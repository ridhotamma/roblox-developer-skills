--!strict
-- A "Slots" container drawn as a grid of equal cells, one stack per cell. Used for hotbars,
-- backpacks, equipment rows, item boxes and chests.
--
-- Views never change data. A press starts a drag (InventoryDrag), the release is turned into
-- a request by the controller, and Render() redraws from ctx.State when the answer arrives.

local InventoryUi = require(script.Parent.Parent.InventoryUi)

local New = InventoryUi.New

local SlotGridView = {}
SlotGridView.__index = SlotGridView

function SlotGridView.new(ctx: any, containerId: string, cell: number)
	local spec = ctx.State.Containers[containerId].Spec
	local theme = ctx.Theme
	local size = math.floor(cell * (spec.CellScale or 1))
	local slots = math.max(1, spec.Slots or 1)
	local columns = math.clamp(spec.Columns or 9, 1, slots)
	local rows = math.ceil(slots / columns)

	local self = setmetatable({
		ContainerId = containerId,
		Ctx = ctx,
		Cell = size,
		Columns = columns,
		Slots = slots,
		Buttons = {} :: { TextButton },
		Hovered = nil :: TextButton?,
		Frame = New("Frame", { BackgroundTransparency = 1, Size = UDim2.fromOffset(columns * size, rows * size) }),
	}, SlotGridView)

	for slot = 1, slots do
		local column = (slot - 1) % columns
		local row = math.floor((slot - 1) / columns)
		local button = New("TextButton", {
			Name = `Slot{slot}`,
			AutoButtonColor = false,
			BackgroundColor3 = theme.Cell,
			BorderSizePixel = 0,
			Position = UDim2.fromOffset(column * size + 1, row * size + 1),
			Size = UDim2.fromOffset(size - 2, size - 2),
			Text = "",
			Parent = self.Frame,
		})
		InventoryUi.Corner(button, theme.Radius)
		InventoryUi.Stroke(button, theme.Line, 1, 0.5)
		local slotName = spec.SlotNames and spec.SlotNames[slot]
		if slotName then
			local label = InventoryUi.Label(theme, {
				Name = "SlotName",
				Size = UDim2.fromScale(1, 1),
				Text = slotName,
				TextColor3 = theme.Muted,
				TextSize = 11,
				TextXAlignment = Enum.TextXAlignment.Center,
			})
			label.Parent = button
		end

		button.InputBegan:Connect(function(input: InputObject)
			self:_onInput(slot, input)
		end)
		button.Activated:Connect(function(input: InputObject)
			if input and input.KeyCode == Enum.KeyCode.ButtonA then
				self:_onGamepad(slot)
			end
		end)
		button.SelectionGained:Connect(function()
			if not ctx.Drag.Held then
				ctx.Select(containerId, self:_itemAt(slot), true)
			end
		end)
		self.Buttons[slot] = button
	end

	self.Unregister = ctx.Drag.Register(self)
	self:Render()
	return self
end

function SlotGridView:_itemAt(slot: number): any
	local container = self.Ctx.State.Containers[self.ContainerId]
	return container and self.Ctx.Core.ItemAtSlot(container, slot)
end

function SlotGridView:_held(item: any, carry: boolean): any
	return {
		ContainerId = self.ContainerId,
		Item = item,
		Def = self.Ctx.Items[item.Id],
		Rot = false,
		Count = nil,
		Carry = carry,
		Cell = self.Ctx.Cell,
		Shaped = self.Ctx.HasGrid,
	}
end

function SlotGridView:_onInput(slot: number, input: InputObject)
	local ctx = self.Ctx
	local kind = input.UserInputType
	if kind == Enum.UserInputType.MouseButton1 or kind == Enum.UserInputType.Touch then
		if ctx.Drag.Held then
			-- Already carrying something (a split stack): this press places it.
			ctx.Drag.Release(Vector2.new(input.Position.X, input.Position.Y))
			return
		end
		local item = self:_itemAt(slot)
		ctx.Select(self.ContainerId, item, false)
		if item then
			ctx.Drag.Begin(self:_held(item, false), input)
		end
	elseif kind == Enum.UserInputType.MouseButton2 then
		local item = self:_itemAt(slot)
		if item and not ctx.Drag.Held then
			ctx.Select(self.ContainerId, item, true)
			ctx.Activate(self.ContainerId, item)
		end
	end
end

function SlotGridView:_onGamepad(slot: number)
	local ctx = self.Ctx
	local item = self:_itemAt(slot)
	if ctx.Drag.Held then
		ctx.Drag.PlaceAt(self, { Dest = { Slot = slot }, TargetUid = if item then item.Uid else nil })
	elseif item then
		ctx.Select(self.ContainerId, item, true)
		ctx.Drag.Begin(self:_held(item, true), nil)
	end
end

function SlotGridView:Render()
	local ctx = self.Ctx
	local container = ctx.State.Containers[self.ContainerId]
	if not container then
		return
	end
	local bySlot = {}
	for _, item in container.Items do
		if item.Slot then
			bySlot[item.Slot] = item
		end
	end
	local selected = ctx.Selected
	for slot, button in self.Buttons do
		local old = button:FindFirstChild("Tile")
		if old then
			old:Destroy()
		end
		local item = bySlot[slot]
		local slotName = button:FindFirstChild("SlotName")
		if slotName and slotName:IsA("TextLabel") then
			slotName.Visible = item == nil
		end
		if item then
			local tile = InventoryUi.Tile(ctx.Theme, ctx.Items[item.Id], item.Count, self.Cell - 2, self.Cell - 2, {
				Equipped = ctx.State.Equipped == item.Uid,
				Selected = selected ~= nil and selected.Uid == item.Uid,
			})
			tile.Parent = button
		end
	end
end

function SlotGridView:HitTest(position: Vector2, _held: any): any
	local frame = self.Frame
	local rel = position - frame.AbsolutePosition
	if rel.X < 0 or rel.Y < 0 or rel.X >= frame.AbsoluteSize.X or rel.Y >= frame.AbsoluteSize.Y then
		return nil
	end
	local slot = math.floor(rel.Y / self.Cell) * self.Columns + math.floor(rel.X / self.Cell) + 1
	if slot < 1 or slot > self.Slots then
		return nil
	end
	local item = self:_itemAt(slot)
	return { Dest = { Slot = slot }, TargetUid = if item then item.Uid else nil }
end

function SlotGridView:Hover(position: Vector2?, held: any)
	local theme = self.Ctx.Theme
	if self.Hovered then
		self.Hovered.BackgroundColor3 = theme.Cell
		self.Hovered = nil
	end
	local hit = if position and held then self:HitTest(position, held) else nil
	if hit then
		local button = self.Buttons[hit.Dest.Slot]
		button.BackgroundColor3 = theme.CellHover
		self.Hovered = button
	end
end

function SlotGridView:FirstSelectable(): GuiObject?
	return self.Buttons[1]
end

function SlotGridView:Destroy()
	self.Unregister()
	self.Frame:Destroy()
end

return SlotGridView
