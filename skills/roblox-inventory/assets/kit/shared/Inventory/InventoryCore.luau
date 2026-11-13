--!strict
-- Pure container logic shared by the server (the authority) and the client (prediction and
-- drag previews). No Roblox APIs and no requires, so it also runs in the plain `luau` CLI
-- (tests/InventoryCore.spec.luau).
--
-- A container is { Spec, Items }. Spec.Layout decides how items are positioned:
--   "Slots"  numbered slots, one item (stack) per slot        item.Slot
--   "Grid"   width x height cells, items cover a rectangle    item.X, item.Y, item.Rot
--   "List"   no positions; limited by MaxWeight / MaxItems
--
-- Every function that changes a container either fully succeeds or leaves it untouched.

local Core = {}

export type ItemDef = {
	Name: string,
	Category: string,
	MaxStack: number?, -- default 1
	Size: { number }?, -- { width, height } in grid cells, default { 1, 1 }
	Weight: number?, -- per unit, default 0
	[string]: any,
}

export type Defs = { [string]: ItemDef }

export type Item = {
	Uid: string, -- unique within one player's inventory
	Id: string, -- key of the item catalog
	Count: number,
	Slot: number?,
	X: number?,
	Y: number?,
	Rot: boolean?, -- Grid: rotated a quarter turn (width and height swapped)
	Data: { [string]: any }?, -- per-item state (durability, loaded rounds); never stacks
}

export type Spec = {
	Layout: "Slots" | "Grid" | "List",
	Slots: number?,
	Width: number?,
	Height: number?,
	MaxWeight: number?,
	SoftWeight: boolean?, -- MaxWeight does not block; the game slows the player instead
	MaxItems: number?, -- List: maximum number of entries
	MaxStack: number?, -- caps every stack in this container
	NoRotate: boolean?, -- Grid: items may not be rotated
	Accept: { [string]: boolean }?, -- categories allowed; nil = everything
	SlotAccept: { string }?, -- Slots: category per slot ("Any" = everything), for equipment
	[string]: any,
}

export type Container = { Spec: Spec, Items: { Item } }
export type Dest = { Slot: number?, X: number?, Y: number?, Rot: boolean? }

local function isInt(value: any): boolean
	return type(value) == "number" and value % 1 == 0 and value > -1e9 and value < 1e9
end

local function copyData(data: { [string]: any }?): { [string]: any }?
	if data == nil then
		return nil
	end
	local copy = {}
	for key, value in data do
		copy[key] = if type(value) == "table" then copyData(value) else value
	end
	return copy
end

local function copyItem(item: Item): Item
	return {
		Uid = item.Uid,
		Id = item.Id,
		Count = item.Count,
		Slot = item.Slot,
		X = item.X,
		Y = item.Y,
		Rot = item.Rot,
		Data = copyData(item.Data),
	}
end

function Core.New(spec: Spec): Container
	return { Spec = spec, Items = {} }
end

-- The largest stack of `def` this container allows.
function Core.MaxStack(spec: Spec, def: ItemDef): number
	local limit = def.MaxStack or 1
	if spec.MaxStack then
		limit = math.min(limit, spec.MaxStack)
	end
	return math.max(1, limit)
end

-- Width and height in cells, after rotation.
function Core.Footprint(def: ItemDef?, rot: boolean?): (number, number)
	local size = def and def.Size
	local w = if size then size[1] else 1
	local h = if size then size[2] else 1
	if rot then
		return h, w
	end
	return w, h
end

function Core.Accepts(spec: Spec, def: ItemDef, slot: number?): boolean
	if spec.Accept and not spec.Accept[def.Category] then
		return false
	end
	if slot and spec.SlotAccept then
		local want = spec.SlotAccept[slot]
		if want and want ~= "Any" and want ~= def.Category then
			return false
		end
	end
	return true
end

function Core.Find(container: Container, uid: string): (Item?, number?)
	for index, item in container.Items do
		if item.Uid == uid then
			return item, index
		end
	end
	return nil, nil
end

function Core.FindId(container: Container, id: string): Item?
	for _, item in container.Items do
		if item.Id == id then
			return item
		end
	end
	return nil
end

function Core.ItemAtSlot(container: Container, slot: number): Item?
	for _, item in container.Items do
		if item.Slot == slot then
			return item
		end
	end
	return nil
end

function Core.ItemAtCell(container: Container, defs: Defs, x: number, y: number): Item?
	for _, item in container.Items do
		local ix, iy = item.X, item.Y
		if ix and iy then
			local w, h = Core.Footprint(defs[item.Id], item.Rot)
			if x >= ix and x < ix + w and y >= iy and y < iy + h then
				return item
			end
		end
	end
	return nil
end

-- Grid: the items a `def` placed with its top-left corner at (x, y) would overlap.
-- Returns nil when the rectangle leaves the grid. `ignore` is a Uid to skip (the item being moved).
function Core.Blockers(
	container: Container,
	defs: Defs,
	def: ItemDef?,
	x: number,
	y: number,
	rot: boolean?,
	ignore: string?
): { Item }?
	local spec = container.Spec
	local w, h = Core.Footprint(def, rot)
	if x < 1 or y < 1 or x + w - 1 > (spec.Width or 0) or y + h - 1 > (spec.Height or 0) then
		return nil
	end
	local found = {}
	for _, other in container.Items do
		local ox, oy = other.X, other.Y
		if other.Uid ~= ignore and ox and oy then
			local ow, oh = Core.Footprint(defs[other.Id], other.Rot)
			if ox < x + w and x < ox + ow and oy < y + h and y < oy + oh then
				table.insert(found, other)
			end
		end
	end
	return found
end

-- Grid: true when the rectangle is inside the grid and empty.
function Core.Fits(
	container: Container,
	defs: Defs,
	def: ItemDef?,
	x: number,
	y: number,
	rot: boolean?,
	ignore: string?
): boolean
	local blockers = Core.Blockers(container, defs, def, x, y, rot, ignore)
	return blockers ~= nil and #blockers == 0
end

-- The first free position for a new stack of `def`, or nil when the container is full.
function Core.FindSpace(container: Container, defs: Defs, def: ItemDef): Dest?
	local spec = container.Spec
	if spec.Layout == "Slots" then
		local taken = {}
		for _, item in container.Items do
			if item.Slot then
				taken[item.Slot] = true
			end
		end
		for slot = 1, spec.Slots or 0 do
			if not taken[slot] and Core.Accepts(spec, def, slot) then
				return { Slot = slot }
			end
		end
		return nil
	elseif spec.Layout == "Grid" then
		local baseW, baseH = Core.Footprint(def, false)
		for turn = 1, 2 do
			local rot = turn == 2
			if rot and (baseW == baseH or spec.NoRotate) then
				break
			end
			local w, h = Core.Footprint(def, rot)
			for y = 1, (spec.Height or 0) - h + 1 do
				for x = 1, (spec.Width or 0) - w + 1 do
					if Core.Fits(container, defs, def, x, y, rot, nil) then
						local dest: Dest = { X = x, Y = y, Rot = rot }
						return dest
					end
				end
			end
		end
		return nil
	else
		if spec.MaxItems and #container.Items >= spec.MaxItems then
			return nil
		end
		return {}
	end
end

function Core.Weight(container: Container, defs: Defs): number
	local total = 0
	for _, item in container.Items do
		local def = defs[item.Id]
		if def then
			total += (def.Weight or 0) * item.Count
		end
	end
	return total
end

-- How many more units of `def` the weight limit allows (math.huge when unlimited).
function Core.Capacity(container: Container, defs: Defs, def: ItemDef): number
	local spec = container.Spec
	local weight = def.Weight or 0
	if not spec.MaxWeight or spec.SoftWeight or weight <= 0 then
		return math.huge
	end
	-- The small epsilon keeps 0.1 + 0.2 style sums from rejecting an item that exactly fits.
	return math.max(0, math.floor((spec.MaxWeight - Core.Weight(container, defs)) / weight + 1e-6))
end

function Core.Count(container: Container, id: string): number
	local total = 0
	for _, item in container.Items do
		if item.Id == id then
			total += item.Count
		end
	end
	return total
end

local function place(item: Item, layout: string, dest: Dest)
	item.Slot = if layout == "Slots" then dest.Slot else nil
	item.X = if layout == "Grid" then dest.X else nil
	item.Y = if layout == "Grid" then dest.Y else nil
	item.Rot = if layout == "Grid" and dest.Rot then true else nil
end

-- Adds up to `count` of an item: tops up existing stacks, then opens new ones.
-- Returns how many were added (0..count). Items with `data` never stack.
function Core.Add(
	container: Container,
	defs: Defs,
	id: string,
	count: number,
	data: { [string]: any }?,
	newUid: () -> string
): number
	local def = defs[id]
	local spec = container.Spec
	if not def or not isInt(count) or count <= 0 or not Core.Accepts(spec, def, nil) then
		return 0
	end
	local room = math.min(count, Core.Capacity(container, defs, def))
	local left = room
	local stack = if data then 1 else Core.MaxStack(spec, def)

	if stack > 1 then
		for _, item in container.Items do
			if left <= 0 then
				break
			end
			if item.Id == id and item.Data == nil and item.Count < stack then
				local n = math.min(left, stack - item.Count)
				item.Count += n
				left -= n
			end
		end
	end

	while left > 0 do
		local dest = Core.FindSpace(container, defs, def)
		if not dest then
			break
		end
		local n = math.min(left, stack)
		local item: Item = { Uid = newUid(), Id = id, Count = n, Data = copyData(data) }
		place(item, spec.Layout, dest)
		table.insert(container.Items, item)
		left -= n
	end
	return room - left
end

function Core.Clone(container: Container): Container
	local items = table.create(#container.Items)
	for index, item in container.Items do
		items[index] = copyItem(item)
	end
	return { Spec = container.Spec, Items = items }
end

-- True when all `count` units would fit (checked on a copy; nothing changes).
function Core.CanAdd(container: Container, defs: Defs, id: string, count: number): boolean
	local n = 0
	return Core.Add(Core.Clone(container), defs, id, count, nil, function()
		n += 1
		return `?{n}`
	end) == count
end

-- Removes `count` units of an item id, smallest stacks first. All or nothing.
function Core.Remove(container: Container, id: string, count: number): boolean
	if not isInt(count) or count <= 0 or Core.Count(container, id) < count then
		return false
	end
	local stacks = {}
	for _, item in container.Items do
		if item.Id == id then
			table.insert(stacks, item)
		end
	end
	table.sort(stacks, function(a, b)
		return a.Count < b.Count
	end)
	local left = count
	for _, item in stacks do
		if left <= 0 then
			break
		end
		local n = math.min(left, item.Count)
		item.Count -= n
		left -= n
		if item.Count == 0 then
			local _, index = Core.Find(container, item.Uid)
			table.remove(container.Items, index :: number)
		end
	end
	return true
end

-- Takes `count` units (default: all) out of one item. Returns the detached part
-- ({ Id, Count, Data }) or nil when the uid is unknown.
function Core.Take(container: Container, uid: string, count: number?): { Id: string, Count: number, Data: { [string]: any }? }?
	local item, index = Core.Find(container, uid)
	if not item or not index then
		return nil
	end
	local n = item.Count
	if count ~= nil then
		if not isInt(count) or count <= 0 then
			return nil
		end
		n = math.min(count, item.Count)
	end
	if n == item.Count then
		table.remove(container.Items, index)
	else
		item.Count -= n
	end
	return { Id = item.Id, Count = n, Data = copyData(item.Data) }
end

-- Moves an item (or `count` units of it) to a chosen position in the same or another
-- container. Dropping on a stack of the same item merges; dropping on a different item
-- swaps (Slots to Slots only). Returns ok and a reason on failure.
function Core.Move(
	from: Container,
	to: Container,
	defs: Defs,
	uid: string,
	dest: Dest,
	count: number?,
	newUid: () -> string
): (boolean, string?)
	local item, index = Core.Find(from, uid)
	if not item or not index then
		return false, "NoItem"
	end
	local def = defs[item.Id]
	if not def then
		return false, "UnknownItem"
	end
	if count ~= nil and (not isInt(count) or count <= 0) then
		return false, "BadCount"
	end
	local same = from == to
	local toSpec = to.Spec
	local layout = toSpec.Layout
	local stack = if item.Data then 1 else Core.MaxStack(toSpec, def)
	local n = math.min(count or item.Count, item.Count)

	-- What is at the destination?
	local target: Item? = nil
	if layout == "Slots" then
		local slot = dest.Slot
		if not isInt(slot) or (slot :: number) < 1 or (slot :: number) > (toSpec.Slots or 0) then
			return false, "BadDest"
		end
		if not Core.Accepts(toSpec, def, slot) then
			return false, "NotAccepted"
		end
		target = Core.ItemAtSlot(to, slot :: number)
	elseif layout == "Grid" then
		if not isInt(dest.X) or not isInt(dest.Y) then
			return false, "BadDest"
		end
		if not Core.Accepts(toSpec, def, nil) then
			return false, "NotAccepted"
		end
		if dest.Rot and toSpec.NoRotate then
			return false, "NoRotate"
		end
		-- The item itself is not in the way when the whole stack moves within one grid.
		local ignore = if same and n == item.Count then uid else nil
		local blockers = Core.Blockers(to, defs, def, dest.X :: number, dest.Y :: number, dest.Rot, ignore)
		if not blockers then
			return false, "OutOfBounds"
		elseif #blockers > 1 then
			return false, "Blocked"
		end
		target = blockers[1]
	else
		-- Lists have no positions: moving in is a transfer.
		if same then
			return true, nil
		end
		local moved = Core.Transfer(from, to, defs, uid, n, newUid)
		return moved > 0, if moved > 0 then nil else "Full"
	end

	if target == item then
		return true, nil -- dropped on itself
	end

	if target == nil then
		n = math.min(n, stack)
		if not same and Core.Capacity(to, defs, def) < n then
			return false, "TooHeavy"
		end
		if n == item.Count then
			if not same then
				table.remove(from.Items, index)
				table.insert(to.Items, item)
			end
			place(item, layout, dest)
		else
			item.Count -= n
			local part: Item = { Uid = newUid(), Id = item.Id, Count = n }
			place(part, layout, dest)
			table.insert(to.Items, part)
		end
		return true, nil
	end

	if target.Id == item.Id and stack > 1 and target.Data == nil then
		local space = stack - target.Count
		if space <= 0 then
			return false, "Full"
		end
		local m = math.min(n, space)
		if not same then
			m = math.min(m, Core.Capacity(to, defs, def))
			if m <= 0 then
				return false, "TooHeavy"
			end
		end
		target.Count += m
		item.Count -= m
		if item.Count == 0 then
			table.remove(from.Items, index)
		end
		return true, nil
	end

	-- A different item is in the way: swap, when both sides are slots and both accept.
	local fromSpec = from.Spec
	if layout ~= "Slots" or fromSpec.Layout ~= "Slots" or n ~= item.Count then
		return false, "Blocked"
	end
	local targetDef = defs[target.Id]
	if not targetDef or not Core.Accepts(fromSpec, targetDef, item.Slot) then
		return false, "NotAccepted"
	end
	if item.Count > stack or target.Count > (if target.Data then 1 else Core.MaxStack(fromSpec, targetDef)) then
		return false, "StackLimit"
	end
	if not same then
		local itemWeight = (def.Weight or 0) * item.Count
		local targetWeight = (targetDef.Weight or 0) * target.Count
		if toSpec.MaxWeight and not toSpec.SoftWeight and itemWeight > targetWeight then
			if Core.Weight(to, defs) - targetWeight + itemWeight > toSpec.MaxWeight + 1e-6 then
				return false, "TooHeavy"
			end
		end
		if fromSpec.MaxWeight and not fromSpec.SoftWeight and targetWeight > itemWeight then
			if Core.Weight(from, defs) - itemWeight + targetWeight > fromSpec.MaxWeight + 1e-6 then
				return false, "TooHeavy"
			end
		end
		local _, targetIndex = Core.Find(to, target.Uid)
		from.Items[index] = target
		to.Items[targetIndex :: number] = item
	end
	item.Slot, target.Slot = target.Slot, item.Slot
	return true, nil
end

-- Moves up to `count` units into the first space the other container has (stacks first).
-- Returns how many moved. Used for quick-transfer, looting and list containers.
function Core.Transfer(from: Container, to: Container, defs: Defs, uid: string, count: number?, newUid: () -> string): number
	if from == to then
		return 0
	end
	local item = Core.Find(from, uid)
	if not item then
		return 0
	end
	if count ~= nil and (not isInt(count) or count <= 0) then
		return 0
	end
	local n = math.min(count or item.Count, item.Count)
	local moved = Core.Add(to, defs, item.Id, n, item.Data, newUid)
	if moved > 0 then
		Core.Take(from, uid, moved)
	end
	return moved
end

-- Merges partial stacks and repacks everything from the top-left. Grids place the largest
-- items first. Returns false (and changes nothing) for equipment containers or when the
-- repack does not fit.
function Core.Sort(container: Container, defs: Defs): boolean
	local spec = container.Spec
	if spec.SlotAccept then
		return false
	end

	local merged: { Item } = {}
	for _, source in container.Items do
		local def = defs[source.Id]
		local item = copyItem(source)
		local stack = if def and not item.Data then Core.MaxStack(spec, def) else 1
		if stack > 1 then
			for _, other in merged do
				if item.Count <= 0 then
					break
				end
				if other.Id == item.Id and other.Data == nil and other.Count < stack then
					local n = math.min(item.Count, stack - other.Count)
					other.Count += n
					item.Count -= n
				end
			end
		end
		if item.Count > 0 then
			table.insert(merged, item)
		end
	end

	local function area(item: Item): number
		local w, h = Core.Footprint(defs[item.Id], false)
		return w * h
	end
	local function category(item: Item): string
		local def = defs[item.Id]
		return if def then def.Category else ""
	end
	table.sort(merged, function(a, b)
		if spec.Layout == "Grid" and area(a) ~= area(b) then
			return area(a) > area(b)
		end
		if category(a) ~= category(b) then
			return category(a) < category(b)
		end
		if a.Id ~= b.Id then
			return a.Id < b.Id
		end
		if a.Count ~= b.Count then
			return a.Count > b.Count
		end
		return a.Uid < b.Uid
	end)

	local packed: Container = { Spec = spec, Items = {} }
	for _, item in merged do
		local def = defs[item.Id]
		local dest = if def then Core.FindSpace(packed, defs, def) else nil
		if not dest then
			return false
		end
		place(item, spec.Layout, dest)
		table.insert(packed.Items, item)
	end
	container.Items = packed.Items
	return true
end

-- A deep copy of the items, safe to save or send over a remote.
function Core.Save(container: Container): { Item }
	local items = table.create(#container.Items)
	for index, item in container.Items do
		items[index] = copyItem(item)
	end
	return items
end

-- Rebuilds a container from saved or received items. Entries that are malformed, unknown,
-- over the stack limit or no longer fit where they were (the catalog or the container size
-- changed) are re-added from the first free space. What still does not fit comes back as
-- `overflow` ({ Id, Count, Data }) so the caller can keep it instead of deleting it.
function Core.Load(spec: Spec, saved: any, defs: Defs, newUid: () -> string): (Container, { any })
	local container = Core.New(spec)
	local overflow = {}
	if type(saved) ~= "table" then
		return container, overflow
	end
	local seen: { [string]: boolean } = {}
	local pending = {}

	for _, entry in saved do
		if type(entry) ~= "table" or type(entry.Id) ~= "string" or not isInt(entry.Count) or entry.Count < 1 then
			continue
		end
		local def = defs[entry.Id]
		if not def then
			continue -- removed from the catalog
		end
		local data = if type(entry.Data) == "table" then copyData(entry.Data) else nil
		local stack = if data then 1 else Core.MaxStack(spec, def)
		local keep = math.min(entry.Count, stack)
		local uid = entry.Uid
		if type(uid) ~= "string" or uid == "" or seen[uid] then
			uid = newUid()
		end

		local dest: Dest? = nil
		if not Core.Accepts(spec, def, nil) then
			keep = 0
		elseif spec.Layout == "Slots" then
			local slot = entry.Slot
			if
				isInt(slot)
				and slot >= 1
				and slot <= (spec.Slots or 0)
				and Core.Accepts(spec, def, slot)
				and not Core.ItemAtSlot(container, slot)
			then
				dest = { Slot = slot }
			end
		elseif spec.Layout == "Grid" then
			local rot = entry.Rot == true and not spec.NoRotate
			if isInt(entry.X) and isInt(entry.Y) and Core.Fits(container, defs, def, entry.X, entry.Y, rot, nil) then
				dest = { X = entry.X, Y = entry.Y, Rot = rot }
			end
		elseif not spec.MaxItems or #container.Items < spec.MaxItems then
			dest = {}
		end

		if dest and keep > 0 then
			seen[uid] = true
			local item: Item = { Uid = uid, Id = entry.Id, Count = keep, Data = data }
			place(item, spec.Layout, dest)
			table.insert(container.Items, item)
		else
			keep = 0
		end
		if entry.Count > keep then
			table.insert(pending, { Id = entry.Id, Count = entry.Count - keep, Data = data })
		end
	end

	for _, rest in pending do
		local added = 0
		if rest.Data then
			-- Items with data are single units: add them one at a time.
			for _ = 1, rest.Count do
				if Core.Add(container, defs, rest.Id, 1, rest.Data, newUid) == 0 then
					break
				end
				added += 1
			end
		else
			added = Core.Add(container, defs, rest.Id, rest.Count, nil, newUid)
		end
		if added < rest.Count then
			table.insert(overflow, { Id = rest.Id, Count = rest.Count - added, Data = rest.Data })
		end
	end
	return container, overflow
end

return Core
