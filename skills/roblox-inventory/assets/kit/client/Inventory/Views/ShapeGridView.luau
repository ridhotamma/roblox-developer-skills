--!strict
-- A "Grid" container: every item covers a rectangle of cells and can be turned a quarter
-- turn. The attache-case / extraction-backpack view.
--
-- Layers, bottom to top: one button per cell (takes all input), the item tiles (never
-- interactive, so presses fall through to the cell underneath), and the placement highlight
-- shown while something is held: green fits, red does not, accent = merge or combine.

local InventoryUi = require(script.Parent.Parent.InventoryUi)

local New = InventoryUi.New

local ShapeGridView = {}
ShapeGridView.__index = ShapeGridView

function ShapeGridView.new(ctx: any, containerId: string, cell: number)
	local spec = ctx.State.Containers[containerId].Spec
	local theme = ctx.Theme
	local width = math.max(1, spec.Width or 1)
	local height = math.max(1, spec.Height or 1)

	local self = setmetatable({
		ContainerId = containerId,
		Ctx = ctx,
		Cell = cell,
		Width = width,
		Height = height,
		First = nil :: TextButton?,
		Frame = New("Frame", { BackgroundTransparency = 1, Size = UDim2.fromOffset(width * cell, height * cell) }),
	}, ShapeGridView)

	for y = 1, height do
		for x = 1, width do
			local button = New("TextButton", {
				Name = `Cell{x}_{y}`,
				AutoButtonColor = false,
				BackgroundColor3 = theme.Cell,
				BorderSizePixel = 0,
				Position = UDim2.fromOffset((x - 1) * cell + 1, (y - 1) * cell + 1),
				Size = UDim2.fromOffset(cell - 2, cell - 2),
				Text = "",
				ZIndex = 1,
				Parent = self.Frame,
			})
			button.InputBegan:Connect(function(input: InputObject)
				self:_onInput(x, y, input)
			end)
			button.Activated:Connect(function(input: InputObject)
				if input and input.KeyCode == Enum.KeyCode.ButtonA then
					self:_onGamepad(x, y)
				end
			end)
			button.SelectionGained:Connect(function()
				if not ctx.Drag.Held then
					ctx.Select(containerId, self:_itemAt(x, y), true)
				end
			end)
			if not self.First then
				self.First = button
			end
		end
	end

	self.Layer = New("Frame", {
		Name = "Items",
		BackgroundTransparency = 1,
		Size = UDim2.fromScale(1, 1),
		ZIndex = 2,
		Parent = self.Frame,
	})
	self.Highlight = New("Frame", {
		Name = "Highlight",
		BackgroundColor3 = theme.Good,
		BackgroundTransparency = 0.65,
		BorderSizePixel = 0,
		Visible = false,
		ZIndex = 3,
		Parent = self.Frame,
	})

	self.Unregister = ctx.Drag.Register(self)
	self:Render()
	return self
end

function ShapeGridView:_itemAt(x: number, y: number): any
	local ctx = self.Ctx
	local container = ctx.State.Containers[self.ContainerId]
	return container and ctx.Core.ItemAtCell(container, ctx.Items, x, y)
end

function ShapeGridView:_held(item: any, carry: boolean): any
	return {
		ContainerId = self.ContainerId,
		Item = item,
		Def = self.Ctx.Items[item.Id],
		Rot = item.Rot == true,
		Count = nil,
		Carry = carry,
		Cell = self.Cell,
		Shaped = true,
	}
end

-- Where the held item would go if the pointer is over cell (px, py) and its top-left corner
-- is proposed at (left, top).
function ShapeGridView:_hit(held: any, px: number, py: number, left: number, top: number): any
	local target = self:_itemAt(px, py)
	if target and target.Uid ~= held.Item.Uid then
		-- Dropped on another item: aim at it, so stacks merge and recipes combine.
		return { Dest = { X = target.X, Y = target.Y, Rot = target.Rot == true }, TargetUid = target.Uid }
	end
	return { Dest = { X = left, Y = top, Rot = held.Rot }, TargetUid = nil }
end

function ShapeGridView:_onInput(x: number, y: number, input: InputObject)
	local ctx = self.Ctx
	local kind = input.UserInputType
	if kind == Enum.UserInputType.MouseButton1 or kind == Enum.UserInputType.Touch then
		if ctx.Drag.Held then
			ctx.Drag.Release(Vector2.new(input.Position.X, input.Position.Y))
			return
		end
		local item = self:_itemAt(x, y)
		ctx.Select(self.ContainerId, item, false)
		if item then
			ctx.Drag.Begin(self:_held(item, false), input)
		end
	elseif kind == Enum.UserInputType.MouseButton2 then
		local item = self:_itemAt(x, y)
		if item and not ctx.Drag.Held then
			ctx.Select(self.ContainerId, item, true)
			ctx.Activate(self.ContainerId, item)
		end
	end
end

function ShapeGridView:_onGamepad(x: number, y: number)
	local ctx = self.Ctx
	local held = ctx.Drag.Held
	if held then
		-- The selected cell becomes the item's top-left corner.
		ctx.Drag.PlaceAt(self, self:_hit(held, x, y, x, y))
		return
	end
	local item = self:_itemAt(x, y)
	if item then
		ctx.Select(self.ContainerId, item, true)
		ctx.Drag.Begin(self:_held(item, true), nil)
	end
end

function ShapeGridView:Render()
	local ctx = self.Ctx
	local container = ctx.State.Containers[self.ContainerId]
	if not container then
		return
	end
	self.Layer:ClearAllChildren()
	local selected = ctx.Selected
	local cell = self.Cell
	for _, item in container.Items do
		if item.X and item.Y then
			local def = ctx.Items[item.Id]
			local w, h = ctx.Core.Footprint(def, item.Rot)
			local tile = InventoryUi.Tile(ctx.Theme, def, item.Count, w * cell, h * cell, {
				Rot = item.Rot == true,
				Equipped = ctx.State.Equipped == item.Uid,
				Selected = selected ~= nil and selected.Uid == item.Uid,
			})
			tile.Position = UDim2.fromOffset((item.X - 1) * cell + 2, (item.Y - 1) * cell + 2)
			tile.Parent = self.Layer
		end
	end
end

function ShapeGridView:HitTest(position: Vector2, held: any): any
	local frame = self.Frame
	local rel = position - frame.AbsolutePosition
	if rel.X < 0 or rel.Y < 0 or rel.X >= frame.AbsoluteSize.X or rel.Y >= frame.AbsoluteSize.Y then
		return nil
	end
	local cell = self.Cell
	local w, h = self.Ctx.Core.Footprint(held.Def, held.Rot)
	-- The ghost is centred on the pointer: snap its top-left corner to the nearest cell and
	-- keep the whole footprint inside the grid.
	local left = math.clamp(math.floor(rel.X / cell - w / 2 + 0.5) + 1, 1, math.max(1, self.Width - w + 1))
	local top = math.clamp(math.floor(rel.Y / cell - h / 2 + 0.5) + 1, 1, math.max(1, self.Height - h + 1))
	local px = math.clamp(math.floor(rel.X / cell) + 1, 1, self.Width)
	local py = math.clamp(math.floor(rel.Y / cell) + 1, 1, self.Height)
	return self:_hit(held, px, py, left, top)
end

function ShapeGridView:Hover(position: Vector2?, held: any)
	local highlight = self.Highlight
	local hit = if position and held then self:HitTest(position, held) else nil
	if not hit then
		highlight.Visible = false
		return
	end
	local ctx = self.Ctx
	local theme = ctx.Theme
	local container = ctx.State.Containers[self.ContainerId]
	local cell = self.Cell
	local w, h = ctx.Core.Footprint(held.Def, hit.Dest.Rot)
	local color = theme.Bad
	if hit.TargetUid then
		local target = ctx.Core.Find(container, hit.TargetUid)
		if target then
			w, h = ctx.Core.Footprint(ctx.Items[target.Id], target.Rot)
			local sameKind = target.Id == held.Item.Id and (held.Def.MaxStack or 1) > 1
			if sameKind or ctx.Catalog.FindRecipe(held.Item.Id, target.Id) then
				color = theme.Accent
			end
		end
	else
		local moving = held.ContainerId == self.ContainerId and held.Count == nil
		local ignore = if moving then held.Item.Uid else nil
		if ctx.Core.Fits(container, ctx.Items, held.Def, hit.Dest.X, hit.Dest.Y, hit.Dest.Rot, ignore) then
			color = theme.Good
		end
	end
	highlight.BackgroundColor3 = color
	highlight.Position = UDim2.fromOffset((hit.Dest.X - 1) * cell, (hit.Dest.Y - 1) * cell)
	highlight.Size = UDim2.fromOffset(w * cell, h * cell)
	highlight.Visible = true
end

function ShapeGridView:FirstSelectable(): GuiObject?
	return self.First
end

function ShapeGridView:Destroy()
	self.Unregister()
	self.Frame:Destroy()
end

return ShapeGridView
