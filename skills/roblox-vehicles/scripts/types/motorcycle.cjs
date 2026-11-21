// Motorcycle specs: defaults, validation and the real-world report (launch limited by wheelie
// and traction, stoppie-limited braking, lean and turn radius). The powertrain is the car's
// (rveh.cjs / VehicleMath.luau); BikeSim.luau runs the same numbers in game.
'use strict';

const { G, merge, num } = require('./common.cjs');

const car = () => require('../rveh.cjs'); // lazy: rveh.cjs requires this file

const DEFAULTS = {
  type: 'Motorcycle',
  title: '',
  mass: 280, // kg, bike + rider
  frontWeight: 0.5,
  comHeight: 0.62, // m, with rider
  wheelbase: 1.4, // m
  wheelRadius: 0.31, // m, rear (gearing)
  engine: { idleRpm: 1300, redlineRpm: 14000, launchRpm: 7000, efficiency: 0.9, speedLimitKmh: 0, torqueCurve: [[3000, 55], [6000, 80], [9000, 100], [11500, 113], [13500, 104], [14000, 98]] },
  gearbox: { ratios: [2.6, 2.0, 1.65, 1.45, 1.3, 1.18], reverse: 2.6, finalDrive: 4.3, shiftUpRpm: 13500, shiftDownRpm: 7000, shiftTime: 0.08, reverseSpeedKmh: 7 },
  brakes: { decelG: 1.15, frontBias: 0.72 },
  steering: { maxAngle: 32, speed: 3, maxLean: 50, leanRate: 85, lowSpeedKmh: 12 },
  tires: { gripFront: 1.2, gripRear: 1.2, stiffness: 10, shape: 1.8, slideGrip: 0.82, camberThrust: 0.9, rollingResistance: 0.015 },
  wheelie: { control: true, balanceAngle: 28, stoppieAngle: -12, riderShift: 0.12, assist: 0.85 },
  recovery: { airControl: 0.3, airGravity: 2, airInput: 160, autoFlip: true, stuckAssist: true, bailG: 7 },
  assists: { stability: 0.5 },
  suspension: { frequencyFront: 2.0, frequencyRear: 2.2, dampingRatio: 0.45, maxLength: 1.6, rideHeight: 0.55 },
  aero: { cd: 0.6, area: 0.6 },
  body: { hullFriction: 0.1 },
};

function normalize(raw) {
  const s = merge(DEFAULTS, raw);
  const errors = [];
  if (!/^[A-Za-z][A-Za-z0-9_]*$/.test(s.name || '')) errors.push('name must be an identifier (letters, digits, _)');
  const curve = s.engine.torqueCurve;
  if (!Array.isArray(curve) || curve.length < 2) errors.push('engine.torqueCurve needs at least two [rpm, Nm] points');
  else for (let i = 1; i < curve.length; i++) if (!(curve[i][0] > curve[i - 1][0])) errors.push('engine.torqueCurve rpm must increase');
  for (let i = 1; i < s.gearbox.ratios.length; i++) if (!(s.gearbox.ratios[i] < s.gearbox.ratios[i - 1])) errors.push('gearbox.ratios must decrease');
  if (s.gearbox.shiftDownRpm >= s.gearbox.shiftUpRpm) errors.push('gearbox.shiftDownRpm must be below shiftUpRpm');
  for (const [k, v] of [['mass', s.mass], ['wheelRadius', s.wheelRadius], ['comHeight', s.comHeight], ['wheelbase', s.wheelbase]]) if (!(v > 0)) errors.push(`${k} must be positive`);
  if (!(s.frontWeight > 0.2 && s.frontWeight < 0.8)) errors.push('frontWeight must be between 0.2 and 0.8');
  if (!(s.steering.maxLean > 5 && s.steering.maxLean <= 65)) errors.push('steering.maxLean must be between 5 and 65 degrees');
  if (!(s.tires.camberThrust >= 0 && s.tires.camberThrust <= 1.2)) errors.push('tires.camberThrust must be between 0 and 1.2');
  if (!(s.wheelie.assist >= 0 && s.wheelie.assist <= 1)) errors.push('wheelie.assist must be between 0 and 1');
  if (!(s.brakes.frontBias > 0 && s.brakes.frontBias < 1)) errors.push('brakes.frontBias must be between 0 and 1');
  if (errors.length) throw new Error(`${s.name || '(unnamed)'}: ${errors.join('; ')}`);
  return s;
}

// The car tools read spec.tires.gripFront/gripRear etc.; a bike spec has the same fields.
const wheelieG = (s) => (s.wheelbase * s.frontWeight) / s.comHeight; // a = g b / h
const stoppieG = (s) => (s.wheelbase * (1 - s.frontWeight)) / s.comHeight; // a = g a_f / h

// Rear-wheel drive force limit: rear grip with load transfer, and the wheelie limit.
function driveLimit(s, accel) {
  const W = s.mass * G;
  const rearLoad = Math.min(W, W * (1 - s.frontWeight) + (s.mass * accel * s.comHeight) / s.wheelbase);
  return { grip: s.tires.gripRear * rearLoad, wheelie: W * wheelieG(s) };
}

function simulateLaunch(s) {
  const R = car();
  const dt = 0.005;
  let v = 0, t = 0, gear = 0, shiftLeft = 0, accel = 0, dist = 0;
  let t100 = null, t60kmh = null, t60mph = null, quarter = null;
  let limitedBy = { wheelie: 0, grip: 0, engine: 0 };
  for (let i = 0; i < 90 / dt; i++) {
    let drive = 0;
    if (shiftLeft > 0) shiftLeft -= dt;
    else {
      const d = R.driveForce(s, v, gear, 1);
      if (d.rpm >= s.gearbox.shiftUpRpm && gear < s.gearbox.ratios.length - 1) { gear++; shiftLeft = s.gearbox.shiftTime; }
      else drive = d.force;
    }
    const lim = driveLimit(s, accel);
    const capped = Math.min(drive, lim.grip, lim.wheelie);
    if (v < 100 / 3.6 && drive > 0) {
      if (capped === lim.wheelie && drive > lim.wheelie) limitedBy.wheelie += dt;
      else if (capped === lim.grip && drive > lim.grip) limitedBy.grip += dt;
      else limitedBy.engine += dt;
    }
    const resist = R.dragForce(s, v) + s.tires.rollingResistance * s.mass * G;
    accel = (capped - resist) / s.mass;
    v = Math.max(0, v + accel * dt);
    dist += v * dt;
    t += dt;
    if (t60kmh === null && v >= 60 / 3.6) t60kmh = t;
    if (t60mph === null && v >= 26.8224) t60mph = t;
    if (t100 === null && v >= 100 / 3.6) t100 = t;
    if (quarter === null && dist >= 402.336) quarter = { t, kmh: v * 3.6 };
  }
  const main = Object.entries(limitedBy).sort((a, b) => b[1] - a[1])[0][0];
  return { t60kmh, t60mph, t100, quarter, launchLimit: main };
}

// Straight-line braking with load transfer: front (frontBias) and rear brakes each capped by their
// tire's grip under the transfer, and the whole thing capped by the stoppie limit.
function brakeDecel(s) {
  const W = s.mass * G, hl = s.comHeight / s.wheelbase;
  let a = s.brakes.decelG * G, front = 0, rear = 0;
  for (let i = 0; i < 40; i++) {
    const transfer = s.mass * a * hl;
    const fLoad = Math.min(W, W * s.frontWeight + transfer), rLoad = Math.max(0, W * (1 - s.frontWeight) - transfer);
    front = Math.min(s.brakes.frontBias * s.brakes.decelG * W, s.tires.gripFront * fLoad);
    rear = Math.min((1 - s.brakes.frontBias) * s.brakes.decelG * W, s.tires.gripRear * rLoad);
    a += (Math.min((front + rear) / s.mass, stoppieG(s) * G) - a) * 0.5;
  }
  return { g: a / G, stoppieLimited: a >= stoppieG(s) * G * 0.995 };
}

function braking(s) {
  const R = car();
  const b = brakeDecel(s);
  let v = 100 / 3.6, d = 0, t = 0;
  const dt = 0.002;
  while (v > 0) {
    v -= (b.g * G + R.dragForce(s, v) / s.mass + s.tires.rollingResistance * G) * dt;
    d += Math.max(v, 0) * dt;
    t += dt;
  }
  return { meters: d, seconds: t, decelG: b.g, stoppieLimited: b.stoppieLimited };
}

function report(s) {
  const R = car();
  const p = R.peakPower(s);
  const launch = simulateLaunch(s);
  const top = R.topSpeed(s);
  const brake = braking(s);
  const gearSpeeds = s.gearbox.ratios.map((r) => ((s.engine.redlineRpm * 2 * Math.PI) / 60 / (r * s.gearbox.finalDrive)) * s.wheelRadius * 3.6);
  const gripLean = (Math.atan(Math.min(s.tires.gripFront, s.tires.gripRear)) * 180) / Math.PI;
  const lean = Math.min(gripLean, s.steering.maxLean);
  const radiusAt = (kmh) => (kmh / 3.6) ** 2 / (G * Math.tan((lean * Math.PI) / 180));
  const warnings = [];
  if (wheelieG(s) < 0.6) warnings.push(`wheelie limit ${num(wheelieG(s), 2)} g: the bike wheelies at the slightest throttle; lower comHeight or raise frontWeight`);
  if (stoppieG(s) < 0.75) warnings.push(`stoppie limit ${num(stoppieG(s), 2)} g: hard braking flips it; lower comHeight or brakes.frontBias`);
  if (s.steering.maxLean > gripLean + 3) warnings.push(`steering.maxLean ${s.steering.maxLean}° is past what the tires can hold (${num(gripLean, 0)}°): it will slide out at full lean`);
  if (s.suspension.dampingRatio < 0.2) warnings.push('suspension.dampingRatio below 0.2 bounces');
  if (gearSpeeds[0] < 30) warnings.push(`1st gear tops out at ${num(gearSpeeds[0], 0)} km/h: very short`);
  if (launch.t100 === null && top.kmh > 105) warnings.push('never reaches 100 km/h in the launch test');
  return {
    type: 'Motorcycle', name: s.name, title: s.title, peakKw: p.kw, peakHp: p.kw * 1.341, peakRpm: p.rpm, powerToWeight: (p.kw * 1000) / s.mass,
    launch, top, brake, gearSpeeds, wheelieG: wheelieG(s), stoppieG: stoppieG(s), gripLean, lean, radius50: radiusAt(50), radius100: radiusAt(100), warnings,
  };
}

function printReport(r) {
  const f = num;
  const lines = [];
  lines.push(`${r.name}${r.title ? ` — ${r.title}` : ''}  [Motorcycle]`);
  lines.push(`  power        ${f(r.peakKw, 0)} kW (${f(r.peakHp, 0)} hp) at ${r.peakRpm} rpm · ${f(r.powerToWeight, 0)} W/kg`);
  lines.push(`  0-100 km/h   ${f(r.launch.t100, 2)} s   (0-60 mph ${f(r.launch.t60mph, 2)} s, 0-60 km/h ${f(r.launch.t60kmh, 2)} s) · launch limited by ${r.launch.launchLimit}`);
  lines.push(`  quarter mile ${r.launch.quarter ? `${f(r.launch.quarter.t, 2)} s at ${f(r.launch.quarter.kmh, 0)} km/h` : '-'}`);
  lines.push(`  top speed    ${f(r.top.kmh, 0)} km/h (limited by ${r.top.limiter})`);
  lines.push(`  100-0 km/h   ${f(r.brake.meters, 1)} m in ${f(r.brake.seconds, 2)} s at ${f(r.brake.decelG, 2)} g${r.brake.stoppieLimited ? ' (stoppie-limited)' : ''}`);
  lines.push(`  wheelie at   ${f(r.wheelieG, 2)} g · stoppie at ${f(r.stoppieG, 2)} g`);
  lines.push(`  lean         ${f(r.lean, 0)}° (tires allow ${f(r.gripLean, 0)}°) · turn radius ${f(r.radius50, 0)} m at 50 km/h, ${f(r.radius100, 0)} m at 100 km/h`);
  lines.push(`  gear tops    ${r.gearSpeeds.map((v, i) => `${i + 1}:${f(v, 0)}`).join('  ')} km/h at redline`);
  for (const w of r.warnings) lines.push(`  WARN ${w}`);
  return lines.join('\n');
}

module.exports = { DEFAULTS, normalize, report, printReport, wheelieG, stoppieG, simulateLaunch, braking };
