---
name: roblox-inventory
description: Replace Roblox's built-in backpack and hotbar with a custom, server-authoritative inventory in the style the game needs - a survival-horror attache case (grid of cells, items with shapes, rotate to fit, combine herbs), classic eight-slot survival horror with an item box, an open-world weapon wheel (hold, point, release), a block-survival hotbar plus backpack of stacks, a weight-limited RPG list with category tabs and favourites, or an extraction-shooter loadout (equipment slots, backpack grid, stash). Ships a Luau kit that hides the Backpack CoreGui, keeps Tools working (the inventory equips them, loose and StarterPack Tools are converted into items), saves through ProfileStore, validates every client request (move, split, merge, swap, rotate, combine, use, equip, drop, sort, transfer), and adds world pickups, loot chests, a personal stash, drag and drop with client prediction, and mouse, touch and gamepad controls; plus a CLI that installs it into a Rojo project and builds the item catalog from a JSON sheet. Use this whenever the user wants a custom inventory, backpack, hotbar, item grid, inventory tetris, weapon wheel, radial menu, loadout, equipment slots, stash, storage chest, looting, item stacking, item pickup and drop, crafting by combining, carry weight or encumbrance, or wants to disable, hide, remove, override or restyle the default Roblox backpack or toolbar, or asks why items duplicate, vanish, or tools still show in the default hotbar, even if they only say "make an inventory like Resident Evil / GTA / Minecraft / Tarkov / Skyrim".
---

# Roblox custom inventory

Roblox's backpack is a row of Tools. Most games that care about items want something else: a case you have to pack, a wheel you flick, eight slots that force hard choices. This skill replaces the built-in backpack with an inventory **you own end to end**: the server holds the items, the client only draws them and asks.

One kit covers every style, because the styles differ in only three things:

| Decision | Options | What it changes for the player |
|---|---|---|
| **How a container is laid out** | `Slots` (one stack per slot), `Grid` (items cover cells, can rotate), `List` (no positions, limited by weight) | Whether carrying is about *count*, *shape* or *weight* |
| **How the player reaches an item fast** | A hotbar container, quick slots that point at items, a weapon wheel, or nothing | How much the inventory interrupts play |
| **Where the limit bites** | Slots, cells, kilograms, or no limit | What the player has to give up, and when |

## Pick the style

Ask what game it is if the user hasn't said, then pick one. Each is a preset in `InventoryConfig.Styles`; `node scripts/rinv.cjs styles` prints them.

| Style | Like | Containers | Fast access | Use it for |
|---|---|---|---|---|
| `Attache` | Survival-horror attache case | 10x6 `Grid`, shaped items, rotate with R | 4 quick slots | Horror and action games where packing the case is part of the fun |
| `Survivor` | Classic survival horror | 8 big `Slots`, small stacks | none (open the screen) | Tension through scarcity: every pickup is a decision. Needs item boxes |
| `Wheel` | Open-world crime games | Unlimited `List` | 8-segment weapon wheel (hold Q / L1) | Shooters and sandboxes where nobody should manage a bag mid-fight |
| `Hotbar` | Block-survival games | 9-slot hotbar + 27 `Slots` | Number keys on the hotbar | Survival, crafting, building: lots of stackable materials |
| `Weight` | Open-world RPGs | `List` with a soft weight cap | 8 favourites | Loot-heavy RPGs: carry anything, pay for it in speed |
| `Extraction` | Extraction shooters | 5 equipment `Slots` + 8x7 `Grid` | Equipment slots on 1-5 | PvPvE looting where the loadout is the stake |

If the game fits none, make a new preset: `references/styles.md` has each one in detail and a recipe for mixing them (a hotbar in front of a grid, a wheel on top of any style, different sizes).

**Don't copy another game's look.** The mechanics above are genre conventions and free to use; the art, icons, sounds and names of a specific game are not. The kit's themes are original.

## What "overriding the built-in inventory" really means

Tell the user this up front, because it decides how their existing weapons keep working:

1. **The Backpack CoreGui is switched off** (`SetCoreGuiEnabled(Backpack, false)`): the hotbar, the backpack window, the number keys and the backquote key all go away.
2. **Tools are kept, as the thing in the player's hands.** Roblox weapon code (including the `roblox-combat` kit) is built on Tools: `Equipped`, `Activated`, the grip weld, animations. So an item with a `Tool` field equips by cloning that Tool from `ServerStorage.Tools` into the character, and the clone is destroyed when it is put away. The `Backpack` instance still exists but stays empty.
3. **The inventory is the only source of items.** A Tool that arrives any other way (touching one lying in the world, an old script, `StarterPack`) is converted into its catalog item or removed. Nothing can be equipped that the inventory doesn't hold.

Games with no Tools at all (custom viewmodels, fists only) just leave `Tool` off their items and listen to `InventoryService.EquippedChanged`.

## The rules that make it safe

1. **The client asks, the server decides.** Every remote call is a request ("move this uid there"). The server checks the uid is in a container that player may touch, the destination is legal, stacks and weight hold, and the chest is still in reach, using its own copy. Never accept an item id, a count or a container's contents from a client.
2. **One module holds the rules.** `InventoryCore` is pure Luau run by both sides: the client uses it to predict and to colour the drop target, the server uses it to decide. They cannot disagree about what fits.
3. **Every change is all-or-nothing.** A move, swap, combine or purchase either completes or leaves everything as it was. Half-applied changes are how items duplicate.
4. **Give with `Add`, and read what it returns.** `Add` returns how many fit. Decide what happens to the rest (leave it on the ground, refuse the purchase with `CanAdd` first) instead of assuming.
5. **Save through one session-locked profile.** The kit stores items in the player's ProfileStore data. Session locking is what stops duplication by joining two servers; don't write items to a second DataStore.
6. **A full inventory must never eat an item.** Pickups stay in the world, converted Tools drop at the player's feet, items that no longer fit after a catalog or style change wait in an overflow list until there is room.
7. **Everything works without a mouse.** Each action is a button in the detail panel, so touch and gamepad can do all of it. Don't hide a feature behind right-click or hover.

## The kit

`assets/kit/` follows the `roblox-project-structure` layout (`shared` → `ReplicatedStorage.Shared`, `server` → `ServerScriptService.Server`, `client` → `StarterPlayerScripts.Client`). Services and Controllers are started by the scaffold's Loader; it uses the scaffold's `Net` and `DataService` modules and the Signal package. The UI is built from plain Instances and needs no UI library.

| File | Side | Does |
|---|---|---|
| `shared/Inventory/InventoryConfig.luau` | both | The chosen `Style`, the six presets, starter items, death and drop rules, distances, loot tables, key bindings. All tuning lives here. |
| `shared/Inventory/ItemCatalog.luau` | both | Every item (name, category, stack size, grid size, weight, Tool, use handler, wheel group) and the combine recipes. Example content: replace it. |
| `shared/Inventory/InventoryCore.luau` | both | Pure container logic: add, remove, move, split, merge, swap, rotate, transfer, sort, weight, save and load with repair. No Roblox APIs. |
| `server/Services/InventoryService.luau` | server | The authority. Loads and saves through DataService, validates `InventoryAction` requests, replicates with `InventoryState`, starter items, death rules, encumbrance, outside containers. Public API and signals for the rest of the game. |
| `server/Services/EquipService.luau` | server | Puts the equipped item's Tool in the character, removes it when put away, converts loose and StarterPack Tools into items. |
| `server/Services/WorldItemService.luau` | server | Tagged pickups, dropped items, loot chests with refill, and item boxes that open the personal stash. Distance-checked ProximityPrompts. |
| `client/Controllers/InventoryController.luau` | client | Hides the Backpack CoreGui, mirrors state, predicts moves, binds keys (toggle, number keys, wheel, rotate), opens and closes the UI. |
| `client/Inventory/InventoryWindow.luau` | client | The inventory screen: a panel per container plus the detail panel with every action as a button. Sizes itself to the screen. |
| `client/Inventory/InventoryDrag.luau` | client | The held item: press-drag for mouse and touch, pick-and-place for gamepad, split stacks. |
| `client/Inventory/InventoryUi.luau` | client | Instance helpers, the six colour themes, the item tile. |
| `client/Inventory/Views/SlotGridView.luau` | client | View for `Slots` containers (hotbars, backpacks, equipment, chests). |
| `client/Inventory/Views/ShapeGridView.luau` | client | View for `Grid` containers: shaped items, rotation, fit highlight. |
| `client/Inventory/Views/ListView.luau` | client | View for `List` containers: rows, category tabs, weight. |
| `client/Inventory/Views/WheelView.luau` | client | The weapon wheel. |
| `client/Inventory/Views/QuickBar.luau` | client | The always-visible quick slots and the touch buttons. |

### Install

```bash
node scripts/rinv.cjs install --src <project>/src --style Attache
```

This copies the kit, sets the style, adds the two remotes to `src/shared/Net/init.luau` and lists what the project is missing. It never overwrites an existing `ItemCatalog.luau` or `InventoryConfig.luau`. Without Node, copy the three folders into `src` by hand and add the remotes listed at the top of `InventoryConfig.luau` (`InventoryState` and `InventoryAction`, both `"Event"`).

Then, with the user:

1. **Write the catalog.** Replace the examples in `ItemCatalog.luau`, or keep items in a JSON sheet and run `node scripts/rinv.cjs catalog items.json --out <project>/src/shared/Inventory/ItemCatalog.luau` (it checks ids, sizes, recipes and ammo links; `assets/items.example.json` shows the format). Field reference: `references/items-and-tools.md`.
2. **Provide the Tools.** One Tool per equippable item in `ServerStorage.Tools`, named after the item's `Tool` field. Tools left in `StarterPack` are moved there automatically and granted once.
3. **Place the world.** Tag pickups `WorldItem` (attribute `ItemId`, optional `Count`, `Respawn`), chests `InventoryContainer` (attributes `Slots` or `Layout = "Grid"` + `Width`, `Height`, optional `Loot`, `Refill`, `Title`), storage boxes `ItemBox`.
4. **Hook up the game.** Rewards, shops and quests call `InventoryService:Add`; costs call `Remove`; custom consumables register a handler with `RegisterUse`. API: `references/architecture.md`.
5. **Test with two clients** (Test → Clients and Servers) and run the checklist in `references/troubleshooting.md`.

When writing new code for the project, keep the split: only `InventoryService` changes what a player has, clients only draw and request, rules live in `InventoryCore`, numbers in `InventoryConfig`, content in `ItemCatalog`.

## Decide the mode

| The user wants... | Do this |
|---|---|
| "Remove / hide / replace the default backpack" | Install the kit with the closest style. Explain the three points above so they know Tools still work. |
| An inventory "like <game>" | Map it to a style in the table; `references/styles.md` for the details and what to tune. |
| A style the presets don't cover | Add a preset (`references/styles.md` §8). Containers, fast access and limits combine freely. |
| Items, stacking, sizes, icons, consumables, key items | `ItemCatalog.luau` and `references/items-and-tools.md`. |
| Guns that use ammo from the inventory, or the `roblox-combat` kit | `references/items-and-tools.md` §5. |
| Chests, loot, enemy drops, shops, crafting, trading | `references/architecture.md` §5–6. Trading needs both sides in one transaction; read the warning there first. |
| The UI restyled or rebuilt (their art, React, another layout) | Keep the server and `InventoryCore`; replace views. `references/architecture.md` §7 has the contract a view must meet. The `roblox-ui` skill has the component kit. |
| "Items duplicate / vanish / the old hotbar is still there / tools won't equip" | The table in `references/troubleshooting.md`. |
| An existing inventory reviewed | Check it against the seven rules; `roblox-security` has the scanner for unsafe remotes. |

## What good looks like

- **The old backpack is gone and nothing is lost.** No default hotbar, no stray Tools, and every weapon the game had still equips, fires and animates.
- **The limit is felt, not fought.** Players understand at a glance why something doesn't fit (the cells are red, the weight is over) and what would make room.
- **Moving items is instant.** Drags land immediately and never rubber-band in normal play; a refused move snaps back with a short reason.
- **Fast access matches the pace.** A shooter never opens a full-screen bag to switch guns; a horror game is allowed to make you stop and choose.
- **It survives a hostile client.** Firing the remotes with made-up uids, counts, positions and container ids changes nothing. Two clients can't take the same chest item. Leaving mid-drag loses nothing.
- **It works on a phone and a controller.** Every action reachable by tap and by buttons, the wheel by thumbstick, the grid sized to the screen.
- **It persists.** Rejoin and everything is where it was left; change the catalog and old saves still load.

## Limits to be honest about

- The kit's Luau is carefully reviewed and statically cross-checked (`node scripts/selftest.cjs`: structure, references between modules, the remote protocol, the installer), but it has not been run in Studio as part of building this skill. `tests/InventoryCore.spec.luau` covers the container logic and runs with the standalone `luau` CLI; run it, then do the two-client checklist before shipping.
- There is no pause in a multiplayer game: opening the inventory doesn't stop the world, and the wheel can't slow time. Both blur the screen; the danger of looking away is yours to tune.
- Items have no icons until you add them: tiles show initials on a tinted plate. Real icons (`Icon = "rbxassetid://..."`) change the feel more than any other single step.
- On a `Grid`, dropping an item onto a different one does not swap them (their shapes rarely fit each other's space). Dropping onto a stack of the same item merges; onto a recipe partner combines.
- Containers inside containers (a backpack item that has its own grid) and player-to-player trading are not in the kit. `references/architecture.md` §6 says how to build each on top of it and what to watch for.
- Encumbrance sets `Humanoid.WalkSpeed` directly. If the game already changes walk speed (sprinting, the `roblox-ragdoll` kit's leg injuries), read the `Encumbered` player attribute in that one place instead and set `EncumberedWalkSpeed = nil`.

## References

- `references/styles.md` — each of the six styles: what it is for, its containers and controls, what to tune, common variants; and how to build a new preset or combine two.
- `references/items-and-tools.md` — catalog fields, stacking and sizes, icons and world models, how Tools are equipped and converted, use handlers, ammo and the combat kit, key items, death rules.
- `references/architecture.md` — data flow, the save format and migration, the remote protocol, the full server and client API with signals, pickups and chests, shops, crafting, enemy drops, trading, replacing the UI, performance.
- `references/troubleshooting.md` — symptom → cause → fix table, the two-client test checklist, the exploit checklist.
