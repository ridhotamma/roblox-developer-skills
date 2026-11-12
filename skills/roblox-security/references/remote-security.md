# Remote security

## Contents
1. The handler checklist
2. Validating values (what clients can send)
3. Vulnerable → fixed examples
4. State machines and idempotency
5. Rate limits and payload size
6. RemoteFunctions
7. Honeypots
8. Text and chat

---

## 1. The handler checklist

Every `OnServerEvent` / `OnServerInvoke` handler, in this order:

1. **Rate limit** (per player, per remote): drop extra calls.
2. **Types and ranges** of every argument: `typeof`, NaN/inf rejected, lengths capped, allow-lists for ids.
3. **Player state**: data loaded, character alive, not in a cutscene/menu that forbids this.
4. **Ownership**: the item/pet/plot/unit belongs to this player.
5. **Context**: distance to the target/shop/NPC, line of sight, correct zone or round phase.
6. **Cooldown** on the server clock (`os.clock()`), not a client timestamp.
7. **Cost/requirements** from server config (price, level, resources).
8. **Apply** the change on the server, in server data.
9. **Reply** with the result (event back, or let replication show it).

Reject silently (return) on failure. For checks that legit clients can't fail (NaN position, unknown item id, 50 calls/second), also `Sanctions.Flag` the player.

## 2. Validating values

Values a client can send through a remote: `nil`, booleans, numbers (including NaN, `math.huge`, `-math.huge`, huge integers), strings (any bytes, any length up to the remote payload limit), tables (arrays and dictionaries, nested; metatables are stripped; mixed or non-string keys get mangled), Roblox datatypes (Vector3, CFrame, Color3, EnumItem, etc., which can also contain NaN/inf components), and Instances (as references, only ones the receiver also has; the client may pass any Instance it can see, including other players' characters and tools).

Patterns (kit `Validate` module):

```lua
local itemId = Validate.OneOf(rawItemId, ShopConfig.Items)        -- unknown ids -> nil
local amount = Validate.Integer(rawAmount, 1, 99)                   -- rejects 0.5, -1, NaN, 1e9
local name   = Validate.String(rawName, 20, "^[%w_ ]+$")            -- length + charset
local target = Validate.Vector3(rawTarget, 10000)                   -- rejects NaN/inf components
local door   = Validate.Instance(rawDoor, "BasePart", workspace.Doors)
local slots  = Validate.Array(rawSlots, 10, function(v) return Validate.Integer(v, 1, 40) end)
if not (itemId and amount and name and target and door and slots) then return end
```

Common mistakes:
- Range checks written as rejections let NaN through: every comparison with NaN is false, so `if amount > max then return end` accepts NaN. Check `x == x` (false only for NaN), or write checks as "accept if in range" like `Validate.Number` does.
- `tonumber(x)` on a client string accepts `"inf"`, `"nan"`, `"0x10"`, `"1e308"`.
- Indexing config with the client value (`Items[itemId]`) when itemId can be a table or `"__index"`: check type first.
- Trusting `#array` from a client table with holes.
- Using a client-sent Instance without checking its class and where it lives (`tool.Parent == player.Backpack or player.Character`).

## 3. Vulnerable → fixed examples

### Shop

```lua
-- VULNERABLE: client sends the price
Buy.OnServerEvent:Connect(function(player, itemId, price)
	data.Coins -= price
	giveItem(player, itemId)
end)

-- FIXED
Net.Handle("Buy", 2, function(player, rawItemId)
	local item = Validate.OneOf(rawItemId, ShopConfig.Items)
	if not item then return end
	if not Validate.Near(player, workspace.Shop.Counter.Position, 20) then return end
	if Inventory:Has(player, item.Id) and not item.Stackable then return end
	if not CurrencyService:Spend(player, item.Price, "Shop:" .. item.Id) then return end
	Inventory:Add(player, item.Id)
end)
```

### Damage

```lua
-- VULNERABLE: client decides who and how much
Hit.OnServerEvent:Connect(function(player, humanoid, damage)
	humanoid:TakeDamage(damage)
end)

-- FIXED: client says "I swung at this target"; server decides if it connects and for how much
Net.Handle("MeleeHit", 10, function(player, rawTarget)
	local target = Validate.Instance(rawTarget, "Model", workspace)
	local weapon = Combat:EquippedWeapon(player)                -- server-tracked, not client-sent
	if not (target and weapon) then return end
	if not swingCooldown(player) then return end                -- Validate.Cooldown(weapon.Cooldown)
	local humanoid = target:FindFirstChildOfClass("Humanoid")
	local root = target:FindFirstChild("HumanoidRootPart")
	if not (humanoid and root and humanoid.Health > 0) then return end
	if target == player.Character then return end
	if not Validate.Near(player, root.Position, weapon.Range + 4) then -- +4: latency tolerance
		Sanctions.Flag(player, "MeleeRange", 2)
		return
	end
	humanoid:TakeDamage(weapon.Damage)
end)
```
See anticheat.md for hitscan and projectile validation.

### Touched rewards (no remote, still client-triggered)

```lua
-- VULNERABLE: exploits fire Touched from anywhere on the map
coin.Touched:Connect(function(hit)
	local player = Players:GetPlayerFromCharacter(hit.Parent)
	if player then addCoins(player, 10) end
end)

-- FIXED: confirm the character is actually there, and debounce on the server
coin.Touched:Connect(function(hit)
	local player = Players:GetPlayerFromCharacter(hit.Parent)
	if not player or not ready then return end
	if not Validate.Near(player, coin.Position, coin.Size.Magnitude / 2 + 6) then return end
	ready = false
	addCoins(player, 10)
end)
```
Same for `ProximityPrompt.Triggered` (re-check `MaxActivationDistance` plus a margin) and `ClickDetector.MouseClick`.

### Giving tools / spawning things

```lua
-- VULNERABLE: client picks any tool from ServerStorage
GiveTool.OnServerEvent:Connect(function(player, toolName)
	ServerStorage.Tools[toolName]:Clone().Parent = player.Backpack
end)
```
Fix: the client requests by id, the server checks the player owns/unlocked it (in data) and isn't over a limit, and clones from a server-side allow-list.

### Teleports

Client asks to go to a zone id; the server checks the zone is unlocked in the player's data, then teleports them itself (`AntiCheatService:Teleport`). Never accept a CFrame from the client to teleport to.

### Trades

Never let the client describe the trade's final state. The server holds the trade session: both offers, both confirmations, a short countdown after the last change, then an atomic swap inside both players' session-locked profiles (see economy-data-supply-chain.md).

### Admin commands

The server checks the sender's `UserId` against a server-side allow-list (or group rank via `player:GetRankInGroup`, cached) on **every** command. Never trust a client "isAdmin" flag or hide admin remotes in UI; the remote exists for everyone.

## 4. State machines and idempotency

Many exploits call steps out of order or twice: claim a quest reward without completing it, collect round rewards twice, sell an item while it's being traded.

- Track state per player on the server (`Questing → ReadyToClaim → Claimed`) and accept a request only in the right state. Transition before yielding (set "Claimed" first, then grant) so concurrent requests can't both pass.
- Make grants idempotent with ids: a reward for quest `q12` is recorded in data as claimed; a second request finds it and does nothing.
- Lock items involved in an operation (trade, sell, craft) until it finishes.

## 5. Rate limits and payload size

- One token-bucket limiter per remote (the scaffold's `Net.Handle(name, perSecond, handler)`). Typical: UI actions 2–5/s, combat inputs 10–20/s, movement-ish unreliable updates 20–30/s.
- Exceeding a limit by a lot (10× for seconds) is a signal: `Sanctions.Flag(player, "RemoteSpam", 1)`.
- Large payloads cost server memory and bandwidth even when rejected. Cap string lengths and array sizes in validation; never iterate a client table without a size cap; avoid `HttpService:JSONEncode` of client tables.
- Don't do expensive work (DataStore calls, pathfinding, big spatial queries) per client request without a cooldown.

## 6. RemoteFunctions

- **Server → client (`InvokeClient`)**: don't. A client can yield forever (hanging the server thread) or error. Use RemoteEvents both ways.
- **Client → server (`OnServerInvoke`)**: fine for request/response, with the same validation. Return simple values; never return secrets or other players' private data.

## 7. Honeypots

Remotes that legitimate code never fires, with tempting names (`AdminGiveCash`, `SetPlayerLevel`, `GrantItem`). Exploiters scanning for remotes try them. Firing one is near-certain proof of exploiting, so it can lead straight to a ban (kit: `SecurityConfig.HoneypotRemotes`).

Rules: the names must not be used by any real code (check with a search before adding); put them next to real remotes so they look real; ban only in enforce mode; log arguments for evidence. Rotate names occasionally.

## 8. Text and chat

- Any text one player writes that others can see (pet names, signs, plot titles, custom chat) must go through `TextService:FilterStringAsync` (and the right `GetNonChatStringForBroadcastAsync` / `GetChatForUserAsync` call) on the server before display. This is a Roblox policy requirement, not only security.
- Cap lengths and characters before filtering.
- Use `TextChatService` for chat; don't build an unfiltered custom chat.
