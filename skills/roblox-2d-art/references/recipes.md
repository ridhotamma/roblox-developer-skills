# Recipes: how to build common Roblox images

Each recipe lists the layers (bottom to top), the effects and the pitfalls. Examples in `examples/` implement most
of them; copy the closest one.

## Contents
- Building blocks (the drawing order that works)
- Item icons: food, weapons, potions, gems and currency, chests, tools, armour, pets
- Game icon
- Thumbnail
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

## Game icon (kind `game-icon`, 512, opaque)

Layers: background (stage `back`: `k.bg.radial` + `k.bg.rays` + `k.bg.vignette`), the hero (mascot / object) huge,
overlapping the frame slightly, an expression or action, 1-3 secondary props (coins, gems) smaller. Complementary
background hue. No text, or one short word if it is the brand and big. Check: 150 and 64 px previews on both themes,
`separation`. Make 2-3 variants with different heroes / angles for A/B tests.

## Thumbnail (kind `thumbnail`, 1920x1080, opaque)

Layers: sky / environment (back), midground props (back, shaded), the hero characters (main), title text and badges
(front). Or start from a Studio screenshot: `k.image('shot.png', 0, 0, 1920, 1080)` on stage back, then add characters,
title and colour treatment. Keep the title in the top two thirds, 2-3 words, `Luckiest Guy` / `Lilita One` / `Fredoka
One`, gradient fill, thick dark outline plus a light outer outline, slight rotation (-4°). Nothing important in the
bottom 12%. Show real gameplay elements. Each variant should show a different hook.

## Badges, passes, products (512, circle crop)

Background `k.bg.rarity(...)` (or radial), subject inside the middle ~70%, optional `k.frame.circle()` on front so the
crop edge looks intentional. Passes: the perk as an object (crown = VIP, x2 coin = double money, speed boots), plus a
short label only if it reads at 150 px. Check: `circle crop`.

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
`k.burst`) on stage back or main. Arc the text slightly (`arc: 20`) for energy.

## Textures and decals (kind `texture`)

Seamless: base colour rect + `k.tile(details)` (details drawn anywhere, wrapped at the edges), `tile: true` for the
seam check and the 3x3 preview. Avoid one big unique blotch (repeats become obvious). Value range low on purpose:
textures sit behind gameplay.

## Particles and flipbooks (kind `particle`)

White or greyscale with soft edges (`k.blurF`), centred, transparent. Animated: `frames: { count: 16, layout:
'flipbook' }` and drive size / opacity with `ctx.t`. 4x4 at 1024 = 256 px frames; 8x8 at 1024 = 128 px frames.

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
