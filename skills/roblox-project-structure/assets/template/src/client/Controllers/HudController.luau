--!strict
-- Behaviour of the HUD: shows coins (from the server-set "Coins" attribute), asks the
-- server for the daily reward, and shows toasts the server sends.

local Players = game:GetService("Players")
local ReplicatedStorage = game:GetService("ReplicatedStorage")

local Format = require(ReplicatedStorage.Shared.Util.Format)
local HudScreen = require(script.Parent.Parent.UI.HudScreen)
local Net = require(ReplicatedStorage.Shared.Net)

local TOAST_SECONDS = 2.5

local player = Players.LocalPlayer

local HudController = {}

local screen: HudScreen.HudScreen
local toastToken = 0

function HudController:Init()
	screen = HudScreen()
end

function HudController:Start()
	screen.Gui.Parent = player:WaitForChild("PlayerGui")

	local function refreshCoins()
		local coins = player:GetAttribute("Coins")
		screen.CoinsLabel.Text = `Coins: {Format.Number(if typeof(coins) == "number" then coins else 0)}`
	end
	player:GetAttributeChangedSignal("Coins"):Connect(refreshCoins)
	refreshCoins()

	local claim = Net.Event("ClaimDailyReward")
	screen.DailyButton.Activated:Connect(function()
		claim:FireServer()
	end)

	Net.Event("Notify").OnClientEvent:Connect(function(message: unknown)
		if typeof(message) == "string" then
			HudController:Toast(message)
		end
	end)
end

function HudController:Toast(message: string)
	toastToken += 1
	local token = toastToken
	screen.Toast.Text = message
	screen.Toast.Visible = true
	task.delay(TOAST_SECONDS, function()
		if toastToken == token then
			screen.Toast.Visible = false
		end
	end)
end

return HudController
