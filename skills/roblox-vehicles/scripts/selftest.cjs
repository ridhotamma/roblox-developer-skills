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

// Braking with load transfer: a rear-biased car locks its rears and stops shorter of decelG.
const rearBiased = R.normalize({ name: 'B', brakes: { decelG: 1.1, frontBias: 0.4 } });
const balanced = R.normalize({ name: 'C', brakes: { decelG: 1.1, frontBias: 0.73 } });
check('rear-biased brakes lock and lose decel', R.braking(rearBiased).rearLocked && R.braking(rearBiased).decelG < 0.95);
check('balanced brakes reach decelG', near(R.braking(balanced).decelG, 1.0, 0.02) || R.braking(balanced).decelG >= 0.98);
check('warns on brake bias that locks an axle', R.report(rearBiased).warnings.some((w) => w.includes('brakes lock')));

// Validation.
const bad = (spec, msg) => { try { R.normalize(spec); return false; } catch (e) { return e.message.includes(msg); } };
check('rejects bad name', bad({ name: '1x' }, 'identifier'));
check('rejects increasing gear ratios', bad({ name: 'X', gearbox: { ratios: [1, 2] } }, 'must decrease'));
check('rejects unknown drivetrain', bad({ name: 'X', drivetrain: '4WD' }, 'FWD, RWD or AWD'));
check('rejects unsorted torque curve', bad({ name: 'X', engine: { torqueCurve: [[3000, 100], [1000, 90]] } }, 'must increase'));
check('rejects slideGrip out of range', bad({ name: 'X', tires: { slideGrip: 1.5 } }, 'slideGrip'));
check('warns when the auto hull is off', R.report(R.normalize({ name: 'H', body: { autoHull: false } })).warnings.some((w) => w.includes('autoHull')));
check('warns on grabby hull friction', R.report(R.normalize({ name: 'F', body: { hullFriction: 0.6 } })).warnings.some((w) => w.includes('hullFriction')));

// Bundled specs land in realistic ranges for their class.
const specsDir = path.join(__dirname, '..', 'specs');
const specs = fs.readdirSync(specsDir).filter((f) => f.endsWith('.json')).sort().map((f) => R.normalize(JSON.parse(fs.readFileSync(path.join(specsDir, f), 'utf8'))));
const byName = Object.fromEntries(specs.map((s) => [s.name, R.report(s)]));
const expect = {
  Hatchback: { t100: [8.5, 12], top: [175, 210], brake: [36, 46] },
  SportsCar: { t100: [3.5, 5], top: [270, 300], brake: [30, 38] },
  PickupTruck: { t100: [5.5, 8.5], top: [160, 200], brake: [40, 50] },
  Kart: { t60kmh: [3, 6.5], top: [70, 100], brake: [25, 40] },
  DriftCar: { t100: [4, 6], top: [230, 270], brake: [32, 40] },
  ArcadeCar: { t100: [3.5, 5], top: [230, 250], brake: [28, 36] },
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

// ---------------------------------------------------------------------------------- other types
const C = require('./types/common.cjs');
const { Motorcycle: MB, Boat: BT, Plane: PL, Helicopter: HE, Tank: TK, Train: TN } = R.TYPES;

// Momentum theory: static thrust (2 rho A P^2)^(1/3); at speed thrust -> P / V.
const A1 = Math.PI * 0.5 ** 2;
check('disk thrust static matches (2 rho A P^2)^(1/3)', near(C.diskThrust(50000, 1.225, A1, 0, 1), Math.cbrt(2 * 1.225 * A1 * 50000 ** 2), 2));
check('disk thrust at speed tends to P / V', near(C.diskThrust(50000, 1.225, 50, 100, 1) * 100, 50000, 600));
check('induced velocity in hover sqrt(T / 2 rho A)', near(C.inducedVelocity(1000, 1.225, A1, 0), Math.sqrt(1000 / (2 * 1.225 * A1)), 1e-9));

// Motorcycle: wheelie and stoppie limits from geometry.
const bike = R.normalize({ name: 'B', type: 'Motorcycle', wheelbase: 1.4, frontWeight: 0.5, comHeight: 0.7 });
check('wheelie limit = g b / h', near(MB.wheelieG(bike), 0.7 / 0.7, 1e-9));
check('report flags a bike that wheelies at the slightest throttle', MB.report(R.normalize({ name: 'W', type: 'Motorcycle', comHeight: 1.4 })).warnings.some((w) => w.includes('wheelie limit')));

// Boat: floats at the draft the spec implies; displacement hulls are held near hull speed.
const boat = R.normalize({ name: 'S', type: 'Boat', mass: 2000, hull: { length: 6, beam: 2.5, blockCoefficient: 0.4, waterDensity: 1025 } });
check('boat draft = mass / (rho L B Cb)', near(BT.draft(boat), 2000 / 1025 / (6 * 2.5 * 0.4), 1e-9));
check('planing lift lifts the hull at speed', BT.steadyImmersion(boat, 15) < 0.4 && BT.steadyImmersion(boat, 0) === 1);
check('wave resistance peaks near Fn 0.56 for planing hulls', BT.waveBump(boat, 0.56) > BT.waveBump(boat, 0.4) && BT.waveBump(boat, 0.56) > BT.waveBump(boat, 1.0));

// Plane: lift slope from aspect ratio, stall speed from C_Lmax.
const plane = R.normalize({ name: 'P', type: 'Plane', wing: { area: 16, span: 12 } });
check('lift slope 2 pi AR / (AR + 2)', near(PL.liftSlope(plane), (2 * Math.PI * 9) / 11, 1e-9));
check('stall speed sqrt(2 W / (rho S C_Lmax))', near(PL.stallSpeed(plane, 0), Math.sqrt((2 * plane.mass * 9.81) / (1.225 * 16 * plane.wing.clMax)), 1e-9));
check('lift collapses past the stall', PL.liftCoefficient(plane, PL.stallAlpha(plane, 0) + 0.25, 0) < plane.wing.clMax * 0.8);

// Helicopter: Glauert inflow falls with forward speed (translational lift); ground effect helps.
const heli = R.normalize({ name: 'H', type: 'Helicopter' });
const W = heli.mass * 9.81;
check('forward flight needs less induced power (translational lift)', HE.powerRequired(heli, W, 1.225, 25, 0) < HE.powerRequired(heli, W, 1.225, 0, 0));
check('ground effect adds thrust near the ground', HE.groundEffect(heli, 3) > 1.1 && near(HE.groundEffect(heli, 100), 1, 0.01));

// Tank: ground pressure W / (2 L b), skid-steer moment mu W L / 4, the tractive-effort hyperbola.
const tank = R.normalize({ name: 'T', type: 'Tank' });
check('tank ground pressure = W / (2 L b)', near(TK.groundPressure(tank), (tank.mass * 9.81) / (2 * tank.tracks.contactLength * tank.tracks.width), 1e-9));
check('skid-steer turning moment = mu_t W L / 4', near(TK.turningMoment(tank), (tank.tracks.lateralGrip * tank.mass * 9.81 * tank.tracks.contactLength) / 4, 1e-9));
check('tank tractive effort is power-limited at speed (eta P / v)', near(TK.tractiveEffort(tank, 15), (tank.engine.efficiency * tank.engine.power * 1000) / 15, 1e-6));
check('tank tractive effort is traction-limited from a standstill', near(TK.tractiveEffort(tank, 0), tank.engine.maxTractiveG * tank.mass * 9.81, 1e-6));
check('warns on a long hull that fights every turn (L/B > 1.8)', TK.report(R.normalize({ name: 'L', type: 'Tank', tracks: { contactLength: 6, tread: 2.5 } })).warnings.some((w) => w.includes('steering ratio')));

// Train: Rockl curve resistance, derailment speed, tractive effort limits, ruling grade.
const train = R.normalize({ name: 'N', type: 'Train' });
check('Rockl curve resistance 650 / (R - 55) N/kN above 300 m', near(TN.curveResistance(400), 650 / 345 / 1000, 1e-12));
check('Rockl curve resistance 500 / (R - 30) N/kN below 300 m', near(TN.curveResistance(200), 500 / 170 / 1000, 1e-12) && TN.curveResistance(Infinity) === 0);
check('derailment speed sqrt(a_lat R)', near(TN.derailSpeedKmh(train, 300), Math.sqrt(train.derail.lateralG * 9.81 * 300) * 3.6, 1e-9));
check('train tractive effort = min(start, adhesion, eta P / v)', near(TN.tractiveEffort(train, 0.1), Math.min(train.engine.startingTractiveEffort * 1000, train.engine.adhesion * train.mass * 9.81), 1e-6) && near(TN.tractiveEffort(train, 40), (train.engine.efficiency * train.engine.power * 1000) / 40, 1e-6));
check('no tractive effort past the speed limit', TN.tractiveEffort(train, (train.engine.speedLimitKmh + 1) / 3.6) === 0);
check('warns on wheelslip when starting effort is past adhesion', TN.report(R.normalize({ name: 'W', type: 'Train', engine: { startingTractiveEffort: 600 } })).warnings.some((w) => w.includes('wheelslip')));

// Validation for the new types.
check('rejects an unknown type', bad({ name: 'X', type: 'Submarine' }, 'type must be'));
check('rejects a boat drive type', bad({ name: 'X', type: 'Boat', drive: { type: 'sail' } }, 'outboard, inboard or jet'));
check('rejects a hull that sinks', bad({ name: 'X', type: 'Boat', mass: 50000 }, 'sinks'));
check('rejects a jet without thrust', bad({ name: 'X', type: 'Plane', engine: { type: 'jet', thrust: 0 } }, 'needs engine.thrust'));
check('rejects a tank with fewer than 3 track contacts', bad({ name: 'X', type: 'Tank', tracks: { contacts: 2 } }, 'tracks.contacts'));
check('rejects gun elevation limits the wrong way round', bad({ name: 'X', type: 'Tank', turret: { minElevation: 10, maxElevation: 5 } }, 'minElevation'));
check('rejects bogies wider apart than the vehicle', bad({ name: 'X', type: 'Train', length: 10, bogieSpacing: 12 }, 'bogieSpacing'));
check('rejects an emergency brake weaker than service', bad({ name: 'X', type: 'Train', brakes: { service: 1, emergency: 0.5 } }, 'emergency'));
check('warns when a helicopter cannot hover', HE.report(R.normalize({ name: 'X', type: 'Helicopter', engine: { power: 100 } })).warnings.some((w) => w.includes("can't hover")));

// Bundled specs of the new types land in real-world ranges.
const expectOther = {
  SportBike: (r) => [['0-100 2.6-3.4 s', r.launch.t100, 2.6, 3.4], ['top 290-300 km/h', r.top.kmh, 290, 300], ['100-0 30-42 m', r.brake.meters, 30, 42], ['wheelie limit 1.0-1.25 g', r.wheelieG, 1.0, 1.25]],
  DirtBike: (r) => [['0-100 3-4.5 s', r.launch.t100, 3, 4.5], ['top 140-175 km/h', r.top.kmh, 140, 175], ['100-0 38-52 m', r.brake.meters, 38, 52]],
  Speedboat: (r) => [['top 80-100 km/h', r.top.kmh, 80, 100], ['0-50 km/h 3-7 s', r.launch.t50, 3, 7], ['hump R/W 0.08-0.2', r.humpRW, 0.08, 0.2]],
  JetSki: (r) => [['top 100-110 km/h', r.top.kmh, 100, 110], ['0-50 km/h 1-2.5 s', r.launch.t50, 1, 2.5]],
  FishingBoat: (r) => [['top 14-20 km/h (hull speed)', r.top.kmh, 14, 20], ['draft 0.3-0.8 m', r.draft, 0.3, 0.8]],
  LightPlane: (r) => [['stall 90-105 km/h', r.stallKmh, 90, 105], ['top 220-240 km/h', r.top.kmh, 220, 240], ['climb 3-4.5 m/s', r.climb.rate, 3, 4.5], ['takeoff roll 200-330 m', r.takeoff.meters, 200, 330]],
  JetFighter: (r) => [['stall 215-260 km/h', r.stallKmh, 215, 260], ['afterburner top 1300-1500 km/h', r.topAb.kmh, 1300, 1500], ['afterburner climb 200-300 m/s', r.climbAb.rate, 200, 300]],
  LightHeli: (r) => [['top 190-230 km/h', r.top.kmh, 190, 230], ['vertical climb 4-8 m/s', r.verticalClimb, 4, 8], ['hover margin 10-40%', r.margin, 0.1, 0.4]],
  AttackHeli: (r) => [['top 270-310 km/h', r.top.kmh, 270, 310], ['vertical climb 8-14 m/s', r.verticalClimb, 8, 14]],
  MainBattleTank: (r) => [['0-32 km/h 6-8 s', r.launch.t32, 6, 8], ['top 65-72 km/h', r.top.kmh, 65, 72], ['ground pressure 95-115 kPa', r.groundPressure / 1000, 95, 115], ['climbs a 60% slope', r.slopePercent, 60, 100], ['360° pivot 10-20 s', r.pivotTime, 10, 20], ['recoil 0.2-0.5 m/s', r.recoilDv, 0.2, 0.5]],
  LightTank: (r) => [['0-32 km/h 4-7 s', r.launch.t32, 4, 7], ['top 65-75 km/h', r.top.kmh, 65, 75], ['ground pressure 50-80 kPa', r.groundPressure / 1000, 50, 80], ['climbs a 60% slope', r.slopePercent, 60, 100]],
  PassengerTrain: (r) => [['0-100 km/h 45-70 s', r.launch.t100.t, 45, 70], ['top 200 km/h (limit)', r.top.kmh, 199, 201], ['emergency stop from 200 km/h 900-1400 m', r.emergencyStop.meters, 900, 1400], ['derails at 100-130 km/h in a 300 m curve', r.derail300, 100, 130]],
  FreightTrain: (r) => [['0-100 km/h 150-300 s', r.launch.t100.t, 150, 300], ['60-85 km/h on a 1% grade', r.balance1.kmh, 60, 85], ['starts on a 3%+ grade', r.rulingGrade * 100, 3, 15], ['service stop from 110 km/h 800-1500 m', r.serviceStop.meters, 800, 1500]],
  Tram: (r) => [['starts at 1.0-1.4 m/s²', r.startingAccel, 1.0, 1.4], ['0-50 km/h 10-16 s', r.launch.t50.t, 10, 16], ['top 70 km/h (limit)', r.top.kmh, 69, 71], ['emergency stop from 70 km/h 60-100 m', r.emergencyStop.meters, 60, 100]],
};
for (const [name, fn] of Object.entries(expectOther)) {
  const r = byName[name];
  if (!r) { check(`${name} spec present`, false); continue; }
  for (const [label, value, lo, hi] of fn(r)) check(`${name} ${label}`, value >= lo && value <= hi, value);
  const allowed = name === 'JetFighter' ? r.warnings.filter((w) => !w.includes('speedLimitKmh')) : r.warnings;
  check(`${name} has no warnings`, allowed.length === 0, allowed.join(' | '));
}

// Kit's generated VehicleSpecs.luau is in sync with the specs folder.
const kitFile = path.join(__dirname, '..', 'assets', 'kit', 'shared', 'Vehicle', 'VehicleSpecs.luau');
const fresh = R.toLuau(specs);
check('kit VehicleSpecs.luau matches specs/ (re-run: node rveh.cjs luau specs --out ...)', fs.readFileSync(kitFile, 'utf8').replace(/\r\n/g, '\n') === fresh.replace(/\r\n/g, '\n'));
check('luau export has every spec', specs.every((s) => fresh.includes(`\t${s.name} = table.freeze({`)));
check('luau export keys are PascalCase', fresh.includes('FrequencyFront') && fresh.includes('TorqueCurve') && !fresh.includes('frequencyFront'));

console.log(failed ? `\n${failed} check(s) failed` : '\nall checks passed');
process.exit(failed ? 1 : 0);
