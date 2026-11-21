# Responsive layout for Roblox

How the kit decides how big things are and where they go on every device, the Roblox layout tools underneath, and the patterns that turn one design into a phone, tablet, desktop and TV layout.

Contents: 1 The devices · 2 Design units and scale · 3 Size classes · 4 Input modes and ten-foot UI · 5 Safe areas, ScreenInsets and the top bar · 6 Mobile control zones · 7 The layout toolbox · 8 Responsive patterns · 9 Visibility: what each device shows · 10 Text · 11 Testing

---

## 1. The devices

What the kit computes for its preview devices (`Stories/Devices.luau`). Regenerate with `node scripts/uikit.cjs devices` after changing `Tokens.Scale` or `Tokens.Breakpoints`; the selftest fails if this table and the code disagree.

| Device | Screen | Input | Safe area | Room | Scale | Design units | Size class | Hit target |
|---|---|---|---|---|---|---|---|---|
| Phone landscape | 844 × 390 | Touch | 750 × 311 | 750 × 311 | 1.00 | 750 × 311 | Compact | 44 px |
| Phone portrait | 390 × 844 | Touch | 390 × 705 | 390 × 705 | 1.00 | 390 × 705 | Compact | 44 px |
| Small phone | 667 × 375 | Touch | 667 × 317 | 667 × 317 | 1.00 | 667 × 317 | Compact | 44 px |
| Tablet landscape | 1180 × 820 | Touch | 1180 × 742 | 1180 × 742 | 1.03 | 1146 × 720 | Expanded | 45 px |
| Tablet portrait | 820 × 1180 | Touch | 820 × 1078 | 820 × 1078 | 1.14 | 719 × 946 | Medium | 50 px |
| Tablet split view | 590 × 820 | Touch | 590 × 742 | 590 × 742 | 1.00 | 590 × 742 | Medium | 44 px |
| Small window | 800 × 600 | Pointer | 800 × 542 | 800 × 542 | 0.75 | 1067 × 723 | Medium | 18 px |
| Laptop | 1366 × 768 | Pointer | 1366 × 710 | 1366 × 710 | 0.82 | 1666 × 866 | Expanded | 20 px |
| Desktop 1080p | 1920 × 1080 | Pointer | 1920 × 1022 | 1920 × 1022 | 1.18 | 1627 × 866 | Expanded | 28 px |
| Ultrawide | 2560 × 1080 | Pointer | 2560 × 1022 | 2560 × 1022 | 1.18 | 2169 × 866 | Expanded | 28 px |
| Console TV | 1920 × 1080 | Gamepad (TV) | 1920 × 1022 | 1728 × 968 | 1.42 | 1217 × 682 | Expanded | 62 px |

What the numbers mean:

- Phones and tablets report their screen in **points** (an iPhone in landscape is about 844 × 390), not physical pixels, so 44 units at scale 1 is a 44-point thumb target, the size Apple and Roblox recommend.
- Desktops report real pixels, from 1280 × 720 laptops to 4K monitors. Consoles lay UI out at about 1920 × 1080 whatever the TV is.
- The safe area is what is left after notches, the home indicator and the Roblox top bar. On a phone in landscape that is often only ~310 points tall: the room a layout really has is smaller than "a phone screen" suggests.
- **Room** is the safe area minus TV overscan (section 4): what a Safe layer's content gets, and what design units and the size class are measured from. Off TV it equals the safe area.
- The presets cover the extremes where things clip first: a small phone, an iPad in split view (Medium, portrait, touch), a small desktop window (Medium with a pointer), and an ultrawide monitor (very wide Expanded).
- Insets in the presets approximate an iPhone 14 / iPad Air class device and a 58-point top bar; check real devices (section 11).

## 2. Design units and scale

Sizes in the kit are **design units**. `ui.px(units)` turns them into whole pixels for the current device:

```
scale  = clamp(shortSideOfSafeArea / Reference, Min, Max)   -- rounded to 0.01
pixels = round(units × scale)
```

| Profile (`Tokens.Scale`) | Reference | Min | Max | Why |
|---|---|---|---|---|
| Touch | 720 | 1 | 1.25 | Phones stay at 1 (points are already physical-ish); tablets grow slightly. Min 1 means a touch target never drops under 44 points. |
| Pointer | 864 | 0.75 | 2 | A 1080p monitor gets ~1.18, 1440p ~1.6, 4K 2: every monitor sees a layout of about 1600 × 860 units, so desktop layouts look the same everywhere instead of tiny on big monitors. |
| TenFoot | 720 | 1.25 | 1.5 | A TV is read from across the room: ~1.42 at 1080p. |

Why not just scale everything from a 1080p design (`viewport.X / 1920`)? Because a phone then gets a scale of ~0.4: 44-pixel buttons become 18 points and 16-pixel text becomes 7. Proportional scaling keeps the *picture* the same and makes it unusable. The kit keeps *physical sizes* sensible per input and changes the *layout* by size class instead.

Use **Scale** (UDim scale) when something is a share of its parent: two columns at 0.5, a progress fill, a full-width bar. Use **`ui.px`** for everything that should feel the same size on every device: padding, gaps, text, icons, buttons, corner radii, strokes. Avoid raw offsets: a literal `UDim2.fromOffset(200, 50)` is 200 points on a phone and 200 pixels on a 4K monitor.

The rounding to whole pixels matters: fractional sizes blur 1-pixel strokes and text edges.

Alternative you'll see in other codebases: a `UIScale` on the root driven by the viewport. It scales Studio-authored UI without touching each element (set the root frame's size to `1 / scale` of the screen so it still fills it), but it also scales AbsoluteSize readings and makes layouts depend on one design resolution. For code-built UI, `px` is simpler and crisper.

## 3. Size classes

The safe area in design units is classified (`Tokens.Breakpoints`):

| Class | Rule | Typical devices | What layouts usually do |
|---|---|---|---|
| Compact | short side < 500 | phones, either orientation | One column. Menus are full-screen sheets. Master-detail becomes list + pinned action bar. Secondary info behind a tap. 2-3 grid columns. |
| Medium | width < 1100 | tablet portrait, small desktop windows | Dialogs, narrower side panels, 3-5 grid columns. |
| Expanded | everything else | desktop, laptop, console, tablet landscape | Dialogs with side panels, master-detail side by side, 5+ columns, more information at once. |

Mobile-first in code: `Responsive.pick(ui.sizeClass, { Compact = 2, Expanded = 4 })` (Medium falls back to Compact). Design Compact first: it is where most players are and the hardest constraint; expanding a good phone layout is easy, compressing a desktop layout rarely works.

Orientation is separate (`ui.orientation`): a phone in portrait is Compact and Portrait, which changes where the HUD goes (section 6). Most Roblox experiences run landscape; portrait happens when a game sets `PlayerGui.ScreenOrientation` or on some tablets.

## 4. Input modes and ten-foot UI

`UserInputService.PreferredInput` (Touch, KeyboardAndMouse, Gamepad) reflects the devices present and what the player used last, and changes live when they pick up a controller. The kit reads it as `ui.input` = Touch / Pointer / Gamepad (with a fallback for clients that predate it). `GuiService:IsTenFootInterface()` gives `ui.tenFoot`.

| Affordance | Touch | Pointer | Gamepad |
|---|---|---|---|
| Minimum interactive size | 44 units | 24 units | 44 units (× TV scale) |
| Hover states and tooltips | none: provide tap-to-reveal | yes | none: show info on selection |
| Focus ring | no | on keyboard navigation | always on the selected element |
| Button glyph hints (A, B, X, Y) | no | no | yes, from `UserInputService:GetImageForKeyCode` |
| Scroll bars | thin, content is dragged | grabbable | hidden behind selection; ScrollingFrames scroll to the selected child |
| Primary action placement | bottom of the sheet, near thumbs | anywhere visible | bound to a face button as well as visible |

Never infer input from screen size or the other way round: a Surface laptop is touch and pointer, an iPad can have a keyboard, a phone can have a controller. `TouchEnabled` alone says nothing about how someone is playing right now.

Ten-foot (console) rules: the larger scale handles text and target size; important content stays away from the outer 5% of each edge (some TVs crop it: overscan); every screen is fully navigable with the D-pad; menus open with selection already inside them and close with B.

The kit applies the overscan margin itself: on a ten-foot interface, Safe and Device layers pad their content by `Tokens.Overscan.TenFoot` (5%) of the screen per edge, minus what the safe insets already clear (the top bar covers the top). `ui.overscan` has the padding and `ui.room` the space left; the scale is still computed from the whole safe area, so a TV keeps its ten-foot scale and the layout gets about 1217 × 682 units.

## 5. Safe areas, ScreenInsets and the top bar

Every ScreenGui has `ScreenInsets`:

| ScreenInsets | Content area | Use for | Kit `Layer insets` |
|---|---|---|---|
| CoreUISafeInsets (default) | Clear of the Roblox top bar buttons, notches, home indicator | Everything readable or tappable | `"Safe"` |
| DeviceSafeInsets | Clear of notches and the home indicator only | Full-width bars that may sit under the top bar strip | `"Device"` |
| TopbarSafeInsets | The strip between the Roblox top-bar buttons and the right edge | A row of top-bar style buttons | `"Topbar"` |
| None | The whole screen | Backdrops, scrims, loading art | `"None"` |

- `IgnoreGuiInset = true` is the old switch; it moves a CoreUISafeInsets gui to DeviceSafeInsets. Prefer setting `ScreenInsets` explicitly.
- `GuiService:GetGuiInset()` maths (shifting things down by 36 or 58) breaks whenever the top bar changes and ignores notches. Let ScreenInsets do it.
- `SafeAreaCompatibility = None` on new ScreenGuis: the default `FullscreenExtension` stretches some full-screen frames into the unsafe area automatically, which surprises.
- A backdrop that must reach the edges goes in a `"None"` layer, with the content above it in a `"Safe"` layer (the kit's Modal is exactly this: scrim layer + window layer).
- The top bar holds the Roblox menu, chat and other core buttons; never put interactive UI under it.

## 6. Mobile control zones

On touch devices Roblox draws its own controls over your UI:

- **Thumbstick**: the dynamic thumbstick activates anywhere in roughly the lower-left part of the screen, where the left thumb rests.
- **Jump button**: bottom-right, sized to the screen.
- Buttons your game creates with `ContextActionService:BindAction(..., true, ...)` appear near the jump button.

So on touch: keep the bottom-left and bottom-right corners free of HUD, put frequent HUD buttons at the left edge, vertically centred (landscape) or in a row under the top-left balance (portrait), and give menus their primary action at the bottom of the sheet (the controls are hidden behind an open full-screen sheet). The device previews draw approximate zones so collisions are visible before testing on a phone.

## 7. The layout toolbox

| Tool | Use it for | Watch out |
|---|---|---|
| `AnchorPoint` + `Position` | Pinning to corners and centres: anchor (1, 0) at position (1, -m, 0, m) is "top-right with margin m" | A layout (UIListLayout / UIGridLayout) controls its children's Position; anchor only free elements. |
| UIListLayout (kit `Stack`) | Rows and columns with a gap; `Wraps` for flowing chips; `HorizontalFlex` / `VerticalFlex` SpaceBetween / SpaceEvenly; `ItemLineAlignment = Stretch` | `SortOrder = LayoutOrder` always. |
| UIFlexItem (kit `flex` prop) | "This child takes the remaining space" (Fill), only grows (Grow), only shrinks (Shrink) | Give the flexing child a base size of 0 on the main axis. |
| UIGridLayout (kit `Grid`) | Tiles. The kit computes columns from a minimum item width so the same grid works everywhere | `FillDirectionMaxCells` caps columns; the cell size must be recomputed when width changes (Grid does). |
| AutomaticSize | Hug content: buttons around their label, panels around their rows, wrapped text growing downward | The automatic axis must not also be Scale-sized by its children; pair with a `UISizeConstraint` max width for chips that can grow too long. |
| UISizeConstraint | Min / max size: dialogs that grow with the screen up to a limit | Max is in pixels: compute it with `ui.px`. |
| UIAspectRatioConstraint | Square icons, card art, video frames | Picks a dominant axis; set `DominantAxis` when inside a layout. |
| UIPadding | Inner spacing; works on ScrollingFrames too | Padding counts toward AutomaticSize. |
| ScrollingFrame (kit `Scroller`) | `AutomaticCanvasSize` with an AutomaticSize child; no CanvasSize maths | Set `ScrollingDirection`; insets so the bar doesn't cover content. |
| UIScale | Scaling a whole Studio-authored UI, small press effects | Changes AbsoluteSize readings; avoid on children of AutomaticSize parents (it changes their size and reflows siblings). |
| ZIndex / DisplayOrder | Order within a ScreenGui (Sibling mode) / between ScreenGuis | Use layers for big stacking decisions, ZIndex only among siblings. |

## 8. Responsive patterns

| Pattern | Compact | Medium / Expanded | In the kit |
|---|---|---|---|
| Sheet vs dialog | Full-screen sheet that slides up | Centred dialog with max size | `Modal` |
| Master-detail | Grid fills the sheet; selected item in a pinned bar with the action | Grid + details column | `ShopScreen` |
| Auto columns | 2-3 columns | 4-7 columns | `Grid` with `minItemWidth` |
| Reflow | Rows stack into a column | Side by side | `Stack direction` from `Responsive.pick` |
| Navigation | Scrollable tab strip | Tab strip (or a sidebar on very wide screens) | `Tabs` |
| Progressive disclosure | Name + price on the tile, the rest on tap | More stats visible on the tile or the details column | `ItemTile` + details |
| Sticky primary action | Bottom bar under the thumb | Inside the details column | `ShopScreen` `BuyBar` |
| HUD clusters | Left-edge column (landscape) or top row (portrait), bottom corners free, extras in More | Left-edge column, larger | `HudScreen` |
| Show / hide | Secondary panels and hover hints left out (`Show`) | Shown | `Show`, `Responsive.matches` |

```lua
local ui = UiContext.useUi()
local columns = Responsive.pick(ui.sizeClass, { Compact = 1, Expanded = 2 })
local direction = if columns == 1 then "Column" else "Row"
return e(Stack, { direction = direction, gap = "L", align = "Stretch" }, {
	Stats = e(StatsPanel, { layoutOrder = 1, flex = if columns == 2 then "Fill" else nil }),
	Upgrades = e(UpgradeList, { layoutOrder = 2, flex = if columns == 2 then "Fill" else nil }),
})
```

Keep the number of layout variants small: usually Compact and "everything else", sometimes a Medium tweak. Each variant is a layout someone has to test.

## 9. Visibility: what each device shows

Layout changes are half of responsive design; the other half is deciding what exists on each device at all, and what gives way when room runs out. Four tools, from the most specific:

**Show rules.** `Show` (Primitives/Show) renders its children only where a rule matches:

```lua
e(Show, { on = { sizeClass = { "Medium", "Expanded" } } }, { Stats = e(StatsPanel, { layoutOrder = 2 }) })
e(Show, { on = { input = "Gamepad" } }, { Legend = e(ControlsLegend) })
e(Show, { on = { sizeClass = "Expanded" }, fallback = e(StatsSummary) }, { Full = e(StatsTable) })
```

Rules (`Responsive.Rule`) take `sizeClass`, `input`, `orientation`, `tenFoot`, and `minWidth` / `minHeight` in design units; every field given must match. Room and input stay separate questions: hide a column on `{ sizeClass = "Compact" }`, hide a hover hint on `{ input = { "Touch", "Gamepad" } }`, never on "mobile". `Show` unmounts; to keep state while hidden, pass `visible = Responsive.matches(ui, rule)` to the element instead.

Hiding is for secondary information. The only way to do something is never hidden on a size class or input: it moves (behind a tap, into a More menu, into a details sheet).

**Priority and overflow.** A strip of buttons (HUD menus, a toolbar, a tab row) computes how many it holds and moves the rest into a More button, instead of running off the screen or under the thumbs:

```lua
local capacity = Responsive.fit(bandLength, buttonHeight, gap)              -- pixels in, a count out
local shown, hidden = Responsive.overflow(actions, capacity, function(action, index)
	return action.priority or index                                           -- lower stays longer
end)
```

When everything fits nothing moves; otherwise More takes one slot and the most important items keep the rest, in their original order. The kit's HUD does this: each `HudScreen.Action` has an optional `priority` and `show` rule, the column on touch stays above the bottom third (`Tokens.ThumbZone`), and overflow opens a flyout that works with touch, mouse and gamepad (B closes it; shortcuts of actions inside it still work). Give strip items a fixed size so the capacity is known before layout.

With the kit's HUD (44-unit buttons, 88 units wide on Compact and Medium, 120 on Expanded):

| Device | HUD strip | Buttons it holds (More included) |
|---|---|---|
| Phone landscape / small phone | Left column between the balance and the thumb zone | 2 |
| Phone portrait | Row under the balance | 3 |
| Tablet split view / tablet portrait | Row under the balance | 5 / 7 |
| Tablet landscape, small window, laptop, desktop, TV | Left column (below the chat window on desktop) | 6 or more |

So the kit's two default buttons (Shop, Daily) fit everywhere; a third action moves the lowest-priority ones into More on landscape phones.

**Roblox's own UI.** Core UI draws above every ScreenGui and owns parts of the screen:

| Core UI | Where | What the kit does |
|---|---|---|
| Top bar (menu, chat, other buttons) | Top strip | Safe layers start below it (section 5) |
| Chat window (TextChatService) | Top left; open by default on desktop, opened from the chat button on phones | `ui.chatWindow` is its rectangle in a Safe layer's pixels (from `ChatWindowConfiguration.AbsolutePosition` / `AbsoluteSize`); the HUD moves the balance to its right and starts the column below it |
| Player list | Top right on desktop; from the menu on phones | Keep the top-right corner for non-interactive status; Modal hides it while a sheet is open on phones |
| Backpack hotbar | Bottom centre, when the player has Tools | Modal hides it while open (it would cover a sheet's footer, and number keys would equip tools mid-purchase) |
| Emotes menu | Centre, while open | Modal hides it while open |
| Thumbstick and jump | Bottom left and right on touch | HUD stays above `Tokens.ThumbZone`; full-screen sheets cover them |

Hide core UI only through `CoreUi.useHidden(types, active)` (Foundation/CoreUi): it counts requests per type, so two menus never fight, and it only restores what it hid. A blind `StarterGui:SetCoreGuiEnabled(type, true)` on close re-enables a Backpack that a custom inventory turned off for good. Pass `coreGui = {}` to a Modal to hide nothing.

**The on-screen keyboard.** On phones and tablets a focused TextBox raises a keyboard over the bottom ~40% of the screen. `ui.keyboard` is the height it covers at the bottom of the room (0 when down; from `UserInputService.OnScreenKeyboardVisible` / `OnScreenKeyboardSize`, refreshed on TextBox focus). The kit's Modal shrinks the sheet (Compact) or lifts the dialog by it, so a search box or code field and the footer stay visible. Anything else with a text field near the bottom (a chat-like input, a gift note) does the same: subtract `ui.keyboard` from the height it lays out in. Previews pass `keyboard` in the simulation to check it.

## 10. Text

- Sizes come from the theme's type scale (`ui.theme.type`) through `ui.px`, so every Body label is the same size on a screen. Captions (12 units) are the floor for anything the player must read.
- Long text: `width = UDim.new(1, 0)` on the kit's Text wraps and grows downward; `truncate = true` for single-line names in tight spaces (with the full name in the details view).
- `GuiService.PreferredTextSize` (Settings → Accessibility → Text Size) enlarges TextSize-based text automatically; AutomaticSize containers grow with it. `TextScaled` text ignores it, and a `UITextSizeConstraint` caps it.
- Measure text before layout only when necessary (`TextService:GetTextBoundsAsync`); AutomaticSize usually does it for you.
- Translated text runs 30-50% longer than English for some languages: hug content, don't fix widths around English strings.
- RichText only for your own strings; player-provided text with RichText on can inject tags.

## 11. Testing

1. **Stories on the device matrix** while building: every screen on phone (both orientations), small phone, tablet (both orientations and split view), small window, laptop, desktop, ultrawide and TV at once, with the top bar, the desktop chat window, the TV overscan edge and the thumb zones drawn on.
2. **Studio's Device Emulator** (Test → Device): pick phones and tablets, rotate, and play. It applies real safe areas and touch input emulation.
3. **Resize the Studio window** during Play to check Pointer reflow between Medium and Expanded.
4. **A real phone** through the Roblox app (publish to a private place, or Team Test): touch-target feel, text legibility and performance only show up there.
5. **A controller on PC** (or a console): open every menu and complete every flow without touching the mouse.
6. **Core UI on**: play with chat open, a Tool in the backpack and the player list shown, and check nothing of yours sits under them; focus every TextBox on a phone and check the field stays above the keyboard.
7. `node scripts/uikit.cjs devices --size WxH --input touch|pointer|gamepad [--tenfoot]` to see what the kit will do on a specific screen.
