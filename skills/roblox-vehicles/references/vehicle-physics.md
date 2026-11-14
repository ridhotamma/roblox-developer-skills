# Vehicle physics model

## Contents
1. Why raycast suspension
2. Units and the bridge to Roblox
3. Chassis and centre of mass
4. Suspension: frequency, damping, ride height
5. Anti-roll bars and roll centre
6. Tires: load, slip angle, slip curve, friction circle
7. Powertrain: torque curve, gearing, launch, shifting, limiter
8. Brakes and handbrake
9. Steering
10. Aerodynamics and resistance
11. What's simplified

---

## 1. Why raycast suspension

Roblox offers two ways to build cars:

| | Constraint chassis (wheels as parts on hinges and springs) | Raycast chassis (this kit) |
|---|---|---|
| Wheels | real cylinders with physics | visual only |
| Grip | Roblox's contact friction | an explicit tire model you tune |
| Tuning | indirect (part friction, motor torque, spring constants tied to part mass) | real variables (torque curve, gears, grip, Hz, damping ratio) |
| Stability at speed | wheels can jitter, bounce or clip through thin geometry | stable; only casts touch the ground |
| Kerbs and terrain | wheels catch on vertical faces | sphere casts roll over steps up to ~0.5× the wheel radius |
| Reuse across models | spring/motor values change with part masses | spec is mass-independent |
| Cost | many constraints per car | 4–8 raycasts per car per step |

Constraint chassis are fine for slow, physics-toy vehicles. For anything that should feel like a car, raycast suspension is the standard choice in game engines, including most Roblox racing games.

## 2. Units and the bridge to Roblox

- Length: 1 stud = 0.28 m (`METERS_PER_STUD`, Roblox's avatar scale). Speeds shown in km/h use it.
- Horizontal dynamics (engine, brakes, tires, drag, rolling resistance) are computed in **SI with the spec's mass and real gravity (9.81 m/s²)**, then converted:

```
robloxForce = newtons × (assemblyMass / spec.Mass) / METERS_PER_STUD
```

  This turns a force into "the acceleration it would give the real car", expressed in studs/s² on whatever mass the Roblox assembly has. Part masses and densities don't matter.
- Vertical dynamics (suspension) live in **Roblox's gravity** (`Workspace.Gravity`, 196.2 studs/s² by default). Springs are tuned by frequency, which is mass-independent, and the rest length is solved so the car sits at its ride height under Roblox gravity.
- Tire load is measured from the spring force relative to its static value (`loadRatio`), then applied to the real static weight on that wheel. Weight transfer from braking, cornering and bumps comes out of the physics automatically.
- **The gravity mismatch.** 196.2 studs/s² × 0.28 m = 54.9 m/s², about 5.6× real gravity, while every horizontal force is real. Left alone that breaks two things, and the sim corrects both:
  - *Slopes.* The downhill pull would be 5.6× too strong relative to tire grip: past ~10° nothing holds, even on four locked wheels, and hill starts slide backwards. While grounded, the sim adds `mass × (Workspace.Gravity − 9.81 / 0.28) × (ŷ − n (n·ŷ))` (n = average ground normal), scaled by the share of wheels touching, so gravity along the ground is real gravity. Suspension load (along n) is untouched.
  - *Load transfer.* The inertial couple that pitches and rolls the body comes from real-unit tire forces against Roblox-weight springs, so it's ~18% (9.81 / 54.9) of a real car's: no squat, dive or lean, and the report's traction and braking (which assume real transfer) would be optimistic. The sim measures the acceleration the tires produced last step (from the tire forces, not the body's motion, so roll can't feed back) and adds the missing 82% as a couple on the springs: `transfer = m a h / wheelbase` front-to-rear and `m a h / track` side-to-side. Springs push that much less on the loaded side, the body leans into its springs, and the spring compression - which sets tire load - then carries the real transfer.
- Spring force is applied along the average ground normal, not the chassis up axis: on a leaning body, a chassis-axis force has a sideways part worth Roblox's (5.6×) weight times the lean, which would push the car out of corners.

## 3. Chassis and centre of mass

The builder creates `ChassisRoot`, an invisible box the size of the wheelbase × track, and makes it the only part with mass (every body part is welded to it and set `Massless`). Its position is the centre of mass:
- along the wheelbase: `FrontWeight` of the way from the rear axle to the front (55% front weight = CoM 55% of the way forward)
- height: `ComHeight` metres above the ground under the wheels

Its density is raised so it weighs at least 150 mass units (`MIN_ROOT_MASS` in `VehicleService`): a seated character is welded into the assembly and isn't massless, and on a light kart it would otherwise be half the mass, high up and to one side. Performance doesn't depend on this mass (forces scale with `AssemblyMass`). The box's size gives sensible rotational inertia. Low and centred CoM = stable; high CoM (trucks) = more roll and pitch, and a real rollover risk if grip is high.

## 4. Suspension

Per corner, with corner mass `m` (assembly mass × axle weight share ÷ wheels on the axle):

```
ω = 2π f                      f = FrequencyFront / FrequencyRear (Hz)
k = m ω²                      spring rate
c = 2 ζ √(k m)                damper rate, ζ = DampingRatio
static compression = g / ω²   (Roblox gravity)
rest length = static length + g / ω²,   static length = MaxLength × RideHeight
force = k (restLength − length) + c × compressionSpeed   (never negative: springs push, they don't pull)
```

| Variable | Real-world meaning | Typical |
|---|---|---|
| Frequency | How quickly the body bounces; higher = stiffer, sportier | comfort 1.5–2 Hz real; in Roblox gravity use 2.2–2.8 road, 2.8–3.5 sport/kart |
| Damping ratio | How fast bounces die out | 0.25–0.45; below 0.2 bouncy, above 0.7 harsh |
| MaxLength | Total suspension travel (studs) | 1.2–1.8 cars, 2–3 off-road |
| RideHeight | Where the car sits within the travel (0–1) | 0.55–0.65 |

Rear frequency is usually ~10% higher than front (flat ride: the rear catches up with the front over bumps).

The report's check: bump travel (`MaxLength × RideHeight`) should be at least the static sag `g/ω²`, otherwise a 1 g bump bottoms the suspension.

## 5. Anti-roll bars and roll centre

- **Anti-roll** (0–1 × the spring rate) moves force from the extended side to the compressed side of each axle, resisting body roll without stiffening single-wheel bumps. More anti-roll on an axle = that axle loses grip sooner in corners (load transfer concentrates), which is a balance tool: more front anti-roll → more understeer; more rear → more oversteer.
- **Roll centre** (0–1): where the tire's sideways force acts, between the contact patch (0, the most body roll) and the CoM height (1, no roll from cornering). Real cars sit around 0.2–0.5. Arcade cars use 0.6–0.9 for a flat, stable feel.

## 6. Tires

**Load and grip.** Each tire's maximum force is `grip (μ) × load`. Road tires μ ≈ 0.9–1.0, sport tires 1.05–1.2, racing slicks 1.4+, off-road on loose ground 0.6–0.8. Downforce adds load at speed.

**Slip angle.** The angle between where the wheel points and where its contact patch is moving: `atan2(lateral speed, |forward speed|)`. Tires generate sideways force proportional to slip angle at first, peak around 6–10°, then fall off as they slide.

**Slip curve** (simplified Pacejka "magic formula"):

```
lateral force = −μ × load × sin(C × atan(B × slipAngle))
```

| Parameter | Effect |
|---|---|
| `Stiffness` (B) | How quickly grip builds with slip: higher = sharper turn-in, more twitchy; 8–13 typical |
| `Shape` (C) | How grip falls off past the peak: 1.6–1.8 forgiving, catchable slides; 1.9–2.1 snappier |

**Friction circle.** Drive or brake force plus lateral force can't exceed `μ × load` together: braking hard in a corner reduces cornering grip, flooring it in a RWD car mid-corner makes the rear step out. This single rule produces trail braking, power oversteer and understeer at the limit.

**Slide grip.** Past the peak the curve never drops below `SlideGrip` (0.75–0.86). The plain formula falls to under half of peak grip at 30° of slip, which turns every slide into a spin; real tires keep most of their grip while sliding, which is what makes drifting possible (see drifting.md).

**Low speed.** At near-zero speed slip angles become meaningless, so forces are capped to what stops the sideways or forward motion in one step. At standstill that cap uses 40% of the corner mass (`STOP_GAIN`), rising to 100% by 4 m/s: the yaw mode has only about a third of the corners' effective mass (the root box's inertia), and a full-strength cap makes a stopped car shimmy in yaw and never settle.

**Hill hold.** No pedal and slower than 0.6 m/s (`HOLD_MS`): service brakes on all four wheels, each tire carrying its share of the downhill pull outright. Parked cars (the server's idle input) and cars waiting at a junction stay put on slopes up to about the tires' grip (tan θ < μ).

## 7. Powertrain

```
engine rpm   = wheel speed / wheel radius × gear ratio × final drive × 60 / 2π
drive force  = torque(rpm) × throttle × gear ratio × final drive × efficiency / wheel radius
```

- **Torque curve**: `[rpm, N·m]` points, linear in between, zero past the redline. Power (kW) = torque × rpm × 2π / 60 / 1000; the report shows the peak.
- **Launch rpm**: in 1st and reverse the clutch slips so the engine works at `LaunchRpm` from a standstill (otherwise it would launch from idle torque).
- **Automatic gearbox**: up-shift at `ShiftUpRpm`, down-shift at `ShiftDownRpm` (if the lower gear won't immediately over-rev), no drive for `ShiftTime` seconds during a shift.
- **Speed limiter**: no drive above `SpeedLimitKmh` (common on real cars at 180, 250 or 290 km/h).
- **Drivetrain**: FWD / RWD / AWD; AWD splits by `AwdFrontSplit`. Drive force is shared equally across the driven wheels; each is still limited by its own grip, so FWD cars spin the inside front wheel when powering out of tight corners, and RWD cars can be steered with throttle.
- **Efficiency**: 0.8–0.9 (losses through gearbox and diff).

Gear ratios set where the power is usable: short gears = strong acceleration, low top speed; tall gears = the opposite. The report's gear table shows the speed at redline in each gear.

## 8. Brakes and handbrake

- `DecelG`: deceleration the brakes can command (0.8 trucks, 0.95–1.05 road cars, 1.1–1.3 sports and race cars); the tires limit the real result.
- `FrontBias`: share of braking on the front axle (0.6–0.7 road cars). Too much rear bias makes the car spin under braking.
- Handbrake: locks the rear (strong rear brake) and scales rear lateral grip by `HandbrakeGripScale` (0.35–0.6), which is what starts a slide for drifting and hairpins.
- Braking can't push a wheel past zero speed in a step, so the car stops cleanly.

## 9. Steering

- `MaxAngle`: steering lock at the wheels (road cars 30–38°).
- `Speed`: how many full locks per second the wheels can travel (3–5 cars, 6–8 karts); smooths keyboard input.
- Speed sensitivity: lock shrinks linearly to `HighSpeedScale × MaxAngle` at `HighSpeedKmh`. Essential with keyboard input, or full lock at 200 km/h spins the car.
- Stability assist (`Assists.Stability`, 0–1): the yaw rate the steering asks for is `v · tan(steer) / wheelbase` (bicycle model), capped at `μ·g / v`. Yaw beyond that band, or yaw against the steering, gets a torque of `−excess × 10 × Stability × I` about the car's up axis. This is ESC's job done with a torque instead of single-wheel braking, and it's the main reason GTA cars feel planted on a keyboard. It needs two or more wheels on the ground and forward speed above 3 m/s, and it's off while the handbrake is held and for 0.6 s after, so handbrake turns still rotate the car. Understeer is left alone.

## 10. Aerodynamics and resistance

```
drag      = ½ ρ Cd A v²         ρ = 1.225 kg/m³
downforce = ½ ρ Cl A v²         (Cl = DownforceCl, adds tire load)
rolling   = Crr × load          (RollingResistance 0.01–0.02)
```

Typical `Cd × A` (m²): hatchback 0.65, sports car 0.62, pickup 1.45, kart 0.5. Top speed without a limiter is where drive force equals drag + rolling resistance in the best gear.

## 11. Sphere casts, hull and recovery

Suspension uses `Workspace:Spherecast` with a sphere of 85% of the wheel radius, starting one wheel radius above the mount (`CAST_LIFT`); the wheel length is the cast distance minus that lift and the radius difference. Spherecast ignores parts the sphere starts inside, so a cast that started at the mount would lose the ground after a hard landing or a drop from `Recover()` (the body sinks a stud below ride height, the sphere starts in the ground, the wheel reads as airborne and stays that way). Hits on surfaces steeper than ~70° are ignored (walls are for the hull). The body's collision is a generated hull (box with rounded nose and tail cylinders, bottom at axle height, friction 0.08). Stuck assist, auto-flip, air control and `Recover()` are described in anti-stuck.md.

## 12. What's simplified

- No wheel spin inertia or clutch slip outside launch: drive force is limited by grip but the engine rpm follows road speed. Burnouts and wheel-spin sounds come from the `Slip` telemetry instead.
- One slip curve and grip value per axle; no camber, toe, tire temperature or wear.
- No differential types: driven wheels share force equally (an open diff without the one-wheel-spin weakness).
- The Node report is straight-line only; cornering and stability are tested by driving.

These keep the model stable at Roblox physics rates and keep every variable meaningful and tunable.
