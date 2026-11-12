#!/usr/bin/env node
// Vehicle spec tool for the roblox-vehicles skill. Node only, no packages.
//
//   node rveh.cjs report <spec.json>...          real-world performance and checks per spec
//   node rveh.cjs luau <spec.json>... [--out f]  VehicleSpecs.luau for the kit
//   node rveh.cjs report <specs dir>             every *.json in a folder
//
// The longitudinal model here mirrors the kit's VehicleMath.luau (torque curve, gearing,
// launch rpm, traction limit with weight transfer, drag, rolling resistance, brakes), so the
// numbers it reports are what the car does in Roblox on flat ground.
'use strict';

const fs = require('fs');
const path = require('path');

const G = 9.81; // m/s^2 (tire grip, brakes and weight use real gravity)
const RHO = 1.225; // air density kg/m^3
const METERS_PER_STUD = 0.28;
const ROBLOX_GRAVITY = 196.2; // studs/s^2 (suspension lives in Roblox's world)

// ---------------------------------------------------------------------------------------
// Spec defaults and validation

const DEFAULTS = {
  title: '',
  mass: 1300,
  frontWeight: 0.55,
  comHeight: 0.5,
  wheelRadius: 0.32,
  drivetrain: 'FWD',
  awdFrontSplit: 0.4,
  engine: { idleRpm: 850, redlineRpm: 6500, launchRpm: 2500, efficiency: 0.85, speedLimitKmh: 0, torqueCurve: [[1000, 120], [4000, 160], [6500, 130]] },
  gearbox: { ratios: [3.5, 2.0, 1.4, 1.05, 0.85], reverse: 3.3, finalDrive: 3.9, shiftUpRpm: 6000, shiftDownRpm: 2800, shiftTime: 0.25 },
  brakes: { decelG: 1.0, frontBias: 0.65, handbrakeGripScale: 0.5 },
  steering: { maxAngle: 34, speed: 4, highSpeedScale: 0.4, highSpeedKmh: 160 },
  tires: { gripFront: 1.0, gripRear: 1.0, stiffness: 10, shape: 1.9, slideGrip: 0.8, rollingResistance: 0.013 },
  drift: { countersteer: 0.15, maxAngle: 50, stabilizer: 0.5 },
  recovery: { airControl: 0.3, autoFlip: true, stuckAssist: true },
  body: { autoHull: true, hullFriction: 0.08 },
  suspension: { frequencyFront: 2.4, frequencyRear: 2.6, dampingRatio: 0.35, maxLength: 1.6, rideHeight: 0.6, antiRoll: 0.3, rollCenter: 0.5 },
  aero: { cd: 0.32, area: 2.1, downforceCl: 0 },
};

function merge(base, over) {
  const out = Array.isArray(base) ? [...base] : { ...base };
  for (const [k, v] of Object.entries(over || {})) {
    out[k] = v && typeof v === 'object' && !Array.isArray(v) && base[k] && typeof base[k] === 'object' && !Array.isArray(base[k]) ? merge(base[k], v) : v;
  }
  return out;
}

function normalize(raw) {
  const s = merge(DEFAULTS, raw);
  const errors = [];
  if (!/^[A-Za-z][A-Za-z0-9_]*$/.test(s.name || '')) errors.push('name must be an identifier (letters, digits, _)');
  if (!['FWD', 'RWD', 'AWD'].includes(s.drivetrain)) errors.push('drivetrain must be FWD, RWD or AWD');
  const curve = s.engine.torqueCurve;
  if (!Array.isArray(curve) || curve.length < 2) errors.push('engine.torqueCurve needs at least two [rpm, Nm] points');
  else for (let i = 1; i < curve.length; i++) if (!(curve[i][0] > curve[i - 1][0])) errors.push('engine.torqueCurve rpm must increase');
  if (!s.gearbox.ratios.length) errors.push('gearbox.ratios is empty');
  for (let i = 1; i < s.gearbox.ratios.length; i++) if (!(s.gearbox.ratios[i] < s.gearbox.ratios[i - 1])) errors.push('gearbox.ratios must decrease');
  if (s.gearbox.shiftDownRpm >= s.gearbox.shiftUpRpm) errors.push('gearbox.shiftDownRpm must be below shiftUpRpm');
  if (s.engine.redlineRpm <= s.engine.idleRpm) errors.push('engine.redlineRpm must be above idleRpm');
  for (const [k, v] of [['mass', s.mass], ['wheelRadius', s.wheelRadius], ['comHeight', s.comHeight]]) if (!(v > 0)) errors.push(`${k} must be positive`);
  if (!(s.frontWeight > 0 && s.frontWeight < 1)) errors.push('frontWeight must be between 0 and 1');
  if (!(s.tires.slideGrip >= 0 && s.tires.slideGrip <= 1)) errors.push('tires.slideGrip must be between 0 and 1');
  if (!(s.drift.countersteer >= 0 && s.drift.countersteer <= 1)) errors.push('drift.countersteer must be between 0 and 1');
  if (!(s.recovery.airControl >= 0 && s.recovery.airControl <= 1)) errors.push('recovery.airControl must be between 0 and 1');
  if (errors.length) throw new Error(`${s.name || '(unnamed)'}: ${errors.join('; ')}`);
  return s;
}

// ---------------------------------------------------------------------------------------
// Physics (mirrors VehicleMath.luau)

function torqueAt(curve, rpm, redline) {
  if (rpm > redline) return 0;
  if (rpm <= curve[0][0]) return curve[0][1];
  for (let i = 1; i < curve.length; i++) {
    const [r1, t1] = curve[i];
    if (rpm <= r1) {
      const [r0, t0] = curve[i - 1];
      return t0 + ((t1 - t0) * (rpm - r0)) / (r1 - r0);
    }
  }
  return curve[curve.length - 1][1];
}

function engineRpm(s, speedMs, ratio) {
  return (Math.abs(speedMs) / s.wheelRadius) * ratio * s.gearbox.finalDrive * (60 / (2 * Math.PI));
}

// Drive force (N) at the contact patches for a gear and speed with full throttle, before traction.
function driveForce(s, speedMs, gearIndex, throttle) {
  const ratio = s.gearbox.ratios[gearIndex];
  // Electronic speed limiter: no drive at or above the limit.
  if (s.engine.speedLimitKmh > 0 && Math.abs(speedMs) * 3.6 >= s.engine.speedLimitKmh) throttle = 0;
  let rpm = engineRpm(s, speedMs, ratio);
  if (gearIndex === 0 && rpm < s.engine.launchRpm && throttle > 0) rpm = s.engine.launchRpm; // clutch slip
  rpm = Math.max(rpm, s.engine.idleRpm);
  const torque = torqueAt(s.engine.torqueCurve, rpm, s.engine.redlineRpm) * throttle;
  return { force: (torque * ratio * s.gearbox.finalDrive * s.engine.efficiency) / s.wheelRadius, rpm };
}

function dragForce(s, speedMs) {
  return 0.5 * RHO * s.aero.cd * s.aero.area * speedMs * speedMs;
}

function downforce(s, speedMs) {
  return 0.5 * RHO * s.aero.downforceCl * s.aero.area * speedMs * speedMs;
}

// Traction limit of the driven axle(s), with longitudinal weight transfer from acceleration.
function tractionLimit(s, accel, speedMs) {
  const wheelbaseFactor = s.comHeight / wheelbaseMeters(s);
  const weight = s.mass * G + downforce(s, speedMs);
  const transfer = s.mass * accel * wheelbaseFactor; // N moved to the rear under acceleration
  const front = Math.max(0, weight * s.frontWeight - transfer);
  const rear = Math.max(0, weight * (1 - s.frontWeight) + transfer);
  if (s.drivetrain === 'FWD') return front * s.tires.gripFront;
  if (s.drivetrain === 'RWD') return rear * s.tires.gripRear;
  return front * s.tires.gripFront + rear * s.tires.gripRear; // AWD: both axles (split assumed ideal)
}

function wheelbaseMeters(s) {
  return s.wheelbase || 2.6; // only used for weight transfer in the report; the kit measures the model
}

function simulateLaunch(s) {
  const dt = 0.005;
  let v = 0, t = 0, gear = 0, shiftLeft = 0, accel = 0;
  let t100 = null, t60mph = null, t60kmh = null, quarter = null, dist = 0;
  const shifts = [];
  for (let i = 0; i < 120 / dt; i++) {
    let drive = 0;
    if (shiftLeft > 0) shiftLeft -= dt;
    else {
      const d = driveForce(s, v, gear, 1);
      if (d.rpm >= s.gearbox.shiftUpRpm && gear < s.gearbox.ratios.length - 1) {
        gear++;
        shiftLeft = s.gearbox.shiftTime;
        shifts.push({ gear: gear + 1, kmh: v * 3.6, t });
      } else drive = d.force;
    }
    drive = Math.min(drive, tractionLimit(s, accel, v));
    const resist = dragForce(s, v) + s.tires.rollingResistance * (s.mass * G);
    accel = (drive - resist) / s.mass;
    v = Math.max(0, v + accel * dt);
    dist += v * dt;
    t += dt;
    if (t100 === null && v >= 100 / 3.6) t100 = t;
    if (t60mph === null && v >= 26.8224) t60mph = t;
    if (t60kmh === null && v >= 60 / 3.6) t60kmh = t;
    if (quarter === null && dist >= 402.336) quarter = { t, kmh: v * 3.6 };
  }
  return { t100, t60mph, t60kmh, quarter, shifts, topKmh: v * 3.6, topGear: gear + 1 };
}

function topSpeed(s) {
  // Highest speed where drive force (any gear, below redline) still beats resistance.
  let best = 0, limiter = 'drag';
  for (let kmh = 1; kmh < 600; kmh += 0.5) {
    const v = kmh / 3.6;
    const resist = dragForce(s, v) + s.tires.rollingResistance * s.mass * G;
    let maxDrive = 0, anyBelowRedline = false;
    for (let g = 0; g < s.gearbox.ratios.length; g++) {
      const rpm = engineRpm(s, v, s.gearbox.ratios[g]);
      if (rpm > s.engine.redlineRpm) continue;
      anyBelowRedline = true;
      maxDrive = Math.max(maxDrive, driveForce(s, v, g, 1).force);
    }
    if (!anyBelowRedline) { limiter = 'redline in top gear'; break; }
    if (s.engine.speedLimitKmh > 0 && kmh >= s.engine.speedLimitKmh) { best = s.engine.speedLimitKmh; limiter = 'speed limiter'; break; }
    if (maxDrive <= resist) { limiter = 'drag'; break; }
    best = kmh;
  }
  return { kmh: best, limiter };
}

function braking(s) {
  const v0 = 100 / 3.6;
  const dt = 0.002;
  let v = v0, d = 0, t = 0;
  const grip = Math.min(s.brakes.decelG, s.brakes.frontBias * s.tires.gripFront + (1 - s.brakes.frontBias) * s.tires.gripRear);
  while (v > 0) {
    const a = grip * G + (dragForce(s, v) + downforce(s, v) * 0) / s.mass + s.tires.rollingResistance * G;
    v -= a * dt;
    d += Math.max(v, 0) * dt;
    t += dt;
  }
  return { meters: d, seconds: t, decelG: grip };
}

function peakPower(s) {
  let best = { kw: 0, rpm: 0 };
  for (let rpm = s.engine.idleRpm; rpm <= s.engine.redlineRpm; rpm += 50) {
    const kw = (torqueAt(s.engine.torqueCurve, rpm, s.engine.redlineRpm) * rpm * 2 * Math.PI) / 60 / 1000;
    if (kw > best.kw) best = { kw, rpm };
  }
  return best;
}

function suspension(s) {
  const out = {};
  for (const [axle, f] of [['front', s.suspension.frequencyFront], ['rear', s.suspension.frequencyRear]]) {
    const omega2 = (2 * Math.PI * f) ** 2;
    const sag = ROBLOX_GRAVITY / omega2; // studs of static compression in Roblox gravity
    const staticLength = s.suspension.maxLength * s.suspension.rideHeight;
    out[axle] = { frequency: f, sagStuds: sag, bumpTravelStuds: staticLength, droopTravelStuds: s.suspension.maxLength - staticLength };
  }
  return out;
}

function report(s) {
  const p = peakPower(s);
  const launch = simulateLaunch(s);
  const top = topSpeed(s);
  const brake = braking(s);
  const susp = suspension(s);
  const gearSpeeds = s.gearbox.ratios.map((r) => ((s.engine.redlineRpm * 2 * Math.PI) / 60 / (r * s.gearbox.finalDrive)) * s.wheelRadius * 3.6);
  const warnings = [];
  if (launch.t100 === null && top.kmh > 105) warnings.push('never reaches 100 km/h in the launch test despite the top speed: check traction and gearing');
  for (const axle of ['front', 'rear']) {
    const a = susp[axle];
    if (a.bumpTravelStuds < a.sagStuds) warnings.push(`${axle} suspension can bottom out on a 1 g bump (bump travel ${a.bumpTravelStuds.toFixed(2)} < sag ${a.sagStuds.toFixed(2)} studs): raise frequency${axle === 'front' ? 'Front' : 'Rear'}, maxLength or rideHeight`);
  }
  if (s.suspension.dampingRatio < 0.2) warnings.push('dampingRatio below 0.2 bounces; 0.25-0.45 is typical');
  if (s.suspension.dampingRatio > 0.8) warnings.push('dampingRatio above 0.8 feels stiff and skips over bumps');
  if (s.tires.slideGrip < 0.6) warnings.push('tires.slideGrip below 0.6: slides collapse into spins; 0.75-0.85 keeps drifts controllable');
  if (!s.body.autoHull) warnings.push('body.autoHull is off: the detailed body mesh collides with the world and can snag on curbs and trees');
  if (s.body.hullFriction > 0.3) warnings.push('body.hullFriction above 0.3: scraping walls and trees will grab and stop the car');
  const lowGearTop = gearSpeeds[0];
  if (lowGearTop < 25) warnings.push(`1st gear tops out at ${lowGearTop.toFixed(0)} km/h: very short, the car will shift almost immediately`);
  if (top.limiter.startsWith('redline') && top.kmh < gearSpeeds[gearSpeeds.length - 1] - 1) warnings.push('top speed limited by redline: a taller top gear or final drive would go faster');
  const powerToWeight = (p.kw * 1000) / s.mass;
  return { name: s.name, title: s.title, peakKw: p.kw, peakHp: p.kw * 1.341, peakRpm: p.rpm, powerToWeight, launch, top, brake, gearSpeeds, susp, lateralG: (s.tires.gripFront + s.tires.gripRear) / 2, slideGrip: s.tires.slideGrip, countersteer: s.drift.countersteer, driftMaxAngle: s.drift.maxAngle, warnings };
}

// ---------------------------------------------------------------------------------------
// Output

function printReport(r) {
  const f = (n, d = 1) => (n === null || n === undefined ? '-' : Number(n).toFixed(d));
  const lines = [];
  lines.push(`${r.name}${r.title ? ` — ${r.title}` : ''}`);
  lines.push(`  power        ${f(r.peakKw, 0)} kW (${f(r.peakHp, 0)} hp) at ${r.peakRpm} rpm · ${f(r.powerToWeight, 0)} W/kg`);
  lines.push(`  0-100 km/h   ${f(r.launch.t100, 2)} s   (0-60 mph ${f(r.launch.t60mph, 2)} s, 0-60 km/h ${f(r.launch.t60kmh, 2)} s)`);
  lines.push(`  quarter mile ${r.launch.quarter ? `${f(r.launch.quarter.t, 2)} s at ${f(r.launch.quarter.kmh, 0)} km/h` : '-'}`);
  lines.push(`  top speed    ${f(r.top.kmh, 0)} km/h (limited by ${r.top.limiter})`);
  lines.push(`  100-0 km/h   ${f(r.brake.meters, 1)} m in ${f(r.brake.seconds, 2)} s at ${f(r.brake.decelG, 2)} g`);
  lines.push(`  cornering    ~${f(r.lateralG, 2)} g on flat ground (more with downforce)`);
  lines.push(`  gear tops    ${r.gearSpeeds.map((v, i) => `${i + 1}:${f(v, 0)}`).join('  ')} km/h at redline`);
  lines.push(`  suspension   front ${f(r.susp.front.frequency, 1)} Hz sag ${f(r.susp.front.sagStuds, 2)} / bump ${f(r.susp.front.bumpTravelStuds, 2)} studs · rear ${f(r.susp.rear.frequency, 1)} Hz sag ${f(r.susp.rear.sagStuds, 2)} / bump ${f(r.susp.rear.bumpTravelStuds, 2)} studs`);
  lines.push(`  handling     slide grip ${f(r.slideGrip, 2)} · countersteer assist ${f(r.countersteer, 2)} · stabilizer past ${r.driftMaxAngle}°`);
  for (const w of r.warnings) lines.push(`  WARN ${w}`);
  return lines.join('\n');
}

function luaValue(v, indent) {
  const pad = '\t'.repeat(indent);
  if (Array.isArray(v)) {
    if (v.every((x) => typeof x === 'number')) return `table.freeze({ ${v.map(num).join(', ')} })`;
    return `table.freeze({\n${v.map((x) => `${pad}\t${luaValue(x, indent + 1)},`).join('\n')}\n${pad}})`;
  }
  if (v && typeof v === 'object') {
    const keys = Object.keys(v);
    return `table.freeze({\n${keys.map((k) => `${pad}\t${luaKey(k)} = ${luaValue(v[k], indent + 1)},`).join('\n')}\n${pad}})`;
  }
  if (typeof v === 'string') return JSON.stringify(v);
  if (typeof v === 'boolean') return String(v);
  return num(v);
}
const num = (n) => (Number.isInteger(n) ? String(n) : String(Math.round(n * 10000) / 10000));
const luaKey = (k) => k.charAt(0).toUpperCase() + k.slice(1);

function toLuau(specs) {
  const header = [
    '--!strict',
    '-- GENERATED by roblox-vehicles/scripts/rveh.cjs from spec JSON files. Edit the JSON and',
    '-- re-export (`node rveh.cjs luau specs/*.json --out VehicleSpecs.luau`), or edit here by hand.',
    '-- Units: mass kg, lengths m (except Suspension.MaxLength in studs), speeds km/h, torque N·m,',
    '-- angles degrees, frequency Hz. Everything performance-related is independent of the mesh.',
    '',
    'return table.freeze({',
  ];
  const body = specs.map((s) => {
    const { name, ...rest } = s;
    delete rest.wheelbase;
    return `\t${name} = ${luaValue(rest, 1)},`;
  });
  return [...header, ...body, '})', ''].join('\n');
}

function loadSpecs(args) {
  const files = [];
  for (const a of args) {
    if (fs.existsSync(a) && fs.statSync(a).isDirectory()) for (const f of fs.readdirSync(a).sort()) { if (f.endsWith('.json')) files.push(path.join(a, f)); }
    else files.push(a);
  }
  if (!files.length) throw new Error('give spec .json files or a folder');
  return files.map((f) => normalize(JSON.parse(fs.readFileSync(f, 'utf8'))));
}

function main() {
  const [cmd, ...rest] = process.argv.slice(2);
  const outIdx = rest.indexOf('--out');
  const out = outIdx >= 0 ? rest[outIdx + 1] : null;
  const args = outIdx >= 0 ? rest.filter((_, i) => i !== outIdx && i !== outIdx + 1) : rest;
  if (cmd === 'report') {
    const specs = loadSpecs(args);
    console.log(specs.map((s) => printReport(report(s))).join('\n\n'));
  } else if (cmd === 'luau') {
    const text = toLuau(loadSpecs(args));
    if (out) { fs.writeFileSync(out, text); console.log(`wrote ${out}`); } else process.stdout.write(text);
  } else {
    console.log('usage:\n  node rveh.cjs report <spec.json | folder>...\n  node rveh.cjs luau <spec.json | folder>... [--out VehicleSpecs.luau]');
    process.exit(cmd ? 1 : 0);
  }
}

if (require.main === module) {
  try { main(); } catch (e) { console.error(`rveh: ${e.message}`); process.exit(1); }
}

module.exports = { normalize, torqueAt, engineRpm, driveForce, dragForce, tractionLimit, simulateLaunch, topSpeed, braking, peakPower, suspension, report, toLuau, METERS_PER_STUD };
