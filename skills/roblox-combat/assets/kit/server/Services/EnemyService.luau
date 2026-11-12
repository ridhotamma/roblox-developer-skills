--!strict
-- Enemy brains: a small state machine per enemy, all updated from one loop.
--
--   Idle -> Chase -> Telegraph -> Attack -> Recover -> Chase ...
--                 \-> Hover (no attack token free: circle at a distance)
--   any -> Stagger (poise broken) ; any -> Dead
--
-- Enemies are Models with a Humanoid and HumanoidRootPart, tagged "Enemy" (CombatConfig.EnemyTag),
-- with attribute Archetype = a key of CombatConfig.Enemies. Place them in Workspace (they respawn
-- where they stood) or call EnemyService:Spawn(name, cframe) with templates in
-- ServerStorage.Assets.Enemies.
--
-- The current state is published as the "State" attribute so clients can show telegraphs
-- (EnemyVisuals) without extra remotes. Direction is locked when the telegraph starts, so
-- dodging sideways works.

local CollectionService = game:GetService("CollectionService")
local Players = game:GetService("Players")
local ReplicatedStorage = game:GetService("ReplicatedStorage")
local ServerStorage = game:GetService("ServerStorage")

local CombatConfig = require(ReplicatedStorage.Shared.Combat.CombatConfig)
local CombatService = require(script.Parent.CombatService)
local Hitbox = require(ReplicatedStorage.Shared.Combat.Hitbox)
local Signal = require(ReplicatedStorage.Packages.Signal)

type Brain = {
	model: Model,
	humanoid: Humanoid,
	root: BasePart,
	archetypeName: string,
	archetype: any,
	state: string,
	stateSince: number,
	target: Player?,
	tokens: number,
	nextAttack: number,
	poise: number,
	lastHit: number,
	hoverAngle: number,
	home: CFrame,
	template: Model?,
	parent: Instance?,
	lastAttacker: Player?,
}

local POISE_RESET_SECONDS = 3
local HOVER_SLACK = 6 -- studs beyond hover distance before an enemy without a token chases again

local EnemyService = {
	-- Fires (model: Model, archetypeName: string, killer: Player?) when an enemy dies.
	Defeated = Signal.new(),
}

local brains: { [Model]: Brain } = {}
local tokensUsed: { [Player]: number } = {}

local function setState(brain: Brain, state: string)
	brain.state = state
	brain.stateSince = os.clock()
	brain.model:SetAttribute("State", state)
end

local function releaseTokens(brain: Brain)
	local target = brain.target
	if target and brain.tokens > 0 then
		tokensUsed[target] = math.max(0, (tokensUsed[target] or 0) - brain.tokens)
	end
	brain.tokens = 0
end

local function tokensFree(brain: Brain): boolean
	local target = brain.target
	if not target then
		return false
	end
	local used = tokensUsed[target] or 0
	-- A big enemy (cost above the limit) may still attack alone.
	return used == 0 or used + brain.archetype.TokenCost <= CombatConfig.EnemyTokensPerPlayer
end

local function takeTokens(brain: Brain)
	local target = brain.target :: Player
	tokensUsed[target] = (tokensUsed[target] or 0) + brain.archetype.TokenCost
	brain.tokens = brain.archetype.TokenCost
end

local function livingRoot(player: Player?): BasePart?
	local character = player and player.Character
	local humanoid = character and character:FindFirstChildOfClass("Humanoid")
	local root = character and character:FindFirstChild("HumanoidRootPart")
	if humanoid and humanoid.Health > 0 and root and root:IsA("BasePart") then
		return root
	end
	return nil
end

local function flatDistance(a: Vector3, b: Vector3): number
	return Vector3.new(a.X - b.X, 0, a.Z - b.Z).Magnitude
end

local function findTarget(brain: Brain): Player?
	local best, bestDistance = nil, brain.archetype.AggroRange
	for _, player in Players:GetPlayers() do
		local root = livingRoot(player)
		if root then
			local distance = (root.Position - brain.root.Position).Magnitude
			if distance < bestDistance then
				best, bestDistance = player, distance
			end
		end
	end
	return best
end

local function attack(brain: Brain)
	local archetype = brain.archetype
	local cframe, size = Hitbox.InFront(brain.root, archetype.Hitbox)
	for _, model in Hitbox.Query(cframe, size, { brain.model }) do
		if Players:GetPlayerFromCharacter(model) then
			CombatService:Hit(brain.model, model, archetype.Weight, brain.root.CFrame.LookVector, {
				Damage = archetype.Damage,
				Kind = "Enemy",
			})
		end
	end
	brain.nextAttack = os.clock() + archetype.Cooldown
end

local function update(brain: Brain, now: number)
	if brain.state == "Dead" then
		return
	end
	local archetype = brain.archetype
	local elapsed = now - brain.stateSince

	-- Committed states run to completion.
	if brain.state == "Stagger" then
		if elapsed >= archetype.Stagger then
			setState(brain, "Chase")
		end
		return
	elseif brain.state == "Telegraph" then
		if elapsed >= archetype.Telegraph then
			attack(brain)
			setState(brain, "Recover")
		end
		return
	elseif brain.state == "Recover" then
		if elapsed >= archetype.Recover then
			releaseTokens(brain)
			setState(brain, "Chase")
		end
		return
	end

	-- Keep or drop the target (lose range > aggro range, so it doesn't flip-flop).
	local targetRoot = livingRoot(brain.target)
	local lost = not targetRoot or flatDistance(targetRoot.Position, brain.root.Position) > archetype.LoseRange
	if brain.target and lost then
		releaseTokens(brain)
		brain.target = nil
		targetRoot = nil
	end
	if not brain.target then
		brain.target = findTarget(brain)
		targetRoot = livingRoot(brain.target)
	end

	if not targetRoot then
		if brain.state ~= "Idle" then
			setState(brain, "Idle")
			brain.humanoid:MoveTo(brain.home.Position)
		end
		return
	end

	local distance = flatDistance(targetRoot.Position, brain.root.Position)
	local canAttack = tokensFree(brain)

	if distance <= archetype.AttackRange and canAttack and now >= brain.nextAttack then
		takeTokens(brain)
		brain.humanoid:MoveTo(brain.root.Position)
		local look = Vector3.new(targetRoot.Position.X, brain.root.Position.Y, targetRoot.Position.Z)
		brain.root.CFrame = CFrame.lookAt(brain.root.Position, look) -- direction locked from here
		brain.model:SetAttribute("TelegraphTime", archetype.Telegraph)
		setState(brain, "Telegraph")
	elseif not canAttack and distance <= CombatConfig.EnemyHoverDistance + HOVER_SLACK then
		-- Someone else is attacking this player: circle at a distance and wait.
		brain.hoverAngle += 0.6 / CombatConfig.EnemyTickRate
		local offset = Vector3.new(math.cos(brain.hoverAngle), 0, math.sin(brain.hoverAngle))
		brain.humanoid:MoveTo(targetRoot.Position + offset * CombatConfig.EnemyHoverDistance)
		if brain.state ~= "Hover" then
			setState(brain, "Hover")
		end
	elseif distance <= archetype.AttackRange then
		brain.humanoid:MoveTo(brain.root.Position) -- in range, waiting for cooldown
	else
		brain.humanoid:MoveTo(targetRoot.Position)
		if brain.state ~= "Chase" then
			setState(brain, "Chase")
		end
	end
end

local function onDamaged(victim: Model, attacker: Model?, weightName: string)
	local brain = brains[victim]
	if not brain or brain.state == "Dead" then
		return
	end
	local attackerPlayer = if attacker then Players:GetPlayerFromCharacter(attacker) else nil
	if attackerPlayer then
		brain.lastAttacker = attackerPlayer
		if not brain.target then
			brain.target = attackerPlayer -- getting hit makes it aggro
		end
	end

	local now = os.clock()
	if now - brain.lastHit > POISE_RESET_SECONDS then
		brain.poise = 0
	end
	brain.lastHit = now
	brain.poise += CombatConfig.HitWeights[weightName].Poise
	if brain.poise >= brain.archetype.Poise then
		-- Poise broken: interrupt whatever it was doing, including a telegraphed attack.
		brain.poise = 0
		releaseTokens(brain)
		brain.humanoid:MoveTo(brain.root.Position)
		setState(brain, "Stagger")
	end
end

local function onDeath(brain: Brain)
	if brain.state == "Dead" then
		return
	end
	releaseTokens(brain)
	setState(brain, "Dead")
	brains[brain.model] = nil
	EnemyService.Defeated:Fire(brain.model, brain.archetypeName, brain.lastAttacker)

	local model = brain.model
	task.delay(3, function()
		model:Destroy()
	end)

	local template = brain.template
	local respawn = brain.archetype.RespawnSeconds
	if template and respawn and respawn > 0 then
		task.delay(respawn, function()
			local clone = template:Clone()
			clone:PivotTo(brain.home)
			clone.Parent = brain.parent or workspace
		end)
	end
end

local function bind(model: Instance)
	if not model:IsA("Model") or brains[model] or not model:IsDescendantOf(workspace) then
		return
	end
	local humanoid = model:FindFirstChildOfClass("Humanoid")
	local root = model:FindFirstChild("HumanoidRootPart")
	if not humanoid or not root or not root:IsA("BasePart") then
		warn(`[EnemyService] {model:GetFullName()} needs a Humanoid and a HumanoidRootPart`)
		return
	end
	local archetypeName = model:GetAttribute("Archetype")
	if typeof(archetypeName) ~= "string" or not CombatConfig.Enemies[archetypeName] then
		warn(`[EnemyService] {model:GetFullName()} has unknown Archetype {archetypeName}; using Grunt`)
		archetypeName = "Grunt"
	end
	local archetype = (CombatConfig.Enemies :: any)[archetypeName]

	-- Keep a pristine copy for respawning placed enemies (spawned ones set Respawn = false).
	local template = if model:GetAttribute("Respawn") ~= false then model:Clone() else nil

	humanoid.MaxHealth = archetype.Health
	humanoid.Health = archetype.Health
	humanoid.WalkSpeed = archetype.WalkSpeed
	pcall(function()
		root:SetNetworkOwner(nil) -- the server simulates enemies
	end)

	local brain: Brain = {
		model = model,
		humanoid = humanoid,
		root = root,
		archetypeName = archetypeName :: string,
		archetype = archetype,
		state = "Idle",
		stateSince = os.clock(),
		target = nil,
		tokens = 0,
		nextAttack = 0,
		poise = 0,
		lastHit = 0,
		hoverAngle = math.random() * 2 * math.pi,
		home = model:GetPivot(),
		template = template,
		parent = model.Parent,
		lastAttacker = nil,
	}
	brains[model] = brain
	setState(brain, "Idle")
	humanoid.Died:Connect(function()
		onDeath(brain)
	end)
end

local function unbind(model: Instance)
	local brain = brains[model :: Model]
	if brain then
		releaseTokens(brain)
		brains[model :: Model] = nil
	end
end

-- Spawns an enemy from ServerStorage.Assets.Enemies[archetypeName]. Spawned enemies don't respawn.
function EnemyService:Spawn(archetypeName: string, cframe: CFrame, parent: Instance?): Model?
	local assets = ServerStorage:FindFirstChild("Assets")
	local folder = assets and assets:FindFirstChild("Enemies")
	local template = folder and folder:FindFirstChild(archetypeName)
	if not template or not template:IsA("Model") then
		warn(`[EnemyService] no template ServerStorage.Assets.Enemies.{archetypeName}`)
		return nil
	end
	local model = template:Clone()
	model:SetAttribute("Archetype", archetypeName)
	model:SetAttribute("Respawn", false)
	model:PivotTo(cframe)
	CollectionService:AddTag(model, CombatConfig.EnemyTag)
	model.Parent = parent or workspace
	return model
end

function EnemyService:Start()
	CombatService.Damaged:Connect(onDamaged)

	local tag = CombatConfig.EnemyTag
	CollectionService:GetInstanceAddedSignal(tag):Connect(bind)
	CollectionService:GetInstanceRemovedSignal(tag):Connect(unbind)
	for _, model in CollectionService:GetTagged(tag) do
		bind(model)
	end
	Players.PlayerRemoving:Connect(function(player)
		tokensUsed[player] = nil
		for _, brain in brains do
			if brain.target == player then
				brain.tokens = 0
				brain.target = nil
			end
		end
	end)

	local interval = 1 / CombatConfig.EnemyTickRate
	while true do
		task.wait(interval)
		local now = os.clock()
		for model, brain in brains do
			if not model.Parent then
				unbind(model)
				continue
			end
			local ok, err = pcall(update, brain, now)
			if not ok then
				warn(`[EnemyService] {model:GetFullName()}: {err}`)
			end
		end
	end
end

return EnemyService
