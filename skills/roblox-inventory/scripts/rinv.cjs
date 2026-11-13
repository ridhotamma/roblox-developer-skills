#!/usr/bin/env node
// Roblox inventory kit tool.
//
//   node rinv.cjs styles
//       List the inventory styles the kit ships.
//
//   node rinv.cjs install --src <project>/src [--style Attache] [--force]
//       Copy the kit into a Rojo project (roblox-project-structure layout), set the style,
//       declare the two remotes in shared/Net/init.luau and report what is still missing.
//       An existing ItemCatalog.luau / InventoryConfig.luau is kept unless --force.
//
//   node rinv.cjs catalog <items.json> [--out <ItemCatalog.luau>]
//       Check an item sheet and write it as ItemCatalog.luau. Prints to stdout without --out.
//       Sheet: { "Items": { "<Id>": { "Name": ..., "Category": ..., ... } }, "Recipes": [ { "A", "B", "Result", "Count" } ] }
//       Colours are "#rrggbb" or [r, g, b].
'use strict';

const fs = require('fs');
const path = require('path');

const SKILL = path.resolve(__dirname, '..');
const KIT = path.join(SKILL, 'assets', 'kit');
const CONFIG = path.join(KIT, 'shared', 'Inventory', 'InventoryConfig.luau');
const KEEP = new Set(['ItemCatalog.luau', 'InventoryConfig.luau']); // the user's own data

const REMOTE_LINES = [
  '\t-- roblox-inventory',
  '\tInventoryState = "Event", -- server -> client (key: string, payload: any) container contents, equipped item, shortcuts, notices',
  '\tInventoryAction = "Event", -- client -> server (action: string, ...) a request to move / use / equip / drop; the server checks every argument',
];

// --- styles ------------------------------------------------------------------------------

// Reads the style presets out of InventoryConfig.luau: name, the comment above it, and the
// few fields the tools care about.
function readStyles(source) {
  const start = source.indexOf('local Styles');
  const end = source.indexOf('\nlocal InventoryConfig');
  if (start < 0 || end < 0) throw new Error('InventoryConfig.luau: Styles table not found');
  const body = source.slice(start, end);
  const styles = [];
  const re = /((?:^\t-- .*\n)+)^\t(\w+) = \{\n([\s\S]*?)^\t\},/gm;
  let m;
  while ((m = re.exec(body))) {
    const text = m[3];
    const list = (key) => {
      const found = new RegExp(`^\\t\\t${key} = \\{([^}]*)\\}`, 'm').exec(text);
      return found ? [...found[1].matchAll(/"([^"]+)"/g)].map((x) => x[1]) : null;
    };
    const str = (key) => {
      const found = new RegExp(`^\\t\\t${key} = "([^"]+)"`, 'm').exec(text);
      return found ? found[1] : null;
    };
    const num = (key) => {
      const found = new RegExp(`^\\t\\t${key} = (\\d+)`, 'm').exec(text);
      return found ? Number(found[1]) : null;
    };
    const containers = {};
    const block = /^\t\tContainers = \{\n([\s\S]*?)^\t\t\},/m.exec(text);
    if (block) {
      // One-line entries and multi-line entries (Equipment) both start at three tabs.
      for (const c of block[1].matchAll(/^\t\t\t(\w+) = \{([\s\S]*?)(?=^\t\t\t\w+ = \{|(?![\s\S]))/gm)) {
        const spec = c[2];
        const pick = (k) => {
          const f = new RegExp(`\\b${k} = (\\d+|"[^"]+")`).exec(spec);
          return f ? JSON.parse(f[1]) : null;
        };
        containers[c[1]] = { Layout: pick('Layout'), Slots: pick('Slots'), Width: pick('Width'), Height: pick('Height') };
      }
    }
    styles.push({
      name: m[2],
      comment: m[1].split('\n').map((l) => l.replace(/^\t-- ?/, '')).join(' ').trim(),
      containers,
      carry: list('Carry') || [],
      window: list('Window') || [],
      wheel: list('Wheel'),
      bar: str('Bar'),
      barSlots: num('BarSlots'),
      shortcuts: num('Shortcuts'),
      theme: str('Theme'),
      hasStash: /^\t\tStash = \{/m.test(text),
    });
  }
  return styles;
}

function currentStyle(source) {
  const m = /^\tStyle = "(\w+)",/m.exec(source);
  return m ? m[1] : null;
}

// --- install -----------------------------------------------------------------------------

function walk(dir, base = dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith('.')) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(full, base));
    else out.push(path.relative(base, full));
  }
  return out.sort();
}

function addRemotes(netSource) {
  if (/\bInventoryState\b/.test(netSource) && /\bInventoryAction\b/.test(netSource)) return { text: netSource, changed: false };
  const m = /^local REMOTES[^\n]*=\s*\{\s*$/m.exec(netSource);
  if (!m) return { text: netSource, changed: false, failed: true };
  const at = m.index + m[0].length;
  return { text: `${netSource.slice(0, at)}\n${REMOTE_LINES.join('\n')}\n${netSource.slice(at)}`, changed: true };
}

function install({ src, style, force = false }) {
  const report = { written: [], kept: [], warnings: [], steps: [], style: null };
  if (!src) throw new Error('install needs --src <project>/src');
  const styles = readStyles(fs.readFileSync(CONFIG, 'utf8'));
  if (style && !styles.some((s) => s.name === style)) {
    throw new Error(`unknown style "${style}". Styles: ${styles.map((s) => s.name).join(', ')}`);
  }
  fs.mkdirSync(src, { recursive: true });

  for (const rel of walk(KIT)) {
    const from = path.join(KIT, rel);
    const to = path.join(src, rel);
    if (fs.existsSync(to) && KEEP.has(path.basename(rel)) && !force) {
      report.kept.push(rel);
      continue;
    }
    fs.mkdirSync(path.dirname(to), { recursive: true });
    fs.copyFileSync(from, to);
    report.written.push(rel);
  }

  const configPath = path.join(src, 'shared', 'Inventory', 'InventoryConfig.luau');
  let config = fs.readFileSync(configPath, 'utf8');
  if (style) {
    config = config.replace(/^\tStyle = "\w+",/m, `\tStyle = "${style}",`);
    fs.writeFileSync(configPath, config);
  }
  report.style = currentStyle(config);

  const netPath = path.join(src, 'shared', 'Net', 'init.luau');
  if (fs.existsSync(netPath)) {
    const result = addRemotes(fs.readFileSync(netPath, 'utf8'));
    if (result.changed) {
      fs.writeFileSync(netPath, result.text);
      report.written.push(path.join('shared', 'Net', 'init.luau') + ' (remotes added)');
    } else if (result.failed) {
      report.warnings.push('Could not find the REMOTES table in shared/Net/init.luau: add InventoryState and InventoryAction (both "Event") yourself.');
    }
  } else {
    report.warnings.push('shared/Net/init.luau not found. The kit expects the roblox-project-structure Net module; declare InventoryState and InventoryAction (RemoteEvents) there.');
  }

  const need = [
    [path.join('server', 'Services', 'DataService.luau'), 'DataService (ProfileStore) is what saves the inventory'],
    [path.join('shared', 'Util', 'Loader.luau'), 'the Loader starts Services and Controllers'],
  ];
  for (const [rel, why] of need) {
    if (!fs.existsSync(path.join(src, rel))) report.warnings.push(`${rel} not found: ${why}. Scaffold with the roblox-project-structure skill, or adapt the requires.`);
  }
  const wally = path.join(path.dirname(src), 'wally.toml');
  if (fs.existsSync(wally) && !/^\s*Signal\s*=/m.test(fs.readFileSync(wally, 'utf8'))) {
    report.warnings.push('wally.toml has no Signal dependency: add Signal = "sleitnick/signal@2.0.3" under [dependencies].');
  }

  const chosen = styles.find((s) => s.name === report.style);
  report.steps.push('Replace the example items in shared/Inventory/ItemCatalog.luau with your own (or build it from a sheet: rinv.cjs catalog).');
  report.steps.push('Put one Tool per equippable item in ServerStorage.Tools, named after the item\'s Tool field. Empty StarterPack (the kit moves matching Tools out of it on its own).');
  report.steps.push('Optional: add `Inventory = {},` to shared/Config/DataTemplate.luau so the saved field is typed. It is created on first load either way.');
  report.steps.push('World: tag pickups "WorldItem" (attribute ItemId), chests "InventoryContainer"' + (chosen && chosen.hasStash ? ', storage boxes "ItemBox".' : '.'));
  report.steps.push('Test with Test > Clients and Servers (2 players): the built-in hotbar is gone, I / ` opens the inventory, a second client cannot see or move the first one\'s items.');
  return report;
}

// --- catalog -----------------------------------------------------------------------------

const FIELD_ORDER = ['Name', 'Category', 'Description', 'Icon', 'Color', 'MaxStack', 'Size', 'Weight', 'Tool', 'Use', 'Heal', 'WheelGroup', 'Ammo', 'Droppable', 'Model'];
const ID = /^[A-Za-z_][A-Za-z0-9_]*$/;

function luauString(value) {
  return `"${String(value).replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n')}"`;
}

function parseColor(value) {
  if (typeof value === 'string') {
    const m = /^#?([0-9a-f]{6})$/i.exec(value.trim());
    if (!m) return null;
    const n = parseInt(m[1], 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }
  if (Array.isArray(value) && value.length === 3 && value.every((v) => Number.isInteger(v) && v >= 0 && v <= 255)) return value;
  return null;
}

function luauValue(key, value) {
  if (key === 'Color') return `Color3.fromRGB(${parseColor(value).join(', ')})`;
  if (key === 'Size') return `{ ${value[0]}, ${value[1]} }`;
  if (typeof value === 'string') return luauString(value);
  return String(value);
}

// Returns { text, errors, warnings }. `text` is null when there are errors.
function buildCatalog(sheet, styles = readStyles(fs.readFileSync(CONFIG, 'utf8'))) {
  const errors = [];
  const warnings = [];
  const items = sheet && sheet.Items;
  if (!items || typeof items !== 'object' || Array.isArray(items)) {
    return { text: null, errors: ['sheet needs an "Items" object keyed by item id'], warnings };
  }
  const ids = Object.keys(items);
  if (ids.length === 0) errors.push('"Items" is empty');
  const wheelGroups = new Set(styles.flatMap((s) => s.wheel || []));
  const grids = styles.flatMap((s) => Object.entries(s.containers).filter(([, c]) => c.Layout === 'Grid').map(([name, c]) => ({ style: s.name, name, ...c })));
  const toolOwners = {};

  for (const id of ids) {
    const item = items[id];
    const at = `Items.${id}`;
    if (!ID.test(id)) errors.push(`${at}: ids must be identifiers (letters, digits, underscore)`);
    if (!item || typeof item !== 'object') { errors.push(`${at}: must be an object`); continue; }
    for (const key of Object.keys(item)) {
      if (!FIELD_ORDER.includes(key)) warnings.push(`${at}.${key}: not a field the kit reads (kept out of the output)`);
    }
    for (const key of ['Name', 'Category']) {
      if (typeof item[key] !== 'string' || !item[key].trim()) errors.push(`${at}.${key}: required text`);
    }
    for (const key of ['Description', 'Icon', 'Tool', 'Use', 'WheelGroup', 'Ammo', 'Model']) {
      if (item[key] !== undefined && typeof item[key] !== 'string') errors.push(`${at}.${key}: must be text`);
    }
    if (item.Icon !== undefined && typeof item.Icon === 'string' && !/^rbxassetid:\/\/\d+$|^rbxasset:\/\//.test(item.Icon)) {
      errors.push(`${at}.Icon: use "rbxassetid://<number>"`);
    }
    if (item.Color !== undefined && !parseColor(item.Color)) errors.push(`${at}.Color: use "#rrggbb" or [r, g, b]`);
    if (item.MaxStack !== undefined && !(Number.isInteger(item.MaxStack) && item.MaxStack >= 1)) errors.push(`${at}.MaxStack: whole number, 1 or more`);
    if (item.Weight !== undefined && !(typeof item.Weight === 'number' && item.Weight >= 0)) errors.push(`${at}.Weight: number, 0 or more`);
    if (item.Heal !== undefined && !(typeof item.Heal === 'number' && item.Heal > 0)) errors.push(`${at}.Heal: number above 0`);
    if (item.Droppable !== undefined && typeof item.Droppable !== 'boolean') errors.push(`${at}.Droppable: true or false`);
    if (item.Size !== undefined) {
      const ok = Array.isArray(item.Size) && item.Size.length === 2 && item.Size.every((v) => Number.isInteger(v) && v >= 1 && v <= 12);
      if (!ok) errors.push(`${at}.Size: [width, height] in whole cells, 1 to 12`);
      else {
        for (const grid of grids) {
          const [w, h] = item.Size;
          const fits = (w <= grid.Width && h <= grid.Height) || (h <= grid.Width && w <= grid.Height);
          if (!fits) warnings.push(`${at}.Size ${w}x${h} never fits the ${grid.Width}x${grid.Height} ${grid.name} grid of style ${grid.style}`);
        }
      }
    }
    if (item.Use === 'Heal' && item.Heal === undefined) warnings.push(`${at}: Use = "Heal" without Heal uses the default of 25`);
    if (item.Tool && (item.MaxStack || 1) > 1) warnings.push(`${at}: an equippable item that stacks; one Tool is held for the whole stack`);
    if (item.Tool && item.Use) warnings.push(`${at}: has both Tool and Use; using it runs Use and it can only be equipped from the Equip button`);
    if (item.WheelGroup && !wheelGroups.has(item.WheelGroup)) warnings.push(`${at}.WheelGroup "${item.WheelGroup}" is not a segment of any style's Wheel (${[...wheelGroups].join(', ')})`);
    if (item.WheelGroup && !item.Tool) warnings.push(`${at}: WheelGroup without Tool; the wheel only shows equippable items`);
    if (item.Tool) {
      if (toolOwners[item.Tool]) warnings.push(`${at}: shares Tool "${item.Tool}" with ${toolOwners[item.Tool]}; a loose Tool of that name can only become one of them`);
      toolOwners[item.Tool] = id;
    }
  }
  for (const id of ids) {
    const ammo = items[id] && items[id].Ammo;
    if (typeof ammo === 'string' && !items[ammo]) errors.push(`Items.${id}.Ammo: "${ammo}" is not an item`);
  }

  const recipes = sheet.Recipes === undefined ? [] : sheet.Recipes;
  if (!Array.isArray(recipes)) errors.push('"Recipes" must be a list');
  else {
    const seen = new Set();
    recipes.forEach((r, i) => {
      const at = `Recipes[${i}]`;
      if (!r || typeof r !== 'object') { errors.push(`${at}: must be an object`); return; }
      for (const key of ['A', 'B', 'Result']) {
        if (typeof r[key] !== 'string' || !items[r[key]]) errors.push(`${at}.${key}: "${r[key]}" is not an item`);
      }
      if (r.A === r.B) errors.push(`${at}: A and B must differ (dropping an item on its own kind merges the stacks)`);
      if (r.Count !== undefined && !(Number.isInteger(r.Count) && r.Count >= 1)) errors.push(`${at}.Count: whole number, 1 or more`);
      const pair = [r.A, r.B].sort().join('+');
      if (seen.has(pair)) errors.push(`${at}: a second recipe for ${pair}`);
      seen.add(pair);
    });
  }
  if (errors.length) return { text: null, errors, warnings };

  const lines = [
    '--!strict',
    '-- Every item in the game, and what combines into what.',
    '-- Generated by `rinv.cjs catalog` from an item sheet: edit the sheet and run it again.',
    '-- Field reference: see the roblox-inventory skill, references/items-and-tools.md.',
    '',
    'local Items = {',
  ];
  for (const id of ids) {
    lines.push(`\t${id} = {`);
    for (const key of FIELD_ORDER) {
      if (items[id][key] !== undefined) lines.push(`\t\t${key} = ${luauValue(key, items[id][key])},`);
    }
    lines.push('\t},');
  }
  lines.push('}', '', '-- Dragging A onto B (either order) consumes one of each and gives Result.', 'local Recipes: { { A: string, B: string, Result: string, Count: number } } = {');
  for (const r of recipes) {
    lines.push(`\t{ A = ${luauString(r.A)}, B = ${luauString(r.B)}, Result = ${luauString(r.Result)}, Count = ${r.Count || 1} },`);
  }
  lines.push(
    '}',
    '',
    'local function findRecipe(a: string, b: string): { A: string, B: string, Result: string, Count: number }?',
    '\tfor _, recipe in Recipes do',
    '\t\tif (recipe.A == a and recipe.B == b) or (recipe.A == b and recipe.B == a) then',
    '\t\t\treturn recipe',
    '\t\tend',
    '\tend',
    '\treturn nil',
    'end',
    '',
    'return table.freeze({',
    '\tItems = Items,',
    '\tRecipes = Recipes,',
    '\tFindRecipe = findRecipe,',
    '})',
    ''
  );
  return { text: lines.join('\n'), errors, warnings };
}

// --- cli ---------------------------------------------------------------------------------

function parseArgs(argv) {
  const args = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (next === undefined || next.startsWith('--')) args[key] = true;
      else { args[key] = next; i++; }
    } else args._.push(a);
  }
  return args;
}

function main(argv) {
  const args = parseArgs(argv);
  const command = args._[0];
  if (command === 'styles') {
    const source = fs.readFileSync(CONFIG, 'utf8');
    const active = currentStyle(source);
    for (const s of readStyles(source)) {
      const parts = Object.entries(s.containers).map(([name, c]) => `${name}: ${c.Layout === 'Grid' ? `${c.Width}x${c.Height} grid` : c.Layout === 'Slots' ? `${c.Slots} slots` : 'list'}`);
      const extras = [s.bar ? `hotbar (${s.barSlots})` : null, s.shortcuts ? `${s.shortcuts} quick slots` : null, s.wheel ? `wheel (${s.wheel.length})` : null, s.hasStash ? 'stash' : null].filter(Boolean);
      console.log(`${s.name}${s.name === active ? '  (default)' : ''}\n  ${s.comment}\n  ${parts.join(', ')}${extras.length ? ' + ' + extras.join(', ') : ''}\n`);
    }
    return 0;
  }
  if (command === 'install') {
    const report = install({ src: args.src && path.resolve(String(args.src)), style: args.style === true ? undefined : args.style, force: Boolean(args.force) });
    console.log(`Style: ${report.style}`);
    console.log(`Wrote ${report.written.length} files:`);
    for (const f of report.written) console.log(`  ${f}`);
    for (const f of report.kept) console.log(`  kept your ${f} (use --force to replace)`);
    for (const w of report.warnings) console.log(`WARNING ${w}`);
    console.log('\nNext:');
    report.steps.forEach((s, i) => console.log(`  ${i + 1}. ${s}`));
    return 0;
  }
  if (command === 'catalog') {
    const file = args._[1];
    if (!file) { console.error('catalog needs an items.json'); return 2; }
    let sheet;
    try {
      sheet = JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch (err) {
      console.error(`${file}: ${err.message}`);
      return 2;
    }
    const result = buildCatalog(sheet);
    for (const w of result.warnings) console.error(`warning: ${w}`);
    for (const e of result.errors) console.error(`error: ${e}`);
    if (!result.text) return 1;
    if (args.out && args.out !== true) {
      fs.mkdirSync(path.dirname(path.resolve(String(args.out))), { recursive: true });
      fs.writeFileSync(String(args.out), result.text);
      console.error(`wrote ${args.out} (${Object.keys(sheet.Items).length} items, ${(sheet.Recipes || []).length} recipes)`);
    } else {
      process.stdout.write(result.text);
    }
    return 0;
  }
  console.log(fs.readFileSync(__filename, 'utf8').split('\n').slice(1, 17).map((l) => l.replace(/^\/\/ ?/, '')).join('\n'));
  return command ? 2 : 0;
}

if (require.main === module) {
  try {
    process.exit(main(process.argv.slice(2)));
  } catch (err) {
    console.error(err.message);
    process.exit(1);
  }
}

module.exports = { readStyles, currentStyle, install, addRemotes, buildCatalog, walk, KIT, SKILL };
