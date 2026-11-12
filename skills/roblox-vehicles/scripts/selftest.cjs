#!/usr/bin/env node
// Checks rveh.cjs: maths, spec validation, the bundled specs' real-world numbers, and that the
// kit's VehicleSpecs.luau matches the specs folder. Run after editing the tool or the specs.
'use strict';

const fs = require('fs');
const path = require('path');
const R = require('./rveh.cjs');

let failed = 0;
const check = (name, cond, extra = '') => {
  console.log(`${cond ? 'ok  ' : 'FAIL'} ${name}${cond ? '' : `  ${extra}`}`);
  if (!cond) failed++;
};
const near = (a, b, tol) => Math.abs(a - b) <= tol;

// Torque curve interpolation.
const curve = [[1000, 100], [3000, 200], [5000, 150]];
check('torque below first point', R.torqueAt(curve, 500, 6000) === 100);
check('torque interpolates', R.torqueAt(curve, 2000, 6000) === 150);
check('torque past last point holds', R.torqueAt(curve, 5500, 6000) === 150);
check('torque zero past redline', R.torqueAt(curve, 6100, 6000) === 0);

// Gearing: rpm = v / r * gear * final * 60 / 2pi.
const base = R.normalize({ name: 'T', wheelRadius: 0.3, gearbox: { ratios: [3, 2, 1], finalDrive: 4, shiftUpRpm: 6000, shiftDownRpm: 2500 } });
check('engine rpm', near(R.engineRpm(base, 10, 1), (10 / 0.3) * 4 * (60 / (2 * Math.PI)), 1e-6));
const launch = R.driveForce(base, 0, 0, 1);
check('launch rpm used from standstill in 1st', launch.rpm === base.engine.launchRpm);
check('no drive at zero throttle', R.driveForce(base, 10, 0, 0).force === 0);

// Speed limiter.
const limited = R.normalize({ name: 'L', engine: { speedLimitKmh: 100 } });
check('limiter cuts drive at the limit', R.driveForce(limited, 100 / 3.6, 2, 1).force === 0);
check('top speed reports the limiter', R.topSpeed(limited).limiter === 'speed limiter');

// Drag grows with v^2.
check('drag quadratic', near(R.dragForce(base, 20) / R.dragForce(base, 10), 4, 1e-9));

// Validation.
const bad = (spec, msg) => { try { R.normalize(spec); return false; } catch (e) { return e.message.includes(msg); } };
check('rejects bad name', bad({ name: '1x' }, 'identifier'));
check('rejects increasing gear ratios', bad({ name: 'X', gearbox: { ratios: [1, 2] } }, 'must decrease'));
check('rejects unknown drivetrain', bad({ name: 'X', drivetrain: '4WD' }, 'FWD, RWD or AWD'));
check('rejects unsorted torque curve', bad({ name: 'X', engine: { torqueCurve: [[3000, 100], [1000, 90]] } }, 'must increase'));

// Bundled specs land in realistic ranges for their class.
const specsDir = path.join(__dirname, '..', 'specs');
const specs = fs.readdirSync(specsDir).filter((f) => f.endsWith('.json')).map((f) => R.normalize(JSON.parse(fs.readFileSync(path.join(specsDir, f), 'utf8'))));
const byName = Object.fromEntries(specs.map((s) => [s.name, R.report(s)]));
const expect = {
  Hatchback: { t100: [8.5, 12], top: [175, 210], brake: [36, 46] },
  SportsCar: { t100: [3.5, 5], top: [270, 300], brake: [30, 38] },
  PickupTruck: { t100: [5.5, 8.5], top: [160, 200], brake: [40, 50] },
  Kart: { t60kmh: [3, 6.5], top: [70, 100], brake: [25, 40] },
};
for (const [name, e] of Object.entries(expect)) {
  const r = byName[name];
  if (!r) { check(`${name} spec present`, false); continue; }
  if (e.t100) check(`${name} 0-100 in ${e.t100.join('-')} s`, r.launch.t100 >= e.t100[0] && r.launch.t100 <= e.t100[1], r.launch.t100);
  if (e.t60kmh) check(`${name} 0-60 km/h in ${e.t60kmh.join('-')} s`, r.launch.t60kmh >= e.t60kmh[0] && r.launch.t60kmh <= e.t60kmh[1], r.launch.t60kmh);
  check(`${name} top speed ${e.top.join('-')} km/h`, r.top.kmh >= e.top[0] && r.top.kmh <= e.top[1], r.top.kmh);
  check(`${name} 100-0 in ${e.brake.join('-')} m`, r.brake.meters >= e.brake[0] && r.brake.meters <= e.brake[1], r.brake.meters);
  check(`${name} has no warnings`, r.warnings.length === 0, r.warnings.join(' | '));
}

// Kit's generated VehicleSpecs.luau is in sync with the specs folder.
const kitFile = path.join(__dirname, '..', 'assets', 'kit', 'shared', 'Vehicle', 'VehicleSpecs.luau');
const fresh = R.toLuau(specs);
check('kit VehicleSpecs.luau matches specs/ (re-run: node rveh.cjs luau specs --out ...)', fs.readFileSync(kitFile, 'utf8') === fresh);
check('luau export has every spec', specs.every((s) => fresh.includes(`\t${s.name} = table.freeze({`)));
check('luau export keys are PascalCase', fresh.includes('FrequencyFront') && fresh.includes('TorqueCurve') && !fresh.includes('frequencyFront'));

console.log(failed ? `\n${failed} check(s) failed` : '\nall checks passed');
process.exit(failed ? 1 : 0);
