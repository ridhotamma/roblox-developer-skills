---
name: roblox-vehicles
description: Build Roblox cars and other wheeled vehicles that drive like real ones - a reusable raycast-suspension chassis where every vehicle is defined by real-life variables (mass, weight distribution, centre-of-mass height, engine torque curve, redline, gear ratios, final drive, speed limiter, drivetrain FWD/RWD/AWD, brake deceleration and bias, handbrake, steering lock and speed sensitivity, tire grip and slip curve, spring frequency, damping ratio, ride height, anti-roll, drag and downforce), and any car mesh or model becomes drivable just by naming its wheels. Cars never get stuck: sphere-cast wheels roll over kerbs and terrain, a low-friction rounded collision hull replaces snag-prone body meshes, and stuck assist, auto-flip, air control and a reset button guarantee the player can always keep driving. Drifting is built in (slide grip, handbrake, countersteer assist, yaw stabilizer, drift score) with tire smoke, skid marks and tire squeal driven by per-wheel slip. Includes a spec tool that reports real-world performance (0-100 km/h, quarter mile, top speed, braking distance, gear speeds, suspension checks) and exports Luau, plus a Luau kit (chassis builder, physics sim on the driver's client, wheel visuals, engine sound, HUD, parked-car sleep, speed sanity checks). Use this whenever the user wants a car, kart, truck, racing or drift game, driving mechanics, vehicle chassis or suspension, acceleration, braking, top speed, gears, drifting, tire smoke or skid marks, handling tuning, or asks why their Roblox car gets stuck, flips, bounces, slides or feels floaty, even if they only say "make this car drivable".
---

# Roblox vehicles

Drivable vehicles have two halves that this skill keeps separate:

- **The chassis** (physics): an invisible root part plus four or more raycast suspensions, driven entirely by a **spec** of real-life variables. It's the same code for every car.
- **The body** (looks): any mesh or model. It only needs its wheels named so the builder can find them. Swap the body and the car drives identically; swap the spec and the same body drives like a different car.

That separation is what makes chassis reusable across meshes: performance never depends on part sizes or masses, only on the spec.

## How the physics works (short)

Per wheel, every physics step, on whoever owns the car (the driver's client, or the server when parked):

1. Sphere-cast down from the suspension mount (a sphere almost the tire's size, so wheels roll over kerbs and terrain steps; steep walls don't count as ground) → spring length.
2. Spring + damper force, tuned by **natural frequency (Hz)** and **damping ratio**, so suspension feel doesn't depend on the model's mass.
3. Anti-roll bars move force between left and right wheels.
4. Tire forces in real units: lateral grip from the **slip angle** through a simplified Pacejka curve, drive force from **torque curve × gear × final drive ÷ wheel radius**, brake force from **deceleration in g**, all capped by **grip × load** (friction circle).
5. Converted to Roblox forces on VectorForces; drag and downforce at the centre of mass.

Tires keep `slideGrip` of their grip while sliding, so drifts are holdable instead of collapsing into spins. Around all of it sits the never-stuck layer (below).

Engine, brakes, tires and drag use the spec's real mass and real gravity, then convert to Roblox units, so a car with 0–100 km/h in 4.2 s in the report does that in game. Suspension uses Roblox's own gravity. `references/vehicle-physics.md` has the full model and the unit bridge.

## Never stuck (hard requirement)

Players must always be able to keep driving. Every vehicle built with this skill gets, by default:
- **sphere-cast wheels** that ride over kerbs, cracks and terrain voxel steps, with wall hits rejected so cars don't climb walls
- **a hidden collision hull** instead of the body mesh: bottom no lower than the axles, rounded nose and tail cylinders, friction 0.08, so the car rides over, deflects off and slides along kerbs, trees, poles and barriers
- **a `VehicleIgnore` collision group** for grass, flowers, small rocks and debris (no collision, invisible to the wheels)
- **stuck assist**: throttle held but not moving for 1 s → lift and push; after 3 tries → recover a few studs back
- **auto-flip** when on its side or roof, **air control** that levels the car in jumps, and a **Reset** button (R / Y / touch) with a cooldown

Never ship a vehicle with these turned off for free-roam driving, with collision left on a detailed body mesh, or with hull friction above 0.3. Run every vehicle through the stuck test course in `references/anti-stuck.md` and fix the map where it fails (kerb heights, props, terrain spikes, gaps).

## Decide the mode

| The user wants... | Do this |
|---|---|
| A new car / vehicle class | Write a spec JSON (start from the closest file in `specs/`), run the report, tune until the numbers match the real vehicle or the intended feel, export Luau, set up the model. |
| "Make this model drivable" | Model checklist in `references/vehicle-setup.md`: wheel names, a VehicleSeat, tag and `Vehicle` attribute. Pick or write a spec. |
| Better handling / fix a problem | Symptom table in `references/tuning-guide.md` (flips, understeer, oversteer, bouncing, floaty, slow, wheelspin, can't stop). Change one variable at a time and re-run the report. |
| A racing / driving game | Kit install + specs per class + the game-design skill for the loop; `references/vehicle-setup.md` covers multiplayer, camera, HUD, sound, effects and anti-cheat. |
| Arcade vs simulation feel | `references/tuning-guide.md` §4 lists the dials (grip, steering speed, slip curve, anti-roll, roll centre, assists). |
| Drifting / a drift game | `references/drifting.md`: setup from `specs/drift_car.json`, assists per device, server-side scoring, smoke and skids. |
| "My car keeps getting stuck" | `references/anti-stuck.md`: protections, prohibited patterns, map rules, the test course. |
| Cars that knock over players and pedestrians | The `roblox-ragdoll` skill: its `ImpactService` sweeps every model tagged `Vehicle` (this kit's cars already are) and ragdolls anyone on foot hit above a closing speed, with launch and optional damage. |

## Specs and the report

```bash
node <skill>/scripts/rveh.cjs report specs/sports_car.json      # or a whole folder
node <skill>/scripts/rveh.cjs luau specs --out src/shared/Vehicle/VehicleSpecs.luau
```

A spec is plain JSON with real units (kg, m, N·m, rpm, km/h, g, Hz, degrees). Omitted fields use defaults. The report prints power (kW/hp, W/kg), 0–100 km/h, 0–60 mph, 0–60 km/h, quarter mile, top speed and what limits it (drag, redline, limiter), 100–0 km/h distance, cornering g, top speed per gear at redline, and suspension sag versus bump travel. Its `WARN` lines catch suspension that will bottom out, bouncy or over-damped settings, too-short first gear, and gearing that wastes the engine.

Bundled specs (verified by `scripts/selftest.cjs` to land in realistic ranges):

| Spec | Drive | 0–100 km/h | Top speed | 100–0 km/h |
|---|---|---|---|---|
| `Hatchback` | FWD, 117 hp, 1200 kg | 9.8 s | 197 km/h (drag) | 40 m |
| `SportsCar` | RWD, 411 hp, 1450 kg | 4.2 s | 290 km/h (limiter) | 34 m |
| `PickupTruck` | AWD, 379 hp, 2300 kg | 6.1 s | 180 km/h (limiter) | 45 m |
| `Kart` | RWD, 17 hp, 160 kg | 0–60 km/h 4.6 s | 88 km/h (redline) | 30 m |
| `DriftCar` | RWD, 374 hp, 1250 kg | 5.5 s | 251 km/h (redline) | 38 m |

Spec fields (all optional except `name`): `mass`, `frontWeight`, `comHeight` (m above ground), `wheelRadius` (m, used for gearing; the mesh's wheel size is only visual), `wheelbase` (m, report only), `drivetrain`, `awdFrontSplit`, `engine` {`idleRpm`, `redlineRpm`, `launchRpm`, `efficiency`, `speedLimitKmh`, `torqueCurve` [[rpm, N·m]...]}, `gearbox` {`ratios`, `reverse`, `finalDrive`, `shiftUpRpm`, `shiftDownRpm`, `shiftTime`}, `brakes` {`decelG`, `frontBias`, `handbrakeGripScale`}, `steering` {`maxAngle`, `speed`, `highSpeedScale`, `highSpeedKmh`}, `tires` {`gripFront`, `gripRear`, `stiffness`, `shape`, `slideGrip`, `rollingResistance`}, `drift` {`countersteer`, `maxAngle`, `stabilizer`}, `recovery` {`airControl`, `autoFlip`, `stuckAssist`}, `body` {`autoHull`, `hullFriction`}, `suspension` {`frequencyFront`, `frequencyRear`, `dampingRatio`, `maxLength` (studs), `rideHeight` (0–1), `antiRoll`, `rollCenter` (0–1)}, `aero` {`cd`, `area` (m²), `downforceCl`}.

## The kit

`assets/kit/` follows the `roblox-project-structure` layout (Loader starts Services and Controllers; the component binder handles the tag):

| File | Side | Does |
|---|---|---|
| `shared/Vehicle/VehicleSpecs.luau` | both | Generated from the spec JSONs. |
| `shared/Vehicle/VehicleMath.luau` | both | Torque curve, gearing, launch, auto-shift, drag, downforce, tire curve, spring maths, top speed, unit conversion. Mirrors `rveh.cjs`. |
| `shared/Vehicle/VehicleSim.luau` | both | The per-step physics for one chassis (sphere-cast suspension, anti-roll, tires with slide grip, friction circle, brakes, handbrake, steering with countersteer assist, drift stabilizer, gearbox, aero), the never-stuck layer (stuck assist, auto-flip, air control, `Recover()`), and telemetry (speed, rpm, gear, slip, drift angle, stuck). |
| `server/Services/VehicleService.luau` | server | Builds the chassis from any tagged model (with the rounded low-friction collision hull and the `VehicleHull` / `VehicleIgnore` collision groups), hands physics to the driver, simulates parked cars and puts them to sleep, flags impossible speeds (uses `roblox-security`'s Sanctions if present), `Spawn(name, cframe)`. |
| `client/Controllers/VehicleController.luau` | client | The driver's loop: VehicleSeat input (keyboard, gamepad, touch for free), handbrake on LeftShift / gamepad X / touch "Drift", Reset on R / gamepad Y / touch, sim step, speed-based FOV, HUD (speed, gear, rpm, drift score). |
| `client/Components/VehicleVisuals.luau` | client | For every nearby car: places, steers and spins wheels; tire smoke, skid marks and tire squeal from per-wheel slip; engine loop pitched by rpm. |

Install steps to give the user:
1. Copy `assets/kit` into `src`; export their specs into `src/shared/Vehicle/VehicleSpecs.luau` (or keep the bundled ones).
2. Prepare each car model: wheels named `WheelFL`, `WheelFR`, `WheelRL`, `WheelRR` (BaseParts or Models; more axles as `WheelRL2`...), a `VehicleSeat` (named `DriverSeat` if there are several), attribute `Vehicle` = spec name, tag `Vehicle`, optional attributes `EngineSound` and `TireSound` (looping audio ids), and `KeepCollision = true` only if the body's own collision must stay (it then has to pass the stuck test course). The model can face any direction; forward is worked out from front and rear wheels.
3. Put grass, flowers, small rocks and debris in the `VehicleIgnore` collision group (the service registers it).
4. Place it in Workspace, or put it in `ServerStorage.Assets.Vehicles` and call `VehicleService:Spawn(name, cframe)`.
5. Play, sit in the seat, drive. Tune the JSON, re-run the report, re-export.
6. Drive the stuck test course (`references/anti-stuck.md` §5) with every vehicle.

## What good looks like

- **Numbers you can name.** Each vehicle has a 0–100 time, top speed and braking distance you chose on purpose; classes are clearly different.
- **Weight you can feel.** Visible pitch under braking and acceleration, roll in corners, kept in check by anti-roll and roll centre.
- **Readable limits.** Tires that slide progressively (shape around 1.8–1.9), not snap; understeer at the limit for most road cars; oversteer only when provoked (handbrake, power in RWD).
- **No bounce, no float.** Damping ratio 0.3–0.45, frequency 2–3.5 Hz, no bottoming warnings.
- **Same feel for every body.** Swapping a mesh doesn't change the report or the drive.
- **Never stuck.** Every item on the stuck test course passes or escapes in under 5 s without the reset button.
- **Holdable slides.** A handbrake flick starts a drift that can be held with countersteer and throttle; spin-outs come from overdoing it, not from the tires giving up. Smoke and skid marks appear exactly when the tires are sliding.

## Limits to be honest about

- The Node report covers straight-line performance and braking on flat ground; cornering, roll and stability are checked by driving in Studio.
- Simplifications: no wheel rotational inertia or clutch model beyond launch rpm (so no true burnouts), a single slip curve per axle, and no tire temperature or wear. They're deliberate: they keep the car stable and tunable at Roblox physics rates.
- The kit's Luau is reviewed but has not been run in Studio as part of building this skill. Test with Studio's Play (and a second client) before shipping, and adjust `METERS_PER_STUD` only if the game uses a different world scale.
- Roblox gravity (196.2 studs/s²) is stronger than real gravity at 0.28 m per stud, so jumps arc faster than a real car's; the suspension is tuned for Roblox's gravity on purpose.

## References

- `references/vehicle-physics.md` — the complete model: unit bridge, suspension, anti-roll, roll centre, tires and slip, friction circle, powertrain, gearbox, brakes, steering, aero, and why raycast suspension over constraints.
- `references/tuning-guide.md` — real-world reference values by vehicle class, the handling-balance levers, symptom → fix table, arcade vs sim presets, drift and off-road setups.
- `references/anti-stuck.md` — why Roblox cars get stuck, every protection and its tuning, prohibited patterns, map and road rules, the stuck test course.
- `references/drifting.md` — drift physics, the drift setup, assists per device, server-side scoring, tire smoke, skid marks and squeal.
- `references/vehicle-setup.md` — model requirements and reuse across meshes, seats and passengers, spawning, ownership and multiplayer, controls on every device, camera, HUD, sound, effects (skids, smoke, exhaust), anti-cheat, performance, troubleshooting.
- `specs/` — example specs. `scripts/rveh.cjs` — report and Luau export. `scripts/selftest.cjs` — checks.
