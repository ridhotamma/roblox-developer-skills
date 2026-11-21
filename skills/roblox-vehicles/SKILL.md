---
name: roblox-vehicles
description: Build Roblox vehicles that handle like real ones and play like GTA - cars, karts, trucks, motorcycles, dirt bikes, speedboats, jet skis, fishing boats, light planes, jet fighters, helicopters, tanks and trains - from one reusable kit where every vehicle is a spec of real-life variables and any mesh becomes drivable by naming its parts. Cars - raycast suspension, torque curve, gears, tire slip and friction circle, drifting, never-stuck hull and assists. Motorcycles - lean to turn (tan φ = vω/g), camber thrust, wheelies and stoppies at the real g·b/h limits, cornering ABS, bail-off with ragdoll. Boats - buoyancy at the spec draft, planing and the resistance hump, props and water jets, waves. Planes - lift curve, stall, drag polar, ground effect, props and afterburning jets, gear, flaps, stall protection, point-to-fly. Helicopters - momentum theory with translational lift, power-limited climb, ground effect, blade stall, altitude hold. Tanks - sprung track contacts, the tractive-effort hyperbola, skid steering with pivot turns and the μWL/4 turning moment, idlers that climb steps, a stabilised camera-aimed turret, recoil and server-checked shots. Trains - tractive effort and adhesion, Davis, grade and curve resistance, service and emergency brakes, cars on bogies along a spline track, cant, derailment at the overturning speed, re-railing. Includes a spec tool reporting real-world performance per type (0-100, top speed, braking, wheelie limit, planing, stall speed, climb, hover power, ground pressure, pivot time, balancing speed, stopping distance, derailment speed) and exporting Luau, a Luau kit (builder, client physics, keyboard, gamepad and touch controls, HUD, visuals, anti-cheat) and a tested JS lab. Use this whenever the user wants any drivable, rideable, sailable or flyable vehicle in Roblox, a tank or a railway, vehicle physics or handling, or asks why their car, bike, boat, plane, helicopter, tank or train gets stuck, flips, sinks, won't take off, wobbles or feels floaty, even if they only say "make this drivable" or "add a train".
---

# Roblox vehicles

Drivable vehicles have two halves that this skill keeps separate:

- **The chassis** (physics): an invisible root part at the centre of mass carrying all the mass, driven entirely by a **spec** of real-life variables. It's the same code for every vehicle of a type.
- **The body** (looks): any mesh or model. It only needs its wheels (or rotors, propellers, skids, tracks, turret, train cars) named so the builder can find them. Swap the body and the vehicle handles identically; swap the spec and the same body handles like a different vehicle.

That separation is what makes chassis reusable across meshes: performance never depends on part sizes or masses, only on the spec.

## Vehicle types

A spec's `type` picks the physics. Each type has a theory reference: read it before building or tuning one.

| Type | Sim | How it works (short) | Reference |
|---|---|---|---|
| `Car` (default) | `VehicleSim` | Sphere-cast suspension per wheel, tire slip + friction circle, engine torque curve and gears, drifting, never-stuck layer. Lives in Roblox gravity with slope and load-transfer corrections. | below, `vehicle-physics.md` |
| `Motorcycle` | `BikeSim` | Two sphere-cast wheels, forces at the contact patches; the stick asks for a lean and the rider steers the turn that balances it (δ = atan(L g tan φ / v²) / cos φ); camber thrust; free pitch, so wheelies and stoppies happen at the real g·b/h limits; wheelie/stoppie control, cornering ABS, bail-off. | `motorcycle-physics.md` |
| `Boat` | `BoatSim` | Buoyancy columns over the hull (floats at the spec's draft), planing lift that saturates at full planing speed, friction + wave hump + planing drag, keel and chines, momentum-theory prop or jet, rudder lift, inward banking, waves. | `boat-physics.md` |
| `Plane` | `PlaneSim` | Lift curve with stall, drag polar with ground effect and Mach rise, prop (momentum theory) or jet with afterburner, landing gear; GTA-style control layer: follow the flight path, stick sets angle of attack, stall protection, wings-level, auto-rudder. | `airplane-physics.md` |
| `Helicopter` | `HeliSim` | Rotor thrust limited by engine power through momentum theory with Glauert inflow (translational lift), profile power, ground effect, retreating-blade stall; altitude-hold collective, self-levelling cyclic, hover hold, coordinated yaw, rotor spool. | `helicopter-physics.md` |
| `Tank` | `TankSim` | Each track sampled by sprung sphere-cast contacts plus raised idler and sprocket (rigid past full travel, so it climbs ~1 m steps); the sticks set track speeds like a steering unit, driven within traction, brakes and net engine power (the tractive-effort hyperbola, regenerative steering); per-contact friction makes the skid-steer moment μ W L / 4 emerge, so long hulls fight turns; pivot turns; a turret and gun that hold a world aim (stabilised) at their traverse and elevation rates; recoil at the trunnion. | `tank-physics.md` |
| `Train` | `TrainSim` + `TrainTrack` | The consist is one body along a Catmull-Rom track: tractive effort min(starting limit, adhesion, η P / v) with wheelslip, Davis resistance, grade and Röckl curve resistance per car, notched power and brake levers, service and emergency brakes. Each car is its own assembly held on its bogie chord (cant included) by a stiff PD, so it shoves what's on the line; overspeed in a curve (unbalanced lateral acceleration past the limit) derails it, and Reset re-rails. | `train-physics.md` |

Motorcycles, boats, planes, helicopters and tanks live in **real gravity** (an upward force cancels the part of `Workspace.Gravity` beyond 9.81 m/s²), so lift, buoyancy, wheelie limits, lean balance and suspension sag are the real vehicle's, and every assist is a 0–1 dial in the spec, from GTA-arcade to sim. Train cars ride the track until they derail; then they fall in real gravity too.

## How the car physics works (short)

Per wheel, every physics step, on whoever owns the car (the driver's client, or the server when parked):

1. Sphere-cast down from a wheel radius above the suspension mount (a sphere almost the tire's size, so wheels roll over kerbs and terrain steps; steep walls don't count as ground; starting high means a hard landing never starts the cast inside the ground) → spring length.
2. Spring + damper force, tuned by **natural frequency (Hz)** and **damping ratio**, so suspension feel doesn't depend on the model's mass, pushed along the ground normal.
3. Real-world load transfer (squat, dive, lean) and anti-roll bars move force between the wheels.
4. Tire forces in real units: lateral grip from the **slip angle** through a simplified Pacejka curve, drive force from **torque curve × gear × final drive ÷ wheel radius**, brake force from **deceleration in g**, all capped by **grip × load** (friction circle).
5. Converted to Roblox forces on VectorForces; drag and downforce at the centre of mass.

Tires keep `slideGrip` of their grip while sliding, so drifts are holdable instead of collapsing into spins. Around all of it sits the never-stuck layer (below).

Engine, brakes, tires and drag use the spec's real mass and real gravity, then convert to Roblox units, so a car with 0–100 km/h in 4.2 s in the report does that in game. Suspension uses Roblox's own gravity, which is ~5.6× real gravity at 0.28 m per stud, so the sim corrects the two places where that would show: it cancels the excess gravity along the ground (hills hold and climb like real ones instead of sliding past ~10°) and adds the missing part of the load transfer (so braking, launches and cornering get real weight shift and the body visibly pitches and rolls). Stopped with no pedal, a hill hold brakes all four wheels. `references/vehicle-physics.md` has the full model and the unit bridge.

## Never stuck (hard requirement)

Players must always be able to keep driving. The other types get the same idea in their own form: a low-friction rounded hull (a narrow one above 1.4 wheel radii for bikes, so a 50° lean never scrapes; above the track tops for tanks, so the tracks climb what the hull would snag on), auto-upright, Reset, and bikes standing back up, boats pushing off beaches and righting themselves, aircraft flipping back onto their gear when stopped, tanks getting a push when stuck (never into a wall), trains re-railing at the nearest point. Every car built with this skill gets, by default:
- **sphere-cast wheels** that ride over kerbs, cracks and terrain voxel steps, with wall hits rejected so cars don't climb walls
- **a hidden collision hull** instead of the body mesh: bottom no lower than the axles, rounded nose and tail cylinders, friction 0.08, so the car rides over, deflects off and slides along kerbs, trees, poles and barriers
- **a `VehicleIgnore` collision group** for grass, flowers, small rocks and debris (no collision, invisible to the wheels)
- **stuck assist**: throttle held but not moving for 1 s → lift and push; after 3 tries → recover a few studs back (never while pressing into a wall)
- **impact softening** and a zero-bounce hull: wall, pole and car hits glance the car along instead of spinning it away, flipping it or popping it up
- **auto-flip** when on its side or roof, **air control** (lighter in-air gravity for hang time, a smooth rate-capped turn toward the landing surface), and a **Reset** button (R / Y / touch) with a cooldown

Never ship a vehicle with these turned off for free-roam driving, with collision left on a detailed body mesh, or with hull friction above 0.3. Run every vehicle through the stuck test course in `references/anti-stuck.md` and fix the map where it fails (kerb heights, props, terrain spikes, gaps).

## Decide the mode

| The user wants... | Do this |
|---|---|
| A new car / vehicle class | Write a spec JSON (start from the closest file in `specs/`), run the report, tune until the numbers match the real vehicle or the intended feel, export Luau, set up the model. |
| A motorcycle, boat, plane or helicopter | Read that type's physics reference, copy the closest spec (`sport_bike`, `dirt_bike`, `speedboat`, `jet_ski`, `fishing_boat`, `light_plane`, `jet_fighter`, `light_heli`, `attack_heli`), run the report, set up the model (the reference's last section). |
| A tank | `tank-physics.md`; copy `main_battle_tank` or `light_tank`; model with `TrackL`/`TrackR`, `Turret`, `Gun` (+ `Muzzle` attachment); connect `VehicleService.Fired` to the game's projectiles (the `roblox-combat` skill) or keep `gun.defaultShell` for prototyping. |
| A train, tram or railway | `train-physics.md`; copy `passenger_train`, `freight_train` or `tram`; lay a `TrainTrack` (numbered nodes, tag `TrainTrack`, `TrainTrack.BuildRails` for prototype rails); model the cars as `Car1`, `Car2`... inside the train; switches by setting the train's `Track` attribute. |
| "Make this model drivable / flyable" | Model checklist in `references/vehicle-setup.md` §1: wheel / rotor / skid names, the pivot facing forward, a VehicleSeat, tag and `Vehicle` attribute. Pick or write a spec. |
| Better handling / fix a problem | Cars: symptom table in `references/tuning-guide.md`. Other types: the "symptom → fix" table in their reference. Change one variable at a time and re-run the report. |
| GTA-like vs simulation | Cars: `tuning-guide.md` §4. Others: the `assists` block (bikes: `wheelie.assist`, `assists.stability`; boats: `assists.stability`, `recovery.selfRight`; planes: `stallProtection`, `autoTrim`, `autoLevel`, `coordination`; helicopters: `altitudeHold`, `level`, `hoverHold`, `coordination`, `realism.vortexRing`). |
| A racing / driving / open-world game | Kit install + specs per class + the game-design skill for the loop; `references/vehicle-setup.md` covers multiplayer, camera, HUD, sound, effects and anti-cheat. |
| Drifting / a drift game | `references/drifting.md`: setup from `specs/drift_car.json`, assists per device, server-side scoring, smoke and skids. |
| Water, an ocean, terrain water | `boat-physics.md` §8: the `SeaLevel` / `WaveHeight` attributes, terrain water, or `Water.SetHeightFunction` for a custom ocean. |
| "My car keeps getting stuck" | `references/anti-stuck.md`: protections, prohibited patterns, map rules, the test course. |
| Riders thrown off bikes, pedestrians knocked over | The `roblox-ragdoll` skill: `VehicleService` ragdolls a bailing rider with its `RagdollService` when installed, and its `ImpactService` sweeps every model tagged `Vehicle`. |

## Specs and the report

```bash
node <skill>/scripts/rveh.cjs report specs/sports_car.json      # or a whole folder
node <skill>/scripts/rveh.cjs luau specs --out src/shared/Vehicle/VehicleSpecs.luau
```

A spec is plain JSON with real units (kg, m, N·m, rpm, km/h, g, Hz, kW, kN, degrees) and a `type`. Omitted fields use defaults. The report prints what matters for the type, from the same physics the kit runs, with `WARN` lines for specs that will misbehave:

- **Car**: power, 0–100 km/h, 0–60 mph, quarter mile, top speed and what limits it, 100–0 km/h distance (per-axle braking with load transfer), cornering g, gear speeds, suspension sag versus bump travel.
- **Motorcycle**: the same plus the wheelie and stoppie limits (g·b/h), which one limits launch and braking, grip and clearance lean limits, turn radius at 50 and 100 km/h.
- **Boat**: displacement, draft, wetted area, hull speed, hump speed and resistance, full-planing speed, static thrust, top speed and what limits it (resistance, the hump, the hull-speed wall, a limiter), 0–30 / 0–50 km/h, time to plane, GM, heave and roll periods.
- **Plane**: wing loading, aspect ratio, lift slope, stall angle and speeds (clean, flaps), takeoff roll and lift-off speed, top speed (and with afterburner), best climb rate and speed, best L/D, corner speed and turn rate.
- **Helicopter**: disk loading, hover downwash, hover power out of and in ground effect, power margin, vertical climb, the minimum-power speed and climb rate there, top speed and whether power or blade stall limits it.
- **Tank**: power-to-weight, ground pressure, steering ratio L/B and the turning moment, tractive effort at a standstill and at top speed, 0–32 / 0–50 km/h, top speed and what limits it, 40–0 km/h, steepest slope, pivot force, power and time, turret 360° time, recoil Δv.
- **Train**: consist and power-to-weight, starting tractive effort and acceleration, where power takes over from adhesion, 0–50 / 0–100 km/h (time and distance), top speed, balancing speeds on 1% and 2%, the ruling grade, service and emergency stopping distances, derailment speeds in 150 / 300 / 600 m curves.

Bundled specs (verified by `scripts/selftest.cjs` to land in real-world ranges, and by the lab to do the same in the sim):

| Spec | Type | Key numbers (report) |
|---|---|---|
| `Hatchback` | Car | FWD, 117 hp, 1200 kg · 0–100 9.8 s · 197 km/h (drag) · 100–0 41 m |
| `SportsCar` | Car | RWD, 411 hp, 1450 kg · 0–100 4.2 s · 290 km/h (limiter) · 100–0 35 m |
| `PickupTruck` | Car | AWD, 379 hp, 2300 kg · 0–100 6.1 s · 180 km/h (limiter) · 100–0 45 m |
| `Kart` | Car | RWD, 20 hp, 160 kg · 0–60 km/h 4.6 s · 88 km/h (redline) · 100–0 30 m |
| `DriftCar` | Car | RWD, 374 hp, 1250 kg · 0–100 5.5 s · 251 km/h (redline) · 100–0 38 m |
| `ArcadeCar` | Car | AWD, 279 hp, 1300 kg · 0–100 4.2 s · 240 km/h (limiter) · 100–0 32 m |
| `SportBike` | Motorcycle | 1000 cc superbike + rider, 197 hp, 280 kg · 0–100 2.8 s · 299 km/h (limiter) · 100–0 34 m · wheelie at 1.13 g · 50° lean |
| `DirtBike` | Motorcycle | 450 cc enduro + rider, 59 hp, 195 kg · 0–100 3.5 s · 164 km/h · long travel |
| `Speedboat` | Boat | 6.2 m runabout, 250 hp outboard, 1800 kg · draft 0.30 m · planes at ~34 km/h · 86 km/h · 0–50 km/h 4.3 s |
| `JetSki` | Boat | 3.3 m PWC + rider, water jet, 450 kg · 108 km/h (limiter) · 0–50 km/h 1.6 s |
| `FishingBoat` | Boat | 10 m displacement workboat, inboard + rudder, 9 t · 17 km/h (hull-speed wall) |
| `LightPlane` | Plane | Cessna 172S-class at gross weight · stall 54 kt (POH 53) · 124 kt top (POH 126) · 3.5 m/s climb (POH 3.7) · 258 m roll (POH 293) |
| `JetFighter` | Plane | F-16-class, 76/127 kN · stall 236 km/h · 1225 km/h dry, 1400 km/h afterburner · 249 m/s climb |
| `LightHeli` | Helicopter | Bell 206-class, skids · hover 197 kW of 236 · 6.1 m/s vertical climb · 205 km/h |
| `AttackHeli` | Helicopter | Apache-class, wheels · hover 1683 kW of 2100 · 10.9 m/s vertical climb · 301 km/h (blade stall) |
| `MainBattleTank` | Tank | Abrams-class, 62 t, 1,120 kW · 104 kPa · 0–32 km/h 6.5 s · 67 km/h (governor) · 70% slope · 360° pivot 14 s · turret 360° in 9 s |
| `LightTank` | Tank | CV90-class, 25 t, 450 kW · 64 kPa · 0–32 km/h 5.6 s · 70 km/h · turret 50°/s, −8°/+35° |
| `PassengerTrain` | Train | 125 t loco + 5 × 50 t coaches, 3.6 MW · 0–100 km/h 58 s · 200 km/h (limit) · 177 km/h on 1% · 1144 m emergency stop from 200 · derails at 116 km/h in a 300 m curve |
| `FreightTrain` | Train | ES44AC-class, 190 t + 10 × 100 t, 810 kN starting · 0–100 km/h 208 s · 71 km/h on 1% · starts on 6.8% |
| `Tram` | Train | 40 t single unit, 480 kW · 1.24 m/s² start · 0–50 km/h 13 s · 70 km/h (limit) · track brakes 2.5 m/s² |

`ArcadeCar` is the planted, keyboard-friendly car tune: full stability assist, high grip with the rear 14% above the front, high slide grip, a stabilizer that catches slides past 15°, and 2 g air gravity for GTA-like hang time. Start from it when players say the cars feel slippery (tuning-guide.md, "Arcade / stable"). `JetFighter` has no speed limiter: at 1400 km/h it crosses a 10,000-stud map in 7 s, so most games set `engine.speedLimitKmh`.

Car spec fields (all optional except `name`): `mass`, `frontWeight`, `comHeight` (m above ground), `wheelRadius` (m, used for gearing; the mesh's wheel size is only visual), `wheelbase` (m, report only), `drivetrain`, `awdFrontSplit`, `engine` {`idleRpm`, `redlineRpm`, `launchRpm`, `efficiency`, `speedLimitKmh`, `torqueCurve` [[rpm, N·m]...]}, `gearbox` {`ratios`, `reverse`, `finalDrive`, `shiftUpRpm`, `shiftDownRpm`, `shiftTime`}, `brakes` {`decelG`, `frontBias`, `handbrakeGripScale`}, `steering` {`maxAngle`, `speed`, `highSpeedScale`, `highSpeedKmh`}, `tires` {`gripFront`, `gripRear`, `stiffness`, `shape`, `slideGrip`, `rollingResistance`}, `drift` {`countersteer`, `maxAngle`, `stabilizer`}, `recovery` {`airControl`, `airGravity` (g in the air, default 2.5), `airInput` (deg/s of GTA-style air steering: W/S pitch, A/D roll, handbrake + A/D spin; 0 = off), `autoFlip`, `stuckAssist`}, `assists` {`stability` (0–1, GTA/ESC-style yaw assist, default 0.6)}, `body` {`autoHull`, `hullFriction`}, `suspension` {`frequencyFront`, `frequencyRear`, `dampingRatio`, `maxLength` (studs), `rideHeight` (0–1), `antiRoll`, `rollCenter` (0–1)}, `aero` {`cd`, `area` (m²), `downforceCl`}. The other types' fields are listed in their references (section "Spec fields").

## The kit

`assets/kit/` follows the `roblox-project-structure` layout (Loader starts Services and Controllers; the component binder handles the tag):

| File | Side | Does |
|---|---|---|
| `shared/Vehicle/VehicleSpecs.luau` | both | Generated from the spec JSONs (every type). |
| `shared/Vehicle/VehicleMath.luau` | both | Car (and motorcycle) powertrain, drag, tire curve, spring maths, top speed, unit conversion. Mirrors `rveh.cjs`. |
| `shared/Vehicle/VehicleSim.luau` | both | The car: sphere-cast suspension, anti-roll, tires with slide grip, friction circle, brakes, handbrake, steering with countersteer assist, drift stabilizer, gearbox, aero, the never-stuck layer and telemetry. |
| `shared/Vehicle/BikeSim.luau` | both | The motorcycle (motorcycle-physics.md §7). |
| `shared/Vehicle/BoatSim.luau` | both | The boat (boat-physics.md §7). |
| `shared/Vehicle/PlaneSim.luau` | both | The plane (airplane-physics.md §10), plus `AimInput` for point-to-fly. |
| `shared/Vehicle/HeliSim.luau` | both | The helicopter (helicopter-physics.md §7). |
| `shared/Vehicle/TankSim.luau` | both | The tank (tank-physics.md §9): track contacts, steering unit, power and traction limits, turret and gun, recoil. |
| `shared/Vehicle/TrainSim.luau` | both | The train (train-physics.md §8): the longitudinal model, levers, every car held on its place on the track, derailment, re-railing, switching tracks on the `Track` attribute. |
| `shared/Vehicle/TrainTrack.luau` | both | Railway track from numbered nodes: Catmull-Rom spline, arc-length samples (position, tangent, curvature, cant, grade, speed limit), nearest point, `Find`, `BuildRails`. |
| `shared/Vehicle/Gear.luau` | both | Landing gear and skids: sprung contacts, wheel or skid friction, brakes, nose-wheel steering. |
| `shared/Vehicle/Water.luau` | both | Water surface: custom function, `SeaLevel` + waves (server-time phased), or terrain water. |
| `shared/Vehicle/SimUtil.luau` | both | Shared plumbing: force/torque accumulator, real gravity, rate tracking, momentum-theory thrust, atmosphere, recover. |
| `shared/Vehicle/Sims.luau` | both | Picks the sim for a model from its spec's `type`; speed ceilings for the anti-cheat. |
| `server/Services/VehicleService.luau` | server | Builds any tagged model (root at the spec's centre of mass, rounded low-friction hull, wheel / gear / skid mounts, rotor and control-surface visuals, `EnableFluidForces` off), hands physics to the driver, simulates and sleeps empty vehicles (hill hold, kickstand, parking brake, rotor wind-down, floating), puts seated players in the `VehicleRider` collision group, receives the `VehicleControl` remote (throttle, gear, flaps, bike bail-offs with optional ragdoll, turret aim, train horn), validates tank shots (driver, reload, from the muzzle along the gun) and fires `VehicleService.Fired(player, model, origin, direction, gun)`, builds tanks (track contacts, turret and gun visuals) and trains (one assembly per car, snapped onto the nearest track, all owned by the driver), flags impossible speeds (uses `roblox-security`'s Sanctions if present), `Spawn(name, cframe)`. |
| `client/Controllers/VehicleController.luau` | client | The driver's loop for every type: seat input plus per-type actions on keyboard, gamepad and touch (bound at High priority), the sim step, speed-based FOV, a HUD per type (speed, gear/rpm, throttle, altitude, vertical speed, rotor, stall, wheelie, drift score, reload and turret, power and brake levers, grade, speed limit, derailed), Reset, the control remote, bike bail-offs, tank aim (the camera) and fire, train horn and emergency brake, optional `AIM_FLIGHT` point-to-fly for planes. |
| `client/Components/VehicleVisuals.luau` | client | For every nearby vehicle: wheels (steered, spun, hidden when the gear is up), tire smoke, skid marks and squeal, spinning rotors and propellers, hinged ailerons, elevators, rudders and flaps, boat wake and bow spray, rotor downwash dust, turret traverse and gun elevation (eased for other players), gun recoil, muzzle flash and smoke, track textures scrolling and road wheels rolling with each track's speed, train horn, engine sound per type. |

Install steps to give the user:
1. Copy `assets/kit` into `src`; export their specs into `src/shared/Vehicle/VehicleSpecs.luau` (or keep the bundled ones).
2. Prepare each model (`references/vehicle-setup.md` §1): a `VehicleSeat` (named `DriverSeat` if there are several), attribute `Vehicle` = spec name, tag `Vehicle`, optional `EngineSound` / `TireSound` attributes, and per type: cars `WheelFL/FR/RL/RR` (more axles `WheelRL2`...); motorcycles `WheelF` + `WheelR`; planes gear wheels (`WheelF` + `WheelRL/RR`, or `WheelFL/FR` + `WheelR` for a tail-dragger) and optional `Propeller`, `Aileron*`, `Elevator`, `Rudder`, `Flap*`; helicopters `Skid*` parts or gear wheels, `MainRotor`, `TailRotor`; boats nothing extra (the lowest body point is the keel); tanks `TrackL` + `TrackR`, `Turret`, `Gun` with a `Muzzle` attachment, optional `WheelL*` / `WheelR*` road wheels; trains the lead's parts plus child models `Car1`, `Car2`... in a line behind it. Except cars, the model's pivot must face forward (LookVector to the nose or bow).
3. Put grass, flowers, small rocks and debris in the `VehicleIgnore` collision group (the service registers it).
4. Boats: set the `Workspace` attribute `SeaLevel` (studs) for a sea plane, optionally `WaveHeight` / `WaveLength` / `WaveDirection`, or use terrain water; place the boat with its keel at the surface.
5. Trains: lay a track (a Folder tagged `TrainTrack` with Parts or Attachments named 1, 2, 3... at rail-top height, `Loop` / `DesignSpeedKmh` attributes; `TrainTrack.BuildRails(TrainTrack.FromInstance(folder))` for prototype rails) and place the train roughly on it; the builder snaps it on.
6. Place it in Workspace, or put it in `ServerStorage.Assets.Vehicles` and call `VehicleService:Spawn(name, cframe)`.
7. Play, sit in the seat, drive or fly. Tune the JSON, re-run the report, re-export.
8. Cars: drive the stuck test course (`references/anti-stuck.md` §5) with every car.

## What good looks like

- **Numbers you can name.** Each vehicle has numbers you chose on purpose (0–100, top speed, braking distance, stall speed, climb rate, hover margin) and classes are clearly different.
- **Weight you can feel.** Cars pitch under braking and roll in corners; bikes lean exactly as far as the turn needs; boats lift their bow over the hump, then settle on the plane; planes float in ground effect; helicopters climb through translational lift; tanks squat, dive and rock when they fire; a freight train takes minutes to reach speed and a kilometre to stop.
- **Readable limits.** Tires slide progressively; a bike runs wide instead of washing out; a plane stalls and recovers; a helicopter runs out of power climbing; a tank's turret lags a fast camera; a train derails only past the curve's speed.
- **No bounce, no float, no snap.** Damped springs, porpoise-free hulls, no wobble in hover, no overshoot past the stall.
- **Same feel for every body.** Swapping a mesh doesn't change the report or the handling.
- **Never stuck.** Cars pass the stuck test course; bikes stand back up, boats push off beaches and right themselves, aircraft flip back onto their gear when stopped, and Reset always works.
- **GTA by default, sim on request.** Assists are on by default (stability, wheelie control, cornering ABS, anti-capsize, stall protection, auto-coordination, altitude hold, self-levelling); every one is a 0–1 dial.

## Limits to be honest about

- The Node report covers straight-line and steady-state performance; handling is checked by driving. A Three.js lab in the repo (`examples/roblox-vehicles`, `node lab/run-tests.cjs`) runs JS ports of every sim (`VehicleSim` for cars; `BikeSim`, `BoatSim`, `PlaneSim`, `HeliSim` in `lab/airsea.js`; `TankSim`, `TrainSim`, `TrainTrack` in `lab/heavy.js`) on a Roblox-like rigid body against every bundled spec and replays each run in 3D: 331 checks, from launch, braking, drifting and the stuck course to balanced lean, wheelies, floating at the spec draft, planing, waves, takeoff, stall recovery, 45° turns holding altitude, point-to-fly, hover hold, ground effect, tank pivots, steps, slopes, walls, turret stabilisation and recoil, and train launches, balancing speeds, stopping distances, curves, hills, derailment, cant and re-railing. Re-port and re-run it after changing a sim.
- The kit's Luau has been type-checked with luau-lsp against the Roblox API and checked through those JS ports, but not run in Studio as part of building this skill. Test with Studio's Play (and a second client) before shipping, and adjust `METERS_PER_STUD` only if the game uses a different world scale.
- Cars: no wheel rotational inertia or clutch model beyond launch rpm (so no true burnouts), a single slip curve per axle, no tire temperature or wear. Roblox gravity (196.2 studs/s²) is stronger than real gravity at 0.28 m per stud; the car suspension is tuned for it on purpose, with slope and load-transfer corrections.
- Motorcycles: balance is an assist (the contact patches' roll torque is cancelled while ridden), not countersteer dynamics, trail or gyroscopic precession; that is what GTA and most games do.
- Boats: the hull is a column grid with an analytic resistance curve (Froude-number hump, planing drag, ITTC friction), not per-triangle pressure; no added mass, slamming loads or wave-driven drift. Roblox's own terrain-water buoyancy still acts slightly on boats in terrain water (kept to ~1–2% of the weight by a dense root).
- Planes: stability-derivative moments are replaced by a rate-tracking control layer (follow the flight path, steer the angle of attack); no spins, adverse yaw, P-factor or wing drop. Helicopters: rotor torque reaction and autorotation aren't modelled, vortex ring state is optional, and the cyclic tilt is the body tilt.
- Tanks: tracks are sampled contacts, not linked track shoes; no soil sinkage or bulldozing (rolling resistance is one number), no gear changes (the tractive-effort hyperbola stands in for the gearbox). The default shell is a hitscan raycast for prototyping; real projectiles come from your combat code through `VehicleService.Fired`.
- Trains: the consist is one longitudinal body (no coupler slack, run-in forces or brake-pipe propagation); cars are held on the track by forces, so a very heavy obstacle can push a car off its place for a moment; derailment is by lateral acceleration only (no flange climb from track faults). Switches are separate tracks chosen with the train's `Track` attribute, not a junction graph.

## References

- `references/vehicle-physics.md` — the car model: unit bridge, suspension, anti-roll, roll centre, tires and slip, friction circle, powertrain, gearbox, brakes, steering, aero, and why raycast suspension over constraints.
- `references/motorcycle-physics.md` — lean and countersteer, turn radius, camber thrust, wheelie and stoppie limits, self-stability, how GTA does bikes, the kit's model, spec fields, tuning, setup and controls.
- `references/boat-physics.md` — buoyancy and stability, resistance, hull speed and the hump, planing, propellers and jets, steering, waves, how GTA and Just Cause do boats, the kit's model, water sources, spec fields, tuning, setup and controls.
- `references/airplane-physics.md` — lift, stall, drag polar, props and jets, performance, turning, stability and control, ground effect, flaps and gear, how GTA and War Thunder do planes, the kit's model, spec fields, tuning, setup and controls.
- `references/helicopter-physics.md` — collective, cyclic and pedals, momentum theory, the power bucket, translational lift, ground effect, vortex ring state, blade stall, how GTA does helicopters, the kit's model, spec fields, tuning, setup and controls.
- `references/tank-physics.md` — ground pressure, the tractive-effort hyperbola, track resistance, skid steering and the turning moment, suspension and obstacles, turret stabilisation, recoil, how GTA and War Thunder do tanks, the kit's model, spec fields, tuning, setup and controls.
- `references/train-physics.md` — tractive effort and adhesion, the Davis equation, grades and curves, braking, cant and derailment, bogies and consists, how San Andreas and train simulators do it, the kit's model, track setup, spec fields, tuning, controls.
- `references/tuning-guide.md` — real-world reference values by vehicle class, the handling-balance levers, symptom → fix table, arcade vs sim presets, drift and off-road setups.
- `references/anti-stuck.md` — why Roblox cars get stuck, every protection and its tuning, prohibited patterns, map and road rules, the stuck test course.
- `references/drifting.md` — drift physics, the drift setup, assists per device, server-side scoring, tire smoke, skid marks and squeal.
- `references/vehicle-setup.md` — model requirements and reuse across meshes, seats and passengers, spawning, ownership and multiplayer, controls on every device, camera, HUD, sound, effects (skids, smoke, exhaust), anti-cheat, performance, troubleshooting.
- `specs/` — example specs for every type. `scripts/rveh.cjs` — report and Luau export (`scripts/types/*.cjs` hold the motorcycle, boat, plane, helicopter, tank and train maths). `scripts/selftest.cjs` — checks.
