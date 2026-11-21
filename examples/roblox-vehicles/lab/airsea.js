// Vehicle lab, part 2: line-by-line JS ports of the kit's motorcycle, boat, plane and helicopter
// sims (SimUtil.luau, Gear.luau, Water.luau, BikeSim.luau, BoatSim.luau, PlaneSim.luau,
// HeliSim.luau) on the same Roblox-like rigid-body engine as physics.js: one massive root part,
// a VectorForce at the centre of mass and a Torque held between 60 Hz PreSimulation steps,
// 240 Hz substeps, Workspace.Gravity 196.2 studs/s², spherecasts that ignore shapes they start in.
// Specs are the normalized JSON (camelCase) from rveh.cjs.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./physics.js'));
  else root.AirSeaLab = factory(root.VehicleLab);
})(typeof self !== 'undefined' ? self : this, function (Lab) {
  'use strict';
  const { V, M, VM, Body, collide, hullSamples, rotateAxis, clamp, lookAtR } = Lab;
  const MPS = 0.28, G = 9.81, RHO_AIR = 1.225;
  const lerp = (a, b, t) => a + (b - a) * t;
  const smoothstep = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
  const rad = (d) => (d * Math.PI) / 180, deg = (r) => (r * 180) / Math.PI;
  const flat = (v) => { const f = [v[0], 0, v[2]]; return V.len(f) > 1e-6 ? V.unit(f) : [0, 0, -1]; };

  // ------------------------------------------------------------------ SimUtil.luau
  const SimUtil = {
    // Root part mass for a root box (studs): density clamped like VehicleService (0.7..100).
    rootMass(size, minMass, density) {
      const vol = size[0] * size[1] * size[2];
      return (density ? clamp(density, 0.7, 100) : clamp(minMass / vol, 0.7, 100)) * vol;
    },
    inducedVelocity(T, rho, A, Vax) {
      if (T <= 0) return 0;
      const v = Math.max(Vax, 0);
      return -v / 2 + Math.sqrt((v * v) / 4 + T / (2 * rho * A));
    },
    diskThrust(P, rho, A, Vax, eta) {
      if (P <= 0 || A <= 0) return 0;
      const pe = eta * P, v = Math.max(Vax, 0);
      let lo = 0, hi = Math.cbrt(2 * rho * A * pe * pe) * 1.001 + 1;
      for (let i = 0; i < 24; i++) { const mid = (lo + hi) / 2; if (mid * (v + SimUtil.inducedVelocity(mid, rho, A, v)) > pe) hi = mid; else lo = mid; }
      return lo;
    },
    propEfficiency: (staticEff, eff, fullSpeed, Vax) => staticEff + (eff - staticEff) * clamp(Math.max(Vax, 0) / Math.max(fullSpeed, 0.1), 0, 1),
    airDensity: (altM) => RHO_AIR * Math.exp(-Math.max(altM, 0) / 8500),
    // Spring rate and damper (Roblox units) for a corner mass and frequency (VehicleMath.Spring).
    spring: (m, f, z) => { const w = 2 * Math.PI * f; const k = m * w * w; return [k, 2 * z * Math.sqrt(k * m)]; },
  };

  // Base for every new sim: the assembly, the force/torque accumulator and Roblox stepping.
  class Rig {
    constructor(world, spec, rootSize, rootMass) {
      this.world = world; this.spec = spec; this.rootSize = rootSize;
      const b = new Body();
      b.mass = rootMass;
      b.Ibody = SimUtil_boxInertia(rootMass, rootSize);
      b.comLocal = [0, 0, 0];
      this.body = b;
      this.F = [0, 0, 0]; this.T = [0, 0, 0];
      this.clock = 0; this.events = []; this.hull = null; this.recoveries = 0; this.lastRecover = -Infinity;
    }
    get cf() { const R = this.body.R; return { pos: this.body.pos, right: M.col(R, 0), up: M.col(R, 1), look: V.mul(M.col(R, 2), -1) }; }
    place(ground, yaw = 0, height = 0) {
      this.body.setCFrame(V.add(ground, [0, height, 0]), M.rotY(yaw));
      this.body.v = [0, 0, 0]; this.body.w = [0, 0, 0];
    }
    // SimUtil.Begin
    begin() { this.F = [0, 0, 0]; this.T = [0, 0, 0]; this.com = this.body.com; this.toRoblox = this.body.mass / this.spec.mass / MPS; }
    addForce(fN, at) { this.addForceRbx(V.mul(fN, this.toRoblox), at); }
    addForceRbx(f, at) { this.F = V.add(this.F, f); if (at) this.T = V.add(this.T, V.cross(V.sub(at, this.com), f)); }
    addTorque(tNm) { this.T = V.add(this.T, V.mul(tNm, this.toRoblox / MPS)); }
    addTorqueRbx(t) { this.T = V.add(this.T, t); }
    // Net gravity of g (m/s²) instead of Workspace.Gravity.
    realGravity(g) { this.F = V.add(this.F, [0, this.body.mass * (this.world.gravity - g / MPS), 0]); }
    inertia() { return SimUtil_boxInertia(this.body.mass, this.rootSize); }
    // SimUtil.TrackRates: torque I k (target - ω) per root axis (X right, Y up, Z back).
    trackRates(target, gains, auth) {
      const R = this.body.R, I = this.inertia();
      const e = M.tmulV(R, V.sub(target, this.body.w));
      this.T = V.add(this.T, M.mulV(R, [0, 1, 2].map((i) => I[i] * gains[i] * auth[i] * e[i])));
    }
    // SimUtil.Recover: upright on the ground (or water) below, a little higher, same heading.
    recover(height) {
      if (this.clock - this.lastRecover < 2) return;
      this.lastRecover = this.clock; this.recoveries++; this.events.push({ t: this.clock, what: 'recover' });
      const { pos, look } = this.cf;
      const fwd = flat(look);
      const hit = this.world.raycast(V.add(pos, [0, 12, 0]), [0, -60, 0]);
      let y = hit ? hit.position[1] : pos[1];
      const water = Water.level(this.world, pos[0], pos[2], this.clock);
      if (water !== null && water > y) y = water;
      this.body.setCFrame([pos[0], y + height, pos[2]], lookAtR(fwd));
      this.body.v = [0, 0, 0]; this.body.w = [0, 0, 0];
      this.prevV = null;
    }
    physics(h) {
      const b = this.body; if (b.anchored) return;
      const com = b.com;
      const F = V.add(this.F, [0, -this.world.gravity * b.mass, 0]);
      b.v = V.add(b.v, V.mul(F, h / b.mass));
      const L = V.add(b.worldI(b.w), V.mul(this.T, h));
      b.w = b.worldInvI(L);
      const newCom = V.add(com, V.mul(b.v, h));
      const wl = V.len(b.w);
      if (wl > 1e-9) { b.q = Lab.quatNorm(Lab.quatMul(Lab.quatFromAxisAngle(b.w, wl * h), b.q)); b.R = M.fromQuat(b.q); }
      b.pos = V.sub(newCom, M.mulV(b.R, b.comLocal));
      if (this.hull) collide(this, h);
    }
    frame(dt, input, substeps = 4) {
      this.clock += dt;
      const t = this.step(dt, input);
      for (let i = 0; i < substeps; i++) this.physics(dt / substeps);
      return t;
    }
  }
  function SimUtil_boxInertia(m, s) { return [(m * (s[1] ** 2 + s[2] ** 2)) / 12, (m * (s[0] ** 2 + s[2] ** 2)) / 12, (m * (s[0] ** 2 + s[1] ** 2)) / 12]; }

  // Low-friction rounded hull (VehicleService.buildHull) from root-space corners.
  function makeHull(mn, mx, bottom, friction) {
    const top = Math.max(mx[1], bottom + 1), height = top - bottom;
    const width = Math.max(mx[0] - mn[0], 0.5), length = Math.max(mx[2] - mn[2], 2);
    const radius = Math.min(height / 2, length / 4);
    const cx = (mn[0] + mx[0]) / 2, cz = (mn[2] + mx[2]) / 2;
    const hull = { friction, box: { c: [cx, bottom + height / 2, cz], size: [width, height, Math.max(length - 2 * radius, 0.5)] }, cyl: [mn[2] + radius, mx[2] - radius].map((z) => ({ c: [cx, bottom + radius, z], radius, width })) };
    hull.samples = hullSamples(hull);
    return hull;
  }

  // ------------------------------------------------------------------ Water.luau
  // Sea plane at world.water.level (studs) with three sine wave trains (deep-water speeds).
  const WAVES = [[1, 0, 1, 0], [0.61, 35, 0.5, 1.7], [0.37, -50, 0.25, 4.1]]; // length share, direction offset (deg), amplitude share, phase
  const Water = {
    offset(world, x, z, t) {
      const w = world.water;
      if (!w || !(w.waveHeight > 0)) return 0;
      let y = 0;
      for (const [ls, dOff, as, ph] of WAVES) {
        const len = Math.max(w.waveLength || 30, 1) * ls; // m
        const k = (2 * Math.PI) / len, omega = Math.sqrt(G * k);
        const d = rad((w.waveDirection || 0) + dOff);
        const a = ((w.waveHeight / 2) * as) / 1.75; // m
        y += a * Math.sin(k * (Math.cos(d) * x + Math.sin(d) * z) * MPS - omega * t + ph);
      }
      return y / MPS;
    },
    level(world, x, z, t) {
      const w = world.water;
      if (!w || w.level === undefined || w.level === null) return null;
      return w.level + Water.offset(world, x, z, t);
    },
  };

  // ------------------------------------------------------------------ Gear.luau
  // Landing gear and skids: sphere-cast springs (real gravity), wheel or skid friction, brakes.
  class Gear {
    // points: [{ name, local:[x,y,z] (mount, root space), radius, front, skid, steer, share }]
    constructor(rig, points, g) {
      this.rig = rig; this.g = g;
      const m = rig.body.mass, gEff = G / MPS;
      const staticLength = g.maxLength * g.rideHeight;
      this.points = points.map((p) => {
        const cm = m * p.share;
        const [k, c] = SimUtil.spring(cm, g.frequency, g.dampingRatio);
        const staticForce = cm * gEff;
        return { ...p, k, c, staticForce, restLength: staticLength + staticForce / k, length: staticLength, cornerMassKg: rig.spec.mass * p.share, grounded: false, hit: null, springForce: 0, load: 0, spin: 0 };
      });
    }
    // ctx: { dt, steerDeg, brake 0..1, hold bool } → { grounded, wow }
    step(ctx) {
      const rig = this.rig, b = rig.body, g = this.g, { up, look } = rig.cf;
      const maxLength = g.maxLength;
      let grounded = 0, support = 0;
      for (const p of this.points) {
        const r = p.radius, castR = r * 0.85, inset = r - castR, lift = r;
        const mount = b.toWorld(p.local);
        let hit = rig.world.spherecast(V.add(mount, V.mul(up, lift)), castR, V.mul(up, -(maxLength + inset + lift)));
        if (hit && V.dot(hit.normal, up) < 0.35) hit = null;
        p.hit = hit;
        if (!hit) { p.grounded = false; p.length = maxLength; p.springForce = 0; p.load = 0; continue; }
        const length = clamp(hit.distance - inset - lift, 0, maxLength);
        const sf = Math.max(0, p.k * (p.restLength - length) + p.c * ((p.length - length) / ctx.dt));
        p.length = length; p.grounded = true; p.springForce = sf; grounded++; support += sf;
        p.load = p.cornerMassKg * G * clamp(sf / p.staticForce, 0, 4);
        rig.addForceRbx(V.mul(hit.normal, sf), hit.position);
        // Friction in the ground plane.
        const n = hit.normal;
        let wf = p.steer ? rotateAxis(look, up, rad(-ctx.steerDeg)) : look;
        wf = V.unit(V.sub(wf, V.mul(n, V.dot(wf, n))));
        const wr = V.cross(wf, n);
        const cv = V.mul(b.velAt(hit.position), MPS);
        const longMs = V.dot(cv, wf), latMs = V.dot(cv, wr);
        const stopLimit = (p.cornerMassKg / ctx.dt) * 0.5;
        const gripN = g.grip * p.load;
        let latN = -clamp(stopLimit * latMs, -gripN, gripN);
        let longN;
        if (p.skid) longN = -clamp(stopLimit * longMs, -gripN, gripN);
        else {
          const brakeN = (ctx.hold ? 1 : ctx.brake) * g.brakeG * p.cornerMassKg * G * (ctx.hold ? 2 : 1);
          const resist = Math.min(brakeN + g.rollingResistance * p.load, gripN);
          longN = -Math.sign(longMs) * Math.min(resist, stopLimit * Math.abs(longMs));
        }
        rig.addForce(V.add(V.mul(wf, longN), V.mul(wr, latN)), hit.position);
        p.spin += (longMs / MPS / r) * ctx.dt;
      }
      return { grounded, wow: support / (b.mass * (G / MPS)) };
    }
  }

  // Impact check shared by the sims: horizontal velocity change beyond `limitG` (real g) in a step.
  function impact(rig, dt, limitG) {
    const v = rig.body.v, prev = rig.prevV;
    rig.prevV = v.slice();
    if (!prev) return 0;
    const dv = V.sub(v, prev);
    const g = (Math.hypot(dv[0], dv[2]) / dt) * MPS / G;
    return g > limitG ? g : 0;
  }

  // ------------------------------------------------------------------ BikeSim.luau
  const BIKE = { CAST: 0.85, WALL: 0.35, LEAN_GAIN: 7, ROLL_TRACK: 18, PITCH_TRACK: 10, AIR_LEVEL: 2.5, AIR_MAX: 1.2, AIR_DAMP: 14, STOP_GAIN: 0.4, HOLD_MS: 0.6, ESC_GAIN: 14, STAND_LEAN: 8 };
  class Bike extends Rig {
    constructor(world, spec, opts = {}) {
      const r = spec.wheelRadius / MPS, wb = spec.wheelbase / MPS;
      const size = [0.5 / MPS, 0.9 / MPS, (spec.wheelbase * 1.1) / MPS];
      super(world, spec, size, SimUtil.rootMass(size, 150));
      // model space (facing -Z, ground y = 0): wheels and the centre of mass
      const com = [0, spec.comHeight / MPS, wb / 2 - spec.frontWeight * wb];
      const staticLength = spec.suspension.maxLength * spec.suspension.rideHeight;
      const m = this.body.mass;
      this.wheels = [true, false].map((front) => {
        const center = [0, r, front ? -wb / 2 : wb / 2];
        const share = front ? spec.frontWeight : 1 - spec.frontWeight;
        const cm = m * share;
        const [k, c] = SimUtil.spring(cm, front ? spec.suspension.frequencyFront : spec.suspension.frequencyRear, spec.suspension.dampingRatio);
        const staticForce = cm * (G / MPS);
        return { name: front ? 'WheelF' : 'WheelR', front, radius: r, local: V.sub(V.add(center, [0, staticLength, 0]), com), k, c, staticForce, restLength: staticLength + staticForce / k, axleWeightN: spec.mass * G * share, cornerMassKg: spec.mass * share, length: staticLength, grounded: false, hit: null, springForce: 0, slip: 0, spin: 0 };
      });
      this.wheelbaseM = spec.wheelbase;
      // Narrow hull above 1.4 wheel radii so a 50° lean never scrapes it.
      const bottom = 1.4 * r - com[1];
      this.hull = makeHull([-0.15 / MPS, bottom, -wb / 2 - r * 0.6 - com[2]], [0.15 / MPS, 1.15 / MPS - com[1], wb / 2 + r * 0.6 - com[2]], bottom, spec.body.hullFriction);
      this.reach = wb / 2 + r + 1.5;
      this.steer = 0; this.gear = 1; this.shiftTimer = 0; this.rpm = spec.engine.idleRpm; this.crashed = false;
      this.stuckTimer = 0; this.unstickUntil = 0; this.unstickTries = 0; this.flipTimer = 0; this.prevV = null; this.wasAirborne = false; this.latch = { pitch: 0, roll: 0 };
      this.place(opts.position || [0, 0, 0], opts.yaw || 0, com[1]);
    }
    recoverBike() { this.recover(this.spec.comHeight / MPS + this.spec.suspension.maxLength + 1); this.crashed = false; }

    // input: { throttle -1..1, steer -1..1, handbrake, lean -1 (back) .. 1 (forward), rider (default true) }
    step(dt, input) {
      const spec = this.spec, b = this.body, world = this.world;
      const rider = input.rider !== false;
      this.begin();
      const { up, look: forward, right } = this.cf;
      const vMs = V.mul(b.v, MPS);
      const flatF = flat(forward), flatR = V.cross(flatF, [0, 1, 0]);
      const lean = Math.atan2(-right[1], up[1]); // + = leaning right
      const pitch = Math.asin(clamp(forward[1], -1, 1));
      const forwardMs = V.dot(vMs, flatF);
      const kmh = Math.abs(forwardMs) * 3.6;
      const L = this.wheelbaseM;

      // Crash: a hard hit, or lying over at speed (low-side). Riderless bikes don't balance.
      const hitG = impact(this, dt, spec.recovery.bailG > 0 ? spec.recovery.bailG : Infinity);
      if (rider && hitG > 0) { this.crashed = true; this.events.push({ t: this.clock, what: 'crash', g: hitG }); }

      // Lean and steering, the way a rider does it: the stick asks for a lean angle (none at walking
      // pace), and the rider steers whatever turn keeps the bike balanced at the lean it has now:
      // ground steer atan(L g tan φ / v²), divided by cos φ because the steering axis leans with the
      // bike. Below LowSpeedKmh the bars steer directly (parking-lot turns).
      const st = spec.steering;
      const steerIn = clamp(input.steer || 0, -1, 1);
      const lowBlend = smoothstep(st.lowSpeedKmh * 0.5, st.lowSpeedKmh * 1.5, kmh);
      // Braking hard, the rider picks the bike up a little (it runs wide instead of sliding out).
      const braking = (input.throttle || 0) < -0.05 && forwardMs > 0.3 ? -(input.throttle || 0) : 0;
      const leanCmd = steerIn * rad(st.maxLean) * smoothstep(st.lowSpeedKmh * 0.5, st.lowSpeedKmh * 3, kmh) * (1 - 0.35 * braking);
      const leanTarget = rider ? leanCmd : -rad(BIKE.STAND_LEAN); // riderless: on the kickstand
      const v = Math.max(Math.abs(forwardMs), 0.5);
      const groundSteer = Math.atan((L * G * Math.tan(clamp(lean, -1.2, 1.2))) / (v * v));
      const balanceSteer = Math.atan(Math.tan(groundSteer) / Math.max(Math.cos(lean), 0.3));
      let target = clamp(lerp(steerIn * rad(st.maxAngle), balanceSteer, lowBlend), -rad(st.maxAngle), rad(st.maxAngle));
      // Coming to a stop on the brakes, the rider straightens the bars.
      if ((input.throttle || 0) < -0.5 && forwardMs > 0.3 && kmh < st.lowSpeedKmh) target = 0;
      const maxStep = rad(st.maxAngle) * st.speed * dt;
      this.steer += clamp(target - this.steer, -maxStep, maxStep);
      const rKin = (forwardMs * Math.tan(this.steer * Math.cos(lean))) / L; // right turn +

      // Pedals and gearbox (the car's VehicleMath).
      let drive = 0, brake = 0;
      const thr = input.throttle || 0;
      if (thr > 0.05) { if (forwardMs < -1) brake = thr; else { if (this.gear < 1) this.gear = 1; drive = thr; } }
      else if (thr < -0.05) { if (forwardMs > 0.3) brake = -thr; else { this.gear = -1; drive = kmh < spec.gearbox.reverseSpeedKmh ? -thr : 0; } } // reverse only from a stop
      const holding = Math.abs(thr) <= 0.05 && Math.abs(forwardMs) < BIKE.HOLD_MS;
      if (holding || !rider) brake = 1;
      if (this.shiftTimer > 0) this.shiftTimer -= dt;
      else if (this.gear >= 1) { const next = VM.AutoShift(spec, this.gear, forwardMs); if (next !== this.gear) { this.gear = next; this.shiftTimer = spec.gearbox.shiftTime; } }
      let [driveN, rpm] = VM.Drive(spec, forwardMs, this.gear, rider ? drive : 0);
      if (this.shiftTimer > 0) driveN = 0;
      if (this.gear < 0) driveN = -driveN;
      this.rpm += (rpm - this.rpm) * Math.min(1, dt * 12);

      // Suspension (along the leaned up axis), forces at the contact patch.
      const maxLength = spec.suspension.maxLength;
      let grounded = 0;
      for (const w of this.wheels) {
        const castR = w.radius * BIKE.CAST, inset = w.radius - castR, lift = w.radius;
        let hit = world.spherecast(V.add(b.toWorld(w.local), V.mul(up, lift)), castR, V.mul(up, -(maxLength + inset + lift)));
        if (hit && V.dot(hit.normal, [0, 1, 0]) < BIKE.WALL) hit = null;
        w.hit = hit;
        if (hit) {
          const length = clamp(hit.distance - inset - lift, 0, maxLength);
          w.springForce = Math.max(0, w.k * (w.restLength - length) + w.c * ((w.length - length) / dt));
          w.length = length; w.grounded = true; grounded++;
        } else { w.length = maxLength; w.springForce = 0; w.grounded = false; }
      }
      const [front, rear] = this.wheels;
      const n = rear.hit ? rear.hit.normal : front.hit ? front.hit.normal : [0, 1, 0];
      const pitchRel = pitch - Math.asin(clamp(-V.dot(n, flatF), -1, 1)); // pitch against the slope
      const leanIn = clamp(input.lean || 0, -1, 1);
      const wh = spec.wheelie;
      const wheelie = rear.grounded && !front.grounded && grounded > 0;
      const stoppie = front.grounded && !rear.grounded;
      // Wheelie control trims drive when the front lifts without the rider asking for it.
      let driveScale = 1, frontBrakeScale = 1;
      // Wheelie control (like real anti-wheelie electronics): without lean-back, drive is trimmed as the
      // front wheel goes light, so launches run at the wheelie limit with the front skimming the road.
      const frontLoad = front.grounded ? front.springForce / front.staticForce : 0;
      if (wh.control && leanIn > -0.3 && frontLoad < 0.15) driveScale = clamp(frontLoad / 0.15, 0, 1);
      // Past the balance point the rider rolls off the throttle (no looping out), unless assists are off.
      if (wh.assist > 0 && pitchRel > rad(wh.balanceAngle)) driveScale = Math.min(driveScale, clamp(1 - (pitchRel - rad(wh.balanceAngle)) / rad(8), 0, 1));
      // Stoppie control (ABS rear-lift mitigation): unless leaning forward, the front brake eases off as
      // the rear wheel goes light, so hard stops run at the stoppie limit with the rear just touching.
      const rearLoad = rear.grounded ? rear.springForce / rear.staticForce : 0;
      if (leanIn < 0.3 && brake > 0 && rearLoad < 0.15) frontBrakeScale = clamp(0.3 + 0.7 * (rearLoad / 0.15), 0.3, 1);

      // Tires: slip-angle force, camber thrust, drive, brakes, friction circle.
      const tires = spec.tires;
      const stopGain = BIKE.STOP_GAIN + (1 - BIKE.STOP_GAIN) * clamp(Math.abs(forwardMs) / 4, 0, 1);
      let worstSlip = 0;
      const torqueBefore = this.T.slice();
      for (const w of this.wheels) {
        const hit = w.hit;
        if (!hit) { w.slip = 0; continue; }
        const nn = hit.normal;
        const load = w.axleWeightN * clamp(w.springForce / w.staticForce, 0, 3);
        const gripN = (w.front ? tires.gripFront : tires.gripRear) * load;
        let wf = w.front ? rotateAxis(forward, up, -this.steer) : forward;
        wf = V.unit(V.sub(wf, V.mul(nn, V.dot(wf, nn))));
        const wr = V.cross(wf, nn);
        const cv = V.mul(b.velAt(hit.position), MPS);
        const longMs = V.dot(cv, wf), latMs = V.dot(cv, wr);
        const stopLimit = (w.cornerMassKg / dt) * stopGain;
        const slipAngle = Math.atan2(latMs, Math.max(Math.abs(longMs), 0.5));
        let latN = -load * (w.front ? tires.gripFront : tires.gripRear) * VM.TireCurve(slipAngle, tires.stiffness, tires.shape, tires.slideGrip);
        latN = clamp(latN, -stopLimit * Math.abs(latMs), stopLimit * Math.abs(latMs));
        const camber = Math.asin(clamp(V.dot(up, wr), -1, 1));
        latN += tires.camberThrust * load * Math.tan(clamp(camber, -1.2, 1.2)) * smoothstep(1, 4, Math.abs(longMs));
        // Cornering ABS and lean-sensitive traction control: cornering grip comes first, drive and
        // brakes get what is left of the friction circle (the rear brake lever still slides it).
        const spare = Math.sqrt(Math.max(gripN * gripN - latN * latN, 0)) * 0.95;
        let longN = w.front ? 0 : clamp(driveN * driveScale, -spare, spare);
        let brakeN = Math.min(brake * spec.mass * G * spec.brakes.decelG * (w.front ? spec.brakes.frontBias * frontBrakeScale : 1 - spec.brakes.frontBias), spare);
        if (input.handbrake && !w.front) brakeN += spec.mass * G * spec.brakes.decelG * 0.6;
        const resist = brakeN + tires.rollingResistance * load;
        longN -= (longMs >= 0 ? 1 : -1) * Math.min(resist, stopLimit * Math.abs(longMs));
        const total = Math.hypot(latN, longN);
        w.slip = gripN > 0 ? total / gripN : 0;
        if (total > gripN && total > 0) { latN *= gripN / total; longN *= gripN / total; }
        worstSlip = Math.max(worstSlip, w.slip);
        this.addForceRbx(V.mul(nn, w.springForce), hit.position);
        this.addForce(V.add(V.mul(wf, longN), V.mul(wr, latN)), hit.position);
        w.spin += (longMs / MPS / w.radius) * dt;
      }

      // The rider's balance: a real rider steers the contact patches back under the centre of mass;
      // here the roll torque of the contact forces is cancelled and the lean controller places the
      // bike. Riderless and crashed bikes keep it, so they fall over.
      const balance = rider && !this.crashed;
      if (balance) {
        const contactRoll = V.dot(V.sub(this.T, torqueBefore), forward);
        this.addTorqueRbx(V.mul(forward, -contactRoll));
      }

      // Rider lean shifts the centre of mass fore and aft: lean back lifts the front.
      if (rider) this.addTorque(V.mul(right, -leanIn * spec.mass * G * wh.riderShift));

      const airborne = grounded === 0;
      if (!airborne) {
        // Balance: drive the lean to the target (the rider countersteering).
        if (balance || Math.abs(lean) < rad(35)) {
          const rate = clamp((leanTarget - lean) * BIKE.LEAN_GAIN, -rad(st.leanRate), rad(st.leanRate));
          const tw = V.add(b.w, V.mul(forward, rate - V.dot(b.w, forward)));
          this.trackRates(tw, [0, 0, BIKE.ROLL_TRACK], [0, 0, 1]);
        }
        // Wheelie and stoppie balance, and no looping out.
        let pitchRate = null;
        if (wh.assist > 0) {
          if (wheelie && leanIn < -0.3) pitchRate = clamp((rad(wh.balanceAngle) - pitchRel) * 3, -1.5, 1.5);
          else if (stoppie && leanIn > 0.3) pitchRate = clamp((rad(wh.stoppieAngle) - pitchRel) * 3, -1.5, 1.5);
          if (pitchRel > rad(wh.balanceAngle + 15)) pitchRate = -1.5;
          if (pitchRel < rad(wh.stoppieAngle - 12)) pitchRate = 1.5;
        }
        if (pitchRate !== null) {
          const tw = V.add(b.w, V.mul(right, pitchRate - V.dot(b.w, right)));
          this.trackRates(tw, [BIKE.PITCH_TRACK * wh.assist, 0, 0], [1, 0, 0]);
        }
        // Stability assist: yaw beyond what the steering asks for.
        if (spec.assists.stability > 0 && grounded === 2 && forwardMs > 0.5) {
          const yawRight = -b.w[1];
          const cap = (tires.gripRear * G) / Math.max(forwardMs, 3);
          const wanted = clamp(rKin, -cap, cap);
          const over = yawRight - clamp(yawRight, Math.min(0, wanted), Math.max(0, wanted));
          const I = this.inertia();
          this.addTorqueRbx([0, over * BIKE.ESC_GAIN * spec.assists.stability * I[1], 0]);
        }
      } else {
        // Air: lean pitches (flips), steer rolls; otherwise turn toward the ground below.
        if (!this.wasAirborne) { this.latch.pitch = Math.sign(leanIn); this.latch.roll = Math.sign(steerIn); }
        if (Math.abs(leanIn) < 0.05) this.latch.pitch = 0;
        if (Math.abs(steerIn) < 0.05) this.latch.roll = 0;
        const pIn = Math.sign(leanIn) !== this.latch.pitch ? leanIn : 0;
        const rIn = Math.sign(steerIn) !== this.latch.roll ? steerIn : 0;
        const below = world.raycast(b.pos, [0, -80, 0]);
        const targetUp = below && below.normal[1] > 0.5 ? below.normal : [0, 1, 0];
        let rate = V.mul(V.cross(up, targetUp), BIKE.AIR_LEVEL);
        if (V.len(rate) > BIKE.AIR_MAX) rate = V.mul(V.unit(rate), BIKE.AIR_MAX);
        const inRate = rad(spec.recovery.airInput);
        if (pIn) rate = V.add(V.sub(rate, V.mul(right, V.dot(rate, right))), V.mul(right, -pIn * inRate));
        if (rIn) rate = V.add(V.sub(rate, V.mul(forward, V.dot(rate, forward))), V.mul(forward, rIn * inRate));
        const gain = BIKE.AIR_DAMP * spec.recovery.airControl + (pIn || rIn ? 8 : 0);
        if (gain > 0) this.trackRates(V.add(rate, [0, b.w[1] - rate[1], 0]), [gain, 0, gain], [1, 0, 1]);
      }
      this.wasAirborne = airborne;

      // Gravity: real on the ground, Recovery.AirGravity in the air.
      this.realGravity(airborne ? spec.recovery.airGravity * G : G);
      // Drag.
      const speed = V.len(vMs);
      if (speed > 0.1) this.addForce(V.mul(V.unit(vMs), -0.5 * RHO_AIR * spec.aero.cd * spec.aero.area * speed * speed));

      // Low-side: lying over at speed with a rider.
      if (rider && !airborne && Math.abs(lean) > rad(75) && kmh > 15 && !this.crashed) { this.crashed = true; this.events.push({ t: this.clock, what: 'lowside' }); }
      // Never stuck: upright when on its side and slow with a rider on board.
      if (rider && spec.recovery.autoFlip && Math.abs(lean) > rad(70) && V.len(b.v) < 4) { this.flipTimer += dt; if (this.flipTimer > 1.5) { this.flipTimer = 0; this.recoverBike(); } }
      else this.flipTimer = 0;

      this.telemetry = { speedKmh: forwardMs * 3.6, rpm: this.rpm, gear: this.gear, lean: deg(lean), leanTarget: deg(leanTarget), pitch: deg(pitchRel), wheelie, stoppie, crashed: this.crashed, grounded, slip: worstSlip, steer: deg(this.steer) };
      return this.telemetry;
    }
  }

  // ------------------------------------------------------------------ BoatSim.luau
  const BOAT = { PLANE_DAMP: 4, TURN_LENGTHS: 3.5, ESC_GAIN: 6, SELF_RIGHT: 25, AIR_LEVEL: 2, AIR_MAX: 1, AIR_DAMP: 10, LAT_FLOOR: 0.4 };
  const boatMath = {
    displacement: (s) => s.mass / s.hull.waterDensity,
    waterplane: (s) => s.hull.length * s.hull.beam * s.hull.blockCoefficient,
    draft: (s) => boatMath.displacement(s) / boatMath.waterplane(s),
    wetted0: (s) => 1.7 * s.hull.length * boatMath.draft(s) + boatMath.displacement(s) / boatMath.draft(s),
    planingSpeed: (s) => (s.hull.planingSpeedKmh > 0 ? s.hull.planingSpeedKmh / 3.6 : 1.2 * Math.sqrt(G * s.hull.length)),
    waveBump(s, fn) { const x = fn / 0.5, x4 = x * x * x * x; if (x <= 1) return x4; const p = (2 * x4) / (1 + x4 * x * x); return p + (x4 - p) * s.hull.waveWall; },
    cf(v, L) { const re = Math.max((Math.abs(v) * L) / 1.19e-6, 1e5); const lg = Math.log10(re) - 2; return 0.075 / (lg * lg); },
    resistance(s, v, lift, immersion) {
      const W = s.mass * G, fn = Math.abs(v) / Math.sqrt(G * s.hull.length);
      const wet = boatMath.wetted0(s) * (0.25 + 0.75 * clamp(immersion, 0, 1.5));
      const friction = 0.5 * s.hull.waterDensity * v * v * wet * boatMath.cf(v, s.hull.length);
      const wave = W * s.hull.humpRW * boatMath.waveBump(s, fn) * (1 - clamp(lift, 0, 1));
      const planing = W * clamp(lift, 0, 1) * Math.tan(rad(s.hull.trim));
      return { friction, wave, planing, total: friction + wave + planing };
    },
    thrust(s, v, throttle) {
      const d = s.drive;
      if (d.speedLimitKmh > 0 && v * 3.6 >= d.speedLimitKmh && throttle > 0) return 0;
      const area = Math.PI * (d.propDiameter / 2) ** 2;
      const vin = throttle >= 0 ? v : -v;
      const eta = SimUtil.propEfficiency(d.staticEfficiency, d.efficiency, d.efficiencySpeedKmh / 3.6, vin);
      const t = SimUtil.diskThrust(Math.abs(throttle) * d.power * 1000 * (throttle < 0 ? d.reverse : 1), s.hull.waterDensity, area, vin, eta);
      return throttle < 0 ? -t : t;
    },
  };
  class Boat extends Rig {
    constructor(world, spec, opts = {}) {
      const h = spec.hull;
      const size = [(h.beam * 0.8) / MPS, (h.depth * 0.6) / MPS, (h.length * 0.8) / MPS];
      super(world, spec, size, SimUtil.rootMass(size, 0, 100));
      const T = boatMath.draft(spec);
      this.draftM = T;
      const nA = h.samplesAlong, nB = h.samplesAcross, N = nA * nB;
      const keel = -spec.comHeight / MPS;
      this.points = [];
      for (let i = 0; i < nA; i++) for (let k = 0; k < nB; k++) {
        const along = (i / (nA - 1) - 0.5) * 0.8 * h.length; // m, + = bow
        const across = (k / (nB - 1) - 0.5) * 0.7 * h.beam;
        const aft = -along / (0.4 * h.length); // -1 bow .. 1 stern
        this.points.push({ local: [across / MPS, keel, -along / MPS], liftW: 1 - h.liftBow * aft, keelW: 1 + h.keelAft * aft, d: 0 });
      }
      this.area = boatMath.waterplane(spec) / N;
      this.dPlane = h.planeDraft * T;
      const vp = boatMath.planingSpeed(spec);
      this.vPlane = vp;
      this.cPlane = (h.planingLift * spec.mass * G) / (0.5 * h.waterDensity * vp * vp * boatMath.waterplane(spec));
      this.damp = 2 * h.damping * Math.sqrt(h.waterDensity * G * this.area * (spec.mass / N));
      this.propLocal = [0, (-spec.comHeight + T - spec.drive.depth) / MPS, (0.48 * h.length) / MPS];
      this.staticThrust = boatMath.thrust(spec, 0, 1);
      // Hull: the whole box from the keel up, rounded bow and stern.
      this.hull = makeHull([(-h.beam / 2) / MPS, keel, (-h.length / 2) / MPS], [(h.beam / 2) / MPS, keel + h.depth / MPS, (h.length / 2) / MPS], keel, spec.body.hullFriction);
      this.throttle = 0; this.steerDeg = 0; this.prevV = null; this.wasAirborne = false;
      this.place(opts.position || [0, 0, 0], opts.yaw || 0, opts.height !== undefined ? opts.height : spec.comHeight / MPS - T / MPS);
    }
    recoverBoat() { this.recover(this.spec.comHeight / MPS); }

    // input: { throttle -1..1, steer -1..1 }
    step(dt, input) {
      const spec = this.spec, h = spec.hull, b = this.body, world = this.world, t = this.clock;
      this.begin();
      const { up, look: forward, right } = this.cf;
      const vMs = V.mul(b.v, MPS);
      const Fh = flat(forward), Rh = V.cross(Fh, [0, 1, 0]);
      const u = V.dot(vMs, Fh);
      const rho = h.waterDensity, W = spec.mass * G, T = this.draftM;
      const level = Water.level(world, b.pos[0], b.pos[2], t);

      // Buoyancy, damping and planing lift per hull column.
      let sumD = 0, wetCount = 0, liftN = 0;
      const liftDir = V.unit(V.sub(up, V.mul(Fh, V.dot(up, Fh))));
      for (const p of this.points) {
        const wp = b.toWorld(p.local);
        const surface = level === null ? -Infinity : Water.level(world, wp[0], wp[2], t);
        p.d = clamp((surface - wp[1]) * MPS, 0, h.depth);
        p.world = wp;
        if (p.d <= 0) continue;
        wetCount++; sumD += p.d;
        const vy = b.velAt(wp)[1] * MPS;
        const buoy = rho * G * this.area * p.d;
        const damp = -this.damp * vy * Math.min(p.d / (0.25 * T), 1);
        // Planing lift grows with speed up to full planing speed, then the wetted length adjusts.
        const ue = Math.min(Math.max(u, 0), this.vPlane);
        const lift = 0.5 * rho * ue * ue * this.area * this.cPlane * Math.min(p.d / this.dPlane, 1) * p.liftW;
        // A planing surface also resists vertical motion (its angle of attack changes): damping ~ speed.
        const dynDamp = -0.5 * rho * Math.max(u, 0) * this.area * this.cPlane * BOAT.PLANE_DAMP * vy * Math.min(p.d / this.dPlane, 1);
        liftN += lift;
        this.addForce([0, buoy + damp, 0], wp);
        // Planing pressure acts square to the bottom: a heeled hull carves (its lift tips sideways).
        this.addForce(V.mul(liftDir, lift + dynDamp), wp);
      }
      const N = this.points.length;
      const immersion = sumD / N / T;
      const share = clamp(liftN / W, 0, 1);

      // Resistance in the boat's frame, shared by the wet columns (pitching and yawing it).
      const res = boatMath.resistance(spec, u, share, immersion);
      if (wetCount > 0) {
        for (const p of this.points) {
          if (p.d <= 0) continue;
          this.addForce(V.mul(Fh, -Math.sign(u) * res.total * (p.d / sumD)), V.add(p.world, [0, p.d / 2 / MPS, 0]));
          // Lateral resistance (keel, chines), at the centre of mass height: the heel comes from Hull.Bank.
          const vl = V.dot(b.velAt(p.world), Rh) * MPS;
          const aLat = (((0.8 * h.length) / h.samplesAlong) * p.d) / h.samplesAcross;
          const lat = -0.5 * rho * h.lateralDrag * aLat * (Math.abs(vl) + BOAT.LAT_FLOOR) * vl * p.keelW;
          this.addForce(V.mul(Rh, lat), [p.world[0], this.com[1], p.world[2]]);
        }
        // Bow rise over the hump.
        this.addTorque(V.mul(right, h.prowRise * res.wave * 0.25 * h.length));
      }

      // Propulsion: thrust only with the prop in the water.
      const d = spec.drive;
      this.throttle += clamp(clamp(input.throttle || 0, -1, 1) - this.throttle, -dt / d.spool, dt / d.spool);
      this.steerDeg += clamp(clamp(input.steer || 0, -1, 1) * d.maxSteer - this.steerDeg, -d.steerSpeed * dt, d.steerSpeed * dt);
      const prop = b.toWorld(this.propLocal);
      const propSurface = level === null ? -Infinity : Water.level(world, prop[0], prop[2], t);
      const wet = clamp(((propSurface - prop[1]) * MPS) / d.propDiameter + 0.5, 0, 1);
      const thrustN = boatMath.thrust(spec, u, this.throttle) * wet;
      const steerRad = rad(this.steerDeg);
      // Outboards and jets swivel the thrust; inboards push straight.
      this.addForce(V.mul(d.type === 'inboard' ? forward : rotateAxis(forward, up, steerRad), thrustN), prop);
      // Rudder lift: the inboard's rudder or the outboard's gearcase, in the prop wash. Jets have none,
      // but keep some steering off throttle (Drive.IdleSteer).
      if (d.type !== 'jet') {
        const area = Math.PI * (d.propDiameter / 2) ** 2;
        const wash = 2 * SimUtil.inducedVelocity(Math.abs(thrustN), rho, area, Math.abs(u));
        const vr = u + Math.sign(thrustN) * wash;
        const rudder = 0.5 * rho * vr * Math.abs(vr) * d.rudderArea * clamp(3 * steerRad, -1.1, 1.1) * wet;
        this.addForce(V.mul(Rh, -rudder), [prop[0], this.com[1], prop[2]]); // yaw only, no roll
      } else {
        const idle = d.idleSteer * this.staticThrust * Math.min(1, Math.abs(u) / 3) * wet;
        this.addForce(V.mul(Rh, -Math.sin(steerRad) * Math.max(0, idle - Math.abs(thrustN))), [prop[0], this.com[1], prop[2]]);
      }

      // Air drag.
      const speed = V.len(vMs);
      if (speed > 0.1) this.addForce(V.mul(V.unit(vMs), -0.5 * RHO_AIR * spec.aero.cd * spec.aero.area * speed * speed));

      const airborne = wetCount === 0 && wet === 0;
      const I = this.inertia();
      const yawRight = -b.w[1];
      // Stability assist: yaw beyond what the helm asks for.
      if (!airborne && spec.assists.stability > 0 && u > 2) {
        const wanted = (u * Math.tan(steerRad)) / (BOAT.TURN_LENGTHS * h.length); // tightest turn ~3.5 boat lengths / tan(steer)
        const over = yawRight - clamp(yawRight, Math.min(0, wanted), Math.max(0, wanted));
        this.addTorqueRbx([0, over * BOAT.ESC_GAIN * spec.assists.stability * I[1], 0]);
      }
      // Heel in turns: planing hulls bank in (Hull.Bank > 0, scaled by the planing share),
      // displacement hulls heel out (Bank < 0), as a share of a motorcycle's balanced lean.
      const heel = Math.atan2(-right[1], up[1]);
      const rec = spec.recovery;
      if (!airborne && wetCount > 0 && Math.abs(heel) < rad(BOAT.SELF_RIGHT + 10)) {
        const lean = Math.atan((Math.max(u, 0) * yawRight) / G) * 0.5 * h.bank * (h.bank > 0 ? share : 1);
        const heelT = clamp(lean, -rad(25), rad(25));
        const rate = clamp((heelT - heel) * 2, -0.6, 0.6);
        this.trackRates(V.add(b.w, V.mul(forward, rate - V.dot(b.w, forward))), [0, 0, 6], [0, 0, 1]);
      }
      // Anti-capsize (GTA boats almost never roll over): past SELF_RIGHT degrees of heel, roll back
      // toward upright harder the further over it is.
      if (!airborne && rec.selfRight > 0 && Math.abs(heel) > rad(BOAT.SELF_RIGHT)) {
        const back = -Math.sign(heel) * Math.min(1.2, (Math.abs(heel) - rad(BOAT.SELF_RIGHT)) * 4);
        const tw = V.add(b.w, V.mul(forward, back - V.dot(b.w, forward)));
        this.trackRates(tw, [0, 0, 12 * rec.selfRight], [0, 0, 1]);
      }
      if (airborne && rec.airControl > 0) {
        let rate = V.mul(V.cross(up, [0, 1, 0]), BOAT.AIR_LEVEL);
        if (V.len(rate) > BOAT.AIR_MAX) rate = V.mul(V.unit(rate), BOAT.AIR_MAX);
        this.trackRates([rate[0], b.w[1], rate[2]], [BOAT.AIR_DAMP * rec.airControl, 0, BOAT.AIR_DAMP * rec.airControl], [1, 0, 1]);
      }
      // Beached: hull aground and dry, throttle held -> push off.
      let beached = false;
      if (wetCount === 0 && rec.beachPush && Math.abs(input.throttle || 0) > 0.5) {
        const ground = world.raycast(b.pos, [0, -(spec.comHeight / MPS + 2), 0]);
        if (ground) { beached = true; this.addForce(V.add(V.mul(Fh, Math.sign(input.throttle) * 0.35 * W), [0, 0.3 * W, 0])); }
      }
      this.realGravity(airborne ? rec.airGravity * G : G);
      if (rec.autoFlip && up[1] < 0.2 && V.len(b.v) < 4) { this.flipTimer = (this.flipTimer || 0) + dt; if (this.flipTimer > 1.5) { this.flipTimer = 0; this.recoverBoat(); } }
      else this.flipTimer = 0;

      this.telemetry = { speedKmh: u * 3.6, throttle: this.throttle, thrust: thrustN, planing: share, immersion, draft: immersion * T, wet: wetCount, propWet: wet, heel: deg(heel), trim: deg(Math.asin(clamp(forward[1], -1, 1))), airborne, beached, resistance: res.total, steer: this.steerDeg };
      return this.telemetry;
    }
  }

  // ------------------------------------------------------------------ PlaneSim.luau
  const PLANE = { K_ALPHA: 2.5, ALPHA_LEAD: 0.6, PATH_LEVEL: 3, K_BETA: 2.0, LEVEL_GAIN: 1.5, TRACK: [5, 4, 6], THROTTLE_RATE: 0.5 };
  const planeMath = {
    ar: (s) => (s.wing.span * s.wing.span) / s.wing.area,
    slope: (s) => (2 * Math.PI * planeMath.ar(s)) / (planeMath.ar(s) + 2),
    k: (s) => 1 / (Math.PI * s.wing.oswald * planeMath.ar(s)),
    stallAlpha: (s, f) => (s.wing.clMax + f * s.wing.flapsCl - (s.wing.cl0 + f * s.wing.flapsCl * 0.9)) / planeMath.slope(s),
    cl(s, alpha, f) {
      const w = s.wing, clMax = w.clMax + f * w.flapsCl, cl0 = w.cl0 + f * w.flapsCl * 0.9, a = planeMath.slope(s);
      const aPos = planeMath.stallAlpha(s, f), aNeg = (-0.8 * clMax - cl0) / a;
      if (alpha >= aNeg && alpha <= aPos) return cl0 + a * alpha;
      const over = alpha > aPos ? alpha - aPos : aNeg - alpha;
      const peak = alpha > aPos ? clMax : -0.8 * clMax;
      const fade = 1 - smoothstep(0.5, Math.PI / 2 - Math.abs(alpha > aPos ? aPos : aNeg), over);
      return lerp(peak, peak * w.postStall, smoothstep(0, 0.12, over)) * fade;
    },
    ge(s, h) { if (!(h > 0) || h > 2 * s.wing.span) return 1; const x = (16 * h) / s.wing.span; return clamp((x * x) / (1 + x * x), 0.2, 1); },
    cd(s, alpha, cl, f, gearDown, mach, ge) {
      const w = s.wing, as = planeMath.stallAlpha(s, f);
      return w.cd0 * (1 + w.machDragRise * smoothstep(0.85, 1.1, mach)) + f * w.flapsCd + (gearDown && s.gear.retractable ? s.gear.drag : 0) + cl * cl * planeMath.k(s) * ge + 1.2 * Math.sin(alpha) ** 2 * smoothstep(as, as + 0.12, Math.abs(alpha));
    },
    thrust(s, V, state, rho, ab) {
      const e = s.engine;
      if (e.type === 'jet') return (ab && e.afterburner > 0 ? e.afterburner : e.thrust * state) * 1000 * Math.pow(rho / RHO_AIR, 0.7);
      const area = Math.PI * (e.propDiameter / 2) ** 2;
      return SimUtil.diskThrust(e.power * 1000 * state * (rho / RHO_AIR), rho, area, V, SimUtil.propEfficiency(e.staticEfficiency, e.efficiency, e.efficiencySpeedKmh / 3.6, V));
    },
    stallSpeed: (s, f) => Math.sqrt((2 * s.mass * G) / (RHO_AIR * s.wing.area * (s.wing.clMax + f * s.wing.flapsCl))),
  };
  class Plane extends Rig {
    constructor(world, spec, opts = {}) {
      const size = [(spec.wing.span * 0.55) / MPS, 1.2 / MPS, (spec.length * 0.8) / MPS];
      super(world, spec, size, SimUtil.rootMass(size, 150));
      // Stand-in model: tricycle gear, wheelbase 0.3 length, mains 2.5 m apart, wheels 0.3 m.
      const r = 0.3 / MPS, wb = (spec.length * 0.32) / MPS, track = 2.6 / MPS;
      const fw = spec.frontWeight;
      // CoM: frontWeight of the way from the mains (z = 0) to the nose wheel (z = -wb).
      const com = [0, spec.comHeight / MPS, -wb * fw];
      const staticLength = spec.gear.maxLength * spec.gear.rideHeight;
      const pts = [{ name: 'WheelF', c: [0, r, -wb], front: true, steer: true, share: fw }, { name: 'WheelRL', c: [-track / 2, r, 0], share: (1 - fw) / 2 }, { name: 'WheelRR', c: [track / 2, r, 0], share: (1 - fw) / 2 }];
      this.gear = new Gear(this, pts.map((p) => ({ ...p, radius: r, front: !!p.front, steer: !!p.steer, skid: false, local: V.sub(V.add(p.c, [0, staticLength, 0]), com) })), spec.gear);
      this.wheels = this.gear.points;
      this.hull = makeHull([(-spec.wing.span / 2) / MPS, r - com[1], (-spec.length / 2) / MPS - com[2]], [(spec.wing.span / 2) / MPS, 2.6 / MPS - com[1], (spec.length / 2) / MPS - com[2]], r - com[1], 0.1);
      this.lever = opts.throttle || 0; this.state = this.lever; this.ab = false; this.flaps = 0; this.flapsTarget = 0; this.gearDown = true;
      this.vs = planeMath.stallSpeed(spec, 0);
      this.qFull = 0.5 * RHO_AIR * (1.25 * this.vs) ** 2;
      this.alphaTrim = ((spec.wing.clMax / 1.96) - spec.wing.cl0) / planeMath.slope(spec);
      this.wingHeight = spec.comHeight;
      this.place(opts.position || [0, 0, 0], opts.yaw || 0, com[1]);
      if (opts.airborne) {
        // Lab only: start in trimmed level flight (nose up by the 1 g angle of attack).
        const rho = SimUtil.airDensity(opts.altitude), q = 0.5 * rho * opts.speed * opts.speed;
        const a1 = clamp(((spec.mass * G) / (q * spec.wing.area) - spec.wing.cl0) / planeMath.slope(spec), -0.2, planeMath.stallAlpha(spec, 0));
        const R = Lab.mat3mul(M.rotY(opts.yaw || 0), M.rotX(a1));
        this.body.setCFrame(V.add(opts.position, [0, opts.altitude / MPS, 0]), R);
        this.body.v = M.mulV(M.rotY(opts.yaw || 0), [0, 0, -(opts.speed / MPS)]);
        this.gearDown = !spec.gear.retractable;
      }
    }

    // input: { pitch (+1 nose down), roll (+1 right), yaw (+1 right), power (-1..1 lever), brake, flaps (0/1), gearDown }
    step(dt, input) {
      const spec = this.spec, w = spec.wing, b = this.body, world = this.world;
      this.begin();
      const { up: U, look: F, right: R } = this.cf;
      const vMs = V.mul(b.v, MPS);
      const Vs = V.len(vMs);
      const alt = b.pos[1] * MPS;
      const rho = SimUtil.airDensity(alt);
      const q = 0.5 * rho * Vs * Vs;
      const u = V.dot(vMs, F), wv = V.dot(vMs, U), sv = V.dot(vMs, R);
      const alpha = Vs > 0.5 ? Math.atan2(-wv, u) : 0;
      const beta = Vs > 0.5 ? Math.atan2(sv, Math.hypot(u, wv)) : 0;
      if (input.flaps !== undefined) this.flapsTarget = input.flaps ? 1 : 0;
      this.flaps += clamp(this.flapsTarget - this.flaps, -dt / 2, dt / 2);
      if (input.gearDown !== undefined && spec.gear.retractable) this.gearDown = !!input.gearDown;

      // Gear on the ground.
      const g = this.gear;
      const gr = this.gearDown ? g.step({ dt, steerDeg: clamp(((input.yaw || 0) + (this.wow > 0.3 ? input.roll || 0 : 0)), -1, 1) * spec.gear.steerAngle * clamp(1 - (Vs * 3.6) / 90, 0.15, 1), brake: input.brake ? 1 : 0, hold: this.lever <= 0.02 && Vs < 1 }) : { grounded: 0, wow: 0 };
      this.wow = gr.wow;
      const wow = clamp(gr.wow, 0, 1);

      // Aerodynamic forces (SI) at the centre of mass.
      const ground = world.raycast(b.pos, [0, -(spec.wing.span * 2) / MPS, 0]);
      const ge = planeMath.ge(spec, ground ? ground.distance * MPS : Infinity);
      const cl = planeMath.cl(spec, alpha, this.flaps);
      const cd = planeMath.cd(spec, alpha, cl, this.flaps, this.gearDown, Vs / 340, ge);
      let aero = [0, 0, 0];
      if (Vs > 0.5) {
        const vh = V.unit(vMs);
        const rPerp = V.sub(R, V.mul(vh, V.dot(R, vh)));
        const liftDir = V.len(rPerp) > 1e-3 ? V.unit(V.cross(rPerp, vh)) : U;
        aero = V.add(aero, V.mul(liftDir, q * w.area * cl));
        let drag = q * w.area * cd;
        const lim = spec.engine.speedLimitKmh / 3.6;
        if (lim > 0 && Vs > lim) drag += q * w.area * w.cd0 * 20 * (Vs / lim - 1);
        aero = V.add(aero, V.mul(vh, -drag));
        aero = V.add(aero, V.mul(R, -q * w.area * w.cyBeta * beta));
      }
      // Engine.
      const e = spec.engine;
      const power = clamp(input.power || 0, -1, 1);
      this.lever = clamp(this.lever + power * PLANE.THROTTLE_RATE * dt, 0, 1);
      this.ab = e.type === 'jet' && e.afterburner > 0 && this.lever >= 1 && power > 0.5;
      this.state += clamp(this.lever - this.state, -dt / e.spool, dt / e.spool);
      let thrustN = planeMath.thrust(spec, Math.max(u, 0), this.state, rho, this.ab && this.state > 0.98);
      if (e.speedLimitKmh > 0 && Vs * 3.6 >= e.speedLimitKmh) thrustN = 0;
      aero = V.add(aero, V.mul(F, thrustN));
      this.addForce(aero);

      // Control law: follow the flight path, steer the angle of attack, roll rate, sideslip.
      const as = planeMath.stallAlpha(spec, this.flaps);
      const slope = planeMath.slope(spec);
      const cl0 = w.cl0 + this.flaps * w.flapsCl * 0.9;
      // α that makes n g of normal acceleration; the engine's thrust, tilted up by α, carries part of it.
      const thrustLift = thrustN * Math.sin(alpha);
      const alphaFor = (n) => (q > 1 ? ((n * spec.mass * G - thrustLift) / (q * w.area) - cl0) / slope : as);
      const bank = Math.atan2(-R[1], U[1]);
      const gamma = Vs > 0.5 ? Math.asin(clamp(vMs[1] / Vs, -1, 1)) : 0;
      const asst = spec.assists, c = spec.controls;
      const aNegStall = (-0.8 * (w.clMax + this.flaps * w.flapsCl) - cl0) / slope;
      const aMax = Math.min(lerp(as + rad(10), 0.9 * as, asst.stallProtection), Math.max(alphaFor(c.maxG), 0));
      const aMin = Math.max(alphaFor(c.minG), 0.92 * aNegStall);
      // Stick neutral holds the flight path (banked turns keep their height), easing toward level
      // flight with AutoLevel so it pulls out of a dive (or eases a climb) by itself.
      const nNeutral = clamp(Math.cos(gamma) / Math.max(Math.cos(bank), 0.25) - PLANE.PATH_LEVEL * asst.autoLevel * Math.sin(gamma), 0, c.maxG);
      let aNeutral = lerp(this.alphaTrim, clamp(alphaFor(nNeutral), aMin, aMax), asst.autoTrim);
      aNeutral = lerp(aNeutral, alpha, wow); // on the wheels: hold the ground attitude
      const pitchIn = clamp(input.pitch || 0, -1, 1);
      const aCmd = pitchIn < 0 ? aNeutral + -pitchIn * (aMax - aNeutral) : aNeutral - pitchIn * (aNeutral - aMin);
      // Angle-of-attack tracking, with anticipation (the α rate) near the limit so protection doesn't overshoot.
      const alphaRate = this.prevAlpha === undefined ? 0 : (alpha - this.prevAlpha) / dt;
      this.prevAlpha = alpha;
      const lead = alphaRate > 0 && alpha > 0.6 * aMax ? PLANE.ALPHA_LEAD * alphaRate : 0;
      // The target's own rate is fed forward, so an accelerating plane doesn't lag its trim (and climb).
      const cmdRate = this.prevAlphaCmd === undefined ? 0 : clamp((aCmd - this.prevAlphaCmd) / dt, -0.5, 0.5);
      this.prevAlphaCmd = aCmd;
      const pitchRate = clamp(PLANE.K_ALPHA * (aCmd - alpha - lead) + cmdRate, -rad(c.pitchRate), rad(c.pitchRate));
      const rollIn = clamp(input.roll || 0, -1, 1);
      const auth = clamp(q / this.qFull, 0.03, 1);
      let rollRate = rollIn * rad(c.rollRate);
      if (Math.abs(rollIn) < 0.05 && asst.autoLevel > 0 && Math.abs(bank) < rad(75)) rollRate = -bank * PLANE.LEVEL_GAIN * asst.autoLevel;
      const betaCmd = -clamp(input.yaw || 0, -1, 1) * rad(c.maxBeta);
      const yawRate = -PLANE.K_BETA * Math.max(asst.coordination, 0.3) * (beta - betaCmd);
      // Flight path turn rate from this step's forces (gravity included, gear excluded).
      let wPath = [0, 0, 0];
      if (Vs > 1) {
        const a = V.add(V.mul(aero, 1 / spec.mass), [0, -G, 0]);
        wPath = V.mul(V.cross(V.unit(vMs), a), 1 / Vs);
        wPath = V.mul(wPath, 1 - wow);
      }
      const target = V.add(V.add(V.add(wPath, V.mul(R, pitchRate)), V.mul(F, rollRate)), V.mul(U, yawRate));
      this.trackRates(target, PLANE.TRACK, [auth, auth * (1 - 0.9 * wow), auth * (1 - 0.95 * wow)]);
      this.realGravity(G);

      const stall = Math.abs(alpha) > as && Vs > 3 && wow < 0.2;
      this.telemetry = { airspeedKmh: Vs * 3.6, speedKmh: u * 3.6, altitude: alt, vs: vMs[1], alpha: deg(alpha), beta: deg(beta), bank: deg(bank), throttle: this.lever, thrust: thrustN, ab: this.ab, stall, wow, grounded: gr.grounded, gearDown: this.gearDown, g: V.dot(V.mul(aero, 1 / spec.mass), U) / G };
      return this.telemetry;
    }
  }

  // PlaneSim.AimInput: stick inputs that turn the plane toward a world direction (point-to-fly).
  Plane.prototype.aimInput = function (direction) {
    const l = M.tmulV(this.body.R, V.unit(direction)); // X right, Y up, Z back
    const forward = -l[2];
    if (forward > 0.999) return [0, 0];
    let bankErr = clamp(Math.atan2(l[0], Math.max(l[1], 0.05)), -rad(70), rad(70));
    if (forward < 0.2) bankErr = clamp(Math.atan2(l[0], l[1]), -rad(90), rad(90));
    const roll = clamp(bankErr * 2.5, -1, 1);
    const pitchUp = Math.atan2(l[1], Math.max(forward, 0.05));
    const pitch = -clamp(pitchUp * 4, -0.5, 1);
    return [pitch, roll];
  };

  // ------------------------------------------------------------------ HeliSim.luau
  const HELI = { K_VS: 1.5, K_ATT: 3, K_HOLD: 0.06, HOLD_MAX: 20, K_WV: 3, TRACK: [6, 5, 6], LEVER_RATE: 0.35 };
  const heliMath = {
    area: (s) => Math.PI * (s.rotor.diameter / 2) ** 2,
    vi(T, rho, A, vx, vz) {
      if (T <= 0) return 0;
      const vh2 = T / (2 * rho * A), vh = Math.sqrt(vh2);
      let vi = vh;
      for (let i = 0; i < 12; i++) { const through = Math.max(vz + vi, 0.25 * vh); vi = 0.5 * vi + (0.5 * vh2) / Math.sqrt(vx * vx + through * through); }
      return vi;
    },
    power(s, T, rho, vx, vz) {
      const r = s.rotor, A = heliMath.area(s), mu = Math.abs(vx) / r.tipSpeed;
      const induced = r.inducedFactor * T * heliMath.vi(T, rho, A, vx, vz);
      const profile = ((r.solidity * r.profileCd) / 8) * rho * A * r.tipSpeed ** 3 * (1 + 4.65 * mu * mu);
      return Math.max(0, (induced + profile) * (1 + r.tailPower) + T * vz);
    },
    maxThrust(s, rho, vx, vz, P) {
      if (heliMath.power(s, 0, rho, vx, vz) >= P) return 0;
      let lo = 0, hi = s.mass * G * 4;
      for (let i = 0; i < 20; i++) { const mid = (lo + hi) / 2; if (heliMath.power(s, mid, rho, vx, vz) > P) hi = mid; else lo = mid; }
      return lo;
    },
    ge(s, z) {
      const R = s.rotor.diameter / 2;
      if (!(z > 0) || z === Infinity) return z === Infinity ? 1 : 1 + 0.26 * s.realism.groundEffect;
      const zz = Math.max(z, 0.55 * R);
      return 1 + (1 / (1 - (R / (4 * zz)) ** 2) - 1) * s.realism.groundEffect;
    },
    bladeStall: (s, mu) => 1 - 0.6 * smoothstep(s.rotor.bladeStallMu, s.rotor.bladeStallMu + 0.1, mu),
  };
  class Heli extends Rig {
    constructor(world, spec, opts = {}) {
      const size = [2.2 / MPS, 1.8 / MPS, (spec.length * 0.7) / MPS];
      super(world, spec, size, SimUtil.rootMass(size, 150));
      // Stand-in model: two skids 2.3 m apart, 2.6 m long, centred under the rotor (CoM).
      const com = [0, spec.comHeight / MPS, 0];
      const staticLength = spec.gear.maxLength * spec.gear.rideHeight;
      const r = 0.15 / MPS, half = 1.3 / MPS, track = 2.3 / MPS;
      const pts = [];
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) pts.push({ name: `Skid${sx < 0 ? 'L' : 'R'}${sz < 0 ? 'F' : 'B'}`, c: [(sx * track) / 2, r, sz * half], share: 0.25, skid: true, front: sz < 0, steer: false });
      this.gear = new Gear(this, pts.map((p) => ({ ...p, radius: r, local: V.sub(V.add(p.c, [0, staticLength, 0]), com) })), spec.gear);
      this.hubLocal = [0, (spec.rotor.hubHeight - spec.comHeight) / MPS, 0];
      this.hull = makeHull([-1.1 / MPS, r + 0.5 / MPS - com[1], (-spec.length / 2) / MPS], [1.1 / MPS, 3 / MPS - com[1], (spec.length / 2) / MPS], r + 0.5 / MPS - com[1], 0.2);
      this.rotorSpeed = opts.rotorSpeed !== undefined ? opts.rotorSpeed : 0; this.lever = 0.5; this.wow = 0;
      this.place(opts.position || [0, 0, 0], opts.yaw || 0, com[1]);
      if (opts.altitude) { this.body.setCFrame(V.add(opts.position || [0, 0, 0], [0, opts.altitude / MPS, 0]), M.rotY(opts.yaw || 0)); this.rotorSpeed = 1; }
    }

    // input: { pitch (+1 forward), roll (+1 right), yaw (+1 right), power (+1 up), engine (default true) }
    step(dt, input) {
      const spec = this.spec, r = spec.rotor, c = spec.controls, a = spec.assists, b = this.body, world = this.world;
      this.begin();
      const { up: U, look: F, right: R } = this.cf;
      const vMs = V.mul(b.v, MPS);
      const rho = SimUtil.airDensity(b.pos[1] * MPS);
      const W = spec.mass * G;
      this.rotorSpeed += clamp((input.engine === false ? 0 : 1) - this.rotorSpeed, -dt / r.spoolTime, dt / r.spoolTime);
      const rs = this.rotorSpeed;

      // Available thrust: power-limited (momentum theory + Glauert), ground effect, blade stall.
      const vz = V.dot(vMs, U);
      const vx = V.len(V.sub(vMs, V.mul(U, vz)));
      const hub = b.toWorld(this.hubLocal);
      const below = world.raycast(hub, [0, -(r.diameter * 1.5) / MPS, 0]);
      const z = below ? below.distance * MPS : Infinity;
      const ge = heliMath.ge(spec, z);
      const mu = vx / r.tipSpeed;
      const tMax = heliMath.maxThrust(spec, rho, vx, vz, spec.engine.power * 1000) * rs * rs * ge * heliMath.bladeStall(spec, mu);
      // Command: vertical-speed hold (assist) or a collective lever.
      const power = clamp(input.power || 0, -1, 1);
      const vsCmd = power >= 0 ? power * c.climbRate : power * c.descentRate;
      const hold = (spec.mass * (G + HELI.K_VS * (vsCmd - vMs[1]))) / Math.max(U[1], 0.4);
      this.lever = clamp(this.lever + power * HELI.LEVER_RATE * dt, 0, 1);
      const raw = this.lever * tMax - r.heaveDamping * spec.mass * vz;
      let thrust = clamp(lerp(raw, hold, a.altitudeHold), 0, tMax);
      if (spec.realism.vortexRing > 0) {
        const vh = Math.sqrt(W / (2 * rho * heliMath.area(spec)));
        const sev = smoothstep(0.2, 0.7, -vMs[1] / vh) * (1 - smoothstep(0.9, 1.6, -vMs[1] / vh)) * (1 - smoothstep(0.3, 1, vx / vh));
        thrust *= 1 - 0.35 * sev * spec.realism.vortexRing;
      }
      this.addForce(V.mul(U, thrust));
      // Fuselage drag per body axis.
      const fz = spec.fuselage;
      const vf = V.dot(vMs, F), vr = V.dot(vMs, R);
      const drag = V.add(V.add(V.mul(F, -fz.dragArea * vf * Math.abs(vf)), V.mul(R, -fz.sideArea * vr * Math.abs(vr))), V.mul(U, -fz.topArea * vz * Math.abs(vz)));
      this.addForce(V.mul(drag, 0.5 * rho));

      // Ground.
      const gr = this.gear.step({ dt, steerDeg: 0, brake: power <= 0 ? 1 : 0, hold: power <= 0 && V.len(vMs) < 1 });
      this.wow = gr.wow;
      const wow = clamp(gr.wow, 0, 1);

      // Attitude: target pitch and bank (level assist) or rates; hover hold; coordinated yaw.
      const pitch = Math.asin(clamp(F[1], -1, 1));
      const bank = Math.atan2(-R[1], U[1]);
      const Ff = flat(F), Rf = V.cross(Ff, [0, 1, 0]);
      const vF = V.dot(vMs, Ff), vR = V.dot(vMs, Rf), vH = Math.hypot(vF, vR);
      const pIn = clamp(input.pitch || 0, -1, 1), rIn = clamp(input.roll || 0, -1, 1), yIn = clamp(input.yaw || 0, -1, 1);
      const stickFree = Math.abs(pIn) < 0.1 && Math.abs(rIn) < 0.1;
      let pitchT = -pIn * rad(c.maxPitch), bankT = rIn * rad(c.maxBank);
      if (stickFree && a.hoverHold > 0) {
        pitchT += clamp(vF * HELI.K_HOLD * a.hoverHold * 4, -rad(HELI.HOLD_MAX), rad(HELI.HOLD_MAX));
        bankT -= clamp(vR * HELI.K_HOLD * a.hoverHold * 4, -rad(HELI.HOLD_MAX), rad(HELI.HOLD_MAX));
      }
      const coord = a.coordination * smoothstep(8, 20, vH);
      const pedal = yIn * rad(c.yawRate);
      bankT += Math.atan((vH * pedal) / G) * coord;
      bankT = clamp(bankT, -rad(c.maxBank), rad(c.maxBank));
      const qAtt = clamp(HELI.K_ATT * (pitchT - pitch), -rad(c.pitchRate), rad(c.pitchRate));
      const pAtt = clamp(HELI.K_ATT * (bankT - bank), -rad(c.rollRate), rad(c.rollRate));
      const qRate = -pIn * rad(c.pitchRate), pRate = rIn * rad(c.rollRate);
      const qCmd = lerp(qRate, qAtt, a.level), pCmd = lerp(pRate, pAtt, a.level);
      const beta = vH > 1 ? Math.atan2(V.dot(vMs, R), Math.max(V.dot(vMs, F), 0.1)) : 0;
      const turn = vH > 1 ? (G * Math.tan(bank)) / Math.max(vH, 8) : 0;
      // At speed the pedals bank it into a coordinated turn (yaw follows g tan φ / V); the tail fin
      // weathervanes the nose into the airflow.
      let yawCmd = lerp(pedal, turn, coord) + a.weathervane * HELI.K_WV * beta * smoothstep(5, 25, vH);
      const target = V.add(V.add(V.mul(R, qCmd), V.mul(F, pCmd)), [0, -yawCmd, 0]);
      const grounded = wow > 0.05 && thrust < W * 0.9;
      const att = grounded ? 1 - wow : 1;
      this.trackRates(target, HELI.TRACK, [att, grounded ? 1 - 0.7 * wow : 1, att]);
      this.realGravity(G);

      this.telemetry = { speedKmh: vF * 3.6, airspeedKmh: V.len(vMs) * 3.6, altitude: z === Infinity ? null : z, vs: vMs[1], rotorSpeed: rs, thrust, tMax, powerShare: thrust / Math.max(tMax, 1), groundEffect: ge, pitch: deg(pitch), bank: deg(bank), wow, grounded: gr.grounded };
      return this.telemetry;
    }
  }

  return { SimUtil, Rig, Gear, Water, Bike, Boat, Plane, Heli, boatMath, planeMath, heliMath, makeHull, smoothstep, lerp, rad, deg, flat };
});
