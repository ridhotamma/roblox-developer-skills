#!/usr/bin/env node
// Offline checks for the performance skill:
//  1. every scanner rule fires on a bad fixture, and clean code stays clean
//  2. place rules fire on a generated .rbxlx and stay quiet on a light one
//  3. the bundled kit (and sibling skills' kits, when installed alongside) scan clean of medium+
//  4. Luau files are structurally balanced, and docs reference files that exist
//  5. rule ids are consistent across perfscan.cjs, PerfAudit.luau and the audit checklist
// Run: node scripts/selftest.cjs
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { scanPath } = require('./perfscan.cjs');

const SKILL = path.resolve(__dirname, '..');
let failed = 0;
function check(name, cond, extra = '') {
  console.log(`${cond ? 'ok  ' : 'FAIL'} ${name}${cond ? '' : `  ${extra}`}`);
  if (!cond) failed++;
}

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rperf-'));
const write = (rel, text) => {
  const f = path.join(dir, rel);
  fs.mkdirSync(path.dirname(f), { recursive: true });
  fs.writeFileSync(f, text);
  return f;
};
const rulesIn = (target) => new Set(scanPath(target).findings.map((f) => f.rule));

// --- 1. code fixtures ------------------------------------------------------------------

write('bad/server/Coins.server.luau', `
local Players = game:GetService("Players")
local RunService = game:GetService("RunService")
local TweenService = game:GetService("TweenService")
local Remote = game.ReplicatedStorage.Update

local cash = {}

Players.PlayerAdded:Connect(function(player)
	cash[player] = 0
	Remote.OnServerEvent:Connect(function(p, x)
		print(p, x)
	end)
	RunService.Heartbeat:Connect(function()
		print(player.Name)
	end)
end)

for _, coin in workspace.Coins:GetChildren() do
	RunService.Heartbeat:Connect(function(dt)
		coin.CFrame = coin.CFrame * CFrame.Angles(0, dt, 0)
	end)
	coin.Touched:Connect(function() end)
end

RunService.Heartbeat:Connect(function()
	local part = Instance.new("Part")
	part:Destroy()
	for _, d in workspace:GetDescendants() do end
	Remote:FireAllClients(1)
	local params = RaycastParams.new()
	local tween = TweenService:Create(workspace.Door, TweenInfo.new(1), {})
	local hrp = workspace:WaitForChild("Thing")
	for _, m in workspace.Movers:GetChildren() do
		m:PivotTo(CFrame.new())
	end
end)

RunService.RenderStepped:Connect(function() end)

wait(1)
spawn(function() end)
local p = Instance.new("Part", workspace)
local hits = workspace:FindPartsInRegion3(Region3.new(Vector3.zero, Vector3.one))
workspace.Model:SetPrimaryPartCFrame(CFrame.new())
TweenService:Create(workspace.Door, TweenInfo.new(1), {}):Play()
local queue = {}
table.remove(queue, 1)

for _, a in Players:GetPlayers() do
	for _, b in Players:GetPlayers() do
		print(a, b)
	end
end
`);

write('bad/client/Hud.client.luau', `
local RunService = game:GetService("RunService")
local ContentProvider = game:GetService("ContentProvider")
local label = script.Parent.Label
local humanoid = script.Parent.Humanoid

ContentProvider:PreloadAsync(game:GetDescendants())

RunService.RenderStepped:Connect(function()
	label.Text = tostring(os.clock())
	local track = humanoid:LoadAnimation(script.Anim)
	local svc = game:GetService("Players")
	game.ReplicatedStorage.Look:FireServer(workspace.CurrentCamera.CFrame)
end)

while true do
	local children = workspace:GetChildren()
	task.wait()
end
`);

write('bad/server/Components/Spinner.luau', `
local RunService = game:GetService("RunService")
return {
	Tag = "Spinner",
	Setup = function(part, trove)
		trove:Connect(part.Touched, function() end)
		RunService.Heartbeat:Connect(function(dt)
			part.CFrame *= CFrame.Angles(0, dt, 0)
		end)
	end,
}
`);

write('bad/server/Ignore.server.luau', `
wait(1) -- perf:ignore legacy-wait
`);

const bad = rulesIn(path.join(dir, 'bad'));
const expected = [
  'player-table-leak', 'handler-per-join', 'connection-leak', 'per-object-frame-loop', 'touched-in-loop', 'server-animation',
  'alloc-in-frame', 'descendants-in-frame', 'remote-in-frame', 'params-in-frame', 'tween-in-frame', 'yield-in-frame', 'bulk-move',
  'renderstepped-on-server', 'legacy-wait', 'instance-new-parent-arg', 'deprecated-spatial', 'set-primary-part-cframe', 'server-tween',
  'queue-shift', 'nested-player-loop', 'preload-everything', 'text-in-frame', 'load-animation-in-frame', 'getservice-in-frame',
  'humanoid-load-animation', 'polling-loop', 'children-in-frame',
];
for (const id of expected) check(`rule fires: ${id}`, bad.has(id));

write('compound/Spin.server.luau', `
local RunService = game:GetService("RunService")
RunService.Heartbeat:Connect(function(dt)
	script.Parent.CFrame *= CFrame.Angles(0, dt, 0)
end)
`);
check('compound assignment (*=) counts as server animation', rulesIn(path.join(dir, 'compound')).has('server-animation'));

const ignoreFile = scanPath(path.join(dir, 'bad/server/Ignore.server.luau'));
check('perf:ignore suppresses a finding', ignoreFile.findings.length === 0, JSON.stringify(ignoreFile.findings));

write('clean/server/Services/CoinService.luau', `
local Players = game:GetService("Players")
local RunService = game:GetService("RunService")

local CoinService = {}
local cash: { [Player]: number } = {}
local coins: { BasePart } = {}
local params = RaycastParams.new()

function CoinService:Start()
	Players.PlayerAdded:Connect(function(player)
		cash[player] = 0
	end)
	Players.PlayerRemoving:Connect(function(player)
		cash[player] = nil
	end)
	RunService.Heartbeat:Connect(function(dt)
		for _, coin in coins do
			local result = workspace:Raycast(coin.Position, Vector3.yAxis * -5, params)
		end
	end)
	task.spawn(function()
		while true do
			task.wait(5)
			print("autosave")
		end
	end)
end

return CoinService
`);

write('clean/client/Controllers/HudController.luau', `
local RunService = game:GetService("RunService")
local label = script.Parent.Label
local shown = ""

RunService.RenderStepped:Connect(function()
	local text = tostring(math.floor(os.clock()))
	if text ~= shown then
		shown = text
	end
end)
`);

const clean = scanPath(path.join(dir, 'clean'));
const cleanBad = clean.findings.filter((f) => f.severity !== 'info');
check('clean fixtures have no findings', cleanBad.length === 0, cleanBad.map((f) => `${f.rule} ${f.where}:${f.line}`).join(', '));

// --- 2. place fixtures -----------------------------------------------------------------

function item(cls, name, props, children = '') {
  const p = Object.entries(props).map(([k, v]) => {
    if (typeof v === 'boolean') return `<bool name="${k}">${v}</bool>`;
    if (Array.isArray(v) && v.length === 3) return `<Vector3 name="${k}"><X>${v[0]}</X><Y>${v[1]}</Y><Z>${v[2]}</Z></Vector3>`;
    if (typeof v === 'object' && v.token !== undefined) return `<token name="${k}">${v.token}</token>`;
    if (typeof v === 'object' && v.content !== undefined) return `<Content name="${k}"><url>${v.content}</url></Content>`;
    if (typeof v === 'object' && v.range !== undefined) return `<NumberRange name="${k}">${v.range} </NumberRange>`;
    if (typeof v === 'object' && v.source !== undefined) return `<ProtectedString name="${k}"><![CDATA[${v.source}]]></ProtectedString>`;
    if (typeof v === 'number') return `<float name="${k}">${v}</float>`;
    return `<string name="${k}">${v}</string>`;
  }).join('');
  return `<Item class="${cls}" referent="RBX${Math.random().toString(16).slice(2)}"><Properties><string name="Name">${name}</string>${p}</Properties>${children}</Item>`;
}

function heavyPlace() {
  const parts = [];
  for (let i = 0; i < 4000; i++) {
    parts.push(item(i % 2 ? 'MeshPart' : 'Part', `P${i}`, {
      Anchored: i % 5 !== 0, CastShadow: true, size: [1, 1, 1], Transparency: i % 7 === 0 ? 0.5 : 0,
      CollisionFidelity: { token: i < 300 ? 3 : 0 }, RenderFidelity: { token: i < 250 ? 1 : 0 },
      MeshId: { content: `rbxassetid://${1000 + i}` }, TextureID: { content: `rbxassetid://${9000 + i}` },
    }));
  }
  const lights = [];
  for (let i = 0; i < 12; i++) lights.push(item('PointLight', `L${i}`, { Shadows: true, Enabled: true }));
  const humanoids = [];
  for (let i = 0; i < 60; i++) humanoids.push(item('Model', `Npc${i}`, {}, item('Humanoid', 'Humanoid', {})));
  const scripts = [];
  for (let i = 0; i < 25; i++) scripts.push(item('Script', 'Kill', { Source: { source: 'script.Parent.Touched:Connect(function() end)' } }));
  const emitter = item('ParticleEmitter', 'Smoke', { Rate: 1000, Lifetime: { range: '5 10' }, Enabled: true });
  const replicated = [];
  for (let i = 0; i < 21000; i++) replicated.push(item('Folder', `F${i}`, {}));
  const persistent = item('Model', 'City', { ModelStreamingMode: { token: 2 } }, parts.slice(0, 2500).join(''));
  const workspace = item('Workspace', 'Workspace', { StreamingEnabled: false },
    item('Terrain', 'Terrain', { Decoration: true }) + persistent + parts.slice(2500).join('') + lights.join('') + humanoids.join('') + scripts.join('') + item('Part', 'Chimney', { Anchored: true }, emitter));
  const lighting = item('Lighting', 'Lighting', { Technology: { token: 4 }, GlobalShadows: true });
  const rs = item('ReplicatedStorage', 'ReplicatedStorage', {}, replicated.join(''));
  return `<roblox version="4">${workspace}${lighting}${rs}</roblox>`;
}

write('places/Heavy.rbxlx', heavyPlace());
const heavy = scanPath(path.join(dir, 'places/Heavy.rbxlx'));
const heavyRules = new Set(heavy.findings.map((f) => f.rule));
for (const id of ['streaming-off', 'shadowed-lights', 'small-shadow-casters', 'semi-transparent', 'precise-collision', 'precise-render',
  'unanchored-parts', 'humanoid-npcs', 'particle-load', 'workspace-scripts', 'replicated-heavy', 'unique-meshes', 'unique-textures',
  'persistent-models', 'terrain-decoration']) {
  check(`place rule fires: ${id}`, heavyRules.has(id));
}
const hp = heavy.places[0];
check('place stats: parts counted', hp && hp.parts === 4000 + 1, hp && hp.parts);
check('place stats: Future lighting read', hp && hp.lightingTechnology === 'Future', hp && hp.lightingTechnology);
check('place stats: heaviest model is City', hp && hp.heaviestModels[0] && /City$/.test(hp.heaviestModels[0].where), hp && JSON.stringify(hp.heaviestModels[0]));
check('place scripts scanned as server code', heavy.scripts === 25, heavy.scripts);

const light = item('Workspace', 'Workspace', { StreamingEnabled: true }, item('Part', 'Base', { Anchored: true, size: [512, 4, 512] }));
write('places/Light.rbxlx', `<roblox version="4">${light}${item('Lighting', 'Lighting', { Technology: { token: 3 } })}</roblox>`);
const lightScan = scanPath(path.join(dir, 'places/Light.rbxlx'));
check('light place has no findings', lightScan.findings.length === 0, lightScan.findings.map((f) => f.rule).join(', '));

// --- 3. kits scan clean ----------------------------------------------------------------

const kit = scanPath(path.join(SKILL, 'assets'));
const kitBad = kit.findings.filter((f) => f.severity !== 'info');
check(`own kit scans clean (${kit.scripts} files)`, kitBad.length === 0, kitBad.map((f) => `${f.rule} ${f.where}:${f.line}`).join(', '));
for (const sibling of ['roblox-project-structure', 'roblox-combat', 'roblox-vehicles', 'roblox-atmosphere', 'roblox-security']) {
  const p = path.join(SKILL, '..', sibling, 'assets');
  if (!fs.existsSync(p)) continue;
  const r = scanPath(p);
  const worse = r.findings.filter((f) => f.severity === 'medium' || f.severity === 'high');
  check(`${sibling} kit has no medium/high findings`, worse.length === 0, worse.map((f) => `${f.rule} ${f.where}:${f.line}`).join(', '));
}

// --- 4. Luau structure and file references ---------------------------------------------

function luauFiles(root) {
  const out = [];
  const walk = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const f = path.join(d, e.name);
      if (e.isDirectory()) walk(f);
      else if (/\.luau?$/.test(e.name)) out.push(f);
    }
  };
  walk(root);
  return out;
}

function stripLuau(src) {
  return src
    .replace(/--\[(=*)\[[\s\S]*?\]\1\]/g, '')
    .replace(/--[^\n]*/g, '')
    .replace(/"(\\.|[^"\\\n])*"/g, '""')
    .replace(/'(\\.|[^'\\\n])*'/g, "''")
    .replace(/`(\\.|[^`\\])*`/g, '``');
}

function bracketsBalanced(src) {
  const pairs = { ')': '(', '}': '{', ']': '[' };
  const stack = [];
  for (const ch of stripLuau(src)) {
    if ('({['.includes(ch)) stack.push(ch);
    else if (pairs[ch] && stack.pop() !== pairs[ch]) return false;
  }
  return stack.length === 0;
}

// Openers: function, do (for/while bodies included), repeat, and statement-level `if`.
// `if` expressions (`x = if a then b else c`) have no `end`, so only count an `if` that starts a
// line and isn't a one-line if-expression.
function blocksBalanced(src) {
  const lines = stripLuau(src).split('\n');
  let depth = 0;
  for (const line of lines) {
    const words = line.match(/\b[A-Za-z_]\w*\b/g) || [];
    // `if a then x else y,` on its own line is an if-expression (an argument), not a block.
    const expressionIf = /\bthen\b/.test(line) && /\belse\b/.test(line) && !/\bend\b/.test(line) && !/\bthen\s*$/.test(line);
    const statementIf = /^\s*if\b/.test(line) && !expressionIf;
    for (let i = 0; i < words.length; i++) {
      const w = words[i];
      if (w === 'function' || w === 'do' || w === 'repeat') depth++;
      else if (w === 'if' && statementIf && i === 0) depth++;
      else if (w === 'end' || w === 'until') depth--;
      if (depth < 0) return false;
    }
  }
  return depth === 0;
}

const luau = [...luauFiles(path.join(SKILL, 'assets')), ...luauFiles(path.join(SKILL, 'scripts'))];
for (const f of luau) {
  const src = fs.readFileSync(f, 'utf8');
  const rel = path.relative(SKILL, f);
  check(`brackets balanced: ${rel}`, bracketsBalanced(src));
  check(`blocks balanced: ${rel}`, blocksBalanced(src));
  if (rel.startsWith(path.join('assets', 'kit'))) check(`strict mode: ${rel}`, src.startsWith('--!strict'));
}

const skillMd = fs.readFileSync(path.join(SKILL, 'SKILL.md'), 'utf8');
const referenced = new Set([...skillMd.matchAll(/`((?:references|scripts|assets)\/[^`\s]+)`/g)].map((m) => m[1]));
for (const ref of referenced) {
  const clean = ref.replace(/[),.:]+$/, '');
  check(`SKILL.md reference exists: ${clean}`, fs.existsSync(path.join(SKILL, clean)));
}
for (const f of luauFiles(path.join(SKILL, 'assets', 'kit'))) {
  const name = path.basename(f);
  check(`SKILL.md mentions kit file ${name}`, skillMd.includes(name));
}
const fm = skillMd.match(/^---\n([\s\S]*?)\n---/);
const desc = fm && (fm[1].match(/^description:\s*(.*)$/m) || [])[1];
check('frontmatter name is roblox-performance', fm && /^name:\s*roblox-performance\s*$/m.test(fm[1]));
check('description present, <= 1024 chars, no angle brackets', desc && desc.length <= 1024 && !/[<>]/.test(desc), desc && desc.length);

// --- 5. rule ids consistent ------------------------------------------------------------

const scanSrc = fs.readFileSync(path.join(__dirname, 'perfscan.cjs'), 'utf8');
const placeIds = [...scanSrc.matchAll(/add\('([a-z-]+)'/g)].map((m) => m[1]);
const audit = fs.readFileSync(path.join(SKILL, 'assets', 'studio', 'PerfAudit.luau'), 'utf8');
const checklist = fs.readFileSync(path.join(SKILL, 'references', 'audit-checklist.md'), 'utf8');
check('place rules found in scanner', placeIds.length >= 15, placeIds.length);
for (const id of placeIds) {
  check(`PerfAudit.luau has place rule ${id}`, audit.includes(`"${id}"`));
  check(`audit-checklist.md lists ${id}`, checklist.includes(`\`${id}\``));
}
const codeIds = [...new Set([...scanSrc.matchAll(/id: '([a-z-]+)'/g)].map((m) => m[1]))];
for (const id of codeIds) check(`audit-checklist.md lists ${id}`, checklist.includes(`\`${id}\``));

fs.rmSync(dir, { recursive: true, force: true });
console.log(failed ? `\n${failed} check(s) failed` : '\nall checks passed');
process.exit(failed ? 1 : 0);
