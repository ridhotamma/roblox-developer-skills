# Boat physics

## Contents
1. Floating: buoyancy, draft, stability
2. Moving through water: resistance, hull speed, the hump, planing
3. Propulsion: propellers, water jets, power to thrust
4. Steering: outboards, rudders, jets; why boats turn the way they do
5. Waves
6. How GTA and other games do it
7. The kit's model (BoatSim)
8. Water sources in Roblox
9. Spec fields and real values
10. Tuning: symptom → fix
11. Model setup and controls

---

## 1. Floating

**Archimedes.** Water pushes up with the weight of the water displaced: `F = ρ g V_submerged`, ρ = 1025 kg/m³ (sea) or 1000 (fresh). A boat floats where `ρ V = m`. The displaced volume `∇ = m / ρ`; draft follows from the hull shape: `T = ∇ / (L · B · Cb)` with the block coefficient `Cb` (0.35–0.45 planing hulls, 0.5–0.65 displacement hulls).

**Heave, pitch and roll** are springs: lift a hull by `z` and buoyancy drops by `ρ g A_wp z` (A_wp = waterplane area), so the heave natural period is `2π √(m (1 + added mass) / (ρ g A_wp))` — about 1–2 s for small boats. Pitch and roll work the same way with the waterplane's second moment.

**Stability.** Heel a boat and the centre of buoyancy moves toward the low side; the righting arm is `GM sin φ` where the metacentric height `GM = KB + BM − KG` and `BM = I_T / ∇` (I_T = waterplane second moment across the beam ≈ L B³ / 12 × fullness). Wide, low boats are stiff (big GM, quick roll); narrow, tall ones are tender. Roll period ≈ `2π · 0.4 B / √(g GM)`.

## 2. Moving through water

Total resistance = **friction** + **wave-making** (+ spray, air, appendages).

**Friction** (ITTC-57 line): `R_f = ½ ρ v² S C_f`, `C_f = 0.075 / (log₁₀ Re − 2)²`, `Re = v L / ν` (ν ≈ 1.19×10⁻⁶ m²/s). Wetted surface (Mumford): `S ≈ 1.7 L T + ∇ / T`.

**Waves and the Froude number.** A hull makes a wave system whose length grows with speed. Speed is measured by the length Froude number `Fn = v / √(g L)`:

| Fn | Speed-length ratio (kn/√ft) | What happens |
|---|---|---|
| < 0.35 | < 1.2 | Displacement mode, low wave drag. |
| ≈ 0.40 | 1.34 | **Hull speed**: the bow wave is as long as the hull; the stern sinks into its trough. |
| 0.45–0.6 | 1.5–2 | **The hump**: wave drag peaks (resistance-to-weight 0.10–0.20). Displacement hulls stop here. |
| 0.6–1.0 | 2–3.4 | Semi-planing: dynamic lift raises the hull, bow up. |
| > 1.0–1.2 | > 3.4 | **Planing**: most weight carried by water pressure on the bottom; the hull skims. |

Hull speed in knots ≈ `1.34 √(LWL in ft)`: a 10 m trawler tops out near 8.4 kn (15.6 km/h) however much power it has.

**Planing.** A flat-ish bottom at a small trim angle τ (3–5°) moving fast gets lift from water pressure, like a water ski. The pressure force is tilted back by τ, so planing drag ≈ `W tan τ` (≈ 0.05–0.09 W) plus friction on a much smaller wetted area. That is why resistance *falls* after the hump: a planing boat at 80 km/h may need less thrust per kilogram than at 25 km/h. Savitsky's method is the engineering version; the kit uses a compact form of the same physics (§7).

## 3. Propulsion

Any propeller, rotor or jet is an **actuator disk**: to make thrust it accelerates water (or air) through its disk area A. Momentum theory gives the power needed:

```
T = 2 ρ A (v + vᵢ) vᵢ        P = T (v + vᵢ) / η        vᵢ = induced velocity
static thrust (v = 0):  T = (2 ρ A (η P)²)^(1/3)
```

So thrust per power is huge at low speed and falls like `η P / v` at speed. Bollard pull (static thrust) for small fast boats is about 50–80 N per kW; outboard propeller efficiency at speed is 0.5–0.65 (including the gearcase drag). Water jets (jet skis) have small nozzles: weaker at low speed, efficient at high speed, and **no thrust means no steering**. Propellers and jets only work under water: a boat in the air revs freely and loses drive.

## 4. Steering

- **Outboard / sterndrive**: the whole thrust line swivels; strong steering at low speed, depends on throttle.
- **Inboard + rudder**: rudder lift `½ ρ v² A_r C_Lα δ` grows with speed and prop wash; weak when slow.
- **Jet**: the nozzle swivels; steering only with throttle.

Steering pushes the **stern** sideways, so a boat pivots about a point well forward of the stern (unlike a car, the back swings out). The hull's lateral resistance (keel, chines, wetted side area) then turns the boat's velocity. Planing hulls with deadrise **bank into** turns (the inside chine digs in) and slide more because less hull is in the water; displacement hulls heel **out** of turns.

## 5. Waves

Deep-water waves of length λ travel at `c = √(g λ / 2π)` (a 30 m swell moves at 6.8 m/s). A sum of a few sine or Gerstner waves of different lengths and directions makes a convincing sea. A boat rides the slope of waves longer than itself and slams through shorter ones; at speed it launches off crests.

## 6. How GTA and other games do it

GTA V's `CBoatHandlingData` fields show the arcade recipe:

| Field | Meaning |
|---|---|
| `fAquaplaneForce`, `fAquaplanePushWaterMult` | Planing lift at speed and the spray it throws. |
| `fProwRaiseMult` | How much the bow rises under power. |
| `fRudderForce`, `fRudderOffsetSubmerge` | Steering force and where it acts. |
| `vecMoveResistance` (x, y, z) | Water drag per axis: low forward, very high sideways (the keel) and vertical. |
| `vecTurnResistance` | Rotational damping. |
| `fKeelSphereSize`, `fSampleTop`, `fSampleBottom` | Buoyancy sample shape. |
| `fImpellerOffset`, `fImpellerForceMult`, `fPropRadius` | Where thrust acts; thrust only under water. |

So GTA boats: buoyancy from sample points over the hull, per-axis water drag, a planing force that lifts the bow, thrust only when the prop is wet, steering at the stern, inward lean in turns, and they very rarely capsize. Kerner's "Water interaction model for boats in video games" (used in Just Cause 3) goes further: per-triangle hydrostatic pressure, viscous drag from the ITTC line, pressure drag on faces pushing into the flow and slamming forces. Both are sample-based buoyancy plus shaped drag; the kit sits between them.

## 7. The kit's model (BoatSim)

**Gravity.** Boats live in real gravity (an upward force cancels Roblox's extra), so bobbing, heave and roll periods are real; fully airborne they fall at `Recovery.AirGravity` g.

**Buoyancy.** The hull is sampled at a grid of points over its bottom (`along × across`, default 5 × 3), each a column of waterplane area `A_wp / n`. Per point: depth below the water surface `d` (clamped to the hull depth), force `ρ g Aᵢ d` straight up at that point. `A_wp` comes from the spec (`∇ / T`), so **the boat floats at the spec's draft whatever the mesh**, and pitch and roll stiffness come out of the point layout. Vertical water damping per point (`Hull.Damping`, a damping ratio) settles heave, pitch and roll.

**Planing lift.** Per point: `½ ρ min(u, V_p)² Aᵢ C_plane · min(d / d_plane, 1)`, with `C_plane` solved so that at full planing speed `V_p` (`Hull.PlaningSpeedKmh`, default Fn 1.2) the hull carries `Hull.PlaningLift` of its weight dynamically. Past `V_p` the lift stops growing and the hull settles at the wetted length that carries it (letting lift grow with v² makes it skim on centimetres of water and porpoise). It rises as speed builds, the wetted area shrinks and resistance drops: planing emerges, it isn't scripted. Lift is weighted toward the bow (`Hull.LiftBow`, the stagnation line sits at the front of the wetted area), which sets the running trim bow-up, and it acts square to the hull bottom, so **a heeled hull carves** (its lift tips sideways, like a motorcycle's camber thrust). A planing surface also resists vertical motion (its angle of attack changes), so heave and pitch damping grow with speed.

**Resistance**, in the boat's frame, from the measured planing share `ℓ` (dynamic lift ÷ weight):
```
R = R_friction(S_wet) + W [ (1 − ℓ) · humpRW · bump(Fn) + ℓ · tan(Trim) ] + air drag
bump(Fn) = x⁴ to the hump, then 2x⁴/(1 + x⁶) blended toward x⁴ by Hull.WaveWall,  x = Fn / 0.5
S_wet    = S₀ (0.25 + 0.75 · immersion)
```
`bump` peaks at Fn ≈ 0.56 (the hump) and then falls for planing hulls; `WaveWall` = 1 keeps it rising for displacement hulls (the hull-speed wall). Resistance is shared across the immersed points, so it pitches and yaws the hull naturally. A bow-rise torque proportional to the wave drag (`Hull.ProwRise`) lifts the bow over the hump, like GTA's `fProwRaiseMult`.

**Lateral resistance.** Per point, `½ ρ C_lat (Δx · d) (|v_lat| + 0.4) v_lat`, weighted aft (`Hull.KeelAft`) for directional stability, applied at the centre of mass height (the heel is set separately). It shrinks as the hull rises, so boats carve when slow and slide when planing.

**Heel.** A controller leans the hull to `Bank × ½ × atan(v ω / g)`: planing hulls (`Hull.Bank` > 0) bank into turns by their planing share, displacement hulls (`Bank` < 0) heel out, capped at 25°.

**Propulsion.** Actuator-disk thrust from `Drive.Power`, `Drive.PropDiameter` and `Drive.Efficiency` (rising from `Drive.StaticEfficiency` at rest), at the prop point (`Drive.Depth` below the stern waterline). No water at the prop = no thrust. Outboards and jets swivel the thrust (`Drive.MaxSteer`); rudder lift `½ ρ v_r² A_r C_L` with `C_L = 3δ` capped at 1.1 (real rudders stall) acts in the prop wash: an inboard's rudder, or an outboard's gearcase (`Drive.RudderArea`, 0.01–0.03 m²), which is why outboards turn hard at speed. Jets keep `Drive.IdleSteer` of their steering off throttle.

**Assists.** Yaw stability (like the car's ESC: no yaw beyond a turn of 3.5 hull lengths ÷ tan(steer)), anti-capsize past 25° of heel that rolls back harder the further over it is (`Recovery.SelfRight`), air levelling, auto-flip when capsized and slow, a beach push when the hull is aground and the prop is dry, and Reset.

## 8. Water sources in Roblox

`shared/Vehicle/Water.luau` answers "where is the surface?", in this order:
1. A custom function: `Water.SetHeightFunction(function(position, time) return y end)` for a game's own ocean.
2. A sea plane: `Workspace` attribute `SeaLevel` (studs). Optional waves: `WaveHeight` (m, crest to trough), `WaveLength` (m), `WaveDirection` (degrees). Three sine trains with real deep-water speeds, phased by `Workspace:GetServerTimeNow()` so the server and every client agree. Render the sea with the same function (a flat part when `WaveHeight` is 0).
3. Terrain water: a downward raycast against Terrain with `IgnoreWater = false`, cached per step.

Roblox adds its own buoyancy to parts in Terrain water. The kit makes boat roots very dense (Roblox density 100) so that extra force is a percent or two of the weight, and turns off `EnableFluidForces` on every vehicle part.

## 9. Spec fields and real values

| Spec | Hull | Mass | Power | Top | 0–50 km/h | Hull speed |
|---|---|---|---|---|---|---|
| `Speedboat` (6.2 m runabout, outboard) | planing | 1800 kg | 186 kW | 86 km/h | 4.1–4.3 s | 11 km/h |
| `JetSki` (3.3 m PWC, jet) | planing | 450 kg | 150 kW | 108 km/h (limiter) | 1.6 s | 8 km/h |
| `FishingBoat` (10 m workboat, inboard) | displacement | 9000 kg | 150 kW | 17 km/h | — | 14 km/h |

Fields (all optional except `name`, `type: "Boat"`): `mass`, `comHeight` (m above keel), `hull` {`length`, `beam`, `depth`, `blockCoefficient`, `waterDensity`, `humpRW`, `waveWall`, `trim`, `planingSpeedKmh`, `planingLift`, `planeDraft`, `liftBow`, `prowRise`, `lateralDrag`, `keelAft`, `bank`, `damping`, `samplesAlong`, `samplesAcross`}, `drive` {`type` outboard/inboard/jet, `power`, `propDiameter`, `efficiency`, `staticEfficiency`, `efficiencySpeedKmh`, `reverse`, `depth`, `maxSteer`, `steerSpeed`, `rudderArea`, `idleSteer`, `spool`, `speedLimitKmh`}, `recovery` {`airGravity`, `airControl`, `autoFlip`, `selfRight`, `beachPush`}, `assists` {`stability`}, `aero` {`cd`, `area`}, `body` {`hullFriction`}.

The report prints displacement, draft, wetted area, hull speed, hump speed and its resistance, full-planing speed, static thrust, top speed and what limits it, 0–30 and 0–50 km/h, heave and roll periods and GM.

## 10. Tuning: symptom → fix

| Symptom | Fix |
|---|---|
| Never gets on the plane | More `drive.power` or `drive.efficiency`, lower `hull.humpRW`, lower `hull.planingSpeedKmh`. |
| Planes too early / feels like a car | Raise `hull.planingSpeedKmh`, lower `hull.planingLift`. |
| Porpoises (bow bouncing at speed) | Raise `hull.damping`, lower `hull.liftBow`, lower `hull.planeDraft`. |
| Bow too high on the hump | Lower `hull.prowRise` or `hull.liftBow`. |
| Slides like on ice | Raise `hull.lateralDrag` or `hull.keelAft`; raise `assists.stability`. |
| Won't turn at speed | Raise `drive.rudderArea` (outboard gearcase / inboard rudder) or `drive.maxSteer`; lower `hull.keelAft`. |
| Spins out or scrubs all its speed in a turn | Lower `drive.rudderArea`, raise `assists.stability` (0.5–0.8) and `hull.keelAft`. |
| Rolls too much / capsizes | Lower `comHeight`, raise `hull.beam` (GM), raise `recovery.selfRight`. |
| Sits too deep / too high | `hull.blockCoefficient` (draft = ∇ / (L B Cb)) or `mass`. |

## 11. Model setup and controls

```
SpeedboatWhite (Model)    attribute Vehicle = "Speedboat", tag "Vehicle", pivot facing the bow, up = up
├─ Hull, Deck, Windshield (any parts; the lowest point of the body is taken as the keel)
├─ DriverSeat (VehicleSeat)
├─ PassengerSeat (Seat)   optional
└─ Propeller              optional visual, spins with throttle
```

Place the boat with its keel at or slightly below the water surface; it settles to its draft. Keep the deck walkable: standing players ride along.

| Device | Throttle / reverse | Steer | Reset |
|---|---|---|---|
| Keyboard | W / S | A / D | R |
| Gamepad | R2 / L2 or stick | left stick | Y |
| Touch | thumbstick | thumbstick | "Reset" |
