--!strict
-- Owns every inventory in the game. The only code that changes what a player has.
--
--   * A player's containers come from InventoryConfig.Styles[Style] and are saved through
--     DataService under data.Inventory (ProfileStore's session lock is what stops duplication
--     by server hopping).
--   * Clients send InventoryAction requests; each is checked here against the server's own
--     copy (ownership, position, stack and weight rules, distance to an open chest) and the
--     result is sent back as InventoryState. A rejected request re-sends the true contents,
--     which undoes whatever the client predicted.
--   * Outside containers (chests, loot, shops' stock) are created with CreateContainer and
--     shown to a player with OpenContainer. The style's Stash is the player's own, opened
--     the same way.
--
-- Other services use Add / Remove / Count / CanAdd / Equip / RegisterUse and the signals.
-- EquipService puts Tools in hands; WorldItemService handles drops, pickups and chests.

local HttpService = game:GetService("HttpService")
local Players = game:GetService("Players")
local ReplicatedStorage = game:GetService("ReplicatedStorage")

local Catalog = require(ReplicatedStorage.Shared.Inventory.ItemCatalog)
local Config = require(ReplicatedStorage.Shared.Inventory.InventoryConfig)
local Core = require(ReplicatedStorage.Shared.Inventory.InventoryCore)
local DataService = require(script.Parent.DataService)
local Net = require(ReplicatedStorage.Shared.Net)
local Signal = require(ReplicatedStorage.Packages.Signal)

local Items = Catalog.Items :: Core.Defs
local style = (Config.Styles :: any)[Config.Style] :: Config.Style
assert(style, `InventoryConfig.Style "{Config.Style}" is not one of InventoryConfig.Styles`)

local STASH = "Stash"
local SAVE_VERSION = 1

type State = {
	Containers: { [string]: Core.Container },
	Saved: any, -- data.Inventory; its Containers[name] point at the live Items arrays
	Equipped: string?,
	Shortcuts: { [string]: string },
	Open: string?, -- id of the outside container on screen
	OpenOrigin: Instance?, -- where it is in the world, for the distance check
	LastUse: number,
	BaseWalkSpeed: number?,
}

type World = {
	Container: Core.Container,
	Title: string,
	Viewers: { [Player]: boolean },
}

type UseHandler = (player: Player, item: Core.Item, def: Core.ItemDef) -> boolean?

local InventoryService = {
	Loaded = Signal.new(), -- (player) inventory is ready
	Changed = Signal.new(), -- (player, containerName) one of the player's containers changed
	ContainerChanged = Signal.new(), -- (containerId) an outside container changed
	EquippedChanged = Signal.new(), -- (player, item?, def?)
	Dropped = Signal.new(), -- (player, itemId, count, data?) left the inventory into the world
	Used = Signal.new(), -- (player, itemId, def) a use handler consumed one
}

local states: { [Player]: State } = {}
local worlds: { [string]: World } = {}
local useHandlers: { [string]: UseHandler } = {}
local extraStarterItems: { { Id: string, Count: number } } = {}
local stateEvent: RemoteEvent

local function newUid(): string
	return string.sub((string.gsub(HttpService:GenerateGUID(false), "-", "")), 1, 12)
end

local function send(player: Player, key: string, payload: any)
	stateEvent:FireClient(player, key, payload)
end

local function positionOf(instance: Instance?): Vector3?
	if not instance or not instance:IsDescendantOf(workspace) then
		return nil
	end
	if instance:IsA("BasePart") then
		return instance.Position
	elseif instance:IsA("Model") then
		return instance:GetPivot().Position
	elseif instance:IsA("Attachment") then
		return instance.WorldPosition
	end
	return nil
end

local function rootOf(player: Player): BasePart?
	local character = player.Character
	local root = character and character:FindFirstChild("HumanoidRootPart")
	return if root and root:IsA("BasePart") then root else nil
end

local function humanoidOf(player: Player): Humanoid?
	local character = player.Character
	return character and character:FindFirstChildOfClass("Humanoid")
end

-- Sends one container's full contents to a player who is allowed to see it.
local function syncContainer(player: Player, id: string)
	local state = states[player]
	if not state then
		return
	end
	local own = state.Containers[id]
	if own then
		send(player, id, { Spec = own.Spec, Items = Core.Save(own), Title = own.Spec.Title })
		return
	end
	local world = worlds[id]
	if world and world.Viewers[player] then
		send(player, id, { Spec = world.Container.Spec, Items = Core.Save(world.Container), Title = world.Title })
	end
end

local function findCarried(state: State, uid: string): (Core.Container?, string?, Core.Item?)
	for _, name in style.Carry do
		local container = state.Containers[name]
		local item = Core.Find(container, uid)
		if item then
			return container, name, item
		end
	end
	return nil, nil, nil
end

local function setEquipped(player: Player, state: State, uid: string?)
	if state.Equipped == uid then
		return
	end
	state.Equipped = uid
	state.Saved.Equipped = uid
	send(player, "Equipped", uid or false)
	local item: Core.Item? = nil
	if uid then
		local _, _, found = findCarried(state, uid)
		item = found
	end
	InventoryService.EquippedChanged:Fire(player, item, if item then Items[item.Id] else nil)
end

local function updateWeight(player: Player, state: State)
	local over = false
	for _, name in style.Carry do
		local container = state.Containers[name]
		local spec = container.Spec
		if spec.MaxWeight and spec.SoftWeight and Core.Weight(container, Items) > spec.MaxWeight + 1e-6 then
			over = true
		end
	end
	if player:GetAttribute("Encumbered") == over then
		return
	end
	player:SetAttribute("Encumbered", over)
	local humanoid = humanoidOf(player)
	local slow = Config.EncumberedWalkSpeed
	if not humanoid or not slow then
		return
	end
	if over then
		state.BaseWalkSpeed = humanoid.WalkSpeed
		humanoid.WalkSpeed = math.min(humanoid.WalkSpeed, slow)
	elseif state.BaseWalkSpeed then
		humanoid.WalkSpeed = state.BaseWalkSpeed
		state.BaseWalkSpeed = nil
	end
end

-- Call after any change to a container: saves, replicates, keeps Equipped honest.
local function touch(player: Player?, id: string)
	local state = if player then states[player] else nil
	local own = state and state.Containers[id]
	if player and state and own then
		state.Saved.Containers[id] = own.Items -- Sort and rollbacks replace the array
		syncContainer(player, id)
		if state.Equipped and not findCarried(state, state.Equipped) then
			setEquipped(player, state, nil)
		end
		updateWeight(player, state)
		InventoryService.Changed:Fire(player, id)
		return
	end
	local world = worlds[id]
	if world then
		for viewer in world.Viewers do
			syncContainer(viewer, id)
		end
		InventoryService.ContainerChanged:Fire(id)
	end
end

local function closeOutside(player: Player, state: State)
	local id = state.Open
	if not id then
		return
	end
	state.Open = nil
	state.OpenOrigin = nil
	local world = worlds[id]
	if world then
		world.Viewers[player] = nil
	end
	send(player, "Open", false)
end

local function near(player: Player, origin: Instance?): boolean
	if origin == nil then
		return true -- opened from code with no place in the world (a menu)
	end
	local position = positionOf(origin)
	local root = rootOf(player)
	-- A little slack: the prompt's own range plus a moving character's lag.
	return position ~= nil and root ~= nil and (root.Position - position).Magnitude <= Config.UseDistance + 6
end

-- The container a request may touch right now, or nil.
local function resolve(player: Player, state: State, id: unknown): Core.Container?
	if type(id) ~= "string" then
		return nil
	end
	local outside = id == STASH or state.Containers[id] == nil
	if outside then
		if state.Open ~= id then
			return nil
		end
		if not near(player, state.OpenOrigin) then
			closeOutside(player, state)
			return nil
		end
	end
	local own = state.Containers[id]
	if own then
		return own
	end
	local world = worlds[id]
	return if world then world.Container else nil
end

local function isWorld(state: State, id: string): boolean
	return state.Containers[id] == nil
end

-- Adds to the carried containers: the ones already holding the item first, then in Carry order.
local function addCarried(state: State, id: string, count: number, data: { [string]: any }?): (number, { string })
	local order = {}
	for _, name in style.Carry do
		if Core.FindId(state.Containers[name], id) then
			table.insert(order, name)
		end
	end
	for _, name in style.Carry do
		if not table.find(order, name) then
			table.insert(order, name)
		end
	end
	local left = count
	local touched = {}
	for _, name in order do
		if left <= 0 then
			break
		end
		local added = Core.Add(state.Containers[name], Items, id, left, data, newUid)
		if added > 0 then
			left -= added
			table.insert(touched, name)
		end
	end
	return count - left, touched
end

local function readDest(value: unknown): Core.Dest?
	if type(value) ~= "table" then
		return nil
	end
	local raw = value :: any
	return {
		Slot = if type(raw.Slot) == "number" then raw.Slot else nil,
		X = if type(raw.X) == "number" then raw.X else nil,
		Y = if type(raw.Y) == "number" then raw.Y else nil,
		Rot = raw.Rot == true,
	}
end

local function optionalCount(value: unknown): (boolean, number?)
	if value == nil then
		return true, nil
	end
	if type(value) == "number" and value % 1 == 0 and value >= 1 and value < 1e6 then
		return true, value
	end
	return false, nil
end

-- Key items never leave the player's own containers.
local function mayLeave(state: State, container: Core.Container, uid: string, toId: string): boolean
	if not isWorld(state, toId) then
		return true
	end
	local item = Core.Find(container, uid)
	local def = item and Items[item.Id]
	return def ~= nil and def.Droppable ~= false
end

-- A swap sends whatever sits at the destination back the other way, so that item must be
-- allowed to leave too: a key item can't be swapped out into a chest.
local function swapMayLeave(state: State, fromId: string, to: Core.Container, dest: Core.Dest): boolean
	local slot = dest.Slot
	if not isWorld(state, fromId) or to.Spec.Layout ~= "Slots" or not slot then
		return true
	end
	local target = Core.ItemAtSlot(to, slot)
	local def = target and Items[target.Id]
	return not (def and def.Droppable == false)
end

-- Requests ------------------------------------------------------------------------------------

-- Arguments after `state` come straight from a client: every handler checks their types.
local actions: { [string]: (...any) -> () } = {}

function actions.Move(player, state, fromId, uid, toId, rawDest, rawCount)
	if type(fromId) ~= "string" or type(toId) ~= "string" or type(uid) ~= "string" then
		return
	end
	local from = resolve(player, state, fromId)
	local to = resolve(player, state, toId)
	local dest = readDest(rawDest)
	local countOk, count = optionalCount(rawCount)
	local ok = false
	if from and to and dest and countOk and mayLeave(state, from, uid, toId) and swapMayLeave(state, fromId, to, dest) then
		ok = Core.Move(from, to, Items, uid, dest, count, newUid)
	end
	if ok then
		touch(player, fromId)
		if toId ~= fromId then
			touch(player, toId)
		end
	else
		syncContainer(player, fromId)
		syncContainer(player, toId)
	end
end

function actions.Transfer(player, state, fromId, uid, toId, rawCount)
	if type(fromId) ~= "string" or type(toId) ~= "string" or type(uid) ~= "string" then
		return
	end
	local from = resolve(player, state, fromId)
	local to = resolve(player, state, toId)
	local countOk, count = optionalCount(rawCount)
	local moved = 0
	if from and to and countOk and mayLeave(state, from, uid, toId) then
		moved = Core.Transfer(from, to, Items, uid, count, newUid)
	end
	if moved > 0 then
		touch(player, fromId)
		touch(player, toId)
	else
		syncContainer(player, fromId)
		syncContainer(player, toId)
		if from and to then
			send(player, "Message", "No room")
		end
	end
end

function actions.Combine(player, state, fromId, uid, toId, targetUid)
	if type(fromId) ~= "string" or type(toId) ~= "string" or type(uid) ~= "string" or type(targetUid) ~= "string" then
		return
	end
	-- Only inside the player's own containers.
	if isWorld(state, fromId) or isWorld(state, toId) then
		return
	end
	local from = resolve(player, state, fromId)
	local to = resolve(player, state, toId)
	local a = from and Core.Find(from, uid)
	local b = to and Core.Find(to, targetUid)
	local recipe = if a and b and a ~= b then Catalog.FindRecipe(a.Id, b.Id) else nil
	if not (from and to and recipe) then
		syncContainer(player, fromId)
		syncContainer(player, toId)
		return
	end
	local backupFrom = Core.Save(from)
	local backupTo = if to ~= from then Core.Save(to) else nil
	Core.Take(from, uid, 1)
	Core.Take(to, targetUid, 1)
	if Core.Add(to, Items, recipe.Result, recipe.Count, nil, newUid) < recipe.Count then
		from.Items = backupFrom
		if backupTo then
			to.Items = backupTo
		end
		send(player, "Message", "No room")
	end
	touch(player, fromId)
	if toId ~= fromId then
		touch(player, toId)
	end
end

function actions.Use(player, _state, uid)
	if type(uid) == "string" then
		InventoryService:Use(player, uid)
	end
end

function actions.Equip(player, _state, uid)
	if uid == false or uid == nil then
		InventoryService:Equip(player, nil)
	elseif type(uid) == "string" then
		InventoryService:Equip(player, uid)
	end
end

function actions.Drop(player, state, containerId, uid, rawCount)
	if not Config.AllowDrop or type(containerId) ~= "string" or type(uid) ~= "string" then
		return
	end
	local countOk, count = optionalCount(rawCount)
	if isWorld(state, containerId) or not countOk then
		return
	end
	local container = resolve(player, state, containerId)
	local item = container and Core.Find(container, uid)
	local def = item and Items[item.Id]
	if not container or not def then
		return
	end
	if def.Droppable == false then
		send(player, "Message", "You can't drop that")
		return
	end
	local taken = Core.Take(container, uid, count)
	if taken then
		touch(player, containerId)
		InventoryService.Dropped:Fire(player, taken.Id, taken.Count, taken.Data)
	end
end

function actions.Sort(player, state, containerId)
	if type(containerId) ~= "string" then
		return
	end
	local container = resolve(player, state, containerId)
	if container and Core.Sort(container, Items) then
		touch(player, containerId)
	end
end

function actions.Assign(player, state, index, itemId)
	local slots = style.Shortcuts or 0
	if type(index) ~= "number" or index % 1 ~= 0 or index < 1 or index > slots then
		return
	end
	local key = tostring(index)
	if itemId == false or itemId == nil then
		state.Shortcuts[key] = nil
	elseif type(itemId) == "string" and Items[itemId] then
		-- One slot per item: assigning it again moves it.
		for other, id in state.Shortcuts do
			if id == itemId then
				state.Shortcuts[other] = nil
			end
		end
		state.Shortcuts[key] = itemId
	else
		return
	end
	send(player, "Shortcuts", state.Shortcuts)
end

function actions.Close(player, state)
	closeOutside(player, state)
end

-- Loading and lifecycle -------------------------------------------------------------------------

local function loadPlayer(player: Player, data: any)
	if player.Parent ~= Players then
		return
	end
	local saved = data.Inventory
	if type(saved) ~= "table" then
		saved = {}
		data.Inventory = saved
	end
	local fresh = saved.Version == nil
	saved.Version = SAVE_VERSION
	if type(saved.Containers) ~= "table" then
		saved.Containers = {}
	end
	local shortcuts: { [string]: string } = {}
	if type(saved.Shortcuts) == "table" then
		for key, id in saved.Shortcuts do
			if type(key) == "string" and type(id) == "string" and Items[id] then
				shortcuts[key] = id
			end
		end
	end
	saved.Shortcuts = shortcuts

	local state: State = {
		Containers = {},
		Saved = saved,
		Equipped = nil,
		Shortcuts = shortcuts,
		Open = nil,
		OpenOrigin = nil,
		LastUse = 0,
		BaseWalkSpeed = nil,
	}

	-- Items that did not fit last time, plus whatever does not fit now, get another chance.
	local waiting = if type(saved.Overflow) == "table" then saved.Overflow else {}
	saved.Overflow = {}

	local specs: { [string]: Core.Spec } = table.clone(style.Containers)
	if style.Stash then
		specs[STASH] = style.Stash
	end
	for name, spec in specs do
		local container, overflow = Core.Load(spec, saved.Containers[name], Items, newUid)
		state.Containers[name] = container
		saved.Containers[name] = container.Items
		table.move(overflow, 1, #overflow, #waiting + 1, waiting)
	end
	-- Containers saved under a name this style does not have (the style was changed).
	for name, items in saved.Containers do
		if not state.Containers[name] then
			local orphan = Core.Load({ Layout = "List" }, items, Items, newUid)
			for _, item in orphan.Items do
				table.insert(waiting, { Id = item.Id, Count = item.Count, Data = item.Data })
			end
			saved.Containers[name] = nil
		end
	end

	states[player] = state

	for _, entry in waiting do
		if type(entry) == "table" and type(entry.Id) == "string" and Items[entry.Id] and type(entry.Count) == "number" then
			local data = if type(entry.Data) == "table" then entry.Data else nil
			local added = addCarried(state, entry.Id, entry.Count, data)
			if added < entry.Count then
				table.insert(saved.Overflow, { Id = entry.Id, Count = entry.Count - added, Data = data })
			end
		end
	end
	if #saved.Overflow > 0 then
		send(player, "Message", "Some items are waiting for free space")
	end

	if fresh then
		for _, entry in style.StarterItems or Config.StarterItems do
			addCarried(state, entry.Id, entry.Count, nil)
		end
		for _, entry in extraStarterItems do
			addCarried(state, entry.Id, entry.Count, nil)
		end
	end

	for name, container in state.Containers do
		saved.Containers[name] = container.Items
		syncContainer(player, name)
	end
	send(player, "Shortcuts", state.Shortcuts)
	send(player, "Equipped", false)
	if Config.ReequipOnSpawn and type(saved.Equipped) == "string" and findCarried(state, saved.Equipped) then
		setEquipped(player, state, saved.Equipped)
	else
		saved.Equipped = nil
	end
	updateWeight(player, state)
	InventoryService.Loaded:Fire(player)
end

local function onDied(player: Player)
	local state = states[player]
	if not state then
		return
	end
	local policy = Config.OnDeath
	if policy ~= "Keep" then
		for _, name in style.Carry do
			local container = state.Containers[name]
			local changed = false
			for _, item in table.clone(container.Items) do
				local def = Items[item.Id]
				local spared = (def and def.Droppable == false) or (policy == "DropEquipped" and item.Uid ~= state.Equipped)
				if not spared then
					local taken = Core.Take(container, item.Uid, nil)
					changed = true
					if taken and policy ~= "Clear" then
						InventoryService.Dropped:Fire(player, taken.Id, taken.Count, taken.Data)
					end
				end
			end
			if changed then
				touch(player, name)
			end
		end
	end
	if not Config.ReequipOnSpawn then
		setEquipped(player, state, nil)
	end
	closeOutside(player, state)
end

local function onCharacter(player: Player, character: Model)
	local humanoid = character:WaitForChild("Humanoid", 10)
	if not humanoid or not humanoid:IsA("Humanoid") then
		return
	end
	humanoid.Died:Once(function()
		onDied(player)
	end)
	local state = states[player]
	if state then
		state.BaseWalkSpeed = nil
		player:SetAttribute("Encumbered", nil)
		updateWeight(player, state)
	end
end

function InventoryService:Init()
	stateEvent = Net.Event("InventoryState")

	-- Built-in use handler: items with Use = "Heal" restore `Heal` health.
	useHandlers.Heal = function(player, _item, def)
		local humanoid = humanoidOf(player)
		if not humanoid or humanoid.Health <= 0 or humanoid.Health >= humanoid.MaxHealth then
			return false -- don't waste it at full health
		end
		humanoid.Health = math.min(humanoid.MaxHealth, humanoid.Health + (def.Heal or 25))
		return true
	end
end

function InventoryService:Start()
	Net.Handle("InventoryAction", Config.ActionsPerSecond, function(player, action, ...)
		local state = states[player]
		local handler = if type(action) == "string" then actions[action] else nil
		if state and handler then
			handler(player, state, ...)
		end
	end)

	DataService:ObserveProfiles(loadPlayer)

	local function onPlayer(player: Player)
		player.CharacterAdded:Connect(function(character)
			onCharacter(player, character)
		end)
		if player.Character then
			task.spawn(onCharacter, player, player.Character)
		end
	end
	Players.PlayerAdded:Connect(onPlayer)
	for _, player in Players:GetPlayers() do
		onPlayer(player)
	end

	Players.PlayerRemoving:Connect(function(player)
		local state = states[player]
		if state then
			closeOutside(player, state)
			states[player] = nil
		end
	end)

	-- Close chests and item boxes for players who walked away.
	task.spawn(function()
		while true do
			task.wait(0.5)
			for player, state in states do
				if state.Open and not near(player, state.OpenOrigin) then
					closeOutside(player, state)
				end
			end
		end
	end)
end

-- Public API ------------------------------------------------------------------------------------

function InventoryService:IsLoaded(player: Player): boolean
	return states[player] ~= nil
end

-- Yields until the player's inventory is ready. False if they left first.
function InventoryService:WaitUntilLoaded(player: Player): boolean
	while not states[player] do
		if player.Parent ~= Players then
			return false
		end
		task.wait(0.1)
	end
	return true
end

-- Gives items. Returns how many fit (0..count): check it, and decide what happens to the rest.
function InventoryService:Add(player: Player, id: string, count: number?, data: { [string]: any }?): number
	local state = states[player]
	if not state or not Items[id] then
		return 0
	end
	local added, touched = addCarried(state, id, count or 1, data)
	for _, name in touched do
		touch(player, name)
	end
	return added
end

-- True when all of it would fit. Check before taking payment.
function InventoryService:CanAdd(player: Player, id: string, count: number?): boolean
	local state = states[player]
	if not state or not Items[id] then
		return false
	end
	local copy: State = table.clone(state)
	copy.Containers = {}
	for _, name in style.Carry do
		copy.Containers[name] = Core.Clone(state.Containers[name])
	end
	return (addCarried(copy, id, count or 1, nil)) == (count or 1)
end

function InventoryService:Count(player: Player, id: string): number
	local state = states[player]
	local total = 0
	if state then
		for _, name in style.Carry do
			total += Core.Count(state.Containers[name], id)
		end
	end
	return total
end

-- Takes items the player carries. All or nothing.
function InventoryService:Remove(player: Player, id: string, count: number?): boolean
	local state = states[player]
	local want = count or 1
	if not state or want < 1 or want % 1 ~= 0 or InventoryService:Count(player, id) < want then
		return false
	end
	local left = want
	for _, name in style.Carry do
		local container = state.Containers[name]
		local n = math.min(left, Core.Count(container, id))
		if n > 0 and Core.Remove(container, id, n) then
			left -= n
			touch(player, name)
		end
	end
	return true
end

-- Puts a carried item in the player's hands (it needs a `Tool`), or nil to put it away.
function InventoryService:Equip(player: Player, uid: string?): boolean
	local state = states[player]
	if not state then
		return false
	end
	if uid == nil then
		setEquipped(player, state, nil)
		return true
	end
	local _, _, item = findCarried(state, uid)
	local def = item and Items[item.Id]
	if not def or not def.Tool then
		return false
	end
	setEquipped(player, state, uid)
	return true
end

function InventoryService:GetEquipped(player: Player): (Core.Item?, Core.ItemDef?)
	local state = states[player]
	if not state or not state.Equipped then
		return nil, nil
	end
	local _, _, item = findCarried(state, state.Equipped)
	return item, if item then Items[item.Id] else nil
end

-- Uses a carried item: runs its use handler and consumes one, or toggles a Tool item.
function InventoryService:Use(player: Player, uid: string): boolean
	local state = states[player]
	if not state then
		return false
	end
	local container, name, item = findCarried(state, uid)
	local def = item and Items[item.Id]
	if not container or not name or not item or not def then
		return false
	end
	if def.Use then
		local handler = useHandlers[def.Use]
		local now = os.clock()
		if not handler then
			warn(`[Inventory] item "{item.Id}" has Use = "{def.Use}" but no handler is registered`)
			return false
		end
		if now - state.LastUse < Config.UseCooldown then
			return false
		end
		state.LastUse = now
		local ok, consumed = pcall(handler, player, item, def)
		if not ok then
			warn(`[Inventory] use handler "{def.Use}" failed: {consumed}`)
			return false
		end
		if consumed == false then
			return false
		end
		Core.Take(container, uid, 1)
		touch(player, name)
		InventoryService.Used:Fire(player, item.Id, def)
		return true
	elseif def.Tool then
		return InventoryService:Equip(player, if state.Equipped == uid then nil else uid)
	end
	return false
end

-- handler(player, item, def) runs on the server when an item with Use = name is used.
-- Return false to refuse (nothing is consumed); anything else consumes one.
function InventoryService:RegisterUse(name: string, handler: UseHandler)
	useHandlers[name] = handler
end

-- Extra items for brand-new players, on top of the configured StarterItems. Call from Init.
function InventoryService:AddStarterItem(id: string, count: number)
	table.insert(extraStarterItems, { Id = id, Count = count })
end

-- A carried container ("Main", "Hotbar", ...) or the Stash. Read it; change it through the API.
function InventoryService:GetContainer(player: Player, name: string): Core.Container?
	local state = states[player]
	return if state then state.Containers[name] else nil
end

function InventoryService:Message(player: Player, text: string)
	send(player, "Message", text)
end

-- True when the player's character is within UseDistance of a part, model or attachment.
function InventoryService:IsNear(player: Player, instance: Instance): boolean
	return near(player, instance)
end

-- Outside containers --------------------------------------------------------------------------

-- Creates a container that lives on this server (a chest, a corpse, a shop shelf).
function InventoryService:CreateContainer(id: string, spec: Core.Spec, title: string?): Core.Container
	assert((style.Containers :: any)[id] == nil and id ~= STASH, `container id "{id}" is reserved`)
	local world = worlds[id]
	if not world then
		world = { Container = Core.New(spec), Title = title or spec.Title or "Container", Viewers = {} }
		worlds[id] = world
	end
	return world.Container
end

function InventoryService:DestroyContainer(id: string)
	local world = worlds[id]
	if not world then
		return
	end
	for viewer in world.Viewers do
		local state = states[viewer]
		if state then
			closeOutside(viewer, state)
		end
	end
	worlds[id] = nil
end

-- Adds items to an outside container. Returns how many fit.
function InventoryService:Fill(id: string, itemId: string, count: number, data: { [string]: any }?): number
	local world = worlds[id]
	if not world then
		return 0
	end
	local added = Core.Add(world.Container, Items, itemId, count, data, newUid)
	if added > 0 then
		touch(nil, id)
	end
	return added
end

function InventoryService:Empty(id: string)
	local world = worlds[id]
	if world then
		world.Container.Items = {}
		touch(nil, id)
	end
end

function InventoryService:HasViewers(id: string): boolean
	local world = worlds[id]
	return world ~= nil and next(world.Viewers) ~= nil
end

-- Shows an outside container (or "Stash") next to the player's inventory. `origin` is where
-- it is in the world: the player must stay within UseDistance of it. Pass nil for menus.
function InventoryService:OpenContainer(player: Player, id: string, origin: Instance?): boolean
	local state = states[player]
	if not state then
		return false
	end
	local world = worlds[id]
	if id == STASH then
		if not state.Containers[STASH] then
			return false
		end
	elseif not world then
		return false
	end
	if origin and not near(player, origin) then
		return false
	end
	closeOutside(player, state)
	state.Open = id
	state.OpenOrigin = origin
	if world then
		world.Viewers[player] = true
	end
	syncContainer(player, id)
	send(player, "Open", id)
	return true
end

function InventoryService:CloseContainer(player: Player)
	local state = states[player]
	if state then
		closeOutside(player, state)
	end
end

return InventoryService
