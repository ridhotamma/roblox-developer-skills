--!strict
-- The basic surface: a Frame styled from theme references. Wells, chips, spacers and one-off
-- panels are Boxes with different props; for the standard card look use Components/Card, which
-- takes its defaults from the theme.
--
--   e(Box, {
--       size = UDim2.fromScale(1, 0), automaticSize = Enum.AutomaticSize.Y,
--       color = "SurfaceSunken", radius = "M", padding = "L", stroke = { color = "Border" },
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
