# Items and Tools

## 1. Catalog fields

`ItemCatalog.Items` is keyed by item id (an identifier: `PistolAmmo`, not `"pistol ammo"`). Ids are what gets saved, so **never rename an id that players already own**: change `Name` instead. Removing an id deletes that item from saves the next time each player loads.

| Field | Type | Default | Used for |
|---|---|---|---|
| `Name` | text | required | Shown everywhere |
| `Category` | text | required | List tabs, sorting, `Accept` / `SlotAccept` filters. Free text, but equipment slots must match it exactly |
| `Description` | text | none | Detail panel |
| `Icon` | `"rbxassetid://..."` | initials on a tinted plate | The tile |
| `Color` | `Color3` | theme grey | Tile tint, and the placeholder block when dropped |
| `MaxStack` | whole number | 1 | Units per stack |
| `Size` | `{ width, height }` | `{ 1, 1 }` | Cells covered in `Grid` containers |
| `Weight` | number | 0 | Per unit, in containers with `MaxWeight` |
| `Tool` | text | none | Name of a Tool in `ServerStorage.Tools`. Makes the item equippable |
| `Use` | text | none | Name of a use handler (§6). Makes the item consumable |
| `Heal` | number | 25 | Health restored by the built-in `"Heal"` handler |
| `WheelGroup` | text | none | Segment of the weapon wheel |
| `Ammo` | item id | none | That item's carried count is shown as this weapon's ammo |
| `Droppable` | boolean | true | `false` = can't be dropped, traded into chests, or lost on death |
| `Model` | text | the item id | Name of the model in `ReplicatedStorage.ItemModels` shown when it lies in the world |

Add your own fields freely (`Damage`, `Rarity`, `Price`): the kit ignores what it doesn't know, and both server and client can read them from the catalog.

**From a spreadsheet:** keep items in JSON (`assets/items.example.json`) and run `node scripts/rinv.cjs catalog items.json --out src/shared/Inventory/ItemCatalog.luau`. It refuses bad ids, sizes, colours and dangling `Ammo` / recipe references, and warns about items too big for a style's grid, wheel groups no style has, and two items sharing one Tool.

## 2. Stacks, sizes and weight

- **Stacks.** `MaxStack` is per item; a container spec's `MaxStack` caps it further inside that container. Adding tops up existing stacks before opening new ones.
- **Items with state don't stack.** `InventoryService:Add(player, "Pistol", 1, { Rounds = 7, Durability = 80 })` attaches `Data` to that one item. It travels with the item through moves, drops and saves. Keep it small and remote-safe (numbers, strings, booleans, plain tables).
- **Sizes** only matter in grids. Rules of thumb: ammo `2x1`, small consumables `1x1`, pistols `2x2`, long guns `5x2`–`7x2`, a few awkward shapes (`3x3`, `1x4`) for flavour. Rotation swaps width and height.
- **Weight** only matters in containers with `MaxWeight`. One decimal place is plenty.

## 3. Icons and world models

- **Icons:** square images for 1x1 items; for shaped items draw the icon at the item's aspect ratio (a `5x2` shotgun as a wide image). The tile rotates the image when the item is rotated. Upload as Decals/Images and use the *image* id.
- **World models:** when an item is dropped or spawned, `WorldItemService` clones `ReplicatedStorage.ItemModels[Model or id]` (a Model or a BasePart). With none, it makes a small tinted block sized from `Size`, so drops work from day one.
- A pickup placed by hand in Studio is anything tagged `WorldItem` with an `ItemId` attribute: use the real prop.

## 4. How Tools are handled

What the kit does to replace the built-in backpack:

| Built-in behaviour | What happens now |
|---|---|
| Hotbar and backpack UI, keys 1–0, backquote | Off: `SetCoreGuiEnabled(Backpack, false)` in `InventoryController` |
| Tools wait in `player.Backpack` | The Backpack stays empty. An item is just data until equipped |
| Equipping parents the Tool to the character | Same, but `EquipService` clones it from `ServerStorage.Tools` when the inventory says so, with attributes `ItemUid` and `ItemId`, and destroys it when put away |
| Backspace drops the Tool | `CanBeDropped = false`; dropping goes through the inventory (`AllowDrop`) |
| Touching a Tool in the world picks it up | The Tool is converted into its item (name matches a catalog `Tool`, or it has an `ItemId` attribute) and destroyed. If the inventory is full it becomes a pickup at the player's feet |
| `StarterPack` Tools every spawn | At startup, matching Tools are moved to `ServerStorage.Tools` and granted **once** as starter items (`MigrateStarterPack`) |
| Tools are lost on death, StarterPack returns | Items stay (`OnDeath = "Keep"`) or follow the death rule. The hands are empty on respawn unless `ReequipOnSpawn` |

Consequences worth telling the user:

- **Existing weapon scripts keep working** as long as they react to the Tool being in the character (`Equipped`, `Activated`, `ChildAdded`). Scripts that look in `player.Backpack` to see what a player owns must ask `InventoryService:Count` instead.
- **A Tool is a fresh clone every equip.** State kept on the Tool instance (ammo in an IntValue, a cooldown) resets. Keep per-weapon state on the server keyed by `ItemUid`, or in the item's `Data`.
- **Tools that match nothing** are destroyed by default (`UnknownTools = "Destroy"`), with one warning in the output per name. `"Keep"` leaves them in the hidden Backpack, where the player can't reach them: only useful for scripts that equip them by code.
- **Gear and admin commands** that hand out Tools turn into items if the catalog knows them. Add catalog entries for anything that should survive.

Games without Tools: leave `Tool` off, and do your own viewmodel from `InventoryService.EquippedChanged` (server) or `InventoryController.Changed` with key `"Equipped"` (client). `Equip` then refuses items without a `Tool`; either give them a dummy Tool or relax that check in `InventoryService:Equip`.

## 5. Ammo, and the roblox-combat kit

The combat kit's `WeaponService` keeps its own magazine and reserve per weapon name. Two ways to connect it:

- **Display only (no changes):** set `Ammo` on the weapon item. The wheel and detail panel show how many rounds are carried. Good when ammo is a pickup that goes straight to the reserve.
- **Inventory is the reserve (recommended for survival and horror):** in `WeaponService`, where a reload moves rounds from `reserve` to `magazine`, take them from the inventory instead:

  ```lua
  local need = weapon.Magazine - state.magazine
  local have = InventoryService:Count(player, weaponItem.Ammo)
  local take = math.min(need, have)
  if take > 0 and InventoryService:Remove(player, weaponItem.Ammo, take) then
      state.magazine += take
  end
  ```

  and report `have` as the reserve to the client. Look the item up from the equipped Tool: `Catalog.Items[tool:GetAttribute("ItemId")]`. Key the magazine state by `tool:GetAttribute("ItemUid")` rather than weapon name so two pistols don't share a magazine, and store the loaded rounds in the item's `Data` if they should persist.

The combat kit recognises a weapon by the Tool's `Weapon` attribute: set it on the template in `ServerStorage.Tools` and it is copied with every clone.

## 6. Use handlers

An item with `Use = "Name"` runs a server function when used. Register it from any Service's `Start`:

```lua
InventoryService:RegisterUse("Antidote", function(player, item, def)
    local character = player.Character
    if not character or not character:GetAttribute("Poisoned") then
        return false -- refuse: nothing is consumed
    end
    character:SetAttribute("Poisoned", nil)
    return true -- consume one
end)
```

- Return `false` to refuse (full health, wrong place, on cooldown). Anything else consumes one unit.
- The handler runs on the server after the kit has checked the player carries the item and `UseCooldown` has passed. Do the game-specific checks (alive, not stunned, in range of the door for a key) inside it.
- `"Heal"` is built in and refuses at full health.
- `InventoryService.Used` fires after a successful use, for sounds, analytics and quests.
- Timed use (a two-second bandage): start your own progress on the server in the handler and return `false`, then `InventoryService:Remove` when it completes. Don't trust a client-side timer.

## 7. Key items and death

- `Droppable = false` items can't be dropped, moved into world containers, or removed by a death rule. They *can* go in the personal stash. Use it for keys and quest items.
- `OnDeath`: `"Keep"` (default), `"DropAll"`, `"DropEquipped"`, `"Clear"`. Dropped items land near the body as pickups and last `DropLifetime` seconds.
- A key that opens a door is a server check, not an item use: `if InventoryService:Count(player, "RustyKey") > 0 then`. Remove it only if the design wants keys consumed.
