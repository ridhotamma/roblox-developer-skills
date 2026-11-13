--!strict
-- YOUR theme. This is the file to edit to restyle the game: colours, corner roundness, fonts,
-- spacing, and how each component looks. Write only what differs from the defaults; everything
-- else keeps the kit's value. The kit installer never overwrites this file.
--
-- Every key and its default is listed in Theme/Theme.luau (DEFAULTS) and the skill's
-- references/theming.md. Unknown keys warn in Output, so typos show up the first time you play.
-- After changing colours, check contrast:  node <skill>/scripts/uikit.cjs contrast --project .
-- Preview: open any story in UI Labs with the Theme control set to "Game".

local Theme = require(script.Parent.Theme)

return Theme.create({
	name = "Game",

	-- Examples (uncomment and adjust):

	-- roundness = 1.5, -- 0 = square corners everywhere, 1 = default, 2 = very round

	-- palettes = {
	--     Dark = {
	--         -- Brand colour for primary buttons, tabs and bars. TextOnAccent (white) is shared
	--         -- by Accent, Positive and Danger fills, so pick an accent dark enough for white text.
	--         Accent = Color3.fromRGB(190, 70, 0),
	--         Surface = Color3.fromRGB(28, 24, 40),
	--     },
	--     -- A new palette starts from Dark: only list what changes.
	--     Halloween = { Accent = Color3.fromRGB(200, 70, 0), Background = Color3.fromRGB(20, 10, 4) },
	-- },

	-- font = "rbxasset://fonts/families/Montserrat.json",

	-- components = {
	--     Button = {
	--         radius = "Full", -- pill buttons ("S", "M", "L", "XL", "Full" or design units)
	--         depth = 0, -- flat, no lip
	--         variants = {
	--             Gold = { fill = "Currency", text = "Background" }, -- e(Button, { variant = "Gold" })
	--         },
	--     },
	--     Card = { radius = "XL", stroke = false }, -- rounder, borderless cards
	--     Tile = { rarityBorder = false },
	-- },
})
