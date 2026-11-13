--!strict
-- Example themes built on your game theme, to show how far overrides go and as starting points:
-- copy the parts you like into GameTheme.luau. Stories can switch to any of them with the Theme
-- control ("Game", "Default", "Sharp", "Soft", "Arcade").
--
--   Sharp:  near-square corners, flat buttons, quicker motion   (competitive, sci-fi, esports)
--   Soft:   very round, pill buttons, borderless cards, springy (cozy, simulators, pets)
--   Arcade: chunky borders and lips, bold type, a saturated purple palette (party, obby, kids)

local GameTheme = require(script.Parent.GameTheme)
local Theme = require(script.Parent.Theme)

local Presets = {}

Presets.Sharp = Theme.create({
	name = "Sharp",
	roundness = 0.25,
	springs = { Snappy = { Frequency = 7, Damping = 1 } },
	components = {
		Button = { depth = 0, radius = "S" },
		Pill = { radius = "S" },
		ProgressBar = { radius = "S", height = 10 },
		Tile = { strokeWidth = 1 },
	},
}, GameTheme)

Presets.Soft = Theme.create({
	name = "Soft",
	roundness = 1.75,
	springs = { Snappy = { Frequency = 4.5, Damping = 0.75 } },
	components = {
		Button = { radius = "Full", depth = 2 },
		Card = { stroke = false, transparency = 0 },
		Modal = { stroke = false },
		Tile = { rarityBorder = false, stroke = "SurfaceRaised" },
		Toast = { radius = "XL" },
	},
}, GameTheme)

Presets.Arcade = Theme.create({
	name = "Arcade",
	roundness = 1.25,
	palettes = {
		Dark = {
			Background = Color3.fromRGB(20, 12, 40),
			Surface = Color3.fromRGB(36, 22, 70),
			SurfaceRaised = Color3.fromRGB(48, 30, 92),
			SurfaceSunken = Color3.fromRGB(22, 14, 46),
			Border = Color3.fromRGB(120, 90, 200),
			Accent = Color3.fromRGB(210, 30, 110),
			Focus = Color3.fromRGB(255, 230, 80),
		},
	},
	-- Thicker stroke steps reach every border that refers to them (cards, tiles, focus rings).
	stroke = { Thin = 2, Regular = 3, Thick = 4 },
	type = { Button = { Size = 18, Weight = Enum.FontWeight.ExtraBold } },
	components = {
		Button = { depth = 5 },
	},
}, GameTheme)

Presets.names = table.freeze({ "Game", "Default", "Sharp", "Soft", "Arcade" })

-- A theme by name ("Game", "Default" or a preset); unknown names give the game theme.
function Presets.get(name: string?): Theme.Theme
	if name == "Default" then
		return Theme.default
	end
	local preset = (Presets :: any)[name or "Game"]
	if type(preset) == "table" and preset.components then
		return preset
	end
	return GameTheme
end

return Presets
