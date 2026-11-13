--!strict
-- Items and containers in the world. Builders tag things in Studio; no scripts inside parts.
--
--   Tag "WorldItem"           a pickup. Attributes: ItemId (string), Count (number, default 1),
--                             Respawn (seconds; 0 or missing = gone once taken).
--   Tag "InventoryContainer"  a chest / crate / locker. Attributes: Layout ("Slots" | "Grid"),
--                             Slots or Width + Height, Columns, Title, Loot (a key of
--                             InventoryConfig.LootTables), Refill (seconds), ContainerId.
--   Tag "ItemBox"             opens the player's own Stash (the same contents at every box).
--
-- Everything is a ProximityPrompt handled here on the server, with the distance checked
-- again: a prompt can be fired by an exploiter from anywhere.
-- Items dropped from an inventory (InventoryService.Dropped) land in front of the player.

local CollectionService = game:GetService("CollectionService")
local ReplicatedStorage = game:GetService("ReplicatedStorage")
local ServerStorage = game:GetService("ServerStorage")

local Catalog = require(ReplicatedStorage.Shared.Inventory.ItemCatalog)
local Config = require(ReplicatedStorage.Shared.Inventory.InventoryConfig)
local InventoryService = require(script.Parent.InventoryService)

local Items = Catalog.Items :: { [string]: any }

local WorldItemService = {}

local rng = Random.new()
local bound: { [Instance]: boolean } = setmetatable({}, { __mode = "k" }) :: any
local dropData: { [Instance]: { [string]: any } } = setmetatable({}, { __mode = "k" }) :: any
local drops: { Instance } = {}
local dropFolder: Folder
local containerCount = 0

local function promptFor(instance: Instance, action: string, object: string): ProximityPrompt
	local prompt = instance:FindFirstChildOfClass("ProximityPrompt")
	if not prompt then
		prompt = Instance.new("ProximityPrompt")
		prompt.RequiresLineOfSight = false
		prompt.Parent = instance
	end
	local result = prompt :: ProximityPrompt
	result.ActionText = action
	result.ObjectText = object
	result.MaxActivationDistance = Config.UseDistance
	return result
end

local function label(id: string, count: number): string
	local def = Items[id]
	local name = if def then def.Name else id
	return if count > 1 then `{name} x{count}` else name
end

local function countOf(instance: Instance): number
	local count = instance:GetAttribute("Count")
	return if type(count) == "number" and count >= 1 then math.floor(count) else 1
end

-- Pickups ---------------------------------------------------------------------------------------

local function pickUp(player: Player, instance: Instance, prompt: ProximityPrompt)
	local id = instance:GetAttribute("ItemId")
	if type(id) ~= "string" or not Items[id] or not instance:IsDescendantOf(workspace) then
		return
	end
	if not InventoryService:IsLoaded(player) or not InventoryService:IsNear(player, instance) then
		return
	end
	local count = countOf(instance)
	local added = InventoryService:Add(player, id, count, dropData[instance])
	if added <= 0 then
		InventoryService:Message(player, "Inventory full")
		return
	end
	if added < count then
		instance:SetAttribute("Count", count - added)
		prompt.ObjectText = label(id, count - added)
		return
	end

	local respawn = instance:GetAttribute("Respawn")
	if type(respawn) == "number" and respawn > 0 then
		local parent = instance.Parent
		instance.Parent = ServerStorage
		task.delay(respawn, function()
			if parent and parent:IsDescendantOf(game) then
				instance.Parent = parent
			else
				instance:Destroy()
			end
		end)
	else
		instance:Destroy()
	end
end

local function bindPickup(instance: Instance)
	if bound[instance] then
		return
	end
	local id = instance:GetAttribute("ItemId")
	if type(id) ~= "string" or not Items[id] then
		warn(`[Inventory] {instance:GetFullName()} is tagged {Config.PickupTag} but its ItemId attribute is not a catalog item`)
		return
	end
	bound[instance] = true
	local prompt = promptFor(instance, "Pick up", label(id, countOf(instance)))
	prompt.Triggered:Connect(function(player)
		pickUp(player, instance, prompt)
	end)
end

-- Puts an item in the world as a pickup. Returns the instance.
function WorldItemService:Spawn(id: string, count: number, position: Vector3, data: { [string]: any }?): Instance?
	local def = Items[id]
	if not def or count < 1 then
		return nil
	end
	local models = ReplicatedStorage:FindFirstChild(Config.ModelsFolder)
	local template = models and models:FindFirstChild(def.Model or id)
	local instance: Instance
	if template and template:IsA("Model") then
		local model = template:Clone()
		model:PivotTo(CFrame.new(position))
		instance = model
	elseif template and template:IsA("BasePart") then
		local part = template:Clone()
		part.CFrame = CFrame.new(position)
		instance = part
	else
		-- No model yet: a small tinted block the size of the item.
		local size = def.Size or { 1, 1 }
		local part = Instance.new("Part")
		part.Name = id
		part.Size = Vector3.new(math.clamp(size[1] * 0.7, 0.7, 3), 0.5, math.clamp(size[2] * 0.7, 0.7, 3))
		part.Color = def.Color or Color3.fromRGB(200, 200, 200)
		part.Material = Enum.Material.SmoothPlastic
		part.Anchored = true
		part.CanCollide = false
		part.CFrame = CFrame.new(position) * CFrame.Angles(0, rng:NextNumber(0, math.pi * 2), 0)
		instance = part
	end
	instance:SetAttribute("ItemId", id)
	instance:SetAttribute("Count", count)
	if data then
		dropData[instance] = data
	end
	instance.Parent = dropFolder
	CollectionService:AddTag(instance, Config.PickupTag)

	table.insert(drops, instance)
	while #drops > Config.MaxDrops do
		local oldest = table.remove(drops, 1)
		if oldest then
			oldest:Destroy()
		end
	end
	task.delay(Config.DropLifetime, function()
		local index = table.find(drops, instance)
		if index then
			table.remove(drops, index)
		end
		instance:Destroy()
	end)
	return instance
end

local function dropNear(player: Player, id: string, count: number, data: { [string]: any }?)
	local character = player.Character
	local root = character and character:FindFirstChild("HumanoidRootPart")
	if not character or not root or not root:IsA("BasePart") then
		return
	end
	local origin = root.Position
		+ root.CFrame.LookVector * 3
		+ Vector3.new(rng:NextNumber(-1.5, 1.5), 0, rng:NextNumber(-1.5, 1.5))
	local params = RaycastParams.new()
	params.FilterType = Enum.RaycastFilterType.Exclude
	params.FilterDescendantsInstances = { character, dropFolder }
	local hit = workspace:Raycast(origin + Vector3.new(0, 2, 0), Vector3.new(0, -30, 0), params)
	local position = if hit then hit.Position + Vector3.new(0, 0.4, 0) else root.Position
	WorldItemService:Spawn(id, count, position, data)
end

-- Containers ------------------------------------------------------------------------------------

local function rollLoot(containerId: string, tableName: string)
	local loot = (Config.LootTables :: any)[tableName]
	if not loot then
		warn(`[Inventory] loot table "{tableName}" is not in InventoryConfig.LootTables`)
		return
	end
	local total = 0
	for _, entry in loot.Entries do
		total += entry.Weight
	end
	for _ = 1, rng:NextInteger(loot.Rolls[1], loot.Rolls[2]) do
		local pick = rng:NextNumber() * total
		for _, entry in loot.Entries do
			pick -= entry.Weight
			if pick <= 0 then
				InventoryService:Fill(containerId, entry.Id, rng:NextInteger(entry.Count[1], entry.Count[2]))
				break
			end
		end
	end
end

local function numberAttribute(instance: Instance, name: string, default: number): number
	local value = instance:GetAttribute(name)
	return if type(value) == "number" and value >= 1 then math.floor(value) else default
end

local function bindContainer(instance: Instance)
	if bound[instance] or not instance:IsDescendantOf(workspace) then
		return
	end
	bound[instance] = true

	local id = instance:GetAttribute("ContainerId")
	if type(id) ~= "string" or id == "" then
		containerCount += 1
		id = `World{containerCount}`
		instance:SetAttribute("ContainerId", id)
	end
	local containerId = id :: string
	local title = instance:GetAttribute("Title")
	local titleText = if type(title) == "string" then title else "Container"
	local layout = if instance:GetAttribute("Layout") == "Grid" then "Grid" else "Slots"

	InventoryService:CreateContainer(containerId, {
		Layout = layout :: any,
		Slots = numberAttribute(instance, "Slots", 12),
		Columns = numberAttribute(instance, "Columns", 6),
		Width = numberAttribute(instance, "Width", 6),
		Height = numberAttribute(instance, "Height", 4),
		Title = titleText,
	}, titleText)

	local lootName = instance:GetAttribute("Loot")
	if type(lootName) == "string" then
		rollLoot(containerId, lootName)
		local refill = instance:GetAttribute("Refill")
		if type(refill) == "number" and refill > 0 then
			task.spawn(function()
				while instance:IsDescendantOf(workspace) do
					task.wait(refill)
					if instance:IsDescendantOf(workspace) and not InventoryService:HasViewers(containerId) then
						InventoryService:Empty(containerId)
						rollLoot(containerId, lootName)
					end
				end
			end)
		end
	end

	promptFor(instance, "Open", titleText).Triggered:Connect(function(player)
		InventoryService:OpenContainer(player, containerId, instance)
	end)
	instance.Destroying:Connect(function()
		InventoryService:DestroyContainer(containerId)
	end)
end

local function bindItemBox(instance: Instance)
	if bound[instance] then
		return
	end
	bound[instance] = true
	promptFor(instance, "Open", "Storage").Triggered:Connect(function(player)
		if not InventoryService:OpenContainer(player, "Stash", instance) then
			InventoryService:Message(player, "Nothing to store here")
		end
	end)
end

local function bindTag(tag: string, bind: (Instance) -> ())
	CollectionService:GetInstanceAddedSignal(tag):Connect(bind)
	for _, instance in CollectionService:GetTagged(tag) do
		task.spawn(bind, instance)
	end
end

function WorldItemService:Init()
	local folder = workspace:FindFirstChild("DroppedItems")
	if not folder or not folder:IsA("Folder") then
		folder = Instance.new("Folder")
		folder.Name = "DroppedItems"
		folder.Parent = workspace
	end
	dropFolder = folder :: Folder
end

function WorldItemService:Start()
	bindTag(Config.PickupTag, bindPickup)
	bindTag(Config.ContainerTag, bindContainer)
	bindTag(Config.ItemBoxTag, bindItemBox)
	InventoryService.Dropped:Connect(dropNear)
end

return WorldItemService
