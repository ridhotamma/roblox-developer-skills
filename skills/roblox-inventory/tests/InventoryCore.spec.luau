--!strict
-- Tests for InventoryCore, runnable outside Roblox with the standalone Luau CLI:
--
--   luau tests/InventoryCore.spec.luau        (from the skill folder)
--
-- or in Studio: paste into a Script next to a copy of InventoryCore and change the require.
-- `node scripts/selftest.cjs` runs this automatically when `luau` is on the PATH.

local Core = require("../assets/kit/shared/Inventory/InventoryCore")

local defs: any = {
	Pistol = { Name = "Pistol", Category = "Weapon", Size = { 2, 2 }, Weight = 1 },
	Shotgun = { Name = "Shotgun", Category = "Weapon", Size = { 5, 2 }, Weight = 4 },
	Ammo = { Name = "Ammo", Category = "Ammo", MaxStack = 50, Size = { 2, 1 }, Weight = 0.1 },
	Herb = { Name = "Herb", Category = "Healing", MaxStack = 3, Weight = 0.5 },
	Key = { Name = "Key", Category = "Key" },
}

local uid = 0
local function newUid(): string
	uid += 1
	return `u{uid}`
end

local passed, failed = 0, 0
local function check(name: string, condition: any)
	if condition then
		passed += 1
	else
		failed += 1
		print(`FAIL {name}`)
	end
end

local function slots(n: number, extra: any?): any
	local spec = { Layout = "Slots", Slots = n }
	for key, value in extra or {} do
		spec[key] = value
	end
	return Core.New(spec :: any)
end

local function grid(w: number, h: number): any
	return Core.New({ Layout = "Grid", Width = w, Height = h })
end

-- No two items overlap and every item is inside the grid.
local function gridIsSound(container: any): boolean
	for _, item in container.Items do
		local blockers = Core.Blockers(container, defs, defs[item.Id], item.X, item.Y, item.Rot, item.Uid)
		if not blockers or #blockers > 0 then
			return false
		end
	end
	return true
end

-- Slots: stacking ---------------------------------------------------------------------------
do
	local c = slots(3)
	check("add fills one stack", Core.Add(c, defs, "Herb", 2, nil, newUid) == 2 and #c.Items == 1)
	check("add tops up then opens a new stack", Core.Add(c, defs, "Herb", 2, nil, newUid) == 2 and #c.Items == 2)
	check("stack sizes", c.Items[1].Count == 3 and c.Items[2].Count == 1)
	check("count", Core.Count(c, "Herb") == 4)
	check("add stops when full", Core.Add(c, defs, "Herb", 10, nil, newUid) == 5 and Core.Count(c, "Herb") == 9)
	check("add to a full container adds nothing", Core.Add(c, defs, "Key", 1, nil, newUid) == 0)
	check("CanAdd is false when full", not Core.CanAdd(c, defs, "Herb", 1))
	check("unknown item", Core.Add(c, defs, "Nope", 1, nil, newUid) == 0)
	check("bad counts", Core.Add(c, defs, "Herb", 0, nil, newUid) == 0 and Core.Add(c, defs, "Herb", 1.5, nil, newUid) == 0)
	check("remove is all or nothing", not Core.Remove(c, "Herb", 10) and Core.Count(c, "Herb") == 9)
	check("remove", Core.Remove(c, "Herb", 7) and Core.Count(c, "Herb") == 2 and #c.Items == 1)
end

-- Slots: move, merge, split, swap -----------------------------------------------------------
do
	local c = slots(4)
	Core.Add(c, defs, "Herb", 2, nil, newUid)
	Core.Add(c, defs, "Key", 1, nil, newUid)
	local herb, key = c.Items[1], c.Items[2]
	check("move to an empty slot", Core.Move(c, c, defs, herb.Uid, { Slot = 4 }, nil, newUid) and herb.Slot == 4)
	check("split", Core.Move(c, c, defs, herb.Uid, { Slot = 3 }, 1, newUid) and herb.Count == 1 and #c.Items == 3)
	local half = Core.ItemAtSlot(c, 3) :: any
	check("merge", Core.Move(c, c, defs, half.Uid, { Slot = 4 }, nil, newUid) and herb.Count == 2 and #c.Items == 2)
	check("swap", Core.Move(c, c, defs, herb.Uid, { Slot = key.Slot }, nil, newUid) and herb.Slot == 2 and key.Slot == 4)
	check("bad slot", not Core.Move(c, c, defs, herb.Uid, { Slot = 9 }, nil, newUid))
	check("fractional slot", not Core.Move(c, c, defs, herb.Uid, { Slot = 1.5 }, nil, newUid))
	check("NaN slot", not Core.Move(c, c, defs, herb.Uid, { Slot = 0 / 0 }, nil, newUid))
	check("negative count", not Core.Move(c, c, defs, herb.Uid, { Slot = 1 }, -1, newUid))
	check("unknown uid", not Core.Move(c, c, defs, "nope", { Slot = 1 }, nil, newUid))
	check("dropped on itself is a no-op", Core.Move(c, c, defs, herb.Uid, { Slot = herb.Slot }, nil, newUid) and #c.Items == 2)

	-- Total is conserved across containers.
	local other = slots(2)
	check("move across containers", (Core.Move(c, other, defs, herb.Uid, { Slot = 1 }, nil, newUid)))
	check("conserved", Core.Count(c, "Herb") + Core.Count(other, "Herb") == 2 and #c.Items == 1 and #other.Items == 1)
	check("swap across containers", (Core.Move(c, other, defs, key.Uid, { Slot = 1 }, nil, newUid)))
	check("swapped", Core.Count(c, "Herb") == 2 and Core.Count(other, "Key") == 1)
end

-- Equipment slots and filters ---------------------------------------------------------------
do
	local gear = slots(2, { SlotAccept = { "Weapon", "Healing" } })
	local bag = slots(4)
	Core.Add(bag, defs, "Pistol", 1, nil, newUid)
	Core.Add(bag, defs, "Herb", 1, nil, newUid)
	Core.Add(bag, defs, "Key", 1, nil, newUid)
	local pistol, herb, key = bag.Items[1], bag.Items[2], bag.Items[3]
	check("wrong slot refused", not Core.Move(bag, gear, defs, herb.Uid, { Slot = 1 }, nil, newUid))
	check("right slot accepted", (Core.Move(bag, gear, defs, pistol.Uid, { Slot = 1 }, nil, newUid)))
	check("swap refused when the other side does not fit", not Core.Move(bag, gear, defs, key.Uid, { Slot = 1 }, nil, newUid))
	check("add skips slots that refuse", Core.Add(gear, defs, "Herb", 1, nil, newUid) == 1 and Core.ItemAtSlot(gear, 2) ~= nil)
	check("add finds no slot", Core.Add(gear, defs, "Key", 1, nil, newUid) == 0)
	check("equipment does not sort", not Core.Sort(gear, defs))

	local ammoOnly = slots(2, { Accept = { Ammo = true } })
	check("category filter", Core.Add(ammoOnly, defs, "Herb", 1, nil, newUid) == 0 and Core.Add(ammoOnly, defs, "Ammo", 5, nil, newUid) == 5)

	local single = slots(8, { MaxStack = 1 })
	check("container stack cap", Core.Add(single, defs, "Herb", 3, nil, newUid) == 3 and #single.Items == 3)
end

-- Grid ----------------------------------------------------------------------------------------
do
	local c = grid(6, 4)
	check("place a shaped item", Core.Add(c, defs, "Shotgun", 1, nil, newUid) == 1)
	local shotgun = c.Items[1]
	check("first fit is top-left", shotgun.X == 1 and shotgun.Y == 1 and not shotgun.Rot)
	check("fits beside", Core.Fits(c, defs, defs.Pistol, 1, 3, false, nil))
	check("overlap refused", not Core.Fits(c, defs, defs.Pistol, 5, 2, false, nil))
	check("out of bounds refused", not Core.Fits(c, defs, defs.Pistol, 6, 1, false, nil))
	check("rotated footprint", select(1, Core.Footprint(defs.Shotgun, true)) == 2)
	check("move rotated", Core.Move(c, c, defs, shotgun.Uid, { X = 1, Y = 1, Rot = true }, nil, newUid) == false) -- 2x5 does not fit 4 rows
	check("move within grid ignores itself", Core.Move(c, c, defs, shotgun.Uid, { X = 2, Y = 1, Rot = false }, nil, newUid) and shotgun.X == 2)
	check("item at cell", Core.ItemAtCell(c, defs, 6, 2) == shotgun and Core.ItemAtCell(c, defs, 1, 1) == nil)
	Core.Add(c, defs, "Pistol", 1, nil, newUid)
	local pistol = c.Items[2]
	check("move onto another item is blocked", not Core.Move(c, c, defs, pistol.Uid, { X = 3, Y = 2 }, nil, newUid))
	check("sound after moves", gridIsSound(c))

	Core.Add(c, defs, "Ammo", 30, nil, newUid)
	Core.Add(c, defs, "Ammo", 30, nil, newUid)
	check("ammo stacks to 50 then opens another", Core.Count(c, "Ammo") == 60 and #c.Items == 4)
	local full, rest = c.Items[3], c.Items[4]
	check("a full stack takes no more", not Core.Move(c, c, defs, rest.Uid, { X = full.X, Y = full.Y, Rot = full.Rot }, nil, newUid)) -- full
	check("part of a stack dropped on another merges", (Core.Move(c, c, defs, full.Uid, { X = rest.X, Y = rest.Y, Rot = rest.Rot }, 10, newUid)))
	check("merged counts", full.Count == 40 and rest.Count == 20)
	check("still sound", gridIsSound(c))

	-- Fill a grid completely, then sort it.
	local tight = grid(4, 2)
	check("fill", Core.Add(tight, defs, "Pistol", 2, nil, newUid) == 2 and Core.Add(tight, defs, "Pistol", 1, nil, newUid) == 0)
	check("rotation is used when it helps", (function()
		local narrow = grid(2, 5)
		return Core.Add(narrow, defs, "Shotgun", 1, nil, newUid) == 1 and narrow.Items[1].Rot == true
	end)())
	check("NoRotate is respected", (function()
		local narrow = Core.New({ Layout = "Grid", Width = 2, Height = 5, NoRotate = true })
		return Core.Add(narrow, defs, "Shotgun", 1, nil, newUid) == 0
	end)())

	local messy = grid(6, 4)
	Core.Add(messy, defs, "Ammo", 10, nil, newUid)
	Core.Add(messy, defs, "Pistol", 1, nil, newUid)
	Core.Add(messy, defs, "Shotgun", 1, nil, newUid)
	check("split into free cells", Core.Move(messy, messy, defs, messy.Items[1].Uid, { X = 5, Y = 1 }, 4, newUid) and #messy.Items == 4)
	check("sort repacks and merges", Core.Sort(messy, defs) and #messy.Items == 3 and gridIsSound(messy))
	check("sort puts the largest first", messy.Items[1].Id == "Shotgun" and messy.Items[1].X == 1 and messy.Items[1].Y == 1)
	check("sort conserves", Core.Count(messy, "Ammo") == 10)
end

-- Weight and lists ----------------------------------------------------------------------------
do
	local c = Core.New({ Layout = "List", MaxWeight = 5 })
	check("weight caps how many are added", Core.Add(c, defs, "Shotgun", 2, nil, newUid) == 1)
	check("capacity", Core.Capacity(c, defs, defs.Pistol) == 1 and Core.Capacity(c, defs, defs.Key) == math.huge)
	check("weight", Core.Weight(c, defs) == 4)
	local soft = Core.New({ Layout = "List", MaxWeight = 5, SoftWeight = true })
	check("soft weight never blocks", Core.Add(soft, defs, "Shotgun", 3, nil, newUid) == 3 and Core.Weight(soft, defs) == 12)

	local bag = slots(2)
	Core.Add(bag, defs, "Shotgun", 1, nil, newUid)
	check("transfer into a list respects weight", Core.Transfer(bag, c, defs, bag.Items[1].Uid, nil, newUid) == 0 and #bag.Items == 1)
	Core.Add(bag, defs, "Pistol", 1, nil, newUid)
	check("transfer moves and removes", Core.Transfer(bag, c, defs, bag.Items[2].Uid, nil, newUid) == 1 and #bag.Items == 1 and #c.Items == 2)
	check("move into a list is a transfer", Core.Move(bag, soft, defs, bag.Items[1].Uid, {}, nil, newUid) and #bag.Items == 0)
	local capped = Core.New({ Layout = "List", MaxItems = 1 })
	check("MaxItems", Core.Add(capped, defs, "Key", 2, nil, newUid) == 1)
end

-- Per-item data -------------------------------------------------------------------------------
do
	local c = slots(4)
	check("data items never stack", Core.Add(c, defs, "Herb", 2, { Fresh = true }, newUid) == 2 and #c.Items == 2)
	check("data is copied per item", c.Items[1].Data ~= c.Items[2].Data and c.Items[1].Data.Fresh == true)
	Core.Add(c, defs, "Herb", 1, nil, newUid)
	check("plain stack does not merge into a data item", #c.Items == 3)
	check("moving a plain stack onto a data item swaps instead of merging", Core.Move(c, c, defs, c.Items[3].Uid, { Slot = 1 }, nil, newUid) and #c.Items == 3)
	local taken = Core.Take(c, c.Items[1].Uid, nil)
	check("take returns the detached part", taken ~= nil and taken.Count == 1 and #c.Items == 2)
end

-- Save and load -------------------------------------------------------------------------------
do
	local c = grid(6, 4)
	Core.Add(c, defs, "Shotgun", 1, nil, newUid)
	Core.Add(c, defs, "Ammo", 70, nil, newUid)
	local saved = Core.Save(c)
	check("save is a copy", saved[1] ~= c.Items[1] and saved[1].Uid == c.Items[1].Uid)

	local same, overflow = Core.Load(c.Spec, saved, defs, newUid)
	check("round trip", #same.Items == #c.Items and #overflow == 0 and same.Items[1].X == c.Items[1].X)

	-- The container shrank: what no longer fits is re-placed or reported, never lost.
	local small, lost = Core.Load({ Layout = "Grid", Width = 3, Height = 2 }, saved, defs, newUid)
	local kept = Core.Count(small, "Ammo") + Core.Count(small, "Shotgun")
	local spilled = 0
	for _, entry in lost do
		spilled += entry.Count
	end
	check("shrunk container keeps or reports everything", kept + spilled == 71 and gridIsSound(small))

	-- Garbage in the save is ignored, duplicates and overlaps are repaired.
	local dirty: { any } = {
		"junk",
		{ Id = "Nope", Count = 1 },
		{ Id = "Herb", Count = -3 },
		{ Id = "Herb", Count = 0 / 0 },
		{ Uid = "a", Id = "Pistol", Count = 1, X = 1, Y = 1 },
		{ Uid = "a", Id = "Pistol", Count = 1, X = 1, Y = 1 },
		{ Uid = "b", Id = "Herb", Count = 99, X = 5, Y = 1 },
	}
	local fixed, extra = Core.Load({ Layout = "Grid", Width = 6, Height = 4 }, dirty, defs, newUid)
	check("load repairs overlaps and duplicate uids", gridIsSound(fixed) and Core.Count(fixed, "Pistol") == 2)
	local seen = {}
	local unique = true
	for _, item in fixed.Items do
		unique = unique and not seen[item.Uid]
		seen[item.Uid] = true
	end
	check("uids are unique after load", unique)
	check("over-stacked save is split, not deleted", Core.Count(fixed, "Herb") + (if extra[1] then extra[1].Count else 0) == 99)
	check("load of nothing", #(Core.Load({ Layout = "Slots", Slots = 2 }, nil, defs, newUid)).Items == 0)

	-- Changing layout (style switch): slot items land in a grid.
	local slotSave = { { Uid = "x", Id = "Herb", Count = 2, Slot = 3 }, { Uid = "y", Id = "Shotgun", Count = 1, Slot = 1 } }
	local asGrid = Core.Load({ Layout = "Grid", Width = 6, Height = 4 }, slotSave, defs, newUid)
	check("slots to grid", #asGrid.Items == 2 and gridIsSound(asGrid) and Core.Count(asGrid, "Herb") == 2)
end

print(`InventoryCore: {passed} passed, {failed} failed`)
if failed > 0 then
	error("InventoryCore tests failed", 0)
end
