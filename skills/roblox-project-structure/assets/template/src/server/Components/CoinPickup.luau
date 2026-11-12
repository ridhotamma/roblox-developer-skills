--!strict
-- Any BasePart in Workspace tagged "CoinPickup" gives coins when a player touches it,
-- hides, and comes back after a delay. Tag parts with the Tag Editor; no script in the part.

local Players = game:GetService("Players")
local ReplicatedStorage = game:GetService("ReplicatedStorage")
local ServerScriptService = game:GetService("ServerScriptService")

local CurrencyService = require(ServerScriptService.Server.Services.CurrencyService)
local GameConfig = require(ReplicatedStorage.Shared.Config.GameConfig)

local function setup(instance: Instance, trove: any)
	if not instance:IsA("BasePart") then
		warn(`CoinPickup tag on {instance:GetFullName()} ignored: not a BasePart`)
		return
	end
	local part = instance :: BasePart
	local config = GameConfig.CoinPickup
	local visibleTransparency = part.Transparency
	local ready = true

	trove:Connect(part.Touched, function(hit: BasePart)
		if not ready then
			return
		end
		local character = hit:FindFirstAncestorOfClass("Model")
		local player = character and Players:GetPlayerFromCharacter(character)
		if not player then
			return
		end

		ready = false
		CurrencyService:Add(player, config.Value, "CoinPickup")
		part.Transparency = 1
		part.CanTouch = false

		task.delay(config.RespawnSeconds, function()
			if part.Parent then
				part.Transparency = visibleTransparency
				part.CanTouch = true
				ready = true
			end
		end)
	end)
end

return {
	Tag = "CoinPickup",
	Setup = setup,
}
