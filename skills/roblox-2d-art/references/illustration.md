# Illustration in code: characters, creatures and scenes

How to draw a picture programmatically that looks illustrated instead of assembled: mascots, characters, creatures,
key art, loading screens, story panels, scenes. Icons are one object on a plain ground. An illustration has a body in
a pose, a face with an expression, an environment with depth and one light over all of it. Every rule below comes
from how illustrators work, translated into what you write in the spec. `examples/illustration.art.mjs` uses all of it.

## Contents
1. What code draws well (and when to use an image model instead)
2. The pipeline: work in passes, from big to small
3. Construction: skeleton, gesture, volumes
4. Curves: why programmer art looks programmed
5. Line art: weight, taper, where to put lines
6. Faces and expression
7. Light: a designed light plan, not a filter
8. Colour in a scene: local colour, light colour, grade
9. Space and depth: planes, ground perspective, overlap
10. Nature at scale: scatter, clusters, variation
11. Texture and finish
12. Failure modes: symptom, cause, fix
13. Checklist before you call it done

---

## 1. What code draws well

Layered vector shapes with procedural shading do **cel / toon, storybook, sticker, flat-with-texture and
"Roblox simulator" illustration** very well: clean shapes, controlled colour, consistent characters you can re-pose
and re-use across a game icon, thumbnail, badge and loading screen (one drawing, many assets). They do not do
painterly rendering, photo-real materials, hair as thousands of strands or complex fabric. If the user wants that
look and has an image-generation tool connected, generate (ask first if it costs credits) and finish with `rart post`.

A good illustration in code is not more shapes; it is **better decisions**: one pose with a clear line of action,
silhouettes that read in black, three value groups, one light, a limited palette, detail only at the focal point.

## 2. The pipeline: work in passes, from big to small

Illustrators never finish one corner first. Work in the same order, rendering after each pass:

1. **Brief** (graphic-design.md section 13): message, reading order, layout, value plan, colour scheme, depth planes.
   For an illustration add: **the moment** (what is happening, what just happened, what happens next) and **the
   emotion** of each character. A pose with no story is a mannequin.
2. **Thumbnail block-in**: flat shapes only (no shading, no outline, no texture), 2-3 layout variants as separate
   assets (`name: 'ThumbA'`, `ThumbB`...). Build, look at them at 256 px, pick one. Composition problems are cheap
   to fix here and expensive later.
3. **Construction**: skeleton and volumes for every character (section 3). Check the silhouette view.
4. **Flats**: local colour per part, one layer per part, bottom to top. Check the greyscale view: if the value
   groups do not read yet, shading will not save them.
5. **Light**: form shading (`shade`), cast and contact shadows, rim light, the key light's pool (section 7).
6. **Line**: outline weight hierarchy and interior lines (section 5).
7. **Detail**: only at the focal point and the second read (face, hands, the key prop). Everywhere else, simplify.
8. **Atmosphere and finish**: haze, grade, vignette, grain on the `post` stage (sections 8 and 11).
9. **Review**: the review sheet plus the checklist in section 13. Then fix the biggest problem first, rebuild.

## 3. Construction: skeleton, gesture, volumes

**Pose with a skeleton, not with shapes.** Place joints first, then hang volumes on them. `k.fk(root, [[length,
angle], ...])` returns joint positions from bone lengths and bend angles, so a pose is a handful of numbers you can
tweak, mirror or animate:

```js
const [shoulder, elbow, hand] = k.fk([300, 260], [[34, 200], [28, -35]]);   // first angle absolute, then bends
const arm = k.limb(shoulder, elbow, 13, 12) + k.limb(elbow, hand, 12, 10);    // tapered capsules on the bones
```

- **Line of action**: one C or S curve runs through the whole figure (head to supporting foot). Lean the body along
  it. A vertical, symmetric figure looks like a mannequin; a figure on a curve looks alive. Draw the curve first
  (`k.line(k.smooth(pts, false), ...)` on a hidden layer while working) and fit the skeleton to it.
- **Weight**: the centre of mass sits over the supporting foot (or between both feet). Off that line the figure falls,
  which is right only for running, jumping or falling poses.
- **Contrapposto**: shoulders and hips tilt in opposite directions when weight is on one leg.
- **No twins**: the two arms (and legs) never do the same thing at the same angle. Vary angle, bend and height.
- **Overlap**: near limbs cross over the body and far limbs tuck behind it. Overlap is the strongest depth cue a
  character has; side-by-side parts read flat. Draw far limbs first, in a darker shade (`k.c.shade(c, -0.35)`).
- **3/4 view** beats front view for appeal: the face turns, the far eye is slightly smaller and closer to the edge,
  the far side of the body is narrower.
- **Proportions in head heights**: chibi / mascot 1.5-2.5 heads (big head and eyes, short limbs, reads at icon size),
  Roblox-style cartoon 4-5, heroic 7-8. Pick one per game and keep it.
- **Volumes**: `k.limb(a, b, ra, rb)` for anything tube-like (arms, legs, necks, tails, fingers, horns, branches),
  `k.smooth` with 6-10 points for torsos and heads, `k.blob` for soft lumps. Keep each body part on its own layer so
  `shade` reads it as its own form.
- **Hands and feet**: simplify to mittens (one shape + a thumb) at mascot scale; they are small and draw attention if
  fussy. Feet are ovals or rounded wedges pointing where the character is going.

## 4. Curves: why programmer art looks programmed

Programmer art has three tells: **straight lines where nature curves, perfect symmetry, and even spacing.**

- Build organic shapes from **few control points** through `k.smooth` (6-10 for a body, 3-4 for a leaf or a hair
  lock). More points make wobbly, lumpy curves; fewer make smooth, confident ones.
- **Straight against curve**: give a limb or body a straighter side and a curved side (the back of a leg is curved,
  the shin is straighter). Two curved sides bulge like a sausage; two straight sides look like a pipe.
- **C and S curves**, not zigzags. Long curves with a clear direction; tight curves only where something bends.
- **Asymmetry**: offset each mirrored pair a little (one side of the body bulges more, one leaf is longer). Perfect
  mirror symmetry belongs to manufactured objects only.
- **Tangents**: never let two edges just touch (graphic-design.md section 11). Overlap clearly or separate clearly.

## 5. Line art: weight, taper, where to put lines

Constant-width strokes are the most common reason code-drawn art looks technical. Ink lines **swell and taper**.

- `k.stroke(pts, width, { taper })` draws a filled brush stroke along a smooth curve: thin at the ends, full in the
  middle. Width can be a number, `[start, end]` or a function of `t` (0..1 along the stroke), e.g. a path that
  narrows into the distance: `t => 90 * (1 - t) ** 1.6 + 4`. Use it for hair locks, grass blades, fur tufts,
  whiskers, brows, cloth folds, motion lines, leaves (a leaf is a stroke with a fat middle), and line art.
- **Weight hierarchy**: outer silhouette thickest (asset `outline`), lines where one part overlaps another medium,
  interior detail lines (folds, creases) thinnest and tapered at both ends. On the light side lines get thinner, on
  the shadow side and under things (where weight rests) thicker.
- **Not everything gets a line**: draw a line where a silhouette overlaps another shape or where two similar values
  meet. Inside one surface, let value changes do the work.
- **Coloured line**: `outline: { color: 'auto' }` (a dark, hue-shifted version of the colour it borders) looks more
  finished than black. Lines in the background are lighter, thinner or absent (atmosphere eats lines too).
- Keep a stroke's width below the bend radius of its curve; a fat stroke around a tight bend folds over itself.

## 6. Faces and expression

The face is the focal point of almost every character illustration; viewers look at faces first (the attention map
does not know this, so check it yourself).

- **Placement**: for a cute character put the eye line low (55-65% down the head) with a big forehead; eyes about
  one eye-width apart; a small mouth close under the eyes. Lower eyes and a smaller mouth read younger and cuter.
- `k.eye(cx, cy, r, { style, look, lid, tilt })`: `bean` (dark oval + two catchlights: cute, reads at 48 px) or
  `full` (white, iris, pupil, lid line, lid shadow). Catchlights go on the light side, the **same side in both eyes**.
  `look` moves the gaze: characters should look **into the picture** or at the thing that matters, never off-frame
  without a reason.
- **Brows carry most of the emotion** (`k.brow(cx, cy, w, { angle, arch })`): inner ends up = worried, sad, pleading;
  inner ends down = angry, determined; both raised and arched = surprised, curious; one up = sceptical.
- **Lids**: `lid: 0.3-0.5` = sleepy, smug, bored; a tilted lid edge (`tilt`) sharpens anger or sadness.
- `k.mouth(cx, cy, w, mood)`: `smile`, `grin`, `open`, `o`, `flat`, `frown`, `smirk`, `wavy` (nervous), `cat`.
- **Push the expression**: the face should read at thumbnail size. A half-hearted expression reads as blank.
- **Blush and cheeks**: opaque light pink, not a transparent pink over a green or blue skin (complements mix to mud).
- Draw the face on the `front` stage (or as the last main layer without `shade`) so form shading does not shift
  its colours.

## 7. Light: a designed light plan, not a filter

Decide the lights before drawing and write them in the brief:

- **Key light**: one direction for every form in the picture (`light`). If a lantern, fire or window is in the
  scene, it is the key: put `light` toward it, and make its source the lightest value in the picture.
- **Ambient / fill**: the colour of the shadows, usually the sky (cool outdoors) or the room. Shadows take this colour,
  never plain black: `shade` hue-shifts toward `shadowHue`; for a coloured light set `lightHue`.
- **Rim light**: a second light from behind on the shadow-side edge separates a character from a dark background
  (`shade: { rim: 0.5, rimColor: skyColour, rimWidth: 7 }`).
- **Cast shadows**: point AWAY from the key light, have the shape of the thing casting them, and get softer with
  distance. Draw the ground shadow as its own shape (an ellipse offset away from the light, blurred).
- **Contact / occlusion shadows**: the darkest, sharpest shadow is where things touch (feet on the ground, an arm
  against the body: `cast` on the upper layer). Without them, characters float.
- **Bounce light**: the shadow side facing a coloured ground picks up a little of its colour.
- **Light pools**: the key light brightens what is near it. A radial glow on the `post` stage with blend `screen`
  (`k.bg.glowAt(x, y, r, warm, 0.5)`) lights everything around the source, characters included.
- **Light leads the eye**: the brightest value next to the darkest value is the first read. Put the hero's lit face
  against the darkest background shape (a tree, a doorway, a shadowed wall) on purpose.

## 8. Colour in a scene: local colour, light colour, grade

- **Local colour** is what a thing is (a green body, a red scarf). **Light colour** is what the light does to it
  (warm where the lantern hits, cool in the sky's shadow). Draw flats in local colour; let `shade`, the light pool
  and the grade add the light colour. Mixing the two in your flats gives inconsistent light.
- **Limited palette**: 3-6 hues in the whole picture, each as a ramp (`k.c.ramp`). `k.c.scheme(hero, type, { mood })`
  gives a 60-30-10 role palette: the environment takes the dominant role, the hero the secondary, one accent (the
  light source, the treasure, the title) the 10%.
- **Hero against the environment**: the hero's hue near the complement of the dominant environment hue, and a value
  step away from what is directly behind it (the `separation` and `figure hue` checks measure this).
- **Saturation is focus**: the most saturated colour goes on the focal point or the key light. Big background areas
  are calmer (lower chroma) and planes further back calmer still (`k.c.atmos(c, depth, haze)`).
- **Colour grade** (the finishing pass that makes a scene feel like one place): a gradient from the light's
  temperature to the shadow's temperature over the whole picture on the `post` stage with blend `soft-light` or
  `overlay` (`k.bg.grade(warm, cool, 0.4, angle)`). Warm light / cool shadow is the classic pair; reverse it for
  moonlight or underwater.

## 9. Space and depth: planes, ground perspective, overlap

- **Three to five planes**: sky, far, mid, near, foreground. Each step back: smaller, lower contrast, lower chroma,
  closer to the haze colour, fewer details, thinner or no lines. `k.c.atmos(colour, depth, haze)` per plane and
  `k.bg.haze(y0, y1, colour, op)` between planes.
- **Ground perspective**: on a ground plane, things further away stand higher on the screen and are smaller.
  `k.persp(y, horizon, refY)` returns the scale of an object whose base is at screen height `y`; scatter trees,
  rocks or crowds with it and the scene gets a coherent ground plane for free.
- **Ground as functions**: write each hill as `y = f(x)` (a few summed sines and bumps) and build its path by
  sampling; then stand characters and trees exactly ON it (`f(x)`), no floating, no buried feet.
- **Overlap beats everything**: a foreground plant cropped by the frame, a character in front of a tree, a path that
  disappears over a crest and reappears further on (two strokes: the near one clipped to the near hill). Each overlap
  is a depth cue.
- **Foreground framing**: a dark, simple, out-of-focus shape cropped by the bottom corners (grass, rocks, leaves)
  frames the scene and pushes everything else back. Keep it low in detail and dark so it never competes.
- **Leading lines**: paths, rivers, fences, the character's gaze and pointing limbs lead the eye along the reading
  order. Point them at the focal point or from it to the second read.

## 10. Nature at scale: scatter, clusters, variation

Uniform randomness looks like noise and a grid looks like wallpaper. Nature is **clustered, varied and sorted**:

- `k.scatter({ x, y, w, h, n, gap, seed, scale, rot, inside })` places points with a minimum spacing (Poisson-disc:
  no overlaps, no grid), sizes leaning small (few big, many small), random rotation, and returns them sorted by y so
  nearer items overlap farther ones. `inside(x, y)` keeps them in a region (above the ground, outside the hero's
  face).
- **Big-medium-small**: one large, a few medium, many small, in groups of odd numbers. Leave empty areas: rest areas
  make the busy areas read.
- **Variation within a range**: size, angle (plus or minus 10-20 degrees), lean, hue and value (a few percent). Larger
  variation reads as chaos.
- **Build from a few parametric parts**: a grass tuft is three tapered strokes leaning one way; a pine is stacked
  rounded triangles; a cloud is a flat-bottomed `k.cloud`; a rock is a `k.roundPoly` with `form: 'flat'` faces; a
  bush is overlapping `k.blob`s. Vary the parameters per instance with `k.rng(seed)` so every one is different but
  every render is the same.
- **Wind is shared**: grass, hair, scarves, smoke and flags lean the same way.

## 11. Texture and finish

- **Grain**: `k.bg.grain(op)` on a `post` layer with blend `overlay` takes the digital flatness off large gradients.
  Keep it subtle (0.08-0.2) and leave it off icons shown small.
- **Rough edges**: `filter: k.roughF(amount, freq)` on a `<g>` displaces edges by smooth noise for a hand-cut or
  painted look (paper craft, storybook foliage). 1-4 px at 512; more looks broken.
- **Vignette**: `k.bg.vignette(op, colour)` on `post` darkens the corners and holds the eye inside the picture.
- **Glow** on light sources only (`glow` on the lantern, fireflies, magic); a glow on everything flattens it.
- **Detail density**: highest around the focal point, falling off toward the edges. Detail is a spotlight.

## 12. Failure modes: symptom, cause, fix

| Symptom | Cause | Fix |
|---|---|---|
| Stiff, mannequin character | vertical body, symmetric pose, twinned limbs | line of action, lean, contrapposto, vary the two arms (`k.fk` angles) |
| Looks like clip art / vector stock | constant-width lines, perfect symmetry, even spacing | `k.stroke` with taper, offset mirrored parts, `k.scatter` |
| Character floats | no contact shadow, feet not on the ground line | stand on `f(x)`, dark contact ellipse under the feet, `cast` |
| Flat, sticker-on-background | one light on the hero, another (or none) on the scene | one `light`, shadows away from it, grade on `post`, light pool |
| Muddy colours | transparent complements mixed, too many hues, black shadows | opaque accents, 3-6 hues, hue-shifted shadows |
| Hero gets lost | same value as what is behind it | darkest shape behind the lightest, rim light, glow pool, `separation` check |
| Busy, no focal point | detail and saturation everywhere | simplify the background, calm its chroma, detail only at the focal point |
| Scene has no depth | planes same contrast and saturation, no overlap | `k.c.atmos` per plane, haze bands, overlap, cropped foreground |
| Wallpaper nature | grid placement, equal sizes | Poisson scatter, big-medium-small groups, empty rest areas |
| Path / river looks pasted on | flat wedge with no perspective | width narrowing with distance, hidden behind crests, lower contrast far away |
| Face reads blank | expression too subtle, eyes looking nowhere | push brows and mouth, gaze into the picture, catchlights on the light side |

## 13. Checklist before you call it done

- Silhouette view: the pose and the character read in solid black.
- Greyscale view: three value groups, the focal point has the strongest light-dark contrast.
- Squint view: the first blob the eye finds is the hero (or what the brief says).
- At display size (512 or less): the face and the expression still read.
- One key light: every shadow falls the same way, contact shadows everywhere things touch.
- 3-6 hues, the most saturated on the focal point or the light source.
- Each plane further back is hazier, smaller and lower in contrast.
- No tangents, no twins, no grid-placed nature.
- Mirror test: flip the picture (`k.flipX` on the whole thing, or look at the reversed render): errors in proportion
  and balance you stopped seeing jump out again.
- The story is clear: what is happening, and how the character feels about it.

---

## Sources

- Construction, line of action, gesture: Preston Blair, *Cartoon Animation* (1994); Michael D. Mattesi, *Force:
  Dynamic Life Drawing* (2006).
- Light and colour in scenes: James Gurney, *Color and Light* (2010); Marco Bucci's light-and-shadow lessons.
- Shape design and appeal, straights against curves: Stephen Silver, *The Silver Way* (2017).
- Poisson-disc sampling: Robert Bridson, "Fast Poisson Disk Sampling in Arbitrary Dimensions" (SIGGRAPH 2007).
