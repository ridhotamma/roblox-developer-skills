# Reference research and measurement

A low-poly model is a simplification of the real thing, and a simplification only reads if the big proportions are right: overall length to height, where the widest point is, how big the head / handle / lid is relative to the body. Those numbers come from references, not memory.

## 1. Find images

`node scripts/refsearch.cjs "<query>" --out refs [--n 8] [--source commons|openverse|both]`

- Downloads up to `n` results per source into `refs/ref01.jpg ...`, appends to `refs/sources.json` (title, page URL, licence, author, query) and redraws `refs/contact-sheet.png` (numbered thumbnails). Look at the contact sheet once instead of opening every file.
- Run it two or three times with different queries; results accumulate in the same folder.
- Good query patterns: `"<object> side view"`, `"<object> profile"`, `"<object> isolated white background"`, `"<species> illustration"` (old natural-history plates are side views on plain paper: ideal for tracing), `"<object> diagram"` / `"<object> dimensions"` (gives sizes), `"<object> open"` (for the animated state), `"low poly <object>"` (shows how others simplified it: use for style, not for proportions).
- Wikimedia Commons and Openverse need no key. If they rate-limit you (HTTP 429), wait a minute, switch `--source`, or use the browser to search and save images yourself into `refs/`.
- When the network is unavailable, say so, use the sizes table below and well-known proportions, and lower your confidence in the report.

## 2. Choose the views

Pick, in order of value:

1. **A true side (profile) view**: the camera square to the object, little perspective. Gives length, height and the profile (the most recognisable outline for animals, vehicles, weapons, furniture).
2. **A front view**: width and cross-section shape (round, oval, flat-sided, tapered).
3. **A top view**: footprint, taper of the body seen from above.
4. **The moving state**: open lid, spread wings, mid-swim bend. It tells you the hinge position, opening angle and range of motion.
5. **A 3/4 view**: how the parts connect. Not for measuring (perspective distorts).

Reject images where the object is cropped by the frame, strongly foreshortened, partly hidden, or a stylised design that differs from what the user asked for. Prefer several ordinary examples over one striking but atypical one.

## 3. Measure

**Real size.** From product listings, encyclopaedia text, diagrams, or the table below. Write it into `reference.dimensions` (`width` = x, left-right; `height` = y; `depth` = z, front-back) with a `tolerance` (0.05 for manufactured objects, 0.08-0.15 for animals and stylised props).

**Proportions from a side view:**

```
node scripts/rmodel.cjs trace refs/ref06.jpg --flip --stations 12 --length 0.30
```

- `--flip` mirrors the image so the front points right (the convention for the model's side view: front = +Z = right). Without it, `compare` still detects a flipped reference automatically.
- `--crop x0,y0,x1,y1` (fractions 0-1) isolates one figure on a sheet with several; `--threshold 0.1-0.4` adjusts the background key; `--invert` for light objects on dark backgrounds.
- Output: aspect (width/height), and for each station along the length the top, bottom and thickness as fractions of the height, then suggested loft stations in metres (`at`, `h`, `dy`). Add `w` (the width) from a front or top view, or estimate it (fish ~0.4-0.5 × height, birds ~0.8-1.0, boats ~0.35 × length).
- It writes `<image>-mask.png`. **Look at it.** Shadows, text labels, stands and backgrounds sometimes join the object. Crop, change the threshold, or measure by eye from the image instead.
- The trace includes appendages (fins, handles, legs, tails). Read the profile and decide which stations are body and which are appendage; model appendages as separate parts.

**By eye.** When tracing is not possible (busy photos), measure in pixels from the image: you can see coordinates when you view an image. Express everything as ratios of one reference length (for example "head = 0.28 of total length, eye centre at 0.12 from the snout and 0.6 of the height"). Write the ratios into `reference.notes`.

**Check against the reference after building:** add a `silhouette` check with the same image (`view: "side"`, `min: 0.8`). `compare-<Name>-side.png` shows exactly where the model is too big (blue) or too small (red); fix those regions and rebuild. Also: `node scripts/rmodel.cjs compare model.json refs/ref06.jpg --view side` prints the reference and model profiles side by side.

## 4. Record it

Every model spec has a `reference` block: `sources` (URL, note on what each image showed, local file), `dimensions`, and `notes` (the measurements and decisions). Mention the sources and licences when delivering. Images under licences with NC / ND terms are fine for private measuring but should not be committed to a public repository; keep only the URL.

## Common real-world sizes (metres, approximate)

| Object | Size |
|---|---|
| Treasure / storage chest | 0.8-1.0 W × 0.5-0.6 D × 0.5-0.65 H (lid arch 0.15-0.25) |
| Wooden crate | 0.6-1.0 cube; pallet 1.2 × 1.0 × 0.15 |
| Barrel (wine / whisky) | 0.9-1.0 H, 0.55-0.65 belly Ø, heads 0.5 Ø |
| Door | 0.8-0.9 W × 2.0-2.1 H × 0.04 |
| Dining table / chair | table 0.75 H; chair seat 0.45 H, back 0.9 H |
| Lantern (handheld) | 0.25-0.35 H |
| Sword (arming / long) | 0.9-1.2 total, blade 0.75-0.95 × 0.04-0.05, grip 0.1-0.25 |
| Axe (hatchet / felling) | 0.35-0.45 / 0.8-0.9 handle |
| Shield (round) | 0.6-0.9 Ø |
| Bow (long) | 1.6-1.9 |
| Human (adult) | 1.65-1.8 H, shoulders 0.45 W, head 0.22-0.24 H |
| Tree (young / mature) | 4-8 / 12-25 H, trunk 0.2-0.6 Ø |
| Rock (boulder) | 0.5-2 |
| Goldfish / perch / trout / salmon | 0.1-0.2 / 0.25-0.35 / 0.4-0.6 / 0.7-0.9 length; body height 0.3-0.5 × length (perch) or 0.2-0.25 (trout) |
| Shark (reef) | 1.5-2.0 |
| Bird (sparrow / pigeon / crow / eagle) | length 0.15 / 0.3 / 0.45 / 0.8-0.95; wingspan ~1.6-2.2 × length |
| Cat / dog (medium) | 0.45 / 0.6-0.7 body length, 0.25 / 0.5 shoulder height |
| Horse | 2.4 length, 1.6 withers |
| Car (hatchback) | 4.0 × 1.75 × 1.5 |
| Roblox character | about 5 studs tall (1 stud ≈ 0.28 m when matching real sizes) |

For something not listed, search `"<object> dimensions"` and cite where the number came from.
