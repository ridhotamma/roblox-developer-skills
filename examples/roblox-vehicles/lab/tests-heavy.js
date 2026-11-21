// Test scenarios for the tank and train sims. Each test builds a world, drives the ported kit
// with a scripted driver, records frames for replay, and compares against the spec report
// (rveh.cjs) or the skill's stated behaviour.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./physics.js'), require('./airsea.js'), require('./heavy.js'));
  else root.HeavyTests = factory(root.VehicleLab, root.AirSeaLab, root.HeavyLab);
})(typeof self !== 'undefined' ? self : this, function (Lab, AS, H) {
  'use strict';
  const { V, M, World, clamp } = Lab;
  const MPS = 0.28, DT = 1 / 60, G = 9.81;
  const f = (x, d = 1) => (x === null || x === undefined || Number.isNaN(x) ? '—' : Number(x).toFixed(d));
  const rad = (d) => (d * Math.PI) / 180, deg = (r) => (r * 180) / Math.PI;

  function flatWorld(size = 20000) { const w = new World(); w.box('Ground', [0, -5, 0], [size, 10, size], M.I(), { color: 0x3b4252 }); return w; }

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
  const pq = (b) => [b.pos.map((x) => +x.toFixed(3)), b.q.map((x) => +x.toFixed(5))];
  function frame(rig, tel, input) {
    const b = rig.body;
    const out = { t: +rig.clock.toFixed(3), p: pq(b)[0], q: pq(b)[1], tel: Object.fromEntries(Object.entries(tel).filter(([, v]) => typeof v === 'number' || typeof v === 'boolean').map(([k, v]) => [k, typeof v === 'number' ? +v.toFixed(3) : v])), in: { ...input, aim: undefined } };
    if (rig.cars) out.cars = rig.cars.map((c) => pq(c.rig.body));
    return out;
  }
  const result = (pass, measured, expected, frames, world) => ({ pass: !!pass, measured, expected, frames, world });
  const thin = (fr, k) => fr.filter((_, i) => i % k === 0);

  const TESTS = [];
  const test = (type, id, title, fn) => TESTS.push({ type, id, title, fn });

  // ------------------------------------------------------------------ Tank
  const cruise = (spec, kmh) => clamp(kmh / spec.engine.maxSpeedKmh, -1, 1);
  const aimAt = (yawDeg, pitchDeg = 0) => { const y = rad(yawDeg), p = rad(pitchDeg); return [Math.sin(y) * Math.cos(p), Math.sin(p), -Math.cos(y) * Math.cos(p)]; };
  function ramp(w, grade, z0, len, name = 'Ramp') {
    const th = Math.atan(grade), s = Math.sin(th), c = Math.cos(th);
    const top = [0, (s * len) / 2, z0 - (c * len) / 2];
    w.box(name, V.sub(top, [0, c * 2, s * 2]), [60, 4, len], M.rotX(th), { color: 0x4c566a });
    return { top: s * len, end: z0 - c * len };
  }

  test('Tank', 'tank-settle', 'Sits level on its tracks and holds still', (spec) => {
    const w = flatWorld(); const k = new H.Tank(w, spec); const fr = [];
    drive(k, 1.5, () => ({}), fr);
    const p0 = k.body.pos.slice(); let maxTilt = 0;
    const tel = drive(k, 4, () => ({}), fr, (t, tel) => { maxTilt = Math.max(maxTilt, Math.abs(tel.pitch), Math.abs(tel.roll)); });
    const drift = V.len(V.sub(k.body.pos, p0)) * MPS;
    return result(maxTilt < 1.5 && drift < 0.1 && tel.grounded >= spec.tracks.contacts * 2, `tilt ≤ ${f(maxTilt, 2)}°, drift ${f(drift, 3)} m, ${tel.grounded} contacts`, '< 1.5°, < 0.1 m, every track contact down', fr, w);
  });
  test('Tank', 'tank-launch', '0-32 km/h matches the report', (spec, rep) => {
    const w = flatWorld(); const k = new H.Tank(w, spec); const fr = []; let t32 = null, squat = 0;
    drive(k, 30, () => ({ throttle: 1 }), fr, (t, tel) => { squat = Math.max(squat, tel.pitch); if (t32 === null && tel.speedKmh >= 32) t32 = t; return t32 !== null && t > t32 + 1; });
    const ok = t32 !== null && Math.abs(t32 - rep.launch.t32) <= rep.launch.t32 * 0.25 && squat > 0.3 && squat < 8;
    return result(ok, `${f(t32, 2)} s, squats ${f(squat)}°`, `${f(rep.launch.t32, 2)} s ±25%, nose up 0.3-8°`, fr, w);
  });
  test('Tank', 'tank-top', 'Reaches the report top speed', (spec, rep) => {
    const w = flatWorld(60000); const k = new H.Tank(w, spec); const fr = [];
    const tel = drive(k, 50, () => ({ throttle: 1 }), fr);
    return result(tel.speedKmh >= rep.top.kmh * 0.93 && tel.speedKmh <= rep.top.kmh * 1.03, `${f(tel.speedKmh, 1)} km/h`, `${f(rep.top.kmh, 0)} km/h (−7% / +3%)`, thin(fr, 3), w);
  });
  test('Tank', 'tank-brake', '40-0 km/h distance matches the report, nose dives', (spec, rep) => {
    const w = flatWorld(); const k = new H.Tank(w, spec); const fr = [];
    drive(k, 20, () => ({ throttle: cruise(spec, 40.5) }), fr, (t, tel) => tel.speedKmh >= 40);
    const start = k.body.pos.slice(); let dive = 0;
    drive(k, 8, () => ({ throttle: -1 }), fr, (t, tel) => { dive = Math.min(dive, tel.pitch); return tel.speedKmh < 0.5; });
    const d = V.len(V.sub(k.body.pos, start)) * MPS;
    return result(Math.abs(d - rep.brake.meters) <= rep.brake.meters * 0.3 && dive < -0.3, `${f(d)} m, dives ${f(-dive)}°`, `${f(rep.brake.meters)} m ±30%, nose down`, fr, w);
  });
  test('Tank', 'tank-coast', 'Off the throttle it rolls to a stop without locking up', (spec) => {
    const w = flatWorld(); const k = new H.Tank(w, spec); const fr = [];
    drive(k, 20, () => ({ throttle: cruise(spec, 40.5) }), fr, (t, tel) => tel.speedKmh >= 40);
    const start = k.body.pos.slice(); let tStop = null;
    drive(k, 20, () => ({}), fr, (t, tel) => { if (tel.speedKmh < 0.5) { tStop = t; return true; } return false; });
    const d = V.len(V.sub(k.body.pos, start)) * MPS;
    return result(tStop !== null && tStop > 2 && tStop < 12, `stops in ${f(tStop)} s / ${f(d)} m`, '2-12 s (engine braking + track losses)', fr, w);
  });
  test('Tank', 'tank-pivot', 'Pivot steer spins on the spot at the pivot rate', (spec) => {
    const w = flatWorld(); const k = new H.Tank(w, spec); const fr = [];
    drive(k, 1, () => ({}), fr);
    const p0 = k.body.pos.slice(); let rate = 0, n = 0;
    drive(k, 6, () => ({ steer: 1 }), fr, (t, tel) => { if (t > 2.5) { rate += tel.yawRate; n++; } });
    rate /= n;
    const drift = V.len(V.sub(k.body.pos, p0)) * MPS;
    const ok = Math.abs(rate - spec.steering.pivotRate) <= spec.steering.pivotRate * 0.3 && drift < 3;
    return result(ok, `${f(rate)}°/s, drift ${f(drift, 2)} m`, `${spec.steering.pivotRate}°/s ±30%, < 3 m`, fr, w);
  });
  test('Tank', 'tank-turn', 'Turning at 40 km/h: yaw rate within grip, no rollover', (spec) => {
    const w = flatWorld(); const k = new H.Tank(w, spec); const fr = [];
    drive(k, 20, () => ({ throttle: cruise(spec, 40) }), fr, (t, tel) => tel.speedKmh >= 39.5);
    let rate = 0, want = 0, n = 0, maxRoll = 0;
    const tel = drive(k, 8, () => ({ throttle: cruise(spec, 40), steer: 1 }), fr, (t, tel) => {
      maxRoll = Math.max(maxRoll, Math.abs(tel.roll));
      if (t > 3) { const v = Math.max(Math.abs(tel.speedKmh) / 3.6, 1); rate += tel.yawRate; want += Math.min(spec.steering.turnRate, deg((spec.steering.maxLateralG * G) / v)); n++; }
    });
    rate /= n; want /= n;
    const ok = Math.abs(rate - want) <= want * 0.35 && maxRoll < 10 && tel.speedKmh > 15;
    return result(ok, `${f(rate)}°/s at ${f(tel.speedKmh, 0)} km/h, roll ≤ ${f(maxRoll)}°`, `${f(want)}°/s ±35%, roll < 10°`, fr, w);
  });
  test('Tank', 'tank-step', 'Climbs a 0.9 m step', (spec) => {
    const w = flatWorld(); const hStep = 0.9 / MPS;
    w.box('Step', [0, hStep / 2, -110], [80, hStep, 120], M.I(), { color: 0x4c566a });
    const k = new H.Tank(w, spec); const fr = [];
    const y0 = k.body.pos[1];
    drive(k, 25, () => ({ throttle: cruise(spec, 12) }), fr, (t, tel, rig) => rig.body.pos[2] < -80);
    const rise = (k.body.pos[1] - y0) * MPS;
    return result(k.body.pos[2] < -80 && rise > 0.75, `rose ${f(rise, 2)} m, at z ${f(k.body.pos[2], 0)}`, 'on top of the step (rise ≈ 0.9 m)', fr, w);
  });
  test('Tank', 'tank-wall', 'Stops at a 2.5 m wall without climbing it, and backs off', (spec) => {
    const w = flatWorld(); const hWall = 2.5 / MPS;
    w.box('Wall', [0, hWall / 2, -70], [80, hWall, 4], M.I(), { color: 0x4c566a });
    const k = new H.Tank(w, spec); const fr = [];
    let maxY = 0;
    drive(k, 8, () => ({ throttle: cruise(spec, 20) }), fr, (t, tel, rig) => { maxY = Math.max(maxY, rig.body.pos[1]); });
    const front = k.body.pos[2] - spec.length / 2 / MPS, gap = (front - -68) * MPS;
    const zAt = k.body.pos[2];
    drive(k, 4, () => ({ throttle: -1 }), fr);
    const back = (k.body.pos[2] - zAt) * MPS;
    const rise = (maxY - spec.comHeight / MPS) * MPS;
    const ok = gap > -0.5 && rise < 0.8 && back > 3;
    return result(ok, `nose ${f(gap, 2)} m from the wall, rose ≤ ${f(rise, 2)} m, backed off ${f(back)} m`, 'within 0.5 m, no climbing, > 3 m back', fr, w);
  });
  test('Tank', 'tank-slope', 'Climbs a 50% slope', (spec) => {
    const w = flatWorld(); const r = ramp(w, 0.5, -30, 140);
    const k = new H.Tank(w, spec); const fr = [];
    let top = 0;
    drive(k, 50, () => ({ throttle: 1 }), fr, (t, tel, rig) => { top = Math.max(top, rig.body.pos[1]); return rig.body.pos[2] < r.end + 10; });
    const rise = (top - spec.comHeight / MPS) * MPS, want = r.top * MPS;
    return result(rise > want * 0.8, `rose ${f(rise)} m`, `${f(want)} m (the top) × 0.8`, thin(fr, 2), w);
  });
  test('Tank', 'tank-hold-slope', 'Holds still on a 30% slope with no input', (spec) => {
    const w = new World(); w.box('Hill', [0, -5, 0], [2000, 10, 2000], M.rotX(Math.atan(0.3)), { color: 0x3b4252 });
    const k = new H.Tank(w, spec, { position: [0, 2, 0] }); const fr = [];
    drive(k, 3, () => ({}), fr);
    const p0 = k.body.pos.slice();
    drive(k, 5, () => ({}), fr);
    const drift = V.len(V.sub(k.body.pos, p0)) * MPS;
    return result(drift < 0.3, `${f(drift, 3)} m in 5 s`, '< 0.3 m', fr, w);
  });
  test('Tank', 'tank-turret', 'Turret traverses at its rate and stays on target while the hull pivots', (spec) => {
    const w = flatWorld(); const k = new H.Tank(w, spec); const fr = [];
    drive(k, 1, () => ({}), fr);
    const aim = aimAt(120); let tOn = null;
    drive(k, 8, () => ({ aim }), fr, (t, tel) => { if (tOn === null && Math.abs(tel.turretYaw - 120) < 1) tOn = t; return tOn !== null; });
    const want = 120 / spec.turret.traverseRate;
    let maxErr = 0;
    drive(k, 5, () => ({ aim, steer: -1 }), fr, (t, tel, rig) => { if (t > 0.5) { const g = AS.flat(rig.gunDir); maxErr = Math.max(maxErr, deg(Math.acos(clamp(V.dot(g, AS.flat(aim)), -1, 1)))); } });
    const ok = tOn !== null && Math.abs(tOn - want) <= want * 0.15 && maxErr < 3;
    return result(ok, `on target in ${f(tOn, 2)} s, ≤ ${f(maxErr, 2)}° off while pivoting`, `${f(want, 2)} s ±15%, < 3°`, fr, w);
  });
  test('Tank', 'tank-elevation', 'Gun elevation stops at its limits', (spec) => {
    const w = flatWorld(); const k = new H.Tank(w, spec); const fr = [];
    drive(k, 1, () => ({}), fr);
    const up = drive(k, 4, () => ({ aim: aimAt(0, 60) }), fr).gunPitch;
    const down = drive(k, 4, () => ({ aim: aimAt(0, -40) }), fr).gunPitch;
    const ok = Math.abs(up - spec.turret.maxElevation) < 0.6 && Math.abs(down - spec.turret.minElevation) < 0.6;
    return result(ok, `+${f(up)}° / ${f(down)}°`, `+${spec.turret.maxElevation}° / ${spec.turret.minElevation}°`, fr, w);
  });
  test('Tank', 'tank-recoil', 'Firing shoves the hull back by J/m and rocks it; reload enforced', (spec, rep) => {
    const w = flatWorld(); const k = new H.Tank(w, spec); const fr = [];
    drive(k, 2, () => ({ aim: aimAt(0) }), fr);
    const fwd = AS.flat(k.cf.look);
    const v0 = V.dot(k.body.v, fwd) * MPS, pitch0 = k.telemetry.pitch;
    const shot = drive(k, DT, () => ({ aim: aimAt(0), fire: true }), fr);
    const dv = v0 - V.dot(k.body.v, fwd) * MPS;
    let rock = 0, again = false;
    drive(k, 2, () => ({ aim: aimAt(0), fire: true }), fr, (t, tel) => { rock = Math.max(rock, Math.abs(tel.pitch - pitch0)); if (tel.fired) again = true; });
    const settle = drive(k, 4, () => ({ aim: aimAt(0) }), fr);
    const ok = shot.fired && !again && Math.abs(dv - rep.recoilDv) <= rep.recoilDv * 0.4 && rock > 0.2 && Math.abs(settle.pitch - pitch0) < 0.5;
    return result(ok, `Δv ${f(dv, 2)} m/s, rocks ${f(rock, 2)}°, refire blocked: ${!again}`, `${f(rep.recoilDv, 2)} m/s ±40%, visible rock, reload ${spec.gun.reload} s`, fr, w);
  });
  test('Tank', 'tank-flip', 'Upside down, it rights itself', (spec) => {
    const w = flatWorld(); const k = new H.Tank(w, spec); const fr = [];
    k.body.setCFrame([0, (spec.height + 1) / MPS, 0], M.rotX(Math.PI));
    drive(k, 8, () => ({}), fr);
    const up = k.cf.up[1];
    return result(up > 0.95 && k.recoveries >= 1, `up·Y ${f(up, 2)}, ${k.recoveries} recovery`, 'upright (> 0.95)', fr, w);
  });

  // ------------------------------------------------------------------ Train
  // Tracks: a straight line (optionally on a grade) and a circle.
  function straightTrack(w, lengthStuds, grade = 0) {
    const nodes = [];
    for (let d = 0; d <= lengthStuds; d += 100) nodes.push({ p: [0, grade * d, -d] });
    const tr = new H.TrainTrack(nodes);
    if (grade !== 0) { const th = Math.atan(grade); w.box('Embankment', [0, (grade * lengthStuds) / 2 - 5 * Math.cos(th), -lengthStuds / 2], [200, 10, lengthStuds * 1.02], M.rotX(th), { color: 0x3b4252 }); }
    w.trackLine = tr.samples.filter((_, i) => i % 6 === 0).map((s) => s.pos);
    return tr;
  }
  function circleTrack(w, radiusM, opts = {}) {
    const R = radiusM / MPS, N = 36, nodes = [];
    for (let i = 0; i < N; i++) { const a = (i / N) * Math.PI * 2; nodes.push({ p: [R * Math.cos(a) - R, 0, -R * Math.sin(a)] }); }
    const tr = new H.TrainTrack(nodes, { loop: true, ...opts });
    w.trackLine = tr.samples.filter((_, i) => i % 3 === 0).map((s) => s.pos);
    w.trackLine.push(w.trackLine[0]);
    tr.center = [-R, 0, 0];
    return tr;
  }
  const trainLength = (spec) => (spec.length + spec.cars.count * (spec.cars.length + 1)) / MPS;
  // How far each car is from its place on the track (studs) and how far it is turned off it (°).
  function trackError(tn) {
    let pos = 0, ang = 0;
    for (const car of tn.cars) {
      const pose = tn.pose(car), b = car.rig.body;
      pos = Math.max(pos, V.len(V.sub(pose.pos, b.com)));
      const look = V.mul(M.col(b.R, 2), -1);
      ang = Math.max(ang, deg(Math.acos(clamp(V.dot(look, pose.fwd), -1, 1))));
    }
    return { pos, ang };
  }

  test('Train', 'train-settle', 'Sits on the rails and holds still with the brakes on', (spec) => {
    const w = flatWorld(60000); const tr = straightTrack(w, 4000);
    const tn = new H.Train(w, spec, tr, { s: trainLength(spec) + 50 }); const fr = [];
    const s0 = tn.s;
    drive(tn, 4, () => ({}), fr);
    const e = trackError(tn);
    return result(Math.abs(tn.s - s0) < 0.01 && e.pos < 0.1 && e.ang < 0.5, `moved ${f(Math.abs(tn.s - s0) * MPS, 3)} m, cars ≤ ${f(e.pos, 3)} studs / ${f(e.ang, 2)}° off`, 'still, < 0.1 stud, < 0.5°', fr, w);
  });
  test('Train', 'train-launch', '0-50 (and 0-100) km/h match the report', (spec, rep) => {
    const w = flatWorld(200000); const tr = straightTrack(w, 90000);
    const tn = new H.Train(w, spec, tr, { s: trainLength(spec) + 50 }); const fr = [];
    let t50 = null, t100 = null;
    const want100 = rep.launch.t100 ? rep.launch.t100.t : null;
    drive(tn, (want100 || rep.launch.t50.t) * 1.5 + 5, () => ({ throttle: 1 }), fr, (t, tel) => {
      if (t50 === null && tel.speedKmh >= 50) t50 = t;
      if (t100 === null && tel.speedKmh >= 100) t100 = t;
      return want100 ? t100 !== null : t50 !== null;
    });
    const ok50 = t50 !== null && Math.abs(t50 - rep.launch.t50.t) <= rep.launch.t50.t * 0.2;
    const ok100 = !want100 || (t100 !== null && Math.abs(t100 - want100) <= want100 * 0.2);
    return result(ok50 && ok100, `0-50 ${f(t50)} s${want100 ? `, 0-100 ${f(t100)} s` : ''}`, `${f(rep.launch.t50.t)}${want100 ? ` / ${f(want100)}` : ''} s ±20%`, thin(fr, 8), w);
  });
  test('Train', 'train-balance', 'Balancing speed on a 1% grade matches the report', (spec, rep) => {
    const w = flatWorld(400000); const tr = straightTrack(w, 160000, 0.01);
    const target = rep.balance1.kmh, fr = [];
    if (rep.balance1.limiter === 'speed limit') {
      const tn = new H.Train(w, spec, tr, { s: trainLength(spec) + 50, kmh: target - 5 });
      const tel = drive(tn, 40, () => ({ throttle: 1 }), fr);
      return result(Math.abs(tel.speedKmh - target) < 3, `${f(tel.speedKmh)} km/h`, `${f(target, 0)} km/h (speed limit) ±3`, thin(fr, 4), w);
    }
    const lo = new H.Train(w, spec, tr, { s: trainLength(spec) + 50, kmh: target * 0.9 });
    const a = drive(lo, 40, () => ({ throttle: 1 }), fr).speedKmh;
    const w2 = flatWorld(400000); const tr2 = straightTrack(w2, 160000, 0.01);
    const hi = new H.Train(w2, spec, tr2, { s: trainLength(spec) + 50, kmh: target * 1.1 });
    const b = drive(hi, 40, () => ({ throttle: 1 })).speedKmh;
    const ok = a > target * 0.9 + 0.3 && b < target * 1.1 - 0.3 && a < target * 1.02 && b > target * 0.98;
    return result(ok, `from ${f(target * 0.9, 0)} → ${f(a)}, from ${f(target * 1.1, 0)} → ${f(b)} km/h`, `both toward ${f(target, 0)} km/h`, thin(fr, 4), w);
  });
  test('Train', 'train-brake', 'Service and emergency stopping distances match the report', (spec, rep) => {
    const run = (emergency) => {
      const w = flatWorld(400000); const tr = straightTrack(w, 150000);
      const tn = new H.Train(w, spec, tr, { s: trainLength(spec) + 50, kmh: rep.lineKmh }); const fr = [];
      const s0 = tn.s;
      drive(tn, 600, () => (emergency ? { handbrake: true } : { throttle: -1 }), fr, (t, tel) => tel.speedKmh < 0.3);
      return { d: (tn.s - s0) * MPS, fr, w };
    };
    const svc = run(false), em = run(true);
    const ok = Math.abs(svc.d - rep.serviceStop.meters) <= rep.serviceStop.meters * 0.15 && Math.abs(em.d - rep.emergencyStop.meters) <= rep.emergencyStop.meters * 0.15;
    return result(ok, `from ${f(rep.lineKmh, 0)} km/h: ${f(svc.d, 0)} m service, ${f(em.d, 0)} m emergency`, `${f(rep.serviceStop.meters, 0)} / ${f(rep.emergencyStop.meters, 0)} m ±15%`, thin(em.fr, 4), em.w);
  });
  test('Train', 'train-reverse', 'S from a stop reverses up to the reverse speed limit', (spec) => {
    const w = flatWorld(60000); const tr = straightTrack(w, 6000);
    const tn = new H.Train(w, spec, tr, { s: 4000 }); const fr = [];
    const tel = drive(tn, 40, () => ({ throttle: -1 }), fr);
    const ok = tel.speedKmh < 0 && Math.abs(-tel.speedKmh - spec.engine.reverseSpeedKmh) < 2;
    return result(ok, `${f(tel.speedKmh)} km/h`, `−${spec.engine.reverseSpeedKmh} km/h ±2`, fr, w);
  });
  test('Train', 'train-curve', 'Every car follows the track through a 400 m curve at 80 km/h', (spec) => {
    const w = flatWorld(); const tr = circleTrack(w, 400, { designSpeedKmh: 80 });
    const kmh = Math.min(80, spec.engine.speedLimitKmh - 5);
    const tn = new H.Train(w, spec, tr, { s: 0, kmh }); const fr = [];
    let worst = { pos: 0, ang: 0 };
    const tel = drive(tn, 20, (t, tel) => ({ throttle: tel.speedKmh < kmh ? 0.5 : 0 }), fr, (t) => { if (t > 1) { const e = trackError(tn); worst = { pos: Math.max(worst.pos, e.pos), ang: Math.max(worst.ang, e.ang) }; } });
    const ok = !tel.derailed && worst.pos < 0.3 && worst.ang < 2;
    return result(ok, `≤ ${f(worst.pos, 3)} studs, ≤ ${f(worst.ang, 2)}° off the track`, '< 0.3 stud, < 2°, on the rails', fr, w);
  });
  test('Train', 'train-hill', 'Over a crest and through a dip, the cars stay on the track', (spec) => {
    const w = flatWorld(60000);
    const nodes = []; let y = 0;
    for (let d = 0; d <= 12000; d += 100) { nodes.push({ p: [0, y, -d] }); y += d < 3000 ? 2 : d < 6000 ? -2 : d < 9000 ? -1 : 1; }
    const tr = new H.TrainTrack(nodes);
    w.trackLine = tr.samples.filter((_, i) => i % 6 === 0).map((s) => s.pos);
    const kmh = Math.min(100, spec.engine.speedLimitKmh - 5);
    const tn = new H.Train(w, spec, tr, { s: trainLength(spec) + 1500, kmh }); const fr = [];
    let worst = { pos: 0, ang: 0 };
    drive(tn, 40, (t, tel) => ({ throttle: tel.speedKmh < kmh ? 1 : 0 }), fr, (t, tel) => { if (t > 1) { const e = trackError(tn); worst = { pos: Math.max(worst.pos, e.pos), ang: Math.max(worst.ang, e.ang) }; } return tn.s > 11000; });
    return result(worst.pos < 0.3 && worst.ang < 2, `≤ ${f(worst.pos, 3)} studs, ≤ ${f(worst.ang, 2)}° off the track`, '< 0.3 stud, < 2°', thin(fr, 2), w);
  });
  test('Train', 'train-derail', 'Overspeed in a 150 m curve derails; just under the limit it holds', (spec, rep) => {
    const limit = rep.derail150;
    const run = (kmh, seconds) => {
      const w = flatWorld(); const tr = circleTrack(w, 150);
      const tn = new H.Train(w, spec, tr, { s: 0, kmh }); const fr = [];
      drive(tn, seconds, (t, tel) => ({ throttle: tel.speedKmh < kmh ? 0.6 : 0 }), fr, (t, tel) => tel.derailed && t > 3);
      return { tn, fr, w, tr };
    };
    const slow = run(limit * 0.9, 10);
    const fast = run(limit * 1.15, 6);
    const out = fast.tn.cars.map((c) => V.len(V.sub([c.rig.body.pos[0], 0, c.rig.body.pos[2]], fast.tr.center)) * MPS - 150);
    const ok = !slow.tn.derailed && fast.tn.derailed && Math.min(...out) > 0.5;
    return result(ok, `${f(limit * 0.9, 0)} km/h holds: ${!slow.tn.derailed}; ${f(limit * 1.15, 0)} km/h derails: ${fast.tn.derailed}, cars ${f(Math.min(...out))} m+ outside`, `derails above ${f(limit, 0)} km/h, thrown outward`, fast.fr, fast.w);
  });
  test('Train', 'train-cant', 'Cant (DesignSpeedKmh) raises the derailment speed', (spec, rep) => {
    const run = (opts) => {
      const w = flatWorld(); const tr = circleTrack(w, 150, opts);
      const tn = new H.Train(w, spec, tr, { s: 0, kmh: rep.derail150 * 1.05 }); const fr = [];
      drive(tn, 6, (t, tel) => ({ throttle: tel.speedKmh < rep.derail150 * 1.05 ? 0.6 : 0 }), fr);
      return { tn, fr, w };
    };
    const flat = run({}), canted = run({ designSpeedKmh: 80 });
    return result(flat.tn.derailed && !canted.tn.derailed, `${f(rep.derail150 * 1.05, 0)} km/h: flat derails ${flat.tn.derailed}, canted ${canted.tn.derailed}`, 'flat derails, canted holds', canted.fr, canted.w);
  });
  test('Train', 'train-hold-grade', 'Stopped on a 2% grade, the brakes hold it', (spec) => {
    const w = flatWorld(60000); const tr = straightTrack(w, 6000, 0.02);
    const tn = new H.Train(w, spec, tr, { s: 3000 }); const fr = [];
    const s0 = tn.s;
    drive(tn, 10, () => ({}), fr);
    return result(Math.abs(tn.s - s0) * MPS < 0.05, `moved ${f(Math.abs(tn.s - s0) * MPS, 3)} m`, '< 0.05 m', fr, w);
  });
  test('Train', 'train-rerail', 'After a derailment, Reset puts it back on the rails', (spec, rep) => {
    const w = flatWorld(); const tr = circleTrack(w, 150);
    const tn = new H.Train(w, spec, tr, { s: 0, kmh: rep.derail150 * 1.2 }); const fr = [];
    drive(tn, 4, () => ({}), fr);
    const wasDerailed = tn.derailed;
    tn.recover();
    const tel = drive(tn, 3, () => ({}), fr);
    const e = trackError(tn);
    return result(wasDerailed && !tel.derailed && e.pos < 0.2 && Math.abs(tel.speedKmh) < 0.5, `derailed ${wasDerailed}, back on: cars ≤ ${f(e.pos, 3)} studs off`, 'on the rails, stopped', fr, w);
  });

  const serializeWorld = (w) => (w ? { boxes: w.boxes.map((b) => ({ name: b.name, c: b.c, h: b.h, R: b.R, color: b.color })), water: w.water || null, track: w.trackLine || null } : { boxes: [], water: null, track: null });
  function runOne(t, name, SPECS) {
    const S = SPECS[name];
    let r;
    try { r = t.fn(S.spec, S.report); } catch (e) { r = { pass: false, measured: `error: ${e.message}`, expected: '', frames: [] }; }
    return { spec: name, type: S.type, id: t.id, title: t.title, group: S.type, ...r, world: serializeWorld(r.world) };
  }
  return { TESTS, runOne, flatWorld };
});
