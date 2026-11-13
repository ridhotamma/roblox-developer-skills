--!strict
-- The shop on every device: full-screen sheet with a pinned Buy bar on phones, grid + details
-- column on tablets, desktops and the TV. Tiles are interactive in the preview.
-- Controls: Device, Palette, Open, Coins.

local ReplicatedStorage = game:GetService("ReplicatedStorage")

local React = require(ReplicatedStorage.Packages.React)
local ReactRoblox = require(ReplicatedStorage.Packages.ReactRoblox)
local AppState = require(script.Parent.Parent.AppState)
local Devices = require(script.Parent.Devices)
local ShopScreen = require(script.Parent.Parent.Screens.ShopScreen)

local e = React.createElement

local OWNED = table.freeze({ wood_sword = true, cat = true })

return {
	react = React,
	reactRoblox = ReactRoblox,
	controls = {
		Device = "All",
		Palette = "Dark",
		Open = true,
		Coins = 2400,
	},
	story = function(props: any)
		local controls = props.controls
		return e(Devices.Matrix, {
			device = controls.Device,
			palette = controls.Palette,
			render = function()
				return e(ShopScreen, {
					open = controls.Open,
					items = AppState.SAMPLE_ITEMS,
					coins = controls.Coins,
					owned = OWNED,
					onBuy = function(itemId: string)
						print(`[ShopScreen.story] buy {itemId}`)
					end,
					onClose = function()
						print("[ShopScreen.story] close")
					end,
				})
			end,
		})
	end,
}
