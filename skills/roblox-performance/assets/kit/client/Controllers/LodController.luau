--!strict
-- Client-side distance LOD for tagged objects, run as one time-budgeted loop (Scheduler).
--
-- Tag a Model or a part "PerfLod" (PerfConfig.Lod.Tag). When the camera is farther than its LOD
-- distance (scaled by the quality tier), the controller:
--   * disables its ParticleEmitters, Beams, Trails, lights, Fire, Smoke and Sparkles
--     (and puts them back the way they were when it comes near again),
--   * removes its child named "Detail" (small props, decals, inner parts) from the world,
--   * shows its child named "Simple" (an optional cheap stand-in), which is hidden while near,
--   * sets the attribute LodLevel on it locally (0 near, 1 far, 2 culled) so other client code
--     can stop animating it, e.g. `if model:GetAttribute("LodLevel") ~= 0 then return end`.
-- Beyond the optional CullDistance attribute the Simple child is hidden too (LodLevel 2).
--
-- Attributes on the tagged instance (all optional):
--   LodDistance (number)  default PerfConfig.Lod.DefaultDistance
--   CullDistance (number) hide everything listed above beyond this
--   LodStatic (bool)      position never changes: read it once instead of every check
--
-- With StreamingEnabled the engine already removes far-away parts; use this for what streaming
-- keeps: effects and lights (which cost even when small on screen), persistent models, and detail
-- you want gone well before the streaming radius. Objects are checked more often when they are
-- close to their LOD edge and rarely when far from it, so thousands of tagged objects cost a few
-- tenths of a millisecond.
--
-- While an object is far, gameplay code that toggles its effects' Enabled will be overruled when it
-- comes near (the controller restores what it saw). Toggle effects through an attribute instead.

local CollectionService = game:GetService("CollectionService")
local Players = game:GetService("Players")
local ReplicatedStorage = game:GetService("ReplicatedStorage")

local PerfConfig = require(ReplicatedStorage.Shared.Perf.PerfConfig)
local Scheduler = require(ReplicatedStorage.Shared.Perf.Scheduler)

local config = PerfConfig.Lod
local player = Players.LocalPlayer
local EFFECT_CLASSES = { "ParticleEmitter", "Beam", "Trail", "Light", "Fire", "Smoke", "Sparkles" }

type Entry = {
	Root: Instance,
	Distance: number,
	Cull: number?,
	Static: Vector3?,
	Effects: { Instance },
	Saved: { [Instance]: boolean },
	Detail: Instance?,
	DetailParent: Instance?,
	Simple: Instance?,
	SimpleParent: Instance?,
	Level: number,
	Connections: { RBXScriptConnection },
}

local LodController = {}

local entries: { [Instance]: Entry } = {}
local scheduler: Scheduler.Scheduler? = nil
local cameraPosition = Vector3.zero
local lodScale = 1

local function isEffect(instance: Instance): boolean
	for _, className in EFFECT_CLASSES do
		if instance:IsA(className) then
			return true
		end
	end
	return false
end

local function positionOf(entry: Entry): Vector3?
	if entry.Static then
		return entry.Static
	end
	local root = entry.Root
	if root:IsA("Model") then
		return root:GetPivot().Position
	elseif root:IsA("BasePart") then
		return root.Position
	end
	local part = root:FindFirstChildWhichIsA("BasePart", true)
	return if part then part.Position else nil
end

local function insideDetail(entry: Entry, instance: Instance): boolean
	local detail = entry.Detail
	return detail ~= nil and (instance == detail or instance:IsDescendantOf(detail))
end

local function setEffects(entry: Entry, on: boolean)
	if on then
		for effect, enabled in entry.Saved do
			(effect :: any).Enabled = enabled
		end
		table.clear(entry.Saved)
	else
		for _, effect in entry.Effects do
			if entry.Saved[effect] == nil then
				entry.Saved[effect] = (effect :: any).Enabled
				;(effect :: any).Enabled = false
			end
		end
	end
end

local function setParent(child: Instance?, parent: Instance?)
	if child and child.Parent ~= parent then
		pcall(function()
			child.Parent = parent
		end)
	end
end

local function applyLevel(entry: Entry, level: number)
	if entry.Level == level then
		return
	end
	entry.Level = level
	setEffects(entry, level == 0)
	setParent(entry.Detail, if level == 0 then entry.DetailParent else nil)
	setParent(entry.Simple, if level == 1 then entry.SimpleParent else nil)
	entry.Root:SetAttribute("LodLevel", level)
end

local function step(entry: Entry, _dt: number): number?
	local position = positionOf(entry)
	if position == nil then
		return config.MaxCheckSeconds
	end
	local distance = (position - cameraPosition).Magnitude
	local edge = entry.Distance * lodScale
	local h = config.Hysteresis
	local level = entry.Level

	if level == 0 then
		if distance > edge + h then
			level = 1
		end
	elseif distance < edge - h then
		level = 0
	elseif level == 1 or level == -1 then
		level = 1
	end
	local cull = entry.Cull
	if cull and level ~= 0 then
		local cullEdge = cull * lodScale
		if distance > cullEdge + h then
			level = 2
		elseif distance < cullEdge - h then
			level = 1
		end
	end
	applyLevel(entry, level)

	-- Check again sooner when close to an edge.
	local gap = math.abs(distance - edge)
	if cull then
		gap = math.min(gap, math.abs(distance - cull * lodScale))
	end
	return math.clamp(gap / config.AssumedCameraSpeed, config.MinCheckSeconds, config.MaxCheckSeconds)
end

local function remove(root: Instance)
	local entry = entries[root]
	if entry == nil then
		return
	end
	entries[root] = nil
	if scheduler then
		scheduler:Remove(entry)
	end
	for _, connection in entry.Connections do
		connection:Disconnect()
	end
	-- Put things back so the instance is whole if it is retagged or kept.
	setEffects(entry, true)
	if entry.Detail and entry.Detail.Parent == nil then
		if entry.DetailParent and entry.DetailParent.Parent ~= nil then
			setParent(entry.Detail, entry.DetailParent)
		else
			entry.Detail:Destroy()
		end
	end
	if entry.Simple and entry.Simple.Parent == nil then
		if entry.SimpleParent and entry.SimpleParent.Parent ~= nil then
			setParent(entry.Simple, entry.SimpleParent)
		else
			entry.Simple:Destroy()
		end
	end
end

local function add(root: Instance)
	if entries[root] or not root:IsDescendantOf(workspace) then
		return
	end
	local distance = root:GetAttribute("LodDistance")
	local cull = root:GetAttribute("CullDistance")
	local detail = root:FindFirstChild(config.DetailName)
	local simple = root:FindFirstChild(config.SimpleName)
	local entry: Entry = {
		Root = root,
		Distance = if type(distance) == "number" then distance else config.DefaultDistance,
		Cull = if type(cull) == "number" then cull else nil,
		Static = nil,
		Effects = {},
		Saved = {},
		Detail = detail,
		DetailParent = if detail then detail.Parent else nil,
		Simple = simple,
		SimpleParent = if simple then simple.Parent else nil,
		Level = -1, -- unknown until the first check
		Connections = {},
	}
	if root:GetAttribute("LodStatic") == true then
		entry.Static = positionOf(entry)
	end
	if isEffect(root) then
		table.insert(entry.Effects, root)
	end
	for _, descendant in root:GetDescendants() do
		if isEffect(descendant) and not insideDetail(entry, descendant) then
			table.insert(entry.Effects, descendant)
		end
	end
	-- Hide the stand-in until the first check says we're far.
	setParent(simple, nil)

	table.insert(
		entry.Connections,
		root.DescendantAdded:Connect(function(descendant)
			if isEffect(descendant) and not insideDetail(entry, descendant) then
				table.insert(entry.Effects, descendant)
				if entry.Level > 0 then
					entry.Saved[descendant] = (descendant :: any).Enabled
					;(descendant :: any).Enabled = false
				end
			end
		end)
	)
	table.insert(
		entry.Connections,
		root.DescendantRemoving:Connect(function(descendant)
			local index = table.find(entry.Effects, descendant)
			if index then
				table.remove(entry.Effects, index)
				entry.Saved[descendant] = nil
			end
		end)
	)

	entries[root] = entry
	if scheduler then
		scheduler:Add(entry)
	end
end

-- Force a re-check of everything (after a teleport or camera cut).
function LodController:Refresh()
	if scheduler then
		for _, entry in entries do
			scheduler:Wake(entry)
		end
	end
end

function LodController:Start()
	local function readScale()
		local value = player:GetAttribute("PerfLodScale")
		lodScale = if type(value) == "number" and value > 0 then value else 1
	end
	readScale()
	player:GetAttributeChangedSignal("PerfLodScale"):Connect(function()
		readScale()
		LodController:Refresh()
	end)

	scheduler = Scheduler.new("Lod.Step", {
		BudgetMs = config.BudgetMs,
		Event = "Heartbeat",
		Begin = function()
			local camera = workspace.CurrentCamera
			if camera then
				cameraPosition = camera.CFrame.Position
			end
		end,
		Step = step,
	})

	CollectionService:GetInstanceAddedSignal(config.Tag):Connect(add)
	CollectionService:GetInstanceRemovedSignal(config.Tag):Connect(remove)
	for _, instance in CollectionService:GetTagged(config.Tag) do
		add(instance)
	end
end

return LodController
