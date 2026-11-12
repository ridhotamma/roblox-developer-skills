--!strict
-- Owns coins. The saved value lives in the player's data; the "Coins" attribute on the
-- Player mirrors it so any client UI can display it without a remote.
-- Every change goes through Add / Spend, which is also where economy analytics are logged.

local AnalyticsService = game:GetService("AnalyticsService")

local DataService = require(script.Parent.DataService)

local CURRENCY = "Coins"

local CurrencyService = {}

local function publish(player: Player, balance: number)
	player:SetAttribute(CURRENCY, balance)
end

local function logEconomy(
	player: Player,
	flow: Enum.AnalyticsEconomyFlowType,
	amount: number,
	balance: number,
	reason: string
)
	-- Shows up in Creator Hub → Analytics → Economy as sources and sinks by `reason`.
	pcall(function()
		AnalyticsService:LogEconomyEvent(
			player,
			flow,
			CURRENCY,
			amount,
			balance,
			Enum.AnalyticsEconomyTransactionType.Gameplay.Name,
			reason
		)
	end)
end

function CurrencyService:Start()
	DataService:ObserveProfiles(function(player, data)
		publish(player, data.Coins)
	end)
end

function CurrencyService:Get(player: Player): number
	local data = DataService:Get(player)
	return if data then data.Coins else 0
end

-- Adds a whole, positive number of coins. `reason` names the source ("DailyReward").
function CurrencyService:Add(player: Player, amount: number, reason: string): boolean
	assert(amount > 0 and amount % 1 == 0, "amount must be a positive integer")
	local data = DataService:Get(player)
	if not data then
		return false
	end
	data.Coins += amount
	publish(player, data.Coins)
	logEconomy(player, Enum.AnalyticsEconomyFlowType.Source, amount, data.Coins, reason)
	return true
end

-- Removes coins if the player can afford it. Returns false (and changes nothing) otherwise.
function CurrencyService:Spend(player: Player, amount: number, reason: string): boolean
	assert(amount > 0 and amount % 1 == 0, "amount must be a positive integer")
	local data = DataService:Get(player)
	if not data or data.Coins < amount then
		return false
	end
	data.Coins -= amount
	publish(player, data.Coins)
	logEconomy(player, Enum.AnalyticsEconomyFlowType.Sink, amount, data.Coins, reason)
	return true
end

return CurrencyService
