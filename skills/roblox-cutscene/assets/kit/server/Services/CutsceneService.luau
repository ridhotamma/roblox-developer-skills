--!strict
-- Runs scenes on the server: the one clock everybody follows.
--
--   * Starts a scene for some players (camera) and optionally everyone else (observers):
--     sends the scene name, origin, bound actors and a start time on the shared clock
--     (workspace:GetServerTimeNow() + Lead), so every client plays the same frame together.
--   * Freezes the real actors (anchored, invulnerable, InCutscene attribute) while clients play
--     local stand-ins, and parks them where the scene will leave them, so nothing pops at the end.
--   * Runs the same Timeline as the clients on Heartbeat: fires server events (damage, kills,
--     heals, your own game events), starts QTEs early enough for the prompt to be up on time,
--     branches on their results (Goto a label, continue, end) and re-syncs every client.
--   * Skips by vote (CutsceneConfig.Skip.Rule), still applying Essential events.
--   * Ends cleanly: actors placed, unfrozen, ragdolled if they finished lying down, killed
--     victims' stand-ins kept as corpses, Ended signal.
--
-- Scenes: ModuleScripts in ReplicatedStorage.Shared.Cutscene.Scenes (finishers in .Finishers).
-- Triggers: parts tagged CutsceneTrigger with attribute Scene = "Name" (see CutsceneConfig).

local CollectionService = game:GetService("CollectionService")
local HttpService = game:GetService("HttpService")
local Players = game:GetService("Players")
local ReplicatedStorage = game:GetService("ReplicatedStorage")
local RunService = game:GetService("RunService")

local CutsceneConfig = require(ReplicatedStorage.Shared.Cutscene.CutsceneConfig)
local Net = require(ReplicatedStorage.Shared.Net)
local QteService = require(script.Parent.QteService)
local Signal = require(ReplicatedStorage.Packages.Signal)
local Timeline = require(ReplicatedStorage.Shared.Cutscene.Timeline)

-- Optional kits, found by name next to this service.
local function optional(name: string): any
	local module = script.Parent:FindFirstChild(name)
	return if module then (require :: any)(module) else nil
end

export type PlayOptions = {
	Origin: CFrame,
	Actors: { [string]: Model }?, -- real models bound to the scene's actors
	Players: { Player }?, -- who gets the camera (default: players bound to actors, else everyone)
	CameraFor: { string }?, -- or: the players bound to these actors get the camera
	Observers: boolean?, -- everyone else also sees the stand-ins (finishers)
	Folder: string?, -- "Scenes" (default) or "Finishers"
	Skippable: boolean?,
	Invulnerable: boolean?, -- default true: bound actors take no damage except the scene's own
	Lead: number?,
	OnEvent: ((play: Play, item: any) -> ())?,
}

export type Play = {
	Id: string,
	Name: string,
	Def: any,
	Compiled: Timeline.Compiled,
	Folder: string,
	Origin: CFrame,
	Actors: { [string]: Model },
	ActorPlayers: { [string]: Player },
	Watchers: { [Player]: boolean }, -- camera
	Recipients: { [Player]: boolean }, -- camera + observers
	AnchorScene: number,
	AnchorServer: number,
	LastT: number,
	Votes: { [Player]: boolean },
	Skippable: boolean,
	QteStarted: { [any]: boolean },
	QteOpen: { [any]: { string } },
	QteResolved: { [any]: boolean },
	Frozen: { [Model]: { Anchored: boolean, ForceField: ForceField? } },
	Options: PlayOptions,
	Ended: boolean,
	EndAt: number?,
}

local CutsceneService = {
	Started = Signal.new(), -- (play: Play)
	Event = Signal.new(), -- (play: Play, item: table) every event the scene fires, on the server
	Ended = Signal.new(), -- (play: Play, skipped: boolean)
}

local active: { [string]: Play } = {}
local compiledCache: { [any]: Timeline.Compiled } = {}
local playEvent: RemoteEvent
local seekEvent: RemoteEvent
local endEvent: RemoteEvent
local votesEvent: RemoteEvent

local RagdollService: any = nil
local CombatService: any = nil

---------------------------------------------------------------------------------------------
-- Helpers

local function rootOf(model: Model): BasePart?
	local root = model:FindFirstChild("HumanoidRootPart") or model.PrimaryPart
	return if root and root:IsA("BasePart") then root else nil
end

local function humanoidOf(model: Model?): Humanoid?
	return if model then model:FindFirstChildOfClass("Humanoid") else nil
end

local function groundOffset(model: Model): number
	local humanoid = humanoidOf(model)
	local root = rootOf(model)
	if humanoid and root then
		if humanoid.RigType == Enum.HumanoidRigType.R6 then
			return root.Size.Y / 2 + 2
		end
		return humanoid.HipHeight + root.Size.Y / 2
	end
	return 0
end

function CutsceneService:Find(name: string, folder: string?): any?
	local root = ReplicatedStorage.Shared.Cutscene:FindFirstChild(folder or CutsceneConfig.ScenesFolder)
	local module = root and root:FindFirstChild(name)
	if module and module:IsA("ModuleScript") then
		return (require :: any)(module)
	end
	return nil
end

function CutsceneService:Compile(def: any): (Timeline.Compiled?, { string })
	local cached = compiledCache[def]
	if cached then
		return cached, {}
	end
	local compiled, errors = Timeline.Compile(def)
	if #errors > 0 then
		return nil, errors
	end
	compiledCache[def] = compiled
	return compiled, errors
end

-- Server time at which the scene reaches scene time t (if it plays on without branching).
local function serverTimeOf(play: Play, t: number): number
	local c = play.Compiled
	return play.AnchorServer + (Timeline.WallTime(c, t) - Timeline.WallTime(c, play.AnchorScene))
end

local function pendingQtes(play: Play): { any }
	local out = {}
	for _, item in play.Compiled.Qtes do
		if item.At >= play.AnchorScene - 1e-6 and not play.QteResolved[item] then
			table.insert(out, item)
		end
	end
	return out
end

local function sceneTimeNow(play: Play, now: number): number
	local c = play.Compiled
	local wall = Timeline.WallTime(c, play.AnchorScene) + (now - play.AnchorServer)
	local t = Timeline.SceneTime(c, wall)
	-- Hold at the end of a QTE window until the result is in.
	for _, item in pendingQtes(play) do
		local close = Timeline.QteEnd(item)
		if item.At <= t and t > close then
			t = close
		end
	end
	return t
end

local function sendTo(play: Play, event: RemoteEvent, ...: any)
	for player in play.Recipients do
		if player.Parent then
			event:FireClient(player, ...)
		end
	end
end

local function payloadFor(play: Play, player: Player): any
	return {
		Id = play.Id,
		Scene = play.Name,
		Folder = play.Folder,
		Origin = play.Origin,
		Actors = play.Actors,
		SceneTime = play.AnchorScene,
		ServerTime = play.AnchorServer,
		Camera = play.Watchers[player] == true,
		Skippable = play.Skippable,
	}
end

---------------------------------------------------------------------------------------------
-- Actors

local function freeze(play: Play, model: Model)
	local root = rootOf(model)
	if not root or play.Frozen[model] then
		return
	end
	local record = { Anchored = root.Anchored, ForceField = nil :: ForceField? }
	root.Anchored = true
	if play.Options.Invulnerable ~= false then
		local field = Instance.new("ForceField")
		field.Visible = false
		field.Name = "CutsceneForceField"
		field.Parent = model
		record.ForceField = field
	end
	model:SetAttribute("InCutscene", play.Id)
	play.Frozen[model] = record
end

local function unfreeze(play: Play, model: Model)
	local record = play.Frozen[model]
	if not record then
		return
	end
	play.Frozen[model] = nil
	if record.ForceField then
		record.ForceField:Destroy()
	end
	local root = rootOf(model)
	if root then
		root.Anchored = record.Anchored
	end
	if model:GetAttribute("InCutscene") == play.Id then
		model:SetAttribute("InCutscene", nil)
	end
end

-- Puts the (hidden) real actors where the scene leaves them, standing upright. Returns the
-- names of actors that end lying down.
local function placeAtEnd(play: Play, t: number): { [string]: boolean }
	local lying = {}
	for name, model in play.Actors do
		local root = rootOf(model)
		local humanoid = humanoidOf(model)
		if root and model.Parent and (not humanoid or humanoid.Health > 0) then
			local pose = Timeline.ActorPose(play.Compiled, name, t)
			if math.abs(pose.Pitch) > 45 or math.abs(pose.Roll) > 45 then
				lying[name] = true
			end
			local upright = play.Origin
				* CFrame.new(pose.Position)
				* CFrame.Angles(0, math.rad(pose.Yaw), 0)
			root.CFrame = upright * CFrame.new(0, groundOffset(model), 0)
			root.AssemblyLinearVelocity = Vector3.zero
		end
	end
	return lying
end

---------------------------------------------------------------------------------------------
-- Built-in server events

local function actorModel(play: Play, name: any): Model?
	return if type(name) == "string" then play.Actors[name] else nil
end

local function damage(model: Model, amount: number)
	local humanoid = humanoidOf(model)
	if humanoid and humanoid.Health > 0 then
		-- Health directly: the scene's own damage ignores the scene's ForceField.
		humanoid.Health = math.max(0, humanoid.Health - amount)
	end
end

local function builtin(play: Play, item: any)
	local target = actorModel(play, item.Target)
	if item.Name == "Hit" and target and type(item.Damage) == "number" then
		damage(target, item.Damage)
		if item.Damage > 0 and humanoidOf(target) and (humanoidOf(target) :: Humanoid).Health <= 0 then
			target:SetAttribute("FinisherKilled", true)
		end
		local splash = item.Splash
		local root = rootOf(target)
		if splash and root then
			local attacker = nil
			for name, model in play.Actors do
				if name ~= item.Target then
					attacker = model
				end
			end
			for _, tag in CutsceneConfig.Finisher.Tags do
				for _, other in CollectionService:GetTagged(tag) do
					if other:IsA("Model") and other ~= target and not other:GetAttribute("InCutscene") then
						local otherRoot = rootOf(other)
						if otherRoot and (otherRoot.Position - root.Position).Magnitude <= (splash.Radius or 6) then
							local direction = (otherRoot.Position - root.Position) * Vector3.new(1, 0, 1)
							direction = if direction.Magnitude > 1e-3 then direction.Unit else Vector3.zAxis
							if CombatService then
								CombatService:Hit(attacker, other, "Heavy", direction, { Damage = splash.Damage or 0, Kind = "Finisher" })
							else
								damage(other, splash.Damage or 0)
								if otherRoot:GetNetworkOwner() == nil then
									otherRoot.AssemblyLinearVelocity = direction * (splash.Knockback or 40) + Vector3.new(0, 20, 0)
								end
							end
						end
					end
				end
			end
		end
	elseif item.Name == "Kill" and target then
		local humanoid = humanoidOf(target)
		if humanoid and humanoid.Health > 0 then
			target:SetAttribute("FinisherKilled", true)
			humanoid.Health = 0
		end
	elseif item.Name == "Heal" and target then
		local humanoid = humanoidOf(target)
		if humanoid and humanoid.Health > 0 then
			humanoid.Health = math.min(humanoid.MaxHealth, humanoid.Health + (item.Amount or 10))
		end
	end
end

---------------------------------------------------------------------------------------------
-- Branching and ending

local rebase: (play: Play, sceneTime: number) -> ()
local finish: (play: Play, skipped: boolean) -> ()

rebase = function(play: Play, sceneTime: number)
	play.AnchorScene = sceneTime
	play.AnchorServer = workspace:GetServerTimeNow() + 0.1
	play.LastT = sceneTime - 1e-6
	-- QTEs at or after the target are live again (a retry loops back before them).
	for item in play.QteResolved do
		if item.At >= sceneTime - 1e-6 then
			play.QteResolved[item] = nil
			play.QteStarted[item] = nil
		end
	end
	placeAtEnd(play, Timeline.EndFrom(play.Compiled, sceneTime))
	sendTo(play, seekEvent, play.Id, sceneTime, play.AnchorServer)
end

local function resolveQte(play: Play, item: any, success: boolean)
	if play.Ended or play.QteResolved[item] then
		return
	end
	play.QteResolved[item] = true
	for _, id in play.QteOpen[item] or {} do
		QteService:Cancel(id)
	end
	play.QteOpen[item] = nil
	local branch = if success then item.OnSuccess else item.OnFail
	if type(branch) == "table" and branch.Goto ~= nil then
		local at = Timeline.Label(play.Compiled, branch.Goto)
		if at then
			rebase(play, at)
			return
		end
	elseif branch == "End" or (type(branch) == "table" and branch.Final and not success) then
		finish(play, false)
		return
	end
	-- Continue: everyone jumps to the window's end together, so a success pays off at once.
	rebase(play, Timeline.QteEnd(item))
end

local function startQte(play: Play, item: any)
	play.QteStarted[item] = true
	local responders: { Player } = {}
	local bound = item.Player and play.ActorPlayers[item.Player]
	if bound then
		table.insert(responders, bound)
	else
		for player in play.Watchers do
			table.insert(responders, player)
		end
	end
	if #responders == 0 then
		resolveQte(play, item, true)
		return
	end
	local rule = item.Rule or "Any"
	local results = { Success = 0, Fail = 0 }
	local anchor = bound and play.Actors[item.Player] and rootOf(play.Actors[item.Player])
	play.QteOpen[item] = {}
	for _, player in responders do
		local id = QteService:Begin(player, item.Qte, {
			Start = serverTimeOf(play, item.At),
			Id = `{play.Id}/{item.Id}`,
			Anchor = anchor,
			OnResult = function(status: string)
				results[status] = (results[status] or 0) + 1
				local done = results.Success + results.Fail
				if rule == "Any" and results.Success > 0 then
					resolveQte(play, item, true)
				elseif rule == "All" and results.Fail > 0 then
					resolveQte(play, item, false)
				elseif done >= #responders then
					local success = if rule == "Majority" then results.Success * 2 > #responders else rule == "All"
					resolveQte(play, item, success)
				end
			end,
		})
		table.insert(play.QteOpen[item], id)
	end
end

finish = function(play: Play, skipped: boolean)
	if play.Ended then
		return
	end
	play.Ended = true
	active[play.Id] = nil
	local c = play.Compiled
	if skipped then
		for _, item in Timeline.EssentialAfter(c, play.LastT) do
			builtin(play, item)
			CutsceneService.Event:Fire(play, item)
			if play.Options.OnEvent then
				task.spawn(play.Options.OnEvent, play, item)
			end
		end
	end
	for _, ids in play.QteOpen do
		for _, id in ids do
			QteService:Cancel(id)
		end
	end
	local endT = if skipped then Timeline.EndFrom(c, math.max(0, play.LastT)) else math.max(0, play.LastT)
	local lying = placeAtEnd(play, endT)
	local keep: { [string]: boolean } = {}
	for name, model in play.Actors do
		unfreeze(play, model)
		local humanoid = humanoidOf(model)
		if humanoid and humanoid.Health <= 0 then
			keep[name] = true
		elseif lying[name] and RagdollService and model.Parent then
			RagdollService:Ragdoll(model, { Seconds = 1.2 })
		end
	end
	sendTo(play, endEvent, play.Id, skipped, keep)
	CutsceneService.Ended:Fire(play, skipped)
end

---------------------------------------------------------------------------------------------
-- Public

-- Starts a scene. `scene` is a name (looked up in options.Folder) or a scene table.
function CutsceneService:Play(scene: any, options: PlayOptions): Play?
	local folder = options.Folder or CutsceneConfig.ScenesFolder
	local def = if type(scene) == "string" then self:Find(scene, folder) else scene
	if not def then
		warn(`[Cutscene] no scene "{tostring(scene)}" in {folder}`)
		return nil
	end
	local compiled, errors = self:Compile(def)
	if not compiled then
		warn(`[Cutscene] {def.Name} has errors:\n  {table.concat(errors, "\n  ")}`)
		return nil
	end

	local actors: { [string]: Model } = {}
	local actorPlayers: { [string]: Player } = {}
	for name, model in options.Actors or {} do
		if compiled.Actors[name] and typeof(model) == "Instance" and model:IsA("Model") then
			if model:GetAttribute("InCutscene") then
				warn(`[Cutscene] {model.Name} is already in a scene`)
				return nil
			end
			actors[name] = model
			local player = Players:GetPlayerFromCharacter(model)
			if player then
				actorPlayers[name] = player
			end
		end
	end

	local watchers: { [Player]: boolean } = {}
	if options.Players then
		for _, player in options.Players do
			watchers[player] = true
		end
	elseif options.CameraFor then
		for _, name in options.CameraFor do
			if actorPlayers[name] then
				watchers[actorPlayers[name]] = true
			end
		end
	else
		for _, player in actorPlayers do
			watchers[player] = true
		end
		if next(watchers) == nil then
			for _, player in Players:GetPlayers() do
				watchers[player] = true
			end
		end
	end
	local recipients: { [Player]: boolean } = table.clone(watchers)
	if options.Observers then
		for _, player in Players:GetPlayers() do
			recipients[player] = true
		end
	end

	local play: Play = {
		Id = HttpService:GenerateGUID(false),
		Name = def.Name,
		Def = def,
		Compiled = compiled,
		Folder = folder,
		Origin = options.Origin,
		Actors = actors,
		ActorPlayers = actorPlayers,
		Watchers = watchers,
		Recipients = recipients,
		AnchorScene = 0,
		AnchorServer = workspace:GetServerTimeNow() + (options.Lead or CutsceneConfig.Lead),
		LastT = -1,
		Votes = {},
		Skippable = if options.Skippable ~= nil then options.Skippable else def.Skippable ~= false,
		QteStarted = {},
		QteOpen = {},
		QteResolved = {},
		Frozen = {},
		Options = options,
		Ended = false,
	}
	for _, model in actors do
		freeze(play, model)
	end
	placeAtEnd(play, Timeline.EndFrom(compiled, 0))
	active[play.Id] = play
	for player in recipients do
		playEvent:FireClient(player, payloadFor(play, player))
	end
	CutsceneService.Started:Fire(play)
	return play
end

function CutsceneService:Skip(play: Play)
	finish(play, true)
end

function CutsceneService:Stop(play: Play)
	finish(play, false)
end

function CutsceneService:IsActing(model: Model): boolean
	return model:GetAttribute("InCutscene") ~= nil
end

function CutsceneService:Get(id: string): Play?
	return active[id]
end

---------------------------------------------------------------------------------------------
-- Loop

local function step()
	local now = workspace:GetServerTimeNow()
	for _, play in active do
		if play.Ended then
			continue
		end
		local c = play.Compiled
		local t = sceneTimeNow(play, now)

		-- QTEs start a little early so the prompt is on screen when the window opens.
		for _, item in pendingQtes(play) do
			if not play.QteStarted[item] and now >= serverTimeOf(play, item.At) - CutsceneConfig.Qte.Lead then
				startQte(play, item)
			end
		end

		local anchor = play.AnchorServer
		if t > play.LastT then
			for _, item in Timeline.ItemsBetween(c, play.LastT, t) do
				if item.Kind ~= "Event" then
					continue
				end
				if item.Name == "End" then
					play.LastT = item.At
					finish(play, false)
					break
				elseif item.Name == "Goto" then
					local at = Timeline.Label(c, item.Label)
					if at then
						rebase(play, at)
					end
					break
				end
				builtin(play, item)
				CutsceneService.Event:Fire(play, item)
				if play.Options.OnEvent then
					task.spawn(play.Options.OnEvent, play, item)
				end
			end
			if not play.Ended and play.AnchorServer == anchor then
				play.LastT = t -- (a rebase above set its own LastT)
			end
		end
		if play.Ended then
			continue
		end
		if t >= c.Length then
			finish(play, false)
			continue
		end
		-- A watcher dying ends the scene for everyone (a QTE fail that kills, falling damage...).
		for _, player in play.ActorPlayers do
			local humanoid = humanoidOf(player.Character)
			if play.Watchers[player] and (not humanoid or humanoid.Health <= 0) then
				finish(play, false)
				break
			end
		end
	end
end

---------------------------------------------------------------------------------------------
-- Triggers

local triggered: { [Instance]: { [Player]: boolean } | boolean } = {}

local function bindTrigger(part: Instance)
	if not part:IsA("BasePart") then
		return
	end
	part.Touched:Connect(function(hit: BasePart)
		local character = hit:FindFirstAncestorOfClass("Model")
		local player = character and Players:GetPlayerFromCharacter(character)
		if not player or not character or character:GetAttribute("InCutscene") then
			return
		end
		local sceneName = part:GetAttribute("Scene")
		if type(sceneName) ~= "string" then
			return
		end
		local once = part:GetAttribute("Once")
		local record = triggered[part]
		if once == "Server" and record == true then
			return
		elseif once == "Player" and type(record) == "table" and record[player] then
			return
		end
		local def = CutsceneService:Find(sceneName)
		if not def then
			return
		end
		local origin = part.CFrame
		local originRef = part:FindFirstChild("Origin")
		if originRef and originRef:IsA("ObjectValue") and originRef.Value then
			local value = originRef.Value
			origin = if value:IsA("BasePart") then value.CFrame elseif value:IsA("Attachment") then value.WorldCFrame else origin
		end
		local look = origin.LookVector * Vector3.new(1, 0, 1)
		origin = CFrame.lookAt(origin.Position, origin.Position + (if look.Magnitude > 1e-3 then look else Vector3.new(0, 0, -1)))

		local actors: { [string]: Model } = {}
		local playerActor = part:GetAttribute("PlayerActor")
		if type(playerActor) ~= "string" then
			for name, actorDef in def.Actors or {} do
				if actorDef.Player then
					playerActor = name
				end
			end
		end
		if type(playerActor) == "string" then
			actors[playerActor] = character
		end
		for _, child in part:GetChildren() do
			local actorName = string.match(child.Name, "^Actor_(.+)$")
			if actorName and child:IsA("ObjectValue") and child.Value and child.Value:IsA("Model") then
				actors[actorName] = child.Value :: Model
			end
		end
		local watchers = { player }
		if part:GetAttribute("Shared") then
			watchers = {}
			for _, other in Players:GetPlayers() do
				local root = other.Character and rootOf(other.Character)
				if root and (root.Position - part.Position).Magnitude <= CutsceneConfig.Triggers.SharedRadius then
					table.insert(watchers, other)
				end
			end
		end
		if CutsceneService:Play(def, { Origin = origin, Actors = actors, Players = watchers }) then
			if once == "Server" then
				triggered[part] = true
			elseif once == "Player" then
				local map = if type(record) == "table" then record else {}
				map[player] = true
				triggered[part] = map
			end
		end
	end)
end

---------------------------------------------------------------------------------------------
-- Lifecycle

function CutsceneService:Init()
	playEvent = Net.Event("CutscenePlay")
	seekEvent = Net.Event("CutsceneSeek")
	endEvent = Net.Event("CutsceneEnd")
	votesEvent = Net.Event("CutsceneVotes")
	Net.Event("CutsceneSkip") -- declared; handled in Start
end

function CutsceneService:Start()
	RagdollService = optional("RagdollService")
	CombatService = optional("CombatService")

	Net.Handle("CutsceneSkip", 4, function(player: Player, id: unknown)
		if type(id) ~= "string" then
			return
		end
		local play = active[id]
		if not play or not play.Skippable or not play.Watchers[player] then
			return
		end
		play.Votes[player] = true
		local watchers, votes = 0, 0
		for watcher in play.Watchers do
			if watcher.Parent then
				watchers += 1
				if play.Votes[watcher] then
					votes += 1
				end
			end
		end
		local rule = CutsceneConfig.Skip.Rule
		local needed = if rule == "Any" then 1 elseif rule == "Majority" then math.floor(watchers / 2) + 1 else watchers
		for watcher in play.Watchers do
			votesEvent:FireClient(watcher, play.Id, votes, needed)
		end
		if votes >= needed then
			finish(play, true)
		end
	end)

	Players.PlayerRemoving:Connect(function(player)
		for _, play in active do
			play.Watchers[player] = nil
			play.Recipients[player] = nil
			play.Votes[player] = nil
			if next(play.Watchers) == nil and play.Folder ~= CutsceneConfig.FinishersFolder then
				finish(play, true)
			end
		end
	end)

	for _, part in CollectionService:GetTagged(CutsceneConfig.Triggers.Tag) do
		bindTrigger(part)
	end
	CollectionService:GetInstanceAddedSignal(CutsceneConfig.Triggers.Tag):Connect(bindTrigger)

	RunService.Heartbeat:Connect(step)
end

return CutsceneService
