#!/usr/bin/env node
// Runs the combat kit's real Luau modules in the standalone `luau` CLI.
//
// The CLI has no Roblox types and no Instance requires, so this bundles one file:
//   RobloxShim.luau (Vector3, CFrame, Random, workspace raycasts, RunService, game:GetService)
//   + every kit module as a lazy function keyed by its Studio path
//     (ReplicatedStorage/Shared/Combat/X, StarterPlayerScripts/Client/Combat/Y)
//   + the program (a spec, the trace replayer, or the config dump)
// The modules are pasted unmodified, so what passes here is the code you copy into Studio.
//
//   node tests/run-luau.cjs              run Shooter.spec.luau
//   node tests/run-luau.cjs config       print CombatConfig as JSON (the browser lab uses it)
// From Node: require('./run-luau.cjs').replay(traceText) -> output lines of Replay.luau
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const HERE = __dirname;
const KIT = path.join(HERE, '..', 'assets', 'kit');
const ROOTS = { shared: 'ReplicatedStorage/Shared', client: 'StarterPlayerScripts/Client', server: 'ServerScriptService/Server' };
// The pure modules and the client modules that only need RunService and the camera.
const MODULES = [
  'shared/Combat/CombatConfig.luau',
  'shared/Combat/Ballistics.luau',
  'shared/Combat/AimCamera.luau',
  'shared/Combat/WeaponState.luau',
  'client/Combat/CameraFx.luau',
];

function luauAvailable() {
  try { execFileSync('luau', ['-h'], { stdio: 'ignore' }); return true; } catch (e) { return e.status !== undefined && e.code !== 'ENOENT'; }
}

function longString(text) {
  let eq = '=';
  while (text.includes(`]${eq}]`)) eq += '=';
  return `[${eq}[\n${text}]${eq}]`;
}

function bundle(program, extra = '') {
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
`);
  for (const rel of MODULES) {
    const [top, ...rest] = rel.replace(/\.luau$/, '').split('/');
    const key = `${ROOTS[top]}/${rest.join('/')}`;
    const src = fs.readFileSync(path.join(KIT, rel), 'utf8').replace(/^--!strict\s*\n/, '');
    parts.push(`__defs[${JSON.stringify(key)}] = function(script: any): any\n${src}\nend`);
  }
  parts.push(extra);
  parts.push(`local Shared = game:GetService("ReplicatedStorage").Shared\nlocal ClientRoot = Path("StarterPlayerScripts/Client")\n`);
  parts.push(fs.readFileSync(path.join(HERE, program), 'utf8').replace(/^--!strict\s*\n/, ''));
  return parts.join('\n');
}

function run(program, extra) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'combat-luau-'));
  const file = path.join(dir, 'bundle.luau');
  fs.writeFileSync(file, bundle(program, extra));
  try {
    return execFileSync('luau', [file], { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });
  } catch (e) {
    const out = (e.stdout || '') + (e.stderr || '');
    throw new Error(`luau failed (bundle kept at ${file}):\n${out.slice(-4000)}`);
  }
}

const replay = (traceText) => run('Replay.luau', `local TRACE = ${longString(traceText)}\n`).split('\n').filter((l) => l.length);
const config = () => JSON.parse(run('DumpConfig.luau'));

module.exports = { luauAvailable, bundle, run, replay, config };

if (require.main === module) {
  if (!luauAvailable()) { console.log('luau CLI not found (brew install luau, or rokit add luau-lang/luau); skipped'); process.exit(0); }
  const mode = process.argv[2] || 'spec';
  if (mode === 'config') { process.stdout.write(JSON.stringify(config(), null, 1) + '\n'); process.exit(0); }
  const out = run('Shooter.spec.luau');
  process.stdout.write(out);
  process.exit(/\b0 failed\b/.test(out) ? 0 : 1);
}
