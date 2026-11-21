// Train specs: defaults, validation and the real-world report (tractive effort and adhesion,
// acceleration, top and balancing speeds, ruling grade, stopping distances, derailment speeds).
// The longitudinal model mirrors TrainSim.luau: one body on the track, tractive effort =
// min(starting limit, adhesion, power / v), Davis resistance, grade and Röckl curve resistance.
'use strict';

const { G, RHO_AIR, merge, num } = require('./common.cjs');

const DEFAULTS = {
  type: 'Train',
  title: '',
  mass: 125000, // kg, the powered vehicle (locomotive or power car)
  comHeight: 1.8, // m above the rail
  length: 21, // m
  bogieSpacing: 14, // m between bogie centres
  cars: { count: 5, mass: 50000, length: 26, bogieSpacing: 19, cdA: 1.2 },
  engine: { power: 3600, efficiency: 0.85, startingTractiveEffort: 290, adhesion: 0.33, speedLimitKmh: 200, reverseSpeedKmh: 20 },
  resistance: { rolling: 1.3, speed: 0.015, cdA: 6 },
  brakes: { service: 0.9, emergency: 1.3, adhesion: 0.15 },
  derail: { enabled: true, lateralG: 0.35 },
  controls: { notchRate: 0.5 },
};

function normalize(raw) {
  const s = merge(DEFAULTS, raw);
  const errors = [];
  if (!/^[A-Za-z][A-Za-z0-9_]*$/.test(s.name || '')) errors.push('name must be an identifier (letters, digits, _)');
  for (const [k, v] of [['mass', s.mass], ['engine.power', s.engine.power], ['engine.startingTractiveEffort', s.engine.startingTractiveEffort], ['engine.adhesion', s.engine.adhesion], ['bogieSpacing', s.bogieSpacing], ['brakes.service', s.brakes.service]]) if (!(v > 0)) errors.push(`${k} must be positive`);
  if (!(s.cars.count >= 0 && Number.isInteger(s.cars.count))) errors.push('cars.count must be a whole number');
  if (!(s.bogieSpacing < s.length)) errors.push('bogieSpacing must be shorter than length');
  if (!(s.brakes.emergency >= s.brakes.service)) errors.push('brakes.emergency must be at least brakes.service');
  if (!(s.derail.lateralG > 0.05 && s.derail.lateralG < 1.5)) errors.push('derail.lateralG must be between 0.05 and 1.5');
  if (errors.length) throw new Error(`${s.name || '(unnamed)'}: ${errors.join('; ')}`);
  return s;
}

// ------------------------------------------------------------------ longitudinal model (mirrors TrainSim.luau)
const totalMass = (s) => s.mass + s.cars.count * s.cars.mass;
const totalCdA = (s) => s.resistance.cdA + s.cars.count * s.cars.cdA;

// Tractive effort (N) at speed v (m/s) for a power lever 0..1.
function tractiveEffort(s, v, lever = 1) {
  const e = s.engine;
  if (e.speedLimitKmh > 0 && Math.abs(v) * 3.6 >= e.speedLimitKmh) return 0;
  const start = e.startingTractiveEffort * 1000;
  const adhesion = e.adhesion * s.mass * G;
  const power = (e.efficiency * e.power * 1000) / Math.max(Math.abs(v), 0.1);
  return lever * Math.min(start, adhesion, power);
}

// Röckl curve resistance per unit weight (N/N) for a radius in metres (0 or Infinity = straight).
function curveResistance(radiusM) {
  if (!(radiusM > 0) || radiusM === Infinity || radiusM > 1e5) return 0;
  const r = Math.max(radiusM, 35);
  return (r >= 300 ? 650 / (r - 55) : 500 / (r - 30)) / 1000;
}

// Running resistance (N) at speed v on a grade (rise/run) and a curve radius (m).
function resistance(s, v, grade = 0, radiusM = 0) {
  const W = totalMass(s) * G;
  const r = s.resistance;
  return W * (r.rolling / 1000 + (r.speed / 1000) * Math.abs(v) + curveResistance(radiusM)) + W * grade + 0.5 * RHO_AIR * totalCdA(s) * v * v;
}

// Brake force (N) for a lever 0..1 (emergency uses the emergency rate), capped by adhesion.
function brakeForce(s, lever, emergency) {
  const M = totalMass(s);
  const decel = emergency ? s.brakes.emergency : s.brakes.service * lever;
  return Math.min(decel * M, s.brakes.adhesion * M * G);
}

function launch(s) {
  const M = totalMass(s);
  const dt = 0.05;
  let v = 0, t = 0, lever = 0, x = 0, t50 = null, t100 = null;
  for (let i = 0; i < 1800 / dt; i++) {
    lever = Math.min(1, lever + s.controls.notchRate * dt);
    const a = (tractiveEffort(s, v, lever) - resistance(s, v)) / M;
    v = Math.max(0, v + a * dt);
    x += v * dt;
    t += dt;
    if (t50 === null && v >= 50 / 3.6) t50 = { t, x };
    if (t100 === null && v >= 100 / 3.6) t100 = { t, x };
    if (t100 && t > t100.t + 1) break;
  }
  return { t50, t100 };
}

// Highest speed where tractive effort still beats resistance on a grade.
function balancingSpeed(s, grade) {
  let best = 0;
  for (let v = 0.1; v < 150; v += 0.05) {
    if (s.engine.speedLimitKmh > 0 && v * 3.6 >= s.engine.speedLimitKmh) return { kmh: s.engine.speedLimitKmh, limiter: 'speed limit' };
    if (tractiveEffort(s, v) < resistance(s, v, grade)) break;
    best = v;
  }
  return { kmh: best * 3.6, limiter: best === 0 ? 'stalls' : 'power' };
}

function rulingGrade(s) {
  const W = totalMass(s) * G;
  return (tractiveEffort(s, 0.1) - W * (s.resistance.rolling / 1000)) / W;
}

function stoppingDistance(s, kmh, emergency) {
  const M = totalMass(s);
  let v = kmh / 3.6, d = 0, t = 0;
  const dt = 0.01;
  const b = brakeForce(s, 1, emergency);
  while (v > 0 && t < 900) {
    v -= ((b + resistance(s, v)) / M) * dt;
    d += Math.max(v, 0) * dt;
    t += dt;
  }
  return { meters: d, seconds: t };
}

const derailSpeedKmh = (s, radiusM) => Math.sqrt(s.derail.lateralG * G * radiusM) * 3.6;

function report(s) {
  const M = totalMass(s);
  const W = M * G;
  const start = tractiveEffort(s, 0.1);
  const adhesion = s.engine.adhesion * s.mass * G;
  const crossover = (s.engine.efficiency * s.engine.power * 1000) / Math.min(s.engine.startingTractiveEffort * 1000, adhesion);
  const acc = launch(s);
  const top = balancingSpeed(s, 0);
  const lineKmh = Math.min(top.kmh, s.engine.speedLimitKmh || top.kmh);
  const warnings = [];
  if (start < W * 0.005) warnings.push('starting tractive effort under 0.5% of the train weight: it can barely move');
  if (s.engine.startingTractiveEffort * 1000 > adhesion * 1.05) warnings.push(`starting tractive effort ${s.engine.startingTractiveEffort} kN is past adhesion (${num(adhesion / 1000, 0)} kN): wheelslip on every start`);
  if (rulingGrade(s) < 0.01) warnings.push(`ruling grade ${num(rulingGrade(s) * 100, 1)}%: it can't start on a 1% grade; add power or fewer cars`);
  if (top.limiter === 'power' && s.engine.speedLimitKmh > 0 && top.kmh < s.engine.speedLimitKmh * 0.7) warnings.push(`only reaches ${num(top.kmh, 0)} km/h of its ${s.engine.speedLimitKmh} km/h limit`);
  return {
    type: 'Train', name: s.name, title: s.title, mass: M, consist: `${num(s.mass / 1000, 0)} t + ${s.cars.count} × ${num(s.cars.mass / 1000, 0)} t`, powerToWeight: (s.engine.power * 1000) / M,
    startingTE: start, startingAccel: (start - resistance(s, 0)) / M, crossoverKmh: crossover * 3.6, launch: acc, top,
    balance1: balancingSpeed(s, 0.01), balance2: balancingSpeed(s, 0.02), rulingGrade: rulingGrade(s),
    serviceStop: stoppingDistance(s, lineKmh, false), emergencyStop: stoppingDistance(s, lineKmh, true), lineKmh,
    derail150: derailSpeedKmh(s, 150), derail300: derailSpeedKmh(s, 300), derail600: derailSpeedKmh(s, 600), warnings,
  };
}

function printReport(r) {
  const f = num;
  const lines = [];
  lines.push(`${r.name}${r.title ? ` — ${r.title}` : ''}  [Train]`);
  lines.push(`  consist      ${r.consist} = ${f(r.mass / 1000, 0)} t · ${f(r.powerToWeight, 1)} W/kg`);
  lines.push(`  traction     ${f(r.startingTE / 1000, 0)} kN starting (${f(r.startingAccel, 2)} m/s²) · power takes over at ${f(r.crossoverKmh, 0)} km/h`);
  lines.push(`  launch       0-50 km/h ${r.launch.t50 ? `${f(r.launch.t50.t, 0)} s / ${f(r.launch.t50.x, 0)} m` : '-'} · 0-100 km/h ${r.launch.t100 ? `${f(r.launch.t100.t, 0)} s / ${f(r.launch.t100.x, 0)} m` : '-'}`);
  lines.push(`  top speed    ${f(r.top.kmh, 0)} km/h (limited by ${r.top.limiter}) · on 1%: ${f(r.balance1.kmh, 0)} km/h · on 2%: ${f(r.balance2.kmh, 0)} km/h`);
  lines.push(`  ruling grade ${f(r.rulingGrade * 100, 1)}% (steepest it can start on)`);
  lines.push(`  stopping     from ${f(r.lineKmh, 0)} km/h: ${f(r.serviceStop.meters, 0)} m service, ${f(r.emergencyStop.meters, 0)} m emergency`);
  lines.push(`  derails at   ${f(r.derail150, 0)} km/h in a 150 m curve · ${f(r.derail300, 0)} at 300 m · ${f(r.derail600, 0)} at 600 m (no cant)`);
  for (const w of r.warnings) lines.push(`  WARN ${w}`);
  return lines.join('\n');
}

module.exports = { DEFAULTS, normalize, report, printReport, totalMass, totalCdA, tractiveEffort, curveResistance, resistance, brakeForce, balancingSpeed, rulingGrade, stoppingDistance, derailSpeedKmh, launch };
