--!strict
-- A menu window that adapts to the device:
--   * Compact (phones): a full-screen sheet that slides up, because a centred dialog on a phone
--     leaves a few hundred points of cramped content and tiny margins nobody can tap;
--   * Medium / Expanded: a centred dialog up to `width` x `height` design units, never larger
--     than the safe area.
-- It dims the world behind it (tap outside to close when `onClose` is given), closes with B on a
-- gamepad, moves gamepad selection inside when it opens and back when it closes, and stays
-- mounted while closed (hidden and disabled), so reopening is instant and keeps scroll position.
--
--   e(Modal, { open = shopOpen, title = "Shop", onClose = closeShop, footer = buyBar }, body)
--
-- While open it also keeps Roblox's own UI out of the way (Foundation/CoreUi): the backpack hotbar
-- and the emotes menu are hidden (the hotbar would sit over a sheet's footer and its number keys
-- would equip tools mid-purchase), and on phones the player list too. Chat stays: menus open over
-- a running multiplayer game. Pass `coreGui = {}` to hide nothing, or your own list.
-- When the on-screen keyboard is up (a TextBox in the body has focus on a phone or tablet), the
-- sheet shrinks and the dialog rises so the focused field and the footer stay above the keys.
--
-- `scroll = false` when the body manages its own scrolling (e.g. a grid beside a details pane).
-- Look (corners, colour, border, scrim, default size, header height, footer) comes from
-- theme.components.Modal; on phones the sheet is always square-cornered and full-screen.

local ReplicatedStorage = game:GetService("ReplicatedStorage")

local React = require(ReplicatedStorage.Packages.React)
local Box = require(script.Parent.Parent.Primitives.Box)
local Button = require(script.Parent.Parent.Primitives.Button)
local CoreUi = require(script.Parent.Parent.Foundation.CoreUi)
local Layer = require(script.Parent.Parent.Primitives.Layer)
local Motion = require(script.Parent.Parent.Foundation.Motion)
local Navigation = require(script.Parent.Parent.Foundation.Navigation)
local Scroller = require(script.Parent.Parent.Primitives.Scroller)
local Stack = require(script.Parent.Parent.Primitives.Stack)
local Text = require(script.Parent.Parent.Primitives.Text)
local Tokens = require(script.Parent.Parent.Theme.Tokens)
local UiContext = require(script.Parent.Parent.Foundation.UiContext)

local e = React.createElement

export type Props = {
	open: boolean,
	title: string,
	onClose: (() -> ())?, -- nil: the player can't dismiss it (forced choices only)
	width: number?, -- design units; default theme Modal.width
	height: number?, -- design units; default theme Modal.height
	scroll: boolean?, -- default true
	footer: any?, -- element pinned under the body (actions)
	order: number?, -- layer; default Tokens.Layers.Modal
	coreGui: { Enum.CoreGuiType }?, -- Roblox UI hidden while open; default below
	children: any,
}

local HIDE_EVERYWHERE = { Enum.CoreGuiType.Backpack, Enum.CoreGuiType.EmotesMenu }
local HIDE_ON_PHONES = { Enum.CoreGuiType.Backpack, Enum.CoreGuiType.EmotesMenu, Enum.CoreGuiType.PlayerList }

-- An "X" drawn from two bars, so it needs no icon asset and no font glyph.
local function CloseGlyph(props: { color: Color3 })
	local ui = UiContext.useUi()
	local length = ui.px(ui.theme.icon.S)
	local thickness = math.max(2, ui.stroke("Regular"))
	local function bar(rotation: number)
		return e("Frame", {
			AnchorPoint = Vector2.new(0.5, 0.5),
			Position = UDim2.fromScale(0.5, 0.5),
			Size = UDim2.fromOffset(length, thickness),
			Rotation = rotation,
			BackgroundColor3 = props.color,
			BorderSizePixel = 0,
		})
	end
	return e("Frame", {
		Size = UDim2.fromOffset(length, length),
		BackgroundTransparency = 1,
		LayoutOrder = 1,
	}, {
		A = bar(45),
		B = bar(-45),
	})
end

local function Modal(props: Props)
	local ui = UiContext.useUi()
	local style = ui.theme.components.Modal
	local alpha = Motion.useSpring(if props.open then 1 else 0)
	local panelRef = React.useRef(nil :: Frame?)
	local compact = ui.sizeClass == "Compact"
	local order = props.order or Tokens.Layers.Modal

	Navigation.useShortcut({ Enum.KeyCode.ButtonB }, props.onClose, props.open)
	Navigation.useFocus(panelRef, props.open)
	CoreUi.useHidden(props.coreGui or (if compact then HIDE_ON_PHONES else HIDE_EVERYWHERE), props.open)

	-- Room left above the on-screen keyboard (all of it when the keyboard is down).
	local keyboard = if props.open then ui.keyboard else 0

	local shown = alpha:map(function(a: number)
		return a > 0.001
	end)

	local panelSize: UDim2
	local panelAnchor: Vector2
	local panelPosition: any
	if compact then
		panelSize = UDim2.new(1, 0, 1, -keyboard)
		panelAnchor = Vector2.zero
		panelPosition = alpha:map(function(a: number)
			return UDim2.fromScale(0, Motion.lerp(1.05, 0, a))
		end)
	else
		local margin = ui.space(style.margin) * 2
		local width = math.min(ui.px(props.width or style.width), ui.room.X - margin)
		local height = math.min(ui.px(props.height or style.height), ui.room.Y - keyboard - margin)
		panelSize = UDim2.fromOffset(width, height)
		panelAnchor = Vector2.new(0.5, 0.5)
		local rise = ui.space(style.margin)
		local lift = math.round(keyboard / 2) -- centred in the room above the keyboard
		panelPosition = alpha:map(function(a: number)
			return UDim2.new(0.5, 0, 0.5, math.round(rise * (1 - a)) - lift)
		end)
	end

	local body = if props.scroll == false
		then e(Box, { size = UDim2.fromScale(1, 0), flex = "Fill", layoutOrder = 3 }, props.children)
		else e(Scroller, {
			size = UDim2.fromScale(1, 0),
			flex = "Fill",
			padding = style.padding,
			layoutOrder = 3,
		}, props.children)

	return e(React.Fragment, nil, {
		Backdrop = e(Layer, { name = `{props.title}Backdrop`, order = order, insets = "None", enabled = shown }, {
			Scrim = e("TextButton", {
				Text = "",
				AutoButtonColor = false,
				Selectable = false,
				Size = UDim2.fromScale(1, 1),
				BackgroundColor3 = ui.palette.Scrim,
				BackgroundTransparency = alpha:map(function(a: number)
					return Motion.lerp(1, ui.transparency(style.scrim), a)
				end),
				BorderSizePixel = 0,
				-- Swallows taps so they don't reach the world; closes when dismissible.
				[React.Event.Activated] = function()
					if props.open and props.onClose then
						props.onClose()
					end
				end,
			}),
		}),
		Window = e(Layer, { name = `{props.title}Window`, order = order + 1, insets = "Safe", enabled = shown }, {
			Panel = e(Stack, {
				ref = panelRef,
				size = panelSize,
				anchor = panelAnchor,
				position = panelPosition,
				color = style.color,
				transparency = style.transparency,
				radius = if compact then nil else style.radius,
				stroke = if compact or not style.stroke then nil else { color = style.stroke, thickness = style.strokeWidth },
				clip = true,
				native = { Active = true }, -- clicks on the panel don't fall through to the scrim
			}, {
				Header = e(Stack, {
					direction = "Row",
					align = "Center",
					gap = "S",
					size = UDim2.new(1, 0, 0, ui.px(style.headerHeight)),
					padding = { left = style.padding, right = "S" },
					layoutOrder = 1,
				}, {
					Title = e(Text, {
						text = props.title,
						variant = "Heading",
						size = UDim2.fromScale(0, 1),
						flex = "Fill",
						truncate = true,
						layoutOrder = 1,
					}),
					Close = if props.onClose
						then e(Button, {
							variant = "Ghost",
							size = "Small",
							onActivate = props.onClose,
							hint = Enum.KeyCode.ButtonB,
							layoutOrder = 2,
						}, {
							Glyph = e(CloseGlyph, { color = ui.palette.Text }),
						})
						else nil,
				}),
				Divider = e(Box, {
					size = UDim2.new(1, 0, 0, ui.stroke("Thin")),
					color = style.dividerColor,
					layoutOrder = 2,
				}),
				Body = body,
				Footer = if props.footer
					then e(Box, {
						size = UDim2.fromScale(1, 0),
						automaticSize = Enum.AutomaticSize.Y,
						color = style.footerColor,
						padding = style.footerPadding,
						layoutOrder = 4,
					}, { Content = props.footer })
					else nil,
			}),
		}),
	})
end

return Modal
