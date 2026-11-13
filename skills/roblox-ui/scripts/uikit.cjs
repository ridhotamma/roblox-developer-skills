#!/usr/bin/env node
// Installs the React UI kit into a project and generates new components, screens and stories in
// the kit's shape, so a growing UI stays consistent.
//
//   node uikit.cjs install --project <dir> [--client <dir>] [--force] [--dry-run]
//   node uikit.cjs new <component|screen|primitive> <Name> [--project <dir>] [--ui <dir>] [--no-story] [--force]
//   node uikit.cjs devices [--size WxH --input touch|pointer|gamepad [--tenfoot] [--insets t,b,l,r] [--topbar 58]]
//   node uikit.cjs contrast [--project <dir> | --ui <UI dir>] [--verbose]
//
// `install` copies assets/kit/client into <project>/src/client (never overwriting without
// --force; your Theme/GameTheme.luau is never overwritten, even with --force), adds React and
// ReactRoblox to wally.toml, and checks the scaffold pieces UiController uses (Net remotes, the
// old HudController). `new` writes UI/<Folder>/<Name>.luau plus UI/Stories/<Name>.story.luau.
// `devices` prints the size class and scale the kit computes for each preview device, or for any
// screen you describe. `contrast` checks every palette of the default theme, your GameTheme and
// the presets against WCAG contrast (text 4.5:1, UI parts 3:1) and exits 1 on a failure.
// Needs only Node.
'use strict';

const fs = require('fs');
const path = require('path');

const SKILL = path.resolve(__dirname, '..');
const KIT = path.join(SKILL, 'assets', 'kit');
const TEMPLATES = path.join(SKILL, 'assets', 'templates');
const TOKENS = path.join(KIT, 'client', 'UI', 'Theme', 'Tokens.luau');
const DEVICES = path.join(KIT, 'client', 'UI', 'Stories', 'Devices.luau');

// Files the user owns after install: never overwritten, even with --force.
const USER_OWNED = new Set([path.join('UI', 'Theme', 'GameTheme.luau')]);

const PACKAGES = [
  ['React', 'jsdotlua/react@17.2.1'],
  ['ReactRoblox', 'jsdotlua/react-roblox@17.2.1'],
];

// ---- responsive maths, mirrored from Foundation/Responsive.luau ------------------------

function readTokens(file = TOKENS) {
  const src = fs.readFileSync(file, 'utf8');
  const scale = {};
  const scaleBlock = /Tokens\.Scale\s*=\s*\{([\s\S]*?)\n\}/.exec(src);
  const re = /(Touch|Pointer|TenFoot)\s*=\s*\{\s*Reference\s*=\s*([\d.]+),\s*Min\s*=\s*([\d.]+),\s*Max\s*=\s*([\d.]+)\s*\}/g;
  let m;
  while ((m = re.exec(scaleBlock ? scaleBlock[1] : ''))) {
    scale[m[1]] = { reference: Number(m[2]), min: Number(m[3]), max: Number(m[4]) };
  }
  const num = (name) => {
    const found = new RegExp(`${name}\\s*=\\s*(\\d+)`).exec(src);
    return found ? Number(found[1]) : NaN;
  };
  const hitBlock = /Tokens\.HitTarget\s*=\s*\{([^}]*)\}/.exec(src);
  const hitTarget = {};
  if (hitBlock) {
    for (const h of hitBlock[1].matchAll(/(Touch|Pointer|Gamepad)\s*=\s*(\d+)/g)) hitTarget[h[1]] = Number(h[2]);
  }
  return {
    scale,
    compactShortSide: num('CompactShortSide'),
    expandedWidth: num('ExpandedWidth'),
    hitTarget,
  };
}

function readDevices(file = DEVICES) {
  const src = fs.readFileSync(file, 'utf8');
  const devices = [];
  const re = /\{\s*name\s*=\s*"([^"]+)",\s*size\s*=\s*Vector2\.new\((\d+),\s*(\d+)\),\s*input\s*=\s*"(\w+)",\s*(tenFoot\s*=\s*true,\s*)?insets\s*=\s*insets\((\d+),\s*(\d+),\s*(\d+),\s*(\d+)\),\s*topbar\s*=\s*(\d+)\s*\}/g;
  let m;
  while ((m = re.exec(src))) {
    devices.push({
      name: m[1],
      size: { x: Number(m[2]), y: Number(m[3]) },
      input: m[4],
      tenFoot: Boolean(m[5]),
      insets: { top: Number(m[6]), bottom: Number(m[7]), left: Number(m[8]), right: Number(m[9]) },
      topbar: Number(m[10]),
    });
  }
  return devices;
}

function measure(device, tokens) {
  const i = device.insets;
  const safe = {
    x: device.size.x - i.left - i.right,
    y: device.size.y - i.top - device.topbar - i.bottom,
  };
  const profile = device.tenFoot ? tokens.scale.TenFoot : device.input === 'Touch' ? tokens.scale.Touch : tokens.scale.Pointer;
  const short = Math.min(safe.x, safe.y);
  let scale = 1;
  if (short > 0) {
    scale = Math.min(Math.max(short / profile.reference, profile.min), profile.max);
    scale = Math.round(scale * 100) / 100;
  }
  const design = { x: safe.x / scale, y: safe.y / scale };
  let sizeClass = 'Expanded';
  if (Math.min(design.x, design.y) < tokens.compactShortSide) sizeClass = 'Compact';
  else if (design.x < tokens.expandedWidth) sizeClass = 'Medium';
  return {
    safe,
    scale,
    design,
    sizeClass,
    orientation: safe.y > safe.x ? 'Portrait' : 'Landscape',
    hitTargetPx: Math.round((tokens.hitTarget[device.input] || 44) * scale),
  };
}

// ---- install ---------------------------------------------------------------------------

function copyTree(from, to, opt, report, rel = '') {
  for (const entry of fs.readdirSync(from, { withFileTypes: true })) {
    const src = path.join(from, entry.name);
    const dst = path.join(to, entry.name);
    const relPath = path.join(rel, entry.name);
    if (entry.isDirectory()) {
      copyTree(src, dst, opt, report, relPath);
    } else if (fs.existsSync(dst) && USER_OWNED.has(relPath)) {
      report.owned.push(dst);
    } else if (fs.existsSync(dst) && !opt.force) {
      report.skipped.push(dst);
    } else {
      if (!opt.dryRun) {
        fs.mkdirSync(path.dirname(dst), { recursive: true });
        fs.copyFileSync(src, dst);
      }
      report.written.push(dst);
    }
  }
}

function addWallyDependencies(text) {
  const lines = text.split('\n');
  const header = lines.findIndex((l) => /^\[dependencies\]\s*$/.test(l));
  const added = [];
  const missing = PACKAGES.filter(([alias]) => !new RegExp(`^\\s*${alias}\\s*=`, 'm').test(text));
  if (!missing.length) return { text, added };
  const entries = missing.map(([alias, spec]) => `${alias} = "${spec}"`);
  if (header < 0) {
    lines.push('', '[dependencies]', ...entries);
  } else {
    let insertAt = header + 1;
    while (insertAt < lines.length && /^\s*[A-Za-z_]\w*\s*=/.test(lines[insertAt])) insertAt++;
    lines.splice(insertAt, 0, ...entries);
  }
  added.push(...entries);
  return { text: lines.join('\n'), added };
}

function install(opt) {
  const project = path.resolve(opt.project || '.');
  const client = path.resolve(opt.client || path.join(project, 'src', 'client'));
  const report = { written: [], skipped: [], owned: [], wally: [], notes: [] };

  if (!opt.client && !fs.existsSync(client)) {
    throw new Error(`${client} not found. Run in a roblox-project-structure project, or pass --client <folder that maps to StarterPlayerScripts>.`);
  }
  copyTree(path.join(KIT, 'client'), client, opt, report);

  const wally = path.join(project, 'wally.toml');
  if (fs.existsSync(wally)) {
    const { text, added } = addWallyDependencies(fs.readFileSync(wally, 'utf8'));
    if (added.length && !opt.dryRun) fs.writeFileSync(wally, text);
    report.wally = added;
  } else {
    report.notes.push(`No wally.toml: add these under [dependencies] (shared realm): ${PACKAGES.map(([a, s]) => `${a} = "${s}"`).join(', ')}`);
  }

  const net = path.join(project, 'src', 'shared', 'Net', 'init.luau');
  if (!fs.existsSync(net)) {
    report.notes.push('No src/shared/Net/init.luau: UiController uses the roblox-project-structure Net module (Notify, ClaimDailyReward, PurchaseItem). Point those three calls at your own remotes.');
  } else {
    const netSrc = fs.readFileSync(net, 'utf8');
    for (const [name, line] of [
      ['Notify', 'Notify = "Event", -- (message: string) show a toast'],
      ['ClaimDailyReward', 'ClaimDailyReward = "Event", -- () ask for today\'s reward'],
      ['PurchaseItem', 'PurchaseItem = "Event", -- (itemId: string) ask to buy; the server checks price, balance, ownership'],
    ]) {
      if (!new RegExp(`\\b${name}\\s*=\\s*"`).test(netSrc)) report.notes.push(`Declare in Net.REMOTES: ${line}`);
    }
  }

  for (const old of ['Controllers/HudController.luau', 'UI/HudScreen.luau']) {
    if (fs.existsSync(path.join(client, old))) {
      report.notes.push(`Delete src/client/${old}: UiController and Screens/HudScreen replace it (coins, daily reward, toasts); keeping both shows two HUDs.`);
    }
  }
  return report;
}

// ---- new -------------------------------------------------------------------------------

const FOLDERS = { component: 'Components', screen: 'Screens', primitive: 'Primitives' };

function words(name) {
  return name.replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/Screen$/, '').trim();
}

function render(template, values) {
  return template.replace(/\{\{(\w+)\}\}/g, (_, key) => {
    if (!(key in values)) throw new Error(`template value missing: ${key}`);
    return values[key];
  });
}

function generate(kind, name, opt = {}) {
  const folder = FOLDERS[kind];
  if (!folder) throw new Error(`kind must be one of: ${Object.keys(FOLDERS).join(', ')}`);
  if (!/^[A-Z][A-Za-z0-9]*$/.test(name || '')) throw new Error('Name must be PascalCase, e.g. QuestCard');
  const ui = path.resolve(opt.ui || path.join(opt.project || '.', 'src', 'client', 'UI'));
  const isScreen = kind === 'screen';
  const files = [];

  const source = render(fs.readFileSync(path.join(TEMPLATES, isScreen ? 'Screen.luau.tmpl' : 'Component.luau.tmpl'), 'utf8'), {
    NAME: name,
    TITLE: words(name) || name,
  });
  files.push([path.join(ui, folder, `${name}.luau`), source]);

  if (opt.story !== false) {
    const story = render(fs.readFileSync(path.join(TEMPLATES, 'Story.luau.tmpl'), 'utf8'), {
      NAME: name,
      FOLDER: folder,
      IMPORTS: isScreen
        ? ''
        : 'local Box = require(script.Parent.Parent.Primitives.Box)\nlocal Layer = require(script.Parent.Parent.Primitives.Layer)\n',
      RENDER: isScreen
        ? `e(${name}, {\n\t\t\t\t\topen = true,\n\t\t\t\t\tonClose = function()\n\t\t\t\t\t\tprint("[${name}.story] close")\n\t\t\t\t\tend,\n\t\t\t\t})`
        : `e(Layer, { name = "Story" }, {\n\t\t\t\t\tFrame = e(Box, { padding = "L" }, {\n\t\t\t\t\t\tSubject = e(${name}, { title = "${words(name) || name}" }),\n\t\t\t\t\t}),\n\t\t\t\t})`,
    });
    files.push([path.join(ui, 'Stories', `${name}.story.luau`), story]);
  }

  for (const [file] of files) {
    if (fs.existsSync(file) && !opt.force) throw new Error(`${file} exists (use --force to overwrite)`);
  }
  if (!opt.dryRun) {
    for (const [file, text] of files) {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, text);
    }
  }
  return files.map(([file]) => file);
}

// ---- themes and contrast ---------------------------------------------------------------
// Reads palettes straight from the Luau sources (Tokens.luau, GameTheme.luau, Presets.luau), so
// it checks exactly what the game will use, including your edits.

// Comments removed, strings kept (colours can be hex strings), offsets preserved.
function stripComments(src) {
  const out = src.split('');
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    if (c === '"' || c === "'" || c === '`') {
      let j = i + 1;
      while (j < src.length && src[j] !== c && src[j] !== '\n') j += src[j] === '\\' ? 2 : 1;
      i = j + 1;
    } else if (c === '-' && src[i + 1] === '-') {
      const long = /^--\[(=*)\[/.exec(src.slice(i, i + 64));
      const end = long ? src.indexOf(`]${long[1]}]`, i) + long[1].length + 2 : src.indexOf('\n', i);
      const stop = end < i ? src.length : end;
      for (let k = i; k < stop; k++) if (out[k] !== '\n') out[k] = ' ';
      i = stop;
    } else {
      i++;
    }
  }
  return out.join('');
}

function matchBrace(text, open) {
  let depth = 0;
  for (let i = open; i < text.length; i++) {
    if (text[i] === '{') depth++;
    else if (text[i] === '}' && --depth === 0) return i;
  }
  return -1;
}

// The `{ ... }` assigned to `key =` (first occurrence at or after `from`), or null.
function tableAfter(text, pattern, from = 0) {
  const re = new RegExp(pattern, 'g');
  re.lastIndex = from;
  const m = re.exec(text);
  if (!m) return null;
  const open = text.indexOf('{', m.index + m[0].length - 1);
  const close = matchBrace(text, open);
  return close < 0 ? null : { body: text.slice(open + 1, close), start: m.index, end: close };
}

function parseColor(expr) {
  let m = /Color3\.fromRGB\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*\)/.exec(expr);
  if (m) return [Number(m[1]), Number(m[2]), Number(m[3])];
  m = /Color3\.fromHex\(\s*"#?([0-9a-fA-F]{6})"\s*\)/.exec(expr);
  if (m) return [0, 2, 4].map((k) => parseInt(m[1].slice(k, k + 2), 16));
  m = /Color3\.new\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*\)/.exec(expr);
  if (m) return [Number(m[1]) * 255, Number(m[2]) * 255, Number(m[3]) * 255];
  return null;
}

// Top-level `Key = Color3...` entries of a table body.
function parseColorTable(body) {
  const colors = {};
  for (const m of body.matchAll(/\b([A-Za-z_]\w*)\s*=\s*(Color3\.\w+\([^)]*\))/g)) {
    const rgb = parseColor(m[2]);
    if (rgb) colors[m[1]] = rgb;
  }
  return colors;
}

// `{ Name = { Key = Color3... }, ... }` -> { Name: { Key: rgb } }
function parsePalettes(body) {
  const palettes = {};
  const re = /\b([A-Za-z_]\w*)\s*=\s*\{/g;
  let m;
  while ((m = re.exec(body))) {
    const open = m.index + m[0].length - 1;
    const close = matchBrace(body, open);
    if (close < 0) break;
    palettes[m[1]] = parseColorTable(body.slice(open + 1, close));
    re.lastIndex = close + 1;
  }
  return palettes;
}

function overridesOf(body) {
  const palettes = tableAfter(body, '\\bpalettes\\s*=\\s*\\{');
  const rarity = tableAfter(body, '\\brarity\\s*=\\s*\\{');
  const name = /\bname\s*=\s*"([^"]+)"/.exec(body);
  const defaultPalette = /\bdefaultPalette\s*=\s*"([^"]+)"/.exec(body);
  return {
    name: name && name[1],
    defaultPalette: defaultPalette && defaultPalette[1],
    palettes: palettes ? parsePalettes(palettes.body) : {},
    rarity: rarity ? parseColorTable(rarity.body) : {},
  };
}

// Same rules as Theme.create: existing palettes merge key by key, new ones start from the default.
function extendTheme(base, overrides, fallbackName) {
  const palettes = {};
  for (const [name, colors] of Object.entries(base.palettes)) palettes[name] = { ...colors };
  for (const [name, colors] of Object.entries(overrides.palettes)) {
    palettes[name] = { ...(palettes[name] || base.palettes[base.defaultPalette] || {}), ...colors };
  }
  return {
    name: overrides.name || fallbackName,
    defaultPalette: overrides.defaultPalette || base.defaultPalette,
    palettes,
    rarity: { ...base.rarity, ...overrides.rarity },
  };
}

function readThemes(uiDir) {
  const themeDir = path.join(uiDir, 'Theme');
  const tokensSrc = stripComments(fs.readFileSync(path.join(themeDir, 'Tokens.luau'), 'utf8'));
  const palettes = tableAfter(tokensSrc, 'Tokens\\.Palettes\\s*=\\s*\\{');
  const rarity = tableAfter(tokensSrc, 'Tokens\\.Rarity\\s*=\\s*\\{');
  const base = {
    name: 'Default',
    defaultPalette: 'Dark',
    palettes: palettes ? parsePalettes(palettes.body) : {},
    rarity: rarity ? parseColorTable(rarity.body) : {},
  };
  const themes = [base];

  const createCalls = (src) => {
    const calls = [];
    const re = /(?:Presets\.(\w+)\s*=\s*)?Theme\.create\(\s*\{/g;
    let m;
    while ((m = re.exec(src))) {
      const open = m.index + m[0].length - 1;
      const close = matchBrace(src, open);
      if (close < 0) break;
      const tail = src.slice(close + 1, src.indexOf(')', close) + 1);
      calls.push({ key: m[1], body: src.slice(open + 1, close), extendsGame: /\bGameTheme\b/.test(tail) });
      re.lastIndex = close + 1;
    }
    return calls;
  };

  let game = base;
  const gameFile = path.join(themeDir, 'GameTheme.luau');
  if (fs.existsSync(gameFile)) {
    const call = createCalls(stripComments(fs.readFileSync(gameFile, 'utf8')))[0];
    if (call) {
      game = extendTheme(base, overridesOf(call.body), 'Game');
      themes.push(game);
    }
  }
  const presetsFile = path.join(themeDir, 'Presets.luau');
  if (fs.existsSync(presetsFile)) {
    for (const call of createCalls(stripComments(fs.readFileSync(presetsFile, 'utf8')))) {
      themes.push(extendTheme(call.extendsGame ? game : base, overridesOf(call.body), call.key || 'Preset'));
    }
  }
  return themes;
}

function luminance([r, g, b]) {
  const lin = (c) => {
    const v = c / 255;
    return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

function contrastRatio(a, b) {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

// [foreground, background, minimum]: 4.5 for text, 3 for large text and UI parts (WCAG 2.1 AA).
const CONTRAST_PAIRS = [
  ['Text', 'Background', 4.5], ['Text', 'Surface', 4.5], ['Text', 'SurfaceRaised', 4.5], ['Text', 'SurfaceSunken', 4.5],
  ['TextMuted', 'Surface', 4.5], ['TextMuted', 'SurfaceRaised', 4.5],
  ['TextOnAccent', 'Accent', 4.5], ['TextOnAccent', 'Positive', 4.5], ['TextOnAccent', 'Danger', 4.5],
  ['Currency', 'Surface', 4.5], ['Warning', 'Surface', 3], ['Accent', 'Surface', 3],
  ['Focus', 'Surface', 3], ['Focus', 'Accent', 3],
];

function checkThemes(themes) {
  const results = [];
  for (const theme of themes) {
    for (const [paletteName, palette] of Object.entries(theme.palettes)) {
      const checks = [];
      for (const [fg, bg, min] of CONTRAST_PAIRS) {
        if (!palette[fg] || !palette[bg]) continue;
        const ratio = contrastRatio(palette[fg], palette[bg]);
        checks.push({ fg, bg, min, ratio, ok: ratio >= min });
      }
      // Rarity names are shown as caption text on tiles and the details column.
      for (const [rarity, rgb] of Object.entries(theme.rarity)) {
        for (const bg of ['Surface', 'SurfaceRaised']) {
          if (!palette[bg]) continue;
          const ratio = contrastRatio(rgb, palette[bg]);
          checks.push({ fg: rarity, bg, min: 4.5, ratio, ok: ratio >= 4.5 });
        }
      }
      results.push({ theme: theme.name, palette: paletteName, checks });
    }
  }
  return results;
}

// ---- cli -------------------------------------------------------------------------------

function parseArgs(args) {
  const opt = { _: [] };
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--force') opt.force = true;
    else if (a === '--dry-run') opt.dryRun = true;
    else if (a === '--no-story') opt.story = false;
    else if (a === '--tenfoot') opt.tenFoot = true;
    else if (a.startsWith('--')) opt[a.slice(2)] = args[++i];
    else opt._.push(a);
  }
  return opt;
}

function printDevices(opt) {
  const tokens = readTokens();
  let devices = readDevices();
  if (opt.size) {
    const [x, y] = opt.size.split(/[x×,]/).map(Number);
    const input = { touch: 'Touch', pointer: 'Pointer', gamepad: 'Gamepad' }[String(opt.input || 'pointer').toLowerCase()];
    if (!x || !y || !input) throw new Error('--size WxH and --input touch|pointer|gamepad');
    const [top, bottom, left, right] = (opt.insets || '0,0,0,0').split(',').map(Number);
    devices = [{ name: 'Custom', size: { x, y }, input, tenFoot: Boolean(opt.tenFoot), insets: { top, bottom, left, right }, topbar: Number(opt.topbar ?? 58) }];
  }
  console.log('| Device | Screen | Input | Safe area | Scale | Design units | Size class | Hit target |');
  console.log('|---|---|---|---|---|---|---|---|');
  for (const d of devices) {
    const r = measure(d, tokens);
    console.log(`| ${d.name} | ${d.size.x} × ${d.size.y} | ${d.tenFoot ? 'Gamepad (TV)' : d.input} | ${r.safe.x} × ${r.safe.y} | ${r.scale.toFixed(2)} | ${Math.round(r.design.x)} × ${Math.round(r.design.y)} | ${r.sizeClass} | ${r.hitTargetPx} px |`);
  }
}

function main(argv) {
  const [command, ...rest] = argv.slice(2);
  const opt = parseArgs(rest);
  try {
    if (command === 'install') {
      const report = install(opt);
      const verb = opt.dryRun ? 'would write' : 'wrote';
      console.log(`${verb} ${report.written.length} files${report.skipped.length ? `, kept ${report.skipped.length} existing (use --force to overwrite)` : ''}`);
      for (const f of report.skipped) console.log(`  kept ${path.relative(process.cwd(), f)}`);
      for (const f of report.owned) console.log(`  kept your ${path.relative(process.cwd(), f)} (yours; never overwritten)`);
      if (report.wally.length) console.log(`wally.toml: added ${report.wally.join(', ')}`);
      for (const note of report.notes) console.log(`- ${note}`);
      console.log('\nNext: sh scripts/install-packages.sh (or wally install), then rojo serve and Play.');
      console.log('Stories: install the UI Labs plugin and open Stories/UI.storybook in its widget.');
      return 0;
    }
    if (command === 'new') {
      const [kind, name] = opt._;
      const files = generate(kind, name, opt);
      for (const f of files) console.log(`${opt.dryRun ? 'would write' : 'wrote'} ${path.relative(process.cwd(), f)}`);
      if (kind === 'screen') console.log(`Mount it in UI/App.luau and add an "open" atom to UI/AppState.luau.`);
      return 0;
    }
    if (command === 'devices') {
      printDevices(opt);
      return 0;
    }
    if (command === 'contrast') {
      const ui = path.resolve(opt.ui || (opt.project ? path.join(opt.project, 'src', 'client', 'UI') : path.join(KIT, 'client', 'UI')));
      const results = checkThemes(readThemes(ui));
      let failures = 0;
      for (const r of results) {
        const bad = r.checks.filter((c) => !c.ok);
        failures += bad.length;
        console.log(`${bad.length ? 'FAIL' : 'ok  '} ${r.theme} / ${r.palette}: ${r.checks.length - bad.length}/${r.checks.length} pairs pass`);
        for (const c of opt.verbose ? r.checks : bad) {
          console.log(`     ${c.ok ? 'ok  ' : 'FAIL'} ${c.fg} on ${c.bg}: ${c.ratio.toFixed(2)}:1 (needs ${c.min}:1)`);
        }
      }
      if (failures) console.log(`\n${failures} pair(s) below WCAG contrast. Adjust those colours in GameTheme.luau.`);
      return failures ? 1 : 0;
    }
  } catch (err) {
    console.error(`error: ${err.message}`);
    return 1;
  }
  console.log('usage:\n  node uikit.cjs install --project <dir> [--client <dir>] [--force] [--dry-run]\n  node uikit.cjs new <component|screen|primitive> <Name> [--project <dir>] [--ui <dir>] [--no-story] [--force]\n  node uikit.cjs devices [--size WxH --input touch|pointer|gamepad [--tenfoot] [--insets t,b,l,r] [--topbar 58]]\n  node uikit.cjs contrast [--project <dir> | --ui <UI dir>] [--verbose]');
  return 2;
}

module.exports = {
  readTokens, readDevices, measure, install, generate, addWallyDependencies, PACKAGES,
  readThemes, checkThemes, contrastRatio, CONTRAST_PAIRS,
};

if (require.main === module) process.exit(main(process.argv));
