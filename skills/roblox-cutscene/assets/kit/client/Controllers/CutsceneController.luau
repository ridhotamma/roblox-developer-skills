--!strict
-- Client side of the cutscene kit:
--   * plays scenes the server starts (CutscenePlay / CutsceneSeek / CutsceneEnd), camera or observer
--   * hold-to-skip (keyboard, gamepad, touch) and the "waiting for others" count
--   * QTE prompts (QteStart / QteResult) and the player's assist setting
--   * the finisher prompt: finds the enemy you could finish right now with the same rules the
--     server uses (Finisher.Choose), shows "[F] Suplex" on it (RE4-style), and asks the server
--     on press, or after a hold for Hold-input moves (CoD-style)
--   * hooks for your own code: CutsceneController.OnEvent("BossMusic", fn)
--
-- Other controllers should ignore gameplay input while Players.LocalPlayer:GetAttribute("InCutscene").

local CollectionService = game:GetService("CollectionService")
local ContextActionService = game:GetService("ContextActionService")
local Players = game:GetService("Players")
local ReplicatedStorage = game:GetService("ReplicatedStorage")
local RunService = game:GetService("RunService")

local CutsceneConfig = require(ReplicatedStorage.Shared.Cutscene.CutsceneConfig)
local CutscenePlayer = require(script.Parent.Parent.Cutscene.CutscenePlayer)
local CinemaOverlay = require(script.Parent.Parent.Cutscene.CinemaOverlay)
local Finisher = require(ReplicatedStorage.Shared.Cutscene.Finisher)
local Net = require(ReplicatedStorage.Shared.Net)
local QtePrompt = require(script.Parent.Parent.Cutscene.QtePrompt)
local Timeline = require(ReplicatedStorage.Shared.Cutscene.Timeline)

local player = Players.LocalPlayer
local config = CutsceneConfig.Finisher

local CutsceneController = {}

local plays: { [string]: CutscenePlayer.CutscenePlayer } = {}
local compiled: { [string]: Timeline.Compiled } = {}
local handlers: { [string]: { (item: any, play: any) -> () } } = {}
local moves: { [string]: any } = {}
local shakeScale = 1
local skipEvent: RemoteEvent
local requestEvent: RemoteEvent

---------------------------------------------------------------------------------------------
-- Public

-- Runs `fn(item, play)` whenever a scene fires an event with this name on this client.
function CutsceneController.OnEvent(name: string, fn: (item: any, play: any) -> ()): () -> ()
	handlers[name] = handlers[name] or {}
	table.insert(handlers[name], fn)
	return function()
		local list = handlers[name]
		local index = list and table.find(list, fn)
		if index then
			table.remove(list, index)
		end
	end
end

-- True while a scene has this player's camera.
function CutsceneController.IsPlaying(): boolean
	return player:GetAttribute("InCutscene") == true
end

-- Accessibility: impact shake 0 (off) .. 1 (full).
function CutsceneController.SetShakeScale(scale: number)
	shakeScale = math.clamp(scale, 0, 1)
end

-- Accessibility: "Off" | "Easy" | "Hold" | "Auto".
function CutsceneController.SetQteAssist(mode: string)
	Net.Event("QteAssist"):FireServer(mode)
end

---------------------------------------------------------------------------------------------
-- Scenes

local function sceneFor(folderName: string, name: string): Timeline.Compiled?
	local key = `{folderName}/{name}`
	if compiled[key] then
		return compiled[key]
	end
	local folder = ReplicatedStorage.Shared.Cutscene:FindFirstChild(folderName)
	local module = folder and folder:FindFirstChild(name)
	if not module or not module:IsA("ModuleScript") then
		warn(`[Cutscene] no scene {key} on the client`)
		return nil
	end
	local c, errors = Timeline.Compile((require :: any)(module))
	if #errors > 0 then
		warn(`[Cutscene] {key}: {table.concat(errors, "; ")}`)
		return nil
	end
	compiled[key] = c
	return c
end

local hooks: CutscenePlayer.Hooks = {
	OnEvent = function(item: any, play: any)
		for _, fn in handlers[item.Name] or {} do
			task.spawn(fn, item, play)
		end
	end,
	ShakeScale = function(): number
		return shakeScale
	end,
}

local function onPlay(payload: unknown)
	if type(payload) ~= "table" then
		return
	end
	local p = payload :: any
	if type(p.Id) ~= "string" or type(p.Scene) ~= "string" or typeof(p.Origin) ~= "CFrame" then
		return
	end
	if not p.Camera then
		-- Observers far away skip it: they'd barely see it and it costs clones.
		local root = player.Character and player.Character:FindFirstChild("HumanoidRootPart")
		if root and root:IsA("BasePart") and (root.Position - p.Origin.Position).Magnitude > CutsceneConfig.ObserverRange then
			return
		end
	end
	local c = sceneFor(p.Folder or CutsceneConfig.ScenesFolder, p.Scene)
	if not c then
		return
	end
	local play = CutscenePlayer.new(p, c, hooks)
	plays[p.Id] = play
	play:Start()
end

---------------------------------------------------------------------------------------------
-- Skip (hold, never tap: nobody should lose a scene to a stray key)

local skipHeldSince: number? = nil
local skipSent: { [string]: boolean } = {}

local function skippable(): CutscenePlayer.CutscenePlayer?
	for _, play in plays do
		if play.Camera and play.Payload.Skippable and not play.Finished then
			return play
		end
	end
	return nil
end

local skipBound = false

-- Bound only while a skippable scene has the camera, so the touch button isn't always on screen.
local function setSkipBound(bound: boolean)
	if bound == skipBound then
		return
	end
	skipBound = bound
	if not bound then
		ContextActionService:UnbindAction("CutsceneSkip")
		skipHeldSince = nil
		return
	end
	ContextActionService:BindActionAtPriority("CutsceneSkip", function(_, state: Enum.UserInputState)
		if state == Enum.UserInputState.Begin then
			skipHeldSince = os.clock()
		elseif state == Enum.UserInputState.End or state == Enum.UserInputState.Cancel then
			skipHeldSince = nil
		end
		return Enum.ContextActionResult.Sink
	end, true, Enum.ContextActionPriority.High.Value, table.unpack(CutsceneConfig.Skip.Keys))
	ContextActionService:SetTitle("CutsceneSkip", "Skip")
end

local function bindSkip()
	RunService.RenderStepped:Connect(function()
		local play = skippable()
		setSkipBound(play ~= nil)
		if not play then
			return
		end
		if skipSent[play.Id] then
			return
		end
		if skipHeldSince then
			local k = (os.clock() - skipHeldSince) / CutsceneConfig.Skip.HoldTime
			CinemaOverlay.SetSkip(`Skipping {string.rep("■", math.floor(math.min(k, 1) * 8))}{string.rep("□", 8 - math.floor(math.min(k, 1) * 8))}`)
			if k >= 1 then
				skipSent[play.Id] = true
				skipEvent:FireServer(play.Id)
				CinemaOverlay.SetSkip("Skipping...")
			end
		else
			CinemaOverlay.SetSkip("Hold to skip")
		end
	end)
end

---------------------------------------------------------------------------------------------
-- Finisher prompt

type Prompt = { Victim: Model, Move: any, Gui: BillboardGui, Fill: Frame }

local prompt: Prompt? = nil
local holdStarted: number? = nil

local function rootOf(model: Model?): BasePart?
	local root = model and (model:FindFirstChild("HumanoidRootPart") or model.PrimaryPart)
	return if root and root:IsA("BasePart") then root else nil
end

local function groundOffset(model: Model): number
	local humanoid = model:FindFirstChildOfClass("Humanoid")
	local root = rootOf(model)
	if humanoid and root then
		return if humanoid.RigType == Enum.HumanoidRigType.R6 then root.Size.Y / 2 + 2 else humanoid.HipHeight + root.Size.Y / 2
	end
	return 0
end

local function keyText(): string
	local last = game:GetService("UserInputService"):GetLastInputType()
	if string.find(last.Name, "Gamepad") then
		return (string.gsub(config.Pad.Name, "^Button", ""))
	elseif last == Enum.UserInputType.Touch then
		return "Tap"
	end
	return config.Key.Name
end

local function makePrompt(victim: Model, move: any): Prompt
	local gui = Instance.new("BillboardGui")
	gui.Name = "FinisherPrompt"
	gui.AlwaysOnTop = true
	gui.Size = UDim2.fromOffset(170, 40)
	gui.StudsOffsetWorldSpace = Vector3.new(0, 3.2, 0)
	gui.LightInfluence = 0
	local box = Instance.new("TextLabel")
	box.Size = UDim2.fromScale(1, 1)
	box.BackgroundColor3 = Color3.fromRGB(15, 15, 18)
	box.BackgroundTransparency = 0.25
	box.TextColor3 = Color3.new(1, 1, 1)
	box.Font = Enum.Font.GothamBold
	box.TextSize = 18
	box.Text = `[{keyText()}] {move.Finisher.Prompt or move.Name}`
	box.Parent = gui
	Instance.new("UICorner", box).CornerRadius = UDim.new(0, 8)
	local stroke = Instance.new("UIStroke", box)
	stroke.Color = Color3.fromRGB(255, 214, 92)
	stroke.Thickness = 2
	stroke.ApplyStrokeMode = Enum.ApplyStrokeMode.Border
	local fill = Instance.new("Frame")
	fill.Name = "Fill"
	fill.AnchorPoint = Vector2.new(0, 1)
	fill.Position = UDim2.fromScale(0, 1)
	fill.Size = UDim2.fromScale(0, 0.12)
	fill.BackgroundColor3 = Color3.fromRGB(255, 214, 92)
	fill.BorderSizePixel = 0
	fill.Parent = box
	gui.Adornee = rootOf(victim)
	gui.Parent = player:WaitForChild("PlayerGui")
	return { Victim = victim, Move = move, Gui = gui, Fill = fill }
end

local finisherAction: ((string, Enum.UserInputState, InputObject) -> Enum.ContextActionResult)? = nil

local function clearPrompt()
	if prompt then
		prompt.Gui:Destroy()
		prompt = nil
		ContextActionService:UnbindAction("CutsceneFinisher")
	end
	holdStarted = nil
end

local function showPrompt(victim: Model, move: any)
	prompt = makePrompt(victim, move)
	if finisherAction then
		ContextActionService:BindAction("CutsceneFinisher", finisherAction, true, config.Key, config.Pad)
		ContextActionService:SetTitle("CutsceneFinisher", move.Finisher.Prompt or "Finish")
	end
end

local function best(): (Model?, any?)
	local character = player.Character
	local root = rootOf(character)
	local humanoid = character and character:FindFirstChildOfClass("Humanoid")
	if not root or not humanoid or humanoid.Health <= 0 or CutsceneController.IsPlaying() or (character :: Model):GetAttribute("InCutscene") then
		return nil, nil
	end
	local found, foundMove, foundDistance = nil, nil, math.huge
	local seen: { [Instance]: boolean } = {}
	for _, tag in config.Tags do
		for _, model in CollectionService:GetTagged(tag) do
			if seen[model] or not model:IsA("Model") or model:GetAttribute("InCutscene") then
				continue
			end
			seen[model] = true
			local victimRoot = rootOf(model)
			local victimHumanoid = model:FindFirstChildOfClass("Humanoid")
			if not victimRoot or not victimHumanoid or victimHumanoid.Health <= 0 then
				continue
			end
			local distance = (victimRoot.Position - root.Position).Magnitude
			if distance > config.PromptRange or distance >= foundDistance then
				continue
			end
			local state = model:GetAttribute("State")
			local posture = model:GetAttribute("Posture")
			local kind = model:GetAttribute("Archetype") or model:GetAttribute("Kind")
			local ground = Finisher.Ground(victimRoot.CFrame, groundOffset(model))
			local move = Finisher.Choose(moves, {
				Side = Finisher.Side(root.Position, ground),
				Posture = if type(posture) == "string" then posture else nil,
				HealthFraction = victimHumanoid.Health / math.max(1, victimHumanoid.MaxHealth),
				Distance = distance,
				Height = root.Position.Y - victimRoot.Position.Y,
				Unaware = state == nil or (type(state) == "string" and table.find(config.UnawareStates, state) ~= nil),
				Kind = if type(kind) == "string" then kind else nil,
				Last = nil,
			})
			if move then
				found, foundMove, foundDistance = model, move, distance
			end
		end
	end
	return found, foundMove
end

local function request()
	local current = prompt
	if not current then
		return
	end
	requestEvent:FireServer(current.Victim)
	clearPrompt()
end

local function bindFinisher()
	local folder = ReplicatedStorage.Shared.Cutscene:WaitForChild(CutsceneConfig.FinishersFolder)
	for _, module in folder:GetChildren() do
		if module:IsA("ModuleScript") then
			local move = (require :: any)(module)
			if move.Finisher and not move.Finisher.Grab then
				moves[move.Name] = move
			end
		end
	end

	finisherAction = function(_, state: Enum.UserInputState)
		local current = prompt
		if not current then
			return Enum.ContextActionResult.Pass
		end
		if state == Enum.UserInputState.Begin then
			if current.Move.Finisher.Input == "Hold" then
				holdStarted = os.clock()
			else
				request()
			end
		elseif state == Enum.UserInputState.End then
			holdStarted = nil
		end
		return Enum.ContextActionResult.Sink
	end

	local nextScan = 0
	RunService.RenderStepped:Connect(function()
		local current = prompt
		if current and holdStarted then
			local k = (os.clock() - holdStarted) / (current.Move.Finisher.HoldTime or 0.3)
			current.Fill.Size = UDim2.fromScale(math.min(k, 1), 0.12)
			if k >= 1 then
				request()
			end
		end
		if os.clock() < nextScan then
			return
		end
		nextScan = os.clock() + config.ScanInterval
		local victim, move = best()
		if not victim then
			clearPrompt()
		elseif not prompt or prompt.Victim ~= victim or prompt.Move ~= move then
			local holding = holdStarted
			local sameVictim = prompt ~= nil and prompt.Victim == victim
			clearPrompt()
			showPrompt(victim, move)
			if holding and sameVictim then
				holdStarted = holding
			end
		end
	end)
end

---------------------------------------------------------------------------------------------
-- Lifecycle

function CutsceneController:Init()
	skipEvent = Net.Event("CutsceneSkip")
	requestEvent = Net.Event("FinisherRequest")
end

function CutsceneController:Start()
	Net.Event("CutscenePlay").OnClientEvent:Connect(onPlay)
	Net.Event("CutsceneSeek").OnClientEvent:Connect(function(id: unknown, sceneTime: unknown, serverTime: unknown)
		local play = type(id) == "string" and plays[id]
		if play and type(sceneTime) == "number" and type(serverTime) == "number" then
			play:Rebase(sceneTime, serverTime)
		end
	end)
	Net.Event("CutsceneEnd").OnClientEvent:Connect(function(id: unknown, _skipped: unknown, keep: unknown)
		local play = type(id) == "string" and plays[id]
		if play then
			plays[id :: string] = nil
			skipSent[id :: string] = nil
			play:Finish(if type(keep) == "table" then keep :: any else {})
		end
	end)
	Net.Event("CutsceneVotes").OnClientEvent:Connect(function(id: unknown, votes: unknown, needed: unknown)
		local play = type(id) == "string" and plays[id]
		if play and play.Camera and type(votes) == "number" and type(needed) == "number" and votes < needed then
			CinemaOverlay.SetSkip(`Waiting for others to skip ({votes}/{needed})`)
		end
	end)

	local inputEvent = Net.Event("QteInput")
	Net.Event("QteStart").OnClientEvent:Connect(function(id: unknown, spec: unknown, startAt: unknown, assist: unknown, anchor: unknown)
		if type(id) ~= "string" or type(spec) ~= "table" or type(startAt) ~= "number" then
			return
		end
		QtePrompt.Show(id, spec :: any, startAt, if type(assist) == "string" then assist else nil, if typeof(anchor) == "Instance" then anchor :: Instance else nil, function(action: string, down: boolean, time: number)
			inputEvent:FireServer(id, action, down, time)
		end)
	end)
	Net.Event("QteResult").OnClientEvent:Connect(function(id: unknown, status: unknown, grade: unknown)
		if type(id) == "string" and type(status) == "string" then
			QtePrompt.Result(id, status, if type(grade) == "string" then grade else nil)
		end
	end)

	bindSkip()
	bindFinisher()
	player.CharacterRemoving:Connect(clearPrompt)
end

return CutsceneController
