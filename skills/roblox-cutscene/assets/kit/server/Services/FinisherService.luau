--!strict
-- Finishers (executions, takedowns, glory kills) and enemy grabs.
--
--   Openings   sets the Posture attribute that finisher moves require, RE4-style:
--              head hit -> "Stagger", leg hit -> "Kneel", low health -> "Stagger" (Doom), and
--              the combat kit's own stagger state. Each opening lasts a few seconds.
--   Requests   a client asks "finish this one" (FinisherRequest); the server re-checks range,
--              side (with a little latency tolerance), posture, health, awareness, kind and
--              free space, picks the move with the same rules the prompt used (Finisher.Choose),
--              and plays it through CutsceneService with both bodies aligned to the move's marks.
--   Grabs      FinisherService:Grab(enemy, player) plays an enemy-initiated move (struggle QTEs).
--   Lethal     a Lethal move kills at its Kill event, or at the end if it has none.
--
-- Moves are scenes in ReplicatedStorage.Shared.Cutscene.Finishers with a Finisher block.

local CollectionService = game:GetService("CollectionService")
local Players = game:GetService("Players")
local ReplicatedStorage = game:GetService("ReplicatedStorage")

local CutsceneConfig = require(ReplicatedStorage.Shared.Cutscene.CutsceneConfig)
local CutsceneService = require(script.Parent.CutsceneService)
local Finisher = require(ReplicatedStorage.Shared.Cutscene.Finisher)
local Net = require(ReplicatedStorage.Shared.Net)
local Signal = require(ReplicatedStorage.Packages.Signal)
local Timeline = require(ReplicatedStorage.Shared.Cutscene.Timeline)

local config = CutsceneConfig.Finisher

local FinisherService = {
	-- (attacker: Model, victim: Model, moveName: string, killed: boolean)
	Performed = Signal.new(),
	-- (model: Model, posture: string?) whenever an opening starts or ends
	PostureChanged = Signal.new(),
}

local moves: { [string]: any } = {} -- prompt finishers
local grabs: { [string]: any } = {} -- enemy-initiated
local cooldownUntil: { [Model]: number } = {}
local lastMove: { [Player]: string } = {}
local postureToken: { [Model]: number } = {}
local postureTracks: { [Model]: AnimationTrack } = {}

local function rootOf(model: Model?): BasePart?
	local root = model and (model:FindFirstChild("HumanoidRootPart") or model.PrimaryPart)
	return if root and root:IsA("BasePart") then root else nil
end

local function humanoidOf(model: Model?): Humanoid?
	return if model then model:FindFirstChildOfClass("Humanoid") else nil
end

local function alive(model: Model?): boolean
	local humanoid = humanoidOf(model)
	return humanoid ~= nil and humanoid.Health > 0 and rootOf(model) ~= nil
end

local function groundOffset(model: Model): number
	local humanoid = humanoidOf(model)
	local root = rootOf(model)
	if humanoid and root then
		return if humanoid.RigType == Enum.HumanoidRigType.R6 then root.Size.Y / 2 + 2 else humanoid.HipHeight + root.Size.Y / 2
	end
	return 0
end

local function finishable(model: Instance): boolean
	if not model:IsA("Model") then
		return false
	end
	for _, tag in config.Tags do
		if CollectionService:HasTag(model, tag) then
			return true
		end
	end
	return false
end

---------------------------------------------------------------------------------------------
-- Openings (postures)

function FinisherService:SetPosture(model: Model, posture: string?, seconds: number?)
	if not alive(model) or model:GetAttribute("InCutscene") then
		return
	end
	postureToken[model] = (postureToken[model] or 0) + 1
	local token = postureToken[model]
	model:SetAttribute("Posture", posture)
	local old = postureTracks[model]
	if old then
		old:Stop(0.2)
		postureTracks[model] = nil
	end
	local id = posture and config.PostureAnimations[posture]
	local humanoid = humanoidOf(model)
	if id and id ~= "" and humanoid and not Players:GetPlayerFromCharacter(model) then
		local animator = humanoid:FindFirstChildOfClass("Animator")
		if animator then
			local animation = Instance.new("Animation")
			animation.AnimationId = id
			local track = animator:LoadAnimation(animation)
			track.Priority = Enum.AnimationPriority.Action2
			track:Play(0.15)
			postureTracks[model] = track
		end
	end
	FinisherService.PostureChanged:Fire(model, posture)
	if posture and seconds then
		task.delay(seconds, function()
			if postureToken[model] == token and model.Parent then
				FinisherService:SetPosture(model, nil)
			end
		end)
	end
end

local function partIn(part: BasePart?, names: { string }): boolean
	return part ~= nil and table.find(names, part.Name) ~= nil
end

local function onDamaged(victim: Model, _attacker: Model?, _weight: string, _damage: number, killed: boolean, info: any)
	if killed or not finishable(victim) or victim:GetAttribute("InCutscene") then
		return
	end
	local part = info and info.Part
	if config.HeadshotStagger and ((info and info.Headshot) or partIn(part, config.HeadParts)) then
		FinisherService:SetPosture(victim, "Stagger", config.StaggerSeconds)
	elseif config.LegHitKneel and partIn(part, config.LegParts) then
		FinisherService:SetPosture(victim, "Kneel", config.KneelSeconds)
	end
end

local function watch(model: Instance)
	if not model:IsA("Model") then
		return
	end
	local humanoid = humanoidOf(model)
	if not humanoid then
		return
	end
	local opened = false
	humanoid.HealthChanged:Connect(function(health: number)
		if config.LowHealth and not opened and health > 0 and health <= humanoid.MaxHealth * config.LowHealth then
			opened = true -- once per life, or every hit would refresh it forever
			FinisherService:SetPosture(model, "Stagger", config.LowHealthSeconds)
		end
	end)
	-- The combat kit's EnemyService marks its own stagger in the State attribute.
	model:GetAttributeChangedSignal("State"):Connect(function()
		if model:GetAttribute("State") == "Stagger" and model:GetAttribute("Posture") == nil then
			FinisherService:SetPosture(model, "Stagger", config.StaggerSeconds)
		end
	end)
end

---------------------------------------------------------------------------------------------
-- Playing a move

local function clear(move: any, attackerAt: CFrame, ignore: { Instance }): boolean
	local radius = move.Finisher.Clearance or 2.5
	local params = OverlapParams.new()
	params.FilterType = Enum.RaycastFilterType.Exclude
	params.FilterDescendantsInstances = ignore
	params.RespectCanCollide = true
	local center = attackerAt.Position + Vector3.new(0, 3, 0)
	local hits = workspace:GetPartBoundsInBox(CFrame.new(center), Vector3.new(radius * 2, 4, radius * 2), params)
	for _, part in hits do
		-- Walls and props block the move; other characters don't (they get shoved by the scene).
		local model = part:FindFirstAncestorOfClass("Model")
		local isCharacter = model ~= nil and humanoidOf(model) ~= nil
		if part.CanCollide and not isCharacter then
			return false
		end
	end
	return true
end

local function perform(move: any, attacker: Model, victim: Model, attackerPlayer: Player?): boolean
	local spec = move.Finisher
	local victimRoot = rootOf(victim)
	if not victimRoot then
		return false
	end
	local victimGround = Finisher.Ground(victimRoot.CFrame, groundOffset(victim))
	local origin, attackerAt = Finisher.Align(move, victimGround)
	if not clear(move, attackerAt, { attacker, victim }) then
		return false
	end
	local attackerName = spec.Attacker or "Attacker"
	local victimName = spec.Victim or "Victim"
	FinisherService:SetPosture(victim, nil)
	local play = CutsceneService:Play(move, {
		Origin = origin,
		Actors = { [attackerName] = attacker, [victimName] = victim },
		Folder = CutsceneConfig.FinishersFolder,
		CameraFor = { attackerName, victimName },
		Observers = true,
		Skippable = false,
		Invulnerable = config.AttackerInvulnerable or config.VictimInvulnerable,
	})
	if not play then
		return false
	end
	if attackerPlayer then
		lastMove[attackerPlayer] = move.Name
	end
	local connection
	connection = CutsceneService.Ended:Connect(function(ended: any)
		if ended ~= play then
			return
		end
		connection:Disconnect()
		local humanoid = humanoidOf(victim)
		if spec.Lethal and humanoid and humanoid.Health > 0 then
			victim:SetAttribute("FinisherKilled", true)
			humanoid.Health = 0
		end
		cooldownUntil[attacker] = os.clock() + config.Cooldown
		FinisherService.Performed:Fire(attacker, victim, move.Name, humanoid ~= nil and humanoid.Health <= 0)
	end)
	return true
end

local function contextFor(attackerRoot: BasePart, victim: Model, last: string?): (Finisher.Context, { [string]: boolean })
	local victimRoot = rootOf(victim) :: BasePart
	local humanoid = humanoidOf(victim) :: Humanoid
	local victimGround = Finisher.Ground(victimRoot.CFrame, groundOffset(victim))
	local state = victim:GetAttribute("State")
	local posture = victim:GetAttribute("Posture")
	local kind = victim:GetAttribute("Archetype") or victim:GetAttribute("Kind")
	local ctx: Finisher.Context = {
		Side = Finisher.Side(attackerRoot.Position, victimGround),
		Posture = if type(posture) == "string" then posture else nil,
		HealthFraction = humanoid.Health / math.max(1, humanoid.MaxHealth),
		Distance = math.max(0, (attackerRoot.Position - victimRoot.Position).Magnitude - config.RangeSlack),
		Height = attackerRoot.Position.Y - victimRoot.Position.Y,
		Unaware = state == nil or (type(state) == "string" and table.find(config.UnawareStates, state) ~= nil),
		Kind = if type(kind) == "string" then kind else nil,
		Last = last,
	}
	return ctx, Finisher.SidesNear(attackerRoot.Position, victimGround, config.SideTolerance)
end

local function onRequest(player: Player, victim: unknown)
	if typeof(victim) ~= "Instance" or not (victim :: Instance):IsA("Model") then
		return
	end
	local target = victim :: Model
	local attacker = player.Character
	if not attacker or not alive(attacker) or not alive(target) or not finishable(target) then
		return
	end
	if attacker:GetAttribute("InCutscene") or target:GetAttribute("InCutscene") then
		return
	end
	if (cooldownUntil[attacker] or 0) > os.clock() then
		return
	end
	local ctx, sides = contextFor(rootOf(attacker) :: BasePart, target, lastMove[player])
	local move = Finisher.Choose(moves, ctx, math.random(), sides)
	if move then
		perform(move, attacker, target, player)
	end
end

---------------------------------------------------------------------------------------------
-- Public

-- Moves the client can be prompted for (for UI previews, debugging).
function FinisherService:Moves(): { [string]: any }
	return moves
end

-- What `attacker` could do to `victim` right now, or nil (server-side check, no side effects).
function FinisherService:Available(attacker: Model, victim: Model): any?
	local root = rootOf(attacker)
	if not root or not alive(victim) then
		return nil
	end
	local ctx, sides = contextFor(root, victim, nil)
	return Finisher.Choose(moves, ctx, nil, sides)
end

-- Enemy-initiated grab (QTE struggle). `moveName` defaults to the only/first grab move.
function FinisherService:Grab(enemy: Model, player: Player, moveName: string?): boolean
	local character = player.Character
	if not character or not alive(character) or not alive(enemy) then
		return false
	end
	if character:GetAttribute("InCutscene") or enemy:GetAttribute("InCutscene") then
		return false
	end
	local move = if moveName then grabs[moveName] else select(2, next(grabs))
	if not move then
		warn("[Finisher] no grab move")
		return false
	end
	-- For a grab the player is the scene's Victim (aligned to where they stand).
	return perform(move, enemy, character, nil)
end

function FinisherService:Init()
	Net.Event("FinisherRequest")
end

function FinisherService:Start()
	local folder = ReplicatedStorage.Shared.Cutscene:WaitForChild(CutsceneConfig.FinishersFolder)
	for _, module in folder:GetChildren() do
		if module:IsA("ModuleScript") then
			local move = (require :: any)(module)
			local _, errors = Timeline.Compile(move)
			if #errors > 0 then
				warn(`[Finisher] {module.Name}: {table.concat(errors, "; ")}`)
			elseif move.Finisher and move.Finisher.Grab then
				grabs[move.Name] = move
			elseif move.Finisher then
				moves[move.Name] = move
			end
		end
	end

	Net.Handle("FinisherRequest", 4, onRequest)

	for _, tag in config.Tags do
		for _, model in CollectionService:GetTagged(tag) do
			watch(model)
		end
		CollectionService:GetInstanceAddedSignal(tag):Connect(watch)
	end

	local combat = script.Parent:FindFirstChild("CombatService")
	if combat then
		local CombatService = (require :: any)(combat)
		CombatService.Damaged:Connect(onDamaged)
	end

	Players.PlayerRemoving:Connect(function(player)
		lastMove[player] = nil
	end)
end

return FinisherService
