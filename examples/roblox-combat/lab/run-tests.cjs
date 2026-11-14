#!/usr/bin/env node
// Headless run of every combat lab scenario, then the parity check: each scenario's recorded
// trace is replayed through the REAL Luau modules (skills/roblox-combat/tests/Replay.luau in
// the luau CLI) and every printed number must match the JS port.
//   node run-tests.cjs [testId] [--json results.json] [--no-luau]
'use strict';
const fs = require('fs');
const path = require('path');
const { TESTS, runOne } = require('./tests.js');
const L = require(path.join(__dirname, '..', '..', '..', 'skills', 'roblox-combat', 'tests', 'run-luau.cjs'));

const args = process.argv.slice(2);
const jsonIdx = args.indexOf('--json');
const jsonOut = jsonIdx >= 0 ? args[jsonIdx + 1] : null;
const filter = args.find((a, i) => !a.startsWith('--') && i !== jsonIdx + 1);
const skipLuau = args.includes('--no-luau');

const results = [];
let failed = 0, group = null;
for (const t of TESTS) {
  if (filter && filter !== t.id) continue;
  if (t.group !== group) { group = t.group; console.log(`\n${group}`); }
  const r = runOne(t);
  if (!r.pass) failed++;
  console.log(`  ${r.pass ? 'ok  ' : 'FAIL'} ${t.title}\n         ${r.measured}\n         [want ${r.expected}]`);
  results.push(r);
}

// Parity: JS port vs the Luau kit, number by number.
let parityFail = 0;
if (skipLuau) console.log('\nParity with the Luau kit: skipped (--no-luau)');
else if (!L.luauAvailable()) console.log('\nParity with the Luau kit: skipped (luau CLI not installed: brew install luau)');
else {
  console.log('\nParity with the Luau kit (same trace replayed through the .luau modules)');
  const lines = L.replay(results.map((r) => r.trace.join('\n')).join('\n'));
  const byTest = {}; let cur = null;
  for (const l of lines) { if (l.startsWith('## ')) { cur = l.slice(3); byTest[cur] = []; } else if (cur) byTest[cur].push(l); }
  const close = (a, b) => {
    if (a === b) return true;
    const x = a.split(' '), y = b.split(' ');
    if (x.length !== y.length) return false;
    return x.every((tok, i) => tok === y[i] || (isFinite(+tok) && isFinite(+y[i]) && Math.abs(+tok - +y[i]) <= 2e-6 * Math.max(1, Math.abs(+tok))));
  };
  for (const r of results) {
    const js = r.out.slice(1), lu = byTest[r.id] || [];
    let bad = js.length !== lu.length ? Math.abs(js.length - lu.length) : 0, first = null;
    for (let i = 0; i < Math.min(js.length, lu.length); i++) if (!close(js[i], lu[i])) { bad++; if (!first) first = { i, js: js[i], lu: lu[i] }; }
    r.parity = { lines: js.length, mismatches: bad };
    if (bad) parityFail++;
    console.log(`  ${bad ? 'DIFF' : 'same'} ${r.id.padEnd(18)} ${js.length} values${bad ? ` · ${bad} differ, first at line ${first ? first.i : '?'}\n         js   ${first?.js}\n         luau ${first?.lu}` : ''}`);
  }
}

console.log(`\n${results.length - failed}/${results.length} scenarios passed${skipLuau ? '' : ` · ${results.length - parityFail}/${results.length} match the Luau kit`}`);
if (jsonOut) fs.writeFileSync(jsonOut, JSON.stringify(results.map(({ trace, out, ...r }) => r)));
process.exit(failed || parityFail ? 1 : 0);
