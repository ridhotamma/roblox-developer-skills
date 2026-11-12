--!strict
-- Horror helper: one 0-1 "tension" value that pushes the screen and sound toward dread.
-- Drive it from gameplay, e.g. the monster's distance or line of sight:
--
--   Tension.Set(1 - math.clamp((distance - 15) / 60, 0, 1))  -- every frame or on a timer
--   Tension.Pulse(0.8, 1.5)                                    -- a scare: spike, hold, decay
--
-- What rises with tension: desaturation and contrast (its own ColorCorrection, stacked on the
-- preset's grade), a vignette, a heartbeat that speeds up, and the ambience ducking away so the
-- heartbeat and the monster are what you hear. With ReduceFlashing on, pulses rise gently.

local Lighting = game:GetService("Lighting")
local Players = game:GetService("Players")
local ReplicatedStorage = game:GetService("ReplicatedStorage")
local RunService = game:GetService("RunService")
local SoundService = game:GetService("SoundService")

local Ambience = require(script.Parent.Ambience)
local Atmosphere = require(ReplicatedStorage.Shared.Atmosphere.Atmosphere)
local AtmosphereConfig = require(ReplicatedStorage.Shared.Atmosphere.AtmosphereConfig)

local config = AtmosphereConfig.Tension

local Tension = {}

local target = 0
local pulse = 0
local pulseHold = 0
local value = 0

local grade = Instance.new("ColorCorrectionEffect")
grade.Name = "AtmosphereTension"
grade.Parent = Lighting

local heartbeat: Sound? = nil
if config.HeartbeatSoundId ~= "" then
	local s = Instance.new("Sound")
	s.Name = "TensionHeartbeat"
	s.SoundId = config.HeartbeatSoundId
	s.Looped = true
	s.Volume = 0
	s.Parent = SoundService
	heartbeat = s
end

local vignette: ImageLabel? = nil
if config.VignetteImageId ~= "" then
	local gui = Instance.new("ScreenGui")
	gui.Name = "TensionVignette"
	gui.IgnoreGuiInset = true
	gui.ResetOnSpawn = false
	gui.DisplayOrder = -10
	local image = Instance.new("ImageLabel")
	image.BackgroundTransparency = 1
	image.Size = UDim2.fromScale(1, 1)
	image.Image = config.VignetteImageId
	image.ImageColor3 = Color3.new(0, 0, 0)
	image.ImageTransparency = 1
	image.Parent = gui
	gui.Parent = Players.LocalPlayer:WaitForChild("PlayerGui")
	vignette = image
end

function Tension.Set(amount: number)
	target = math.clamp(amount, 0, 1)
end

-- A spike on top of the target (a jumpscare, a door slam, a near miss).
function Tension.Pulse(amount: number, holdSeconds: number?)
	pulse = math.max(pulse, math.clamp(amount, 0, 1))
	pulseHold = math.max(pulseHold, holdSeconds or 1)
end

function Tension.Get(): number
	return value
end

RunService.RenderStepped:Connect(function(dt: number)
	if pulseHold > 0 then
		pulseHold -= dt
	else
		pulse = math.max(0, pulse - dt * 0.5)
	end
	local goal = math.max(target, pulse)
	-- Rise faster than it falls, except for players who asked for gentler effects.
	local rate = if goal > value and not Atmosphere.ReduceFlashing() then config.Response * 2 else config.Response
	value += (goal - value) * (1 - math.exp(-dt * rate))

	local eased = value * value * (3 - 2 * value) -- smoothstep: nothing at low tension, a lot near 1
	grade.Saturation = -config.MaxDesaturate * eased
	grade.Contrast = config.MaxContrast * eased
	grade.TintColor = Color3.new(1, 1, 1):Lerp(config.Tint, eased)
	Ambience.SetDuck(config.AmbienceDuck * eased)

	local hb = heartbeat
	if hb then
		hb.Volume = 0.8 * eased
		hb.PlaybackSpeed = 0.85 + 0.6 * eased
		if eased > 0.02 and not hb.IsPlaying then
			hb:Play()
		elseif eased <= 0.02 and hb.IsPlaying then
			hb:Stop()
		end
	end
	local v = vignette
	if v then
		v.ImageTransparency = 1 - 0.85 * eased
	end
end)

return Tension
