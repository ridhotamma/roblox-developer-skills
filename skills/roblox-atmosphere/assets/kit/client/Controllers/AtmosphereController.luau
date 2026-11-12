--!strict
-- Decides which atmosphere preset this client sees and blends to it, along with its weather and
-- ambience. Highest priority wins:
--
--   1. Player attribute AtmosphereOverride   (server: AtmosphereService:SetPlayerPreset)
--   2. AtmosphereController:SetOverride(name) (client scripts: cutscenes, boss rooms, menus)
--   3. The AtmosphereZone part the character stands in (highest Priority, then the smallest)
--   4. Base: Lighting attribute AtmospherePreset, else the day/night phase, else DefaultPreset
--
-- It also drives Lighting.ClockTime every frame: the preset's own ClockTime, or the shared world
-- clock when day/night is on (for the base preset and for zones with FollowClock = true).

local CollectionService = game:GetService("CollectionService")
local Lighting = game:GetService("Lighting")
local Players = game:GetService("Players")
local ReplicatedStorage = game:GetService("ReplicatedStorage")
local RunService = game:GetService("RunService")

local Atmosphere = require(ReplicatedStorage.Shared.Atmosphere.Atmosphere)
local AtmosphereConfig = require(ReplicatedStorage.Shared.Atmosphere.AtmosphereConfig)
local Ambience = require(script.Parent.Parent.Atmosphere.Ambience)
local Signal = require(ReplicatedStorage.Packages.Signal)
local Weather = require(script.Parent.Parent.Atmosphere.Weather)

local player = Players.LocalPlayer
local dayNight = AtmosphereConfig.DayNight

local AtmosphereController = {}
-- Fires (presetName, source) when the active preset changes. source: "override" | "scripted" | "zone" | "base"
AtmosphereController.Changed = Signal.new()

local zones: { BasePart } = {}
local scriptedOverride: string? = nil
local scriptedSeconds: number? = nil
local activeName: string? = nil
local activeZone: BasePart? = nil
local pinnedClock: number? = nil
local clockSeconds = AtmosphereConfig.TransitionSeconds
local snapClock = true

local function worldClock(): number
	local clock = Lighting:GetAttribute("WorldClock")
	local rate = Lighting:GetAttribute("WorldClockRate")
	local stamp = Lighting:GetAttribute("WorldClockStamp")
	if typeof(clock) ~= "number" or typeof(rate) ~= "number" or typeof(stamp) ~= "number" then
		return dayNight.StartClock
	end
	return (clock + (workspace:GetServerTimeNow() - stamp) * rate) % 24
end

local function phasePreset(clock: number): string
	local phases = dayNight.Phases
	local chosen = phases[#phases].Preset -- before the first phase = still the last one (night)
	for _, phase in phases do
		if clock >= phase.From then
			chosen = phase.Preset
		end
	end
	return chosen
end

local function listenerPosition(): Vector3?
	local character = player.Character
	local root = character and character:FindFirstChild("HumanoidRootPart")
	if root and root:IsA("BasePart") then
		return root.Position
	end
	local camera = workspace.CurrentCamera
	return camera and camera.CFrame.Position
end

local function zoneAt(position: Vector3): BasePart?
	local best: BasePart? = nil
	local bestPriority, bestVolume = -math.huge, math.huge
	for _, zone in zones do
		local preset = zone:GetAttribute("Preset")
		if typeof(preset) ~= "string" then
			continue
		end
		local rel = zone.CFrame:PointToObjectSpace(position)
		local half = zone.Size / 2
		if math.abs(rel.X) > half.X or math.abs(rel.Y) > half.Y or math.abs(rel.Z) > half.Z then
			continue
		end
		local priority = zone:GetAttribute("Priority")
		local p = if typeof(priority) == "number" then priority else 0
		local volume = zone.Size.X * zone.Size.Y * zone.Size.Z
		if p > bestPriority or (p == bestPriority and volume < bestVolume) then
			best, bestPriority, bestVolume = zone, p, volume
		end
	end
	return best
end

local function choose(): (string, string, BasePart?)
	local override = player:GetAttribute("AtmosphereOverride")
	if typeof(override) == "string" and override ~= "" then
		return override, "override", nil
	end
	if scriptedOverride then
		return scriptedOverride, "scripted", nil
	end
	local position = listenerPosition()
	local zone = position and zoneAt(position)
	if zone then
		return zone:GetAttribute("Preset") :: string, "zone", zone
	end
	local base = Lighting:GetAttribute("AtmospherePreset")
	if typeof(base) == "string" and base ~= "" then
		return base, "base", nil
	end
	if dayNight.Enabled then
		return phasePreset(worldClock()), "base", nil
	end
	return AtmosphereConfig.DefaultPreset, "base", nil
end

local function refresh(forceSeconds: number?)
	local name, source, zone = choose()
	if name == activeName and zone == activeZone and forceSeconds == nil then
		return
	end
	local preset = Atmosphere.Get(name)
	if not preset then
		return
	end
	local seconds = forceSeconds
	if seconds == nil and source == "scripted" then
		seconds = scriptedSeconds
	end
	if seconds == nil and zone then
		local attr = zone:GetAttribute("TransitionSeconds")
		seconds = if typeof(attr) == "number" then attr else nil
	end
	local t = seconds or AtmosphereConfig.TransitionSeconds

	local nameChanged = name ~= activeName
	activeName, activeZone = name, zone
	if nameChanged or forceSeconds ~= nil then
		Atmosphere.Apply(preset, t, { SkipClock = true })
		Weather.Set(preset.Weather, t)
		Ambience.Set(preset.Ambience, t)
	end

	local followClock = dayNight.Enabled and (source == "base" or (zone ~= nil and zone:GetAttribute("FollowClock") == true))
	pinnedClock = if followClock then nil else preset.Lighting.ClockTime
	clockSeconds = t
	snapClock = t <= 0

	if nameChanged then
		AtmosphereController.Changed:Fire(name, source)
	end
end

local function stepClock(dt: number)
	local target = pinnedClock or (if dayNight.Enabled then worldClock() else nil)
	if typeof(target) ~= "number" then
		return
	end
	local current = Lighting.ClockTime
	local delta = ((target - current + 12) % 24) - 12
	if snapClock or math.abs(delta) < 1e-4 then
		Lighting.ClockTime = target % 24
		snapClock = false
		return
	end
	-- Exponential follow: reaches ~95% of the way in clockSeconds, and tracks a moving world clock.
	local k = 1 - math.exp(-dt * 3 / math.max(clockSeconds, 0.05))
	Lighting.ClockTime = (current + delta * k) % 24
end

function AtmosphereController:Init()
	local function add(instance: Instance)
		if instance:IsA("BasePart") and not table.find(zones, instance) then
			instance.LocalTransparencyModifier = 1
			table.insert(zones, instance)
		end
	end
	local function remove(instance: Instance)
		local index = table.find(zones, instance :: any)
		if index then
			table.remove(zones, index)
		end
	end
	CollectionService:GetInstanceAddedSignal(AtmosphereConfig.ZoneTag):Connect(add)
	CollectionService:GetInstanceRemovedSignal(AtmosphereConfig.ZoneTag):Connect(remove)
	for _, zone in CollectionService:GetTagged(AtmosphereConfig.ZoneTag) do
		add(zone)
	end
end

function AtmosphereController:Start()
	refresh(0) -- first frame: snap, no blend from the place's default lighting
	Lighting:GetAttributeChangedSignal("AtmospherePreset"):Connect(function()
		refresh()
	end)
	player:GetAttributeChangedSignal("AtmosphereOverride"):Connect(function()
		refresh()
	end)
	RunService.Heartbeat:Connect(stepClock)
	task.spawn(function()
		while true do
			task.wait(AtmosphereConfig.ZoneCheckInterval)
			refresh()
		end
	end)
end

-- Force a preset on this client (above zones), or nil to release it.
function AtmosphereController:SetOverride(name: string?, seconds: number?)
	scriptedOverride = name
	scriptedSeconds = seconds
	activeName = nil -- re-apply even if the same preset is already showing
	refresh(seconds)
end

function AtmosphereController:GetActive(): (string?, BasePart?)
	return activeName, activeZone
end

return AtmosphereController
