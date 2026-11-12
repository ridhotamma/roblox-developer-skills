--!strict
-- Client-only visual: anchored parts tagged "Spinner" rotate and bob in place.
-- Pure decoration runs on the client so the server never spends time on it, and it stops
-- automatically when the part streams out (StreamingEnabled) or the tag is removed.

local RunService = game:GetService("RunService")

local DEGREES_PER_SECOND = 90
local BOB_HEIGHT = 0.5
local BOB_SPEED = 2

local function setup(instance: Instance, trove: any)
	if not instance:IsA("BasePart") then
		return
	end
	local part = instance :: BasePart
	local origin = part.CFrame
	local elapsed = math.random() * 10 -- desync neighbours so a row of coins does not move as one

	trove:Connect(RunService.RenderStepped, function(dt: number)
		elapsed += dt
		local bob = math.sin(elapsed * BOB_SPEED) * BOB_HEIGHT
		part.CFrame = origin * CFrame.new(0, bob, 0) * CFrame.Angles(0, math.rad(elapsed * DEGREES_PER_SECOND), 0)
	end)
	trove:Add(function()
		if part.Parent then
			part.CFrame = origin
		end
	end)
end

return {
	Tag = "Spinner",
	Setup = setup,
}
