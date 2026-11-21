# Helicopter physics

## Contents
1. Controls: collective, cyclic, pedals
2. Momentum theory: thrust, induced velocity, hover power
3. Power in forward flight: the bucket curve
4. Translational lift, ground effect, vortex ring state, blade stall
5. Attitude, torque and the tail rotor
6. How GTA and other games do it
7. The kit's model (HeliSim)
8. Spec fields and real values
9. Tuning: symptom → fix
10. Model setup and controls

---

## 1. Controls

- **Collective** changes all blades' pitch together: more thrust, up.
- **Cyclic** tilts the rotor disk: the thrust vector tilts, the helicopter tilts and accelerates that way. To fly forward you lower the nose.
- **Pedals** change tail-rotor thrust: yaw.
- **Throttle** is governed: the rotor turns at a constant rpm (tip speed ~200–220 m/s) and the engine supplies whatever power the collective demands, up to its limit.

## 2. Momentum theory

The rotor is an actuator disk of area `A = π R²`. To hover it must push air down:

```
T = 2 ρ A vᵢ²            → induced velocity vₕ = √(T / (2 ρ A))
P_ideal = T vₕ = T^1.5 / √(2 ρ A)
```

**Disk loading** `T / A` sets everything: a Bell 206 (1360 kg, 10.16 m rotor) has ~165 N/m² and vₕ ≈ 8 m/s; heavy attack and transport helicopters 300–500 N/m². Real power adds blade **profile drag** `P₀ = σ C_d0 / 8 · ρ A (ΩR)³` (σ = blade area ÷ disk area, 0.04–0.09) and an induced-loss factor κ ≈ 1.15, plus ~10% for the tail rotor. Climbing at `V_c` costs `T V_c` more, but the inflow reduces the induced part: `vᵢ = −V_c/2 + √((V_c/2)² + vₕ²)`.

## 3. Forward flight: the bucket

In forward flight the rotor processes more air, so induced velocity falls (Glauert):

```
vᵢ = vₕ² / √(V_x² + (V_z + vᵢ)²)      (solved by iteration)
P = κ T vᵢ + P₀ (1 + 4.65 μ²) + T · V_axial + P_tail     μ = V_x / ΩR (advance ratio)
```

`T · V_axial` is the power the tilted thrust spends pushing the fuselage through the air (`½ ρ f V³`, f = equivalent flat-plate area: 1 m² light helicopters, 2–3 m² heavy). The total makes a **bucket**: high in hover, lowest around 100–130 km/h (best climb and endurance speed), rising steeply at high speed. Top speed is where the bucket meets available power, or where the retreating blade stalls (μ ≈ 0.35–0.45), whichever comes first.

## 4. Lift effects

- **Effective translational lift (ETL)**: around 25–45 km/h induced power drops sharply; the helicopter climbs or shudders through it. In the model it falls out of Glauert's formula.
- **Ground effect**: within about one rotor diameter the ground blocks the downwash; thrust for the same power rises by `1 / (1 − (R / 4z)²)` (Cheeseman–Bennett): ~7% at z = R, ~20–30% at skid height. Hovering in ground effect needs noticeably less power.
- **Vortex ring state**: descending vertically at about 0.5–1.5 vₕ (4–12 m/s for a light helicopter) with little forward speed, the rotor flies into its own downwash and loses thrust; more collective makes it worse. Exit by flying forward.
- **Retreating blade stall**: at high speed the retreating blade can't make enough lift; the helicopter pitches up and rolls. It sets the speed limit (V_NE).
- **Autorotation**: with the engine off the descent drives the rotor like a windmill; a skilled flare lands safely. Not modelled: an empty helicopter just loses thrust as the rotor spools down.

## 5. Attitude, torque and the tail rotor

The fuselage hangs below the hub like a pendulum; real helicopters are statically unstable in hover (they drift and oscillate unless flown). The main rotor's torque yaws the body the other way; the tail rotor cancels it (its power ~10%). At speed the tail fin weathervanes the nose into the airflow and the helicopter flies more like a plane: pedals coordinate, cyclic banks it into turns.

## 6. How GTA and other games do it

GTA V helicopters use the same `CFlyingHandlingData` as planes, with lift that doesn't need forward speed: thrust along the rotor axis from the throttle, `fPitchStabilise` / `fRollStab` bringing the body back to level when the stick is released, `fYawStabilise`, per-axis movement and turn resistance, and a short engine spool-up before take-off. Play-feel: hands-off it roughly holds its height and settles level, tilt to move, yaw to turn, collective up/down to climb and descend, and it banks into turns at speed. Battlefield adds a heavier inertial feel; Arma and DCS simulate the rotor (no self-levelling, torque, VRS, ground effect).

## 7. The kit's model (HeliSim)

**Gravity**: real (an upward force cancels Roblox's extra).

**Rotor thrust** along the body's up axis (the cyclic tilt is the body tilt), from:
- **Available thrust** `T_max`: the largest T whose power (momentum theory with Glauert inflow, profile power with μ, `T · V_axial`, tail rotor) fits `Engine.Power × rotor speed`, times ground effect `1 / (1 − (R / 4z)²)` (z from a downward cast, clamped), times a retreating-blade-stall loss past `Rotor.BladeStallMu`. Translational lift, power-limited climbs and a real top speed all come from this.
- **Command**: with `Assists.AltitudeHold` = 1 the collective input asks for a vertical speed (`Controls.ClimbRate` up, `Controls.DescentRate` down, 0 = hold height) and the thrust is solved for it; with 0 the collective is a lever that stays where it's put, thrust = lever × T_max, with heave damping (`Rotor.HeaveDamping`, the real rotor's thrust drop when climbing).
- **Rotor speed** spools up over `Rotor.SpoolTime` when a pilot is in, and down when empty; thrust ∝ rotor speed².
- Optional **vortex ring state** (`Realism.VortexRing`).

**Fuselage drag** per body axis: `½ ρ C_d A v|v|` with forward (`Fuselage.DragArea`), side and top areas.

**Attitude control.** Pitch stick (W/S) and roll (Q/E) set target pitch and bank (`Controls.MaxPitch`, `MaxBank`) with `Assists.Level` = 1 (attitude mode, releases back to level like GTA) or target rates with 0 (rate mode, holds the attitude you leave it in). With the stick released, `Assists.HoverHold` tilts against any drift (up to 20°) so it comes to a stop over a spot. Pedals (A/D) set a yaw rate; at speed `Assists.Coordination` banks into the yaw and the yaw follows the coordinated turn rate g tan φ / V, while `Assists.Weathervane` swings the nose into the airflow (sideslip stays under ~7° in the lab). A torque `I k (ω_target − ω)` tracks the rates, faded while sitting on the skids so it can't tip itself over.

**Ground.** Skids (two contact points per `Skid*` part, static friction holds it on slopes) or wheels (`Wheel*`), raycast-sprung like the plane's gear. Rotor parts are excluded from the collision hull.

## 8. Spec fields and real values

| Spec | Mass | Rotor | Power | Hover power | Max climb | Top speed |
|---|---|---|---|---|---|---|
| `LightHeli` (Bell 206-class) | 1360 kg | 10.16 m | 236 kW (transmission) | 197 kW OGE, 159 kW IGE | 6.1 m/s vertical, 8.8 m/s at 91 km/h | 205 km/h (power) |
| `AttackHeli` (Apache-class) | 8000 kg | 14.63 m | 2100 kW | 1683 kW OGE | 10.9 m/s vertical | 301 km/h (blade stall; real 293) |

Fields (all optional except `name`, `type: "Helicopter"`): `mass`, `comHeight` (m above the skid bottoms), `frontWeight` (wheels only), `length`, `rotor` {`diameter`, `tipSpeed`, `solidity`, `profileCd`, `inducedFactor`, `tailPower`, `spoolTime`, `bladeStallMu`, `heaveDamping`}, `engine` {`power`}, `fuselage` {`dragArea`, `sideArea`, `topArea`}, `controls` {`pitchRate`, `rollRate`, `yawRate`, `maxPitch`, `maxBank`, `climbRate`, `descentRate`}, `assists` {`altitudeHold`, `level`, `hoverHold`, `coordination`, `weathervane`}, `realism` {`groundEffect`, `vortexRing`}, `gear` {`frequency`, `dampingRatio`, `maxLength`, `rideHeight`, `grip`, `rollingResistance`, `brakeG`}, `recovery` {`autoFlip`}.

The report prints disk loading, vₕ, hover power out of and in ground effect, power margin, vertical climb rate, the bucket (minimum-power speed and the climb rate there) and top speed with what limits it.

## 9. Tuning: symptom → fix

| Symptom | Fix |
|---|---|
| Can't lift off | Report's hover power must be below `engine.power`; lower `mass` or raise `rotor.diameter`. |
| Climbs like a rocket | Lower `controls.climbRate` (assist) or `engine.power`. |
| Too slow forward | Raise `controls.maxPitch` (25–35°), lower `fuselage.dragArea`, check the blade-stall limit. |
| Drifts after releasing the stick | Raise `assists.hoverHold`. |
| Wobbles / oscillates | Lower `controls.pitchRate` / `rollRate`. |
| Flat, car-like turns | Raise `assists.coordination`. |
| Nose won't hold heading at speed | Lower `assists.weathervane`. |
| Too easy for a sim game | `assists.level` 0, `assists.altitudeHold` 0, `realism.vortexRing` 1. |

## 10. Model setup and controls

```
LightHeli (Model)         attribute Vehicle = "LightHeli", tag "Vehicle", pivot facing the nose
├─ Fuselage, TailBoom (any parts)
├─ DriverSeat (VehicleSeat)
├─ SkidL, SkidR           landing skids (long thin parts; or wheels named Wheel*)
├─ MainRotor              visual, spins about its thinnest axis; centre of mass goes under it
└─ TailRotor              visual
```

| Device | Forward / back (pitch) | Turn (yaw) | Strafe (roll) | Up / down | Reset |
|---|---|---|---|---|---|
| Keyboard | W / S | A / D | Q / E | LeftShift / LeftCtrl | R |
| Gamepad | left stick | left stick | L1 / R1 | R2 / L2 | Y |
| Touch | thumbstick | thumbstick | — (auto-coordinated) | "Up" / "Down" | "Reset" |
