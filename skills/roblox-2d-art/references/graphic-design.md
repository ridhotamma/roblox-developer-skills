# Graphic design for composed images

Thumbnails, banners, game icons, badges, passes, logos and UI screens arrange several things (a hero, a title,
props, a background) so they read **in a fixed order in under a second**. That is graphic design, and it has rules
with numbers. `art-theory.md` covers drawing one object well (silhouette, shading, materials); this file covers
putting things together. Each section ends with what the engine measures or offers. Sources at the end.

## Contents
1. The job: one message, a reading order, the squint test
2. Hierarchy and the focal point
3. Proportion and layout: grids, margins, size ratios
4. Balance and visual weight
5. Gestalt: grouping and figure / ground
6. Eye flow: reading path, leading lines, gaze
7. Value structure (notan)
8. Colour for composition: roles, harmony, contrasts, temperature, mood
9. Depth: three planes and atmospheric perspective
10. Typography
11. Edges: tangents, crops, corners
12. Layout templates per kind
13. Design brief (write it before drawing)
14. Critique checklist (use it on the review sheet)

---

## 1. The job

- **One message.** Before any shape, write the image's promise in one sentence ("a cute slime collecting coins in a
  bright world"). Everything in the frame either says that or goes.
- **A reading order of three.** Decide what is seen 1st (the hero), 2nd (the title or the action), 3rd (supporting
  props, setting). More than three levels is noise; two things at the same level fight.
- **The squint test.** Blur your eyes (or look at the review sheet's squint and attention views): the first thing
  you see must be the hero, and the image must still say its message as big blobs of light and dark.
- **Show the real game.** Roblox rejects misleading thumbnails and calls out ambiguous graphics as bad examples;
  the clearer the promise, the better it converts.

## 2. Hierarchy and the focal point

The eye goes to **the place of greatest contrast**. Contrast comes in many kinds; the focal point is where most of
them meet, and nowhere else gets more than one or two:

| Lever | Focal point gets | Everything else |
|---|---|---|
| Size | the biggest single element | clearly smaller (step about 0.6x per level) |
| Value | the darkest dark against the lightest light | compressed toward the middle |
| Saturation | the most saturated colour | calmer, greyer |
| Edges | crisp, hard edges | softer, simpler shapes |
| Detail | the face, the eyes, the gem | big flat areas |
| Isolation | space around it | grouped, overlapping |
| Faces | an expressive face looking into the frame | no rival faces at the same size |
| Anomaly | the one thing that breaks the pattern | repeated, similar things |

- **One dominant, a few subordinate.** A primary : secondary : tertiary size ratio around **1 : 0.6 : 0.35** reads
  as a clear hierarchy. Equal-sized elements read as a list, not a picture.
- **The second read is usually the title**, near the hero but not on top of its face.
- Supporting props (coins, gems, enemies) are smaller, partly behind or overlapped by the hero, and lower in
  contrast. A pile of high-contrast coins as big and bright as the hero becomes a second focal point.

Engine: the `focal point` check names the layer the eye lands on first; `hierarchy` warns when two image areas pull
the eye about equally; `figure / ground` compares how much attention the background takes against its area. The
review sheet's composition row numbers the first three attention peaks (1-2-3) and shows the attention map. Mark the
hero's layers with `role: 'hero'` so the checks know what should win. `k.bg.glowAt(x, y, r)` puts a light pool
behind the focal point (more value contrast exactly there).

## 3. Proportion and layout

- **Thirds and golden section.** Divide the frame in thirds (0.333 / 0.667) or by the golden ratio (0.382 / 0.618).
  The four intersections are the strong points for a focal point; the lines are where horizons, the hero's eye line or
  a text column sit. Phi lines sit a little closer to the centre than thirds; either works, and the difference is small.
  Use them for wide formats. Centred, symmetric layouts suit emblems: game icons, badges, passes, logos.
- **Never split the frame in equal halves**: horizon not at the middle, hero not exactly half the height, two
  objects not the same size. Unequal areas (about 1/3 vs 2/3) feel intentional; equal ones feel undecided.
- **Margins.** Keep text and important elements at least **5% of the short side** in from every edge (54 px on a
  1080 thumbnail), the same on every side they approach. Roblox covers the thumbnail's bottom band with the player
  count and rounds icon corners, so those areas get nothing important.
- **Proximity.** Things that belong together sit close; groups are separated by clearly more space. Inside a group
  the gap should be at most about half the gap between groups (title + tagline as one block, then space, then hero).
- **Alignment.** Text lines in a block share an edge or a centre line; a text block lines up with a grid line or
  with the hero's edge. Nearly-aligned looks like a mistake.
- **Size ratios.** Hero in a thumbnail: about 50-75% of the frame height (a face alone: a quarter to a third of the
  frame). Hero in a game icon: 60-85% of the canvas. Title cap height in a thumbnail: 10-16% of the frame height.
- **Rule of odds.** Groups of 3 or 5 props feel more natural than 2 or 4 (an even set pairs up and leaves nothing in
  the middle). Vary their sizes and spacing (big, medium, small; not a row of clones).

Engine: `k.at('tl')` and friends return the thirds intersections (`'phi-tr'` for the golden section, `'center'`,
`'left'`, `'top'`...), `k.margin()` the 5% margin, `k.safe()` the box inside the margins and above a thumbnail's
covered band, all in design pixels. The review sheet draws the thirds (white), golden section (yellow) and margin
(cyan) over the image. The `margins` check catches text closer to the edge than 5%.

## 4. Balance and visual weight

Every element has a **visual weight**, and the heavier side of an image feels like it is tipping. Weight grows with:
size, darkness, saturation, warm hue (red is the heaviest), contrast against its surroundings, isolation (an object
alone in empty space), detail, and position (higher and further from the centre feels heavier, like a lever).

- **Symmetric balance** (mirror) is stable and formal: emblems, badges, logos, a single mascot front and centre.
- **Asymmetric balance** is dynamic and suits thumbnails: a big, calm hero on one side balanced by a smaller, brighter
  or more saturated title on the other. Big-and-calm balances small-and-loud.
- The centre of visual weight should sit near the frame centre (within about 13% of the width for wide formats,
  9% for square ones) unless the imbalance is the point (tension, a falling character).

Engine: `balance` check and the cyan diamond on the review sheet mark the centre of visual weight (attention +
foreground area + saturation).

## 5. Gestalt: grouping and figure / ground

The eye groups things automatically; use it instead of fighting it.

- **Figure / ground**: the subject must separate from what is behind it. Separate by **value first** (a light hero
  on a darker ground or the reverse), then by hue (complementary or contrasting), then by edge (outline, rim light).
  A green slime on green grass, or a gold trophy on a gold background, camouflages the subject even with an outline.
- **Proximity**: close things are one group (see section 3).
- **Similarity**: things with the same colour, shape or size are read as related. A rarity colour on every rare
  item is similarity at work; one different item in a row of similar ones becomes a focal point (anomaly).
- **Closure**: the mind completes shapes, so a hero cropped by the frame still reads whole, and a coin half behind
  the hero still reads as a coin.
- **Continuation**: the eye follows lines and curves: a trail of coins, a road, a ray, a sword's direction.

Engine: `separation` (edge contrast), `figure hue` (how much of the area around the subject has its hue and value)
and `saturation` (subject vs background chroma) checks.

## 6. Eye flow

- Wide images are scanned roughly in a **Z**: top-left, across to top-right, diagonally down, across the bottom.
  A strong focal point overrides the default path, so place the hero where it wins and let the Z carry the eye to
  the title.
- **Leading lines** point at the focal point: the curve of the ground, a path, a trail of pickups getting bigger
  toward the hero, rays radiating from behind it, a character's arm.
- **Gaze and motion lead.** Characters look and move *into* the frame, toward the title or the action, with more
  space in front of them than behind. A hero looking out of the frame leads the eye out with it.
- Nothing should point at the corners or the edges (the eye exits there).

## 7. Value structure (notan)

The light-dark pattern is read before colour and is what survives at 150 px. Plan it in three values: dark, mid,
light.

- **One value dominates** (about half the frame or more), a second takes most of the rest, and the third is
  reserved for the focal point. A frame that is a third dark, a third mid and a third light reads as noise.
- **The hero sits on the value it contrasts with**: a light hero on a mid-to-dark ground, or a dark silhouette on a
  light sky. The strongest light-dark contrast in the whole image belongs at the focal point.
- Group values: a light sky stays light even where it has detail; a dark foreground stays dark. Detail lives inside
  value groups, never across them.
- The full image should still span from true darks (outlines, deep shadows) to true lights (highlights, glow).

Engine: `value plan` check (shares of dark / mid / light) and `value range`; the review sheet shows the 3-value
notan and the greyscale view.

## 8. Colour for composition

### Roles: 60-30-10
Give colours jobs by area (visual weight, not a pixel count):
- **Dominant ~60%**: the background and large surfaces. Calmer (less saturated) and value-separated from the hero.
- **Secondary ~30%**: ground, panels, big props. Supports the dominant without competing with the accent.
- **Accent ~10%**: the most saturated, often the lightest, colour. Title fill, coins, sparkles, the call to action.
  It goes where the eye should go. If it is everywhere it accents nothing.
- The hero is usually the accent's family or its complement; either way it is more saturated than the background.

### Harmony schemes (hue relationships, in the perceptual OKLCH wheel)
| Scheme | Hues | Feel | Use |
|---|---|---|---|
| Complementary | opposite (180°) | maximum pop | hero on its complement: orange coin on blue rays, green slime on magenta |
| Split-complementary | base + the two neighbours of its complement (±150°) | pop with less tension | the safest lively choice for thumbnails |
| Analogous | neighbours within ~60° | calm, unified | cozy, nature, underwater; add one complementary accent for the focal point |
| Triadic | three hues 120° apart | playful, busy | let one dominate, the others small |
| Monochromatic | one hue, many values | moody, elegant | horror, night, premium; value does all the work |

Two or three hue families plus neutrals is enough; five equally present hues is chaos.

### Itten's seven contrasts (the ways colours differ)
1. **Hue**: pure hues side by side (loud, primary).
2. **Light-dark**: the strongest structural contrast (yellow vs violet is the extreme).
3. **Cold-warm**: warm colours (red, orange, yellow) advance and feel heavy; cool ones (blue, green, violet) recede.
   Cool backgrounds push back, a warm hero comes forward, or the reverse for a cold hero on a warm sunset.
4. **Complementary**: opposites intensify each other.
5. **Simultaneous**: a colour shifts toward the complement of its neighbour; a grey next to strong green looks
   reddish. Judge colours in place, not in isolation.
6. **Saturation**: vivid against dull; saturation is relative, so a calm background makes a moderate hero look vivid.
7. **Extension (area)**: bright, light colours carry more weight per pixel than dark, dull ones; balance them with
   less area (the traditional ratios run about yellow 1 : violet 3, orange 1 : blue 2, red 1 : green 1).

### Temperature and light
- Warm light makes cool shadows and cool light makes warm shadows (the engine's hue-shifted shading does this per
  part). Keep one light temperature for the whole image.
- Rim or back light in the background's complementary hue separates a dark hero from a dark background.

### Pitfalls
- **Mud**: a semi-transparent colour over its complement (pink blush at 60% on green) mixes to grey-brown. Use opaque
  shapes in a lighter tint of a related hue.
- **Vibration**: saturated complements of the same value touching (red on green, blue on orange) shimmer. Put a value
  step or an outline between them.
- **Everything saturated**: when every area is at full chroma, nothing stands out and the image looks cheap. Turn
  the background down so the hero can be loud.
- **No dominant**: three colours at a third each look undecided; let one family own the frame.

### Mood (Roblox's own guidance)
Bright, high-saturation colour for cheerful, fantasy and simulator games; muted, low-saturation colour for somber or
cozy ones; heavy contrast and darkness for horror. Night, sci-fi and neon: dark dominant with small, very bright
accents.

Engine: `k.c.scheme(heroColour, 'complementary' | 'split' | 'analogous' | 'triad' | 'mono', { mood: 'bright' |
'muted' | 'dark' | 'horror' })` returns `{ hero, bg, bgLight, bgDeep, secondary, accent, ink, light }` with the
background value-separated from the hero and less saturated than it. `k.c.temperature(c)`, `k.c.harmony`,
`k.c.complement`. Checks: `colour proportion` (families by area), `accent` (a saturated colour covering too much of a
wide image), `harmony` (scheme name, warm / cool split), `saturation`, `figure hue`. The review sheet shows the
proportion bar and a hue wheel (dot size = area, distance from centre = saturation).

## 9. Depth

Three planes read as space: **foreground** (darkest or most saturated, biggest, may be cropped by the frame),
**midground** (the hero and the action, sharpest detail and highest contrast), **background** (simplest shapes).

- **Atmospheric perspective**: distant things move toward the sky colour, lose contrast (values compress toward the
  haze), lose saturation and lose detail. Use it on far hills, buildings and crowds.
- **Overlap** is the strongest depth cue: the hero in front of the ground line, props partly behind the hero.
- **Scale**: repeated objects get smaller with distance; a trail of coins shrinking away creates depth and a leading
  line at once.
- Dark, simple foreground shapes in a bottom corner frame the scene (and the bottom band of a thumbnail is
  covered anyway).

Engine: `k.c.atmos(colour, depth, haze)` pushes a colour back (depth 0 = near, 1 = horizon); `k.bg.haze(y0, y1,
colour)` lays a haze gradient over far layers; `k.bg.vignette()` darkens the edges toward the centre of interest.

## 10. Typography

- **Hierarchy with few levels**: a title and at most one supporting line. Each level clearly bigger than the next:
  a modular scale of **1.5x** (perfect fifth) or **1.618x** (golden) per level for display work; steps under 1.25x
  look like a mistake. `k.typeScale(base, 1.5)`.
- **Typefaces**: one display face (heavy, rounded or blocky: Luckiest Guy, Lilita One, Fredoka One, Titan One,
  Bungee) for titles, at most one more for supporting text. Match the game's mood (rounded = friendly, angular =
  action, distressed or condensed = horror).
- **Readable where players see it**: text needs a cap height of at least about 8 px at the smallest display size.
  For a thumbnail seen at 256x144 that is a font size of at least ~86 px on the 1920x1080 canvas; titles look right
  at 160-240 px. On a 512 icon seen at 64 px, text below ~92 px is unreadable.
- **Few words**: a thumbnail title of 2-3 words, at most about 5 words in total (Roblox: use overlay text
  sparingly); icons none or one short brand word; badges and passes one word at most (VIP, x2).
- **Contrast**: large text needs at least **3:1** contrast (WCAG) against what touches it. On busy art the touching
  colour is the outline, so a dark outline (about 12-18% of the font size) plus an optional light outer rim keeps
  any fill readable over any background. Gradient fills go light (top) to saturated (bottom).
- **Spacing**: outlined display caps need slightly open tracking so outlines do not fuse letters into a blob;
  stacked lines sit tight (line height 0.9-1.0 of the size). Never stretch type more than about 5% (`width`).
- **Placement**: on calm areas (sky, negative space), next to the hero rather than over its face, inside the 5%
  margin, out of a thumbnail's bottom band. A slight rotation (-3° to -6°) adds energy; more looks accidental.

Engine: the `text size`, `word count`, `typefaces`, `type scale`, `text contrast` and `margins` checks read the
text of front layers (and layers with `role: 'text'`). `k.text` options: `fill` gradients, `stroke` / `sw`, `outer`,
`shadow`, `rot`, `ls` (letter spacing), `arc`.

## 11. Edges: tangents, crops, corners

- **Tangents**: two edges that just touch (a head touching the title, a shape touching the frame) make the eye snag
  and flatten depth. Either **overlap clearly** or leave a **visible gap** (at least ~2% of the frame).
- **Crops**: crop boldly into the frame (a big hero cut by the bottom edge reads as close and powerful) or keep the
  object fully inside with margin. A sliver cut off, or an edge kissing the frame, looks like a mistake. Do not crop
  characters exactly at joints (wrists, ankles, neck).
- **Corners**: keep them quiet. Roblox rounds icon corners and its docs show a corner graphic as an error example.

Engine: `tangent` (a layer nearly touching the frame) and `kissing shapes` (two shapes that nearly touch) checks.

## 12. Layout templates

**Thumbnail, hero + title (the default)** (1920x1080): hero on a vertical thirds line (x ≈ 640 or 1280), 55-75% of
the frame height, facing into the frame, standing on a ground line around the lower third. Title in the other two
thirds, upper half, inside `k.safe()`, aligned as one block with the tagline. 3-5 small props on a leading line
between them. Background: one calm dominant family, glow behind the hero, vignette, far layers hazed.

**Thumbnail, centred icon**: the mascot or boss huge and centred (symmetry = power), title arched above, rays from
behind. For a single iconic subject.

**Thumbnail, versus**: two characters on the two thirds lines facing each other, a diagonal split between warm and
cool backgrounds, a short word (VS, a mode name) at the centre. For PvP, battle and rivalry games.

**Thumbnail, gameplay scene**: a Studio screenshot (`k.image`, stage back) graded toward the dominant colour
(`k.bg.haze`, vignette), the hero cut out larger in the foreground, the title on the calmest area.

**Banner / menu background** (wide, `kind: 'banner'`): a text column on one side (about 40% of the width), the
hero on the other. If it is shown with `ScaleType.Crop`, different screens cut it: a 16:9 image on a 4:3 tablet
loses ~12% on each side, on a 21:9 phone ~12% top and bottom, so keep everything important inside the central
75% x 75%.

**Game icon** (512): one hero, 60-85% of the canvas, three-quarter view, big expressive face, slightly below the
optical centre; glow behind the face; at most 2-3 props at a third of the hero's size or less, partly behind it and
lower in contrast (two equal props behind the shoulders read as ears at 64 px: one clear prop, or three at clearly
different sizes); quiet corners; no text or one short word.

**Badge / pass / product** (512, circle crop): symmetric emblem inside the middle 70% circle, background in the
subject's complementary or a contrasting hue (a gold trophy on deep blue, not on gold), one short word in the lower
third if it reads at 150 px.

**Logo / title lockup**: main word big, secondary words 0.4-0.65x its size, stacked and centred as one block; one
display face; a shape behind (ribbon, burst, shield) to unify it; the same outline and shadow on every word.

**UI screens and panels**: a spacing scale (4, 8, 16, 24, 32, 48 px), one corner radius family, everything aligned
to a column grid, the accent colour only on the primary button; small text needs 4.5:1 contrast. (`roblox-ui`
covers building them.)

## 13. Design brief (write it before drawing)

A few lines in your plan, for every composed image:
1. **Message** in one sentence, and which real gameplay it shows.
2. **Reading order**: 1 = ..., 2 = ..., 3 = ...
3. **Layout**: which template; the hero's anchor (`k.at('tl')`...), its size as a share of the frame; where the
   text block sits (`k.safe()`).
4. **Value plan**: which value dominates, where the strongest light-dark contrast is.
5. **Colour**: scheme and mood (`k.c.scheme(hero, 'split', { mood: 'bright' })`), which role each part takes.
6. **Type**: words, typeface, sizes from `k.typeScale`.
7. **Depth**: what is in the foreground, midground, background.

## 14. Critique checklist

Look at `review-<name>.png` and answer in this order (most problems are found by the first three):
1. **Squint / attention**: are the numbered points 1-2-3 the intended reading order? Is 1 on the hero?
2. **Value**: does the 3-value notan show one dominant value and a clear shape for the hero?
3. **Figure / ground**: is the hero separated by value *and* hue from what is right behind it?
4. **Colour**: one dominant family, a small accent at the focus, two or three hue families, background calmer than
   the hero?
5. **Balance**: is the diamond near the centre, or is the imbalance intended and countered?
6. **Text**: readable at the card size, few words, two sizes a clear step apart, inside the margins, on a calm area?
7. **Edges**: no tangents, bold crops only, quiet corners, nothing important in a thumbnail's bottom band?
8. **Depth**: three planes, distance hazier and calmer?
9. **Promise**: does it show the real game, and would a player understand it at 150 px?

---

## Sources

- Core principles (hierarchy, contrast, balance, alignment, proximity, repetition, white space): https://www.adobe.com/express/learn/blog/8-basic-design-principles-to-help-you-create-better-graphics , https://opentextbc.ca/graphicdesign/?p=1445 , https://www.figma.com/resource-library/graphic-design-principles/
- Visual weight and direction: https://www.smashingmagazine.com/2014/12/design-principles-visual-weight-direction/ ; compositional flow: https://www.smashingmagazine.com/2015/04/design-principles-compositional-flow-and-rhythm
- Gestalt principles: https://www.ixdf.org/literature/topics/gestalt-principles , https://www.creativebloq.com/graphic-design/gestalt-theory-10134960
- Thirds and golden section: https://expertphotography.com/golden-ratio-vs-rule-of-thirds , https://photographylife.com/the-myth-of-the-rule-of-thirds ; rule of odds: https://helio.zurb.com/definitions/rule-of-odds/
- 60-30-10: https://uxplanet.org/the-60-30-10-rule-a-simple-way-to-creating-catchy-user-interfaces-e9e2cf957213 , https://www.freecodecamp.org/news/the-60-30-10-rule-in-design/
- Itten's seven contrasts: https://www.olli-dc.org/uploads/PDFs/2024_Spring/599_Miklitsch/599colortheoryweek4handout.pdf , https://www.oreilly.com/library/view/best-practices-for/9781592538355/chapter-46.html
- Warm light / cool shadow: https://jamesgurney.substack.com/p/the-warm-and-cool-approach , https://gurneyjourney.blogspot.com/2008/05/induced-color.html
- Notan and value composition: https://www.virtualartacademy.com/notan/ , https://www.proko.com/course-lesson/project-notan-master-thumbnails
- Atmospheric perspective: https://human.libretexts.org/Courses/Coalinga_College/Drawing_Perspectives/05:_Atmospheric_Perspective/5.04:_Understanding_Atmospheric_Perspective
- Tangents: https://illustrationdept.substack.com/p/on-a-tangent , https://gurneyjourney.blogspot.com/2010/11/tangencies-in-real-life.html
- Modular type scales: https://www.github.com/Team-Sass/modular-scale ; logo typography: https://smashingmagazine.com/2024/08/mastering-typography-in-logo-design
- Text contrast (3:1 large text, outlines and halos over images): https://w3.org/WAI/WCAG21/Understanding/contrast-minimum.html , https://www.w3.org/WAI/WCAG21/Techniques/general/G18
- Key art (one focal hero, readability at small sizes, crops): https://madegooddesigns.com/game-key-art-design/ , https://www.gamedeveloper.com/design/6-elements-of-visual-guidance
- Thumbnail practice (one focal point, faces, few words, contrast at small size): https://vidiq.com/blog/post/youtube-thumbnail-design-tips/ , https://snappa.com/blog/youtube-thumbnail-best-practices/
- Roblox guidance (unique, relevant, unambiguous imagery; mood by colour and contrast; sparing text; bottom band; 150 px icons): https://create.roblox.com/docs/production/promotion/thumbnails , https://create.roblox.com/docs/production/promotion/game-icons
