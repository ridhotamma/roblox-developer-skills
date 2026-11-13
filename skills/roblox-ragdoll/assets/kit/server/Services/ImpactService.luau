--!strict
-- Knocks characters over when the world hits them hard, whatever animation they were in:
--   * fast impactors: anything tagged "Vehicle" or "Impactor" (cars, boulders, swinging hammers)
--   * hard landings
--
-- Impactors are swept on the server a few times a second instead of using Touched: the box the
-- impactor will cover before the next check is tested against registered characters only, so
-- fast cars can't tunnel past a pedestrian and map geometry costs nothing. Only impactors
-- already moving faster than MinSpeed are checked at all.
--
-- Other triggers (explosions, traps, tackles) just call RagdollService:Ragdoll themselves.

local CollectionService = game:GetService("CollectionService")
local ReplicatedStorage = game:GetService("ReplicatedStorage")
local RunService = game:GetService("RunService")

local RagdollConfig = require(ReplicatedStorage.Shared.Ragdoll.RagdollConfig)
local RagdollService = require(script.Parent.RagdollService)
local Signal = require(ReplicatedStorage.Packages.Signal)

local impact = RagdollConfig.Impact
local fall = RagdollConfig.Fall

local ImpactService = {
	-- Fires (character: Model, impactor: Instance, closingSpeed: number) for scoring, sounds, crime systems...
	Hit = Signal.new(),
	-- Fires (character: Model, landingSpeed: number)
	Fell = Signal.new(),
}

local lastHit: { [Model]: number } = {}
local lastFallSpeed: { [Model]: number } = {}

local function movingPart(instance: Instance): BasePart?
	if instance:IsA("BasePart") then
		return instance
	elseif instance:IsA("Model") then
		return instance.PrimaryPart or instance:FindFirstChildWhichIsA("BasePart", true)
	end
	return nil
end

local function boundsOf(instance: Instance, part: BasePart): (CFrame, Vector3)
	if instance:IsA("Model") then
		return instance:GetBoundingBox()
	end
	return part.CFrame, part.Size
end

local function characterOf(part: BasePart): Model?
	local model = part:FindFirstAncestorOfClass("Model")
	while model and not RagdollService:IsRegistered(model) do
		model = model:FindFirstAncestorOfClass("Model")
	end
	return model
end

local function sweep(instance: Instance, dt: number, now: number, params: OverlapParams)
	local part = movingPart(instance)
	if not part or part.Anchored or not part:IsDescendantOf(workspace) then
		return
	end
	local velocity = part.AssemblyLinearVelocity
	local speed = velocity.Magnitude
	if speed < impact.MinSpeed then
		return
	end

	-- The box now, stretched along the travel direction to cover the next interval.
	local cframe, size = boundsOf(instance, part)
	local travel = cframe:VectorToObjectSpace(velocity * dt)
	local pad = impact.Padding * 2
	local swept = Vector3.new(size.X + math.abs(travel.X) + pad, size.Y + math.abs(travel.Y) + pad, size.Z + math.abs(travel.Z) + pad)
	local center = cframe + velocity * dt * 0.5

	local seen: { [Model]: boolean } = {}
	for _, touched in workspace:GetPartBoundsInBox(center, swept, params) do
		local character = characterOf(touched)
		if not character or seen[character] then
			continue
		end
		seen[character] = true
		if character == instance or character:IsAncestorOf(instance) or now - (lastHit[character] or 0) < impact.Cooldown then
			continue
		end
		local humanoid = character:FindFirstChildOfClass("Humanoid")
		local root = character:FindFirstChild("HumanoidRootPart")
		if not humanoid or not root or not root:IsA("BasePart") then
			continue
		end
		-- Drivers and passengers ride along; only people on foot get run over.
		if humanoid.SeatPart ~= nil then
			continue
		end

		-- Closing speed: how fast the impactor is coming at the character, not just how fast it moves.
		local relative = velocity - root.AssemblyLinearVelocity
		local toCharacter = root.Position - cframe.Position
		local flat = Vector3.new(toCharacter.X, 0, toCharacter.Z)
		local closing = if flat.Magnitude > 1e-3 then relative:Dot(flat.Unit) else relative.Magnitude
		if closing < impact.MinSpeed then
			continue
		end

		lastHit[character] = now
		local launch = relative * impact.Transfer + Vector3.new(0, closing * impact.Lift, 0)
		RagdollService:Ragdoll(character, { Seconds = impact.Seconds, Velocity = launch })
		if impact.DamagePerSpeed > 0 and humanoid.Health > 0 then
			humanoid:TakeDamage(math.min((closing - impact.MinSpeed) * impact.DamagePerSpeed, impact.MaxDamage))
		end
		ImpactService.Hit:Fire(character, instance, closing)
	end
end

local function checkFalls()
	for _, character in RagdollService:Characters() do
		local root = character:FindFirstChild("HumanoidRootPart")
		local humanoid = character:FindFirstChildOfClass("Humanoid")
		if not root or not root:IsA("BasePart") or not humanoid then
			continue
		end
		local down = -root.AssemblyLinearVelocity.Y
		local before = lastFallSpeed[character] or 0
		lastFallSpeed[character] = down
		-- Was falling fast a moment ago, has now stopped: that was the landing.
		if before >= fall.Speed and down < 10 and humanoid.Health > 0 and not RagdollService:IsRagdolled(character) then
			RagdollService:Ragdoll(character, { Seconds = fall.Seconds })
			if fall.DamagePerSpeed > 0 then
				humanoid:TakeDamage((before - fall.Speed) * fall.DamagePerSpeed)
			end
			ImpactService.Fell:Fire(character, before)
		end
	end
end

function ImpactService:Start()
	if not impact.Enabled and not fall.Enabled then
		return
	end
	local interval = 1 / impact.Rate
	local elapsed = 0
	local lastCleanup = os.clock()

	RunService.Heartbeat:Connect(function(dt)
		elapsed += dt
		if elapsed < interval then
			return
		end
		local now = os.clock()

		if impact.Enabled then
			local characters = RagdollService:Characters()
			if #characters > 0 then
				local params = OverlapParams.new()
				params.FilterType = Enum.RaycastFilterType.Include
				params.FilterDescendantsInstances = characters
				for _, tag in impact.Tags do
					for _, instance in CollectionService:GetTagged(tag) do
						sweep(instance, elapsed, now, params)
					end
				end
			end
		end
		if fall.Enabled then
			checkFalls()
		end
		elapsed = 0

		if now - lastCleanup > 30 then
			lastCleanup = now
			for character in lastHit do
				if not character.Parent then
					lastHit[character] = nil
				end
			end
			for character in lastFallSpeed do
				if not character.Parent then
					lastFallSpeed[character] = nil
				end
			end
		end
	end)
end

return ImpactService
