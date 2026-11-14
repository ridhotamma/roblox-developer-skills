--!strict
-- The spacing rules as code, for anything placed at runtime: build mode in a tycoon or restaurant
-- game, furniture placement, procedural rooms. One rule does most of the work:
--
--   a gap is either closed (the two things touch and read as one group)
--   or open (wide enough for an avatar to walk through). Never in between.
--
-- A footprint is { x, z, w, d, rot, clear = { f, b, l, r }?, group? } in studs; front is -Z,
-- rot is yaw in degrees, clear is the free floor the object needs on each side to be usable.

local Spacing = {}

Spacing.PASS = 3.5 -- narrowest gap an avatar walks through without squeezing
Spacing.TOUCH = 0.5 -- anything closer than this reads as touching
Spacing.MAIN_AISLE = 6 -- routes everyone uses
Spacing.DOOR_WIDTH = 6
Spacing.DOOR_HEIGHT = 8
Spacing.CEILING = 14 -- under 12 the third-person camera clips

export type Footprint = { x: number, z: number, w: number, d: number, rot: number?, clear: { f: number?, b: number?, l: number?, r: number? }?, group: string? }
type Poly = { { number } }

local function l2w(x: number, z: number, rot: number, lx: number, lz: number): (number, number)
	local c, s = math.cos(math.rad(rot)), math.sin(math.rad(rot))
	return x + lx * c + lz * s, z - lx * s + lz * c
end

local function rect(f: Footprint, x0: number, z0: number, x1: number, z1: number): Poly
	local out = {}
	for _, p in { { x0, z0 }, { x1, z0 }, { x1, z1 }, { x0, z1 } } do
		local x, z = l2w(f.x, f.z, f.rot or 0, p[1], p[2])
		table.insert(out, { x, z })
	end
	return out
end

function Spacing.Polygon(f: Footprint, grow: number?): Poly
	local hw, hd = f.w / 2 + (grow or 0), f.d / 2 + (grow or 0)
	return rect(f, -hw, -hd, hw, hd)
end

-- The free-space rectangles an object needs: { { side = "front", poly = ... }, ... }
function Spacing.ClearZones(f: Footprint): { { side: string, poly: Poly } }
	local c, hw, hd, out = f.clear or {}, f.w / 2, f.d / 2, {}
	if c.f and c.f > 0 then
		table.insert(out, { side = "front", poly = rect(f, -hw, -hd - c.f, hw, -hd) })
	end
	if c.b and c.b > 0 then
		table.insert(out, { side = "back", poly = rect(f, -hw, hd, hw, hd + c.b) })
	end
	if c.l and c.l > 0 then
		table.insert(out, { side = "left", poly = rect(f, -hw - c.l, -hd, -hw, hd) })
	end
	if c.r and c.r > 0 then
		table.insert(out, { side = "right", poly = rect(f, hw, -hd, hw + c.r, hd) })
	end
	return out
end

local function segPoint(px: number, pz: number, a: { number }, b: { number }): number
	local dx, dz = b[1] - a[1], b[2] - a[2]
	local l2 = dx * dx + dz * dz
	local t = if l2 > 0 then math.clamp(((px - a[1]) * dx + (pz - a[2]) * dz) / l2, 0, 1) else 0
	return math.sqrt((px - a[1] - dx * t) ^ 2 + (pz - a[2] - dz * t) ^ 2)
end

-- Distance between two convex polygons and, when they overlap, how deep.
function Spacing.PolygonGap(A: Poly, B: Poly): (number, number)
	local depth = math.huge
	for _, P in { A, B } do
		for i = 1, #P do
			local a, b = P[i], P[i % #P + 1]
			local nx, nz = b[2] - a[2], a[1] - b[1]
			local len = math.sqrt(nx * nx + nz * nz)
			if len > 0 then
				nx /= len
				nz /= len
				local a0, a1, b0, b1 = math.huge, -math.huge, math.huge, -math.huge
				for _, p in A do
					local v = p[1] * nx + p[2] * nz
					a0, a1 = math.min(a0, v), math.max(a1, v)
				end
				for _, p in B do
					local v = p[1] * nx + p[2] * nz
					b0, b1 = math.min(b0, v), math.max(b1, v)
				end
				depth = math.min(depth, math.min(a1, b1) - math.max(a0, b0))
			end
		end
	end
	if depth > 0 then
		return 0, depth
	end
	local best = math.huge
	for i = 1, #A do
		for j = 1, #B do
			best = math.min(best, segPoint(A[i][1], A[i][2], B[j], B[j % #B + 1]), segPoint(B[j][1], B[j][2], A[i], A[i % #A + 1]))
		end
	end
	return best, 0
end

function Spacing.Gap(a: Footprint, b: Footprint): (number, number)
	return Spacing.PolygonGap(Spacing.Polygon(a), Spacing.Polygon(b))
end

export type PlaceOptions = {
	pass: number?, -- default Spacing.PASS
	allowTouch: boolean?, -- default true: flush against a neighbour is fine
	bounds: { number }?, -- { x0, z0, x1, z1 } the object must stay inside
	keepOut: { Poly }?, -- doorways, aisles, spawn pads
}

-- Can `f` go here? Returns ok, reason, the neighbour in the way, and a number (gap or depth).
-- Reasons: "outside", "keepout", "overlap", "dead-gap", "blocks" (f sits in a neighbour's working
-- space), "blocked" (a neighbour sits in f's working space).
function Spacing.CanPlace(f: Footprint, others: { Footprint }, options: PlaceOptions?): (boolean, string?, Footprint?, number?)
	local opt: PlaceOptions = options or {}
	local pass = opt.pass or Spacing.PASS
	local poly = Spacing.Polygon(f)
	if opt.bounds then
		for _, p in poly do
			if p[1] < opt.bounds[1] - 0.01 or p[1] > opt.bounds[3] + 0.01 or p[2] < opt.bounds[2] - 0.01 or p[2] > opt.bounds[4] + 0.01 then
				return false, "outside", nil, nil
			end
		end
	end
	for _, k in opt.keepOut or {} do
		local _, depth = Spacing.PolygonGap(poly, k)
		if depth > 0.05 then
			return false, "keepout", nil, depth
		end
	end
	local zones = Spacing.ClearZones(f)
	for _, o in others do
		if o ~= f and not (f.group and f.group == o.group) then
			local other = Spacing.Polygon(o)
			local gap, depth = Spacing.PolygonGap(poly, other)
			if depth > 0.05 then
				return false, "overlap", o, depth
			end
			if gap <= Spacing.TOUCH and opt.allowTouch == false then
				return false, "overlap", o, gap
			end
			for _, zone in zones do
				local _, d = Spacing.PolygonGap(zone.poly, other)
				if d > 0.2 then
					return false, "blocked", o, d
				end
			end
			local covered = false
			for _, zone in Spacing.ClearZones(o) do
				local _, d = Spacing.PolygonGap(zone.poly, poly)
				if d > 0.2 then
					return false, "blocks", o, d
				end
				covered = true
			end
			-- a sliver is fine where either object reserves that floor anyway (chair pull-out space)
			if gap > Spacing.TOUCH and gap < pass and not covered and #zones == 0 then
				return false, "dead-gap", o, gap
			end
		end
	end
	return true, nil, nil, nil
end

-- Nudge a position so a dead gap becomes a touch: returns the offset (dx, dz) that closes the gap
-- to `neighbour` when the gap is under `snap` studs. Use it for magnetic snapping in build mode.
function Spacing.SnapOffset(f: Footprint, neighbour: Footprint, snap: number?): (number, number)
	local gap = Spacing.Gap(f, neighbour)
	if gap <= 0 or gap > (snap or Spacing.PASS) then
		return 0, 0
	end
	local dx, dz = neighbour.x - f.x, neighbour.z - f.z
	-- move along the axis they are separated on
	local horizontal = math.abs(dx) - (f.w + neighbour.w) / 2 > math.abs(dz) - (f.d + neighbour.d) / 2
	if horizontal then
		return math.sign(dx) * gap, 0
	end
	return 0, math.sign(dz) * gap
end

-- Spread things of the given widths along `length` so every gap is closed or at least minGap.
-- mode: "even" (equal gaps, ends included), "between" (equal gaps, flush ends), "center", "start".
-- Returns centre positions measured from the start, or nil when they don't fit.
function Spacing.Distribute(length: number, widths: { number }, minGap: number?, mode: string?): { number }?
	local gapMin, n, sum = minGap or 4, #widths, 0
	for _, w in widths do
		sum += w
	end
	if n == 0 or sum > length + 1e-6 then
		return nil
	end
	local free = length - sum
	local function lay(lead: number, gap: number): { number }
		local out, p = {}, lead
		for _, w in widths do
			table.insert(out, p + w / 2)
			p += w + gap
		end
		return out
	end
	if (mode or "even") == "even" and free / (n + 1) >= gapMin then
		return lay(free / (n + 1), free / (n + 1))
	end
	if mode == "between" and n > 1 and free / (n - 1) >= gapMin then
		return lay(0, free / (n - 1))
	end
	if mode == "start" then
		return if free <= 0.5 or free >= gapMin then lay(0, 0) else nil
	end
	if free / 2 >= gapMin or free / 2 <= 0.5 then
		return lay(free / 2, 0)
	end
	if free >= gapMin then
		return lay(0, 0)
	end
	return nil
end

-- How many things of width w fit in `length` with at least `gap` between them and at both ends.
function Spacing.FitCount(length: number, w: number, gap: number): number
	return math.max(0, math.floor((length - gap) / (w + gap)))
end

export type Metrics = { walkSpeed: number?, jumpHeight: number?, gravity: number? }

-- Horizontal distance an avatar covers in a jump that lands `rise` studs higher (negative = lower).
function Spacing.JumpReach(rise: number, metrics: Metrics?): number
	local m: Metrics = metrics or {}
	local g, h, s = m.gravity or 196.2, m.jumpHeight or 7.2, m.walkSpeed or 16
	local v0 = math.sqrt(2 * g * h)
	local disc = v0 * v0 - 2 * g * rise
	if disc < 0 then
		return 0
	end
	return s * (v0 + math.sqrt(disc)) / g
end

-- Edge-to-edge gap for a jump: lo is comfortable, hi is the hardest fair jump.
function Spacing.JumpBand(rise: number, metrics: Metrics?): (number, number, number)
	local reach = Spacing.JumpReach(rise, metrics)
	return math.max(2.5, (reach - 2.5) * 0.55), reach - 1.2, reach
end

-- 0 = a comfortable hop, 1 = the hardest fair jump, above 1 = unfair.
function Spacing.JumpDifficulty(gap: number, rise: number, landing: number, metrics: Metrics?): number
	local lo, hi = Spacing.JumpBand(rise, metrics)
	local height = (metrics and metrics.jumpHeight) or 7.2
	local r = if gap <= 0.3 then 0 else math.clamp((gap - lo) / math.max(0.5, hi - lo), 0, 1.6)
	if rise > 1 then
		r = math.max(r, math.clamp((rise / height - 0.3) / 0.55, 0, 1.6))
	end
	if landing < 4 and gap > 0.3 then
		r += (4 - landing) * 0.12
	end
	return r
end

return Spacing
