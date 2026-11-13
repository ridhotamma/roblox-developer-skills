# Troubleshooting and testing

## 1. Symptom → cause → fix

| Symptom | Cause | Fix |
|---|---|---|
| The default hotbar is still there | `InventoryController` never started (not under `Client/Controllers`, or the Loader errored earlier), or another script re-enables the Backpack CoreGui | Check the client output for a failed `Init`. Search the project for `SetCoreGuiEnabled` and `CoreGuiType.All` |
| `Remote "InventoryState" is not declared in Net.REMOTES` | The remotes weren't added | Add `InventoryState = "Event"` and `InventoryAction = "Event"` to `src/shared/Net/init.luau`, or run `rinv.cjs install` |
| Inventory is empty and never fills | The profile didn't load (DataService kicked or is still waiting), so `InventoryService` has no state for the player | Look for DataService errors. In Studio, ProfileStore uses a mock store unless API access is enabled: that still loads |
| Nothing saves in Studio | Studio API access is off, so ProfileStore is mocking | Game Settings → Security → Enable Studio Access to API Services |
| Item won't equip; output says it needs a Tool | No Tool named after the item's `Tool` field in `ServerStorage.Tools` | Add it. The name must match exactly |
| Tool appears in the hand, then vanishes | Something unequipped it (a seat, `Humanoid:UnequipTools()`, a script reparenting it). The kit treats that as "put away" | Find the script. If it is intended (sitting), re-equip from the server when it ends |
| A weapon forgets its ammo every time it is drawn | State is stored on the Tool instance, which is a fresh clone per equip | Keep it on the server keyed by the `ItemUid` attribute, or in the item's `Data` (`references/items-and-tools.md` §4–5) |
| Player gets the same starter weapon again on every respawn | A Tool is still being handed out each spawn (StarterPack with `MigrateStarterPack = false`, or a script cloning into the Backpack) and converted into an item each time | Leave `MigrateStarterPack = true`, remove the script, grant through `StarterItems` |
| Picked-up Tools disappear | `UnknownTools = "Destroy"` and the Tool matches no catalog item | Add a catalog item with that `Tool` name, or give the Tool an `ItemId` attribute |
| "Inventory full" but there is visible space | Grid: the free cells don't form the item's shape in either orientation. Slots with `SlotAccept` / `Accept`: the free slot refuses that category. Weight: the hard cap is reached | Sort. For filters, check `Category` spelling matches the spec |
| Items moved, then snapped back | The server refused. Usually the client copy was stale (two fast moves) or the chest is out of reach | Normal under lag. If constant: compare the client's reason toast with the server rule; check `UseDistance` against the prompt distance |
| Chest closes by itself | The player moved beyond `UseDistance` + 6 studs of the tagged part | Raise `UseDistance`, or tag a part nearer where players stand. For a Model, set its pivot sensibly |
| Stash "Nothing to store here" | The style has no `Stash` spec | Add one to the style |
| Number keys do nothing | Style has neither `Bar` nor `Shortcuts`; or a shortcut slot isn't bound; or a TextBox has focus | Bind items in the detail panel (quick slot row) |
| Wheel segment is empty though the player has the weapon | The item has no `Tool`, or its `WheelGroup` doesn't match a segment name exactly | Fix the catalog. `rinv.cjs catalog` warns about both |
| Mouse stays locked with the window open (first person) | Another script sets `MouseBehavior` every frame | Have it skip while `InventoryController.IsOpen()` |
| Gun fires when clicking in the inventory | The weapon controller doesn't know the UI is open | Check `InventoryController.IsOpen()` (or `gameProcessed`) in the fire input |
| Walk speed stuck low after dropping weight | Another script changed `WalkSpeed` while encumbered, so the remembered "normal" speed is wrong | Drive speed from one place: read the `Encumbered` attribute there and set `EncumberedWalkSpeed = nil` |
| After changing the catalog some players report missing items | An item id was renamed or removed: saves refer to ids | Restore the id (change only `Name`). To really rename, add the new id and convert old ones in `loadPlayer` |
| "Some items are waiting for free space" | Items didn't fit after a style, size or catalog change and are in `Overflow` | They return on the next load with room. Give players room, or a bigger stash |
| Items duplicated | Almost always game code outside the kit: giving before a yield and again after, a second DataStore, granting on the client's say-so, or a trade that isn't one transaction | Grant only through `Add` on the server, in response to server-verified events. See §3 |
| Dropped item can't be picked up | It landed inside geometry or under the map | Drops raycast down from in front of the player; in tight spaces raise the origin or drop at the character's feet |

## 2. Two-client checklist

Run **Test → Clients and Servers** with 2 players. Ten minutes; do it after installing and after any change to rules.

1. Join: no default hotbar. I (or `) opens the inventory with the starter items.
2. Pick up a tagged `WorldItem`. It appears; the world copy is gone for both players.
3. Fill the inventory, pick up one more: "Inventory full", and the item is still in the world.
4. Drag an item to an empty place, onto a stack of the same item (merges), onto a different item (swaps in slots, refused on a grid). Rotate one on a grid (R).
5. Split a stack and place the half. Counts add up.
6. Use a healing item at full health (refused, not consumed), then damaged (consumed).
7. Equip a Tool item: it is in the hand for the *other* client too. Put it away: gone for both. Equip, then reset the character: no Tool left behind, items follow `OnDeath`.
8. Number keys / wheel switch items; the highlighted quick slot matches the hand.
9. Drop an item: a pickup appears in front of the player; the other player can take it; it can't be taken twice.
10. Both players open the same chest and grab the same item at once: exactly one gets it.
11. Walk away from an open chest: it closes.
12. Stash an item at one `ItemBox`, take it out at another.
13. Leave and rejoin (with Studio API access on): everything is where it was, including grid positions and quick slots.
14. Phone emulator (Device toolbar): the window fits, drag works, every action has a button. Gamepad: A picks and places, X uses, Y rotates, B closes.

## 3. Exploit checklist

Open the developer console on a client (or use a test LocalScript) and fire `InventoryAction` yourself. Every one of these must change nothing and error nothing on the server:

```lua
local action = game.ReplicatedStorage.Remotes.InventoryAction
action:FireServer("Move", "Main", "not-a-uid", "Main", { Slot = 1 })
action:FireServer("Move", "Main", realUid, "Main", { X = 0/0, Y = -5, Rot = "yes" })
action:FireServer("Move", "Main", realUid, "Main", { Slot = 1 }, 1e9)
action:FireServer("Move", "Main", realUid, "Main", { Slot = 1 }, -1)
action:FireServer("Move", "World1", someUid, "Main", { Slot = 1 })      -- a chest that isn't open
action:FireServer("Transfer", "Stash", someUid, "Main")                 -- no item box open
action:FireServer("Drop", "Main", keyItemUid)                           -- Droppable = false
action:FireServer("Use", otherPlayersUid)
action:FireServer("Assign", 99, "Pistol")
action:FireServer("Nope")
action:FireServer({}, {}, {})
for _ = 1, 500 do action:FireServer("Sort", "Main") end                 -- rate limit
```

Then the rules that are yours to keep:

- **No remote takes an item id and a count and gives it.** Rewards are decided by server code reacting to server-verified events (the enemy the server killed, the prompt the server saw triggered in range).
- **No yield between check and write** in shops, crafting and trades. `CanAdd` → `Spend` → `Add` in one go.
- **ProximityPrompts are not proof of distance.** `WorldItemService` re-checks; do the same in prompts you add.
- **Client-side `Count` is for display.** A door that needs a key asks the server.
- **One DataStore owner.** Only `DataService` touches persistence, with session locking.
- Run the `roblox-security` skill's scanner over the project after adding your own remotes.

## 4. Running the automated checks

```bash
node scripts/selftest.cjs
```

Checks the kit's structure, that modules reference each other correctly, that client and server agree on the protocol, the installer and the catalog builder. With the standalone Luau CLI installed (`brew install luau`, or a release from github.com/luau-lang/luau) it also runs `tests/InventoryCore.spec.luau`: stacking, moving, splitting, merging, swapping, grid fitting and rotation, weight, sorting, and save repair. Run that file again whenever `InventoryCore` changes:

```bash
luau tests/InventoryCore.spec.luau
```
