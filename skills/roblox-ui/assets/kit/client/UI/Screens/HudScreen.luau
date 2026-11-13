--!strict
-- The always-on HUD: balance at the top left, menu buttons where each device wants them.
--
-- Placement rules this screen demonstrates:
--   * Everything sits in the Safe layer, so it clears the Roblox top bar and phone notches.
--   * The bottom corners stay empty on touch: the thumbstick lives bottom-left and the jump
--     button bottom-right. Menu buttons go in a column at the left edge, vertically centred,
--     where a left thumb reaches them (landscape), or in a row under the balance (portrait).
--   * Buttons are larger on touch (the hit target) and show shortcut glyphs on gamepad, where
--     ButtonY opens the shop and ButtonX claims the daily reward.
--   * HUD text is outlined and chips have a dark backing, so it reads over any world.

local ReplicatedStorage = game:GetService("ReplicatedStorage")

local React = require(ReplicatedStorage.Packages.React)
local Button = require(script.Parent.Parent.Primitives.Button)
local CurrencyPill = require(script.Parent.Parent.Components.CurrencyPill)
local Layer = require(script.Parent.Parent.Primitives.Layer)
local Navigation = require(script.Parent.Parent.Foundation.Navigation)
local Responsive = require(script.Parent.Parent.Foundation.Responsive)
local Stack = require(script.Parent.Parent.Primitives.Stack)
local Tokens = require(script.Parent.Parent.Theme.Tokens)
local UiContext = require(script.Parent.Parent.Foundation.UiContext)

local e = React.createElement

export type Props = {
	coins: number,
	dailyReady: boolean?,
	shortcuts: boolean?, -- false while a menu is open, so its own buttons get the keys
	onOpenShop: () -> (),
	onClaimDaily: () -> (),
}

local function HudScreen(props: Props)
	local ui = UiContext.useUi()
	local shortcuts = props.shortcuts ~= false
	Navigation.useShortcut({ Enum.KeyCode.ButtonY }, props.onOpenShop, shortcuts)
	Navigation.useShortcut({ Enum.KeyCode.ButtonX }, props.onClaimDaily, shortcuts)

	local margin = Tokens.Space.M
	local portrait = ui.orientation == "Portrait"
	local menuSize = Responsive.pick(ui.sizeClass, { Compact = "Medium", Expanded = "Large" } :: any)

	local menuButtons = {
		Shop = e(Button, {
			text = "Shop",
			variant = "Primary",
			size = menuSize,
			hint = Enum.KeyCode.ButtonY,
			onActivate = props.onOpenShop,
			layoutOrder = 1,
		}),
		Daily = e(Button, {
			text = "Daily",
			variant = "Secondary",
			size = menuSize,
			hint = Enum.KeyCode.ButtonX,
			badge = props.dailyReady == true,
			onActivate = props.onClaimDaily,
			layoutOrder = 2,
		}),
	}

	local menu
	if portrait then
		-- Phone held upright: a row under the balance, clear of both thumb zones.
		menu = e(Stack, {
			direction = "Row",
			gap = Tokens.Space.S,
			automaticSize = Enum.AutomaticSize.XY,
			position = UDim2.fromOffset(ui.px(margin), ui.px(margin + Tokens.Control.Medium + Tokens.Space.S)),
		}, menuButtons)
	else
		menu = e(Stack, {
			gap = Tokens.Space.S,
			align = "Stretch",
			automaticSize = Enum.AutomaticSize.XY,
			anchor = Vector2.new(0, 0.5),
			position = UDim2.new(0, ui.px(margin), 0.5, 0),
		}, menuButtons)
	end

	return e(Layer, { name = "Hud", order = Tokens.Layers.Hud }, {
		Balance = e(CurrencyPill, {
			amount = props.coins,
			onAdd = props.onOpenShop,
			position = UDim2.fromOffset(ui.px(margin), ui.px(margin)),
		}),
		Menu = menu,
	})
end

return HudScreen
