--!strict
-- The client side of the inventory. Replaces Roblox's built-in backpack:
--   * hides the Backpack CoreGui (hotbar, backpack window, number keys, backquote)
--   * keeps a copy of what the server says the player has (InventoryState)
--   * draws it in the configured style: window, quick bar, weapon wheel
--   * turns input into InventoryAction requests
--
-- The client never decides anything. Moves are applied to the local copy first so dragging
-- feels instant (the same InventoryCore the server runs), then the server's answer replaces
-- the local copy: if it disagreed, the item simply snaps back.
--
-- Other controllers: InventoryController.Changed, .IsOpen(), .Count(itemId), .GetEquipped().

local ContextActionService = game:GetService("ContextActionService")
local Lighting = game:GetService("Lighting")
local Players = game:GetService("Players")
local ReplicatedStorage = game:GetService("ReplicatedStorage")
local StarterGui = game:GetService("StarterGui")
local UserInputService = game:GetService("UserInputService")

local Catalog = require(ReplicatedStorage.Shared.Inventory.ItemCatalog)
local Config = require(ReplicatedStorage.Shared.Inventory.InventoryConfig)
local Core = require(ReplicatedStorage.Shared.Inventory.InventoryCore)
local InventoryDrag = require(script.Parent.Parent.Inventory.InventoryDrag)
local InventoryUi = require(script.Parent.Parent.Inventory.InventoryUi)
local InventoryWindow = require(script.Parent.Parent.Inventory.InventoryWindow)
local Net = require(ReplicatedStorage.Shared.Net)
local QuickBar = require(script.Parent.Parent.Inventory.Views.QuickBar)
local Signal = require(ReplicatedStorage.Packages.Signal)
local WheelView = require(script.Parent.Parent.Inventory.Views.WheelView)

local STASH = "Stash"
local DOUBLE_CLICK = 0.35

local player = Players.LocalPlayer
local style = (Config.Styles :: any)[Config.Style] :: Config.Style
assert(style, `InventoryConfig.Style "{Config.Style}" is not one of InventoryConfig.Styles`)
local Items = Catalog.Items :: { [string]: any }
local barCount = if style.Bar then style.BarSlots or 9 else style.Shortcuts or 0

local InventoryController = {
	Changed = Signal.new(), -- (key) a container id, "Equipped" or "Shortcuts" was updated
}

local state = {
	Containers = {} :: { [string]: any },
	Equipped = nil :: string?,
	Shortcuts = {} :: { [string]: string },
	Open = nil :: string?,
}

-- Everything the views need, in one table.
local ctx: any = {
	Config = Config,
	Style = style,
	Catalog = Catalog,
	Core = Core,
	Items = Items,
	Theme = InventoryUi.Themes[style.Theme] or InventoryUi.Themes.Slate,
	State = state,
	Drag = InventoryDrag,
	Selected = nil, -- { ContainerId, Uid }
	Cell = 48,
	HasGrid = false,
}

local actionEvent: RemoteEvent
local window: any
local bar: any
local wheel: any
local blur: BlurEffect
local blurReasons: { [string]: boolean } = {}
local toast: TextLabel
local toastToken = 0
local lastClickUid: string? = nil
local lastClickTime = 0
local predicted = 0

local REASONS: { [string]: string } = {
	Blocked = "Something is in the way",
	OutOfBounds = "It doesn't fit there",
	NotAccepted = "That doesn't go there",
	TooHeavy = "Too heavy",
	Full = "No room",
	StackLimit = "Too many to stack there",
	NoRotate = "It can't be turned here",
}

local function isOwn(containerId: string): boolean
	return (style.Containers :: any)[containerId] ~= nil or containerId == STASH
end

local function isCarried(containerId: string): boolean
	return table.find(style.Carry, containerId) ~= nil
end

local function carriedItems(): { { ContainerId: string, Item: any } }
	local found = {}
	for _, name in style.Carry do
		local container = state.Containers[name]
		if container then
			for _, item in container.Items do
				table.insert(found, { ContainerId = name, Item = item })
			end
		end
	end
	return found
end

local function countCarried(itemId: string): number
	local total = 0
	for _, name in style.Carry do
		local container = state.Containers[name]
		if container then
			total += Core.Count(container, itemId)
		end
	end
	return total
end

local function send(action: string, ...: any)
	actionEvent:FireServer(action, ...)
end

local function showToast(message: string)
	toastToken += 1
	local token = toastToken
	toast.Text = message
	toast.Visible = true
	task.delay(2, function()
		if toastToken == token then
			toast.Visible = false
		end
	end)
end

local function setBlur(reason: string, on: boolean)
	blurReasons[reason] = if on then true else nil
	blur.Enabled = Config.Blur and next(blurReasons) ~= nil
end

local function render()
	window:Render()
	bar:Render()
	wheel:Render()
end

-- Moves an item on the local copy, then asks the server for the same move.
local function move(fromId: string, uid: string, toId: string, dest: any, count: number?): boolean
	local from, to = state.Containers[fromId], state.Containers[toId]
	local item = from and Core.Find(from, uid)
	if not from or not to or not item then
		return false
	end
	local samePlace = fromId == toId
		and count == nil
		and item.Slot == dest.Slot
		and item.X == dest.X
		and item.Y == dest.Y
		and (item.Rot == true) == (dest.Rot == true)
	if samePlace then
		return false
	end
	local ok, reason = Core.Move(from, to, Items, uid, dest, count, function()
		predicted += 1
		return `~{predicted}` -- replaced by the server's uid when its answer arrives
	end)
	if not ok then
		showToast(REASONS[reason or ""] or "Can't do that")
		return false
	end
	send("Move", fromId, uid, toId, dest, count)
	render()
	return true
end

-- Where the detail panel's Store / Take / Move buttons can send an item.
local function transferTargets(containerId: string): { { Id: string, Label: string } }
	local targets = {}
	local function title(name: string): string
		local container = state.Containers[name]
		return (container and (container.Title or container.Spec.Title)) or name
	end
	if isCarried(containerId) then
		local open = state.Open
		if open and state.Containers[open] then
			table.insert(targets, { Id = open, Label = "Store" })
		end
		for _, name in style.Carry do
			if name ~= containerId and state.Containers[name] then
				table.insert(targets, { Id = name, Label = `Move to {title(name)}` })
			end
		end
	else
		for _, name in style.Carry do
			if state.Containers[name] then
				table.insert(targets, { Id = name, Label = if #style.Carry > 1 then `Take to {title(name)}` else "Take" })
			end
		end
	end
	return targets
end

-- Double-click, right-click, gamepad X: the obvious thing to do with an item.
local function activate(containerId: string, item: any)
	local def = Items[item.Id]
	if not def then
		return
	end
	if not isCarried(containerId) then
		local target = transferTargets(containerId)[1]
		if target then
			send("Transfer", containerId, item.Uid, target.Id) -- quick-loot
		end
	elseif def.Use then
		send("Use", item.Uid)
	elseif def.Tool then
		send("Equip", if state.Equipped == item.Uid then false else item.Uid)
	elseif state.Open and state.Containers[state.Open] then
		send("Transfer", containerId, item.Uid, state.Open) -- quick-store
	end
end

local function select(containerId: string, item: any, quiet: boolean?)
	local uid = if item then item.Uid else nil
	local previous = ctx.Selected
	local changed = (previous and previous.Uid) ~= uid
	ctx.Selected = if item then { ContainerId = containerId, Uid = uid } else nil
	if changed then
		window:RenderSelection()
	end
	if item and not quiet then
		local now = os.clock()
		if lastClickUid == uid and now - lastClickTime < DOUBLE_CLICK then
			lastClickUid = nil
			activate(containerId, item)
		else
			lastClickUid = uid
			lastClickTime = now
		end
	end
end

local function closeWindow()
	if not window:IsOpen() then
		return
	end
	window:Close()
	ctx.Selected = nil
	setBlur("Window", false)
	bar:SetVisible(true)
	if state.Open then
		send("Close")
	end
end

local function openWindow()
	wheel:Close(false)
	window:Open()
	setBlur("Window", true)
	bar:SetVisible(false)
end

local function toggleWindow()
	if window:IsOpen() then
		closeWindow()
	else
		openWindow()
	end
end

-- The item a quick slot stands for.
local function barItem(index: number): (any, any)
	if style.Bar then
		local container = state.Containers[style.Bar]
		local item = container and Core.ItemAtSlot(container, index)
		return item, if item then Items[item.Id] else nil
	end
	local id = state.Shortcuts[tostring(index)]
	local def = if id then Items[id] else nil
	if not def then
		return nil, nil
	end
	for _, entry in carriedItems() do
		if entry.Item.Id == id then
			return entry.Item, def
		end
	end
	return nil, def
end

local function barEntry(index: number): any
	local item, def = barItem(index)
	if not def then
		return nil
	end
	if style.Bar then
		return { Def = def, Count = item.Count, Equipped = state.Equipped == item.Uid, Missing = false }
	end
	-- A shortcut shows everything carried of that item, and stays (faded) at zero.
	local total = countCarried(item and item.Id or state.Shortcuts[tostring(index)])
	local equipped = false
	for _, entry in carriedItems() do
		if entry.Item.Uid == state.Equipped and Items[entry.Item.Id] == def then
			equipped = true
		end
	end
	return { Def = def, Count = total, Equipped = equipped, Missing = item == nil }
end

-- A number key or a tap on a quick slot. `toggle` = pressing the held item's slot puts it away.
local function selectBar(index: number, toggle: boolean)
	local item, def = barItem(index)
	if not item or not def then
		-- An empty hotbar slot means empty hands; an empty shortcut does nothing.
		if style.Bar and state.Equipped then
			send("Equip", false)
		end
		return
	end
	if def.Tool then
		if state.Equipped ~= item.Uid then
			send("Equip", item.Uid)
		elseif toggle then
			send("Equip", false)
		end
	elseif def.Use then
		send("Use", item.Uid)
	elseif style.Bar and state.Equipped then
		send("Equip", false)
	end
end

local function scrollBar(direction: number)
	local container = style.Bar and state.Containers[style.Bar]
	if not container then
		return
	end
	local current = 0
	local equipped = state.Equipped and Core.Find(container, state.Equipped)
	if equipped and equipped.Slot then
		current = equipped.Slot
	end
	selectBar((current - 1 + direction) % barCount + 1, false)
end

local function split(containerId: string, item: any)
	InventoryDrag.Begin({
		ContainerId = containerId,
		Item = item,
		Def = Items[item.Id],
		Rot = item.Rot == true,
		Count = math.floor(item.Count / 2),
		Carry = true,
		Cell = ctx.Cell,
		Shaped = ctx.HasGrid,
	}, nil)
	showToast("Pick where the other half goes")
end

local function rotateItem(containerId: string, item: any)
	if item.X and item.Y then
		move(containerId, item.Uid, containerId, { X = item.X, Y = item.Y, Rot = not item.Rot }, nil)
	end
end

-- A held item was released over a view.
local function place(held: InventoryDrag.Held, toId: string, hit: InventoryDrag.Hit)
	local uid = held.Item.Uid
	local to = state.Containers[toId]
	local target = if hit.TargetUid and to then Core.Find(to, hit.TargetUid) else nil
	if target and target.Uid ~= uid and target.Id ~= held.Item.Id then
		if Catalog.FindRecipe(held.Item.Id, target.Id) and isOwn(held.ContainerId) and isOwn(toId) then
			send("Combine", held.ContainerId, uid, toId, target.Uid)
			return
		end
	end
	move(held.ContainerId, uid, toId, hit.Dest, held.Count)
end

-- A dragged item was released outside every view: outside the window means "drop it".
local function releasedOutside(held: InventoryDrag.Held, position: Vector2)
	if held.Carry or not window:IsOpen() or window:Contains(position) then
		return
	end
	if not Config.AllowDrop or not isOwn(held.ContainerId) then
		return
	end
	if held.Def and held.Def.Droppable == false then
		showToast("You can't drop that")
		return
	end
	send("Drop", held.ContainerId, held.Item.Uid, held.Count)
end

local function onState(key: unknown, payload: any)
	if type(key) ~= "string" then
		return
	end
	if key == "Message" then
		showToast(tostring(payload))
		return
	elseif key == "Open" then
		local previous = state.Open
		state.Open = if type(payload) == "string" then payload else nil
		if previous and previous ~= state.Open and not isOwn(previous) then
			state.Containers[previous] = nil
		end
		if state.Open then
			openWindow()
		elseif window:IsOpen() then
			window:Open() -- rebuild without the outside panel
		end
		return
	elseif key == "Equipped" then
		state.Equipped = if type(payload) == "string" then payload else nil
	elseif key == "Shortcuts" then
		state.Shortcuts = if type(payload) == "table" then payload else {}
	elseif type(payload) == "table" and type(payload.Spec) == "table" then
		state.Containers[key] = {
			Spec = payload.Spec,
			Items = if type(payload.Items) == "table" then payload.Items else {},
			Title = payload.Title,
		}
	else
		return
	end
	render()
	InventoryController.Changed:Fire(key)
end

local function bindInput()
	ContextActionService:BindAction("InventoryToggle", function(_, inputState, input)
		-- While the window is open the D-pad moves the selection; B closes.
		if window:IsOpen() and input.UserInputType == Enum.UserInputType.Gamepad1 then
			return Enum.ContextActionResult.Pass
		end
		if inputState == Enum.UserInputState.Begin then
			toggleWindow()
		end
		return Enum.ContextActionResult.Sink
	end, false, table.unpack(Config.Keys.Toggle))

	if barCount > 0 then
		local keys = table.move(Config.Keys.Bar, 1, math.min(barCount, #Config.Keys.Bar), 1, {})
		ContextActionService:BindAction("InventoryBar", function(_, inputState, input)
			if inputState == Enum.UserInputState.Begin then
				local index = table.find(keys, input.KeyCode)
				if index then
					selectBar(index, true)
				end
			end
			return Enum.ContextActionResult.Sink
		end, false, table.unpack(keys))
	end

	if style.Wheel then
		ContextActionService:BindAction("InventoryWheel", function(_, inputState)
			if window:IsOpen() then
				return Enum.ContextActionResult.Pass
			end
			if inputState == Enum.UserInputState.Begin then
				wheel:Open(nil)
			else
				wheel:Close(inputState == Enum.UserInputState.End)
			end
			return Enum.ContextActionResult.Sink
		end, false, table.unpack(Config.Keys.Wheel))
	end

	UserInputService.InputBegan:Connect(function(input)
		if not window:IsOpen() or UserInputService:GetFocusedTextBox() then
			return
		end
		local selected = ctx.Selected
		local container = selected and state.Containers[selected.ContainerId]
		local item = container and Core.Find(container, selected.Uid)
		if table.find(Config.Keys.Rotate, input.KeyCode) then
			if InventoryDrag.Held then
				InventoryDrag.Rotate()
			elseif item then
				rotateItem(selected.ContainerId, item)
			end
		elseif input.KeyCode == Enum.KeyCode.ButtonB then
			if InventoryDrag.Held then
				InventoryDrag.Cancel()
			else
				closeWindow()
			end
		elseif input.KeyCode == Enum.KeyCode.ButtonX and item and not InventoryDrag.Held then
			activate(selected.ContainerId, item)
		end
	end)

	if Config.ScrollBar and style.Bar then
		UserInputService.InputChanged:Connect(function(input, processed)
			if input.UserInputType == Enum.UserInputType.MouseWheel and not processed then
				if not window:IsOpen() and not wheel:IsOpen() then
					scrollBar(if input.Position.Z > 0 then -1 else 1)
				end
			end
		end)
	end
end

function InventoryController:Init()
	-- The built-in backpack UI and its key bindings go away; Tools still work.
	task.spawn(function()
		for _ = 1, 10 do
			if pcall(StarterGui.SetCoreGuiEnabled, StarterGui, Enum.CoreGuiType.Backpack, false) then
				break
			end
			task.wait(0.5)
		end
	end)

	ctx.Send = send
	ctx.Select = select
	ctx.Activate = activate
	ctx.Close = closeWindow
	ctx.Toggle = toggleWindow
	ctx.SelectBar = function(index: number)
		selectBar(index, true)
	end
	ctx.BarEntry = barEntry
	ctx.CarriedItems = carriedItems
	ctx.CountCarried = countCarried
	ctx.IsOwn = isOwn
	ctx.IsCarried = isCarried
	ctx.TransferTargets = transferTargets
	ctx.Split = split
	ctx.RotateItem = rotateItem
	ctx.SetBlur = setBlur
	ctx.OpenWheel = function(touch: InputObject?)
		if not window:IsOpen() then
			wheel:Open(touch)
		end
	end
end

function InventoryController:Start()
	local playerGui = player:WaitForChild("PlayerGui")
	ctx.PlayerGui = playerGui
	actionEvent = Net.Event("InventoryAction")

	blur = Instance.new("BlurEffect")
	blur.Name = "InventoryBlur"
	blur.Size = 14
	blur.Enabled = false
	blur.Parent = Lighting

	-- Topmost layer: the drag ghost and short notices.
	local layer = InventoryUi.New("ScreenGui", {
		Name = "InventoryOverlay",
		DisplayOrder = 40,
		IgnoreGuiInset = true,
		ResetOnSpawn = false,
		ZIndexBehavior = Enum.ZIndexBehavior.Sibling,
		Parent = playerGui,
	})
	toast = InventoryUi.Label(ctx.Theme, {
		AnchorPoint = Vector2.new(0.5, 0),
		AutomaticSize = Enum.AutomaticSize.X,
		BackgroundColor3 = ctx.Theme.Panel,
		BackgroundTransparency = 0.15,
		Position = UDim2.new(0.5, 0, 0.14, 0),
		Size = UDim2.fromOffset(0, 34),
		TextSize = 15,
		TextTruncate = Enum.TextTruncate.None,
		TextXAlignment = Enum.TextXAlignment.Center,
		Visible = false,
	})
	InventoryUi.Corner(toast, ctx.Theme.Radius)
	InventoryUi.Padding(toast, 10)
	toast.Parent = layer

	InventoryDrag.Setup({
		Theme = ctx.Theme,
		Layer = layer,
		Place = place,
		Outside = releasedOutside,
	})

	window = InventoryWindow.new(ctx)
	bar = QuickBar.new(ctx)
	wheel = if style.Wheel
		then WheelView.new(ctx)
		else { Render = function() end, Close = function() end, Open = function() end, IsOpen = function()
			return false
		end }

	Net.Event("InventoryState").OnClientEvent:Connect(onState)
	bindInput()

	-- Dying closes everything.
	local function onCharacter(character: Model)
		local humanoid = character:WaitForChild("Humanoid", 10)
		if humanoid and humanoid:IsA("Humanoid") then
			humanoid.Died:Once(function()
				wheel:Close(false)
				closeWindow()
			end)
		end
	end
	player.CharacterAdded:Connect(onCharacter)
	if player.Character then
		task.spawn(onCharacter, player.Character)
	end
end

-- Public API ------------------------------------------------------------------------------------

function InventoryController.IsOpen(): boolean
	return window ~= nil and (window:IsOpen() or wheel:IsOpen())
end

function InventoryController.Open()
	if not window:IsOpen() then
		openWindow()
	end
end

function InventoryController.Close()
	wheel:Close(false)
	closeWindow()
end

-- How many of an item the player carries (the client's copy: for display only).
function InventoryController.Count(itemId: string): number
	return countCarried(itemId)
end

-- The equipped item and its catalog entry, or nil.
function InventoryController.GetEquipped(): (any, any)
	for _, entry in carriedItems() do
		if entry.Item.Uid == state.Equipped then
			return entry.Item, Items[entry.Item.Id]
		end
	end
	return nil, nil
end

return InventoryController
