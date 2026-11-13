# Game UI and UX patterns

What good Roblox UI does for the player, screen by screen, and a review checklist. Use it when designing a screen, reviewing screenshots, or deciding why players don't find or use something.

Contents: 1 Principles · 2 HUD · 3 Menus and navigation · 4 Shops and purchases · 5 Inventories and collections · 6 Onboarding · 7 Notifications · 8 Feedback and juice · 9 Loading, pending, empty and error states · 10 Settings · 11 Accessibility · 12 Localisation · 13 Gamepad navigation · 14 Review checklist and report format

---

## 1. Principles

1. **Glanceable.** The player is playing. Anything on the HUD must read in under a second: one number, one icon, one short word.
2. **Show less.** Every HUD element competes with the game. Put things in menus until players need them in the moment.
3. **Every action answers within a frame.** Press state immediately, sound, then the result. A tap with no visible response gets tapped again (and buys twice).
4. **Same thing, same place, same look.** Primary actions are always the same colour and side; currency always looks the same; close is always top-right.
5. **Forgiving.** Confirm what costs a lot or can't be undone; make everything else undoable or cheap to redo.
6. **Respect the device.** Thumbs on phones, D-pads on consoles, small safe areas, players who can't hear or don't see colour well.
7. **Don't stop the world.** Roblox games are multiplayer; menus open over a running game, so keep them quick to open and quick to leave.

## 2. HUD

Landscape phone and desktop zones (safe area):

```
┌─────────────────────────────────────────────────────────┐
│ [Roblox top bar: menu, chat ...]                         │  never under it
│ (coins +)                     objective / timer   (... ) │  top: status
│                                                         │
│ [Shop]                                                  │  left edge: menu buttons
│ [Daily]          (game world)          prompts appear  │
│ [Pets]                                 near objects     │
│                                                         │
│  ( move )            toasts / hints             ( jump )│  bottom corners: touch controls
└─────────────────────────────────────────────────────────┘
```

- **Belongs on the HUD**: the main currency, the current objective or round timer, health or energy if the game has them, two to four menu buttons, and contextual prompts.
- **Doesn't**: secondary currencies, stats, settings, social features, ads for the shop. Move them into menus or show them only when they change.
- **World interactions** use `ProximityPrompt`: it handles touch, keyboard and gamepad, shows the right key, and needs no HUD space.
- **Menu buttons** get an icon and a short label: icons alone are ambiguous to new players and labels translate.
- **Readability over the world**: dark backing chips (`Tokens.Transparency.Hud`) and outlined text; test over the brightest and darkest parts of the map.
- **Portrait phones**: top row for status and menu buttons; the bottom third belongs to the thumbs.

## 3. Menus and navigation

- **One menu at a time.** Opening the inventory closes the shop. With more than two menus, use one `activeMenu: Atom<string?>` instead of a boolean per menu.
- **Closing**: a close button top-right, tap on the dimmed world outside (when nothing is lost), B on a gamepad. Never trap the player.
- **Nested views** (shop → item → confirm) keep a back stack: B and the back button go up one level, close leaves entirely.
- **Phones get full-screen sheets**, other devices centred dialogs (the kit's Modal). A dialog on a phone wastes the edges and shrinks the content.
- **Remember the last tab and scroll** per menu; players return to the same place.
- **Open and close in 150-250 ms.** Longer animations feel sluggish when opening a menu twenty times a session.
- **On gamepad, selection starts inside the menu** when it opens and returns where it was when it closes (`Navigation.useFocus`).

## 4. Shops and purchases

- Every item shows its **price, currency, and state**: affordable, not affordable (with how much more is needed), owned, equipped, locked (with how to unlock).
- **Buy is a request.** The button shows a pending state ("Buying..."), disabled, until the server answers (balance changes, a toast). This prevents double purchases and lies.
- **Robux purchases** go through `MarketplaceService:PromptProductPurchase` / `PromptGamePassPurchase`; grant developer products in `ProcessReceipt` on the server and show the result after the receipt is processed. Never draw your own imitation of Roblox's purchase dialog.
- **Confirm** purchases that are expensive (a large share of the balance) or irreversible; don't confirm cheap, frequent ones.
- **Paid random items** (crates, eggs bought with Robux or with currency bought with Robux) must show the odds of each item before purchase, per Roblox's policies. Show odds for free random rewards too: it builds trust.
- **No dark patterns**: no fake countdowns, no fake scarcity, no confusing currency conversions, no guilt-tripping close buttons. The audience is young and Roblox's rules are strict.
- **Entry points in context**: when a player can't afford something, the disabled button can offer "Get more" that opens the right shop tab.
- **Featured and limited items** state honestly when they end (`3d 4h`).

## 5. Inventories and collections

- Grid of tiles with tabs or filters by category, and a sort (rarity, newest, power).
- Equipped items marked on the tile, not only in the details.
- **Empty state** explains how to get the first item and links there.
- Capacity shown when there is a cap ("38 / 50"), with a warning near full.
- Phones: tap a tile to open details with the actions at the bottom. Desktop: details column, multi-select and bulk actions (sell duplicates) where useful.
- Counts on stacked items as a small badge; "new" dots that clear when seen.

## 6. Onboarding

- **Teach by doing.** Point at the next action (a pulsing ring around the Shop button, an arrow to the first quest NPC) instead of explaining it.
- **One hint at a time**, dismissed by doing the thing, never a wall of text.
- **Reveal the HUD progressively**: a new player sees the balance and the first goal; buttons appear when they unlock.
- **Skip for returning players** (save onboarding progress in player data).
- Funnel every step with `AnalyticsService:LogOnboardingFunnelStepEvent` to see where new players drop. `roblox-game-design` covers what the first minutes should contain.

## 7. Notifications

| Use | When | Kit |
|---|---|---|
| Toast | Feedback the player can miss: purchased, saved, not enough coins | `Toasts.push` |
| Badge dot / count | Something new inside a menu: a claimable reward, unseen items | `Button badge` |
| Modal | The player must decide: confirm, choose a reward | `Modal` |
| Banner | Server-wide or timed events: double coins for 10 minutes | a HUD component in the top area |
| Inline message | Why an action is unavailable, next to the action | disabled Button label |

Merge repeats ("+5 coins" ten times becomes "+50 coins"), cap visible toasts (the kit shows three), and never use a modal for something a toast would do.

## 8. Feedback and juice

- **Press feedback** on every button (colour and press-down) and a short click sound (`SoundService:PlayLocalSound`, routed through a UI SoundGroup so the volume setting covers it).
- **Numbers move**: balances count up (CurrencyPill), "+N" pops near where the reward came from, bars fill with a spring.
- **Rewards get a moment**: a short anticipation (shake, glow), the reveal, then the result with its rarity colour and word. Keep it skippable.
- **Motion with purpose**: things enter from where they come from (a sheet from the bottom, a toast from the top). With Reduced Motion on, replace movement with fades or nothing (the kit's springs snap).
- **Particles in UI** sparingly: a few on big moments, not on every coin. `roblox-vfx` for world effects, `roblox-performance` for their cost.

## 9. Loading, pending, empty and error states

- **Loading screen**: from ReplicatedFirst (`ReplicatedFirst:RemoveDefaultLoadingScreen()`), light on assets, with progress or tips, and gone as soon as the player can act. Preload only what the first screen needs.
- **Pending**: the action is disabled and says what is happening; after a timeout (5-10 s) show an error and re-enable.
- **Empty**: say why it's empty and offer the next step.
- **Error**: what happened and what to do, in player words ("Couldn't buy: you already own this"), never error codes or stack traces.

## 10. Settings

The essentials: separate music and sound-effect volumes, a high-contrast palette toggle (`UiProvider palette`), a reduced-motion override on top of the Roblox setting, camera sensitivity if the game has a custom camera, and a controls reference per input. Save settings through the server's data layer, apply them through atoms. An optional extra UI size slider can multiply the kit's scale (pass a multiplier into UiProvider and apply it in `Responsive.scaleFor`).

## 11. Accessibility

- **Contrast**: 4.5:1 for body text on its background, 3:1 for large text and icons. The kit's palettes meet it on their surfaces; over the 3D world use backing chips and outlines.
- **Text size**: TextSize-based text grows with the player's Text Size setting (`GuiService.PreferredTextSize`); layouts must grow with it (AutomaticSize, wrapping). TextScaled ignores it.
- **Background transparency**: multiply UI background transparency by `GuiService.PreferredTransparency` (the kit's surfaces do).
- **Reduced motion**: `GuiService.ReducedMotionEnabled` means fewer or no movement effects (the kit's springs jump to the end).
- **Colour is never the only signal**: rarity has a word, errors have text, team colours have icons. About 1 in 12 boys has a colour vision deficiency.
- **Sound is never the only signal**: important audio cues have a visual (a timer pulse, a caption).
- **Timing**: avoid UI that must be hit within a short window; offer hold alternatives to rapid tapping.

## 12. Localisation

- Roblox's automatic translation (`AutoLocalize` on text objects, the experience's localization table) handles most strings; turn it off (`localize = false` on the kit's Text) for names, numbers and anything player-made.
- Build strings with parameters through a Translator (`LocalizationService:GetTranslatorForPlayerAsync`, `FormatByKey`) instead of concatenating sentence pieces, which can't be translated in languages with a different word order.
- Let text hug: buttons and labels sized by content, layouts that wrap. Expect 30-50% longer strings in some languages and test with the longest one your game supports.
- Format numbers and times with one helper (`NumberFormat`), not ad-hoc string maths in each screen.

## 13. Gamepad navigation

- Roblox moves `GuiService.SelectedObject` between `Selectable` GuiObjects with the D-pad / stick. The kit's Button and ItemTile are selectable and draw their own focus ring (the default selection image is hidden by an empty `SelectionImageObject`).
- When a menu opens, call `GuiService:Select(menu)` to select its first selectable descendant (`Navigation.useFocus`); restore the previous selection when it closes.
- Fix awkward jumps with `NextSelectionUp/Down/Left/Right` on specific elements, and keep selection inside an open modal with the selection-group properties on its panel (`SelectionGroup` and the `SelectionBehavior*` properties; check names in the API reference for your Studio version).
- ScrollingFrames scroll to keep the selected child visible, so long lists work without extra code; make the ScrollingFrame itself non-selectable.
- Face buttons: A confirms (Activated fires), B backs out, X / Y for the screen's main secondary actions, LB / RB for tabs. Show the glyph next to the button it triggers, and only on gamepad.
- On keyboard, players can toggle the same navigation with the `\` key; it should work too.

## 14. Review checklist and report format

Run through each item on a phone (both orientations if the game allows portrait), a desktop, and with a controller.

**Layout**
- [ ] Nothing interactive under the top bar, notches, home indicator, thumbstick or jump zones.
- [ ] Every menu fits the phone safe area without clipping; scrolls where needed.
- [ ] Phones get sheets and stacked layouts, not shrunken desktop layouts.
- [ ] Text never smaller than 12 units; same role, same size across screens.

**Input**
- [ ] Every touch target at least 44 points.
- [ ] Every flow completes with a controller only; selection starts inside menus; B closes.
- [ ] No hover-only information.

**Clarity and feedback**
- [ ] Prices, states and reasons for disabled actions are visible.
- [ ] Every action responds within a frame; purchases show pending and result.
- [ ] HUD reads at a glance over the brightest and darkest scenes.

**Accessibility and reach**
- [ ] Contrast meets 4.5:1 for text; colour never the only signal.
- [ ] Larger text settings don't break layouts; reduced motion respected.
- [ ] Strings are translatable and layouts survive 50% longer text.

**Report format**

1. **Summary**: the three issues that cost players most, in player terms ("phone players can't see the Buy button without scrolling, and it's under the jump button").
2. **Findings table**: where (screen, element), who it affects (device / input / setting), severity (blocks a flow / hurts conversion or retention / polish), and the fix (with code in the kit's shape when it's a code change).
3. **Quick wins** (an afternoon), then **structural changes** (layout per size class, moving to the kit), each with how to verify (story on the device matrix, a real phone, a controller).
