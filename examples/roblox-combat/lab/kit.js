// Line-by-line JS port of the roblox-combat kit's shooter modules:
//   AimCamera.luau   (first person + over-the-shoulder third person camera)
//   WeaponState.luau (trigger, fire modes, rate, click buffer, ammo, reload, bloom, recoil size)
//   Ballistics.luau  (Spread, Falloff, Step, AimFrom, Obstruction)
//   CameraFx.luau    (trauma shake, recoil spring, FOV punch)
// plus Rig, which drives them like CameraController + WeaponController do in game and records
// every call as a trace. run-tests.cjs replays each trace through the REAL Luau modules
// (skills/roblox-combat/tests/Replay.luau) and fails if any printed number differs, so what you
// see in this lab is what the .luau code does in Studio.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./rbx.js'), require('./config.js'));
  else root.CombatKit = factory(root.Rbx, root.COMBAT_CONFIG);
})(typeof self !== 'undefined' ? self : this, function (Rbx, CombatConfig) {
  'use strict';
  const { Vector3, CFrame, Random, World, noise, clamp, mod } = Rbx;
  const rad = (d) => (d * Math.PI) / 180;
  const deg = (r) => (r * 180) / Math.PI;

  // ================================================================ AimCamera.luau
  const lerp = (a, b, t) => a + (b - a) * t;
  const ease = (current, target, rate, dt) => target + (current - target) * Math.exp(-rate * dt);
  const wrap = (degrees) => mod(degrees + 180, 360) - 180;

  class AimCamera {
    constructor(config, mode) {
      this.Config = config;
      this.Mode = mode || config.StartMode || 'Third';
      this.Yaw = 0; this.Pitch = 0;
      this.Aiming = false; this.AimBlend = 0;
      this.Side = 1; this.SideBlend = 1;
      this.Distance = config.Third.Distance;
      this.Shoulder = config.Third.Shoulder;
      this.FaceTimer = 0;
      this.Focus = Vector3.zero;
      this.CFrame = CFrame.identity;
      this.Fov = config.Third.Fov;
    }
    LookScale() { return this.Aiming ? this.Config.AimSensitivityScale : 1; }
    Look(dx, dy, touch) {
      const config = this.Config;
      const sensitivity = (touch ? config.TouchSensitivity : config.Sensitivity) * this.LookScale();
      this.Yaw = wrap(this.Yaw - dx * sensitivity);
      this.Pitch = clamp(this.Pitch - dy * sensitivity, config.PitchMin, config.PitchMax);
    }
    Stick(x, y, dt) {
      const config = this.Config;
      const magnitude = Math.sqrt(x * x + y * y);
      if (magnitude <= config.GamepadDeadzone) return;
      const strength = clamp((magnitude - config.GamepadDeadzone) / (1 - config.GamepadDeadzone), 0, 1);
      const speed = strength ** config.GamepadCurve * config.GamepadSpeed * this.LookScale() * dt;
      this.Yaw = wrap(this.Yaw - (x / magnitude) * speed);
      this.Pitch = clamp(this.Pitch + (y / magnitude) * speed, config.PitchMin, config.PitchMax);
    }
    SetAiming(aiming) { this.Aiming = aiming; }
    SwapShoulder() { this.Side = -this.Side; }
    SetMode(mode) {
      if (mode === this.Mode) return;
      this.Mode = mode;
      if (mode === 'Third') { this.Distance = 0; this.Shoulder = 0; }
    }
    ToggleMode() { this.SetMode(this.Mode === 'Third' ? 'First' : 'Third'); }
    Fired() { this.FaceTimer = this.Config.FaceAimSeconds; }
    Rotation() { return CFrame.fromEulerAnglesYXZ(rad(this.Pitch), rad(this.Yaw), 0); }
    AimSkip() { const look = this.CFrame.LookVector; return Math.max(0, this.Focus.sub(this.CFrame.Position).Dot(look)); }
    Update(dt, rootPosition, cast) {
      const config = this.Config;
      this.AimBlend = ease(this.AimBlend, this.Aiming ? 1 : 0, config.AimBlendSpeed, dt);
      this.SideBlend = ease(this.SideBlend, this.Side, config.ShoulderSwapSpeed, dt);
      this.FaceTimer = Math.max(0, this.FaceTimer - dt);
      const rotation = this.Rotation();
      const a = this.AimBlend;

      if (this.Mode === 'First') {
        const first = config.First;
        this.Focus = rootPosition.add(new Vector3(0, first.Height, 0));
        this.CFrame = CFrame.new(this.Focus).mul(rotation);
        this.Fov = lerp(first.Fov, first.AimFov, a);
        return [this.CFrame, this.Fov];
      }

      const hip = config.Third, aim = config.ThirdAim;
      const height = lerp(hip.Height, aim.Height, a);
      const wantDistance = lerp(hip.Distance, aim.Distance, a);
      const wantShoulder = lerp(hip.Shoulder, aim.Shoulder, a) * this.SideBlend;
      const radius = config.CollisionRadius;
      const pivot = rootPosition.add(new Vector3(0, height, 0));
      this.Focus = pivot;

      const sideSign = wantShoulder < 0 ? -1 : 1;
      let sideLength = Math.abs(wantShoulder);
      if (cast && sideLength > 1e-3) {
        const hit = cast(pivot, rotation.RightVector.mul(sideSign * sideLength), radius);
        if (hit != null) sideLength = Math.min(sideLength, hit);
      }
      this.Shoulder = sideSign * sideLength;
      const shoulderPoint = pivot.add(rotation.RightVector.mul(this.Shoulder));

      let allowed = wantDistance;
      if (cast) {
        const hit = cast(shoulderPoint, rotation.LookVector.mul(-wantDistance), radius);
        if (hit != null) allowed = Math.min(allowed, hit);
      }
      if (allowed < this.Distance) this.Distance = allowed;
      else this.Distance = Math.min(allowed, this.Distance + config.PushOutSpeed * dt);

      this.CFrame = CFrame.new(shoulderPoint.sub(rotation.LookVector.mul(this.Distance))).mul(rotation);
      this.Fov = lerp(hip.Fov, aim.Fov, a);
      return [this.CFrame, this.Fov];
    }
    CharacterYaw(currentYaw, dt) {
      if (this.Mode === 'First') return this.Yaw;
      if (!this.Aiming && this.FaceTimer <= 0) return null;
      const delta = wrap(this.Yaw - currentYaw);
      const maxStep = this.Config.TurnSpeed * dt;
      return wrap(currentYaw + clamp(delta, -maxStep, maxStep));
    }
    HideCharacter() { return this.Mode === 'First' || this.CFrame.Position.sub(this.Focus).Magnitude < 1.2; }
  }

  // ================================================================ WeaponState.luau
  const MOVE_SPREAD = 1, BURST = 3;
  class WeaponState {
    constructor(stats, buffer) {
      this.Stats = stats; this.Buffer = buffer || 0;
      this.Magazine = stats.Magazine; this.Reserve = stats.Reserve;
      this.ReloadingUntil = 0; this.NextShot = 0;
      this.TriggerDown = false; this.PressedAt = -Infinity; this.ShotsThisPress = 0; this.BurstLeft = 0;
      this.Bloom = 0; this.Aiming = false;
      this.LastSpread = 0; this.LastRecoilUp = 0; this.LastRecoilSide = 0;
    }
    Interval() { return 60 / this.Stats.Rpm; }
    Press(now) {
      this.TriggerDown = true; this.PressedAt = now; this.ShotsThisPress = 0;
      if (this.Stats.Mode === 'Burst' && this.BurstLeft === 0) this.BurstLeft = BURST;
    }
    Release() { this.TriggerDown = false; }
    SetAiming(aiming) { this.Aiming = aiming; }
    IsReloading() { return this.ReloadingUntil > 0; }
    CanReload() { return this.ReloadingUntil === 0 && this.Magazine < this.Stats.Magazine && this.Reserve > 0; }
    StartReload(now) {
      if (!this.CanReload()) return false;
      this.ReloadingUntil = now + this.Stats.ReloadSeconds; this.BurstLeft = 0;
      return true;
    }
    CancelReload() { this.ReloadingUntil = 0; }
    Unequip() { this.TriggerDown = false; this.BurstLeft = 0; this.PressedAt = -Infinity; this.Aiming = false; this.CancelReload(); }
    SetAmmo(magazine, reserve) { this.Magazine = magazine; this.Reserve = reserve; }
    Spread(moving) { const s = this.Stats; return (this.Aiming ? s.SpreadAds : s.SpreadHip) + this.Bloom + (moving ? MOVE_SPREAD : 0); }
    wantsShot(now) {
      const mode = this.Stats.Mode;
      if (mode === 'Auto') return this.TriggerDown;
      if (mode === 'Burst') return this.BurstLeft > 0;
      return this.ShotsThisPress === 0 && (this.TriggerDown || now - this.PressedAt <= this.Buffer);
    }
    Step(now, dt, moving) {
      const stats = this.Stats;
      if (now > this.NextShot) this.Bloom = Math.max(0, this.Bloom - stats.BloomRecovery * dt);
      if (this.ReloadingUntil > 0) {
        if (now < this.ReloadingUntil) return null;
        const moved = Math.min(stats.Magazine - this.Magazine, this.Reserve);
        this.Magazine += moved; this.Reserve -= moved; this.ReloadingUntil = 0;
        return 'Reloaded';
      }
      if (!this.wantsShot(now) || now < this.NextShot) return null;
      if (this.Magazine <= 0) {
        this.TriggerDown = false; this.ShotsThisPress = 1; this.BurstLeft = 0; this.PressedAt = -Infinity;
        return 'Empty';
      }
      const interval = this.Interval();
      this.NextShot = now - this.NextShot <= dt ? this.NextShot + interval : now + interval;
      this.Magazine -= 1;
      const adsFactor = this.Aiming ? 0.7 : 1;
      const firstShot = this.ShotsThisPress === 0 ? 0.7 : 1;
      this.LastSpread = this.Spread(moving);
      this.LastRecoilUp = stats.RecoilUp * adsFactor * firstShot;
      this.LastRecoilSide = stats.RecoilSide * adsFactor;
      this.ShotsThisPress += 1;
      if (this.BurstLeft > 0) this.BurstLeft -= 1;
      this.Bloom = Math.min(stats.BloomMax, this.Bloom + stats.BloomPerShot);
      return 'Fire';
    }
    static ServerFire(state, stats, now, tolerance) {
      const interval = 60 / stats.Rpm;
      if (now < state.reloadingUntil || state.magazine <= 0) return false;
      if (now < state.nextShot - interval * 0.25 - tolerance) return false;
      state.nextShot = Math.max(state.nextShot, now) + interval;
      state.magazine -= 1;
      return true;
    }
  }

  // ================================================================ Ballistics.luau
  const Ballistics = {
    Spread(direction, degrees, rng) {
      if (degrees <= 0) return direction.Unit;
      const radius = Math.tan(rad(degrees)) * Math.sqrt(rng.NextNumber());
      const angle = rng.NextNumber() * 2 * Math.PI;
      const up = Math.abs(direction.Unit.Y) > 0.99 ? Vector3.xAxis : Vector3.yAxis;
      const frame = CFrame.lookAt(Vector3.zero, direction, up);
      const offset = frame.RightVector.mul(Math.cos(angle) * radius).add(frame.UpVector.mul(Math.sin(angle) * radius));
      return direction.Unit.add(offset).Unit;
    },
    Falloff(distance, stats) {
      if (distance <= stats.FalloffStart || stats.FalloffEnd <= stats.FalloffStart) return 1;
      const t = clamp((distance - stats.FalloffStart) / (stats.FalloffEnd - stats.FalloffStart), 0, 1);
      return 1 + (stats.FalloffMin - 1) * t;
    },
    // raycast(origin, direction) -> RaycastResult-like | null
    Step(position, velocity, gravity, dt, raycast) {
      const acceleration = new Vector3(0, -gravity, 0);
      const nextPosition = position.add(velocity.mul(dt)).add(acceleration.mul(0.5 * dt * dt));
      const nextVelocity = velocity.add(acceleration.mul(dt));
      const result = raycast(position, nextPosition.sub(position));
      if (result) return [result.Position, nextVelocity, result];
      return [nextPosition, nextVelocity, null];
    },
    AimFrom(cameraCFrame, range, skip, cast) {
      const look = cameraCFrame.LookVector;
      const origin = cameraCFrame.Position.add(look.mul(skip));
      const hit = cast(origin, look.mul(range - skip));
      return hit || origin.add(look.mul(range - skip));
    },
    Obstruction(muzzle, aimPoint, cast) {
      const toAim = aimPoint.sub(muzzle);
      if (toAim.Magnitude < 1e-3) return null;
      const hit = cast(muzzle, toAim);
      if (hit && aimPoint.sub(hit).Magnitude > 0.5) return hit;
      return null;
    },
    IsHead(part) { return part.Name === 'Head'; },
  };

  // ================================================================ CameraFx.luau (per instance)
  class CameraFx {
    constructor(clock) {
      this.clock = clock; // () => seconds, os.clock() in game
      this.trauma = 0; this.shakeScale = 1; this.recoilPitch = 0; this.recoilYaw = 0; this.recoilStiffness = 10;
      this.fovPunch = 0; this.baseFov = null; this.targetFov = null; this.bound = false; this.fovOwned = false; this.DefaultFov = null;
    }
    // camera = { CFrame, FieldOfView }; mutates it like the bound render step does.
    step(camera, dt) {
      if (!this.bound) return;
      const MAX_ANGLE = 3, MAX_OFFSET = 0.25, FREQUENCY = 18, TRAUMA_DECAY = 1.6, FOV_PUNCH_DECAY = 14, FOV_EASE = 12;
      this.baseFov = this.baseFov ?? camera.FieldOfView;
      this.targetFov = this.targetFov ?? this.baseFov;
      let offset = CFrame.identity;
      if (this.trauma > 0) {
        const amount = this.trauma * this.trauma;
        const t = this.clock() * FREQUENCY;
        const pitch = noise(t, 1.7) * MAX_ANGLE * amount;
        const yaw = noise(t, 3.1) * MAX_ANGLE * amount;
        const roll = noise(t, 5.3) * MAX_ANGLE * amount * 0.5;
        const x = noise(t, 7.9) * MAX_OFFSET * amount;
        const y = noise(t, 9.2) * MAX_OFFSET * amount;
        offset = CFrame.new(x, y, 0).mul(CFrame.Angles(rad(pitch), rad(yaw), rad(roll)));
        this.trauma = Math.max(0, this.trauma - TRAUMA_DECAY * dt);
      }
      if (this.recoilPitch !== 0 || this.recoilYaw !== 0) {
        offset = CFrame.Angles(rad(this.recoilPitch), rad(this.recoilYaw), 0).mul(offset);
        const keep = Math.exp(-this.recoilStiffness * dt);
        this.recoilPitch *= keep; this.recoilYaw *= keep;
        if (Math.abs(this.recoilPitch) < 0.01 && Math.abs(this.recoilYaw) < 0.01) { this.recoilPitch = 0; this.recoilYaw = 0; }
      }
      if (!offset.equals(CFrame.identity)) camera.CFrame = camera.CFrame.mul(offset);
      this.fovPunch *= Math.exp(-FOV_PUNCH_DECAY * dt);
      if (this.fovOwned) { camera.FieldOfView -= this.fovPunch; return; }
      let base = this.baseFov;
      base += (this.targetFov - base) * Math.min(1, dt * FOV_EASE);
      this.baseFov = base;
      camera.FieldOfView = base - this.fovPunch;
    }
    AddTrauma(amount) { if (amount <= 0 || this.shakeScale <= 0) return; this.trauma = Math.min(1, this.trauma + amount * this.shakeScale); this.bound = true; }
    Recoil(up, side, stiffness) { this.recoilPitch += up; this.recoilYaw += side; this.recoilStiffness = stiffness; this.bound = true; }
    FovPunch(degrees) { if (degrees <= 0) return; this.fovPunch = Math.max(this.fovPunch, degrees * Math.max(this.shakeScale, 0.3)); this.bound = true; }
    SetFovOwned(owned) { this.fovOwned = owned; this.bound = true; }
    SetShakeScale(scale) { this.shakeScale = clamp(scale, 0, 2); }
  }

  // ================================================================ Rig: the game-side glue + trace
  // Every method appends a trace command (the language Replay.luau reads) and, for queries, the
  // exact line Replay.luau prints, so the two can be diffed.
  const n = (x) => { if (Number.isNaN(x)) return 'nan'; const s = x.toFixed(6); return s === '-0.000000' ? '0.000000' : s; };
  const v = (p) => `${n(p.X)} ${n(p.Y)} ${n(p.Z)}`;
  const cloneStats = (s) => ({ ...s });

  class Rig {
    constructor(id) {
      this.world = new World();
      this.player = { Name: 'Player' };
      this.models = { Player: this.player };
      this.cam = null; this.gun = null; this.rng = new Random(1); this.sv = {}; this.fx = null; this.clockNow = 0;
      this.camera = { CFrame: CFrame.identity, FieldOfView: 70 };
      this.trace = []; this.out = [];
      this.cmd(`begin ${id}`); this.emit(`## ${id}`);
    }
    cmd(line) { this.trace.push(line); }
    emit(line) { this.out.push(line); }
    exclude() { return [this.player]; }
    rayCast = (origin, direction) => { const r = this.world.Raycast(origin, direction, this.exclude()); return r ? r.Position : null; };
    // camera casts ignore CanCollide-off parts (RespectCanCollide): the "NoCollide" model here
    sphereCast = (origin, direction, radius) => {
      const ex = this.models.NoCollide ? [this.player, this.models.NoCollide] : this.exclude();
      const r = this.world.Spherecast(origin, radius, direction, ex); return r ? r.Distance : null;
    };

    box(name, center, size, modelName, color) {
      this.cmd(`box ${name} ${center.join(' ')} ${size.join(' ')}${modelName ? ' ' + modelName : ''}`);
      let model = null;
      if (modelName) { model = this.models[modelName] || { Name: modelName }; this.models[modelName] = model; }
      return this.world.Box(name, new Vector3(...center), new Vector3(...size), model, color);
    }
    camera3(mode) { this.cmd(`cam ${mode}`); this.cam = new AimCamera(CombatConfig.Camera, mode); return this.cam; }
    look(dx, dy, touch = false) { this.cmd(`look ${dx} ${dy} ${touch ? 1 : 0}`); this.cam.Look(dx, dy, touch); }
    stick(x, y, dt) { this.cmd(`stick ${x} ${y} ${dt}`); this.cam.Stick(x, y, dt); }
    camAim(on) { this.cmd(`caim ${on ? 1 : 0}`); this.cam.SetAiming(on); }
    swap() { this.cmd('swap'); this.cam.SwapShoulder(); }
    mode(m) { this.cmd(`mode ${m}`); this.cam.SetMode(m); }
    toggle() { this.cmd('toggle'); this.cam.ToggleMode(); }
    fired() { this.cmd('fired'); this.cam.Fired(); }
    setYaw(yaw, pitch) { this.cmd(`setyaw ${yaw} ${pitch}`); this.cam.Yaw = yaw; this.cam.Pitch = pitch; }
    update(dt, rootPos) {
      this.cmd(`upd ${dt} ${rootPos.join(' ')}`);
      const [c, fov] = this.cam.Update(dt, new Vector3(...rootPos), this.sphereCast);
      const k = this.cam;
      this.emit(`cam ${v(c.Position)} ${v(c.LookVector)} ${v(c.RightVector)} ${n(fov)} ${n(k.Distance)} ${n(k.Shoulder)} ${n(k.Yaw)} ${n(k.Pitch)} ${n(k.AimBlend)}`);
      return [c, fov];
    }
    charYaw(cur, dt) { this.cmd(`cyaw ${cur} ${dt}`); const y = this.cam.CharacterYaw(cur, dt); this.emit(y === null ? 'cyaw nil' : `cyaw ${n(y)}`); return y; }
    skip() { this.cmd('skip'); const s = this.cam.AimSkip(); this.emit(`skip ${n(s)}`); return s; }
    hide() { this.cmd('hide'); const h = this.cam.HideCharacter(); this.emit(`hide ${h ? 1 : 0}`); return h; }

    equip(name) { this.cmd(`gun ${name}`); this.gun = new WeaponState(cloneStats(CombatConfig.Weapons[name]), CombatConfig.FireBuffer); return this.gun; }
    gunSet(key, value) {
      this.cmd(`gunset ${key} ${value}`); this.gun.Stats[key] = value;
      if (key === 'Magazine') this.gun.Magazine = value; else if (key === 'Reserve') this.gun.Reserve = value;
    }
    press(t) { this.cmd(`press ${t}`); this.gun.Press(t); }
    release() { this.cmd('release'); this.gun.Release(); }
    gunAim(on) { this.cmd(`gaim ${on ? 1 : 0}`); this.gun.SetAiming(on); }
    unequip() { this.cmd('unequip'); this.gun.Unequip(); }
    setAmmo(m, r) { this.cmd(`setammo ${m} ${r}`); this.gun.SetAmmo(m, r); }
    reload(t) { this.cmd(`reload ${t}`); const ok = this.gun.StartReload(t); this.emit(`reload ${ok ? 1 : 0}`); return ok; }
    step(t, dt, moving = false) {
      this.cmd(`step ${t} ${dt} ${moving ? 1 : 0}`);
      const g = this.gun; const ev = g.Step(t, dt, moving);
      this.emit(`step ${ev || '-'} ${g.Magazine} ${g.Reserve} ${n(g.Bloom)} ${n(g.LastSpread)} ${n(g.LastRecoilUp)} ${n(g.LastRecoilSide)} ${n(g.Spread(moving))}`);
      return ev;
    }
    aim(range, noSkip = false) {
      this.cmd(`${noSkip ? 'aim0' : 'aim'} ${range}`);
      const p = Ballistics.AimFrom(this.cam.CFrame, range, noSkip ? 0 : this.cam.AimSkip(), this.rayCast);
      this.emit(`aim ${v(p)}`); return p;
    }
    obstruction(muzzle, aimPoint) {
      this.cmd(`obst ${v(muzzle)} ${v(aimPoint)}`);
      // the trace carries 6-decimal numbers; use the same rounded inputs here
      const m = new Vector3(+muzzle.X.toFixed(6), +muzzle.Y.toFixed(6), +muzzle.Z.toFixed(6));
      const a = new Vector3(+aimPoint.X.toFixed(6), +aimPoint.Y.toFixed(6), +aimPoint.Z.toFixed(6));
      const hit = Ballistics.Obstruction(m, a, this.rayCast);
      this.emit(hit ? `obst ${v(hit)}` : 'obst nil'); return hit;
    }
    seed(s) { this.cmd(`rng ${s}`); this.rng = new Random(s); }
    spread(dir, degrees) {
      this.cmd(`spread ${v(dir)} ${degrees}`);
      const d = Ballistics.Spread(new Vector3(+dir.X.toFixed(6), +dir.Y.toFixed(6), +dir.Z.toFixed(6)), degrees, this.rng);
      this.emit(`spread ${v(d)}`); return d;
    }
    falloff(d, name) { this.cmd(`falloff ${d} ${name}`); const f = Ballistics.Falloff(d, CombatConfig.Weapons[name]); this.emit(`falloff ${n(f)}`); return f; }
    server(name, now, tol) {
      this.cmd(`sv ${name} ${now} ${tol}`);
      const state = this.sv[name] || (this.sv[name] = { magazine: 1e9, reserve: 0, reloadingUntil: 0, nextShot: 0 });
      const ok = WeaponState.ServerFire(state, CombatConfig.Weapons[name], now, tol);
      this.emit(`sv ${ok ? 1 : 0} ${n(state.nextShot)}`); return ok;
    }
    serverReset() { this.cmd('svreset'); this.sv = {}; }
    projectile(pos, vel, g, dt) {
      const P = (a) => new Vector3(+a.X.toFixed(6), +a.Y.toFixed(6), +a.Z.toFixed(6));
      this.cmd(`proj ${v(pos)} ${v(vel)} ${g} ${dt}`);
      const [p, nv, hit] = Ballistics.Step(P(pos), P(vel), g, dt, (o, d) => this.world.Raycast(o, d, this.exclude()));
      this.emit(`proj ${v(p)} ${v(nv)} ${hit ? hit.Instance.Name : '-'}`);
      return [p, nv, hit];
    }
    ray(origin, dir) {
      const P = (a) => new Vector3(+a.X.toFixed(6), +a.Y.toFixed(6), +a.Z.toFixed(6));
      this.cmd(`ray ${v(origin)} ${v(dir)}`);
      const r = this.world.Raycast(P(origin), P(dir), this.exclude());
      this.emit(r ? `ray ${v(r.Position)} ${r.Instance.Name}` : 'ray nil'); return r;
    }
    setClock(t) { this.cmd(`clock ${t}`); this.clockNow = t; }
    cameraFx() { if (!this.fx) this.fx = new CameraFx(() => this.clockNow); return this.fx; }
    fxRecoil(up, side, stiff) { this.cmd(`fx ${up} ${side} ${stiff}`); this.cameraFx().Recoil(up, side, stiff); }
    fxTrauma(a) { this.cmd(`fxtrauma ${a}`); this.cameraFx().AddTrauma(a); }
    fxPunch(d) { this.cmd(`fxpunch ${d}`); this.cameraFx().FovPunch(d); }
    fxOwned(on) { this.cmd(`fxowned ${on ? 1 : 0}`); this.cameraFx().SetFovOwned(on); }
    fxFrame(dt) {
      this.cmd(`fxframe ${dt}`);
      const fx = this.cameraFx();
      this.camera.CFrame = this.cam.CFrame; this.camera.FieldOfView = this.cam.Fov;
      fx.step(this.camera, dt);
      this.emit(`fx ${v(this.camera.CFrame.Position)} ${v(this.camera.CFrame.LookVector)} ${n(this.camera.FieldOfView)}`);
      return this.camera;
    }
    noise(x, y, z) { this.cmd(`noise ${x} ${y} ${z}`); const r = noise(x, y, z); this.emit(`noise ${n(r)}`); return r; }
  }

  return { AimCamera, WeaponState, Ballistics, CameraFx, Rig, CombatConfig, rad, deg, wrap };
});
