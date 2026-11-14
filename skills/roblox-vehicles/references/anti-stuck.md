# Never getting stuck

A car that wedges on a kerb, beaches on a terrain ridge, snags on a tree or ends up on its roof is the most common reason players abandon Roblox driving games. This skill treats "the player can always keep driving" as a hard requirement. Every vehicle built with it must pass the stuck test course below.

## Contents
1. Why Roblox cars get stuck
2. The protections (and where they live)
3. Rules for vehicles (prohibited patterns)
4. Rules for maps and roads
5. The stuck test course
6. Tuning the protections

---

## 1. Why Roblox cars get stuck

| Cause | What happens |
|---|---|
| Thin raycast wheels | A single ray drops into cracks between parts, catches the top edge of a kerb as a "wall", or misses a step entirely, so the car stops dead or the wheel snaps through geometry. |
| Wheels as physical parts (constraint chassis) | Wheel cylinders hit the vertical face of a kerb and can't climb it; they jitter on terrain voxel steps. |
| Collision on the detailed body mesh | Bumpers, skirts, exhausts and mirrors hang low and wide; they catch on kerbs, roots, fences and terrain ridges. Mesh collisions also have sharp concave edges that hook. |
| High body friction | When the car scrapes a wall or tree, friction grabs and stops it or spins it into the obstacle. |
| Low ground clearance | The belly lands on a ridge, the driven wheels hang in the air, no traction, no escape. |
| Flipped car | On its side or roof with no way to right itself. |
| Small props as obstacles | Grass, flowers, pebbles and debris with collision act like walls. |
| Wall-climbing | A wheel ray that hits a vertical wall pushes the car up it, then it falls over. |

## 2. The protections

| Protection | Where | How |
|---|---|---|
| **Sphere-cast suspension** | `VehicleSim`, `VehicleVisuals` | Each wheel casts a sphere of 85% of the tire's radius instead of a ray. A sphere rolls up kerbs and terrain steps (its leading edge meets the step's top edge at an angle, compressing the spring) and doesn't fall into cracks. |
| **Wall rejection** | `VehicleSim` | Hits whose surface faces less than ~70° from up (`WALL_NORMAL`) aren't ground. A wheel touching a wall's side doesn't climb it; the hull handles walls. |
| **Collision hull** | `VehicleService` (`Body.AutoHull`) | The body mesh stops colliding. A hidden hull takes over: a box with its bottom no lower than the axles (ground clearance = wheel radius plus suspension), and rounded cylinders along the nose and tail bottom edges so the car rides over and deflects off obstacles instead of hooking them. |
| **Low hull friction, no bounce** | `VehicleService` (`Body.HullFriction`) | Friction 0.08 and elasticity 0, both at weight 100. Roblox mixes two parts' values as a weighted average, so at weight 1 the hull would take on half of every wall's elasticity (plastic 0.5 → bounces at ~0.28). Scraping a wall, barrier or tree slides the car along it. |
| **Impact softening** | `VehicleSim` | A step whose horizontal velocity changed by more than 8 g real (a hit, which tires can't do) keeps the stop or deflection the collision gave, but not its side effects. It keeps only 20% of the pitch/roll-rate change, caps the yaw-rate change at 1.5 rad/s and the upward speed gain at 1 m/s, and caps bounce-back at 10% of the approach speed + 0.5 m/s. For 0.4 s after the hit, scraping along the wall can't wind the yaw rate up further. A 45° hit glances the car along the wall instead of spinning it away, flipping it or popping it up. |
| **Ignore group** | `VehicleService` | Parts in collision group `VehicleIgnore` don't collide with vehicle hulls and are invisible to the suspension casts. Put grass, flowers, small rocks, bushes, debris and decals' backing parts in it. |
| **Stuck assist** | `VehicleSim` (`Recovery.StuckAssist`) | Throttle held (forward or reverse) but the car moves less than 0.4 m/s for 1 s: for 0.45 s the car is lifted (60% of its weight) and pushed (0.45 g) in the throttle direction. After 3 failed tries it recovers. It never fires when a wall is in the way: a 1-stud sphere cast from the root to just past the bumper, in the throttle direction, that hits a steep face means the driver is pressing into a wall. Lifting and pushing there only bumps the car, and the 4th try would teleport it. |
| **Recovery** | `VehicleSim:Recover()` | Sets the car upright above the ground under it (the suspension casts start a wheel radius above the mounts, so the drop never leaves a wheel unable to find the ground), 3 studs back from the obstacle (or forward if it was reversing), velocity zeroed. 2 s minimum between recoveries. |
| **Auto-flip** | `VehicleSim` (`Recovery.AutoFlip`) | Tilted more than ~73° (side or roof) and nearly stopped for 1.5 s: recover. Also runs on the server for parked cars knocked over. |
| **Air control** | `VehicleSim` (`Recovery.AirControl`, `Recovery.AirGravity`) + `Stabilizer` Torque | Airborne (no wheel touching, or the springs carrying under 20% of the weight), a rate-capped torque (≤ ~70°/s) turns the car until its wheels face the ground below it, a landing ramp's slope included, and damps tumbling. In the air, gravity is lightened to `AirGravity` real g, so there is hang time to land. With some wheels off the ground at speed (cresting a ramp lip), it strongly damps pitch and roll rate, and each wheel off the ground gets its share of the gravity relief. Otherwise, in Roblox gravity, the rear springs flip the nose down off every lip. |
| **Reset button** | `VehicleController` | R / gamepad Y / touch "Reset", 3 s cooldown, always available as the last resort. |

## 3. Rules for vehicles (prohibited patterns)

Do not ship a vehicle that:
- uses physical wheel parts or hinge/cylindrical constraints for wheels in this chassis
- keeps collision on a detailed body mesh (`KeepCollision = true`) without a reason and a passed test course
- has body or hull friction above 0.3
- has ground clearance below the wheel radius at rest (the auto hull guarantees this)
- turns off `StuckAssist`, `AutoFlip` or the reset button in a game where players drive freely
- has suspension that bottoms out on the report (bump travel shorter than sag)
- relies on players to "jump out and get back in" or respawn to get unstuck

Also avoid:
- wheel collision with players (the kit's visual wheels don't collide; keep it that way)
- very low air control on vehicles that jump (0 makes landings on the roof common)

## 4. Rules for maps and roads

The map matters as much as the car:
- **Kerbs**: no taller than about 0.5× the wheel radius of the smallest vehicle that drives there (roughly 0.5–0.6 studs for cars, 0.25 for karts). Bevel them (wedge or a chamfered edge) where cars cross them. No wheel climbs a kerb taller than its own radius; small-wheeled vehicles need lower kerbs or ramps.
- **Road edges**: avoid knee-high lips between road and terrain; blend terrain up to the road surface.
- **Trees and poles**: collision as simple cylinders, not detailed meshes with low branches; foliage on the `VehicleIgnore` group.
- **Small props**: rocks under ~1 stud, grass, flowers, litter, debris → `VehicleIgnore` (or `CanCollide = false`).
- **Terrain**: avoid single-voxel spikes and sharp ridges on drivable areas; smooth them.
- **Gaps**: no gaps between road parts wider than about the wheel radius (sphere casts bridge small ones; big ones swallow wheels).
- **Invisible walls** at map edges should be smooth, vertical and low-friction (players scrape along them, not into them).
- **Water and pits**: if a car can fall in, provide a respawn/recover trigger zone.

## 5. The stuck test course

Build it once in a test place and drive every vehicle through it before shipping. Each item must be passable or escapable in under 5 seconds **without the reset button**:

1. Kerbs of 0.25, 0.5 and 0.85 × the wheel radius (0.3, 0.6 and 1.0 studs for a car's ~1.2-stud wheels; 0.13, 0.25 and 0.43 for a kart), approached straight at 20 km/h and at 30° at 40 km/h.
2. A kerb running alongside the road: steer into it at a shallow angle at 60 km/h and continue.
3. A tree row and lamp posts: hit a trunk head-on at 30 km/h, then reverse away; scrape along a row at 50 km/h.
4. A concrete barrier and a wall: scrape along at 80 km/h; nose into it and reverse out.
5. A terrain ridge (a "speed bump" of terrain 1.5 studs high): cross it slowly and stop with the belly on top; drive off forward and backward.
6. A ditch 2 studs deep and 4 wide: drive in, drive out.
7. Rough terrain: hills, rocks, a dry river bed; drive at speed.
8. A ramp jump at full speed: must land on the wheels most of the time.
9. A slope steep enough to roll the car: roll it; it must right itself.
12. Slopes of 5°, 10° and 15°: park on each (leave the seat) and it stays put; hill start up 8°, 12° and 18° from a standstill.
10. A field of `VehicleIgnore` props (grass, pebbles): drive through without hitting anything.
11. A narrow alley with parked cars: three-point turn without wedging.

Then drive the real map's worst spots. Any failure: fix the map (section 4) or tune (section 6), not the player's patience.

## 6. Tuning the protections

| Value | Where | Default | Notes |
|---|---|---|---|
| `CAST_RADIUS` | VehicleSim / VehicleVisuals | 0.85 | Share of wheel radius. Higher rides over more, but wheels "float" above sharp holes. Keep both files equal. |
| `WALL_NORMAL` | VehicleSim / VehicleVisuals | 0.35 | Lower = wheels climb steeper faces (more kerb-climbing, more wall-climbing risk). |
| `Body.HullFriction` | spec | 0.08 | 0.05–0.15. Higher grabs. |
| `Body.AutoHull` | spec | true | Model attribute `KeepCollision = true` opts one model out. |
| `STUCK_SECONDS` / `UNSTICK_SECONDS` / `MAX_UNSTICK_TRIES` | VehicleSim | 1 / 0.45 / 3 | Faster assist for arcade games; slower for sims. |
| `FLIP_SECONDS` | VehicleSim | 1.5 | |
| `CAST_LIFT` | VehicleSim / VehicleVisuals | 1 | Wheel radii above the mount where casts start. Keep both files equal; lower only if wheels catch ceilings in tight tunnels. |
| `AIR_LEVEL` / `AIR_MAX_RATE` / `AIR_DAMP` / `LIP_DAMP` | VehicleSim | 2.5 / 1.2 / 14 / 60 | Air control: leveling rate per radian of tilt, max pitch/roll rate (rad/s), rate tracking and ramp-lip damping (× `Recovery.AirControl`). |
| `Recovery.AirGravity` | spec | 2.5 | Gravity in the air, real g. 2–3 for GTA-like hang time; 1 = real world (very floaty with Roblox's map scale); 0 = Roblox gravity. Longer hang time means longer jumps, so size stunt gaps for it. |
| `Recovery.AirInput` | spec | 120 | GTA-style air steering rate, deg/s (W/S pitch, A/D roll, handbrake + A/D spin). 0 turns it off. |
| `IMPACT_G` / `IMPACT_YAW` / `IMPACT_TILT` / `IMPACT_HOP` / `IMPACT_RESTITUTION` / `IMPACT_WINDOW` | VehicleSim | 8 / 1.5 / 0.2 / 1 / 0.1 / 0.4 | Impact softening: hit threshold (real g), most yaw-rate change (rad/s), share of pitch/roll-rate change kept, most upward speed (m/s), bounce-back share, scrape window (s). Raise `IMPACT_YAW` for wilder crashes. |
| `Recovery.AirControl` | spec | 0.3 | 0.2–0.4 road cars, 0.4–0.6 arcade/off-road jumpers; 0 for realism (with auto-flip on). |

If players report getting stuck somewhere specific, log the car's position when the stuck assist triggers 3 times (the `Stuck` telemetry) and fix those places on the map.
