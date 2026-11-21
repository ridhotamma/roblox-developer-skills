--!strict
-- The HUD on every device, with the Roblox top bar, the default chat window (desktop) and the
-- touch thumbstick / jump zones drawn on top. Nothing interactive should sit under those overlays.
-- Controls: Device, Theme, Palette, Coins (change it to see the count animate), DailyReady,
-- Extra (0-5 more menu buttons: watch them overflow into More on phones first; "Ranks" only
-- exists on Expanded).

local ReplicatedStorage = game:GetService("ReplicatedStorage")

local React = require(ReplicatedStorage.Packages.React)
local ReactRoblox = require(ReplicatedStorage.Packages.ReactRoblox)
local Devices = require(script.Parent.Devices)
local HudScreen = require(script.Parent.Parent.Screens.HudScreen)

local e = React.createElement

local function log(what: string): () -> ()
	return function()
		print(`[HudScreen.story] {what}`)
	end
end

-- Extra buttons a bigger game has. Lower priority leaves the screen first.
local EXTRA: { HudScreen.Action } = {
	{ id = "Pets", text = "Pets", priority = 3, onActivate = log("pets") },
	{ id = "Quests", text = "Quests", badge = "2", priority = 4, onActivate = log("quests") },
	{ id = "Codes", text = "Codes", priority = 8, onActivate = log("codes") },
	{ id = "Ranks", text = "Ranks", priority = 6, show = { sizeClass = "Expanded" }, onActivate = log("leaderboard") },
	{ id = "Settings", text = "Settings", priority = 9, onActivate = log("settings") },
}

return {
	react = React,
	reactRoblox = ReactRoblox,
	controls = {
		Device = "All",
		Theme = "Game", -- Game, Default, Sharp, Soft, Arcade
		Palette = "", -- empty = the theme's default; or Dark, HighContrast, a palette your theme adds
		Coins = 12500,
		DailyReady = true,
		Extra = 3,
	},
	story = function(props: any)
		local controls = props.controls
		local actions: { HudScreen.Action } = {
			{ id = "Shop", text = "Shop", variant = "Primary", hint = Enum.KeyCode.ButtonY, onActivate = log("open shop") },
			{
				id = "Daily",
				text = "Daily",
				hint = Enum.KeyCode.ButtonX,
				badge = controls.DailyReady == true,
				onActivate = log("claim daily"),
			},
		}
		for index = 1, math.clamp(math.floor(tonumber(controls.Extra) or 0), 0, #EXTRA) do
			table.insert(actions, EXTRA[index])
		end
		return e(Devices.Matrix, {
			device = controls.Device,
			theme = controls.Theme,
			palette = controls.Palette,
			render = function()
				return e(HudScreen, {
					coins = controls.Coins,
					actions = actions,
					onOpenShop = log("open shop"),
				})
			end,
		})
	end,
}
