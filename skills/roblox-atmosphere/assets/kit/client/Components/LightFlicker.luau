--!strict
-- Client-only light behaviour. Tag a Light, a Part or a Model "Flicker"; every PointLight,
-- SpotLight and SurfaceLight inside it (and Neon parts, which dim with it) follows a style:
--
--   Attribute Style = "Candle"       soft constant waver (torches, candles, campfires)
--                     "Fluorescent"  steady, with an occasional stutter (offices, hospitals, liminal)
--                     "Broken"       mostly dark, sputters on in bursts (horror set pieces)
--                     "Pulse"        slow breathing glow (alarms, magic, sci-fi standby)
--   Attribute Speed  = number, default 1
--
-- Players with ReduceFlashing get the same mood with no hard on/off: stutters become dips and
-- nothing changes more than ~2 times a second (keeps clear of the 3-flashes-per-second limit).
-- One RenderStepped loop serves every light, and lights far from the camera are skipped.

local ReplicatedStorage = game:GetService("ReplicatedStorage")
local RunService = game:GetService("RunService")

local Atmosphere = require(ReplicatedStorage.Shared.Atmosphere.Atmosphere)

local MAX_DISTANCE = 220

type Entry = {
	Root: Instance,
	Lights: { { Light: Light, Base: number } },
	Neon: { { Part: BasePart, Base: number } },
	Style: string,
	Speed: number,
	Seed: number,
	Clock: number,
	-- state for stutter styles
	NextEvent: number,
	Until: number,
	On: boolean,
}

local entries: { Entry } = {}
local connection: RBXScriptConnection? = nil

local function positionOf(root: Instance): Vector3?
	if root:IsA("BasePart") then
		return root.Position
	elseif root:IsA("Model") then
		return root:GetPivot().Position
	elseif root:IsA("Light") and root.Parent and root.Parent:IsA("BasePart") then
		return root.Parent.Position
	end
	return nil
end

local function level(e: Entry, dt: number, gentle: boolean): number
	e.Clock += dt * e.Speed
	local t = e.Clock
	if e.Style == "Pulse" then
		return 0.45 + 0.55 * (0.5 + 0.5 * math.sin(t * 2.2))
	elseif e.Style == "Candle" then
		local n = math.noise(t * 3, e.Seed) * 0.6 + math.noise(t * 9, e.Seed + 7) * 0.4
		return 0.88 + n * (if gentle then 0.12 else 0.25)
	end

	-- Fluorescent and Broken: events at random times; "On" toggles quickly inside an event.
	local broken = e.Style == "Broken"
	if t >= e.NextEvent then
		e.Until = t + (if broken then 0.4 + math.random() * 1.6 else 0.15 + math.random() * 0.45)
		e.NextEvent = e.Until + (if broken then 1 + math.random() * 4 else 3 + math.random() * 9)
	end
	local inEvent = t < e.Until
	if not inEvent then
		return if broken then 0.03 else 1
	end
	local rate = if gentle then 2 else 14 -- toggles per second
	local phase = math.floor(t * rate + e.Seed)
	e.On = (phase % 2 == 0) == (math.noise(phase, e.Seed) > -0.2)
	if gentle then
		return if broken then (if e.On then 0.55 else 0.25) else (if e.On then 1 else 0.6)
	end
	return if e.On then 1 else (if broken then 0 else 0.08)
end

local function step(dt: number)
	local camera = workspace.CurrentCamera
	if not camera then
		return
	end
	local eye = camera.CFrame.Position
	local gentle = Atmosphere.ReduceFlashing()
	for _, e in entries do
		local p = positionOf(e.Root)
		if p and (p - eye).Magnitude > MAX_DISTANCE then
			continue
		end
		local k = level(e, dt, gentle)
		for _, l in e.Lights do
			l.Light.Brightness = l.Base * k
		end
		for _, n in e.Neon do
			n.Part.Transparency = n.Base + (1 - n.Base) * (1 - k) * 0.85
		end
	end
end

local function setup(instance: Instance, trove: any)
	local style = instance:GetAttribute("Style")
	local speed = instance:GetAttribute("Speed")
	local entry: Entry = {
		Root = instance,
		Lights = {},
		Neon = {},
		Style = if typeof(style) == "string" then style else "Candle",
		Speed = if typeof(speed) == "number" then speed else 1,
		Seed = math.random() * 100,
		Clock = math.random() * 10,
		NextEvent = math.random() * 4,
		Until = 0,
		On = true,
	}
	local candidates = instance:GetDescendants()
	table.insert(candidates, instance)
	for _, d in candidates do
		if d:IsA("Light") then
			table.insert(entry.Lights, { Light = d, Base = d.Brightness })
		elseif d:IsA("BasePart") and d.Material == Enum.Material.Neon then
			table.insert(entry.Neon, { Part = d, Base = d.Transparency })
		end
	end
	table.insert(entries, entry)
	-- Style and Speed can change live (e.g. the server switches lamps to "Broken" near a monster).
	trove:Connect(instance:GetAttributeChangedSignal("Style"), function()
		local s = instance:GetAttribute("Style")
		entry.Style = if typeof(s) == "string" then s else "Candle"
	end)
	trove:Connect(instance:GetAttributeChangedSignal("Speed"), function()
		local s = instance:GetAttribute("Speed")
		entry.Speed = if typeof(s) == "number" then s else 1
	end)
	if not connection then
		connection = RunService.RenderStepped:Connect(step)
	end

	trove:Add(function()
		local index = table.find(entries, entry)
		if index then
			table.remove(entries, index)
		end
		for _, l in entry.Lights do
			l.Light.Brightness = l.Base
		end
		for _, n in entry.Neon do
			n.Part.Transparency = n.Base
		end
		if #entries == 0 and connection then
			connection:Disconnect()
			connection = nil
		end
	end)
end

return {
	Tag = "Flicker",
	Setup = setup,
}
