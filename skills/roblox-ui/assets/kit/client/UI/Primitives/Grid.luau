--!strict
-- A responsive grid: as many columns as fit at `minItemWidth`, cells stretched to fill the row.
-- The same shop grid shows 2 columns on a phone, 4 on a tablet and 6 on a monitor without any
-- per-device code. Put it inside a Scroller; it grows downward with its content.
--
--   e(Grid, { minItemWidth = 132, aspectRatio = 0.8, gap = Tokens.Space.S }, tiles)
--
-- The grid needs its width from its parent (Size X as scale or offset, not AutomaticSize X).
-- Children are ordered by layoutOrder.

local ReplicatedStorage = game:GetService("ReplicatedStorage")

local React = require(ReplicatedStorage.Packages.React)
local Box = require(script.Parent.Box)
local Decorate = require(script.Parent.Decorate)
local Responsive = require(script.Parent.Parent.Foundation.Responsive)
local Tokens = require(script.Parent.Parent.Theme.Tokens)
local UiContext = require(script.Parent.Parent.Foundation.UiContext)

local e = React.createElement

export type Props = Decorate.StyleProps & {
	minItemWidth: number, -- design units
	aspectRatio: number?, -- cell width / height; default 1 (square). Ignored with itemHeight.
	itemHeight: number?, -- design units; fixed row height instead of an aspect ratio
	gap: number?, -- design units; default Tokens.Space.S
	maxColumns: number?,
	align: ("Start" | "Center")?, -- where a short last row sits; default Start
}

local Grid = React.forwardRef(function(props: Props, ref: any)
	local ui = UiContext.useUi()
	local width, setWidth = React.useState(0)

	local sides = Decorate.sides(props.padding)
	local gap = ui.px(props.gap or Tokens.Space.S)
	-- AbsoluteSize includes any UIScale above the UI (story previews), offsets don't: undo it.
	local available = width / ui.previewScale - ui.px(sides.left) - ui.px(sides.right)
	local columns = Responsive.columns(available, ui.px(props.minItemWidth), gap, props.maxColumns)
	local cellWidth = math.max(0, math.floor((available - gap * (columns - 1)) / columns))
	local cellHeight = if props.itemHeight
		then ui.px(props.itemHeight)
		else math.floor(cellWidth / (props.aspectRatio or 1))

	local native: { [any]: any } = if props.native then table.clone(props.native) else {}
	native[React.Change.AbsoluteSize] = function(frame: GuiObject)
		setWidth(frame.AbsoluteSize.X)
	end

	local boxProps: { [string]: any } = table.clone(props :: any)
	boxProps.ref = ref
	boxProps.size = props.size or UDim2.fromScale(1, 0)
	boxProps.automaticSize = props.automaticSize or Enum.AutomaticSize.Y
	boxProps.native = native
	boxProps.children = {
		Layout = e("UIGridLayout", {
			CellSize = UDim2.fromOffset(cellWidth, cellHeight),
			CellPadding = UDim2.fromOffset(gap, gap),
			FillDirection = Enum.FillDirection.Horizontal,
			FillDirectionMaxCells = columns,
			HorizontalAlignment = if props.align == "Center"
				then Enum.HorizontalAlignment.Center
				else Enum.HorizontalAlignment.Left,
			SortOrder = Enum.SortOrder.LayoutOrder,
		}),
		Items = e(React.Fragment, nil, props.children),
	}
	return e(Box, boxProps)
end)

return Grid
