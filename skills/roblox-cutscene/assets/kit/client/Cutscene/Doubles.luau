--!strict
-- Stand-ins: each client clones the scene's actors locally ("doubles", like a film's stunt
-- doubles) and plays the scene on the clones, while the real characters wait hidden and frozen.
--
-- Why not animate the real characters? A player's character animations replicate from that
-- player's client and an NPC's from the server, each with its own delay, so two bodies that
-- must touch (a suplex, a grab) drift apart on everyone else's screen. Local clones driven by
-- the shared clock line up perfectly on every client, can be posed, moved, slowed, frozen and
-- ragdolled freely, and nothing they do replicates or touches gameplay.

local Players = game:GetService("Players")
local ReplicatedStorage = game:GetService("ReplicatedStorage")

local Doubles = {}

type TrackInfo = { Track: AnimationTrack, Base: number, Hold: boolean, Held: boolean, Layer: string }
type DoubleInfo = { Tracks: { TrackInfo }, Rate: number, Offset: number, Ragdolled: boolean }

local info: { [Model]: DoubleInfo } = {}
local hidden: { [Model]: { [Instance]: number | boolean } } = {}
local animations: { [string]: Animation } = {}
local folder: Folder? = nil

local function container(): Folder
	if folder and folder.Parent then
		return folder
	end
	local f = Instance.new("Folder")
	f.Name = "CutsceneDoubles"
	f.Parent = workspace
	folder = f
	return f
end

local function rootOf(model: Model): BasePart?
	local root = model:FindFirstChild("HumanoidRootPart") or model.PrimaryPart
	return if root and root:IsA("BasePart") then root else nil
end

-- Studs from the ground to the root part's centre.
function Doubles.GroundOffset(model: Model): number
	local humanoid = model:FindFirstChildOfClass("Humanoid")
	local root = rootOf(model)
	if humanoid and root then
		if humanoid.RigType == Enum.HumanoidRigType.R6 then
			return root.Size.Y / 2 + 2
		end
		return humanoid.HipHeight + root.Size.Y / 2
	end
	local cframe, size = model:GetBoundingBox()
	return model:GetPivot().Position.Y - (cframe.Position.Y - size.Y / 2)
end

-- Studs from feet to the top of the head (accessories excluded where possible).
function Doubles.Height(model: Model): number
	local humanoid = model:FindFirstChildOfClass("Humanoid")
	local root = rootOf(model)
	local head = model:FindFirstChild("Head")
	if humanoid and root and head and head:IsA("BasePart") then
		local feet = root.Position.Y - Doubles.GroundOffset(model)
		return math.max(1, head.Position.Y + head.Size.Y / 2 - feet)
	end
	local _, size = model:GetBoundingBox()
	return size.Y
end

-- A local, inert copy of `model` (nil if it can't be cloned).
function Doubles.Make(model: Model): Model?
	local wasArchivable = model.Archivable
	model.Archivable = true -- player characters aren't archivable by default
	local ok, copy = pcall(function()
		return model:Clone()
	end)
	model.Archivable = wasArchivable
	if not ok or not copy then
		return nil
	end
	local double = copy :: Model
	for _, item in double:GetDescendants() do
		if item:IsA("BaseScript") or item:IsA("ForceField") then
			item:Destroy()
		elseif item:IsA("BasePart") then
			item.CanCollide = false
			item.CanQuery = false
			item.CanTouch = false
			item.Anchored = false
			item.Massless = true
			item.LocalTransparencyModifier = 0 -- a first-person character's parts are locally hidden
		elseif item:IsA("Decal") then
			item.LocalTransparencyModifier = 0
		end
	end
	local humanoid = double:FindFirstChildOfClass("Humanoid")
	if humanoid then
		humanoid.BreakJointsOnDeath = false
		humanoid.RequiresNeck = false
		humanoid.DisplayDistanceType = Enum.HumanoidDisplayDistanceType.None
		humanoid.HealthDisplayType = Enum.HumanoidHealthDisplayType.AlwaysOff
		humanoid:SetStateEnabled(Enum.HumanoidStateType.Dead, false)
		humanoid.Health = humanoid.MaxHealth
		if not humanoid:FindFirstChildOfClass("Animator") then
			Instance.new("Animator").Parent = humanoid
		end
	end
	local root = rootOf(double)
	if root then
		root.Anchored = true
	end
	double.Name = `{model.Name}_Double`
	double:SetAttribute("CutsceneDouble", true)
	double.Parent = container()
	info[double] = { Tracks = {}, Rate = 1, Offset = Doubles.GroundOffset(model), Ragdolled = false }
	return double
end

-- From a template model (ReplicatedStorage.CutsceneActors.X) for actors nobody bound.
function Doubles.FromTemplate(name: string): Model?
	local templates = ReplicatedStorage:FindFirstChild("CutsceneActors")
	local template = templates and templates:FindFirstChild(name)
	if template and template:IsA("Model") then
		return Doubles.Make(template)
	end
	return nil
end

---------------------------------------------------------------------------------------------
-- Hiding the real actors

local function hideItem(record: { [Instance]: number | boolean }, item: Instance)
	if item:IsA("BasePart") or item:IsA("Decal") then
		if record[item] == nil then
			record[item] = (item :: any).LocalTransparencyModifier
		end
		(item :: any).LocalTransparencyModifier = 1
	elseif item:IsA("BillboardGui") or item:IsA("SurfaceGui") or item:IsA("ParticleEmitter") or item:IsA("Beam") or item:IsA("Trail") or item:IsA("Light") then
		if record[item] == nil then
			record[item] = (item :: any).Enabled
		end
		(item :: any).Enabled = false
	end
end

function Doubles.Hide(model: Model)
	local record = hidden[model] or {}
	hidden[model] = record
	for _, item in model:GetDescendants() do
		hideItem(record, item)
	end
end

-- Roblox's camera scripts reset LocalTransparencyModifier on your own character; call every frame.
function Doubles.KeepHidden()
	for model, record in hidden do
		if not model.Parent then
			hidden[model] = nil
			continue
		end
		for item in record do
			if item:IsA("BasePart") or item:IsA("Decal") then
				(item :: any).LocalTransparencyModifier = 1
			end
		end
	end
end

function Doubles.Show(model: Model)
	local record = hidden[model]
	hidden[model] = nil
	if not record then
		return
	end
	for item, value in record do
		if item.Parent then
			if item:IsA("BasePart") or item:IsA("Decal") then
				(item :: any).LocalTransparencyModifier = if model == Players.LocalPlayer.Character then 0 else value
			else
				(item :: any).Enabled = value
			end
		end
	end
end

function Doubles.IsHidden(model: Model): boolean
	return hidden[model] ~= nil
end

---------------------------------------------------------------------------------------------
-- Moving and animating a double

-- Puts the double's feet on `ground` (a CFrame on the floor, possibly pitched for a fall).
function Doubles.Place(double: Model, ground: CFrame)
	local data = info[double]
	local root = rootOf(double)
	if not data or not root or data.Ragdolled then
		return
	end
	root.CFrame = ground * CFrame.new(0, data.Offset, 0)
end

function Doubles.SetVisible(double: Model, visible: boolean)
	for _, item in double:GetDescendants() do
		if item:IsA("BasePart") or item:IsA("Decal") then
			(item :: any).LocalTransparencyModifier = if visible then 0 else 1
		end
	end
end

local function animationFor(id: string): Animation
	local animation = animations[id]
	if not animation then
		animation = Instance.new("Animation")
		animation.AnimationId = id
		animations[id] = animation
	end
	return animation
end

function Doubles.Preload(ids: { string })
	local list = {}
	for _, id in ids do
		if id ~= "" then
			table.insert(list, animationFor(id))
		end
	end
	if #list > 0 then
		pcall(function()
			game:GetService("ContentProvider"):PreloadAsync(list)
		end)
	end
end

export type PlayOptions = {
	Speed: number?,
	Looped: boolean?,
	FadeTime: number?,
	Weight: number?,
	Layer: string?,
	TimePosition: number?,
	Hold: boolean?, -- hold the last frame instead of snapping back (default true)
}

function Doubles.Play(double: Model, id: string, options: PlayOptions?): AnimationTrack?
	local data = info[double]
	local humanoid = double:FindFirstChildOfClass("Humanoid")
	local animator = humanoid and humanoid:FindFirstChildOfClass("Animator")
	if not data or not animator or id == "" or data.Ragdolled then
		return nil
	end
	local opts = options or {}
	local layer = opts.Layer or "Action"
	for i = #data.Tracks, 1, -1 do
		local entry = data.Tracks[i]
		if entry.Layer == layer then
			entry.Track:Stop(opts.FadeTime or 0.15)
			table.remove(data.Tracks, i)
		end
	end
	local track = animator:LoadAnimation(animationFor(id))
	track.Priority = Enum.AnimationPriority.Action4
	track.Looped = opts.Looped == true
	local base = opts.Speed or 1
	track:Play(opts.FadeTime or 0.15, opts.Weight or 1, base * data.Rate)
	local position = opts.TimePosition or 0
	if position > 0 and track.Length > 0 then
		track.TimePosition = if track.Looped then position % track.Length else math.min(position, track.Length - 0.02)
	end
	table.insert(data.Tracks, { Track = track, Base = base, Hold = opts.Hold ~= false and not track.Looped, Held = false, Layer = layer })
	return track
end

-- Playback rate for slow motion (0.25) and hit freezes (0).
function Doubles.SetRate(double: Model, rate: number)
	local data = info[double]
	if not data or data.Rate == rate then
		return
	end
	data.Rate = rate
	for _, entry in data.Tracks do
		if not entry.Held then
			entry.Track:AdjustSpeed(entry.Base * rate)
		end
	end
end

-- Call every frame: stops one-shot clips on their last frame instead of popping to the bind pose.
function Doubles.Step(double: Model)
	local data = info[double]
	if not data then
		return
	end
	for _, entry in data.Tracks do
		local track = entry.Track
		if entry.Hold and not entry.Held and track.Length > 0 and track.TimePosition >= track.Length - 0.05 then
			track:AdjustSpeed(0)
			entry.Held = true
		end
	end
end

function Doubles.StopAll(double: Model, fade: number?)
	local data = info[double]
	if not data then
		return
	end
	for _, entry in data.Tracks do
		entry.Track:Stop(fade or 0.1)
	end
	data.Tracks = {}
end

-- Goes limp (needs the roblox-ragdoll kit's RagdollRig in ReplicatedStorage.Shared.Ragdoll;
-- without it the double just holds its last pose). Returns true if it ragdolled.
function Doubles.Ragdoll(double: Model, velocity: Vector3?): boolean
	local data = info[double]
	if not data or data.Ragdolled then
		return false
	end
	local ragdollFolder = ReplicatedStorage.Shared:FindFirstChild("Ragdoll")
	local module = ragdollFolder and ragdollFolder:FindFirstChild("RagdollRig")
	if not module then
		return false
	end
	local RagdollRig = (require :: any)(module)
	if not RagdollRig.Build(double) then
		return false
	end
	Doubles.StopAll(double, 0)
	for _, item in double:GetDescendants() do
		if item:IsA("BasePart") then
			item.Massless = false -- limbs become their own assemblies and need weight
		end
	end
	RagdollRig.SetActive(double, true)
	data.Ragdolled = true
	local root = rootOf(double)
	if root then
		root.Anchored = false
		root.AssemblyLinearVelocity = velocity or Vector3.zero
	end
	local humanoid = double:FindFirstChildOfClass("Humanoid")
	if humanoid then
		humanoid:ChangeState(Enum.HumanoidStateType.Physics)
	end
	return true
end

function Doubles.IsRagdolled(double: Model): boolean
	local data = info[double]
	return data ~= nil and data.Ragdolled
end

function Doubles.Destroy(double: Model)
	info[double] = nil
	double:Destroy()
end

return Doubles
