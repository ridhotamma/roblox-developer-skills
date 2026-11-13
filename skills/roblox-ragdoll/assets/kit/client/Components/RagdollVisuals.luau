--!strict
-- Every character the server has built for ragdolling (tag "Ragdollable") gets procedural
-- poses on this client: flinches, injury poses and the get-up blend. Cleans up when the
-- character is removed or streams out.

local ProceduralPose = require(script.Parent.Parent.Ragdoll.ProceduralPose)

local function setup(instance: Instance, trove: any)
	if not instance:IsA("Model") then
		return
	end
	local character = instance :: Model
	-- The tag can arrive a moment before the body does on a streaming client.
	if not character:WaitForChild("HumanoidRootPart", 10) then
		return
	end
	ProceduralPose.Register(character)
	trove:Add(function()
		ProceduralPose.Unregister(character)
	end)
end

return {
	Tag = "Ragdollable", -- keep in sync with RagdollConfig.Tag
	Setup = setup,
}
