// Test scenarios for the motorcycle, boat, plane and helicopter sims. Each test builds a world,
// flies or drives the ported kit with a scripted pilot, records frames for replay, and compares
// against the spec report (rveh.cjs) or the skill's stated behaviour.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./physics.js'), require('./airsea.js'));
  else root.AirSeaTests = factory(root.VehicleLab, root.AirSeaLab);
})(typeof self !== 'undefined' ? self : this, function (Lab, A) {
  'use strict';
  const { V, M, World, clamp } = Lab;
  const MPS = 0.28, DT = 1 / 60;
  const f = (x, d = 1) => (x === null || x === undefined || Number.isNaN(x) ? '—' : Number(x).toFixed(d));
  const hold = (target, gain = 0.1) => (tel) => clamp((target - tel.speedKmh) * gain, -1, 1);

  function flatWorld(size = 20000) { const w = new World(); w.box('Ground', [0, -5, 0], [size, 10, size], M.I(), { color: 0x3b4252 }); return w; }
  function seaWorld(waves = 0) { const w = new World(); w.box('Seabed', [0, -80, 0], [20000, 10, 20000], M.I(), { color: 0x2e3440 }); w.water = { level: 0, waveHeight: waves, waveLength: 30, waveDirection: 20 }; return w; }

  function drive(rig, seconds, ctrl, rec, stopIf) {
    let tel = rig.telemetry || {};
    const n = Math.round(seconds / DT);
    for (let i = 0; i < n; i++) {
      const t = i * DT;
      const input = ctrl(t, tel, rig);
      tel = rig.frame(DT, input);
      if (rec && i % 3 === 0) rec.push(frame(rig, tel, input));
      if (stopIf && stopIf(t, tel, rig)) break;
    }
    return tel;
  }
  function frame(rig, tel, input) {
    const b = rig.body;
    return { t: +rig.clock.toFixed(3), p: b.pos.map((x) => +x.toFixed(3)), q: b.q.map((x) => +x.toFixed(5)), tel: Object.fromEntries(Object.entries(tel).filter(([, v]) => typeof v === 'number' || typeof v === 'boolean').map(([k, v]) => [k, typeof v === 'number' ? +v.toFixed(3) : v])), in: input };
  }
  const result = (pass, measured, expected, frames, world) => ({ pass: !!pass, measured, expected, frames, world });
  const altitude = (rig) => rig.body.pos[1] * MPS;

  const TESTS = [];
  const test = (type, id, title, fn) => TESTS.push({ type, id, title, fn });

  // ------------------------------------------------------------------ Motorcycle
  test('Motorcycle', 'bike-settle', 'Stands upright at rest with a rider', (spec) => {
    const w = flatWorld(); const k = new A.Bike(w, spec); const fr = [];
    let maxLean = 0; drive(k, 4, () => ({}), fr, (t, tel) => { if (t > 0.5) maxLean = Math.max(maxLean, Math.abs(tel.lean)); });
    return result(maxLean < 2 && !k.telemetry.crashed, `max lean ${f(maxLean)}°`, '< 2°', fr, w);
  });
  test('Motorcycle', 'bike-launch', '0-100 km/h matches the report', (spec, rep) => {
    const w = flatWorld(); const k = new A.Bike(w, spec); const fr = []; let t100 = null; let maxPitch = 0;
    drive(k, 12, () => ({ throttle: 1 }), fr, (t, tel) => { maxPitch = Math.max(maxPitch, tel.pitch); if (t100 === null && tel.speedKmh >= 100) t100 = t; return t100 !== null && t > t100 + 1; });
    const ok = t100 !== null && Math.abs(t100 - rep.launch.t100) <= rep.launch.t100 * 0.2 && maxPitch < 25;
    return result(ok, `${f(t100, 2)} s, front up ≤ ${f(maxPitch)}°`, `${f(rep.launch.t100, 2)} s ±20%, no wheelie flip`, fr, w);
  });
  test('Motorcycle', 'bike-top', 'Reaches the report top speed', (spec, rep) => {
    const w = flatWorld(60000); const k = new A.Bike(w, spec); const fr = [];
    const tel = drive(k, 60, () => ({ throttle: 1 }), fr);
    return result(tel.speedKmh >= rep.top.kmh * 0.93 && tel.speedKmh <= rep.top.kmh * 1.03, `${f(tel.speedKmh, 0)} km/h`, `${f(rep.top.kmh, 0)} km/h (−7% / +3%)`, fr.filter((_, i) => i % 4 === 0), w);
  });
  test('Motorcycle', 'bike-brake', '100-0 km/h distance matches the report, no flip', (spec, rep) => {
    const w = flatWorld(); const k = new A.Bike(w, spec); const fr = [];
    drive(k, 10, (t, tel) => ({ throttle: hold(100, 0.3)(tel) }), fr, (t, tel) => tel.speedKmh >= 100);
    const start = k.body.pos.slice(); let minPitch = 0;
    const tel = drive(k, 8, () => ({ throttle: -1 }), fr, (t, tel) => { minPitch = Math.min(minPitch, tel.pitch); return tel.speedKmh < 0.5; });
    const d = V.len(V.sub(k.body.pos, start)) * MPS;
    return result(Math.abs(d - rep.brake.meters) <= rep.brake.meters * 0.25 && minPitch > -30 && !tel.crashed, `${f(d)} m, rear up ${f(-minPitch)}°`, `${f(rep.brake.meters)} m ±25%, no flip`, fr, w);
  });
  test('Motorcycle', 'bike-turn', 'Steady turn leans to balance (tan φ = v ω / g)', (spec) => {
    const w = flatWorld(); const k = new A.Bike(w, spec); const fr = [];
    drive(k, 8, (t, tel) => ({ throttle: hold(70, 0.2)(tel) }), fr);
    let n = 0, lean = 0, ideal = 0;
    drive(k, 8, (t, tel) => ({ throttle: hold(70, 0.2)(tel), steer: 1 }), fr, (t, tel, rig) => { if (t > 4) { n++; lean += tel.lean; ideal += (Math.atan(((tel.speedKmh / 3.6) * -rig.body.w[1]) / 9.81) * 180) / Math.PI; } });
    lean /= n; ideal /= n;
    const ok = lean > spec.steering.maxLean * 0.6 && Math.abs(lean - ideal) < 8 && !k.telemetry.crashed;
    return result(ok, `lean ${f(lean)}°, balanced ${f(ideal)}°`, `> ${f(spec.steering.maxLean * 0.6, 0)}°, within 8° of balance`, fr, w);
  });
  test('Motorcycle', 'bike-slalom', 'Keyboard slalom at 70 km/h stays up', (spec) => {
    const w = flatWorld(); const k = new A.Bike(w, spec); const fr = [];
    drive(k, 6, (t, tel) => ({ throttle: hold(70, 0.2)(tel) }), fr);
    let maxLean = 0, maxSlip = 0;
    const tel = drive(k, 12, (t, tel) => ({ throttle: hold(70, 0.2)(tel), steer: Math.floor(t / 1.3) % 2 ? 1 : -1 }), fr, (t, tel) => { maxLean = Math.max(maxLean, Math.abs(tel.lean)); maxSlip = Math.max(maxSlip, tel.slip); });
    return result(!tel.crashed && maxLean < spec.steering.maxLean + 8 && tel.speedKmh > 50, `max lean ${f(maxLean)}°, ${f(tel.speedKmh, 0)} km/h at the end`, 'no crash, lean within the limit', fr, w);
  });
  test('Motorcycle', 'bike-brake-lean', 'Braking hard in a lean does not spin it (cornering ABS)', (spec) => {
    const w = flatWorld(); const k = new A.Bike(w, spec); const fr = [];
    drive(k, 6, (t, tel) => ({ throttle: hold(80, 0.2)(tel) }), fr);
    drive(k, 4, (t, tel) => ({ throttle: hold(80, 0.2)(tel), steer: 1 }), fr);
    let maxYaw = 0;
    const tel = drive(k, 6, () => ({ throttle: -1, steer: 1 }), fr, (t, tel, rig) => { maxYaw = Math.max(maxYaw, Math.abs(rig.body.w[1])); return tel.speedKmh < 1; });
    return result(maxYaw < 2.2 && !tel.crashed && tel.speedKmh > -3, `max yaw ${f(maxYaw, 2)} rad/s`, '< 2.2 rad/s (a tightening turn, not a spin)', fr, w);
  });
  test('Motorcycle', 'bike-wheelie', 'Lean back + throttle holds a wheelie at the balance point', (spec) => {
    const w = flatWorld(); const k = new A.Bike(w, spec); const fr = [];
    drive(k, 5, (t, tel) => ({ throttle: hold(35, 0.3)(tel) }), fr);
    let up = 0, maxPitch = 0, sum = 0, n = 0;
    drive(k, 6, (t, tel) => ({ throttle: tel.pitch > spec.wheelie.balanceAngle ? 0.3 : 1, lean: -1 }), fr, (t, tel) => { maxPitch = Math.max(maxPitch, tel.pitch); if (tel.wheelie) { up += DT; if (t > 2) { sum += tel.pitch; n++; } } });
    const avg = n ? sum / n : 0;
    const ok = up > 2 && maxPitch < spec.wheelie.balanceAngle + 20 && Math.abs(avg - spec.wheelie.balanceAngle) < 12 && !k.telemetry.crashed;
    return result(ok, `${f(up, 1)} s on one wheel at ~${f(avg)}° (max ${f(maxPitch)}°)`, `> 2 s near ${spec.wheelie.balanceAngle}°, never past ${spec.wheelie.balanceAngle + 20}°`, fr, w);
  });
  test('Motorcycle', 'bike-jump', 'Ramp jump lands upright', (spec) => {
    const w = flatWorld(); const ang = (12 * Math.PI) / 180;
    w.box('Ramp', [0, Math.sin(ang) * 10 - 0.6, -150], [10, 1.2, 20], M.rotX(ang), { color: 0xd08770 });
    const k = new A.Bike(w, spec); const fr = [];
    let air = 0, landed = false;
    const tel = drive(k, 14, (t, tel) => ({ throttle: hold(90, 0.2)(tel) }), fr, (t, tel) => { if (tel.grounded === 0) air += DT; if (air > 0.3 && tel.grounded === 2) landed = true; return landed && t > 9; });
    return result(air > 0.3 && !tel.crashed && Math.abs(tel.lean) < 15, `${f(air, 2)} s airborne, lean ${f(tel.lean)}°`, 'airborne, lands upright', fr, w);
  });
  test('Motorcycle', 'bike-parked', 'Riderless bike stands on its kickstand', (spec) => {
    const w = flatWorld(); const k = new A.Bike(w, spec); const fr = [];
    const tel = drive(k, 5, () => ({ rider: false }), fr);
    return result(tel.lean < -3 && tel.lean > -20 && tel.grounded === 2, `lean ${f(tel.lean)}°`, 'leaning on the stand (−3° … −20°)', fr, w);
  });
  test('Motorcycle', 'bike-crash', 'Hitting a wall throws the rider (Crashed)', (spec) => {
    const w = flatWorld(); w.box('Wall', [0, 6, -260], [60, 12, 4], M.I(), { color: 0xbf616a });
    const k = new A.Bike(w, spec); const fr = [];
    const tel = drive(k, 12, (t, tel) => ({ throttle: hold(60, 0.3)(tel) }), fr, (t, tel) => tel.crashed);
    return result(tel.crashed, tel.crashed ? 'crashed' : 'still riding', 'Crashed telemetry', fr, w);
  });

  // ------------------------------------------------------------------ Boat
  test('Boat', 'boat-float', 'Floats level at the spec draft, heave settles', (spec, rep) => {
    const w = seaWorld(); const b = new A.Boat(w, spec, { height: (spec.comHeight - rep.draft) / MPS + 1 }); const fr = [];
    const tel = drive(b, 8, () => ({}), fr);
    const ok = Math.abs(tel.draft - rep.draft) < rep.draft * 0.12 && Math.abs(tel.trim) < 1.5 && Math.abs(b.body.v[1] * MPS) < 0.05;
    return result(ok, `draft ${f(tel.draft, 3)} m, trim ${f(tel.trim)}°`, `${f(rep.draft, 3)} m ±12%, level, settled`, fr, w);
  });
  test('Boat', 'boat-launch', 'Acceleration matches the report', (spec, rep) => {
    const w = seaWorld(); const b = new A.Boat(w, spec); const fr = [];
    const target = rep.launch.t50 !== null ? 50 : 10;
    const expect = rep.launch.t50 !== null ? rep.launch.t50 : null;
    let t = null; drive(b, 30, () => ({ throttle: 1 }), fr, (tt, tel) => { if (t === null && tel.speedKmh >= target) t = tt; return t !== null; });
    if (expect === null) return result(t !== null && t < 30, `0-${target} km/h ${f(t, 1)} s`, `reaches ${target} km/h`, fr, w);
    return result(t !== null && Math.abs(t - expect) <= expect * 0.3, `0-50 km/h ${f(t, 1)} s`, `${f(expect, 1)} s ±30%`, fr, w);
  });
  test('Boat', 'boat-top', 'Top speed matches the report', (spec, rep) => {
    const w = seaWorld(); const b = new A.Boat(w, spec); const fr = [];
    const tel = drive(b, 60, () => ({ throttle: 1 }), fr);
    return result(Math.abs(tel.speedKmh - rep.top.kmh) <= rep.top.kmh * 0.1, `${f(tel.speedKmh, 0)} km/h, planing ${f(tel.planing * 100, 0)}%`, `${f(rep.top.kmh, 0)} km/h ±10%`, fr.filter((_, i) => i % 3 === 0), w);
  });
  test('Boat', 'boat-plane', 'Rises onto the plane: less hull in the water, bow up over the hump', (spec, rep) => {
    const w = seaWorld(); const b = new A.Boat(w, spec); const fr = [];
    if (spec.hull.planingLift <= 0) {
      const tel = drive(b, 40, () => ({ throttle: 1 }), fr);
      return result(tel.speedKmh <= rep.hullSpeedKmh * 1.3, `${f(tel.speedKmh, 1)} km/h, stays in the water`, `displacement hull: held near hull speed (${f(rep.hullSpeedKmh, 0)} km/h)`, fr, w);
    }
    let maxTrim = -Infinity;
    const tel = drive(b, 30, () => ({ throttle: 1 }), fr, (t, tel) => { maxTrim = Math.max(maxTrim, tel.trim); });
    const ok = tel.immersion < 0.6 && tel.planing > 0.5 && maxTrim > 1.5 && maxTrim < 12;
    return result(ok, `immersion ${f(tel.immersion * 100, 0)}% of draft, ${f(tel.planing * 100, 0)}% carried by planing lift, peak bow-up ${f(maxTrim)}°`, '< 60% immersed, > 50% planing lift, bow rises 1.5–12°', fr.filter((_, i) => i % 2 === 0), w);
  });
  test('Boat', 'boat-turn', 'Full-lock turn at speed: turns, banks the right way, no capsize', (spec) => {
    const w = seaWorld(); const b = new A.Boat(w, spec); const fr = [];
    drive(b, 25, () => ({ throttle: 1 }), fr);
    let yaw = 0, n = 0, heel = 0, maxHeel = 0;
    const tel = drive(b, 12, () => ({ throttle: 1, steer: 1 }), fr, (t, tel, rig) => { if (t > 4) { yaw += -rig.body.w[1]; heel += tel.heel; n++; } maxHeel = Math.max(maxHeel, Math.abs(tel.heel)); });
    yaw /= n; heel /= n;
    const radius = tel.speedKmh / 3.6 / yaw;
    const inward = spec.hull.bank > 0 ? heel > 0.5 : heel < 1;
    const v = tel.speedKmh / 3.6, limit = Math.max(spec.hull.length * 12, (v * v) / (0.35 * 9.81));
    const ok = yaw > 0.05 && radius < limit && maxHeel < 35 && inward;
    return result(ok, `radius ${f(radius, 0)} m at ${f(tel.speedKmh, 0)} km/h (${f((v * yaw) / 9.81, 2)} g), heel ${f(heel)}° (max ${f(maxHeel)}°)`, `turns right, radius < ${f(limit, 0)} m (12 lengths or 0.35 g), ${spec.hull.bank > 0 ? 'banks in' : 'no inward bank'}, heel < 35°`, fr, w);
  });
  test('Boat', 'boat-waves', '1.5 m waves at speed: no capsize, keeps going', (spec) => {
    const w = seaWorld(1.5); const b = new A.Boat(w, spec); const fr = [];
    let maxHeel = 0, air = 0;
    const tel = drive(b, 30, (t) => ({ throttle: 1, steer: Math.sin(t * 0.4) * 0.5 }), fr, (t, tel) => { maxHeel = Math.max(maxHeel, Math.abs(tel.heel)); if (tel.airborne) air += DT; });
    return result(maxHeel < 80 && Math.abs(tel.heel) < 20 && tel.speedKmh > 5, `max heel ${f(maxHeel)}°, ${f(air, 1)} s airborne, ${f(tel.speedKmh, 0)} km/h`, 'never capsizes (< 80°), upright and under way', fr.filter((_, i) => i % 2 === 0), w);
  });
  test('Boat', 'boat-dry-prop', 'No thrust with the prop out of the water', (spec) => {
    const w = seaWorld(); const b = new A.Boat(w, spec, { height: 12 / MPS }); const fr = [];
    let maxThrust = 0;
    drive(b, 0.6, () => ({ throttle: 1 }), fr, (t, tel) => { maxThrust = Math.max(maxThrust, Math.abs(tel.thrust)); });
    return result(maxThrust < 1, `${f(maxThrust, 0)} N in the air`, '0 N', fr, w);
  });
  test('Boat', 'boat-right', 'Heeled 30° and released: rights itself', (spec) => {
    const w = seaWorld(); const b = new A.Boat(w, spec); const fr = [];
    drive(b, 2, () => ({}), fr);
    b.body.setCFrame(b.body.pos, [[Math.cos(0.52), -Math.sin(0.52), 0], [Math.sin(0.52), Math.cos(0.52), 0], [0, 0, 1]]);
    let tel = drive(b, 8, () => ({}), fr);
    return result(Math.abs(tel.heel) < 4, `heel ${f(tel.heel)}° after 8 s`, '< 4°', fr, w);
  });

  // ------------------------------------------------------------------ Plane
  function takeoff(p, spec, rep, fr, extra = {}) {
    let lift = null; const start = p.body.pos.slice();
    drive(p, 60, (t, tel) => ({ power: 1, pitch: tel.airspeedKmh > rep.takeoff.liftOffKmh * 0.92 ? -1 : 0, ...extra }), fr, (t, tel, rig) => { if (lift === null && tel.wow < 0.02 && tel.airspeedKmh > 30) lift = V.len(V.sub(rig.body.pos, start)) * MPS; return lift !== null && altitude(rig) > 15; });
    return lift;
  }
  test('Plane', 'plane-sit', 'Sits level on its gear', (spec) => {
    const w = flatWorld(); const p = new A.Plane(w, spec); const fr = [];
    let maxVy = 0; const tel = drive(p, 4, () => ({}), fr, (t, tel, rig) => { if (t > 1) maxVy = Math.max(maxVy, Math.abs(rig.body.v[1] * MPS)); });
    return result(maxVy < 0.05 && Math.abs(tel.bank) < 1 && tel.wow > 0.9, `wow ${f(tel.wow, 2)}, bank ${f(tel.bank)}°`, 'on the wheels, level, still', fr, w);
  });
  test('Plane', 'plane-takeoff', 'Takeoff roll matches the report', (spec, rep) => {
    const w = flatWorld(60000); const p = new A.Plane(w, spec); const fr = [];
    const roll = takeoff(p, spec, rep, fr);
    return result(roll !== null && Math.abs(roll - rep.takeoff.meters) <= rep.takeoff.meters * 0.35, `${f(roll, 0)} m`, `${f(rep.takeoff.meters, 0)} m ±35%`, fr, w);
  });
  test('Plane', 'plane-climb', 'Climb rate at the best-climb speed matches the report', (spec, rep) => {
    const w = flatWorld(); const p = new A.Plane(w, spec, { airborne: true, position: [0, 0, 0], altitude: 300, speed: rep.climb.kmh / 3.6, throttle: 1 }); const fr = [];
    // Hold the best-climb airspeed with the stick, full power.
    let rate = 0, n = 0, last = rep.climb.kmh;
    drive(p, 40, (t, tel) => { const as = tel.airspeedKmh || rep.climb.kmh; const acc = (as - last) / DT; last = as; return { pitch: clamp((rep.climb.kmh - as) * 0.012 - acc * 0.03, -1, 1) }; }, fr, (t, tel) => { if (t > 20) { rate += tel.vs; n++; } });
    rate /= n;
    return result(Math.abs(rate - rep.climb.rate) <= Math.max(rep.climb.rate * 0.3, 1), `${f(rate, 1)} m/s`, `${f(rep.climb.rate, 1)} m/s ±30%`, fr, w);
  });
  test('Plane', 'plane-top', 'Level top speed matches the report', (spec, rep) => {
    const w = flatWorld(); const top = rep.topAb ? rep.topAb : rep.top;
    const p = new A.Plane(w, spec, { airborne: true, position: [0, 0, 0], altitude: 600, speed: (top.kmh / 3.6) * 0.9, throttle: 1 }); const fr = [];
    // Hold altitude with the stick, full power (afterburner if it has one).
    const tel = drive(p, 60, (t, tel, rig) => ({ power: 1, pitch: clamp((altitude(rig) - 600) * 0.02 + tel.vs * 0.05, -1, 1) }), fr);
    return result(Math.abs(tel.airspeedKmh - top.kmh) <= top.kmh * 0.08, `${f(tel.airspeedKmh, 0)} km/h at ${f(tel.altitude, 0)} m`, `${f(top.kmh, 0)} km/h ±8%`, fr.filter((_, i) => i % 3 === 0), w);
  });
  test('Plane', 'plane-turn', '45° banked turn, stick neutral: holds altitude, no sideslip', (spec, rep) => {
    const w = flatWorld(); const v = Math.max(rep.stallKmh * 1.8, Math.min(rep.top.kmh * 0.7, 600)) / 3.6;
    const p = new A.Plane(w, spec, { airborne: true, position: [0, 0, 0], altitude: 500, speed: v, throttle: 0.9 }); const fr = [];
    drive(p, 3, () => ({}), fr);
    const alt0 = altitude(p); let maxBeta = 0, turned = 0, flown = 0;
    drive(p, 25, (t, tel) => ({ roll: tel.bank < 45 ? clamp((45 - tel.bank) * 0.1, 0, 1) : clamp((45 - tel.bank) * 0.1, -1, 0) }), fr, (t, tel, rig) => { flown += (tel.airspeedKmh / 3.6) * DT; if (t > 4) { maxBeta = Math.max(maxBeta, Math.abs(tel.beta)); turned += -rig.body.w[1] * DT; } });
    const dAlt = altitude(p) - alt0;
    const expectTurn = (9.81 / v) * 21; // tan 45° = 1
    const tol = Math.max(40, 0.012 * flown); // 40 m, or a 0.7° path error at jet speeds
    return result(Math.abs(dAlt) < tol && maxBeta < 3 && turned > 0.6 * expectTurn, `altitude ${dAlt >= 0 ? '+' : ''}${f(dAlt, 0)} m over ${f(flown / 1000, 1)} km, max sideslip ${f(maxBeta, 1)}°, turned ${f((turned * 180) / Math.PI, 0)}°`, `< ${f(tol, 0)} m change, < 3° sideslip, turning (> ${f((0.6 * expectTurn * 180) / Math.PI, 0)}°)`, fr, w);
  });
  test('Plane', 'plane-roll', 'Full roll input reaches the spec roll rate', (spec, rep) => {
    const w = flatWorld(); const v = Math.min(rep.top.kmh * 0.8, 700) / 3.6;
    const p = new A.Plane(w, spec, { airborne: true, position: [0, 0, 0], altitude: 800, speed: v, throttle: 1 }); const fr = [];
    drive(p, 1, () => ({}), fr);
    let maxRate = 0; drive(p, 1.5, () => ({ roll: 1 }), fr, (t, tel, rig) => { maxRate = Math.max(maxRate, (V.dot(rig.body.w, rig.cf.look) * 180) / Math.PI); });
    return result(Math.abs(maxRate - spec.controls.rollRate) <= spec.controls.rollRate * 0.25, `${f(maxRate, 0)}°/s`, `${spec.controls.rollRate}°/s ±25%`, fr, w);
  });
  test('Plane', 'plane-stall', 'Unprotected stall: nose drops and it recovers', (spec, rep) => {
    const w = flatWorld(); const s2 = JSON.parse(JSON.stringify(spec)); s2.assists.stallProtection = 0;
    const p = new A.Plane(w, s2, { airborne: true, position: [0, 0, 0], altitude: 800, speed: (rep.stallKmh * 1.4) / 3.6, throttle: 0 }); const fr = [];
    let stalled = false, minAlt = Infinity;
    drive(p, 10, () => ({ pitch: -1, power: -1 }), fr, (t, tel) => { if (tel.stall) stalled = true; });
    const tel = drive(p, 20, () => ({ power: 1 }), fr, (t, tel, rig) => { minAlt = Math.min(minAlt, altitude(rig)); });
    const gamma = (Math.asin(clamp(tel.vs / (tel.airspeedKmh / 3.6), -1, 1)) * 180) / Math.PI;
    const ok = stalled && !tel.stall && tel.airspeedKmh > rep.stallKmh * 1.2 && gamma > -30;
    return result(ok, `${stalled ? 'stalled' : 'never stalled'}, then flying at ${f(tel.airspeedKmh, 0)} km/h, path ${f(gamma, 0)}°, lost ${f(800 - minAlt, 0)} m`, 'stalls, then flies again (path above −30°)', fr, w);
  });
  test('Plane', 'plane-protect', 'With stall protection, full back stick never stalls', (spec, rep) => {
    const w = flatWorld(); const s2 = JSON.parse(JSON.stringify(spec)); s2.assists.stallProtection = 1;
    const p = new A.Plane(w, s2, { airborne: true, position: [0, 0, 0], altitude: 800, speed: (rep.stallKmh * 1.5) / 3.6, throttle: 0.3 }); const fr = [];
    let maxAlpha = 0, stalled = false;
    drive(p, 12, () => ({ pitch: -1 }), fr, (t, tel) => { maxAlpha = Math.max(maxAlpha, tel.alpha); if (tel.stall) stalled = true; });
    return result(!stalled, `max α ${f(maxAlpha)}°`, `below the stall angle (${f(rep.stallDeg)}°)`, fr, w);
  });
  test('Plane', 'plane-aim', 'Point-to-fly turns onto a target 120° right and 10° up', (spec, rep) => {
    const w = flatWorld(); const v = Math.min(rep.top.kmh * 0.75, 650) / 3.6;
    const p = new A.Plane(w, spec, { airborne: true, position: [0, 0, 0], altitude: 600, speed: v, throttle: 0.9 }); const fr = [];
    const a = (120 * Math.PI) / 180, e = (10 * Math.PI) / 180;
    const target = [Math.sin(a) * Math.cos(e), Math.sin(e), -Math.cos(a) * Math.cos(e)]; // yaw right of -Z
    let err = 180;
    drive(p, 40, (t, tel, rig) => { const [pitch, roll] = rig.aimInput(target); return { pitch, roll }; }, fr, (t, tel, rig) => { err = (Math.acos(clamp(V.dot(rig.cf.look, target), -1, 1)) * 180) / Math.PI; return err < 5 && t > 2; });
    return result(err < 5 && !p.telemetry.stall, `${f(err, 1)}° off target`, '< 5°, no stall', fr, w);
  });
  test('Plane', 'plane-taxi', 'Taxi turn on the ground: steers, stays on its wheels', (spec) => {
    const w = flatWorld(); const p = new A.Plane(w, spec); const fr = [];
    let maxBank = 0, turned = 0;
    drive(p, 14, (t, tel) => ({ power: tel.airspeedKmh < 25 ? 0.4 : -0.4, yaw: t > 3 ? 1 : 0 }), fr, (t, tel, rig) => { maxBank = Math.max(maxBank, Math.abs(tel.bank)); turned += -rig.body.w[1] * DT; });
    return result(turned > 0.8 && maxBank < 5 && p.telemetry.wow > 0.8, `turned ${f((turned * 180) / Math.PI, 0)}°, max bank ${f(maxBank, 1)}°`, '> 45°, < 5° bank, on the gear', fr, w);
  });

  // ------------------------------------------------------------------ Helicopter
  test('Helicopter', 'heli-liftoff', 'Spools up and lifts off (none before the rotor is up to speed)', (spec) => {
    const w = flatWorld(); const h = new A.Heli(w, spec); const fr = [];
    let early = false, liftT = null;
    drive(h, spec.rotor.spoolTime + 6, (t) => ({ power: 1 }), fr, (t, tel, rig) => { if (tel.rotorSpeed < 0.75 && altitude(rig) - spec.comHeight > 0.2) early = true; if (liftT === null && altitude(rig) - spec.comHeight > 1) liftT = t; });
    return result(!early && liftT !== null, `lift-off at ${f(liftT, 1)} s (rotor spool ${spec.rotor.spoolTime} s)`, 'after spool-up', fr, w);
  });
  test('Helicopter', 'heli-hover', 'Hands-off hover holds height and position', (spec) => {
    const w = flatWorld(); const h = new A.Heli(w, spec, { altitude: 40 }); const fr = [];
    drive(h, 3, () => ({}), fr);
    const p0 = h.body.pos.slice();
    drive(h, 20, () => ({}), fr);
    const dAlt = (h.body.pos[1] - p0[1]) * MPS, drift = Math.hypot(h.body.pos[0] - p0[0], h.body.pos[2] - p0[2]) * MPS;
    return result(Math.abs(dAlt) < 1.5 && drift < 4, `height ${f(dAlt, 2)} m, drift ${f(drift, 2)} m`, '±1.5 m, < 4 m', fr, w);
  });
  test('Helicopter', 'heli-climb', 'Full collective: climb rate within the power limit', (spec, rep) => {
    const w = flatWorld(); const h = new A.Heli(w, spec, { altitude: 30 }); const fr = [];
    let rate = 0, n = 0;
    drive(h, 12, () => ({ power: 1 }), fr, (t, tel) => { if (t > 6) { rate += tel.vs; n++; } });
    rate /= n;
    const expect = Math.min(spec.controls.climbRate, rep.verticalClimb);
    return result(Math.abs(rate - expect) <= Math.max(expect * 0.25, 0.8), `${f(rate, 1)} m/s`, `${f(expect, 1)} m/s (assist ${spec.controls.climbRate}, power ${f(rep.verticalClimb, 1)})`, fr, w);
  });
  test('Helicopter', 'heli-top', 'Full forward with height held: top speed matches the report', (spec, rep) => {
    const w = flatWorld(80000); const h = new A.Heli(w, spec, { altitude: 300 }); const fr = [];
    const tel = drive(h, 60, (t, tel, rig) => ({ pitch: 1, power: clamp((300 - altitude(rig)) * 0.2, -1, 1) }), fr);
    return result(Math.abs(tel.airspeedKmh - rep.top.kmh) <= rep.top.kmh * 0.15, `${f(tel.airspeedKmh, 0)} km/h`, `${f(rep.top.kmh, 0)} km/h ±15%`, fr.filter((_, i) => i % 3 === 0), w);
  });
  test('Helicopter', 'heli-stop', 'Releasing the stick at speed brings it to a hover', (spec) => {
    const w = flatWorld(80000); const h = new A.Heli(w, spec, { altitude: 120 }); const fr = [];
    drive(h, 15, (t, tel, rig) => ({ pitch: 1, power: clamp((120 - altitude(rig)) * 0.2, -1, 1) }), fr);
    const v0 = h.telemetry.airspeedKmh;
    const tel = drive(h, 25, () => ({}), fr);
    return result(tel.airspeedKmh < 8 && Math.abs(tel.bank) < 5, `${f(v0, 0)} → ${f(tel.airspeedKmh, 1)} km/h`, '< 8 km/h within 25 s', fr, w);
  });
  test('Helicopter', 'heli-turn', 'Yaw at speed banks into a coordinated turn', (spec) => {
    const w = flatWorld(80000); const h = new A.Heli(w, spec, { altitude: 150 }); const fr = [];
    drive(h, 12, (t, tel, rig) => ({ pitch: 0.7, power: clamp((150 - altitude(rig)) * 0.2, -1, 1) }), fr);
    let bank = 0, n = 0, beta = 0;
    drive(h, 10, (t, tel, rig) => ({ pitch: 0.7, yaw: 1, power: clamp((150 - altitude(rig)) * 0.2, -1, 1) }), fr, (t, tel, rig) => { if (t > 4) { bank += tel.bank; n++; const v = rig.body.v; beta = Math.max(beta, Math.abs(Math.atan2(V.dot(v, rig.cf.right), Math.max(V.dot(v, rig.cf.look), 0.1)))); } });
    bank /= n;
    return result(bank > 10 && (beta * 180) / Math.PI < 15, `bank ${f(bank)}°, max sideslip ${f((beta * 180) / Math.PI)}°`, '> 10° bank, < 15° slip', fr, w);
  });
  test('Helicopter', 'heli-ground-effect', 'More thrust available in ground effect', (spec) => {
    const w = flatWorld(); const h = new A.Heli(w, spec, { altitude: 0.01 }); const fr = [];
    h.place([0, 0, 0], 0, spec.comHeight / MPS); h.rotorSpeed = 1;
    const low = drive(h, 0.2, () => ({}), fr);
    const h2 = new A.Heli(w, spec, { altitude: 60 });
    const high = drive(h2, 0.2, () => ({}), fr);
    return result(low.groundEffect > 1.1 && low.tMax > high.tMax * 1.1, `×${f(low.groundEffect, 2)} at skid height, T_max ${f(low.tMax / high.tMax, 2)}× OGE`, '> 1.1×', fr, w);
  });
  test('Helicopter', 'heli-engine-off', 'Engine off in the air: rotor winds down and it comes down', (spec) => {
    const w = flatWorld(); const h = new A.Heli(w, spec, { altitude: 25 }); const fr = [];
    const tel = drive(h, 20, () => ({ engine: false }), fr, (t, tel) => tel.wow > 0.5 && t > 3);
    return result(tel.wow > 0.5 && tel.rotorSpeed < 0.6, `on the ground, rotor ${f(tel.rotorSpeed * 100, 0)}%`, 'lands (hard), rotor below 60%', fr, w);
  });

  const serializeWorld = (w) => (w ? { boxes: w.boxes.map((b) => ({ name: b.name, c: b.c, h: b.h, R: b.R, color: b.color })), water: w.water || null } : { boxes: [], water: null });
  function runOne(t, name, SPECS) {
    const S = SPECS[name];
    let r;
    try { r = t.fn(S.spec, S.report); } catch (e) { r = { pass: false, measured: `error: ${e.message}`, expected: '', frames: [] }; }
    return { spec: name, type: S.type, id: t.id, title: t.title, group: S.type, ...r, world: serializeWorld(r.world) };
  }
  return { TESTS, runOne, seaWorld, flatWorld };
});
