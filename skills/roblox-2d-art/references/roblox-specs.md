# Roblox image specs and integration

What Roblox expects for each kind of image, how to get the PNGs into the game, and how to display them.
"Docs" = Roblox Creator Docs (URLs at the end). "Community" = DevForum reports, not official.

## Asset kinds (the `kind` field)

| kind | Size | Background | Roblox rules and display | Design rules |
|---|---|---|---|---|
| `game-icon` | 512x512 (square, at least 512; non-square is rejected) | opaque | shown down to ~150x150; one per locale; moderated (docs) | mascot / hero object big, simple background, no small text, no corner symbols |
| `thumbnail` | 1920x1080, 16:9 (other ratios are stretched) | opaque | up to 10 images/videos; .jpg .gif .png .tga .bmp; personalization wants 2-5 active, each under 3 MB; bottom edge can be covered by player-count metadata (docs) | real gameplay promise, one focal point, short big title, nothing essential at the bottom |
| `badge` | 512x512 template | opaque | the upload crops the image to a CIRCLE; shown at 150x150; 5 free badges / 24 h per game, then 100 Robux each (docs) | subject inside the middle ~70%, background may bleed to corners |
| `pass` | at most 512x512, .png/.jpg/.bmp | opaque | keep important details inside the circular boundary; shown at 150x150 (docs) | same as badge |
| `product` | at most 512x512 | opaque | same as passes (developer products) | same as badge |
| `item` | 512 source; export 256/128 | transparent | ImageLabel / ImageButton in inventories, shops, hotbars, rewards | silhouette, outline, consistent set |
| `ui-icon` | 256 source; export 128/64 | transparent | HUD glyphs at 24-48 px; white copy (`export.white`) for `ImageColor3` tinting | simple, bold, few colours |
| `panel` | small, e.g. 96x96 | transparent | `ScaleType.Slice` + `SliceCenter` (9-slice) | corners in the corners; stretch bands flat |
| `logo`, `banner` | free | transparent / any | menus, loading screens | |
| `texture` | 256-1024 | opaque | `Decal` stretches over a face; `Texture` repeats every `StudsPerTileU/V` | `tile: true` + `k.tile()` for seamless |
| `sprite` | design 512, output = pixel grid | transparent | display with `ResampleMode = Enum.ResamplerMode.Pixelated` | pixel art rules |
| `particle` | 256-1024 | transparent, usually white | `ParticleEmitter.Texture`; flipbooks `Grid2x2` / `Grid4x4` / `Grid8x8`, `FlipbookFramerate` max 30 (docs) | soft edges, white so `Color` tints it |

General:
- **Keep in-game images at or under 1024 px a side.** Larger uploads are downscaled (community reports; the docs
  do not state a limit). Upload close to the size you display for the sharpest result.
- **Transparent pixels and dark fringes**: the docs note that transparent pixels become black on upload, and Roblox's
  bilinear scaling blends the RGB of transparent pixels into edges, so a transparent PNG with black (0,0,0,0)
  pixels gets a dark halo when scaled. The engine **alpha-bleeds every export** (each fully transparent pixel takes the
  colour of the nearest visible pixel), which is what tools like PixelFix do. Community reports say mobile can still
  show faint fringes at extreme downscales: upload near display size.
- Everything uploaded is **moderated**. No real-world brands, logos, copyrighted characters, real people, personal
  information, or misleading claims ("50% off", "free UGC") on store media.
- Image thumbnails via `rbxthumb`: GameIcon / BadgeIcon / GamePass are fetched at 150x150; GameThumbnail at
  256x144 up to 768x432 (docs, assets page).

## Getting PNGs into Roblox

1. **Studio, Asset Manager → Bulk Import** (or Import): pick the PNGs; each becomes an Image asset whose id you
   can paste into `Image` properties. Simplest for a set.
2. **Creator Hub** (create.roblox.com → Development Items → Decals): upload one by one. A decal upload gives a
   Decal id; the Image id is what `ImageLabel.Image` needs (inserting the decal in Studio shows it in `Texture`).
3. **Roblox Studio MCP** (`upload_image` tool, when the Roblox_Studio MCP server is connected): it takes **http URLs**
   and returns `rbxassetid://` ids. Serve the output folder first:
   `node <skill>/scripts/rart.mjs serve out/items` (prints `http://localhost:8765/<file>.png` for each PNG), then call
   `upload_image` with those URLs and the `studio_id` from `list_roblox_studios`. Uploading creates assets on the
   user's account: confirm with the user before uploading.
4. **Game icon / thumbnails / badges / passes / products**: Creator Hub → the experience → Configure (icon,
   thumbnails), Engagement → Badges, Monetization → Passes / Developer Products. They are uploaded there, not as
   decals.
5. **Open Cloud Assets API** (scripts / CI): creates Decal assets and returns an Operation to poll; turning the
   result into an Image id needs an extra lookup (community). Prefer 1-3 for images.

Keep a map from file name to asset id in the game (e.g. a `Config/Images.luau` ModuleScript), and name files after
the ids your code uses so the mapping is mechanical.

## Displaying them

```lua
-- item / UI icon
label.Image = "rbxassetid://123"
label.ScaleType = Enum.ScaleType.Fit           -- keep aspect
label.BackgroundTransparency = 1
-- white glyph tinted in code
label.ImageColor3 = Color3.fromRGB(255, 200, 60)
-- pixel art: keep pixels sharp
label.ResampleMode = Enum.ResamplerMode.Pixelated
-- 9-slice (values come from the build output / manifest.json)
label.ScaleType = Enum.ScaleType.Slice
label.SliceCenter = Rect.new(28, 28, 68, 68)   -- in source-image pixels: left, top, right, bottom of the centre
label.SliceScale = 0.5                         -- shrink the corners on screen without new art
-- one frame of a sprite sheet (the generated <name>_sheet.luau module does this and can play an animation)
label.ImageRectOffset = Vector2.new(0, 0)
label.ImageRectSize = Vector2.new(128, 128)
```

Particle flipbook (also written to `<name>_sheet.luau`):
```lua
emitter.Texture = "rbxassetid://123"
emitter.FlipbookLayout = Enum.ParticleFlipbookLayout.Grid4x4
emitter.FlipbookMode = Enum.ParticleFlipbookMode.OneShot   -- Loop | OneShot | PingPong | Random
emitter.FlipbookFramerate = NumberRange.new(24)            -- max 30; OneShot timing follows the particle lifetime
```
Leave spacing between flipbook frames (the docs recommend it because mip filtering bleeds neighbours); the packer
insets every frame by `margin` (default 4% of a cell).

Decals and textures: `Decal` stretches over one face; `Texture` tiles by `StudsPerTileU/V`; both take `Color3` and
`Transparency`. Prefer separate textures over atlases for 3D surfaces (the whole atlas streams at the highest
resolution any part needs, docs).

## Sources

- Icons: https://create.roblox.com/docs/production/publishing/experience-icons
- Thumbnails: https://create.roblox.com/docs/production/publishing/thumbnails
- Badges: https://create.roblox.com/docs/production/publishing/badges
- Passes: https://create.roblox.com/docs/production/monetization/passes ; developer products: https://create.roblox.com/docs/production/monetization/developer-products
- ImageLabel (ImageRectOffset/Size, ResampleMode, SliceCenter, transparency note): https://create.roblox.com/docs/reference/engine/classes/ImageLabel
- 9-slice: https://create.roblox.com/docs/ui/9-slice
- Particle flipbooks: https://create.roblox.com/docs/effects/particle-emitters
- Assets and rbxthumb sizes: https://create.roblox.com/docs/projects/assets ; textures and decals: https://create.roblox.com/docs/parts/textures-decals
- Thumbnail personalization tips (Roblox staff): https://devforum.roblox.com/t/5-tips-from-roblox-staff-to-get-the-most-out-of-thumbnail-personalization/3471689
- Dark edges on scaled transparent images (community): https://devforum.roblox.com/t/pixelfix-remove-the-black-edges-on-scaled-images/201802
- Open Cloud assets (decal ids vs image ids, community): https://devforum.roblox.com/t/provide-a-stable-open-cloud-api-to-get-an-image-id-from-a-decal-id/3594046
