--!strict
-- Natural-looking placement: things spread out with an even-but-irregular spacing instead of
-- random clumps and bald patches (pure math.random) or a visible grid.
--
--   Poisson     fill a rectangle; spacing can change from place to place (dense forest, thin meadow)
--   JitterCell  one deterministic point per grid cell, for endless or streamed worlds
--   Occupied    "is anything within d studs of here" for keeping different kinds apart

local Scatter = {}

export type Point = { x: number, z: number, r: number }
export type PoissonOptions = {
	rMin: number, -- the smallest spacing radiusAt can return
	rMax: number?, -- the largest (needed when spacing varies)
	tries: number?, -- darts to throw; default fills the area
	max: number?, -- stop after this many points
	existing: { Point }?, -- points to keep clear of
}

-- radiusAt(x, z) returns the wanted spacing in studs at that spot, or 0 for "nothing here".
function Scatter.Poisson(rng: any, x0: number, z0: number, x1: number, z1: number, radiusAt: (number, number) -> number, options: PoissonOptions): { Point }
	local rMin = options.rMin
	local cell = rMin / math.sqrt(2)
	local gw, gh = math.ceil((x1 - x0) / cell), math.ceil((z1 - z0) / cell)
	local grid: { [number]: { Point } } = {}
	local function put(p: Point)
		local k = math.floor((p.x - x0) / cell) * 100003 + math.floor((p.z - z0) / cell)
		local bucket = grid[k]
		if not bucket then
			bucket = {}
			grid[k] = bucket
		end
		table.insert(bucket, p)
	end
	for _, p in options.existing or {} do
		put(p)
	end
	local out: { Point } = {}
	local tries = options.tries or math.ceil(gw * gh * 1.6)
	for _ = 1, tries do
		local x, z = rng:Range(x0, x1), rng:Range(z0, z1)
		local r = radiusAt(x, z)
		if r and r > 0 then
			local ci, cj = math.floor((x - x0) / cell), math.floor((z - z0) / cell)
			local reach = math.ceil(math.max(r, options.rMax or r) / cell)
			local ok = true
			for i = ci - reach, ci + reach do
				for j = cj - reach, cj + reach do
					local bucket = grid[i * 100003 + j]
					if bucket then
						for _, q in bucket do
							local need = math.max(r, q.r)
							if (q.x - x) ^ 2 + (q.z - z) ^ 2 < need * need then
								ok = false
								break
							end
						end
					end
					if not ok then
						break
					end
				end
				if not ok then
					break
				end
			end
			if ok then
				local p = { x = x, z = z, r = r }
				put(p)
				table.insert(out, p)
				if options.max and #out >= options.max then
					break
				end
			end
		end
	end
	return out
end

-- One point per `spacing`-sized cell, pushed off-centre by a hash of (seed, cell). The same cell
-- always gives the same point, so chunks can be generated in any order and still line up.
-- Returns nil when keep (0..1) says the cell is empty. jitter 0 = grid, 0.5 = fully irregular.
function Scatter.JitterCell(seed: number, cellX: number, cellZ: number, spacing: number, keep: number?, jitter: number?): (number?, number?, number?)
	local h = bit32.bxor(cellX * 73856093, cellZ * 19349663, seed * 83492791) % 4294967296
	local function nextUnit(): number
		h = (h * 1664525 + 1013904223) % 4294967296
		return h / 4294967296
	end
	nextUnit()
	if nextUnit() > (keep or 1) then
		return nil, nil, nil
	end
	local j = jitter or 0.38
	local x = (cellX + 0.5 + (nextUnit() - 0.5) * 2 * j) * spacing
	local z = (cellZ + 0.5 + (nextUnit() - 0.5) * 2 * j) * spacing
	return x, z, nextUnit() -- the third value is a spare 0..1 for rotation or scale
end

-- Every JitterCell point inside a rectangle (a chunk). density(x, z) returns 0..1.
function Scatter.JitterRect(seed: number, x0: number, z0: number, x1: number, z1: number, spacing: number, density: ((number, number) -> number)?): { { x: number, z: number, u: number } }
	local out = {}
	for cx = math.floor(x0 / spacing), math.floor((x1 - 1e-6) / spacing) do
		for cz = math.floor(z0 / spacing), math.floor((z1 - 1e-6) / spacing) do
			local keep = if density then density((cx + 0.5) * spacing, (cz + 0.5) * spacing) else 1
			local x, z, u = Scatter.JitterCell(seed, cx, cz, spacing, keep)
			if x and z and u and x >= x0 and x < x1 and z >= z0 and z < z1 then
				table.insert(out, { x = x, z = z, u = u })
			end
		end
	end
	return out
end

-- Spatial lookup of circles: Add(x, z, radius), Any(x, z, distance).
local Occupied = {}
Occupied.__index = Occupied

function Scatter.Occupied(cell: number?)
	return setmetatable({ c = cell or 16, m = {} :: { [number]: { { number } } } }, Occupied)
end

function Occupied:Add(x: number, z: number, r: number?)
	local k = math.floor(x / self.c) * 4099 + math.floor(z / self.c)
	local bucket = self.m[k]
	if not bucket then
		bucket = {}
		self.m[k] = bucket
	end
	table.insert(bucket, { x, z, r or 0 })
end

function Occupied:Any(x: number, z: number, d: number): boolean
	local n = math.ceil((d + 12) / self.c)
	local ci, cj = math.floor(x / self.c), math.floor(z / self.c)
	for i = ci - n, ci + n do
		for j = cj - n, cj + n do
			local bucket = self.m[i * 4099 + j]
			if bucket then
				for _, p in bucket do
					if math.sqrt((p[1] - x) ^ 2 + (p[2] - z) ^ 2) < d + p[3] then
						return true
					end
				end
			end
		end
	end
	return false
end

return Scatter
