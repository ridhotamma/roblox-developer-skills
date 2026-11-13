--!strict
-- The local player's side of ragdolling, plus the flinch listener every client needs:
--   * "RagdollState" on our character -> hold our Humanoid in the Physics state while down,
--     stand it up (GettingUp, optional get-up animation) when the server lets go.
--     The server can't do this for us: a player's Humanoid state belongs to that player's client.
--   * "RagdollImpulse" from the server -> throw our own body (we own its physics)
--   * "HitReact" from the server -> a flinch on any character we can see
--
-- Input is not blocked here on purpose: the Physics state already ignores movement. Block
-- abilities and shooting in your own controllers with RagdollController.IsDown().

local Players = game:GetService("Players")
local ReplicatedStorage = game:GetService("ReplicatedStorage")

local BodyZones = require(ReplicatedStorage.Shared.Ragdoll.BodyZones)
local Net = require(ReplicatedStorage.Shared.Net)
local ProceduralPose = require(script.Parent.Parent.Ragdoll.ProceduralPose)
local RagdollConfig = require(ReplicatedStorage.Shared.Ragdoll.RagdollConfig)
local RagdollRig = require(ReplicatedStorage.Shared.Ragdoll.RagdollRig)

local STATE = RagdollConfig.StateAttribute
local player = Players.LocalPlayer

local RagdollController = {}

local down = false

-- True while the local character is ragdolled or getting up.
function RagdollController.IsDown(): boolean
	return down
end

local function isFinite(v: Vector3): boolean
	return v.X == v.X and v.Y == v.Y and v.Z == v.Z and v.Magnitude < 1e5
end

local function playGetUp(humanoid: Humanoid, faceUp: boolean)
	local id = if faceUp then RagdollConfig.GetUpAnimations.FaceUp else RagdollConfig.GetUpAnimations.FaceDown
	local animator = humanoid:FindFirstChildOfClass("Animator")
	if id == "" or not animator then
		return
	end
	local animation = Instance.new("Animation")
	animation.AnimationId = id
	local track = animator:LoadAnimation(animation)
	track.Priority = Enum.AnimationPriority.Action
	track:Play(0.1)
	track.Stopped:Once(function()
		track:Destroy()
		animation:Destroy()
	end)
end

local function bindCharacter(character: Model)
	local found = character:WaitForChild("Humanoid", 10)
	if not found or not found:IsA("Humanoid") then
		return
	end
	local humanoid: Humanoid = found
	local faceUp = false
	down = false

	local function onState()
		local state = character:GetAttribute(STATE)
		if state == "Ragdoll" then
			down = true
			if humanoid.Health > 0 then
				humanoid:ChangeState(Enum.HumanoidStateType.Physics)
			end
		elseif state == "Recovering" then
			faceUp = RagdollRig.FacingUp(character)
		elseif down then
			down = false
			if humanoid.Health > 0 then
				if RagdollConfig.Ragdoll.SnapUpright then
					RagdollRig.Upright(character)
				end
				humanoid:ChangeState(Enum.HumanoidStateType.GettingUp)
				playGetUp(humanoid, faceUp)
			end
		end
	end

	character:GetAttributeChangedSignal(STATE):Connect(onState)
	-- Anything that knocks the Humanoid out of Physics while we are down (a jump request,
	-- a seat, another script) gets overruled.
	humanoid.StateChanged:Connect(function(_, new)
		if
			character:GetAttribute(STATE) == "Ragdoll"
			and new ~= Enum.HumanoidStateType.Physics
			and new ~= Enum.HumanoidStateType.Dead
			and humanoid.Health > 0
		then
			humanoid:ChangeState(Enum.HumanoidStateType.Physics)
		end
	end)
	onState()
end

function RagdollController:Start()
	Net.Unreliable("HitReact").OnClientEvent:Connect(function(character: unknown, zone: unknown, direction: unknown, strength: unknown)
		if
			typeof(character) == "Instance"
			and character:IsA("Model")
			and BodyZones.IsZone(zone)
			and typeof(direction) == "Vector3"
			and isFinite(direction)
			and typeof(strength) == "number"
			and strength == strength
		then
			ProceduralPose.Flinch(character, zone :: string, direction, strength)
		end
	end)

	Net.Event("RagdollImpulse").OnClientEvent:Connect(function(velocity: unknown, part: unknown, partVelocity: unknown)
		local character = player.Character
		if not character or typeof(velocity) ~= "Vector3" or not isFinite(velocity) then
			return
		end
		local hitPart: BasePart? = if typeof(part) == "Instance" and part:IsA("BasePart") then part else nil
		local extra: Vector3? = if typeof(partVelocity) == "Vector3" and isFinite(partVelocity) then partVelocity else nil
		RagdollRig.Launch(character, velocity, hitPart, extra)
	end)

	player.CharacterAdded:Connect(bindCharacter)
	if player.Character then
		task.spawn(bindCharacter, player.Character)
	end
end

return RagdollController
