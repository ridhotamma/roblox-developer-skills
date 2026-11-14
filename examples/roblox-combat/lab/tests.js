// Shooter scenarios for the combat lab: first person, over-the-shoulder third person (RE4 /
// TLOU / GTA style), every input path, the gun rules and the server's checks. Each test drives
// the ported kit through a Rig (which records a trace for the Luau parity check), records frames
// for the replay viewer, and states what it measured against what it expects.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./kit.js'), require('./rbx.js'));
  else root.CombatTests = factory(root.CombatKit, root.Rbx);
})(typeof self !== 'undefined' ? self : this, function (Kit, Rbx) {
  'use strict';
  const { Rig, CombatConfig, rad, wrap } = Kit;
  const { Vector3, CFrame, World, Random } = Rbx;
  const CAM = CombatConfig.Camera;
  const DT = 1 / 60;
  const f = (x, d = 2) => (x === null || x === undefined || Number.isNaN(x) ? '—' : Number(x).toFixed(d));
  const near = (a, b, tol) => Math.abs(a - b) <= tol;

  // ------------------------------------------------------------------ scene helpers
  // Root = HumanoidRootPart centre (3 studs above the feet, like an R15 rig).
  function arena(rig, size = 300) { rig.box('Floor', [0, -0.5, 0], [size, 1, size], null, 0x3b4252); }
  function player(rig, rootPos) {
    const [x, y, z] = rootPos;
    rig.box('PlayerLegs', [x, y - 2, z], [2, 2, 1], 'Player', 0x5e81ac);
    rig.box('PlayerTorso', [x, y, z], [2, 2, 1], 'Player', 0x81a1c1);
    rig.box('PlayerHead', [x, y + 1.6, z], [1.2, 1.2, 1.2], 'Player', 0xeceff4);
  }
  // A target dummy standing at `feet`.
  function dummy(rig, model, feet) {
    const [x, y, z] = feet;
    rig.box('Legs', [x, y + 1, z], [2, 2, 1], model, 0xbf616a);
    rig.box('Torso', [x, y + 3, z], [2, 2, 1], model, 0xd08770);
    rig.box('Head', [x, y + 4.6, z], [1.2, 1.2, 1.2], model, 0xebcb8b);
  }
  // The gun's muzzle: right hand, chest height, in front, turned with the character.
  function muzzle(rootPos, yawDeg) {
    const R = CFrame.fromEulerAnglesYXZ(0, rad(yawDeg), 0);
    return new Vector3(...rootPos).add(R.mul(new Vector3(1, 0.5, -1.6)));
  }
  const insideAny = (world, p, filter, grow = 0) => world.boxes.some((b) => filter(b) &&
    p.X > b.Min.X - grow && p.X < b.Max.X + grow && p.Y > b.Min.Y - grow && p.Y < b.Max.Y + grow && p.Z > b.Min.Z - grow && p.Z < b.Max.Z + grow);
  const isPlayerBox = (b) => b.Model && b.Model.Name === 'Player';

  // Frames for the replay viewer.
  function snap(frames, t, rig, rootPos, charYaw, extra) {
    const c = rig.cam;
    frames.push({ t: +t.toFixed(3), cam: c.CFrame.toMatrix4Array().map((x) => +x.toFixed(4)), fov: +c.Fov.toFixed(2), root: rootPos.map((x) => +x.toFixed(3)), yaw: +(charYaw ?? c.Yaw).toFixed(2),
      mode: c.Mode, hide: c.HideCharacter(), aim: +c.AimBlend.toFixed(2), ...(extra || {}) });
  }
  const P = (v) => [+v.X.toFixed(3), +v.Y.toFixed(3), +v.Z.toFixed(3)];

  // ------------------------------------------------------------------ tests
  const TESTS = [];
  const test = (id, title, group, fn) => TESTS.push({ id, title, group, fn });

  // ================================================================ first person
  test('fp-eye', 'Camera at the eyes; the bullet lands on the crosshair', 'First person', (rig) => {
    arena(rig); const root = [0, 3, 0]; player(rig, root);
    const frames = []; const errs = [];
    const dists = [10, 50, 150];
    dists.forEach((d, i) => dummy(rig, 'Dummy' + i, [i * 6 - 6, 0, -d]));
    rig.camera3('First');
    let hidden = true, eyeErr = 0, sameHit = true;
    dists.forEach((d, i) => {
      const head = new Vector3(i * 6 - 6, 4.6, -d);
      const eye = new Vector3(0, 3 + CAM.First.Height, 0);
      const to = head.sub(eye);
      rig.setYaw(+(Math.atan2(-to.X, -to.Z) * 180 / Math.PI).toFixed(4), +(Math.asin(to.Unit.Y) * 180 / Math.PI).toFixed(4));
      const [cf] = rig.update(DT, root);
      eyeErr = Math.max(eyeErr, cf.Position.sub(eye).Magnitude);
      hidden = hidden && rig.hide();
      const aim = rig.aim(400);
      const m = muzzle(root, rig.cam.Yaw);
      const shot = rig.ray(m, aim.sub(m).Unit.mul(400));
      const cross = rig.world.Raycast(cf.Position, cf.LookVector.mul(400), [rig.player]);
      errs.push(shot ? shot.Position.sub(aim).Magnitude : 99);
      sameHit = sameHit && shot && cross && shot.Instance === cross.Instance;
      snap(frames, i * 0.5, rig, root, rig.cam.Yaw, { shots: [{ a: P(m), b: P(shot ? shot.Position : aim), hit: shot ? shot.Instance.Name : '' }] });
      for (let k = 1; k < 30; k++) snap(frames, i * 0.5 + k * DT, rig, root, rig.cam.Yaw);
    });
    const worst = Math.max(...errs);
    return { pass: eyeErr < 1e-6 && worst < 0.05 && sameHit && hidden, measured: `eye offset ${f(eyeErr, 3)} · bullet vs crosshair ${errs.map((e) => f(e, 3)).join(' / ')} studs at ${dists.join('/')} · ${sameHit ? 'same part' : 'DIFFERENT PART'} · body ${hidden ? 'hidden' : 'VISIBLE'}`, expected: 'camera at root+1.5, < 0.05 studs, same part, own body hidden', frames };
  });

  test('fp-look', 'Mouse look: 0.22°/px, pitch clamps at ±80°, yaw wraps', 'First person', (rig) => {
    arena(rig); const root = [0, 3, 0]; player(rig, root); rig.camera3('First');
    const frames = []; let t = 0;
    const run = (dx, dy, n) => { for (let i = 0; i < n; i++) { rig.look(dx, dy); rig.update(DT, root); snap(frames, (t += DT), rig, root); } };
    run(10, 0, 10); const yaw100 = rig.cam.Yaw; // 100 px right
    run(0, -60, 20); const top = rig.cam.Pitch; // way up
    run(0, 120, 20); const bottom = rig.cam.Pitch; // way down
    run(0, -40, 9); // back to ~level
    run(200, 0, 12); const yaw = rig.cam.Yaw; // spin far right
    const ok = near(yaw100, -22, 1e-9) && top === CAM.PitchMax && bottom === CAM.PitchMin && yaw >= -180 && yaw < 180;
    return { pass: ok, measured: `100 px → ${f(yaw100, 2)}° · up ${f(top, 1)}° · down ${f(bottom, 1)}° · after 2,500 px yaw ${f(yaw, 1)}°`, expected: '−22° (right), +80°, −80°, yaw in [−180, 180)', frames };
  });

  test('fp-ads', 'Aim down sights: FOV 80 → 55 in ~0.2 s, look slows to 60%', 'First person', (rig) => {
    arena(rig); const root = [0, 3, 0]; player(rig, root); dummy(rig, 'D', [0, 0, -40]); rig.camera3('First');
    const frames = []; let t95 = null;
    rig.update(DT, root); const fovHip = rig.cam.Fov;
    rig.camAim(true);
    for (let i = 1; i <= 30; i++) { rig.update(DT, root); snap(frames, i * DT, rig, root); if (t95 === null && rig.cam.AimBlend >= 0.95) t95 = i * DT; }
    const fovAim = rig.cam.Fov;
    const y0 = rig.cam.Yaw; rig.look(100, 0); const turned = y0 - rig.cam.Yaw;
    rig.camAim(false);
    for (let i = 1; i <= 30; i++) { rig.update(DT, root); snap(frames, 0.5 + i * DT, rig, root); }
    const back = rig.cam.Fov;
    const ok = near(fovHip, 80, 0.01) && near(fovAim, 55, 0.05) && t95 !== null && t95 <= 0.25 && near(turned, 22 * 0.6, 1e-9) && near(back, 80, 0.05);
    return { pass: ok, measured: `FOV ${f(fovHip, 1)} → ${f(fovAim, 1)} (95% at ${f(t95, 2)} s) → ${f(back, 1)} · 100 px turns ${f(turned, 1)}° aimed`, expected: '80 → 55 within 0.25 s and back, 13.2° (60% of 22°)', frames };
  });

  test('fp-face', 'The body always faces the crosshair (strafe)', 'First person', (rig) => {
    arena(rig); const root = [0, 3, 0]; player(rig, root); rig.camera3('First');
    const frames = []; let worst = 0, charYaw = 0;
    for (let i = 0; i < 60; i++) {
      rig.look(i < 30 ? 25 : -40, 0); rig.update(DT, root);
      const y = rig.charYaw(charYaw, DT); charYaw = y; worst = Math.max(worst, Math.abs(wrap(y - rig.cam.Yaw)));
      snap(frames, i * DT, rig, root, charYaw);
    }
    return { pass: worst < 1e-9, measured: `max body/aim yaw gap ${f(worst, 4)}°`, expected: '0° (locked to the camera)', frames };
  });

  test('fp-toggle', 'V toggles first ↔ third; third person eases out, no pop', 'First person', (rig) => {
    arena(rig); const root = [0, 3, 0]; player(rig, root); rig.camera3('Third');
    const frames = []; let t = 0;
    for (let i = 0; i < 20; i++) { rig.update(DT, root); snap(frames, (t += DT), rig, root); }
    rig.toggle(); rig.update(DT, root); snap(frames, (t += DT), rig, root);
    const firstOk = rig.cam.Mode === 'First' && rig.hide();
    for (let i = 0; i < 20; i++) { rig.update(DT, root); snap(frames, (t += DT), rig, root); }
    rig.toggle(); let prev = rig.cam.CFrame.Position, maxJump = 0, tOut = null;
    for (let i = 1; i <= 60; i++) {
      const [cf] = rig.update(DT, root); snap(frames, (t += DT), rig, root);
      maxJump = Math.max(maxJump, cf.Position.sub(prev).Magnitude); prev = cf.Position;
      if (tOut === null && rig.cam.Distance >= CAM.Third.Distance - 1e-6) tOut = i * DT;
    }
    const limit = CAM.PushOutSpeed * DT + CAM.Third.Shoulder; // first frame also slides the shoulder in
    const ok = firstOk && rig.cam.Mode === 'Third' && maxJump <= limit && tOut !== null && tOut < 0.6;
    return { pass: ok, measured: `first person ${firstOk ? 'ok, body hidden' : 'WRONG'} · back to third: out in ${f(tOut, 2)} s, biggest step ${f(maxJump, 2)} studs/frame`, expected: `≤ ${f(limit, 2)} studs per frame, settled < 0.6 s`, frames };
  });

  // ================================================================ third person, over the shoulder
  test('tp-offset', 'Character sits left of the crosshair and never blocks it', 'Over the shoulder', (rig) => {
    arena(rig); const root = [0, 3, 0]; player(rig, root); dummy(rig, 'D', [0, 0, -30]); rig.camera3('Third');
    const frames = []; let blocked = 0, rays = 0, minLeft = Infinity, maxLeft = -Infinity, t = 0;
    for (const pitch of [-60, -30, 0, 30, 60]) for (const yaw of [-90, -30, 0, 45, 135]) {
      rig.setYaw(yaw, pitch);
      for (let k = 0; k < 4; k++) rig.update(DT, root);
      const cf = rig.cam.CFrame;
      // crosshair ray from the camera: does it pass through any of the player's own parts?
      rays++;
      if (rig.world.boxes.some((b) => isPlayerBox(b) && World.sweep(cf.Position, cf.LookVector.mul(500), b.Min, b.Max, 0))) blocked++;
      const local = cf.PointToObjectSpace(new Vector3(...root).add(new Vector3(0, 0.5, 0)));
      const angle = Math.atan2(local.X, -local.Z) * 180 / Math.PI; // horizontal screen angle of the chest
      minLeft = Math.min(minLeft, angle); maxLeft = Math.max(maxLeft, angle);
      snap(frames, (t += 0.25), rig, root);
      for (let k = 1; k < 15; k++) snap(frames, t + k * DT, rig, root);
      t += 15 * DT;
    }
    const ok = blocked === 0 && maxLeft < -5;
    return { pass: ok, measured: `${rays - blocked}/${rays} crosshair rays clear of the body · chest at ${f(minLeft, 1)}° … ${f(maxLeft, 1)}° from centre`, expected: 'all clear, chest left of centre (< −5°)', frames };
  });

  test('tp-aim', 'Aim zooms to the shoulder: 8 → 4 studs, FOV 70 → 50, slower look', 'Over the shoulder', (rig) => {
    arena(rig); const root = [0, 3, 0]; player(rig, root); dummy(rig, 'D', [0, 0, -30]); rig.camera3('Third');
    const frames = []; let t = 0, t95 = null;
    for (let i = 0; i < 30; i++) { rig.update(DT, root); snap(frames, (t += DT), rig, root); }
    const hip = { d: rig.cam.Distance, s: rig.cam.Shoulder, fov: rig.cam.Fov };
    rig.camAim(true);
    for (let i = 1; i <= 40; i++) { rig.update(DT, root); snap(frames, (t += DT), rig, root, null, { aimOn: true }); if (t95 === null && rig.cam.AimBlend > 0.95) t95 = i * DT; }
    const aim = { d: rig.cam.Distance, s: rig.cam.Shoulder, fov: rig.cam.Fov };
    const y0 = rig.cam.Yaw; rig.look(100, 0); const turned = y0 - rig.cam.Yaw; rig.look(-100, 0);
    rig.camAim(false);
    for (let i = 0; i < 40; i++) { rig.update(DT, root); snap(frames, (t += DT), rig, root); }
    const ok = near(hip.d, 8, 1e-3) && near(aim.d, 4, 0.05) && near(aim.fov, 50, 0.2) && near(aim.s, 1.9, 0.02) && t95 <= 0.25 && near(turned, 13.2, 1e-6) && near(rig.cam.Distance, 8, 0.05);
    return { pass: ok, measured: `hip ${f(hip.d, 1)} studs / ${f(hip.s, 1)} right / ${f(hip.fov, 0)}° → aim ${f(aim.d, 2)} / ${f(aim.s, 2)} / ${f(aim.fov, 1)}° (95% in ${f(t95, 2)} s) · 100 px = ${f(turned, 1)}° · released → ${f(rig.cam.Distance, 2)}`, expected: '8/2.2/70° → 4/1.9/50° in ≤ 0.25 s, 13.2°, back to 8', frames };
  });

  test('tp-swap', 'Q swaps shoulders smoothly and never clips through the head', 'Over the shoulder', (rig) => {
    arena(rig); const root = [0, 3, 0]; player(rig, root); rig.camera3('Third');
    const frames = []; let t = 0, inside = 0, maxStep = 0, tDone = null;
    for (let i = 0; i < 20; i++) { rig.update(DT, root); snap(frames, (t += DT), rig, root); }
    rig.swap(); let prev = rig.cam.Shoulder;
    for (let i = 1; i <= 60; i++) {
      const [cf] = rig.update(DT, root); snap(frames, (t += DT), rig, root);
      if (insideAny(rig.world, cf.Position, isPlayerBox, CAM.CollisionRadius)) inside++;
      maxStep = Math.max(maxStep, Math.abs(rig.cam.Shoulder - prev)); prev = rig.cam.Shoulder;
      if (tDone === null && rig.cam.Shoulder < -CAM.Third.Shoulder * 0.95) tDone = i * DT;
    }
    const left = rig.cam.Shoulder;
    rig.camAim(true); rig.swap();
    for (let i = 0; i < 40; i++) { rig.update(DT, root); snap(frames, (t += DT), rig, root); }
    const aimedRight = rig.cam.Shoulder;
    const ok = inside === 0 && near(left, -2.2, 0.01) && tDone !== null && tDone <= 0.4 && maxStep < 1.1 && near(aimedRight, 1.9, 0.02);
    return { pass: ok, measured: `right → left ${f(left, 2)} in ${f(tDone, 2)} s, max ${f(maxStep, 2)} studs/frame · camera inside body ${inside} frames · aimed swap back → ${f(aimedRight, 2)}`, expected: '−2.2 within 0.4 s, no frame > ¼ of the 4.4-stud slide, 0 frames inside, +1.9 aimed', frames };
  });

  test('tp-wall-behind', 'Backed against a wall: camera pulls in at once, never inside it, eases back out', 'Over the shoulder', (rig) => {
    arena(rig); player(rig, [0, 3, 0]);
    rig.box('WallBehind', [0, 6, 3], [30, 12, 1], null, 0x4c566a);
    rig.camera3('Third');
    const frames = []; let t = 0, insideWall = 0, minDist = Infinity, maxOut = 0;
    let rootZ = 0; let prevD = null;
    const wallFilter = (b) => b.Name === 'WallBehind';
    // Start already backed up (spawned against the wall), then walk away from it at 16 studs/s.
    for (let i = 0; i < 90; i++) {
      if (i >= 30) rootZ -= 16 * DT;
      const root = [0, 3, +rootZ.toFixed(4)];
      const [cf] = rig.update(DT, root); snap(frames, (t += DT), rig, root);
      if (insideAny(rig.world, cf.Position, wallFilter, CAM.CollisionRadius - 1e-6)) insideWall++;
      if (i < 30) minDist = Math.min(minDist, rig.cam.Distance);
      if (prevD !== null) maxOut = Math.max(maxOut, rig.cam.Distance - prevD);
      prevD = rig.cam.Distance;
    }
    const final = rig.cam.Distance;
    const ok = insideWall === 0 && minDist < 3 && maxOut <= CAM.PushOutSpeed * DT + 16 * DT + 1e-6 && near(final, 8, 1e-6);
    return { pass: ok, measured: `against the wall: ${f(minDist, 2)} studs back · inside the wall ${insideWall} frames · eases out ≤ ${f(maxOut / DT, 1)} studs/s · then ${f(final, 2)}`, expected: '< 3 studs, 0 frames inside, ≤ 18 studs/s + walking, back to 8', frames };
  });

  test('tp-wall-side', 'Hugging a wall on the camera side: the shoulder squeezes in, never into the wall', 'Over the shoulder', (rig) => {
    arena(rig); const root = [0, 3, 0]; player(rig, root);
    rig.box('WallRight', [2.3, 6, -10], [1, 12, 40], null, 0x4c566a);
    rig.camera3('Third');
    const frames = []; let t = 0, inside = 0;
    for (let i = 0; i < 40; i++) {
      const [cf] = rig.update(DT, root); snap(frames, (t += DT), rig, root);
      if (insideAny(rig.world, cf.Position, (b) => b.Name === 'WallRight', CAM.CollisionRadius - 1e-6)) inside++;
    }
    const squeezed = rig.cam.Shoulder;
    rig.swap();
    for (let i = 0; i < 40; i++) { rig.update(DT, root); snap(frames, (t += DT), rig, root); }
    const left = rig.cam.Shoulder;
    const ok = inside === 0 && squeezed > 0 && squeezed <= 2.3 - 0.5 - 0.5 + 1e-6 && near(left, -2.2, 0.01);
    return { pass: ok, measured: `shoulder ${f(squeezed, 2)} studs (wanted 2.2) · inside wall ${inside} frames · swapped to the open side → ${f(left, 2)}`, expected: '≤ 1.3 studs (wall face − camera radius), 0 frames inside, −2.2 after the swap', frames };
  });

  test('tp-floor-ceiling', 'Looking up from a low crouch / down under a low ceiling: camera stays in the room', 'Over the shoulder', (rig) => {
    arena(rig); const root = [0, 3, 0]; player(rig, root);
    rig.box('Ceiling', [0, 8.5, 0], [60, 1, 60], null, 0x434c5e);
    rig.camera3('Third');
    const frames = []; let t = 0, out = 0, lowY = Infinity, highY = -Infinity;
    for (let i = 0; i < 120; i++) {
      rig.look(0, i < 40 ? -12 : i < 100 ? 12 : -12); // up to +80, then down to −80, then back
      const [cf] = rig.update(DT, root); snap(frames, (t += DT), rig, root);
      lowY = Math.min(lowY, cf.Position.Y); highY = Math.max(highY, cf.Position.Y);
      if (cf.Position.Y < CAM.CollisionRadius - 1e-6 || cf.Position.Y > 8 - CAM.CollisionRadius + 1e-6) out++;
    }
    return { pass: out === 0, measured: `camera height ${f(lowY, 2)} … ${f(highY, 2)} studs (floor 0, ceiling 8) · ${out} frames through`, expected: `stays within ${CAM.CollisionRadius} … ${8 - CAM.CollisionRadius}`, frames };
  });

  test('tp-skip', 'Foliage behind the player can’t eat the shot (aim ray starts at the character)', 'Over the shoulder', (rig) => {
    arena(rig); const root = [0, 3, 0]; player(rig, root); dummy(rig, 'D', [2.2, -1.6, -40]);
    // a bush (CanCollide off): the camera sits inside it, the crosshair ray starts inside or behind it
    rig.box('Bush', [2.2, 4.6, 5], [4, 4, 4], 'NoCollide', 0x8fbcbb);
    rig.camera3('Third');
    const frames = [];
    for (let i = 0; i < 30; i++) { rig.update(DT, root); snap(frames, i * DT, rig, root); }
    // Look a hair down so the crosshair ray from behind passes through the bush's top.
    rig.setYaw(0, -1.5);
    for (let i = 0; i < 10; i++) { rig.update(DT, root); snap(frames, 0.5 + i * DT, rig, root); }
    const skip = rig.skip();
    const naive = rig.aim(400, true);
    const skipped = rig.aim(400);
    const nHit = rig.world.Raycast(rig.cam.CFrame.Position, rig.cam.CFrame.LookVector.mul(400), [rig.player]);
    const sHit = rig.world.Raycast(rig.cam.CFrame.Position.add(rig.cam.CFrame.LookVector.mul(skip)), rig.cam.CFrame.LookVector.mul(400 - skip), [rig.player]);
    const m = muzzle(root, 0);
    frames[frames.length - 1].shots = [{ a: P(m), b: P(skipped), hit: sHit ? sHit.Instance.Name : '' }];
    const ok = nHit && nHit.Instance.Name === 'Bush' && sHit && sHit.Instance.Model && sHit.Instance.Model.Name === 'D';
    return { pass: !!ok, measured: `skip ${f(skip, 2)} studs · from the camera the ray hits ${nHit ? nHit.Instance.Name : 'nothing'} at ${f(naive.Z, 1)} · from the character it hits ${sHit ? sHit.Instance.Model?.Name + ' ' + sHit.Instance.Name : 'nothing'}`, expected: 'camera ray would hit the Bush; the kit’s ray hits the dummy', frames };
  });

  test('tp-converge', 'Right-hand muzzle, centre crosshair: bullets still land on the crosshair', 'Over the shoulder', (rig) => {
    arena(rig, 600); const root = [0, 3, 0]; player(rig, root);
    const dists = [5, 20, 60, 200];
    dists.forEach((d, i) => rig.box('Target' + d, [(i - 1.5) * 18, 3, -d], [10, 10, 1], null, 0xa3be8c));
    rig.camera3('Third'); rig.camAim(true);
    const frames = []; const errs = [], naive = []; let t = 0;
    for (let i = 0; i < 30; i++) { rig.update(DT, root); snap(frames, (t += DT), rig, root); }
    dists.forEach((d, i) => {
      const target = new Vector3((i - 1.5) * 18, 4, -d + 0.5);
      // aim the crosshair at the target point from where the camera is
      for (let k = 0; k < 3; k++) {
        const to = target.sub(rig.cam.CFrame.Position);
        rig.setYaw(+(Math.atan2(-to.X, -to.Z) * 180 / Math.PI).toFixed(5), +(Math.asin(to.Unit.Y) * 180 / Math.PI).toFixed(5));
        rig.update(DT, root);
      }
      const charYaw = rig.charYaw(rig.cam.Yaw, 1);
      const aim = rig.aim(600);
      const m = muzzle(root, charYaw);
      const shot = rig.ray(m, aim.sub(m).Unit.mul(600));
      const wrong = rig.world.Raycast(m, rig.cam.CFrame.LookVector.mul(600), [rig.player]); // fire along the camera look instead
      errs.push(shot ? shot.Position.sub(aim).Magnitude : 99);
      naive.push(wrong ? wrong.Position.sub(aim).Magnitude : 99);
      snap(frames, (t += 0.4), rig, root, charYaw, { shots: [{ a: P(m), b: P(shot.Position), hit: shot.Instance.Name }] });
      for (let k = 1; k < 24; k++) snap(frames, t + k * DT, rig, root, charYaw);
      t += 24 * DT;
    });
    const worst = Math.max(...errs);
    return { pass: worst < 0.05, measured: `miss vs crosshair at ${dists.join('/')} studs: ${errs.map((e) => f(e, 3)).join(' / ')} (firing parallel to the camera would miss by ${naive.map((e) => f(e, 1)).join(' / ')})`, expected: '< 0.05 studs at every distance', frames };
  });

  test('tp-corner', 'Peeking a corner: muzzle blocked → the shot hits the wall and a red dot shows it', 'Over the shoulder', (rig) => {
    arena(rig); player(rig, [0, 3, 0]); dummy(rig, 'D', [6, 0, -30]);
    // a wall to the player's right front, ending at x = 2: the right-shoulder camera sees past it
    rig.box('Corner', [-4, 6, -3], [12, 12, 1], null, 0x4c566a);
    rig.camera3('Third');
    const frames = []; let t = 0; let first = null, clear = null, firstAt = null;
    // Step right from behind the corner while aiming at the dummy.
    for (let i = 0; i < 70; i++) {
      const x = +(-0.5 + i * 0.05).toFixed(3); const root = [x, 3, 0];
      const aimAt = new Vector3(6, 4.6, -30); const to = aimAt.sub(new Vector3(x, 3 + 1.6, 0));
      rig.setYaw(+(Math.atan2(-to.X, -to.Z) * 180 / Math.PI).toFixed(4), 0);
      rig.camAim(true);
      rig.update(DT, root);
      const aim = rig.aim(400);
      const m = muzzle(root, rig.cam.Yaw);
      const block = rig.obstruction(m, aim);
      if (block && first === null) { first = block; firstAt = x; }
      if (!block && first !== null && clear === null) clear = x;
      snap(frames, (t += DT), rig, root, rig.cam.Yaw, { aimOn: true, block: block ? P(block) : null, shots: i % 10 === 0 ? [{ a: P(m), b: P(block || aim), hit: block ? 'Corner' : 'Head' }] : undefined });
    }
    const ok = first !== null && Math.abs(first.Z - (-2.5)) < 0.01 && clear !== null;
    return { pass: ok, measured: first ? `at x=${f(firstAt, 2)} the muzzle is blocked (wall at z ${f(first.Z, 2)}) while the camera sees the dummy · clear from x=${f(clear, 2)}` : 'never blocked', expected: 'blocked by the corner face (z −2.5), then clear after stepping out', frames };
  });

  test('tp-face', 'Aiming or shooting turns the character to the crosshair at ≤ 900°/s; free run otherwise', 'Over the shoulder', (rig) => {
    arena(rig); const root = [0, 3, 0]; player(rig, root); rig.camera3('Third');
    const frames = []; let t = 0;
    rig.setYaw(180, 0); rig.update(DT, root);
    const free = rig.charYaw(0, DT);
    rig.camAim(true);
    let charYaw = 0, tFace = null, maxRate = 0;
    for (let i = 1; i <= 30; i++) {
      rig.update(DT, root); const y = rig.charYaw(charYaw, DT);
      maxRate = Math.max(maxRate, Math.abs(wrap(y - charYaw)) / DT); charYaw = y;
      snap(frames, (t += DT), rig, root, charYaw, { aimOn: true });
      if (tFace === null && Math.abs(wrap(charYaw - 180)) < 0.5) tFace = i * DT;
    }
    rig.camAim(false); rig.setYaw(90, 0); rig.update(DT, root);
    const afterRelease = rig.charYaw(charYaw, DT);
    rig.fired(); let hipTurn = charYaw, hipHeld = 0;
    for (let i = 1; i <= 60; i++) { rig.update(DT, root); const y = rig.charYaw(hipTurn, DT); if (y !== null) { hipTurn = y; hipHeld = i * DT; } snap(frames, (t += DT), rig, root, hipTurn); }
    const ok = free === null && tFace !== null && tFace <= 0.22 && maxRate <= 900 + 1e-6 && afterRelease === null && near(hipTurn, 90, 0.5) && near(hipHeld, CAM.FaceAimSeconds, DT + 1e-9);
    return { pass: ok, measured: `not aiming: ${free === null ? 'free' : 'LOCKED'} · aim 180° away: faces it in ${f(tFace, 2)} s (max ${f(maxRate, 0)}°/s) · hip-fire: faces aim for ${f(hipHeld, 2)} s`, expected: 'free, ≤ 0.22 s at ≤ 900°/s, 0.6 s after a shot', frames };
  });

  test('tp-hide', 'Camera squeezed into the character hides it (no inside-the-head view)', 'Over the shoulder', (rig) => {
    arena(rig); const root = [0, 3, 0]; player(rig, root);
    rig.box('Closet', [0, 6, 1.2], [8, 12, 1], null, 0x4c566a); rig.box('ClosetR', [1.4, 6, -2], [1, 12, 8], null, 0x4c566a);
    rig.camera3('Third');
    const frames = []; let hid = false;
    for (let i = 0; i < 20; i++) { rig.update(DT, root); snap(frames, i * DT, rig, root); }
    hid = rig.hide();
    const d = rig.cam.CFrame.Position.sub(rig.cam.Focus).Magnitude;
    return { pass: hid && d < 1.2, measured: `camera ${f(d, 2)} studs from the head pivot · character ${hid ? 'hidden' : 'VISIBLE'}`, expected: '< 1.2 studs → hidden', frames };
  });

  // ================================================================ input
  test('in-stick', 'Gamepad right stick: deadzone, 260°/s at full tilt, fine control near centre', 'Input', (rig) => {
    arena(rig); const root = [0, 3, 0]; player(rig, root); rig.camera3('Third');
    const frames = []; let t = 0;
    const hold = (x, y, s) => { const y0 = rig.cam.Yaw, p0 = rig.cam.Pitch; for (let i = 0; i < s / DT; i++) { rig.stick(x, y, DT); rig.update(DT, root); snap(frames, (t += DT), rig, root, null, { stick: [x, y] }); } return [wrap(y0 - rig.cam.Yaw), rig.cam.Pitch - p0]; };
    const drift = hold(0.12, 0.05, 0.5);
    const full = hold(1, 0, 0.5);
    const half = hold(0.575, 0, 0.5); // strength 0.5 → 0.25 of the speed with curve 2
    const up = hold(0, 1, 0.1);
    rig.camAim(true); const aimed = hold(1, 0, 0.5);
    const ok = drift[0] === 0 && drift[1] === 0 && near(full[0], 130, 0.01) && near(half[0], 32.5, 0.05) && near(up[1], 26, 0.01) && near(aimed[0], 78, 0.01);
    return { pass: ok, measured: `drift 0.13: ${f(drift[0], 2)}° · full 0.5 s: ${f(full[0], 1)}° · 57% tilt: ${f(half[0], 1)}° · up 0.1 s: ${f(up[1], 1)}° · aimed: ${f(aimed[0], 1)}°`, expected: '0°, 130°, 32.5°, +26°, 78° (60%)', frames };
  });

  test('in-touch', 'Touch drag on the right of the screen turns 0.3°/px (mouse 0.22°/px)', 'Input', (rig) => {
    arena(rig); const root = [0, 3, 0]; player(rig, root); rig.camera3('Third');
    const frames = []; let t = 0;
    const y0 = rig.cam.Yaw;
    for (let i = 0; i < 20; i++) { rig.look(-5, 2, true); rig.update(DT, root); snap(frames, (t += DT), rig, root); }
    const touchYaw = rig.cam.Yaw - y0, touchPitch = rig.cam.Pitch;
    rig.camAim(true); const y1 = rig.cam.Yaw; rig.look(-10, 0, true); const aimedTouch = rig.cam.Yaw - y1;
    const ok = near(touchYaw, 30, 1e-9) && near(touchPitch, -12, 1e-9) && near(aimedTouch, 1.8, 1e-9);
    return { pass: ok, measured: `100 px left → ${f(touchYaw, 1)}° · 40 px down → ${f(touchPitch, 1)}° · aimed 10 px → ${f(aimedTouch, 2)}°`, expected: '+30°, −12°, 1.8°', frames };
  });

  // ================================================================ weapons (WeaponState)
  function gunFrames(frames, rig, t, ev, extra) { frames.push({ t: +t.toFixed(3), gun: { mag: rig.gun.Magazine, res: rig.gun.Reserve, spread: +rig.gun.Spread(false).toFixed(2), rel: rig.gun.IsReloading(), ev: ev || '', ...(extra || {}) } }); }

  test('w-semi', 'Pistol: one shot per click; holding the trigger doesn’t auto-fire', 'Weapons', (rig) => {
    rig.equip('Pistol'); const frames = []; let shots = 0, t = 0;
    rig.press(0); for (let i = 0; i < 120; i++) { const ev = rig.step((t = i * DT), DT); if (ev === 'Fire') shots++; gunFrames(frames, rig, t, ev); }
    rig.release();
    const held = shots;
    for (let c = 0; c < 4; c++) { const at = +(2 + c * 0.5).toFixed(4); rig.press(at); for (let i = 0; i < 6; i++) { const ev = rig.step(+(at + i * DT).toFixed(6), DT); if (ev === 'Fire') shots++; gunFrames(frames, rig, at + i * DT, ev); } rig.release(); }
    return { pass: held === 1 && shots === 5, measured: `held 2 s → ${held} shot · 4 clicks → ${shots - held} shots · ${rig.gun.Magazine}/12 left`, expected: '1, then 4', frames };
  });

  test('w-buffer', 'Pistol click-spam: an early click (≤ 0.12 s) fires when ready; a click between frames isn’t lost', 'Weapons', (rig) => {
    rig.equip('Pistol'); const frames = []; const interval = 60 / CombatConfig.Weapons.Pistol.Rpm; // 0.15
    const fireAt = [];
    const run = (from, to) => { for (let t = from; t < to - 1e-9; t += DT) { const tt = +t.toFixed(6); const ev = rig.step(tt, DT); if (ev === 'Fire') fireAt.push(tt); gunFrames(frames, rig, tt, ev); } };
    rig.press(0); rig.release(); run(0, 0.1); // tap: press+release between two frames
    rig.press(0.1); rig.release(); run(0.1, 0.4); // 0.05 s before ready → buffered
    rig.press(0.4); rig.release(); run(0.4, 0.42); // a shot fired at 0.15 → ready 0.3; this one at 0.4 fires right away
    run(0.42, 0.5);
    rig.press(0.5); rig.release(); run(0.5, 0.9); // 0.05 after the last shot (0.4): ready 0.55, buffered
    rig.press(0.9); rig.release(); // ready (last ~0.55 → 0.7); fires
    run(0.9, 0.92);
    rig.press(0.95); rig.release(); run(0.95, 1.3); // 0.05 after → ready 1.05, buffered
    rig.press(1.3); rig.release(); run(1.3, 1.31); rig.press(1.32); rig.release(); run(1.31, 1.6); // 2nd click 0.13 early → dropped
    const n = fireAt.length; const gaps = fireAt.slice(1).map((x, i) => x - fireAt[i]);
    const minGap = Math.min(...gaps);
    const ok = fireAt[0] === 0 && n === 7 && minGap >= interval - 1e-9;
    return { pass: ok, measured: `${n} shots at ${fireAt.map((x) => f(x, 2)).join(', ')} s · min gap ${f(minGap, 3)} s`, expected: `tap at 0 fires; 7 shots; never closer than ${interval} s; the 0.13-early click is dropped`, frames };
  });

  test('w-auto-rate', 'Rifle holds 600 RPM at 30, 60 and 144 FPS', 'Weapons', (rig) => {
    const frames = []; const res = [];
    for (const fps of [30, 60, 144]) {
      rig.equip('Rifle'); rig.gunSet('Magazine', 999);
      const dt = 1 / fps; let shots = 0, oldShots = 0, oldNext = 0;
      rig.press(0);
      for (let i = 0; i * dt < 3 - 1e-9; i++) {
        const t = +(i * dt).toFixed(6);
        const ev = rig.step(t, +dt.toFixed(9)); if (ev === 'Fire') shots++;
        if (t >= oldNext) { oldShots++; oldNext = t + 0.1; } // the old rule: next = now + interval
        if (fps === 60) gunFrames(frames, rig, t, ev);
      }
      rig.release();
      res.push({ fps, rpm: (shots / 3) * 60, old: (oldShots / 3) * 60 });
    }
    const ok = res.every((r) => Math.abs(r.rpm - 600) <= 20);
    return { pass: ok, measured: res.map((r) => `${r.fps} FPS ${f(r.rpm, 0)} RPM (old rule ${f(r.old, 0)})`).join(' · '), expected: '600 ± 20 at every frame rate', frames };
  });

  test('w-burst', 'Burst mode: a tap fires all 3, then waits for the next press', 'Weapons', (rig) => {
    rig.equip('Rifle'); rig.gunSet('Mode', 'Burst'); const frames = []; const bursts = [];
    let t = 0;
    for (let b = 0; b < 3; b++) {
      let shots = 0; rig.press(+t.toFixed(6)); rig.step(+t.toFixed(6), DT) === 'Fire' && shots++; rig.release(); // tap: released after one frame
      for (let i = 1; i < 30; i++) { const tt = +(t + i * DT).toFixed(6); const ev = rig.step(tt, DT); if (ev === 'Fire') shots++; gunFrames(frames, rig, tt, ev); }
      bursts.push(shots); t += 0.5;
    }
    return { pass: bursts.every((s) => s === 3), measured: `bursts ${bursts.join(', ')} · ${rig.gun.Magazine}/30 left`, expected: '3, 3, 3', frames };
  });

  test('w-empty', 'Empty: one dry click, auto-reload, refill keeps the leftover reserve', 'Weapons', (rig) => {
    rig.equip('Shotgun'); rig.setAmmo(1, 4); const frames = []; const evs = [];
    rig.press(0);
    for (let i = 0; i < 60 * 4; i++) {
      const t = +(i * DT).toFixed(6); const ev = rig.step(t, DT);
      if (ev) evs.push(ev);
      if (ev === 'Empty') rig.reload(t); // WeaponController reloads on Empty
      gunFrames(frames, rig, t, ev);
      if (i === 70) { rig.press(t); }
    }
    const ok = evs.join(',') === 'Fire,Empty,Reloaded' && rig.gun.Magazine === 4 && rig.gun.Reserve === 0;
    return { pass: ok, measured: `events ${evs.join(' → ')} · ${rig.gun.Magazine}/${rig.gun.Reserve} after`, expected: 'Fire → Empty → Reloaded, 4 / 0 (only 4 left in reserve)', frames };
  });

  test('w-reload', 'Reload: blocks firing, refuses when full or out of reserve, can’t double-start', 'Weapons', (rig) => {
    rig.equip('Pistol'); const frames = [];
    const full = rig.reload(0);
    rig.press(0); rig.step(0, DT); rig.release(); // 11/96
    const ok1 = rig.reload(0.1); const again = rig.reload(0.2);
    rig.press(0.3); let firedDuring = 0;
    for (let i = 0; i < 60 * 1.5; i++) { const t = +(0.3 + i * DT).toFixed(6); const ev = rig.step(t, DT); if (ev === 'Fire' && t < 1.5) firedDuring++; gunFrames(frames, rig, t, ev); }
    rig.release();
    rig.setAmmo(3, 0); const noReserve = rig.reload(2);
    const ok = !full && ok1 && !again && firedDuring === 0 && rig.gun.Magazine === 3;
    return { pass: ok, measured: `full: ${full ? 'RELOADED' : 'refused'} · started ${ok1} · second R ${again ? 'ACCEPTED' : 'ignored'} · shots during reload ${firedDuring} · no reserve: ${noReserve ? 'RELOADED' : 'refused'}`, expected: 'refused, true, ignored, 0, refused', frames };
  });

  test('w-swap-cancel', 'Swapping weapons cancels the reload; ammo unchanged; trigger and aim reset', 'Weapons', (rig) => {
    rig.equip('Rifle'); rig.setAmmo(5, 100); rig.gunAim(true); const frames = [];
    rig.reload(0); for (let i = 0; i < 60; i++) rig.step(+(i * DT).toFixed(6), DT);
    rig.press(1); rig.unequip();
    let reloaded = false; for (let i = 0; i < 120; i++) { const t = +(1 + i * DT).toFixed(6); const ev = rig.step(t, DT); if (ev) reloaded = true; gunFrames(frames, rig, t, ev); }
    const g = rig.gun;
    const ok = !reloaded && g.Magazine === 5 && g.Reserve === 100 && !g.IsReloading() && !g.TriggerDown && !g.Aiming;
    return { pass: ok, measured: `${g.Magazine}/${g.Reserve} · ${reloaded ? 'RELOAD FINISHED ANYWAY' : 'no reload'} · trigger ${g.TriggerDown ? 'STUCK' : 'up'} · aim ${g.Aiming ? 'STUCK' : 'off'}`, expected: '5/100, no reload, trigger up, aim off', frames };
  });

  test('w-bloom', 'Bloom grows per shot to its cap and recovers; aiming and standing still tighten it', 'Weapons', (rig) => {
    rig.equip('Rifle'); rig.gunSet('Magazine', 999); const frames = []; const W = CombatConfig.Weapons.Rifle;
    rig.press(0); let maxSpread = 0;
    for (let i = 0; i < 180; i++) { const t = +(i * DT).toFixed(6); const ev = rig.step(t, DT); if (ev === 'Fire') maxSpread = Math.max(maxSpread, rig.gun.LastSpread); gunFrames(frames, rig, t, ev); }
    rig.release(); const capped = rig.gun.Bloom;
    let tRecover = null; for (let i = 1; i <= 120; i++) { const t = +(3 + i * DT).toFixed(6); rig.step(t, DT); gunFrames(frames, rig, t); if (tRecover === null && rig.gun.Bloom === 0) tRecover = i * DT; }
    const hipMoving = rig.gun.Spread(true), hip = rig.gun.Spread(false); rig.gunAim(true); const ads = rig.gun.Spread(false);
    const ok = near(capped, W.BloomMax, 1e-9) && maxSpread <= W.SpreadHip + W.BloomMax + 1e-9 && tRecover !== null && tRecover <= W.BloomMax / W.BloomRecovery + 60 / W.Rpm + DT && ads < hip && hip < hipMoving;
    return { pass: ok, measured: `bloom cap ${f(capped, 2)}° · widest shot ${f(maxSpread, 2)}° · recovered in ${f(tRecover, 2)} s · spread moving ${f(hipMoving, 1)}° / still ${f(hip, 1)}° / aimed ${f(ads, 1)}°`, expected: `cap ${W.BloomMax}°, ≤ ${W.SpreadHip + W.BloomMax}°, ≤ ${f(W.BloomMax / W.BloomRecovery + 60 / W.Rpm, 1)} s (recovery starts once the gun is ready), aimed < still < moving`, frames };
  });

  test('w-recoil', 'Recoil: camera climbs during a spray and settles back within 0.5 s (ADS kicks 70%)', 'Weapons', (rig) => {
    arena(rig); const root = [0, 3, 0]; player(rig, root); dummy(rig, 'D', [2, 0, -40]);
    rig.camera3('Third'); rig.equip('Rifle'); rig.fxOwned(true);
    const frames = []; const rng = new Random(7); let t = 0, peak = 0, firstKick = null;
    for (let i = 0; i < 20; i++) { rig.update(DT, root); snap(frames, (t += DT), rig, root); }
    const basePitch = rig.cam.CFrame.LookVector.Y;
    const pitchOf = (cam) => Math.asin(cam.CFrame.LookVector.Y) * 180 / Math.PI;
    rig.press(+t.toFixed(6));
    const sprayEnd = t + 1;
    let settle = null;
    for (let i = 0; i < 120; i++) {
      t += DT; const tt = +t.toFixed(6);
      if (tt >= sprayEnd && rig.gun.TriggerDown) rig.release();
      rig.update(DT, root);
      const ev = rig.step(tt, DT);
      if (ev === 'Fire') { const side = +(rng.NextNumber(-1, 1) * rig.gun.LastRecoilSide).toFixed(6); rig.fxRecoil(rig.gun.LastRecoilUp, side, CombatConfig.Weapons.Rifle.RecoilRecovery); rig.fired(); }
      rig.setClock(tt);
      const cam = rig.fxFrame(DT);
      const kick = pitchOf(cam) - Math.asin(basePitch) * 180 / Math.PI;
      if (firstKick === null && ev === 'Fire') firstKick = kick;
      peak = Math.max(peak, kick);
      if (!rig.gun.TriggerDown && settle === null && Math.abs(kick) < 0.05) settle = tt - sprayEnd;
      frames.push({ t: +t.toFixed(3), cam: cam.CFrame.toMatrix4Array().map((x) => +x.toFixed(4)), fov: +cam.FieldOfView.toFixed(2), root, yaw: rig.cam.Yaw, mode: 'Third', aim: 0, hide: false, gun: { mag: rig.gun.Magazine, res: rig.gun.Reserve, ev: ev || '' } });
    }
    const W = CombatConfig.Weapons.Rifle;
    const ok = firstKick !== null && near(firstKick, W.RecoilUp * 0.7, 0.05) && peak > W.RecoilUp && settle !== null && settle <= 0.5;
    return { pass: ok, measured: `first shot kicks ${f(firstKick, 2)}° (70% of ${W.RecoilUp}) · spray peak ${f(peak, 2)}° · back within 0.05° ${f(settle, 2)} s after letting go`, expected: `${f(W.RecoilUp * 0.7, 2)}°, peak above one shot, ≤ 0.5 s`, frames };
  });

  test('w-spread', 'Spread: every shot inside the cone, spread evenly over its area', 'Weapons', (rig) => {
    rig.seed(42); const dir = new Vector3(0, 0, -1); const deg = 4; const frames = [];
    let outside = 0, inner = 0; const N = 600;
    for (let i = 0; i < N; i++) {
      const d = rig.spread(dir, deg);
      const a = Math.acos(Math.min(1, d.Dot(dir))) * 180 / Math.PI;
      if (a > deg + 1e-6) outside++;
      if (Math.tan(rad(a)) <= Math.tan(rad(deg)) * Math.SQRT1_2) inner++;
      frames.push({ t: i / 60, dot: [+(d.X / -d.Z).toFixed(5), +(d.Y / -d.Z).toFixed(5)] });
    }
    const share = inner / N;
    return { pass: outside === 0 && near(share, 0.5, 0.06), measured: `${outside}/${N} outside 4° · ${f(share * 100, 1)}% inside the half-area circle`, expected: '0 outside, 50% ± 6 (uniform over the disk, not clumped in the middle)', frames, view: 'spread', cone: deg };
  });

  test('w-shotgun', 'Shotgun: 8 pellets in a 6° cone, damage falls off 100% → 20% from 10 to 35 studs', 'Weapons', (rig) => {
    arena(rig); const root = [0, 3, 0]; player(rig, root); dummy(rig, 'D', [0, 0, -12]);
    rig.camera3('Third'); rig.camAim(true); const frames = [];
    for (let i = 0; i < 20; i++) { rig.update(DT, root); }
    for (let k = 0; k < 3; k++) { // put the crosshair on the dummy's chest
      const to = new Vector3(0, 3.2, -12).sub(rig.cam.CFrame.Position);
      rig.setYaw(+(Math.atan2(-to.X, -to.Z) * 180 / Math.PI).toFixed(5), +(Math.asin(to.Unit.Y) * 180 / Math.PI).toFixed(5)); rig.update(DT, root);
    }
    const aim = rig.aim(120); const m = muzzle(root, rig.cam.Yaw); const base = aim.sub(m).Unit;
    rig.seed(3); const W = CombatConfig.Weapons.Shotgun; let widest = 0, hits = 0; const shots = [];
    for (let p = 1; p <= W.Pellets; p++) {
      const d = rig.spread(base, W.SpreadHip); widest = Math.max(widest, Math.acos(Math.min(1, d.Dot(base))) * 180 / Math.PI);
      const r = rig.ray(m, d.mul(W.Range)); if (r && r.Instance.Model && r.Instance.Model.Name === 'D') hits++;
      shots.push({ a: P(m), b: P(r ? r.Position : m.add(d.mul(60))), hit: r ? r.Instance.Name : '' });
    }
    const fall = [5, 10, 22.5, 35, 60].map((d) => rig.falloff(d, 'Shotgun'));
    for (let i = 0; i < 40; i++) snap(frames, i * DT, rig, root, rig.cam.Yaw, { aimOn: true, shots: i < 20 ? shots : undefined });
    const ok = widest <= W.SpreadHip + 1e-6 && hits >= 5 && near(fall[0], 1, 1e-9) && near(fall[1], 1, 1e-9) && near(fall[2], 0.6, 1e-9) && near(fall[3], 0.2, 1e-9) && near(fall[4], 0.2, 1e-9);
    return { pass: ok, measured: `widest pellet ${f(widest, 2)}° · ${hits}/8 on a dummy at 12 studs · falloff at 5/10/22.5/35/60: ${fall.map((x) => f(x, 2)).join(' / ')}`, expected: '≤ 6°, ≥ 5 hits, 1 / 1 / 0.6 / 0.2 / 0.2', frames };
  });

  test('w-damage', 'Pistol damage: falloff 40 → 120 studs, headshot × 1.8 (WeaponService’s formula)', 'Weapons', (rig) => {
    arena(rig, 600); const root = [0, 3, 0]; player(rig, root);
    const W = CombatConfig.Weapons.Pistol; const out = [];
    [20, 80, 150].forEach((d, i) => dummy(rig, 'D' + d, [i * 5 - 5, 0, -d]));
    rig.camera3('First'); const frames = []; let t = 0;
    for (const [i, d] of [20, 80, 150].entries()) for (const part of ['Head', 'Torso']) {
      const target = new Vector3(i * 5 - 5, part === 'Head' ? 4.6 : 3, -d);
      const to = target.sub(new Vector3(0, 4.5, 0));
      rig.setYaw(+(Math.atan2(-to.X, -to.Z) * 180 / Math.PI).toFixed(5), +(Math.asin(to.Unit.Y) * 180 / Math.PI).toFixed(5));
      rig.update(DT, root);
      const aim = rig.aim(W.Range); const m = muzzle(root, rig.cam.Yaw);
      const r = rig.ray(m, aim.sub(m).Unit.mul(W.Range));
      const fo = rig.falloff(+r.Position.sub(m).Magnitude.toFixed(4), 'Pistol');
      const dmg = Math.floor(W.Damage * fo * (Kit.Ballistics.IsHead(r.Instance) ? W.HeadshotMultiplier : 1) * 10 + 0.5) / 10;
      out.push({ d, part: r.Instance.Name, dmg });
      snap(frames, (t += 0.4), rig, root, rig.cam.Yaw, { shots: [{ a: P(m), b: P(r.Position), hit: `${r.Instance.Name} ${dmg}` }] });
      for (let k = 1; k < 20; k++) snap(frames, t + k * DT, rig, root, rig.cam.Yaw);
      t += 20 * DT;
    }
    const get = (d, p) => out.find((o) => o.d === d && o.part === p)?.dmg;
    const ok = get(20, 'Head') === 39.6 && get(20, 'Torso') === 22 && get(150, 'Torso') === 13.2 && get(80, 'Torso') < 22 && get(80, 'Torso') > 13.2;
    return { pass: ok, measured: out.map((o) => `${o.d}m ${o.part} ${o.dmg}`).join(' · '), expected: 'close head 39.6, close body 22, 80 studs in between, 150 studs body 13.2 (60%)', frames };
  });

  test('w-bow', 'Bow: arrows drop (gravity 60); aiming at the head from 60 studs lands low, holding over hits', 'Weapons', (rig) => {
    arena(rig); const root = [0, 3, 0]; player(rig, root); dummy(rig, 'D', [0, 0, -60]);
    const W = CombatConfig.Weapons.Bow; const frames = []; const results = [];
    for (const holdOver of [0, 1]) {
      const head = new Vector3(0, 4.6, -60); const m = muzzle(root, 0);
      let dir = head.sub(m).Unit;
      if (holdOver) { const tFlight = 60 / W.ProjectileSpeed; const drop = 0.5 * W.ProjectileGravity * tFlight * tFlight; dir = head.add(new Vector3(0, drop, 0)).sub(m).Unit; }
      let pos = m, vel = dir.mul(W.ProjectileSpeed), hit = null; const path = [P(pos)];
      for (let i = 0; i < 120 && !hit; i++) {
        const [p, v, h] = rig.projectile(pos, vel, W.ProjectileGravity, DT); pos = p; vel = v; hit = h; path.push(P(pos));
        frames.push({ t: +((holdOver * 2) + i * DT).toFixed(3), arrow: P(pos), path: path.slice(), root, cam: null });
      }
      results.push({ holdOver, part: hit ? hit.Instance.Name : 'miss', y: pos.Y });
    }
    const ok = results[0].part !== 'Head' && results[0].y < 4 && results[1].part === 'Head';
    return { pass: ok, measured: results.map((r) => `${r.holdOver ? 'held over' : 'dead-on'}: ${r.part} at y ${f(r.y, 2)}`).join(' · '), expected: 'dead-on lands below the head; held over by the drop hits the head', frames, view: 'side', world: true };
  });

  // ================================================================ server checks
  test('s-honest', 'Server accepts every honest shot: 30/60/144 FPS with 0–80 ms network jitter', 'Server', (rig) => {
    const out = []; const frames = []; const jitter = new Random(11);
    for (const fps of [30, 60, 144]) {
      rig.equip('Rifle'); rig.gunSet('Magazine', 999);
      const dt = 1 / fps; let sent = 0, accepted = 0, arrival = 0; const name = 'Rifle';
      rig.serverReset(); rig.press(0);
      for (let i = 0; i * dt < 4; i++) {
        const t = +(i * dt).toFixed(6);
        if (rig.step(t, +dt.toFixed(9)) === 'Fire') {
          sent++;
          arrival = Math.max(arrival, t + 0.05 + jitter.NextNumber(0, 0.08)); // reliable remote: in order
          const at = +(arrival + fps * 1000).toFixed(6); // server clock offset per run
          if (rig.server(name + '', at, CombatConfig.FireJitterTolerance)) accepted++;
          frames.push({ t: +(t + fps).toFixed(3), sv: { sent, accepted, fps } });
        }
      }
      rig.release(); rig.serverReset();
      out.push({ fps, sent, accepted });
    }
    const ok = out.every((o) => o.accepted === o.sent && o.sent >= 39);
    return { pass: ok, measured: out.map((o) => `${o.fps} FPS ${o.accepted}/${o.sent}`).join(' · '), expected: 'all accepted', frames };
  });

  test('s-exploit', 'Server holds a 10× rapid-fire exploit to the weapon’s rate', 'Server', (rig) => {
    const frames = []; let accepted = 0, sent = 0;
    for (let i = 0; i < 500; i++) { const t = +(i * 0.01).toFixed(4); sent++; if (rig.server('Rifle', t, CombatConfig.FireJitterTolerance)) accepted++; if (i % 5 === 0) frames.push({ t, sv: { sent, accepted } }); }
    const allowed = 5 * 10 + 1 + (0.025 + CombatConfig.FireJitterTolerance) / 0.1;
    return { pass: accepted <= allowed && accepted >= 49, measured: `${accepted} of ${sent} accepted in 5 s (${f((accepted / 5) * 60, 0)} RPM)`, expected: `≤ ${f(allowed, 1)} (600 RPM + the jitter slack)`, frames };
  });

  // ------------------------------------------------------------------ runner
  function runOne(t) {
    const rig = new Rig(t.id);
    const t0 = Date.now();
    let r;
    try { r = t.fn(rig); } catch (e) { r = { pass: false, measured: 'ERROR ' + (e.stack || e.message), expected: '', frames: [] }; }
    return {
      id: t.id, title: t.title, group: t.group, pass: r.pass, measured: r.measured, expected: r.expected, ms: Date.now() - t0,
      frames: r.frames, view: r.view || (r.frames.length && r.frames[0].cam ? 'camera' : r.frames.length && r.frames[0].gun ? 'gun' : r.frames.length && r.frames[0].sv ? 'server' : 'side'),
      cone: r.cone, world: rig.world.boxes.map((b) => ({ name: b.Name, model: b.Model ? b.Model.Name : null, min: b.Min.toArray(), max: b.Max.toArray(), color: b.color })),
      trace: rig.trace, out: rig.out,
    };
  }

  return { TESTS, runOne, DT };
});
