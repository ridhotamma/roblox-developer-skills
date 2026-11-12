#!/usr/bin/env node
// Roblox security scanner: backdoors, unsafe remotes, purchase mistakes, leaked secrets and
// other exploitable patterns in Luau source.
//
//   node scan.cjs <path> [--json] [--min info|low|medium|high|critical] [--fail-on <severity>]
//
// <path>: a folder (Rojo src tree, scanned recursively for .lua/.luau/.rbxlx/.rbxmx),
// a single .lua/.luau file, or a place/model saved as XML (.rbxlx/.rbxmx).
// Binary .rbxl/.rbxm files can't be read: save as XML first.
//
// Suppress a finding on one line with a comment:  -- scan:ignore <rule-id>
// It's a pattern scan, not a proof: read every finding and review remote handlers by hand.
// Also usable as a module: const { scanPath } = require('./scan.cjs').
'use strict';

const fs = require('fs');
const path = require('path');

const SEVERITIES = ['info', 'low', 'medium', 'high', 'critical'];
const rank = (s) => SEVERITIES.indexOf(s);

const SKIP_DIRS = new Set(['.git', 'node_modules', 'Packages', 'ServerPackages', 'DevPackages', '_Index', 'build']);
const SCRIPT_CLASSES = new Set(['Script', 'LocalScript', 'ModuleScript']);
const CLIENT_VISIBLE_SERVICES = new Set([
  'ReplicatedStorage', 'ReplicatedFirst', 'StarterGui', 'StarterPack', 'StarterPlayer', 'Workspace', 'Lighting', 'SoundService', 'Teams', 'Chat', 'TextChatService',
]);
const SERVER_SERVICES = new Set(['ServerScriptService', 'ServerStorage']);

// ---------------------------------------------------------------------------------------
// Loading units (one per script)

function decodeXml(s) {
  return s
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, d) => String.fromCharCode(Number(d)))
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCharCode(parseInt(h, 16)))
    .replace(/&amp;/g, '&');
}

function contextFromFilePath(rel) {
  const p = rel.replace(/\\/g, '/');
  if (/\.server\.luau?$/i.test(p)) return 'server';
  if (/\.client\.luau?$/i.test(p)) return 'client';
  const segs = p.split('/').map((s) => s.toLowerCase());
  const has = (re) => segs.some((s) => re.test(s));
  if (has(/^(client|shared|common|replicatedstorage|replicatedfirst|startergui|starterpack|starterplayer|starterplayerscripts|startercharacterscripts|ui|gui)$/)) return 'client-visible';
  if (has(/^(server|serverscriptservice|serverstorage|services)$/)) return 'server';
  return 'unknown';
}

function unitsFromXml(file, display) {
  const xml = fs.readFileSync(file, 'utf8');
  const units = [];
  const props = [];
  const stack = [];
  const re = /<Item\s+class="([^"]+)"[^>]*>|<\/Item>|<string name="Name">([\s\S]*?)<\/string>|<ProtectedString name="Source">([\s\S]*?)<\/ProtectedString>|<bool name="LoadStringEnabled">(true|false)<\/bool>/g;
  let m;
  while ((m = re.exec(xml))) {
    if (m[1] !== undefined) {
      stack.push({ className: m[1], name: m[1], source: null });
    } else if (m[0] === '</Item>') {
      const item = stack.pop();
      if (!item) continue;
      const chain = [...stack.map((s) => s.name), item.name];
      const top = stack.length ? stack[0].className : item.className;
      const where = `${display}:${chain.join('.')}`;
      let context = 'unknown';
      if (SERVER_SERVICES.has(top)) context = 'server';
      else if (CLIENT_VISIBLE_SERVICES.has(top)) context = item.className === 'Script' && top === 'Workspace' ? 'server' : 'client-visible';
      if (item.className === 'LocalScript') context = 'client-visible';
      if (SCRIPT_CLASSES.has(item.className) && item.source !== null) {
        units.push({ kind: 'script', where, className: item.className, context, topService: top, source: item.source });
      } else if (/^(RemoteEvent|RemoteFunction|UnreliableRemoteEvent)$/.test(item.className)) {
        units.push({ kind: 'remote', where, className: item.className, name: item.name, context, topService: top, source: '' });
      }
    } else if (m[2] !== undefined && stack.length) {
      stack[stack.length - 1].name = decodeXml(m[2]);
    } else if (m[3] !== undefined && stack.length) {
      stack[stack.length - 1].source = decodeXml(m[3]);
    } else if (m[4] !== undefined && stack.length) {
      props.push({ where: `${display}:${stack.map((s) => s.name).join('.')}`, name: 'LoadStringEnabled', value: m[4] === 'true' });
    }
  }
  return { units, props };
}

function loadPath(target) {
  const abs = path.resolve(target);
  const stat = fs.statSync(abs);
  const result = { units: [], props: [], skipped: [] };
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
      result.units.push({ kind: 'script', where: rel, className: 'Script', context: contextFromFilePath(rel), source: fs.readFileSync(f, 'utf8') });
    } else if (ext === '.rbxlx' || ext === '.rbxmx') {
      const x = unitsFromXml(f, rel);
      result.units.push(...x.units);
      result.props.push(...x.props);
    } else if (ext === '.rbxl' || ext === '.rbxm') {
      result.skipped.push(`${rel} (binary format: save as .rbxlx / .rbxmx to scan)`);
    }
  }
  return result;
}

// ---------------------------------------------------------------------------------------
// Source helpers

// Replace comments with spaces (keeping newlines) so line numbers stay correct.
function stripComments(src) {
  return src
    .replace(/--\[(=*)\[[\s\S]*?\]\1\]/g, (c) => c.replace(/[^\n]/g, ' '))
    .replace(/--[^\n]*/g, (c) => ' '.repeat(c.length));
}

function lineOf(src, index) {
  let n = 1;
  for (let i = 0; i < index && i < src.length; i++) if (src.charCodeAt(i) === 10) n++;
  return n;
}

function indentOf(line) {
  return (line.match(/^\s*/) || [''])[0].length;
}

// Lines of a `function(...) ... end)` block starting at lineIdx (0-based), capped.
function blockFrom(lines, lineIdx, cap = 60) {
  const base = indentOf(lines[lineIdx]);
  const out = [];
  for (let i = lineIdx + 1; i < lines.length && out.length < cap; i++) {
    const l = lines[i];
    if (/^\s*end\b/.test(l) && indentOf(l) <= base) break;
    out.push(l);
  }
  return out.join('\n');
}

function snippet(line) {
  const t = line.trim();
  return t.length > 140 ? `${t.slice(0, 137)}...` : t;
}

// ---------------------------------------------------------------------------------------
// Rules. Line rules: { id, severity, title, fix, re, when?(unit) }.

const OUTCOME_NAME = /\b\w*(Give|Add|Set|Grant|Award|Increase|Change|Update)_?(Cash|Coins?|Money|Gems?|Gold|Stats?|Level|XP|Exp|Points?|Currency|Items?|Damage|Health|Admin|Rank)\w*|\b\w*(DealDamage|DoDamage|DamagePlayer|KillPlayer|TakeDamageRemote)\w*/i;
const CLIENT_PARAM = /^(amount|amt|price|cost|damage|dmg|reward|coins?|cash|money|gems?|value|health|hp|xp|exp|level|points?|speed|multiplier)$/i;
const REWARD_WORDS = /\b(Coins?|Cash|Money|Gems?|Points?|Reward|leaderstats|Currency|XP|Exp)\b|:(Add|Give|Award|Increment)\w*\(|\.Value\s*[+]=|\.Value\s*=\s*[^=].*\+/;
const DISTANCE_WORDS = /Magnitude|Near\s*\(|DistanceFromCharacter|GetPartBoundsIn|GetPartsInPart|Distance\b|Raycast/;
const VALIDATION_WORDS = /\btypeof\s*\(|\btype\s*\(|Validate\.|\bt\.\w+\s*\(|\bassert\s*\(|\bguard\w*\s*\(|tonumber\s*\(|:IsA\s*\(/;

const LINE_RULES = [
  {
    id: 'require-asset-id', severity: 'critical',
    title: 'require() of an asset id: loads code the asset owner can change at any time (classic backdoor)',
    fix: 'Remove it. Use only modules in your own place or Wally packages from known authors.',
    re: /\brequire\s*\(\s*(\(?\s*\d{5,}|0x[0-9a-f]+|tonumber\s*\(|[^)]*\b(reverse|char|sub|gsub|rep)\s*\()/i,
  },
  {
    id: 'env-manipulation', severity: 'critical',
    title: 'getfenv/setfenv: used by obfuscated loaders and backdoors to hide what they call',
    fix: 'Remove the script unless you wrote it and understand why it needs environment access.',
    re: /\b(getfenv|setfenv)\s*\(/,
  },
  {
    id: 'loadstring', severity: 'critical',
    title: 'loadstring(): runs code from a string (backdoors pair it with HTTP or remotes)',
    fix: 'Remove it and keep ServerScriptService.LoadStringEnabled off.',
    re: /\bloadstring\s*\(/,
  },
  {
    id: 'obfuscated-string', severity: 'critical',
    title: 'Long escape-encoded string or string.char chain: typical of obfuscated backdoors',
    fix: 'Decode it to see what it does; delete the script if you did not write it.',
    re: /(\\\d{1,3}){20,}|(\\x[0-9a-fA-F]{2}){20,}|string\.char\s*\(\s*(\d+\s*,\s*){12,}/,
  },
  {
    id: 'insert-service-load', severity: 'medium',
    title: 'InsertService:LoadAsset at runtime: inserts assets (and their scripts) from the library',
    fix: 'Only load assets you own; never load an id that comes from a client or from HTTP.',
    re: /:LoadAsset(Version)?\s*\(/,
  },
  {
    id: 'invoke-client', severity: 'high',
    title: 'Server calls InvokeClient: a client can hang the server thread forever or error it',
    fix: 'Use RemoteEvents in both directions.',
    re: /:InvokeClient\s*\(/,
  },
  {
    id: 'product-purchase-finished', severity: 'high',
    title: 'PromptProductPurchaseFinished used: developer products must be granted only in ProcessReceipt',
    fix: 'Grant in MarketplaceService.ProcessReceipt, idempotently by PurchaseId; use this event only for UI.',
    re: /PromptProductPurchaseFinished/,
  },
  {
    id: 'outcome-remote', severity: 'high',
    title: 'Remote named after an outcome: suggests the client decides amounts, stats or damage',
    fix: 'Make remotes requests ("Buy", "Swing") and compute the result on the server from its own data.',
    re: OUTCOME_NAME,
    when: (u, line) => /FireServer|InvokeServer|OnServerEvent|OnServerInvoke|RemoteEvent|RemoteFunction|WaitForChild|FindFirstChild|Net\.\w+\s*\(|=\s*"(Event|Function|Unreliable)"/.test(line),
  },
  {
    id: 'webhook-or-key', severity: 'high',
    title: 'Webhook URL or API key in code',
    fix: 'Move it to Creator Hub secrets and read it on the server with HttpService:GetSecret; rotate the leaked one.',
    re: /discord(app)?\.com\/api\/webhooks\/|\b(api[_-]?key|secret|token|webhook)\w*\s*=\s*["'][A-Za-z0-9_\-.:/]{16,}["']/i,
  },
  {
    id: 'server-api-in-client', severity: 'high',
    title: 'Server-only API in a client-visible script: exploiters can read this logic',
    fix: 'Move server logic to ServerScriptService / ServerStorage; clients only get what they need to display.',
    re: /DataStoreService|MessagingService|:BanAsync\s*\(|:GetSecret\s*\(|ProcessReceipt|ServerStorage|ServerScriptService/,
    when: (u) => u.context === 'client-visible',
  },
  {
    id: 'global-state', severity: 'low',
    title: '_G / shared global state: any script can read and overwrite it',
    fix: 'Use module returns instead.',
    re: /\b_G\s*[.[]|\bshared\s*[.[]/,
  },
];

function runLineRules(unit, findings) {
  const raw = unit.source.split('\n');
  const code = stripComments(unit.source).split('\n');
  code.forEach((line, i) => {
    for (const rule of LINE_RULES) {
      if (!rule.re.test(line)) continue;
      if (rule.when && !rule.when(unit, line)) continue;
      if (new RegExp(`scan:ignore\\b[^\\n]*\\b${rule.id}\\b`).test(raw[i])) continue;
      findings.push({ rule: rule.id, severity: rule.severity, title: rule.title, fix: rule.fix, where: unit.where, line: i + 1, snippet: snippet(raw[i]) });
    }
    if (line.length > 3000 && !/scan:ignore/.test(raw[i])) {
      findings.push({ rule: 'very-long-line', severity: 'high', title: `Line of ${line.length} characters: common in obfuscated or packed backdoors`, fix: 'Inspect the line; legitimate code is rarely written this way.', where: unit.where, line: i + 1, snippet: snippet(raw[i]) });
    }
  });
}

function ignored(rawLine, id) {
  return new RegExp(`scan:ignore\\b[^\\n]*\\b${id}\\b`).test(rawLine);
}

// Block rules that look at a handler and its body.
function runBlockRules(unit, findings) {
  if (unit.context === 'client-visible' && unit.className === 'LocalScript') return;
  const raw = unit.source.split('\n');
  const lines = stripComments(unit.source).split('\n');
  lines.forEach((line, i) => {
    // Remote handlers: OnServerEvent:Connect(function(player, ...)), OnServerInvoke = function(...), Net.Handle("X", n, function(...)
    const h = line.match(/(OnServerEvent\s*:\s*Connect\s*\(\s*function|OnServerInvoke\s*=\s*function|\.Handle\s*\(\s*["'][^"']+["']\s*,[^,]*,\s*function)\s*\(([^)]*)\)/);
    if (h) {
      const params = h[2].split(',').map((p) => p.trim().replace(/:.*$/, '').trim()).filter(Boolean);
      const args = params.slice(1);
      const body = blockFrom(lines, i);
      const clientParams = args.filter((p) => CLIENT_PARAM.test(p));
      if (clientParams.length && !ignored(raw[i], 'client-sent-amount')) {
        findings.push({ rule: 'client-sent-amount', severity: 'high', title: `Remote handler takes ${clientParams.join(', ')} from the client`, fix: 'Never accept amounts, prices, damage or stats from the client; look them up on the server.', where: unit.where, line: i + 1, snippet: snippet(raw[i]) });
      }
      // A pure vararg pass-through (a wrapper forwarding `...` to another function) is not a handler.
      const forwardsOnly = args.length === 1 && args[0] === '...' && /\(\s*[^)]*\.\.\.\s*\)/.test(body);
      if (args.length && !forwardsOnly && !VALIDATION_WORDS.test(body) && !ignored(raw[i], 'unvalidated-handler')) {
        findings.push({ rule: 'unvalidated-handler', severity: 'medium', title: 'Remote handler uses client arguments with no visible type checks', fix: 'Check typeof, ranges (reject NaN/inf), lengths and allow-lists for every argument (see Validate).', where: unit.where, line: i + 1, snippet: snippet(raw[i]) });
      }
    }

    // Client-triggered world interactions that hand out rewards.
    const t =
      line.match(/\.(Touched|Triggered|MouseClick|PromptTriggered)\s*:\s*Connect\s*\(\s*function/) ||
      line.match(/Connect\s*\(\s*[\w.:]+\.(Touched|Triggered|MouseClick|PromptTriggered)\s*,\s*function/); // trove:Connect(part.Touched, function
    if (t && unit.context !== 'client-visible') {
      const body = blockFrom(lines, i);
      if (REWARD_WORDS.test(body) && !DISTANCE_WORDS.test(body) && !ignored(raw[i], 'interaction-no-distance')) {
        findings.push({ rule: 'interaction-no-distance', severity: 'medium', title: `${t[1]} handler grants something without a distance check (exploits fire it from anywhere)`, fix: "Check the player's character is within range of the part on the server before rewarding.", where: unit.where, line: i + 1, snippet: snippet(raw[i]) });
      }
    }
  });
}

function runFileRules(unit, findings) {
  const code = stripComments(unit.source);
  const m = code.match(/\.ProcessReceipt\s*=/);
  if (m && !/PurchaseId/.test(code)) {
    findings.push({ rule: 'receipt-not-idempotent', severity: 'high', title: 'ProcessReceipt without a PurchaseId check: retries can grant twice', fix: "Record receiptInfo.PurchaseId in the player's session-locked data and skip ones already granted.", where: unit.where, line: lineOf(code, m.index), snippet: snippet(unit.source.split('\n')[lineOf(code, m.index) - 1]) });
  }
  const http = [...code.matchAll(/https?:\/\/([a-z0-9.-]+)/gi)].map((x) => x[1].toLowerCase());
  if (http.length && /HttpService|RequestAsync|GetAsync|PostAsync/.test(code)) {
    findings.push({ rule: 'http-domains', severity: 'info', title: `Calls external domains: ${[...new Set(http)].join(', ')}`, fix: 'Make sure you know and trust every domain the game talks to.', where: unit.where, line: lineOf(code, code.search(/https?:\/\//)), snippet: '' });
  }
}

function runProjectRules(loaded, findings) {
  const receipts = loaded.units.filter((u) => u.kind === 'script' && /\.ProcessReceipt\s*=/.test(stripComments(u.source)));
  if (receipts.length > 1) {
    findings.push({ rule: 'multiple-process-receipt', severity: 'high', title: `ProcessReceipt is assigned in ${receipts.length} scripts: only the last one runs, purchases handled by the others are lost`, fix: 'Have exactly one PurchaseService that handles every product.', where: receipts.map((u) => u.where).join(', '), line: 0, snippet: '' });
  }
  for (const p of loaded.props) {
    if (p.name === 'LoadStringEnabled' && p.value) {
      findings.push({ rule: 'loadstring-enabled', severity: 'critical', title: 'ServerScriptService.LoadStringEnabled is on', fix: 'Turn it off unless you have a reviewed reason; backdoors rely on it.', where: p.where, line: 0, snippet: '' });
    }
  }
  for (const u of loaded.units) {
    if (u.kind === 'remote' && OUTCOME_NAME.test(u.name)) {
      findings.push({ rule: 'outcome-remote', severity: 'high', title: `${u.className} "${u.name}" is named after an outcome: suggests the client decides it`, fix: 'Make remotes requests and compute the result on the server.', where: u.where, line: 0, snippet: '' });
    }
  }
  const wsScripts = loaded.units.filter((u) => u.kind === 'script' && u.topService === 'Workspace' && u.className !== 'ModuleScript');
  for (const u of wsScripts) {
    const name = u.where.split('.').pop();
    if (/vaccine|virus|infect|spread|anti.?lag|backdoor/i.test(name)) {
      findings.push({ rule: 'suspicious-script-name', severity: 'medium', title: `Script named "${name}" in Workspace: a common free-model virus name`, fix: 'Read it; delete it if it is not yours.', where: u.where, line: 0, snippet: '' });
    }
  }
  if (wsScripts.length) {
    const sample = wsScripts.slice(0, 15).map((u) => u.where.split(':').pop()).join('\n      ');
    findings.push({ rule: 'workspace-scripts', severity: 'info', title: `${wsScripts.length} Script(s)/LocalScript(s) inside Workspace (where free-model backdoors hide; consider tags + components)`, fix: `Review each one:\n      ${sample}${wsScripts.length > 15 ? '\n      ...' : ''}`, where: 'Workspace', line: 0, snippet: '' });
  }
}

function scanPath(target) {
  const loaded = loadPath(target);
  const findings = [];
  for (const unit of loaded.units) {
    if (unit.kind !== 'script') continue;
    runLineRules(unit, findings);
    runBlockRules(unit, findings);
    runFileRules(unit, findings);
  }
  runProjectRules(loaded, findings);
  findings.sort((a, b) => rank(b.severity) - rank(a.severity) || a.where.localeCompare(b.where) || a.line - b.line);
  return { findings, scripts: loaded.units.filter((u) => u.kind === 'script').length, skipped: loaded.skipped };
}

// ---------------------------------------------------------------------------------------
// CLI

function main() {
  const argv = process.argv.slice(2);
  let target = null;
  let json = false;
  let min = 'info';
  let failOn = null;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--json') json = true;
    else if (a === '--min') min = argv[++i];
    else if (a === '--fail-on') failOn = argv[++i];
    else if (a === '-h' || a === '--help') {
      console.log('usage: node scan.cjs <path> [--json] [--min info|low|medium|high|critical] [--fail-on <severity>]');
      process.exit(0);
    } else target = a;
  }
  if (!target) {
    console.error('scan: give a folder, .lua/.luau file or .rbxlx/.rbxmx file');
    process.exit(2);
  }
  if (rank(min) < 0 || (failOn && rank(failOn) < 0)) {
    console.error(`scan: severities are ${SEVERITIES.join(', ')}`);
    process.exit(2);
  }
  if (!fs.existsSync(target)) {
    console.error(`scan: ${target} does not exist`);
    process.exit(2);
  }

  const result = scanPath(target);
  const shown = result.findings.filter((f) => rank(f.severity) >= rank(min));
  if (json) {
    console.log(JSON.stringify({ ...result, findings: shown }, null, 2));
  } else {
    console.log(`Scanned ${result.scripts} script(s) in ${target}`);
    for (const s of result.skipped) console.log(`  skipped ${s}`);
    const counts = SEVERITIES.slice().reverse().map((s) => `${s}: ${result.findings.filter((f) => f.severity === s).length}`).join('  ');
    console.log(`  ${counts}\n`);
    for (const f of shown) {
      const loc = f.line ? `${f.where}:${f.line}` : f.where;
      console.log(`[${f.severity.toUpperCase()}] ${f.rule}  ${loc}`);
      console.log(`  ${f.title}`);
      if (f.snippet) console.log(`  > ${f.snippet}`);
      console.log(`  fix: ${f.fix}\n`);
    }
    if (!shown.length) console.log('No findings at this level. This does not prove the game is secure: review remote handlers and money paths by hand.');
  }
  if (failOn && result.findings.some((f) => rank(f.severity) >= rank(failOn))) process.exit(1);
}

if (require.main === module) main();

module.exports = { scanPath, stripComments, contextFromFilePath };
