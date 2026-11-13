--!strict
-- A "List" container: one row per stack, category tabs on top, carried weight underneath.
-- The open-world RPG view, and the plain "everything else" list of the Wheel style.
--
-- Rows are selected with a tap / click / gamepad A (double = use or equip). There is no
-- dragging out of a list, so scrolling by touch is never mistaken for a drag: items move
-- with the detail panel's Store / Take buttons. Dropping a dragged item ON a list works.

local InventoryUi = require(script.Parent.Parent.InventoryUi)

local New = InventoryUi.New

local ROW = 38
local TABS = 30
local FOOTER = 24

local ListView = {}
ListView.__index = ListView

function ListView.new(ctx: any, containerId: string, width: number, height: number)
	local theme = ctx.Theme
	local self = setmetatable({
		ContainerId = containerId,
		Ctx = ctx,
		Tab = "All",
		First = nil :: GuiObject?,
		Rows = {} :: { [string]: { Row: TextButton, Name: TextLabel } },
		Frame = New("Frame", { BackgroundTransparency = 1, Size = UDim2.fromOffset(width, height) }),
	}, ListView)

	self.Tabs = New("ScrollingFrame", {
		BackgroundTransparency = 1,
		BorderSizePixel = 0,
		AutomaticCanvasSize = Enum.AutomaticSize.X,
		CanvasSize = UDim2.new(),
		ScrollBarThickness = 0,
		ScrollingDirection = Enum.ScrollingDirection.X,
		Size = UDim2.new(1, 0, 0, TABS),
		Parent = self.Frame,
	}, {
		New("UIListLayout", {
			FillDirection = Enum.FillDirection.Horizontal,
			Padding = UDim.new(0, 4),
			SortOrder = Enum.SortOrder.LayoutOrder,
		}),
	})
	self.List = New("ScrollingFrame", {
		BackgroundColor3 = theme.Cell,
		BackgroundTransparency = 0.5,
		BorderSizePixel = 0,
		AutomaticCanvasSize = Enum.AutomaticSize.Y,
		CanvasSize = UDim2.new(),
		Position = UDim2.fromOffset(0, TABS + 4),
		ScrollBarImageColor3 = theme.Line,
		ScrollBarThickness = 4,
		ScrollingDirection = Enum.ScrollingDirection.Y,
		Size = UDim2.new(1, 0, 1, -(TABS + FOOTER + 8)),
		Parent = self.Frame,
	}, {
		New("UIListLayout", { Padding = UDim.new(0, 2), SortOrder = Enum.SortOrder.LayoutOrder }),
	})
	InventoryUi.Corner(self.List, theme.Radius)
	self.Outline = InventoryUi.Stroke(self.List, theme.Accent, 2, 1)
	self.Footer = InventoryUi.Label(theme, {
		AnchorPoint = Vector2.new(0, 1),
		Position = UDim2.fromScale(0, 1),
		Size = UDim2.new(1, 0, 0, FOOTER),
		TextColor3 = theme.Muted,
		TextXAlignment = Enum.TextXAlignment.Right,
	})
	self.Footer.Parent = self.Frame

	self.Unregister = ctx.Drag.Register(self)
	self:Render()
	return self
end

local function formatWeight(value: number): string
	return if value % 1 == 0 then tostring(value) else string.format("%.1f", value)
end

function ListView:Render()
	local ctx = self.Ctx
	local theme = ctx.Theme
	local container = ctx.State.Containers[self.ContainerId]
	if not container then
		return
	end
	local defs = ctx.Items

	-- Tabs: "All" plus every category present.
	local categories = {}
	local seen = {}
	for _, item in container.Items do
		local def = defs[item.Id]
		if def and not seen[def.Category] then
			seen[def.Category] = true
			table.insert(categories, def.Category)
		end
	end
	table.sort(categories)
	table.insert(categories, 1, "All")
	if not seen[self.Tab] then
		self.Tab = "All"
	end
	for _, child in self.Tabs:GetChildren() do
		if child:IsA("TextButton") then
			child:Destroy()
		end
	end
	for order, category in categories do
		local active = category == self.Tab
		local tab = InventoryUi.Button(theme, category, {
			AutomaticSize = Enum.AutomaticSize.X,
			BackgroundColor3 = if active then theme.CellHover else theme.Cell,
			LayoutOrder = order,
			Size = UDim2.fromOffset(0, TABS - 2),
			TextColor3 = if active then theme.Accent else theme.Muted,
			TextSize = 13,
		}, function()
			self.Tab = category
			self:Render()
		end)
		InventoryUi.Padding(tab, 8)
		tab.Parent = self.Tabs
	end

	-- Rows, by name.
	local rows = {}
	for _, item in container.Items do
		local def = defs[item.Id]
		if def and (self.Tab == "All" or def.Category == self.Tab) then
			table.insert(rows, item)
		end
	end
	table.sort(rows, function(a, b)
		local nameA, nameB = defs[a.Id].Name, defs[b.Id].Name
		if nameA ~= nameB then
			return nameA < nameB
		end
		return a.Uid < b.Uid
	end)

	for _, child in self.List:GetChildren() do
		if child:IsA("GuiObject") then
			child:Destroy()
		end
	end
	self.First = nil
	table.clear(self.Rows)
	local selected = ctx.Selected
	for order, item in rows do
		local def = defs[item.Id]
		local isSelected = selected ~= nil and selected.Uid == item.Uid
		local row = New("TextButton", {
			AutoButtonColor = true,
			BackgroundColor3 = if isSelected then theme.CellHover else theme.Cell,
			BorderSizePixel = 0,
			LayoutOrder = order,
			Size = UDim2.new(1, -6, 0, ROW),
			Text = "",
			Parent = self.List,
		})
		local tile = InventoryUi.Tile(theme, def, 1, ROW - 4, ROW - 4, {
			Equipped = ctx.State.Equipped == item.Uid,
		})
		tile.Parent = row
		local name = InventoryUi.Label(theme, {
			Position = UDim2.fromOffset(ROW + 6, 0),
			Size = UDim2.new(1, -(ROW + 110), 1, 0),
			Text = if item.Count > 1 then `{def.Name}  x{item.Count}` else def.Name,
			TextColor3 = if isSelected then theme.Accent else theme.Text,
		})
		name.Parent = row
		local weight = InventoryUi.Label(theme, {
			AnchorPoint = Vector2.new(1, 0),
			Position = UDim2.new(1, -8, 0, 0),
			Size = UDim2.new(0, 90, 1, 0),
			Text = if (def.Weight or 0) > 0 then formatWeight(def.Weight * item.Count) else "",
			TextColor3 = theme.Muted,
			TextSize = 13,
			TextXAlignment = Enum.TextXAlignment.Right,
		})
		weight.Parent = row

		row.Activated:Connect(function()
			ctx.Select(self.ContainerId, item, false)
		end)
		row.MouseButton2Click:Connect(function()
			ctx.Select(self.ContainerId, item, true)
			ctx.Activate(self.ContainerId, item)
		end)
		row.SelectionGained:Connect(function()
			ctx.Select(self.ContainerId, item, true)
		end)
		self.Rows[item.Uid] = { Row = row, Name = name }
		if not self.First then
			self.First = row
		end
	end
	if #rows == 0 then
		local empty = InventoryUi.Label(theme, {
			Size = UDim2.new(1, 0, 0, ROW),
			Text = "Nothing here",
			TextColor3 = theme.Muted,
			TextXAlignment = Enum.TextXAlignment.Center,
		})
		empty.Parent = self.List
	end

	local spec = container.Spec
	local total = ctx.Core.Weight(container, defs)
	if spec.MaxWeight then
		self.Footer.Text = `Weight  {formatWeight(total)} / {formatWeight(spec.MaxWeight)}`
		self.Footer.TextColor3 = if total > spec.MaxWeight then theme.Bad else theme.Muted
	elseif total > 0 then
		self.Footer.Text = `Weight  {formatWeight(total)}`
	else
		self.Footer.Text = `{#container.Items} items`
	end
end

-- Selection changed: recolour the rows without rebuilding them, so a gamepad keeps its focus.
function ListView:RenderSelection()
	local theme = self.Ctx.Theme
	local selected = self.Ctx.Selected
	for uid, entry in self.Rows do
		local isSelected = selected ~= nil and selected.Uid == uid
		entry.Row.BackgroundColor3 = if isSelected then theme.CellHover else theme.Cell
		entry.Name.TextColor3 = if isSelected then theme.Accent else theme.Text
	end
end

function ListView:HitTest(position: Vector2, held: any): any
	if held.ContainerId == self.ContainerId then
		return nil
	end
	local frame = self.Frame
	local rel = position - frame.AbsolutePosition
	if rel.X < 0 or rel.Y < 0 or rel.X >= frame.AbsoluteSize.X or rel.Y >= frame.AbsoluteSize.Y then
		return nil
	end
	return { Dest = {}, TargetUid = nil }
end

function ListView:Hover(position: Vector2?, held: any)
	local over = position ~= nil and held ~= nil and self:HitTest(position, held) ~= nil
	self.Outline.Transparency = if over then 0 else 1
end

function ListView:FirstSelectable(): GuiObject?
	return self.First
end

function ListView:Destroy()
	self.Unregister()
	self.Frame:Destroy()
end

return ListView
