--!strict
-- The client UI's state as atoms, and the actions screens may request. UiController creates one
-- State, keeps it in sync with the server (attributes, remotes) and hands both to App; stories
-- create their own with sample data. Screens never talk to remotes directly: they call actions,
-- so every screen can be previewed and tested without a server.
--
-- State here is a *view* of server truth (coins, owned items) plus purely local UI state (which
-- menu is open, the active theme and palette). The server never trusts any of it.

local Atom = require(script.Parent.Foundation.Atom)
local ItemTile = require(script.Parent.Components.ItemTile)
local Theme = require(script.Parent.Theme.Theme)

export type State = {
	coins: Atom.Atom<number>,
	dailyReady: Atom.Atom<boolean>,
	shopOpen: Atom.Atom<boolean>,
	owned: Atom.Atom<{ [string]: boolean }>,
	items: Atom.Atom<{ ItemTile.Item }>,
	-- Look: switch live from a settings menu or an event (UiController:SetTheme / SetPalette).
	theme: Atom.Atom<Theme.Theme>,
	palette: Atom.Atom<string?>, -- nil = the theme's default palette
}

export type Actions = {
	buy: (itemId: string) -> (),
	claimDaily: () -> (),
}

export type Options = {
	items: { ItemTile.Item }?,
	theme: Theme.Theme?,
	palette: string?,
}

local AppState = {}

-- Placeholder catalogue for stories and a fresh install. Replace with your ShopConfig.
AppState.SAMPLE_ITEMS = table.freeze({
	{ id = "wood_sword", name = "Wooden Sword", price = 50, rarity = "Common", category = "Swords", description = "A sturdy practice blade." },
	{ id = "iron_sword", name = "Iron Sword", price = 400, rarity = "Uncommon", category = "Swords", description = "Hits harder, swings the same." },
	{ id = "crystal_sword", name = "Crystal Sword", price = 2500, rarity = "Rare", category = "Swords", description = "Glows faintly in the dark." },
	{ id = "dragon_blade", name = "Dragon Blade", price = 125000, rarity = "Legendary", category = "Swords", description = "Forged in a volcano. Probably." },
	{ id = "cat", name = "Cat", price = 300, rarity = "Common", category = "Pets", description = "Follows you around. Sometimes." },
	{ id = "fox", name = "Fox", price = 1800, rarity = "Rare", category = "Pets", description = "Finds 10% more coins." },
	{ id = "phoenix", name = "Phoenix", price = 48000, rarity = "Epic", category = "Pets", description = "Revives you once per round." },
	{ id = "spark_trail", name = "Spark Trail", price = 750, rarity = "Uncommon", category = "Trails", description = "Leaves sparks where you run." },
	{ id = "rainbow_trail", name = "Rainbow Trail", price = 9000, rarity = "Epic", category = "Trails", description = "Every colour, all the time." },
} :: { ItemTile.Item })

function AppState.create(options: Options?): State
	local opts: Options = options or {}
	return {
		coins = Atom.new(0),
		dailyReady = Atom.new(true),
		shopOpen = Atom.new(false),
		owned = Atom.new({} :: { [string]: boolean }),
		items = Atom.new(opts.items or AppState.SAMPLE_ITEMS),
		theme = Atom.new(opts.theme or Theme.default),
		palette = Atom.new(opts.palette :: string?),
	}
end

return AppState
