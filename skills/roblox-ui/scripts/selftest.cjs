#!/usr/bin/env node
// Offline checks for the UI skill:
//  1. every scanner rule fires on a bad fixture, clean code stays clean, suppression works
//  2. the bundled kit scans clean (nothing above info) and every Luau file parses balanced
//  3. install copies the kit, edits wally.toml once, and reports missing scaffold pieces
//  4. generated components / screens / stories are balanced, strict and reference real modules
//  5. the device table in references/responsive-layout.md matches what the kit computes
//  6. docs reference files that exist, mention every kit file, and list every rule id
// Run: node scripts/selftest.cjs
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { RULES, scanSource, scanPath, strip, parseFunctions } = require('./uiscan.cjs');
const { readTokens, readDevices, measure, install, generate, addWallyDependencies } = require('./uikit.cjs');

const SKILL = path.resolve(__dirname, '..');
let failed = 0;
function check(name, cond, extra = '') {
  console.log(`${cond ? 'ok  ' : 'FAIL'} ${name}${cond ? '' : `  ${extra}`}`);
  if (!cond) failed++;
}

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rui-'));
const write = (rel, text) => {
  const f = path.join(dir, rel);
  fs.mkdirSync(path.dirname(f), { recursive: true });
  fs.writeFileSync(f, text);
  return f;
};
const rulesOf = (src) => new Set(scanSource(src).map((f) => f.rule));

// --- 1. scanner fixtures ---------------------------------------------------------------

const BAD = `
local Players = game:GetService("Players")
local GuiService = game:GetService("GuiService")
local RunService = game:GetService("RunService")
local UserInputService = game:GetService("UserInputService")
local React = require(game.ReplicatedStorage.Packages.React)
local Roact = require(game.ReplicatedStorage.Packages.Roact)
local e = React.createElement

local isMobile = UserInputService.TouchEnabled

local gui = Instance.new("ScreenGui")
gui.IgnoreGuiInset = true
gui.ZIndexBehavior = Enum.ZIndexBehavior.Global

local list = Instance.new("UIListLayout")
list.Parent = gui

local buy = Instance.new("TextButton")
buy.Size = UDim2.fromOffset(120, 30)
buy.MouseButton1Click:Connect(function() end)

local label = Instance.new("TextLabel")
label.TextScaled = true
label.Font = Enum.Font.GothamBold

local camera = workspace.CurrentCamera
if camera.ViewportSize.X < 900 then
	print("phone")
end
local scale = camera.ViewportSize.X / 1920
local inset = GuiService:GetGuiInset()
local deep = Players.LocalPlayer.PlayerGui:WaitForChild("Main"):WaitForChild("Shop"):WaitForChild("Buy")

local function Tooltip(props)
	return e("Frame", {
		[React.Event.MouseEnter] = function() end,
	})
end

local function Hud(props)
	local coins, setCoins = React.useState(0)
	local flash, setFlash = React.useState(0)
	RunService.Heartbeat:Connect(function() end)
	React.useEffect(function()
		local connection = RunService.Heartbeat:Connect(function(dt)
			setFlash(dt)
		end)
	end, {})
	React.useEffect(function()
		print(coins)
	end)
	return e("ScreenGui", { ScreenInsets = Enum.ScreenInsets.None }, {
		Fade = e("CanvasGroup", {}),
		Close = e("TextButton", { Size = UDim2.fromOffset(24, 24), Text = "x" }),
		List = e("UIListLayout", { Padding = UDim.new(0, 4) }),
		Old = Roact.createElement("Frame"),
	})
end
`;
const badRules = rulesOf(BAD);
for (const id of Object.keys(RULES)) check(`rule fires on bad fixture: ${id}`, badRules.has(id), [...badRules].join(', '));

const GOOD = `
--!strict
local ReplicatedStorage = game:GetService("ReplicatedStorage")
local RunService = game:GetService("RunService")
local React = require(ReplicatedStorage.Packages.React)
local e = React.createElement

local label = "MouseButton1Click TextScaled = true TouchEnabled" -- strings and comments are ignored
--[[ IgnoreGuiInset = true ]]

local function Meter(props: { value: number })
	local fill, setFill = React.useBinding(0)
	local open, setOpen = React.useState(false)
	React.useEffect(function()
		local connection = RunService.Heartbeat:Connect(function(dt)
			setFill(fill:getValue() + dt)
		end)
		return function()
			connection:Disconnect()
		end
	end, {})
	local width = if open then 1 else 0.5
	if props.value > 1 then
		width = 1
	end
	return e("ScreenGui", { ResetOnSpawn = false }, {
		Button = e("TextButton", {
			Size = UDim2.fromOffset(160, 48),
			[React.Event.Activated] = function()
				setOpen(not open)
			end,
		}),
		List = e("UIListLayout", { SortOrder = Enum.SortOrder.LayoutOrder }),
		Bar = e("Frame", { Size = fill:map(function(v) return UDim2.fromScale(v * width, 1) end) }),
	})
end

return Meter
`;
const goodFindings = scanSource(GOOD);
check('clean fixture has no findings', goodFindings.length === 0, goodFindings.map((f) => `${f.rule}:${f.line}`).join(', '));

const suppressed = scanSource('local touch = UserInputService.TouchEnabled -- ui:ignore ismobile-check\n');
check('ui:ignore suppresses a finding', suppressed.length === 0, suppressed.map((f) => f.rule).join(', '));
const aboveSuppressed = scanSource('-- ui:ignore textscaled\nlabel.TextScaled = true\n');
check('ui:ignore on the line above suppresses', aboveSuppressed.length === 0);

const methodSrc = `
local React = require(game.ReplicatedStorage.Packages.React)
local Controller = {}
function Controller:Start()
	game.Players.PlayerAdded:Connect(function() end)
	React.createElement("Frame")
end
return Controller
`;
check('methods are not mistaken for components', !rulesOf(methodSrc).has('render-side-effect'));

const ifExpr = parseFunctions(strip('local x = if a then b else c\nlocal s = "x"\nif s then\n\tprint(s)\nend\nlocal function f()\n\treturn if x then 1 else 2\nend\n'));
check('parser balances if-expressions and string-ended statements', ifExpr.balanced && ifExpr.functions.length === 1);

// --- 2. kit scans clean, Luau balanced -------------------------------------------------

function luauFiles(root, pattern = /\.luau?$/) {
  const out = [];
  const walk = (d) => {
    for (const entry of fs.readdirSync(d, { withFileTypes: true })) {
      const f = path.join(d, entry.name);
      if (entry.isDirectory()) walk(f);
      else if (pattern.test(entry.name)) out.push(f);
    }
  };
  walk(root);
  return out.sort();
}

function bracketsBalanced(src) {
  const pairs = { ')': '(', '}': '{', ']': '[' };
  const stack = [];
  for (const ch of strip(src)) {
    if ('({['.includes(ch)) stack.push(ch);
    else if (pairs[ch] && stack.pop() !== pairs[ch]) return false;
  }
  return stack.length === 0;
}

const KIT = path.join(SKILL, 'assets', 'kit');
const kitScan = scanPath(KIT);
const kitBad = kitScan.findings.filter((f) => f.severity !== 'info');
check(`kit scans clean (${kitScan.files} files)`, kitBad.length === 0, kitBad.map((f) => `${f.rule} ${f.file}:${f.line}`).join(', '));

const kitFiles = luauFiles(KIT);
for (const f of kitFiles) {
  const src = fs.readFileSync(f, 'utf8');
  const rel = path.relative(SKILL, f);
  check(`brackets balanced: ${rel}`, bracketsBalanced(src));
  check(`blocks balanced: ${rel}`, parseFunctions(strip(src)).balanced);
  check(`strict mode: ${rel}`, src.startsWith('--!strict'));
  check(`no deprecated wait/spawn/delay: ${rel}`, !/(^|[^.\w])(wait|spawn|delay)\s*\(/m.test(strip(src)));
  // Every script.Parent... require must resolve to a file in the kit.
  for (const m of src.matchAll(/require\(script((?:\.Parent)+)((?:\.[A-Za-z_]\w*)+)\)/g)) {
    let base = f;
    const ups = m[1].split('.Parent').length - 1;
    for (let i = 0; i < ups; i++) base = path.dirname(base);
    const parts = m[2].split('.').filter(Boolean);
    const target = path.join(base, ...parts);
    const exists = fs.existsSync(`${target}.luau`) || fs.existsSync(path.join(target, 'init.luau'));
    check(`require resolves: ${rel} -> ${parts.join('.')}`, exists, target);
  }
}

// Every component module returns something and the stories return a UI Labs story table.
for (const f of luauFiles(path.join(KIT, 'client', 'UI', 'Stories'), /\.story\.luau$/)) {
  const src = fs.readFileSync(f, 'utf8');
  check(`story has react, reactRoblox, story: ${path.basename(f)}`, /react\s*=\s*React/.test(src) && /reactRoblox\s*=\s*ReactRoblox/.test(src) && /story\s*=\s*function/.test(src));
}

// --- 3. install ------------------------------------------------------------------------

const project = path.join(dir, 'game');
write('game/src/client/Main.client.luau', '-- main\n');
write('game/src/client/Controllers/HudController.luau', '-- old hud\n');
write('game/src/shared/Net/init.luau', 'local REMOTES = {\n\tNotify = "Event",\n\tClaimDailyReward = "Event",\n}\n');
write('game/wally.toml', '[package]\nname = "studio/game"\n\n[dependencies]\nSignal = "sleitnick/signal@2.0.3"\nTrove = "sleitnick/trove@1.8.0"\n\n[server-dependencies]\nProfileStore = "lm-loleris/profilestore@1.0.3"\n');
const report = install({ project });
check('install writes every kit file', report.written.length === kitFiles.length, `${report.written.length} vs ${kitFiles.length}`);
const wallyText = fs.readFileSync(path.join(project, 'wally.toml'), 'utf8');
check('install adds React to [dependencies]', /\[dependencies\]\nSignal[^\n]*\nTrove[^\n]*\nReact = "jsdotlua\/react@/.test(wallyText), wallyText);
check('install keeps server-dependencies separate', /\[server-dependencies\]\nProfileStore/.test(wallyText));
check('install flags missing PurchaseItem remote', report.notes.some((n) => n.includes('PurchaseItem')));
check('install flags old HudController', report.notes.some((n) => n.includes('HudController')));
const again = install({ project });
check('install is idempotent (keeps files, no duplicate deps)', again.written.length === 0 && again.wally.length === 0, JSON.stringify({ w: again.written.length, d: again.wally }));
check('wally edit adds a [dependencies] table when missing', /\[dependencies\]\nReact = /.test(addWallyDependencies('[package]\nname = "a/b"\n').text));
check('installed project scans clean', scanPath(path.join(project, 'src')).findings.every((f) => f.severity === 'info'));

// --- 4. generator ----------------------------------------------------------------------

const ui = path.join(project, 'src', 'client', 'UI');
const generated = [
  ...generate('component', 'QuestCard', { ui }),
  ...generate('screen', 'SettingsScreen', { ui }),
  ...generate('primitive', 'Divider', { ui, story: false }),
];
check('generator wrote 5 files', generated.length === 5, generated.join(', '));
for (const f of generated) {
  const src = fs.readFileSync(f, 'utf8');
  const rel = path.relative(ui, f);
  check(`generated balanced and strict: ${rel}`, bracketsBalanced(src) && parseFunctions(strip(src)).balanced && src.startsWith('--!strict'));
  check(`generated has no leftover placeholders: ${rel}`, !/\{\{\w+\}\}/.test(src));
  for (const m of src.matchAll(/require\(script\.Parent\.Parent\.(\w+)\.(\w+)\)/g)) {
    check(`generated require resolves: ${rel} -> ${m[1]}.${m[2]}`, fs.existsSync(path.join(ui, m[1], `${m[2]}.luau`)));
  }
}
check('screen title is human readable', fs.readFileSync(path.join(ui, 'Screens', 'SettingsScreen.luau'), 'utf8').includes('title = "Settings"'));
let refused = false;
try {
  generate('component', 'QuestCard', { ui });
} catch {
  refused = true;
}
check('generator refuses to overwrite', refused);
let badName = false;
try {
  generate('component', 'questCard', { ui });
} catch {
  badName = true;
}
check('generator rejects non-PascalCase names', badName);
check('project with generated files scans clean', scanPath(path.join(project, 'src')).findings.every((f) => f.severity === 'info'));

// --- 5. device table in the docs matches the kit ---------------------------------------

const tokens = readTokens();
const devices = readDevices();
check('device presets parsed', devices.length >= 8, devices.length);
check('scale profiles parsed', ['Touch', 'Pointer', 'TenFoot'].every((k) => tokens.scale[k]));
const layoutDoc = fs.readFileSync(path.join(SKILL, 'references', 'responsive-layout.md'), 'utf8');
for (const d of devices) {
  const r = measure(d, tokens);
  const row = layoutDoc.split('\n').find((l) => l.startsWith(`| ${d.name} |`));
  check(`docs row for ${d.name}`, Boolean(row));
  if (row) {
    check(`docs scale for ${d.name} is ${r.scale.toFixed(2)}`, row.includes(`| ${r.scale.toFixed(2)} |`), row);
    check(`docs size class for ${d.name} is ${r.sizeClass}`, row.includes(`| ${r.sizeClass} |`), row);
  }
}
const phone = measure(devices.find((d) => d.name === 'Phone landscape'), tokens);
const tv = measure(devices.find((d) => d.name === 'Console TV'), tokens);
check('phones are Compact at scale 1 (44 units = 44 points)', phone.sizeClass === 'Compact' && phone.scale === 1);
check('touch hit target is at least 44 px on every touch device', devices.filter((d) => d.input === 'Touch').every((d) => measure(d, tokens).hitTargetPx >= 44));
check('TV is scaled up for ten-foot viewing', tv.scale >= 1.25);

// --- 6. docs ---------------------------------------------------------------------------

const skillMd = fs.readFileSync(path.join(SKILL, 'SKILL.md'), 'utf8');
const referenced = new Set([...skillMd.matchAll(/`((?:references|scripts|assets)\/[^`\s]+)`/g)].map((m) => m[1]));
for (const ref of referenced) {
  const clean = ref.replace(/[),.:]+$/, '');
  check(`SKILL.md reference exists: ${clean}`, fs.existsSync(path.join(SKILL, clean)));
}
for (const f of kitFiles) {
  const name = path.basename(f);
  check(`SKILL.md mentions kit file ${name}`, skillMd.includes(name));
}
const fm = skillMd.match(/^---\n([\s\S]*?)\n---/);
const desc = fm && (fm[1].match(/^description:\s*(.*)$/m) || [])[1];
check('frontmatter name is roblox-ui', fm && /^name:\s*roblox-ui\s*$/m.test(fm[1]));
check('description present, <= 1024 chars, no angle brackets', desc && desc.length <= 1024 && !/[<>]/.test(desc), desc && desc.length);
check('SKILL.md under 500 lines', skillMd.split('\n').length < 500);

const checklist = fs.readFileSync(path.join(SKILL, 'references', 'audit-checklist.md'), 'utf8');
for (const id of Object.keys(RULES)) check(`audit-checklist.md lists ${id}`, checklist.includes(`\`${id}\``));
for (const doc of fs.readdirSync(path.join(SKILL, 'references'))) {
  const text = fs.readFileSync(path.join(SKILL, 'references', doc), 'utf8');
  for (const m of text.matchAll(/`((?:assets|scripts)\/[^`\s]+)`/g)) {
    check(`${doc} reference exists: ${m[1]}`, fs.existsSync(path.join(SKILL, m[1])));
  }
}

fs.rmSync(dir, { recursive: true, force: true });
console.log(failed ? `\n${failed} check(s) failed` : '\nall checks passed');
process.exit(failed ? 1 : 0);
