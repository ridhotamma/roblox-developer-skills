# Water, flipbooks and scrolling textures: the theory

Read this before authoring water (waterfalls, rivers, splashes, ripples, rain, shore and ocean waves, water attacks) or any
effect that needs an animated sprite (smoke puffs, foam, mist) or a flowing texture. It explains *why* the recipes in
`vfx-cookbook.md` section 11 work, so they can be adapted instead of copied.

Contents: 1. Three ways to make a texture move · 2. Flipbooks · 3. Scrolling textures · 4. Procedural textures that tile and
loop · 5. How water behaves · 6. Waterfalls · 7. Splashes and ripples · 8. Ocean and shore waves · 9. Roblox water specifics ·
10. Known uncertainties

## 1. Three ways to make a texture move

| Technique | Roblox feature | Moves | Use for |
|---|---|---|---|
| Particle motion | ParticleEmitter (speed, drag, acceleration, size and transparency over life) | where a sprite is, how big, how faded | everything that travels: droplets, spray, debris |
| Flipbook | ParticleEmitter `FlipbookLayout` + a sheet of frames | the *shape* inside the sprite | things that change shape in place: a splash crown rising and collapsing, a puff billowing and breaking up, ripple rings, churning foam |
| Scrolling texture | Beam `TextureSpeed` (+ `TextureMode`), or a `Texture` on a part with `OffsetStudsU/V` animated | a pattern sliding along a surface | continuous flow: falling sheets, rivers, foam on rapids, wave lines on a sea, caustics |

Combine them: a waterfall is a scrolling sheet (flow) plus flipbook splashes (shape change) plus particle droplets (travel).
If a sprite's shape must change, no amount of particle animation fakes it convincingly; that is the job of a flipbook.

## 2. Flipbooks

A flipbook is one texture holding a grid of frames that a particle steps through. Roblox facts (Creator Hub, 2026):

- `FlipbookLayout`: `None`, `Grid2x2` (4 frames), `Grid4x4` (16), `Grid8x8` (64), or `Custom` (columns and rows from
  `FlipbookSizeX` / `FlipbookSizeY`). Frames are read left to right, top to bottom.
- Texture size: the docs say flipbook playback requires a **1024 x 1024** texture (otherwise the engine marks it
  `NotCompatible` and plays nothing), and elsewhere that the size must be an exact multiple of the layout. A 1024 square
  satisfies both, so this skill always writes 1024 x 1024 Grid4x4 sheets (16 frames of 256 px).
- `FlipbookMode`: `Loop`, `OneShot`, `PingPong`, `Random`. **OneShot ignores the framerate**: the frames are spread
  evenly over each particle's `Lifetime`, so the animation always finishes exactly when the particle dies. The others
  advance at `FlipbookFramerate` (a NumberRange, at most 30 fps).
- `FlipbookStartRandom` starts each particle on a random frame (essential for looping foam and mist, or every particle
  churns in sync). `FlipbookBlendFrames` crossfades between frames, which hides low frame counts.
- Leave transparent spacing around every frame: mip filtering blends neighbouring pixels, and at a distance a frame
  would pick up the edge of the next one. The sheets here inset every frame by 4 % (about 10 px).
- Flipbooks cost texture memory and Roblox may switch them off on low-memory devices. Keep the effect readable without
  them: the droplets, spray and light should be separate layers, not painted into the flipbook.

Design rules:

- **Frame budget.** Smooth motion needs 12 to 30 frames per second of screen time. OneShot fps = 16 / lifetime: a
  16-frame splash on a 0.6 s particle plays at 27 fps (smooth); on a 2 s particle at 8 fps (choppy: blend frames, or
  use fewer, slower-changing shapes). The build reports the fps of every flipbook layer.
- **Loops must close.** For a looping flipbook the frame after the last must equal the first. Do not fade the last
  frame into the first; generate the animation on a *periodic* time axis (section 4) so frame 16 *is* frame 0.
- **One-shots must end empty.** The last frame should be fully transparent so the particle cannot pop; the texture
  does the fade, so the layer's `transparency` can stay nearly constant.
- **Alpha erosion beats fading.** Fading the whole sprite uniformly looks like a slide dissolve. Real smoke, foam and
  spray break up: thin parts vanish first, the dense core last. Erosion raises a threshold through a noise-weighted copy
  of the alpha over time (the puff, splash and crest flipbooks do this in their last third).
- **White masks.** Draw frames white with the shape in alpha; `Color` tints them, so one sheet serves water, slime,
  lava foam and magic. Shading painted into the texture would fight the tint.
- **Let the texture do the shape, the emitter do the travel.** A splash flipbook already grows, so keep its `size`
  constant (its value is the size of the whole frame); a ripple flipbook already expands, so its `size` is the final
  diameter.
- **Bottom-anchored sprites.** A splash or breaking crest stands on its base, which is the bottom edge of the frame.
  Use `orientation: "cameraUp"` (stays upright) and put `at` at half the size above the water, minus a little to
  sink the base.
- **Billboards are view-dependent.** A side-view sprite (the breaking crest) is right only when the camera sees it
  from the side. Round things (puffs, mist, foam, splash crowns) read from any angle; prefer them for third-person
  games where the camera can be anywhere.

## 3. Scrolling textures

### Beams
- A Beam draws its texture between `Attachment0` and `Attachment1`; the image's **horizontal axis runs along the beam**
  (left edge at Attachment0) and the vertical axis spans the width once.
- `TextureMode = Stretch`: the texture repeats `TextureLength` times over the whole beam (stretches if the beam gets
  longer). `Wrap`: one repeat every `TextureLength` studs (keeps its scale whatever the length; use this for flow).
  `Static` behaves like `Wrap` on a Beam.
- `TextureSpeed`: texture cycles per second; positive moves from Attachment0 toward Attachment1. Flow speed in studs/s
  is `TextureSpeed x TextureLength` in Wrap mode (the build reports it).
- `FaceCamera = true` turns the ribbon to face the camera (never seen edge-on: right for falling sheets and curtains);
  `false` keeps it in the plane set by its attachments (right for a river lying flat or foam on a beach).
- `CurveSize0/1` bend the beam along each attachment's +X (Attachment1's -X); `Segments` must be high enough for the
  curve and for the Color / Transparency keypoints (at least n - 1).
- `ZOffset` moves a beam toward the camera in render order: use it to keep the fast front layer in front.
- **Parallax by speed.** Two copies of a sheet scrolling at different speeds and texture lengths read as depth and
  turbulence (Roblox's own waterfall tutorial stacks a fast and a slow drop). A single scrolling layer looks like a
  conveyor belt.
- **Soft edges.** A beam's texture fills the width edge to edge; fade the top and bottom of the image (the build does
  this for tiling textures on beams: `<name>_beam.png`) or the ribbon shows hard sides.

### Textures on parts
- A `Texture` tiles every `StudsPerTileU/V` studs over one face and slides with `OffsetStudsU/V`; animating the offset
  scrolls it. It has no additive mode and no soft edges, so hide its border in geometry (banks, rocks, the water line).
- It still renders on a part with `Transparency = 1`, which is how a surface layer floats wave lines or caustics over
  water or a pool floor.
- Caustics: two copies of the same caustic texture scrolling in different directions at different speeds give the
  shifting web of light seen on pool floors; one copy just slides.

## 4. Procedural textures that tile and loop

- **Tiling** comes from periodic noise: the noise lattice wraps after an integer number of cells, so the texture's
  right edge continues into its left edge. Stretching the lattice (more cells across than along) makes streaks along
  the flow.
- **Looping** uses the same trick on time: time is a third noise axis that wraps, or Worley cell points travel once
  around a small circle. Frame 16 then equals frame 0 exactly.
- **Gradient (Perlin) noise** gives soft billows (mist, puffs, streaks). **Worley (cellular) noise** gives cell walls:
  `F2 - F1` near zero draws the walls, which look like foam lacing and, thinner, like light caustics. Feature points
  must spread over the whole cell, or the walls line up with the lattice and the pattern looks gridded.
- **Thin lines alias.** At a distance, mipmaps average thin white lines into a grey haze; up close they are crisp. Keep
  line textures at a tile size where the lines stay a few pixels wide in the views that matter.

## 5. How water behaves (what to imitate)

- **Water itself is nearly invisible; what we see is its surface and its air.** Clear water shows the colour of what
  is behind it, plus reflections and specular highlights. **Foam, white water and spray are white because they are full
  of air bubbles** that scatter light: the more turbulent, the whiter. So: calm water = transparent and tinted,
  turbulent water = white and opaque-ish.
- **Colour by depth.** Shallow water looks pale cyan or green (you see the bottom), deep water dark blue-teal. Mist is
  the palest, nearly white with a hint of blue.
- **Speed sells scale.** Falling water accelerates: `v = sqrt(2 g h)`. With Earth gravity and 1 stud about 0.28 m,
  g is about 35 studs/s², so water at the bottom of a 24-stud fall moves about 40 studs/s. Big waterfalls look slow
  from far away because the eye judges speed relative to size: scale texture speeds down for distant, huge falls.
- **Droplets are ballistic.** Once in the air, each drop follows a parabola under gravity with little drag; fine spray
  has lots of drag (it floats and becomes mist). Use streaked `droplet` sprites along the velocity for drops, soft
  `mist` for spray.
- **Opaque layers survive daylight.** Additive white disappears against a bright sky; foam and mist need
  `lightEmission` near 0 to read outdoors.

## 6. Waterfalls

Anatomy (the Roblox Creator Hub tutorial splits it the same way): cascades (the falling water), splashes (where water
hits the plunge pool), white water (turbulence at the impact), foam (on the pool surface), mist (vapour rising and
drifting, sometimes a faint rainbow).

| Part | Behaviour | Build it with |
|---|---|---|
| Lip | water slides toward the edge, foam streaks | flat beam (`faceCamera: false`) of `foamflow` scrolling toward the edge |
| Sheet | accelerating fall, streaks stretched along the flow, translucent | 2 beams of `waterflow` at different speeds (e.g. 24 and 42 studs/s), the fast one narrower with `zOffset` |
| Arc | leaves the lip horizontally, then curves down | `curve0` forward over the lip, `curve1` straight up from the pool so it enters vertically |
| Impact | crown splashes, droplets, white water | `splash` flipbook (cameraUp, constant size) + `droplet` with gravity + `puff` billows |
| Pool | foam drifting away, ripples spreading | flat `foam` flipbook (Loop, random start) + flat `ripple` flipbook |
| Mist | rises, drifts downwind, lingers seconds | opaque `mist` flipbook, slow, growing, long lifetime |

## 7. Splashes and ripples

- **Splash timeline** (a heavy object into deep water): impact flash of white water (0 to 0.05 s); a **crown** sheet
  rises around the cavity and its rim tears into fingers that shed droplets (0.05 to 0.3 s); the crown falls back and a
  central **Worthington jet** shoots up from the collapsing cavity, often dropping a bead from its tip (0.3 to 0.7 s);
  foam and ripple rings spread for the next 1 to 2 s. Small objects make only a crown or only a jet; big ones make both.
- **Ripples** spread from the disturbance as rings at roughly constant speed and fade as they grow (the energy spreads
  over a longer circumference), with a trailing ring or two behind the first. Footsteps and raindrops: one small
  ripple each. Something moving through water leaves a V-shaped wake of ripples behind it.
- **Rain on water**: per drop a tiny crown or jet (short splash flipbook, size about 1) and a ripple (size about 2 to 3).

## 8. Ocean and shore waves

- **Shape.** Real wind waves are not sine waves: water particles move in circles, which sharpens crests and flattens
  troughs (the trochoidal or **Gerstner** wave). Sum several Gerstner waves in different directions for a sea:
  for each wave with direction D, wavelength L, amplitude A and steepness Q: `k = 2 pi / L`,
  `w = sqrt(g k)` (deep-water dispersion: long waves travel faster, speed `sqrt(g L / 2 pi)`), and a surface point at
  rest position p moves to `p + (Q A D cos(k D.p - w t), A sin(k D.p - w t))` (horizontal, vertical). Keep `Q k A` below 1
  for the sum or the crests loop over themselves. (GPU Gems, "Effective Water Simulation from Physical Models".)
- **Breaking.** A wave breaks when it gets too steep: in deep water around height / length = 1/7 (whitecaps), near the
  shore when its height reaches about 0.8 of the water depth. Approaching the beach, waves slow down, bunch up and
  steepen (shoaling), so they break in lines parallel to the shore.
- **Breaker types**: *spilling* (gentle beaches: foam tumbles down the front face), *plunging* (the lip throws forward
  and crashes, enclosing a tube: the `crest` flipbook), *surging* (steep shores: the wave slides up without breaking).
- **After the break**: the whitewater rushes up the beach (swash), slows, and drains back (backwash), leaving a foam
  line and lacy foam patches that slowly dissolve.
- **Peeling.** A wave rarely breaks along its whole length at once; the break point travels along the crest. Stagger
  bursts along the line.
- In a game the moving water surface is the Terrain water or a water mesh; VFX add what the surface cannot: foam,
  whitewater, spray, mist, wave lines.

## 9. Roblox water specifics

- **Terrain water** (properties on `workspace.Terrain`): `WaterColor` (default a dark teal 0.05, 0.33, 0.36),
  `WaterTransparency` (0 opaque to 1 clear, default 0.3), `WaterReflectance` (0 to 1, default 1), `WaterWaveSize` (wave
  height in studs, **limited to 0 to 1**), `WaterWaveSpeed` (wave cycles per minute, 0 to 100). Terrain waves are small
  ripples, not breaking surf: big swells need a mesh (an EditableMesh or bones moved by Gerstner sums on the client),
  and surf needs the VFX here.
- Rough presets: calm lake `WaveSize 0.05, WaveSpeed 6, Transparency 0.5`; open sea `WaveSize 0.4 to 0.8, WaveSpeed 15 to
  25, Transparency 0.2, WaterColor (0.08, 0.3, 0.42)`; tropical shallows `Transparency 0.8, WaterColor (0.1, 0.55, 0.55)`.
  Tune in Studio; the `roblox-atmosphere` skill covers fog and sky that change how water reads.
- Water parts (a transparent blue part, often with a scrolling Texture) are the alternative for stylised or moving
  water (rivers on slopes, waterfalls' pools in obbies).
- Particles do not collide: droplets fall through the water surface. Give them lifetimes that end near the surface, or
  let the water hide them.

## 10. Known uncertainties

- With `FaceCamera = false` Roblox does not document which attachment axis the ribbon's width follows. The exporter
  points each attachment's +X along the curve (documented) and +Y (SecondaryAxis) along `widthAxis`. If a flat beam
  shows edge-on in Studio, rotate both attachments 90 degrees about their X axis, or set FaceCamera.
- The direction a `Texture` moves when `OffsetStudsV` grows depends on the face's UV layout. The module scrolls U along
  the part's +X and V along its -Z (forward for an up-facing surface); if a surface flows backwards in Studio, negate
  that `scroll` component.
- The preview approximates Roblox's renderer: no bloom, no water refraction, simplified lighting, its own mipmaps.
  Judge final colour and opacity in Studio, over the real water.
