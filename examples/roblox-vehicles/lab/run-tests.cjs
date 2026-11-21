#!/usr/bin/env node
// Headless run of every lab test for every bundled spec: the car tests (tests.js) for cars, the
// motorcycle, boat, plane and helicopter tests (tests-airsea.js) and the tank and train tests
// (tests-heavy.js) for those types.
//   node run-tests.cjs [SpecName] [testId] [--json results.json]
'use strict';
const fs = require('fs');
const SPECS = require('./specs.js');
const { TESTS, runOne } = require('./tests.js');
const AS = require('./tests-airsea.js');
const HV = require('./tests-heavy.js');
const Lab = require('./physics.js');

const args = process.argv.slice(2);
const jsonIdx = args.indexOf('--json');
const jsonOut = jsonIdx >= 0 ? args[jsonIdx + 1] : null;
const pos = args.filter((a, i) => !a.startsWith('--') && !(jsonIdx >= 0 && i === jsonIdx + 1));
const specFilter = pos[0], testFilter = pos[1];

const results = [];
let failed = 0;
for (const name of Object.keys(SPECS)) {
  if (specFilter && specFilter !== name) continue;
  const type = SPECS[name].type || 'Car';
  console.log(`\n${name} [${type}]`);
  const suite = type === 'Car' ? null : type === 'Tank' || type === 'Train' ? HV : AS;
  const list = suite ? suite.TESTS.filter((t) => t.type === type) : TESTS;
  for (const t of list) {
    if (testFilter && testFilter !== t.id) continue;
    const r = suite ? suite.runOne(t, name, SPECS) : runOne(t, name, SPECS);
    if (!r.pass) failed++;
    console.log(`  ${r.pass ? 'ok  ' : 'FAIL'} ${t.title.padEnd(66)} ${r.measured}   [want ${r.expected}]`);
    results.push(r);
  }
}

// Static checks on the Luau ports.
if (!specFilter) {
  console.log('\nStatic');
  for (const [name, s] of Object.entries(SPECS)) {
    if ((s.type || 'Car') !== 'Car') continue;
    const luau = Lab.VM.TopSpeedKmhLuau(Lab.normalize(s.raw));
    const same = Math.abs(luau - s.report.topKmh) < 0.01;
    console.log(`  ${same ? 'ok  ' : 'NOTE'} VehicleMath.TopSpeedKmh(${name}) = ${luau} vs rveh ${s.report.topKmh}`);
  }
}

console.log(`\n${results.length - failed}/${results.length} passed`);
if (jsonOut) fs.writeFileSync(jsonOut, JSON.stringify(results));
process.exitCode = failed ? 1 : 0;
