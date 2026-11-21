// Helicopter specs: defaults, validation and the real-world report (disk loading, hover power in
// and out of ground effect, climb, the power bucket, top speed). Rotor maths mirrors HeliSim.luau:
// momentum theory with Glauert's forward-flight inflow, blade profile power, tail rotor share,
// Cheeseman-Bennett ground effect and a retreating-blade-stall limit.
'use strict';

const { G, RHO_AIR, merge, clamp, smoothstep, num } = require('./common.cjs');

const DEFAULTS = {
  type: 'Helicopter',
  title: '',
  mass: 1360, // kg
  comHeight: 1.4, // m above the skid bottoms / ground
  frontWeight: 0.5, // wheels only
  length: 9.5, // m (inertia only)
  rotor: { diameter: 10.16, tipSpeed: 210, solidity: 0.042, profileCd: 0.011, inducedFactor: 1.15, tailPower: 0.1, spoolTime: 6, bladeStallMu: 0.38, heaveDamping: 0.4, hubHeight: 2.9 },
  engine: { power: 236 },
  fuselage: { dragArea: 1.1, sideArea: 7, topArea: 10 },
  controls: { pitchRate: 50, rollRate: 70, yawRate: 60, maxPitch: 28, maxBank: 35, climbRate: 6, descentRate: 5 },
  assists: { altitudeHold: 1, level: 1, hoverHold: 0.6, coordination: 0.8, weathervane: 0.5 },
  realism: { groundEffect: 1, vortexRing: 0 },
  gear: { frequency: 2.5, dampingRatio: 0.7, maxLength: 0.8, rideHeight: 0.5, grip: 0.8, rollingResistance: 0.03, brakeG: 0.3 },
  recovery: { autoFlip: true },
};

function normalize(raw) {
  const s = merge(DEFAULTS, raw);
  const errors = [];
  if (!/^[A-Za-z][A-Za-z0-9_]*$/.test(s.name || '')) errors.push('name must be an identifier (letters, digits, _)');
  for (const [k, v] of [['mass', s.mass], ['rotor.diameter', s.rotor.diameter], ['rotor.tipSpeed', s.rotor.tipSpeed], ['engine.power', s.engine.power]]) if (!(v > 0)) errors.push(`${k} must be positive`);
  for (const k of ['altitudeHold', 'level', 'hoverHold', 'coordination', 'weathervane']) if (!(s.assists[k] >= 0 && s.assists[k] <= 1)) errors.push(`assists.${k} must be between 0 and 1`);
  if (errors.length) throw new Error(`${s.name || '(unnamed)'}: ${errors.join('; ')}`);
  return s;
}

// ------------------------------------------------------------------ rotor (mirrors HeliSim.luau)
const diskArea = (s) => Math.PI * (s.rotor.diameter / 2) ** 2;

// Induced velocity (m/s) for thrust T with in-plane speed vx and axial speed vz (+ = climbing,
// air flowing down through the disk), Glauert's formula solved by damped fixed-point iteration.
// Descents faster than the wake are clamped (momentum theory breaks down there: vortex ring).
function inducedVelocity(T, rho, A, vx, vz) {
  if (T <= 0) return 0;
  const vh2 = T / (2 * rho * A);
  const vh = Math.sqrt(vh2);
  let vi = vh;
  for (let i = 0; i < 12; i++) {
    const through = Math.max(vz + vi, 0.25 * vh);
    const next = vh2 / Math.sqrt(vx * vx + through * through);
    vi = 0.5 * vi + 0.5 * next;
  }
  return vi;
}

// Shaft power (W) for thrust T in a flight condition (vx in-plane, vz axial along the thrust).
function powerRequired(s, T, rho, vx, vz) {
  const r = s.rotor;
  const A = diskArea(s);
  const mu = Math.abs(vx) / r.tipSpeed;
  const vi = inducedVelocity(T, rho, A, vx, vz);
  const induced = r.inducedFactor * T * vi;
  const profile = ((r.solidity * r.profileCd) / 8) * rho * A * r.tipSpeed ** 3 * (1 + 4.65 * mu * mu);
  const axial = T * vz; // climbing, and the parasite power of the tilted disk in forward flight
  return Math.max(0, (induced + profile) * (1 + r.tailPower) + axial);
}

// Largest thrust (N) whose power fits `power` (W).
function maxThrust(s, rho, vx, vz, power) {
  let lo = 0, hi = s.mass * G * 4;
  if (powerRequired(s, 0, rho, vx, vz) >= power) return 0;
  for (let i = 0; i < 24; i++) {
    const mid = (lo + hi) / 2;
    if (powerRequired(s, mid, rho, vx, vz) > power) hi = mid;
    else lo = mid;
  }
  return lo;
}

// Thrust multiplier in ground effect at rotor height z (m) above the ground (Cheeseman-Bennett).
function groundEffect(s, z) {
  const R = s.rotor.diameter / 2;
  if (!(z > 0)) return 1 + 0.26 * s.realism.groundEffect;
  const zz = Math.max(z, 0.55 * R);
  const k = 1 / (1 - (R / (4 * zz)) ** 2);
  return 1 + (k - 1) * s.realism.groundEffect;
}

// Thrust kept at an advance ratio (retreating blade stall past bladeStallMu).
function bladeStall(s, mu) {
  return 1 - 0.6 * smoothstep(s.rotor.bladeStallMu, s.rotor.bladeStallMu + 0.1, mu);
}

const fuselageDrag = (s, V, rho = RHO_AIR) => 0.5 * rho * s.fuselage.dragArea * V * V;

// Level-flight power at speed V: thrust tilts to balance drag, its axial component does D V.
function levelPower(s, V) {
  const W = s.mass * G;
  const D = fuselageDrag(s, V);
  const T = Math.hypot(W, D);
  const tilt = Math.atan2(D, W);
  return { power: powerRequired(s, T, RHO_AIR, V * Math.cos(tilt), V * Math.sin(tilt)), thrust: T, tilt };
}

function report(s) {
  const W = s.mass * G;
  const A = diskArea(s);
  const P = s.engine.power * 1000;
  const vh = Math.sqrt(W / (2 * RHO_AIR * A));
  const hoverOge = powerRequired(s, W, RHO_AIR, 0, 0);
  const ge = groundEffect(s, s.rotor.hubHeight);
  const hoverIge = powerRequired(s, W / ge, RHO_AIR, 0, 0);
  // Vertical climb: largest vz whose power fits.
  let lo = 0, hi = 60;
  for (let i = 0; i < 30; i++) { const mid = (lo + hi) / 2; if (powerRequired(s, W, RHO_AIR, 0, mid) > P) hi = mid; else lo = mid; }
  const verticalClimb = hoverOge > P ? 0 : lo;
  // Bucket and top speed.
  let bucket = { power: Infinity, kmh: 0 }, top = { kmh: 0, limiter: 'power' };
  for (let V = 0; V < 120; V += 0.25) {
    const lp = levelPower(s, V);
    if (lp.power < bucket.power) bucket = { power: lp.power, kmh: V * 3.6 };
    const mu = V / s.rotor.tipSpeed;
    const stallOk = W <= maxThrust(s, RHO_AIR, V, V * Math.sin(lp.tilt), P) * bladeStall(s, mu) && bladeStall(s, mu) > 0.97;
    if (lp.power > P) { top.limiter = 'power'; break; }
    if (!stallOk) { top.limiter = 'retreating blade stall'; break; }
    top.kmh = V * 3.6;
  }
  const bestClimb = Math.max(0, (P - bucket.power) / W);
  const warnings = [];
  if (hoverOge > P) warnings.push(`can't hover out of ground effect: needs ${num(hoverOge / 1000, 0)} kW, has ${s.engine.power} kW`);
  if (hoverIge > P) warnings.push("can't even hover in ground effect: it will never lift off");
  if (P / hoverOge > 2.2) warnings.push(`power is ${num(P / hoverOge, 1)}× hover power: rocket-like; fine for arcade, unrealistic otherwise`);
  if (W / A > 600) warnings.push(`disk loading ${num(W / A, 0)} N/m²: very high, huge downwash and hover power`);
  return {
    type: 'Helicopter', name: s.name, title: s.title, diskArea: A, diskLoading: W / A, vh, hoverOge, hoverIge, groundEffect: ge, power: P,
    margin: P / hoverOge - 1, verticalClimb, bucket, bestClimb, top, warnings,
  };
}

function printReport(r) {
  const f = num;
  const lines = [];
  lines.push(`${r.name}${r.title ? ` — ${r.title}` : ''}  [Helicopter]`);
  lines.push(`  rotor        disk ${f(r.diskArea, 0)} m² · loading ${f(r.diskLoading, 0)} N/m² · hover downwash vh ${f(r.vh, 1)} m/s`);
  lines.push(`  hover        ${f(r.hoverOge / 1000, 0)} kW out of ground effect · ${f(r.hoverIge / 1000, 0)} kW in it (×${f(r.groundEffect, 2)} thrust) · ${f(r.power / 1000, 0)} kW available (${r.margin >= 0 ? '+' : ''}${f(r.margin * 100, 0)}%)`);
  lines.push(`  climb        ${f(r.verticalClimb, 1)} m/s vertical · ${f(r.bestClimb, 1)} m/s at ${f(r.bucket.kmh, 0)} km/h (minimum-power speed, ${f(r.bucket.power / 1000, 0)} kW)`);
  lines.push(`  top speed    ${f(r.top.kmh, 0)} km/h (${f(r.top.kmh / 1.852, 0)} kt, limited by ${r.top.limiter})`);
  for (const w of r.warnings) lines.push(`  WARN ${w}`);
  return lines.join('\n');
}

module.exports = { DEFAULTS, normalize, report, printReport, diskArea, inducedVelocity, powerRequired, maxThrust, groundEffect, bladeStall, fuselageDrag, levelPower };
