# Theming and design config

How to restyle the whole UI (colours, corner roundness, borders, fonts, spacing, motion, and each component's look) from one config file, without touching component code. The model is the one web UI libraries use: Tailwind's config, MUI's `createTheme`, shadcn's CSS variables.

Contents: 1 How it maps to web libraries · 2 Files · 3 Recipes · 4 Reference values · 5 Theme keys · 6 Component styles · 7 Merge rules · 8 Contrast · 9 What isn't themeable · 10 Theming your own components · 11 Moving hard-coded styles into the theme

---

## 1. How it maps to web libraries

| Idea | On the web | In this kit |
|---|---|---|
| Design scales | Tailwind `theme.spacing`, `borderRadius`, `fontFamily` | `space`, `radius`, `stroke`, `type`, `icon`, `control`, `font` in the theme |
| One theme object, overrides merged in | MUI `createTheme({ ... })` | `Theme.create(overrides, base)` |
| Per-component defaults | MUI `components.MuiButton.styleOverrides` | `components.Button`, `components.Card`, ... |
| Semantic colour variables | shadcn `--primary`, `--card`, `--border` | palette keys referenced by name: `"Accent"`, `"Surface"`, `"Border"` |
| One corner knob | shadcn `--radius` | `roundness` (multiplies the radius scale) |
| Variants | cva / MUI `variants` | `components.Button.variants` |
| Dark / light / high contrast | `.dark` class / MUI palette mode | `palettes` + `UiController:SetPalette(name)` |
| Components you own | shadcn's copy-in CLI | `uikit.cjs install` copies the kit into your project; `GameTheme.luau` is never overwritten |
| Utility classes in markup | `className="rounded-lg p-4 bg-card"` | props with references: `radius = "L", padding = "L", color = "Surface"` |

## 2. Files

| File | Role | Edit it? |
|---|---|---|
| `UI/Theme/GameTheme.luau` | Your theme: overrides on top of the defaults. App and UiController use it. | Yes, this is the file. The installer never overwrites it. |
| `UI/Theme/Theme.luau` | The schema (types), the defaults for every component, `Theme.create`, validation and the resolvers. | Rarely: when adding a key every theme should have. |
| `UI/Theme/Tokens.luau` | The default values of the scales and palettes, plus system constants (hit targets, layers, breakpoints, scale). | Rarely: prefer overriding in GameTheme. |
| `UI/Theme/Presets.luau` | Example themes built on yours: Sharp, Soft, Arcade. Stories switch to them. | Optional: copy what you like into GameTheme, or add presets. |

Components never read `Tokens` for looks; they read `ui.theme` (from `UiContext.useUi()`), so the active theme is the only source of style.

## 3. Recipes

All in `GameTheme.luau`, inside `Theme.create({ ... })`.

**Brand colour.** Primary buttons, selected tabs, progress fills and links use `Accent`.
```lua
palettes = { Dark = { Accent = Color3.fromRGB(190, 70, 0) } },
```
`TextOnAccent` (white) is shared by the Accent, Positive and Danger fills, so pick an accent dark enough for white text, then run `uikit.cjs contrast`.

**Rounder or sharper everywhere.** `roundness = 0` square, `0.5` subtle, `1` default, `1.5` friendly, `2` very round. Applies to every component whose radius is a step name ("M", "L"); explicit numbers and "Full" are unaffected.
```lua
roundness = 1.5,
```

**Pill buttons, flat buttons.**
```lua
components = { Button = { radius = "Full", depth = 0 } },
```

**Borderless, rounder cards (and dialogs).**
```lua
components = {
	Card = { radius = "XL", stroke = false },
	Modal = { stroke = false },
},
```

**A new button variant.** New variants start from `{ fill = false, text = "Text", stroke = false }`.
```lua
components = { Button = { variants = { Gold = { fill = "Currency", text = "Background" } } } },
-- e(Button, { text = "VIP", variant = "Gold" })
```

**A seasonal palette, switched live.** A new palette starts as a copy of the default one, so list only what changes.
```lua
palettes = { Halloween = { Accent = Color3.fromRGB(200, 70, 0), Background = Color3.fromRGB(20, 10, 4) } },
```
```lua
UiController:SetPalette("Halloween")   -- and SetPalette(nil) to go back
```

**High contrast from a settings toggle.** The kit ships a `HighContrast` palette: `UiController:SetPalette(if on then "HighContrast" else nil)`.

**A whole different theme at runtime** (an event, a VIP look): build it on your game theme and set it.
```lua
local Winter = Theme.create({ palettes = { Dark = { Accent = Color3.fromRGB(30, 110, 200) } }, roundness = 1.5 }, GameTheme)
UiController:SetTheme(Winter)   -- SetTheme(nil) returns to GameTheme
```

**A different font.** Any family asset; Builder Sans (the default) ships with every client, others download before first use, so preload them on the loading screen.
```lua
font = "rbxasset://fonts/families/Montserrat.json",
```

**Bolder, bigger button text.**
```lua
type = { Button = { Size = 18, Weight = Enum.FontWeight.ExtraBold } },
```

**Snappier or bouncier motion.**
```lua
springs = { Snappy = { Frequency = 4.5, Damping = 0.75 } },  -- a little overshoot on every transition
```

**One-off overrides** stay on props: `e(Card, { radius = "S", stroke = false })` wins over the theme for that card only.

## 4. Reference values

Theme values and primitive props accept references, resolved against the active theme at render time:

| Type | Accepts | Resolved by | Examples |
|---|---|---|---|
| `ColorRef` | a palette key, a rarity name, or a `Color3` | `ui.color(ref)` | `"Accent"`, `"SurfaceRaised"`, `"Epic"`, `Color3.fromRGB(...)` |
| `SpaceRef` | a space step or design units | `ui.space(ref)` (pixels) | `"S"`, `"L"`, `20` |
| `RadiusRef` | a radius step (times `roundness`), design units, or `"Full"` | `ui.corner(ref)` (UDim) | `"M"`, `"XL"`, `"Full"`, `6` |
| `StrokeRef` | a stroke step or design units | `ui.stroke(ref)` (pixels, at least 1) | `"Thin"`, `"Thick"`, `2` |

Primitives take them directly: `e(Stack, { gap = "S", padding = "L", color = "Surface", radius = "L", stroke = { color = "Border", thickness = "Thin" } })`.

## 5. Theme keys

| Key | Type | Default | Notes |
|---|---|---|---|
| `name` | string | "Default" | Shown in story controls and warnings. |
| `defaultPalette` | string | "Dark" | The palette used when none is chosen. |
| `palettes` | map of palettes | Dark, HighContrast | Each palette has every key of `Tokens.Palette`: Background, Surface, SurfaceRaised, SurfaceSunken, Border, Scrim, Text, TextMuted, TextOnAccent, Accent, Positive, Danger, Warning, Currency, Focus. New palettes start from the default palette. |
| `rarity` | map of Color3 | Common, Uncommon, Rare, Epic, Legendary | Usable as colour references ("Epic"). Add rarities freely. |
| `font` | string | Builder Sans | A font family asset id. |
| `type` | map of { Size, Weight } | Display 40, Title 28, Heading 20, Button 16, Body 16, Label 14, Caption 12 | Text variants by name; add your own. |
| `space` | map of numbers | None 0, XXS 2, XS 4, S 8, M 12, L 16, XL 24, XXL 32, XXXL 48 | Design units. |
| `roundness` | number | 1 | Multiplies every `radius` step. |
| `radius` | map of numbers | None 0, S 4, M 8, L 12, XL 16 | Design units before `roundness`. |
| `stroke` | map of numbers | Thin 1, Regular 2, Thick 3 | Border widths in design units. |
| `control` | Small / Medium / Large | 32 / 44 / 56 | Control heights (buttons, tabs, pills); never below the hit target on touch. |
| `icon` | map of numbers | S 16, M 24, L 32, XL 48 | Icon sizes. |
| `transparency` | Surface / Hud / Scrim / Disabled | 0.04 / 0.25 / 0.4 / 0.5 | Multiplied by the player's Background Transparency setting where it applies. |
| `springs` | map of { Frequency, Damping } | Snappy, Bouncy, Gentle | Used by `Motion.useSpring(target, "Gentle")`. |
| `components` | map of styles | below | One entry per component; add entries for your own. |

## 6. Component styles

Defaults live in `Theme.luau` (`DEFAULTS.components`). Colours are `ColorRef`, sizes `SpaceRef` / `RadiusRef` / `StrokeRef` unless noted.

### Button

| Key | Default | Controls |
|---|---|---|
| `radius` | "M" | Corner radius ("Full" for pills). |
| `depth` | 3 | The darker lip under solid buttons, design units; 0 for flat buttons. Pressing moves the face down by this much. |
| `hoverTint` | 0.12 | How far a hovered fill moves toward white (pointer only). |
| `disabledMix` | 0.6 | How far a disabled fill moves toward Surface. |
| `strokeWidth` | "Thin" | Border width for variants with a `stroke`. |
| `focusWidth` | "Thick" | Gamepad / keyboard focus ring width (at least 2 px). |
| `gap` | "S" | Between icon, label and glyph hint. |
| `padding` | Small "M", Medium "L", Large "XL" | Horizontal padding per size. |
| `text` | Small "Label", Medium "Button", Large "Heading" | Type style per size. |
| `icon` | Small "S", Medium "M", Large "L" | Icon step per size. |
| `badge` | size 18, dot 12, color "Danger", text "TextOnAccent" | The count badge and the dot. |
| `variants` | Primary, Secondary, Positive, Danger, Ghost | Each `{ fill, text, stroke }`; `false` for no fill or no border. Add your own. |

### Card

| Key | Default | Controls |
|---|---|---|
| `radius` | "L" | Corner radius. |
| `color` | "Surface" | Background. |
| `raisedColor` | "SurfaceRaised" | Background with `tone = "Raised"`. |
| `transparency` | 0.04 | Background transparency. |
| `stroke` | "Border" | Border colour, or `false` for none. |
| `strokeWidth` | "Thin" | Border width. |
| `padding` | "L" | Inner padding. |
| `gap` | "S" | Space between children. |

### Modal

| Key | Default | Controls |
|---|---|---|
| `radius` | "L" | Dialog corners (phone sheets are always square and full-screen). |
| `color` | "Surface" | Panel background. |
| `transparency` | 0.04 | Panel transparency. |
| `stroke` | "Border" | Dialog border, or `false`. |
| `strokeWidth` | "Thin" | Border width. |
| `padding` | "L" | Body padding and header inset. |
| `margin` | "XL" | Minimum gap between a dialog and the safe-area edge; also how far it rises in when opening. |
| `scrim` | 0.4 | Transparency of the dimmed world behind. |
| `width` | 640 | Default dialog width, design units (props override). |
| `height` | 560 | Default dialog height. |
| `headerHeight` | 56 | Title bar height. |
| `dividerColor` | "Border" | Line under the header. |
| `footerColor` | "SurfaceRaised" | Footer background. |
| `footerPadding` | "M" | Footer padding. |

### Tile

| Key | Default | Controls |
|---|---|---|
| `radius` | "L" | Tile corners. |
| `color` | "Surface" | Background. |
| `selectedColor` | "SurfaceRaised" | Background when selected. |
| `stroke` | "Border" | Border when `rarityBorder` is off. |
| `rarityBorder` | true | Border in the item's rarity colour. |
| `selectedStroke` | "Accent" | Border when selected (gamepad focus always uses palette Focus). |
| `strokeWidth` | "Regular" | Border width. |
| `selectedStrokeWidth` | "Thick" | Border width when selected or focused. |
| `padding` | "S" | Inner padding. |
| `gap` | "XS" | Space between picture, name and footer. |
| `artRadius` | "M" | Corners of the picture well. |
| `artColor` | "SurfaceSunken" | Picture well background (also the shop's details picture). |

### Toast

| Key | Default | Controls |
|---|---|---|
| `radius` | "M" | Corners. |
| `color` | "Surface" | Background. |
| `transparency` | 0.04 | Background transparency once shown. |
| `strokeWidth` | "Regular" | Border width (colour comes from the tone). |
| `maxWidth` | 420 | Width cap, design units. |
| `paddingX` | "L" | Horizontal padding. |
| `paddingY` | "M" | Vertical padding. |
| `gap` | "S" | Space between stacked toasts. |
| `offset` | "S" | Distance from the top of the safe area. |
| `tones` | Info "Accent", Positive "Positive", Danger "Danger" | Border colour per tone. |

### Pill

| Key | Default | Controls |
|---|---|---|
| `radius` | "Full" | The currency chip's corners. |
| `color` | "Surface" | Backing colour over the world. |
| `transparency` | 0.25 | Backing transparency. |
| `gap` | "S" | Between coin, amount and "+". |
| `glyph` | "Currency" | Coin colour. |

### ProgressBar

| Key | Default | Controls |
|---|---|---|
| `radius` | "Full" | Track and fill corners. |
| `height` | 14 | Default height, design units. |
| `track` | "SurfaceSunken" | Empty part. |
| `fill` | "Accent" | Filled part (the `color` prop overrides per bar). |

### Tabs

| Key | Default | Controls |
|---|---|---|
| `selected` | "Primary" | Button variant of the selected tab. |
| `idle` | "Ghost" | Button variant of the other tabs. |
| `size` | "Small" | Button size. |
| `gap` | "XS" | Space between tabs. |

### Text

| Key | Default | Controls |
|---|---|---|
| `lineHeight` | 1.1 | Line height for every Text. |
| `outlineColor` | black | Outline colour for `outline = true` text (HUD over the world). |
| `outlineWidth` | 1.5 | Outline width, design units. |
| `outlineTransparency` | 0.35 | Outline transparency. |

### Scroller

| Key | Default | Controls |
|---|---|---|
| `barWidth` | 6 | Scroll bar width with a pointer, design units. |
| `touchBarWidth` | 3 | Scroll bar width on touch and gamepad. |
| `barColor` | "TextMuted" | Scroll bar colour. |
| `barTransparency` | 0.4 | Scroll bar transparency. |

## 7. Merge rules

`Theme.create(overrides, base)` deep-merges `overrides` into `base` (default: the kit's default theme):

- Tables merge key by key; any other value replaces. `false` is a value (e.g. `stroke = false`).
- **Unknown keys warn once in Output and are ignored** (`[Theme] unknown key "components.Button.raduis" ignored (typo?)`). Maps that accept new keys: `palettes`, `rarity`, `type`, `space`, `radius`, `stroke`, `icon`, `springs`, `components`, and `components.Button.variants`.
- A new palette starts as a copy of the base's default palette; a new Button variant starts from `{ fill = false, text = "Text", stroke = false }`; a new component entry is taken as written.
- A string in a colour field (`color`, `fill`, `stroke`, `track`, ...) that isn't a palette key or rarity warns.
- The result is frozen. Build variants of a theme with `Theme.create(moreOverrides, thatTheme)` rather than mutating it.
- `theme.radius` holds the scale with `roundness` applied; `theme.config` holds the merged settings `Theme.create` extends.

## 8. Contrast

```bash
node <skill>/scripts/uikit.cjs contrast --project .        # or --ui path/to/UI, add --verbose for every pair
```

It reads `Tokens.luau`, `GameTheme.luau` and `Presets.luau` as written, builds each theme the way `Theme.create` does, and checks every palette: body text and muted text on every surface (4.5:1), text on Accent / Positive / Danger fills (4.5:1), currency text (4.5:1), rarity names on Surface and SurfaceRaised (4.5:1), and Warning, Accent and the focus ring as UI parts (3:1). It exits 1 on any failure, so it can run in CI. The selftest also checks that `GameTheme.luau`'s commented examples pass if uncommented.

## 9. What isn't themeable, and why

- **Hit targets, breakpoints, device scale, layers** (`Tokens.HitTarget`, `Breakpoints`, `Scale`, `Layers`): ergonomics and device behaviour, not looks. A theme that shrinks touch targets breaks phones; change these deliberately in Tokens, with a device test.
- **Layout behaviour**: phones get full-screen sheets, the HUD keeps thumb zones clear. That's the responsive model (`references/responsive-layout.md`), not style.
- **Accessibility responses**: Reduced Motion still snaps springs and PreferredTransparency still applies, whatever the theme.

## 10. Theming your own components

Give a component its own entry so games can restyle it without editing it:

```lua
-- GameTheme.luau (or a Theme.create base shared by your games)
components = { QuestCard = { radius = "XL", accent = "Positive", padding = "L" } },
```
```lua
-- QuestCard.luau
local style = ui.theme.components.QuestCard or { radius = "L", accent = "Accent", padding = "L" }
return e(Card, { radius = style.radius, padding = style.padding }, {
	Bar = e(Box, { color = style.accent, size = UDim2.new(0, ui.px(4), 1, 0), layoutOrder = 1 }),
	...
})
```

If the component ships with the kit, add its defaults to `DEFAULTS.components` in `Theme.luau` and a section here; the selftest checks that every key a kit component reads has a default and is documented.

## 11. Moving hard-coded styles into the theme

The scanner's `hardcoded-style` rule flags `Color3.fromRGB / fromHex / fromHSV / new(...)` (other than pure black or white), `Font.new` and literal `CornerRadius = UDim.new(0, n)` inside UI components (theme files and stories are exempt):

1. For each flagged colour, find or add the palette key it means ("this grey is SurfaceRaised") and pass the name.
2. For corners, use a radius step; if a component needs its own knob, add it to that component's theme entry.
3. For fonts, use Text variants (and `type` / `font` in the theme).
4. Re-run `uiscan.cjs --min low` and `uikit.cjs contrast`.
