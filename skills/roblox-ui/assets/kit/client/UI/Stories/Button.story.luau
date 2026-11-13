--!strict
-- Every Button variant and size on every device. Watch Small grow to the 44-unit hit target on
-- touch and the TV, and the shortcut glyphs appear only on the gamepad device.
-- Controls: Device ("All" or part of a name), Theme, Palette, Text, Disabled.

local ReplicatedStorage = game:GetService("ReplicatedStorage")

local React = require(ReplicatedStorage.Packages.React)
local ReactRoblox = require(ReplicatedStorage.Packages.ReactRoblox)
local Button = require(script.Parent.Parent.Primitives.Button)
local Devices = require(script.Parent.Devices)
local Layer = require(script.Parent.Parent.Primitives.Layer)
local Stack = require(script.Parent.Parent.Primitives.Stack)

local e = React.createElement

-- Variants your theme adds can be listed here too.
local VARIANTS = { "Primary", "Secondary", "Positive", "Danger", "Ghost" }
local SIZES = { "Small", "Medium", "Large" }

return {
	react = React,
	reactRoblox = ReactRoblox,
	controls = {
		Device = "All",
		Theme = "Game", -- Game, Default, Sharp, Soft, Arcade
		Palette = "", -- empty = the theme's default; or Dark, HighContrast, a palette your theme adds
		Text = "Play",
		Disabled = false,
	},
	story = function(props: any)
		local controls = props.controls
		return e(Devices.Matrix, {
			device = controls.Device,
			theme = controls.Theme,
			palette = controls.Palette,
			render = function()
				local rows: { [string]: any } = {}
				for row, variant in VARIANTS do
					local buttons: { [string]: any } = {}
					for column, size in SIZES do
						buttons[size] = e(Button, {
							text = controls.Text,
							variant = variant,
							size = size,
							disabled = controls.Disabled,
							hint = if column == 1 then Enum.KeyCode.ButtonA else nil,
							badge = if column == 3 and row == 1 then "3" else nil,
							onActivate = function()
								print(`[Button.story] {variant} {size} activated`)
							end,
							layoutOrder = column,
						})
					end
					rows[variant] = e(Stack, {
						direction = "Row",
						align = "Center",
						gap = "S",
						automaticSize = Enum.AutomaticSize.XY,
						layoutOrder = row,
					}, buttons)
				end
				return e(Layer, { name = "ButtonStory" }, {
					Column = e(Stack, {
						gap = "M",
						padding = "L",
						automaticSize = Enum.AutomaticSize.XY,
					}, rows),
				})
			end,
		})
	end,
}
