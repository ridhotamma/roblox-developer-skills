// Shared physics for the non-car vehicle types (motorcycle, boat, plane, helicopter). Node only.
// Mirrors assets/kit/shared/Vehicle/SimUtil.luau, so the report and the game agree.
'use strict';

const G = 9.81; // m/s^2: every new vehicle type lives in real gravity (the kit cancels Roblox's extra)
const RHO_AIR = 1.225; // kg/m^3 at sea level
const METERS_PER_STUD = 0.28;
const NU_WATER = 1.19e-6; // kinematic viscosity of sea water, m^2/s

function merge(base, over) {
  const out = Array.isArray(base) ? [...base] : { ...base };
  for (const [k, v] of Object.entries(over || {})) {
    out[k] = v && typeof v === 'object' && !Array.isArray(v) && base[k] && typeof base[k] === 'object' && !Array.isArray(base[k]) ? merge(base[k], v) : v;
  }
  return out;
}

const clamp = (x, a, b) => Math.min(Math.max(x, a), b);
const lerp = (a, b, t) => a + (b - a) * t;
function smoothstep(a, b, x) {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
}

// Induced velocity (m/s) of an actuator disk making thrust T (N) with axial inflow V (m/s, along
// the thrust) through area A (m^2): T = 2 rho A (V + vi) vi.
function inducedVelocity(T, rho, A, V) {
  if (T <= 0) return 0;
  const v = Math.max(V, 0);
  return -v / 2 + Math.sqrt((v * v) / 4 + T / (2 * rho * A));
}

// Thrust (N) of a propeller, rotor or water jet from shaft power P (W), by momentum theory:
// eta * P = T (V + vi). Static thrust is (2 rho A (eta P)^2)^(1/3); at speed it tends to eta P / V.
function diskThrust(P, rho, A, V, eta) {
  if (P <= 0 || A <= 0) return 0;
  const pe = eta * P;
  const v = Math.max(V, 0);
  let lo = 0;
  let hi = Math.cbrt(2 * rho * A * pe * pe) * 1.001 + 1;
  for (let i = 0; i < 24; i++) {
    const mid = (lo + hi) / 2;
    if (mid * (v + inducedVelocity(mid, rho, A, v)) > pe) hi = mid;
    else lo = mid;
  }
  return lo;
}

// Efficiency of a fixed propeller: staticEfficiency at standstill rising to efficiency by fullSpeed (m/s).
function propEfficiency(staticEff, eff, fullSpeed, V) {
  return staticEff + (eff - staticEff) * clamp(Math.max(V, 0) / Math.max(fullSpeed, 0.1), 0, 1);
}

// Air density (kg/m^3) at an altitude (m), exponential atmosphere (scale height 8500 m).
function airDensity(altitudeM) {
  return RHO_AIR * Math.exp(-Math.max(altitudeM, 0) / 8500);
}

const num = (n, d = 1) => (n === null || n === undefined || Number.isNaN(n) ? '-' : Number(n).toFixed(d));

module.exports = { G, RHO_AIR, METERS_PER_STUD, NU_WATER, merge, clamp, lerp, smoothstep, inducedVelocity, diskThrust, propEfficiency, airDensity, num };
