--!strict
-- The always-on HUD: balance at the top left, menu buttons where each device wants them, and a
-- "More" button for whatever doesn't fit.
--
-- Placement rules this screen demonstrates:
--   * Everything sits in the Safe layer, so it clears the Roblox top bar, phone notches and TV
--     overscan.
--   * The bottom corners stay empty on touch: the thumbstick lives bottom-left and the jump
--     button bottom-right, so the menu column stays above the bottom third of the screen
--     (Tokens.ThumbZone). Menu buttons go in a column at the left edge (landscape), or in a row
--     under the balance (portrait).
--   * The strip knows how many buttons it has room for. When the actions don't all fit, the most
--     important ones stay (`priority`, lower first, default list order) and the rest move into
--     a More flyout, so nothing is cut off on a small phone and no action is ever unreachable.
--   * `show` rules (Responsive.Rule) drop an action where it doesn't belong at all, by room or
--     input: a "Controls" legend only for gamepad, a leaderboard button only on Expanded.
--   * The default chat window opens at the top left on desktop: the balance moves to its right
--     and the column starts below it, instead of drawing under it (ui.chatWindow).
--   * Buttons are larger on touch (the hit target) and show shortcut glyphs on gamepad. Every
--     action's shortcut works while its button is in More too.
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

export type Action = {
	id: string,
	text: string,
	icon: string?,
	variant: Button.Variant?, -- default Secondary
	hint: Enum.KeyCode?, -- gamepad shortcut, bound even while the button is in More
	badge: (boolean | string)?,
	priority: number?, -- lower stays on screen longer; default: its position in the list
	show: Responsive.Rule?, -- where the action exists at all; default everywhere
	onActivate: () -> (),
}

export type Props = {
	coins: number,
	actions: { Action }, -- in display order
	shortcuts: boolean?, -- false while a menu is open, so its own buttons get the keys
	onOpenShop: (() -> ())?, -- the "+" on the balance
}

-- HUD menu buttons share one width so the strip's capacity is known before layout (and the
-- column reads as one block). Labels are short words; translations get room up to this width.
local BUTTON_WIDTH = { Compact = 88, Expanded = 120 }

local function Shortcut(props: { key: Enum.KeyCode, handler: () -> (), enabled: boolean })
	Navigation.useShortcut({ props.key }, props.handler, props.enabled)
	return nil
end

local function overlaps(rect: UiContext.Rect?, x0: number, y0: number, x1: number, y1: number): boolean
	if rect == nil then
		return false
	end
	local finish = rect.position + rect.size
	return rect.position.X < x1 and finish.X > x0 and rect.position.Y < y1 and finish.Y > y0
end

local function bottomOf(rect: UiContext.Rect): number
	return math.round(rect.position.Y + rect.size.Y)
end

local function priorityOf(action: Action, index: number): number?
	return action.priority or index
end

local function HudScreen(props: Props)
	local ui = UiContext.useUi()
	local shortcuts = props.shortcuts ~= false
	local moreOpen, setMoreOpen = React.useState(false)
	local flyoutRef = React.useRef(nil :: Frame?)

	-- Sizes, in pixels of the Safe layer's content (ui.room).
	local room = ui.room
	local margin = ui.space("M")
	local gap = ui.space("S")
	local portrait = ui.orientation == "Portrait"
	local size: Button.Size = Responsive.pick(ui.sizeClass, { Compact = "Medium", Expanded = "Large" } :: any)
	local buttonHeight = ui.px(math.max(ui.theme.control[size], ui.hitTarget))
	local buttonWidth = ui.px(Responsive.pick(ui.sizeClass, BUTTON_WIDTH))
	local pillHeight = ui.px(math.max(ui.theme.control.Medium, ui.hitTarget))

	-- The balance: top left, or to the right of the chat window when that is in the corner.
	local chat = ui.chatWindow
	local balanceX = margin
	if chat and overlaps(chat, margin, margin, margin + buttonWidth, margin + pillHeight) then
		balanceX = math.round(chat.position.X + chat.size.X) + margin
	end
	local balanceAtLeft = balanceX == margin

	-- The band the strip of menu buttons may use, and how many buttons it holds.
	local bandStart, bandLength, capacity
	if portrait then
		-- A row under the balance (or the chat window), clear of both thumb zones.
		local y = if balanceAtLeft then margin + pillHeight + gap else margin
		if chat and overlaps(chat, margin, y, room.X - margin, y + buttonHeight) then
			y = bottomOf(chat) + gap
		end
		bandStart = y
		bandLength = room.X - margin * 2
		capacity = Responsive.fit(bandLength, buttonWidth, gap)
	else
		-- A column at the left edge, between the balance (or the chat window) and the thumbstick.
		local top = if balanceAtLeft then margin + pillHeight + gap else margin
		if chat and overlaps(chat, margin, top, margin + buttonWidth, room.Y) then
			top = math.max(top, bottomOf(chat) + gap)
		end
		local bottom = room.Y - margin
		if ui.input == "Touch" then
			bottom = math.min(bottom, math.round(room.Y * (1 - Tokens.ThumbZone.Height)))
		end
		bandStart = top
		bandLength = math.max(0, bottom - top)
		capacity = Responsive.fit(bandLength, buttonHeight, gap)
	end

	-- What exists here at all, then what stays on screen and what moves into More.
	local available: { Action } = {}
	for _, action in props.actions do
		if Responsive.matches(ui, action.show) then
			table.insert(available, action)
		end
	end
	local shown, hidden = Responsive.overflow(available, capacity, priorityOf)
	local hasMore = #hidden > 0

	-- Close the flyout when it has nothing left to show or a menu takes over the keys.
	local flyoutActive = moreOpen and hasMore and shortcuts
	React.useEffect(function()
		if moreOpen and not flyoutActive then
			setMoreOpen(false)
		end
		return nil
	end, { moreOpen, flyoutActive })
	Navigation.useShortcut({ Enum.KeyCode.ButtonB }, function()
		setMoreOpen(false)
	end, flyoutActive)
	Navigation.useFocus(flyoutRef, flyoutActive)

	local function button(action: Action, layoutOrder: number, fromFlyout: boolean)
		return e(Button, {
			text = action.text,
			icon = action.icon,
			variant = action.variant or "Secondary",
			size = size,
			width = UDim.new(0, buttonWidth),
			hint = action.hint,
			badge = action.badge,
			onActivate = function()
				if fromFlyout then
					setMoreOpen(false)
				end
				action.onActivate()
			end,
			layoutOrder = layoutOrder,
		})
	end

	local stripButtons: { [string]: any } = {}
	for index, action in shown do
		stripButtons[action.id] = button(action, index, false)
	end
	local anyBadge = false
	for _, action in hidden do
		if action.badge then
			anyBadge = true
		end
	end
	if hasMore then
		stripButtons.More = e(Button, {
			text = if flyoutActive then "Close" else "More",
			variant = "Secondary",
			size = size,
			width = UDim.new(0, buttonWidth),
			badge = anyBadge and not flyoutActive,
			onActivate = function()
				setMoreOpen(not moreOpen)
			end,
			layoutOrder = #shown + 1,
		})
	end

	-- Strip and flyout positions. The column is centred in its band; the row starts at the left.
	local slots = #shown + (if hasMore then 1 else 0)
	local stripLength = math.max(0, slots * (if portrait then buttonWidth else buttonHeight) + (slots - 1) * gap)
	local stripPosition, flyoutPosition
	local pad = ui.space("S")
	local flyoutHeight = #hidden * buttonHeight + math.max(0, #hidden - 1) * gap + pad * 2
	local flyoutWidth = buttonWidth + pad * 2
	if portrait then
		stripPosition = UDim2.fromOffset(margin, bandStart)
		local moreX = margin + #shown * (buttonWidth + gap)
		flyoutPosition = UDim2.fromOffset(
			math.clamp(moreX - pad, margin, math.max(margin, room.X - margin - flyoutWidth)),
			bandStart + buttonHeight + gap
		)
	else
		local stripY = bandStart + math.max(0, math.floor((bandLength - stripLength) / 2))
		stripPosition = UDim2.fromOffset(margin, stripY)
		local moreY = stripY + #shown * (buttonHeight + gap)
		flyoutPosition = UDim2.fromOffset(
			margin + buttonWidth + gap,
			math.clamp(moreY - pad, margin, math.max(margin, room.Y - margin - flyoutHeight))
		)
	end

	local flyoutButtons: { [string]: any } = {}
	for index, action in hidden do
		flyoutButtons[action.id] = button(action, index, true)
	end

	local shortcutsList: { [string]: any } = {}
	for _, action in available do
		if action.hint then
			shortcutsList[action.id] = e(Shortcut, { key = action.hint, handler = action.onActivate, enabled = shortcuts })
		end
	end

	local pill = ui.theme.components.Pill
	return e(Layer, { name = "Hud", order = Tokens.Layers.Hud }, {
		Shortcuts = e(React.Fragment, nil, shortcutsList),
		Balance = e(CurrencyPill, {
			amount = props.coins,
			onAdd = props.onOpenShop,
			position = UDim2.fromOffset(balanceX, margin),
		}),
		Menu = if slots > 0
			then e(Stack, {
				direction = if portrait then "Row" else "Column",
				gap = "S",
				automaticSize = Enum.AutomaticSize.XY,
				position = stripPosition,
			}, stripButtons)
			else nil,
		-- Taps outside the open flyout close it instead of reaching the world.
		Dismiss = if flyoutActive
			then e("TextButton", {
				Text = "",
				AutoButtonColor = false,
				Selectable = false,
				BackgroundTransparency = 1,
				Size = UDim2.fromScale(1, 1),
				ZIndex = 2,
				[React.Event.Activated] = function()
					setMoreOpen(false)
				end,
			})
			else nil,
		Flyout = if flyoutActive
			then e(Stack, {
				ref = flyoutRef,
				gap = "S",
				padding = "S",
				automaticSize = Enum.AutomaticSize.XY,
				position = flyoutPosition,
				color = pill.color,
				transparency = pill.transparency,
				radius = "L",
				zIndex = 3,
				native = { Active = true },
			}, flyoutButtons)
			else nil,
	})
end

return HudScreen
