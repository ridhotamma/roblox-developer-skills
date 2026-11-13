--!strict
-- The row of quick slots that stays on screen during play, and the touch buttons that
-- replace the keyboard (open inventory, hold for the wheel).
--
-- What a slot shows comes from the controller (ctx.BarEntry): either a real slot of the
-- style's Bar container, or a shortcut pointing at an item id anywhere in the inventory.
-- Tapping a slot is the same as pressing its number key.

local UserInputService = game:GetService("UserInputService")

local InventoryUi = require(script.Parent.Parent.InventoryUi)

local New = InventoryUi.New

local QuickBar = {}
QuickBar.__index = QuickBar

function QuickBar.new(ctx: any)
	local theme = ctx.Theme
	local style = ctx.Style
	local count = if style.Bar then style.BarSlots or 9 else style.Shortcuts or 0
	local touch = UserInputService.TouchEnabled
	local viewport = (workspace.CurrentCamera :: Camera).ViewportSize
	-- Fit the whole row on a phone held upright.
	local size = if count > 0 then math.clamp(math.floor((viewport.X - 32) / count) - 4, 32, if touch then 58 else 52) else 52

	local self = setmetatable({
		Ctx = ctx,
		Count = count,
		Size = size,
		Buttons = {} :: { TextButton },
	}, QuickBar)

	self.Gui = New("ScreenGui", {
		Name = "InventoryBar",
		DisplayOrder = 5,
		ResetOnSpawn = false,
		ZIndexBehavior = Enum.ZIndexBehavior.Sibling,
		Parent = ctx.PlayerGui,
	})
	local row = New("Frame", {
		AnchorPoint = Vector2.new(0.5, 1),
		AutomaticSize = Enum.AutomaticSize.XY,
		BackgroundTransparency = 1,
		Position = UDim2.new(0.5, 0, 1, -10),
		Parent = self.Gui,
	}, {
		New("UIListLayout", {
			FillDirection = Enum.FillDirection.Horizontal,
			Padding = UDim.new(0, 4),
			SortOrder = Enum.SortOrder.LayoutOrder,
		}),
	})

	for index = 1, count do
		local button = New("TextButton", {
			Name = `Quick{index}`,
			AutoButtonColor = false,
			BackgroundColor3 = theme.Panel,
			BackgroundTransparency = 0.25,
			BorderSizePixel = 0,
			LayoutOrder = index,
			Size = UDim2.fromOffset(size, size),
			Text = "",
			Parent = row,
		})
		InventoryUi.Corner(button, theme.Radius)
		New("UIStroke", {
			Name = "Edge",
			ApplyStrokeMode = Enum.ApplyStrokeMode.Border,
			Color = theme.Line,
			Transparency = 0.4,
			Parent = button,
		})
		local key = InventoryUi.Label(theme, {
			Name = "Key",
			Position = UDim2.fromOffset(4, 1),
			Size = UDim2.fromOffset(14, 14),
			Text = tostring(index),
			TextColor3 = theme.Muted,
			TextSize = 11,
			ZIndex = 6,
		})
		key.Parent = button
		button.Activated:Connect(function()
			ctx.SelectBar(index)
		end)
		self.Buttons[index] = button
	end

	if touch then
		local side = New("Frame", {
			AnchorPoint = Vector2.new(1, 0.5),
			AutomaticSize = Enum.AutomaticSize.XY,
			BackgroundTransparency = 1,
			Position = UDim2.new(1, -12, 0.42, 0),
			Parent = self.Gui,
		}, {
			New("UIListLayout", { Padding = UDim.new(0, 8), SortOrder = Enum.SortOrder.LayoutOrder }),
		})
		local bag = InventoryUi.Button(theme, "BAG", {
			BackgroundTransparency = 0.25,
			LayoutOrder = 1,
			Size = UDim2.fromOffset(56, 56),
			TextSize = 13,
		}, function()
			ctx.Toggle()
		end)
		bag.Parent = side
		if style.Wheel then
			-- Hold, drag towards a segment, let go.
			local wheel = InventoryUi.Button(theme, "WHEEL", {
				BackgroundTransparency = 0.25,
				LayoutOrder = 2,
				Size = UDim2.fromOffset(56, 56),
				TextSize = 12,
			}, function() end)
			wheel.InputBegan:Connect(function(input: InputObject)
				if input.UserInputType == Enum.UserInputType.Touch then
					ctx.OpenWheel(input)
				end
			end)
			wheel.Parent = side
		end
	end

	self:Render()
	return self
end

function QuickBar:Render()
	local ctx = self.Ctx
	local theme = ctx.Theme
	for index, button in self.Buttons do
		local old = button:FindFirstChild("Tile")
		if old then
			old:Destroy()
		end
		-- entry = { Def, Count, Equipped, Missing }
		local entry = ctx.BarEntry(index)
		local edge = button:FindFirstChild("Edge")
		if edge and edge:IsA("UIStroke") then
			local active = entry ~= nil and entry.Equipped
			edge.Color = if active then theme.Accent else theme.Line
			edge.Thickness = if active then 2 else 1
			edge.Transparency = if active then 0 else 0.4
		end
		if entry then
			local tile = InventoryUi.Tile(theme, entry.Def, entry.Count, self.Size, self.Size, {
				Count = if entry.Count > 1 or entry.Missing then entry.Count else nil,
				Equipped = entry.Equipped,
				Faded = entry.Missing,
			})
			tile.Parent = button
		end
	end
end

function QuickBar:SetVisible(visible: boolean)
	self.Gui.Enabled = visible
end

return QuickBar
