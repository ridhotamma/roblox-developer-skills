--!strict
-- The one place characters are knocked down, hurt and stood back up.
--
--   RagdollService:Ragdoll(character, { Seconds, Velocity, Part, PartVelocity })   full ragdoll
--   RagdollService:Recover(character)                                              get up now
--   RagdollService:Push(character, velocity, part?, partVelocity?)                 shove a ragdoll
--   RagdollService:HitReact(character, part?, position?, direction, strength)      flinch (cosmetic)
--   RagdollService:Injure(character, zone, amount) / :Heal(character, zone?)       lasting injury
--
-- Who does what:
--   * The server switches the joints (Motor6D off, constraint on). That replicates to everyone.
--   * Whoever owns the body's physics changes the Humanoid state and applies launches: the
--     server for NPCs, the player's own client for player characters (RagdollController).
--   * Flinches, limps and the get-up blend are drawn by every client (ProceduralPose); the
--     server only says what happened (one unreliable remote, a few attributes).
--
-- With the roblox-combat kit installed, hits become flinches and injuries automatically, heavy
-- weights knock down, and deaths are thrown along the killing blow.

local CollectionService = game:GetService("CollectionService")
local Players = game:GetService("Players")
local ReplicatedStorage = game:GetService("ReplicatedStorage")
local RunService = game:GetService("RunService")

local BodyZones = require(ReplicatedStorage.Shared.Ragdoll.BodyZones)
local Net = require(ReplicatedStorage.Shared.Net)
local RagdollConfig = require(ReplicatedStorage.Shared.Ragdoll.RagdollConfig)
local RagdollRig = require(ReplicatedStorage.Shared.Ragdoll.RagdollRig)
local Signal = require(ReplicatedStorage.Packages.Signal)

-- Optional neighbours (other skills' kits).
local antiCheatModule = script.Parent:FindFirstChild("AntiCheatService")
local AntiCheat: any = if antiCheatModule then (require :: any)(antiCheatModule) else nil
local combatModule = script.Parent:FindFirstChild("CombatService")

local STATE = RagdollConfig.StateAttribute
local TICK = 0.1
local ragdollConfig = RagdollConfig.Ragdoll
local injuryConfig = RagdollConfig.Injury
local reactions = RagdollConfig.Reactions

export type RagdollOptions = {
	Seconds: number?, -- minimum time on the ground (default RagdollConfig.Ragdoll.MinSeconds)
	Velocity: Vector3?, -- added to the whole body
	Part: BasePart?, -- body part that took the blow...
	PartVelocity: Vector3?, -- ...and its extra velocity
}

type Record = {
	character: Model,
	humanoid: Humanoid,
	root: BasePart,
	state: "None" | "Ragdoll" | "Recovering",
	since: number,
	minUntil: number,
	stillSince: number?,
	injuries: { [string]: number },
	lastHurt: number,
	speedScale: number,
	dangling: { [string]: boolean },
	connections: { RBXScriptConnection },
}

local RagdollService = {
	Ragdolled = Signal.new(), -- (character: Model)
	Recovered = Signal.new(), -- (character: Model)
}

local records: { [Model]: Record } = {}
local characterList: { Model } = {}
local listDirty = true
local reactEvent: UnreliableRemoteEvent
local impulseEvent: RemoteEvent

local function alive(record: Record): boolean
	return record.character.Parent ~= nil and record.humanoid.Health > 0
end

local function grant(record: Record, seconds: number)
	if AntiCheat then
		local player = Players:GetPlayerFromCharacter(record.character)
		if player then
			AntiCheat:Grant(player, seconds)
		end
	end
end

-- Arms that are injured badly enough hang from their constraints while the rest stays animated.
local function applyDangle(record: Record)
	local threshold = injuryConfig.DangleArmAt
	for key, joints in BodyZones.ArmJoints do
		local injury = record.injuries[key] or 0
		local want = threshold > 0
			and alive(record)
			and (injury >= threshold or (record.dangling[key] == true and injury >= threshold - 0.2))
		if record.state == "None" and want ~= (record.dangling[key] == true) then
			RagdollRig.SetActive(record.character, want, joints)
		end
		record.dangling[key] = want
	end
end

local function applySpeed(record: Record)
	local legs = (record.injuries.LeftLeg or 0) + (record.injuries.RightLeg or 0)
	local scale = 1 - math.min(legs * injuryConfig.LegSpeedPenalty, 0.6)
	scale = math.floor(scale * 20 + 0.5) / 20 -- 5% steps, so healing doesn't replicate WalkSpeed every tick
	if math.abs(scale - record.speedScale) > 1e-3 then
		-- Multiplicative, so sprint and slow effects from other systems keep working.
		record.humanoid.WalkSpeed = record.humanoid.WalkSpeed / record.speedScale * scale
		record.speedScale = scale
	end
end

local function publishInjury(record: Record, key: string)
	local step = injuryConfig.Step
	local value = math.floor((record.injuries[key] or 0) / step + 0.5) * step
	local attribute = BodyZones.InjuryAttribute(key)
	if record.character:GetAttribute(attribute) ~= value then
		record.character:SetAttribute(attribute, value)
	end
end

local function forget(character: Model)
	local record = records[character]
	if record then
		records[character] = nil
		listDirty = true
		for _, connection in record.connections do
			connection:Disconnect()
		end
	end
end

local function register(character: Model)
	if records[character] or not character:IsDescendantOf(workspace) then
		return
	end
	local humanoid = character:FindFirstChildOfClass("Humanoid")
	local root = character:FindFirstChild("HumanoidRootPart")
	if not humanoid or not root or not root:IsA("BasePart") or not RagdollRig.Build(character) then
		return
	end

	local record: Record = {
		character = character,
		humanoid = humanoid,
		root = root,
		state = "None",
		since = 0,
		minUntil = 0,
		stillSince = nil,
		injuries = {},
		lastHurt = 0,
		speedScale = 1,
		dangling = {},
		connections = {},
	}
	records[character] = record
	listDirty = true
	character:SetAttribute(STATE, "None")

	table.insert(
		record.connections,
		humanoid.Died:Connect(function()
			if ragdollConfig.OnDeath then
				RagdollService:Ragdoll(character)
			end
		end)
	)
	table.insert(
		record.connections,
		character.AncestryChanged:Connect(function(_, parent)
			if parent == nil then
				forget(character)
			end
		end)
	)
	CollectionService:AddTag(character, RagdollConfig.Tag)
end

local function oldestLiving(): Record?
	local oldest: Record? = nil
	local count = 0
	for _, record in records do
		if record.state == "Ragdoll" then
			count += 1
			if alive(record) and (not oldest or record.since < oldest.since) then
				oldest = record
			end
		end
	end
	return if count >= ragdollConfig.MaxActive then oldest else nil
end

function RagdollService:Init()
	reactEvent = Net.Unreliable("HitReact")
	impulseEvent = Net.Event("RagdollImpulse")
end

-- Every registered character (for overlap filters). Do not modify the returned array.
function RagdollService:Characters(): { Model }
	if listDirty then
		listDirty = false
		characterList = {}
		for character in records do
			table.insert(characterList, character)
		end
	end
	return characterList
end

function RagdollService:IsRegistered(character: Model): boolean
	return records[character] ~= nil
end

function RagdollService:IsRagdolled(character: Model): boolean
	local record = records[character]
	return record ~= nil and record.state ~= "None"
end

-- Shoves a body that is already (or about to be) ragdolled.
function RagdollService:Push(character: Model, velocity: Vector3, part: BasePart?, partVelocity: Vector3?)
	local record = records[character]
	if not record then
		return
	end
	local player = Players:GetPlayerFromCharacter(character)
	if player then
		grant(record, 3)
		impulseEvent:FireClient(player, velocity, part, partVelocity)
	else
		RagdollRig.Launch(character, velocity, part, partVelocity)
	end
end

-- Returns true if the character is now ragdolled (also when it already was: the timer extends).
function RagdollService:Ragdoll(character: Model, options: RagdollOptions?): boolean
	local record = records[character]
	if not record or not character.Parent then
		return false
	end
	local opts: RagdollOptions = options or {}
	local now = os.clock()
	local seconds = math.max(opts.Seconds or ragdollConfig.MinSeconds, ragdollConfig.MinSeconds)
	record.minUntil = math.max(record.minUntil, now + seconds)
	record.stillSince = nil

	if record.state ~= "Ragdoll" then
		local crowded = oldestLiving()
		if crowded and crowded ~= record then
			RagdollService:Recover(crowded.character)
		end

		record.state = "Ragdoll"
		record.since = now
		grant(record, ragdollConfig.MaxSeconds + 2)
		character:SetAttribute(STATE, "Ragdoll")
		RagdollRig.SetActive(character, true)
		if not Players:GetPlayerFromCharacter(character) and record.humanoid.Health > 0 then
			-- NPCs: the server owns the body, so it also holds the Humanoid in the Physics state.
			record.humanoid:ChangeState(Enum.HumanoidStateType.Physics)
		end
		RagdollService.Ragdolled:Fire(character)
	end

	if opts.Velocity or opts.PartVelocity then
		RagdollService:Push(character, opts.Velocity or Vector3.zero, opts.Part, opts.PartVelocity)
	end
	return true
end

-- Stands a living character back up. Clients get RecoverGap seconds to capture the pose they
-- will blend from before the joints lock again.
function RagdollService:Recover(character: Model)
	local record = records[character]
	if not record or record.state ~= "Ragdoll" or not alive(record) then
		return
	end
	record.state = "Recovering"
	character:SetAttribute(STATE, "Recovering")

	task.delay(ragdollConfig.RecoverGap, function()
		if records[character] ~= record or record.state ~= "Recovering" then
			return
		end
		record.state = "None"
		record.minUntil = 0
		RagdollRig.SetActive(character, false)
		for key in record.dangling do
			record.dangling[key] = false -- SetActive(false) locked every joint; re-evaluate
		end
		applyDangle(record)
		character:SetAttribute(STATE, "None")
		grant(record, 1.5)

		if not Players:GetPlayerFromCharacter(character) then
			if ragdollConfig.SnapUpright then
				RagdollRig.Upright(character)
			end
			record.humanoid:ChangeState(Enum.HumanoidStateType.GettingUp)
		end
		RagdollService.Recovered:Fire(character)
	end)
end

-- A flinch: cosmetic, drawn by nearby clients. `direction` is the way the blow was travelling.
function RagdollService:HitReact(character: Model, part: BasePart?, position: Vector3?, direction: Vector3, strength: number)
	local record = records[character]
	if not record or record.state ~= "None" or direction.Magnitude < 1e-3 then
		return
	end
	local zone = BodyZones.FromHit(character, part, position)
	local localDirection = record.root.CFrame:VectorToObjectSpace(direction.Unit)
	local amount = math.clamp(strength, 0, 1)
	local origin = record.root.Position
	for _, player in Players:GetPlayers() do
		if player:DistanceFromCharacter(origin) <= reactions.MaxDistance then
			reactEvent:FireClient(player, character, zone, localDirection, amount)
		end
	end
end

-- Adds to a zone's lasting injury (0..1). `zone` is a hit zone or an injury key.
function RagdollService:Injure(character: Model, zone: string, amount: number)
	local record = records[character]
	if not record or not injuryConfig.Enabled or amount <= 0 or not alive(record) then
		return
	end
	local key = BodyZones.InjuryKey(zone)
	record.injuries[key] = math.clamp((record.injuries[key] or 0) + amount, 0, 1)
	record.lastHurt = os.clock()
	publishInjury(record, key)
	applySpeed(record)
	applyDangle(record)
end

-- Clears one zone, or every injury when `zone` is nil (medkits, respawn pads).
function RagdollService:Heal(character: Model, zone: string?)
	local record = records[character]
	if not record then
		return
	end
	for _, key in BodyZones.InjuryKeys do
		if zone == nil or BodyZones.InjuryKey(zone) == key then
			record.injuries[key] = 0
			publishInjury(record, key)
		end
	end
	applySpeed(record)
	applyDangle(record)
end

function RagdollService:GetInjury(character: Model, zone: string): number
	local record = records[character]
	return if record then record.injuries[BodyZones.InjuryKey(zone)] or 0 else 0
end

-- Builds and tracks a character by hand (players and tagged NPCs are picked up automatically;
-- use this for a model that was moved into Workspace instead of cloned or tagged).
function RagdollService:Register(character: Model)
	register(character)
end

-- Call after rescaling a character or swapping body parts.
function RagdollService:Rebuild(character: Model)
	forget(character)
	RagdollRig.Destroy(character)
	register(character)
end

local function step(dt: number)
	local now = os.clock()
	for character, record in records do
		if not character.Parent then
			forget(character)
			continue
		end

		if record.state == "Ragdoll" and alive(record) then
			local still = record.root.AssemblyLinearVelocity.Magnitude < ragdollConfig.SettleSpeed
			if still then
				record.stillSince = record.stillSince or now
			else
				record.stillSince = nil
			end
			local settled = record.stillSince ~= nil and now - record.stillSince >= ragdollConfig.SettleSeconds
			local timedOut = now - record.since >= ragdollConfig.MaxSeconds
			if now >= record.minUntil and (settled or timedOut) then
				RagdollService:Recover(character)
			end
		end

		if now - record.lastHurt >= injuryConfig.HealDelay then
			local changed = false
			for key, value in record.injuries do
				if value > 0 then
					record.injuries[key] = math.max(0, value - injuryConfig.HealPerSecond * dt)
					publishInjury(record, key)
					changed = true
				end
			end
			if changed then
				applySpeed(record)
				applyDangle(record)
			end
		end
	end
end

local function hookCombat()
	if not combatModule then
		return
	end
	local CombatService: any = (require :: any)(combatModule)
	local knockdowns = RagdollConfig.Combat.KnockdownWeights

	-- `info` ({ Position, Direction, Part }) is sent by combat kits that include the ragdoll hook;
	-- older ones send five arguments and the reaction falls back to attacker -> victim.
	CombatService.Damaged:Connect(function(victim: Model, attacker: Model?, weightName: string, damage: number, killed: boolean, info: any)
		local record = records[victim]
		if not record then
			return
		end
		local details = if typeof(info) == "table" then info else {}
		local part: BasePart? = if typeof(details.Part) == "Instance" and details.Part:IsA("BasePart") then details.Part else nil
		local position: Vector3? = if typeof(details.Position) == "Vector3" then details.Position else nil
		local direction: Vector3? = if typeof(details.Direction) == "Vector3" then details.Direction else nil
		if not direction or direction.Magnitude < 1e-3 then
			local attackerRoot = attacker and attacker:FindFirstChild("HumanoidRootPart")
			direction = if attackerRoot and attackerRoot:IsA("BasePart")
				then record.root.Position - attackerRoot.Position
				else -record.root.CFrame.LookVector
		end
		local along = if (direction :: Vector3).Magnitude > 1e-3 then (direction :: Vector3).Unit else Vector3.zAxis

		if killed then
			if ragdollConfig.OnDeath then
				RagdollService:Ragdoll(victim)
				RagdollService:Push(victim, along * ragdollConfig.DeathPush, part, along * ragdollConfig.DeathPartPush)
			end
			return
		end

		local strength = math.clamp(damage / reactions.FullDamage, reactions.MinStrength, 1)
		RagdollService:HitReact(victim, part, position, along, strength)
		RagdollService:Injure(victim, BodyZones.FromHit(victim, part, position), damage * injuryConfig.PerDamage)

		local seconds = knockdowns[weightName]
		if seconds and seconds > 0 then
			RagdollService:Ragdoll(victim, { Seconds = seconds })
		end
	end)
end

function RagdollService:Start()
	-- Players: wait for the avatar to finish loading, because loading swaps body parts and joints.
	local function watchPlayer(player: Player)
		player.CharacterAppearanceLoaded:Connect(register)
		local character = player.Character
		if character and player:HasAppearanceLoaded() then
			register(character)
		end
	end
	Players.PlayerAdded:Connect(watchPlayer)
	for _, player in Players:GetPlayers() do
		watchPlayer(player)
	end

	-- NPCs: anything tagged, now or later.
	for _, tag in RagdollConfig.NpcTags do
		CollectionService:GetInstanceAddedSignal(tag):Connect(function(instance)
			if instance:IsA("Model") then
				register(instance)
			end
		end)
		for _, instance in CollectionService:GetTagged(tag) do
			if instance:IsA("Model") then
				register(instance)
			end
		end
	end

	hookCombat()

	local elapsed = 0
	RunService.Heartbeat:Connect(function(dt)
		elapsed += dt
		if elapsed >= TICK then
			step(elapsed)
			elapsed = 0
		end
	end)
end

return RagdollService
