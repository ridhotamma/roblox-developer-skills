--!strict
-- All atmosphere tuning that isn't a preset lives here: which preset plays where, transition
-- speed, the day/night clock, weather look, and audio asset ids.
--
-- Audio ids are left empty on purpose: empty ids are skipped, so everything runs silently
-- until you paste ids from the Creator Store (search terms are in references/sound-and-weather.md).

local AtmosphereConfig = {
	-- Base look when no zone, override or day/night phase applies.
	DefaultPreset = "cartoon_day",
	-- Seconds to blend between presets (a zone part can override with a TransitionSeconds attribute).
	TransitionSeconds = 2.5,

	-- Parts tagged with this are atmosphere zones. Attributes on the part:
	--   Preset (string, required)  Priority (number, default 0; higher wins, then smaller zone)
	--   TransitionSeconds (number)  FollowClock (bool: keep the day/night clock instead of the preset's)
	ZoneTag = "AtmosphereZone",
	ZoneCheckInterval = 0.2,

	-- Lights / Neon parts tagged with this take the active preset's Accent colour.
	AccentTag = "AtmosphereAccent",

	-- Accessibility. Your settings menu sets this attribute on the Player (true/false); flicker,
	-- lightning and tension pulses get gentler. Default for players who never touch the setting:
	ReduceFlashingAttribute = "ReduceFlashing",
	ReduceFlashingDefault = false,

	DayNight = {
		-- When enabled, AtmosphereService runs a shared world clock and the base preset is
		-- picked from Phases by time of day. Zones and overrides keep their own ClockTime
		-- unless the zone has FollowClock = true.
		Enabled = false,
		MinutesPerDay = 12,
		StartClock = 8,
		-- Each phase starts at From (0-24) and lasts until the next one; the last wraps past midnight.
		Phases = {
			{ From = 5.5, Preset = "golden_hour" },
			{ From = 7.5, Preset = "cozy_morning" },
			{ From = 10, Preset = "cartoon_day" },
			{ From = 17, Preset = "golden_hour" },
			{ From = 19, Preset = "cozy_night" },
		},
	},

	Weather = {
		-- Raycast up from the camera; under a roof, weather particles stop and its sound muffles.
		ShelterCheck = true,
		ShelterHeight = 80,
		-- Built-in engine textures so it works out of the box. Swap for your own streak/flake
		-- textures (rbxassetid://...) for a better look.
		Textures = {
			Streak = "rbxasset://textures/particles/smoke_main.dds",
			Soft = "rbxasset://textures/particles/smoke_main.dds",
			Spark = "rbxasset://textures/particles/sparkles_main.dds",
		},
		-- Looping sounds per weather type, plus thunder for storms.
		Sounds = {
			rain = "",
			storm = "",
			blizzard = "",
			snow = "",
			dust = "",
			thunder = "",
		},
		SoundVolume = 0.6,
	},

	Tension = {
		-- Horror helper: Tension.Set(0..1). Leave ids empty to skip that layer.
		HeartbeatSoundId = "",
		VignetteImageId = "", -- a full-screen radial vignette image
		Tint = Color3.fromRGB(255, 205, 205),
		MaxDesaturate = 0.5,
		MaxContrast = 0.15,
		AmbienceDuck = 0.6,
		Response = 3, -- how fast tension follows its target (per second)
	},

	-- Ambience beds, keyed by a preset's Ambience field.
	--   Bed: looping sound id   Details: one-shot ids played at random 3D points around the player
	--   DetailEvery: {min, max} seconds between details
	Ambiences = {
		night_forest = { Bed = "", BedVolume = 0.5, Details = {}, DetailEvery = { 6, 18 }, DetailVolume = 0.35 },
		fog_drone = { Bed = "", BedVolume = 0.45, Details = {}, DetailEvery = { 15, 40 }, DetailVolume = 0.3 },
		house_creaks = { Bed = "", BedVolume = 0.35, Details = {}, DetailEvery = { 8, 25 }, DetailVolume = 0.4 },
		fluorescent_hum = { Bed = "", BedVolume = 0.4, Details = {}, DetailEvery = { 20, 60 }, DetailVolume = 0.25 },
		birds_meadow = { Bed = "", BedVolume = 0.4, Details = {}, DetailEvery = { 4, 12 }, DetailVolume = 0.3 },
		crickets = { Bed = "", BedVolume = 0.4, Details = {}, DetailEvery = { 10, 25 }, DetailVolume = 0.25 },
		light_breeze = { Bed = "", BedVolume = 0.3, Details = {}, DetailEvery = { 10, 30 }, DetailVolume = 0.25 },
		magic_forest = { Bed = "", BedVolume = 0.45, Details = {}, DetailEvery = { 6, 16 }, DetailVolume = 0.3 },
		cave_drips = { Bed = "", BedVolume = 0.45, Details = {}, DetailEvery = { 3, 9 }, DetailVolume = 0.35 },
		station_hum = { Bed = "", BedVolume = 0.4, Details = {}, DetailEvery = { 12, 30 }, DetailVolume = 0.3 },
		city_rain = { Bed = "", BedVolume = 0.45, Details = {}, DetailEvery = { 10, 25 }, DetailVolume = 0.3 },
		wind_desolate = { Bed = "", BedVolume = 0.5, Details = {}, DetailEvery = { 12, 30 }, DetailVolume = 0.3 },
		storm = { Bed = "", BedVolume = 0.5, Details = {}, DetailEvery = { 10, 30 }, DetailVolume = 0.3 },
		blizzard = { Bed = "", BedVolume = 0.55, Details = {}, DetailEvery = { 15, 35 }, DetailVolume = 0.3 },
		snow_calm = { Bed = "", BedVolume = 0.3, Details = {}, DetailEvery = { 15, 40 }, DetailVolume = 0.25 },
		underwater = { Bed = "", BedVolume = 0.5, Details = {}, DetailEvery = { 5, 14 }, DetailVolume = 0.3 },
		ocean_waves = { Bed = "", BedVolume = 0.5, Details = {}, DetailEvery = { 6, 16 }, DetailVolume = 0.3 },
		space_hum = { Bed = "", BedVolume = 0.35, Details = {}, DetailEvery = { 20, 50 }, DetailVolume = 0.25 },
	},
}

return AtmosphereConfig
