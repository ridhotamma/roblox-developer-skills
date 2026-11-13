--!strict
-- The one place damage happens. Melee, guns and enemies all call CombatService:Hit, which
-- checks who may hit whom and i-frames, applies damage, sends knockback to whoever owns the
-- victim's physics (after the hitstop), and broadcasts the hit so every client plays feedback.
--
-- Also handles the melee "Swing" request: the client only says "I swung"; the server tracks the
-- combo step on its own clock and runs its own hitbox in front of the character.

local CollectionService = game:GetService("CollectionService")
local Players = game:GetService("Players")
local ReplicatedStorage = game:GetService("ReplicatedStorage")

local CombatConfig = require(ReplicatedStorage.Shared.Combat.CombatConfig)
local Hitbox = require(ReplicatedStorage.Shared.Combat.Hitbox)
local Knockback = require(ReplicatedStorage.Shared.Combat.Knockback)
local Net = require(ReplicatedStorage.Shared.Net)
local Signal = require(ReplicatedStorage.Packages.Signal)

-- Optional: roblox-security's AntiCheatService, so knockback isn't flagged as speed hacking.
local antiCheatModule = script.Parent:FindFirstChild("AntiCheatService")
local AntiCheat: any = if antiCheatModule then (require :: any)(antiCheatModule) else nil

export type HitOptions = {
	Damage: number?, -- overrides the weight's damage
	Headshot: boolean?,
	Kind: string?, -- "Melee" | "Gun" | "Enemy" ...
	Position: Vector3?, -- where the hit landed (defaults to the victim's root)
	Part: BasePart?, -- the body part that was hit, when known (guns); drives hit reactions by zone
}

local CombatService = {
	-- Fires (victim: Model, attacker: Model?, weightName: string, damage: number, killed: boolean,
	--        info: { Position: Vector3, Direction: Vector3, Part: BasePart?, Headshot: boolean, Kind: string })
	-- `info` is what the roblox-ragdoll kit uses for flinches, limb injuries and death pushes.
	Damaged = Signal.new(),
}

local hitEvent: RemoteEvent
local knockbackEvent: RemoteEvent
local iframesUntil: { [Model]: number } = {}
local swingState: { [Player]: { last: number, step: number } } = {}

local function rootOf(model: Model?): BasePart?
	local root = model and model:FindFirstChild("HumanoidRootPart")
	return if root and root:IsA("BasePart") then root else nil
end

local function isEnemy(model: Model): boolean
	return CollectionService:HasTag(model, CombatConfig.EnemyTag)
end

-- Players hit enemies (and players if PvP); enemies hit players; nothing else.
local function canHit(attacker: Model?, victim: Model): boolean
	if attacker == victim then
		return false
	end
	local attackerIsPlayer = attacker ~= nil and Players:GetPlayerFromCharacter(attacker) ~= nil
	local victimIsPlayer = Players:GetPlayerFromCharacter(victim) ~= nil
	if attackerIsPlayer then
		return isEnemy(victim) or (victimIsPlayer and CombatConfig.PvP)
	end
	return victimIsPlayer
end

function CombatService:Init()
	hitEvent = Net.Event("CombatHit")
	knockbackEvent = Net.Event("Knockback")
end

-- Returns true if the hit was applied.
function CombatService:Hit(
	attacker: Model?,
	victim: Model,
	weightName: string,
	direction: Vector3,
	options: HitOptions?
): boolean
	local weight = CombatConfig.HitWeights[weightName]
	local humanoid = victim:FindFirstChildOfClass("Humanoid")
	local root = rootOf(victim)
	if not weight or not humanoid or humanoid.Health <= 0 or not root then
		return false
	end
	if not canHit(attacker, victim) then
		return false
	end

	local now = os.clock()
	if (iframesUntil[victim] or 0) > now then
		return false
	end

	local opts: HitOptions = options or {}
	local damage = opts.Damage or weight.Damage
	local victimPlayer = Players:GetPlayerFromCharacter(victim)
	local iframes = if victimPlayer then CombatConfig.PlayerIFrames else 0
	if iframes > 0 then
		iframesUntil[victim] = now + iframes
	end

	humanoid:TakeDamage(damage)
	local killed = humanoid.Health <= 0

	-- Freeze first (clients play the hitstop), then fly.
	if weight.Knockback > 0 or weight.KnockUp > 0 then
		local attackerRoot = rootOf(attacker)
		local from = if attackerRoot then attackerRoot.Position else root.Position - direction
		local push = Knockback.Direction(from, root.Position, direction) * weight.Knockback
			+ Vector3.new(0, weight.KnockUp, 0)
		task.delay(weight.Hitstop, function()
			if not victim.Parent then
				return
			end
			if victimPlayer then
				if AntiCheat then
					AntiCheat:Grant(victimPlayer, weight.KnockTime + 0.5)
				end
				knockbackEvent:FireClient(victimPlayer, push, weight.KnockTime)
			else
				Knockback.Push(root, push, weight.KnockTime)
			end
		end)
	end

	CombatService.Damaged:Fire(victim, attacker, weightName, damage, killed, {
		Position = opts.Position or root.Position,
		Direction = direction,
		Part = opts.Part,
		Headshot = opts.Headshot == true,
		Kind = opts.Kind or "Melee",
	})
	hitEvent:FireAllClients({
		Attacker = attacker,
		Victim = victim,
		Weight = weightName,
		Damage = damage,
		Position = opts.Position or root.Position,
		IFrames = iframes,
		Headshot = opts.Headshot == true,
		Killed = killed,
		Kind = opts.Kind or "Melee",
	})
	return true
end

function CombatService:Start()
	local melee = CombatConfig.Melee

	-- Rate limit a bit above the cooldown; the cooldown below is the real gate.
	Net.Handle("Swing", 1 / melee.Cooldown + 2, function(player)
		local character = player.Character
		local root = rootOf(character)
		local humanoid = character and character:FindFirstChildOfClass("Humanoid")
		if not (character and root and humanoid and humanoid.Health > 0) then
			return
		end

		local now = os.clock()
		local state = swingState[player]
		if not state then
			state = { last = -math.huge, step = 0 }
			swingState[player] = state
		end
		if now - state.last < melee.Cooldown * 0.8 then -- 20% slack for network jitter
			return
		end
		state.step = if now - state.last <= melee.ComboResetSeconds then state.step % #melee.Combo + 1 else 1
		state.last = now

		local weightName = melee.Combo[state.step]
		local cframe, size = Hitbox.InFront(root, melee.Hitbox, melee.LatencyPadding)
		for _, target in Hitbox.Query(cframe, size, { character }) do
			CombatService:Hit(character, target, weightName, root.CFrame.LookVector, { Kind = "Melee" })
		end
	end)

	Players.PlayerRemoving:Connect(function(player)
		swingState[player] = nil
		if player.Character then
			iframesUntil[player.Character] = nil
		end
	end)

	-- Forget i-frames of models that are gone.
	while true do
		task.wait(10)
		local now = os.clock()
		for model, untilTime in iframesUntil do
			if untilTime < now or not model.Parent then
				iframesUntil[model] = nil
			end
		end
	end
end

return CombatService
