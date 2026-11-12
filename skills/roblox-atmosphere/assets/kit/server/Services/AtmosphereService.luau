--!strict
-- Server side of the atmosphere kit. It never touches Lighting properties (those would replicate
-- and fight the clients); it only sets attributes that every AtmosphereController reads:
--
--   Lighting.AtmospherePreset            base preset for everyone (e.g. lobby -> match -> blackout)
--   Player.AtmosphereOverride            one player's preset, above zones (e.g. a jumpscare, a cutscene)
--   Lighting.WorldClock / WorldClockRate / WorldClockStamp
--                                        the shared day/night clock; clients extrapolate it locally,
--                                        so it costs no network traffic while it runs

local Lighting = game:GetService("Lighting")
local ReplicatedStorage = game:GetService("ReplicatedStorage")

local AtmosphereConfig = require(ReplicatedStorage.Shared.Atmosphere.AtmosphereConfig)
local AtmospherePresets = require(ReplicatedStorage.Shared.Atmosphere.AtmospherePresets)

local AtmosphereService = {}

local function check(name: string?)
	if name and not AtmospherePresets[name] then
		error(`[AtmosphereService] unknown preset '{name}'`, 3)
	end
end

function AtmosphereService:Start()
	if AtmosphereConfig.DayNight.Enabled then
		self:SetClock(AtmosphereConfig.DayNight.StartClock)
	end
end

-- Base preset for every player. nil = back to DefaultPreset / day-night phases.
function AtmosphereService:SetPreset(name: string?)
	check(name)
	Lighting:SetAttribute("AtmospherePreset", name)
end

-- One player's preset, above zones. nil clears it.
function AtmosphereService:SetPlayerPreset(player: Player, name: string?)
	check(name)
	player:SetAttribute("AtmosphereOverride", name)
end

-- Jump the world clock (0-24). `hoursPerSecond` defaults to the configured day length; 0 freezes time.
function AtmosphereService:SetClock(clock: number, hoursPerSecond: number?)
	local rate = hoursPerSecond or 24 / (AtmosphereConfig.DayNight.MinutesPerDay * 60)
	Lighting:SetAttribute("WorldClock", clock % 24)
	Lighting:SetAttribute("WorldClockRate", rate)
	Lighting:SetAttribute("WorldClockStamp", workspace:GetServerTimeNow())
end

function AtmosphereService:GetClock(): number
	local clock = Lighting:GetAttribute("WorldClock")
	local rate = Lighting:GetAttribute("WorldClockRate")
	local stamp = Lighting:GetAttribute("WorldClockStamp")
	if typeof(clock) ~= "number" or typeof(rate) ~= "number" or typeof(stamp) ~= "number" then
		return AtmosphereConfig.DayNight.StartClock
	end
	return (clock + (workspace:GetServerTimeNow() - stamp) * rate) % 24
end

-- For gameplay that depends on time of day (night-only enemies, shop hours).
function AtmosphereService:IsNight(): boolean
	local clock = self:GetClock()
	return clock < 6 or clock >= 18.5
end

return AtmosphereService
