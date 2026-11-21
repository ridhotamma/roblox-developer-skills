# Train physics

## Contents
1. Steel on steel: why trains are different
2. Tractive effort and adhesion
3. Resistance: the Davis equation, grades, curves
4. Braking
5. Curves, cant and derailment
6. The consist: cars, bogies, couplers
7. How GTA and other games do it
8. The kit's model (TrainSim, TrainTrack)
9. Track setup in Roblox
10. Spec fields and real values
11. Tuning: symptom → fix
12. Controls

---

## 1. Steel on steel

A steel wheel on a steel rail rolls with almost no loss: rolling resistance is about 1–2 N per kN of weight, a tenth of a car tire's. That is why one locomotive can pull thousands of tonnes, and also why a train takes a kilometre to stop: wheel–rail adhesion is only μ ≈ 0.25–0.4 (dry, with modern slip control), 0.15–0.2 wet. The flanged wheels and the rails steer the train, so its physics is one-dimensional: speed along the track. Everything sideways (curves, cant, derailment) follows from where the track goes.

## 2. Tractive effort and adhesion

```
TE(v) = min(TE_start, μ_adh · W_driving, η P / v)
```

- **Adhesion limit** `μ_adh · W_driving`: only the weight on driven axles counts (the locomotive's, or the whole train's for multiple units).
- **Starting limit** `TE_start`: what the traction motors and their current allow (often below adhesion on passenger locos).
- **Power hyperbola** `η P / v`: at speed, power is the limit. η ≈ 0.8–0.9 from engine or line to rail.

GE ES44AC (freight, ~190 t): 3.28 MW engine (4,400 hp), ~810 kN starting tractive effort (μ ≈ 0.44 with AC traction). A passenger loco: ~3.5 MW at the rail, ~290 kN starting. A tram: ~500 kW, ~70 kN on 40 t, so trams launch at 1.0–1.3 m/s² while freight trains crawl at 0.1–0.3 m/s².

## 3. Resistance

**Davis equation** (1926, still the basis of every train simulator):
```
R = A + B v + C v²
A ≈ W × 1.0–1.5 N/kN       bearings, rolling                (the kit: Resistance.Rolling)
B v ≈ W × 0.01–0.03 N/kN per m/s   flange friction, hunting (the kit: Resistance.Speed)
C v² = ½ ρ C_d A v²        air: the nose plus skin friction along the train
```
Freight trains are bluff and draggy; streamlined passenger trains have much lower C.

**Grades** are the big one: `W sin θ ≈ W × grade`. A 1% grade adds 10 N/kN, five to ten times the rolling resistance. The **ruling grade** is the steepest a train can start on: `TE_start > W (grade + A)`. **Balancing speed** is where power equals resistance on a given grade.

**Curves** (Röckl): extra resistance `650 / (R − 55)` N/kN for R > 300 m, `500 / (R − 30)` below (R in metres). A 300 m curve adds ~2.7 N/kN.

## 4. Braking

- Air brakes on every car: service ~0.5–1.0 m/s² for passenger trains, 0.3–0.5 for freight. Emergency ~1.2–1.5 and ~0.6 respectively.
- Braking is limited by adhesion (μ ≈ 0.15 with wheel-slide protection). Trams add magnetic track brakes that grip the rail directly: 2.5–3 m/s² emergency.
- Long freight trains need hundreds of metres to kilometres to stop: from 100 km/h at 0.4 m/s² it takes 960 m.
- Dynamic or regenerative braking uses the motors as generators, power-limited like traction.

## 5. Curves, cant and derailment

In a curve of radius R the train needs `v² / R` of sideways acceleration. Track is canted (superelevated) by angle θ so gravity supplies part of it:

```
unbalanced lateral acceleration  a_u = v² / R − g tan θ
```

- **Balance speed**: a_u = 0, no side force on the rails or passengers.
- Comfort limits a_u to ~0.6–1.0 m/s² (cant deficiency 75–150 mm).
- Overturning happens when the resultant leaves the outer rail: roughly `a_u > g × (half gauge / CoM height)` ≈ 0.4 g for a passenger coach, less with wind and track faults. Flange climb (wheel lifting over the rail) also derails.

GTA San Andreas made this a gameplay rule: take a curve too fast and the train derails.

## 6. The consist

A train is a chain of vehicles on **bogies**: each car's body rests on two pivoting trucks, so in a curve the body is a chord between its bogie points. Couplers have slack: a starting freight train takes up slack car by car, and run-in and run-out forces matter for real handling. Simulators either model each car as a mass on spring couplers or treat the consist as one mass with per-car grade and curve loads.

## 7. How GTA and other games do it

GTA V's trains are scripted on fixed lines. GTA San Andreas let the player drive one: throttle and brake only, it follows the track, it derails if you take a curve too fast, and it plows through cars on the line. Train Sim World and Open Rails use the Davis equation, tractive effort curves, adhesion with wheelslip, air brakes with propagation and coupler forces. The kit uses the simulators' longitudinal physics with San Andreas controls.

## 8. The kit's model (TrainSim, TrainTrack)

**On the track, the consist is one longitudinal body**:
```
M dv/dt = TE − brakes − Σ cars [ m g (Rolling + Speed·|v| + grade + curve) ] − ½ ρ CdA v²
```
- Tractive effort is `power lever × min(TE_start, μ_adh m_loco g, η P / |v|)`. Asking for more than adhesion caps it and flags **wheelslip**.
- Brakes ramp with the brake lever up to `Brakes.Service` m/s² (or `Brakes.Emergency`), capped by `Brakes.Adhesion × W`. Stopped with the brakes on, the train holds on grades.
- Grade and curve resistance are summed per car at each car's own position, so a long train cresting a hill feels it car by car.
- The lever ramps at `Controls.NotchRate` per second, like notching a real controller.

**Every car is placed on the track** from its bogie points: front and rear bogies sit at ± half the bogie spacing along the track. The body is the chord between them, raised by `ComHeight`, and rolled by the track's cant. Each car's root (its own assembly) is pulled onto that pose by a stiff PD force (12 rad/s, critically damped) with gravity and track-acceleration feed-forward, aimed at where the car will be after the step, and turned onto it by rate tracking. So cars articulate through curves and over crests, players can ride on them, and cars or props on the line get shoved aside by real contacts. Each car's collision hull starts 0.8 m above the rail, clear of rails and platform edges, and neighbouring cars don't collide with each other.

**Derailment**: when any car's unbalanced lateral acceleration exceeds `Derail.LateralG` (with `Derail.Enabled`), the whole train leaves the rails. Every car becomes a free body with its velocity and real gravity, and they tumble with their collision hulls. Reset puts the train back on the track at the nearest point, stopped.

**TrainTrack** turns an ordered set of nodes into a Catmull-Rom spline. It keeps an arc-length table with position, tangent, curvature (from the heading change over a few samples, so it is smooth), grade, cant and speed limit at any distance. It supports loops and lines (a line's ends are buffer stops), finds the nearest point, and generates simple rails and sleepers for prototyping.

## 9. Track setup in Roblox

```
MainLine (Folder or Model)      tag "TrainTrack"
├─ 1, 2, 3 ... (Parts or Attachments, in order)    node positions; attribute SpeedLimit (km/h) and Cant (degrees) optional
attributes: Loop (bool), DesignSpeedKmh (auto cant for that speed, max 6°)
```

- Space nodes 20–60 studs apart; the spline smooths between them. Curves tighter than the train's bogie spacing look wrong.
- Node positions are the rail tops along the track's centre line.
- The train finds the nearest `TrainTrack` when it is built (or set attribute `Track` on the train to the track's name). Place the train roughly on the line; the builder snaps it on.
- `TrainTrack.BuildRails(TrainTrack.FromInstance(folder))` lays rails and sleepers along the spline for prototyping. Real maps lay their own rail meshes along the same nodes.
- **Switches**: make each route its own track. A branch shares the main line's nodes for at least a train's length before the points, then diverges. Setting the train's `Track` attribute to the branch's name on the server (a lever, a ProximityPrompt, a signalling script) moves the train onto the branch where it stands; it replicates to the driver's client, whose sim follows it.

## 10. Spec fields and real values

| Spec | Consist | Power | Starting TE | Top | Notes |
|---|---|---|---|---|---|
| `PassengerTrain` | 125 t loco + 5 × 50 t coaches | 3.6 MW (η 0.85) | 290 kN | 200 km/h (limit) | 0–100 km/h 58 s, 177 km/h on 1%, service 0.9 m/s², 1.1 km emergency stop from 200 |
| `FreightTrain` | 190 t ES44AC-class + 10 × 100 t | 3.28 MW (η 0.85) | 810 kN | 110 km/h (limit) | 0–100 km/h 208 s, 71 km/h balancing on 1%, starts on 6.8%, service 0.4 m/s² |
| `Tram` | 40 t single unit | 480 kW (η 0.9) | 50 kN | 70 km/h (limit) | 1.24 m/s² launch, 0–50 km/h 13 s, track brakes 2.5 m/s² |

Fields (all optional except `name`, `type: "Train"`):
- `mass` (kg, the powered vehicle), `comHeight` (m above the rail), `length` (m), `bogieSpacing` (m)
- `cars` {`count`, `mass`, `length`, `bogieSpacing`, `cdA`} (the report's consist; in game, the model's `Car*` models are counted, and a car's `Mass` / `BogieSpacing` attributes override these)
- `engine` {`power` (kW), `efficiency`, `startingTractiveEffort` (kN), `adhesion`, `speedLimitKmh`, `reverseSpeedKmh`}
- `resistance` {`rolling` (N/kN), `speed` (N/kN per m/s), `cdA` (m², the powered vehicle)}
- `brakes` {`service`, `emergency` (m/s²), `adhesion`}
- `derail` {`enabled`, `lateralG`}
- `controls` {`notchRate`}

The report prints power-to-weight, starting acceleration, the speed where power takes over from adhesion, 0–50 and 0–100 km/h, top speed and what limits it, balancing speeds on 1% and 2%, the ruling grade, service and emergency stopping distances, and the derailment speed in 150, 300 and 600 m curves.

## 11. Tuning: symptom → fix

| Symptom | Fix |
|---|---|
| Wheelslip on every start | Lower `engine.startingTractiveEffort`, or more `engine.adhesion` (sanded rail), or a heavier loco. |
| Stalls on a hill | The report's ruling grade: more starting effort or fewer `Car*` models. |
| Accelerates too slowly to be fun | More `engine.power`; trams and multiple units launch at ~1 m/s², freight at ~0.2. |
| Overshoots stations | Brake earlier; or raise `brakes.service`. Long freight trains stop in kilometres. |
| Derails too easily | Raise `derail.lateralG`, add cant (`DesignSpeedKmh` on the track), widen curves, or disable derailment. |
| Cars jitter on the track | Space track nodes more evenly and keep curves wider than the cars; the PD needs smooth curvature. |

## 12. Controls

| Device | Power / brake | Emergency brake | Horn | Reset (re-rail) |
|---|---|---|---|---|
| Keyboard | W (hold to notch up) / S (hold to brake); S when stopped reverses | LeftShift | H | R |
| Gamepad | R2 / L2 or left stick | X | L1 | Y |
| Touch | thumbstick | "E-Brake" | "Horn" | "Reset" |

Release W to coast: the power lever falls back. The HUD shows speed, power and brake levers, grade, the current speed limit, WHEELSLIP and DERAILED.
