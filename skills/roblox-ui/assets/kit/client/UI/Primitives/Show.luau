--!strict
-- Renders its children only where a rule matches the room and the input, so "what does each size
-- class show" is written next to the element instead of as scattered if-statements:
--
--   e(Show, { on = { sizeClass = { "Medium", "Expanded" } } }, { Stats = e(StatsPanel, ...) })
--   e(Show, { on = { input = "Gamepad" } }, { Legend = e(ControlsLegend) })
--   e(Show, { on = { sizeClass = "Expanded" }, fallback = e(CompactSummary) }, { Full = e(FullStats) })
--
-- Rules (Responsive.Rule): sizeClass, input, orientation, tenFoot, minWidth, minHeight (design
-- units of the room). Every field given must match. Decide by room and input, never by device
-- name: "hide on mobile" is { sizeClass = "Compact" } for the layout, or { input = "Touch" } for
-- an interaction, and those are different questions.
--
-- Show unmounts what it hides (its state resets when it comes back). To keep an element mounted,
-- pass the rule as its visibility instead:
--   visible = Responsive.matches(ui, { sizeClass = "Expanded" })
--
-- Hiding is for secondary information. Never hide the only way to do something on a size class
-- or input: move it (behind a tap, into a More menu, into a details sheet) instead.

local ReplicatedStorage = game:GetService("ReplicatedStorage")

local React = require(ReplicatedStorage.Packages.React)
local Responsive = require(script.Parent.Parent.Foundation.Responsive)
local UiContext = require(script.Parent.Parent.Foundation.UiContext)

export type Props = {
	on: Responsive.Rule,
	fallback: any?, -- rendered instead when the rule doesn't match
	children: any,
}

local function Show(props: Props)
	local ui = UiContext.useUi()
	if Responsive.matches(ui, props.on) then
		return React.createElement(React.Fragment, nil, props.children)
	end
	return props.fallback
end

return Show
