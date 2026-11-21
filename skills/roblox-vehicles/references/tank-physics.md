# Tank physics

## Contents
1. Tracks: why tanks don't sink and how they push
2. Tractive effort: power, the hyperbola and adhesion
3. Resistance: rolling, soft ground, slopes
4. Skid steering: the turning-resistance moment
5. Suspension, obstacles and the hull's pitch
6. Turret, gun and stabilisation
7. Recoil
8. How GTA and other games do it
9. The kit's model (TankSim)
10. Spec fields and real values
11. Tuning: symptom → fix
12. Model setup and controls

---

## 1. Tracks

A track lays its own road: the weight is spread over the whole ground contact, so a 62 t tank presses the ground about as hard as a person standing (100 kPa vs ~20–60 kPa for a foot, ~250 kPa for a car tire):

```
ground pressure p = W / (2 · L · b)       L ground contact length, b track width
```

M1A2 Abrams: 62 t on 4.6 m × 0.635 m per side → ~104 kPa. The track is driven by a sprocket (rear on most Western tanks); it pushes the ground through shear, so traction is `μ × W` with μ ≈ 0.7–1.0 on hard ground, 0.4–0.6 on mud. Road wheels on torsion bars ride on the inside of the track.

## 2. Tractive effort

A tank's engine and transmission are matched so that, through the gears, the track force follows the **tractive-effort hyperbola** of constant power:

```
F(v) = min(F_max, η P / v)        F_max = min(adhesion μ W, low-gear torque limit)
```

Abrams: 1,120 kW, η ≈ 0.75 at the sprockets → at 10 m/s, 84 kN; at 18.6 m/s (67 km/h, governed), 45 kN. Below ~3 m/s the adhesion/torque limit (~400 kN) caps it. 0–32 km/h takes about 7 s. Power-to-weight sets everything: 18 kW/t for the Abrams, 13 kW/t for a T-72, 20–25 kW/t for light tanks.

## 3. Resistance

```
R = f_r W + W sin θ + ½ ρ C_d A v²
```

- Rolling resistance of tracks is high: `f_r` ≈ 0.03–0.05 on roads, 0.06–0.1 on grass, 0.1–0.2 in mud and sand (internal track and suspension losses plus sinkage).
- Slopes: a 60% gradient (31°) is the usual design limit; it needs `F_max > W (sin θ + f_r cos θ)`.
- Aero is small at tank speeds (C_d·A ≈ 6–8 m²).

## 4. Skid steering

Tracked vehicles turn by driving one track faster than the other. The hull pivots about its centre, so the front and rear of each track's contact patch must **slide sideways**, and the ground resists with a moment (uniform pressure, slow turn):

```
M_r = μ_t · W · L / 4          μ_t lateral resistance coefficient (0.5–0.8 hard ground)
F_outer − F_inner ≈ 2 M_r / B  B tread (distance between track centres)
```

- The **steering ratio L/B** decides how hard a tank turns: 1.0–1.6 turns easily, above ~1.8 it fights every turn. Abrams: 4.6 / 2.95 ≈ 1.56.
- **Neutral (pivot) steer**: tracks in opposite directions, the hull spins on the spot. Each track needs ±M_r/B ≈ 0.24 W on an Abrams, well within traction.
- At speed the lateral grip limit is about μ_t g: tanks skid if turned harder than ~0.5 g. Steering units (regenerative, double-differential) give a turn radius proportional to speed, so a stick deflection asks for a **yaw rate**.

## 5. Suspension and obstacles

Torsion-bar suspension at about 1–1.5 Hz with heavy damping (ζ 0.4–0.6) and 0.3–0.45 m of travel. The raised idler and sprocket at the ends let the track climb steps of ~1 m and cross ~2.7 m trenches. Under acceleration and braking the hull **squats and dives** visibly (a few degrees), the signature tank motion. Rollover needs very high lateral g (wide, low hull): tanks rarely tip.

## 6. Turret, gun and stabilisation

- **Traverse**: Abrams 360° in ~9 s (40°/s) powered, light tanks 30–60°/s. Elevation −9° to +20°, about 25–40°/s.
- **Stabilisation**: since the 1970s, gyro-stabilised turrets and guns hold their aim in space while the hull pitches, rolls and turns, so tanks fire on the move. A game expresses this by aiming at a world direction (the camera's) and letting the turret and gun turn toward it at their rate limits.
- **Reload**: 6–10 s (Abrams with a loader ~6 s, autoloaders 7–8 s).

## 7. Recoil

Momentum of projectile plus propellant gases goes back into the gun: a 120 mm APFSDS round (8.4 kg at 1,650 m/s) plus gases gives an impulse around 20 kN·s. The recoil mechanism spreads it over ~0.5 m of travel, so the hull gets a short shove: Δv ≈ J / m ≈ 0.3 m/s backward and a visible rock, nose up when the gun points forward (the force acts above the centre of mass).

## 8. How GTA and other games do it

GTA's Rhino: slow and heavy, W/S/A/D with pivot turns, the turret follows the camera, the cannon on the attack button with a long reload, cars bounce off it and it climbs most things. Battlefield and War Thunder (arcade) work the same way with traverse limits, gun elevation limits and stabilisers; War Thunder's realistic mode adds gear changes, track speed limits and per-track control. The kit keeps the real numbers (tractive hyperbola, track friction, skid-steer moment, suspension, recoil) under a GTA control scheme.

## 9. The kit's model (TankSim)

**Gravity**: real (an upward force cancels Roblox's extra).

**Contacts.** Each track is sampled at `Tracks.Contacts` points along its ground length (default 6), plus an idler and a sprocket at the hull ends, raised by `Tracks.Approach`, for climbing. Each is a sphere-cast spring (frequency and damping ratio) with the spring force at the contact. Past full compression a stiff bump stop makes the contact rigid (a real idler isn't sprung), so the track climbs a step of about 1.1 m instead of hanging the hull on it.

**Track forces.** Each contact gets:
- its share of its track's longitudinal force, capped by `μ × load`
- lateral friction (Coulomb with a stop limit), capped by `Tracks.LateralGrip × load`

Because the front and rear contacts slide in opposite directions when the hull yaws, the turning-resistance moment μ W L / 4 emerges by itself. A low L/B turns easily; a long hull fights.

**Drive.** The sticks set target track speeds, the way a tank's steering unit does:

```
v_cmd  = throttle × MaxSpeed (ReverseSpeed backwards)
r_cmd  = steer × yaw rate, from PivotRate at a standstill down to what μ_t g / v allows at speed
v_L,R  = v_cmd ± r_cmd · B / 2
F_L,R  = clamp(k · m_side · (v_L,R − v_measured), −brakes, +tractive effort)
```

The tractive effort is `min(Engine.MaxTractiveG × W, η P / |v|)`. The cap is on the tracks' **net** power: in a turn the braked inner track's power goes to the outer one, as in a regenerative steering unit, so a tank turns at speed without stalling. Rolling resistance acts on each contact, and drag at the centre of mass. Off the throttle the track speed falls at 0.15 g (engine braking and track losses), uphill or down; once stopped the brakes hold it, and friction includes gravity's pull along the slope, so it doesn't creep.

**Turret and gun.** The aim is a world direction (the camera's). The turret turns toward it in the hull's frame at `Turret.TraverseRate`, and the gun at `Turret.ElevationRate`, within `MinElevation`/`MaxElevation`. Aiming at a world direction is what makes it stabilised.

**Firing.** Each shot puts the recoil impulse (`Gun.Recoil` kN·s) into the hull at the trunnion, along the gun axis. Shots are only allowed every `Gun.Reload` seconds.

**Never stuck.** Rounded low-friction hull above the track tops (only the track contacts touch the ground, so nothing snags under the hull), stuck assist (a push and a lift after 1.5 s of throttle without moving, but not against a wall it would only climb), auto-upright, Reset.

## 10. Spec fields and real values

| Spec | Mass | Power | Contact L × b, tread | Ground pressure | Top | Pivot | Traverse |
|---|---|---|---|---|---|---|---|
| `MainBattleTank` (Abrams-class) | 62 t | 1,120 kW | 4.6 × 0.635 m, 2.95 m | ~104 kPa | 67 km/h (governed) | ~25°/s | 40°/s, −9°/+20° |
| `LightTank` (CV90/M8-class) | 25 t | 450 kW | 3.6 × 0.53 m, 2.6 m | ~64 kPa | 70 km/h | ~40°/s | 50°/s, −8°/+35° |

Fields (all optional except `name`, `type: "Tank"`):
- `mass`, `comHeight` (m above the ground), `length`, `width`, `height` (m, inertia and hull)
- `tracks` {`contactLength`, `width`, `tread`, `contacts`, `wheelRadius`, `grip`, `lateralGrip`, `rollingResistance`, `approach` (m the end points sit above the ground)}
- `engine` {`power` (kW), `efficiency`, `maxTractiveG`, `maxSpeedKmh`, `reverseSpeedKmh`, `spool` (s)}
- `steering` {`pivotRate` (deg/s), `turnRate` (deg/s at low speed), `maxLateralG`}
- `brakes` {`decelG`}
- `suspension` {`frequency`, `dampingRatio`, `maxLength` (studs), `rideHeight`}
- `turret` {`traverseRate`, `elevationRate`, `minElevation`, `maxElevation`}
- `gun` {`reload` (s), `recoil` (kN·s), `muzzleVelocity` (m/s), `range` (m), `defaultShell` (bool)}
- `recovery` {`autoFlip`, `stuckAssist`}, `assists` {`stability`}, `aero` {`cd`, `area`}, `body` {`hullFriction`}

The report prints power-to-weight, ground pressure, steering ratio and the turning moment, the tractive effort at standstill and top speed, 0–32 and 0–50 km/h, top speed and what limits it, braking distance, the steepest slope it can climb, the pivot time, turret 360° time and recoil Δv.

## 11. Tuning: symptom → fix

| Symptom | Fix |
|---|---|
| Won't pivot / turns sluggishly | Lower `tracks.lateralGrip` or `tracks.contactLength` (L/B); raise `engine.maxTractiveG`. |
| Spins like a top | Lower `steering.pivotRate`, `steering.turnRate`. |
| Slides out in turns at speed | Lower `steering.maxLateralG` (asks for gentler yaw), raise `tracks.lateralGrip`. |
| Too slow off the line | Raise `engine.power` (kW/t) or `engine.maxTractiveG`. |
| Can't climb the hill | Report's max slope; raise `engine.maxTractiveG`, `tracks.grip`. |
| Bounces / wallows | Raise `suspension.dampingRatio` (0.5–0.7), lower `frequency`. |
| Turret too fast / slow | `turret.traverseRate` (20–60 °/s). |
| Firing barely moves the hull, or throws it | `gun.recoil` (kN·s): 10–25 for 105–125 mm guns. |

## 12. Model setup and controls

```
Abrams (Model)        attribute Vehicle = "MainBattleTank", tag "Vehicle", pivot facing forward
├─ Hull (any parts)
├─ DriverSeat (VehicleSeat)
├─ TrackL, TrackR      track meshes (left and right); their bottoms set the ground contact.
│                      A Texture inside scrolls with track speed.
├─ WheelL1..n, WheelR1..n   optional road wheel visuals, spun by track speed
├─ Turret              visual, turns about the hull's up axis at its pivot
└─ Gun                 visual inside or beside the turret, pitches about its pivot (the trunnion).
                       Muzzle (Attachment) at the barrel end.
```

| Device | Throttle / reverse | Steer (pivot when stopped) | Aim | Fire | Reset |
|---|---|---|---|---|---|
| Keyboard + mouse | W / S | A / D | the camera (right-drag or shift-lock) | left click | R |
| Gamepad | left stick / R2-L2 | left stick | right stick (camera) | R1 | Y |
| Touch | thumbstick | thumbstick | drag the camera | "Fire" | "Reset" |

Shots go to the server (`VehicleControl` remote). The server checks the driver, the reload time and the aim, rocks the hull for everyone, and fires `VehicleService.Fired(player, model, origin, direction, gun)`. Connect it to the `roblox-combat` skill's projectiles. With `gun.defaultShell = true`, the server also raycasts the shot and makes a harmless explosion for prototyping.
