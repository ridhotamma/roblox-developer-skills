--!strict
-- The weapon wheel: hold a key, point at a segment, let go.
--
-- Segments are the style's Wheel groups, clockwise from the top. An item joins a segment
-- through its WheelGroup field; a segment with several items remembers the last one chosen
-- and cycles with the mouse wheel or D-pad left / right. The "Unarmed" segment puts
-- everything away.
--
-- Pointing works with whatever the player is using: mouse position from the centre (the
-- wheel frees a locked mouse while it is open), the right thumbstick, or a finger dragged
-- from the wheel button.

local ContextActionService = game:GetService("ContextActionService")
local UserInputService = game:GetService("UserInputService")

local InventoryUi = require(script.Parent.Parent.InventoryUi)

local New = InventoryUi.New

local SINK_ACTION = "InventoryWheelStick"
local TAU = math.pi * 2

local WheelView = {}
WheelView.__index = WheelView

function WheelView.new(ctx: any)
	return setmetatable({
		Ctx = ctx,
		Groups = ctx.Style.Wheel :: { string },
		Chosen = {} :: { [string]: string }, -- group -> uid last picked there
		Index = nil :: number?,
		Gui = nil :: ScreenGui?,
		Segments = {} :: { Frame },
		SegmentSize = 96,
		Connections = {} :: { RBXScriptConnection },
	}, WheelView)
end

function WheelView:IsOpen(): boolean
	return self.Gui ~= nil
end

-- Carried items that belong in a segment, in a stable order.
function WheelView:_itemsIn(group: string): { any }
	local ctx = self.Ctx
	local found = {}
	for _, entry in ctx.CarriedItems() do
		local def = ctx.Items[entry.Item.Id]
		if def and def.Tool and def.WheelGroup == group then
			table.insert(found, entry.Item)
		end
	end
	table.sort(found, function(a, b)
		if a.Id ~= b.Id then
			return a.Id < b.Id
		end
		return a.Uid < b.Uid
	end)
	return found
end

-- The item a segment would equip: the equipped one, else the last chosen, else the first.
function WheelView:_current(group: string): (any, number, number)
	local items = self:_itemsIn(group)
	local equipped = self.Ctx.State.Equipped
	local pick = 0
	for index, item in items do
		if item.Uid == self.Chosen[group] then
			pick = index
		end
	end
	if pick == 0 then
		for index, item in items do
			if item.Uid == equipped then
				pick = index
			end
		end
	end
	if pick == 0 and #items > 0 then
		pick = 1
	end
	return items[pick], pick, #items
end

function WheelView:Render()
	local gui = self.Gui
	if not gui then
		return
	end
	local ctx = self.Ctx
	local theme = ctx.Theme
	for index, segment in self.Segments do
		local group = self.Groups[index]
		local item, pick, total = self:_current(group)
		local active = index == self.Index
		segment:ClearAllChildren()
		InventoryUi.Corner(segment, theme.Radius + 4)
		InventoryUi.Stroke(segment, if active then theme.Accent else theme.Line, if active then 3 else 1, if active then 0 else 0.4)
		segment.BackgroundColor3 = if active then theme.CellHover else theme.Cell
		local size = self.SegmentSize
		if item then
			local tile = InventoryUi.Tile(theme, ctx.Items[item.Id], item.Count, size - 12, size - 30, {
				Equipped = ctx.State.Equipped == item.Uid,
			})
			tile.Position = UDim2.fromOffset(6, 6)
			tile.Parent = segment
		end
		local caption = InventoryUi.Label(theme, {
			AnchorPoint = Vector2.new(0, 1),
			Position = UDim2.fromScale(0, 1),
			Size = UDim2.new(1, 0, 0, 22),
			Text = if total > 1 then `{group}  {pick}/{total}` else group,
			TextColor3 = if item or group == "Unarmed" then theme.Text else theme.Muted,
			TextSize = 12,
			TextXAlignment = Enum.TextXAlignment.Center,
		})
		caption.Parent = segment
	end

	-- Centre: what letting go right now would do.
	local title, detail = "", ""
	if self.Index then
		local group = self.Groups[self.Index]
		local item = self:_current(group)
		if group == "Unarmed" then
			title = "Unarmed"
		elseif item then
			local def = ctx.Items[item.Id]
			title = def.Name
			if def.Ammo and ctx.Items[def.Ammo] then
				detail = `{ctx.Items[def.Ammo].Name}  {ctx.CountCarried(def.Ammo)}`
			end
		else
			title = group
			detail = "Empty"
		end
	end
	self.Title.Text = title
	self.Detail.Text = detail
end

-- Points the wheel along a direction (screen space: +X right, +Y down).
function WheelView:_point(direction: Vector2, deadzone: number)
	if direction.Magnitude < deadzone then
		return
	end
	local count = #self.Groups
	local step = TAU / count
	local angle = (math.atan2(direction.Y, direction.X) + math.pi / 2) % TAU -- 0 = up, clockwise
	local index = math.floor((angle + step / 2) / step) % count + 1
	if index ~= self.Index then
		self.Index = index
		self:Render()
	end
end

-- Steps through the items of the highlighted segment.
function WheelView:Cycle(direction: number)
	if not self.Gui or not self.Index then
		return
	end
	local group = self.Groups[self.Index]
	local items = self:_itemsIn(group)
	if #items < 2 then
		return
	end
	local _, pick = self:_current(group)
	local nextIndex = (pick - 1 + direction) % #items + 1
	self.Chosen[group] = items[nextIndex].Uid
	self:Render()
end

-- `touch` is the finger holding the on-screen wheel button, when there is one.
function WheelView:Open(touch: InputObject?)
	if self.Gui then
		return
	end
	local ctx = self.Ctx
	local theme = ctx.Theme
	local viewport = (workspace.CurrentCamera :: Camera).ViewportSize
	local radius = math.floor(math.min(viewport.X, viewport.Y) * 0.3)
	local count = #self.Groups
	local size = math.clamp(math.floor(radius * TAU / count * 0.8), 56, 150)

	local gui = New("ScreenGui", {
		Name = "InventoryWheel",
		DisplayOrder = 30,
		IgnoreGuiInset = true,
		ResetOnSpawn = false,
		ZIndexBehavior = Enum.ZIndexBehavior.Sibling,
	})
	-- A visible Modal button releases a locked mouse (first person, shift lock).
	local root = New("TextButton", {
		Name = "Root",
		AutoButtonColor = false,
		BackgroundColor3 = theme.Dim,
		BackgroundTransparency = math.max(theme.DimTransparency, 0.5),
		BorderSizePixel = 0,
		Modal = true,
		Size = UDim2.fromScale(1, 1),
		Text = "",
		Parent = gui,
	})
	self.Segments = {}
	self.SegmentSize = size
	for index = 1, count do
		local angle = (index - 1) / count * TAU - math.pi / 2
		local segment = New("Frame", {
			AnchorPoint = Vector2.new(0.5, 0.5),
			BackgroundColor3 = theme.Cell,
			BackgroundTransparency = 0.1,
			BorderSizePixel = 0,
			Position = UDim2.new(0.5, math.floor(math.cos(angle) * radius), 0.5, math.floor(math.sin(angle) * radius)),
			Size = UDim2.fromOffset(size, size),
			Parent = root,
		})
		self.Segments[index] = segment
	end
	self.Title = InventoryUi.Label(theme, {
		AnchorPoint = Vector2.new(0.5, 1),
		FontFace = theme.Heading,
		Position = UDim2.fromScale(0.5, 0.5),
		Size = UDim2.fromOffset(radius * 1.2, 26),
		TextSize = 20,
		TextXAlignment = Enum.TextXAlignment.Center,
	})
	self.Title.Parent = root
	self.Detail = InventoryUi.Label(theme, {
		AnchorPoint = Vector2.new(0.5, 0),
		Position = UDim2.new(0.5, 0, 0.5, 4),
		Size = UDim2.fromOffset(radius * 1.2, 20),
		TextColor3 = theme.Muted,
		TextXAlignment = Enum.TextXAlignment.Center,
	})
	self.Detail.Parent = root

	-- Start on the segment holding what is equipped.
	self.Index = nil
	local equipped = ctx.State.Equipped
	for index, group in self.Groups do
		for _, item in self:_itemsIn(group) do
			if item.Uid == equipped then
				self.Index = index
				self.Chosen[group] = item.Uid
			end
		end
	end

	gui.Parent = ctx.PlayerGui
	self.Gui = gui
	ctx.SetBlur("Wheel", true)

	local function centre(): Vector2
		return root.AbsolutePosition + root.AbsoluteSize / 2
	end
	table.insert(
		self.Connections,
		UserInputService.InputChanged:Connect(function(input)
			local kind = input.UserInputType
			if kind == Enum.UserInputType.MouseMovement or (kind == Enum.UserInputType.Touch and input == touch) then
				self:_point(Vector2.new(input.Position.X, input.Position.Y) - centre(), radius * 0.35)
			elseif input.KeyCode == Enum.KeyCode.Thumbstick2 then
				self:_point(Vector2.new(input.Position.X, -input.Position.Y), 0.4)
			elseif kind == Enum.UserInputType.MouseWheel then
				self:Cycle(if input.Position.Z > 0 then -1 else 1)
			end
		end)
	)
	table.insert(
		self.Connections,
		UserInputService.InputBegan:Connect(function(input)
			if input.KeyCode == Enum.KeyCode.DPadLeft then
				self:Cycle(-1)
			elseif input.KeyCode == Enum.KeyCode.DPadRight then
				self:Cycle(1)
			end
		end)
	)
	if touch then
		table.insert(
			self.Connections,
			UserInputService.InputEnded:Connect(function(input)
				if input == touch then
					self:Close(true)
				end
			end)
		)
	end
	-- Keep the right stick from turning the camera while it is choosing.
	ContextActionService:BindActionAtPriority(SINK_ACTION, function()
		return Enum.ContextActionResult.Sink
	end, false, 3000, Enum.KeyCode.Thumbstick2)

	self:Render()
end

-- commit = equip what is highlighted. False just closes (the player died, a menu opened).
function WheelView:Close(commit: boolean)
	local gui = self.Gui
	if not gui then
		return
	end
	local ctx = self.Ctx
	self.Gui = nil
	for _, connection in self.Connections do
		connection:Disconnect()
	end
	table.clear(self.Connections)
	ContextActionService:UnbindAction(SINK_ACTION)
	gui:Destroy()
	ctx.SetBlur("Wheel", false)

	if not commit or not self.Index then
		return
	end
	local group = self.Groups[self.Index]
	if group == "Unarmed" then
		if ctx.State.Equipped then
			ctx.Send("Equip", false)
		end
		return
	end
	local item = self:_current(group)
	if item then
		self.Chosen[group] = item.Uid
		if item.Uid ~= ctx.State.Equipped then
			ctx.Send("Equip", item.Uid)
		end
	end
end

return WheelView
