// Vehicle lab, part 3: line-by-line JS ports of the kit's tank and train sims (TankSim.luau,
// TrainSim.luau, TrainTrack.luau) on the same Roblox-like rigid-body engine (airsea.js's Rig).
// Specs are the normalized JSON (camelCase) from rveh.cjs.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./physics.js'), require('./airsea.js'));
  else root.HeavyLab = factory(root.VehicleLab, root.AirSeaLab);
})(typeof self !== 'undefined' ? self : this, function (Lab, AS) {
  'use strict';
  const { V, M, collide, rotateAxis, clamp, lookAtR } = Lab;
  const { Rig, makeHull, smoothstep, lerp, rad, deg, flat } = AS;
  const MPS = 0.28, G = 9.81, RHO_AIR = 1.225;
  const RMU_PER_KG = 150 / 1300; // heavy vehicles: a car's root mass per kg, so tanks and trains outweigh cars in proportion
  const heavyMass = (size, kg) => { const vol = size[0] * size[1] * size[2]; return clamp((kg * RMU_PER_KG) / vol, 0.7, 100) * vol; };

  // ------------------------------------------------------------------ TankSim.luau
  const TANK = { CAST: 0.85, WALL: 0.35, STOP_GAIN: 0.5, K_TRACK: 60, COAST_G: 0.15, BUMP: 4, CONTACT_MAX: 0.5, ESC_GAIN: 6, HOLD_MS: 0.5, AIR_LEVEL: 2, AIR_MAX: 1, AIR_DAMP: 8, IDLE: 0.2 };
  const tankMath = {
    tractiveEffort: (s, v) => Math.min(s.engine.maxTractiveG * s.mass * G, Math.min(s.tracks.grip, 2) * s.mass * G, (s.engine.efficiency * s.engine.power * 1000) / Math.max(Math.abs(v), 0.5)),
  };
  class Tank extends Rig {
    constructor(world, spec, opts = {}) {
      const size = [(spec.width * 0.8) / MPS, (spec.height * 0.5) / MPS, (spec.length * 0.8) / MPS];
      super(world, spec, size, heavyMass(size, spec.mass));
      const t = spec.tracks, n = t.contacts, r = t.wheelRadius / MPS;
      const staticLength = spec.suspension.maxLength * spec.suspension.rideHeight;
      const com = [0, spec.comHeight / MPS, 0];
      const m = this.body.mass, gEff = G / MPS;
      const cornerMass = m / (2 * n);
      const omega = 2 * Math.PI * spec.suspension.frequency;
      const k = cornerMass * omega * omega, c = 2 * spec.suspension.dampingRatio * Math.sqrt(k * cornerMass);
      const staticForce = cornerMass * gEff;
      this.contacts = [];
      for (const side of [-1, 1]) {
        const x = (side * t.tread) / 2 / MPS;
        const pts = [];
        for (let i = 0; i < n; i++) pts.push({ z: ((i / (n - 1) - 0.5) * t.contactLength) / MPS, lift: 0, end: false });
        // Idler and sprocket: at the hull ends, raised by the approach height, so the track climbs steps.
        const endZ = Math.max(spec.length / 2 - t.wheelRadius, t.contactLength / 2 + t.wheelRadius);
        for (const e of [-1, 1]) pts.push({ z: (e * endZ) / MPS, lift: t.approach / MPS, end: true });
        for (const p of pts) {
          const center = [x, r + p.lift, p.z];
          this.contacts.push({ left: side < 0, end: p.end, radius: r, local: V.sub(V.add(center, [0, staticLength, 0]), com), k, c, staticForce, restLength: staticLength + staticForce / k, length: staticLength, cornerMassKg: spec.mass / (2 * n), hit: null, springForce: 0, grounded: false });
        }
      }
      // Collision hull: hull and turret above the track tops (wheel plus idler height). Below it the
      // track contacts carry everything, so the idlers climb steps instead of the hull snagging.
      const bottom = (2 * t.wheelRadius + t.approach - spec.comHeight) / MPS;
      this.hull = makeHull([(-spec.width / 2) / MPS, bottom, (-spec.length / 2) / MPS], [(spec.width / 2) / MPS, (spec.height - spec.comHeight) / MPS, (spec.length / 2) / MPS], bottom, spec.body.hullFriction);
      this.state = TANK.IDLE; this.coastV = 0; this.turretYaw = 0; this.gunPitch = 0; this.reload = 0; this.flipTimer = 0; this.stuckTimer = 0; this.unstickUntil = 0;
      this.place(opts.position || [0, 0, 0], opts.yaw || 0, com[1]);
    }

    // input: { throttle -1..1, steer -1..1 (+ = turn right), aim (world dir, optional), fire (bool) }
    step(dt, input) {
      const spec = this.spec, t = spec.tracks, e = spec.engine, b = this.body, world = this.world;
      this.begin();
      const { up, look: forward, right } = this.cf;
      const vMs = V.mul(b.v, MPS);
      const Fh = flat(forward);
      const vF = V.dot(vMs, Fh);
      const yawR = -b.w[1];
      const thr = clamp(input.throttle || 0, -1, 1), steer = clamp(input.steer || 0, -1, 1);
      const W = spec.mass * G;
      const active = Math.abs(thr) > 0.05 || Math.abs(steer) > 0.05;
      this.state += clamp((active ? 1 : TANK.IDLE) - this.state, -dt / e.spool, dt / e.spool);

      // Track speed commands, like a steering unit: forward speed plus a yaw rate.
      // Off the throttle it coasts down: the track speed falls at Coast g (engine braking and track
      // losses), uphill or down, until it stops and the brakes hold.
      const coasting = Math.abs(thr) <= 0.05;
      this.coastV = coasting ? Math.sign(this.coastV) * Math.max(Math.abs(this.coastV) - TANK.COAST_G * G * dt, 0) : vF;
      const vCmd = coasting ? this.coastV : thr > 0 ? (thr * e.maxSpeedKmh) / 3.6 : (thr * e.reverseSpeedKmh) / 3.6;
      const st = spec.steering;
      const rMax = lerp(rad(st.pivotRate), Math.min(rad(st.turnRate), (st.maxLateralG * G) / Math.max(Math.abs(vF), 1)), smoothstep(0, 4, Math.abs(vF)));
      const rCmd = steer * rMax;
      const B = t.tread;
      const cmd = [vCmd + (rCmd * B) / 2, vCmd - (rCmd * B) / 2]; // left, right
      const meas = [vF + (yawR * B) / 2, vF - (yawR * B) / 2];
      const holding = !active && Math.abs(vF) < TANK.HOLD_MS;
      let force = [0, 1].map((i) => TANK.K_TRACK * (spec.mass / 2) * (cmd[i] - meas[i]));
      // Limits: traction and torque per side, braking per side, total power.
      const sideDrive = (e.maxTractiveG * W) / 2 * this.state, sideBrake = (spec.brakes.decelG * W) / 2;
      force = force.map((f, i) => (Math.sign(f) === Math.sign(meas[i]) || Math.abs(meas[i]) < 0.3 ? clamp(f, -sideDrive, sideDrive) : clamp(f, -sideBrake, sideBrake)));
      const pMax = e.efficiency * e.power * 1000 * this.state;
      // Regenerative steering: the braked inner track's power goes to the outer one, so the cap is
      // on the net power; only the driving side is scaled back.
      const pDrive = Math.max(0, force[0] * meas[0]) + Math.max(0, force[1] * meas[1]);
      const pNet = force[0] * meas[0] + force[1] * meas[1];
      if (pNet > pMax && pDrive > 0) { const k = clamp(1 - (pNet - pMax) / pDrive, 0, 1); force = force.map((f, i) => (f * meas[i] > 0 ? f * k : f)); }
      if (holding) force = [0, 0];

      // Suspension contacts.
      const maxLength = spec.suspension.maxLength;
      let grounded = 0;
      const sideCount = [0, 0];
      for (const p of this.contacts) {
        const castR = p.radius * TANK.CAST, inset = p.radius - castR, lift = p.radius;
        let hit = world.spherecast(V.add(b.toWorld(p.local), V.mul(up, lift)), castR, V.mul(up, -(maxLength + inset + lift)));
        if (hit && V.dot(hit.normal, up) < TANK.WALL) hit = null;
        p.hit = hit;
        if (!hit) { p.grounded = false; p.length = maxLength; p.springForce = 0; continue; }
        // Past full compression the wheel or idler is rigid (a stiff bump stop), so the track climbs
        // a step instead of the hull hanging on it.
        const raw = hit.distance - inset - lift;
        const length = clamp(raw, 0, maxLength);
        let fs = p.k * (p.restLength - length) + p.c * ((p.length - length) / dt);
        if (raw < 0) fs += p.k * TANK.BUMP * -raw;
        p.springForce = clamp(fs, 0, TANK.CONTACT_MAX * b.mass * (G / MPS));
        p.length = length; p.grounded = true; grounded++; sideCount[p.left ? 0 : 1]++;
      }
      // Track forces per contact: drive share, rolling resistance, lateral friction (the skid-steer
      // turning moment emerges from the front and rear sliding opposite ways).
      for (const p of this.contacts) {
        if (!p.grounded) continue;
        const hit = p.hit, n = hit.normal;
        const load = p.cornerMassKg * G * clamp(p.springForce / p.staticForce, 0, 4);
        this.addForceRbx(V.mul(n, p.springForce), hit.position);
        const tf = V.unit(V.sub(forward, V.mul(n, V.dot(forward, n))));
        const tr = V.cross(tf, n);
        const cv = V.mul(b.velAt(hit.position), MPS);
        const longMs = V.dot(cv, tf), latMs = V.dot(cv, tr);
        const stop = (p.cornerMassKg / dt) * TANK.STOP_GAIN;
        const gripN = t.grip * load, latGrip = t.lateralGrip * load;
        // Friction stops the contact sliding, gravity's pull along the ground included (no creep).
        const gMass = load / G;
        let latF = clamp(-stop * latMs + gMass * G * tr[1], -latGrip, latGrip);
        let longF;
        if (holding) longF = clamp(-stop * longMs + gMass * G * tf[1], -spec.brakes.decelG * load * 2, spec.brakes.decelG * load * 2);
        else {
          const side = p.left ? 0 : 1;
          longF = force[side] / Math.max(sideCount[side], 1);
          longF -= Math.sign(longMs) * Math.min(t.rollingResistance * load, stop * Math.abs(longMs));
        }
        const total = Math.hypot(longF, latF);
        if (total > gripN && total > 0) { longF *= gripN / total; latF *= gripN / total; }
        this.addForce(V.add(V.mul(tf, longF), V.mul(tr, latF)), hit.position);
      }

      const I = this.inertia();
      if (grounded > 0) {
        // Stability assist: yaw beyond what the sticks ask for.
        if (spec.assists.stability > 0 && Math.abs(vF) > 1) {
          const over = yawR - clamp(yawR, Math.min(0, rCmd), Math.max(0, rCmd));
          this.addTorqueRbx([0, over * TANK.ESC_GAIN * spec.assists.stability * I[1], 0]);
        }
      } else {
        let rate = V.mul(V.cross(up, [0, 1, 0]), TANK.AIR_LEVEL);
        if (V.len(rate) > TANK.AIR_MAX) rate = V.mul(V.unit(rate), TANK.AIR_MAX);
        this.trackRates([rate[0], b.w[1], rate[2]], [TANK.AIR_DAMP, 0, TANK.AIR_DAMP], [1, 0, 1]);
      }
      this.realGravity(G);
      const speed = V.len(vMs);
      if (speed > 0.1) this.addForce(V.mul(V.unit(vMs), -0.5 * RHO_AIR * spec.aero.cd * spec.aero.area * speed * speed));

      // Never stuck: throttle held without moving -> lift and push; on its side or roof -> upright.
      let stuck = false;
      // A wall straight ahead is not "stuck": it would only climb it.
      const wallHit = Math.abs(thr) > 0.5 ? world.spherecast(b.pos, 1, V.mul(Fh, Math.sign(thr) * (spec.length / 2 / MPS + 2))) : null;
      const blocked = !!(wallHit && V.dot(wallHit.normal, [0, 1, 0]) < TANK.WALL);
      if (spec.recovery.stuckAssist && Math.abs(thr) > 0.5 && !blocked && V.len(vMs) < 0.3 && this.clock >= this.unstickUntil) this.stuckTimer += dt;
      else if (V.len(vMs) > 1) this.stuckTimer = 0;
      if (this.stuckTimer > 1.5) { this.stuckTimer = 0; this.unstickUntil = this.clock + 0.5; }
      if (this.clock < this.unstickUntil) { stuck = true; this.addForce(V.add([0, 0.5 * W, 0], V.mul(Fh, Math.sign(thr) * 0.4 * W))); }
      if (spec.recovery.autoFlip && up[1] < 0.3 && V.len(b.v) < 4) { this.flipTimer += dt; if (this.flipTimer > 1.5) { this.flipTimer = 0; this.recover(spec.comHeight / MPS + 1.5); } }
      else this.flipTimer = 0;

      // Turret and gun: turn toward the aim (a world direction) at their rates: stabilised.
      const tu = spec.turret;
      if (input.aim) {
        const l = M.tmulV(b.R, V.unit(input.aim));
        const yawT = Math.atan2(l[0], -l[2]);
        const pitchT = clamp(Math.atan2(l[1], Math.hypot(l[0], l[2])), rad(tu.minElevation), rad(tu.maxElevation));
        let dYaw = yawT - this.turretYaw;
        dYaw = Math.atan2(Math.sin(dYaw), Math.cos(dYaw));
        this.turretYaw += clamp(dYaw, -rad(tu.traverseRate) * dt, rad(tu.traverseRate) * dt);
        this.turretYaw = Math.atan2(Math.sin(this.turretYaw), Math.cos(this.turretYaw));
        this.gunPitch += clamp(pitchT - this.gunPitch, -rad(tu.elevationRate) * dt, rad(tu.elevationRate) * dt);
      }
      const turretRight = rotateAxis(right, up, -this.turretYaw);
      const gunDir = rotateAxis(rotateAxis(forward, up, -this.turretYaw), turretRight, this.gunPitch);
      this.reload = Math.max(0, this.reload - dt);
      let fired = false;
      if (input.fire && this.reload <= 0) {
        fired = true;
        this.reload = spec.gun.reload;
        const trunnion = V.add(b.pos, V.mul(up, (tu.height - spec.comHeight) / MPS));
        this.addForce(V.mul(gunDir, (-spec.gun.recoil * 1000) / dt), trunnion);
      }
      this.gunDir = gunDir;
      this.telemetry = { speedKmh: vF * 3.6, trackLeft: meas[0] * 3.6, trackRight: meas[1] * 3.6, yawRate: deg(yawR), turretYaw: deg(this.turretYaw), gunPitch: deg(this.gunPitch), reload: this.reload, fired, grounded, stuck, pitch: deg(Math.asin(clamp(forward[1], -1, 1))), roll: deg(Math.atan2(-right[1], up[1])), state: this.state };
      return this.telemetry;
    }
  }

  // ------------------------------------------------------------------ TrainTrack.luau
  // Catmull-Rom spline through ordered nodes, sampled into an arc-length table with tangent,
  // signed curvature (+ = turning left, rad/stud), cant, grade and speed limit.
  const TRACK = { PER_SEGMENT: 12, CURVE_WINDOW: 4, MAX_CANT: 6 };
  class TrainTrack {
    // nodes: [{ p:[x,y,z] (studs), speedLimit?, cant? (deg) }]; opts: { loop, designSpeedKmh }
    constructor(nodes, opts = {}) {
      this.loop = !!opts.loop;
      const N = nodes.length;
      const P = (i) => { if (this.loop) return nodes[((i % N) + N) % N].p; return nodes[clamp(i, 0, N - 1)].p; };
      const segs = this.loop ? N : N - 1;
      const pts = [], nodeAt = [];
      for (let i = 0; i < segs; i++) {
        const p0 = P(i - 1), p1 = P(i), p2 = P(i + 1), p3 = P(i + 2);
        for (let k = 0; k < TRACK.PER_SEGMENT; k++) {
          const u = k / TRACK.PER_SEGMENT, u2 = u * u, u3 = u2 * u;
          pts.push([0, 1, 2].map((a) => 0.5 * (2 * p1[a] + (-p0[a] + p2[a]) * u + (2 * p0[a] - 5 * p1[a] + 4 * p2[a] - p3[a]) * u2 + (-p0[a] + 3 * p1[a] - 3 * p2[a] + p3[a]) * u3)));
          nodeAt.push(i);
        }
      }
      if (!this.loop) { pts.push(P(N - 1).slice()); nodeAt.push(N - 1); }
      const cnt = pts.length;
      const cum = [0];
      for (let i = 1; i < cnt; i++) cum.push(cum[i - 1] + V.len(V.sub(pts[i], pts[i - 1])));
      this.length = this.loop ? cum[cnt - 1] + V.len(V.sub(pts[0], pts[cnt - 1])) : cum[cnt - 1];
      const idx = (i) => (this.loop ? ((i % cnt) + cnt) % cnt : clamp(i, 0, cnt - 1));
      const tangents = pts.map((_, i) => V.unit(V.sub(pts[idx(i + 1)], pts[idx(i - 1)])));
      const heading = tangents.map((t) => Math.atan2(t[0], t[2]));
      const distBetween = (a, b) => { let d = cum[idx(b)] - cum[idx(a)]; if (this.loop && d <= 0) d += this.length; return d; };
      let limit = 0;
      this.samples = pts.map((p, i) => {
        const a = idx(i - TRACK.CURVE_WINDOW), bb = idx(i + TRACK.CURVE_WINDOW);
        let dpsi = heading[bb] - heading[a];
        dpsi = Math.atan2(Math.sin(dpsi), Math.cos(dpsi));
        const ds = this.loop ? 2 * TRACK.CURVE_WINDOW * (this.length / cnt) : Math.max(distBetween(a, bb), 1e-6);
        const kappa = a === bb ? 0 : dpsi / ds;
        const node = nodes[nodeAt[i] % N];
        if (node.speedLimit) limit = node.speedLimit;
        const t = tangents[i];
        let cant = 0;
        if (node.cant !== undefined) cant = rad(node.cant) * Math.sign(kappa || 1);
        else if (opts.designSpeedKmh) { const v = opts.designSpeedKmh / 3.6; cant = Math.sign(kappa) * Math.min(Math.atan((v * v * Math.abs(kappa / MPS)) / G), rad(TRACK.MAX_CANT)); }
        const upFlat = V.unit(V.sub([0, 1, 0], V.mul(t, t[1])));
        return { pos: p, s: cum[i], tan: t, kappa, cant, up: rotateAxis(upFlat, t, -cant), grade: t[1] / Math.max(Math.hypot(t[0], t[2]), 1e-6), speedLimit: limit };
      });
    }
    wrap(s) { return this.loop ? ((s % this.length) + this.length) % this.length : clamp(s, 0, this.length); }
    sample(sIn) {
      const s = this.wrap(sIn), S = this.samples;
      let lo = 0, hi = S.length - 1;
      if (s >= S[hi].s) { lo = hi; }
      else { while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (S[mid].s <= s) lo = mid; else hi = mid; } }
      const a = S[lo], b = S[(lo + 1) % S.length];
      const segLen = lo + 1 < S.length ? b.s - a.s : this.length - a.s;
      const u = segLen > 1e-9 ? clamp((s - a.s) / segLen, 0, 1) : 0;
      const pos = V.add(a.pos, V.mul(V.sub(b.pos, a.pos), u));
      const tan = V.unit(V.add(V.mul(a.tan, 1 - u), V.mul(b.tan, u)));
      const kappa = lerp(a.kappa, b.kappa, u), cant = lerp(a.cant, b.cant, u);
      const upFlat = V.unit(V.sub([0, 1, 0], V.mul(tan, tan[1])));
      return { pos, tan, kappa, cant, up: rotateAxis(upFlat, tan, -cant), grade: lerp(a.grade, b.grade, u), speedLimit: a.speedLimit, radiusM: Math.abs(kappa) > 1e-9 ? MPS / Math.abs(kappa) : Infinity };
    }
    nearest(p) {
      let best = 0, bd = Infinity;
      for (const smp of this.samples) { const d = V.len(V.sub(smp.pos, p)); if (d < bd) { bd = d; best = smp.s; } }
      return best;
    }
  }

  // ------------------------------------------------------------------ TrainSim.luau
  const TRAIN = { PD_W: 12, PD_Z: 1, ROT_K: 8, ROT_TRACK: 20, RELEASE: 2, BRAKE_RATE: 1, HOLD_MS: 0.3, GAP: 1, TIP: 0.8 };
  const trainMath = {
    curveResistance(radiusM) { if (!(radiusM > 0) || radiusM === Infinity || radiusM > 1e5) return 0; const r = Math.max(radiusM, 35); return (r >= 300 ? 650 / (r - 55) : 500 / (r - 30)) / 1000; },
  };
  class Train {
    // opts: { s (studs along the track for the lead car's centre), dir (+1: forward = increasing s) }
    constructor(world, spec, track, opts = {}) {
      this.world = world; this.spec = spec; this.track = track; this.clock = 0; this.events = [];
      const vehicles = [{ massKg: spec.mass, length: spec.length, bogie: spec.bogieSpacing }];
      for (let i = 0; i < spec.cars.count; i++) vehicles.push({ massKg: spec.cars.mass, length: spec.cars.length, bogie: spec.cars.bogieSpacing });
      let offset = 0;
      this.cars = vehicles.map((veh, i) => {
        if (i > 0) offset += (vehicles[i - 1].length / 2 + veh.length / 2 + TRAIN.GAP) / MPS;
        const size = [3 / MPS, 3 / MPS, (veh.length * 0.9) / MPS];
        const rig = new Rig(world, { mass: veh.massKg }, size, heavyMass(size, veh.massKg));
        const com = spec.comHeight / MPS;
        rig.hull = makeHull([-1.5 / MPS, 0.8 / MPS - com, -veh.length / 2 / MPS], [1.5 / MPS, 4 / MPS - com, veh.length / 2 / MPS], 0.8 / MPS - com, 0.3);
        return { rig, offset, half: veh.bogie / 2 / MPS, massKg: veh.massKg };
      });
      this.totalMass = vehicles.reduce((a, v) => a + v.massKg, 0);
      this.s = opts.s || 0; this.dir = opts.dir || 1; this.v = (opts.kmh || 0) / 3.6; this.power = 0; this.brake = 0; this.reverser = 1; this.derailed = false; this.wheelslip = false; this.accel = 0;
      this.placeCars();
    }
    // Every car onto its pose, moving with the train.
    placeCars() {
      for (const car of this.cars) {
        const pose = this.pose(car), b = car.rig.body;
        b.setCFrame(pose.pos, pose.R);
        b.v = V.mul(pose.fwd, this.v / MPS);
        b.w = [0, pose.sample.kappa * this.dir * (this.v / MPS), 0];
      }
    }
    // Where a car belongs on the track: the chord between its bogies, raised by ComHeight, canted.
    pose(car) {
      const tr = this.track, d = this.dir;
      const si = this.s - d * car.offset;
      const f = tr.sample(si + d * car.half), r = tr.sample(si - d * car.half), c = tr.sample(si);
      const fwd = V.unit(V.sub(f.pos, r.pos));
      const up = V.unit(V.sub(c.up, V.mul(fwd, V.dot(c.up, fwd))));
      const pos = V.add(V.mul(V.add(f.pos, r.pos), 0.5), V.mul(up, this.spec.comHeight / MPS));
      const right = V.cross(fwd, up);
      const R = [[right[0], up[0], -fwd[0]], [right[1], up[1], -fwd[1]], [right[2], up[2], -fwd[2]]];
      return { pos, fwd, up, right, R, sample: c, si };
    }
    // TrainSim.Recover: back on the rails at the nearest point, stopped.
    recover() {
      const lead = this.cars[0].rig.body;
      this.s = this.track.nearest(lead.pos);
      const p = this.track.sample(this.s);
      const look = M.col(lead.R, 2);
      this.dir = V.dot(V.mul(look, -1), p.tan) >= 0 ? 1 : -1;
      this.v = 0; this.power = 0; this.brake = 1; this.derailed = false;
      this.placeCars();
      this.events.push({ t: this.clock, what: 'rerail' });
    }
    // Off the rails: every car flies on with its velocity and tips toward the outside of the curve.
    derail() {
      this.derailed = true;
      this.events.push({ t: this.clock, what: 'derail', kmh: this.v * 3.6 });
      for (const car of this.cars) {
        const c = this.track.sample(this.s - this.dir * car.offset);
        if (Math.abs(c.kappa) < 1e-9) continue;
        const b = car.rig.body, up = M.col(b.R, 1);
        const out = V.mul(V.unit(V.cross([0, 1, 0], c.tan)), -Math.sign(c.kappa));
        b.w = V.add(b.w, V.mul(V.unit(V.cross(up, out)), TRAIN.TIP));
      }
    }
    // input: { throttle -1..1 (W power / S brake; S stopped = reverse), handbrake (emergency) }
    step(dt, input) {
      const spec = this.spec, e = spec.engine, tr = this.track;
      const thr = clamp(input.throttle || 0, -1, 1);
      // Levers: power notches up at NotchRate, brakes apply at BRAKE_RATE, both release quickly.
      let driveCmd = 0, brakeCmd = 0;
      // W: power forward (brakes first if rolling backward). S: brakes, or power in reverse once stopped.
      if (thr > 0.05) { if (this.v < -TRAIN.HOLD_MS) brakeCmd = thr; else { this.reverser = 1; driveCmd = thr; } }
      else if (thr < -0.05) { if (this.v > TRAIN.HOLD_MS) brakeCmd = -thr; else { this.reverser = -1; driveCmd = -thr; } }
      this.power += clamp(driveCmd - this.power, -TRAIN.RELEASE * dt, spec.controls.notchRate * dt);
      this.brake += clamp(brakeCmd - this.brake, -TRAIN.RELEASE * dt, TRAIN.BRAKE_RATE * dt);
      const holding = Math.abs(thr) <= 0.05 && Math.abs(this.v) < TRAIN.HOLD_MS;
      if (holding) this.brake = 1;
      const emergency = !!input.handbrake;

      const Mt = this.totalMass, W = Mt * G;
      let net = 0, resist = 0;
      if (!this.derailed) {
        // Tractive effort: starting limit, adhesion, power.
        const limit = this.reverser > 0 ? e.speedLimitKmh : e.reverseSpeedKmh;
        const start = e.startingTractiveEffort * 1000, adhesion = e.adhesion * spec.mass * G;
        let te = this.power * Math.min(start, adhesion, (e.efficiency * e.power * 1000) / Math.max(Math.abs(this.v), 0.1));
        if (limit > 0) te *= clamp((limit - Math.abs(this.v) * 3.6) / 2, 0, 1);
        this.wheelslip = this.power > 0.5 && start > adhesion && Math.abs(this.v) * 3.6 < 15;
        net += te * this.reverser;
        // Grade and curve, per car at its own position.
        let curve = 0;
        for (const car of this.cars) {
          const c = tr.sample(this.s - this.dir * car.offset);
          net -= car.massKg * G * c.grade * this.dir;
          curve += car.massKg * G * trainMath.curveResistance(c.radiusM);
        }
        const r = spec.resistance;
        const cdA = r.cdA + spec.cars.count * spec.cars.cdA;
        resist = W * (r.rolling / 1000 + (r.speed / 1000) * Math.abs(this.v)) + curve + 0.5 * RHO_AIR * cdA * this.v * this.v;
        const brakeF = Math.min((emergency ? spec.brakes.emergency : spec.brakes.service * this.brake) * Mt, spec.brakes.adhesion * W);
        const opposing = resist + brakeF;
        if (Math.abs(this.v) < 0.05 && Math.abs(net) <= opposing) { this.v = 0; this.accel = 0; }
        else {
          const sign = Math.abs(this.v) > 1e-6 ? Math.sign(this.v) : Math.sign(net);
          const a = (net - sign * opposing) / Mt;
          const v2 = this.v + a * dt;
          this.v = Math.sign(v2) !== sign && Math.abs(net) <= opposing ? 0 : v2;
          this.accel = a;
        }
        // Along the track; the ends of a line are buffer stops.
        let s2 = this.s + (this.dir * this.v * dt) / MPS;
        if (!tr.loop && (s2 < 0 || s2 > tr.length)) { s2 = clamp(s2, 0, tr.length); this.v = 0; }
        this.s = tr.wrap(s2);
        // Derailment: unbalanced lateral acceleration of any car past Derail.LateralG.
        if (spec.derail.enabled) {
          for (const car of this.cars) {
            const c = tr.sample(this.s - this.dir * car.offset);
            const aLat = this.v * this.v * Math.abs(c.kappa / MPS) - G * Math.tan(Math.abs(c.cant)) * (Math.sign(c.cant) === Math.sign(c.kappa) ? 1 : -1);
            if (aLat > spec.derail.lateralG * G) { this.derail(); break; }
          }
        }
      }

      // Each car: pulled onto its pose on the track (stiff PD + feed-forward), or free when derailed.
      const w2 = TRAIN.PD_W * TRAIN.PD_W, damp = 2 * TRAIN.PD_Z * TRAIN.PD_W;
      for (const car of this.cars) {
        const rig = car.rig, b = rig.body;
        rig.begin();
        if (this.derailed) { rig.realGravity(G); continue; }
        const pose = this.pose(car);
        const c = pose.sample;
        const vS = this.v / MPS; // studs/s along the train
        const vTarget = V.mul(pose.fwd, vS);
        const left = V.unit(V.cross([0, 1, 0], c.tan));
        const aFF = V.add(V.mul(pose.fwd, this.accel / MPS), V.mul(left, vS * vS * c.kappa));
        // Error against where the car will be after this step, so it arrives on its pose.
        const err = V.sub(pose.pos, V.add(b.com, V.mul(b.v, dt))), vErr = V.sub(vTarget, b.v);
        rig.addForceRbx(V.mul(V.add(V.add(V.mul(err, w2), V.mul(vErr, damp)), aFF), b.mass));
        rig.addForceRbx([0, b.mass * this.world.gravity, 0]);
        const { up, look, right } = rig.cf;
        const rotErr = V.mul(V.add(V.add(V.cross(look, pose.fwd), V.cross(up, pose.up)), V.cross(right, pose.right)), 0.5);
        const wFF = [0, c.kappa * this.dir * vS, 0];
        rig.trackRates(V.add(wFF, V.mul(rotErr, TRAIN.ROT_K)), [TRAIN.ROT_TRACK, TRAIN.ROT_TRACK, TRAIN.ROT_TRACK], [1, 1, 1]);
      }
      const lead = tr.sample(this.s);
      this.telemetry = { speedKmh: this.v * 3.6, power: this.power, brake: emergency ? 1 : this.brake, grade: lead.grade * this.dir * 100, radiusM: lead.radiusM, wheelslip: this.wheelslip, derailed: this.derailed, speedLimit: lead.speedLimit, s: this.s, resistance: resist };
      return this.telemetry;
    }
    frame(dt, input, substeps = 4) {
      this.clock += dt;
      for (const car of this.cars) car.rig.clock = this.clock;
      const t = this.step(dt, input);
      for (let i = 0; i < substeps; i++) for (const car of this.cars) car.rig.physics(dt / substeps);
      return t;
    }
    get body() { return this.cars[0].rig.body; }
  }

  return { Tank, Train, TrainTrack, tankMath, trainMath, heavyMass, RMU_PER_KG };
});
