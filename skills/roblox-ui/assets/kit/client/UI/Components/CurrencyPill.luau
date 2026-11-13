--!strict
-- The always-visible balance chip: coin glyph, an amount that counts up or down when it changes
-- (a spring driving the text through a binding, so no re-render per frame), and an optional "+"
-- that opens the shop. Readable over any world thanks to a dark backing and outlined text.
--
--   e(CurrencyPill, { amount = coins, onAdd = openShop })

local ReplicatedStorage = game:GetService("ReplicatedStorage")

local React = require(ReplicatedStorage.Packages.React)
local Box = require(script.Parent.Parent.Primitives.Box)
local Button = require(script.Parent.Parent.Primitives.Button)
local Motion = require(script.Parent.Parent.Foundation.Motion)
local NumberFormat = require(script.Parent.Parent.Foundation.NumberFormat)
local Stack = require(script.Parent.Parent.Primitives.Stack)
local Text = require(script.Parent.Parent.Primitives.Text)
local Tokens = require(script.Parent.Parent.Theme.Tokens)
local UiContext = require(script.Parent.Parent.Foundation.UiContext)

local e = React.createElement

export type Props = {
	amount: number,
	color: Color3?, -- glyph colour; default palette.Currency
	onAdd: (() -> ())?,
	addHint: Enum.KeyCode?, -- gamepad glyph on the "+" button
	position: UDim2?,
	anchor: Vector2?,
	layoutOrder: number?,
}

local function CurrencyPill(props: Props)
	local ui = UiContext.useUi()
	local shown = Motion.useSpring(props.amount, Tokens.Motion.Springs.Gentle)
	local color = props.color or ui.palette.Currency
	local glyph = ui.px(Tokens.IconSize.M)

	return e(Stack, {
		direction = "Row",
		align = "Center",
		gap = Tokens.Space.S,
		size = UDim2.fromOffset(0, ui.px(math.max(Tokens.Control.Medium, ui.hitTarget))),
		automaticSize = Enum.AutomaticSize.X,
		position = props.position,
		anchor = props.anchor,
		layoutOrder = props.layoutOrder,
		color = ui.palette.Surface,
		transparency = Tokens.Transparency.Hud,
		radius = "Full",
		padding = { left = Tokens.Space.S, right = if props.onAdd then Tokens.Space.XS else Tokens.Space.L },
	}, {
		Coin = e(Box, {
			size = UDim2.fromOffset(glyph, glyph),
			color = color,
			radius = "Full",
			stroke = { color = color:Lerp(Color3.new(0, 0, 0), 0.35), thickness = Tokens.Stroke.Regular },
			layoutOrder = 1,
		}),
		Amount = e(Text, {
			text = shown:map(function(value: number)
				return NumberFormat.Short(math.round(value))
			end),
			variant = "Heading",
			outline = true,
			localize = false,
			layoutOrder = 2,
		}),
		Add = if props.onAdd
			then e(Button, {
				text = "+",
				variant = "Positive",
				size = "Small",
				hint = props.addHint,
				onActivate = props.onAdd,
				layoutOrder = 3,
			})
			else nil,
	})
end

return CurrencyPill
