// Tank specs: defaults, validation and the real-world report (ground pressure, tractive effort,
// acceleration, top speed, braking, climbing, skid-steer turning moment, pivot and turret times,
// recoil). Mirrors TankSim.luau: tractive-effort hyperbola, track rolling resistance, μ W L / 4.
'use strict';

const { G, RHO_AIR, merge, num } = require('./common.cjs');

const DEFAULTS = {
  type: 'Tank',
  title: '',
  mass: 62000, // kg
  comHeight: 1.1, // m above the ground
  length: 7.9, // hull length, m
  width: 3.7, // m
  height: 2.4, // m (hull + turret)
  tracks: { contactLength: 4.6, width: 0.635, tread: 2.95, contacts: 6, wheelRadius: 0.4, grip: 0.8, lateralGrip: 0.6, rollingResistance: 0.035, approach: 0.45 },
  engine: { power: 1120, efficiency: 0.72, maxTractiveG: 0.65, maxSpeedKmh: 67, reverseSpeedKmh: 35, spool: 1.2 },
  steering: { pivotRate: 25, turnRate: 30, maxLateralG: 0.45 },
  brakes: { decelG: 0.6 },
  suspension: { frequency: 1.4, dampingRatio: 0.5, maxLength: 1.6, rideHeight: 0.5 },
  turret: { traverseRate: 40, elevationRate: 30, minElevation: -9, maxElevation: 20, height: 2.0 },
  gun: { reload: 6, recoil: 20, muzzleVelocity: 1650, range: 3000, defaultShell: true },
  recovery: { autoFlip: true, stuckAssist: true },
  assists: { stability: 0.6 },
  aero: { cd: 0.9, area: 7 },
  body: { hullFriction: 0.15 },
};

function normalize(raw) {
  const s = merge(DEFAULTS, raw);
  const t = s.tracks, errors = [];
  if (!/^[A-Za-z][A-Za-z0-9_]*$/.test(s.name || '')) errors.push('name must be an identifier (letters, digits, _)');
  for (const [k, v] of [['mass', s.mass], ['engine.power', s.engine.power], ['tracks.contactLength', t.contactLength], ['tracks.width', t.width], ['tracks.tread', t.tread], ['engine.maxSpeedKmh', s.engine.maxSpeedKmh]]) if (!(v > 0)) errors.push(`${k} must be positive`);
  if (!(t.contacts >= 3 && Number.isInteger(t.contacts))) errors.push('tracks.contacts must be a whole number, at least 3');
  if (!(s.turret.minElevation < s.turret.maxElevation)) errors.push('turret.minElevation must be below maxElevation');
  if (errors.length) throw new Error(`${s.name || '(unnamed)'}: ${errors.join('; ')}`);
  return s;
}

// ------------------------------------------------------------------ mirrors TankSim.luau
const weight = (s) => s.mass * G;
const groundPressure = (s) => weight(s) / (2 * s.tracks.contactLength * s.tracks.width); // Pa

// Total track force available (N) at speed v: adhesion/torque limit, then constant power.
function tractiveEffort(s, v) {
  const e = s.engine;
  return Math.min(e.maxTractiveG * weight(s), Math.min(s.tracks.grip, 2) * weight(s), (e.efficiency * e.power * 1000) / Math.max(Math.abs(v), 0.5));
}

function resistance(s, v, slope = 0) {
  const W = weight(s);
  return W * (s.tracks.rollingResistance * Math.cos(slope) + Math.sin(slope)) + 0.5 * RHO_AIR * s.aero.cd * s.aero.area * v * v;
}

// Turning-resistance moment (N m) and the track force difference it needs (uniform pressure).
const turningMoment = (s) => (s.tracks.lateralGrip * weight(s) * s.tracks.contactLength) / 4;

function launch(s) {
  const dt = 0.01;
  let v = 0, t = 0, state = 0.2, t32 = null, t50 = null;
  const vmax = s.engine.maxSpeedKmh / 3.6;
  for (let i = 0; i < 120 / dt; i++) {
    state = Math.min(1, state + dt / Math.max(s.engine.spool, 0.01));
    const drive = v < vmax ? tractiveEffort(s, v) * state : 0;
    v = Math.max(0, v + ((drive - resistance(s, v)) / s.mass) * dt);
    t += dt;
    if (t32 === null && v >= 32 / 3.6) t32 = t;
    if (t50 === null && v >= 50 / 3.6) t50 = t;
  }
  return { t32, t50 };
}

function topSpeed(s) {
  let best = 0;
  for (let v = 0.1; v < 60; v += 0.05) {
    if (v * 3.6 >= s.engine.maxSpeedKmh) return { kmh: s.engine.maxSpeedKmh, limiter: 'governor' };
    if (tractiveEffort(s, v) < resistance(s, v)) break;
    best = v;
  }
  return { kmh: best * 3.6, limiter: 'power' };
}

function braking(s, kmh) {
  let v = kmh / 3.6, d = 0, t = 0;
  const dt = 0.005;
  const decel = Math.min(s.brakes.decelG, s.tracks.grip) * G;
  while (v > 0) { v -= (decel + resistance(s, v) / s.mass) * dt; d += Math.max(v, 0) * dt; t += dt; }
  return { meters: d, seconds: t };
}

// Steepest slope (rad) it can climb from a standstill.
function maxSlope(s) {
  let lo = 0, hi = Math.PI / 3;
  for (let i = 0; i < 40; i++) { const mid = (lo + hi) / 2; if (tractiveEffort(s, 0.5) >= resistance(s, 0.5, mid)) lo = mid; else hi = mid; }
  return lo;
}

function report(s) {
  const W = weight(s);
  const L = s.tracks.contactLength, B = s.tracks.tread;
  const M = turningMoment(s);
  const pivotForce = M / B; // each track, opposite directions
  const pivotPower = M * ((s.steering.pivotRate * Math.PI) / 180);
  const acc = launch(s);
  const top = topSpeed(s);
  const slope = maxSlope(s);
  const warnings = [];
  if (L / B > 1.8) warnings.push(`steering ratio L/B ${num(L / B, 2)}: above 1.8 it fights every turn`);
  if (pivotForce > s.tracks.grip * (W / 2)) warnings.push("the tracks can't grip enough to pivot (needs more than the traction per track)");
  if (pivotPower > s.engine.efficiency * s.engine.power * 1000) warnings.push(`pivoting at ${s.steering.pivotRate}°/s needs ${num(pivotPower / 1000, 0)} kW, more than the engine delivers`);
  if (groundPressure(s) > 150000) warnings.push(`ground pressure ${num(groundPressure(s) / 1000, 0)} kPa: it would bog down off-road`);
  if (top.limiter === 'power' && top.kmh < s.engine.maxSpeedKmh * 0.8) warnings.push(`only reaches ${num(top.kmh, 0)} km/h of its ${s.engine.maxSpeedKmh} km/h governor`);
  return {
    type: 'Tank', name: s.name, title: s.title, powerToWeight: s.engine.power / (s.mass / 1000), groundPressure: groundPressure(s), steeringRatio: L / B,
    turningMoment: M, pivotForce, pivotPower, startTE: tractiveEffort(s, 0.5), topTE: tractiveEffort(s, s.engine.maxSpeedKmh / 3.6),
    launch: acc, top, brake: braking(s, 40), slope, slopePercent: Math.tan(slope) * 100, pivotTime: 360 / s.steering.pivotRate,
    traverseTime: 360 / s.turret.traverseRate, recoilDv: (s.gun.recoil * 1000) / s.mass, warnings,
  };
}

function printReport(r) {
  const f = num;
  const lines = [];
  lines.push(`${r.name}${r.title ? ` — ${r.title}` : ''}  [Tank]`);
  lines.push(`  power        ${f(r.powerToWeight, 1)} kW/t · ground pressure ${f(r.groundPressure / 1000, 0)} kPa · steering ratio L/B ${f(r.steeringRatio, 2)}`);
  lines.push(`  traction     ${f(r.startTE / 1000, 0)} kN at a standstill · ${f(r.topTE / 1000, 0)} kN at top speed`);
  lines.push(`  launch       0-32 km/h ${f(r.launch.t32, 1)} s · 0-50 km/h ${f(r.launch.t50, 1)} s`);
  lines.push(`  top speed    ${f(r.top.kmh, 0)} km/h (limited by ${r.top.limiter}) · 40-0 km/h ${f(r.brake.meters, 1)} m`);
  lines.push(`  climbing     ${f(r.slopePercent, 0)}% slope (${f((r.slope * 180) / Math.PI, 0)}°)`);
  lines.push(`  steering     turning moment ${f(r.turningMoment / 1000, 0)} kN·m · pivot needs ±${f(r.pivotForce / 1000, 0)} kN per track, ${f(r.pivotPower / 1000, 0)} kW · 360° pivot ${f(r.pivotTime, 1)} s`);
  lines.push(`  turret       360° in ${f(r.traverseTime, 1)} s · recoil shoves the hull ${f(r.recoilDv, 2)} m/s`);
  for (const w of r.warnings) lines.push(`  WARN ${w}`);
  return lines.join('\n');
}

module.exports = { DEFAULTS, normalize, report, printReport, groundPressure, tractiveEffort, resistance, turningMoment, launch, topSpeed, braking, maxSlope };
