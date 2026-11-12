---
name: roblox-vfx
description: Design, preview and export Roblox visual effects built from ParticleEmitters, Beams and PointLights. Turns a described effect (combat hits and slash impacts, explosions, ground slams and shockwaves, fire, smoke, magic auras, heals and buffs, charge-ups, lightning, pickups, level-up bursts, ambient loops) into a layered effect with an interactive 3D preview and storyboard, then generates a ready-to-use ModuleScript with its emitter template (.rbxmx file and a Studio command-bar script) plus particle texture PNGs. Use this whenever the user wants Roblox VFX, particles, a ParticleEmitter setup, an explosion / aura / impact / spell effect, a Beam or lightning effect, or asks to fix, retime or optimise an existing one, even if they only say "make it look cooler when X happens".
---

# Roblox VFX (particles, beams, lights)

You author an effect as a small JSON **effect spec**: a stack of layers (flash, core, sparks, smoke, ring, light...), each one a ParticleEmitter, Beam or PointLight described with the same properties Roblox uses. The bundled engine does what is hard to do blind: it simulates the particles the way Roblox does, renders a 3D preview and a storyboard you can look at, reports where everything actually ends up in studs, and exports real instances plus a `play()` module that fires every burst, window and light tween on time.

The user judges the result by watching it, so the loop is: **plan the layers → write the spec → build → look at the storyboard yourself → fix → deliver preview + export.** Do not skip the looking step. Effect numbers that seem right on paper are routinely wrong on screen: a flash that hides everything, sparks that never leave the core, smoke the size of a house.

## Workflow

1. **Pin down the effect.** What triggers it and where it sits (on the ground, on a character, at a hit point), one-shot or loop, its footprint in studs (match the hitbox if there is one), the mood and palette, and what gameplay needs to know (damage frame, sound cue). Start building straight away for a clear request and state the assumptions.
2. **Break it into layers** before writing numbers. Nearly every one-shot is: flash → core shape → fast debris → slow residue → light. Read `references/vfx-cookbook.md` for the genre (impacts, explosions, ground effects, auras and loops, fire and smoke, magic, lightning); it has layer recipes, timing tables and palettes.
3. **Write the spec** to `<name>.json`. Start from the closest file in `examples/` rather than from nothing.
4. **Build:** `node <skill>/scripts/rvfx.cjs <name>.json --out out` (several specs can be passed; they become tabs in one preview). Needs only Node, no packages.
5. **Read the report** on stdout. For each layer it gives the emission, peak particles alive and the `reach` box (R = right, U = up, F = forward, in studs from the origin), then the particles alive per layer at each storyboard panel, and `WARN` lines. Use it to check intent: does the ring really reach the 10-stud hitbox, is the smoke staying under the ceiling?
6. **Look at `out/storyboard-<Name>.png`** with the Read tool: eight moments of the effect on a dark stage with a 4-stud grid and an avatar-sized dummy for scale. Compare each panel with what you planned for that moment. To study one layer, rebuild a copy of the spec with the other layers removed, or set `"shots": [0.05, 0.1, ...]` to pick the times.
7. **Fix and rebuild** until every layer reads and the warnings are gone or consciously accepted. Two or three rounds is normal.
8. **Deliver:** the interactive `out/preview.html` (publish it as an artifact or send the file), `out/<Name>.rbxmx`, `out/<Name>.lua` and the `out/textures/` folder. Show the storyboard inline if you can. Tell the user briefly how to get it into Studio, how to call it, and about the texture upload step (below).

## Effect spec

```json
{
  "name": "HitSpark",              // ModuleScript and file name
  "title": "Melee hit spark",      // shown in the previewer
  "description": "One or two sentences shown beside the preview.",
  "duration": 0.35,                // seconds: the scripted part (loops: the loop length)
  "loop": false,
  "anchor": "character",           // "ground": origin on the floor · "character": origin at the HumanoidRootPart
  "markers": [ { "t": 0, "name": "Impact" } ],
  "layers": [
    { "name": "Flash", "texture": "glow", "at": [0, 0.5, 1.2], "burst": 1,
      "lifetime": 0.1, "size": [[0, 2.5], [0.3, 5], [1, 3]], "transparency": [[0, 0], [1, 1]],
      "color": ["#ffffff", "#ffe9a8"], "brightness": 2 },
    { "name": "Sparks", "texture": "streak", "at": [0, 0.5, 1.2], "burst": 16, "orientation": "velocity",
      "direction": "forward", "spread": [75, 75], "speed": [22, 46], "drag": 5, "accel": [0, -30, 0],
      "lifetime": [0.18, 0.34], "size": [[0, 1.5, 0.4], [1, 0.3]], "color": ["#ffffff", "#ffc24a", "#ff6a1a"] },
    { "name": "Blink", "type": "light", "at": [0, 0.5, 1.2], "color": "#ffd27a", "range": 14,
      "brightness": [[0, 6], [0.12, 0]], "window": [0, 0.14] }
  ]
}
```
(Comments are for explanation only; the file must be plain JSON.)

All positions and vectors are `[right, up, forward]` in studs relative to the effect origin, with "forward" being the way the target faces. Other top-level fields: `scale` (multiplies every size, speed, distance and range: the quick way to make a bigger or smaller variant), `dummy` (`"center"`, `"side"`, `"none"` or `[right, forward]`: where the scale figure stands in the preview), `camera` (`yaw`, `pitch`, `dist`, `target`), `shots` (storyboard times), `seed`, and `textures` (uploaded asset ids, see Textures).

### Particle layers (`"type": "particles"`, the default)

| Field | Meaning | Default |
|---|---|---|
| `burst` | Particles emitted at once: a number (at t = 0) or `[{ "t": 0.08, "count": 10 }, ...]` | none |
| `rate`, `window` | Continuous emission per second during `[start, end]` seconds | 0, whole duration |
| `at`, `direction`, `spread` | Emit point, direction (`up`, `down`, `left`, `right`, `forward`, `back` or a vector) and cone half-angles in degrees (`[180, 180]` = every direction) | origin, `up`, 0 |
| `shape` | `{ "type": "sphere" or "box", "size": [r, u, f], "style": "volume" or "surface", "inOut": "outward" or "inward" }`. Emits from a part of that size at `at` instead of a point. Spheres emit radially (inward = converge on the centre: charge-ups). A flattened sphere gives a ground ring of emission. | point |
| `lifetime`, `speed`, `rotation`, `rotSpeed` | A number or `[min, max]` (seconds, studs/s, degrees, degrees/s) | 0.5 to 1, 0, 0, 0 |
| `accel`, `drag` | World-space acceleration (gravity is about `[0, -40, 0]` for heavy debris, positive up for heat) and Drag (speed halves every `1/drag` seconds) | 0 |
| `size`, `transparency` | Over the particle's life: a number, `[start, ..., end]` evenly spaced, or `[[t, value, envelope], ...]` with t from 0 to 1. Size is the full width in studs. Envelope is a random ± per particle. | 1; `[0, 1]` |
| `color` | `"#hex"`, `["#start", ..., "#end"]` or `[[t, "#hex"], ...]` | white |
| `texture` | `glow`, `dot`, `ring`, `spark`, `streak`, `smoke`, `star`, `shard`, `flame` | `glow` |
| `lightEmission` | 1 = additive (light: fire, magic, sparks), 0 = opaque (matter: smoke, dust, debris) | 1 |
| `brightness`, `lightInfluence`, `zOffset`, `lockedToPart` | As in Roblox. `lockedToPart` makes particles travel with a moving parent (auras). | 1, 0, 0, false |
| `orientation` | `camera` (billboard), `cameraUp` (billboard that stays upright: flames), `velocity` (stretched along travel: streaks, use the `streak` texture), `flat` (perpendicular to travel: with `direction: "up"` and `speed: 0.01` the particle lies on the floor, which is how shockwave rings and magic circles are made) | `camera` |

### Light layers (`"type": "light"`)

`at`, `color`, `range` and `brightness`, plus `window` `[on, off]` for one-shots. `range` and `brightness` take a number or a track over effect time, `[[seconds, value], ...]`, which the module animates every frame: `[[0, 8], [0.1, 4], [0.5, 0]]` is a flash that decays. In a loop the track repeats, so make the first and last values equal.

### Beam layers (`"type": "beam"`)

`from`, `to`, optional `curve0` / `curve1` (offsets from each end to its Bézier control point), `width` (number or `[start, end]`), `color` and `transparency` (along the length), `texture: "glow"` for soft edges or none for a solid ribbon, `segments`, `window`, and `pulse`: a track over effect time that multiplies the width (flicker, grow-in, fade by thinning). One Beam is one smooth curve; jagged or forked looks come from stacking several differently curved beams and flickering them (see `examples/lightning_strike.json`).

### Markers

`markers` are named moments passed to `options.onMarker(name, model)` when the effect plays: the damage frame, sound cues, camera shake (the `roblox-combat` skill, if installed, has the camera shake, hitstop and sound side of hits). Put one on every moment gameplay cares about, and line them up with the animation's markers when the effect accompanies one.

## What good looks like

- **Layers with different jobs.** Something instant and bright (1 to 3 frames), something that defines the shape, something fast and small, something slow that lingers, and a light. If two layers do the same job, delete one.
- **Contrast in timing.** The flash is over in 0.1 s, sparks in 0.3 s, smoke takes a second or more. If every layer has the same lifetime the effect looks like a single sprite fading.
- **Hot to cold, bright to dark.** Start white or pale, move through the saturated hue, end dark. Additive layers (`lightEmission` 1) supply energy; at least one opaque layer (`lightEmission` 0) gives it body and keeps it readable in daylight. Toggle Daylight in the preview: an all-additive effect nearly vanishes against a bright sky.
- **Speed plus drag, not speed alone.** High `speed` with `drag` 3 to 6 gives the burst-then-hang motion that reads as impact. Constant speed looks like a fountain.
- **Nothing pops.** Every particle should end transparent or at size 0 (the build warns otherwise).
- **Right-sized.** Check `reach` against the dummy (5.2 studs tall) and the gameplay radius. Effects are usually authored too big.
- **Cheap.** Aim for under about 100 particles alive for a common effect (hits, footsteps) and under 300 for a rare big one; the report prints the peak. A few large particles beat many small ones.
- **Zero warnings**, or a reason for each one you keep.

## Getting it into Roblox Studio

Give the user both routes, the call, and the texture step.

- **Command bar (fastest):** View → Command Bar, paste the whole contents of `<Name>.lua`, press Enter. It creates `ReplicatedStorage.VFX.<Name>` (a ModuleScript with a `Template` model inside holding the real emitters, beams and lights, all editable in Explorer) and plays the effect once in front of the camera, or at the selected part.
- **File:** drag `<Name>.rbxmx` into Studio, or right-click ReplicatedStorage → Insert from File.
- **Playing it** (client-side is best: fire a RemoteEvent to clients and play there, so effects never cost server time):

```lua
local HitSpark = require(game.ReplicatedStorage.VFX.HitSpark)
HitSpark.play(hitPosition)                      -- Vector3 or CFrame: plays there
HitSpark.play(character)                        -- Model / BasePart / Attachment: welds to it and follows
local aura = HealAura.play(character)           -- loops return a handle...
aura:Stop()                                     -- ...stop lets live particles finish, then cleans up
Explosion.play(cf, { onMarker = function(name) if name == "Damage" then dealDamage() end end })
```

`anchor: "ground"` effects expect a point on the floor; `anchor: "character"` effects expect the character (its HumanoidRootPart). The effect's forward follows the target's facing. Acceleration stays in world space, as in Roblox. One-shots destroy themselves when the last particle is gone.

### Textures

Roblox particles need image assets, and assets can only be uploaded by the user. The build writes `out/textures/<name>.png` (white on transparent, tinted by `Color`) for every texture used. Until they are uploaded, the export points at textures that ship with Roblox (sparkle, smoke, fire), so the effect works immediately but `ring`, `streak`, `shard` and `star` show as a generic sparkle and the rest look approximate. Say this plainly when delivering. To finish the look: upload the PNGs (Creator Hub → Development Items → Images/Decals, or Asset Manager in Studio), then either paste the ids into the `TEXTURES` table at the top of `<Name>.lua`, or add `"textures": { "ring": "rbxassetid://123", ... }` to the spec and rebuild. The user's own texture ids work the same way (or per layer with `textureId`); the preview keeps showing the named stand-in shape.

## Limits to be honest about

- The preview is a faithful approximation, not Roblox's renderer: no bloom, ColorCorrection or fog, lighting is simplified, and custom uploaded textures are not shown. Final colour and brightness tuning happens in Studio, in the game's own lighting.
- Not covered: Trails (they need a moving part; for a sword slash, add a `Trail` between two attachments on the blade and enable it between the animation's markers), flipbook textures, mesh or part based effects, screen effects and camera shake (drive those from markers).
- Studio's menus change from time to time; if a step does not match what the user sees, say so and look up the current wording rather than insisting.

## Files

- `scripts/rvfx.cjs` — simulator, renderer, previewer and exporter in one file. Also a module: `const R = require('.../rvfx.cjs'); const c = R.compile(spec); R.report(c); R.toLuau(c)`.
- `scripts/selftest.cjs` — checks the particle maths, sequences, PNG writer and both exporters. Run it after editing the engine.
- `examples/` — `hit_spark` (character-anchored impact), `explosion` (full layered one-shot with opaque smoke), `ground_slam` (floor rings, radial dust from a flat sphere, gravity debris), `heal_aura` (loop welded to a character, box and sphere shapes), `campfire` (environment loop with a flickering light), `lightning_strike` (beams with pulse tracks, delayed bursts, telegraph).
- `references/vfx-cookbook.md` — layer recipes, timing and palettes by genre, plus troubleshooting. Read the relevant section before authoring.
