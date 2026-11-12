--!strict
-- Applies an atmosphere preset to Lighting with a smooth blend.
--
--   Atmosphere.Apply("horror_woods", 3)            blend to a named preset over 3 s
--   Atmosphere.Apply(myPresetTable, 0)             snap to a custom preset table
--   Atmosphere.Apply(name, 2, { SkipClock = true }) leave ClockTime alone (the controller drives it)
--
-- It owns these instances and creates them if missing:
--   Lighting.Atmosphere · Lighting.Sky · Terrain.Clouds (the place's existing ones are reused)
--   Lighting.AtmosphereGrade (ColorCorrection) · AtmosphereBloom · AtmosphereSunRays · AtmosphereDepthOfField
-- Other effects in Lighting (e.g. a combat slow-mo ColorCorrection) are left alone and stack on top.
--
-- Use it on the client (AtmosphereController does). If the server changes Lighting properties,
-- those replicate and overwrite what clients set, so keep server code to the attributes that
-- AtmosphereService sets.

local CollectionService = game:GetService("CollectionService")
local Lighting = game:GetService("Lighting")
local Players = game:GetService("Players")
local RunService = game:GetService("RunService")
local SoundService = game:GetService("SoundService")
local TweenService = game:GetService("TweenService")

local AtmosphereConfig = require(script.Parent.AtmosphereConfig)
local AtmospherePresets = require(script.Parent.AtmospherePresets)

export type Preset = AtmospherePresets.Preset
export type ApplyOptions = { SkipClock: boolean? }

local Atmosphere = {}
Atmosphere.Presets = AtmospherePresets

-- What a missing effect section blends to, so effects fade out instead of popping.
local NEUTRAL: { [string]: { [string]: any } } = {
	Grade = { Brightness = 0, Contrast = 0, Saturation = 0, TintColor = Color3.new(1, 1, 1) },
	Bloom = { Intensity = 0 },
	SunRays = { Intensity = 0 },
	Clouds = { Cover = 0, Density = 0 },
	DepthOfField = { FarIntensity = 0, NearIntensity = 0 },
}

local OWNED: { [string]: { Class: string, Name: string, Singleton: boolean } } = {
	Atmosphere = { Class = "Atmosphere", Name = "Atmosphere", Singleton = true },
	Sky = { Class = "Sky", Name = "Sky", Singleton = true },
	Clouds = { Class = "Clouds", Name = "Clouds", Singleton = true },
	Grade = { Class = "ColorCorrectionEffect", Name = "AtmosphereGrade", Singleton = false },
	Bloom = { Class = "BloomEffect", Name = "AtmosphereBloom", Singleton = false },
	SunRays = { Class = "SunRaysEffect", Name = "AtmosphereSunRays", Singleton = false },
	DepthOfField = { Class = "DepthOfFieldEffect", Name = "AtmosphereDepthOfField", Singleton = false },
}

local tweens: { [Instance]: Tween } = {}
local clockDriver: NumberValue? = nil
local currentName: string? = nil
local currentPreset: Preset? = nil

local function instanceFor(section: string): Instance
	local spec = OWNED[section]
	local parent: Instance = if section == "Clouds" then workspace.Terrain else Lighting
	local found = parent:FindFirstChild(spec.Name)
	if found and not found:IsA(spec.Class) then
		found = nil
	end
	if not found and spec.Singleton then
		found = parent:FindFirstChildOfClass(spec.Class :: any)
	end
	if found then
		return found
	end
	local created = Instance.new(spec.Class :: any)
	created.Name = spec.Name
	created.Parent = parent
	return created
end

local function blend(target: Instance, props: { [string]: any }, seconds: number)
	local running = tweens[target]
	if running then
		running:Cancel()
		tweens[target] = nil
	end
	local animated = {}
	local any = false
	for key, value in props do
		local kind = typeof(value)
		if seconds > 0 and (kind == "number" or kind == "Color3") then
			animated[key] = value
			any = true
		else
			(target :: any)[key] = value
		end
	end
	if any then
		local tween = TweenService:Create(target, TweenInfo.new(seconds, Enum.EasingStyle.Sine, Enum.EasingDirection.InOut), animated)
		tweens[target] = tween
		tween:Play()
	end
end

-- ClockTime wraps at 24, so 23 -> 1 must go forward through midnight, not back through noon.
local function blendClock(target: number, seconds: number)
	if clockDriver then
		clockDriver:Destroy()
		clockDriver = nil
	end
	local start = Lighting.ClockTime
	local delta = ((target - start + 12) % 24) - 12
	if seconds <= 0 or math.abs(delta) < 1e-3 then
		Lighting.ClockTime = target % 24
		return
	end
	local driver = Instance.new("NumberValue")
	clockDriver = driver
	driver.Changed:Connect(function(v: number)
		Lighting.ClockTime = (start + v) % 24
	end)
	local tween = TweenService:Create(driver, TweenInfo.new(seconds, Enum.EasingStyle.Sine, Enum.EasingDirection.InOut), { Value = delta })
	tween.Completed:Connect(function()
		if clockDriver == driver then
			driver:Destroy()
			clockDriver = nil
		end
	end)
	tween:Play()
end

local function applyAccent(color: Color3, seconds: number)
	for _, tagged in CollectionService:GetTagged(AtmosphereConfig.AccentTag) do
		local targets = { tagged }
		for _, d in tagged:GetDescendants() do
			table.insert(targets, d)
		end
		for _, t in targets do
			if t:IsA("Light") then
				blend(t, { Color = color }, seconds)
			elseif t:IsA("BasePart") and t.Material == Enum.Material.Neon then
				blend(t, { Color = color }, seconds)
			end
		end
	end
end

function Atmosphere.Get(name: string): Preset?
	local preset = AtmospherePresets[name]
	if not preset then
		warn(`[Atmosphere] unknown preset '{name}'`)
	end
	return preset
end

function Atmosphere.Apply(nameOrPreset: string | Preset, seconds: number?, options: ApplyOptions?): Preset?
	local preset: Preset? = if typeof(nameOrPreset) == "string" then Atmosphere.Get(nameOrPreset) else nameOrPreset
	if not preset then
		return nil
	end
	local t = math.max(seconds or AtmosphereConfig.TransitionSeconds, 0)

	local lightingProps = table.clone(preset.Lighting)
	local clock = lightingProps.ClockTime
	lightingProps.ClockTime = nil
	blend(Lighting, lightingProps, t)
	if typeof(clock) == "number" and not (options and options.SkipClock) then
		blendClock(clock, t)
	end

	for section in OWNED do
		local props = (preset :: any)[section] or NEUTRAL[section]
		if props then
			blend(instanceFor(section), props, t)
		end
	end

	if preset.Reverb then
		local ok, reverb = pcall(function()
			return (Enum.ReverbType :: any)[preset.Reverb]
		end)
		if ok and reverb then
			SoundService.AmbientReverb = reverb
		end
	end
	if preset.Accent then
		applyAccent(preset.Accent, t)
	end

	currentName = if typeof(nameOrPreset) == "string" then nameOrPreset else preset.Label
	currentPreset = preset
	return preset
end

function Atmosphere.Current(): (string?, Preset?)
	return currentName, currentPreset
end

-- Whether this client wants gentler flashes (player attribute set by your settings menu).
function Atmosphere.ReduceFlashing(): boolean
	if RunService:IsClient() then
		local player = Players.LocalPlayer
		local value = player and player:GetAttribute(AtmosphereConfig.ReduceFlashingAttribute)
		if typeof(value) == "boolean" then
			return value
		end
	end
	return AtmosphereConfig.ReduceFlashingDefault
end

return Atmosphere
