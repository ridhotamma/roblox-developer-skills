# UI audit checklist

How to audit an existing Roblox UI: the scanner's rules with why each matters and the fix, the manual passes the scanner can't do, the report format, and a staged plan to fix a UI without stopping updates.

Contents: 1 Scanner rules · 2 Manual passes · 3 Report format · 4 Staged plan for an existing UI

---

## 1. Scanner rules

```bash
node <skill>/scripts/uiscan.cjs src --min low
```

Severity: **high** breaks for many players or costs performance every frame; **medium** breaks for a whole device or input class; **low** is fragile or wrong on some devices; **info** is worth a look. Suppress a reviewed line with `-- ui:ignore <rule-id>` (same line or the line above), with a comment saying why.

| Rule | Severity | Why it matters | Fix |
|---|---|---|---|
| `render-side-effect` | high | A `:Connect`, `Instance.new`, `task.*` or remote call directly in a component body runs on every render: duplicate connections, leaked Instances, remotes fired on re-render. | Move it into `React.useEffect` and return a cleanup. |
| `state-per-frame` | high | A `useState` setter called from Heartbeat / RenderStepped / BindToRenderStep re-renders the subtree every frame. | A binding (`React.useBinding`, `Motion.useSpring`) mapped onto properties. |
| `textscaled` | medium | Every TextScaled label picks its own size, so a screen mixes sizes; it ignores the player's Text Size accessibility setting. | Type-scale TextSize via `ui.px` (kit Text); AutomaticSize or wrapping for long strings; if TextScaled must stay, cap it with UITextSizeConstraint. |
| `mouse-click-event` | medium | `MouseButton1Click` and friends never fire from a gamepad and aren't the cross-input event. | `Activated`. |
| `ismobile-check` | medium | `TouchEnabled` used as "isMobile": touch laptops, tablets with keyboards and phones with controllers get the wrong UI, and it never updates when the player switches input. | `UserInputService.PreferredInput` (kit `ui.input`) for affordances; the safe-area size class (`ui.sizeClass`) for layout. |
| `effect-no-cleanup` | medium | An effect that connects, binds, schedules or creates and returns nothing leaks each time it re-runs and on unmount. | Return a function that undoes it. |
| `small-touch-target` | medium | Buttons under 44 points are missed and mis-tapped on phones. | At least 44 units on touch (kit Button uses `ui.hitTarget`); enlarge the hit area even if the art stays small. |
| `resetonspawn` | medium | A ScreenGui made in code defaults to `ResetOnSpawn = true`: it is deleted on respawn, losing state and any React root inside. | `ResetOnSpawn = false` (kit Layer). |
| `effect-no-deps` | low | An effect without a dependency list runs after every render. | Pass the values it uses (`{}` for once); no nil holes (`x or false`). |
| `viewport-breakpoint` | low | Comparing ViewportSize / AbsoluteSize with a pixel number mixes points (phones), pixels (desktop) and console 1080p. | `Responsive.classify` on design units (kit `ui.sizeClass`). |
| `fixed-design-resolution` | low | `ViewportSize.X / 1920`-style scaling shrinks a desktop design to ~40% on phones. | Per-input clamped scale (`Tokens.Scale`, `ui.px`) and layout changes per size class. |
| `gui-inset-math` | low | Offsetting by `GetGuiInset()` breaks when the top bar changes and ignores notches. | ScreenInsets = CoreUISafeInsets (kit Layer `"Safe"`). |
| `ignore-gui-inset` | low | `IgnoreGuiInset = true` lets content slide under the top bar and notches. | Set `ScreenInsets` explicitly; full-screen only for backdrops. |
| `zindex-global` | low | Global ZIndex makes every element in the ScreenGui compete in one number space; components break each other. | `ZIndexBehavior.Sibling`, layers by DisplayOrder. |
| `hover-only` | low | A file that reacts to `MouseEnter` with no tap or selection path hides that information from touch and gamepad players. | Tap-to-reveal or show on selection (`Activated`, `SelectionGained`). |
| `missing-sort-order` | info | Without `SortOrder = LayoutOrder`, order can fall back to names; keyed React children are named by key. | Explicit SortOrder and `layoutOrder` on children. |
| `screen-insets-none` | info | A full-screen layer: correct for backdrops, wrong for content. | Check that only backdrops live in it. |
| `canvasgroup` | info | CanvasGroups render to a texture: memory, and a redraw whenever anything inside changes. | Small fades only; animate a few elements' transparency for big panels. |
| `legacy-font` | info | Gotham and Arial are deprecated. | `FontFace` with Builder Sans (`Tokens.FontFamily`). |
| `legacy-roact` | info | Roact is unmaintained. | react-lua; `roact-compat` to migrate gradually (`references/react-lua.md`). |
| `waitforchild-chain` | info | Deep `PlayerGui:WaitForChild(...):WaitForChild(...)` chains into Studio-made UI break silently on a rename and hang forever. | Code-built UI, or one module that resolves the authored UI once with clear errors. |

The scanner is a pattern scan on source. It can't see layouts authored in Studio, screenshots, or what a screen looks like on a phone; that is what the manual passes are for.

## 2. Manual passes

Collect evidence first: the scanner output, the Explorer tree of `StarterGui` / `PlayerGui`, screenshots or a video on a phone, and the main flows (open shop, buy, equip, claim reward).

1. **Device pass.** Studio Device Emulator on a small phone (667 × 375), a notched phone in landscape and portrait, a tablet, and a resized desktop window. For each screen: clipping, overlap with the top bar / notch / thumb zones, text size, whether it is a shrunken desktop layout.
2. **Input pass.** Complete every flow with only touch, only mouse and keyboard, and only a controller. Note dead ends (menus you can't enter or leave), missing focus, hover-only info, tiny targets.
3. **Accessibility pass.** Largest Text Size, Reduced Motion on, Background Transparency lowered: does anything overflow, flash, or become unreadable? Check contrast of text over the world and over panels.
4. **Clarity pass.** For each screen: is the primary action obvious, are prices and states readable, does every action give feedback, does the player know why something is disabled?
5. **Code pass.** Where does UI state live, who fires remotes, how many LocalScripts touch the same ScreenGui, are there per-frame loops updating UI, are connections cleaned up.
6. **Performance pass.** Open each menu with the MicroProfiler on a low-end phone; look for hitches on open and per-frame UI work (`roblox-performance`).

## 3. Report format

1. **Verdict per area** (layout, input, accessibility, clarity, code health, performance): healthy / risky / broken, with the evidence.
2. **Top issues by player impact**, each in player terms, with where it is and the fix:
   - "On phones the shop's Buy button is below the fold and under the jump button (ShopFrame.Buy, offset 600 px from the top): move to a pinned bottom bar (kit ShopScreen pattern)."
3. **Scanner findings** grouped by rule with counts and the worst examples (path:line), plus the mechanical fix for the group.
4. **The staged plan** below, adapted to what was found, each stage with how to verify it.

Quote real names and paths from their project. Generic advice without pointing at their screens is not useful.

## 4. Staged plan for an existing UI

Each stage ships on its own and leaves the game working.

1. **Stop the bleeding (a day).** `ResetOnSpawn = false` on code-made ScreenGuis, `Activated` instead of mouse events, safe ScreenInsets on content ScreenGuis, enlarge the worst touch targets. Verify: device and input passes on the main flow.
2. **Foundation (a day).** Install the kit beside the old UI (`uikit.cjs install`), mount `App` with only the Toasts host, route existing notifications through `Toasts.push`. Verify: toasts on all devices.
3. **HUD.** Rebuild the HUD as a screen (the kit's HudScreen is the starting point), driven by atoms from a controller; delete the old HUD ScreenGui. Verify: device matrix story, thumb zones clear, controller shortcuts.
4. **One menu per release**, most used first (usually the shop). Keep the controller API the same (`ShopController:Open()`), swap the implementation to an atom + React screen, delete the old ScreenGui. Verify each with its story and a real phone.
5. **Tokens everywhere.** Replace remaining hard-coded colours and sizes with tokens; add the HighContrast palette toggle to settings.
6. **Guard it.** Run `uiscan.cjs --fail-on medium` in CI next to Selene and StyLua so the same mistakes don't come back.
