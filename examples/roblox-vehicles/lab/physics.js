// Vehicle lab: a line-by-line JS port of the roblox-vehicles kit (VehicleMath.luau,
// VehicleSim.luau, the chassis builder in VehicleService.luau) running on a small rigid-body
// engine that behaves like Roblox for this case: one massive root part, VectorForces held
// constant between PreSimulation steps (60 Hz), physics substeps at 240 Hz, Workspace.Gravity
// 196.2 studs/s², spherecasts that ignore shapes they start inside, and a low-friction
// collision hull (box + rounded nose/tail cylinders).
// Works in Node (require) and in the browser (window.VehicleLab).
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.VehicleLab = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // ---------------------------------------------------------------- vectors / matrices
  const V = {
    add: (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]],
    sub: (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]],
    mul: (a, s) => [a[0] * s, a[1] * s, a[2] * s],
    dot: (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2],
    cross: (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]],
    len: (a) => Math.hypot(a[0], a[1], a[2]),
    unit: (a) => { const l = Math.hypot(a[0], a[1], a[2]); return l > 1e-12 ? [a[0] / l, a[1] / l, a[2] / l] : [0, 0, 0]; },
    zero: () => [0, 0, 0],
  };
  // 3x3 matrices as arrays of 3 rows. Columns of a rotation = right (X), up (Y), back (Z).
  const M = {
    mulV: (m, v) => [V.dot(m[0], v), V.dot(m[1], v), V.dot(m[2], v)],
    tmulV: (m, v) => [m[0][0] * v[0] + m[1][0] * v[1] + m[2][0] * v[2], m[0][1] * v[0] + m[1][1] * v[1] + m[2][1] * v[2], m[0][2] * v[0] + m[1][2] * v[1] + m[2][2] * v[2]],
    col: (m, i) => [m[0][i], m[1][i], m[2][i]],
    fromQuat: (q) => {
      const [w, x, y, z] = q;
      return [
        [1 - 2 * (y * y + z * z), 2 * (x * y - w * z), 2 * (x * z + w * y)],
        [2 * (x * y + w * z), 1 - 2 * (x * x + z * z), 2 * (y * z - w * x)],
        [2 * (x * z - w * y), 2 * (y * z + w * x), 1 - 2 * (x * x + y * y)],
      ];
    },
    rotX: (a) => [[1, 0, 0], [0, Math.cos(a), -Math.sin(a)], [0, Math.sin(a), Math.cos(a)]],
    rotY: (a) => [[Math.cos(a), 0, Math.sin(a)], [0, 1, 0], [-Math.sin(a), 0, Math.cos(a)]],
    I: () => [[1, 0, 0], [0, 1, 0], [0, 0, 1]],
  };
  const quatFromAxisAngle = (axis, a) => { const s = Math.sin(a / 2); const u = V.unit(axis); return [Math.cos(a / 2), u[0] * s, u[1] * s, u[2] * s]; };
  const quatMul = (a, b) => [
    a[0] * b[0] - a[1] * b[1] - a[2] * b[2] - a[3] * b[3],
    a[0] * b[1] + a[1] * b[0] + a[2] * b[3] - a[3] * b[2],
    a[0] * b[2] - a[1] * b[3] + a[2] * b[0] + a[3] * b[1],
    a[0] * b[3] + a[1] * b[2] - a[2] * b[1] + a[3] * b[0],
  ];
  const quatNorm = (q) => { const l = Math.hypot(...q); return q.map((x) => x / l); };
  // Rodrigues: rotate v about unit axis k by angle a (= CFrame.fromAxisAngle(k, a) * v).
  const rotateAxis = (v, k, a) => V.add(V.add(V.mul(v, Math.cos(a)), V.mul(V.cross(k, v), Math.sin(a))), V.mul(k, V.dot(k, v) * (1 - Math.cos(a))));
  const clamp = (x, a, b) => Math.min(Math.max(x, a), b);
  const CAST_LIFT = 1; // sphere casts start this many wheel radii above the mount
  const AIR_SUPPORT = 0.2;
  const STOP_GAIN = 0.4; // share of 'stop this corner in one step': above ~0.65 the yaw mode oscillates at standstill
  const AIR_LEVEL = 40, AIR_DAMP = 14; // air control gains (× Recovery.AirControl)
  const HOLD_MS = 0.6; // hill hold below this speed (m/s) with no pedal
  const MIN_ROOT_MASS = 150; // RMU: keeps a seated character a small share of the assembly // springs carrying less than this share of weight = airborne

  // ---------------------------------------------------------------- spec (rveh.cjs DEFAULTS)
  const DEFAULTS = {
    mass: 1300, frontWeight: 0.55, comHeight: 0.5, wheelRadius: 0.32, drivetrain: 'FWD', awdFrontSplit: 0.4,
    engine: { idleRpm: 850, redlineRpm: 6500, launchRpm: 2500, efficiency: 0.85, speedLimitKmh: 0, torqueCurve: [[1000, 120], [4000, 160], [6500, 130]] },
    gearbox: { ratios: [3.5, 2.0, 1.4, 1.05, 0.85], reverse: 3.3, finalDrive: 3.9, shiftUpRpm: 6000, shiftDownRpm: 2800, shiftTime: 0.25 },
    brakes: { decelG: 1.0, frontBias: 0.65, handbrakeGripScale: 0.5 },
    steering: { maxAngle: 34, speed: 4, highSpeedScale: 0.4, highSpeedKmh: 160 },
    tires: { gripFront: 1.0, gripRear: 1.0, stiffness: 10, shape: 1.9, slideGrip: 0.8, rollingResistance: 0.013 },
    drift: { countersteer: 0.15, maxAngle: 50, stabilizer: 0.5 },
    recovery: { airControl: 0.3, autoFlip: true, stuckAssist: true },
    body: { autoHull: true, hullFriction: 0.08 },
    suspension: { frequencyFront: 2.4, frequencyRear: 2.6, dampingRatio: 0.35, maxLength: 1.6, rideHeight: 0.6, antiRoll: 0.3, rollCenter: 0.5 },
    aero: { cd: 0.32, area: 2.1, downforceCl: 0 },
  };
  function merge(base, over) {
    const out = Array.isArray(base) ? [...base] : { ...base };
    for (const [k, v] of Object.entries(over || {})) out[k] = v && typeof v === 'object' && !Array.isArray(v) && base[k] && typeof base[k] === 'object' && !Array.isArray(base[k]) ? merge(base[k], v) : v;
    return out;
  }
  const normalize = (raw) => merge(DEFAULTS, raw);

  // ---------------------------------------------------------------- VehicleMath.luau port
  const VM = { G: 9.81, AIR_DENSITY: 1.225, METERS_PER_STUD: 0.28 };
  VM.TorqueAt = (curve, rpm, redline) => {
    if (rpm > redline) return 0;
    if (rpm <= curve[0][0]) return curve[0][1];
    for (let i = 1; i < curve.length; i++) {
      const [r1, t1] = curve[i];
      if (rpm <= r1) { const [r0, t0] = curve[i - 1]; return t0 + ((t1 - t0) * (rpm - r0)) / (r1 - r0); }
    }
    return curve[curve.length - 1][1];
  };
  VM.EngineRpm = (s, speedMs, ratio) => (Math.abs(speedMs) / s.wheelRadius) * ratio * s.gearbox.finalDrive * (60 / (2 * Math.PI));
  VM.Ratio = (s, gear) => (gear < 0 ? s.gearbox.reverse : s.gearbox.ratios[clamp(gear, 1, s.gearbox.ratios.length) - 1]);
  VM.Drive = (s, speedMs, gear, throttle) => {
    const e = s.engine;
    if (e.speedLimitKmh > 0 && Math.abs(speedMs) * 3.6 >= e.speedLimitKmh) throttle = 0;
    const ratio = VM.Ratio(s, gear);
    let rpm = VM.EngineRpm(s, speedMs, ratio);
    if ((gear === 1 || gear < 0) && throttle > 0 && rpm < e.launchRpm) rpm = e.launchRpm;
    rpm = Math.max(rpm, e.idleRpm);
    const torque = VM.TorqueAt(e.torqueCurve, rpm, e.redlineRpm) * throttle;
    return [(torque * ratio * s.gearbox.finalDrive * e.efficiency) / s.wheelRadius, rpm];
  };
  VM.AutoShift = (s, gear, speedMs) => {
    if (gear < 1) return gear;
    const gb = s.gearbox;
    const rpm = VM.EngineRpm(s, speedMs, VM.Ratio(s, gear));
    if (rpm >= gb.shiftUpRpm && gear < gb.ratios.length) return gear + 1;
    if (gear > 1) {
      const lower = VM.EngineRpm(s, speedMs, VM.Ratio(s, gear - 1));
      if (rpm <= gb.shiftDownRpm && lower < gb.shiftUpRpm * 0.95) return gear - 1;
    }
    return gear;
  };
  VM.Drag = (s, v) => 0.5 * VM.AIR_DENSITY * s.aero.cd * s.aero.area * v * v;
  VM.Downforce = (s, v) => 0.5 * VM.AIR_DENSITY * s.aero.downforceCl * s.aero.area * v * v;
  VM.TireCurve = (slip, B, C, slideGrip) => {
    const x = C * Math.atan(B * Math.abs(slip));
    let f = Math.sin(x);
    if (x > Math.PI / 2) f = Math.max(f, slideGrip);
    return slip < 0 ? -f : f;
  };
  VM.Spring = (m, freq, zeta) => { const w = 2 * Math.PI * freq; const k = m * w * w; return [k, 2 * zeta * Math.sqrt(k * m)]; };
  // Exact port of the Luau loop order (drag check BEFORE the limiter check).
  VM.TopSpeedKmhLuau = (s) => {
    let best = 0;
    for (let kmh = 1; kmh <= 600; kmh += 0.5) {
      const v = kmh / 3.6;
      const resist = VM.Drag(s, v) + s.tires.rollingResistance * s.mass * VM.G;
      let maxDrive = 0, any = false;
      for (let g = 1; g <= s.gearbox.ratios.length; g++) {
        if (VM.EngineRpm(s, v, VM.Ratio(s, g)) <= s.engine.redlineRpm) { any = true; maxDrive = Math.max(maxDrive, VM.Drive(s, v, g, 1)[0]); }
      }
      if (!any) break;
      if (s.engine.speedLimitKmh > 0 && kmh >= s.engine.speedLimitKmh) return s.engine.speedLimitKmh;
      if (maxDrive <= resist) break;
      best = kmh;
    }
    return best;
  };

  // ---------------------------------------------------------------- world
  // Boxes: { name, c:[x,y,z], h:[hx,hy,hz], R (rotation rows), ignore?, color? }
  class World {
    constructor() { this.boxes = []; this.gravity = 196.2; }
    box(name, c, size, R = M.I(), opts = {}) { const b = { name, c, h: size.map((x) => x / 2), R, ...opts }; this.boxes.push(b); return b; }
    closest(b, p) {
      const l = M.tmulV(b.R, V.sub(p, b.c));
      const q = [clamp(l[0], -b.h[0], b.h[0]), clamp(l[1], -b.h[1], b.h[1]), clamp(l[2], -b.h[2], b.h[2])];
      return V.add(b.c, M.mulV(b.R, q));
    }
    // Workspace:Spherecast. Parts the sphere starts inside are ignored (Roblox behaviour).
    spherecast(origin, r, dirVec) {
      const maxD = V.len(dirVec); const d = V.unit(dirVec);
      let best = null;
      for (const b of this.boxes) {
        if (b.ignore) continue;
        // cheap reject: bounding sphere of the box vs the swept segment
        const br = V.len(b.h) + r;
        const toC = V.sub(b.c, origin); const t0 = clamp(V.dot(toC, d), 0, maxD);
        if (V.len(V.sub(toC, V.mul(d, t0))) > br) continue;
        const dist = (t) => { const p = V.add(origin, V.mul(d, t)); return V.len(V.sub(p, this.closest(b, p))); };
        if (dist(0) <= r) continue;
        const step = Math.min(0.08, r * 0.5);
        let prev = 0, hitT = null;
        for (let t = step; t <= maxD + 1e-9; t += step) { if (dist(Math.min(t, maxD)) <= r) { hitT = Math.min(t, maxD); break; } prev = t; }
        if (hitT === null) continue;
        let lo = prev, hi = hitT;
        for (let i = 0; i < 12; i++) { const mid = (lo + hi) / 2; if (dist(mid) <= r) hi = mid; else lo = mid; }
        if (best && hi >= best.distance) continue;
        const centre = V.add(origin, V.mul(d, hi));
        const pos = this.closest(b, centre);
        best = { position: pos, normal: V.unit(V.sub(centre, pos)), distance: hi, part: b };
      }
      return best;
    }
    raycast(origin, dirVec) { return this.spherecast(origin, 0.02, dirVec); }
  }

  // ---------------------------------------------------------------- car geometry (a stand-in "mesh")
  // The kit only reads wheel positions/sizes and the body's bounding corners, so a car here is
  // just that: 4 wheels from the spec and a body box. Track widths are typical for the class.
  const TRACK_M = { Hatchback: 1.5, SportsCar: 1.6, PickupTruck: 1.7, Kart: 1.1, DriftCar: 1.5, ArcadeCar: 1.6 };
  function carGeometry(spec) {
    const MPS = VM.METERS_PER_STUD;
    const wb = (spec.wheelbase || 2.6) / MPS;
    const track = (TRACK_M[spec.name] || 1.55) / MPS;
    const r = spec.wheelRadius / MPS;
    const kart = spec.name === 'Kart';
    const overhang = kart ? 0.6 : wb * 0.32;
    const bodyBottom = kart ? r * 0.5 : r * 0.55;
    const bodyTop = kart ? r * 2.2 : spec.name === 'PickupTruck' ? r + 6.4 : r + 4.4;
    return {
      wheels: [
        { name: 'WheelFL', front: true, left: true, center: [-track / 2, r, -wb / 2], radius: r },
        { name: 'WheelFR', front: true, left: false, center: [track / 2, r, -wb / 2], radius: r },
        { name: 'WheelRL', front: false, left: true, center: [-track / 2, r, wb / 2], radius: r },
        { name: 'WheelRR', front: false, left: false, center: [track / 2, r, wb / 2], radius: r },
      ],
      body: { min: [-track / 2 - (kart ? 0 : 0.4), bodyBottom, -wb / 2 - overhang], max: [track / 2 + (kart ? 0 : 0.4), bodyTop, wb / 2 + overhang] },
      seat: [-track * 0.2, bodyBottom + (kart ? 1.2 : 2.2), 0], // driver's hip, left of centre
    };
  }

  // ---------------------------------------------------------------- rigid body (the assembly)
  class Body {
    constructor() {
      this.pos = [0, 0, 0]; // root part position (CFrame.Position)
      this.q = [1, 0, 0, 0];
      this.R = M.I();
      this.v = [0, 0, 0]; // velocity of the centre of mass
      this.w = [0, 0, 0];
      this.mass = 1; this.Ibody = [1, 1, 1]; this.comLocal = [0, 0, 0];
      this.anchored = false;
    }
    get com() { return V.add(this.pos, M.mulV(this.R, this.comLocal)); }
    worldInvI(v) { // I_world^-1 * v
      const l = M.tmulV(this.R, v);
      return M.mulV(this.R, [l[0] / this.Ibody[0], l[1] / this.Ibody[1], l[2] / this.Ibody[2]]);
    }
    worldI(v) { const l = M.tmulV(this.R, v); return M.mulV(this.R, [l[0] * this.Ibody[0], l[1] * this.Ibody[1], l[2] * this.Ibody[2]]); }
    velAt(p) { return V.add(this.v, V.cross(this.w, V.sub(p, this.com))); }
    toWorld(l) { return V.add(this.pos, M.mulV(this.R, l)); }
    setCFrame(pos, R) {
      this.pos = pos; this.R = R;
      // matrix -> quaternion
      const m = R, tr = m[0][0] + m[1][1] + m[2][2];
      let q;
      if (tr > 0) { const s = Math.sqrt(tr + 1) * 2; q = [0.25 * s, (m[2][1] - m[1][2]) / s, (m[0][2] - m[2][0]) / s, (m[1][0] - m[0][1]) / s]; }
      else if (m[0][0] > m[1][1] && m[0][0] > m[2][2]) { const s = Math.sqrt(1 + m[0][0] - m[1][1] - m[2][2]) * 2; q = [(m[2][1] - m[1][2]) / s, 0.25 * s, (m[0][1] + m[1][0]) / s, (m[0][2] + m[2][0]) / s]; }
      else if (m[1][1] > m[2][2]) { const s = Math.sqrt(1 + m[1][1] - m[0][0] - m[2][2]) * 2; q = [(m[0][2] - m[2][0]) / s, (m[0][1] + m[1][0]) / s, 0.25 * s, (m[1][2] + m[2][1]) / s]; }
      else { const s = Math.sqrt(1 + m[2][2] - m[0][0] - m[1][1]) * 2; q = [(m[1][0] - m[0][1]) / s, (m[0][2] + m[2][0]) / s, (m[1][2] + m[2][1]) / s, 0.25 * s]; }
      this.q = quatNorm(q);
    }
  }

  // lookAt like CFrame.lookAt(pos, pos + forward, up): LookVector = -Z column.
  function lookAtR(forward, up = [0, 1, 0]) {
    const back = V.unit(V.mul(forward, -1));
    const right = V.unit(V.cross(up, back));
    const u = V.cross(back, right);
    return [[right[0], u[0], back[0]], [right[1], u[1], back[1]], [right[2], u[2], back[2]]];
  }

  // ---------------------------------------------------------------- VehicleService.build port + VehicleSim port
  class Car {
    // opts: { position:[x,y,z] ground point under the car, yaw (rad), characterMass (RMU, 0 = none) }
    constructor(world, rawSpec, opts = {}) {
      const spec = (this.spec = normalize(rawSpec));
      this.world = world;
      const MPS = VM.METERS_PER_STUD;
      const geo = (this.geo = carGeometry(spec));
      // --- build(): geometry in model space (car built facing -Z at the origin, ground y=0)
      const up = [0, 1, 0];
      const fronts = geo.wheels.filter((w) => w.front), rears = geo.wheels.filter((w) => !w.front);
      const avg = (ws) => V.mul(ws.reduce((a, w) => V.add(a, w.center), [0, 0, 0]), 1 / ws.length);
      const frontC = avg(fronts), rearC = avg(rears), allC = avg(geo.wheels);
      const groundH = geo.wheels.reduce((a, w) => a + w.center[1] - w.radius, 0) / geo.wheels.length;
      const along = V.sub(frontC, rearC);
      const forward = V.unit(V.sub(along, V.mul(up, V.dot(along, up))));
      const wheelbase = V.len(V.sub(along, V.mul(up, V.dot(along, up))));
      const right = V.cross(forward, up);
      const xs = geo.wheels.map((w) => V.dot(w.center, right));
      const track = Math.max(Math.max(...xs) - Math.min(...xs), 2);
      let com = V.add(rearC, V.mul(forward, wheelbase * spec.frontWeight));
      com = V.add(com, V.mul(right, V.dot(V.sub(allC, com), right)));
      com = V.add(com, V.mul(up, groundH + spec.comHeight / MPS - V.dot(com, up)));
      const rootSize = [track, Math.max(1, spec.comHeight / MPS), wheelbase * 1.15];
      const rootR = lookAtR(forward, up);
      this.rootSize = rootSize; this.track = track; this.wheelbaseStuds = wheelbase;
      const toRootLocal = (p) => M.tmulV(rootR, V.sub(p, com));

      // Body + root masses (Roblox: density 0.7 × volume; body parts are Massless).
      const body = new Body();
      const rootVol = rootSize[0] * rootSize[1] * rootSize[2];
      const rootMass = Math.min(100, Math.max(0.7, MIN_ROOT_MASS / rootVol)) * rootVol; // root density
      const box = (m, s) => [(m * (s[1] ** 2 + s[2] ** 2)) / 12, (m * (s[0] ** 2 + s[2] ** 2)) / 12, (m * (s[0] ** 2 + s[1] ** 2)) / 12];
      let I = box(rootMass, rootSize);
      let mass = rootMass, comLocal = [0, 0, 0];
      this.characterMass = opts.characterMass || 0;
      if (this.characterMass > 0) {
        // Seated character welded to the seat: a point-ish mass (2×2×1 block) at the hip.
        const cm = this.characterMass, p = toRootLocal(geo.seat);
        comLocal = V.mul(p, cm / (rootMass + cm));
        const d0 = V.mul(comLocal, -1), d1 = V.sub(p, comLocal);
        const par = (m, d) => [m * (d[1] ** 2 + d[2] ** 2), m * (d[0] ** 2 + d[2] ** 2), m * (d[0] ** 2 + d[1] ** 2)];
        const Ic = box(cm, [2, 2, 1]);
        I = [0, 1, 2].map((i) => I[i] + par(rootMass, d0)[i] + Ic[i] + par(cm, d1)[i]);
        mass += cm;
      }
      body.mass = mass; body.Ibody = I; body.comLocal = comLocal;
      this.body = body;
      this.assemblyMass = mass;

      // Hull (buildHull), in root space.
      this.hull = null;
      if (spec.body.autoHull) {
        const corners = [];
        for (const sx of [0, 1]) for (const sy of [0, 1]) for (const sz of [0, 1]) corners.push(toRootLocal([sx ? geo.body.max[0] : geo.body.min[0], sy ? geo.body.max[1] : geo.body.min[1], sz ? geo.body.max[2] : geo.body.min[2]]));
        const mn = [0, 1, 2].map((i) => Math.min(...corners.map((c) => c[i])));
        const mx = [0, 1, 2].map((i) => Math.max(...corners.map((c) => c[i])));
        const axleY = geo.wheels.reduce((a, w) => a + toRootLocal(w.center)[1], 0) / geo.wheels.length;
        const bottom = Math.max(mn[1], axleY), top = Math.max(mx[1], bottom + 1), height = top - bottom;
        const width = Math.max(mx[0] - mn[0], 1), length = Math.max(mx[2] - mn[2], 2);
        const radius = Math.min(height / 2, length / 4);
        const cx = (mn[0] + mx[0]) / 2, cz = (mn[2] + mx[2]) / 2;
        this.hull = {
          friction: spec.body.hullFriction,
          box: { c: [cx, bottom + height / 2, cz], size: [width, height, Math.max(length - 2 * radius, 0.5)] },
          cyl: [mn[2] + radius, mx[2] - radius].map((z) => ({ c: [cx, bottom + radius, z], radius, width })),
        };
        this.hull.samples = hullSamples(this.hull);
      }

      // Mounts and contacts (attachments on the root).
      const staticLength = spec.suspension.maxLength * spec.suspension.rideHeight;
      const frontShare = spec.drivetrain === 'FWD' ? 1 : spec.drivetrain === 'RWD' ? 0 : spec.awdFrontSplit;
      const gravity = world.gravity;
      this.wheels = geo.wheels.map((w) => {
        const axleCount = w.front ? fronts.length : rears.length;
        const axleShare = w.front ? spec.frontWeight : 1 - spec.frontWeight;
        const cornerMass = (mass * axleShare) / axleCount; // root.AssemblyMass
        const freq = w.front ? spec.suspension.frequencyFront : spec.suspension.frequencyRear;
        const [k, c] = VM.Spring(cornerMass, freq, spec.suspension.dampingRatio);
        const staticForce = cornerMass * gravity;
        return {
          name: w.name, front: w.front, left: w.left, radius: w.radius,
          mountLocal: toRootLocal(V.add(w.center, V.mul(up, staticLength))),
          contactLocal: toRootLocal(V.sub(w.center, V.mul(up, w.radius))),
          driveShare: (w.front ? frontShare : 1 - frontShare) / axleCount,
          brakeShare: (w.front ? spec.brakes.frontBias : 1 - spec.brakes.frontBias) / axleCount,
          k, c, restLength: staticLength + staticForce / k, staticForce,
          axleWeightN: (spec.mass * VM.G * axleShare) / axleCount,
          cornerMassKg: (spec.mass * axleShare) / axleCount,
          length: staticLength, grounded: false, hit: null, springForce: 0, slip: 0,
          springF: [0, 0, 0], tireF: [0, 0, 0], spin: 0,
        };
      });
      this.rearCount = Math.max(rears.length, 1);
      this.comModel = com; // model-space CoM (the root's origin), for visuals
      this.staticLength = staticLength;
      this.aeroF = [0, 0, 0]; this.stabT = [0, 0, 0];
      this.inertiaAir = (mass * (rootSize[0] ** 2 + rootSize[2] ** 2)) / 12;
      this.gear = 1; this.shiftTimer = 0; this.steer = 0; this.rpm = spec.engine.idleRpm;
      this.stuckTimer = 0; this.unstickUntil = 0; this.unstickTries = 0; this.flipTimer = 0; this.lastRecover = -Infinity;
      this.accelLong = 0; this.accelLat = 0; this.tireLongN = 0; this.tireLatN = 0;
      this.frontCount = Math.max(fronts.length, 1);
      this.wheelbaseM = (wheelbase * MPS); this.trackM = (track * MPS);
      this.clock = 0; this.recoveries = 0; this.unsticks = 0; this.events = [];
      this.place(opts.position || [0, 0, 0], opts.yaw || 0, opts.R);
    }

    // Puts the built car in the world with the wheels on the ground at `ground`.
    place(ground, yaw = 0, Rextra) {
      const R0 = M.rotY(yaw);
      const R = Rextra ? mat3mul(R0, Rextra) : R0;
      // root sits so the tire contact points are on the ground
      this.body.setCFrame(V.add(ground, M.mulV(R, [0, -this.wheels[0].contactLocal[1], 0])), R);
      this.body.v = [0, 0, 0]; this.body.w = [0, 0, 0];
    }

    get cf() { const R = this.body.R; return { pos: this.body.pos, right: M.col(R, 0), up: M.col(R, 1), look: V.mul(M.col(R, 2), -1) }; }

    // VehicleSim.Recover
    recover(stepBack = 0) {
      const now = this.clock;
      if (now - this.lastRecover < 2) return;
      this.lastRecover = now; this.recoveries++;
      this.events.push({ t: now, what: 'recover' });
      const MPS = VM.METERS_PER_STUD;
      const { pos, look } = this.cf;
      const flat = [look[0], 0, look[2]];
      const fwd = V.len(flat) > 0.1 ? V.unit(flat) : [0, 0, 1];
      const position = V.sub(pos, V.mul(fwd, stepBack));
      const g = this.world.raycast(V.add(position, [0, 12, 0]), [0, -60, 0]);
      const groundY = g ? g.position[1] : position[1];
      const height = this.spec.comHeight / MPS + this.spec.suspension.maxLength + 1.5;
      this.body.setCFrame([position[0], groundY + height, position[2]], lookAtR(fwd));
      this.body.v = [0, 0, 0]; this.body.w = [0, 0, 0];
      this.stuckTimer = 0; this.unstickTries = 0; this.flipTimer = 0;
    }

    // VehicleSim.Step — the port. input: { throttle -1..1, steer -1..1, handbrake }
    step(dt, input) {
      const spec = this.spec, MPS = VM.METERS_PER_STUD, G = VM.G, body = this.body, world = this.world;
      this.clock += dt;
      const now = this.clock;
      const { up, look: forward, right } = this.cf;
      const velocity = body.velAt(body.pos); // root.AssemblyLinearVelocity (velocity at the root part's position)
      const forwardMs = V.dot(velocity, forward) * MPS;
      const lateralMs = V.dot(velocity, right) * MPS;
      const speedKmh = Math.abs(forwardMs) * 3.6;
      const toRoblox = this.assemblyMass / spec.mass / MPS;

      const driftAngle = Math.abs(forwardMs) > 1 ? (Math.atan2(lateralMs, Math.abs(forwardMs)) * 180) / Math.PI : 0;
      const drifting = Math.abs(driftAngle) > 10 && speedKmh > 25 && forwardMs > 0;

      const st = spec.steering;
      const lock = st.maxAngle * (1 + (st.highSpeedScale - 1) * clamp(speedKmh / st.highSpeedKmh, 0, 1));
      let target = clamp(input.steer, -1, 1) * lock;
      if (drifting) target += spec.drift.countersteer * driftAngle;
      target = clamp(target, -st.maxAngle, st.maxAngle);
      const maxStep = st.maxAngle * st.speed * dt;
      this.steer += clamp(target - this.steer, -maxStep, maxStep);

      let drive = 0, brake = 0;
      if (input.throttle > 0.05) {
        if (forwardMs < -1) brake = input.throttle;
        else { if (this.gear < 1) this.gear = 1; drive = input.throttle; }
      } else if (input.throttle < -0.05) {
        if (forwardMs > 1) brake = -input.throttle;
        else { this.gear = -1; drive = -input.throttle; }
      }

      // Hill hold: no pedal and (nearly) stopped -> service brakes on all four wheels, so parked
      // and waiting cars stay put on slopes instead of creeping.
      const holding = Math.abs(input.throttle) <= 0.05 && Math.abs(forwardMs) < HOLD_MS;
      if (holding) brake = 1;

      if (this.shiftTimer > 0) this.shiftTimer -= dt;
      else if (this.gear >= 1) {
        const next = VM.AutoShift(spec, this.gear, forwardMs);
        if (next !== this.gear) { this.gear = next; this.shiftTimer = spec.gearbox.shiftTime; }
      }
      let [driveN, rpm] = VM.Drive(spec, forwardMs, this.gear, drive);
      if (this.shiftTimer > 0) driveN = 0;
      if (this.gear < 0) driveN = -driveN;
      this.rpm += (rpm - this.rpm) * Math.min(1, dt * 12);

      // Pass 1: sphere-cast suspension
      const maxLength = spec.suspension.maxLength;
      let grounded = 0;
      for (const w of this.wheels) {
        const castR = w.radius * 0.85, inset = w.radius - castR, lift = w.radius * CAST_LIFT;
        let hit = world.spherecast(V.add(body.toWorld(w.mountLocal), V.mul(up, lift)), castR, V.mul(up, -(maxLength + inset + lift)));
        if (hit && V.dot(hit.normal, up) < 0.35) hit = null;
        w.hit = hit;
        if (hit) {
          const length = clamp(hit.distance - inset - lift, 0, maxLength);
          const cs = (w.length - length) / dt;
          w.springForce = w.k * (w.restLength - length) + w.c * cs;
          w.length = length; w.grounded = true; grounded++;
        } else { w.length = maxLength; w.springForce = 0; w.grounded = false; }
      }

      // Pass 1b: real-world weight transfer. Tire forces are real-unit forces but Roblox gravity is
      // ~5.6x real gravity in studs, so the inertial couple that rolls and pitches the body is only
      // ~18% of a real car's. Add the missing couple from the measured chassis acceleration: each
      // spring pushes up that much less (outer/rear wheels) or more (inner/front), the body leans
      // and squats, and the springs - which set the tire loads - pick up the real load transfer.
      let groundNormal = up;
      if (grounded > 0) { let n = [0, 0, 0]; for (const w of this.wheels) if (w.hit) n = V.add(n, w.hit.normal); groundNormal = V.unit(n); }
      const groundAlong = V.sub([0, 1, 0], V.mul(groundNormal, groundNormal[1])); // uphill, |.| = sin(slope)

      // Acceleration the tires produced last step (real units, chassis frame). Using tire forces
      // rather than the body's measured motion keeps body roll from feeding back into the transfer.
      const smooth = Math.min(1, dt * 15);
      this.accelLong += (clamp(this.tireLongN / spec.mass, -2.5 * G, 2.5 * G) - this.accelLong) * smooth;
      this.accelLat += (clamp(this.tireLatN / spec.mass, -2.5 * G, 2.5 * G) - this.accelLat) * smooth;
      for (const w of this.wheels) w.transferForce = 0;
      if (grounded === this.wheels.length) {
        const share = 1 - G / MPS / world.gravity;
        const h = spec.comHeight;
        const longN = (spec.mass * this.accelLong * h) / this.wheelbaseM; // moved front -> rear
        const latN = (spec.mass * this.accelLat * h) / this.trackM; // moved right -> left
        for (const w of this.wheels) {
          const axleShare = w.front ? spec.frontWeight : 1 - spec.frontWeight;
          const axleCount = w.front ? this.frontCount : this.rearCount;
          const dN = (w.front ? -longN : longN) / axleCount + ((w.left ? latN : -latN) * axleShare) / (axleCount / 2);
          w.transferForce = w.staticForce * (dN / w.axleWeightN) * share;
        }
      }
      let support = 0;
      for (const w of this.wheels) support += Math.max(0, w.springForce);
      support /= this.assemblyMass * world.gravity;

      // Pass 2: anti-roll
      const antiRoll = spec.suspension.antiRoll;
      if (antiRoll > 0) {
        for (const front of [true, false]) {
          let ls = 0, rs = 0, ln = 0, rn = 0, k = 0;
          for (const w of this.wheels) if (w.front === front) { k = w.k; if (w.left) { ls += maxLength - w.length; ln++; } else { rs += maxLength - w.length; rn++; } }
          if (ln > 0 && rn > 0) {
            const transfer = antiRoll * k * (ls / ln - rs / rn);
            for (const w of this.wheels) if (w.front === front && w.grounded) w.springForce += w.left ? transfer : -transfer;
          }
        }
      }

      // Pass 3: tires
      const tires = spec.tires, brakes = spec.brakes;
      const downforceN = VM.Downforce(spec, V.len(velocity) * MPS);
      const rollCenter = spec.suspension.rollCenter;
      let worstSlip = 0, sumLong = 0, sumLat = 0;
      const overRot = Math.max(0, Math.abs(driftAngle) - spec.drift.maxAngle) / spec.drift.maxAngle;
      const rearBoost = 1 + spec.drift.stabilizer * Math.min(overRot * 3, 1);
      for (const w of this.wheels) {
        const hit = w.hit;
        if (!hit) { w.springF = [0, 0, 0]; w.tireF = [0, 0, 0]; w.slip = 0; continue; }
        const springForce = Math.max(0, w.springForce);
        const loadRatio = clamp(springForce / w.staticForce, 0, 3);
        const loadN = w.axleWeightN * loadRatio + downforceN / this.wheels.length;
        let mu = w.front ? tires.gripFront : tires.gripRear;
        if (!w.front) { mu *= rearBoost; if (input.handbrake) mu *= brakes.handbrakeGripScale; }
        const gripN = mu * loadN;
        // CFrame.fromAxisAngle(up, -rad(steer)) * forward
        const wf = w.front ? rotateAxis(forward, up, (-this.steer * Math.PI) / 180) : forward;
        const wr = V.cross(wf, up);
        const cv = body.velAt(hit.position);
        const longMs = V.dot(cv, wf) * MPS, latMs = V.dot(cv, wr) * MPS;
        // Never push a corner past zero speed in one step. At standstill the yaw mode has much less
        // effective mass than the corners, so the gain is reduced there to keep it from oscillating.
        const stopLimit = (w.cornerMassKg / dt) * (STOP_GAIN + (1 - STOP_GAIN) * clamp((V.len(velocity) * MPS) / 4, 0, 1));
        const slipAngle = Math.atan2(latMs, Math.max(Math.abs(longMs), 0.5));
        let latN = -gripN * VM.TireCurve(slipAngle, tires.stiffness, tires.shape, tires.slideGrip);
        latN = clamp(latN, -stopLimit * Math.abs(latMs), stopLimit * Math.abs(latMs));
        // Holding still on a slope: the tire carries its share of the downhill pull outright,
        // instead of only resisting once the car has started to creep.
        const holdPull = holding ? w.cornerMassKg * G : 0;
        if (holding) latN += holdPull * V.dot(groundAlong, wr);
        let longN = driveN * w.driveShare;
        let brakeN = brake * spec.mass * G * brakes.decelG * w.brakeShare;
        if (input.handbrake && !w.front) brakeN += (spec.mass * G * brakes.decelG * 0.5) / this.rearCount;
        const resistN = brakeN + tires.rollingResistance * loadN;
        const dir = longMs >= 0 ? 1 : -1;
        if (holding) longN += clamp(holdPull * V.dot(groundAlong, wf) - stopLimit * longMs, -resistN, resistN);
        else longN -= dir * Math.min(resistN, stopLimit * Math.abs(longMs));
        const total = Math.hypot(latN, longN);
        w.slip = gripN > 0 ? total / gripN : 0;
        if (total > gripN && total > 0) { const s = gripN / total; latN *= s; longN *= s; }
        worstSlip = Math.max(worstSlip, w.slip);
        const tireN = V.add(V.mul(wf, longN), V.mul(wr, latN));
        sumLong += V.dot(tireN, forward); sumLat += V.dot(tireN, right);
        const lift = V.dot(V.sub(body.pos, hit.position), up) * rollCenter;
        w.contactWorldLocal = M.tmulV(body.R, V.sub(V.add(hit.position, V.mul(up, lift)), body.pos));
        w.springF = V.mul(groundNormal, Math.max(0, w.springForce - w.transferForce));
        w.tireF = V.mul(V.add(V.mul(wf, longN), V.mul(wr, latN)), toRoblox);
        w.spin += (longMs / MPS / w.radius) * dt;
      }

      this.tireLongN = sumLong; this.tireLatN = sumLat;
      const speedMs = V.len(velocity) * MPS;
      let extra = [0, 0, 0];
      if (speedMs > 0.1) extra = V.sub(extra, V.mul(V.unit(velocity), VM.Drag(spec, speedMs) * toRoblox));
      if (downforceN > 0) extra = V.sub(extra, V.mul(up, (downforceN / (spec.mass * G)) * this.assemblyMass * world.gravity));

      // Slopes: Roblox gravity pulls a car downhill ~5.6x harder (relative to tire grip) than real
      // gravity does. Cancel the excess along the ground plane so hills hold and climb like real ones.
      if (grounded > 0) {
        const along = groundAlong;
        const excess = world.gravity - G / MPS;
        extra = V.add(extra, V.mul(along, this.assemblyMass * excess * (grounded / this.wheels.length)));
      }

      const rec = spec.recovery;
      let stuck = false;
      if (rec.stuckAssist) {
        const trying = Math.abs(input.throttle) > 0.5;
        if (trying && V.len(velocity) * MPS < 0.4 && now >= this.unstickUntil) this.stuckTimer += dt;
        else if (!trying || V.len(velocity) * MPS > 1.5) { this.stuckTimer = 0; if (V.len(velocity) * MPS > 3) this.unstickTries = 0; }
        if (this.stuckTimer >= 1.0) {
          this.stuckTimer = 0; this.unstickTries++;
          if (this.unstickTries > 3) this.recover(input.throttle > 0 ? 3 : -3);
          else { this.unstickUntil = now + 0.45; this.unsticks++; this.events.push({ t: now, what: 'unstick' }); }
        }
        if (now < this.unstickUntil) {
          stuck = true;
          const weight = this.assemblyMass * world.gravity;
          const push = input.throttle >= 0 ? forward : V.mul(forward, -1);
          extra = V.add(extra, V.add([0, weight * 0.6, 0], V.mul(push, spec.mass * G * 0.45 * toRoblox)));
        }
      }
      this.aeroF = extra;

      const upright = up[1];
      if (rec.autoFlip && upright < 0.3 && V.len(velocity) < 4) { this.flipTimer += dt; if (this.flipTimer >= 1.5) this.recover(); }
      else this.flipTimer = 0;

      // Air control. Fully airborne: level the car (spring toward upright + damping). Partly off the
      // ground at speed (cresting a ramp lip, one axle in the air): damp pitch/roll rate only, so
      // Roblox's strong gravity doesn't kick the nose down off every jump.
      const ang = body.w;
      const tilt = [ang[0], 0, ang[2]];
      if ((grounded === 0 || support < AIR_SUPPORT) && rec.airControl > 0) {
        const axis = V.cross(up, [0, 1, 0]);
        const level = V.sub(V.mul(axis, AIR_LEVEL), V.mul(tilt, AIR_DAMP));
        this.stabT = V.mul(level, this.inertiaAir * rec.airControl);
      } else if (grounded < this.wheels.length && rec.airControl > 0 && speedMs > 5) {
        this.stabT = V.mul(tilt, -AIR_DAMP * this.inertiaAir * rec.airControl);
      } else this.stabT = [0, 0, 0];

      this.telemetry = { speedKmh: forwardMs * 3.6, rpm: this.rpm, gear: this.gear, steer: this.steer, grounded, slip: worstSlip, driftAngle, drifting, stuck };
      return this.telemetry;
    }

    // Roblox physics for one 1/240 s substep with the forces held from step().
    physics(h) {
      const b = this.body; if (b.anchored) return;
      const com = b.com;
      let F = [0, -this.world.gravity * b.mass, 0], T = [0, 0, 0];
      const addAt = (f, p) => { F = V.add(F, f); T = V.add(T, V.cross(V.sub(p, com), f)); };
      for (const w of this.wheels) {
        addAt(w.springF, b.toWorld(w.mountLocal));
        addAt(w.tireF, b.toWorld(w.contactWorldLocal || w.contactLocal));
      }
      F = V.add(F, this.aeroF); // ApplyAtCenterOfMass
      T = V.add(T, this.stabT);
      b.v = V.add(b.v, V.mul(F, h / b.mass));
      // angular: dL = T h ; w = I^-1 L (gyroscopic term via L)
      const L = V.add(b.worldI(b.w), V.mul(T, h));
      b.w = b.worldInvI(L);
      // integrate the CoM, then rotate about it
      const newCom = V.add(com, V.mul(b.v, h));
      const wl = V.len(b.w);
      if (wl > 1e-9) { b.q = quatNorm(quatMul(quatFromAxisAngle(b.w, wl * h), b.q)); b.R = M.fromQuat(b.q); }
      b.pos = V.sub(newCom, M.mulV(b.R, b.comLocal));
      if (this.hull) collide(this, h);
    }

    frame(dt, input, substeps = 4) {
      const t = this.step(dt, input);
      for (let i = 0; i < substeps; i++) this.physics(dt / substeps);
      return t;
    }
  }

  function mat3mul(a, b) { return a.map((row) => [0, 1, 2].map((j) => row[0] * b[0][j] + row[1] * b[1][j] + row[2] * b[2][j])); }

  // Sample points on the hull surface (root space).
  function hullSamples(hull) {
    const pts = [];
    const { c, size } = hull.box;
    const nx = 5, ny = 3, nz = 7;
    for (let i = 0; i < nx; i++) for (let j = 0; j < ny; j++) for (let k = 0; k < nz; k++) {
      const onSurface = i === 0 || i === nx - 1 || j === 0 || j === ny - 1 || k === 0 || k === nz - 1;
      if (!onSurface) continue;
      pts.push([c[0] + size[0] * (i / (nx - 1) - 0.5), c[1] + size[1] * (j / (ny - 1) - 0.5), c[2] + size[2] * (k / (nz - 1) - 0.5)]);
    }
    for (const cy of hull.cyl) for (let i = 0; i < nx; i++) for (let a = 0; a < 16; a++) {
      const ang = (a / 16) * Math.PI * 2;
      pts.push([cy.c[0] + cy.width * (i / (nx - 1) - 0.5), cy.c[1] + Math.cos(ang) * cy.radius, cy.c[2] + Math.sin(ang) * cy.radius]);
    }
    return pts;
  }

  // Hull vs world boxes: penetrating sample points get a normal impulse (elasticity 0.05) and
  // Coulomb friction at the hull's friction, plus positional correction.
  function collide(car, h) {
    const b = car.body, world = car.world, mu = car.hull.friction;
    const contacts = [];
    const pts = car.hull.samples.map((l) => b.toWorld(l));
    const com = b.com;
    for (const box of world.boxes) {
      if (box.ignore || box.noCollide) continue;
      const br = V.len(box.h) + 12;
      if (V.len(V.sub(box.c, com)) > br + 20) continue;
      for (const p of pts) {
        const l = M.tmulV(box.R, V.sub(p, box.c));
        const pen = [box.h[0] - Math.abs(l[0]), box.h[1] - Math.abs(l[1]), box.h[2] - Math.abs(l[2])];
        if (pen[0] <= 0 || pen[1] <= 0 || pen[2] <= 0) continue;
        // exit along the axis of least penetration, but prefer the face the point moved through
        let ax = 0; if (pen[1] < pen[ax]) ax = 1; if (pen[2] < pen[ax]) ax = 2;
        const nl = [0, 0, 0]; nl[ax] = l[ax] >= 0 ? 1 : -1;
        contacts.push({ p, n: M.mulV(box.R, nl), depth: pen[ax] });
      }
    }
    if (!contacts.length) return;
    car.hullContacts = (car.hullContacts || 0) + 1;
    for (let it = 0; it < 4; it++) {
      for (const c of contacts) {
        const r = V.sub(c.p, b.com);
        const vp = b.velAt(c.p);
        const vn = V.dot(vp, c.n);
        if (vn >= 0) continue;
        const kn = 1 / b.mass + V.dot(c.n, V.cross(b.worldInvI(V.cross(r, c.n)), r));
        const e = it === 0 ? 0.05 : 0;
        const jn = (-(1 + e) * vn) / kn / contacts.length * 2;
        applyImpulse(b, V.mul(c.n, jn), r);
        const vp2 = b.velAt(c.p);
        const vt = V.sub(vp2, V.mul(c.n, V.dot(vp2, c.n)));
        const vtl = V.len(vt);
        if (vtl > 1e-6) {
          const t = V.mul(vt, -1 / vtl);
          const kt = 1 / b.mass + V.dot(t, V.cross(b.worldInvI(V.cross(r, t)), r));
          const jt = Math.min(vtl / kt, mu * jn);
          applyImpulse(b, V.mul(t, jt), r);
        }
      }
    }
    let shift = [0, 0, 0];
    for (let it = 0; it < 3; it++) for (const c of contacts) {
      const remaining = c.depth - V.dot(shift, c.n) - 0.01;
      if (remaining > 0) shift = V.add(shift, V.mul(c.n, remaining * 0.6));
    }
    b.pos = V.add(b.pos, shift);
  }
  function applyImpulse(b, j, r) { b.v = V.add(b.v, V.mul(j, 1 / b.mass)); b.w = V.add(b.w, b.worldInvI(V.cross(r, j))); }

  return { V, M, VM, World, Car, normalize, carGeometry, clamp, lookAtR };
});
