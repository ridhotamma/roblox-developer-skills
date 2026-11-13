--!strict
-- The inventory screen: one panel per container (the style's Window list, plus the stash or
-- chest that is open), and a detail panel with the selected item's actions.
--
-- The window is built when it opens and destroyed when it closes, sized for the screen it
-- opens on: the cell size is whatever lets every panel fit, panels sit side by side on wide
-- screens and stack on narrow ones. Each container's layout picks its view:
--   Slots -> SlotGridView    Grid -> ShapeGridView    List -> ListView
--
-- Every action is also a button in the detail panel, so nothing depends on right-click,
-- hover or a keyboard: the same screen works with touch and a gamepad.

local GuiService = game:GetService("GuiService")
local UserInputService = game:GetService("UserInputService")

local InventoryUi = require(script.Parent.InventoryUi)
local ListView = require(script.Parent.Views.ListView)
local ShapeGridView = require(script.Parent.Views.ShapeGridView)
local SlotGridView = require(script.Parent.Views.SlotGridView)

local New = InventoryUi.New

local DETAIL_WIDTH = 236
local NARROW = 760

local InventoryWindow = {}
InventoryWindow.__index = InventoryWindow

function InventoryWindow.new(ctx: any)
	return setmetatable({
		Ctx = ctx,
		Gui = nil :: ScreenGui?,
		Content = nil :: Frame?,
		Detail = nil :: Frame?,
		Views = {} :: { any },
	}, InventoryWindow)
end

function InventoryWindow:IsOpen(): boolean
	return self.Gui ~= nil
end

-- Columns and rows a container needs, in cells. Lists return nil (they are sized in pixels).
local function gridSize(spec: any): (number?, number?)
	if spec.Layout == "Grid" then
		return spec.Width or 1, spec.Height or 1
	elseif spec.Layout == "Slots" then
		local slots = math.max(1, spec.Slots or 1)
		local columns = math.clamp(spec.Columns or 9, 1, slots)
		local scale = spec.CellScale or 1
		return columns * scale, math.ceil(slots / columns) * scale
	end
	return nil, nil
end

function InventoryWindow:_panel(containerId: string, cell: number, listWidth: number, listHeight: number): Frame?
	local ctx = self.Ctx
	local theme = ctx.Theme
	local container = ctx.State.Containers[containerId]
	if not container then
		return nil
	end
	local spec = container.Spec
	local view
	if spec.Layout == "Grid" then
		view = ShapeGridView.new(ctx, containerId, cell)
	elseif spec.Layout == "Slots" then
		view = SlotGridView.new(ctx, containerId, cell)
	else
		view = ListView.new(ctx, containerId, listWidth, listHeight)
	end
	table.insert(self.Views, view)

	local panel = New("Frame", {
		Name = containerId,
		AutomaticSize = Enum.AutomaticSize.XY,
		BackgroundColor3 = theme.Panel,
		BackgroundTransparency = theme.PanelTransparency,
		BorderSizePixel = 0,
	}, {
		New("UIListLayout", { Padding = UDim.new(0, 6), SortOrder = Enum.SortOrder.LayoutOrder }),
	})
	InventoryUi.Corner(panel, theme.Radius + 2)
	InventoryUi.Stroke(panel, theme.Line, 1, 0.3)
	InventoryUi.Padding(panel, 10)

	local header = New("Frame", {
		BackgroundTransparency = 1,
		LayoutOrder = 1,
		Size = UDim2.fromOffset(view.Frame.Size.X.Offset, 24),
		Parent = panel,
	})
	local title = InventoryUi.Label(theme, {
		FontFace = theme.Heading,
		Size = UDim2.new(1, -70, 1, 0),
		Text = string.upper(container.Title or spec.Title or containerId),
		TextColor3 = theme.Accent,
		TextSize = 15,
	})
	title.Parent = header
	if not spec.SlotAccept and spec.Layout ~= "List" then
		local sort = InventoryUi.Button(theme, "Sort", {
			AnchorPoint = Vector2.new(1, 0),
			Position = UDim2.fromScale(1, 0),
			Size = UDim2.fromOffset(60, 24),
			TextSize = 12,
		}, function()
			ctx.Send("Sort", containerId)
		end)
		sort.Parent = header
	end
	view.Frame.LayoutOrder = 2
	view.Frame.Parent = panel
	return panel
end

function InventoryWindow:Open()
	if self.Gui then
		self:Close()
	end
	local ctx = self.Ctx
	local theme = ctx.Theme
	local state = ctx.State
	local viewport = (workspace.CurrentCamera :: Camera).ViewportSize
	local narrow = viewport.X < NARROW
	local outside: string? = if state.Open and state.Containers[state.Open] then state.Open else nil

	-- Cell size: the largest that lets every panel fit.
	local ownColumns, ownRows, panels = 0, 0, 0
	local hasGrid = false
	local function measure(containerId: string): (number, number)
		local container = state.Containers[containerId]
		if not container then
			return 0, 0
		end
		hasGrid = hasGrid or container.Spec.Layout == "Grid"
		local columns, rows = gridSize(container.Spec)
		return columns or 0, rows or 0
	end
	for _, containerId in ctx.Style.Window do
		local columns, rows = measure(containerId)
		ownColumns = math.max(ownColumns, columns)
		ownRows += rows
		panels += 1
	end
	local outColumns, outRows = 0, 0
	if outside then
		outColumns, outRows = measure(outside)
	end
	local needColumns = if narrow then math.max(ownColumns, outColumns) else ownColumns + outColumns
	local needRows = if narrow then ownRows + outRows else math.max(ownRows, outRows)
	local acrossPanels = if narrow or not outside then 1 else 2
	local downPanels = if narrow and outside then panels + 1 else panels
	local availableX = viewport.X - 32 - acrossPanels * 32 - (if narrow then 0 else DETAIL_WIDTH + 12)
	local availableY = viewport.Y - 48 - downPanels * 64 - (if narrow then 150 else 0)
	local cell = math.clamp(math.floor(math.min(availableX / math.max(needColumns, 1), availableY / math.max(needRows, 1))), 20, 58)
	local listWidth = math.clamp(availableX / acrossPanels, 220, 380)
	local listHeight = math.clamp(availableY / (if narrow and outside then 2 else 1), 160, 420)
	ctx.Cell = cell
	ctx.HasGrid = hasGrid

	local gui = New("ScreenGui", {
		Name = "Inventory",
		DisplayOrder = 20,
		IgnoreGuiInset = true,
		ResetOnSpawn = false,
		ZIndexBehavior = Enum.ZIndexBehavior.Sibling,
	})
	-- Modal: frees the mouse in first person and shift lock while the window is up.
	local backdrop = New("TextButton", {
		Name = "Backdrop",
		AutoButtonColor = false,
		BackgroundColor3 = theme.Dim,
		BackgroundTransparency = theme.DimTransparency,
		BorderSizePixel = 0,
		Modal = true,
		Selectable = false,
		Size = UDim2.fromScale(1, 1),
		Text = "",
		Parent = gui,
	})
	backdrop.InputBegan:Connect(function(input: InputObject)
		local kind = input.UserInputType
		if (kind == Enum.UserInputType.MouseButton1 or kind == Enum.UserInputType.Touch) and ctx.Drag.Held then
			ctx.Drag.Cancel() -- clicked empty space while carrying a split stack
		end
	end)
	local close = InventoryUi.Button(theme, "X", {
		AnchorPoint = Vector2.new(1, 0),
		Position = UDim2.new(1, -16, 0, 16 + GuiService:GetGuiInset().Y),
		Size = UDim2.fromOffset(40, 40),
		TextSize = 16,
	}, function()
		ctx.Close()
	end)
	close.Parent = backdrop

	local content = New("Frame", {
		Name = "Content",
		AnchorPoint = Vector2.new(0.5, 0.5),
		AutomaticSize = Enum.AutomaticSize.XY,
		BackgroundTransparency = 1,
		Position = UDim2.fromScale(0.5, 0.5),
		Parent = backdrop,
	}, {
		New("UIListLayout", {
			FillDirection = if narrow then Enum.FillDirection.Vertical else Enum.FillDirection.Horizontal,
			HorizontalAlignment = Enum.HorizontalAlignment.Center,
			Padding = UDim.new(0, 12),
			SortOrder = Enum.SortOrder.LayoutOrder,
			VerticalAlignment = Enum.VerticalAlignment.Center,
		}),
	})

	self.Views = {}
	if outside then
		local panel = self:_panel(outside, cell, listWidth, listHeight)
		if panel then
			panel.LayoutOrder = 1
			panel.Parent = content
		end
	end
	local own = New("Frame", {
		Name = "Own",
		AutomaticSize = Enum.AutomaticSize.XY,
		BackgroundTransparency = 1,
		LayoutOrder = 2,
		Parent = content,
	}, {
		New("UIListLayout", {
			HorizontalAlignment = Enum.HorizontalAlignment.Center,
			Padding = UDim.new(0, 12),
			SortOrder = Enum.SortOrder.LayoutOrder,
		}),
	})
	for order, containerId in ctx.Style.Window do
		local panel = self:_panel(containerId, cell, listWidth, listHeight)
		if panel then
			panel.LayoutOrder = order
			panel.Parent = own
		end
	end

	local detail = New("Frame", {
		Name = "Detail",
		AutomaticSize = Enum.AutomaticSize.Y,
		BackgroundColor3 = theme.Panel,
		BackgroundTransparency = theme.PanelTransparency,
		BorderSizePixel = 0,
		LayoutOrder = 3,
		Size = UDim2.fromOffset(if narrow then math.min(viewport.X - 32, 420) else DETAIL_WIDTH, 0),
		Parent = content,
	})
	InventoryUi.Corner(detail, theme.Radius + 2)
	InventoryUi.Stroke(detail, theme.Line, 1, 0.3)

	gui.Parent = ctx.PlayerGui
	self.Gui = gui
	self.Content = content
	self.Detail = detail
	self:_renderDetail()

	if UserInputService:GetLastInputType() == Enum.UserInputType.Gamepad1 then
		self:_focus()
	end
end

function InventoryWindow:_focus()
	for _, view in self.Views do
		local first = view:FirstSelectable()
		if first then
			GuiService.SelectedObject = first
			return
		end
	end
end

function InventoryWindow:Close()
	local gui = self.Gui
	if not gui then
		return
	end
	self.Ctx.Drag.Cancel()
	for _, view in self.Views do
		view:Destroy()
	end
	self.Views = {}
	self.Gui = nil
	self.Content = nil
	self.Detail = nil
	if GuiService.SelectedObject and GuiService.SelectedObject:IsDescendantOf(gui) then
		GuiService.SelectedObject = nil
	end
	gui:Destroy()
end

-- True when a screen position is over the panels (not the dimmed surroundings).
function InventoryWindow:Contains(position: Vector2): boolean
	local content = self.Content
	if not content then
		return false
	end
	local rel = position - content.AbsolutePosition
	return rel.X >= 0 and rel.Y >= 0 and rel.X <= content.AbsoluteSize.X and rel.Y <= content.AbsoluteSize.Y
end

-- Container contents changed.
function InventoryWindow:Render()
	if not self.Gui then
		return
	end
	local detail = self.Detail
	local focus = GuiService.SelectedObject
	local focusInDetail = focus ~= nil and detail ~= nil and focus:IsDescendantOf(detail)
	for _, view in self.Views do
		view:Render()
	end
	self:_renderDetail()
	if focusInDetail then
		self:_focus() -- the button that was focused has been rebuilt
	end
end

-- Only the selection changed.
function InventoryWindow:RenderSelection()
	if not self.Gui then
		return
	end
	for _, view in self.Views do
		if view.RenderSelection then
			view:RenderSelection()
		else
			view:Render()
		end
	end
	self:_renderDetail()
end

function InventoryWindow:_renderDetail()
	local detail = self.Detail
	if not detail then
		return
	end
	local ctx = self.Ctx
	local theme = ctx.Theme
	local state = ctx.State
	detail:ClearAllChildren()
	InventoryUi.Corner(detail, theme.Radius + 2)
	InventoryUi.Stroke(detail, theme.Line, 1, 0.3)
	InventoryUi.Padding(detail, 12)
	New("UIListLayout", { Padding = UDim.new(0, 6), SortOrder = Enum.SortOrder.LayoutOrder, Parent = detail })

	local order = 0
	local function add(instance: GuiObject)
		order += 1
		instance.LayoutOrder = order
		instance.Parent = detail
	end
	local function text(value: string, color: Color3, size: number, heading: boolean?)
		add(InventoryUi.Label(theme, {
			AutomaticSize = Enum.AutomaticSize.Y,
			FontFace = if heading then theme.Heading else theme.Font,
			Size = UDim2.new(1, 0, 0, 0),
			Text = value,
			TextColor3 = color,
			TextSize = size,
			TextTruncate = Enum.TextTruncate.None,
			TextWrapped = true,
			TextYAlignment = Enum.TextYAlignment.Top,
		}))
	end
	local function button(label: string, callback: () -> ())
		add(InventoryUi.Button(theme, label, {}, callback))
	end

	local selected = ctx.Selected
	local container = selected and state.Containers[selected.ContainerId]
	local item = container and ctx.Core.Find(container, selected.Uid)
	local def = item and ctx.Items[item.Id]
	if not selected or not container or not item or not def then
		text(string.upper(ctx.Style.Title), theme.Accent, 16, true)
		text("Select an item to see what you can do with it.", theme.Muted, 13)
		if ctx.HasGrid then
			text("Drag to move. R / Y turns the item you are holding.", theme.Muted, 13)
		else
			text("Drag to move. Drop a stack on the same item to merge.", theme.Muted, 13)
		end
		return
	end
	local containerId = selected.ContainerId
	local isOwn = ctx.IsOwn(containerId)
	local carried = ctx.IsCarried(containerId)

	text(def.Name, theme.Text, 17, true)
	local facts = { def.Category }
	if item.Count > 1 then
		table.insert(facts, `x{item.Count}`)
	end
	if (def.Weight or 0) > 0 then
		table.insert(facts, `{string.format("%.1f", def.Weight * item.Count)} wt`)
	end
	if def.Ammo and ctx.Items[def.Ammo] then
		table.insert(facts, `{ctx.CountCarried(def.Ammo)} {ctx.Items[def.Ammo].Name}`)
	end
	text(table.concat(facts, "  ·  "), theme.Muted, 13)
	if def.Description then
		text(def.Description, theme.Text, 13)
	end

	if carried and def.Use then
		button("Use", function()
			ctx.Send("Use", item.Uid)
		end)
	end
	if carried and def.Tool then
		local equipped = state.Equipped == item.Uid
		button(if equipped then "Put away" else "Equip", function()
			ctx.Send("Equip", if equipped then false else item.Uid)
		end)
	end
	for _, target in ctx.TransferTargets(containerId) do
		button(target.Label, function()
			ctx.Send("Transfer", containerId, item.Uid, target.Id)
		end)
	end
	if item.Count > 1 and container.Spec.Layout ~= "List" then
		button("Split", function()
			ctx.Split(containerId, item)
		end)
	end
	local size = def.Size
	if container.Spec.Layout == "Grid" and size and size[1] ~= size[2] and not container.Spec.NoRotate then
		button("Rotate", function()
			ctx.RotateItem(containerId, item)
		end)
	end
	if isOwn and ctx.Config.AllowDrop and def.Droppable ~= false then
		button("Drop", function()
			ctx.Send("Drop", containerId, item.Uid)
		end)
	end

	-- Quick slots: tap a number to bind this item to it, tap again to clear.
	local shortcuts = ctx.Style.Shortcuts or 0
	if carried and shortcuts > 0 and (def.Use or def.Tool) then
		text("Quick slot", theme.Muted, 12)
		local row = New("Frame", { BackgroundTransparency = 1, Size = UDim2.new(1, 0, 0, 30) }, {
			New("UIGridLayout", {
				CellPadding = UDim2.fromOffset(4, 4),
				CellSize = UDim2.fromOffset(22, 26),
				SortOrder = Enum.SortOrder.LayoutOrder,
			}),
		})
		row.AutomaticSize = Enum.AutomaticSize.Y
		for index = 1, shortcuts do
			local bound = state.Shortcuts[tostring(index)] == item.Id
			local slot = InventoryUi.Button(theme, tostring(index), {
				BackgroundColor3 = if bound then theme.Accent else theme.Cell,
				LayoutOrder = index,
				TextColor3 = if bound then theme.Panel else theme.Text,
				TextSize = 13,
			}, function()
				ctx.Send("Assign", index, if bound then false else item.Id)
			end)
			slot.Parent = row
		end
		add(row)
	end
end

return InventoryWindow
