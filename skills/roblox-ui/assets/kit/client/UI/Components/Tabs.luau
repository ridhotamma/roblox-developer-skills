--!strict
-- A row of tabs. Scrolls sideways when the tabs don't fit (phones, long translations), and on a
-- gamepad LB / RB move between tabs with the bumper glyphs shown at each end. Which Button
-- variants and size the tabs use comes from theme.components.Tabs.
--
--   e(Tabs, { tabs = { { id = "all", label = "All" }, { id = "pets", label = "Pets" } },
--             selected = tab, onSelect = setTab, shortcuts = props.open })

local ReplicatedStorage = game:GetService("ReplicatedStorage")
local UserInputService = game:GetService("UserInputService")

local React = require(ReplicatedStorage.Packages.React)
local Button = require(script.Parent.Parent.Primitives.Button)
local Icon = require(script.Parent.Parent.Primitives.Icon)
local Navigation = require(script.Parent.Parent.Foundation.Navigation)
local Scroller = require(script.Parent.Parent.Primitives.Scroller)
local Stack = require(script.Parent.Parent.Primitives.Stack)
local UiContext = require(script.Parent.Parent.Foundation.UiContext)

local e = React.createElement

export type Tab = { id: string, label: string, icon: string? }

export type Props = {
	tabs: { Tab },
	selected: string,
	onSelect: (id: string) -> (),
	shortcuts: boolean?, -- bind LB / RB (pass false while another menu has focus)
	layoutOrder: number?,
}

local function glyph(key: Enum.KeyCode): string?
	local ok, image = pcall(UserInputService.GetImageForKeyCode, UserInputService, key)
	return if ok and type(image) == "string" and image ~= "" then image else nil
end

local function Tabs(props: Props)
	local ui = UiContext.useUi()
	local style = ui.theme.components.Tabs

	local index = 1
	for i, tab in props.tabs do
		if tab.id == props.selected then
			index = i
		end
	end
	local function move(step: number)
		local count = #props.tabs
		if count == 0 then
			return
		end
		local nextIndex = ((index - 1 + step) % count) + 1
		props.onSelect(props.tabs[nextIndex].id)
	end

	local bumpers = props.shortcuts ~= false and #props.tabs > 1
	Navigation.useShortcut({ Enum.KeyCode.ButtonL1 }, function()
		move(-1)
	end, bumpers)
	Navigation.useShortcut({ Enum.KeyCode.ButtonR1 }, function()
		move(1)
	end, bumpers)

	local onGamepad = ui.input == "Gamepad" and bumpers
	local leftGlyph = if onGamepad then glyph(Enum.KeyCode.ButtonL1) else nil
	local rightGlyph = if onGamepad then glyph(Enum.KeyCode.ButtonR1) else nil

	local buttons: { [string]: any } = {}
	for i, tab in props.tabs do
		local selected = tab.id == props.selected
		buttons[`Tab_{tab.id}`] = e(Button, {
			text = tab.label,
			icon = tab.icon,
			size = style.size,
			variant = if selected then style.selected else style.idle,
			onActivate = function()
				props.onSelect(tab.id)
			end,
			layoutOrder = i,
		})
	end

	local height = ui.px(math.max((ui.theme.control :: any)[style.size] or ui.theme.control.Small, ui.hitTarget))
	return e(Stack, {
		direction = "Row",
		align = "Center",
		gap = style.gap,
		size = UDim2.new(1, 0, 0, height),
		layoutOrder = props.layoutOrder,
	}, {
		Left = if leftGlyph then e(Icon, { image = leftGlyph, layoutOrder = 1 }) else nil,
		Strip = e(Scroller, {
			direction = "Horizontal",
			size = UDim2.fromScale(0, 1),
			flex = "Fill",
			layoutOrder = 2,
		}, {
			Row = e(Stack, {
				direction = "Row",
				align = "Center",
				gap = style.gap,
				size = UDim2.fromScale(0, 1),
				automaticSize = Enum.AutomaticSize.X,
			}, buttons),
		}),
		Right = if rightGlyph then e(Icon, { image = rightGlyph, layoutOrder = 3 }) else nil,
	})
end

return Tabs
