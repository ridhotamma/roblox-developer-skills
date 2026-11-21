# Airplane physics

## Contents
1. The four forces
2. Lift: angle of attack, the lift curve, stall
3. Drag: parasite, induced, the drag polar
4. Thrust: propellers and jets
5. Performance: stall speed, takeoff, climb, top speed, glide
6. Turning: bank, load factor, coordination
7. Stability and control surfaces
8. Ground effect, flaps, landing gear
9. How GTA and other games do it
10. The kit's model (PlaneSim)
11. Spec fields and real values
12. Tuning: symptom → fix
13. Model setup and controls

---

## 1. The four forces

Lift (perpendicular to the airflow and the wing span), drag (against the airflow), thrust (along the engine) and weight. Everything aerodynamic scales with **dynamic pressure** `q = ½ ρ V²` (ρ = 1.225 kg/m³ at sea level, falling about 10% per 1000 m).

## 2. Lift

```
L = q S C_L(α)          S wing area, α angle of attack (wing chord vs airflow)
C_L = C_L0 + C_Lα α     C_Lα ≈ 2π · AR / (AR + 2) per radian, AR = span² / S
```

A Cessna 172 (AR 7.5) gets C_Lα ≈ 5.0 /rad, a fighter (AR 3) ≈ 3.8. Cambered wings lift at α = 0 (`C_L0` ≈ 0.2–0.3). Past the **critical angle** (14–18° for light planes, 20–30° for fighters with leading-edge devices) the flow separates and lift collapses to ~60% of `C_Lmax` and keeps falling: the **stall**. Typical `C_Lmax`: 1.4–1.6 clean, 2.0–2.2 with flaps.

## 3. Drag

```
D = q S C_D,   C_D = C_D0 + C_L² / (π e AR)
```

- `C_D0` (parasite): 0.025–0.035 light planes with fixed gear, 0.016–0.022 clean jets. It rises sharply near Mach 1 (wave drag, ×2–3).
- Induced drag `C_L² / (π e AR)`, Oswald efficiency e ≈ 0.75–0.85: the price of lift, largest when slow.

Best lift-to-drag `(L/D)max = ½ √(π e AR / C_D0)` (≈ 10–12 for a Cessna; that is also its glide ratio).

## 4. Thrust

**Propellers** are actuator disks (see boat-physics.md §3): `P η = T (V + vᵢ)`. Static thrust `(2 ρ A (η P)²)^(1/3)` is large; at speed thrust ≈ `η P / V`. A fixed-pitch prop's efficiency climbs from ~0.5 at the start of the takeoff roll to ~0.8 at cruise.

**Jets** give roughly constant thrust with speed, dropping with air density (`∝ σ^0.7`). Afterburners add 50–70% thrust at four times the fuel burn. Jet engines spool slowly (3–5 s idle to full).

## 5. Performance

| Quantity | Formula | Cessna 172S |
|---|---|---|
| Stall speed | `V_s = √(2 W / (ρ S C_Lmax))` | 53 kt clean, 48 kt flaps (POH) |
| Rotation / lift-off | ≈ 1.1–1.2 V_s | 55 kt |
| Takeoff ground roll | ∫ V / a, `a = (T − D − μ(W − L)) / m` | 960 ft (293 m) |
| Rate of climb | `(T V − D V) / W` max over V | 730 ft/min (3.7 m/s) |
| Top speed | T = D with L = W | 126 kt (233 km/h) at sea level |
| Best glide | (L/D)max | ~9:1 |
| Manoeuvring speed | `V_s √n_max` | 105 kt at 3.8 g |

## 6. Turning

Planes turn by banking: the lift tilts and its horizontal part curves the flight path.

```
level turn:  n = 1 / cos φ        turn rate ω = g √(n² − 1) / V        radius R = V² / (g tan φ)
```

A 60° bank needs 2 g. Pull more than the wing can give (α > critical) and it stalls in the turn. **Adverse yaw** (the up-going wing's ailerons drag more) swings the nose out of the turn; pilots add rudder to **coordinate** (zero sideslip, the ball centred).

## 7. Stability and control

- **Pitch**: the CoM ahead of the neutral point (static margin 5–15%) makes the nose follow the airflow like a weathervane; elevator deflection sets an angle of attack, not a rate. Trim sets the speed the plane holds hands-off.
- **Yaw**: the fin aligns the nose with the airflow (weathervane).
- **Roll**: dihedral levels the wings in a sideslip; the spiral mode slowly tightens a hands-off bank.
- **Control power** scales with q: controls are mushy near the stall and sharp at speed; maximum roll rates 60–120 °/s for light planes, 180–360 °/s for fighters and aerobatic planes.

## 8. Ground effect, flaps, landing gear

- **Ground effect**: within one wingspan of the ground induced drag falls by `φ = (16h/b)² / (1 + (16h/b)²)` (McCormick), so planes float in the flare.
- **Flaps**: +0.5–0.8 C_Lmax, more drag, slightly lower critical angle; lower stall speed for takeoff and landing.
- **Landing gear**: tricycle (nose wheel, CoM ahead of the mains, stable on the ground) or tail-dragger. Rolling friction μ ≈ 0.02–0.05; braking μ ≈ 0.4–0.5. Retractable gear removes ΔC_D0 ≈ 0.01–0.02.

## 9. How GTA and other games do it

GTA V's `CFlyingHandlingData` is a set of multipliers on simple physical terms: `fThrust`, `fThrustFallOff` (thrust drop with speed), `fFormLiftMult` (lift from forward speed alone), `fAttackLiftMult` / `fAttackDiveMult` (lift from angle of attack), `fSideSlipMult` (velocity pulled toward the nose), `fYawMult` / `fPitchMult` / `fRollMult` (control torques) and `fYawStabilise` / `fPitchStabilise` / `fRollStab` (return toward level or aligned), `fMoveRes` and `vecTurnRes` (damping), gear and wind multipliers. Values vary hugely between aircraft, so it's a tuned model, not a derived one. It flies like this: lift grows with speed, the velocity is pulled toward where the nose points, controls are rate-like with stabilisers, stalls are gentle and recoverable, takeoff is a matter of speed.

War Thunder's "instructor" (mouse aim) flies the plane toward where the camera points; DCS and MSFS use full stability-derivative or blade-element models. The kit keeps real aerodynamics (lift curve, stall, drag polar, momentum-theory props, jets, ground effect) and puts a GTA-style control layer on top, with every assist on a 0–1 dial.

## 10. The kit's model (PlaneSim)

**Gravity.** Real gravity: an upward force cancels Roblox's extra, so lift only has to carry the real weight and every number in the report holds.

**Forces** (SI, then converted like the car): lift `q S C_L(α)` perpendicular to the airflow in the plane of symmetry, drag `q S C_D` with induced drag reduced in ground effect, side force `−q S C_Yβ β` (fuselage and fin, so velocity follows the heading), thrust along the nose. `C_L(α)` is linear to `C_Lmax` at `StallDeg`, then blends to `PostStall × C_Lmax` and toward a flat plate; flaps add lift and drag. Mach drag rise for jets. Air density falls with altitude.

**Control law** (what makes it fly like a game plane):
1. The flight path's own turn rate `ω_path = (v̂ × a) / V` is computed from this step's forces.
2. Pitch stick sets an **angle-of-attack target**: neutral = the α that holds the flight path (`AutoTrim` = 1: n = cos γ / cos φ, so banked turns hold altitude, minus `3 × AutoLevel × sin γ` so it eases back toward level and pulls out of dives) or a fixed trim α (`AutoTrim` = 0); full back = 0.9 × stall α (`StallProtection` = 1) up to 10° past stall (0); limited by `MaxG`. The α needed for n g counts the thrust line tilted up by α (3% of a jet's weight), the target's own rate is fed forward, and the α rate is anticipated near the limit so protection doesn't overshoot.
3. Roll stick sets a roll rate `RollRate × stick × authority`; with the stick neutral `AutoLevel` rolls the wings level from banks under 75°.
4. Rudder sets a sideslip target; `Coordination` holds zero sideslip (auto-rudder).
5. The body's target angular velocity is `ω_path + pitch correction toward α_target + roll rate + yaw correction toward β_target`, tracked by a torque `I k (ω_target − ω) × authority`, with authority `q / q_full` (full at `1.25 V_s`). Near the stall the controls go soft; in a stall the nose follows the falling flight path and drops, and the plane recovers by itself once it has speed.

**On the ground** the landing gear (raycast suspension with nose-wheel steering, rolling resistance and brakes) carries it; roll and yaw control fade with weight on wheels, the nose wheel steers with the rudder or roll input, and pulling back at rotation speed lifts the nose. Holding throttle-down at idle brakes; stopped with the throttle at idle holds the parking brake. Retractable gear (`Gear.Retractable`) toggles in the air.

## 11. Spec fields and real values

| Spec | Mass | Wing | Engine | Stall | Top (SL) | Climb | Takeoff roll |
|---|---|---|---|---|---|---|---|
| `LightPlane` (Cessna 172S-class, gross weight) | 1157 kg | 16.2 m², span 11 m | 134 kW prop | 99 km/h (54 kt; POH 53) | 230 km/h (124 kt; POH 126) | 3.5 m/s (POH 3.7) | 258 m (POH 293) |
| `JetFighter` (F-16-class) | 12000 kg | 27.9 m², span 9.96 m | 76 kN / 127 kN AB | 236 km/h | 1225 km/h dry, 1400 km/h AB | 249 m/s AB | 247 m AB |

Fields (all optional except `name`, `type: "Plane"`): `mass`, `frontWeight` (share on the nose gear; ~0.9 for tail-draggers whose front wheels are the mains), `comHeight`, `length`, `wing` {`area`, `span`, `cl0`, `clMax` (the stall angle follows from these and the lift slope), `postStall`, `cd0`, `oswald`, `flapsCl`, `flapsCd`, `cyBeta`, `machDragRise`}, `engine` {`type` prop/jet, `power` (kW), `propDiameter`, `efficiency`, `staticEfficiency`, `efficiencySpeedKmh`, `thrust` (kN), `afterburner` (kN), `spool` (s), `speedLimitKmh`}, `controls` {`rollRate`, `pitchRate`, `yawRate`, `maxG`, `minG`, `maxBeta`}, `assists` {`stallProtection`, `autoTrim`, `autoLevel`, `coordination`}, `gear` {`retractable`, `drag`, `frequency`, `dampingRatio`, `maxLength`, `rideHeight`, `steerAngle`, `brakeG`, `grip`, `rollingResistance`}, `recovery` {`autoFlip`}.

## 12. Tuning: symptom → fix

| Symptom | Fix |
|---|---|
| Won't take off | Check the report's lift-off speed vs top speed; more `engine.power`/`thrust`, bigger `wing.area`, `clMax`, or use flaps. |
| Takes off by itself | `assists.autoTrim` holds the ground attitude on wheels already; lower `wing.cl0`. |
| Feels floaty / balloons | Raise `mass` or `wing.cd0`; lower `wing.area`. |
| Sluggish roll | Raise `controls.rollRate` (90 light, 180–270 aerobatic/fighter). |
| Nose wanders on keyboard | Raise `assists.coordination` and `assists.autoLevel`. |
| Stalls too easily | `assists.stallProtection` = 1; lower `controls.maxG`. |
| Unrealistically fast (jets cross a 10k-stud map in seconds) | `engine.speedLimitKmh`: no thrust past it, and steep extra drag caps dives. |
| Bounces on landing | Raise `gear.dampingRatio` (0.6–0.8), lower `gear.frequency`. |
| Tips on a wingtip while taxiing | Lower `comHeight`, check `frontWeight` matches the gear layout. |

## 13. Model setup and controls

```
LightPlane (Model)        attribute Vehicle = "LightPlane", tag "Vehicle", pivot facing the nose
├─ Fuselage, Wings, Tail (any parts)
├─ DriverSeat (VehicleSeat)
├─ WheelF                 nose wheel (steers); tail-dragger: WheelFL/WheelFR mains + WheelR tail
├─ WheelRL, WheelRR       main gear
├─ Propeller              optional visual, spins with throttle (pivot on the prop axis)
├─ AileronL, AileronR, Elevator, Rudder, FlapL, FlapR   optional visuals (pivot on the hinge line)
```

| Device | Pitch / roll | Rudder | Throttle | Gear / flaps | Reset |
|---|---|---|---|---|---|
| Keyboard | W/S (W = nose down), A/D | Q / E | LeftShift / LeftCtrl (Ctrl at idle = brakes) | G / F | R |
| Gamepad | left stick | L1 / R1 | R2 / L2 | D-pad down / up | Y |
| Touch | thumbstick | auto (coordination) | "Throttle +" / "Throttle −" | "Gear" | "Reset" |

`AIM_FLIGHT` in the controller turns on point-to-fly: the plane steers toward the camera's look direction whenever the stick is centred (War Thunder style), good for mouse and touch.
