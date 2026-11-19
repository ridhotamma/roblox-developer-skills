#!/usr/bin/env node
// Runs the music kit's pure Luau modules (MusicTimeline, MusicDirector, MusicConfig, MusicCues)
// in the standalone `luau` CLI, unmodified, and checks the browser lab's JS port against them.
//
//   node tests/run-luau.cjs          Music.spec.luau + JS-vs-Luau replay of every scenario
//
// The bundle gives each module a `script` whose .Parent.X resolves to sibling modules, and a
// `game:GetService("ReplicatedStorage").Shared.Music.X` path, exactly like Studio.
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const HERE = __dirname;
const KIT = path.join(HERE, '..', 'assets', 'kit');
const MODULES = ['shared/Music/MusicCues.luau', 'shared/Music/MusicConfig.luau', 'shared/Music/MusicTimeline.luau', 'shared/Music/MusicDirector.luau'];

function luauAvailable() {
  try { execFileSync('luau', ['--help'], { stdio: 'ignore' }); return true; } catch (e) { return e.code !== 'ENOENT'; }
}

const SHIM = `
local __defs, __cache = {}, {}
local PathMeta = {}
local function Path(key: string): any
	return setmetatable({ __path = key }, PathMeta)
end
PathMeta.__index = function(self: any, name: string): any
	local key = rawget(self, "__path")
	if name == "Parent" then
		return Path((string.match(key, "^(.*)/[^/]+$")) or "")
	end
	return Path(key .. "/" .. name)
end
local function require(target: any): any
	local key = rawget(target, "__path")
	if __cache[key] == nil then
		local def = __defs[key]
		assert(def, "no bundled module " .. tostring(key))
		__cache[key] = def(Path(key))
	end
	return __cache[key]
end
local game = { GetService = function(_: any, name: string): any return Path(name) end }
`;

function bundle(program, extra) {
  const parts = [SHIM];
  for (const rel of MODULES) {
    const key = 'ReplicatedStorage/Shared/' + rel.replace(/^shared\//, '').replace(/\.luau$/, '');
    const src = fs.readFileSync(path.join(KIT, rel), 'utf8').replace(/^--!strict\s*\n/, '');
    parts.push(`__defs[${JSON.stringify(key)}] = function(script: any): any\n${src}\nend`);
  }
  parts.push('local Shared = game:GetService("ReplicatedStorage").Shared');
  parts.push(extra || '');
  parts.push(fs.readFileSync(path.join(HERE, program), 'utf8').replace(/^--!strict\s*\n/, ''));
  return parts.join('\n');
}

function run(program, extra) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'music-luau-'));
  const file = path.join(dir, 'bundle.luau');
  fs.writeFileSync(file, bundle(program, extra));
  try {
    return execFileSync('luau', [file], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  } catch (e) {
    throw new Error(`luau failed (bundle kept at ${file}):\n${((e.stdout || '') + (e.stderr || '')).slice(-4000)}`);
  }
}

// JS value -> Luau literal (for scenarios)
function lit(v) {
  if (v === null || v === undefined) return 'nil';
  if (typeof v === 'number') return Number.isFinite(v) ? String(v) : '0';
  if (typeof v === 'boolean') return String(v);
  if (typeof v === 'string') return JSON.stringify(v);
  if (Array.isArray(v)) return `{ ${v.map(lit).join(', ')} }`;
  return `{ ${Object.entries(v).map(([k, x]) => `[${JSON.stringify(k)}] = ${lit(x)}`).join(', ')} }`;
}

// Same scenarios in both languages: the director's state/intensity every step, and timeline maths.
const { SCENARIOS, TIMELINE_CASES } = require('./scenarios.cjs');

function replayJs() {
  const M = require('../scripts/engine');
  const lines = [];
  for (const sc of SCENARIOS) {
    const d = new M.Director(sc.config);
    let ai = 0;
    for (let step = 1; step <= sc.steps; step++) {
      const t = step * sc.dt;
      while (ai < sc.actions.length && sc.actions[ai].t <= t - sc.dt / 2) {
        const a = sc.actions[ai++];
        if (a.op === 'set') d.SetSource(a.id, a.state, a.intensity, a.ttl === undefined ? undefined : a.ttl);
        else if (a.op === 'clear') d.ClearSource(a.id);
        else if (a.op === 'base') d.SetBase(a.state);
      }
      const r = d.Update(sc.dt);
      lines.push(`${sc.name} ${step} ${r.state} ${r.intensity.toFixed(5)} ${r.changed}`);
    }
  }
  for (const c of TIMELINE_CASES) {
    const T = M.Timeline;
    const pos = T.Position(c.cue, c.start, c.now);
    lines.push(`tl ${c.name} ${T.NextBoundary(c.cue, c.start, c.now, c.sync).toFixed(5)} ${pos.loopTime.toFixed(5)} ${pos.bar} ${pos.beat} ${T.LayerGain(c.min, c.full, c.intensity).toFixed(5)} ${T.EntryOffset(c.cue, c.old || null, c.start, c.now, c.entry).toFixed(5)}`);
  }
  return lines;
}

function replayLuau() {
  const out = run('Replay.luau', `local SCENARIOS = ${lit(SCENARIOS)}\nlocal TIMELINE_CASES = ${lit(TIMELINE_CASES)}\n`);
  return out.split('\n').filter((l) => l.length);
}

module.exports = { luauAvailable, run, replayJs, replayLuau };

if (require.main === module) {
  if (!luauAvailable()) { console.log('luau CLI not found (brew install luau, or rokit add luau-lang/luau); skipped'); process.exit(0); }
  const out = run('Music.spec.luau');
  process.stdout.write(out);
  let failed = /\b0 failed\b/.test(out) ? 0 : 1;
  const js = replayJs(), lu = replayLuau();
  let diffs = 0;
  for (let i = 0; i < Math.max(js.length, lu.length); i++) {
    if (js[i] !== lu[i]) { if (diffs < 10) console.log(`DIFF line ${i + 1}\n  js:   ${js[i]}\n  luau: ${lu[i]}`); diffs++; }
  }
  console.log(`replay: ${js.length} lines, ${diffs} differences between the lab's JS and the kit's Luau`);
  if (diffs) failed = 1;
  process.exit(failed);
}
