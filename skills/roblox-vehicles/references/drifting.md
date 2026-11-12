# Drifting

## Contents
1. What a drift is, physically
2. How the chassis supports it
3. A drift setup
4. Controls and assists by device
5. Drift scoring
6. Tire smoke, skid marks and sound
7. Tuning problems

---

## 1. What a drift is

A drift is a controlled oversteer slide: the rear tires are past their grip peak and sliding, the car travels at an angle (the **drift angle** or body slip angle) to where it points, and the driver balances it with steering (countersteer) and throttle (in RWD, more throttle = more angle).

It needs three things from the physics:
1. **A way to break rear grip**: handbrake, a weight shift (lift-off, flick), or power (RWD torque past rear grip).
2. **Grip that doesn't vanish when sliding**: real tires keep ~75–90% of their peak grip while sliding. If grip collapses, slides turn into spins.
3. **A way to hold and exit the angle**: countersteer and throttle modulation, and the front tires keeping grip.

## 2. How the chassis supports it

| Mechanism | Spec | What it does |
|---|---|---|
| Slide grip | `tires.slideGrip` | Past the slip-curve peak, lateral force never drops below this share of grip. 0.75–0.86 = holdable drifts; below 0.6 = spins. |
| Handbrake | `brakes.handbrakeGripScale` | Rear lateral grip × this while held (and rear wheels braked): the drift starter. |
| Power oversteer | RWD + torque | The friction circle: rear drive force uses up rear grip, so the tail steps out under power. |
| Countersteer assist | `drift.countersteer` (0–1) | While drifting, steering gets `countersteer × drift angle` added: the wheels point into the slide like a driver catching it. 0.15 road cars (subtle), 0.3 sports cars, 0.5–0.7 drift/arcade cars. |
| Stabilizer | `drift.maxAngle`, `drift.stabilizer` | Past `maxAngle` the rear finds grip again (up to +`stabilizer`×100%), pulling the car back before it spins. Drift cars: 60–70°; road cars: 40–50°. |
| Steering lock | `steering.maxAngle` | Drift cars run 48–60° of lock so they can countersteer at big angles. |

The car reports `DriftAngle` (signed degrees), `Drifting` (angle > 10° above 25 km/h, moving forward) and `Slip` in telemetry.

## 3. A drift setup

Start from `specs/drift_car.json`:
- RWD, weight 50–53% front, low CoM
- strong mid-range torque, short gears (stay in the power band through a slide)
- rear grip 5–12% below front; `slideGrip` 0.82–0.88; tire `shape` 1.6–1.75 (progressive)
- `handbrakeGripScale` 0.3–0.4
- steering lock 50–55°, `speed` 6
- suspension: slightly softer rear than front (rear frequency ≤ front) for rear traction on exit
- anti-roll 0.5, roll centre 0.5–0.6
- `drift.countersteer` 0.5–0.7, `maxAngle` 60–70, `stabilizer` 0.5–0.7

For a non-drift car that can still slide for fun (sports car): `slideGrip` 0.8, countersteer 0.3, maxAngle 50–55.

## 4. Controls and assists by device

- **Keyboard**: digital steering is the hardest; rely on countersteer assist (0.5+) and steering speed 6. Handbrake on LeftShift.
- **Gamepad**: analog stick makes balancing natural; countersteer 0.3–0.5 is enough. Handbrake on X; consider analog triggers for throttle (see vehicle-setup.md §6).
- **Touch**: the "Drift" button is the handbrake; countersteer 0.6–0.7 and a slightly higher stabilizer keep it fun. Offer an "auto-drift" option that holds handbrake while steering hard above a speed.

Assists can be a player setting (Pro / Normal / Easy) that scales `countersteer` and `stabilizer` at runtime.

## 5. Drift scoring

The kit's controller shows a cosmetic score: points = Σ |drift angle| × speed × time while drifting, banked 1.2 s after a clean exit, lost on a spin-out (angle 25° beyond `maxAngle`) or a stuck assist. Chains continue if a new drift starts before banking.

For rewards, score on the server, never trust the client's number:
- sample the car's velocity and facing on the server (10 Hz) and compute the same angle × speed integral
- require minimum speed and angle, cap points per second, and reset on collisions (sudden speed loss)
- compare with the client's score only as a sanity check; reward the server's
- add multipliers for zones, proximity to walls (classic in drift games), chains and style

## 6. Tire smoke, skid marks and sound

`VehicleVisuals` drives them for every car on every client, from slip it estimates per wheel:
- **sideways slip**: angle between the wheel's heading and its contact patch's travel (drifts, handbrake turns)
- **wheelspin**: full throttle below 30 km/h on driven wheels (launches, burnouts)
- **lock-up**: hard braking above 60 km/h

| Effect | How |
|---|---|
| Tire smoke | A ParticleEmitter per wheel at the contact patch (Roblox's built-in smoke texture), rate ∝ slip², large soft particles that grow, drift up and fade over 1–2.5 s. |
| Skid marks | Thin dark segments laid along each wheel's path while slip > 0.45, darker with more slip, fading after 12 s, at most 500 per client. |
| Tire squeal | Optional looping sound from the model's `TireSound` attribute, volume and pitch from slip. |

Tune the look with the `roblox-vfx` skill if you want coloured drift smoke (a common unlockable cosmetic: tint `Color` per player), sparks from scraping, or flames on backfires.

## 7. Tuning problems

| Problem | Fix |
|---|---|
| Can't start a drift | handbrakeGripScale ↓, rear grip ↓, more torque, steering lock ↑ |
| Spins every time | slideGrip ↑ (0.85), stabilizer ↑, maxAngle ↓, countersteer ↑, rear grip ↑ slightly |
| Drift dies immediately (straightens) | slideGrip too high for the power, rear grip too high, stabilizer kicking in too early (maxAngle ↑) |
| Too easy, no skill | countersteer ↓ (0.2–0.3), stabilizer ↓ |
| Snappy transitions (left-right flicks) | tire shape ↓ (1.6), steering speed ↓, damping ratio ↑ |
| No smoke | slip below thresholds: check the estimate (side angle > 7°, speed > 12 km/h); smoke emitters exist under Workspace.Terrain |
| Too much smoke (performance) | SMOKE_MAX_RATE ↓, particle Lifetime ↓; it already only runs within 450 studs |
