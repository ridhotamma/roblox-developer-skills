--!strict
-- The client's music brain: collects sources (server attributes, fear emitters, your own client
-- code), runs MusicDirector every frame, and tells MusicPlayer which cue and intensity to play.
--
--   MusicController:SetSource("enemy:12", "combat", 0.6)   -- an enemy has spotted me
--   MusicController:SetSource("gunfire", "combat", 0.95, 2) -- a 2 s spike
--   MusicController:ClearSource("enemy:12")
--   MusicController:PlayStinger("discover")
--   MusicController:Duck(0.6)  ... MusicController:Duck(0)    -- dialogue
--   MusicController:Preload("epic_boss")                       -- load before the boss door opens
--   MusicController.Changed:Connect(function(state, cue) end)
--   MusicController.Beat:Connect(function(bar, beat) end)       -- music-synced gameplay / VFX
--
-- Server-driven music (round states, wanted level, boss fights) goes through MusicService, which
-- only sets attributes; this controller turns them into sources "server" and "server:player".

local CollectionService = game:GetService("CollectionService")
local Players = game:GetService("Players")
local ReplicatedStorage = game:GetService("ReplicatedStorage")
local RunService = game:GetService("RunService")

local MusicConfig = require(ReplicatedStorage.Shared.Music.MusicConfig)
local MusicDirector = require(ReplicatedStorage.Shared.Music.MusicDirector)
local MusicPlayer = require(script.Parent.Parent.Music.MusicPlayer)
local Signal = require(ReplicatedStorage.Packages.Signal)

local localPlayer = Players.LocalPlayer
local attrs = MusicConfig.Attributes

local MusicController = {}
-- (state: string, cue: string?)
MusicController.Changed = Signal.new()
-- (bar: number, beat: number) on every beat of the playing cue
MusicController.Beat = Signal.new()

local director: MusicDirector.Director
local player: MusicPlayer.MusicPlayer
local enabled = true
local lastBar, lastBeat = 0, 0
local emitterAccum = 0
local emitterStates: { [string]: boolean } = {}

local function directorConfig()
	local d = MusicConfig.Director
	return {
		States = MusicConfig.States,
		BaseState = MusicConfig.BaseState,
		Attack = d.Attack,
		Release = d.Release,
		IntensityHold = d.IntensityHold,
		StateHold = d.StateHold,
	}
end

local function applyState(state: string, previous: string?)
	local def = MusicConfig.States[state]
	local prevDef = previous and MusicConfig.States[previous]
	local cue = if enabled then def.Cue else nil
	player:Play(cue, {
		Sync = def.Sync,
		Fade = def.Fade,
		Entry = def.Entry,
		Intro = def.Intro,
		Ending = prevDef ~= nil and prevDef.Ending == true,
	})
	if enabled and def.Stinger and (prevDef == nil or def.Priority > prevDef.Priority) then
		player:PlayStinger(def.Stinger, { Cue = def.Cue })
	end
	MusicController.Changed:Fire(state, cue)
end

-- Attributes from MusicService: State + Intensity on workspace (everyone) and on the Player.
local function watchStateAttributes(instance: Instance, sourceId: string)
	local function refresh()
		local state = instance:GetAttribute(attrs.State)
		if typeof(state) == "string" and MusicConfig.States[state] then
			local intensity = instance:GetAttribute(attrs.Intensity)
			director:SetSource(sourceId, state, if typeof(intensity) == "number" then intensity else 0)
		else
			director:ClearSource(sourceId)
		end
	end
	instance:GetAttributeChangedSignal(attrs.State):Connect(refresh)
	instance:GetAttributeChangedSignal(attrs.Intensity):Connect(refresh)
	refresh()
	-- Stingers arrive as "name#counter" so the same stinger twice still fires the signal.
	instance:GetAttributeChangedSignal(attrs.Stinger):Connect(function()
		local value = instance:GetAttribute(attrs.Stinger)
		if typeof(value) == "string" then
			local name = string.match(value, "^([^#]+)")
			if name then
				MusicController:PlayStinger(name)
			end
		end
	end)
end

local function listenerPosition(): Vector3?
	local character = localPlayer.Character
	local root = character and character:FindFirstChild("HumanoidRootPart")
	if root and root:IsA("BasePart") then
		return root.Position
	end
	local camera = workspace.CurrentCamera
	return camera and camera.CFrame.Position
end

-- Dead Space-style fear emitters: the closest, strongest emitter per state sets that state's
-- source; intensity falls off linearly to 0 at Radius.
local function updateEmitters()
	local position = listenerPosition()
	local best: { [string]: number } = {}
	if position then
		for _, part in CollectionService:GetTagged(MusicConfig.Emitters.Tag) do
			if not part:IsA("BasePart") then
				continue
			end
			local state = part:GetAttribute("State")
			if typeof(state) ~= "string" or not MusicConfig.States[state] then
				continue
			end
			local radius = part:GetAttribute("Radius")
			local r = if typeof(radius) == "number" and radius > 0 then radius else MusicConfig.Emitters.DefaultRadius
			local distance = (part.Position - position).Magnitude
			if distance < r then
				local peak = part:GetAttribute("Intensity")
				local level = (if typeof(peak) == "number" then peak else 1) * (1 - distance / r)
				best[state] = math.max(best[state] or 0, level)
			end
		end
	end
	for state in emitterStates do
		if not best[state] then
			director:ClearSource("emitter:" .. state)
			emitterStates[state] = nil
		end
	end
	for state, level in best do
		director:SetSource("emitter:" .. state, state, level)
		emitterStates[state] = true
	end
end

local function readVolume()
	local v = localPlayer:GetAttribute(MusicConfig.VolumeAttribute)
	local setting = if typeof(v) == "number" then math.clamp(v, 0, 1) else 1
	player:SetVolume((MusicConfig.Volume or 0.5) * setting)
end

function MusicController:Init()
	director = MusicDirector.new(directorConfig())
	player = MusicPlayer.new(MusicConfig)
end

function MusicController:Start()
	watchStateAttributes(workspace, "server")
	watchStateAttributes(localPlayer, "server:player")
	local function readBase()
		local base = workspace:GetAttribute(attrs.Base)
		director:SetBase(if typeof(base) == "string" and MusicConfig.States[base] then base else MusicConfig.BaseState)
	end
	workspace:GetAttributeChangedSignal(attrs.Base):Connect(readBase)
	readBase()
	localPlayer:GetAttributeChangedSignal(MusicConfig.VolumeAttribute):Connect(readVolume)
	readVolume()

	applyState(director.state, nil)
	player:SetIntensity(director.intensity)

	RunService.Heartbeat:Connect(function(dt)
		emitterAccum += dt
		if emitterAccum >= MusicConfig.Emitters.Interval then
			emitterAccum = 0
			updateEmitters()
		end
		local previous = director.state
		local state, intensity, changed = director:Update(dt)
		if changed then
			applyState(state, previous)
		end
		player:SetIntensity(intensity)
		player:Update(dt)

		local _, bar, beat = player:Position()
		if bar and beat and (bar ~= lastBar or beat ~= lastBeat) then
			lastBar, lastBeat = bar, beat
			MusicController.Beat:Fire(bar, beat)
		end
	end)
end

function MusicController:SetSource(id: string, state: string, intensity: number?, ttl: number?)
	director:SetSource(id, state, intensity, ttl)
end

function MusicController:ClearSource(id: string)
	director:ClearSource(id)
end

function MusicController:SetBase(state: string)
	director:SetBase(state)
end

function MusicController:PlayStinger(name: string)
	if enabled then
		player:PlayStinger(name, { Cue = MusicConfig.States[director.state].Cue })
	end
end

-- Load a cue's stems ahead of time so the first switch to it is instant.
function MusicController:Preload(cueName: string)
	player:Preload(cueName)
end

function MusicController:Duck(amount: number)
	player:Duck(amount)
end

-- Turn music off/on (a settings toggle). Off fades out on the next bar; sources keep updating.
function MusicController:SetEnabled(on: boolean)
	if enabled == on then
		return
	end
	enabled = on
	applyState(director.state, nil)
end

function MusicController:GetState(): (string, number)
	return director.state, director.intensity
end

return MusicController
