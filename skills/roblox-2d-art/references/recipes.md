# Recipes: how to build common Roblox images

Each recipe lists the layers (bottom to top), the effects and the pitfalls. Examples in `examples/` implement most
of them; copy the closest one.

## Contents
- Building blocks (the drawing order that works)
- Item icons: food, weapons, potions, gems and currency, chests, tools, armour, pets
- Composed images: start from the brief
- Game icon
- Thumbnail
- Banner
- Badges, passes, products
- UI: glyphs, 9-slice frames and buttons, progress bars, rarity cards
- Logos and title text
- Textures and decals
- Particles and flipbooks
- Turning a reference into art (trace, palette, simplify)
- Finishing AI images, renders and screenshots (`post`)

## Building blocks

1. **Blocking**: one layer per part that has its own form (bun, patty, cheese...). Flat base colours only. Build and
   look at the silhouette and the 48 px preview before adding anything else: most problems are visible already.
2. **Shading**: `shade` on each part (toon for cartoon, gloss for shiny). Same `light` for everything.
3. **Contact**: `cast` on parts that sit on top of others.
4. **Details**: clipped layers (`clip: 'part'`) for markings, seams, seeds, stripes: they never spill outside.
5. **Line**: asset `outline` (thick, around everything). Thin per-layer `outline` only where two parts of similar
   value touch.
6. **Accents**: glints and sparkles on stage `front`; drop `shadow` under the whole object. Front layers get no
   outline: a white accent (steam, sparkle) placed off the object vanishes on light backgrounds, so give it a thin
   layer `outline` or a darker colour, or keep it on `main` so the asset outline wraps it.
7. **Ground shadow**: a soft ellipse (`k.groundShadow`, opacity under 0.5) as the first `main` layer moves with
   `fit` and is not outlined (outlines only wrap pixels above 50% opacity).

## Item icons (kind `item`, 512, transparent)

- **Food**: rounded shapes, warm saturated colours, `toon` with `depth` small for flat layers (cheese, lettuce:
  12-30) and default for round ones (bun). Stack with `cast`. Show the cross-section that identifies it (burger
  layers, pizza slice with toppings, sushi from the side). Exaggerate the toppings.
- **Weapons**: draw vertical, rotate 45° (`<g transform="rotate(45 256 256)">`) so the length uses the diagonal.
  Blade `metal` with `form: 'cyl-y'`, a fuller (darker groove) `clip`ped to the blade; guard and pommel gold
  `toon`/`gloss`; grip with 2-3 wrap lines. Thick guard, short grip: proportions read better pushed.
- **Potions / bottles**: glass = light tinted fill with `gloss` and low `shadow` (0.3); liquid `clip: 'glass'` with
  a wavy top; cork `toon`; long white glint streak on top (no outline). Round flask = health, tall = mana, square =
  utility.
- **Gems and currency**: `k.gem` (faceted, no shade needed) + sparkles on `front`; `k.coin` + `gloss`. Stacks of coins
  for "lots": 3-6 coins overlapping, slightly rotated.
- **Chests / crates / boxes** (flat faces): draw the front face and the top face as separate layers;
  `shade: { form: 'flat', face: 0.3 }` on top, `face: -0.1` on front, `face: -0.45` on a visible side; metal bands
  `clip`ped; dark gap under the lid.
- **Tools** (pickaxe, axe, hammer): head big, handle long and thin but at least ~6% of the canvas wide so it
  survives 48 px.
- **Pets / creatures**: big head (50-60% of the height), big eyes low on the face, small body; `gloss` for slime or
  plastic toys, `toon` for fur; a face layer on top without shading.

Set rules: same `light`, `outline`, `shadow`, `fit` for the whole set (put them in `set:`), and read the set checks.

## Composed images: start from the brief

Thumbnails, banners, game icons, badges, passes and logos start with the design brief in `graphic-design.md`
(section 13): message, reading order, layout template, value plan, colour scheme and roles, words and type sizes,
depth planes. Then build the colours from the hero: `const S = k.c.scheme(heroColour, 'split', { mood: 'bright' })`
and use `S.bg` / `S.bgLight` / `S.bgDeep` for the ~60% background, `S.secondary` for the ~30% ground and big props,
`S.accent` for the ~10% title fill, coins and sparkles, `S.ink` for outlines. Mark the hero's layers `role: 'hero'`.
Read the design checks and the composition row of the review sheet, then the critique checklist (section 14).

## Game icon (kind `game-icon`, 512, opaque)

Layers: background (stage `back`: `k.bg.radial` in `S.bgLight` → `S.bg`, soft `k.bg.rays`, `k.bg.glowAt` behind the
face, `k.bg.vignette`), the hero (mascot / object) at 60-85% of the canvas, three-quarter view, an expression or
action, `role: 'hero'`; 1-3 secondary props at a third of the hero's size or less, partly behind it, lower contrast
(odd numbers, different sizes). Two equal props behind the shoulders read as ears at 64 px: prefer one clear prop, or
three at clearly different sizes. Background hue complementary or split-complementary to the hero. Quiet corners. No
text, or one short word if it is the brand and big. Check: 150 and 64 px previews on both themes, `focal point`,
`hierarchy` (props must not rival the hero), `figure hue`. Make 2-3 variants with different heroes / angles for A/B tests.

## Thumbnail (kind `thumbnail`, 1920x1080, opaque)

Pick a template from `graphic-design.md` section 12 (hero + title, centred icon, versus, gameplay scene). The default:
- **back**: sky gradient in the dominant colour, a few soft rays or none, far hills / buildings pushed back with
  `k.c.atmos(colour, depth, sky)` or `k.bg.haze`, `k.bg.glowAt` behind the hero, a vignette.
- **main**: the ground in the secondary colour (a value step away from the hero, never the hero's hue and value);
  the hero (`role: 'hero'`) on a thirds line (`k.at('tl', 1920, 1080)`), 55-75% of the frame height, looking into the
  frame; 3-5 props on a leading line toward the hero, getting smaller with distance and deeper in value than the title
  fill. Bright, large props become a second focal point: the `hierarchy` check names them when they do.
- **front**: the title as one block inside `k.safe()` on the side the hero faces: 2-3 words in one display face
  (`Luckiest Guy`, `Lilita One`, `Fredoka One`), font size 160-240, gradient fill (`S.light` → `S.accent`), dark
  outline 12-18% of the size (`S.ink`), a light outer rim, -3° to -6° rotation; an optional hook line one step down the
  type scale (`k.typeScale(96, 1.5)`: 96 / 144 / 216) and at least ~86 px.
- Or start from a Studio screenshot: `k.image('shot.png', 0, 0, 1920, 1080)` on stage back, graded with haze and a
  vignette, then the hero cut-out larger in front and the title.
Nothing important in the bottom 12%. Show real gameplay elements. Each variant should show a different hook.

## Banner (kind `banner`, wide, menu / loading / promo)

A text column on one side (about 40% of the width) and the hero on the other, three depth planes behind, one dominant
colour family. If it is displayed with `ScaleType.Crop`, keep everything important inside the central 75% x 75%
(phones and tablets cut different sides). Loading screens: leave a calm band for the progress bar. Example:
`examples/banner.art.mjs` (kicker + two-line title in a type-scale step, hero on the right thirds line with a
glowing prop clearly behind its shoulder, hazed far layers, dark foreground rocks cropped by the corners).

## Badges, passes, products (512, circle crop)

Background `k.bg.rarity(...)` (or radial) in a hue that contrasts with the subject (a gold trophy on deep blue or
violet, not on gold: the `figure hue` check catches camouflage), subject inside the middle ~70%, symmetric, optional
`k.frame.circle()` on front so the crop edge looks intentional. Passes: the perk as an object (crown = VIP, x2 coin =
double money, speed boots), plus one short label in the lower third only if it reads at 150 px. Check: `circle crop`,
`saturation` (the subject should be the most saturated thing).

## UI

- **Glyphs** (kind `ui-icon`, 256): thick strokes (≥ 18 px at 256), 1-2 colours, `toon` or flat; `export: { white:
  true }` gives a white copy for `ImageColor3` tinting (one asset, many colours).
- **9-slice frames and buttons** (kind `panel`): draw small (64-128 px) with the corner radius inside the corner
  insets; everything between the corners must be constant along the stretch direction (no gradients across the
  stretch band, no centred details). `slice: [l, t, r, b]`; the check verifies the bands; the review stretches it.
  Buttons: a darker bottom lip (pressed-depth), a light top highlight strip, both full-width.
- **Progress bars**: a 9-slice track + a 9-slice fill (same insets), scale the fill's width in code.
- **Rarity cards**: kind `item` with stage back `k.bg.rarity(r)` + `k.frame.card()` on front, the item in main.

## Logos and title text (kind `logo`)

Text with `k.text`: `size` big, `fill` gradient (light top to saturated bottom), `stroke` dark (`sw` ~16% of size),
`outer` light outline, `shadow` 6-10% of size, `shine: 0.35`. Add a shape behind (ribbon `k.ribbon`, burst
`k.burst`) on stage back or main. Arc the text slightly (`arc: 20`) for energy. Lockup: the main word biggest, other
words 0.4-0.65x its size, stacked and centred as one block, one typeface, the same outline and shadow on every word,
fill contrast at least 3:1 against the outline (`text contrast` check).

## Textures and decals (kind `texture`)

Seamless: base colour rect + `k.tile(details)` (details drawn anywhere, wrapped at the edges), `tile: true` for the
seam check and the 3x3 preview. Avoid one big unique blotch (repeats become obvious). Value range low on purpose:
textures sit behind gameplay.

## Particles and flipbooks (kind `particle`)

White or greyscale with soft edges (`k.blurF`), centred, transparent. Animated: `frames: { count: 16, layout:
'flipbook' }` and drive size / opacity with `ctx.t`. 4x4 at 1024 = 256 px frames; 8x8 at 1024 = 128 px frames.

Flipbook rules that decide whether it looks right in game:
- The sheet is always 1024 x 1024 (Roblox plays nothing on other sizes); frames read left to right, top to bottom.
- `OneShot` spreads the frames over each particle's lifetime (16 frames on a 0.6 s particle is 27 fps; on 2 s it is
  8 fps and choppy). `Loop` / `PingPong` use `FlipbookFramerate`, at most 30.
- A loop must close: draw on a periodic time axis so the frame after the last equals the first (`count` covers one
  cycle; t = 1 is not drawn). A one-shot must end on an empty frame, so nothing pops.
- Break shapes up as they die (alpha erosion: raise a threshold through noise so thin parts vanish first) instead of
  fading the whole sprite.
- Keep frames white and let `ParticleEmitter.Color` tint them; let the frames change the shape and the emitter move it.
- Procedural effect sprites (water splash crowns, ripples, churning foam, mist, smoke puffs, breaking wave crests) and
  seamless flowing textures for beams come ready-made from the `roblox-vfx` skill, previewed inside the effect; draw
  here when the sprite needs a designed, stylised shape (a cartoon star burst, a logo, a hand-drawn smoke style).

## Turning a reference into art

1. `rart refs "<object>"` and look at the contact sheet. Pick: 1-2 emoji/icon references (how others simplified it),
   1-2 photos (the real proportions, colours, details).
2. `rart trace <photo> --colors 6` gives the silhouette as a path (fitted into your canvas) and the colour regions.
   Look at `-overlay.png`. Use the numbers (aspect, where the widest point is, part heights) or use the path itself
   as the base layer and simplify (`--detail 3` = fewer points, chunkier).
3. `rart palette <photo>` gives the real colours with ramps. Push them for game art: more saturation, brighter
   lights, shadows hue-shifted.
4. Write the spec using the measured proportions; put the reference in `refs` so the review sheet shows them side by
   side; compare and adjust.
5. Never trace or copy another game's or brand's art, logo or characters. References are for measuring real objects
   and learning how they are usually simplified.

## Finishing AI images, renders and screenshots (`post`)

`rart post render.png --kind item --key --outline 14 --shadow --fit` removes a plain background (flood from the
border), centres and pads the object, adds the outline and shadow, alpha-bleeds, exports the sizes and writes the
review sheet. `--pixel 32 --palette sweetie16` turns it into pixel art. For thumbnails from Studio screenshots,
prefer a spec with `k.image()` so you can add title text and characters.
