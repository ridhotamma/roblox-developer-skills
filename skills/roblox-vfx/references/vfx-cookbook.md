# VFX cookbook

Layer recipes, timing and palettes. Sizes assume an avatar about 5 studs tall; use the top-level `scale` to resize a finished effect. Numbers are starting points; always check them in the storyboard.

Contents: 1. Universal structure · 2. Impacts and hits · 3. Explosions · 4. Ground effects · 5. Auras, buffs and loops · 6. Fire and smoke · 7. Magic: charge, cast, projectile · 8. Lightning and beams · 9. Palettes · 10. Troubleshooting

## 1. Universal structure

| Layer | Job | Lifetime | Typical settings |
|---|---|---|---|
| Flash | Tell the eye *where* and *when* | 0.08 to 0.15 s | 1 `glow`, big, white, `brightness` 2, size grows then shrinks |
| Core | Define the shape of the effect | 0.2 to 0.7 s | ring, fireball puffs, beam: the saturated hue lives here |
| Debris | Sell the energy | 0.2 to 1 s | 10 to 30 small `streak` / `dot` / `shard`, high `speed` + `drag`, gravity |
| Residue | Give it weight and an afterimage | 0.8 to 2.5 s | `smoke`, `lightEmission` 0, slow, grows, fades in then out |
| Light | Tie it to the world | 0.1 to 0.5 s | PointLight track: peak on frame 1, decay to 0 |

- One-shot timing: everything bright happens in the first 0.1 s. Delay heavier layers a few frames with `burst: [{ "t": 0.06, "count": n }]` so the effect unfolds instead of appearing at once.
- `duration` covers the scripted part (bursts, windows, tracks). Particles may outlive it; the module waits for them before cleaning up.
- Sequences read better with a fast attack: put the size peak at t = 0.2 to 0.4, not at the end, for anything explosive; let smoke grow all the way.
- Fade smoke *in* (`transparency` starts at 1, drops by t = 0.15) so it does not pop over the flash.
- Envelopes (the third number in a keypoint) on `size` are the cheapest way to stop a burst looking uniform.
- Random `rotation: [0, 360]` on anything not round; `rotSpeed` on smoke (±20 to 60) and debris (±300 to 600).

## 2. Impacts and hits

Anchor `character`, placed at the contact point (`at` slightly in front of the chest, or play it at the hit position). Total under 0.4 s; it must not obscure the fight.

| Effect | Layers |
|---|---|
| Light hit | Flash (size 2 → 4, 0.08 s) + 8 streak sparks (`speed` 18 to 35, `drag` 5) |
| Heavy hit | Flash + `ring` (size 1 → 6 in 0.22 s) + 16 sparks + light blink (brightness 6 → 0 in 0.12 s). See `examples/hit_spark.json` |
| Slash impact | Replace the ring with 1 `streak` on `orientation: "camera"`, size 8, fixed `rotation` matching the cut angle, 0.12 s; sparks sprayed along `direction` of the cut with `spread` [20, 60] |
| Blocked / parry | Cooler palette (white → pale blue), `star` flash with `rotSpeed` 200, fewer sparks, no smoke |
| Blood / goo | 10 to 14 `dot`, `lightEmission` 0, `accel` [0, -60, 0], `drag` 1, size 0.5 → 0 |

Directional hits: point `direction` along the attack (`forward` when played on the attacker's target facing) and narrow `spread` to 30 to 75. A full-sphere spray reads as an explosion, not a hit.

## 3. Explosions

See `examples/explosion.json` for the full stack. Scale guide: grenade 12 to 16 studs across, rocket 20 to 25, boss attack 40+.

- **Flash:** one glow at 1.3× the fireball's final size, 0.14 s.
- **Fireball:** 10 to 16 `smoke` puffs from a small sphere shape, `lightEmission` 0.8, colour white-yellow → orange → deep red → near black, `speed` 8 to 18 with `drag` 4 so it blooms and stops, slight upward `accel`.
- **Shockwave:** one `ring`, `orientation: "flat"`, `speed: 0.01`, size 2 → 2× the fireball in 0.4 s.
- **Embers:** 20 to 30 `dot`, `speed` 18 to 42, `drag` 2, `accel` [0, -38, 0], `brightness` 2, lifetime up to 1.1 s.
- **Smoke:** 8 to 12 opaque puffs delayed 0.08 s, lifetime 1.2 to 2 s, rising slowly, `zOffset: -1` so the fire draws in front.
- **Light:** range 30 → 14, brightness 8 → 0 over 0.5 s.

Variants: *magic burst* swaps the palette and replaces smoke with a second, slower ring and `star` debris; *water splash* uses opaque pale-blue `dot` debris with strong gravity and no fire; *dust-only* (a wall breaking) drops flash and fire and doubles the smoke in tan.

## 4. Ground effects

Anchor `ground`. The floor trick: `"orientation": "flat", "direction": "up", "speed": 0.01` lays a particle on the ground; keep `at` 0.1 studs up to avoid z-fighting.

| Effect | Layers |
|---|---|
| Ground slam | 2 flat rings (fast bright, slower dim, 0.06 s apart) + radial dust from a flattened sphere shape (`size: [4, 0.3, 4]`, `style: "surface"`, `speed` 12 to 22, `drag` 3) + `shard` chips with gravity. See `examples/ground_slam.json` |
| Landing puff | Dust only, 10 puffs, half the speed |
| Footstep dust | `burst` 3, size 0.8 → 2, lifetime 0.4, `speed` 2 to 4 backward; keep it under 5 particles |
| Magic circle | `ring` or `star`, flat, `rate` 1 with lifetime 1.2 (overlapping), `rotSpeed` 40, plus `glow` motes rising from a box shape the size of the circle |
| AoE warning | Flat ring, `rate` 2, size constant at the damage diameter, transparency pulsing; red or orange; then the real effect on the damage marker |
| Geyser / pillar | `rate` 60 for 0.4 s from a small box, `direction: "up"`, `spread` 6, `speed` 40 to 60, `drag` 1.5, `orientation: "velocity"` |

Match the visual radius to the hitbox: the outer ring's final size is a diameter, so a 10-stud damage radius wants a ring ending near size 20.

## 5. Auras, buffs and loops

`"loop": true`, anchor `character`. Use `rate`, not `burst`, and keep it subtle: the player looks at this for a long time. See `examples/heal_aura.json`.

- Rising motes: box shape around the feet (`size: [4.5, 1, 4.5]`), `direction: "up"`, `speed` 2 to 4, size 0 → 0.5 → 0.
- Floor ring: flat `ring`, `rate` 1.5, lifetime 1.4, growing 3 → 8, `lockedToPart: true` so it travels with the character.
- Sparkles: `spark` on a sphere surface around the body, `rate` 5, very short life, size 0 → 1.3 → 0.
- Light: range 10 to 12, brightness breathing between two values over the loop; first and last track values equal.
- Budget: 20 to 40 particles alive. Twenty players may have it at once.
- Fire aura: `flame`, `cameraUp`, emitted from a box around the torso, `speed` 3 to 5 up, plus ember dots. Dark aura: opaque `smoke` in purple-black with `lightEmission` 0 and an *inward* sphere shape. Speed buff: `streak`, `velocity` orientation, emitted backward from a box behind the character with `lockedToPart: false` so they trail.

Loop length only matters for bursts and tracks; continuous emitters loop seamlessly by themselves.

## 6. Fire and smoke

See `examples/campfire.json`.

- **Flames:** `flame` texture, `orientation: "cameraUp"`, box shape as wide as the fire and very thin, `rate` 20 to 25, lifetime 0.5 to 0.85, size bulging early then narrowing, colour pale yellow → orange → red → dark, `lightEmission` 0.85, small `rotation` range (±12) so tongues lean.
- **Core:** a few `glow` particles low down, short life, pale yellow, to stop the base looking hollow.
- **Embers:** `dot`, `rate` 5 to 8, `brightness` 2.5, a little sideways `accel` for wind.
- **Smoke:** opaque, `rate` 4 to 6, lifetime 2 to 3 s, fades in, `zOffset` negative. Use the same sideways `accel` as the embers.
- **Light:** range about 6× the fire's width; flicker with 6 to 8 uneven keys between 2 and 3 brightness.
- Torch: `scale: 0.35` of the campfire and drop the smoke rate. Burning building: several instances rather than one huge emitter.
- Steam / fog: `smoke`, `lightEmission` 0, white, transparency never below 0.6, very slow.

## 7. Magic: charge, cast, projectile

| Stage | Recipe |
|---|---|
| Charge-up | Sphere shape `inOut: "inward"`, `style: "surface"`, radius R, `speed` ≈ R / lifetime so particles arrive at the centre as they die; `streak` + `velocity`; rate ramping is faked with two layers whose `window`s start at different times. Add a `glow` at the centre growing over the charge and a light track rising with it. End with a marker for the release. |
| Cast / muzzle | A hit spark (section 2) at the hand, pointed along `forward` with `spread` 25. |
| Projectile | A loop welded to the projectile part: `glow` core (`rate` 30, lifetime 0.15, `lockedToPart: true`), trailing `dot` or `spark` particles with `lockedToPart: false` and near-zero speed so they are left behind, and a light. Stop it and play an impact effect on hit. |
| Heal / level-up burst | One-shot: flat ring at the feet, `star` or `spark` particles rising with `speed` 10 to 16 and `drag` 2, a soft column (`glow`, `cameraUp`, tall narrow via several stacked particles), light up then down over 0.6 s. |
| Teleport | Inward charge for 0.3 s, flash, then outward `streak` burst and a flat ring; mirror it at the destination. |
| Shield | Sphere-surface `spark` or `ring` particles with `speed` 0, `lockedToPart: true`, lifetime 0.5, plus a `flat` ring that flashes on each hit (play a small one-shot at the hit point). |

## 8. Lightning and beams

See `examples/lightning_strike.json`.

- A Beam is one cubic curve. Give each bolt different `curve0` / `curve1` vectors (5 to 15 studs sideways on a 40-stud bolt) and stack three: a wide soft one (`texture: "glow"`), a medium one, and a thin solid white core with `brightness` 2.
- Flicker with `pulse` tracks whose keys are 0.03 to 0.05 s apart and uneven (1.4, 0.5, 1.2, 0.3, 0.9, 0); stagger the tracks between beams so they are never all dim together.
- Telegraph first: a thin, mostly transparent line or a floor ring 0.2 to 0.4 s before the strike, with a marker on the strike frame for damage.
- Laser: one straight beam, soft outer + solid inner, `pulse` growing from 0 to 1 in 0.05 s, plus a hit spark looping at the far end.
- Tether / heal link between two characters: export a single curved beam, then in Studio re-parent its two attachments (`<Layer>_A0`, `<Layer>_A1`) to the two characters; set `TextureSpeed` on the Beam for flow.
- Electric arcs on a character: 3 or 4 short beams (2 to 4 studs) with strong curves and windows of 0.05 to 0.08 s scattered through a 1 s loop.

## 9. Palettes

Three or four stops, from the hottest (start of life) to the coldest.

| Theme | Stops |
|---|---|
| Fire | `#fff3c4` → `#ffb030` → `#e2410c` → `#3a0f06` |
| Electric | `#ffffff` → `#9ad1ff` → `#3c7dff` |
| Heal / nature | `#f2fff6` → `#59f08f` → `#1f9d55` |
| Arcane | `#ffffff` → `#d59bff` → `#7a2cff` → `#2a0a5e` |
| Ice | `#ffffff` → `#bfefff` → `#5ab8ff` |
| Poison | `#f4ffb0` → `#9be22a` → `#3f7d12` |
| Holy / gold | `#ffffff` → `#ffe9a8` → `#ffb040` |
| Shadow | `#b78cff` → `#4a2a7a` → `#120a1e` (opaque layers, `lightEmission` 0 to 0.3) |
| Dust / stone | `#cdbb9c` → `#8d8170` (opaque) |
| Smoke | `#4a3a30` → `#26221f` (opaque) |

Additive colours saturate to white where particles overlap, which is what makes a core look hot; pick a mid-tone hue rather than a pale one for the body so there is room to brighten. Opaque layers show their exact colour.

## 10. Troubleshooting

| Symptom | Fix |
|---|---|
| The whole thing is a white blob | Too many additive particles overlapping. Cut counts, lower `brightness`, shorten the flash, make one layer opaque |
| Invisible or weak in the Daylight view | Everything is additive. Add an opaque layer or lower `lightEmission` to 0.5 on the core |
| Looks like a fountain | No `drag`. Raise `speed` and add `drag` 3 to 6 |
| Particles pop out | End `transparency` at 1 or `size` at 0 |
| Sparks are fat blobs | Use `streak` with `orientation: "velocity"`, size around 1.5 → 0.3 |
| Ring stands upright instead of lying down | It needs `orientation: "flat"`, `direction: "up"` and a tiny `speed` (0.01) |
| Effect is huge next to the dummy | Check `reach`; set `scale` or reduce `size` and `speed` together |
| Debris falls through the floor | Particles do not collide. Shorten `lifetime` so they die near the ground, or fade them earlier |
| Smoke hides the fire | Delay the smoke burst, start it transparent, give it a negative `zOffset` |
| Looks different in Studio | Stand-in textures until the PNGs are uploaded; bloom and lighting in the place; `LightInfluence` 0 keeps colours independent of the scene |
| Laggy with many players | Lower counts before anything else, play effects on the client only, shorten smoke lifetimes |
