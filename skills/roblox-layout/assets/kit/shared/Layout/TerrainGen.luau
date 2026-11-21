--!strict
-- Smooth Terrain from a short list of features: rolling ground, hills, mountains, mesas, dips,
-- lakes and rivers with real Terrain water, flat pads for buildings and camps, plowed fields,
-- rock outcrops, painted areas and material patches. Trails in the layout get a level bed and a
-- painted surface. Steep ground turns to rock and dirt by itself, high ground to snow.
--
--   local sampler = TerrainGen.Sample(layout.terrain, layout.paths)
--   TerrainGen.Write(sampler, { Origin = Vector3.zero, YieldEvery = 4 })
--   sampler:Height(x, z), sampler:Slope(x, z), sampler:Water(x, z), sampler:Material(x, z)
--
-- Sample is a pure function of the spec, so the server, a client and the browser preview all get
-- the same ground from the same numbers: replicate the spec or the seed, not the voxels.
-- This is a port of scripts/lib/terrain.cjs (the rlayout tool): keep the two in step.

local Rng = require("./Rng")

local TerrainGen = {}

local NONE = -1e9
TerrainGen.NONE = NONE

local MATERIALS = {
	"Asphalt", "Basalt", "Brick", "Cobblestone", "Concrete", "CrackedLava", "Glacier", "Grass", "Ground", "Ice", "LeafyGrass",
	"Limestone", "Mud", "Pavement", "Rock", "Salt", "Sand", "Sandstone", "Slate", "Snow", "WoodPlanks",
}
TerrainGen.Materials = MATERIALS

local SHAPES: { [string]: { flat: number, rough: number } } = {
	hill = { flat = 0, rough = 0 },
	mountain = { flat = 0, rough = 0.35 },
	mesa = { flat = 0.72, rough = 0.08 },
	dip = { flat = 0.3, rough = 0 },
}
local DEFAULT_HEIGHT: { [string]: number } = { hill = 14, mountain = 60, mesa = 24, dip = -8 }

export type Body = { type: string, id: string?, at: { number }?, radius: number?, points: { { number } }?, width: number?, level: number }

export type Sampler = {
	spec: any,
	nx: number,
	nz: number,
	x0: number,
	z0: number,
	cell: number,
	H: { number },
	W: { number },
	deg: { number },
	mat: { string },
	bodies: { Body },
	lo: number,
	hi: number,
	wtop: number,
	Height: (self: Sampler, x: number, z: number) -> number,
	Slope: (self: Sampler, x: number, z: number) -> number,
	Water: (self: Sampler, x: number, z: number) -> number?,
	Wet: (self: Sampler, x: number, z: number, depth: number?) -> boolean,
	Material: (self: Sampler, x: number, z: number) -> string,
	Samples: (self: Sampler, x: number, z: number, fw: number?, fd: number?, rot: number?) -> { number },
	Ground: (self: Sampler, x: number, z: number, fw: number?, fd: number?, rot: number?) -> number,
	Relief: (self: Sampler, x: number, z: number, r: number) -> number,
}

local function sstep(t: number): number
	t = if t < 0 then 0 elseif t > 1 then 1 else t
	return t * t * (3 - 2 * t)
end
local function r2(v: number): number
	return math.floor(v * 100 + 0.5) / 100
end
local function hyp(x: number, z: number): number
	return math.sqrt(x * x + z * z)
end
local function clamp(v: number, a: number, b: number): number
	return math.max(a, math.min(b, v))
end
-- distance from (x, z) to segment a-b, and how far along it (0..1) the nearest point is
local function seg(x: number, z: number, a: { number }, b: { number }): (number, number)
	local dx, dz = b[1] - a[1], b[2] - a[2]
	local l2 = dx * dx + dz * dz
	local t = if l2 > 0 then ((x - a[1]) * dx + (z - a[2]) * dz) / l2 else 0
	t = if t < 0 then 0 elseif t > 1 then 1 else t
	return hyp(x - (a[1] + dx * t), z - (a[2] + dz * t)), t
end
-- the same rotation as the layout tool: local (lx, lz) of an object at (x, z) with yaw rot
local function l2w(x: number, z: number, rot: number, lx: number, lz: number): (number, number)
	local c, s = math.cos(rot * math.pi / 180), math.sin(rot * math.pi / 180)
	return x + lx * c + lz * s, z - lx * s + lz * c
end
local function w2l(x: number, z: number, rot: number, wx: number, wz: number): (number, number)
	local c, s = math.cos(rot * math.pi / 180), math.sin(rot * math.pi / 180)
	local dx, dz = wx - x, wz - z
	return dx * c - dz * s, dx * s + dz * c
end

local isMaterial: { [string]: boolean } = {}
for _, m in MATERIALS do
	isMaterial[m] = true
end

local function resolve(spec: any, layout: any?): any
	local s: any = {
		cell = 4, base = 0, relief = 0, scale = 200, ridges = 0, depth = 16, rock = 40, dirt = 30, ground = "Grass", paths = true,
	}
	for k, v in spec do
		s[k] = v
	end
	s.seed = if spec.seed ~= nil then spec.seed else (layout and layout.seed) or 1
	if not s.bounds then
		local b = layout and layout.bounds
		if not b then
			error("terrain needs bounds: give terrain.bounds { x0, z0, x1, z1 } or layout.bounds")
		end
		s.bounds = { b.min[1], b.min[2], b.max[1], b.max[2] }
	end
	if s.edge == true then
		s.edge = {}
	end
	if s.edge then
		s.edge = { height = s.edge.height or 40, width = s.edge.width or 60 }
	end
	local features = {}
	for i, f in spec.features or {} do
		local copy = table.clone(f)
		if copy.type ~= "lake" and copy.type ~= "river" and copy.type ~= "flatten" and copy.type ~= "field" and copy.type ~= "outcrop" and copy.type ~= "paint" and copy.type ~= "patches" and not SHAPES[copy.type] then
			error(`terrain feature {i}: unknown type "{copy.type}"`)
		end
		for _, k in { "material", "alt", "bed", "beach" } do
			if copy[k] and not isMaterial[copy[k]] then
				error(`terrain feature {i}: "{copy[k]}" is not a terrain material`)
			end
		end
		table.insert(features, copy)
	end
	s.features = features
	if not isMaterial[s.ground] then
		error(`terrain.ground: "{s.ground}" is not a terrain material`)
	end
	return s
end

local SamplerMethods = {}
SamplerMethods.__index = SamplerMethods

local function heightAt(self: any, x: number, z: number): number
	local nx, nz, cell, H = self.nx, self.nz, self.cell, self.H
	local fx, fz = (x - self.x0) / cell, (z - self.z0) / cell
	fx = if fx < 0 then 0 elseif fx > nx - 1 then nx - 1 else fx
	fz = if fz < 0 then 0 elseif fz > nz - 1 then nz - 1 else fz
	local i, j = math.floor(fx), math.floor(fz)
	if i > nx - 2 then
		i = nx - 2
	end
	if j > nz - 2 then
		j = nz - 2
	end
	local tx, tz, k = fx - i, fz - j, j * nx + i + 1
	local a = H[k] + (H[k + 1] - H[k]) * tx
	local b = H[k + nx] + (H[k + nx + 1] - H[k + nx]) * tx
	return a + (b - a) * tz
end

local function nodeAt(self: any, x: number, z: number): number
	local i = clamp(math.floor((x - self.x0) / self.cell + 0.5), 0, self.nx - 1)
	local j = clamp(math.floor((z - self.z0) / self.cell + 0.5), 0, self.nz - 1)
	return j * self.nx + i + 1
end

function SamplerMethods.Height(self: Sampler, x: number, z: number): number
	return heightAt(self, x, z)
end
function SamplerMethods.Slope(self: Sampler, x: number, z: number): number
	return self.deg[nodeAt(self, x, z)]
end
function SamplerMethods.Water(self: Sampler, x: number, z: number): number?
	local w = self.W[nodeAt(self, x, z)]
	return if w == NONE then nil else w
end
function SamplerMethods.Wet(self: Sampler, x: number, z: number, depth: number?): boolean
	local w = self:Water(x, z)
	return w ~= nil and w - heightAt(self, x, z) > (depth or 0.5)
end
function SamplerMethods.Material(self: Sampler, x: number, z: number): string
	return self.mat[nodeAt(self, x, z)]
end
-- heights under the centre and the four corners of a footprint
function SamplerMethods.Samples(self: Sampler, x: number, z: number, fw: number?, fd: number?, rot: number?): { number }
	local w, d, r = fw or 0, fd or 0, rot or 0
	local out = { heightAt(self, x, z) }
	if w > 0.5 or d > 0.5 then
		for _, c in { { -w / 2, -d / 2 }, { w / 2, -d / 2 }, { w / 2, d / 2 }, { -w / 2, d / 2 } } do
			local wx, wz = l2w(x, z, r, c[1], c[2])
			table.insert(out, heightAt(self, wx, wz))
		end
	end
	return out
end
function SamplerMethods.Ground(self: Sampler, x: number, z: number, fw: number?, fd: number?, rot: number?): number
	return math.min(table.unpack(self:Samples(x, z, fw, fd, rot)))
end
-- how much the ground rises and falls within r studs: a quick "is this a good spot to build"
function SamplerMethods.Relief(self: Sampler, x: number, z: number, r: number): number
	local lo, hi = math.huge, -math.huge
	for _, o in { { 0, 0 }, { r, 0 }, { -r, 0 }, { 0, r }, { 0, -r }, { r * 0.7, r * 0.7 }, { -r * 0.7, -r * 0.7 }, { r * 0.7, -r * 0.7 }, { -r * 0.7, r * 0.7 } } do
		local h = heightAt(self, x + o[1], z + o[2])
		lo, hi = math.min(lo, h), math.max(hi, h)
	end
	return hi - lo
end

-- Build the height, water and material grid. `paths` are the layout's paths (trails get a level
-- bed and a painted surface). `layout` supplies the seed and bounds when the spec leaves them out.
function TerrainGen.Sample(specIn: any, paths: { any }?, layout: any?): Sampler
	local s = resolve(specIn, layout)
	local N = Rng.Noise(s.seed)
	local cell = s.cell
	local bx0, bz0, bx1, bz1 = s.bounds[1], s.bounds[2], s.bounds[3], s.bounds[4]
	local x0, z0 = bx0, bz0
	local nx = math.max(2, math.ceil((bx1 - bx0) / cell) + 1)
	local nz = math.max(2, math.ceil((bz1 - bz0) / cell) + 1)
	local n = nx * nz
	local H, W = table.create(n, 0) :: { number }, table.create(n, NONE) :: { number }
	local hard, soft, locked = {} :: { [number]: string }, {} :: { [number]: string }, {} :: { [number]: boolean }
	local bodies: { Body } = {}
	local grid: any = { nx = nx, nz = nz, x0 = x0, z0 = z0, cell = cell, H = H }
	local function height(x: number, z: number): number
		return heightAt(grid, x, z)
	end
	local function each(ax0: number, az0: number, ax1: number, az1: number, fn: (k: number, x: number, z: number) -> ())
		local i0, i1 = math.max(0, math.ceil((ax0 - x0) / cell)), math.min(nx - 1, math.floor((ax1 - x0) / cell))
		local j0, j1 = math.max(0, math.ceil((az0 - z0) / cell)), math.min(nz - 1, math.floor((az1 - z0) / cell))
		for j = j0, j1 do
			for i = i0, i1 do
				fn(j * nx + i + 1, x0 + i * cell, z0 + j * cell)
			end
		end
	end

	-- 1. the base: rolling ground, optional ridges, and a rim of hills that frames the map
	for j = 0, nz - 1 do
		for i = 0, nx - 1 do
			local x, z = x0 + i * cell, z0 + j * cell
			local h = s.base
			if s.relief ~= 0 then
				h += s.relief * (N(x, z, s.scale, 3) - 0.5) * 2
			end
			if s.ridges ~= 0 then
				local r = 1 - math.abs(2 * N(x + 517, z - 233, s.scale * 0.8, 2) - 1)
				h += s.relief * s.ridges * r * r * 2
			end
			if s.edge then
				local d = math.min(x - bx0, bx1 - x, z - bz0, bz1 - z)
				if d < s.edge.width then
					h += s.edge.height * sstep(1 - d / s.edge.width) * (0.7 + 0.6 * N(x - 811, z + 409, 70, 2))
				end
			end
			H[j * nx + i + 1] = h
		end
	end

	-- 2. features, in the order given: later ones work on top of earlier ones
	local function water(k: number, h: number, level: number, f: any)
		H[k] = h
		W[k] = level
		hard[k] = if level - h < 2.2 then (f.beach or "Sand") else (f.bed or "Mud")
	end
	local function shoreBand(k: number, s01: number, level: number, f: any)
		local target = level + 0.35 + 1.4 * s01
		H[k] = math.max(target + (H[k] - target) * sstep(s01), level + 0.35)
		if s01 < 0.6 then
			hard[k] = f.beach or "Sand"
		end
	end
	for fIndex, f in s.features do
		local fi = fIndex - 1
		local t = f.type
		local shape = SHAPES[t]
		if shape then
			local R = f.radius
			local ht = if f.height ~= nil then f.height else DEFAULT_HEIGHT[t]
			local flat = if f.flat ~= nil then f.flat else shape.flat
			local rough = if f.rough ~= nil then f.rough else shape.rough
			local ax, az = f.at[1], f.at[2]
			each(ax - R * 1.2, az - R * 1.2, ax + R * 1.2, az + R * 1.2, function(k, x, z)
				local re = R * (0.85 + 0.3 * N(x + 37 * fi, z - 53 * fi, R * 0.7, 2))
				local tt = hyp(x - ax, z - az) / re
				if tt >= 1 then
					return
				end
				local u = if flat >= 1 then 0 else clamp((tt - flat) / (1 - flat), 0, 1)
				local prof = (math.cos(math.pi * u) + 1) / 2
				local add = ht * prof
				if rough ~= 0 then
					add += math.abs(ht) * rough * (N(x - 71 * fi, z + 29 * fi, 14, 2) - 0.5) * 2 * prof
				end
				H[k] += add
			end)
		elseif t == "lake" then
			local R, depth = f.radius, f.depth or 8
			local shore = if f.shore ~= nil then f.shore else 8
			local ax, az = f.at[1], f.at[2]
			-- default level: just under the lowest point of the rim, so the water never needs a dam
			local level = f.level
			if level == nil then
				local rim = math.huge
				for q = 0, 15 do
					rim = math.min(rim, height(ax + math.cos(q * math.pi / 8) * R * 1.05, az + math.sin(q * math.pi / 8) * R * 1.05))
				end
				level = r2(rim - 0.6)
			end
			f.level = level
			table.insert(bodies, { type = "lake", id = f.id, at = { ax, az }, radius = R, level = level })
			local m = R * 1.15 + shore
			each(ax - m, az - m, ax + m, az + m, function(k, x, z)
				local re = R * (0.88 + 0.24 * N(x + 61 * fi, z + 17 * fi, R * 0.8, 2))
				local d = hyp(x - ax, z - az)
				if d < re then
					local tt = d / re
					water(k, level - 0.6 - depth * (1 - tt * tt), level, f)
				elseif shore > 0 and d < re + shore then
					shoreBand(k, (d - re) / shore, level, f)
				end
			end)
		elseif t == "river" then
			local P = f.points
			local width, depth = f.width or 12, f.depth or 4
			local bank = if f.bank ~= nil then f.bank else 8
			local level = f.level
			if level == nil and f.joins then
				for _, b in bodies do
					if b.id == f.joins then
						level = b.level
						break
					end
				end
			end
			if level == nil then
				local lowest = math.huge
				for _, p in P do
					lowest = math.min(lowest, height(p[1], p[2]))
				end
				level = r2(lowest - 1)
			end
			f.level = level
			table.insert(bodies, { type = "river", id = f.id, points = P, width = width, level = level })
			local ax0, az0, ax1, az1 = math.huge, math.huge, -math.huge, -math.huge
			for _, p in P do
				ax0, az0, ax1, az1 = math.min(ax0, p[1]), math.min(az0, p[2]), math.max(ax1, p[1]), math.max(az1, p[2])
			end
			local m = width / 2 * 1.15 + bank
			each(ax0 - m, az0 - m, ax1 + m, az1 + m, function(k, x, z)
				local d = math.huge
				for q = 2, #P do
					d = math.min(d, (seg(x, z, P[q - 1], P[q])))
				end
				local hw = width / 2 * (0.85 + 0.3 * N(x + 43 * fi, z - 11 * fi, 40, 2))
				if d < hw then
					local tt = d / hw
					water(k, level - 0.6 - depth * (1 - tt * tt), level, f)
				elseif bank > 0 and d < hw + bank then
					shoreBand(k, (d - hw) / bank, level, f)
				end
			end)
		elseif t == "flatten" or t == "field" then
			-- a level pad (circle or turned rectangle) blended into its surroundings
			local blend = if f.blend ~= nil then f.blend elseif t == "field" then 10 else 12
			local rot = f.rot or 0
			local cx, cz, hw, hd, R = 0, 0, 0, 0, 0
			if f.rect then
				cx, cz = (f.rect[1] + f.rect[3]) / 2, (f.rect[2] + f.rect[4]) / 2
				hw, hd = math.abs(f.rect[3] - f.rect[1]) / 2, math.abs(f.rect[4] - f.rect[2]) / 2
			elseif f.size then
				cx, cz, hw, hd = f.at[1], f.at[2], f.size[1] / 2, f.size[2] / 2
			elseif f.at and f.radius then
				cx, cz, R = f.at[1], f.at[2], f.radius
			else
				error(`terrain feature {fIndex} ({t}) needs rect, at + size, or at + radius`)
			end
			local level = if f.height ~= nil then f.height else r2(height(cx, cz))
			f.height = level
			local reach = (if R ~= 0 then R else hyp(hw, hd)) + blend
			local rows, flatten = f.rows or 4, f.flatten ~= false
			local mat = f.material or (if t == "field" then "Mud" else nil)
			local alt = f.alt or (if t == "field" then "LeafyGrass" else nil)
			each(cx - reach, cz - reach, cx + reach, cz + reach, function(k, x, z)
				local out, lx = 0, 0
				if R ~= 0 then
					out = hyp(x - cx, z - cz) - R
				else
					local l1, l2 = w2l(cx, cz, rot, x, z)
					local ex, ez = math.abs(l1) - hw, math.abs(l2) - hd
					lx = l1
					out = if ex > 0 or ez > 0 then hyp(math.max(ex, 0), math.max(ez, 0)) else math.max(ex, ez)
				end
				if out >= blend then
					return
				end
				if out <= 0 then
					if flatten then
						H[k] = level
						locked[k] = true
					end
					if mat then
						hard[k] = if t == "field" and alt and math.floor((lx + hw) / rows) % 2 == 1 then alt else mat
					end
				elseif flatten then
					H[k] = level + (H[k] - level) * sstep(out / blend)
				end
			end)
		elseif t == "outcrop" then
			local R = f.radius
			local ht = if f.height ~= nil then f.height else 5
			local ax, az = f.at[1], f.at[2]
			each(ax - R * 1.2, az - R * 1.2, ax + R * 1.2, az + R * 1.2, function(k, x, z)
				local re = R * (0.8 + 0.4 * N(x + 19 * fi, z + 83 * fi, R * 0.6, 2))
				local tt = hyp(x - ax, z - az) / re
				if tt >= 1 then
					return
				end
				H[k] += ht * (1 - sstep(tt)) * (0.55 + 0.9 * N(x - 7 * fi, z + 3 * fi, 5, 2))
				if tt < 0.9 then
					hard[k] = f.material or "Rock"
				end
			end)
		elseif t == "paint" or t == "patches" then
			local scale, oct = f.scale or 120, f.octaves or 2
			local above = if f.above ~= nil then f.above elseif t == "patches" then 0.55 else 0
			local below = if f.below ~= nil then f.below else 1
			local off = f.offset or { 0, 0 }
			local target = if t == "patches" then soft else hard
			local box = { bx0, bz0, bx1, bz1 }
			local inside = function(_x: number, _z: number): boolean
				return true
			end
			if f.at and f.radius then
				local R = f.radius
				box = { f.at[1] - R, f.at[2] - R, f.at[1] + R, f.at[2] + R }
				inside = function(x, z)
					return hyp(x - f.at[1], z - f.at[2]) < R
				end
			elseif f.rect then
				box = f.rect
				inside = function(x, z)
					return x >= f.rect[1] and x <= f.rect[3] and z >= f.rect[2] and z <= f.rect[4]
				end
			end
			each(box[1], box[2], box[3], box[4], function(k, x, z)
				if not inside(x, z) then
					return
				end
				if above > 0 or below < 1 then
					local v = N(x + off[1], z + off[2], scale, oct)
					if v < above or v > below then
						return
					end
				end
				target[k] = f.material or "LeafyGrass"
			end)
		end
	end

	-- 3. paths: a level bed along each trail, blended into the slope beside it, painted
	if s.paths and paths then
		for _, pa in paths do
			local P0 = pa.points
			if not P0 or #P0 < 2 then
				continue
			end
			-- resample every 8 studs so the bed follows the ground (and eases into pads) instead
			-- of cutting straight lines between far-apart points
			local P = { P0[1] }
			for q = 2, #P0 do
				local a, b = P0[q - 1], P0[q]
				local m = math.max(1, math.ceil(hyp(b[1] - a[1], b[2] - a[2]) / 8))
				for st = 1, m do
					table.insert(P, { a[1] + (b[1] - a[1]) * st / m, a[2] + (b[2] - a[2]) * st / m })
				end
			end
			local hw = (pa.width or 6) / 2
			local band = hw + (if pa.blend ~= nil then pa.blend else 6)
			local mat = pa.material or (if pa.kind == "trail" then "Ground" else "Cobblestone")
			local tv = {}
			for q, p in P do
				tv[q] = height(p[1], p[2])
			end
			for _ = 1, 4 do
				local nextTv = table.clone(tv)
				for q = 2, #tv - 1 do
					nextTv[q] = (tv[q - 1] + 2 * tv[q] + tv[q + 1]) / 4
				end
				tv = nextTv
			end
			local bestD, bestY, touched = {} :: { [number]: number }, {} :: { [number]: number }, {} :: { number }
			for q = 2, #P do
				local a, b = P[q - 1], P[q]
				each(math.min(a[1], b[1]) - band, math.min(a[2], b[2]) - band, math.max(a[1], b[1]) + band, math.max(a[2], b[2]) + band, function(k, x, z)
					local d, along = seg(x, z, a, b)
					local e = bestD[k]
					if d < band and (e == nil or d < e) then
						if e == nil then
							table.insert(touched, k)
						end
						bestD[k] = d
						bestY[k] = tv[q - 1] + (tv[q] - tv[q - 1]) * along
					end
				end)
			end
			for _, k in touched do
				if W[k] ~= NONE then
					continue
				end
				local d, y = bestD[k], bestY[k]
				if locked[k] then -- pads stay level; the trail is only painted across them
					if d <= hw and not hard[k] then
						hard[k] = mat
					end
					continue
				end
				if d <= hw then
					H[k] = y
					hard[k] = mat
				else
					H[k] = y + (H[k] - y) * sstep((d - hw) / (band - hw))
				end
			end
		end
	end

	-- 3b. sea: every bit of ground under the sea level is under water, with sand just above it
	if s.sea ~= nil then
		table.insert(bodies, { type = "sea", level = s.sea })
		for k = 1, n do
			if W[k] ~= NONE then
				continue
			end
			if H[k] < s.sea then
				W[k] = s.sea
				if not hard[k] then
					hard[k] = if s.sea - H[k] < 2.2 then "Sand" else "Mud"
				end
			elseif H[k] < s.sea + 1.5 and not hard[k] then
				hard[k] = "Sand"
			end
		end
	end

	-- 4. surface material: painted > too steep for grass > snow line > patches > ground
	local deg, mat = table.create(n, 0) :: { number }, table.create(n, "") :: { string }
	local lo, hi, wtop = math.huge, -math.huge, NONE
	for j = 0, nz - 1 do
		for i = 0, nx - 1 do
			local k = j * nx + i + 1
			local i0, i1 = math.max(0, i - 1), math.min(nx - 1, i + 1)
			local j0, j1 = math.max(0, j - 1), math.min(nz - 1, j + 1)
			local gx = (H[j * nx + i1 + 1] - H[j * nx + i0 + 1]) / (cell * (i1 - i0))
			local gz = (H[j1 * nx + i + 1] - H[j0 * nx + i + 1]) / (cell * (j1 - j0))
			local d = math.atan(math.sqrt(gx * gx + gz * gz)) * 180 / math.pi
			deg[k] = d
			mat[k] = hard[k]
				or (if d >= s.rock then "Rock" elseif s.snow ~= nil and H[k] >= s.snow then "Snow" elseif d >= s.dirt then "Ground" else soft[k] or s.ground)
			lo, hi = math.min(lo, H[k]), math.max(hi, H[k])
			if W[k] > wtop then
				wtop = W[k]
			end
		end
	end
	local sampler: any = {
		spec = s, nx = nx, nz = nz, x0 = x0, z0 = z0, cell = cell, H = H, W = W, deg = deg, mat = mat,
		bodies = bodies, lo = lo, hi = hi, wtop = wtop,
	}
	return setmetatable(sampler, SamplerMethods) :: any
end

export type WriteOptions = {
	Origin: Vector3?, -- where the layout's (0, 0, 0) goes; terrain is axis aligned, so no rotation
	Terrain: Terrain?,
	YieldEvery: number?, -- task.wait() after this many chunks
	Chunk: number?, -- columns per chunk side (default 32 = 128 studs)
}

local function enumMaterial(name: string): Enum.Material
	local ok, m = pcall(function()
		return (Enum.Material :: any)[name]
	end)
	return if ok and m then m else Enum.Material.Grass
end

-- Write the sampled ground into Roblox Terrain with WriteVoxels, chunk by chunk. Everything in the
-- covered region is replaced, air above the surface included, so existing terrain there is lost.
function TerrainGen.Write(sampler: Sampler, options: WriteOptions?): { voxels: number, region: Region3 }
	local o: WriteOptions = options or {}
	local terrain: Terrain = o.Terrain or workspace.Terrain
	local origin = o.Origin or Vector3.zero
	local s = sampler.spec
	local R = 4
	local wx0 = math.floor((origin.X + sampler.x0) / R) * R
	local wz0 = math.floor((origin.Z + sampler.z0) / R) * R
	local wx1 = math.ceil((origin.X + sampler.x0 + (sampler.nx - 1) * sampler.cell) / R) * R
	local wz1 = math.ceil((origin.Z + sampler.z0 + (sampler.nz - 1) * sampler.cell) / R) * R
	local top = math.max(sampler.hi, sampler.wtop)
	local wy0 = math.floor((origin.Y + sampler.lo - (s.depth or 16)) / R) * R
	local wy1 = math.ceil((origin.Y + top + 8) / R) * R
	local cols, rows, layers = (wx1 - wx0) / R, (wz1 - wz0) / R, (wy1 - wy0) / R
	local chunk = o.Chunk or 32
	local mats: { [string]: Enum.Material } = {}
	local function m(name: string): Enum.Material
		local e = mats[name]
		if not e then
			e = enumMaterial(name)
			mats[name] = e
		end
		return e
	end
	local deep = { Rock = true, Snow = true, Slate = true, Basalt = true, Glacier = true, Ice = true }
	local voxels, written = 0, 0
	for cz = 0, rows - 1, chunk do
		for cx = 0, cols - 1, chunk do
			local w, d = math.min(chunk, cols - cx), math.min(chunk, rows - cz)
			local matArr, occArr = table.create(w), table.create(w)
			for i = 1, w do
				local mCol, oCol = table.create(layers), table.create(layers)
				for y = 1, layers do
					mCol[y] = table.create(d, Enum.Material.Air)
					oCol[y] = table.create(d, 0)
				end
				matArr[i], occArr[i] = mCol, oCol
				for k = 1, d do
					local lx = wx0 + (cx + i - 1) * R + R / 2 - origin.X
					local lz = wz0 + (cz + k - 1) * R + R / 2 - origin.Z
					local h = origin.Y + sampler:Height(lx, lz)
					local wl = sampler:Water(lx, lz)
					local wy = if wl then origin.Y + wl else nil
					local surface = sampler:Material(lx, lz)
					local below = if deep[surface] then "Rock" else "Ground"
					for y = 1, layers do
						local bottom = wy0 + (y - 1) * R
						local occ = clamp((h - bottom) / R, 0, 1)
						if occ > 0 and wy and wy >= bottom + R and occ < 0.6 then
							mCol[y][k], oCol[y][k] = Enum.Material.Water, 1
						elseif occ > 0 then
							mCol[y][k] = m(if h - bottom < 2 * R then surface else below)
							oCol[y][k] = occ
						elseif wy and wy > bottom then
							mCol[y][k], oCol[y][k] = Enum.Material.Water, clamp((wy - bottom) / R, 0, 1)
						end
					end
				end
			end
			local min = Vector3.new(wx0 + cx * R, wy0, wz0 + cz * R)
			local region = Region3.new(min, min + Vector3.new(w * R, layers * R, d * R)):ExpandToGrid(R)
			terrain:WriteVoxels(region, R, matArr, occArr)
			voxels += w * d * layers
			written += 1
			if o.YieldEvery and written % o.YieldEvery == 0 then
				task.wait()
			end
		end
	end
	if s.colors then
		for name, hex in s.colors do
			if name ~= "Water" then
				terrain:SetMaterialColor(m(name), Color3.fromHex(hex))
			end
		end
	end
	if s.water then
		if s.water.color then
			terrain.WaterColor = Color3.fromHex(s.water.color)
		end
		if s.water.transparency then
			terrain.WaterTransparency = s.water.transparency
		end
		if s.water.waveSize then
			terrain.WaterWaveSize = s.water.waveSize
		end
		if s.water.waveSpeed then
			terrain.WaterWaveSpeed = s.water.waveSpeed
		end
		if s.water.reflectance then
			terrain.WaterReflectance = s.water.reflectance
		end
	end
	return { voxels = voxels, region = Region3.new(Vector3.new(wx0, wy0, wz0), Vector3.new(wx1, wy1, wz1)) }
end

-- Sample and write in one call.
function TerrainGen.Build(spec: any, paths: { any }?, options: WriteOptions?, layout: any?): Sampler
	local sampler = TerrainGen.Sample(spec, paths, layout)
	TerrainGen.Write(sampler, options)
	return sampler
end

return TerrainGen
