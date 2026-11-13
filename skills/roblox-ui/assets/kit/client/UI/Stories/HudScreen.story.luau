--!strict
-- The HUD on every device, with the Roblox top bar and the touch thumbstick / jump zones drawn
-- on top. Nothing interactive should sit under those overlays.
-- Controls: Device, Palette, Coins (change it to see the count animate), DailyReady.

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
		Palette = "Dark",
		Coins = 12500,
		DailyReady = true,
	},
	story = function(props: any)
		local controls = props.controls
		return e(Devices.Matrix, {
			device = controls.Device,
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
