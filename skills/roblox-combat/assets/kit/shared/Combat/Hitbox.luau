--!strict
-- Box hitbox queries. Used by the server (authoritative) and by the attacker's client
-- (prediction, cosmetic only).

local Hitbox = {}

-- The box in front of a root part: `size` is (width, height, reach).
function Hitbox.InFront(root: BasePart, size: Vector3, padding: number?): (CFrame, Vector3)
	local pad = padding or 0
	local padded = size + Vector3.new(pad, pad, pad)
	return root.CFrame * CFrame.new(0, 0, -padded.Z / 2), padded
end

-- Unique living character models (Humanoid with Health > 0) touching the box.
function Hitbox.Query(cframe: CFrame, size: Vector3, exclude: { Instance }): { Model }
	local params = OverlapParams.new()
	params.FilterType = Enum.RaycastFilterType.Exclude
	params.FilterDescendantsInstances = exclude

	local found: { [Model]: boolean } = {}
	local out: { Model } = {}
	for _, part in workspace:GetPartBoundsInBox(cframe, size, params) do
		local model = part:FindFirstAncestorOfClass("Model")
		-- Accessories and tools sit inside the character model, so climb to the model with a Humanoid.
		while model and not model:FindFirstChildOfClass("Humanoid") do
			model = model:FindFirstAncestorOfClass("Model")
		end
		if model and not found[model] then
			local humanoid = model:FindFirstChildOfClass("Humanoid")
			if humanoid and humanoid.Health > 0 then
				found[model] = true
				table.insert(out, model)
			end
		end
	end
	return out
end

-- The model owning a hit part (for raycasts), if it's a living character.
function Hitbox.CharacterFromPart(part: Instance): Model?
	local model = part:FindFirstAncestorOfClass("Model")
	while model and not model:FindFirstChildOfClass("Humanoid") do
		model = model:FindFirstAncestorOfClass("Model")
	end
	if model then
		local humanoid = model:FindFirstChildOfClass("Humanoid")
		if humanoid and humanoid.Health > 0 then
			return model
		end
	end
	return nil
end

return table.freeze(Hitbox)
