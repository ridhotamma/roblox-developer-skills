#!/usr/bin/env node
// Roblox performance scanner: per-frame work, allocation churn, replication-heavy server code,
// leaks and deprecated slow APIs in Luau source, plus content problems in places saved as XML
// (streaming off, shadow-casting lights, small shadow casters, transparency, precise collision,
// unanchored parts, Humanoids, particle load, scripts in parts, what replicates at join...).
//
//   node perfscan.cjs <path> [--json] [--min info|low|medium|high] [--fail-on <severity>] [--no-stats]
//
// <path>: a folder (Rojo src tree, scanned recursively for .lua/.luau/.rbxlx/.rbxmx), a single
// .lua/.luau file, or a place/model saved as XML (.rbxlx/.rbxmx). Binary .rbxl/.rbxm files can't
// be read: convert with `lune run rbxl-to-rbxlx.luau <file>` or File -> Save to File As .rbxlx.
//
// Suppress a finding on one line with a comment:  -- perf:ignore <rule-id>
// It's a pattern scan, not a profiler: findings say where to look. Measure in game to confirm.
// Also usable as a module: const { scanPath } = require('./perfscan.cjs').
'use strict';

const fs = require('fs');
const path = require('path');

const SEVERITIES = ['info', 'low', 'medium', 'high'];
const rank = (s) => SEVERITIES.indexOf(s);
const SKIP_DIRS = new Set(['.git', 'node_modules', 'Packages', 'ServerPackages', 'DevPackages', '_Index', 'build']);

// ---------------------------------------------------------------------------------------
// Loading

function decodeXml(s) {
  return s
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, d) => String.fromCharCode(Number(d)))
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCharCode(parseInt(h, 16)))
    .replace(/&amp;/g, '&');
}

// 'server' | 'client' | 'shared' | 'unknown', from a Rojo-style path.
function contextFromFilePath(rel) {
  const p = rel.replace(/\\/g, '/');
  if (/\.server\.luau?$/i.test(p)) return 'server';
  if (/\.client\.luau?$/i.test(p)) return 'client';
  const dirs = p.toLowerCase().split('/').slice(0, -1);
  const has = (re) => dirs.some((s) => re.test(s));
  if (has(/^(server|serverscriptservice|serverstorage|services)$/)) return 'server';
  if (has(/^(client|starterplayerscripts|startercharacterscripts|startergui|starterpack|controllers|ui|gui)$/)) return 'client';
  if (has(/^(shared|common|replicatedstorage|replicatedfirst)$/)) return 'shared';
  return 'unknown';
}

const BASEPART = new Set(['Part', 'MeshPart', 'UnionOperation', 'IntersectOperation', 'PartOperation', 'WedgePart', 'CornerWedgePart', 'TrussPart', 'SpawnLocation', 'Seat', 'VehicleSeat', 'SkateboardPlatform']);
const LIGHTS = new Set(['PointLight', 'SpotLight', 'SurfaceLight']);
const SCRIPTS = new Set(['Script', 'LocalScript', 'ModuleScript']);
const REPLICATED_TOP = new Set(['ReplicatedStorage', 'ReplicatedFirst', 'StarterGui', 'StarterPack', 'StarterPlayer', 'Lighting']);
const SERVER_TOP = new Set(['ServerScriptService', 'ServerStorage']);
const CLIENT_TOP = new Set(['StarterGui', 'StarterPack', 'StarterPlayer', 'ReplicatedFirst']);
const TECHNOLOGY = ['Legacy', 'Voxel', 'Compatibility', 'ShadowMap', 'Future'];
const STREAM_PERSISTENT = new Set([2, 3]); // ModelStreamingMode.Persistent, PersistentPerPlayer
const FIDELITY_PRECISE = 3; // CollisionFidelity.PreciseConvexDecomposition
const RENDER_PRECISE = 1; // RenderFidelity.Precise

const prop = (props, ...names) => {
  for (const n of names) if (props[n] !== undefined) return props[n];
  return undefined;
};
const boolOf = (props, name, dflt) => {
  const v = prop(props, name);
  return v === undefined ? dflt : v.trim() === 'true';
};
const numOf = (props, name, dflt) => {
  const v = prop(props, name);
  if (v === undefined) return dflt;
  const t = v.trim().toLowerCase();
  if (t === 'inf' || t === '+inf' || t === 'infinity') return Infinity;
  const n = parseFloat(t);
  return Number.isNaN(n) ? dflt : n;
};
const vec3Of = (props, ...names) => {
  const v = prop(props, ...names);
  if (v === undefined) return null;
  const g = (axis) => parseFloat((v.match(new RegExp(`<${axis}>([^<]*)</${axis}>`)) || [])[1]);
  return [g('X'), g('Y'), g('Z')];
};
const rangeOf = (props, name, dflt) => {
  const v = prop(props, name);
  if (v === undefined) return dflt;
  const nums = v.trim().split(/\s+/).map(Number).filter((n) => !Number.isNaN(n));
  return nums.length >= 2 ? [nums[0], nums[1]] : dflt;
};
const contentOf = (props, ...names) => {
  const raw = prop(props, ...names);
  if (raw === undefined) return '';
  const m = raw.match(/<(?:url|uri)>([^<]*)<\/(?:url|uri)>/);
  if (m) return decodeXml(m[1]).trim();
  if (/<null\s*\/?>/.test(raw)) return '';
  return decodeXml(raw).trim();
};

function xmlScriptContext(cls, props, top) {
  if (cls === 'LocalScript') return 'client';
  if (cls === 'Script') {
    const runContext = numOf(props, 'RunContext', 0); // Legacy 0, Server 1, Client 2
    if (runContext === 2) return 'client';
    if (runContext === 1) return 'server';
    return SERVER_TOP.has(top) || top === 'Workspace' ? 'server' : 'unknown';
  }
  if (SERVER_TOP.has(top)) return 'server';
  if (CLIENT_TOP.has(top)) return 'client';
  if (top === 'ReplicatedStorage' || top === 'Workspace') return 'shared';
  return 'unknown';
}

function newPlaceStats(display) {
  return {
    display, isPlace: false,
    streaming: null, streamingTargetRadius: null, technology: null, globalShadows: null, terrainDecoration: null,
    wsInstances: 0, parts: 0, anchored: 0, unanchored: 0, meshParts: 0, unions: 0,
    smallShadow: 0, semiTransparent: 0, preciseCollision: 0, preciseUnused: 0, preciseRender: 0,
    lights: 0, shadowLights: 0, emitters: [], aliveParticles: 0, beams: 0, trails: 0,
    humanoids: 0, workspaceScripts: [], surfaceGuis: 0, billboards: 0, billboardsNoLimit: 0, viewports: 0,
    loopedSounds: 0, persistentModels: 0, persistentParts: 0,
    meshIds: new Set(), textureIds: new Set(),
    replicatedInstances: 0, replicatedParts: 0, models: [],
  };
}

function parseXml(file, display) {
  const xml = fs.readFileSync(file, 'utf8');
  const stats = newPlaceStats(display);
  const scripts = [];
  const stack = [];
  const topLevel = [];
  const re = /<Item\s+class="([^"]+)"[^>]*>|<\/Item>|<(\w+)\s+name="([^"]+)"\s*>([\s\S]*?)<\/\2>/g;
  let m;
  const texture = (id) => { if (id) stats.textureIds.add(id); };

  while ((m = re.exec(xml))) {
    if (m[1] !== undefined) {
      const node = { cls: m[1], name: m[1], props: {}, parts: 0 };
      if (stack.length === 0) topLevel.push(node.cls);
      stack.push(node);
      continue;
    }
    if (m[0] === '</Item>') {
      const node = stack.pop();
      if (!node) continue;
      const parent = stack[stack.length - 1];
      const top = stack.length ? stack[0].cls : node.cls;
      const chain = [...stack.map((s) => s.name), node.name];
      const where = `${display}:${chain.join('.')}`;
      const isModelFile = !topLevel.includes('Workspace');
      const inWorkspace = (top === 'Workspace' && stack.length > 0) || isModelFile;
      const p = node.props;
      const cls = node.cls;

      if (BASEPART.has(cls)) node.parts += 1;
      if (parent) parent.parts += node.parts;

      if (stack.length === 0) {
        // a service (place) or a top-level model (model file)
        if (cls === 'Workspace') {
          stats.isPlace = true;
          const s = prop(p, 'StreamingEnabled');
          stats.streaming = s === undefined ? null : s.trim() === 'true';
          stats.streamingTargetRadius = numOf(p, 'StreamingTargetRadius', null);
        } else if (cls === 'Lighting') {
          const t = numOf(p, 'Technology', null);
          stats.technology = t === null ? null : TECHNOLOGY[t] || `Technology(${t})`;
          stats.globalShadows = boolOf(p, 'GlobalShadows', true);
        }
        if (!isModelFile) continue;
      }

      if (SCRIPTS.has(cls)) {
        const source = prop(p, 'Source');
        if (source !== undefined) {
          scripts.push({ where, className: cls, context: xmlScriptContext(cls, p, top), source: decodeXml(source) });
        }
      }

      if (REPLICATED_TOP.has(top) && stack.length > 0 && !isModelFile) {
        stats.replicatedInstances += 1;
        if (BASEPART.has(cls)) stats.replicatedParts += 1;
        if (cls === 'ViewportFrame') stats.viewports += 1;
        continue;
      }
      if (!inWorkspace) continue;

      stats.wsInstances += 1;
      if (cls === 'Terrain') {
        stats.terrainDecoration = boolOf(p, 'Decoration', false);
      } else if (BASEPART.has(cls)) {
        stats.parts += 1;
        if (boolOf(p, 'Anchored', false)) stats.anchored += 1;
        else stats.unanchored += 1;
        const size = vec3Of(p, 'size', 'Size') || [4, 1, 2];
        const transparency = numOf(p, 'Transparency', 0);
        if (boolOf(p, 'CastShadow', true) && transparency < 1 && Math.max(...size) < 1.5) stats.smallShadow += 1;
        if (transparency > 0 && transparency < 1) stats.semiTransparent += 1;
        if (numOf(p, 'CollisionFidelity', 0) === FIDELITY_PRECISE) {
          stats.preciseCollision += 1;
          if (!boolOf(p, 'CanCollide', true) && !boolOf(p, 'CanQuery', true) && !boolOf(p, 'CanTouch', true)) stats.preciseUnused += 1;
        }
        if (numOf(p, 'RenderFidelity', 0) === RENDER_PRECISE) stats.preciseRender += 1;
        if (cls === 'MeshPart') {
          stats.meshParts += 1;
          const meshId = contentOf(p, 'MeshId', 'MeshID', 'MeshContent');
          if (meshId) stats.meshIds.add(meshId);
          texture(contentOf(p, 'TextureID', 'TextureId', 'TextureContent'));
        } else if (cls === 'UnionOperation') {
          stats.unions += 1;
        }
      } else if (LIGHTS.has(cls)) {
        stats.lights += 1;
        if (boolOf(p, 'Enabled', true) && boolOf(p, 'Shadows', false)) stats.shadowLights += 1;
      } else if (cls === 'ParticleEmitter') {
        const rate = numOf(p, 'Rate', 20);
        const [lo, hi] = rangeOf(p, 'Lifetime', [5, 10]);
        const alive = rate * (lo + hi) / 2;
        if (boolOf(p, 'Enabled', true)) stats.aliveParticles += alive;
        stats.emitters.push({ where, alive, rate });
      } else if (cls === 'Beam') {
        stats.beams += 1;
      } else if (cls === 'Trail') {
        stats.trails += 1;
      } else if (cls === 'Humanoid') {
        stats.humanoids += 1;
      } else if (cls === 'Script' || cls === 'LocalScript') {
        stats.workspaceScripts.push(where);
      } else if (cls === 'SurfaceGui') {
        stats.surfaceGuis += 1;
      } else if (cls === 'BillboardGui') {
        stats.billboards += 1;
        const max = numOf(p, 'MaxDistance', Infinity);
        if (!Number.isFinite(max) || max <= 0) stats.billboardsNoLimit += 1;
      } else if (cls === 'ViewportFrame') {
        stats.viewports += 1;
      } else if (cls === 'Sound') {
        if (boolOf(p, 'Looped', false) && boolOf(p, 'Playing', false)) stats.loopedSounds += 1;
      } else if (cls === 'Decal' || cls === 'Texture') {
        texture(contentOf(p, 'Texture', 'TextureContent'));
      } else if (cls === 'SurfaceAppearance') {
        texture(contentOf(p, 'ColorMap', 'ColorMapContent'));
      }
      if (cls === 'Model') {
        if (STREAM_PERSISTENT.has(numOf(p, 'ModelStreamingMode', 0))) {
          stats.persistentModels += 1;
          stats.persistentParts += node.parts;
        }
        const topModel = isModelFile ? stack.length === 0 : stack.slice(1).every((s) => s.cls === 'Folder');
        if (topModel) stats.models.push({ where, parts: node.parts });
      }
      continue;
    }
    // a property
    if (stack.length && m[3] !== undefined) {
      const node = stack[stack.length - 1];
      node.props[m[3]] = m[4];
      if (m[3] === 'Name') node.name = decodeXml(m[4]);
    }
  }
  return { scripts, place: stats };
}

function loadPath(target) {
  const abs = path.resolve(target);
  const stat = fs.statSync(abs);
  const result = { scripts: [], places: [], skipped: [] };
  const files = [];
  const base = stat.isDirectory() ? abs : path.dirname(abs);
  const walk = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (e.isDirectory()) {
        if (!SKIP_DIRS.has(e.name)) walk(path.join(dir, e.name));
      } else files.push(path.join(dir, e.name));
    }
  };
  if (stat.isDirectory()) walk(abs);
  else files.push(abs);

  for (const f of files) {
    const rel = path.relative(base, f) || path.basename(f);
    const ext = path.extname(f).toLowerCase();
    if (ext === '.lua' || ext === '.luau') {
      result.scripts.push({ where: rel, className: 'Script', context: contextFromFilePath(rel), source: fs.readFileSync(f, 'utf8') });
    } else if (ext === '.rbxlx' || ext === '.rbxmx') {
      const x = parseXml(f, rel);
      result.scripts.push(...x.scripts);
      result.places.push(x.place);
    } else if (ext === '.rbxl' || ext === '.rbxm') {
      result.skipped.push(`${rel} (binary: convert with scripts/rbxl-to-rbxlx.luau or save as .rbxlx / .rbxmx)`);
    }
  }
  return result;
}

// ---------------------------------------------------------------------------------------
// Source helpers

function stripComments(src) {
  return src
    .replace(/--\[(=*)\[[\s\S]*?\]\1\]/g, (c) => c.replace(/[^\n]/g, ' '))
    .replace(/--[^\n]*/g, (c) => ' '.repeat(c.length));
}

const indentOf = (line) => (line.match(/^\s*/) || [''])[0].length;
const blank = (line) => line.trim() === '';

function snippet(line) {
  const t = (line || '').trim();
  return t.length > 140 ? `${t.slice(0, 137)}...` : t;
}

// Body lines (indices) of the block opened on line i, by indentation.
function blockFrom(lines, i, cap = 120) {
  const opener = lines[i];
  // one-liner: `X:Connect(function() ... end)`
  if (/\bfunction\b[^)]*\)/.test(opener) && /\bend\b[\s)]*[,;]?\s*$/.test(opener.replace(/^.*?\bfunction\b[^)]*\)/, ''))) return [i];
  const base = indentOf(opener);
  const out = [];
  for (let j = i + 1; j < lines.length && out.length < cap; j++) {
    const l = lines[j];
    if (blank(l)) continue;
    const ind = indentOf(l);
    if (ind < base) break;
    if (ind === base) break; // the closing `end` / `end)` (or the next statement)
    out.push(j);
  }
  return out;
}

// Indices of the lines that enclose line i (each less indented than the last), innermost first.
function enclosing(lines, i) {
  const out = [];
  let cur = indentOf(lines[i]);
  for (let j = i - 1; j >= 0 && cur > 0; j--) {
    const l = lines[j];
    if (blank(l)) continue;
    const ind = indentOf(l);
    if (ind < cur) {
      out.push(j);
      cur = ind;
    }
  }
  return out;
}

const ignored = (rawLine, id) => new RegExp(`perf:ignore\\b[^\\n]*\\b${id}\\b`).test(rawLine || '');

// ---------------------------------------------------------------------------------------
// Code rules

const FRAME_CONNECT = /\b(RenderStepped|Heartbeat|Stepped|PreRender|PreAnimation|PreSimulation|PostSimulation)\s*:\s*(Connect|ConnectParallel)\s*\(\s*function\b/;
const BIND_RENDER = /BindToRenderStep\s*\([^,]+,[^,]+,\s*function\b/;
const WHILE_OPEN = /^\s*while\s+(.+?)\s+do\s*$/;
const FRAME_WAIT = /\btask\.wait\s*\(\s*(0?\.0\d*|0|1\s*\/\s*\d{2,})?\s*\)|(^|[^.:\w])wait\s*\(\s*\)|\b(Heartbeat|RenderStepped|Stepped|PreRender|PreSimulation|PostSimulation)\s*:\s*Wait\s*\(/;
const COLLECTION_LOOP = /^\s*for\b.*\bin\b.*(GetChildren|GetDescendants|GetTagged)\s*\(/;
const PER_OBJECT_SETUP = /(GetInstanceAddedSignal\s*\([^)]*\)\s*:\s*Connect|ChildAdded\s*:\s*Connect|DescendantAdded\s*:\s*Connect|\bSetup\s*=\s*function|function\s+[\w.:]*\b(Setup|Construct)\s*\()/;
const JOIN_HANDLER = /\b(PlayerAdded|CharacterAdded)\s*:\s*Connect\s*\(\s*function\b/;
const LONG_LIVED_CONNECT = /\b(RunService|UserInputService|UIS|workspace|Workspace|ReplicatedStorage|Lighting|Players|game)\s*\.\s*\w+\s*:\s*(Connect|ConnectParallel)\s*\(|:BindToRenderStep\s*\(/;
const REMOTE_HANDLER = /\b(OnServerEvent|OnClientEvent)\s*:\s*Connect\s*\(|\bOnServerInvoke\s*=|\bOnClientInvoke\s*=|\bNet\.Handle\s*\(/;
const CLEANUP = /:Disconnect\s*\(|\bTrove\b|\bJanitor\b|\bMaid\b|:Once\s*\(|\bDoCleaning\b|:Clean\s*\(/;

const LINE_RULES = [
  {
    id: 'legacy-wait', severity: 'medium',
    title: 'Legacy wait()/spawn()/delay(): throttled, waits at least ~30 ms, deprecated',
    fix: 'Use task.wait / task.spawn / task.delay.',
    re: /(^|[^.:\w])(wait|spawn|delay)\s*\(/,
    when: (u, line) => !/\bfunction\s+(wait|spawn|delay)\s*\(/.test(line),
  },
  {
    id: 'renderstepped-on-server', severity: 'high',
    title: 'Render-step API in server code: it never runs on the server',
    fix: 'Use Heartbeat / PostSimulation on the server; RenderStepped, PreRender and BindToRenderStep are client-only.',
    re: /\b(RenderStepped|PreRender|BindToRenderStep)\b/,
    when: (u) => u.context === 'server',
  },
  {
    id: 'instance-new-parent-arg', severity: 'low',
    title: 'Instance.new with a parent argument: every property set afterwards replicates and re-renders separately',
    fix: 'Create it, set all properties, then set Parent last.',
    re: /Instance\.new\s*\(\s*["'][^"']+["']\s*,\s*[^)\s]/,
  },
  {
    id: 'deprecated-spatial', severity: 'medium',
    title: 'Deprecated spatial query (Region3 / FindPartOnRay)',
    fix: 'Use workspace:Raycast / Spherecast / Blockcast and GetPartBoundsInBox / GetPartBoundsInRadius with params created once.',
    re: /\b(FindPartsInRegion3(WithIgnoreList|WithWhiteList)?|FindPartOnRay(WithIgnoreList|WithWhitelist)?)\s*\(/,
  },
  {
    id: 'set-primary-part-cframe', severity: 'low',
    title: 'SetPrimaryPartCFrame/GetPrimaryPartCFrame: deprecated, and parts drift apart over time',
    fix: 'Use Model:PivotTo / GetPivot; for many models per frame, workspace:BulkMoveTo.',
    re: /\b(SetPrimaryPartCFrame|GetPrimaryPartCFrame)\s*\(/,
  },
  {
    id: 'preload-everything', severity: 'high',
    title: 'PreloadAsync on the whole game or a whole tree: players wait for every asset before they can play',
    fix: 'Preload only what the first screen shows (loading screen art, spawn area, first music) and let the rest load in the background.',
    re: /PreloadAsync\s*\(\s*(\{\s*)?(game|workspace|Workspace)\s*[,})]|PreloadAsync\s*\(\s*[\w.:]*GetDescendants\s*\(/,
  },
  {
    id: 'humanoid-load-animation', severity: 'low',
    title: 'Humanoid:LoadAnimation is deprecated',
    fix: 'Load through the Animator (humanoid:FindFirstChildOfClass("Animator")) once per character and cache the tracks.',
    re: /[Hh]umanoid\w*\s*:\s*LoadAnimation\s*\(/,
  },
  {
    id: 'queue-shift', severity: 'low',
    title: 'Inserts/removes at the front of an array: shifts every element (O(n) per call)',
    fix: 'For queues keep head/tail indices or a ring buffer; for unordered lists swap-remove with the last element.',
    re: /table\.remove\s*\(\s*[^,()]+,\s*1\s*\)|table\.insert\s*\(\s*[^,()]+,\s*1\s*,/,
  },
  {
    id: 'server-tween', severity: 'medium',
    title: 'Tween on the server: every step replicates to every client and looks choppy with latency',
    fix: 'Tween cosmetic motion on clients (fire an event or set an attribute; a client component animates). If the server must own the end state, set it once when the tween would finish.',
    re: /TweenService\s*:\s*Create\s*\(/,
    when: (u) => u.context === 'server',
  },
];

// Applied to the body of per-frame handlers and per-frame loops. Reported once per body.
const FRAME_BODY_RULES = [
  {
    id: 'remote-in-frame', severity: 'high',
    title: 'Fires a remote every frame',
    fix: 'Send at most 10-20 times a second, only when the value changed, batched into one call; use an UnreliableRemoteEvent for continuous state.',
    re: /:(FireServer|FireAllClients|FireClient)\s*\(/,
  },
  {
    id: 'load-animation-in-frame', severity: 'high',
    title: 'Loads an animation track every frame',
    fix: 'Load each track once per character and keep it; tracks loaded repeatedly leak and hit the per-Animator track limit.',
    re: /:LoadAnimation\s*\(/,
  },
  {
    id: 'alloc-in-frame', severity: 'medium',
    title: 'Creates Instances every frame',
    fix: 'Create once and reuse, or take them from a Pool; for effects, :Emit() from an existing emitter.',
    re: /Instance\.new\s*\(|:Clone\s*\(\s*\)/,
  },
  {
    id: 'descendants-in-frame', severity: 'medium',
    title: 'Walks every descendant every frame',
    fix: 'Collect the objects once and keep the list current with CollectionService or DescendantAdded/Removing.',
    re: /:GetDescendants\s*\(\s*\)/,
  },
  {
    id: 'tween-in-frame', severity: 'medium',
    title: 'Creates a tween every frame',
    fix: 'Create tweens once and :Play() them, or set the property directly in the loop.',
    re: /TweenService\s*:\s*Create\s*\(/,
  },
  {
    id: 'yield-in-frame', severity: 'medium', connectOnly: true,
    title: 'Yields inside a per-frame handler: every frame starts another thread that piles up',
    fix: 'Resolve instances before connecting; never wait inside RenderStepped/Heartbeat handlers.',
    re: /:WaitForChild\s*\(|\btask\.wait\s*\(|(^|[^.:\w])wait\s*\(/,
  },
  {
    id: 'children-in-frame', severity: 'low',
    title: 'Builds a new list of children/tagged instances every frame',
    fix: 'Keep the list and update it from ChildAdded/ChildRemoved or tag signals.',
    re: /:GetChildren\s*\(\s*\)|:GetTagged\s*\(/,
  },
  {
    id: 'params-in-frame', severity: 'low',
    title: 'Creates RaycastParams/OverlapParams every frame',
    fix: 'Create them once and reuse; update FilterDescendantsInstances only when the list changes.',
    re: /\b(RaycastParams|OverlapParams)\.new\s*\(/,
  },
  {
    id: 'getservice-in-frame', severity: 'low',
    title: 'Calls GetService every frame',
    fix: 'Get services once at the top of the script.',
    re: /:GetService\s*\(/,
  },
  {
    id: 'text-in-frame', severity: 'low', clientOnly: true,
    title: 'Sets UI text every frame',
    fix: 'Write Text only when the shown value changed; every write re-measures and re-renders the label.',
    re: /\.Text\s*(\.\.)?=(?!=)/,
  },
];

function push(findings, unit, rule, lineIdx, raw, extraTitle = '') {
  findings.push({ rule: rule.id, severity: rule.severity, title: rule.title + extraTitle, fix: rule.fix, where: unit.where, line: lineIdx + 1, snippet: snippet(raw[lineIdx]) });
}

function scanFrameBody(unit, findings, lines, raw, openerIdx, bodyIdx, isConnect, label) {
  const seen = new Set();
  for (const j of bodyIdx) {
    const l = j === openerIdx ? lines[j].replace(/^.*?\bfunction\b[^)]*\)/, '') : lines[j];
    for (const rule of FRAME_BODY_RULES) {
      if (seen.has(rule.id)) continue;
      if (rule.connectOnly && !isConnect) continue;
      if (rule.clientOnly && unit.context === 'server') continue;
      if (!rule.re.test(l)) continue;
      if (ignored(raw[j], rule.id) || ignored(raw[openerIdx], rule.id)) continue;
      seen.add(rule.id);
      push(findings, unit, rule, j, raw, ` (${label})`);
    }
  }
  const text = bodyIdx.map((j) => lines[j]).join('\n');
  if (/^\s*for\b/m.test(text) && /\.CFrame\s*\*?=(?!=)|:PivotTo\s*\(/.test(text) && !ignored(raw[openerIdx], 'bulk-move')) {
    push(findings, unit, {
      id: 'bulk-move', severity: 'low',
      title: 'Moves objects one at a time in a loop every frame',
      fix: 'For many anchored parts use workspace:BulkMoveTo(parts, cframes, Enum.BulkMoveMode.FireCFrameChanged); move welded assemblies by their root part.',
    }, openerIdx, raw);
  }
  if (unit.context === 'server' && /\.(CFrame|Position|Orientation|Rotation|Color|Transparency|Size)\s*[*+\-/]?=(?!=)|:PivotTo\s*\(/.test(text) && !ignored(raw[openerIdx], 'server-animation')) {
    push(findings, unit, {
      id: 'server-animation', severity: 'medium',
      title: 'Changes part properties every frame on the server: each change replicates to every client and rebuilds render data',
      fix: 'Animate cosmetic motion (spinning coins, bobbing pickups, doors swinging, colour pulses) on clients. The server changes a part only when gameplay needs it.',
    }, openerIdx, raw);
  }
}

function scanScript(unit, findings) {
  const raw = unit.source.split('\n');
  const lines = stripComments(unit.source).split('\n');
  const hasCleanup = CLEANUP.test(lines.join('\n'));
  const fileText = lines.join('\n');

  lines.forEach((line, i) => {
    // line rules
    for (const rule of LINE_RULES) {
      if (!rule.re.test(line)) continue;
      if (rule.when && !rule.when(unit, line)) continue;
      if (ignored(raw[i], rule.id)) continue;
      push(findings, unit, rule, i, raw);
    }

    // per-frame handlers
    const isConnect = FRAME_CONNECT.test(line) || BIND_RENDER.test(line);
    const w = line.match(WHILE_OPEN);
    if (w) {
      const cond = w[1];
      const body = blockFrom(lines, i);
      const bodyText = body.map((j) => lines[j]).join('\n');
      if (FRAME_WAIT.test(cond) || (/^true$/.test(cond.trim()) && FRAME_WAIT.test(bodyText))) {
        if (!ignored(raw[i], 'polling-loop')) {
          push(findings, unit, {
            id: 'polling-loop', severity: 'low',
            title: 'Loop that runs every frame',
            fix: 'Prefer events (GetPropertyChangedSignal, AttributeChanged, tag signals) or one Heartbeat connection per system; if it must poll, poll at the slowest rate that still feels right.',
          }, i, raw);
        }
        scanFrameBody(unit, findings, lines, raw, i, body, false, 'per-frame loop');
      }
    }
    if (isConnect) {
      const body = blockFrom(lines, i);
      scanFrameBody(unit, findings, lines, raw, i, body, true, 'per-frame handler');
      const outer = enclosing(lines, i).map((j) => lines[j]);
      const perObject = outer.some((l) => COLLECTION_LOOP.test(l) || PER_OBJECT_SETUP.test(l)) || /(^|\/)components\//i.test(unit.where.replace(/\\/g, '/'));
      if (perObject && !ignored(raw[i], 'per-object-frame-loop')) {
        push(findings, unit, {
          id: 'per-object-frame-loop', severity: 'medium',
          title: 'Each object connects its own per-frame loop: with hundreds of objects this dominates the frame',
          fix: 'Run one loop per system over a set of objects (the kit\'s Scheduler: time budget, round-robin, distance-based update rates).',
        }, i, raw);
      }
    }

    // Touched connected per part inside a loop over many parts
    if (/\.Touched\s*:\s*Connect\s*\(/.test(line) && enclosing(lines, i).some((j) => COLLECTION_LOOP.test(lines[j])) && !ignored(raw[i], 'touched-in-loop')) {
      push(findings, unit, {
        id: 'touched-in-loop', severity: 'low',
        title: 'Connects Touched on every part in a loop',
        fix: 'Fine for a few dozen parts. For hundreds: turn CanTouch off where it isn\'t needed, or check zones with GetPartBoundsInBox/InRadius on a timer from one loop.',
      }, i, raw);
    }

    // Nested loops over all players
    if (/^\s*for\b.*\bin\b.*GetPlayers\s*\(/.test(line)) {
      const body = blockFrom(lines, i);
      const inner = body.find((j) => /^\s*for\b.*\bin\b.*GetPlayers\s*\(/.test(lines[j]));
      if (inner !== undefined && !ignored(raw[i], 'nested-player-loop')) {
        push(findings, unit, {
          id: 'nested-player-loop', severity: 'medium',
          title: 'Loop over all players inside a loop over all players (cost grows with players squared)',
          fix: 'Fine once in a while with few players. Per frame, or with raycasts inside, bucket players into a spatial grid and only compare neighbours.',
        }, i, raw);
      }
    }

    // Handlers connected per join / per spawn
    if (JOIN_HANDLER.test(line)) {
      const body = blockFrom(lines, i);
      for (const j of body) {
        if (REMOTE_HANDLER.test(lines[j]) && !ignored(raw[j], 'handler-per-join')) {
          push(findings, unit, {
            id: 'handler-per-join', severity: 'high',
            title: 'Connects a remote handler every time a player joins or respawns: handlers pile up, run once per connection and are never freed',
            fix: 'Connect remote handlers once at startup and look the player up from the handler\'s first argument.',
          }, j, raw);
          break;
        }
      }
      if (!hasCleanup) {
        for (const j of body) {
          if (LONG_LIVED_CONNECT.test(lines[j]) && !ignored(raw[j], 'connection-leak')) {
            push(findings, unit, {
              id: 'connection-leak', severity: 'medium',
              title: 'Connects to a long-lived signal on every join/spawn and never disconnects: connections and everything they reference pile up',
              fix: 'Keep the connection in a Trove (or variable) tied to the player/character and clean it up on PlayerRemoving / character removal (or use :Once).',
            }, j, raw);
            break;
          }
        }
      }
    }
  });

  // Per-player tables never cleared
  if (unit.context !== 'client' && !/PlayerRemoving|__mode|Destroying/.test(fileText)) {
    const idx = lines.findIndex((l) => /\w+\s*\[\s*(player|plr|plyr|client)\s*\]\s*=\s*(?!nil\b)\S/.test(l));
    if (idx >= 0 && !ignored(raw[idx], 'player-table-leak')) {
      push(findings, unit, {
        id: 'player-table-leak', severity: 'medium',
        title: 'Stores per-player state in a table but nothing clears it when players leave (the server leaks memory for every player who ever joined)',
        fix: 'Clear the entry in Players.PlayerRemoving (or keep per-player state in one PlayerData module that does).',
      }, idx, raw);
    }
  }
}

// ---------------------------------------------------------------------------------------
// Place rules (same ids and thresholds as assets/studio/PerfAudit.luau)

const fmt = (n) => Math.round(n).toLocaleString('en-US');

function placeFindings(s, findings) {
  const add = (rule, severity, title, fix) => findings.push({ rule, severity, title, fix, where: s.display, line: 0, snippet: '' });
  if (s.streaming === false && s.parts > 3000) {
    add('streaming-off', s.parts > 20000 ? 'high' : 'medium', `StreamingEnabled is off with ${fmt(s.parts)} parts: every client loads and keeps the whole map`,
      'Turn Workspace.StreamingEnabled on, then make client code handle parts that are not there yet (tags + components, WaitForChild with timeouts).');
  }
  if (s.shadowLights > 8) {
    add('shadowed-lights', s.shadowLights > 25 ? 'high' : 'medium', `${s.shadowLights} enabled lights cast shadows (${s.lights} lights total, Technology ${s.technology || '?'})`,
      'Keep Shadows on only for a few key lights near players; turn it off on fill, decorative and small lights.');
  }
  if (s.smallShadow > 500) {
    add('small-shadow-casters', s.smallShadow > 5000 ? 'medium' : 'low', `${fmt(s.smallShadow)} parts under 1.5 studs cast shadows`,
      'Turn CastShadow off on small props, trim, interior detail and anything players will not miss.');
  }
  if (s.semiTransparent > 300) {
    add('semi-transparent', s.semiTransparent > 2000 ? 'medium' : 'low', `${fmt(s.semiTransparent)} parts are semi-transparent (0 < Transparency < 1): sorted and overdrawn every frame`,
      'Make them opaque or fully invisible where possible; avoid stacking glass, water and fog layers.');
  }
  if (s.preciseCollision > 100) {
    add('precise-collision', 'medium', `${fmt(s.preciseCollision)} MeshParts/unions use PreciseConvexDecomposition collision`,
      'Use Box or Hull for decor and anything players do not need to collide with precisely.');
  }
  if (s.preciseUnused > 0) {
    add('precise-collision-unused', 'low', `${fmt(s.preciseUnused)} parts have precise collision geometry but CanCollide, CanQuery and CanTouch all off`,
      'Set CollisionFidelity to Box: the geometry is built and stored for nothing.');
  }
  if (s.preciseRender > 200) {
    add('precise-render', 'low', `${fmt(s.preciseRender)} MeshParts/unions use RenderFidelity Precise (no distance LOD)`,
      'Use Automatic except for hero meshes the camera sees up close.');
  }
  if (s.unanchored > 500) {
    add('unanchored-parts', s.unanchored > 3000 ? 'high' : 'medium', `${fmt(s.unanchored)} unanchored parts in Workspace (physics simulates and replicates them)`,
      'Anchor everything that does not need to move; weld moving pieces into few assemblies.');
  }
  if (s.humanoids > 50) {
    add('humanoid-npcs', s.humanoids > 150 ? 'high' : 'medium', `${s.humanoids} Humanoids in Workspace`,
      'Humanoids are among the most expensive instances. NPCs that do not need one: AnimationController + Animator; crowds: simulate positions on the server and render models on clients.');
  }
  if (s.aliveParticles > 5000) {
    add('particle-load', s.aliveParticles > 20000 ? 'high' : 'medium', `~${fmt(s.aliveParticles)} particles alive at once from always-on emitters (Rate x Lifetime)`,
      'Lower Rate, shorten Lifetime, use fewer bigger particles, and disable emitters far from the camera (PerfLod tag).');
  }
  if (s.workspaceScripts.length > 20) {
    add('workspace-scripts', 'medium', `${s.workspaceScripts.length} Scripts/LocalScripts inside Workspace`,
      'Replace copies of the same script in many parts with a CollectionService tag and one component.');
  }
  if (s.replicatedInstances > 20000) {
    add('replicated-heavy', s.replicatedInstances > 60000 ? 'high' : 'medium', `${fmt(s.replicatedInstances)} instances (${fmt(s.replicatedParts)} parts) in ReplicatedStorage/ReplicatedFirst/Starter*/Lighting: every client downloads them at join`,
      'Move server-only assets to ServerStorage and clone them in when needed; keep rarely used maps and models out of ReplicatedStorage.');
  }
  if (s.meshIds.size > 500) {
    add('unique-meshes', 'medium', `${fmt(s.meshIds.size)} different meshes in Workspace`,
      'Reuse the same mesh (same MeshId and texture) for repeated props so they instance into one draw call; merge small one-offs.');
  }
  if (s.textureIds.size > 300) {
    add('unique-textures', 'medium', `${fmt(s.textureIds.size)} different textures in Workspace (texture memory is the biggest cause of mobile crashes)`,
      'Share textures and atlases across props; use 256-512 px for small props; keep SurfaceAppearance for what is seen up close.');
  }
  if (s.surfaceGuis > 150) {
    add('surface-guis', 'medium', `${s.surfaceGuis} SurfaceGuis in Workspace (each renders its own texture)`,
      'Use decals/textures for static signs; limit live SurfaceGuis to what players read; set MaxDistance.');
  }
  if (s.billboardsNoLimit > 50) {
    add('billboards-no-limit', 'low', `${s.billboardsNoLimit} BillboardGuis draw at any distance`,
      'Set MaxDistance on nameplates, markers and labels (60-150 studs is typical).');
  }
  if (s.viewports > 20) {
    add('viewport-frames', 'low', `${s.viewports} ViewportFrames`,
      'Each one renders its own scene. Show few at once (inventory pages), and use images for static icons.');
  }
  if (s.loopedSounds > 30) {
    add('looped-sounds', 'low', `${s.loopedSounds} looped sounds playing in Workspace`,
      'Play ambience on the client, and only near the player; stop sounds that are out of range.');
  }
  if (s.persistentParts > 2000) {
    add('persistent-models', 'medium', `${s.persistentModels} Persistent models hold ${fmt(s.persistentParts)} parts that never stream out`,
      'Keep ModelStreamingMode Persistent for the few models clients must always have; use Atomic or Default for the rest.');
  }
  if (s.terrainDecoration === true) {
    add('terrain-decoration', 'info', 'Terrain decoration (animated grass) is on',
      'It costs GPU on low-end phones; keep it if it matters to the look, and measure on a phone.');
  }
}

function placeSummary(s) {
  const top = s.models.slice().sort((a, b) => b.parts - a.parts).slice(0, 8);
  const emitters = s.emitters.slice().sort((a, b) => b.alive - a.alive).slice(0, 5);
  return {
    file: s.display,
    kind: s.isPlace ? 'place' : 'model',
    streamingEnabled: s.streaming,
    streamingTargetRadius: s.streamingTargetRadius,
    lightingTechnology: s.technology,
    globalShadows: s.globalShadows,
    workspaceInstances: s.wsInstances,
    parts: s.parts, anchored: s.anchored, unanchored: s.unanchored, meshParts: s.meshParts, unions: s.unions,
    uniqueMeshes: s.meshIds.size, uniqueTextures: s.textureIds.size,
    lights: s.lights, shadowLights: s.shadowLights,
    particleEmitters: s.emitters.length, aliveParticles: Math.round(s.aliveParticles), beams: s.beams, trails: s.trails,
    humanoids: s.humanoids, workspaceScripts: s.workspaceScripts.length,
    surfaceGuis: s.surfaceGuis, billboardGuis: s.billboards, viewportFrames: s.viewports,
    replicatedAtJoin: { instances: s.replicatedInstances, parts: s.replicatedParts },
    heaviestModels: top,
    heaviestEmitters: emitters.map((e) => ({ where: e.where, alive: Math.round(e.alive), rate: e.rate })),
  };
}

// ---------------------------------------------------------------------------------------

function scanPath(target) {
  const loaded = loadPath(target);
  const findings = [];
  for (const unit of loaded.scripts) scanScript(unit, findings);
  for (const place of loaded.places) placeFindings(place, findings);
  findings.sort((a, b) => rank(b.severity) - rank(a.severity) || a.where.localeCompare(b.where) || a.line - b.line);
  return { findings, scripts: loaded.scripts.length, places: loaded.places.map(placeSummary), skipped: loaded.skipped };
}

function printPlace(p) {
  const n = (x) => (x === null || x === undefined ? '?' : typeof x === 'number' ? fmt(x) : String(x));
  console.log(`${p.kind === 'place' ? 'Place' : 'Model'} ${p.file}`);
  if (p.kind === 'place') {
    console.log(`  StreamingEnabled ${n(p.streamingEnabled)} (target ${n(p.streamingTargetRadius)})  Lighting ${n(p.lightingTechnology)}  GlobalShadows ${n(p.globalShadows)}`);
  }
  console.log(`  ${n(p.workspaceInstances)} instances, ${n(p.parts)} parts (${n(p.anchored)} anchored, ${n(p.unanchored)} unanchored), ${n(p.meshParts)} MeshParts, ${n(p.unions)} unions`);
  console.log(`  ${n(p.uniqueMeshes)} unique meshes, ${n(p.uniqueTextures)} unique textures`);
  console.log(`  ${n(p.lights)} lights (${n(p.shadowLights)} with shadows), ${n(p.particleEmitters)} emitters (~${n(p.aliveParticles)} particles alive), ${n(p.beams)} beams, ${n(p.trails)} trails`);
  console.log(`  ${n(p.humanoids)} Humanoids, ${n(p.workspaceScripts)} scripts in Workspace, ${n(p.surfaceGuis)} SurfaceGuis, ${n(p.billboardGuis)} BillboardGuis, ${n(p.viewportFrames)} ViewportFrames`);
  if (p.kind === 'place') console.log(`  Replicated at join (outside Workspace): ${n(p.replicatedAtJoin.instances)} instances, ${n(p.replicatedAtJoin.parts)} parts`);
  if (p.heaviestModels.length) {
    console.log('  Heaviest models (parts):');
    for (const m of p.heaviestModels) console.log(`    ${fmt(m.parts).padStart(8)}  ${m.where.split(':').pop()}`);
  }
  console.log('');
}

function main() {
  const argv = process.argv.slice(2);
  let target = null;
  let json = false;
  let min = 'info';
  let failOn = null;
  let stats = true;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--json') json = true;
    else if (a === '--min') min = argv[++i];
    else if (a === '--fail-on') failOn = argv[++i];
    else if (a === '--no-stats') stats = false;
    else if (a === '-h' || a === '--help') {
      console.log('usage: node perfscan.cjs <path> [--json] [--min info|low|medium|high] [--fail-on <severity>] [--no-stats]');
      process.exit(0);
    } else target = a;
  }
  if (!target) {
    console.error('perfscan: give a folder, .lua/.luau file or .rbxlx/.rbxmx file');
    process.exit(2);
  }
  if (rank(min) < 0 || (failOn && rank(failOn) < 0)) {
    console.error(`perfscan: severities are ${SEVERITIES.join(', ')}`);
    process.exit(2);
  }
  if (!fs.existsSync(target)) {
    console.error(`perfscan: ${target} does not exist`);
    process.exit(2);
  }

  const result = scanPath(target);
  const shown = result.findings.filter((f) => rank(f.severity) >= rank(min));
  if (json) {
    console.log(JSON.stringify({ ...result, findings: shown }, null, 2));
  } else {
    console.log(`Scanned ${result.scripts} script(s) and ${result.places.length} place/model file(s) in ${target}`);
    for (const s of result.skipped) console.log(`  skipped ${s}`);
    const counts = SEVERITIES.slice().reverse().map((s) => `${s}: ${result.findings.filter((f) => f.severity === s).length}`).join('  ');
    console.log(`  ${counts}\n`);
    if (stats) for (const p of result.places) printPlace(p);
    for (const f of shown) {
      const loc = f.line ? `${f.where}:${f.line}` : f.where;
      console.log(`[${f.severity.toUpperCase()}] ${f.rule}  ${loc}`);
      console.log(`  ${f.title}`);
      if (f.snippet) console.log(`  > ${f.snippet}`);
      console.log(`  fix: ${f.fix}\n`);
    }
    if (!shown.length) console.log('No findings at this level. That says nothing about rendering or real frame times: measure in game (MicroProfiler, F9 console).');
  }
  if (failOn && result.findings.some((f) => rank(f.severity) >= rank(failOn))) process.exit(1);
}

module.exports = { scanPath, contextFromFilePath, parseXml };
if (require.main === module) main();
