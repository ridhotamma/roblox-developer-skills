# Tuning guide

## Contents
1. Real-world reference values
2. Handling balance: understeer and oversteer
3. Symptom → fix
4. Arcade vs simulation
5. Setups: drift, off-road, kart, heavy truck
6. Tuning workflow

---

## 1. Real-world reference values

Use these to write a spec that matches a real class of vehicle, then confirm with the report.

| Class | Mass (kg) | Front weight | Power (kW/hp) | Peak torque (N·m) | Redline | 0–100 km/h | Top speed | 100–0 km/h | Grip μ |
|---|---|---|---|---|---|---|---|---|---|
| City car / hatchback | 1000–1300 | 0.60–0.63 | 70–100 / 95–135 | 130–200 | 6000–6800 | 9–12 s | 170–200 | 38–44 m | 0.9–1.0 |
| Family sedan | 1400–1600 | 0.58–0.60 | 110–150 / 150–200 | 250–350 | 6000–6500 | 7.5–9 s | 210–230 | 36–40 m | 0.95–1.0 |
| Hot hatch | 1300–1450 | 0.60–0.62 | 180–240 / 245–325 | 350–420 | 6500–7000 | 5.5–6.5 s | 240–260 (limited) | 34–36 m | 1.0–1.1 |
| Sports coupe (RWD) | 1400–1600 | 0.50–0.52 | 280–350 / 375–470 | 450–550 | 7000–7500 | 3.8–4.5 s | 250–300 | 32–35 m | 1.1–1.2 |
| Supercar | 1400–1600 | 0.42–0.45 | 450–600 / 600–800 | 600–800 | 8000–9000 | 2.8–3.3 s | 320–340 | 30–32 m | 1.2–1.3 |
| SUV | 1900–2300 | 0.55–0.58 | 150–250 / 200–335 | 350–500 | 6000 | 7–9 s | 200–230 | 38–42 m | 0.9 |
| Pickup truck | 2100–2700 | 0.55–0.60 | 200–300 / 270–400 | 450–650 | 5500–6000 | 6–9 s | 170–190 (limited) | 42–48 m | 0.8–0.9 |
| Electric car | 1800–2200 | 0.48–0.50 | 200–400 | 400–650, flat from 0 rpm | 15000–18000, 1 gear | 3.5–6 s | 200–260 (limited) | 34–36 m | 1.0 |
| Go-kart (rental) | 140–180 incl. driver | 0.40–0.45 | 6–15 | 10–20 | 6000–9000, 1 gear | 0–60 km/h 3–5 s | 60–90 | — | 1.2–1.4 |
| Bus / box truck | 7000–15000 | 0.35–0.45 | 180–250 | 900–1200 | 2500 | 20–30 s | 100–120 (limited) | 55–70 m | 0.7–0.8 |

Gearing hints: 5–6 speed manual-style ratios from ~3.5 down to ~0.8; 8–10 speed automatics from ~4.7 down to ~0.65; final drive 3–4.5; EVs a single ratio around 8–10 with redline ~16000 rpm (model the motor's torque curve flat to ~5000 rpm then falling).

Electric car tip: `launchRpm` can equal `idleRpm` (no clutch), `shiftTime` 0, one gear.

## 2. Handling balance

**Understeer**: the front runs out of grip first; the car pushes wide. Safe, common in road cars.
**Oversteer**: the rear runs out first; the tail steps out. Exciting, can spin.

| To get more... | Change |
|---|---|
| Understeer (stability) | front grip ↓ or rear grip ↑; front anti-roll ↑ or rear ↓; front frequency ↑; CoM forward (frontWeight ↑); FWD |
| Oversteer (rotation) | the opposite; RWD with strong torque; handbrake grip scale ↓ |
| Faster turn-in | tire stiffness ↑, steering speed ↑, front frequency ↑ |
| Forgiving slides | tire shape ↓ (1.6–1.8), roll centre ↑, damping ratio ↑ a little |
| High-speed stability | steering highSpeedScale ↓, downforce ↑, rear grip slightly > front |

Change one thing at a time and drive the same corner before and after.

## 3. Symptom → fix

| Symptom | Likely cause | Fix |
|---|---|---|
| Car bounces after bumps/landing | damping too low | dampingRatio 0.35–0.45 |
| Floaty, wallowy | frequency too low | +0.3–0.5 Hz both axles |
| Bottoms out, scrapes, report WARN | bump travel < sag | frequency ↑, maxLength ↑ or rideHeight ↑ |
| Harsh, skips over bumps | frequency or damping too high | lower one of them |
| Rolls over in corners | CoM too high, grip too high, roll centre too low | comHeight ↓, antiRoll ↑, rollCenter ↑ (0.6–0.8) |
| Leans into corners (odd) | rollCenter above 1 or mount geometry off | rollCenter 0.3–0.6 |
| Spins when braking | brake bias too rear | frontBias 0.62–0.7 |
| Spins on throttle (RWD) | too much torque for rear grip | rear grip ↑, torque curve softer at low rpm, launchRpm ↓ |
| Won't turn at speed (keyboard) | full lock too small at speed, or front grip low | highSpeedScale ↑ slightly, front grip ↑ |
| Twitchy, snaps at the limit | stiffness/shape too high | stiffness 8–10, shape 1.7–1.8 |
| Slow off the line | launchRpm in a weak part of the curve, 1st gear too tall | launchRpm near peak torque, shorter 1st |
| Hits redline long before top speed | gears too short | taller final drive or top gear |
| Top speed too high | drag too low, no limiter | realistic Cd × A or speedLimitKmh |
| Can't stop on hills when parked | low-speed force cap | the server sleeps parked cars after 2 s settled; or add a parking brake that anchors |
| Jitters when standing still | normal raycast noise at very low speed | already capped; make sure body parts don't collide with the ground at rest (ride height) |
| Sinks into the ground | rest length solved for wrong gravity, or Workspace.Gravity changed after build | keep gravity constant, rebuild, or raise frequency |
| Wheels float above/below the road | wheel radius detected wrong | set `WheelRadius` attribute on the wheel |
| Gets stuck on kerbs, trees, terrain | see anti-stuck.md | keep AutoHull on, hull friction ≤ 0.15, props in VehicleIgnore, fix kerb heights |
| Spins out of every slide | slide grip too low | tires.slideGrip 0.8–0.86, drift stabilizer ↑ |
| Lands on its roof after jumps | no air control | recovery.airControl 0.3–0.5 |

## 4. Arcade vs simulation

| Dial | Arcade | Simulation |
|---|---|---|
| Grip μ | 1.3–1.8 | real values (table above) |
| Tire shape C | 1.5–1.7 (very forgiving) | 1.8–2.0 |
| Steering speed | 6–10 | 3–5 |
| High-speed steering scale | 0.5–0.7 | 0.3–0.45 |
| Roll centre | 0.7–0.9 (flat) | 0.2–0.5 |
| Anti-roll | 0.6–1.0 | 0.2–0.5 |
| Brakes decelG | 1.3–1.8 | real |
| Mass/torque | exaggerated power-to-weight | real |
| Assists (game code) | auto-countersteer, traction control, downforce boost | none or optional |

Arcade cars are still defined by the same variables; they're just less realistic values. Most Roblox audiences (mobile, keyboard) enjoy something between the two.

## 5. Setups

**Drift (RWD):** see drifting.md and `specs/drift_car.json`: frontWeight 0.50–0.52, rear grip 5–12% below front, slideGrip 0.82–0.88, tire shape 1.6–1.75, handbrakeGripScale 0.3–0.4, steering maxAngle 50–55, mid-range torque, short gears, countersteer 0.5–0.7, drift maxAngle 60–70, stabilizer 0.5–0.7.

**Off-road / truck:** maxLength 2.2–3.0 studs, rideHeight 0.5–0.55, frequency 1.9–2.4 Hz, damping 0.3, grip 0.75–0.9, AWD 40/60, comHeight 0.75–0.9 m, low first gear for climbing.

**Kart:** very low CoM (0.2–0.3 m), stiff (3–4 Hz), high anti-roll (0.8), high grip (1.2–1.4), one gear, quick steering (6–8), no suspension travel to speak of (maxLength 0.8–1.0).

**Heavy truck / bus:** mass 7000+, frontWeight 0.35–0.45, low redline (2200–2600), many gears, decelG 0.6–0.7, steering speed 2, highSpeedScale 0.5, Cd × A 5–8 m².

## 6. Tuning workflow

1. Pick the closest bundled spec; set mass, weight distribution, CoM height and wheel radius for the vehicle.
2. Engine and gearbox until the report's 0–100, top speed and gear speeds match the target.
3. Brakes until 100–0 matches.
4. Suspension: frequency and damping, then fix any report warnings.
5. Drive in Studio: a slalom, a tight hairpin, a fast sweeper, a braking zone into a corner, a jump. Adjust balance (section 2) one variable at a time.
6. Test with keyboard, gamepad and touch (Studio's device emulator). Keyboard needs more steering help than gamepad.
7. Export Luau, commit the JSON with the change log ("rear grip 1.05 → 1.0: less snap oversteer").
