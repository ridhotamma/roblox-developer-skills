# Art theory for 2D game assets

What makes a game image read instantly, look finished and sit well next to its siblings. Each section ends with how
the engine supports it. Sources are listed at the end.

## Contents
1. Readability first: silhouette, size, detail budget
2. Shape language
3. Value (light and dark) before colour
4. Colour: palettes, hue shifting, saturation, harmony
5. Light and form: how to shade
6. Materials cheat sheet
7. Line work: outlines and line weight
8. Composition (icons, thumbnails, badges)
9. Consistency across a set
10. Style choice

---

## 1. Readability first

- **Silhouette is the most important property of an icon**, above colour. Test: fill it solid black. If you can
  still tell sword from axe from potion, the set works. Pick the angle that shows the most characteristic outline
  (a sword diagonally, a mug from the side with the handle visible, a car in 3/4 or side view, never head-on).
- **Design large, check small.** Draw at 512 (or 1024), then look at 64, 48 and 32 px. Anything that turns into
  mush gets removed or exaggerated. Roblox shows the game icon at ~150 px, badges and passes at 150 px, inventory
  icons often at 48-80 px.
- **Detail budget.** One clear idea per icon. Three to five big shapes, a few medium ones, small details only
  where the eye should go (the face, the gem, the label). Thin lines, tiny text and noisy textures vanish when small.
- **Exaggerate what identifies the object**: bigger handle on a mug, bigger seeds on a bun, chunkier guard on a
  sword. Stylised proportions read better than real ones (measure the real thing first, then push it).
- Leave **space between shapes**; touching shapes of similar value merge into a blob.

Engine: `review-*.png` shows the silhouette test, real display sizes and a squint (blur) test; the `small size`
check counts interior clutter at the smallest preview size; `fill` checks how much of the canvas the subject uses.

## 2. Shape language

Shapes carry emotion before anything else is read:

| Shape | Reads as | Use for |
|---|---|---|
| Circles, blobs, rounded corners | friendly, soft, safe, cute | mascots, pets, food, currency, casual / simulator games |
| Squares, thick rectangles | stable, strong, reliable | shields, crates, buildings, tanks, UI frames |
| Triangles, spikes, sharp points | danger, speed, aggression, magic | weapons, enemies, fire, lightning, "rare" items |

Mix them with one dominant shape. Vary sizes (big-medium-small) instead of repeating equal pieces. Avoid perfectly
symmetric, evenly spaced arrangements unless the object is manufactured.

Engine: `k.smooth` (organic curves through points), `k.blob`, `k.roundPoly` (chunky "toy" polygons), `k.star`,
`k.burst`, `k.capsule`, `k.rrect`, `k.shield`, `k.heart`, `k.drop`, `k.bolt`, `k.cloud`, `k.flame`.

## 3. Value before colour

The light-dark pattern is what the eye reads first and what survives at small sizes and in greyscale.

- Give each icon a **full value range**: darkest darks (outline, core shadow) to lightest lights (highlight, glint).
  OKLab lightness spread of roughly 0.35+ inside the subject reads well.
- **Separate the subject from its background by value**, not just hue: a mid-tone subject on a mid-tone background
  of a different hue still melts together at 64 px.
- Group values: the lit side in a narrow band of light values, the shadow side in a narrow band of dark values.
  Mixing light and dark values everywhere makes noise.

Engine: the `value range` and `separation` checks; the review sheet's greyscale view.

## 4. Colour

- **Hue shifting** (the core pixel-art and illustration trick): do not darken with black or lighten with white.
  Shadows move toward cool hues (blue / violet) and get a little more saturated; highlights move toward warm hues
  (yellow) and get less saturated. Slynyrd's ramps shift hue up to ~20° per step, brightness rising steadily, saturation
  peaking mid-ramp. Avoid high saturation together with high brightness ("the biggest mistake"), and ramps with no hue
  shift (they look flat).
- **Saturation as a focus tool**: the most saturated colour in the image is where the eye goes. Keep backgrounds
  less saturated than the subject (or much darker / lighter).
- **Palette size**: an icon set lives on a small shared palette (5-8 hues, each a 3-5 step ramp). Re-use ramps
  across icons so the set feels like one game.
- **Harmony for backgrounds and store art**: complementary (opposite hues: orange coin on blue rays) gives maximum
  pop; analogous (neighbours) feels calm. Bright, saturated colours suit cheerful / fantasy games; muted, low
  saturation suits somber ones; heavy contrast suits horror (Roblox docs give the same guidance for icons).
- **Rarity colours** are a shared language in Roblox games: common grey, uncommon green, rare blue, epic purple,
  legendary gold/orange, mythic red/pink. Back colour with shape (frame style, rays, sparkles) for colour-blind players.

Engine: `k.c.ramp(hex, 5)`, `k.c.shade(hex, t)` (t -1..1, hue shifted), `k.c.ink(hex)`, `k.c.mix`, `k.c.harmony`,
`k.c.RARITY`, the automatic `shade` effect (shifts every pixel along its own ramp), `rart palette <image>`.

## 5. Light and form

Pick **one light direction for the whole game** (top-left is the convention: `light: 'tl'`) and never mix.

The anatomy of a lit form, in the order an artist adds it:
1. **Base colour** (local colour): the largest area. Toon art keeps roughly 55-65% of a part in base colour.
2. **Form (core) shadow**: the side turned away from the light, about a quarter to a third of the part.
3. **Highlight band**: the area facing the light, a thin band.
4. **Specular glint**: a small, crisp white shape on shiny materials, near the highlight band.
5. **Cast shadow / contact shadow**: where one part sits on another (a crossguard on a blade, a patty under a bun).
   This is what makes stacked parts feel attached instead of pasted on.
6. **Rim / back light**: a thin light line on the shadow-side edge; separates dark objects from dark backgrounds.
7. **Ground shadow / drop shadow**: anchors the object on the canvas.

Avoid **pillow shading** (lightening every edge inward toward the centre regardless of the light): it flattens the
form. Flat faces (box sides) get one tone each, curved surfaces get a gradient or bands.

Engine: `shade` effect per layer: `toon` (2-3 flat bands, area-balanced, glint), `soft` (smooth gradient), `gloss`
(smooth + crisp specular + rim: candy, plastic, slime), `metal` (sharp horizon reflection), `flat`. Forms: `round`
(inflated, no pillow artefacts), `cyl-x` / `cyl-y` (tubes), `flat` with `face` (box faces: top +0.3, side -0.45).
`cast` on a layer drops its shadow onto the layers below; `shadow` / `glow` under the whole subject.

## 6. Materials cheat sheet

| Material | Contrast | Highlight | Shading recipe |
|---|---|---|---|
| Matte (cloth, wood, bread, skin) | low-medium | broad, soft, no glint | `toon` or `soft`, spec 0-0.2 |
| Plastic, candy, slime, toys | medium | crisp white glint + rim | `gloss` |
| Polished metal (blades, armour) | very high | sharp horizon line, bright sky above, dark below | `metal`, `form: 'cyl-y'` for blades |
| Gold | high, warm | yellow-white glint, orange-brown shadows | `gloss` on `#f0b43c`-ish, or `toon` + glint |
| Glass | low fill, strong edges | long white streaks, visible inside | light tinted fill, `gloss` with low shadow, liquid layer `clip`ped inside, white streaks on top |
| Gems | extreme | facets: each face a flat tone from a 5-step ramp | `k.gem`, sparkles on stage `front` |
| Organic (fruit, slime) | medium | soft glint, subsurface warmth in shadows | `gloss` or `toon` with a warmer `shadowHue` (e.g. 20 for reds) |
| Fire / energy | inverted: core brightest | no outline or a coloured one | layered flames light-to-dark outward, `glow` |

## 7. Line work

- A **dark outer outline** around the whole silhouette is the single biggest readability boost for game icons on
  busy backgrounds. Make it **thicker than interior lines** (line-weight hierarchy): outer ~2.5-3% of the canvas
  (12-16 px at 512), interior separations ~1% or none (value changes separate parts).
- **Coloured outlines** (a dark, hue-shifted version of the colour they border) look more polished than pure black.
  Pure black suits bold cartoon styles; light outlines suit dark UIs.
- An outline must be darker than both the object and the background behind it. For dark UI backgrounds add a second,
  light outer rim (`outline: [{width: 14, color: 'auto'}, {width: 4, color: '#ffffff'}]`).
- Keep line width constant across a set (same canvas size, same `outline.width`).

Engine: `outline` (distance-field based: perfectly even, round, around the union of parts), `innerLine` per layer,
SVG strokes for interior detail lines.

## 8. Composition

**Icons**: one subject, centred on its optical centre (slightly above the geometric centre when there is a drop
shadow), filling ~80-90% of the canvas; diagonal placement for long objects (more length, more dynamism);
nothing important in corners. Text is rarely readable at icon size.

**Game icon** (512, shown ~150): the game's promise in one image: the mascot or hero object, big, with a strong
expression or action, on a simple high-contrast background (radial glow + rays is the classic). Must stand out on
both Roblox themes and among neighbouring icons. No small text, no corner symbols (Roblox lists a graphic in the corner
as an error example).

**Thumbnail** (1920x1080): show what players actually get (Roblox rejects misleading media), one focal point,
characters with readable faces/actions, foreground-midground-background depth, title text big and short (2-3
words), away from the bottom edge (player count bar). Different thumbnails should show different motivations
(combat, collecting, social) so personalisation testing can tell them apart.

**Badges / passes / products**: designed inside a circle (Roblox crops to it): subject in the middle ~70%,
background can bleed to the corners.

General: rule of thirds for wide formats, leading lines toward the subject, contrast highest at the focal point.

## 9. Consistency across a set

Same canvas size and padding (`fit`), same light direction, same outline weight and colour logic, same shading
style, shared palette ramps, similar visual weight (a sword icon should not look half the size of a shield icon).
Build sets in one spec with `set:` defaults and read `review-set.png` plus the set consistency checks.

## 10. Style choice

| Style | Looks like | Engine settings |
|---|---|---|
| Cartoon / toon (Roblox default) | flat colours, 2-3 bands, dark outline, glint | `shade: 'toon'`, `outline: 14` |
| Glossy simulator | smooth gradients, big glints, rim light, rays | `shade: 'gloss'`, `outline: 12-16`, rarity backgrounds |
| Flat / minimal UI | no shading or one shadow tone, crisp shapes | `shade: false` or `k.cel`, small or no outline |
| Pixel art | grid, limited palette, 1 px outline | `pixel: { size: 32, palette }` or `pixels` |
| Sticker / badge | thick white outer rim + dark outline | `outline: [{width:10,color:'auto'},{width:16,color:'#fff'}]` |
| Painterly / realistic | soft lighting, texture, detail | beyond vector drawing: generate with an image model, then `rart post` to finish it |

Match the game: look at existing UI and assets in the project first, and continue their style.

---

## Sources

- Icon readability (silhouette test, design large / check small, detail and stroke rules): https://gamineai.com/blog/creating-game-icons-and-logos-design-principles-game-branding , https://mobilegamer.biz/how-to-make-an-iconic-icon/ , https://uxdesign.cc/7-principles-of-icon-design-e7187539e4a2
- Pixel art anti-aliasing: https://pixelparmesan.com/anti-aliasing-fundamentals-for-pixel-artists
- Outlines with colour, selective outlining: https://lospec.com/articles/pixel-art-outlines-part-2-using-color
- Colour ramps and hue shifting: https://www.slynyrd.com/blog/2018/1/10/pixelblog-1-color-palettes
- Roblox icon / thumbnail guidance: https://create.roblox.com/docs/production/publishing/experience-icons , https://create.roblox.com/docs/production/publishing/thumbnails , https://devforum.roblox.com/t/5-tips-from-roblox-staff-to-get-the-most-out-of-thumbnail-personalization/3471689
