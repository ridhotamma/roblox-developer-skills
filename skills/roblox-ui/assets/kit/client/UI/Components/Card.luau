--!strict
-- A card: the standard surface for grouped content (a settings section, a quest, a reward, a
-- stats panel). It is a Stack (column by default) whose look comes from theme.components.Card:
-- corner radius, colour, transparency, border and padding. Restyle every card in the game from
-- the theme:
--   components = { Card = { radius = "XL", stroke = false, padding = "XL" } }
-- Props still win for one-off cards: `e(Card, { radius = "S" })`, `stroke = false`.
--
--   e(Card, { size = UDim2.fromScale(1, 0), automaticSize = Enum.AutomaticSize.Y }, {
--       Title = e(Text, { text = "Daily quests", variant = "Heading", layoutOrder = 1 }),
--       List = e(QuestList, { layoutOrder = 2 }),
--   })
--
-- `tone = "Raised"` uses the theme's raisedColor (a card on a card, a selected card).

local ReplicatedStorage = game:GetService("ReplicatedStorage")

local React = require(ReplicatedStorage.Packages.React)
local Stack = require(script.Parent.Parent.Primitives.Stack)
local UiContext = require(script.Parent.Parent.Foundation.UiContext)

local e = React.createElement

export type Props = Stack.Props & {
	tone: ("Default" | "Raised")?,
}

local Card = React.forwardRef(function(props: Props, ref: any)
	local ui = UiContext.useUi()
	local style = ui.theme.components.Card

	local stackProps: { [string]: any } = table.clone(props :: any)
	stackProps.tone = nil
	stackProps.ref = ref
	if props.color == nil then
		stackProps.color = if props.tone == "Raised" then style.raisedColor else style.color
	end
	if props.transparency == nil then
		stackProps.transparency = style.transparency
	end
	if props.radius == nil then
		stackProps.radius = style.radius
	end
	if props.padding == nil then
		stackProps.padding = style.padding
	end
	if props.gap == nil then
		stackProps.gap = style.gap
	end
	if props.stroke == nil and style.stroke then
		stackProps.stroke = { color = style.stroke, thickness = style.strokeWidth }
	end
	return e(Stack, stackProps)
end)

return Card
