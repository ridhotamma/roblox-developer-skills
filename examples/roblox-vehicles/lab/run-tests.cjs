#!/usr/bin/env node
// Headless run of every lab test for every bundled spec.
//   node run-tests.cjs [SpecName] [testId] [--json results.json]
'use strict';
const fs = require('fs');
const path = require('path');
const SPECS = require('./specs.js');
const { TESTS, runOne } = require('./tests.js');
const Lab = require('./physics.js');

const args = process.argv.slice(2);
const jsonIdx = args.indexOf('--json');
const jsonOut = jsonIdx >= 0 ? args[jsonIdx + 1] : null;
const pos = args.filter((a, i) => !a.startsWith('--') && i !== jsonIdx + 1 || jsonIdx < 0 && !a.startsWith('--'));
const specFilter = pos[0], testFilter = pos[1];

const results = [];
let failed = 0;
for (const name of Object.keys(SPECS)) {
  if (specFilter && specFilter !== name) continue;
  console.log(`\n${name}`);
  for (const t of TESTS) {
    if (testFilter && testFilter !== t.id) continue;
    const r = runOne(t, name, SPECS);
    if (!r.pass) failed++;
    console.log(`  ${r.pass ? 'ok  ' : 'FAIL'} ${t.title.padEnd(52)} ${r.measured}   [want ${r.expected}]`);
    results.push(r);
  }
}

// Static checks on the Luau ports.
console.log('\nStatic');
for (const [name, s] of Object.entries(SPECS)) {
  const luau = Lab.VM.TopSpeedKmhLuau(Lab.normalize(s.raw));
  const same = Math.abs(luau - s.report.topKmh) < 0.01;
  console.log(`  ${same ? 'ok  ' : 'NOTE'} VehicleMath.TopSpeedKmh(${name}) = ${luau} vs rveh ${s.report.topKmh}`);
}

console.log(`\n${results.length - failed}/${results.length} passed`);
if (jsonOut) fs.writeFileSync(jsonOut, JSON.stringify(results));
