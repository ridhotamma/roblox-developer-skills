# Motorcycle physics

## Contents
1. How a real motorcycle turns: lean, countersteer, balance
2. Lean angle, turn radius and grip
3. Tires: camber thrust and slip angle
4. Wheelies and stoppies
5. Why bikes stay up: trail, gyroscopes and the speed window
6. How GTA and other games do it
7. The kit's model (BikeSim)
8. Spec fields and real values
9. Tuning: symptom → fix
10. Model setup and controls

---

## 1. How a real motorcycle turns

A car turns by steering; a motorcycle turns by **leaning**. The steering only starts the lean:

1. **Countersteer.** To turn right, the rider pushes the right bar (steers left) for a fraction of a second. The tires run out from under the bike to the left, so gravity tips it to the right.
2. **Lean.** Once leaned, gravity pulls the bike further over and the tires' sideways force pushes it back up. The rider holds a small steer *into* the turn to stop the lean growing.
3. **Balanced turn.** In a steady turn the resultant of gravity and the centripetal force passes exactly through the contact patches, so there is no net roll torque.

Above walking pace, riders never "steer" in the car sense; they choose a lean angle and the steering follows.

## 2. Lean angle, turn radius and grip

Balance in a steady turn (thin tires, rider in line with the bike):

```
tan φ = v² / (g R) = v · ω / g        φ lean, v speed, R radius, ω yaw rate
```

| Speed | Radius at 30° | Radius at 45° |
|---|---|---|
| 50 km/h | 34 m | 20 m |
| 100 km/h | 136 m | 79 m |
| 200 km/h | 545 m | 315 m |

The tires must supply the sideways force `m g tan φ`, so the grip limit is `tan φ ≤ μ`: road tires (μ ≈ 1.0) allow ~45°, sport tires (μ ≈ 1.2) ~50°, MotoGP slicks ~60°. Ground clearance (pegs, exhausts, fairing) caps it earlier on most bikes: sport bikes ~50–55°, naked bikes ~45°, cruisers ~30°.

Kinematic steering at the front wheel (wheelbase L): `R ≈ L / tan δ`, so at speed the steering angle is tiny: 45° lean at 100 km/h on a 1.4 m wheelbase needs only about 1° of steer.

## 3. Tires: camber thrust and slip angle

A leaned tire pushes sideways even with no slip angle, because its contact patch is curved like a cone rolling in a circle. This **camber thrust** is roughly `Fz · tan γ` for motorcycle tires (camber thrust coefficient 0.8–1.0), so a leaned bike gets most of its cornering force from lean, and only a small slip angle (1–3°) supplies the rest. The friction circle still applies: braking or accelerating hard while leaned uses up grip, which is why riders brake upright and trail off the brake as they lean.

## 4. Wheelies and stoppies

Take moments about the rear contact patch. With the centre of mass (CoM) a horizontal distance `b` ahead of the rear axle and at height `h`, the front wheel lifts when

```
a_wheelie = g · b / h
```

A sport bike with rider: wheelbase 1.40 m, 50/50 weight (b = 0.70 m), CoM 0.62 m → **1.13 g**. That is below the rear tire's grip (μ ≈ 1.2), so sport bikes are *wheelie-limited*: 0–100 km/h in ~3 s no matter how much power. Long, low drag bikes and cruisers push the limit up; short, tall dirt bikes pull it down.

Braking is the mirror image about the front contact patch (`a` = distance from the front axle to the CoM):

```
a_stoppie = g · a / h        (≈ 1.1 g on a sport bike)
```

So hard braking is stoppie-limited: almost all the load moves to the front tire, the rear goes light and does little, which is why bikes put ~70% of braking on the front. Rider position moves the CoM: tucking forward raises the wheelie limit; sitting back lowers it.

## 5. Why bikes stay up

A rolling bike is self-stable between roughly 15 and 30 km/h even with no rider: **trail** (the contact patch behind the steering axis) and the **gyroscopic** front wheel make it steer into a fall. Below that speed it falls over (*capsize* mode), above it a slow weave appears (*weave* mode, damped by the rider). At walking pace riders balance with tiny steering moves or put a foot down. None of this is fun to simulate at 60 Hz with keyboard input, which is why every game replaces it with a balance controller.

## 6. How GTA and other games do it

GTA V's bike handling (`CBikeHandlingData` in `handling.meta`) shows the recipe:

| Field | What it does |
|---|---|
| `fMaxBankAngle` | Maximum lean in degrees (sport bikes ~40°, choppers less, bicycles ~20°). |
| `fLeanFwdCOMMult`, `fLeanFwdForceMult`, `fLeanBakCOMMult`, `fLeanBakForceMult` | Rider lean: shifts the CoM and adds a pitch torque (wheelies, stoppies, mid-air flips). |
| `fWheelieBalancePoint`, `fStoppieBalancePoint` | Pitch angle (deg) the bike balances at in a wheelie (e.g. 8–10) or stoppie (−9 to −10). |
| `fDesLeanReturnFrac`, `fStickLeanMult` | How fast lean follows the stick and returns upright. |
| `fInAirSteerMult` | Air control. |
| `fBikeOnStandLeanAngle` | Kickstand lean when parked. |

So GTA's bikes: **steer input → target lean**, an invisible balance assist keeps them up at any speed, lean back/forward for wheelies, stoppies and flips, the rider is thrown off in a hard crash (ragdoll), and parked bikes stand on a kickstand. Most arcade racers do the same; sims (Ride, MotoGP) add real countersteer and rider-weight physics but still assist balance at low speed.

## 7. The kit's model (BikeSim)

Same philosophy as the car: real units, one spec, any mesh.

**Gravity.** Bikes live in real gravity: an upward force cancels the part of `Workspace.Gravity` beyond 9.81 m/s², so wheelie and stoppie limits, lean balance and suspension sag are real. In the air gravity is `Recovery.AirGravity` g (default 2) for snappier jumps.

**Suspension.** Front and rear sphere-cast suspension along the bike's (leaned) up axis, frequency and damping-ratio tuned like the car. Spring and tire forces act at the **contact patch**, so the roll torques of a leaned bike are physical: the support force tries to tip it further, the sideways tire force tries to stand it up.

**The rider** (per step). The stick asks for a **lean**, and the rider steers whatever turn keeps the bike balanced at the lean it has right now, exactly the causality of a real bike:
```
φ_target = steer × MaxLean × ramp(speed) × (1 − 0.35 × braking)   no lean at walking pace; braking picks it up
δ_ground = atan(L · g · tan φ / v²)                                the turn that balances the current lean φ
δ        = δ_ground / cos φ                                        the steering axis leans with the bike
δ        = lerp(steer × MaxAngle, δ, speed blend)                  direct bars below LowSpeedKmh; straight when stopping
```
A rate-limited lean controller (`LeanRate` deg/s) drives the bike to `φ_target`, and while a rider is on board the contact patches' roll torque is cancelled (a real rider keeps steering the patches back under the centre of mass; riderless or crashed bikes don't, so they fall over). The `cos φ` term matters: without it a bike leaned 47° turns a third wider than its lean implies. In the lab a steady turn holds 50.0° of lean against 49.9° balanced (`tan φ = v ω / g`).

**Tires.** Per wheel: slip-angle force through the same tire curve as the car, plus camber thrust `CamberThrust × Fz × tan φ`, drive on the rear, brakes split by `FrontBias`, all inside the friction circle `μ × Fz`. **Cornering ABS and lean-sensitive traction control** give cornering grip priority: drive and brakes only get what is left of the circle, so braking hard mid-corner runs the bike wide instead of washing the front out (the rear-brake button still slides it). The engine and gearbox are the car's (`VehicleMath.Drive`), so torque curves, gears, launch rpm and limiter behave identically. Reverse engages only from a stop, at walking pace.

**Pitch, wheelies and stoppies.** Pitch is free physics: drive force at the rear patch below the CoM lifts the front at exactly `g b / h`, hard front braking lifts the rear at `g a / h`. On top:
- rider lean (`Input.Lean`, −1 back … +1 forward) adds a pitch torque `m g × RiderShift` (moving the CoM by `RiderShift` metres)
- **wheelie control** (`Wheelie.Control`): without lean-back, drive is trimmed as the front wheel's load falls below 15% (like real anti-wheelie electronics), so launches run at the wheelie limit with the front skimming the road
- **wheelie balance**: leaning back with the front up, a balance assist holds the pitch at `Wheelie.BalanceAngle`; past it the rider rolls off the throttle, and past it plus 15° the bike is pushed down (no looping out unless `Wheelie.Assist` = 0)
- **stoppie control**: unless leaning forward, the front brake eases as the rear wheel's load falls below 15%, so hard stops run at the stoppie limit; leaning forward holds `Wheelie.StoppieAngle`
- **stability assist** (`Assists.Stability`) takes out yaw beyond what the steering asks for, down to walking pace (an unloaded rear sliding out under braking is what spins bikes)

**Air.** Both wheels off the ground: lean input pitches (flips), steer rolls, and an air-control assist turns the bike toward the landing surface, like the car.

**Crashes.** `Crashed` telemetry when a hit changes velocity by more than `Recovery.BailG` g in one step, or the bike lies over past 75° at speed (a low-side). The controller throws the rider off (ragdolled if the `roblox-ragdoll` kit is installed); a riderless bike gets no balance, so it falls and slides.

**Never stuck.** Narrow rounded hull (bottom above 1.4 wheel radii, so 50°+ of lean never scrapes it), stuck assist, auto-upright when on its side and slow with a rider on board, Reset button. The rider's character is put in the `VehicleRider` collision group while riding so knees and feet never touch the road in a lean.

## 8. Spec fields and real values

| Class | Mass with rider | Power | Wheelbase | CoM height | Max lean | 0–100 | Top |
|---|---|---|---|---|---|---|---|
| Superbike (`SportBike`) | 280 kg | 147 kW | 1.41 m | 0.62 m | 50° | 2.8 s (report), 2.95 s (lab) | 299 km/h (limiter) |
| Dirt / enduro (`DirtBike`) | 195 kg | 44 kW | 1.48 m | 0.72 m | 45° | 3.5 s (report), 4.2 s (lab) | 164 km/h |
| Naked 600 | 270 kg | 75 kW | 1.42 m | 0.65 m | 48° | ~3.6 s | 230 km/h |
| Cruiser | 400 kg | 65 kW | 1.65 m | 0.60 m | 32° | ~4.5 s | 180 km/h |
| Scooter 125 | 200 kg | 9 kW | 1.30 m | 0.60 m | 40° | 0–60 ~7 s | 100 km/h |

Fields (all optional except `name`, `type: "Motorcycle"`): `mass`, `frontWeight`, `comHeight`, `wheelbase`, `wheelRadius`, `engine` and `gearbox` (same as cars, plus `gearbox.reverseSpeedKmh`), `brakes` {`decelG`, `frontBias`}, `steering` {`maxAngle`, `speed`, `maxLean`, `leanRate`, `lowSpeedKmh`}, `tires` {`gripFront`, `gripRear`, `stiffness`, `shape`, `slideGrip`, `camberThrust`, `rollingResistance`}, `wheelie` {`control`, `balanceAngle`, `stoppieAngle`, `riderShift`, `assist`}, `recovery` {`airControl`, `airGravity`, `airInput`, `autoFlip`, `stuckAssist`, `bailG`}, `assists` {`stability`}, `suspension` {`frequencyFront`, `frequencyRear`, `dampingRatio`, `maxLength`, `rideHeight`}, `aero` {`cd`, `area`}, `body` {`hullFriction`}.

The report prints the wheelie and stoppie limits, which one limits launch and braking, the grip and clearance lean limits and turn radius at 50 and 100 km/h.

## 9. Tuning: symptom → fix

| Symptom | Fix |
|---|---|
| Bike wheelies on every launch | Lower `comHeight`, raise `frontWeight`, longer `wheelbase`, or keep `wheelie.control` on. |
| Can't wheelie at all | Lean back (`Input.Lean` < 0) or raise `wheelie.riderShift`; check power: `a = g b / h` must be reachable in first gear. |
| Lean feels slow / boat-like | Raise `steering.leanRate` (60–110 deg/s). |
| Too twitchy at speed on keyboard | Lower `steering.leanRate`, `steering.speed`; raise `assists.stability`. |
| Runs wide in corners | Raise `steering.maxLean` (if clearance allows) or `tires.grip*`. |
| Low-sides when braking in a lean | Expected (friction circle); lower `brakes.decelG` or raise grip. |
| Stoppies on every hard stop | Lower `brakes.frontBias` or `brakes.decelG`; lower `comHeight`. |
| Rider thrown off too easily | Raise `recovery.bailG` (0 = never). |

## 10. Model setup and controls

```
SportBikeRed (Model)      attribute Vehicle = "SportBike", tag "Vehicle", pivot facing forward
├─ Body (any parts)
├─ DriverSeat (VehicleSeat)
├─ WheelF                 front wheel (steers) — BasePart or Model
└─ WheelR                 rear wheel (driven)
```

| Device | Throttle / brake | Steer (lean) | Rear brake | Lean back / forward | Reset |
|---|---|---|---|---|---|
| Keyboard | W / S | A / D | LeftShift | Q / E | R |
| Gamepad | R2 / L2 or stick | left stick | X | L1 / R1 | Y |
| Touch | thumbstick | thumbstick | "Brake" button | "Wheelie" button | "Reset" |
