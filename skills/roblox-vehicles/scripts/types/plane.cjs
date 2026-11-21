// Airplane specs: defaults, validation and the real-world report (stall speeds, takeoff roll,
// climb, top speed, glide, turn). Aerodynamics mirror PlaneSim.luau: linear lift curve to C_Lmax,
// post-stall blend, parabolic drag polar with Mach drag rise, momentum-theory propellers, jets.
'use strict';

const { G, RHO_AIR, merge, clamp, lerp, smoothstep, num, diskThrust, propEfficiency } = require('./common.cjs');

const DEFAULTS = {
  type: 'Plane',
  title: '',
  mass: 1050, // kg
  frontWeight: 0.12, // static share on the front gear (nose wheel; ~0.9 for tail-draggers)
  comHeight: 1.3, // m above the ground on its gear
  length: 8.3, // m (inertia only)
  wing: { area: 16.2, span: 11.0, cl0: 0.3, clMax: 1.5, postStall: 0.6, cd0: 0.034, oswald: 0.8, flapsCl: 0.5, flapsCd: 0.03, cyBeta: 0.6, machDragRise: 0 },
  engine: { type: 'prop', power: 134, propDiameter: 1.9, efficiency: 0.8, staticEfficiency: 0.5, efficiencySpeedKmh: 180, thrust: 0, afterburner: 0, spool: 1.0, speedLimitKmh: 0 },
  controls: { rollRate: 90, pitchRate: 40, yawRate: 25, maxG: 3.8, minG: -1.5, maxBeta: 10 },
  assists: { stallProtection: 0.8, autoTrim: 1, autoLevel: 0.3, coordination: 1 },
  gear: { retractable: false, drag: 0.015, frequency: 2.2, dampingRatio: 0.65, maxLength: 1.2, rideHeight: 0.5, steerAngle: 30, brakeG: 0.45, grip: 0.8, rollingResistance: 0.025 },
  recovery: { autoFlip: true },
};

function normalize(raw) {
  const s = merge(DEFAULTS, raw);
  const errors = [];
  const w = s.wing, e = s.engine;
  if (!/^[A-Za-z][A-Za-z0-9_]*$/.test(s.name || '')) errors.push('name must be an identifier (letters, digits, _)');
  for (const [k, v] of [['mass', s.mass], ['wing.area', w.area], ['wing.span', w.span], ['wing.clMax', w.clMax], ['wing.cd0', w.cd0]]) if (!(v > 0)) errors.push(`${k} must be positive`);
  if (!['prop', 'jet'].includes(e.type)) errors.push('engine.type must be prop or jet');
  if (e.type === 'prop' && !(e.power > 0 && e.propDiameter > 0)) errors.push('a prop engine needs engine.power (kW) and engine.propDiameter (m)');
  if (e.type === 'jet' && !(e.thrust > 0)) errors.push('a jet engine needs engine.thrust (kN)');
  if (!(w.cl0 < w.clMax)) errors.push('wing.cl0 must be below wing.clMax');
  if (!(s.frontWeight > 0 && s.frontWeight < 1)) errors.push('frontWeight must be between 0 and 1');
  for (const k of ['stallProtection', 'autoTrim', 'autoLevel', 'coordination']) if (!(s.assists[k] >= 0 && s.assists[k] <= 1)) errors.push(`assists.${k} must be between 0 and 1`);
  if (errors.length) throw new Error(`${s.name || '(unnamed)'}: ${errors.join('; ')}`);
  return s;
}

// ------------------------------------------------------------------ aerodynamics (mirrors PlaneSim.luau)
const aspectRatio = (s) => (s.wing.span * s.wing.span) / s.wing.area;
const liftSlope = (s) => (2 * Math.PI * aspectRatio(s)) / (aspectRatio(s) + 2); // per radian
const inducedK = (s) => 1 / (Math.PI * s.wing.oswald * aspectRatio(s));

// Stall angle (rad) where the linear curve meets C_Lmax (flaps 0..1 shift the curve up).
function stallAlpha(s, flaps) {
  const w = s.wing;
  return (w.clMax + flaps * w.flapsCl - (w.cl0 + flaps * w.flapsCl * 0.9)) / liftSlope(s);
}

// Lift coefficient at angle of attack alpha (rad, -pi..pi): linear to the stall, then a blend to
// PostStall x C_Lmax over ~7 degrees, fading to zero at 90 degrees. Symmetric-ish for negative alpha.
function liftCoefficient(s, alpha, flaps) {
  const w = s.wing;
  const clMax = w.clMax + flaps * w.flapsCl;
  const cl0 = w.cl0 + flaps * w.flapsCl * 0.9;
  const a = liftSlope(s);
  const aPos = stallAlpha(s, flaps);
  const aNeg = (-0.8 * clMax - cl0) / a;
  const linear = cl0 + a * alpha;
  if (alpha >= aNeg && alpha <= aPos) return linear;
  const over = alpha > aPos ? alpha - aPos : aNeg - alpha;
  const peak = alpha > aPos ? clMax : -0.8 * clMax;
  const s1 = smoothstep(0, 0.12, over);
  const fade = 1 - smoothstep(0.5, Math.PI / 2 - Math.abs(alpha > aPos ? aPos : aNeg), over);
  return lerp(peak, peak * w.postStall, s1) * fade;
}

// Ground-effect factor on induced drag (McCormick): h = wing height above ground (m).
function groundEffect(s, h) {
  if (!(h > 0) || h > 2 * s.wing.span) return 1;
  const x = (16 * h) / s.wing.span;
  return clamp((x * x) / (1 + x * x), 0.2, 1);
}

function dragCoefficient(s, alpha, cl, flaps, gearDown, mach, ge) {
  const w = s.wing;
  const machFactor = 1 + w.machDragRise * smoothstep(0.85, 1.1, mach);
  const separated = smoothstep(stallAlpha(s, flaps), stallAlpha(s, flaps) + 0.12, Math.abs(alpha));
  return w.cd0 * machFactor + flaps * w.flapsCd + (gearDown && s.gear.retractable ? s.gear.drag : 0) + cl * cl * inducedK(s) * ge + 1.2 * Math.sin(alpha) ** 2 * separated;
}

// Engine thrust (N) at airspeed V (m/s) for a throttle 0..1 (afterburner when ab is true).
function engineThrust(s, V, throttle, rho, ab) {
  const e = s.engine;
  if (e.type === 'jet') {
    const sigma = Math.pow(rho / RHO_AIR, 0.7);
    return (ab && e.afterburner > 0 ? e.afterburner : e.thrust * throttle) * 1000 * sigma;
  }
  const area = Math.PI * (e.propDiameter / 2) ** 2;
  const eta = propEfficiency(e.staticEfficiency, e.efficiency, e.efficiencySpeedKmh / 3.6, V);
  return diskThrust(e.power * 1000 * throttle * (rho / RHO_AIR), rho, area, V, eta);
}

const stallSpeed = (s, flaps) => Math.sqrt((2 * s.mass * G) / (RHO_AIR * s.wing.area * (s.wing.clMax + flaps * s.wing.flapsCl)));

// Level-flight drag (N) at V: the C_L that carries the weight, with the polar.
function levelDrag(s, V, rho = RHO_AIR) {
  const q = 0.5 * rho * V * V;
  const cl = (s.mass * G) / (q * s.wing.area);
  if (cl > s.wing.clMax) return Infinity;
  const alpha = (cl - s.wing.cl0) / liftSlope(s);
  return q * s.wing.area * dragCoefficient(s, alpha, cl, 0, false, V / 340, 1);
}

function topSpeed(s, ab) {
  let best = 0, limiter = 'drag';
  for (let V = stallSpeed(s, 0) * 1.02; V < 900; V += 0.25) {
    if (s.engine.speedLimitKmh > 0 && V * 3.6 >= s.engine.speedLimitKmh) { best = s.engine.speedLimitKmh / 3.6; limiter = 'speed limiter'; break; }
    if (engineThrust(s, V, 1, RHO_AIR, ab) < levelDrag(s, V)) break;
    best = V;
  }
  return { kmh: best * 3.6, ms: best, limiter };
}

function climb(s, ab) {
  let best = { rate: -Infinity, kmh: 0 };
  for (let V = stallSpeed(s, 0) * 1.15; V < topSpeed(s, ab).ms; V += 0.5) {
    const rate = ((engineThrust(s, V, 1, RHO_AIR, ab) - levelDrag(s, V)) * V) / (s.mass * G);
    if (rate > best.rate) best = { rate, kmh: V * 3.6 };
  }
  return best;
}

// Takeoff ground roll with no flaps: full thrust, drag at the ground attitude (C_L0, ground
// effect), rolling resistance on the unloaded weight; rotate when the lift at 85% of the stall
// angle carries the weight.
function takeoff(s, ab) {
  const aRot = stallAlpha(s, 0) * 0.85;
  const clRot = liftCoefficient(s, aRot, 0);
  const vLof = Math.sqrt((2 * s.mass * G) / (RHO_AIR * s.wing.area * clRot));
  const hWing = s.comHeight;
  let v = 0, x = 0, t = 0;
  const dt = 0.01;
  while (v < vLof && t < 200) {
    const q = 0.5 * RHO_AIR * v * v;
    const cl = s.wing.cl0;
    const lift = q * s.wing.area * cl;
    const drag = q * s.wing.area * dragCoefficient(s, 0, cl, 0, true, v / 340, groundEffect(s, hWing));
    const roll = s.gear.rollingResistance * Math.max(0, s.mass * G - lift);
    const thrustN = s.engine.type === 'jet' ? engineThrust(s, v, 1, RHO_AIR, ab) : engineThrust(s, v, Math.min(1, t / Math.max(s.engine.spool, 0.01)), RHO_AIR, false);
    v += ((thrustN - drag - roll) / s.mass) * dt;
    x += v * dt;
    t += dt;
  }
  return { meters: x, seconds: t, liftOffKmh: vLof * 3.6 };
}

function report(s) {
  const ar = aspectRatio(s);
  const vs = stallSpeed(s, 0), vsf = stallSpeed(s, 1);
  const k = inducedK(s);
  const ldMax = 1 / (2 * Math.sqrt(s.wing.cd0 * k));
  const vMd = Math.sqrt((2 * s.mass * G) / (RHO_AIR * s.wing.area * Math.sqrt(s.wing.cd0 / k)));
  const jetAb = s.engine.type === 'jet' && s.engine.afterburner > 0;
  const top = topSpeed(s, false), topAb = jetAb ? topSpeed(s, true) : null;
  const best = climb(s, false), bestAb = jetAb ? climb(s, true) : null;
  const to = takeoff(s, jetAb);
  const va = vs * Math.sqrt(s.controls.maxG);
  const turnRate = ((G * Math.sqrt(s.controls.maxG ** 2 - 1)) / va) * (180 / Math.PI);
  const staticThrust = engineThrust(s, 0, 1, RHO_AIR, jetAb);
  const warnings = [];
  if (top.ms < vs * 1.3) warnings.push(`top speed ${num(top.kmh, 0)} km/h is barely above the stall (${num(vs * 3.6, 0)} km/h): more power or wing`);
  if (best.rate < 1.5) warnings.push(`climb rate ${num(best.rate, 1)} m/s: it will struggle to climb`);
  if (to.meters > 1500) warnings.push(`takeoff roll ${num(to.meters, 0)} m: needs a very long runway`);
  if (stallAlpha(s, 0) * (180 / Math.PI) > 30) warnings.push('stall angle above 30°: lower wing.clMax or raise wing.span');
  if (s.engine.type === 'jet' && s.engine.speedLimitKmh === 0 && (topAb || top).kmh > 1000) warnings.push(`top speed ${num((topAb || top).kmh, 0)} km/h crosses a 10k-stud map in ${num(10000 * 0.28 / (topAb || top).ms, 0)} s: consider engine.speedLimitKmh`);
  return {
    type: 'Plane', name: s.name, title: s.title, aspectRatio: ar, liftSlope: liftSlope(s), wingLoading: s.mass / s.wing.area, stallDeg: (stallAlpha(s, 0) * 180) / Math.PI,
    stallKmh: vs * 3.6, stallFlapsKmh: vsf * 3.6, top, topAb, climb: best, climbAb: bestAb, takeoff: to, ldMax, bestGlideKmh: vMd * 3.6,
    cornerKmh: va * 3.6, turnRate, staticThrust, thrustToWeight: staticThrust / (s.mass * G), warnings,
  };
}

function printReport(r) {
  const f = num;
  const lines = [];
  lines.push(`${r.name}${r.title ? ` — ${r.title}` : ''}  [Plane]`);
  lines.push(`  wing         loading ${f(r.wingLoading, 0)} kg/m² · AR ${f(r.aspectRatio, 1)} · C_Lα ${f(r.liftSlope, 2)}/rad · stalls at ${f(r.stallDeg, 1)}°`);
  lines.push(`  stall        ${f(r.stallKmh, 0)} km/h clean (${f(r.stallKmh / 1.852, 0)} kt) · ${f(r.stallFlapsKmh, 0)} km/h with flaps`);
  lines.push(`  takeoff      ${f(r.takeoff.meters, 0)} m ground roll in ${f(r.takeoff.seconds, 1)} s, lift-off ${f(r.takeoff.liftOffKmh, 0)} km/h · static thrust ${f(r.staticThrust / 1000, 1)} kN (T/W ${f(r.thrustToWeight, 2)})`);
  lines.push(`  top speed    ${f(r.top.kmh, 0)} km/h (${f(r.top.kmh / 1.852, 0)} kt, limited by ${r.top.limiter})${r.topAb ? ` · afterburner ${f(r.topAb.kmh, 0)} km/h` : ''}`);
  lines.push(`  climb        ${f(r.climb.rate, 1)} m/s (${f(r.climb.rate * 196.85, 0)} ft/min) at ${f(r.climb.kmh, 0)} km/h${r.climbAb ? ` · afterburner ${f(r.climbAb.rate, 0)} m/s` : ''}`);
  lines.push(`  glide        L/D ${f(r.ldMax, 1)} at ${f(r.bestGlideKmh, 0)} km/h`);
  lines.push(`  turn         corner speed ${f(r.cornerKmh, 0)} km/h · ${f(r.turnRate, 1)}°/s at the g limit`);
  for (const w of r.warnings) lines.push(`  WARN ${w}`);
  return lines.join('\n');
}

module.exports = { DEFAULTS, normalize, report, printReport, aspectRatio, liftSlope, inducedK, stallAlpha, liftCoefficient, groundEffect, dragCoefficient, engineThrust, stallSpeed, levelDrag, topSpeed, climb, takeoff };
