--!strict
-- Tunable numbers for the whole game. Data only: no logic, no Instances.
-- The client reads these to display; the server reads them to enforce.

return table.freeze({
	CoinPickup = table.freeze({
		Value = 5, -- coins per pickup
		RespawnSeconds = 10,
	}),

	DailyReward = table.freeze({
		Coins = 100,
		CooldownSeconds = 20 * 60 * 60, -- 20 h, so players on a daily routine never just miss it
	}),
})
