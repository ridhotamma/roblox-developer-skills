#!/usr/bin/env node
// Runs the cutscene kit's real Luau modules in the standalone `luau` CLI.
//
// The CLI has no Roblox types and no Instance requires, so this bundles one file:
//   RobloxShim.luau (Vector3, CFrame, typeof, Color3, Enum, RunService, game:GetService)
//   + every module under assets/kit/shared as a lazy function keyed by its Studio path
//     (ReplicatedStorage/Shared/Cutscene/X, .../Cutscene/Scenes/Y, .../Cutscene/Finishers/Z)
//   + the program (the spec, or Dump.luau for the previs and the coverage check)
// The modules are pasted unmodified, so what passes here is the code you copy into Studio.
//
//   node tests/run-luau.cjs                 run Cutscene.spec.luau
// From Node:
//   require('./run-luau.cjs').dump('BossIntro', { fps: 30 })  -> previs JSON for a scene
//   require('./run-luau.cjs').dump('Finishers/Suplex')         -> same for a finisher
//   require('./run-luau.cjs').dump('/abs/path/MyScene.luau')    -> a scene file outside the kit
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const HERE = __dirname;
const KIT = path.join(HERE, '..', 'assets', 'kit');
const SHARED = path.join(KIT, 'shared');

function luauAvailable() {
  try { execFileSync('luau', ['--help'], { stdio: 'ignore' }); return true; } catch (e) { return e.code !== 'ENOENT'; }
}

function walk(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(full));
    else if (entry.name.endsWith('.luau')) out.push(full);
  }
  return out.sort();
}

function longString(text) {
  let eq = '=';
  while (text.includes(`]${eq}]`)) eq += '=';
  return `[${eq}[\n${text}]${eq}]`;
}

function moduleKey(file) {
  const rel = path.relative(SHARED, file).replace(/\\/g, '/').replace(/\.luau$/, '');
  return `ReplicatedStorage/Shared/${rel}`;
}

function bundle(program, extra = '', extraModules = {}) {
  const parts = [fs.readFileSync(path.join(HERE, 'RobloxShim.luau'), 'utf8')];
  parts.push(`
local __defs, __cache = {}, {}
local function require(target: any): any
	local key = if type(target) == "table" then rawget(target, "__path") else target
	if __cache[key] == nil then
		local def = __defs[key]
		assert(def, "no bundled module " .. tostring(key))
		__cache[key] = def(Path(key))
	end
	return __cache[key]
end
local __keys = {}
`);
  const modules = {};
  for (const file of walk(SHARED)) modules[moduleKey(file)] = fs.readFileSync(file, 'utf8');
  Object.assign(modules, extraModules);
  for (const [key, text] of Object.entries(modules)) {
    const src = text.replace(/^--!strict\s*\n/, '');
    parts.push(`__defs[${JSON.stringify(key)}] = function(script: any): any\n${src}\nend\ntable.insert(__keys, ${JSON.stringify(key)})`);
  }
  parts.push(extra);
  parts.push(`local Shared = game:GetService("ReplicatedStorage").Shared\n`);
  parts.push(fs.readFileSync(path.join(HERE, program), 'utf8').replace(/^--!strict\s*\n/, ''));
  return parts.join('\n');
}

function run(program, extra, extraModules) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cutscene-luau-'));
  const file = path.join(dir, 'bundle.luau');
  fs.writeFileSync(file, bundle(program, extra, extraModules));
  try {
    const out = execFileSync('luau', [file], { encoding: 'utf8', maxBuffer: 512 * 1024 * 1024 });
    fs.rmSync(dir, { recursive: true, force: true });
    return out;
  } catch (e) {
    const out = (e.stdout || '') + (e.stderr || '');
    throw new Error(`luau failed (bundle kept at ${file}):\n${out.slice(-4000)}`);
  }
}

// target: "BossIntro", "Scenes/BossIntro", "Finishers/Suplex", or a path to a .luau file.
function dump(target, options = {}) {
  const extraModules = {};
  let key;
  if (target.endsWith('.luau') && fs.existsSync(target)) {
    key = 'ReplicatedStorage/Shared/Cutscene/Scenes/__External';
    extraModules[key] = fs.readFileSync(target, 'utf8');
  } else {
    const name = target.includes('/') ? target : `Scenes/${target}`;
    key = `ReplicatedStorage/Shared/Cutscene/${name}`;
  }
  const extra = `local TARGET = ${JSON.stringify(key)}\nlocal FPS = ${Number(options.fps || 30)}\nlocal ASPECT = ${Number(options.aspect || 16 / 9)}\n`;
  const out = run('Dump.luau', extra, extraModules);
  return JSON.parse(out);
}

module.exports = { luauAvailable, bundle, run, dump, walk, SHARED };

if (require.main === module) {
  if (!luauAvailable()) { console.log('luau CLI not found (brew install luau, or rokit add luau-lang/luau); skipped'); process.exit(0); }
  const out = run('Cutscene.spec.luau');
  process.stdout.write(out);
  process.exit(/\b0 failed\b/.test(out) ? 0 : 1);
}
