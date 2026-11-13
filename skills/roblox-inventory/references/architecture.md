# Architecture and API

## 1. Data flow

```
 client                                   server
 ──────                                   ──────
 drag / key / button
   └─ InventoryController
        ├─ predict with InventoryCore  (local copy changes at once)
        └─ InventoryAction ───────────►  InventoryService
                                           ├─ may this player touch these containers?
                                           ├─ InventoryCore decides (same rules)
                                           ├─ write to the profile's tables
        InventoryState  ◄──────────────────┘  full contents of each changed container
   └─ replace the local copy, redraw
```

- The server's answer always replaces the client's copy. If the server refused, it re-sends the true contents and the item snaps back. There is no delta protocol to get out of sync: a container is at most a few kilobytes.
- `InventoryCore` has no Roblox APIs and no requires. That is deliberate: it runs on both sides, and in the `luau` CLI for tests.
- Three kinds of container, one mechanism: **carried** (in the style's `Carry`), the **stash** (the player's own, reachable only while an item box is open), and **outside** containers created by the server (chests). A request names containers by id; `resolve` in `InventoryService` is the single place that decides whether the player may touch one right now.

## 2. Save format and migration

Stored in the player's profile as `data.Inventory`:

```lua
Inventory = {
    Version = 1,
    Containers = {
        Main  = { { Uid = "a1b2c3d4e5f6", Id = "Pistol", Count = 1, X = 1, Y = 1, Rot = true, Data = { Rounds = 7 } }, ... },
        Stash = { { Uid = "...", Id = "PistolAmmo", Count = 50, Slot = 3 }, ... },
    },
    Shortcuts = { ["1"] = "GreenHerb" },   -- string keys: sparse arrays don't survive DataStores
    Overflow = { { Id = "Shotgun", Count = 1 } },
    Equipped = "a1b2c3d4e5f6",
}
```

The live containers point at these same arrays, so there is no "save" step: whatever ProfileStore writes is current.

What happens on load (`Core.Load`), so that changing the game never corrupts or silently deletes:

| Change you made | What loading does |
|---|---|
| Removed an item id from the catalog | Those items are dropped from the save (intended: that is how you delete an item) |
| Lowered a `MaxStack` | The stack is split into legal stacks |
| Changed an item's `Size`, or shrank a grid | Items that still fit stay put; the rest are re-placed in the first free space |
| Switched `Style` (slots → grid, renamed containers) | Everything is re-fitted into the new containers |
| Anything that still doesn't fit | Goes to `Overflow`, and is tried again on every load. The player sees "Some items are waiting for free space" |
| Malformed or duplicated entries | Skipped; duplicate uids are re-issued |

Adding `Inventory = {}` to `DataTemplate` is optional (the field is created on first load); it only helps typing. Brand-new inventories (`Version == nil`) receive the starter items.

## 3. The remote protocol

Two RemoteEvents, declared in `src/shared/Net/init.luau`.

**`InventoryAction`** (client → server), rate-limited by `ActionsPerSecond`:

| Action | Arguments | Server checks |
|---|---|---|
| `"Move"` | fromId, uid, toId, `{ Slot }` or `{ X, Y, Rot }`, count? | both containers reachable; uid is in `from`; destination in bounds, accepted, free / same stack / swappable; weight; key items stay with the player |
| `"Transfer"` | fromId, uid, toId, count? | same, destination chosen by the server |
| `"Combine"` | fromId, uid, toId, targetUid | both in the player's own containers; a recipe exists; the result fits, else everything is restored |
| `"Use"` | uid | carried; has a handler; cooldown |
| `"Equip"` | uid or false | carried; has a `Tool` |
| `"Drop"` | containerId, uid, count? | own container; `AllowDrop`; `Droppable` |
| `"Sort"` | containerId | reachable |
| `"Assign"` | index, itemId or false | index within `Shortcuts`; id is in the catalog |
| `"Close"` | — | — |

**`InventoryState`** (server → client): `(key, payload)` where key is a container id (`{ Spec, Items, Title }`), `"Equipped"` (uid or false), `"Shortcuts"`, `"Open"` (outside container id or false), or `"Message"` (text).

Adding an action: write `function actions.Name(player, state, ...)` in `InventoryService`, type-check every argument first, change containers only through `Core`, call `touch` for each one changed, and document it in the header of `InventoryConfig.luau`. `node scripts/selftest.cjs` fails if a handler uses an argument it never checks.

## 4. API

### Server: `InventoryService`

```lua
local InventoryService = require(script.Parent.InventoryService)
```

| Method | Returns | Notes |
|---|---|---|
| `Add(player, id, count?, data?)` | number added | Fills existing stacks first, then `Carry` order. **Check the result** |
| `CanAdd(player, id, count?)` | boolean | Would all of it fit? Call before taking payment |
| `Remove(player, id, count?)` | boolean | All or nothing, from carried containers |
| `Count(player, id)` | number | Carried only |
| `Equip(player, uid?)` | boolean | `nil` puts everything away |
| `GetEquipped(player)` | item?, def? | |
| `Use(player, uid)` | boolean | Same path as the client's request |
| `RegisterUse(name, handler)` | | `handler(player, item, def) -> boolean?` |
| `AddStarterItem(id, count)` | | Call from another Service's `Init` |
| `GetContainer(player, name)` | container? | Read only. `"Main"`, `"Stash"`, ... |
| `IsLoaded(player)` / `WaitUntilLoaded(player)` | boolean | Inventory exists once the profile has loaded |
| `Message(player, text)` | | Short notice on the client |
| `IsNear(player, instance)` | boolean | Within `UseDistance` |
| `CreateContainer(id, spec, title?)` | container | An outside container on this server |
| `Fill(id, itemId, count, data?)` | number added | Put items in an outside container |
| `Empty(id)` / `DestroyContainer(id)` | | |
| `HasViewers(id)` | boolean | Someone has it open |
| `OpenContainer(player, id, origin?)` | boolean | `id` or `"Stash"`. With `origin` the player must stay near it |
| `CloseContainer(player)` | | |

Signals: `Loaded(player)`, `Changed(player, containerName)`, `ContainerChanged(containerId)`, `EquippedChanged(player, item?, def?)`, `Dropped(player, itemId, count, data?)`, `Used(player, itemId, def)`.

`EquipService:GetTool(player)` returns the Tool the inventory put in the player's hands. `WorldItemService:Spawn(id, count, position, data?)` puts a pickup in the world.

### Client: `InventoryController`

`IsOpen()`, `Open()`, `Close()`, `Count(itemId)`, `GetEquipped()`, and the `Changed(key)` signal. The client copy is for display: never send what it says back to the server as fact. Other controllers should check `InventoryController.IsOpen()` before acting on clicks (don't fire the gun through the inventory screen).

The player attribute `Encumbered` (boolean) replicates on its own for HUDs.

## 5. Pickups, chests and enemy drops

- **Pickups:** tag `WorldItem`, attribute `ItemId`; optional `Count`, `Respawn` (seconds). The prompt's `Triggered` runs on the server, which checks distance again and calls `Add`. Partial pickups leave the remainder with an updated count.
- **Chests:** tag `InventoryContainer`. Attributes: `Slots` (default 12) + `Columns`, or `Layout = "Grid"` with `Width` and `Height`; `Title`; `Loot` (a key of `LootTables`) rolled once at start, and again every `Refill` seconds while nobody has it open. Several players can have the same chest open: each move is validated against the one server copy, so two players can't take the same item (the second request finds the uid gone and is refused).
- **Item box:** tag `ItemBox`. Opens the player's `Stash`; same contents at every box.
- **Enemy drops:**

  ```lua
  enemy.Humanoid.Died:Once(function()
      WorldItemService:Spawn("PistolAmmo", math.random(3, 8), enemy:GetPivot().Position)
  end)
  ```

- **A lootable body:** `CreateContainer("Corpse" .. id, { Layout = "Slots", Slots = 8 }, "Remains")`, `Fill` it, give the model a prompt that calls `OpenContainer(player, id, model)`, and `DestroyContainer` when it despawns.

## 6. Building on top

**Shops.** Never let the client name a price.

```lua
function ShopService:Buy(player, itemId)
    local offer = OFFERS[itemId]                       -- server table
    if not offer or not InventoryService:CanAdd(player, itemId, offer.Count) then
        return false                                   -- "No room" before any money moves
    end
    if not CurrencyService:Spend(player, offer.Price, "Shop") then
        return false
    end
    InventoryService:Add(player, itemId, offer.Count)
    return true
end
```

Selling is `Remove` then pay; `Remove` returning false means they don't have it. For Robux products, grant inside `ProcessReceipt` and only return `PurchaseGranted` after `Add` returned the full count.

**Crafting from a menu** (many inputs): check every input with `Count`, check the output with `CanAdd`, then `Remove` each and `Add`. Because the server runs one request to completion before the next, nothing can change between the checks and the writes as long as you don't yield in between.

**Trading.** The kit has no player-to-player trade, on purpose: it is the classic duplication surface. If you build it: both offers are lists of uids held on the server; either player changing an offer clears both confirmations; on the final confirm, re-validate that every uid is still in its owner's carried containers and that both sides have room (`Core.CanAdd` on clones), then move everything in one function without yielding. Both players must be in the same server with loaded profiles. Never trade across servers through MessagingService.

**Containers inside containers** (a backpack item with its own grid): keep the inner contents in the item's `Data` (`Data.Items`), and when the player opens it, build a temporary outside container from that data with `CreateContainer`, write it back on close. Forbid putting a bag inside itself or another bag, or cap depth at one.

**Durability / loaded rounds / enchantments:** the item's `Data`. Change it on the server and call nothing else: the tables are the save. To show it on the client, re-send the container by making any change through the service, or add a small `Touch` method that calls the internal `touch`.

## 7. Replacing the UI

The server and `InventoryCore` don't know the UI exists. To restyle, edit `InventoryUi.Themes` and `InventoryUi.Tile`. To rebuild (your own art, React via the `roblox-ui` kit), keep `InventoryController`'s state handling and replace the window. A view must:

- draw from `ctx.State.Containers[id]` (`{ Spec, Items, Title }`) and redraw when the controller calls `Render()`;
- never change that table: call `ctx.Drag.Begin` / `ctx.Select` / `ctx.Activate` / `ctx.Send` and wait for state;
- implement `HitTest(position, held) -> { Dest, TargetUid? }?` and `Hover(position?, held?)` if items can be dropped on it, `FirstSelectable()` for gamepad focus, and `Destroy()`;
- register with `ctx.Drag.Register(self)`.

`SlotGridView` is the shortest complete example.

## 8. Performance

- A container sync is one remote with a table of at most a few hundred small entries. Typical play sends well under one per second per player.
- The window is built when opened and destroyed when closed: no hidden Instances during play. A 10x12 grid is about 250 Instances while open.
- `Core.FindSpace` on a grid is the heaviest call (cells × items). At 10x12 with 60 items it is still microseconds; it would matter only for auto-sorting very large grids every frame, which nothing does.
- Dropped items are capped (`MaxDrops`) and expire (`DropLifetime`). The `roblox-performance` skill covers the wider budget.
