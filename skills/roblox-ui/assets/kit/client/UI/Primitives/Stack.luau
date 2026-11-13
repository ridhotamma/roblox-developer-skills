--!strict
-- A Box that lays its children out in a row or a column with a gap: the layout primitive for
-- almost everything. Wraps UIListLayout, including its flex features (wrap, space-between, fill).
--
--   e(Stack, { direction = "Row", gap = Tokens.Space.S, align = "Center", automaticSize = Enum.AutomaticSize.XY }, {
--       Icon = e(Icon, { image = ..., layoutOrder = 1 }),
--       Label = e(Text, { text = "Coins", layoutOrder = 2 }),
--   })
--
-- Children are ordered by their `layoutOrder` prop, not by table order: keyed children have no
-- order in Luau. Give every child a layoutOrder. A child with `flex = "Fill"` takes the space
-- that is left (a scroll area under a header, a label that pushes a button to the edge).

local ReplicatedStorage = game:GetService("ReplicatedStorage")

local React = require(ReplicatedStorage.Packages.React)
local Box = require(script.Parent.Box)
local Decorate = require(script.Parent.Decorate)
local UiContext = require(script.Parent.Parent.Foundation.UiContext)

local e = React.createElement

export type Align = "Start" | "Center" | "End" | "Stretch"
export type Justify = "Start" | "Center" | "End" | "SpaceBetween" | "SpaceAround" | "SpaceEvenly"

export type Props = Decorate.StyleProps & {
	direction: ("Row" | "Column")?, -- default Column
	gap: number?, -- design units
	align: Align?, -- cross axis; default Start
	justify: Justify?, -- main axis; default Start
	wrap: boolean?, -- rows of items that flow onto the next line
}

local HORIZONTAL = {
	Start = Enum.HorizontalAlignment.Left,
	Center = Enum.HorizontalAlignment.Center,
	End = Enum.HorizontalAlignment.Right,
}
local VERTICAL = {
	Start = Enum.VerticalAlignment.Top,
	Center = Enum.VerticalAlignment.Center,
	End = Enum.VerticalAlignment.Bottom,
}
local FLEX = {
	SpaceBetween = Enum.UIFlexAlignment.SpaceBetween,
	SpaceAround = Enum.UIFlexAlignment.SpaceAround,
	SpaceEvenly = Enum.UIFlexAlignment.SpaceEvenly,
}

local Stack = React.forwardRef(function(props: Props, ref: any)
	local ui = UiContext.useUi()
	local row = props.direction == "Row"
	local justify = props.justify or "Start"
	local align = props.align or "Start"

	local mainFlex = FLEX[justify] or Enum.UIFlexAlignment.None
	local mainAlign = if FLEX[justify] then "Start" else justify
	local crossAlign = if align == "Stretch" then "Start" else align

	local layout: { [string]: any } = {
		FillDirection = if row then Enum.FillDirection.Horizontal else Enum.FillDirection.Vertical,
		SortOrder = Enum.SortOrder.LayoutOrder,
		Padding = UDim.new(0, ui.px(props.gap or 0)),
		Wraps = props.wrap == true,
		ItemLineAlignment = if align == "Stretch" then Enum.ItemLineAlignment.Stretch else Enum.ItemLineAlignment.Automatic,
	}
	if row then
		layout.HorizontalAlignment = HORIZONTAL[mainAlign]
		layout.HorizontalFlex = mainFlex
		layout.VerticalAlignment = VERTICAL[crossAlign]
	else
		layout.VerticalAlignment = VERTICAL[mainAlign]
		layout.VerticalFlex = mainFlex
		layout.HorizontalAlignment = HORIZONTAL[crossAlign]
	end

	local boxProps: { [string]: any } = table.clone(props :: any)
	boxProps.ref = ref
	boxProps.children = {
		Layout = e("UIListLayout", layout),
		Items = e(React.Fragment, nil, props.children),
	}
	return e(Box, boxProps)
end)

return Stack
