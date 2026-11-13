--!strict
-- The basic surface: a Frame styled from tokens. Panels, cards, chips, wells and spacers are
-- all Boxes with different props.
--
--   e(Box, {
--       size = UDim2.fromScale(1, 0), automaticSize = Enum.AutomaticSize.Y,
--       color = ui.palette.Surface, radius = Tokens.Radius.L, padding = Tokens.Space.L,
--       stroke = { color = ui.palette.Border },
--   }, children)
--
-- No `color` = no background. Accepts a ref (forwarded to the Frame).

local ReplicatedStorage = game:GetService("ReplicatedStorage")

local React = require(ReplicatedStorage.Packages.React)
local Decorate = require(script.Parent.Decorate)
local UiContext = require(script.Parent.Parent.Foundation.UiContext)

local e = React.createElement

export type Props = Decorate.StyleProps

local Box = React.forwardRef(function(props: Props, ref: any)
	local ui = UiContext.useUi()
	local hostProps = Decorate.hostProps(props, ui)
	hostProps.ref = ref
	local children = Decorate.children(props, ui)
	children.Content = e(React.Fragment, nil, props.children)
	return e("Frame", hostProps, children)
end)

return Box
