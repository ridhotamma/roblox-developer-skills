# Ragdoll physics

How a Roblox character becomes a physical body and back, and why each step is there.

## 1. Anatomy of a ragdoll

A Humanoid rig is a tree of parts held together by `Motor6D`s. Animations write each motor's `Transform`. A ragdoll replaces every motor with a physical joint at the same pivot:

| Rig joint | Constraint | Limits (defaults) |
|---|---|---|
| Neck | BallSocket | cone 35°, twist ±45° |
| Waist | BallSocket | cone 25°, twist ±20° |
| Shoulders | BallSocket | cone 110°, twist ±60° |
| Elbows | Hinge | 0° to 140° (forward only) |
| Wrists, ankles | BallSocket | cone 25°, twist ±10° |
| Hips | BallSocket | cone 70°, twist ±20° |
| Knees | Hinge | −130° to 0° (backward only) |
| Root (HumanoidRootPart → torso) | stays a Motor6D | rigid |

R6 has only neck, shoulders and hips; they match the same entries because joint names are compared with spaces removed. Unknown joints on custom rigs get `Default`.

**Pivots come from the motor itself.** Attachment0 sits at `motor.C0` on Part0; Attachment1 is placed so both attachments coincide in the rest pose (`(C0 * C1⁻¹)⁻¹ * frame`). This works on any rig without relying on `...RigAttachment` names.

**Cone axis.** A ball socket's cone is measured around its attachment's X axis. The kit points that axis from the pivot toward the child part's centre, so "cone 70°" always means "70° away from where the limb naturally hangs", whatever the rig's C0 orientation.

**Hinge axis.** Knees and elbows hinge around Part0's X axis (the character's right on R15). Rotation follows the right-hand rule: positive swings a hanging limb forward (elbows), negative swings it back (knees). If a rig's knees fold the wrong way, swap the sign of that joint's limits in `RagdollConfig.Joints`.

**Friction.** `MaxFrictionTorque` on ball sockets (default 6) stops the weightless flailing that makes ragdolls look like rubber. Raise it for stiffer, heavier bodies; lower it for floppy comedy.

## 2. Colliders

Humanoids set `CanCollide = false` on arms and legs every frame. A ragdoll made only of constraints lands on its torso and head while the limbs sink into the floor.

The kit welds an invisible collider to every body part: 75% of the part's size, `Massless`, `CanQuery = false` and `CanTouch = false` (so raycasts, hitboxes and `Touched` keep hitting the real limb), `CanCollide` off until the ragdoll starts.

- Colliders live in the `Ragdoll` collision group, which doesn't collide with itself. Limbs don't jam against each other and two ragdolls' limbs pass through each other, which is both cheaper and more stable.
- Each joint gets `NoCollisionConstraint`s between a part and its neighbour's collider, since they overlap at the pivot.
- Colliders still hit the world, vehicles, and torsos and heads (including the ragdoll's own, which is what keeps arms from passing through the chest).

Smaller colliders (`ColliderScale` 0.6–0.7) reduce jams and jitter; larger (0.9) look more solid on the ground but catch on geometry.

## 3. Who owns what

| Thing | Who must do it | Why |
|---|---|---|
| `Motor6D.Enabled`, constraint `Enabled`, collider `CanCollide` | Server | Replicates to every client; clients can't be trusted with it. |
| `Humanoid:ChangeState(Physics / GettingUp)` | Physics owner | A player's Humanoid state is driven by that player's client. Server calls on player characters don't stick. |
| Velocities and impulses | Physics owner | The server can't push a part it doesn't simulate. |
| Flinch and injury poses | Every client, locally | `Motor6D.Transform` doesn't replicate. |

Player characters are owned by their player; NPCs should be server-owned (`root:SetNetworkOwner(nil)`, which the combat kit's `EnemyService` already does). Ownership applies to the whole mechanism, so loose limbs joined by constraints stay with the same owner as the torso.

So the server sets the `RagdollState` attribute and toggles the joints, and:
- for NPCs, also changes the Humanoid state and applies the launch itself;
- for players, `RagdollController` on that player's client reacts to the attribute (state) and to `RagdollImpulse` (launch).

## 4. Humanoid state

While ragdolled the Humanoid is held in `Enum.HumanoidStateType.Physics`: no balancing torque, no walking, no auto-rotate. It is the only state that never leaves on its own, but other scripts and jump requests can still kick it out, so the controller re-asserts it on `StateChanged`.

`PlatformStand = true` is the older alternative. It replicates from the server, which is convenient, but anything that clears it stands the character up mid-ragdoll. Prefer `Physics`.

## 5. Launching

`RagdollRig.Launch(character, velocity, part, partVelocity)` on the owner:
- sets every body part to the root's current velocity plus `velocity` (so running speed is kept: a sprinter hit from behind flies further than one hit head-on);
- adds roll around the axis perpendicular to travel (`Tumble`), like going over a bonnet;
- gives the struck part extra velocity (`partVelocity`), so a shot to the shoulder spins the body from the shoulder.

Velocities are **set**, not added as impulses, so the result is the same whether or not the joint toggle has reached the client yet. Everything is capped at `MaxLaunch` (160 studs/s): beyond that, bodies tunnel through walls and trip anti-cheat.

When the combat kit applies knockback (a `LinearVelocity` on the root) to a ragdolled character, the root drags the body with it. That is intended, and looks right.

## 6. Settling and getting up

Every 0.1 s the server checks each live ragdoll:

```
now ≥ minUntil  and  (root speed < SettleSpeed for SettleSeconds  or  time down ≥ MaxSeconds)  →  Recover
```

Recover sequence:
1. Server sets `RagdollState = "Recovering"`. Clients capture every joint's physical pose as a Transform (`C0⁻¹ · Part0⁻¹ · Part1 · C1`); the owner notes whether the body is face-up.
2. `RecoverGap` (0.1 s) later the server re-enables the motors and sets `"None"`.
3. The owner changes the Humanoid to `GettingUp`, which rights the root physically, and plays `GetUpAnimations.FaceUp` or `.FaceDown` if set.
4. Every client blends each limb from the captured pose to the animation over `BlendSeconds` with a smoothstep, so limbs flow into the stand-up instead of snapping.

Get-up animations should start from a lying pose and take 0.8–1.4 s. Without them the Humanoid's own stand-up plus the blend is acceptable for arcade games.

`SnapUpright = true` places the root upright on the ground under the body before `GettingUp`. Use it if characters get stuck under ledges or on slopes; the cost is a visible pop.

Dead characters never recover: they stay ragdolled until the character is removed (respawn, or the enemy system's cleanup).

## 7. Performance budget

Per character, built once: about 14 constraints, 14 colliders, 28 attachments and 28 NoCollisionConstraints. Idle cost is nil (everything disabled, colliders not colliding).

While ragdolled, each body is ~15 assemblies with contacts. Budgets that hold on phones:

| | Budget |
|---|---|
| Live ragdolls at once | 8–12 on mobile, 24 (the default `MaxActive`) on desktop-first games |
| Corpses | Remove or anchor after 5–10 s; never accumulate |
| Procedural poses | Only within `MaxDistance` (150 studs); nothing runs for characters with no flinch, injury or blend |

When the cap is reached the oldest living ragdoll is stood up to make room. For crowd scenes (zombies, armies) ragdoll only the kills near a player and fade the rest out.

## 8. Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| Player dies the moment they ragdoll | `RequiresNeck` is true | Set false before disabling the neck (the kit does at build) |
| Body falls apart on death | `BreakJointsOnDeath` is true, or a death script calls `BreakJoints` | Set false; remove the old script |
| Ragdoll stands stiff like a statue | Humanoid never entered `Physics` (state changed on the wrong machine), or motors not disabled | Check `RagdollController` is running; check `RagdollState` replicates |
| Limbs sink through the floor | No colliders, or colliders in a group that doesn't hit the map | Check the `Ragdoll` group collides with the map's groups |
| Body explodes outward / flings on start | Colliders overlapping without NoCollision, or colliders too big | Lower `ColliderScale`; make sure the rig wasn't rescaled after build (`Rebuild`) |
| Jitter while lying still | Colliders fighting, friction too low | `ColliderScale` 0.65, `FrictionTorque` 10+ |
| Limbs stretch away from the body | Constraint attachments built before the avatar finished loading | Build on `CharacterAppearanceLoaded` (the kit does); `Rebuild` after body swaps |
| Knees or elbows bend the wrong way | Hinge sign for this rig | Swap that joint's `Lower`/`Upper` sign in `RagdollConfig.Joints` |
| Launch does nothing on players | Velocity applied by the server | Send it to the owner (`RagdollService:Push`) |
| Anti-cheat kicks ragdolled players | No grace period | `AntiCheatService:Grant` while down (the kit does if `roblox-security` is installed) |
| Won't get up / stuck in the floor | `GettingUp` blocked by geometry | `SnapUpright = true` |
| Gets up, then slides or spins | `AutoRotate` or a leftover mover | Clear BodyMovers / `LinearVelocity` on recover |
| Tool or accessory flies off | Its weld was treated as a body joint | Only Motor6Ds between direct children of the character are body joints (the kit's rule) |
| Camera clips into the body | Camera follows the root, which lies on the ground | Set `CameraSubject` to the head while down |

## 9. Test checklist

Run with two clients (Test → Clients and Servers), on R15 and R6 if the game allows both:

- [ ] `RagdollService:Ragdoll(character)` from the server console: body goes limp, nobody dies, limbs rest on the floor.
- [ ] Knees fold backward, elbows forward, head doesn't spin past the shoulders.
- [ ] The other client sees the same fall.
- [ ] Gets up within `MaxSeconds`, facing where it was lying, limbs blending in.
- [ ] Ragdoll while running, jumping, climbing, swimming, seated, and holding a tool.
- [ ] Death ragdolls and the respawn is clean (no leftover state on the new character).
- [ ] A launch at `MaxLaunch` into a wall doesn't pass through it.
- [ ] 10 ragdolls at once on a low-end device: no hitching (see the `roblox-performance` skill's profiling guide).
- [ ] With `roblox-security` installed: no flags during ragdoll, launch or get-up.
