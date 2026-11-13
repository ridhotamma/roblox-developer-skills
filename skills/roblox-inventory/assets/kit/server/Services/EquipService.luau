--!strict
-- Puts the equipped inventory item in the player's hands as a Roblox Tool, and keeps the
-- built-in Backpack empty.
--
-- The inventory is the truth; a Tool exists only while its item is equipped:
--   * InventoryService.EquippedChanged -> clone ServerStorage.Tools[def.Tool] into the
--     character (parenting a Tool to a character equips it), destroy the previous one.
--   * The clone carries attributes ItemUid and ItemId, so weapon code can find its item.
--   * If anything else unequips it (Humanoid:UnequipTools(), a seat, a script), the clone is
--     destroyed and the inventory is told nothing is equipped.
--
-- Tools that arrive from outside the inventory (touching a Tool lying in the world, an old
-- script parenting one to the Backpack, StarterPack) are converted into inventory items when
-- the catalog has a matching `Tool` name or the Tool has an ItemId attribute.

local Players = game:GetService("Players")
local ReplicatedStorage = game:GetService("ReplicatedStorage")
local ServerStorage = game:GetService("ServerStorage")
local StarterPack = game:GetService("StarterPack")

local Catalog = require(ReplicatedStorage.Shared.Inventory.ItemCatalog)
local Config = require(ReplicatedStorage.Shared.Inventory.InventoryConfig)
local InventoryService = require(script.Parent.InventoryService)

local Items = Catalog.Items :: { [string]: any }

local EquipService = {}

local held: { [Player]: Tool } = {}
local toolToItem: { [string]: string } = {}
local warned: { [string]: boolean } = {}
local toolsFolder: Instance

local function warnOnce(message: string)
	if not warned[message] then
		warned[message] = true
		warn(`[Inventory] {message}`)
	end
end

local function itemIdOf(tool: Tool): string?
	local id = tool:GetAttribute("ItemId")
	if type(id) == "string" and Items[id] then
		return id
	end
	return toolToItem[tool.Name]
end

-- Makes the character hold exactly what the inventory says is equipped.
local function apply(player: Player)
	local character = player.Character
	local humanoid = character and character:FindFirstChildOfClass("Humanoid")
	local item, def = InventoryService:GetEquipped(player)

	local current = held[player]
	if current and (not item or current.Parent ~= character or current:GetAttribute("ItemUid") ~= item.Uid) then
		held[player] = nil
		current:Destroy()
	end
	if not item or not def or held[player] then
		return
	end
	if not character or not humanoid or humanoid.Health <= 0 then
		return -- applied again when the next character spawns
	end

	local template = toolsFolder:FindFirstChild(def.Tool)
	if not template or not template:IsA("Tool") then
		warnOnce(`item "{item.Id}" needs a Tool named "{def.Tool}" in ServerStorage.{Config.ToolsFolder}`)
		InventoryService:Equip(player, nil)
		return
	end

	local tool = template:Clone()
	tool:SetAttribute("ItemUid", item.Uid)
	tool:SetAttribute("ItemId", item.Id)
	tool.CanBeDropped = false -- dropping goes through the inventory
	held[player] = tool
	tool.Parent = character

	tool.AncestryChanged:Connect(function()
		if held[player] == tool and tool.Parent ~= character then
			-- Unequipped by something other than the inventory.
			held[player] = nil
			task.defer(function()
				tool:Destroy()
				InventoryService:Equip(player, nil)
			end)
		end
	end)
end

-- A Tool the inventory did not create has reached the player: turn it into an item.
local function adopt(player: Player, tool: Tool)
	if tool:GetAttribute("ItemUid") ~= nil or tool.Parent == nil then
		return
	end
	local character = player.Character
	if not tool:IsDescendantOf(player) and not (character and tool:IsDescendantOf(character)) then
		return
	end
	local id = itemIdOf(tool)
	if not id then
		warnOnce(`Tool "{tool.Name}" matches no catalog item (UnknownTools = "{Config.UnknownTools}")`)
		if Config.UnknownTools == "Destroy" then
			tool:Destroy()
		end
		return
	end
	if not InventoryService:WaitUntilLoaded(player) or tool.Parent == nil then
		return
	end
	local count = tool:GetAttribute("Count")
	local amount = if type(count) == "number" and count >= 1 then math.floor(count) else 1
	tool:Destroy() -- first, so it can never be converted twice
	local added = InventoryService:Add(player, id, amount)
	if added < amount then
		-- No room: it goes back on the ground as a pickup instead of vanishing.
		InventoryService.Dropped:Fire(player, id, amount - added, nil)
		InventoryService:Message(player, "Inventory full")
	end
end

local function watch(player: Player)
	local function onChild(child: Instance)
		if child:IsA("Tool") then
			task.defer(adopt, player, child)
		end
	end
	local function onBackpack(backpack: Instance)
		backpack.ChildAdded:Connect(onChild)
		for _, child in backpack:GetChildren() do
			onChild(child)
		end
	end
	local function onCharacter(character: Model)
		-- The old character took its Tool with it.
		local old = held[player]
		held[player] = nil
		if old then
			old:Destroy()
		end
		character.ChildAdded:Connect(onChild)
		for _, child in character:GetChildren() do
			onChild(child)
		end
		if character:WaitForChild("Humanoid", 10) then
			apply(player)
		end
	end

	-- The Backpack is replaced on every spawn.
	player.ChildAdded:Connect(function(child)
		if child:IsA("Backpack") then
			onBackpack(child)
		end
	end)
	local backpack = player:FindFirstChildOfClass("Backpack")
	if backpack then
		onBackpack(backpack)
	end
	player.CharacterAdded:Connect(onCharacter)
	if player.Character then
		task.spawn(onCharacter, player.Character)
	end
end

function EquipService:Init()
	local folder = ServerStorage:FindFirstChild(Config.ToolsFolder)
	if not folder then
		folder = Instance.new("Folder")
		folder.Name = Config.ToolsFolder
		folder.Parent = ServerStorage
	end
	toolsFolder = folder

	for id, def in Items do
		if def.Tool then
			if toolToItem[def.Tool] then
				warnOnce(`items "{toolToItem[def.Tool]}" and "{id}" share Tool "{def.Tool}": loose Tools of that name become either`)
			end
			toolToItem[def.Tool] = id
		end
	end

	-- StarterPack hands out a fresh copy on every spawn, which would add the item again and
	-- again. Move its Tools to the templates folder and give them once instead.
	if Config.MigrateStarterPack then
		for _, child in StarterPack:GetChildren() do
			if not child:IsA("Tool") then
				continue
			end
			local id = itemIdOf(child)
			if id then
				InventoryService:AddStarterItem(id, 1)
				if toolsFolder:FindFirstChild(child.Name) then
					child:Destroy()
				else
					child.Parent = toolsFolder
				end
			else
				warnOnce(`StarterPack Tool "{child.Name}" matches no catalog item`)
			end
		end
	end
end

function EquipService:Start()
	InventoryService.EquippedChanged:Connect(function(player: Player)
		apply(player)
	end)

	Players.PlayerAdded:Connect(watch)
	for _, player in Players:GetPlayers() do
		task.spawn(watch, player)
	end
	Players.PlayerRemoving:Connect(function(player)
		held[player] = nil
	end)
end

-- The Tool currently in the player's hands, if the inventory put it there.
function EquipService:GetTool(player: Player): Tool?
	return held[player]
end

return EquipService
