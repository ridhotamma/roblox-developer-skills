# Pixel art rules (and how the engine applies them)

1. **Grid first**: pick the sprite size from the display size: 16x16 for tiny pickups and tiles, 24-32 for items,
   32-64 for characters. Roblox displays it with `ResampleMode = Pixelated`, scaled by whole multiples where possible
   (16 px sprite at 48 or 64 px on screen, not 50).
2. **Limited palette**: 8-32 colours for a whole game. Ramps of 3-5 shades per material with hue shifting (shadows
   cooler, highlights warmer, ~10-20° per step), saturation highest mid-ramp, never pure black shadows. Named Lospec
   palettes: `pico8` (16), `sweetie16`, `endesga32`, `gameboy` (4); `auto` makes k-means colours from the art itself.
3. **Clusters, not noise**: shapes are built from clumps of the same colour. Single stray pixels ("orphans") read as
   noise; the engine's cleanup merges them into the majority neighbour.
4. **Outline**: 1 px. Default is darker than both the object and the background. **Selective outline** (the
   engine's default): each outline pixel is a dark version of the colour it borders, so the line is lighter on lit
   sides and darker in shadow. Use a fixed colour (`outline: '#1a1c2c'`) for a bolder look.
5. **Light from one side** (top-left); shade with 2-3 bands (`toon`), not gradients. Avoid pillow shading.
6. **Anti-aliasing by hand, sparingly**: an in-between colour where a curve steps, chosen by value; inside the
   silhouette only; skip it on tiny sprites. The engine does not anti-alias (hard alpha), which suits sprites at
   16-32 px. For larger sprites add AA pixels with a hand grid or accept the crisp look.
7. **Dithering** (checkerboard mixing of two colours) for gradients on big areas; `dither: 0.5` applies ordered
   (Bayer) dithering during palette snapping. Leave it at 0 for small sprites.
8. **Readable at 1x**: check the 1x preview in the review sheet; if two neighbouring colours blend, push them
   apart in value.

Two ways to make it:
- **Converted** (`pixel: {...}` on vector layers): fast, consistent across a set and across animation frames, good
  for 16-48 px. Draw shapes bold (thin parts under one grid cell disappear) and shade with `toon`.
- **Hand-placed** (`pixels: { palette, rows }`): full control; best for 8-16 px icons, characters' faces and
  anything where single pixels matter. You can also convert first, then copy the grid into `pixels` rows and fix
  individual pixels.

Animation: `frames` on a pixel asset renders each frame, snaps every frame to the SAME palette (from frame 1) and
packs a sheet; `<name>_sheet@Nx.png` is the upscaled copy (capped at 1024).

Sources: https://pixelparmesan.com/anti-aliasing-fundamentals-for-pixel-artists ,
https://lospec.com/articles/pixel-art-outlines-part-2-using-color , https://www.slynyrd.com/blog/2018/1/10/pixelblog-1-color-palettes
