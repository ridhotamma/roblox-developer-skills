---
name: roblox-ui
description: Build Roblox game UI with React (react-lua - jsdotlua/react + react-roblox) in Luau that works on phones, tablets, desktop and console - responsive layout (safe areas, notches, top bar, thumb zones, size classes, device scale), input-aware design (touch, mouse, gamepad) and a scalable, modular, themeable component library (theme, primitives, components, screens, stories). Ships a drop-in Luau kit (UiProvider, Stack, Grid, Text, Button, Modal, Tabs, Toasts, a responsive HUD and shop, springs on bindings, atom state, gamepad navigation, device-matrix stories for UI Labs), an installer and component generator, and a scanner for UI mistakes (TextScaled, mouse-only events, isMobile checks, leaked effects, per-frame setState, tiny touch targets). Use this whenever the user works on Roblox UI or UX - HUDs, menus, shops, inventories, settings, ScreenGuis, React or Roact, design systems, themes - or says their UI is tiny on mobile, cut off or broken with a controller, even if they never say React or responsive.
---

# Roblox UI with React

Most Roblox UIs are designed on a 1080p monitor and shipped to players who are mostly on phones. The result is familiar: buttons too small to tap, text scaled to different sizes in every label, menus hidden under the notch or the top bar, HUD buttons under the thumbstick, nothing selectable with a controller, and a pile of LocalScripts poking at `PlayerGui.Main.Frame.Shop.Buy`. This skill builds UI the way app teams do: declarative React components, one theme config (like a Tailwind config or MUI createTheme), a responsive foundation that knows the device, and a library of small components that screens are composed from.

The guiding idea: **layout follows the room you have, interaction follows the input the player uses, and the look comes from the theme.** A screen is a pure function of its props; one controller connects it to the game.

```
Theme (palettes, scales, roundness, per-component styles)   Theme/GameTheme.luau over Theme.luau defaults
  -> Foundation (UiProvider: scale, size class, input, accessibility; Atom; Motion; Navigation)
    -> Primitives (Layer, Box, Stack, Grid, Text, Icon, Button, Scroller)
      -> Components (Card, Modal, Tabs, Toasts, ProgressBar, ItemTile, CurrencyPill)
        -> Screens (HudScreen, ShopScreen: pure props in, callbacks out)
          -> App (reads atoms, mounts screens)  <-  UiController (network, attributes)
```

## Decide the mode

| The user wants... | Do this |
|---|---|
| A UI foundation / "set up React UI" / a design system | Install the kit (below), show the layer diagram, then build their first real screen with it. Ask only what changes output: their palette or brand colours, and whether they already use another UI library. |
| To restyle the UI: brand colours, rounder or sharper corners, flat buttons, borderless cards, a seasonal or high-contrast look | Edit `UI/Theme/GameTheme.luau` with overrides (see Theming below and `references/theming.md`), never component code; run `uikit.cjs contrast`; preview with the stories' Theme control. |
| A specific screen (shop, inventory, quest log, settings, round results, loading, daily rewards) | Write down its states (empty, loading, error, success, not affordable, owned) and what changes per size class, generate it with `uikit.cjs new screen`, compose it from kit components, add a story, mount it in `App.luau`. Give the complete files. |
| "UI is tiny on mobile / cut off / doesn't work with a controller" | Run `scripts/uiscan.cjs` on their source, ask for screenshots on a phone if possible, read findings with `references/audit-checklist.md`, and give a ranked fix plan with code. Usually: scale model, safe-area layers, Activated, hit targets, gamepad selection. |
| To migrate Roact, Studio-built UI or plain Instance scripts to React | Use the migration path in `references/react-lua.md`: install the kit beside the old UI, move one screen at a time behind the same controller API, delete the old screen when the new one ships. Never a big-bang rewrite. |
| A UX review (screenshots, a flow, "why don't players buy") | Use `references/ux-patterns.md`: check the flow against the patterns and the review checklist, and report issues by player impact with a concrete fix each. |
| A single component (a slider, a timer pill, a quest card) | `uikit.cjs new component <Name>`, build it from primitives with theme references, add its story, show it on the device matrix. |

If the project is not in the `roblox-project-structure` layout, the kit still works: copy `assets/kit/client` to wherever client code lives, and point `UiController`'s three `Net` calls at their remotes.

## The stack

- **react-lua** (`jsdotlua/react` and `jsdotlua/react-roblox`, 17.2.1) from Wally: Roblox's own React port, the one the Roblox app is built with. Hooks, context, portals, plus Roblox extras: bindings (update Instance properties without re-rendering), `React.Event`, `React.Change`, `React.Tag`. `references/react-lua.md` covers the API, Luau gotchas and typing.
- **The kit** adds no other dependencies: its own small atom store, spring motor and navigation hooks. For big games, Charm (atoms with server sync) and react-spring / ripple slot in later; the shapes match.
- **UI Labs** (or Flipbook) Studio plugin for stories. Every kit screen has a story that renders it on eight simulated devices at once.
- roblox-ts teams use `@rbxts/react`, which is the same library; the patterns and the kit's structure carry over directly.

Recommend React for any game with more than a HUD. If the user is committed to Fusion or Vide, the responsive model, theme structure and UX rules here still apply; only the component syntax differs.

## The responsive model

Two independent questions drive every decision; never derive one from the other ("isMobile" checks are the classic bug):

1. **How much room is there?** UiProvider measures the safe area (inside notches, home indicator and the Roblox top bar), computes a **scale** and the room in **design units** (1 unit = 1 pixel at scale 1, like a point on a phone), and classifies it: **Compact** (short side under 500 units: phones), **Medium** (under 1100 wide: tablet portrait, small windows), **Expanded** (desktop, laptop, console, tablet landscape).
2. **How is the player interacting?** `UserInputService.PreferredInput` gives **Touch**, **Pointer** or **Gamepad**, and changes live when they pick up a controller. `GuiService:IsTenFootInterface()` marks a TV.

Scale is clamped per input (`Tokens.Scale`): phones stay at 1 so 44 units is a 44-point thumb target; desktops scale with resolution so a layout gets roughly 1600 x 860 units on any monitor; TVs scale up about 1.4x for reading across a room. Layout changes at size classes; it never shrinks a desktop design onto a phone.

| Device (preview preset) | Scale | Size class |
|---|---|---|
| Phone, either orientation | 1.00 | Compact |
| Tablet portrait / landscape | 1.14 / 1.03 | Medium / Expanded |
| Laptop 1366x768 / Desktop 1080p | 0.82 / 1.18 | Expanded |
| Console TV 1080p | 1.42 | Expanded |

`node <skill>/scripts/uikit.cjs devices` prints the full table, or `--size 1024x768 --input touch` for any screen. `references/responsive-layout.md` has the safe-area layers, thumb zones, layout toolbox and the responsive patterns (reflow, master-detail to stack, sheet vs dialog, sticky action bar).

## Theming (design config)

Every visual decision lives in one theme, so a game is restyled without touching component code, the way Tailwind's config, MUI's `createTheme` and shadcn's CSS variables work on the web:

```lua
-- UI/Theme/GameTheme.luau: only what differs from the defaults
return Theme.create({
	roundness = 1.5, -- every corner step 1.5x rounder (0 = square)
	palettes = { Dark = { Accent = Color3.fromRGB(190, 70, 0) } }, -- brand colour
	components = {
		Button = { radius = "Full", depth = 0 }, -- flat pill buttons
		Card = { radius = "XL", stroke = false }, -- rounder, borderless cards
	},
})
```

- **Theme keys**: palettes (with semantic names: Surface, Accent, TextOnAccent...), rarity, font, type scale, space, radius + `roundness`, stroke, control and icon sizes, transparency, springs, and `components`: Button (radius, lip depth, tints, padding, variants), Card, Modal, Tile, Toast, Pill, ProgressBar, Tabs, Text, Scroller. Add your own components' entries too.
- **References, not values**: props and theme entries take names that resolve against the active theme (`color = "Accent"`, `radius = "L"`, `padding = "M"`, `thickness = "Thin"`), so one palette or scale change reaches every component.
- **Overrides merge** key by key; unknown keys warn once (typos never silently do nothing); new palettes start from the default one; new Button variants are usable by name.
- **Live switching**: `UiController:SetTheme(theme)` and `UiController:SetPalette("HighContrast")` restyle everything at runtime (settings toggles, events).
- **Contrast is checked**: `node <skill>/scripts/uikit.cjs contrast --project .` tests every palette of every theme against WCAG (text 4.5:1, UI parts 3:1).
- Not themeable on purpose: hit targets, breakpoints, device scale and layers (ergonomics, not looks).

`references/theming.md` has the web-library mapping, recipes, every key with its default, the merge rules and how to theme your own components.

## Rules that make UI work everywhere

1. **Theme only.** No raw `Color3`, corner size, font or spring in a component: pass theme references (`color = "Accent"`, `radius = "L"`) or read `ui.theme.components.<Name>`. A component with a new knob gets a theme entry. Consistency and re-theming come free, and reviews get shorter.
2. **Size with `ui.px(units)`** for anything that should be physically consistent (padding, text, buttons, icons); **Scale** for things that are a share of their parent (a column that is half the panel). Never `TextScaled`: it makes every label a different size and ignores the player's Text Size setting.
3. **Change layout at size classes, not device names.** `Responsive.pick(ui.sizeClass, { Compact = ..., Expanded = ... })` mobile-first; components that can measure (Grid) adapt continuously.
4. **Content goes in safe layers.** `Layer` with `insets = "Safe"` for anything readable or tappable; `"None"` only for backdrops and art. Layers own DisplayOrder (`Tokens.Layers`), so stacking never depends on mount order.
5. **Every interactive element works with every input:** `Activated` (not `MouseButton1Click`), at least `ui.hitTarget` (44 units) on touch and gamepad, selectable with a visible focus ring, reachable by gamepad when its menu opens (`Navigation.useFocus`), and every shortcut has a visible button. The kit's `Button` does all of it.
6. **Respect the thumbs.** On touch the thumbstick owns the bottom-left and jump owns the bottom-right; HUD buttons go at the left edge or top, primary menu actions at the bottom of sheets where thumbs rest. Keep the HUD sparse: balance, two or three menu buttons, context prompts.
7. **Screens are pure.** Data in through props, intent out through callbacks (`onBuy(itemId)`). Only `UiController` talks to remotes and attributes. Every screen can then be previewed and tested without a server, and the server stays the only authority (a click is a request, never a fact).
8. **Put state where it belongs:** `useState` for UI-only state inside one screen (selected tab); atoms for state shared across screens or fed by the game (coins, which menu is open); bindings for anything that changes every frame (bars, timers, animation). Never set React state per frame.
9. **Effects clean up.** Every connection, bound action, timer and created Instance in `useEffect` is undone in the returned cleanup; dependency arrays never contain `nil` (use `x or false`).
10. **Animate with springs on bindings** (`Motion.useSpring`): one number 0 to 1 mapped onto properties, no re-render per frame, interruptible, and instant when `GuiService.ReducedMotionEnabled` is on. UI transitions finish in about 150-300 ms.
11. **Accessible by default:** text contrast 4.5:1 on its surface, background transparency multiplied by `GuiService.PreferredTransparency`, text that grows with `PreferredTextSize` (AutomaticSize, no TextScaled), colour never the only signal (rarity has a word too), sound never the only signal.
12. **Built for translation:** buttons and labels hug their text, room for 30-50% longer strings, `localize = false` on names and numbers so auto-translation leaves them alone.
13. **Order children with `layoutOrder`.** Keyed children have no order in Luau; Stacks and Grids sort by LayoutOrder.
14. **See it on every device before calling it done.** A story with `Devices.Matrix` shows phone, tablet, laptop, desktop and TV side by side, with the top bar and thumb zones drawn on.

## Installing the kit

```bash
node <skill>/scripts/uikit.cjs install --project ./my-game     # add --dry-run to preview
```

It copies `assets/kit/client` into `src/client` (never overwriting without `--force`, and never overwriting `UI/Theme/GameTheme.luau` at all), adds `React` and `ReactRoblox` to `wally.toml`, and reports what else the project needs. Then tell the user:

1. `sh scripts/install-packages.sh` (or `wally install`), then `rojo serve` and Play.
2. Declare `PurchaseItem = "Event", -- (itemId: string) ask to buy` in `shared/Net/init.luau` and handle it in a server Service that checks price, balance and ownership (without it the shop explains what is missing).
3. Delete the scaffold's `Controllers/HudController.luau` and `UI/HudScreen.luau`: `UiController` replaces them.
4. Install the UI Labs plugin and open the stories (`UI/Stories/UI.storybook`) to see every screen on every device.
5. Replace `AppState.SAMPLE_ITEMS` with their catalogue (`UiController:SetItems`), and feed ownership with `UiController:SetOwned`.
6. Put their brand into `UI/Theme/GameTheme.luau` and run `uikit.cjs contrast --project .`.

The kit mirrors the `roblox-project-structure` layout (`client` maps to `StarterPlayerScripts.Client`); `UiController` is started by the scaffold's Loader and uses its `Net` module.

| File | Does |
|---|---|
| `client/Controllers/UiController.luau` | Mounts React (Folder root + portal into PlayerGui) with GameTheme, mirrors the `Coins` attribute and `Notify` toasts into atoms, turns UI actions into remote requests; `OpenShop`, `Toast`, `SetItems`, `SetOwned`, `SetTheme`, `SetPalette` for other controllers. |
| `client/UI/App.luau` | Root: UiProvider, reads atoms, mounts HUD, shop and toasts. |
| `client/UI/AppState.luau` | The UI's atoms (including the active theme and palette) and the actions screens may request; sample catalogue. |
| `client/UI/Theme/Tokens.luau` | Default values (palettes Dark and HighContrast, rarity, spacing, radii, strokes, Builder Sans type scale, control and icon sizes, springs, transparency) and system constants (hit targets, layers, breakpoints, scale profiles). |
| `client/UI/Theme/Theme.luau` | The theme schema and defaults for every component, `Theme.create(overrides, base)` with merging and validation, and the reference resolvers. |
| `client/UI/Theme/GameTheme.luau` | The user's theme: overrides only, with commented examples. Never overwritten by the installer. |
| `client/UI/Theme/Presets.luau` | Example themes built on GameTheme (Sharp, Soft, Arcade) and `Presets.get(name)` for stories. |
| `client/UI/Foundation/Responsive.luau` | Pure maths: scale, size class, orientation, `pick`, grid columns. |
| `client/UI/Foundation/UiContext.luau` | The `Ui` type and `useUi()`: metrics, input, accessibility settings, theme and palette, `px`, `color`, `space`, `stroke`, `corner`, `transparency`, `hitTarget`. |
| `client/UI/Foundation/UiProvider.luau` | Measures the safe area (probe ScreenGui), PreferredInput, ReducedMotion and PreferredTransparency, event-driven; or simulates a device for stories. |
| `client/UI/Foundation/Atom.luau` | Observable value plus `Atom.use(atom, selector)`. |
| `client/UI/Foundation/Motion.luau` | `useSpring(target)` returning a binding; runs only while moving. |
| `client/UI/Foundation/Navigation.luau` | `useShortcut(keys, handler, enabled)` and `useFocus(ref, active)` for gamepad and keyboard. |
| `client/UI/Foundation/NumberFormat.luau` | `Grouped` (1,234) and `Short` (12.5K) for prices and balances. |
| `client/UI/Primitives/Decorate.luau` | Shared style props (radius, stroke, padding, constraints, flex) to UI* modifiers. |
| `client/UI/Primitives/Layer.luau` | One ScreenGui per layer with the right ScreenInsets; a Frame in stories. |
| `client/UI/Primitives/Box.luau` | Token-styled surface. |
| `client/UI/Primitives/Stack.luau` | Row / column with gap, alignment, wrap and flex fill (UIListLayout). |
| `client/UI/Primitives/Grid.luau` | Auto-column grid from a minimum item width. |
| `client/UI/Primitives/Text.luau` | Type-scale text: hug, wrap-to-width or fixed; outline; localisation switch. |
| `client/UI/Primitives/Icon.luau` | Square image from the theme's icon steps, tint, sprite sheets. |
| `client/UI/Primitives/Button.luau` | Variants and sizes, hit target, hover / press / focus / disabled states, gamepad glyph hints, badges. |
| `client/UI/Primitives/Scroller.luau` | ScrollingFrame with automatic canvas and input-aware scroll bar. |
| `client/UI/Components/Card.luau` | The themed surface for grouped content; corners, colour, border and padding from `components.Card`. |
| `client/UI/Components/Modal.luau` | Sheet on phones, dialog elsewhere; scrim, B to close, gamepad focus, header, footer. |
| `client/UI/Components/Tabs.luau` | Scrollable tab strip, LB / RB on gamepad. |
| `client/UI/Components/Toasts.luau` | `Toasts.push(message, tone)` from anywhere, and the host that shows them. |
| `client/UI/Components/ProgressBar.luau` | Number (springs) or binding (per frame) progress. |
| `client/UI/Components/ItemTile.luau` | Grid tile: picture, name, rarity word and colour, price or Owned, select on gamepad focus. |
| `client/UI/Components/CurrencyPill.luau` | Balance chip with count-up animation and a "+" to the shop. |
| `client/UI/Screens/HudScreen.luau` | Responsive HUD that keeps thumb zones clear; Y / X shortcuts on gamepad. |
| `client/UI/Screens/ShopScreen.luau` | Tabs, auto-column grid, details column or pinned buy bar by size class. |
| `client/UI/Stories/Devices.luau` | Device presets and `Devices.Matrix` / `Devices.Preview` with top bar and thumb-zone overlays. |
| `client/UI/Stories/UI.storybook.luau` | The storybook UI Labs lists. |
| `client/UI/Stories/Button.story.luau`, `HudScreen.story.luau`, `ShopScreen.story.luau` | Stories on the device matrix with controls. |

## Building a new screen or component

```bash
node <skill>/scripts/uikit.cjs new screen QuestLogScreen --project ./my-game
node <skill>/scripts/uikit.cjs new component QuestCard --project ./my-game   # or: new primitive
```

Each writes the module in the kit's shape and a story on the device matrix. Then:

1. **States first.** List what the player can see: empty, loading, error, normal, disabled actions (not affordable, owned, locked), and long text. Design each, not just the happy path.
2. **Per size class.** Decide what changes on Compact (stack instead of columns, sheet instead of dialog, pinned action bar, secondary info hidden behind a tap). Write it with `Responsive.pick` or a branch on `ui.sizeClass`.
3. **Compose from the kit.** Stack and Grid for layout, Text for every string, Button for every action, Modal for every menu. Reach for a raw Instance only for something the kit doesn't do, still sized with `ui.px` and coloured from the palette.
4. **Wire it.** Props in, callbacks out; add an "open" atom and actions in `AppState`, mount in `App`, and handle the network in `UiController`.
5. **Preview and scan.** Story on all devices, then `uiscan.cjs` on the source.

State the files you are adding and what each owns before writing them, and give complete files, not fragments.

## Scanning UI code

```bash
node <skill>/scripts/uiscan.cjs <src-folder-or-file> [--json] [--min low] [--fail-on medium]
```

Finds `TextScaled`, mouse-only button events, `TouchEnabled` "isMobile" checks, raw-pixel breakpoints and fixed-resolution scaling, manual top-bar inset maths, `IgnoreGuiInset`, side effects in component bodies, effects without cleanup or dependencies, React state set per frame, buttons under 44 points, code-made ScreenGuis without `ResetOnSpawn = false`, hover-only interactions, hard-coded colours, fonts and corners in components, layouts without SortOrder, Global ZIndex, CanvasGroups, deprecated fonts, legacy Roact and long `WaitForChild` chains. Every rule with its fix is in `references/audit-checklist.md`. It is a pattern scan: confirm on a device, and suppress reviewed lines with `-- ui:ignore <rule-id>`. Needs only Node.

## Output style

- Lead with what the player experiences ("on a phone the Buy button is 28 points tall and sits under the jump button"), then the cause and the fix.
- Give complete, runnable Luau in the kit's shape: strict mode, theme references, `ui.px`, `layoutOrder` on every child, effects with cleanup. Name the file each block belongs in.
- For layouts, say what each size class shows, and when an ASCII sketch per size class makes the structure clearer, include one.
- Say what you verified (scanner, story on the device matrix) and what needs a real device (feel of touch targets, performance on a low-end phone).

## Related skills

`roblox-project-structure` (layout, Loader, Net, where UI code lives), `roblox-game-design` (what the HUD and menus must communicate, onboarding, shop placement), `roblox-performance` (UI rendering costs, per-frame budgets, PerfQuality on low-end devices), `roblox-security` (validating every UI-triggered remote on the server), `roblox-atmosphere` (colour grading the world the HUD sits over), `roblox-vfx` (effects for rewards and purchases).

## References

- `references/react-lua.md`: setup and mounting, elements and host props, events, change signals, refs and tags, children and keys, hooks with Luau gotchas, bindings, context, memo and re-render control, portals, strict typing, testing with Jest Lua, migrating from Roact, common errors.
- `references/responsive-layout.md`: the device table, design units and scale profiles, size classes, input modes and ten-foot UI, safe areas and ScreenInsets, the top bar, mobile control zones, the layout toolbox (scale vs offset, AnchorPoint, flex lists, grids, AutomaticSize, constraints), responsive patterns, text sizing, and how to test.
- `references/theming.md`: how the theme maps to Tailwind / MUI / shadcn, recipes (brand colour, roundness, flat or pill buttons, borderless cards, variants, seasonal palettes, live switching, fonts), reference values, every theme and component key with its default, merge rules, the contrast check, and theming your own components.
- `references/component-system.md`: the layers and folder layout, component API conventions, composition patterns, theming and tokens, state placement and data flow, adding components, stories and tests, performance of large UIs, anti-patterns.
- `references/ux-patterns.md`: game UI principles, HUD layout per device, menus and navigation, shops and purchase flows, inventories, onboarding, notifications, feedback and juice, loading / empty / error states, settings, accessibility, localisation, gamepad navigation, and the UX review checklist and report format.
- `references/audit-checklist.md`: every scanner rule with why and fix, manual device / input / accessibility passes, the report format, and the staged plan for fixing an existing UI.
- `scripts/uikit.cjs`: installer, generator, device table and contrast check. `scripts/uiscan.cjs`: the scanner. `scripts/selftest.cjs` checks both, the kit and the docs; run it after editing any of them.
- `assets/kit/`: the Luau kit above. `assets/templates/`: the generator's templates.
