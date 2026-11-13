# Inventory styles

Every style is a preset in `InventoryConfig.Styles`. A preset is only data: which containers the player carries, which panels the window shows, how items are reached quickly, and a theme. Sections 7 and 8 cover tuning and building your own.

Controls shared by every style:

| Action | Keyboard / mouse | Touch | Gamepad |
|---|---|---|---|
| Open / close | I or ` | BAG button | D-pad up / B |
| Move | Drag | Drag | A to pick up, A to place |
| Use / equip / quick-loot | Double-click or right-click | Detail panel button | X |
| Rotate (grids) | R while holding | Rotate button | Y |
| Split a stack | Split button, then click a cell | same | same |
| Drop | Drag out of the window, or Drop button | Drop button | Drop button |
| Quick slots | 1–9 | Tap the slot | — (use the wheel or the window) |

## Attache

**The feel:** a case you pack. A shotgun is five cells long, a herb is one, and finding room for the thing you just found is a small puzzle that makes every pickup feel earned.

- **Containers:** `Main`, a 10x6 `Grid`. `Stash`: 60 slots at item boxes (tag `ItemBox`).
- **Fast access:** 4 quick slots bound to *item ids* (select an item, tap a number in the detail panel). A slot bound to "Green Herb" uses whichever herb is carried.
- **Combining:** drop one item on another; `ItemCatalog.Recipes` decides.
- **Tune:** grid size is the difficulty dial. 10x6 is generous; 8x5 forces choices by mid-game. Sell upgrades by raising `Width` / `Height` per player (see §7). Keep ammo `2x1` and healing `1x1`–`1x2` so small gaps stay useful; make the two or three biggest weapons awkward (`5x2`, `6x2`) on purpose.
- **Watch:** every item needs a sensible `Size`. An item bigger than the grid in both orientations can never be picked up (`rinv.cjs catalog` warns).

## Survivor

**The feel:** eight slots and no more. Ammo takes a slot. The key takes a slot. Leaving something behind hurts, and the item box in the safe room is a relief.

- **Containers:** `Main`, 8 large `Slots` (4 columns, `CellScale = 1.5`). `Stash`: a 64-slot item box, the same contents at every box in the world.
- **Fast access:** none on purpose. Opening the screen is the cost.
- **Tune:** `Slots` (6 for a hard mode, 10 after an upgrade), and stack sizes in the catalog: ammo `MaxStack` decides how much a slot is worth. Set `MaxStack = 1` on the container spec to forbid stacking entirely.
- **Needs:** item boxes placed where the designer wants the player to breathe. Without them eight slots is just frustrating. Key items should be `Droppable = false` so they can't be lost.
- **Watch:** pickups that don't fit must stay in the world with a clear "Inventory full" (the kit does this). Never auto-drop something to make room.

## Wheel

**The feel:** no inventory management at all. Hold a button, flick toward a weapon, let go. The bag is a list you only open for curiosity.

- **Containers:** `Main`, an unlimited `List`.
- **Fast access:** the wheel. `Wheel = { "Unarmed", "Melee", "Pistols", ... }` names the segments clockwise from the top; an item joins one through `WheelGroup`. A segment with several weapons cycles with the mouse wheel or D-pad left / right and remembers the last one used. `Unarmed` puts everything away.
- **Controls:** hold Q (or L1, or the on-screen WHEEL button and drag). Pointing uses the mouse position from the centre, the right stick, or the finger.
- **Tune:** 6–8 segments read at a glance; more than 10 gets fiddly on a thumbstick. Change the hold key in `Keys.Wheel`. Tab is traditional but belongs to Roblox's player list: disable that CoreGui first if you want it.
- **Watch:** the world doesn't slow down while the wheel is open (multiplayer has no slow motion). Keep the hold short: the wheel opens on the equipped weapon's segment so a tap-flick-release takes under half a second.

## Hotbar

**The feel:** stacks of everything. Nine slots on the number keys for what's in use, 27 behind them for what's been gathered.

- **Containers:** `Hotbar` (9 `Slots`) and `Main` (27 `Slots`). Pickups fill the hotbar first. `Stash`: a 54-slot chest.
- **Fast access:** the hotbar is a real container (`Bar = "Hotbar"`): pressing 3 equips or uses what is *in slot 3*. Rearranging the bar is dragging items between slots.
- **Tune:** `ScrollBar = true` steps through the hotbar with the mouse wheel (off by default because it takes camera zoom). `MaxStack` per item: 64 for materials, 16 for throwables, 1 for tools.
- **Variants:** drop `Main` for a hotbar-only arcade game; raise `Slots` to 36–45 for a hoarding game.

## Weight

**The feel:** pick up everything, then pay for it. The list is long, the number at the bottom creeps up, and at some point the hero slows to a walk.

- **Containers:** `Main`, a `List` with `MaxWeight = 60` and `SoftWeight = true`. `Stash`: an unlimited list.
- **Fast access:** 8 favourites on the number keys (same binding as Attache's quick slots).
- **Encumbrance:** over the limit the player gets the `Encumbered` attribute and `EncumberedWalkSpeed`. For a hard cap instead, set `SoftWeight = false`: pickups stop at the limit.
- **Tune:** weights in the catalog. Keep them to one decimal and make the heavy things obviously heavy (armour, big guns), consumables nearly free. Raise `MaxWeight` with a strength stat by giving the player a bigger spec (§7).
- **Watch:** lists don't drag. Moving to a stash is the Store / Take buttons or a double-click.

## Extraction

**The feel:** what's equipped is what you fight with, what's in the pack is what you'll lose. The stash at base is the long game.

- **Containers:** `Equipment` (5 `Slots` with `SlotAccept`: Primary, Secondary, Melee, Gear, Medical) and `Main` (8x7 `Grid`). `Stash`: a 10x12 grid.
- **Fast access:** the equipment row is the bar (`Bar = "Equipment"`): 1–3 draw a weapon, 4 the gear, 5 uses the medical item.
- **Rules to set:** `OnDeath = "DropAll"` for full loot, `"DropEquipped"` for a lighter penalty. Dropped items lie where the player died for `DropLifetime` seconds.
- **Tune:** slot categories in `SlotAccept` must match catalog `Category` values exactly. Backpack size is the greed dial.
- **Watch:** a real extraction loop also needs the raid/base split (the stash should only open at base: only place `ItemBox` parts there) and insurance-style rules, which are game design, not inventory.

## 7. Tuning any style

- **Different sizes per player** (upgrades, game passes): the spec comes from the style when the player loads. To vary it, change `loadPlayer` in `InventoryService` to pick the spec per player (for example `Width = 10 + data.CaseUpgrades`). `Core.Load` re-fits the saved items into whatever spec it is given, so growing is always safe, and shrinking pushes what no longer fits into the overflow list instead of deleting it.
- **Filters:** `Accept = { Ammo = true }` on a spec makes an ammo pouch; `SlotAccept` makes equipment slots; `MaxStack` caps stacks inside that container only.
- **Themes:** `InventoryUi.Themes`. Copy one, change the fifteen values, name it in the style's `Theme`.
- **Keys:** `InventoryConfig.Keys`. Every entry is a list, so keyboard and gamepad bindings sit side by side.
- **Starter kit:** `StarterItems` globally or per style.

## 8. Building a new preset

Add an entry to `Styles` and set `Style` to its name. The fields:

| Field | Meaning |
|---|---|
| `Containers` | name → spec. Specs: `Layout` (`"Slots"`, `"Grid"`, `"List"`), then `Slots` + `Columns`, or `Width` + `Height`, or `MaxWeight` / `MaxItems`. Optional `Title`, `CellScale`, `Accept`, `SlotAccept` + `SlotNames`, `MaxStack`, `NoRotate`, `SoftWeight`. |
| `Carry` | Containers that count as "on the player", in pickup order. Only carried items can be used or equipped. |
| `Window` | Panels of the inventory screen, top to bottom. |
| `Stash` | Optional spec of the personal storage opened at `ItemBox` parts. |
| `Bar` + `BarSlots` | A carried `Slots` container whose first slots are the number keys. |
| `Shortcuts` | Instead of `Bar`: how many quick slots bind to item ids. |
| `Wheel` | Segment names. Works on top of any style. |
| `Theme`, `Title` | A key of `InventoryUi.Themes`; the heading of the detail panel. |

Combinations that work well:

- **Grid + hotbar** (survival with shapes): `Hotbar` 6 slots + `Main` grid, `Bar = "Hotbar"`.
- **Any style + wheel:** add `Wheel` to Attache or Extraction for a controller-first game; weapons then have two routes to the hand.
- **Ammo pouch:** a second carried container with `Accept = { Ammo = true }` listed first in `Carry`, so ammo never competes with weapons for cells.
- **Two-tier weight:** `Slots` hotbar for tools + `List` with `MaxWeight` for materials.

Rules a preset must follow (`node scripts/selftest.cjs` checks the shipped ones): every name in `Carry` and `Window` is a key of `Containers`; no carried container is called `Stash`; `Bar` names a `Slots` container; don't set both `Bar` and `Shortcuts`.
