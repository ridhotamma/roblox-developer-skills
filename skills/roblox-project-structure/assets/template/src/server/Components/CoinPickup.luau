--!strict
-- Any BasePart in Workspace tagged "CoinPickup" gives coins when a player touches it,
-- hides, and comes back after a delay. Tag parts with the Tag Editor; no script in the part.

local Players = game:GetService("Players")
local ReplicatedStorage = game:GetService("ReplicatedStorage")
local ServerScriptService = game:GetService("ServerScriptService")

local CurrencyService = require(ServerScriptService.Server.Services.CurrencyService)
local GameConfig = require(ReplicatedStorage.Shared.Config.GameConfig)

-- Studs between the character's root and the coin's surface still counted as a touch
-- (character half-width plus latency slack).
local MAX_TOUCH_DISTANCE = 6

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
		if not (character and player) then
			return
		end
		-- Touches are detected by the player's own client, so exploits can fire them from
		-- anywhere on the map. Confirm on the server that the character is really here.
		local root = character:FindFirstChild("HumanoidRootPart")
		if not root or not root:IsA("BasePart") then
			return
		end
		local reach = part.Size.Magnitude / 2 + MAX_TOUCH_DISTANCE
		if (root.Position - part.Position).Magnitude > reach then
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
