--!strict
-- A scroll area whose canvas grows with its content (AutomaticCanvasSize), so nobody computes
-- CanvasSize by hand. Put a Stack or a Grid with AutomaticSize Y inside it.
--
--   e(Scroller, { size = UDim2.fromScale(1, 1), padding = Tokens.Space.M }, {
--       List = e(Stack, { size = UDim2.fromScale(1, 0), automaticSize = Enum.AutomaticSize.Y, gap = Tokens.Space.S }, rows),
--   })
--
-- The frame itself is not selectable, so gamepad selection moves between the items inside and
-- Roblox scrolls the selected one into view.

local ReplicatedStorage = game:GetService("ReplicatedStorage")

local React = require(ReplicatedStorage.Packages.React)
local Decorate = require(script.Parent.Decorate)
local UiContext = require(script.Parent.Parent.Foundation.UiContext)

local e = React.createElement

export type Props = Decorate.StyleProps & {
	direction: ("Vertical" | "Horizontal")?, -- default Vertical
}

local Scroller = React.forwardRef(function(props: Props, ref: any)
	local ui = UiContext.useUi()
	local horizontal = props.direction == "Horizontal"

	local hostProps = Decorate.hostProps(props, ui)
	hostProps.ref = ref
	hostProps.CanvasSize = UDim2.new()
	hostProps.AutomaticCanvasSize = if horizontal then Enum.AutomaticSize.X else Enum.AutomaticSize.Y
	hostProps.ScrollingDirection = if horizontal then Enum.ScrollingDirection.X else Enum.ScrollingDirection.Y
	-- Thin bar on touch (players drag the content, not the bar); a grabbable one on desktop.
	hostProps.ScrollBarThickness = ui.px(if ui.input == "Pointer" then 6 else 3)
	hostProps.ScrollBarImageColor3 = ui.palette.TextMuted
	hostProps.ScrollBarImageTransparency = 0.4
	hostProps.VerticalScrollBarInset = Enum.ScrollBarInset.ScrollBar
	hostProps.HorizontalScrollBarInset = Enum.ScrollBarInset.ScrollBar
	hostProps.ElasticBehavior = Enum.ElasticBehavior.WhenScrollable
	hostProps.ScrollingEnabled = true
	hostProps.Selectable = false

	local children = Decorate.children(props, ui)
	children.Content = e(React.Fragment, nil, props.children)
	return e("ScrollingFrame", hostProps, children)
end)

return Scroller
