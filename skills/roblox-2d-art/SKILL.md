---
name: roblox-2d-art
description: Make 2D images for Roblox games - item and inventory icons, shop and reward icons, HUD / UI glyphs, game icons (512), thumbnails (1920x1080), badge, game pass and developer product icons (circle-cropped), logos and title text, 9-slice UI frames and buttons, pixel-art sprites, sprite sheets and animations, ParticleEmitter flipbook textures, and seamless decal / texture tiles. Composed images (thumbnails, banners, game icons, badges, logos) follow graphic design rules: a written design brief, one focal point and a 1-2-3 reading order, thirds / golden-section layout with margins, balance of visual weight, a 3-value plan, 60-30-10 colour roles from harmony schemes by mood, depth by atmospheric perspective and a modular type scale, checked by a composition analysis (where the eye lands first, competing focal points, balance, value plan, colour proportion and harmony, camouflage, text size, contrast and margins, tangents). Researches openly licensed references first (emoji and icon sets for how the object is usually simplified, Wikimedia / Openverse photos for real proportions and colours), traces silhouettes and palettes from them, then draws layered SVG art rendered by the local Chrome / Edge, with automatic toon / gloss / metal shading, hue-shifted colour ramps, even distance-field outlines, cast and drop shadows, pixel-art conversion, alpha bleeding, Roblox upload rule checks, readability checks and a review sheet showing the image at the sizes players see it plus its composition (grid, reading order, attention map, notan, colour wheel). Also finishes AI-generated images, renders and screenshots (background removal, outline, padding, sizes). Use this whenever the user wants any picture, icon, sprite, thumbnail, badge, pass icon, logo, UI image, decal, texture or PNG for a Roblox game, asks for "art" or "graphics" for an ImageLabel / ImageButton / ParticleEmitter / Decal, wants game store media, or says their icons look inconsistent, blurry, have black edges or are unreadable when small, or that a thumbnail, banner or icon looks cluttered, amateur, flat or gets no clicks, even if they never say "2D".
---

# Roblox 2D art (reference → measure → draw in layers → shade → check → look → export)

You draw game art as an **art spec**: a small JS module whose layers are SVG markup (you write the shapes, with a
drawing kit for the fiddly parts), plus effects the engine applies per layer (shading, outlines, shadows). The
engine (`scripts/rart.mjs`, Node 22+, no packages) renders each layer with the local Chrome / Edge / Chromium,
applies the effects on pixels, composites, exports Roblox-ready PNGs, runs checks and renders a review sheet.

Why this way: hand-written SVG alone looks flat and amateur, and image models are inconsistent across a set, can't
be edited part by part, and drift from the real object. Layered vector shapes + procedural shading gets the clean,
consistent, readable "Roblox simulator" look, editable forever, and the same light, outline and palette on every
icon. Quality comes from three habits: **look at references before drawing, check at the size players see it, and
look at every render before calling it done.**

## Workflow

1. **Pin down the request**: what images, which `kind` (table below), the style, how many, and where they appear.
   **Look at the game's existing art first** (asset folders, UI theme colours, fonts) and match it; the user's other
   icons are the style guide. For a clear request, start and state your assumptions.

2. **Learn the theory you need**: skim `references/art-theory.md` (silhouette, shape language, value, hue
   shifting, light, materials, line weight, set consistency) and the matching part of `references/recipes.md`.
   **For anything composed** (thumbnail, banner, game icon, badge, pass, product, logo, UI screen) also read
   `references/graphic-design.md`: hierarchy and the focal point, grids and margins, balance, Gestalt, eye flow,
   the value plan, colour roles and harmony, depth, typography, tangents, layout templates per kind. Those images
   live or die on composition, not on how well each part is drawn. For store media and UI,
   `references/roblox-specs.md` has the exact sizes and rules.

3. **Find references**: `node <skill>/scripts/rart.mjs refs "<object>" --out refs` (icons + photos; `--kind
   icons|photos`). **Look at `refs/contact-sheet.png`.** From the icons learn which features designers keep and how
   they block colour; from photos learn the real proportions and colours. Read
   `references/references-and-licences.md` before reusing anything directly. If nothing useful comes back, try
   synonyms, then say you are working from general knowledge.

4. **Measure**: `rart trace refs/refNN.jpg --colors 6` (silhouette path fitted to your canvas + flat colour regions;
   **look at the `-overlay.png`**) and `rart palette refs/refNN.jpg` (real colours with hue-shifted ramps). Write
   down the proportions you will keep and what you will exaggerate for readability.

5. **Plan before drawing** (a few lines): the silhouette and angle; the parts, one layer each, bottom to top; which
   parts are round / tube / flat-faced (that decides `shade` form); a palette of 3-6 base colours; light (top-left
   by default, same for the whole set); outline weight; what goes on stage `back` / `main` / `front`.
   **Composed images get a design brief first** (`graphic-design.md` section 13): the message in one sentence; the
   reading order (1 hero, 2 title, 3 support); the layout template with the hero's anchor and size (`k.at('tl')`,
   `k.safe()`); the value plan (which value dominates, where the strongest contrast is); the colour scheme and mood
   with a role per part (`k.c.scheme(hero, 'split', { mood: 'bright' })`: ~60% background, ~30% secondary, ~10%
   accent); the words and type sizes (`k.typeScale`); the depth planes. Mark the hero's layers `role: 'hero'`.

6. **Write the spec** `<name>.art.mjs` from the closest example (`examples/`): `items.art.mjs` (consistent icon set,
   clipping, cast shadows, metal, glass), `burger.art.mjs` (reference-traced proportions), `store.art.mjs` (game icon,
   thumbnail with title text, badge, pass, each with its design brief), `pixel.art.mjs` (converted, hand-placed and
   animated pixel art), `ui.art.mjs` (9-slice panel and button, tintable glyph, seamless texture, particle flipbook).
   Full field list: `references/spec-reference.md`.

7. **Build**: `node <skill>/scripts/rart.mjs build <name>.art.mjs --out out` (several assets build together and get
   a set review; `--only Name` for one).

8. **Read the checks** on stdout. Each FAIL needs a fix; each WARN needs a fix or a reason. They cover Roblox rules
   (size, aspect, opaque vs transparent, circle crop for badges / passes / products, thumbnail bottom band, 3 MB),
   cut-off edges, fill, value range, subject / background separation, clutter at the smallest display size,
   palette size, 9-slice stretch bands, seams, sprite-sheet size and set consistency. Composed images add design
   checks: focal point (which layer the eye lands on first), hierarchy (competing focal points), figure / ground,
   balance, value plan, colour proportion, accent, harmony, figure hue (camouflage), saturation, text size, word
   count, typefaces, type scale, text contrast, margins, tangents and kissing shapes. They are judgement calls with
   numbers: fix them, or say why the design breaks the rule on purpose.

9. **Look at `out/review-<name>.png`** (and `review-set.png`) with the Read tool. It shows the image on Roblox's dark
   and light themes, at real display sizes, as a silhouette, in greyscale, blurred (squint test), cropped to the
   circle, with thumbnail safe zones, stretched as a 9-slice, tiled, as a sprite sheet, and next to the references.
   Composed images get a composition row: the thirds / golden-section grid and margin with the predicted reading
   order (1-2-3) and the centre of visual weight, the attention map, the 3-value notan, the colour proportion bar and
   a hue wheel. Judge it like a player: does it read at 48 px? Is it clearly *that* object? Does the set look like one
   game? Does it match the references where it should? For composed images run the critique checklist in
   `graphic-design.md` section 14. A render can pass every check and still look wrong.

10. **Fix and rebuild** until it is right; two to four rounds is normal. Typical fixes: simplify small details,
    thicken thin parts, push the value contrast, adjust `shadowArea` / `depth`, separate parts that merge, move text
    out of the bottom band, tighten the set's `fit`. Composition fixes: make the hero bigger and the props smaller and
    calmer, put a glow (`k.bg.glowAt`) behind the focal point, calm or darken the background, move the background to
    the hero's complement, haze the far layers (`k.c.atmos`), cut words, step type sizes by 1.5x, pull text inside
    the margin, overlap or separate shapes that kiss.

11. **Deliver**: the PNGs (`out/<name>.png` plus size variants), the review sheet, and for UI the Luau lines
    (9-slice `SliceCenter`, sprite-sheet module, flipbook properties, all in the output and `manifest.json`). Tell the
    user briefly: what was made, sizes, which references shaped it (with licences, `CREDITS.md` if anything requires
    attribution), anything approximated, and how to get it into Roblox (`references/roblox-specs.md`: Asset Manager
    bulk import, Creator Hub, or the Studio MCP `upload_image` tool via `rart serve out`; uploading creates assets on
    their account, so ask before doing it).

## Kinds

| kind | canvas | for |
|---|---|---|
| `item` | 512, transparent | inventory, shop, reward, hotbar icons (exports 256, 128) |
| `ui-icon` | 256, transparent | HUD / button glyphs; `export: { white: true }` for `ImageColor3` tinting |
| `game-icon` | 512, opaque | the experience icon (shown ~150 px) |
| `thumbnail` | 1920x1080, opaque | store thumbnails (bottom band gets covered) |
| `badge`, `pass`, `product` | 512, opaque | cropped to a circle by Roblox |
| `logo`, `banner` | free | title art, menu / loading backgrounds |
| `panel` | small | 9-slice frames and buttons (`slice: [l, t, r, b]`) |
| `texture` | 256-1024 | decals and tiling textures (`tile: true`) |
| `sprite` | design 512 → pixel grid | pixel art (`pixel` or `pixels`), `ResampleMode = Pixelated` |
| `particle` | 256, transparent | ParticleEmitter textures and flipbooks |

## Spec at a glance

```js
export default (k) => ({
  set: { kind: 'item', light: 'tl', outline: { width: 14, color: 'auto' }, shadow: { dy: 10, blur: 6, opacity: 0.28 } },
  assets: [{
    name: 'HealthPotion',
    refs: [{ file: 'refs/ref03-noto.svg', note: 'Noto potion: round flask, cork, liquid line', license: 'Apache-2.0' }],
    layers: [
      { name: 'glass', svg: k.path(k.circleD(256, 318, 138) + k.rrect(214, 120, 84, 120, 10), '#cfeaff'), shade: { style: 'gloss', shadow: 0.35 } },
      { name: 'liquid', clip: 'glass', svg: k.path('M100 300 Q178 272 256 300 T412 300 V470 H100Z', '#e8334a'), shade: 'gloss' },
      { name: 'cork', svg: k.path(k.rrect(222, 52, 68, 66, 16), '#a8673a'), shade: 'toon', cast: { dy: 6, blur: 3 } },
      { name: 'glint', stage: 'front', svg: k.sparkle(330, 380, 22, '#fff') },
    ],
  }],
});
```
For a composed image, layers also take `role: 'hero'` (what the eye must land on) or `role: 'text'`, and the kit
has design helpers: `k.c.scheme(hero, type, { mood })` (60-30-10 colour roles), `k.at('tl')` / `k.safe()` /
`k.margin()` (thirds and golden-section anchors, margins), `k.typeScale(base, 1.5)`, `k.c.atmos(c, depth)` and
`k.bg.haze` (depth), `k.bg.glowAt` (light behind the focal point). `examples/store.art.mjs` uses them on a
thumbnail, game icon, badge and pass.
Coordinates are pixels of the design canvas (512 here), y down. Stages: `back` (backgrounds, never fitted or
outlined), `main` (the subject: fitted, outlined and shadowed as one), `front` (sparkles, text, frames). Shade
styles: `toon`, `soft`, `gloss`, `metal`, `flat`; forms `round`, `cyl-x`, `cyl-y`, `flat` + `face`. Layer functions
`(k, ctx) => markup` get the canvas size in `k.W`/`k.H` and animation time in `ctx.t`.

## Other commands

- `rart post <image> --kind item --key --outline 14 --shadow --fit`: finish an existing image (an AI generation, a
  Blender / Studio render, a screenshot, the user's drawing): remove a plain background, centre, outline, shadow,
  alpha-bleed, sizes, checks, review. `--pixel 32 --palette sweetie16` converts it to pixel art.
- `rart build icon.svg --kind item`: a plain SVG file (e.g. a licensed icon) scaled into the kind's canvas and
  finished with that kind's outline, shadow, fit, checks and review. `.json` specs work too.
- `rart check <png> --kind thumbnail`: checks + review sheet for any image, with the composition analysis for
  thumbnails, banners, icons, badges and logos (useful on the user's existing store art or an AI generation).
- `rart sheet <frames|dir> [--flipbook 4]`: pack frames into a sprite sheet / flipbook with a Luau module.
- `rart fonts`: fonts available (Roblox Studio's own fonts are used automatically; open-licence game fonts such as
  Luckiest Guy, Fredoka One, Bangers, Lilita One download on first use).
- `rart serve out`: http URLs for the Studio MCP `upload_image` tool. `rart selftest`: engine tests.

## When an image model is the better tool

Painterly, realistic or highly detailed illustration (a rendered character splash, a moody landscape) is beyond
layered vector drawing. If the user has an image-generation tool connected and wants that look, use it (ask first
when it costs credits), then finish the result with `rart post` and check it with the review sheet. Keep a set in
one method: mixing generated and vector icons in the same inventory looks inconsistent.

## Limits to be honest about

- Shading is computed from each layer's silhouette: great for rounded, stylised forms; flat-faced objects need
  `form: 'flat'` faces drawn as separate layers, and complex surface detail must be drawn.
- The readability and design checks are heuristics with numbers; the review sheet is the real test. The attention
  map is a contrast model: it does not know that faces draw the eye more than anything else, so check yourself that
  a face is where you want the first look.
- Needs Chrome, Edge or Chromium (set `CHROME_PATH` if it is in an unusual place). Reference search needs the
  network (Iconify, Wikimedia Commons, Openverse; HTTP 429 = wait a minute).
- Roblox upload limits beyond the documented ones (e.g. downscaling over 1024 px) are community knowledge; the specs
  file marks which is which.

## Files

- `scripts/rart.mjs` CLI; `scripts/lib/`: `build` (pipeline), `kit` (drawing helpers), `fx` (shade, outline,
  shadows, pixelate, key-out), `raster` (float images, blur, distance transform, resize, alpha bleed), `color`
  (OKLab / OKLCH, ramps, palettes, colour schemes, k-means), `checks`, `design` (composition analysis and design
  checks), `review`, `refs`, `trace` (silhouette, colour regions,
  palette), `sheet`, `post`, `fonts`, `chrome` (renderer), `presets` (kinds), `png`.
- `scripts/selftest.mjs`: maths, effects, tracing, packing and an end-to-end build. Run it after editing the engine.
- `examples/`: `items`, `burger` (+ `refs/burger-cc0.jpg`, CC0, Evan-Amos, Wikimedia Commons), `store`,
  `pixel`, `ui`.
- `references/`: `art-theory.md`, `graphic-design.md`, `recipes.md`, `roblox-specs.md`, `spec-reference.md`, `pixel-art.md`,
  `references-and-licences.md`.
- `fonts/`: download cache for open-licence fonts.
