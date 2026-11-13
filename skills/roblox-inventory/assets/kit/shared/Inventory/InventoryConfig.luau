--!strict
-- Which inventory the game has, and all of its tuning. Data only.
--
-- Remotes to declare in src/shared/Net/init.luau REMOTES:
--   InventoryState = "Event",  -- server -> client  (key: string, payload: any)  see "State keys" below
--   InventoryAction = "Event", -- client -> server  (action: string, ...)        see "Actions" below
--
-- State keys (server -> client):
--   "<container id>"  { Spec, Items, Title? }   full contents of a container the player may see
--   "Equipped"        uid | false               the item in the player's hands
--   "Shortcuts"       { ["1"] = itemId, ... }   quick-slot bindings
--   "Open"            container id | false      an outside container (stash, chest) opened or closed
--   "Message"         string                    a short notice ("Inventory full")
--
-- Actions (client -> server). Every one is a request; the server checks it and answers with state.
--   "Move",     fromId, uid, toId, { Slot | X, Y, Rot }, count?   put an item at a chosen position
--   "Transfer", fromId, uid, toId, count?                         put it wherever there is room
--   "Combine",  fromId, uid, toId, targetUid                      use a recipe on two items
--   "Use",      uid          "Equip", uid | false          "Drop", containerId, uid, count?
--   "Sort",     containerId  "Assign", index, itemId | false      "Close"

export type Style = {
	-- The containers a player carries, by name. Items picked up go to the first one in
	-- `Carry` that has room.
	Containers: { [string]: any },
	Carry: { string },
	-- Panels of the inventory window, top to bottom.
	Window: { string },
	-- A personal storage container reachable only at parts tagged "ItemBox" (optional).
	Stash: any?,
	-- Name of a Slots container whose first `BarSlots` slots are an always-visible hotbar
	-- (keys 1-9). Use this OR Shortcuts.
	Bar: string?,
	BarSlots: number?,
	-- Number of quick slots that point at item ids anywhere in the inventory (keys 1-9).
	Shortcuts: number?,
	-- Weapon wheel segments, clockwise from the top. Items join a segment through their
	-- WheelGroup field. Hold the wheel key to open it.
	Wheel: { string }?,
	Theme: string,
	Title: string,
	StarterItems: { { Id: string, Count: number } }?,
}

local Styles: { [string]: Style } = {
	-- Block-survival: a 9-slot hotbar on the number keys and a 27-slot backpack of stacks.
	Hotbar = {
		Containers = {
			Hotbar = { Layout = "Slots", Slots = 9, Columns = 9, Title = "Hotbar" },
			Main = { Layout = "Slots", Slots = 27, Columns = 9, Title = "Backpack" },
		},
		Carry = { "Hotbar", "Main" },
		Window = { "Main", "Hotbar" },
		Stash = { Layout = "Slots", Slots = 54, Columns = 9, Title = "Chest" },
		Bar = "Hotbar",
		BarSlots = 9,
		Theme = "Slate",
		Title = "Inventory",
	},

	-- Attache case: every item has a shape, the case is a grid, and packing it is the game.
	-- Rotate with R. Mix herbs by dropping one on another.
	Attache = {
		Containers = {
			Main = { Layout = "Grid", Width = 10, Height = 6, Title = "Case" },
		},
		Carry = { "Main" },
		Window = { "Main" },
		Stash = { Layout = "Slots", Slots = 60, Columns = 10, Title = "Storage" },
		Shortcuts = 4,
		Theme = "Case",
		Title = "Attache Case",
	},

	-- Classic survival horror: eight slots, small stacks, and an item box at every safe room.
	-- Running out of room is the point.
	Survivor = {
		Containers = {
			Main = { Layout = "Slots", Slots = 8, Columns = 4, CellScale = 1.5, Title = "Items" },
		},
		Carry = { "Main" },
		Window = { "Main" },
		Stash = { Layout = "Slots", Slots = 64, Columns = 8, Title = "Item Box" },
		Theme = "Terminal",
		Title = "Status",
	},

	-- Open-world crime: no bag screen at all during play. Weapons live on a radial wheel
	-- (hold to open, point, release); everything else is a plain list.
	Wheel = {
		Containers = {
			Main = { Layout = "List", Title = "Items" },
		},
		Carry = { "Main" },
		Window = { "Main" },
		Wheel = { "Unarmed", "Melee", "Pistols", "Shotguns", "Rifles", "Heavy", "Thrown", "Gear" },
		Theme = "Street",
		Title = "Inventory",
	},

	-- Open-world RPG: carry anything until it weighs too much. A sortable list with category
	-- tabs and favourites on the number keys.
	Weight = {
		Containers = {
			Main = { Layout = "List", MaxWeight = 60, SoftWeight = true, Title = "Items" },
		},
		Carry = { "Main" },
		Window = { "Main" },
		Stash = { Layout = "List", Title = "Stash" },
		Shortcuts = 8,
		Theme = "Parchment",
		Title = "Inventory",
	},

	-- Extraction shooter: equipment slots that decide what is in your hands, a backpack
	-- grid, and a big stash grid back at base.
	Extraction = {
		Containers = {
			Equipment = {
				Layout = "Slots",
				Slots = 5,
				Columns = 5,
				CellScale = 1.5,
				SlotAccept = { "Weapon", "Weapon", "Weapon", "Gear", "Healing" },
				SlotNames = { "Primary", "Secondary", "Melee", "Gear", "Medical" },
				Title = "Equipment",
			},
			Main = { Layout = "Grid", Width = 8, Height = 7, Title = "Backpack" },
		},
		Carry = { "Equipment", "Main" }, -- a picked-up weapon goes straight into a free weapon slot
		Window = { "Equipment", "Main" },
		Stash = { Layout = "Grid", Width = 10, Height = 12, Title = "Stash" },
		Bar = "Equipment",
		BarSlots = 5,
		Theme = "Tactical",
		Title = "Loadout",
	},
}

local InventoryConfig = {
	-- Pick one. Changing it later is safe: saved items are re-fitted into the new containers
	-- and anything that no longer fits waits in the player's overflow until there is room.
	Style = "Attache",
	Styles = Styles,

	-- Given once, to a player who has never had an inventory. A style's StarterItems wins.
	StarterItems = {
		{ Id = "Knife", Count = 1 },
		{ Id = "GreenHerb", Count = 2 },
	},

	-- Tools --------------------------------------------------------------------------------
	-- Folder in ServerStorage holding one Tool per item `Tool` name.
	ToolsFolder = "Tools",
	-- Folder in ReplicatedStorage with optional world models named after item ids.
	ModelsFolder = "ItemModels",
	-- Tools that reach a player some other way (touch pickup, an old script, StarterPack) and
	-- match a catalog item become that item. Tools that match nothing: "Destroy" or "Keep"
	-- (kept tools sit unseen in the hidden Backpack, so "Destroy" is the safe default).
	UnknownTools = "Destroy",
	-- Move Tools out of StarterPack at startup and give them once as starter items instead.
	MigrateStarterPack = true,
	-- Put the item back in the player's hands after they respawn.
	ReequipOnSpawn = false,

	-- Rules --------------------------------------------------------------------------------
	AllowDrop = true,
	-- "Keep" | "DropAll" | "DropEquipped" | "Clear". Items with Droppable = false always stay.
	OnDeath = "Keep",
	-- Studs. Pickups, chests and item boxes must be this close, checked on the server.
	UseDistance = 12,
	UseCooldown = 0.4, -- seconds between item uses
	ActionsPerSecond = 15, -- rate limit for InventoryAction
	-- Walk speed while over a SoftWeight container's limit (Weight style). nil = no slowdown.
	EncumberedWalkSpeed = 6,

	-- World items --------------------------------------------------------------------------
	DropLifetime = 180, -- seconds before a dropped item disappears
	MaxDrops = 150, -- oldest drops are removed past this
	PickupTag = "WorldItem", -- parts / models with attributes ItemId, Count?, Respawn?
	ContainerTag = "InventoryContainer", -- attributes Layout, Slots | Width + Height, Title?, Loot?, Refill?
	ItemBoxTag = "ItemBox", -- opens the player's own Stash

	-- Loot rolled into tagged containers. Rolls = { min, max } picks; Weight = relative chance.
	LootTables = {
		Crate = {
			Rolls = { 2, 4 },
			Entries = {
				{ Id = "PistolAmmo", Count = { 5, 15 }, Weight = 5 },
				{ Id = "ShotgunShells", Count = { 2, 6 }, Weight = 3 },
				{ Id = "GreenHerb", Count = { 1, 2 }, Weight = 4 },
				{ Id = "RedHerb", Count = { 1, 1 }, Weight = 2 },
				{ Id = "Bandage", Count = { 1, 2 }, Weight = 3 },
				{ Id = "Medkit", Count = { 1, 1 }, Weight = 1 },
			},
		},
	},

	-- Input (client) -----------------------------------------------------------------------
	Keys = {
		Toggle = { Enum.KeyCode.I, Enum.KeyCode.Backquote, Enum.KeyCode.DPadUp },
		Wheel = { Enum.KeyCode.Q, Enum.KeyCode.ButtonL1 }, -- hold
		Rotate = { Enum.KeyCode.R, Enum.KeyCode.ButtonY },
		Bar = {
			Enum.KeyCode.One,
			Enum.KeyCode.Two,
			Enum.KeyCode.Three,
			Enum.KeyCode.Four,
			Enum.KeyCode.Five,
			Enum.KeyCode.Six,
			Enum.KeyCode.Seven,
			Enum.KeyCode.Eight,
			Enum.KeyCode.Nine,
		},
	},
	-- Mouse wheel steps through the hotbar while the window is closed (Bar styles). Turn it
	-- off if the game needs free camera zoom.
	ScrollBar = false,
	-- Blur the world behind the window and the wheel.
	Blur = true,
}

return InventoryConfig
