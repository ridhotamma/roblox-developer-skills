---
name: roblox-vfx
description: Design, preview and export Roblox visual effects built from ParticleEmitters, Beams, PointLights and scrolling Textures. Turns a described effect (combat hits and slash impacts, explosions, ground slams and shockwaves, fire, smoke, magic auras, heals and buffs, charge-ups, lightning, pickups, level-up bursts, ambient loops, and water - waterfalls, rivers, splashes, ripples, rain, fountains, bubbles, caustics, shore and ocean waves, water wave attacks) into a layered effect with an interactive 3D preview and storyboard, then generates a ready-to-use ModuleScript with its emitter template (.rbxmx file and a Studio command-bar script) plus texture PNGs - static particle sprites, procedurally generated flipbook sprite sheets (splash crowns, ripples, churning foam, mist, billowing puffs, breaking wave crests; 1024 Grid4x4, seamless loops, alpha erosion) and seamless tiling textures for flowing beams and surfaces (falling water, foam streaks, caustics, wave lines). Use this whenever the user wants Roblox VFX, particles, a ParticleEmitter setup, a flipbook or animated particle texture, a sprite sheet for an effect, an explosion / aura / impact / spell effect, any water effect, a Beam, lightning or scrolling texture effect, or asks to fix, retime or optimise an existing one, even if they only say "make it look cooler when X happens".
---

# Roblox VFX (particles, beams, lights)

You author an effect as a small JSON **effect spec**: a stack of layers (flash, core, sparks, smoke, ring, light...), each one a ParticleEmitter, Beam, PointLight or scrolling surface Texture described with the same properties Roblox uses. Textures are generated, not drawn by hand: static sprites, animated flipbook sheets (the shape changes inside the sprite: a splash crown rising and collapsing, a puff billowing and eroding) and seamless tiling textures that scroll along beams and surfaces (falling water, foam, caustics). The bundled engine does what is hard to do blind: it simulates the particles the way Roblox does, renders a 3D preview and a storyboard you can look at, reports where everything actually ends up in studs, and exports real instances plus a `play()` module that fires every burst, window and light tween on time.

The user judges the result by watching it, so the loop is: **plan the layers → write the spec → build → look at the storyboard yourself → fix → deliver preview + export.** Do not skip the looking step. Effect numbers that seem right on paper are routinely wrong on screen: a flash that hides everything, sparks that never leave the core, smoke the size of a house.

## Workflow

1. **Pin down the effect.** What triggers it and where it sits (on the ground, on a character, at a hit point), one-shot or loop, its footprint in studs (match the hitbox if there is one), the mood and palette, and what gameplay needs to know (damage frame, sound cue). Start building straight away for a clear request and state the assumptions.
2. **Break it into layers** before writing numbers. Nearly every one-shot is: flash → core shape → fast debris → slow residue → light. Read `references/vfx-cookbook.md` for the genre (impacts, explosions, ground effects, auras and loops, fire and smoke, magic, lightning, water); it has layer recipes, timing tables and palettes. For water, flipbooks or flowing textures, read `references/water-and-flipbooks.md` first: how water behaves (foam is white because of air, falling water accelerates, splash and wave anatomy), when to use particle motion vs a flipbook vs a scrolling texture, and the Roblox rules for each.
3. **Write the spec** to `<name>.json`. Start from the closest file in `examples/` rather than from nothing.
4. **Build:** `node <skill>/scripts/rvfx.cjs <name>.json --out out` (several specs can be passed; they become tabs in one preview). Needs only Node, no packages.
5. **Read the report** on stdout. For each layer it gives the emission, peak particles alive and the `reach` box (R = right, U = up, F = forward, in studs from the origin), then the particles alive per layer at each storyboard panel, and `WARN` lines. Use it to check intent: does the ring really reach the 10-stud hitbox, is the smoke staying under the ceiling?
6. **Look at `out/storyboard-<Name>.png`** with the Read tool: eight moments of the effect on a dark stage with a 4-stud grid and an avatar-sized dummy for scale. Compare each panel with what you planned for that moment. To study one layer, rebuild a copy of the spec with the other layers removed, or set `"shots": [0.05, 0.1, ...]` to pick the times. When the effect uses flipbooks or tiling textures, also look at `out/textures.png` (every frame of every flipbook, tiling textures repeated 2 x 2) so you know what each sprite does on its own.
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
| `texture` | Static: `glow`, `dot`, `ring`, `spark`, `streak`, `smoke`, `star`, `shard`, `flame`, `droplet` (water drop for `velocity`), `bubble`. Animated flipbooks (table below): `splash`, `ripple`, `foam`, `mist`, `puff`, `crest` | `glow` |
| `flipbook` | For animated textures: `{ "mode": "OneShot" \| "Loop" \| "PingPong" \| "Random", "fps": 20 or [min, max], "startRandom": bool, "blend": bool }`. Defaults come from the texture (OneShot plays the 16 frames over each particle's lifetime and ignores `fps`; Loop starts each particle on a random frame) | per texture |
| `lightEmission` | 1 = additive (light: fire, magic, sparks), 0 = opaque (matter: smoke, dust, debris) | 1 |
| `brightness`, `lightInfluence`, `zOffset`, `lockedToPart` | As in Roblox. `lockedToPart` makes particles travel with a moving parent (auras). | 1, 0, 0, false |
| `orientation` | `camera` (billboard), `cameraUp` (billboard that stays upright: flames), `velocity` (stretched along travel: streaks, use the `streak` texture), `flat` (perpendicular to travel: with `direction: "up"` and `speed: 0.01` the particle lies on the floor, which is how shockwave rings and magic circles are made) | `camera` |

### Flipbook textures

Each is a 1024 x 1024 Grid4x4 sheet of 16 white frames, generated procedurally (periodic noise and Worley cells, so loops close exactly and one-shots end fully transparent, breaking up with alpha erosion instead of a flat fade). Let the frames do the shape change and the emitter do the travel.

| Texture | Mode | What it shows | How to place it |
|---|---|---|---|
| `splash` | OneShot | Side view: crown sheet rises, rim tears into fingers and droplets, central jet, collapse | `cameraUp`, constant `size` (the whole frame), base on the bottom edge: `at` = size / 2 minus a little |
| `ripple` | OneShot | Top view: three expanding rings that fade | `flat` + `direction: "up"` + `speed: 0.01`; constant `size` = final diameter |
| `foam` | Loop | Top view: churning lacy foam patch with dense clumps | `flat` on water, or camera-facing for white water |
| `mist` | Loop | Soft billowing vapour | camera-facing, opaque (`lightEmission` 0), slow, growing |
| `puff` | OneShot | Billow that expands and erodes away | smoke, dust, steam, white water, spray |
| `crest` | OneShot | Side view: breaking wave lip pitches forward and explodes into whitewater (travels right) | `cameraUp`; only reads from the side (see the cookbook) |

### Light layers (`"type": "light"`)

`at`, `color`, `range` and `brightness`, plus `window` `[on, off]` for one-shots. `range` and `brightness` take a number or a track over effect time, `[[seconds, value], ...]`, which the module animates every frame: `[[0, 8], [0.1, 4], [0.5, 0]]` is a flash that decays. In a loop the track repeats, so make the first and last values equal.

### Beam layers (`"type": "beam"`)

`from`, `to`, optional `curve0` / `curve1` (offsets from each end to its Bézier control point), `width` (number or `[start, end]`), `color` and `transparency` (along the length), `segments`, `window`, `zOffset`, and `pulse`: a track over effect time that multiplies the width (flicker, grow-in, fade by thinning). One Beam is one smooth curve; jagged or forked looks come from stacking several differently curved beams and flickering them (see `examples/lightning_strike.json`).

`texture`: `"glow"` for soft edges, none for a solid ribbon, or a **tiling texture that flows**: `waterflow` (translucent falling or flowing water with streaks), `foamflow` (streaky foam), `caustics`, `waves`. Flow fields: `textureMode` (`"wrap"`: one repeat every `textureLength` studs, the default for tiling textures; `"stretch"`: `textureLength` repeats over the whole beam), `textureLength`, `textureSpeed` (repeats per second toward `to`; the report prints the flow speed in studs/s), `softEdges` (default true: fades the sides of the ribbon). `faceCamera` (default true) turns the ribbon toward the camera, right for falling sheets and curtains; `"faceCamera": false` with `widthAxis` (the direction the width spans, e.g. `[1, 0, 0]`) keeps a flat ribbon, right for a river on the ground or foam on a beach. Stack two copies at different speeds for depth (see `examples/waterfall.json`).

### Surface layers (`"type": "surface"`)

A scrolling `Texture` on an invisible flat part: wave lines on a sea, caustics on a pool floor, a lake's surface pattern. `at` (centre), `size` `[width, length]` studs, `facing` (`up` by default, or another direction or vector), `texture` (a tiling texture), `tile` (studs per repeat, number or `[u, v]`), `scroll` `[u, v]` studs per second (u along the width, v along the length, which is forward for an up-facing surface), `color`, `transparency` (a number or a track over effect time), `zIndex`. Textures have hard edges and no additive blending: hide the border in the scene.

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

Roblox particles need image assets, and assets can only be uploaded by the user. The build writes `out/textures/<name>.png` (white on transparent, tinted by `Color`) for every texture used: 256 px sprites, 1024 x 1024 flipbook sheets, 256 px tiling textures (`<name>_beam.png` is the soft-edged version a beam uses). Until they are uploaded, the export points at textures that ship with Roblox (sparkle, smoke, fire), so the effect works immediately but `ring`, `streak`, `shard`, `star` and most water sprites show as a generic sparkle, flipbooks play as a single still image, beams with tiling textures draw a plain ribbon and surfaces show nothing. Say this plainly when delivering: water effects in particular only look right after the upload. To finish the look: upload the PNGs (Creator Hub → Development Items → Images/Decals, or Asset Manager in Studio), then either paste the ids into the `TEXTURES` table at the top of `<Name>.lua`, or add `"textures": { "ring": "rbxassetid://123", "waterflow_beam": "rbxassetid://456", ... }` to the spec and rebuild. The flipbook properties (`FlipbookLayout = Grid4x4`, mode, framerate, random start) are already set on the emitters. The user's own texture ids work the same way (or per layer with `textureId`; a custom flipbook must also be a 1024 x 1024 Grid4x4 sheet); the preview keeps showing the named stand-in shape.

## Limits to be honest about

- The preview is a faithful approximation, not Roblox's renderer: no bloom, ColorCorrection, fog or water refraction, lighting is simplified, and custom uploaded textures are not shown. Final colour and brightness tuning happens in Studio, in the game's own lighting and over the real water.
- Two Roblox details are undocumented and inferred (`references/water-and-flipbooks.md` section 10): which attachment axis a flat beam's width follows (if a `faceCamera: false` beam shows edge-on, rotate both attachments 90° about X), and which way a surface Texture slides as its offset grows (if it flows backwards, negate that `scroll` component). Mention them when delivering effects that use either.
- Flipbooks are fixed at 16 frames (Grid4x4) per sheet, and the built-in ones are the six above; a flipbook drawn by hand (any style, any subject) comes from the `roblox-2d-art` skill (`kind: "particle"`) and plugs in with `textureId`.
- Not covered: Trails (they need a moving part; for a sword slash, add a `Trail` between two attachments on the blade and enable it between the animation's markers), mesh or part based effects (swells of an ocean need a mesh moved by Gerstner waves; the theory is in the water reference), screen effects and camera shake (drive those from markers).
- Studio's menus change from time to time; if a step does not match what the user sees, say so and look up the current wording rather than insisting.

## Files

- `scripts/rvfx.cjs` — simulator, renderer, texture generator (periodic gradient and Worley noise, flipbooks, tiling textures), previewer and exporter in one file. Also a module: `const R = require('.../rvfx.cjs'); const c = R.compile(spec); R.report(c); R.toLuau(c); R.flipbookPng('splash')`.
- `scripts/selftest.cjs` — checks the particle maths, sequences, noise periodicity, seamless tiles, flipbook loops and empty last frames, frame selection per mode, PNG writer and both exporters. Run it after editing the engine.
- `examples/` — `hit_spark` (character-anchored impact), `explosion` (full layered one-shot with opaque smoke), `ground_slam` (floor rings, radial dust from a flat sphere, gravity debris), `heal_aura` (loop welded to a character, box and sphere shapes), `campfire` (environment loop with a flickering light), `lightning_strike` (beams with pulse tracks, delayed bursts, telegraph), `waterfall` (two flowing sheets at different speeds, flat lip ribbon, splash / foam / ripple / mist flipbooks), `water_splash` (crown and jet flipbook, droplets, foam, ripple rings), `shore_waves` (scrolling wave-line surface, peeling whitewater, curtain and wash beams driven by pulse tracks).
- `references/vfx-cookbook.md` — layer recipes, timing and palettes by genre (section 11: water), plus troubleshooting. Read the relevant section before authoring.
- `references/water-and-flipbooks.md` — the theory: particle motion vs flipbook vs scrolling texture, Roblox flipbook and beam texture rules, tiling and looping noise, how water behaves, waterfall, splash and ripple anatomy, Gerstner waves, breakers and swash, Terrain water settings, and the known uncertainties.
