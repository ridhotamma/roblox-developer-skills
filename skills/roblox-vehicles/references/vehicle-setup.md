# Vehicle setup, multiplayer and polish

## Contents
1. Model requirements
2. Reusing one chassis across many meshes
3. Seats and passengers
4. Spawning and garages
5. Ownership and multiplayer
6. Controls on every device
7. Camera
8. HUD
9. Sound
10. Effects: skids, smoke, exhaust, lights
11. Anti-cheat
12. Performance
13. Troubleshooting

---

## 1. Model requirements

```
SportsCarBlue (Model)              attribute Vehicle = "SportsCar", tag "Vehicle"
├─ Body (MeshPart or many parts)   anything: meshes, unions, decals, lights
├─ DriverSeat (VehicleSeat)        where the driver sits
├─ PassengerSeat (Seat)            optional
├─ WheelFL (MeshPart or Model)     front-left wheel (steers)
├─ WheelFR
├─ WheelRL                         rear wheels; extra axles: WheelRL2, WheelRR2 ...
└─ WheelRR
```

- Wheel names: `Wheel` + `F`/`R` (front = steered, rear) + `L`/`R` (side) + optional number. Case-sensitive.
- Wheels are placed where they should sit **at rest** on flat ground; the builder solves the suspension so the car settles exactly there.
- Wheel radius comes from the wheel's largest dimension; set attribute `WheelRadius` (studs) on a wheel if its bounding box includes a fender, brake caliper or decoration.
- The model can face any direction. Forward is from the rear axle to the front axle; up is the model pivot's up.
- Body parts can be anchored or welded already: the builder unanchors them, welds each to `ChassisRoot`, and makes them massless. Joints between body and wheels are removed (wheels become visuals).
- Don't use constraint-based wheels (hinges, cylindrical constraints): remove them; the wheels are only visuals here.
- Keep body collision boxes simple (`CollisionFidelity = Box` or `Hull` on big meshes) for performance and fewer snags.
- Optional attributes on the model: `EngineSound` and `TireSound` (`rbxassetid://...` loops), `KeepCollision = true` to keep the body's own collision instead of the generated hull (must then pass the stuck test course in anti-stuck.md).
- Body collision is replaced by a hidden rounded hull (`HullBody`, `HullEnd` parts) unless `KeepCollision` is set; body parts end up `CanCollide = false`.

## 2. Reusing one chassis across many meshes

- The spec defines how it drives; the model defines how it looks. Ten different car bodies can all use `Vehicle = "SportsCar"` and will drive identically, because mass, gearing and grip come from the spec (wheel radius for gearing is `wheelRadius` in the spec, not the mesh).
- To make a variant (tuned version, police car), copy the spec JSON with a new name and change only what differs, then re-export.
- Store bodies as templates in `ServerStorage.Assets.Vehicles`, each with its `Vehicle` attribute. Players' unlocked cars are just template names in their data.
- Upgrades (engine, tires, brakes) are spec overrides: keep the base spec, apply multipliers on the server when building a player's car, and save upgrade levels in player data. If you do this, generate per-player spec tables on the server and replicate them with the model (e.g. an attribute with the upgrade levels that both sides apply to the base spec).

## 3. Seats and passengers

- The **driver seat** must be a `VehicleSeat`: it gives throttle and steer input from every device for free, and its `SteerFloat` replicates so other clients can steer the wheel visuals.
- Passengers use normal `Seat`s. Weld them in the model like any body part.
- The builder marks the driver seat with attribute `DriverSeat` and turns off the default `HeadsUpDisplay`.
- Exiting: the jump button leaves the seat by default. Don't bind handbrake to Space for that reason (the kit uses LeftShift / gamepad X / a touch button).
- Entering: add a `ProximityPrompt` ("Drive") on the door that calls `seat:Sit(humanoid)` on the server after checking the player owns/may use the car.

## 4. Spawning and garages

- `VehicleService:Spawn(name, cframe)` clones a template, tags it and parents it; the builder runs on it.
- Spawn above the ground by about the wheel radius; the car settles.
- Limit one spawned car per player; despawn on leave and after idle time.
- Spawn pads: check the pad area is clear (`workspace:GetPartBoundsInBox`) before spawning.

## 5. Ownership and multiplayer

- When someone sits in the driver seat the server calls `root:SetNetworkOwner(player)`; that player's client runs `VehicleSim` every physics step, so driving has no input lag.
- When the seat empties, ownership returns to the server, which simulates the parked car with no pedal (the hill hold brakes all four wheels) and anchors it after 2 s settled (zero cost while parked). It wakes when someone sits again.
- Other players see the car through normal physics replication; their clients place, steer and spin wheels locally (`VehicleVisuals`) and pitch the engine from estimated rpm.
- Collisions between two player-owned cars are resolved by Roblox's physics ownership; fast car-to-car contact can look rough at high ping. Racing games often reduce damage from collisions or use collision groups so cars ghost through each other during races.
- Server-side gameplay (laps, checkpoints, finish lines) should use server checks of the car's position (region queries on a timer), not client-reported lap times.

## 6. Controls on every device

| Device | Throttle / brake | Steer | Handbrake | Exit |
|---|---|---|---|---|
| Keyboard | W/S or ↑/↓ | A/D or ←/→ | LeftShift | Space |
| Gamepad | left stick (VehicleSeat) | left stick | X | A |
| Touch | on-screen thumbstick | thumbstick | "Drift" button | jump button |

VehicleSeat input is digital on keyboard (−1, 0, 1); the sim's steering speed smooths it. For analog triggers on gamepad (R2 throttle, L2 brake), read `UserInputService` trigger positions in the controller and pass them as `Throttle`. On touch, consider an auto-throttle racing mode (hold to brake) since steering with a thumb is already hard.

## 7. Camera

- The default follow camera works; the controller adds a speed-based field of view (+14° at 220 km/h) for a sense of speed.
- Racing feel: a chase camera that lags slightly behind the car's yaw (spring on the camera angle), looks a little into turns, and lowers at speed. Implement it in a `CameraController` with `RenderPriority.Camera` and `CameraType.Scriptable`, following the root's velocity direction rather than its facing during slides.
- Add a first-person/hood camera toggle for players who want precision.
- Small camera shake proportional to rough-surface suspension speed and on hard landings (the `roblox-combat` skill's CameraFx can be reused).

## 8. HUD

- Speed (km/h or mph setting), gear (R, 1..n), rpm bar with a red zone; the kit has a minimal version.
- Racing: position, lap, lap time, best lap, minimap. Keep it in the bottom corners on phones, clear of the thumbstick and buttons.

## 9. Sound

- **Engine**: a looping sample (`EngineSound` attribute) with `PlaybackSpeed` from rpm (0.55 at idle → ~1.65 at redline in the kit), louder on throttle. Better: two or three samples (low/mid/high rpm) cross-faded by rpm, plus an "on load" and "off load" set.
- **Shifts**: a short blip or dip on gear change (watch the `Gear` telemetry).
- **Tires**: squeal volume and pitch from `Slip` telemetry above ~0.8.
- **Impacts**: a thud scaled by the speed change on collisions.
- **Wind**: rising with speed.
- Turbo whistle, exhaust pops on lift-off for sports cars.

## 10. Effects

Tire smoke, skid marks and tire squeal are built into `VehicleVisuals` (drifting.md §6). The rest below are ideas to add.


- **Exhaust**: small smoke puffs with rate from throttle; flame pops on lift-off at high rpm.
- **Brake lights**: a `SurfaceLight`/neon part enabled when braking (seat throttle opposite to motion).
- **Dust**: on dirt materials, a dust emitter at contacts by speed.

Expose slip, throttle and brake to clients cheaply: the driver's client knows them; other clients can estimate slip from the root's lateral velocity.

## 11. Anti-cheat

The driver's client owns the car's physics, so it can move it anywhere. The kit's server loop flags speeds well above the spec's top speed (and calls `roblox-security`'s `Sanctions.Flag` if installed). Also:
- validate race progress on the server (checkpoints in order, minimum time between them)
- check teleport-like jumps of the car (distance between server checks)
- never let the client grant rewards for races or drifts; the server measures them
- the security skill's movement anti-cheat skips seated players, so car checks live here

## 12. Performance

- Per car per step: one raycast per wheel for physics (owner only) and one per wheel for visuals (clients near the car).
- Parked cars sleep (anchored) on the server.
- Visual raycasts are skipped beyond 450 studs.
- Keep body meshes reasonable (a few thousand triangles, few unique textures) and collisions simple.
- Dozens of cars are fine; for traffic with hundreds, use simplified cars (no suspension, path-following, CFrame-animated on clients).

## 13. Troubleshooting

| Problem | Check |
|---|---|
| Nothing happens when sitting | Model tagged `Vehicle`? `Vehicle` attribute matches a spec? Output shows `[VehicleService]` warnings? Seat is a `VehicleSeat`? |
| Car falls through or sinks | Wheels named correctly (four found)? Ground parts `CanCollide` and `CanQuery` on, and not in `VehicleIgnore`? |
| Gets stuck somewhere | anti-stuck.md: is the hull on, the spot's kerb/prop/terrain within the map rules? |
| Car flies or explodes on spawn | Body parts intersecting the ground at spawn; spawn higher. A huge wheel radius from a misleading mesh: set `WheelRadius`. |
| Drives backwards / sideways | Front wheels are named `WheelF*`? (Forward is rear → front.) |
| Wheels left behind | They're visuals updated by `VehicleVisuals`: is the component bound (client components folder, Loader)? |
| Wheels in the wrong orientation | The visual keeps the wheel's original orientation relative to the chassis; fix the mesh's rest orientation in the model. |
| Jittery for other players | High ping; normal for physics replication. Keep body collision simple. |
| Different feel between two bodies on one spec | Shouldn't happen; check both use the same spec and neither has extra constraints or unanchored loose parts. |
