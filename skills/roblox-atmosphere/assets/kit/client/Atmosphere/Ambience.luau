--!strict
-- Ambient sound for the active preset: a looping bed that crossfades between presets, plus
-- "details" (a crow, a drip, a distant door) played at random 3D points around the player so
-- the world feels alive and, in horror, never quite safe.
--
--   Ambience.Set("cave_drips", 2)   crossfade to an AtmosphereConfig.Ambiences entry (nil = silence)
--   Ambience.SetDuck(0.6)           lower everything by 60% (tension, dialogue, cutscenes)
--
-- Everything plays through SoundService.Ambience (a SoundGroup) so a settings slider can set
-- its Volume.

local Players = game:GetService("Players")
local ReplicatedStorage = game:GetService("ReplicatedStorage")
local SoundService = game:GetService("SoundService")
local TweenService = game:GetService("TweenService")

local AtmosphereConfig = require(ReplicatedStorage.Shared.Atmosphere.AtmosphereConfig)

type Entry = {
	Bed: string,
	BedVolume: number,
	Details: { string },
	DetailEvery: { number },
	DetailVolume: number,
}

local Ambience = {}

local group = SoundService:FindFirstChild("Ambience") :: SoundGroup?
if not group then
	local g = Instance.new("SoundGroup")
	g.Name = "Ambience"
	g.Volume = 1
	g.Parent = SoundService
	group = g
end
local soundGroup = group :: SoundGroup

-- Ducking multiplies into each sound's own volume, so the player's slider (group.Volume) is
-- never touched.
local duck = 0
local currentKey: string? = nil
local bed: Sound? = nil
local bedVolume = 0
local generation = 0

local function entryFor(key: string?): Entry?
	if not key then
		return nil
	end
	local entry = (AtmosphereConfig.Ambiences :: any)[key]
	if not entry then
		warn(`[Ambience] no entry '{key}' in AtmosphereConfig.Ambiences`)
	end
	return entry
end

local function listenerPosition(): Vector3?
	local character = Players.LocalPlayer.Character
	local root = character and character:FindFirstChild("HumanoidRootPart")
	if root and root:IsA("BasePart") then
		return root.Position
	end
	local camera = workspace.CurrentCamera
	return camera and camera.CFrame.Position
end

local function playDetail(id: string, volume: number)
	local position = listenerPosition()
	if not position then
		return
	end
	local angle = math.random() * math.pi * 2
	local distance = 25 + math.random() * 45
	local point = position + Vector3.new(math.cos(angle) * distance, math.random(-2, 8), math.sin(angle) * distance)

	local attachment = Instance.new("Attachment")
	attachment.WorldPosition = point
	attachment.Parent = workspace.Terrain
	local s = Instance.new("Sound")
	s.SoundId = id
	s.Volume = volume * (1 - duck)
	s.PlaybackSpeed = 0.9 + math.random() * 0.2
	s.RollOffMode = Enum.RollOffMode.InverseTapered
	s.RollOffMinDistance = 15
	s.RollOffMaxDistance = 150
	s.SoundGroup = soundGroup
	s.Parent = attachment
	s:Play()
	s.Ended:Once(function()
		attachment:Destroy()
	end)
	task.delay(30, function()
		if attachment.Parent then
			attachment:Destroy()
		end
	end)
end

local function detailLoop(entry: Entry, myGeneration: number)
	local valid = {}
	for _, id in entry.Details do
		if id ~= "" then
			table.insert(valid, id)
		end
	end
	if #valid == 0 then
		return
	end
	local low, high = entry.DetailEvery[1], entry.DetailEvery[2]
	while generation == myGeneration do
		task.wait(low + math.random() * (high - low))
		if generation ~= myGeneration then
			return
		end
		playDetail(valid[math.random(1, #valid)], entry.DetailVolume)
	end
end

function Ambience.Set(key: string?, seconds: number?)
	if key == currentKey then
		return
	end
	currentKey = key
	generation += 1
	local t = math.max(seconds or 2, 0.1)

	local old = bed
	if old then
		local fade = TweenService:Create(old, TweenInfo.new(t), { Volume = 0 })
		fade.Completed:Once(function()
			old:Destroy()
		end)
		fade:Play()
	end
	bed = nil

	local entry = entryFor(key)
	if not entry then
		return
	end
	if entry.Bed ~= "" then
		local s = Instance.new("Sound")
		s.Name = "AmbienceBed"
		s.SoundId = entry.Bed
		s.Looped = true
		s.Volume = 0
		s.SoundGroup = soundGroup
		s.Parent = SoundService
		s:Play()
		bed = s
		bedVolume = entry.BedVolume
		TweenService:Create(s, TweenInfo.new(t), { Volume = bedVolume * (1 - duck) }):Play()
	end
	task.spawn(detailLoop, entry, generation)
end

-- 0 = normal, 1 = silent. Smooth it yourself if you call this every frame (Tension does).
function Ambience.SetDuck(amount: number)
	amount = math.clamp(amount, 0, 1)
	if math.abs(amount - duck) < 1e-3 then
		return -- unchanged: don't fight a crossfade tween that's running
	end
	duck = amount
	local s = bed
	if s then
		s.Volume = bedVolume * (1 - duck)
	end
end

function Ambience.Current(): string?
	return currentKey
end

return Ambience
