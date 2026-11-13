# A scalable, modular component system

How the kit is organised so a UI can grow from one HUD to forty screens without turning into copy-pasted frames: the layers, the API conventions every component follows, composition, theming, where state lives, and how to add to it.

Contents: 1 Layers and folders · 2 Component API conventions · 3 Composition patterns · 4 Theming · 5 State placement and data flow · 6 Adding a component · 7 Stories and tests · 8 Large UIs · 9 Anti-patterns

---

## 1. Layers and folders

```
src/client/
├─ Controllers/UiController.luau   the bridge: network + attributes -> atoms; actions -> remotes
└─ UI/
   ├─ App.luau                     root: provider, reads atoms, mounts screens and layers
   ├─ AppState.luau                atoms + the actions screens may request
   ├─ Theme/                       Tokens (defaults), Theme (schema, create), GameTheme (yours), Presets
   ├─ Foundation/                  UiProvider, UiContext, Responsive, Atom, Motion, Navigation, NumberFormat
   ├─ Primitives/                  Layer, Box, Stack, Grid, Text, Icon, Button, Scroller (+ Decorate)
   ├─ Components/                  Modal, Tabs, Toasts, ProgressBar, ItemTile, CurrencyPill ...
   ├─ Screens/                     HudScreen, ShopScreen ... (one per menu or HUD)
   └─ Stories/                     *.story.luau + Devices + UI.storybook
```

Dependencies point down only:

| Layer | May use | Must not |
|---|---|---|
| Theme (Tokens, Theme, GameTheme, Presets) | nothing but each other | contain logic beyond merging and resolving, or Instances |
| Foundation | Theme, React | render game-specific UI |
| Primitives | Foundation | know about the game (items, coins); hard-code colours, corners or fonts |
| Components | Primitives, Foundation | talk to remotes, read atoms directly (take props) |
| Screens | Components, Primitives, Foundation | talk to remotes, read player attributes |
| App | Screens, AppState, Foundation | contain layout beyond mounting screens |
| UiController | App, AppState, Net, services | contain layout |

A **primitive** is game-agnostic and could ship in any Roblox game. A **component** is a reusable piece with a purpose (a tile, a modal, a pill), still without network access. A **screen** composes components into something the player opens. If a component needs data, its screen passes it.

## 2. Component API conventions

Every kit component follows the same rules, so using a new one needs no reading:

- **One component per module**, the module returns it; the file name is the component name. Helper modules that are not components (`Decorate`, `NumberFormat`, `Toasts` with its `push` API) say so in their header.
- **Header comment**: what it is for, a usage example, and any rule a caller must know (e.g. "needs its width from its parent").
- **`export type Props`** with a comment on every non-obvious field. Optional props end in `?` and have a stated default.
- **camelCase props** for kit components; PascalCase only on host Instances. Common names mean the same everywhere: `size`, `position`, `anchor`, `layoutOrder`, `zIndex`, `visible`, `color`, `transparency`, `radius`, `stroke`, `padding`, `flex`, `width`, `disabled`.
- **Theme references and design units** in props (`gap = "S"`, `color = "Surface"`, `radius = "L"`, `width = 640`), resolved inside with `ui.space`, `ui.color`, `ui.corner`, `ui.px`. Callers never multiply by scale or pick raw colours.
- **Look from the theme**: a component's defaults come from `ui.theme.components.<Name>` and props override them per instance, so a game restyles the component without editing it.
- **Variants and sizes are string unions** (`variant: "Primary" | "Secondary" | ...`, `size: "Small" | "Medium" | "Large"`), not booleans (`isPrimary`, `big`), so they're exclusive and extendable.
- **Callbacks are `onX`** and carry ids, not Instances: `onSelect(itemId)`, `onActivate()`.
- **`layoutOrder`** on everything that can sit in a Stack or Grid.
- **`native`** escape hatch on primitives: extra host properties or events (`native = { [React.Event.InputChanged] = drag }`) without forking the primitive.
- **`ref`** forwarded by primitives (`React.forwardRef`) so callers can focus or measure them.
- **Bindings accepted** where a value may animate (`transparency`, `visible`, `text`, a progress `value`).

## 3. Composition patterns

- **Children as content**: `e(Box, { padding = ... }, { Title = ..., Body = ... })`. Primitives forward `props.children` next to their own decorators.
- **Slots**: named element props for regions a component owns the layout of: `Modal { footer = e(BuyBar, ...) }`. Better than a dozen config props.
- **Wrapping, not configuring**: a special button is a component that renders `Button` with chosen props (`PurchaseButton` = Positive Button + price text + disabled reason), not a new flag on Button.
- **Screens are pure functions of props**: `ShopScreen { open, items, coins, owned, onBuy, onClose }`. This one rule is what makes previews, tests, and swapping the data source possible.
- **Local state for local concerns**: selected tab, hovered tile, search text live in the screen with `useState`. Only what other screens or the game need goes to an atom.
- **Hooks for behaviour**: anything reusable that isn't visual (a shortcut, focus handling, a countdown, a spring) becomes a `useX` function in Foundation.

## 4. Theming and tokens

- The theme (`ui.theme`) is the single source of looks: palettes, scales, `roundness`, and a style entry per component. A game's look lives in `Theme/GameTheme.luau` as overrides on the defaults (`references/theming.md` has every key and recipe).
- Components read the active theme and palette, never `Tokens.Palettes.Dark` or other raw tokens, so themes and palettes swap at runtime: `UiController:SetPalette("HighContrast")` from a settings toggle, `UiController:SetTheme(winterTheme)` for an event.
- **Adding a palette**: in GameTheme, name it and list only what differs from the default palette; run `uikit.cjs contrast` (4.5:1 for text, 3:1 for UI parts) and preview every story with the Palette control.
- **Semantic names over literal ones**: `Positive` not `Green`, `SurfaceRaised` not `Gray2`. A seasonal theme can change what Positive looks like without renaming anything.
- **Adding a step or a knob** is cheaper than a magic number: a new spacing step goes in the theme's `space`, a component's new option in its `components` entry (with a default in `Theme.luau` for kit components).
- Fonts: the theme's `font` defaults to Builder Sans (shipped with the client, no download, four weights). Custom fonts from the Creator Store need a download before first render; preload them with ContentProvider on the loading screen.

## 5. State placement and data flow

```
Server (truth)                         Client
  CurrencyService  -- Coins attribute --> UiController -- coins:set() --> atom --> Atom.use --> Screens
  ShopService      <-- PurchaseItem ----- UiController <-- actions.buy(itemId) ------------- onBuy
  any Service      -- Notify ---------->  UiController -- Toasts.push -->  Toasts.Host
```

| State | Where | Read with |
|---|---|---|
| Server truth shown in the UI (coins, inventory, quest progress) | Server: attributes or remotes. Client: an atom in AppState, written only by UiController | `Atom.use` in App, passed down as props |
| UI state several screens care about (which menu is open, a selected loadout) | Atom in AppState | `Atom.use` |
| UI state one screen cares about (selected tab, scroll, hover) | `useState` in that screen | local |
| Values changing every frame (bars, timers, drag, animation) | Bindings (`useBinding`, `Motion.useSpring`) | properties take the binding |
| Settings (palette, reduced motion override, volume) | Atom, saved by a SettingsService on the server | `Atom.use` |

Rules: the client never changes server truth optimistically for anything that matters (purchases, rewards); it shows a pending state and waits for the server's answer. Atoms hold immutable values: update with copies (`table.clone`). For a large game with lots of synced state, replace the kit's Atom with Charm (`littensy/charm`, and `littensy/react-charm` for hooks); the call sites barely change.

## 6. Adding a component

```bash
node <skill>/scripts/uikit.cjs new component QuestCard --project .
```

1. **Is it already there?** A new look for an existing component is a variant or a wrapper, not a new component.
2. **Which layer?** Game-agnostic → `primitive`; reusable with a purpose → `component`; something the player opens → `screen`.
3. **Props first.** Write `export type Props` before the body: data in, callbacks out, design units, camelCase, defaults stated.
4. **States.** Default, hover / pressed / focused (if interactive), disabled, loading, empty, error, long text, huge numbers.
5. **Responsive.** What changes at Compact? Usually spacing (`Responsive.pick`) and what is hidden; the component should still work at any width its parent gives it.
6. **Story.** The generator makes one; add controls for every state.
7. **Scan.** `uiscan.cjs` on the file.

## 7. Stories and tests

- Every component and screen has a story (`Stories/<Name>.story.luau`) that renders it through `Devices.Matrix`, so reviewing a change means looking at eight devices at once. Use story controls (strings, numbers, booleans) for states: `Disabled`, `Coins`, `Open`, long text.
- Stories pass plain data and `print` callbacks; that only works because screens are pure.
- Pure logic (formatting, sorting, reducers, `Responsive`) gets unit tests with Jest Lua; components get a few render tests for behaviour that matters (the Buy button is disabled when not affordable).
- Keep stories in `UI/Stories` (they ship to clients but are never required at runtime), or map them to a separate Rojo folder if the team prefers.

## 8. Large UIs

- **Mount cost**: everything under App renders on join. Screens that are big and rarely opened (a codex with hundreds of entries) can render only when open (`if open then e(Big) else nil`) at the cost of a short build on open; frequently used menus stay mounted and hidden.
- **Long lists**: paginate or virtualize past ~100 rows; a ScrollingFrame with 1,000 tiles costs memory and layout time on phones.
- **Images**: many unique images in a grid cost memory; use sprite sheets (`Icon rectOffset/rectSize`) for icon sets and keep item art small.
- **Re-renders**: selectors on atoms, `React.memo` on list rows, bindings for animation. Profile with the MicroProfiler (`roblox-performance`) if a menu hitches on open.
- **Ownership**: one owner per screen in a team, the theme owned by whoever owns the art direction, Primitives changed with review because everything depends on them.

## 9. Anti-patterns

| Anti-pattern | Why it hurts | Instead |
|---|---|---|
| Hard-coded `Color3.fromRGB` / corner sizes / offsets in screens | Inconsistent, unthemable, wrong size on phones | Theme references + `ui.px` (scanner rule `hardcoded-style`) |
| Components that fire remotes | Can't preview or test; the UI becomes a second source of rules | Callback props; UiController sends |
| A "Ui" god module that every screen requires to toggle every other screen | Hidden coupling, impossible to reason about order | Atoms for open state; App mounts screens |
| Copy-pasted frames per device ("ShopMobile", "ShopPC") | Two screens to maintain, they drift | One screen with size-class branches |
| Boolean prop explosions (`isSmall`, `isRed`, `noPadding`) | Combinations nobody tested | Variant / size unions and wrappers |
| Reading `PlayerGui` paths from components | Breaks when anything is renamed | Props and refs |
| Per-frame `setState` | Re-renders the tree every frame | Bindings |
| Tweens created in render | Leak and fight each other | `Motion.useSpring` or tweens in effects with cleanup |
