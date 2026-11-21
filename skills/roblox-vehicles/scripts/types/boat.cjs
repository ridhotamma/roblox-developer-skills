// Boat specs: defaults, validation and the real-world report (displacement, draft, hull speed,
// the resistance hump, planing, top speed, acceleration, heave and roll). The hull maths mirrors
// BoatSim.luau: buoyancy columns, planing lift, friction + wave + planing resistance, actuator-disk
// propulsion.
'use strict';

const { G, RHO_AIR, NU_WATER, merge, clamp, num, diskThrust, propEfficiency } = require('./common.cjs');

const DEFAULTS = {
  type: 'Boat',
  title: '',
  mass: 1800, // kg including crew and fuel
  comHeight: 0.55, // m above the keel
  hull: {
    length: 6.2, beam: 2.4, depth: 1.2, blockCoefficient: 0.4, waterDensity: 1025,
    humpRW: 0.12, waveWall: 0, trim: 4, planingSpeedKmh: 0, planingLift: 0.85, planeDraft: 0.35,
    liftBow: 0.4, prowRise: 0.5, lateralDrag: 1.2, keelAft: 0.2, bank: 1, damping: 0.4, samplesAlong: 5, samplesAcross: 3,
  },
  drive: {
    type: 'outboard', power: 186, propDiameter: 0.36, efficiency: 0.62, staticEfficiency: 0.45, efficiencySpeedKmh: 40,
    reverse: 0.4, depth: 0.45, maxSteer: 30, steerSpeed: 90, rudderArea: 0.025, idleSteer: 0.3, spool: 0.8, speedLimitKmh: 0,
  },
  recovery: { airGravity: 1.5, airControl: 0.3, autoFlip: true, selfRight: 0.6, beachPush: true },
  assists: { stability: 0.4 },
  aero: { cd: 0.5, area: 3.0 },
  body: { hullFriction: 0.15 },
};

function normalize(raw) {
  const s = merge(DEFAULTS, raw);
  const errors = [];
  const h = s.hull, d = s.drive;
  if (!/^[A-Za-z][A-Za-z0-9_]*$/.test(s.name || '')) errors.push('name must be an identifier (letters, digits, _)');
  for (const [k, v] of [['mass', s.mass], ['hull.length', h.length], ['hull.beam', h.beam], ['hull.depth', h.depth], ['drive.power', d.power], ['drive.propDiameter', d.propDiameter]]) if (!(v > 0)) errors.push(`${k} must be positive`);
  if (!['outboard', 'inboard', 'jet'].includes(d.type)) errors.push('drive.type must be outboard, inboard or jet');
  if (!(h.blockCoefficient > 0.2 && h.blockCoefficient <= 0.9)) errors.push('hull.blockCoefficient must be between 0.2 and 0.9');
  if (!(h.waveWall >= 0 && h.waveWall <= 1)) errors.push('hull.waveWall must be between 0 (planing) and 1 (displacement)');
  if (!(h.planingLift >= 0 && h.planingLift < 1)) errors.push('hull.planingLift must be between 0 and 0.99');
  if (!(h.planeDraft > 0.05 && h.planeDraft <= 1)) errors.push('hull.planeDraft must be between 0.05 and 1');
  if (!(h.samplesAlong >= 2 && h.samplesAcross >= 2)) errors.push('hull.samplesAlong and samplesAcross must be at least 2');
  if (errors.length) throw new Error(`${s.name || '(unnamed)'}: ${errors.join('; ')}`);
  if (draft(s) >= h.depth) throw new Error(`${s.name}: the hull sinks (draft ${num(draft(s), 2)} m >= depth ${h.depth} m): raise hull.depth, beam or blockCoefficient`);
  return s;
}

// ------------------------------------------------------------------ hull (mirrors BoatSim.luau)
const displacement = (s) => s.mass / s.hull.waterDensity; // m^3
const waterplaneArea = (s) => s.hull.length * s.hull.beam * s.hull.blockCoefficient; // m^2 of buoyancy columns
const draft = (s) => displacement(s) / waterplaneArea(s); // m
const wettedSurface0 = (s) => 1.7 * s.hull.length * draft(s) + displacement(s) / draft(s); // Mumford, m^2
const planingSpeed = (s) => (s.hull.planingSpeedKmh > 0 ? s.hull.planingSpeedKmh / 3.6 : 1.2 * Math.sqrt(G * s.hull.length)); // m/s

// Wave-making resistance per unit weight at displacement draft: x^4 up to the hump (Fn 0.5),
// then 2x^4/(1+x^6) (peaks at Fn 0.56 and falls) for planing hulls, x^4 (a wall) for displacement.
function waveBump(s, fn) {
  const x = fn / 0.5;
  const x4 = x * x * x * x;
  if (x <= 1) return x4;
  return (2 * x4) / (1 + x4 * x * x) + (x4 - (2 * x4) / (1 + x4 * x * x)) * s.hull.waveWall;
}

function frictionCoefficient(v, L) {
  const re = Math.max((Math.abs(v) * L) / NU_WATER, 1e5);
  const lg = Math.log10(re) - 2;
  return 0.075 / (lg * lg);
}

// Steady-state immersion (draft share 0..1) at forward speed v, from buoyancy + planing lift:
// lift per column = planingLift W min(v/Vp, 1)^2 min(d / (planeDraft T), 1). Past full planing
// speed the lift stops growing: the hull settles at the wetted length that carries its weight.
function steadyImmersion(s, v) {
  const x2 = Math.min(Math.max(v, 0) / planingSpeed(s), 1) ** 2;
  const pl = s.hull.planingLift, pd = s.hull.planeDraft;
  const d1 = 1 - pl * x2;
  if (d1 >= pd) return d1;
  return 1 / (1 + (pl * x2) / pd);
}

// Resistance (N) at forward speed v (m/s) for a planing share `lift` (dynamic lift / weight) and
// immersion (d / T), as the sim measures them each step.
function resistanceParts(s, v, lift, immersion) {
  const W = s.mass * G;
  const fn = Math.abs(v) / Math.sqrt(G * s.hull.length);
  const wet = wettedSurface0(s) * (0.25 + 0.75 * clamp(immersion, 0, 1.5));
  const friction = 0.5 * s.hull.waterDensity * v * v * wet * frictionCoefficient(v, s.hull.length);
  const wave = W * s.hull.humpRW * waveBump(s, fn) * (1 - clamp(lift, 0, 1));
  const planing = W * clamp(lift, 0, 1) * Math.tan((s.hull.trim * Math.PI) / 180);
  return { friction, wave, planing, total: friction + wave + planing };
}

function airDrag(s, v) {
  return 0.5 * RHO_AIR * s.aero.cd * s.aero.area * v * v;
}

function resistance(s, v) {
  const imm = steadyImmersion(s, v);
  const parts = resistanceParts(s, v, 1 - imm, imm);
  return { ...parts, air: airDrag(s, v), total: parts.total + airDrag(s, v), immersion: imm };
}

// Propulsion thrust (N) at forward speed v for a throttle 0..1 (negative = reverse).
function thrust(s, v, throttle) {
  const d = s.drive;
  if (d.speedLimitKmh > 0 && v * 3.6 >= d.speedLimitKmh && throttle > 0) return 0;
  const area = Math.PI * (d.propDiameter / 2) ** 2;
  const eta = propEfficiency(d.staticEfficiency, d.efficiency, d.efficiencySpeedKmh / 3.6, throttle >= 0 ? v : -v);
  const power = Math.abs(throttle) * d.power * 1000 * (throttle < 0 ? d.reverse : 1);
  const t = diskThrust(power, s.hull.waterDensity, area, throttle >= 0 ? v : -v, eta);
  return throttle < 0 ? -t : t;
}

function topSpeed(s) {
  let best = 0, limiter = 'resistance';
  let humpBlocked = false;
  for (let v = 0.05; v < 80; v += 0.05) {
    if (s.drive.speedLimitKmh > 0 && v * 3.6 >= s.drive.speedLimitKmh) { best = s.drive.speedLimitKmh / 3.6; limiter = 'speed limiter'; break; }
    if (thrust(s, v, 1) <= resistance(s, v).total) {
      const fn = v / Math.sqrt(G * s.hull.length);
      humpBlocked = fn > 0.35 && fn < 0.75;
      break;
    }
    best = v;
  }
  if (humpBlocked) limiter = s.hull.waveWall > 0.5 ? 'hull speed (wave wall)' : 'the hump (not enough power to plane)';
  return { kmh: best * 3.6, ms: best, limiter };
}

function launch(s) {
  const dt = 0.01;
  let v = 0, t = 0, t30 = null, t50 = null, tPlane = null;
  const vp = planingSpeed(s) * 0.85;
  for (let i = 0; i < 120 / dt; i++) {
    const throttle = Math.min(1, t / Math.max(s.drive.spool, 0.01));
    const a = (thrust(s, v, throttle) - resistance(s, v).total) / s.mass;
    v = Math.max(0, v + a * dt);
    t += dt;
    if (t30 === null && v >= 30 / 3.6) t30 = t;
    if (t50 === null && v >= 50 / 3.6) t50 = t;
    if (tPlane === null && v >= vp) tPlane = t;
  }
  return { t30, t50, tPlane };
}

function stability(s) {
  const T = draft(s), B = s.hull.beam, L = s.hull.length;
  // Sample grid (BoatSim): across positions +-0.35 B, along +-0.4 L; mean y^2 and x^2 per column.
  const meanSq = (n, half) => { let a = 0; for (let k = 0; k < n; k++) { const y = (k / (n - 1) - 0.5) * 2 * half; a += y * y; } return a / n; };
  const bm = (waterplaneArea(s) * meanSq(s.hull.samplesAcross, 0.35 * B)) / displacement(s);
  const gm = T / 2 + bm - s.comHeight;
  const rollGyration = Math.sqrt(((0.8 * B) ** 2 + (0.6 * s.hull.depth) ** 2) / 12);
  const heave = 2 * Math.PI * Math.sqrt(s.mass / (s.hull.waterDensity * G * waterplaneArea(s)));
  const roll = gm > 0 ? (2 * Math.PI * rollGyration) / Math.sqrt(G * gm) : null;
  return { gm, bm, heave, roll };
}

function report(s) {
  const T = draft(s);
  const L = s.hull.length;
  const hullSpeed = 0.4 * Math.sqrt(G * L);
  const humpSpeed = 0.56 * Math.sqrt(G * L);
  const hump = resistance(s, humpSpeed);
  const top = topSpeed(s);
  const acc = launch(s);
  const st = stability(s);
  const staticThrust = thrust(s, 0, 1);
  const warnings = [];
  if (st.gm < 0.15) warnings.push(`GM ${num(st.gm, 2)} m: tender, rolls far and can capsize; lower comHeight or widen the beam`);
  if (T > s.hull.depth * 0.7) warnings.push(`draft ${num(T, 2)} m is ${num((T / s.hull.depth) * 100, 0)}% of the hull depth: little freeboard, waves will swamp it`);
  if (top.limiter.startsWith('the hump')) warnings.push('not enough power to get over the hump and plane: raise drive.power or lower mass / hull.humpRW');
  if (staticThrust / (s.mass * G) < 0.08 && s.hull.waveWall < 0.5) warnings.push('static thrust under 0.08 g: sluggish start');
  if (s.drive.depth < 0.05) warnings.push('drive.depth near 0: the prop leaves the water at the slightest pitch');
  return {
    type: 'Boat', name: s.name, title: s.title, displacement: displacement(s), draft: T, waterplane: waterplaneArea(s), wetted: wettedSurface0(s),
    hullSpeedKmh: hullSpeed * 3.6, humpSpeedKmh: humpSpeed * 3.6, humpRW: hump.total / (s.mass * G), planingSpeedKmh: planingSpeed(s) * 3.6,
    staticThrust, staticThrustG: staticThrust / (s.mass * G), top, launch: acc, stability: st, powerToWeight: (s.drive.power * 1000) / s.mass, warnings,
  };
}

function printReport(r) {
  const f = num;
  const lines = [];
  lines.push(`${r.name}${r.title ? ` — ${r.title}` : ''}  [Boat]`);
  lines.push(`  hull         displacement ${f(r.displacement, 2)} m³ · draft ${f(r.draft, 2)} m · waterplane ${f(r.waterplane, 1)} m² · wetted ${f(r.wetted, 1)} m²`);
  lines.push(`  speeds       hull speed ${f(r.hullSpeedKmh, 0)} km/h · hump ${f(r.humpSpeedKmh, 0)} km/h at R/W ${f(r.humpRW, 3)} · full planing ${f(r.planingSpeedKmh, 0)} km/h`);
  lines.push(`  thrust       static ${f(r.staticThrust / 1000, 2)} kN (${f(r.staticThrustG, 2)} g) · ${f(r.powerToWeight, 0)} W/kg`);
  lines.push(`  top speed    ${f(r.top.kmh, 0)} km/h (${f(r.top.kmh / 1.852, 0)} kn, limited by ${r.top.limiter})`);
  lines.push(`  launch       0-30 km/h ${f(r.launch.t30, 1)} s · 0-50 km/h ${f(r.launch.t50, 1)} s · on the plane ${f(r.launch.tPlane, 1)} s`);
  lines.push(`  stability    GM ${f(r.stability.gm, 2)} m · heave period ${f(r.stability.heave, 2)} s · roll period ${f(r.stability.roll, 2)} s`);
  for (const w of r.warnings) lines.push(`  WARN ${w}`);
  return lines.join('\n');
}

module.exports = { DEFAULTS, normalize, report, printReport, displacement, waterplaneArea, draft, wettedSurface0, planingSpeed, waveBump, frictionCoefficient, steadyImmersion, resistanceParts, resistance, airDrag, thrust, topSpeed };
