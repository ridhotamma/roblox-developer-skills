// Test scenarios for the vehicle lab. Each test builds a world, drives the ported kit with a
// scripted driver, records frames for replay, and compares against the spec report or the
// skill's stated behaviour ("never stuck", "holdable slides", "no bounce", ...).
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./physics.js'));
  else root.VehicleTests = factory(root.VehicleLab);
})(typeof self !== 'undefined' ? self : this, function (Lab) {
  'use strict';
  const { V, M, VM, World, Car, clamp } = Lab;
  const MPS = VM.METERS_PER_STUD;
  const DT = 1 / 60;

  function flatWorld(len = 4000) {
    const w = new World();
    w.box('Ground', [0, -5, -len / 2 + 200], [400, 10, len + 400], M.I(), { color: 0x3b4252 });
    return w;
  }

  // Drive for `seconds`, calling ctrl(t, car, telemetry) -> input; returns recorded frames.
  function drive(car, seconds, ctrl, rec, every = 2, stopIf) {
    let tel = car.telemetry || { speedKmh: 0, driftAngle: 0, gear: 1 };
    const n = Math.round(seconds / DT);
    for (let i = 0; i < n; i++) {
      const t = i * DT;
      const input = ctrl(t, car, tel);
      tel = car.frame(DT, input);
      if (rec && i % every === 0) record(rec, car, tel, input);
      if (stopIf && stopIf(t, car, tel)) break;
    }
    return tel;
  }
  function record(rec, car, tel, input) {
    const b = car.body;
    rec.push({
      t: +car.clock.toFixed(3), p: b.pos.map((x) => +x.toFixed(3)), q: b.q.map((x) => +x.toFixed(5)),
      wl: car.wheels.map((w) => +w.length.toFixed(3)), ws: car.wheels.map((w) => +w.spin.toFixed(2)), wg: car.wheels.map((w) => (w.grounded ? 1 : 0)),
      slip: car.wheels.map((w) => +w.slip.toFixed(2)),
      st: +car.steer.toFixed(2), kmh: +tel.speedKmh.toFixed(1), g: tel.gear, rpm: Math.round(tel.rpm), da: +tel.driftAngle.toFixed(1),
      stuck: tel.stuck, in: input,
    });
  }
  const speedHold = (target, gain = 0.15) => (tel) => clamp((target - tel.speedKmh) * gain, -1, 1);
  const pitchRoll = (car) => { const up = car.cf.up, look = car.cf.look, right = car.cf.right; return { pitch: (Math.asin(clamp(look[1], -1, 1)) * 180) / Math.PI, roll: (Math.asin(clamp(right[1], -1, 1)) * 180) / Math.PI, upY: up[1] }; };
  const travel = (car, start) => V.dot(V.sub(car.body.pos, start), [0, 0, -1]); // distance along -Z
  const within = (x, e, tol) => x !== null && e !== null && Math.abs(x - e) <= Math.abs(e) * tol;
  const f = (x, d = 2) => (x === null || x === undefined || Number.isNaN(x) ? '—' : Number(x).toFixed(d));

  // ------------------------------------------------------------------ tests
  const TESTS = [];
  const test = (id, title, group, fn) => TESTS.push({ id, title, group, fn });

  test('settle', 'Settles at ride height, no bounce', 'Suspension', (raw, rep) => {
    const w = flatWorld(200); const car = new Car(w, raw, { position: [0, 0.6, 0] });
    const frames = []; let settledAt = null, crossings = 0, lastSign = 0, lastY = car.body.pos[1];
    drive(car, 4, () => ({ throttle: 0, steer: 0, handbrake: false }), frames, 2, (t, c) => {
      const vy = c.body.v[1];
      const s = Math.sign(vy); if (Math.abs(vy) > 0.4 && s !== lastSign) { if (lastSign !== 0) crossings++; lastSign = s; }
      if (settledAt === null && t > 0.3 && Math.abs(vy) < 0.15 && Math.abs(c.body.pos[1] - lastY) < 0.01) settledAt = t;
      lastY = c.body.pos[1];
    });
    const mean = car.wheels.reduce((a, x) => a + x.length, 0) / 4;
    const ok = Math.abs(mean - car.staticLength) < 0.12 && crossings <= 3 && settledAt !== null && settledAt < 1.8;
    return { pass: ok, measured: `length ${f(mean)} studs, ${crossings} bounces, still at ${f(settledAt, 1)} s`, expected: `${f(car.staticLength)} studs, ≤3 bounces, < 1.8 s`, frames, world: w };
  });

  test('launch', '0–60 / 0–100 km/h and quarter mile', 'Powertrain', (raw, rep) => {
    const w = flatWorld(4000); const car = new Car(w, raw); const start = car.body.pos.slice();
    const frames = []; let t60 = null, t100 = null, quarter = null;
    drive(car, 30, () => ({ throttle: 1, steer: 0, handbrake: false }), frames, 3, (t, c, tel) => {
      const tt = t + DT;
      if (t60 === null && tel.speedKmh >= 60) t60 = tt;
      if (t100 === null && tel.speedKmh >= 100) t100 = tt;
      if (quarter === null && travel(c, start) * MPS >= 402.336) quarter = { t: tt, kmh: tel.speedKmh };
      return quarter && (t100 || tt > 25);
    });
    const r = rep;
    const okA = within(t60, r.t60kmh, 0.15) && (r.t100 === null ? t100 === null : within(t100, r.t100, 0.15));
    const okQ = !r.quarter || (quarter && within(quarter.t, r.quarter.t, 0.1));
    return {
      pass: okA && okQ,
      measured: `0–60 ${f(t60)} s · 0–100 ${f(t100)} s · ¼ mi ${quarter ? f(quarter.t) + ' s @ ' + f(quarter.kmh, 0) : '—'}`,
      expected: `0–60 ${f(r.t60kmh)} s · 0–100 ${f(r.t100)} s · ¼ mi ${r.quarter ? f(r.quarter.t) + ' s @ ' + f(r.quarter.kmh, 0) : '—'}`, frames, world: w,
    };
  });

  test('top', 'Top speed', 'Powertrain', (raw, rep) => {
    const w = flatWorld(60000); const car = new Car(w, raw);
    const frames = []; let top = 0, last = 0, flat = 0;
    drive(car, 150, () => ({ throttle: 1, steer: 0, handbrake: false }), frames, 30, (t, c, tel) => {
      top = Math.max(top, tel.speedKmh);
      if (t % 5 < DT) { flat = tel.speedKmh - last < 0.5 ? flat + 1 : 0; last = tel.speedKmh; }
      return flat >= 2 && t > 20;
    });
    return { pass: within(top, rep.topKmh, 0.04), measured: `${f(top, 1)} km/h (gear ${car.gear})`, expected: `${f(rep.topKmh, 0)} km/h (${rep.topLimiter})`, frames, world: w };
  });

  test('brake', 'Braking 100–0 km/h', 'Brakes', (raw, rep) => {
    const w = flatWorld(2000); const car = new Car(w, raw);
    drive(car, 1, () => ({ throttle: 0, steer: 0, handbrake: false }));
    const v0 = raw.name === 'Kart' ? 80 : 100;
    car.body.v = V.mul(car.cf.look, v0 / 3.6 / MPS);
    while (VM.AutoShift(car.spec, car.gear, v0 / 3.6) !== car.gear) car.gear = VM.AutoShift(car.spec, car.gear, v0 / 3.6);
    const start = car.body.pos.slice(); const frames = []; let stopT = null, maxPitch = 0;
    drive(car, 8, () => ({ throttle: -1, steer: 0, handbrake: false }), frames, 2, (t, c, tel) => {
      maxPitch = Math.min(maxPitch, pitchRoll(c).pitch);
      if (tel.speedKmh <= 3.6) { stopT = t; return true; }
    });
    const d = travel(car, start) * MPS + 0.05;
    // report is 100-0; scale the kart's 80-0 by v² for comparison
    const expected = rep.brakeM * (v0 / 100) ** 2;
    return { pass: within(d, expected, 0.15), measured: `${f(d, 1)} m in ${f(stopT)} s, nose dive ${f(-maxPitch, 1)}°`, expected: `${f(expected, 1)} m (${v0}–0)`, frames, world: w };
  });

  test('skidpad', 'Steering direction + max cornering g', 'Handling', (raw, rep) => {
    const w = flatWorld(200); w.boxes[0].h = [3000, 5, 3000]; w.boxes[0].c = [0, -5, 0];
    const car = new Car(w, raw); const frames = [];
    let best = 0, turnedRight = null, minUp = 1, maxRoll = 0; const hist = [];
    const vmax = raw.name === 'Kart' ? 70 : 110;
    drive(car, 24, (t, c, tel) => ({ throttle: tel.slip > 1.05 && tel.speedKmh > 8 ? 0 : Math.min(speedHold(20 + (vmax - 20) * Math.min(t / 22, 1), 0.05)(tel), 0.6), steer: 0.6, handbrake: false }), frames, 4, (t, c, tel) => {
      const yaw = c.body.w[1];
      if (t > 1.5 && turnedRight === null) turnedRight = yaw < 0;
      const v = [c.body.v[0], 0, c.body.v[2]]; const pv = c._pv || v; c._pv = v;
      const acc = V.mul(V.sub(v, pv), 1 / DT);
      const a = V.len(v) > 1 ? (Math.abs(V.cross(V.unit(v), acc)[1]) * MPS) / VM.G : 0; // ⊥ acceleration in real g
      hist.push(a); if (hist.length > 60) hist.shift();
      if (hist.length === 60) best = Math.max(best, hist.reduce((x, y) => x + y, 0) / 60);
      const pr = pitchRoll(c); minUp = Math.min(minUp, pr.upY); maxRoll = Math.max(maxRoll, Math.abs(pr.roll));
    });
    const ok = turnedRight && best >= rep.lateralG * 0.7 && best <= rep.lateralG * 1.2 && minUp > 0.7;
    return { pass: ok, measured: `${turnedRight ? 'turns right' : 'TURNS LEFT'} on +steer · ${f(best)} g · max roll ${f(maxRoll, 1)}°`, expected: `right · ~${f(rep.lateralG)} g · no rollover`, frames, world: w };
  });

  test('reverse', 'Reverse from a stop', 'Powertrain', (raw) => {
    const w = flatWorld(400); w.boxes[0].c[2] = 0; const car = new Car(w, raw); const frames = [];
    const tel = drive(car, 4, () => ({ throttle: -1, steer: 0, handbrake: false }), frames);
    const tel2 = drive(car, 3, () => ({ throttle: 1, steer: 0, handbrake: false }), frames);
    const ok = tel.speedKmh < -10 && tel.gear === -1 && tel2.speedKmh > 0 && tel2.gear >= 1;
    return { pass: ok, measured: `${f(tel.speedKmh, 0)} km/h in R after 4 s, then ${f(tel2.speedKmh, 0)} km/h gear ${tel2.gear}`, expected: 'backwards in R, then brakes and drives forward', frames, world: w };
  });

  test('drift', 'Handbrake flick → holdable drift', 'Drift', (raw) => {
    const w = flatWorld(200); w.boxes[0].h = [3000, 5, 3000]; w.boxes[0].c = [0, -5, 0];
    const car = new Car(w, raw); const frames = [];
    const entry = raw.name === 'Kart' ? 50 : 75;
    drive(car, 10, (t, c, tel) => ({ throttle: speedHold(entry)(tel), steer: 0, handbrake: false }), frames, 3, (t, c, tel) => tel.speedKmh >= entry - 1);
    let maxAngle = 0, driftTime = 0, spun = false;
    const flick = 0.35 * Math.min(1, Math.sqrt((raw.wheelbase || 2.6) / 2.4)); // shorter flick for short, twitchy cars
    const t0 = car.clock;
    drive(car, 5, (t, c, tel) => {
      if (t < flick) return { throttle: 0.5, steer: 0.8, handbrake: true };
      // a modest human: countersteer in proportion to the slide, ease off throttle past 40°
      const a = Math.abs(tel.driftAngle);
      return { throttle: a > 40 ? 0.3 : 0.75, steer: clamp(tel.driftAngle / 35, -1, 1), handbrake: false };
    }, frames, 2, (t, c, tel) => {
      maxAngle = Math.max(maxAngle, Math.abs(tel.driftAngle)); if (tel.drifting) driftTime += DT;
      const vel = c.body.v; const look = c.cf.look;
      if (V.dot(V.unit(vel), look) < -0.3) spun = true;
    });
    const drifter = ((raw.drift && raw.drift.countersteer) || 0.15) >= 0.3; // a drift setup (drifting.md)
    const ok = drifter ? maxAngle >= 15 && !spun && driftTime >= 0.6 && maxAngle < spec_max(raw) + 25 : !spun;
    function spec_max(r) { return (r.drift && r.drift.maxAngle) || 50; }
    return { pass: ok, measured: `peak ${f(maxAngle, 0)}° · drifting ${f(driftTime, 1)} s · ${spun ? 'SPUN OUT' : 'recovered'}`, expected: drifter ? `≥15°, ≥0.6 s, peak < maxAngle+25 (${(raw.drift && raw.drift.maxAngle || 50) + 25}°, the HUD's spin-out line)` : 'not a drift setup (countersteer < 0.3): just no spin-out', frames, world: w };
  });

  // What "slippery" feels like on a keyboard: a keyboard can only ask for all of the steering,
  // so quick left/right flicks at speed swing the weight across and the rear lets go. Whether a
  // given car spins depends on exactly when the keys flip, so this drives a grid of speeds and
  // flick timings and reports spins and the worst slide. Every tune must stay off its roof; a
  // tune that asks for stability (drift.maxAngle ≤ 20, the stabilizer catches slides early, as
  // in specs/arcade_car.json) must also never spin and stay under 30° of slide.
  test('slalom', 'Keyboard slalom grid (55/65/80 km/h × flick every 0.5/0.7/0.9 s)', 'Handling', (raw) => {
    const stable = ((raw.drift && raw.drift.maxAngle) || 50) <= 20;
    let spins = 0, worst = 0, rolled = false, frames = [], world = null; const spunAt = [];
    for (const kmh of [55, 65, 80]) for (const per of [0.5, 0.7, 0.9]) {
      const w = flatWorld(200); w.boxes[0].h = [3000, 5, 3000]; w.boxes[0].c = [0, -5, 0];
      const car = new Car(w, raw); const rec = kmh === 65 && per === 0.7 ? frames : null; if (rec) world = w;
      const v0 = raw.name === 'Kart' ? Math.min(kmh, 70) : kmh;
      drive(car, 20, (t, c, tel) => ({ throttle: speedHold(v0)(tel), steer: 0, handbrake: false }), rec, 3, (t, c, tel) => tel.speedKmh >= v0 - 1);
      let spun = false;
      drive(car, 9, (t) => ({ throttle: t < 6 ? 0.8 : 0.4, steer: t < 6 ? (Math.floor(t / per) % 2 ? -1 : 1) : 0, handbrake: false }), rec, 2, (t, c, tel) => {
        worst = Math.max(worst, Math.abs(tel.driftAngle));
        if (V.len(c.body.v) > 3 && V.dot(V.unit(c.body.v), c.cf.look) < -0.3) spun = true;
        if (pitchRoll(c).upY < 0.7) rolled = true;
      });
      if (spun) { spins++; spunAt.push(`${v0}@${per}`); }
    }
    const ok = !rolled && (!stable || (spins === 0 && worst < 30));
    return { pass: ok, measured: `spun ${spins}/9${spins ? ' (' + spunAt.join(', ') + ' km/h@s)' : ''} · worst slide ${f(worst, 0)}° · ${rolled ? 'ROLLED' : 'upright'}`, expected: stable ? 'stable tune: 0/9 spins, worst slide < 30°, upright' : 'upright (spins and slide are reported: lower = more planted on a keyboard)', frames, world };
  });

  // The skill's stuck test course (anti-stuck.md §5, item 1): 0.3 / 0.6 / 1.0 stud kerbs straight
  // at 20 km/h and at 30° at 40 km/h. Must pass or escape in < 5 s without the reset button.
  // Heights are 0.25 / 0.5 / 0.85 × the wheel radius (0.3 / 0.6 / 1.0 studs for a car's ~1.2 stud
  // wheels): no wheel climbs a kerb taller than itself, so small-wheeled vehicles get lower kerbs.
  for (const [k, deg, kmh] of [[0.25, 0, 20], [0.5, 0, 20], [0.85, 0, 20], [0.5, 30, 40], [0.85, 30, 40]]) {
    test(`kerb${k}_${deg}`, `Kerb ${k}× wheel radius ${deg ? 'at 30°, 40' : 'straight, 20'} km/h`, 'Never stuck', (raw) => {
      const h = +((raw.wheelRadius / MPS) * k).toFixed(2);
      const w = flatWorld(600); w.box('Kerb', [0, h / 2, -60], [400, h, 30], M.I(), { color: 0xa3a3a3 });
      const car = new Car(w, raw, { position: [deg ? 35 : 0, 0, 0], yaw: (deg * Math.PI) / 180 });
      const start = car.body.pos.slice(); const frames = [];
      let passedAt = null, reachedAt = null;
      drive(car, 14, (t, c, tel) => ({ throttle: speedHold(kmh)(tel), steer: 0, handbrake: false }), frames, 2, (t, c) => {
        const z = c.body.pos[2];
        if (reachedAt === null && z < -45 + c.wheelbaseStuds * 0.6) reachedAt = t;
        if (z < -75 - c.wheelbaseStuds) { passedAt = t; return true; }
      });
      const took = passedAt !== null && reachedAt !== null ? passedAt - reachedAt : null;
            return { pass: took !== null && took < 5 && car.recoveries === 0, measured: took !== null ? `over in ${f(took, 1)} s (${car.unsticks} assists, ${car.recoveries} resets)` : `STUCK at the kerb (${car.unsticks} assists, ${car.recoveries} resets)`, expected: `${h} studs (${Math.round(h * MPS * 100)} cm): < 5 s, no reset`, frames, world: w };
    });
  }

  test('beached', 'High-centred on a ridge (wheels hanging)', 'Never stuck', (raw) => {
    const w = flatWorld(400);
    const probe = new Car(new World(), raw);
    const hullBottomAbove = probe.hull ? probe.hull.box.c[1] - probe.hull.box.size[1] / 2 - probe.wheels[0].contactLocal[1] : 1;
    const ridgeH = hullBottomAbove + probe.spec.suspension.maxLength * 0.55;
    w.box('Ridge', [0, ridgeH / 2, 0], [40, ridgeH, probe.wheelbaseStuds * 0.3], M.I(), { color: 0xb48ead });
    const car = new Car(w, raw, { position: [0, ridgeH - hullBottomAbove + 0.2, 0] });
    const start = car.body.pos.slice(); const frames = [];
    drive(car, 1, () => ({ throttle: 0, steer: 0, handbrake: false }), frames);
    const g0 = car.telemetry.grounded;
    let freeAt = null;
    drive(car, 8, () => ({ throttle: 1, steer: 0, handbrake: false }), frames, 2, (t, c, tel) => {
      if (Math.abs(travel(c, start)) > car.wheelbaseStuds * 1.2 && tel.grounded >= 3) { freeAt = t; return true; }
    });
    return { pass: freeAt !== null && freeAt < 5, measured: freeAt !== null ? `free in ${f(freeAt, 1)} s (${g0} wheels touching at start, ${car.unsticks} assists, ${car.recoveries} resets)` : `STUCK (${g0} wheels touching, ${car.unsticks} assists, ${car.recoveries} resets)`, expected: 'escapes < 5 s without the reset button', frames, world: w };
  });

  test('wallscrape', 'Glancing a wall at 60 km/h (low-friction hull)', 'Never stuck', (raw) => {
    const w = flatWorld(1200);
    w.box('Wall', [-6, 4, -400], [2, 8, 800], M.I(), { color: 0x81a1c1 });
    const car = new Car(w, raw, { position: [40, 0, 120], yaw: (12 * Math.PI) / 180 });
    const frames = []; let hitAt = null, speedAfter = null, entrySpeed = null;
    drive(car, 8, (t, c, tel) => ({ throttle: speedHold(60)(tel), steer: 0, handbrake: false }), frames, 2, (t, c, tel) => {
      if (hitAt === null && c.hullContacts) { hitAt = t; entrySpeed = tel.speedKmh; c.hullContacts = 0; }
      if (hitAt !== null && t > hitAt + 2) { speedAfter = Math.abs(tel.speedKmh); return true; }
      if (hitAt === null) c.hullContacts = 0;
    });
    const ok = hitAt !== null && speedAfter > 35 && pitchRoll(car).upY > 0.8;
    return { pass: ok, measured: hitAt === null ? 'never touched wall' : `${f(entrySpeed, 0)} → ${f(speedAfter, 0)} km/h 2 s after contact`, expected: 'slides along, keeps > 35 km/h', frames, world: w };
  });

  test('pole', 'Corner clips a pole at 25 km/h', 'Never stuck', (raw) => {
    const w = flatWorld(400); const probe = new Car(new World(), raw);
    const x = probe.track / 2 - 0.4;
    w.box('Pole', [x, 6, -25], [0.8, 12, 0.8], M.I(), { color: 0xebcb8b });
    const car = new Car(w, raw); const start = car.body.pos.slice(); const frames = [];
    let passedAt = null;
    drive(car, 10, (t, c, tel) => ({ throttle: speedHold(25)(tel), steer: 0, handbrake: false }), frames, 2, (t, c) => {
      if (travel(c, start) > 45) { passedAt = t; return true; }
    });
    return { pass: passedAt !== null, measured: passedAt !== null ? `past it in ${f(passedAt, 1)} s (${car.unsticks} assists, ${car.recoveries} resets)` : `STUCK on pole (${car.unsticks} assists, ${car.recoveries} resets)`, expected: 'deflects past (driver not steering)', frames, world: w };
  });

  for (const [id, title, R] of [['roof', 'Upside down → auto-flip', M.rotX(Math.PI)], ['side', 'On its side → auto-flip', [[0, -1, 0], [1, 0, 0], [0, 0, 1]]]]) {
    test(id, title, 'Never stuck', (raw) => {
      const w = flatWorld(200); const car = new Car(w, raw, { position: [0, 4, 0], R }); const frames = [];
      let uprightAt = null, drovenAt = null, minGround = 4, settleT = null;
      drive(car, 9, (t, c) => ({ throttle: t > 3.5 ? 1 : 0, steer: 0, handbrake: false }), frames, 2, (t, c, tel) => {
        if (settleT === null && (c.recoveries > 0 || (t > 1 && pitchRoll(c).upY > 0.95))) settleT = t;
        if (settleT !== null && t > settleT + 0.8 && t <= 3.5) minGround = Math.min(minGround, tel.grounded);
        if (uprightAt === null && c.recoveries > 0 && pitchRoll(c).upY > 0.95 && tel.grounded === 4 && Math.abs(c.body.v[1]) < 0.5) uprightAt = t;
        if (t > 3.5 && tel.grounded === 4 && tel.speedKmh > 15) { drovenAt = t; return true; }
      });
      const ok = c4(minGround) && drovenAt !== null;
      function c4(g) { return g === 4; }
      return { pass: ok, measured: `${car.recoveries ? 'auto-flip reset' : 'righted itself in the air'} · wheels on ground after landing: ${minGround}/4 · ${drovenAt !== null ? 'drove off at ' + f(drovenAt, 1) + ' s' : 'did NOT drive off'} (${car.unsticks} assists)`, expected: 'lands on 4 wheels, drives off with throttle', frames, world: w };
    });
  }

  // Wall hits (VehicleSim impact softening + a zero-bounce hull): a 45° hit at speed must glance
  // the car along the wall, not spin it away, flip it or hop it, and holding the throttle into a
  // wall afterwards must not fire the stuck assist (its lift-and-push bumps the car against it).
  for (const [ang, kmh] of [[45, 70], [45, 120], [90, 50]]) {
    test(`wallhit${ang}_${kmh}`, `Wall hit at ${ang}°, ${kmh} km/h, throttle held into it`, 'Never stuck', (raw) => {
      const w = flatWorld(1200); w.boxes[0].h = [3000, 5, 3000]; w.boxes[0].c = [0, -5, 0];
      w.box('Wall', [0, 6, -200], [600, 12, 4], M.I(), { color: 0x81a1c1 });
      const yaw = ((90 - ang) * Math.PI) / 180;
      const car = new Car(w, raw, { position: [0, 0, 0], yaw }); const lk = car.cf.look; car.place([-lk[0] * 220, 0, -198 - lk[2] * 220], yaw);
      const v = raw.name === 'Kart' ? Math.min(kmh, 80) : kmh; const frames = [];
      let hit = null, hop = 0, tilt = 0, turned = 0, rebound = 0; const assists0 = car.unsticks + car.recoveries;
      drive(car, 14, (t, c, tel) => ({ throttle: hit === null ? clamp((v - tel.speedKmh) * 0.2, -1, 1) : 1, steer: 0, handbrake: false }), frames, 2, (t, c) => {
        if (hit === null && c.hullContacts) hit = t;
        c.hullContacts = 0;
        if (hit === null) return false;
        const dt = t - hit;
        if (dt < 1.5) { hop = Math.max(hop, c.body.v[1] * MPS); tilt = Math.max(tilt, (Math.acos(clamp(c.cf.up[1], -1, 1)) * 180) / Math.PI); }
        if (dt > 0.02 && dt < 0.3) rebound = Math.max(rebound, c.body.v[2] * MPS); // bounce that lasts (the sim corrects the collision frame next step), not driving away later
        if (dt < 0.5) turned += (Math.abs(c.body.w[1]) * 180 / Math.PI) * DT;
        return dt > 4;
      });
      const assists = car.unsticks + car.recoveries - assists0;
      const ok = hit !== null && hop < 1.5 && tilt < 20 && turned < (ang === 90 ? 15 : 75) && rebound < 3 && assists === 0;
      return { pass: ok, measured: hit === null ? 'never touched the wall' : `hop ${f(hop)} m/s · tilt ${f(tilt, 0)}° · turned ${f(turned, 0)}° in 0.5 s · rebound ${f(rebound, 1)} m/s · ${assists} assists`, expected: `hop < 1.5 m/s, tilt < 20°, turned < ${ang === 90 ? 15 : 75}° (glances along, no spin-away), rebound < 3 m/s, no stuck assist`, frames, world: w };
    });
  }

  // GTA-style air control: W/S pitch, A/D roll, handbrake + A/D spin. Keys held at take-off are
  // ignored until released (holding W off a ramp must not dive the nose).
  test('airinput', 'Air control keys: hold W, S nose up, D roll, handbrake+D spin', 'Handling', (raw) => {
    if (!(Lab.normalize(raw).recovery.airInput > 0)) return { pass: true, measured: 'air input off (recovery.airInput 0)', expected: '—', frames: [], world: flatWorld(10) };
    const res = {}; let frames = [], world = null;
    for (const [key, air] of [['W', { throttle: 1, steer: 0 }], ['S', { throttle: -1, steer: 0 }], ['D', { throttle: 0, steer: 1 }], ['HD', { throttle: 0, steer: 1, handbrake: true }]]) {
      const w = flatWorld(3000); w.boxes[0].h = [200, 5, 1500];
      const a = (20 * Math.PI) / 180, L = 40; w.box('Kick', [0, (Math.sin(a) * L) / 2 - 1, -60], [30, 2, L], M.rotX(a), { color: 0xd08770 });
      const car = new Car(w, raw, { position: [0, 0, 300] }); const rec = key === 'S' ? frames : null; if (rec) world = w;
      const vk = raw.name === 'Kart' ? 65 : 100; let tAir = null, p0 = 0, y0 = 0;
      const ang = (c) => ({ pitch: pitchRoll(c).pitch, roll: pitchRoll(c).roll, yaw: (Math.atan2(-c.cf.look[0], -c.cf.look[2]) * 180) / Math.PI });
      drive(car, 12, (t, c, tel) => (tAir === null ? { throttle: key === 'W' ? 1 : speedHold(vk)(tel), steer: 0, handbrake: false } : { handbrake: false, ...air }), rec, 2, (t, c, tel) => {
        if (tAir === null && tel.grounded === 0 && t > 1) { tAir = t; p0 = ang(c).pitch; y0 = ang(c).yaw; }
        if (tAir !== null && t - tAir >= 0.4) { const n = ang(c); res[key] = { dp: n.pitch - p0, roll: n.roll, dy: ((n.yaw - y0 + 540) % 360) - 180 }; return true; }
      });
    }
    const ok = res.W && res.W.dp > -25 && res.S && res.S.dp > 20 && res.D && res.D.roll < -20 && res.HD && res.HD.dy < -20;
    return { pass: !!ok, measured: res.HD ? `held W: pitch ${f(res.W.dp, 0)}° · S: ${f(res.S.dp, 0)}° · D: roll ${f(res.D.roll, 0)}° · handbrake+D: yaw ${f(res.HD.dy, 0)}° (0.4 s)` : 'did not get airborne', expected: 'held W ≥ -25° (no dive), S nose up > 20°, D rolls right > 20°, handbrake+D spins right > 20°', frames, world };
  });

  test('jump', 'Ramp jump at 80 km/h, air control', 'Never stuck', (raw) => {
    const w = flatWorld(1200);
    const ang = (14 * Math.PI) / 180, rl = 24;
    w.box('Ramp', [0, Math.sin(ang) * rl / 2 - 0.8, -60], [30, 1.6, rl], M.rotX(ang), { color: 0xd08770 });
    const car = new Car(w, raw, { position: [0, 0, 190] });
    const v = raw.name === 'Kart' ? 60 : 80; const frames = [];
    let wheelsAfter = 4, air = 0, airMax = 0, landed = null, worstPitchAtLanding = 0, wasAir = false, upAfter = 1;
    drive(car, 9, (t, c, tel) => ({ throttle: speedHold(v)(tel), steer: 0, handbrake: false }), frames, 2, (t, c, tel) => {
      if (tel.grounded === 0) { air += DT; airMax = Math.max(airMax, air); wasAir = true; }
      else { if (wasAir && air > 0.08 && landed === null) { landed = t; worstPitchAtLanding = pitchRoll(c).pitch; } air = 0; }
      if (landed !== null) upAfter = Math.min(upAfter, pitchRoll(c).upY > 0.3 ? 1 : 0);
      if (landed !== null && t > landed + 1 && t < landed + 2) wheelsAfter = Math.min(wheelsAfter, tel.grounded);
      if (landed !== null && t > landed + 2) return true;
    });
    const ok = airMax > 0.08 && landed !== null && Math.abs(worstPitchAtLanding) < 20 && upAfter > 0.5 && wheelsAfter === 4;
    return { pass: ok, measured: `air ${f(airMax)} s · pitch at landing ${f(worstPitchAtLanding, 1)}° · ${upAfter > 0.5 ? 'stays on wheels' : 'ROLLED OVER'} · ${wheelsAfter}/4 wheels on ground after`, expected: 'air control lands it within ±20° pitch, 4 wheels', frames, world: w };
  });

  // GTA-style stunt jump: a tall kicker off a long run-up, a gap lined with parked cars, a bus
  // and crates, then a descending landing ramp and a runout. The gap is sized from the vehicle's
  // own launch speed (at 85% of it, so a slightly slow car still makes the ramp) and each obstacle
  // is kept under that slow arc with clearance for the body, so the test is about the car: does it
  // leave the lip cleanly, hold its attitude in the air without dropping the nose into the
  // obstacles, and absorb the landing on 4 wheels without bouncing, rolling, or a reset.
  test('stunt', 'Stunt jump over parked cars, bus and crates', 'Never stuck', (raw) => {
    const w = new World(); w.box('Ground', [0, -5, 0], [400, 10, 2400], M.I(), { color: 0x3b4252 });
    const probe = new Car(new World(), raw);
    const kart = raw.name === 'Kart';
    const vKmh = kart ? 65 : 105; const vS = vKmh / 3.6 / MPS; // studs/s
    const kAng = (20 * Math.PI) / 180, kH = kart ? 12 : 14, kLen = kH / Math.sin(kAng);
    const lipZ = -kLen * Math.cos(kAng); // kicker starts at z=0 and rises toward -Z
    w.box('Kicker', [0, (kH - 1.6) / 2, lipZ / 2], [24, 1.6, kLen], M.rotX(kAng), { color: 0xd08770 });
    // Ballistic arc of the car's rest point at 85% speed (Roblox gravity), from the lip.
    const g = w.gravity, vs = vS * 0.85, vy = vs * Math.sin(kAng), vz = vs * Math.cos(kAng);
    const lH = kH * 0.5; // the landing ramp starts lower than the lip, so the car drops onto it
    const tLand = (vy + Math.sqrt(vy * vy + 2 * g * (kH - lH))) / g;
    const gapStart = lipZ, gap = vz * tLand; // the landing ramp's top edge sits where the slow car comes down
    const arcY = (dz) => { const t = dz / vz; return kH + vy * t - 0.5 * g * t * t; };
    const bodyDrop = (probe.hull ? probe.hull.box.size[1] : 5) * 0.5 + 1.5; // half the body + margin under the car's origin path
    // Fill the gap with obstacles, front to back, each kept under the slow arc.
    const kinds = kart
      ? [['Crate', 3, 3.5, 0x8f6a3e], ['ParkedKart', 4, 2.5, 0x5e81ac], ['Barrel', 2.5, 3, 0xbf616a], ['Crate', 3, 3.5, 0x8f6a3e]]
      : [['ParkedCar', 6.5, 5, 0x5e81ac], ['Bus', 9, 10, 0xebcb8b], ['ParkedCar', 6.5, 5, 0xa3be8c], ['CrateStack', 5, 7, 0x8f6a3e], ['ParkedCar', 6.5, 5, 0xb48ead], ['Van', 7, 7, 0x88c0d0]];
    const obstacles = []; let z = gapStart - 2; let k = 0;
    while (true) {
      const [name, depth, want, color] = kinds[k % kinds.length];
      if (gapStart - z + depth > gap - 2) break;
      const zFar = z - depth;
      const under = Math.min(arcY(gapStart - z), arcY(gapStart - zFar)) - bodyDrop; // lowest arc point over this obstacle
      const h = Math.min(want, under);
      if (h >= 2) obstacles.push(w.box(name, [0, h / 2, z - depth / 2], [kart ? 10 : 16, h, depth], M.I(), { color }));
      z = zFar - (kart ? 1 : 1.5); k++;
    }
    const deckZ = gapStart - gap;
    const lAng = (12 * Math.PI) / 180, lLen = lH / Math.sin(lAng);
    // One descending landing ramp from the gap edge down to the runout (rotX(-a) tilts -Z down).
    // No flat deck in front of it: a low car bottoming out on a deck/ramp crest catches the
    // ramp box's end face in the lab's contact solver and gets a false yaw kick.
    const lz0 = deckZ, lz1 = lz0 - lLen * Math.cos(lAng);
    w.box('LandingRamp', [0, lH / 2 - 0.8 * Math.cos(lAng), (lz0 + lz1) / 2], [24, 1.6, lLen], M.rotX(-lAng), { color: 0xd08770 });

    const car = new Car(w, raw, { position: [0, 0, 1000] });
    const frames = []; const obsSet = new Set(obstacles);
    let lipKmh = null, air = 0, airMax = 0, wasAir = false, landed = null, landZ = null, landPitch = 0;
    let hits = new Set(), minUp = 1, wheelsAfter = 4, kmhAfter = null, maxX = 0, maxYaw = 0, lipT = null;
    const hullTouches = (c) => {
      if (!c.hull) return null;
      for (const p of c.hull.samples.map((l) => c.body.toWorld(l))) for (const b of obstacles) {
        const l = M.tmulV(b.R, V.sub(p, b.c));
        if (Math.abs(l[0]) < b.h[0] + 0.05 && Math.abs(l[1]) < b.h[1] + 0.05 && Math.abs(l[2]) < b.h[2] + 0.05) return b;
      }
      return null;
    };
    drive(car, 30, (t, c, tel) => ({ throttle: lipT === null ? speedHold(vKmh)(tel) : landed !== null && t > landed + 0.4 ? speedHold(vKmh * 0.6)(tel) : 0.4, steer: 0, handbrake: false }), frames, 2, (t, c, tel) => {
      const pz = c.body.pos[2];
      if (lipT === null && pz < lipZ + 1) { lipT = t; lipKmh = tel.speedKmh; }
      for (const wh of c.wheels) if (wh.hit && obsSet.has(wh.hit.part)) hits.add(wh.hit.part.name);
      const hb = hullTouches(c); if (hb) hits.add(hb.name);
      if (pz > lz1) maxX = Math.max(maxX, Math.abs(c.body.pos[0])); // on the run-up, kicker, in the air or on the landing ramp
      if (lipT !== null) maxYaw = Math.max(maxYaw, Math.abs((Math.atan2(-c.cf.look[0], -c.cf.look[2]) * 180) / Math.PI));
      if (lipT !== null) minUp = Math.min(minUp, pitchRoll(c).upY);
      if (tel.grounded === 0 && lipT !== null) { air += DT; airMax = Math.max(airMax, air); wasAir = true; }
      else { if (wasAir && air > 0.1 && landed === null) { landed = t; landZ = pz; landPitch = pitchRoll(c).pitch; } air = 0; }
      if (landed !== null && t > landed + 0.8 && t < landed + 2) wheelsAfter = Math.min(wheelsAfter, tel.grounded);
      if (landed !== null && t > landed + 2) { kmhAfter = tel.speedKmh; return true; }
    });
    const lastObsZ = obstacles.length ? Math.min(...obstacles.map((b) => b.c[2] - b.h[2])) : gapStart;
    const cleared = landZ !== null && landZ < lastObsZ;
    const flight = landZ !== null ? (gapStart - landZ) * MPS : null;
    const ok = obstacles.length >= 3 && lipKmh !== null && lipKmh >= vKmh * 0.85 && hits.size === 0 && cleared &&
      Math.abs(landPitch) < 25 && minUp > 0.7 && wheelsAfter === 4 && car.recoveries === 0 && kmhAfter !== null && kmhAfter > 20 && maxX < 9 && maxYaw < 15;
    const names = obstacles.map((b) => b.name).join(', ');
    return {
      pass: ok,
      measured: `lip ${f(lipKmh, 0)} km/h · air ${f(airMax)} s · ${f(flight, 1)} m · over ${obstacles.length} (${names}) · ${hits.size ? 'HIT ' + [...hits].join(', ') : cleared ? 'clean' : 'SHORT, landed in the gap'} · landing pitch ${f(landPitch, 1)}° · ${minUp > 0.7 ? 'upright' : 'ROLLED'} · ${wheelsAfter}/4 wheels · ${f(kmhAfter, 0)} km/h after · off line ${f(maxX, 1)} studs, heading ±${f(maxYaw, 0)}° · ${car.recoveries} resets`,
      expected: `≥ ${f(vKmh * 0.85, 0)} km/h at the lip, ≥3 obstacles, touches none, lands past them within ±25°, 4 wheels, no reset, stays on the 24-stud ramp (< 9 studs off line, < 15° heading), drives on`,
      frames, world: w,
    };
  });

  for (const deg of [5, 10, 15]) test(`park${deg}`, `Parked on a ${deg}° slope (server idle input)`, 'Slopes', (raw) => {
    const w = new World(); const ang = (deg * Math.PI) / 180;
    w.box('Slope', [0, -5, 0], [200, 10, 400], M.rotX(ang), { color: 0x4c566a });
    const car = new Car(w, raw, { position: [0, 0, 0] });
    // place on slope surface facing uphill (-Z goes up because rotX tilts +Z down)
    const n = M.mulV(M.rotX(ang), [0, 1, 0]);
    car.body.setCFrame(V.add(V.mul(n, 0.2), M.mulV(M.rotX(ang), [0, -car.wheels[0].contactLocal[1], 0])), M.rotX(ang));
    const frames = []; const start = car.body.pos.slice(); let settled = 0, sleptAt = null, rolled1 = null, kmh5 = 0;
    drive(car, 10, () => ({ throttle: 0, steer: 0, handbrake: false }), frames, 3, (t, c, tel) => {
      if (rolled1 === null && V.len(V.sub(c.body.pos, start)) * MPS > 1) rolled1 = t;
      if (t <= 5) kmh5 = Math.abs(tel.speedKmh);
      if (t > 5 && rolled1 !== null) return true;
      const still = V.len(c.body.v) < 0.3 && V.len(c.body.w) < 0.1;
      settled = still && tel.grounded > 0 ? settled + DT : 0;
      if (settled >= 2 && sleptAt === null) { sleptAt = t; return true; }
    });
    const creep = V.len(V.sub(car.body.pos, start)) * MPS;
    return { pass: sleptAt !== null, measured: sleptAt !== null ? `holds, asleep at ${f(sleptAt, 1)} s, moved ${f(creep)} m` : `ROLLS AWAY: 1 m after ${f(rolled1, 1)} s, ${f(kmh5, 0)} km/h after 5 s (no pedal)`, expected: 'holds and sleeps', frames, world: w };
  });

  for (const deg of [8, 12, 18]) test(`climb${deg}`, `Hill start up a ${deg}° (${Math.round(Math.tan((deg * Math.PI) / 180) * 100)}%) grade`, 'Slopes', (raw) => {
    const w = new World(); const ang = (deg * Math.PI) / 180, R = M.rotX(ang);
    w.box('Hill', [0, -5, 0], [200, 10, 1600], R, { color: 0x4c566a });
    const car = new Car(w, raw);
    const n = M.mulV(R, [0, 1, 0]);
    car.body.setCFrame(V.add(V.mul(n, 0.2), M.mulV(R, [0, -car.wheels[0].contactLocal[1], 0])), R);
    const frames = []; const start = car.body.pos.slice();
    const tel = drive(car, 8, () => ({ throttle: 1, steer: 0, handbrake: false }), frames, 2, (t, c) => V.len(V.sub(c.body.pos, start)) * MPS > 300);
    const up = V.dot(V.sub(car.body.pos, start), M.mulV(R, [0, 0, -1])) * MPS;
    return { pass: up > 20, measured: up > 0 ? `climbed ${f(up, 0)} m, ${f(tel.speedKmh, 0)} km/h after 8 s` : `SLID BACK ${f(-up, 0)} m (${f(tel.speedKmh, 0)} km/h) with full throttle`, expected: 'climbs (real cars manage 30%+)', frames, world: w };
  });

  test('character', 'With a seated character (~12 RMU) welded in', 'Handling', (raw, rep) => {
    const w = flatWorld(200); w.boxes[0].h = [3000, 5, 3000]; w.boxes[0].c = [0, -5, 0];
    const car = new Car(w, raw, { characterMass: 12 }); const frames = [];
    drive(car, 3, () => ({ throttle: 0, steer: 0, handbrake: false }), frames);
    const restRoll = pitchRoll(car).roll;
    let minUp = 1;
    const vmax = raw.name === 'Kart' ? 60 : 90;
    drive(car, 14, (t, c, tel) => ({ throttle: speedHold(Math.min(20 + t * 6, vmax))(tel), steer: -0.6, handbrake: false }), frames, 4, (t, c) => { minUp = Math.min(minUp, pitchRoll(c).upY); });
    const share = (12 / car.assemblyMass) * 100;
    const ok = Math.abs(restRoll) < 3 && minUp > 0.7;
    return { pass: ok, measured: `character = ${f(share, 0)}% of mass · rest lean ${f(restRoll, 1)}° · ${minUp > 0.7 ? 'no rollover' : 'ROLLED'}`, expected: '< 3° lean, no rollover', frames, world: w };
  });

  function serializeWorld(w) { return w.boxes.map((b) => ({ name: b.name, c: b.c, h: b.h, R: b.R, color: b.color })); }

  function runOne(t, specName, SPECS) {
    const s = SPECS[specName];
    const t0 = Date.now();
    let r;
    try { r = t.fn(s.raw, s.report); } catch (e) { r = { pass: false, measured: 'ERROR ' + e.message, expected: '', frames: [], world: new World() }; }
    return { id: t.id, title: t.title, group: t.group, spec: specName, pass: r.pass, measured: r.measured, expected: r.expected, ms: Date.now() - t0, frames: r.frames, world: serializeWorld(r.world) };
  }

  return { TESTS, runOne, DT };
});
