#!/usr/bin/env node
// Offline checks for the inventory skill. No Roblox, no network.
//  1. every kit file is strict, with balanced brackets and balanced blocks
//  2. requires point at files that exist (kit, or the project scaffold)
//  3. cross-module references are real: every Core / InventoryService / InventoryUi /
//     InventoryDrag / Catalog / Config member used somewhere is defined, and everything
//     the views read from `ctx` is provided by the controller
//  4. the wire protocol agrees on both sides: remotes, actions and state keys
//  5. config and catalog are consistent (styles, themes, loot, recipes, starter items)
//  6. the installer and the catalog builder work on a throwaway project
//  7. docs mention every kit file and every style, and point at files that exist
//  8. the Luau tests pass, when the `luau` CLI is installed (skipped otherwise)
// Run: node scripts/selftest.cjs
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { readStyles, currentStyle, install, addRemotes, buildCatalog, walk, KIT, SKILL } = require('./rinv.cjs');

let failed = 0;
let skipped = 0;
function check(name, cond, extra = '') {
  console.log(`${cond ? 'ok  ' : 'FAIL'} ${name}${cond || !extra ? '' : `  ${extra}`}`);
  if (!cond) failed++;
}

const read = (rel) => fs.readFileSync(path.join(SKILL, rel), 'utf8');
const kitFiles = walk(KIT).filter((f) => f.endsWith('.luau'));
const kit = Object.fromEntries(kitFiles.map((f) => [f.split(path.sep).join('/'), fs.readFileSync(path.join(KIT, f), 'utf8')]));

// --- Luau structure ----------------------------------------------------------------------

// Blanks comments and strings (keeping newlines) so keywords and brackets can be counted.
function strip(src) {
  const out = src.split('');
  const n = src.length;
  const blank = (a, b) => { for (let k = a; k < b && k < n; k++) if (out[k] !== '\n') out[k] = ' '; };
  const longAt = (i) => { const m = /^\[(=*)\[/.exec(src.slice(i, i + 16)); return m ? m[1].length : -1; };
  let i = 0;
  while (i < n) {
    const c = src[i];
    if (c === '-' && src[i + 1] === '-') {
      const level = src[i + 2] === '[' ? longAt(i + 2) : -1;
      let end;
      if (level >= 0) {
        const close = `]${'='.repeat(level)}]`;
        end = src.indexOf(close, i + 4);
        end = end < 0 ? n : end + close.length;
      } else {
        end = src.indexOf('\n', i);
        if (end < 0) end = n;
      }
      blank(i, end);
      i = end;
    } else if (c === '[' && longAt(i) >= 0) {
      const close = `]${'='.repeat(longAt(i))}]`;
      let end = src.indexOf(close, i + 2);
      end = end < 0 ? n : end + close.length;
      blank(i, end);
      i = end;
    } else if (c === '"' || c === "'" || c === '`') {
      let j = i + 1;
      while (j < n && src[j] !== c && src[j] !== '\n') j += src[j] === '\\' ? 2 : 1;
      blank(i + 1, j);
      i = j + 1;
    } else i++;
  }
  return out.join('');
}

function bracketsBalanced(stripped) {
  const pairs = { ')': '(', ']': '[', '}': '{' };
  const stack = [];
  for (const c of stripped) {
    if ('([{'.includes(c)) stack.push(c);
    else if (pairs[c]) { if (stack.pop() !== pairs[c]) return false; }
  }
  return stack.length === 0;
}

// Checks function / do / if / repeat against end / until, telling `if` statements apart
// from `if` expressions (which have no `end`).
function blocksBalanced(stripped) {
  const tokens = [...stripped.matchAll(/[A-Za-z_][A-Za-z0-9_]*|\d[\w.]*|==|~=|<=|>=|\.\.|->|[^\s\w]/g)].map((m) => m[0]);
  const exprBefore = new Set(['=', '(', ',', '{', '[', 'return', 'and', 'or', 'not', '..', '+', '-', '*', '/', '%', '^', '==', '~=', '<', '>', '<=', '>=', ':', '+=', '-=', '->', 'in']);
  const stack = [];
  const dropFinishedExprs = () => { while (stack.length && stack[stack.length - 1].kind === 'expr') stack.pop(); };
  let prev = null;
  for (let t = 0; t < tokens.length; t++) {
    const tok = tokens[t];
    // `a += if ...` arrives as two tokens: treat `=` after an operator as `=`.
    if (tok === 'function') { stack.push({ kind: 'block' }); }
    else if (tok === 'do') { dropFinishedExprs(); stack.push({ kind: 'block' }); }
    else if (tok === 'repeat') { dropFinishedExprs(); stack.push({ kind: 'repeat' }); }
    else if (tok === 'until') { dropFinishedExprs(); if (!stack.length || stack.pop().kind !== 'repeat') return false; }
    else if (tok === 'if') {
      let kind;
      if (prev === 'then' || prev === 'else') kind = stack.length && stack[stack.length - 1].kind === 'expr' ? 'expr' : 'stmt';
      else kind = exprBefore.has(prev) ? 'expr' : 'stmt';
      if (kind === 'stmt') dropFinishedExprs();
      stack.push({ kind, elseSeen: false });
    } else if (tok === 'else') {
      while (stack.length && stack[stack.length - 1].kind === 'expr' && stack[stack.length - 1].elseSeen) stack.pop();
      if (!stack.length) return false;
      stack[stack.length - 1].elseSeen = true;
    } else if (tok === 'elseif') {
      while (stack.length && stack[stack.length - 1].kind === 'expr' && stack[stack.length - 1].elseSeen) stack.pop();
      if (!stack.length) return false;
    } else if (tok === 'end') {
      dropFinishedExprs();
      const top = stack.pop();
      if (!top || top.kind === 'repeat') return false;
    }
    prev = tok;
  }
  dropFinishedExprs();
  return stack.length === 0;
}

const fixtureGood = strip('local a = if x then 1 elseif y then 2 else 3\nif a then\n\tlocal b = { if a then 1 else 2 }\n\tfoo(if a then b else c, 2)\nelse\n\tfor i = 1, 2 do repeat i += 1 until i > 3 end\nend\nlocal s = `{a} end "if"` -- end\n');
const fixtureBad = strip('local function f()\n\tif a then\n\t\treturn 1\nend\n');
check('block checker accepts if-expressions', blocksBalanced(fixtureGood));
check('block checker catches a missing end', !blocksBalanced(fixtureBad));

const stripped = {};
for (const [rel, src] of Object.entries(kit)) {
  stripped[rel] = strip(src);
  const ok = src.startsWith('--!strict') && bracketsBalanced(stripped[rel]) && blocksBalanced(stripped[rel]);
  check(`strict and balanced: ${rel}`, ok);
  check(`no CRLF or stray tabs-as-spaces: ${rel}`, !src.includes('\r') && !/^ {2,}\S/m.test(src));
}

// --- requires ----------------------------------------------------------------------------

// Modules the kit expects from the roblox-project-structure scaffold.
const SCAFFOLD = new Set(['shared/Net', 'server/Services/DataService', 'Packages/Signal']);
for (const [rel, src] of Object.entries(kit)) {
  const dir = path.posix.dirname(rel);
  for (const m of stripped[rel].matchAll(/require\(([^)]+)\)/g)) {
    const expr = m[1].trim();
    let target = null;
    if (expr.startsWith('ReplicatedStorage.Shared.')) target = `shared/${expr.slice('ReplicatedStorage.Shared.'.length).split('.').join('/')}`;
    else if (expr.startsWith('ReplicatedStorage.Packages.')) target = `Packages/${expr.slice('ReplicatedStorage.Packages.'.length)}`;
    else if (expr.startsWith('script.')) {
      let at = dir + '/' + path.posix.basename(rel, '.luau');
      for (const part of expr.split('.').slice(1)) at = part === 'Parent' ? path.posix.dirname(at) : `${at}/${part}`;
      target = at;
    }
    const exists = target && (kit[`${target}.luau`] !== undefined || SCAFFOLD.has(target));
    check(`require resolves: ${rel} -> ${expr}`, Boolean(exists));
  }
}

// --- members -----------------------------------------------------------------------------

const core = kit['shared/Inventory/InventoryCore.luau'];
const service = kit['server/Services/InventoryService.luau'];
const ui = kit['client/Inventory/InventoryUi.luau'];
const drag = kit['client/Inventory/InventoryDrag.luau'];
const controller = kit['client/Controllers/InventoryController.luau'];
const config = kit['shared/Inventory/InventoryConfig.luau'];
const catalog = kit['shared/Inventory/ItemCatalog.luau'];

const defined = (src, name) => new Set([...src.matchAll(new RegExp(`function ${name}[.:](\\w+)`, 'g'))].map((m) => m[1]));
const tableKeys = (src, opener) => {
  const start = src.indexOf(opener);
  if (start < 0) return new Set();
  const body = src.slice(start + opener.length, src.indexOf('\n}', start));
  return new Set([...body.matchAll(/^\t(\w+) =/gm)].map((m) => m[1]));
};
function usesOf(pattern, files) {
  const found = [];
  for (const [rel, text] of Object.entries(files)) {
    for (const m of text.matchAll(pattern)) found.push({ rel, name: m[1] });
  }
  return found;
}
function checkMembers(label, uses, members) {
  const missing = [...new Set(uses.filter((u) => !members.has(u.name)).map((u) => `${u.name} (${u.rel})`))];
  check(`${label}: ${new Set(uses.map((u) => u.name)).size} members used, all defined`, missing.length === 0, missing.join(', '));
}

const coreMembers = defined(core, 'Core');
checkMembers('InventoryCore', usesOf(/\b(?:ctx\.|self\.Ctx\.)?Core\.(\w+)\(/g, stripped), coreMembers);

const serviceMembers = new Set([...defined(service, 'InventoryService'), ...tableKeys(service, 'local InventoryService = {')]);
checkMembers('InventoryService', usesOf(/\bInventoryService[.:](\w+)/g, stripped), serviceMembers);

const uiMembers = new Set([...defined(ui, 'InventoryUi'), 'Themes']);
checkMembers('InventoryUi', usesOf(/\bInventoryUi\.(\w+)[(.\[]/g, stripped), uiMembers);

const dragMembers = new Set([...defined(drag, 'InventoryDrag'), 'Held', ...[...drag.matchAll(/^export type (\w+)/gm)].map((m) => m[1])]);
checkMembers('InventoryDrag', usesOf(/\b(?:InventoryDrag|[cC]tx\.Drag)\.(\w+)/g, stripped), dragMembers);

checkMembers('ItemCatalog', usesOf(/\b(?:ctx\.|self\.Ctx\.)?Catalog\.(\w+)/g, stripped), new Set(['Items', 'Recipes', 'FindRecipe']));

const configKeys = new Set([...tableKeys(config, 'local InventoryConfig = {'), 'Style']);
const configUses = usesOf(/\b(?:ctx\.|self\.Ctx\.)?Config\.(\w+)/g, stripped);
checkMembers('InventoryConfig', configUses, configKeys);
const keyUses = usesOf(/\bConfig\.Keys\.(\w+)/g, stripped);
const keyBlock = /\tKeys = \{([\s\S]*?)\n\t\},/.exec(config);
checkMembers('InventoryConfig.Keys', keyUses, new Set([...keyBlock[1].matchAll(/^\t\t(\w+) =/gm)].map((m) => m[1])));

// Everything the views read from ctx is something the controller (or the window) provides.
const ctxProvided = new Set([
  ...tableKeys(controller, 'local ctx: any = {'),
  ...[...controller.matchAll(/\bctx\.(\w+) =/g)].map((m) => m[1]),
  ...[...kit['client/Inventory/InventoryWindow.luau'].matchAll(/\bctx\.(\w+) =/g)].map((m) => m[1]),
]);
const clientFiles = Object.fromEntries(Object.entries(stripped).filter(([rel]) => rel.startsWith('client/Inventory/')));
checkMembers('ctx', usesOf(/\b(?:ctx|self\.Ctx)\.(\w+)/g, clientFiles), ctxProvided);

// Every view offers what the window and the drag manager call.
for (const rel of ['client/Inventory/Views/SlotGridView.luau', 'client/Inventory/Views/ShapeGridView.luau', 'client/Inventory/Views/ListView.luau']) {
  const name = path.posix.basename(rel, '.luau');
  const methods = defined(kit[rel], name);
  const need = ['new', 'Render', 'HitTest', 'Hover', 'FirstSelectable', 'Destroy'];
  check(`${name} implements the view contract`, need.every((m) => methods.has(m)), need.filter((m) => !methods.has(m)).join(', '));
}
const themeKeys = new Set([...ui.matchAll(/^\t(\w+): [\w.]+,/gm)].map((m) => m[1]));
checkMembers('Theme', usesOf(/\b[tT]heme\.(\w+)/g, clientFiles), themeKeys);
const themeNames = [...ui.matchAll(/^\t(\w+) = \{\n\t\tDim =/gm)].map((m) => m[1]);
for (const name of themeNames) {
  const block = new RegExp(`^\\t${name} = \\{\\n([\\s\\S]*?)^\\t\\},`, 'm').exec(ui)[1];
  const keys = new Set([...block.matchAll(/^\t\t(\w+) =/gm)].map((m) => m[1]));
  check(`theme ${name} sets every field`, [...themeKeys].every((k) => keys.has(k)), [...themeKeys].filter((k) => !keys.has(k)).join(', '));
}

// --- wire protocol -----------------------------------------------------------------------

const remotesUsed = new Set(usesOf(/Net\.(?:Event|Handle|Function|Unreliable)\("(\w+)"/g, kit).map((u) => u.name));
const remotesDocumented = new Set([...config.matchAll(/^--   (\w+) = "Event",/gm)].map((m) => m[1]));
check('remotes used = remotes documented in InventoryConfig', [...remotesUsed].sort().join() === [...remotesDocumented].sort().join(), `${[...remotesUsed]} vs ${[...remotesDocumented]}`);
const patched = addRemotes('local REMOTES: { [string]: Kind } = {\n\tNotify = "Event",\n}\n');
check('installer declares the same remotes', [...remotesUsed].every((r) => new RegExp(`\\t${r} = "Event"`).test(patched.text)) && patched.changed);
check('installer does not declare them twice', addRemotes(patched.text).changed === false);

const handlers = new Set([...service.matchAll(/^function actions\.(\w+)/gm)].map((m) => m[1]));
const sent = usesOf(/\b(?:send|ctx\.Send)\("(\w+)"/g, Object.fromEntries(Object.entries(kit).filter(([rel]) => rel.startsWith('client/'))));
checkMembers('client actions have server handlers', sent, handlers);
const header = config.slice(0, config.indexOf('export type Style'));
check('every server action is documented', [...handlers].every((h) => header.includes(`"${h}"`)), [...handlers].filter((h) => !header.includes(`"${h}"`)).join(', '));
const stateKeys = new Set([...service.matchAll(/send\(\w+, "(\w+)"/g)].map((m) => m[1]));
check('every state key is documented and handled', [...stateKeys].every((k) => header.includes(`"${k}"`) && controller.includes(`"${k}"`)), [...stateKeys].join(', '));

// The server never trusts an argument it has not type-checked: every action handler either
// checks types itself or hands straight to a checked public method.
for (const m of service.matchAll(/^function actions\.(\w+)\(([^)]*)\)\n([\s\S]*?)^end/gm)) {
  const params = m[2].split(',').map((p) => p.trim()).slice(2).filter(Boolean);
  const body = m[3];
  const unchecked = params.filter((p) => !new RegExp(`type\\(${p}\\)|readDest\\(${p}\\)|optionalCount\\(${p}\\)|${p} == false`).test(body));
  check(`action ${m[1]} checks its arguments`, unchecked.length === 0, unchecked.join(', '));
}

// --- config and catalog ------------------------------------------------------------------

const styles = readStyles(config);
const itemIds = new Set([...catalog.matchAll(/^\t(\w+) = \{$/gm)].map((m) => m[1]));
check('six styles', styles.length === 6, styles.map((s) => s.name).join(', '));
check('default style exists', styles.some((s) => s.name === currentStyle(config)));
for (const s of styles) {
  const names = new Set(Object.keys(s.containers));
  const problems = [];
  if (!themeNames.includes(s.theme)) problems.push(`theme ${s.theme}`);
  for (const n of [...s.carry, ...s.window]) if (!names.has(n)) problems.push(`container ${n}`);
  if (s.carry.length === 0 || s.window.length === 0) problems.push('empty Carry / Window');
  if (s.bar && (!names.has(s.bar) || s.containers[s.bar].Layout !== 'Slots' || !s.barSlots)) problems.push('Bar');
  if (s.bar && s.shortcuts) problems.push('Bar and Shortcuts together');
  if (names.has('Stash')) problems.push('a carried container named Stash');
  check(`style ${s.name} is consistent`, problems.length === 0, problems.join(', '));
}
const wheelGroups = new Set(styles.flatMap((s) => s.wheel || []));
const idRefs = [
  ...[...catalog.matchAll(/\b(?:Ammo|A|B|Result) = "(\w+)"/g)].map((m) => m[1]),
  ...[...config.matchAll(/\bId = "(\w+)"/g)].map((m) => m[1]),
];
check('every item id referenced exists', idRefs.every((id) => itemIds.has(id)), idRefs.filter((id) => !itemIds.has(id)).join(', '));
const groups = [...catalog.matchAll(/WheelGroup = "(\w+)"/g)].map((m) => m[1]);
check('every WheelGroup is a wheel segment', groups.length > 0 && groups.every((g) => wheelGroups.has(g)), groups.filter((g) => !wheelGroups.has(g)).join(', '));
const equipSlots = /SlotAccept = \{([^}]*)\}/.exec(config)[1].match(/"(\w+)"/g).map((s) => s.slice(1, -1));
const categories = new Set([...catalog.matchAll(/Category = "(\w+)"/g)].map((m) => m[1]));
check('equipment slots accept categories the catalog has', equipSlots.every((c) => categories.has(c)), equipSlots.join(', '));

// --- installer and catalog builder ---------------------------------------------------------

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'rinv-'));
const src = path.join(tmp, 'game', 'src');
fs.mkdirSync(path.join(src, 'shared', 'Net'), { recursive: true });
fs.mkdirSync(path.join(src, 'server', 'Services'), { recursive: true });
fs.mkdirSync(path.join(src, 'shared', 'Util'), { recursive: true });
fs.writeFileSync(path.join(src, 'shared', 'Net', 'init.luau'), 'local REMOTES: { [string]: Kind } = {\n\tNotify = "Event",\n}\n');
fs.writeFileSync(path.join(src, 'server', 'Services', 'DataService.luau'), 'return {}\n');
fs.writeFileSync(path.join(src, 'shared', 'Util', 'Loader.luau'), 'return {}\n');
fs.writeFileSync(path.join(tmp, 'game', 'wally.toml'), '[dependencies]\nSignal = "sleitnick/signal@2.0.3"\n');

const first = install({ src, style: 'Survivor' });
check('install copies every kit file', kitFiles.every((f) => fs.existsSync(path.join(src, f))) && first.written.length === kitFiles.length + 1);
check('install sets the style', first.style === 'Survivor' && /^\tStyle = "Survivor",/m.test(fs.readFileSync(path.join(src, 'shared/Inventory/InventoryConfig.luau'), 'utf8')));
check('install adds the remotes', /InventoryAction = "Event"/.test(fs.readFileSync(path.join(src, 'shared/Net/init.luau'), 'utf8')));
check('install on a full scaffold has no warnings', first.warnings.length === 0, first.warnings.join(' | '));
fs.appendFileSync(path.join(src, 'shared/Inventory/ItemCatalog.luau'), '-- mine\n');
const second = install({ src });
check('reinstall keeps the catalog, the config and the chosen style', second.kept.length === 2 && second.style === 'Survivor' && fs.readFileSync(path.join(src, 'shared/Inventory/ItemCatalog.luau'), 'utf8').endsWith('-- mine\n'));
check('reinstall does not touch Net again', !second.written.some((f) => f.includes('Net')));
const bare = install({ src: path.join(tmp, 'bare', 'src') });
check('install into an empty folder warns about the scaffold', bare.warnings.length >= 3);
let threw = false;
try { install({ src, style: 'Nope' }); } catch { threw = true; }
check('unknown style is refused', threw);

const sheet = JSON.parse(read('assets/items.example.json'));
const built = buildCatalog(sheet);
check('example sheet builds without errors or warnings', built.text !== null && built.errors.length === 0 && built.warnings.length === 0, [...built.errors, ...built.warnings].join(' | '));
const builtStripped = strip(built.text || '');
check('generated catalog is strict and balanced', (built.text || '').startsWith('--!strict') && bracketsBalanced(builtStripped) && blocksBalanced(builtStripped));
check('generated catalog has the items, colours and recipe', /\tRustyKey = \{/.test(built.text) && /Color = Color3\.fromRGB\(170, 130, 80\)/.test(built.text) && /Result = "MixedHerb"/.test(built.text) && /Droppable = false/.test(built.text));
const exported = new Set([...catalog.matchAll(/^\t(\w+) = \w+,$/gm)].map((m) => m[1]));
check('generated catalog exports what the shipped one does', [...exported].every((k) => new RegExp(`^\\t${k} = `, 'm').test(built.text)), [...exported].join(', '));
const bad = buildCatalog({
  Items: {
    'bad id': { Name: 'x', Category: 'y' },
    Gun: { Name: 'Gun', Category: 'Weapon', Size: [0, 2], Ammo: 'Missing', Color: 'red', MaxStack: 1.5 },
    Huge: { Name: 'Huge', Category: 'Weapon', Size: [12, 12], WheelGroup: 'Lasers', Tool: 'Huge' },
    NoName: { Category: 'x' },
  },
  Recipes: [{ A: 'Gun', B: 'Gun', Result: 'Nope' }],
});
const errorText = bad.errors.join('\n');
check('bad sheet is refused with every problem named', bad.text === null && ['bad id', 'Size', 'Ammo', 'Color', 'MaxStack', 'NoName.Name', 'A and B must differ', 'Result'].every((needle) => errorText.includes(needle)), errorText);
check('bad sheet warnings: oversize and unknown wheel group', bad.warnings.some((w) => w.includes('never fits')) && bad.warnings.some((w) => w.includes('Lasers')));
fs.rmSync(tmp, { recursive: true, force: true });

// --- docs --------------------------------------------------------------------------------

const skillMd = read('SKILL.md');
const refs = fs.readdirSync(path.join(SKILL, 'references')).filter((f) => f.endsWith('.md'));
const docs = skillMd + refs.map((f) => read(`references/${f}`)).join('\n');
check('SKILL.md has name and description frontmatter', /^---\nname: roblox-inventory\ndescription: .{200,}\n---\n/.test(skillMd));
check('SKILL.md stays under 500 lines', skillMd.split('\n').length < 500);
for (const rel of Object.keys(kit)) {
  check(`SKILL.md lists kit file ${rel}`, skillMd.includes(rel.replace(/^(shared|server|client)\//, '$1/')));
}
for (const s of styles) check(`docs cover style ${s.name}`, skillMd.includes(`\`${s.name}\``) && read('references/styles.md').includes(`## ${s.name}`));
for (const f of refs) check(`SKILL.md points at references/${f}`, skillMd.includes(`references/${f}`));
const pointers = [...docs.matchAll(/`((?:references|scripts|assets|tests)\/[\w./-]+)`/g)].map((m) => m[1]);
const missingDocs = [...new Set(pointers.filter((p) => !fs.existsSync(path.join(SKILL, p))))];
check(`docs point at ${new Set(pointers).size} files that exist`, missingDocs.length === 0, missingDocs.join(', '));
for (const h of handlers) check(`docs mention action ${h}`, docs.includes(`"${h}"`) || docs.includes(`\`${h}\``));
const apiDocs = read('references/architecture.md');
const publicApi = [...service.matchAll(/^function InventoryService:(\w+)/gm)].map((m) => m[1]).filter((n) => !['Init', 'Start'].includes(n));
const undocumented = publicApi.filter((n) => !apiDocs.includes(n));
check(`architecture.md documents all ${publicApi.length} InventoryService methods`, undocumented.length === 0, undocumented.join(', '));

// --- Luau tests --------------------------------------------------------------------------

const probe = spawnSync('luau', ['--help'], { encoding: 'utf8' });
if (probe.error || probe.status !== 0) {
  skipped++;
  console.log('skip InventoryCore.spec.luau (the `luau` CLI is not installed; `brew install luau` or https://github.com/luau-lang/luau/releases)');
} else {
  const run = spawnSync('luau', ['tests/InventoryCore.spec.luau'], { cwd: SKILL, encoding: 'utf8' });
  check('InventoryCore.spec.luau passes', run.status === 0 && /, 0 failed/.test(run.stdout), `${run.stdout}${run.stderr}`.trim());
}

console.log(failed ? `\n${failed} check(s) failed` : `\nall checks passed${skipped ? ` (${skipped} skipped)` : ''}`);
process.exit(failed ? 1 : 0);
