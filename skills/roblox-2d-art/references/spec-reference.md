# Art spec, effects and kit reference

## Contents
- Spec file forms
- Asset fields
- Layer fields and stages
- Effects (shade, outline, innerLine, cast, shadow, glow) with parameters
- Pixel art fields
- Frames (animation, sprite sheets, flipbooks)
- Kit (`k`) reference
- CLI and outputs

## Spec file forms

`node <skill>/scripts/rart.mjs build <file>` accepts:
- **`.mjs` / `.js`** (recommended): `export default (k) => spec`, where spec is one asset, an array of assets, or
  `{ set: { ...defaults for every asset }, assets: [...] }`. `k` is the drawing kit.
- **`.json`**: the same structure with `svg` strings (no functions).
- **`.svg`**: a single-layer asset at the SVG's viewBox size (add `--kind` style defaults by wrapping it in a spec
  instead if you need effects).

All coordinates are **design pixels** of the asset's canvas (`size`), y down. Effect sizes (outline width, shadow
offsets, blur, depth) are in design pixels too and scale with supersampling automatically.

## Asset fields

| field | default | meaning |
|---|---|---|
| `name` | `asset` | file name (letters, digits, `_ . -`) |
| `kind` | `item` | `item`, `ui-icon`, `game-icon`, `thumbnail`, `badge`, `pass`, `product`, `logo`, `banner`, `panel`, `texture`, `sprite`, `particle` (sets size, background rules, checks, previews: see roblox-specs.md) |
| `size` | from kind | `512` or `[w, h]` |
| `layers` | | list of layers, drawn bottom to top within each stage |
| `svg` | | shorthand for a single main layer |
| `light` | `'tl'` | light for every `shade`: `tl`, `top`, `tr`, `left`, `right`, ... or an angle in degrees (0 = from the right, 90 = from the top) |
| `shade` | `{}` | defaults merged into every layer's `shade` (e.g. `{ style: 'toon', hueShift: 26 }`) |
| `outline` | from kind | outline around the whole main stage: number (width), `{ width, color: 'auto' or hex, position, opacity, darkness }`, an array of those (stacked outward), or `null` |
| `shadow` | from kind | drop shadow under the main stage: `{ dx, dy, blur, spread, color, opacity }` or `null` |
| `glow` | none | glow under the main stage: `{ blur, spread, color, opacity }` |
| `fit` | from kind | `{ pad: 0.06, anchor: 'bottom', maxScale: 4 }`: scales and centres the main (and front) stage to fill the canvas minus padding and effect room; `null` keeps your coordinates |
| `pixel` / `pixels` | | pixel art (below) |
| `frames` | | animation (below) |
| `slice` | | 9-slice insets `[left, top, right, bottom]` in pixels (or `[n]`): adds the 9-slice check, preview and Luau |
| `tile` | | `true` for seamless textures: adds the seam check and a tiled preview |
| `export` | from kind | `{ sizes: [256, 128], white: true \| 'value' }`: extra downscaled PNGs, white tintable copy |
| `refs` | | `[{ file, note, url, license }]` shown beside the result in the review sheet; recorded in manifest.json |
| `credits` | | openly licensed works the art adapts (e.g. a traced or inlined icon): written to CREDITS.md |
| `ss` | auto | supersampling factor (auto: canvases under 400x400 render 2-4x and downscale) |

## Layer fields and stages

| field | meaning |
|---|---|
| `name` | used by `clip` and in messages |
| `svg` | SVG markup string, or `(k, ctx) => string` (`ctx`: `{ w, h, t, frame, frames }`). Use the function form when the markup depends on the canvas size (`k.bg.*`, `k.frame.*` read `k.W` / `k.H`) or on the animation time |
| `stage` | `'back'` (backgrounds; never fitted, not outlined), `'main'` (the subject: fitted, outlined, shadowed as a whole), `'front'` (on top of everything: sparkles, text, frames; follows `fit` unless `fit: false`), `'post'` (canvas-wide overlay blended over the finished picture with its `blend` and `opacity`, only where the picture is: light pools with `screen`, a colour grade with `soft-light`, vignette, grain with `overlay`; no effects, not fitted, not in the design analysis) |
| `clip` | `'prev'` / `true` (previous layer of the same stage) or a layer name: show this layer only inside that layer's shape (liquid in glass, seeds on a bun, stripes on a shield) |
| `shade` | `'toon'`, `'soft'`, `'gloss'`, `'metal'`, `'flat'`, `true` (asset default) or an object (below) |
| `outline` | per-layer outline (thin separations between parts): number or object |
| `innerLine` | line just inside this layer's edge: number or `{ width, color }` |
| `cast` | this layer's shadow falling on the layers already drawn below it (only where they are): `{ dx, dy, blur, opacity, color }`; number = dy |
| `shadow`, `glow` | per-layer drop shadow / glow |
| `blend` | `normal`, `multiply`, `screen`, `overlay`, `soft-light`, `hard-light`, `darken`, `lighten`, `add`, `color-dodge`; blends with the layers below it in the same stage (use stage `post` to blend over the whole picture) |
| `opacity` | 0..1 |
| `hidden` | skip the layer |
| `fit` | `false` on a front layer keeps its own coordinates |
| `role` | composed images: `'hero'` (where the eye must land first; the design checks verify it), `'text'` / `'title'` (copy to read, also detected automatically on front layers), `'bg'`, `'support'` |

Each layer is rendered on its own, so effects see exactly that layer's shape. Several shapes in ONE layer act as one
form for shading (good for a body; bad for separate parts: give parts their own layers).

**Paths that overlap inside one `<path d>`**: the kit's closed builders all run clockwise, so concatenating them
(`k.circleD(...) + k.rrect(...)`) unions them. Hand-written subpaths running the other way cut a hole (nonzero
rule); when in doubt put shapes in separate `<path>` elements of the same layer.

## Effects

### shade (per layer)
| param | default | meaning |
|---|---|---|
| `style` | `toon` | `toon` (flat bands + glint), `soft` (smooth), `gloss` (smooth + crisp glint + rim), `metal` (horizon reflection), `flat` |
| `form` | `round` | `round` (inflated from the silhouette), `cyl-x` (tube lying horizontally), `cyl-y` (vertical tube: blades, bottles), `flat` (use with `face`) |
| `face` | | fixed tone -1..1 for a flat face (top +0.3, lit side +0.1, shadow side -0.45) |
| `depth` | ~ half-thickness | how far the rounding reaches in from the edge (px). Small = bevelled edge with a flat middle, large = fully round |
| `shadow` | 0.6 (metal 0.85) | strength of the dark side |
| `highlight` | 0.3 | strength of the light side |
| `shadowArea` / `lightArea` | 0.32 / 0.1 | toon: fraction of the part in shadow / in the highlight band |
| `bands` | 3 | toon: 2 = shadow + base only |
| `spec`, `shininess`, `specColor` | by style | specular glint strength (0..1), tightness, colour |
| `rim`, `rimColor`, `rimWidth` | gloss / metal 0.35 | back light on the shadow-side edge |
| `hueShift`, `shadowHue`, `lightHue` | 22, 285, 95 | hue shifting: degrees and target hues (OKLCH) for shadows and highlights |
| `light`, `elevation` | asset light, 50 | override per layer |
| `soft` | 0.75 | band edge softness |

### outline (asset or layer)
`{ width: 14, color: 'auto' | '#hex', position: 'outside' | 'inside' | 'center', opacity: 1, darkness: 1 }`.
`auto` colours each stretch of line with a dark, cool-shifted version of the colour it touches. Arrays stack:
`[{ width: 12, color: 'auto' }, { width: 5, color: '#ffffff' }]` (the second goes around the first).

### shadow / glow / cast
`shadow: { dx: 0, dy: 8, blur: 6, spread: 0, color: '#1b1028', opacity: 0.3 }`; `glow: { blur: 14, spread: 0,
color: '#fff', opacity: 0.9 }`; `cast: { dy: 6, blur: 4, opacity: 0.3 }`.

## Pixel art

**Converted from vector layers** (draw at 512, get crisp pixels): `pixel: { size: 32 | [w, h], palette: 'auto' |
'pico8' | 'sweetie16' | 'endesga32' | 'gameboy' | ['#hex', ...], colors: 12 (for auto), dither: 0..1, outline:
'selective' | '#hex' | 'none', cleanup: true, alphaCut: 0.5, scale: 16 }`. Outputs `<name>.png` at grid size and
`<name>@<scale>x.png` upscaled with nearest neighbour. The asset `outline` is skipped (the 1 px outline replaces it)
unless `vector: true` is set on it. Shade with `toon` so the bands become clean pixel clusters.

**Hand-placed**: `pixels: { palette: { '.': null, k: '#1a1c2c', r: '#b13e53' }, rows: ['..kk..', ...], scale }`.

## Frames

`frames: { count: 8, fps: 12, cols, pad: 2, layout: 'grid' | 'flipbook', grid: 2 | 4 | 8, sheetSize: 1024, mode:
'Loop' }`. Every layer function receives `ctx.t` (0..1 across the loop) and `ctx.frame`. Outputs `<name>_sheet.png`
and `<name>_sheet.luau` (grid: a module with `apply(label, frame)` and `play(label, fps)`; flipbook: the
ParticleEmitter property lines). Kind `particle` packs as a flipbook automatically. For loops, make frame `count`
match a full cycle (t = 1 equals t = 0, which is not drawn twice).

## Kit (`k`) reference

Path builders (return `d` strings; all closed ones clockwise):
`rrect(x,y,w,h,r)`, `circleD(cx,cy,r)`, `ellipseD(cx,cy,rx,ry)`, `poly(pts, closed)`, `smooth(pts, closed=true,
tension=1)` (Catmull-Rom through points), `blob(cx,cy,rx,ry,{n,amp,seed,rot})`, `star(cx,cy,ro,ri,n,rot,{round})`,
`burst(cx,cy,ro,ri,n,seed)`, `roundPoly(pts, r)`, `heart(cx,cy,size)`, `drop(cx,cy,w,h)`, `shield(cx,cy,w,h)`,
`bolt(cx,cy,size)`, `capsule(x1,y1,x2,y2,r)`, `ring(cx,cy,ro,ri)` (evenodd), `scallop(cx,cy,rx,ry,bumps,bulge)`,
`cloud(cx,cy,w,h,seed)`, `flame(cx,baseY,w,h,seed)`, `ribbon(cx,cy,w,h)` → `{ body, tails }`.

Illustration (references/illustration.md): `curve(pts, closed, per)` → dense points on the `smooth` curve;
`stroke(pts, width, {taper: [start, end], min, wobble, seed})` → `d` of a tapered brush stroke along a smooth curve
(width: number, `[start, end]` or `t => px`); `limb(a, b, ra, rb)` → `d` of a tapered capsule between two joints;
`fk(root, [[length, angle], ...])` → joint points (first angle absolute, degrees, 0 = right, 90 = down; the rest bend
relative to the previous bone); `scatter({x, y, w, h, n, gap, seed, scale: [min, max], rot, inside, sort})` →
`[{x, y, s, rot, r, i}]` Poisson-spaced, sizes leaning small, sorted by y; `persp(y, horizon, refY = H)` → scale on a
ground plane. Faces: `eye(cx, cy, r, {style: 'bean'|'full', look: [x, y], lid, tilt, ink, iris, light, glint, h})`,
`brow(cx, cy, w, {angle, arch, thick, ink})`, `mouth(cx, cy, w, 'smile'|'grin'|'open'|'o'|'flat'|'frown'|'smirk'|
'wavy'|'cat', {ink, sw, inside, tongue, teeth})`.

Elements (return markup): `path(d, fill, attrs)`, `shape(d, {fill, stroke, sw, opacity, evenodd, transform,
filter})`, `line(d, color, width, {cap, dash, opacity})`, `circle`, `ellipse`, `rect`, `g(attrs, ...kids)`,
`tf(x, y, s, rot)` (transform string), `place(markup, cx, cy, size, rot, box=512)` (re-use a piece drawn in a
512 box), `flipX(markup, cx)`, `tile(markup)` (seamless wrap), `image(file, x, y, w, h, {fit, opacity})` (raster:
screenshots, renders; embedded), `svgFile(file, x, y, w, h, {fill})` (inline an SVG such as a licensed icon from
`refs`), `text(str, x, y, opts)`.

`text` options: `size`, `font` (any family: Roblox Studio's own fonts are found automatically, open-licence game fonts
download on first use, e.g. `Luckiest Guy`, `Fredoka One`, `Bangers`, `Lilita One`, `Titan One`, `Bungee`, `Press
Start 2P`), `fill` (colour or stops array for a vertical gradient), `stroke`, `sw` (outline width), `shadow` (drop
in px or `false`), `shadowColor`, `outer: { color, sw }` (second outline), `anchor`, `rot`, `skew`, `ls` (letter
spacing), `width` (force exact width), `arc` (bend), `shine` (0..1 light top half), `weight`.

Paint servers / filters (register defs, return `url(#id)`): `linear(stops, {x1,y1,x2,y2})`, `radial(stops,
{cx,cy,r,fx,fy})`, `clip(d)`, `clipped(d, ...markup)`, `blurF(std)`, `glowF(std, color)`, `shadowF(dx,dy,std,color,op)`,
`roughF(amount, freq, seed)` (hand-drawn edges by noise displacement; on a `<g filter>`).
Stops: `['#a', '#b']` or `[[0, '#a'], [1, '#b', 0.5]]`.

Hand shading (when you want exact control): `cel(d, base, {shadow, dx, dy, light})` (crescent shadow),
`gloss(d, {x,y,w,h,opacity})`, `shine(cx,cy,rx,ry,rot,op)`, `sparkle(cx,cy,r,fill,{pinch,rot,opacity})`,
`groundShadow(cx,cy,rx,ry,op)`.

Ready-made: `gem(cx,cy,w,h,color)` (faceted), `coin(cx,cy,r,color,{symbol,font})`, `rays(cx,cy,r,n,color,op,rot)`.
Backgrounds (canvas-sized; call inside a layer function): `k.bg.solid(c)`, `linear(top,bottom,angle)`,
`radial(inner,outer,{cx,cy,r})`, `rays({color,n,op,cx,cy})`, `vignette(op)`, `dots(color,op,step,r)`,
`stripes(color,op,step,angle)`, `rarity('common'|'uncommon'|'rare'|'epic'|'legendary'|'mythic'|hex)`,
`glowAt(x, y, r, color, op)` (light pool behind the focal point), `haze(y0, y1, color, op)` (sky-coloured haze over
far layers, full at y0, gone at y1), `grain(op, freq, seed)` (noise for a `post` layer with blend `overlay`),
`grade(top, bottom, op, angle)` (colour-grade gradient for a `post` layer with blend `soft-light`).
Frames: `k.frame.card({r, border, color, inner})`, `k.frame.circle({color, width, inner, inset})`.

Layout (graphic-design.md sections 3 and 13; design pixels; inside a layer function they use the asset's canvas, at
the top of a spec pass the size as the last two arguments):
`k.at(name, w, h)` → `[x, y]`: `'center'`, thirds intersections `'tl' 'tr' 'bl' 'br'`, thirds lines through the middle
`'top' 'bottom' 'left' 'right'`, golden section with a `'phi-'` prefix (`'phi-tr'`). `k.margin(f = 0.05, w, h)` → the
margin in px. `k.safe(f = 0.05, w, h, bottom)` → `{ x, y, w, h, x1, y1, cx, cy }`: inside the margins and above a
thumbnail's covered bottom band (inside a layer the kit knows the kind; at the top of a spec pass the size and
`bottom = 0.12` for a thumbnail). `k.typeScale(base, ratio = 1.5)` → `step => size` (`ts(0)` body, `ts(1)`, `ts(2)` title...).

Colour (`k.c`): `shade(c, t)`, `ramp(c, n)`, `ink(c)`, `mix(a, b, t)`, `lighten`, `darken`, `saturate`, `rotate(c,
deg)`, `complement`, `harmony(c, 'complement'|'analogous'|'triad'|'split')`, `contrast(a, b)` (WCAG ratio),
`oklch(c)`, `temperature(c)` (`'warm' | 'cool' | 'neutral'`), `RARITY`, `PALETTES`, `MOODS`.
`scheme(heroColour, 'complementary' | 'split' | 'analogous' | 'triad' | 'mono', { mood: 'bright' | 'muted' | 'dark' |
'horror', accent: hue })` → `{ hero, bg, bgLight, bgDeep, secondary, accent, ink, light, roles }`: a 60-30-10 role
palette whose background is calmer than the hero and a value step away from it. `atmos(c, depth 0..1, haze)`: the
colour pushed back in space (toward the haze, lower contrast and chroma). Random: `k.rng(seed)` (deterministic).

## CLI and outputs

```
rart.mjs build <spec> [--out dir] [--only a,b] [--no-review] [--verbose]
rart.mjs refs "<object>" [--kind icons|photos|both] [--sets color,shape,ui,pixel|prefixes] [--n 12] [--out refs]
rart.mjs trace <image> [--out name] [--box 512|1920x1080] [--pad 0.06] [--crop x0,y0,x1,y1] [--threshold 0.12] [--holes] [--detail 1.5] [--colors 5] [--all] [--flip] [--no-smooth]
rart.mjs palette <image> [--n 6]
rart.mjs post <image> --kind item [--key [tol]] [--outline 14|false] [--shadow [dy]|--no-shadow] [--fit [pad]|--no-fit] [--shade toon] [--pixel 32 --palette sweetie16] [--size 512] [--name X] [--out dir]
rart.mjs check <png> --kind badge
rart.mjs sheet <frames...|dir> [--out sheet.png] [--cols n] [--cell 128] [--pad 2] [--flipbook 4] [--fps 24] [--name X]
rart.mjs fonts [list | get "<family>"]
rart.mjs serve <dir> [--port 8765]
rart.mjs selftest
```

Composed kinds (`thumbnail`, `banner`, `game-icon`, `badge`, `pass`, `product`, and `logo` for text) also get the
design checks (focal point, hierarchy, figure / ground, balance, value plan, colour proportion, accent, harmony, figure
hue, saturation, text size, word count, typefaces, type scale, text contrast, margins, tangent, kissing shapes) and a
composition row on the review sheet. `rart check <png> --kind thumbnail` runs the same analysis on any image (without
layers it judges the pixels alone, so the layer-specific checks are skipped).

Build outputs in `--out` (default `out/` next to the spec): `<name>.png` (alpha-bled), `<name>_<size>.png`,
`<name>_white.png`, `<name>@Nx.png` (pixel art), `<name>_sheet.png/.luau`, `review-<name>.png`, `review-set.png`
(two or more assets), `manifest.json` (files, checks, slice rects, palettes, references), `CREDITS.md`.
