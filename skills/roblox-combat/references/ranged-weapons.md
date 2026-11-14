# Ranged weapons (guns, bows, magic projectiles)

## Contents
1. The shot's anatomy
2. Hitscan vs projectile
3. Aiming: camera ray vs muzzle ray
4. Spread and bloom
5. Recoil
6. Firing feedback: muzzle flash, smoke, shells, sound
7. The bullet in flight: tracers and projectiles
8. Impacts: by material, on characters
9. Hit confirmation: hit markers, headshots, kill confirm
10. Damage model: falloff, headshots, penetration
11. Ammo, reload, fire modes
12. Aim down sights and first person
13. Security and networking
14. Weapon archetypes and starting stats
15. Explosives and area damage

---

## 1. The shot's anatomy

```
input → fire-rate gate → ammo check →
  [shooter client, same frame]
    recoil kick (camera) + weapon kick (viewmodel/tool)
    muzzle flash (light + particles) + smoke puff + shell eject
    fire sound (2D-ish for shooter)
    aim ray → spread → bullet ray / projectile spawn
    tracer from muzzle
    predicted impact effect at the hit point
  → send Fire(origin, direction) to server
  [server]
    validate (rate, ammo, origin near character, direction finite)
    raycast / simulate projectile
    damage (falloff, headshot) via CombatService
    broadcast shot (for other players' muzzle flash, tracer, sound) and hit (for hit feedback)
  [shooter client on confirm]
    hit marker + hit sound (+ kill confirm)
```

As with melee: everything cosmetic happens on the shooter's client immediately; damage happens only on the server.

## 2. Hitscan vs projectile

| | Hitscan | Projectile |
|---|---|---|
| How | One raycast the instant you fire | Simulated over time with velocity, gravity, drag |
| Feel | Instant, precise | Leading targets, arcs, dodgeable |
| Use for | Rifles, pistols, SMGs, shotguns, lasers | Rockets, grenades, arrows, slow magic orbs, sniper rifles with drop |
| Cost | One raycast per pellet | One raycast per step per projectile |
| Server work | Raycast once | Simulate every frame until hit or max range |

Projectile simulation (kit: `Ballistics.Simulate`): each step, `newPos = pos + vel*dt + 0.5*g*dt²`, raycast from `pos` to `newPos`, stop at the first hit. Bullet speeds of 600–1500 studs/s with a small gravity give "realistic" drop at long range; arrows 120–250 studs/s with full gravity; magic orbs 40–100 studs/s with no gravity (visible, dodgeable).

Hybrid: "fast projectile" guns that are hitscan within 100 studs and simulated beyond keep close-range fights responsive.

## 3. Aiming: camera ray vs muzzle ray

The crosshair is at the screen center, but the gun is offset to the side. Standard fix:

1. Raycast from the camera through the crosshair to find the **aim point** (max range if nothing is hit).
2. Fire the bullet from the **muzzle** toward the aim point.
3. If something blocks the muzzle ray close to the gun (a wall edge), the bullet hits that: realistic and prevents shooting through corners.

Third-person shooters do exactly the same; it keeps the crosshair honest.

## 4. Spread and bloom

- **Base spread** (cone half-angle): hip fire 1.5–4°, aiming down sights 0–0.5°, snipers ~0 when scoped.
- **Bloom**: each shot adds spread (0.2–0.8°) up to a max; it recovers over time (3–8°/s). Rewards tapping and bursting over holding.
- **Movement penalty**: add spread while moving, more while airborne.
- **Shotguns**: N pellets (6–12) in a cone of 4–8°, each its own ray; damage per pellet.
- Generate spread with a uniform disk (not a uniform angle, which clusters at the center): random radius `sqrt(u)` × max, random angle.
- Show it: the crosshair gap widens with current spread.

## 5. Recoil

Recoil is the feel of power and the main skill ceiling of automatic weapons.

- **Camera recoil** (moves your aim): per shot add vertical kick (0.3–1.5°) and random horizontal kick (±0.1–0.6°), applied as a spring offset to the camera after the default camera updates. The spring returns toward rest (recovery), so aim drifts back down when you stop.
- **Pattern**: fixed or semi-random patterns per weapon make recoil learnable ("pull down and slightly left").
- **First-shot multiplier**: the first shot after a pause kicks less (accuracy reward).
- **Visual recoil** (doesn't move aim): the weapon model kicks back and rotates up, then springs back; plus a small camera shake and FOV punch for heavy guns.
- **ADS** reduces camera recoil (×0.6–0.8).
- Recoil should be readable but controllable on phones; reduce horizontal randomness for touch players if your audience is mobile-heavy.

The kit's `CameraFx` keeps recoil as a decaying spring offset in the same render step as camera shake; bullets fired that frame use the recoiled camera aim.

## 6. Firing feedback

Every shot on the shooter's screen, the same frame:
- **Muzzle flash**: a 1–2 frame burst at the muzzle `Attachment`: a few bright particles (`ParticleEmitter:Emit(n)` with very short lifetime 0.03–0.06 s, LightEmission 1) and a `PointLight` blinking on for ~0.04 s (lights the surroundings, great in dark scenes).
- **Smoke**: a small puff (2–4 particles) that drifts and fades over 0.4–1.0 s, opaque-ish (LightEmission 0). For sustained fire, a thin trail of smoke from the barrel after the last shot.
- **Shell ejection**: optional small part or particle thrown sideways from the ejection port.
- **Sound**: a punchy fire sound with ±5% pitch variation, played as a 2D sound for the shooter and 3D (from the muzzle) for others; a distinct mechanical sound on the last bullet and an empty click when out of ammo.
- **Kick**: visual recoil on the weapon, camera recoil, tiny shake.

For others (from the server broadcast): flash, smoke, tracer and 3D sound at the shooter's muzzle. Skip shell casings for distant players.

Effects details and tuning can go through the `roblox-vfx` skill (it has a muzzle recipe: a hit spark at the hand pointed forward with spread 25).

## 7. The bullet in flight

- **Tracers** (hitscan): a short bright streak travelling from muzzle to hit point over 0.04–0.1 s (a thin neon part or a `Beam` between two attachments, scaled along the ray and faded). Every bullet for fast guns can be too busy; many games show every 2nd–3rd bullet.
- **Projectiles**: a visible object (part, mesh, particles) moved each frame on clients along the same `Ballistics` path; a `Trail` behind it. The server simulates the authoritative path; clients render their own copy from the broadcast (origin, velocity, time).
- **Whizz** sounds when a bullet passes close to the local player sell danger (raycast distance from the camera to the bullet path < 4 studs).

## 8. Impacts

The impact tells the player what they hit:
- **Surfaces**: spark burst + small debris for metal, dust puff for concrete/sand/ground, splinters for wood, splash for water, glass shards for glass. Choose by `RaycastResult.Material` (and the hit part's material).
- **Bullet holes**: a small dark disc oriented by `RaycastResult.Normal`, fading after a few seconds, capped (e.g. 50 at once).
- **Characters**: hit flash, a small hit-spark or hit puff in the character's color scheme (gore depends on your game's content maturity settings; most Roblox games use stylized sparks or "hit pops"), small knockback only for big guns, and the victim's hit-reaction animation.
- **Shooter-side prediction**: play the impact at the predicted point immediately; the server confirms damage separately.

## 9. Hit confirmation

- **Hit marker**: an X-shaped flash around the crosshair for 0.1–0.15 s on confirmed hits, with a crisp "tick" sound. Red/bigger for headshots, a distinct shape + sound for kills.
- **Damage numbers**: optional; common in casual shooters and looter games.
- **Kill confirm**: sound, kill feed entry, maybe a small slow-mo on the final kill of a round.
- Only show hit markers for **server-confirmed** hits; players trust them for information.

## 10. Damage model

- **Falloff**: full damage up to `FalloffStart`, decreasing linearly to `MinDamage × damage` at `FalloffEnd`. Defines each weapon's effective range (kit: `Ballistics.Falloff`).
- **Headshots**: multiplier 1.5–2× (snipers 2.5–4×). Check the hit part name (`Head`) or a part attribute (`Hitzone = "Head"`).
- **Limb multipliers** (optional): legs 0.8×.
- **Penetration** (optional): thin surfaces reduce damage and let the ray continue (cast again from just past the exit point).
- **Time to kill** (TTK) is the key balance number: shots to kill × time between shots. Typical casual-shooter TTKs are 0.3–0.8 s for automatic weapons at optimal range.

## 11. Ammo, reload, fire modes

- Magazine and reserve ammo tracked on the **server** (and mirrored on the client for UI). The client predicts its own count for responsiveness.
- Reload: a timed action (1.2–3 s), cancellable by switching weapons; tactical reload (bullet still chambered) faster than empty reload.
- Fire modes: semi (one shot per press), auto (hold), burst (3 shots per press with a burst delay). Fire rate as RPM: `interval = 60 / rpm`.
- Show ammo near the crosshair or bottom-right; flash it red when low.

## 12. Aim down sights and first person

- ADS: tween `Camera.FieldOfView` from 70 to 50–60 (snipers ~20–30 with a scope overlay), reduce spread and recoil, slow walk speed (×0.6–0.8 on the server).
- First person: the kit's `CameraController` (`StartMode = "First"`) puts the camera at the eyes, hides the body (not the Tool) and keeps the character facing the crosshair. A viewmodel (arms + gun rendered close to the camera) gives the best feel but is a big job.
- Over the shoulder (Resident Evil 4, The Last of Us, GTA): the camera sits behind and to the right of the head and looks **parallel** to the aim, so the character is left of the crosshair and never covers it. Aiming pulls it in (8 → 4 studs) with a narrower FOV (70 → 50) and slower look; `Q` swaps shoulders (eased, ~0.3 s) for peeking left corners. Walls: spherecast sideways to the shoulder first (squeezes the offset when hugging a wall), then backwards (pulls in at once, eases back out at ~18 studs/s) so the camera never enters geometry. Ignore CanCollide-off parts (`RespectCanCollide`) so foliage and glass don't shove it. The character turns to face the crosshair while aiming and for ~0.6 s after a hip-fire shot, otherwise it runs freely.
- Third-person aim ray: start the crosshair raycast at the character, not the camera (`AimCamera:AimSkip()`), or a bush or teammate behind you eats the shot. The bullet still flies from the muzzle to that aim point; when something sits between the muzzle and the aim point (peeking a corner the camera sees around), the shot honestly hits it and the HUD shows a red dot there (`Ballistics.Obstruction`).
- Mobile: a fire button on the right side (`ContextActionService` touch button), optional auto-fire when the crosshair is on an enemy (popular for touch shooters), ADS toggle button.

## 13. Security and networking

Following `roblox-security`:
- The client sends **only** `Fire(origin, direction)` (plus an id for projectiles). Never targets, damage, hit positions or hit parts.
- The server checks fire rate on its own clock, ammo, that `origin` is within a few studs of the shooter's character (head/tool), that `direction` is a finite unit vector, then raycasts itself and decides the hit.
- Spread is applied by the client (the server can't reproduce random spread); bound it by checking the angle between the shot direction and the character's look direction isn't absurd (> 90° for third person).
- Aimbots can't be stopped by the server; detect statistically (accuracy and headshot ratio far above normal) and review.
- Lag compensation for competitive shooters: keep 0.5–1 s of position history for characters; raycast against where the target was at the shooter's time (capped at ~200–250 ms).
- Broadcast shots to other clients for cosmetics with `UnreliableRemoteEvent` (losing one tracer is fine) and hits with a reliable event.

## 14. Weapon archetypes and starting stats

| Weapon | Mode | RPM | Damage | Mag | Spread hip/ADS | Recoil V/H | Falloff (start–end, min) | Notes |
|---|---|---|---|---|---|---|---|---|
| Pistol | semi | 400 | 22 | 12 | 2 / 0.5° | 1.2 / 0.3 | 40–120, 0.6 | Reliable sidearm |
| SMG | auto | 850 | 14 | 30 | 3 / 1.2° | 0.5 / 0.4 | 25–70, 0.5 | Close range, high bloom |
| Assault rifle | auto | 600 | 20 | 30 | 2.5 / 0.4° | 0.7 / 0.3 | 60–180, 0.65 | All-rounder |
| Shotgun | semi | 70 | 9 × 8 pellets | 6 | 6 / 5° | 3 / 0.8 | 10–35, 0.2 | One-shot close |
| Sniper | semi | 45 | 90 (×2.5 head) | 5 | 6 / 0° | 4 / 0.5 | none | Projectile with drop, 1200 studs/s |
| Bow | semi (charge) | 60 | 30–70 by charge | – | 1 / 0.3° | 1 / 0 | none | Projectile, 120–220 studs/s, full gravity |
| Rocket | semi | 40 | 100 area | 1 | 0.5° | 2.5 / 0 | none | Projectile 90 studs/s, explosion radius 12 |

Starting points only: tune TTK and ranges together in playtests.

## 15. Explosives and area damage

- Server computes the explosion: `workspace:GetPartBoundsInRadius(center, radius)`, collect unique characters, damage by distance (full at the center, falling to 30–50% at the edge), line-of-sight raycast to avoid damage through walls, knockback outward and up.
- Clients: explosion VFX (`roblox-vfx` explosion example), big camera shake scaled by distance, a loud sound with a low tail, debris.
- Self-damage and friendly fire are design decisions; rocket-jumping is fun and needs `AntiCheatService:Grant`.
- Use the built-in `Explosion` instance only if you set `DestroyJointRadiusPercent = 0` and handle damage yourself; otherwise it kills characters by breaking joints.
