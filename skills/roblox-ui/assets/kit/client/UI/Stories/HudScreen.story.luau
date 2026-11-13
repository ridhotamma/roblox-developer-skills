--!strict
-- The HUD on every device, with the Roblox top bar and the touch thumbstick / jump zones drawn
-- on top. Nothing interactive should sit under those overlays.
-- Controls: Device, Theme, Palette, Coins (change it to see the count animate), DailyReady.

local ReplicatedStorage = game:GetService("ReplicatedStorage")

local React = require(ReplicatedStorage.Packages.React)
local ReactRoblox = require(ReplicatedStorage.Packages.ReactRoblox)
local Devices = require(script.Parent.Devices)
local HudScreen = require(script.Parent.Parent.Screens.HudScreen)

local e = React.createElement

return {
	react = React,
	reactRoblox = ReactRoblox,
	controls = {
		Device = "All",
		Theme = "Game", -- Game, Default, Sharp, Soft, Arcade
		Palette = "", -- empty = the theme's default; or Dark, HighContrast, a palette your theme adds
		Coins = 12500,
		DailyReady = true,
	},
	story = function(props: any)
		local controls = props.controls
		return e(Devices.Matrix, {
			device = controls.Device,
			theme = controls.Theme,
			palette = controls.Palette,
			render = function()
				return e(HudScreen, {
					coins = controls.Coins,
					dailyReady = controls.DailyReady,
					onOpenShop = function()
						print("[HudScreen.story] open shop")
					end,
					onClaimDaily = function()
						print("[HudScreen.story] claim daily")
					end,
				})
			end,
		})
	end,
}
