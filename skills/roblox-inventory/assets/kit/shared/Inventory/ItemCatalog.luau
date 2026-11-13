--!strict
-- Every item in the game, and what combines into what. Replace the examples with your own.
-- `node scripts/rinv.cjs catalog items.json` writes this file from a JSON sheet and checks it.
--
-- Item fields:
--   Name         shown to players
--   Category     free text; used by container filters, equipment slots, list tabs and sorting
--   Description  one or two lines for the detail panel
--   Icon         "rbxassetid://..." (optional: without one the tile shows the item's initials)
--   Color        tile tint (optional)
--   MaxStack     units per stack, default 1
--   Size         { width, height } in grid cells, default { 1, 1 } (grid styles only)
--   Weight       per unit, default 0 (weight styles only)
--   Tool         name of a Tool in ServerStorage.Tools: the item can be equipped
--   Use          name of a use handler (InventoryService:RegisterUse); "Heal" is built in
--   Heal         health restored by the "Heal" handler
--   WheelGroup   which weapon-wheel segment the item appears in (Wheel style)
--   Ammo         item id whose count is shown as this weapon's ammo
--   Droppable    false = cannot be dropped or lost on death (key items)
--   Model        name of a model in ReplicatedStorage.ItemModels used when it lies in the world

local Items = {
	-- Weapons
	Knife = {
		Name = "Combat Knife",
		Category = "Weapon",
		Description = "Quiet and never runs dry.",
		Size = { 1, 2 },
		Weight = 0.5,
		Tool = "Knife",
		WheelGroup = "Melee",
		Color = Color3.fromRGB(150, 158, 170),
	},
	Pistol = {
		Name = "9mm Pistol",
		Category = "Weapon",
		Description = "Reliable sidearm. Uses pistol rounds.",
		Size = { 2, 2 },
		Weight = 1.2,
		Tool = "Pistol",
		WheelGroup = "Pistols",
		Ammo = "PistolAmmo",
		Color = Color3.fromRGB(120, 140, 170),
	},
	Shotgun = {
		Name = "Pump Shotgun",
		Category = "Weapon",
		Description = "Devastating up close. Uses shells.",
		Size = { 5, 2 },
		Weight = 3.6,
		Tool = "Shotgun",
		WheelGroup = "Shotguns",
		Ammo = "ShotgunShells",
		Color = Color3.fromRGB(150, 120, 90),
	},
	Rifle = {
		Name = "Hunting Rifle",
		Category = "Weapon",
		Description = "Slow, accurate, loud.",
		Size = { 6, 2 },
		Weight = 4.2,
		Tool = "Rifle",
		WheelGroup = "Rifles",
		Ammo = "RifleAmmo",
		Color = Color3.fromRGB(110, 130, 100),
	},
	Flashlight = {
		Name = "Flashlight",
		Category = "Gear",
		Description = "Hold it to see in the dark.",
		Size = { 1, 2 },
		Weight = 0.4,
		Tool = "Flashlight",
		WheelGroup = "Gear",
		Color = Color3.fromRGB(200, 190, 120),
	},

	-- Ammo
	PistolAmmo = {
		Name = "Pistol Rounds",
		Category = "Ammo",
		Description = "9mm rounds.",
		MaxStack = 50,
		Size = { 2, 1 },
		Weight = 0.02,
		Color = Color3.fromRGB(190, 160, 80),
	},
	ShotgunShells = {
		Name = "Shotgun Shells",
		Category = "Ammo",
		Description = "12 gauge.",
		MaxStack = 20,
		Size = { 2, 1 },
		Weight = 0.05,
		Color = Color3.fromRGB(190, 90, 70),
	},
	RifleAmmo = {
		Name = "Rifle Rounds",
		Category = "Ammo",
		Description = "Full-power cartridges.",
		MaxStack = 30,
		Size = { 2, 1 },
		Weight = 0.04,
		Color = Color3.fromRGB(170, 150, 110),
	},

	-- Healing
	GreenHerb = {
		Name = "Green Herb",
		Category = "Healing",
		Description = "Restores a little health. Stronger when mixed.",
		MaxStack = 3,
		Size = { 1, 1 },
		Weight = 0.1,
		Use = "Heal",
		Heal = 25,
		Color = Color3.fromRGB(90, 170, 90),
	},
	RedHerb = {
		Name = "Red Herb",
		Category = "Healing",
		Description = "Useless alone. Mix it with a green herb.",
		MaxStack = 3,
		Size = { 1, 1 },
		Weight = 0.1,
		Color = Color3.fromRGB(190, 70, 70),
	},
	MixedHerb = {
		Name = "Mixed Herbs",
		Category = "Healing",
		Description = "Restores all health.",
		MaxStack = 2,
		Size = { 1, 1 },
		Weight = 0.2,
		Use = "Heal",
		Heal = 100,
		Color = Color3.fromRGB(190, 150, 70),
	},
	Bandage = {
		Name = "Bandage",
		Category = "Healing",
		Description = "Stops the bleeding. Restores some health.",
		MaxStack = 5,
		Size = { 1, 1 },
		Weight = 0.1,
		Use = "Heal",
		Heal = 35,
		Color = Color3.fromRGB(225, 225, 215),
	},
	Medkit = {
		Name = "First Aid Kit",
		Category = "Healing",
		Description = "Restores all health.",
		Size = { 2, 2 },
		Weight = 1,
		Use = "Heal",
		Heal = 100,
		Color = Color3.fromRGB(210, 80, 80),
	},

	-- Materials
	Wood = {
		Name = "Wood",
		Category = "Material",
		Description = "Building and crafting material.",
		MaxStack = 64,
		Weight = 0.5,
		Color = Color3.fromRGB(150, 110, 70),
	},
	Stone = {
		Name = "Stone",
		Category = "Material",
		Description = "Building and crafting material.",
		MaxStack = 64,
		Weight = 1,
		Color = Color3.fromRGB(130, 130, 135),
	},

	-- Key items: never dropped, never lost
	RustyKey = {
		Name = "Rusty Key",
		Category = "Key",
		Description = "Opens a door somewhere in the basement.",
		Size = { 1, 1 },
		Droppable = false,
		Color = Color3.fromRGB(170, 130, 80),
	},
}

-- Dragging A onto B (either order) consumes one of each and gives Result.
local Recipes = {
	{ A = "GreenHerb", B = "RedHerb", Result = "MixedHerb", Count = 1 },
	{ A = "MixedHerb", B = "Bandage", Result = "Medkit", Count = 1 },
}

-- The recipe for two item ids in either order, or nil. A and B must differ: dropping an
-- item on its own kind merges the stacks instead.
local function findRecipe(a: string, b: string): { A: string, B: string, Result: string, Count: number }?
	for _, recipe in Recipes do
		if (recipe.A == a and recipe.B == b) or (recipe.A == b and recipe.B == a) then
			return recipe
		end
	end
	return nil
end

return table.freeze({
	Items = Items,
	Recipes = Recipes,
	FindRecipe = findRecipe,
})
