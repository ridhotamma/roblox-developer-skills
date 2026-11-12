--!strict
-- Client weather around the camera: rain, storm (rain + lightning), snow, blizzard, dust, ash,
-- embers, fireflies, spores, bubbles.
--
--   Weather.Set({ Type = "rain", Intensity = 0.8 }, 2)   blend in over 2 s
--   Weather.Set(nil, 2)                                   fade out
--
-- Particles spawn in a box that follows the camera but are not locked to it, so they fall through
-- the world naturally. Under a roof (raycast up) emission stops and the loop sound is muffled.

local Lighting = game:GetService("Lighting")
local Players = game:GetService("Players")
local ReplicatedStorage = game:GetService("ReplicatedStorage")
local RunService = game:GetService("RunService")
local SoundService = game:GetService("SoundService")
local TweenService = game:GetService("TweenService")

local Atmosphere = require(ReplicatedStorage.Shared.Atmosphere.Atmosphere)
local AtmosphereConfig = require(ReplicatedStorage.Shared.Atmosphere.AtmosphereConfig)

local config = AtmosphereConfig.Weather
local textures = config.Textures

type Kind = {
	Texture: string,
	Rate: number, -- particles per second at Intensity 1
	Box: Vector3, -- emitter volume around the camera
	Offset: Vector3, -- box centre relative to the camera
	Direction: Enum.NormalId,
	Speed: NumberRange,
	Lifetime: NumberRange,
	Size: number,
	Squash: number?,
	Parallel: boolean?, -- stretch along velocity (rain streaks)
	Color: Color3,
	Transparency: number,
	Light: number, -- LightEmission
	Acceleration: Vector3,
	SpreadAngle: Vector2,
	Twinkle: boolean?,
	Sound: string?,
	Lightning: boolean?,
}

local KINDS: { [string]: Kind } = {
	rain = {
		Texture = textures.Streak, Rate = 700, Box = Vector3.new(70, 1, 70), Offset = Vector3.new(0, 35, 0),
		Direction = Enum.NormalId.Bottom, Speed = NumberRange.new(80, 100), Lifetime = NumberRange.new(0.7, 0.9),
		Size = 0.12, Squash = 4, Parallel = true, Color = Color3.fromRGB(200, 212, 230), Transparency = 0.45,
		Light = 0.1, Acceleration = Vector3.new(4, 0, 2), SpreadAngle = Vector2.new(3, 3), Sound = "rain",
	},
	storm = {
		Texture = textures.Streak, Rate = 1200, Box = Vector3.new(70, 1, 70), Offset = Vector3.new(0, 35, 0),
		Direction = Enum.NormalId.Bottom, Speed = NumberRange.new(95, 120), Lifetime = NumberRange.new(0.6, 0.8),
		Size = 0.13, Squash = 4, Parallel = true, Color = Color3.fromRGB(190, 200, 215), Transparency = 0.4,
		Light = 0.1, Acceleration = Vector3.new(18, 0, 6), SpreadAngle = Vector2.new(6, 6), Sound = "storm",
		Lightning = true,
	},
	snow = {
		Texture = textures.Soft, Rate = 160, Box = Vector3.new(80, 1, 80), Offset = Vector3.new(0, 30, 0),
		Direction = Enum.NormalId.Bottom, Speed = NumberRange.new(4, 7), Lifetime = NumberRange.new(6, 9),
		Size = 0.3, Color = Color3.fromRGB(255, 255, 255), Transparency = 0.1, Light = 0.3,
		Acceleration = Vector3.new(1, 0, 0.5), SpreadAngle = Vector2.new(25, 25), Sound = "snow",
	},
	blizzard = {
		Texture = textures.Soft, Rate = 900, Box = Vector3.new(70, 30, 70), Offset = Vector3.new(-20, 10, 0),
		Direction = Enum.NormalId.Right, Speed = NumberRange.new(30, 45), Lifetime = NumberRange.new(1.5, 2.5),
		Size = 0.28, Squash = 1.5, Parallel = true, Color = Color3.fromRGB(245, 250, 255), Transparency = 0.2,
		Light = 0.3, Acceleration = Vector3.new(10, -6, 4), SpreadAngle = Vector2.new(15, 15), Sound = "blizzard",
	},
	dust = {
		Texture = textures.Soft, Rate = 30, Box = Vector3.new(60, 20, 60), Offset = Vector3.new(0, 4, 0),
		Direction = Enum.NormalId.Right, Speed = NumberRange.new(2, 5), Lifetime = NumberRange.new(5, 9),
		Size = 3.5, Color = Color3.fromRGB(210, 180, 140), Transparency = 0.88, Light = 0,
		Acceleration = Vector3.new(1, 0.1, 0.3), SpreadAngle = Vector2.new(40, 40), Sound = "dust",
	},
	ash = {
		Texture = textures.Soft, Rate = 90, Box = Vector3.new(70, 1, 70), Offset = Vector3.new(0, 25, 0),
		Direction = Enum.NormalId.Bottom, Speed = NumberRange.new(2, 4), Lifetime = NumberRange.new(7, 11),
		Size = 0.18, Color = Color3.fromRGB(150, 148, 145), Transparency = 0.2, Light = 0,
		Acceleration = Vector3.new(0.6, 0, 0.3), SpreadAngle = Vector2.new(35, 35),
	},
	embers = {
		Texture = textures.Spark, Rate = 30, Box = Vector3.new(50, 4, 50), Offset = Vector3.new(0, -6, 0),
		Direction = Enum.NormalId.Top, Speed = NumberRange.new(2, 6), Lifetime = NumberRange.new(3, 6),
		Size = 0.25, Color = Color3.fromRGB(255, 140, 50), Transparency = 0, Light = 1,
		Acceleration = Vector3.new(0.5, 1.5, 0.3), SpreadAngle = Vector2.new(30, 30), Twinkle = true,
	},
	fireflies = {
		Texture = textures.Spark, Rate = 8, Box = Vector3.new(60, 12, 60), Offset = Vector3.new(0, 2, 0),
		Direction = Enum.NormalId.Top, Speed = NumberRange.new(0.3, 1.2), Lifetime = NumberRange.new(5, 9),
		Size = 0.35, Color = Color3.fromRGB(220, 255, 120), Transparency = 0, Light = 1,
		Acceleration = Vector3.new(0, 0, 0), SpreadAngle = Vector2.new(180, 180), Twinkle = true,
	},
	spores = {
		Texture = textures.Soft, Rate = 25, Box = Vector3.new(60, 20, 60), Offset = Vector3.new(0, 4, 0),
		Direction = Enum.NormalId.Top, Speed = NumberRange.new(0.3, 1), Lifetime = NumberRange.new(6, 10),
		Size = 0.3, Color = Color3.fromRGB(200, 255, 220), Transparency = 0.2, Light = 0.8,
		Acceleration = Vector3.new(0.2, 0.15, 0.1), SpreadAngle = Vector2.new(180, 180), Twinkle = true,
	},
	bubbles = {
		Texture = textures.Spark, Rate = 40, Box = Vector3.new(50, 4, 50), Offset = Vector3.new(0, -10, 0),
		Direction = Enum.NormalId.Top, Speed = NumberRange.new(3, 6), Lifetime = NumberRange.new(4, 7),
		Size = 0.25, Color = Color3.fromRGB(210, 250, 255), Transparency = 0.3, Light = 0.4,
		Acceleration = Vector3.new(0, 1, 0), SpreadAngle = Vector2.new(10, 10),
	},
}

local Weather = {}

type Active = {
	Kind: Kind,
	Type: string,
	Intensity: number,
	Part: BasePart,
	Emitter: ParticleEmitter,
	Sound: Sound?,
	Muffle: EqualizerSoundEffect?,
}

local active: Active? = nil
local sheltered = false
local lastShelterCheck = 0
local flash: ColorCorrectionEffect? = nil

local function sequence(base: number, twinkle: boolean?): NumberSequence
	if twinkle then
		return NumberSequence.new({
			NumberSequenceKeypoint.new(0, 1),
			NumberSequenceKeypoint.new(0.2, base),
			NumberSequenceKeypoint.new(0.45, math.min(1, base + 0.6)),
			NumberSequenceKeypoint.new(0.7, base),
			NumberSequenceKeypoint.new(1, 1),
		})
	end
	return NumberSequence.new({
		NumberSequenceKeypoint.new(0, 1),
		NumberSequenceKeypoint.new(0.1, base),
		NumberSequenceKeypoint.new(0.85, base),
		NumberSequenceKeypoint.new(1, 1),
	})
end

local function build(kindName: string, kind: Kind): (BasePart, ParticleEmitter)
	local part = Instance.new("Part")
	part.Name = "Weather_" .. kindName
	part.Anchored = true
	part.CanCollide = false
	part.CanQuery = false
	part.CanTouch = false
	part.CastShadow = false
	part.Transparency = 1
	part.Size = kind.Box

	local emitter = Instance.new("ParticleEmitter")
	emitter.Texture = kind.Texture
	emitter.Rate = 0
	emitter.EmissionDirection = kind.Direction
	emitter.Shape = Enum.ParticleEmitterShape.Box
	emitter.ShapeStyle = Enum.ParticleEmitterShapeStyle.Volume
	emitter.Speed = kind.Speed
	emitter.Lifetime = kind.Lifetime
	emitter.Size = NumberSequence.new(kind.Size)
	emitter.Squash = NumberSequence.new(kind.Squash or 0)
	emitter.Orientation = if kind.Parallel
		then Enum.ParticleOrientation.VelocityParallel
		else Enum.ParticleOrientation.FacingCamera
	emitter.Color = ColorSequence.new(kind.Color)
	emitter.Transparency = sequence(kind.Transparency, kind.Twinkle)
	emitter.LightEmission = kind.Light
	emitter.LightInfluence = 1 - kind.Light
	emitter.Acceleration = kind.Acceleration
	emitter.SpreadAngle = kind.SpreadAngle
	emitter.Rotation = NumberRange.new(0, 360)
	emitter.LockedToPart = false
	emitter.Parent = part

	part.Parent = workspace.CurrentCamera
	return part, emitter
end

local function targetRate(a: Active): number
	return if sheltered then 0 else a.Kind.Rate * a.Intensity
end

local function soundVolume(a: Active): number
	return config.SoundVolume * math.clamp(a.Intensity, 0, 1)
end

local function fadeOut(a: Active, seconds: number)
	local t = math.max(seconds, 0.1)
	TweenService:Create(a.Emitter, TweenInfo.new(t), { Rate = 0 }):Play()
	if a.Sound then
		TweenService:Create(a.Sound, TweenInfo.new(t), { Volume = 0 }):Play()
	end
	task.delay(t + a.Kind.Lifetime.Max, function()
		a.Part:Destroy()
		if a.Sound then
			a.Sound:Destroy()
		end
	end)
end

local function lightningLoop(a: Active)
	while active == a do
		task.wait(math.random(60, 160) / 10)
		if active ~= a then
			return
		end
		local gentle = Atmosphere.ReduceFlashing()
		if not flash or not flash.Parent then
			local c = Instance.new("ColorCorrectionEffect")
			c.Name = "WeatherFlash"
			c.Parent = Lighting
			flash = c
		end
		local f = flash :: ColorCorrectionEffect
		local peak = (if gentle then 0.08 else 0.4) * math.clamp(a.Intensity, 0.3, 1)
		f.Brightness = peak
		TweenService:Create(f, TweenInfo.new(if gentle then 0.6 else 0.25), { Brightness = 0 }):Play()
		if not gentle then
			task.delay(0.12, function()
				f.Brightness = peak * 0.7
				TweenService:Create(f, TweenInfo.new(0.35), { Brightness = 0 }):Play()
			end)
		end
		local thunderId = config.Sounds.thunder
		if thunderId ~= "" then
			task.delay(math.random(4, 25) / 10, function()
				local s = Instance.new("Sound")
				s.SoundId = thunderId
				s.Volume = config.SoundVolume * (0.6 + math.random() * 0.4)
				s.PlaybackSpeed = 0.9 + math.random() * 0.2
				s.Parent = SoundService
				s:Play()
				s.Ended:Once(function()
					s:Destroy()
				end)
			end)
		end
	end
end

local function updateShelter(camera: Camera)
	if not config.ShelterCheck or not active then
		sheltered = false
		return
	end
	local params = RaycastParams.new()
	params.FilterType = Enum.RaycastFilterType.Exclude
	local ignore: { Instance } = { camera }
	local character = Players.LocalPlayer.Character
	if character then
		table.insert(ignore, character)
	end
	params.FilterDescendantsInstances = ignore
	params.IgnoreWater = true
	local hit = workspace:Raycast(camera.CFrame.Position, Vector3.new(0, config.ShelterHeight, 0), params)
	local now = hit ~= nil
	if now == sheltered then
		return
	end
	sheltered = now
	local a = active :: Active
	TweenService:Create(a.Emitter, TweenInfo.new(0.4), { Rate = targetRate(a) }):Play()
	if a.Muffle then
		TweenService:Create(a.Muffle, TweenInfo.new(0.4), { HighGain = if sheltered then -25 else 0, MidGain = if sheltered then -8 else 0 }):Play()
	end
end

function Weather.Set(weather: { Type: string, Intensity: number }?, seconds: number?)
	local t = math.max(seconds or 2, 0)
	local current = active

	if weather and current and current.Type == weather.Type then
		current.Intensity = weather.Intensity
		TweenService:Create(current.Emitter, TweenInfo.new(math.max(t, 0.1)), { Rate = targetRate(current) }):Play()
		if current.Sound then
			TweenService:Create(current.Sound, TweenInfo.new(math.max(t, 0.1)), { Volume = soundVolume(current) }):Play()
		end
		return
	end

	if current then
		active = nil
		fadeOut(current, t)
	end
	if not weather then
		return
	end
	local kind = KINDS[weather.Type]
	if not kind then
		warn(`[Weather] unknown type '{weather.Type}'`)
		return
	end

	local part, emitter = build(weather.Type, kind)
	local a: Active = {
		Kind = kind,
		Type = weather.Type,
		Intensity = weather.Intensity,
		Part = part,
		Emitter = emitter,
		Sound = nil,
		Muffle = nil,
	}
	local soundId = kind.Sound and (config.Sounds :: any)[kind.Sound]
	if typeof(soundId) == "string" and soundId ~= "" then
		local s = Instance.new("Sound")
		s.Name = "Weather_" .. weather.Type
		s.SoundId = soundId
		s.Looped = true
		s.Volume = 0
		local eq = Instance.new("EqualizerSoundEffect")
		eq.HighGain, eq.MidGain, eq.LowGain = 0, 0, 0
		eq.Parent = s
		s.Parent = SoundService
		s:Play()
		a.Sound, a.Muffle = s, eq
		TweenService:Create(s, TweenInfo.new(math.max(t, 0.1)), { Volume = soundVolume(a) }):Play()
	end
	active = a
	sheltered = false
	TweenService:Create(emitter, TweenInfo.new(math.max(t, 0.1)), { Rate = targetRate(a) }):Play()
	if kind.Lightning then
		task.spawn(lightningLoop, a)
	end
end

function Weather.Get(): (string?, number)
	local a = active
	if a then
		return a.Type, a.Intensity
	end
	return nil, 0
end

function Weather.IsSheltered(): boolean
	return sheltered
end

RunService.RenderStepped:Connect(function()
	local a = active
	local camera = workspace.CurrentCamera
	if not a or not camera then
		return
	end
	a.Part.CFrame = CFrame.new(camera.CFrame.Position + a.Kind.Offset)
	if a.Part.Parent ~= camera then
		a.Part.Parent = camera
	end
	local now = os.clock()
	if now - lastShelterCheck > 0.25 then
		lastShelterCheck = now
		updateShelter(camera)
	end
end)

return Weather
