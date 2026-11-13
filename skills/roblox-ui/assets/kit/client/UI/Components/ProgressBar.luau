--!strict
-- A bar for XP, health, loading, quest progress. `value` is 0..1.
--   * a number: the bar springs to it on change (re-renders only when the number changes);
--   * a Binding: the bar follows it every frame with no re-render (health that drains
--     continuously, a charge meter). Drive the binding from your own code.
--
--   e(ProgressBar, { value = xp / xpToNext, label = `{xp} / {xpToNext} XP`, color = ui.palette.Accent })

local ReplicatedStorage = game:GetService("ReplicatedStorage")

local React = require(ReplicatedStorage.Packages.React)
local Box = require(script.Parent.Parent.Primitives.Box)
local Motion = require(script.Parent.Parent.Foundation.Motion)
local Text = require(script.Parent.Parent.Primitives.Text)
local Tokens = require(script.Parent.Parent.Theme.Tokens)
local UiContext = require(script.Parent.Parent.Foundation.UiContext)

local e = React.createElement

export type Props = {
	value: any, -- number or Binding<number>, 0..1
	color: Color3?,
	height: number?, -- design units; default 14
	label: string?, -- drawn on the bar; keep it short
	width: UDim?, -- default full width
	position: UDim2?,
	anchor: Vector2?,
	layoutOrder: number?,
}

local function fillSize(value: number): UDim2
	return UDim2.fromScale(math.clamp(value, 0, 1), 1)
end

local function ProgressBar(props: Props)
	local ui = UiContext.useUi()
	local isBinding = type(props.value) == "table"
	-- Hooks run unconditionally; the spring is simply unused when given a binding.
	local spring = Motion.useSpring(if isBinding then 0 else props.value :: number, Tokens.Motion.Springs.Gentle)
	local source = if isBinding then props.value else spring

	return e(Box, {
		size = UDim2.new(props.width or UDim.new(1, 0), UDim.new(0, ui.px(props.height or 14))),
		position = props.position,
		anchor = props.anchor,
		layoutOrder = props.layoutOrder,
		color = ui.palette.SurfaceSunken,
		radius = "Full",
		clip = true,
	}, {
		Fill = e(Box, {
			size = source:map(fillSize),
			color = props.color or ui.palette.Accent,
			radius = "Full",
		}),
		Label = if props.label
			then e(Text, {
				text = props.label,
				variant = "Caption",
				size = UDim2.fromScale(1, 1),
				align = "Center",
				outline = true,
				localize = false,
				zIndex = 2,
			})
			else nil,
	})
end

return ProgressBar
