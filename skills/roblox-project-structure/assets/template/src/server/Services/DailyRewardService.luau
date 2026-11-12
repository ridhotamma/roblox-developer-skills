--!strict
-- Example of a client request handled properly: the client asks, the server checks
-- everything (data loaded, cooldown) and decides. The client never says how much it gets.

local ReplicatedStorage = game:GetService("ReplicatedStorage")

local CurrencyService = require(script.Parent.CurrencyService)
local DataService = require(script.Parent.DataService)
local Format = require(ReplicatedStorage.Shared.Util.Format)
local GameConfig = require(ReplicatedStorage.Shared.Config.GameConfig)
local Net = require(ReplicatedStorage.Shared.Net)

local DailyRewardService = {}

function DailyRewardService:Start()
	local notify = Net.Event("Notify")
	local config = GameConfig.DailyReward

	Net.Handle("ClaimDailyReward", 1, function(player)
		local data = DataService:Get(player)
		if not data then
			return
		end

		local now = os.time()
		local readyAt = data.LastDailyClaim + config.CooldownSeconds
		if now < readyAt then
			notify:FireClient(player, `Next reward in {Format.Duration(readyAt - now)}`)
			return
		end

		data.LastDailyClaim = now
		CurrencyService:Add(player, config.Coins, "DailyReward")
		notify:FireClient(player, `+{Format.Number(config.Coins)} coins!`)
	end)
end

return DailyRewardService
