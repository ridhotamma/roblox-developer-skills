--!strict
-- Procedural survival / exploration maps from a seed: lakes, points of interest a short walk
-- apart, trails that connect them in loops, forests that thin into meadows, rocks, and resources
-- spread so no player starts far from wood, stone and food.
--
--   local layout = WorldGen.Generate({ seed = os.time(), size = 640 })
--   LayoutBuilder.Build(layout, { Parent = workspace, Catalog = LayoutCatalog, YieldEvery = 60 })
--
-- The order matters and is the whole design: water, then places, then the trails between them,
-- then resources, then decoration. Each layer keeps clear of the ones before it, so trails stay
-- open and clearings stay clear without any cleanup pass.
-- This is a port of the generator behind `rlayout.cjs new wilderness`: tune a seed in the
-- browser preview, then ship the seed.

local Rng = require("./Rng")
local Scatter = require("./Scatter")
local Catalog = require("./LayoutCatalog")

local WorldGen = {}

export type Options = {
	seed: number?,
	size: number?, -- studs per side, default 640
	lakes: number?, -- default 2
	pois: number?, -- points of interest besides the spawn camp
	name: string?,
}

local function lerp(a: number, b: number, t: number): number
	return a + (b - a) * t
end
local function round(v: number, p: number?): number
	local q = p or 100
	return math.floor(v * q + 0.5) / q
end
local function norm(r: number): number
	return math.floor(r + 0.5) % 360
end
local function hypot(x: number, z: number): number
	return math.sqrt(x * x + z * z)
end
local function l2w(x: number, z: number, rot: number, lx: number, lz: number): (number, number)
	local c, s = math.cos(math.rad(rot)), math.sin(math.rad(rot))
	return x + lx * c + lz * s, z - lx * s + lz * c
end

-- A ready-made group from the catalog (a camp, a rock cluster), turned and moved into place.
local function setItems(name: string, x: number, z: number, rot: number, group: string): { any }
	local out = {}
	for _, s in Catalog.sets[name] do
		local wx, wz = l2w(x, z, rot, s.lx or 0, s.lz or 0)
		table.insert(out, { kind = s.kind, pos = { round(wx), 0, round(wz) }, rot = ((s.rot or 0) + rot + 360) % 360, group = group, size = s.size, scale = s.scale })
	end
	return out
end
WorldGen.SetItems = setItems

local TYPES = { { "Watchtower", 14 }, { "Ruins", 22 }, { "Cabin", 20 }, { "Quarry", 20 }, { "Shrine", 16 }, { "Old camp", 20 } }

function WorldGen.Generate(options: Options?): any
	local o: Options = options or {}
	local seed = o.seed or 1
	local rng, noise = Rng.new(seed), Rng.Noise(seed)
	local S = o.size or 640
	local c = S / 2
	local items, zones, pois, paths = {}, {}, {}, {}
	local function push(list: { any })
		for _, it in list do
			table.insert(items, it)
		end
	end
	table.insert(items, { kind = "ground", role = "floor", pos = { c, -1, c }, size = { S, 1, S }, color = "grass", material = "Grass" })

	-- 1. water: everything else works around it
	local lakes: { { number } } = {}
	local wantLakes, tries = o.lakes or 2, 0
	while #lakes < wantLakes and tries < 60 do
		tries += 1
		local r = rng:Range(42, 68)
		local x, z = rng:Range(r + 30, S - r - 30), rng:Range(r + 30, S - r - 30)
		local ok = hypot(x - c, z - c) >= r + 90
		for _, l in lakes do
			if hypot(l[1] - x, l[2] - z) < l[3] + r + 60 then
				ok = false
			end
		end
		if ok then
			table.insert(lakes, { x, z, r })
			table.insert(items, { kind = "shore", role = "decor", shape = "cylinder", pos = { round(x), 0, round(z) }, size = { 2 * r + 12, 0.15, 2 * r + 12 }, color = "sand", material = "Sand" })
			table.insert(items, { kind = "water", role = "decor", shape = "cylinder", pos = { round(x), 0, round(z) }, size = { 2 * r, 0.3, 2 * r }, color = "water", material = "Glass" })
			table.insert(zones, { id = "lake" .. #lakes, label = "Lake", kind = "water", circle = { round(x), round(z), round(r) } })
		end
	end
	local function inLake(x: number, z: number, margin: number): boolean
		for _, l in lakes do
			if hypot(l[1] - x, l[2] - z) < l[3] + margin then
				return true
			end
		end
		return false
	end

	-- 2. points of interest, 6 to 15 seconds of walking apart
	local P: { any } = { { id = "camp", label = "Spawn camp", x = c, z = c, r = 24, t = "camp" } }
	local want = o.pois or math.max(4, math.floor(S * S / 60000 + 0.5))
	local cand = Scatter.Poisson(rng, 70, 70, S - 70, S - 70, function(x, z)
		return if inLake(x, z, 34) or hypot(x - c, z - c) < 130 then 0 else 150
	end, { rMin = 150 })
	for i = 1, math.min(want, #cand) do
		local t = TYPES[(i - 1) % #TYPES + 1]
		table.insert(P, { id = "poi" .. i, label = t[1], x = round(cand[i].x), z = round(cand[i].z), r = t[2] + 6, t = t[1] })
	end
	for i, l in lakes do
		local a = math.atan2(c - l[2], c - l[1])
		table.insert(P, { id = "dock" .. i, label = "Dock", x = round(l[1] + math.cos(a) * (l[3] - 6)), z = round(l[2] + math.sin(a) * (l[3] - 6)), r = 14, t = "Dock", a = a })
	end
	local occupied = Scatter.Occupied()
	for _, p in P do
		local dock = p.t == "Dock"
		table.insert(pois, { id = p.id, label = p.label, pos = if dock then { round(p.x + math.cos(p.a) * 20), round(p.z + math.sin(p.a) * 20) } else { p.x, p.z } })
		if not dock then
			table.insert(zones, { id = p.id, label = p.label, circle = { p.x, p.z, p.r }, open = true, main = true })
		end
		local rot = rng:Int(0, 3) * 90 + rng:Int(-20, 20)
		if p.t == "camp" or p.t == "Old camp" then
			push(setItems("camp", p.x, p.z, rot, p.id))
		elseif p.t == "Ruins" then
			push(setItems("ruins", p.x, p.z, rot, p.id))
		elseif p.t == "Watchtower" then
			table.insert(items, { kind = "watchtower", pos = { p.x, 0, p.z }, rot = norm(rot), group = p.id })
		elseif p.t == "Cabin" then
			table.insert(items, { kind = "cabin", pos = { p.x, 0, p.z }, rot = norm(math.deg(math.atan2(p.x - c, p.z - c))), group = p.id })
		elseif p.t == "Quarry" then
			push(setItems("rocks", p.x, p.z, rot, p.id))
			table.insert(items, { kind = "ore_node", pos = { p.x + 11, 0, p.z - 8 }, rot = 200, group = p.id })
			table.insert(items, { kind = "ore_node", pos = { p.x - 12, 0, p.z - 6 }, rot = 140, group = p.id })
			table.insert(items, { kind = "crate", pos = { p.x - 4, 0, p.z + 12 }, rot = 25, group = p.id })
		elseif p.t == "Shrine" then
			for a = 0, 300, 60 do
				table.insert(items, { kind = "pillar", pos = { round(p.x + math.cos(math.rad(a)) * 11), 0, round(p.z + math.sin(math.rad(a)) * 11) }, group = p.id })
			end
			table.insert(items, { kind = "pedestal", pos = { p.x, 0, p.z }, group = p.id })
		elseif dock then
			table.insert(items, { kind = "dock", pos = { p.x, 0, p.z }, rot = norm(math.deg(math.atan2(math.cos(p.a), math.sin(p.a))) + 180), group = p.id })
		end
		occupied:Add(p.x, p.z, p.r)
	end

	-- 3. trails: a spanning tree so every place is connected, plus a few loops so it isn't a maze of dead ends
	local edges: { { number } } = {}
	local inTree: { [number]: boolean } = { [1] = true }
	local treeOrder = { 1 }
	while #treeOrder < #P do
		local best: { number }? = nil
		for _, i in treeOrder do
			for j = 1, #P do
				if not inTree[j] then
					local d = hypot(P[i].x - P[j].x, P[i].z - P[j].z)
					if not best or d < best[3] then
						best = { i, j, d }
					end
				end
			end
		end
		local b = best :: { number }
		inTree[b[2]] = true
		table.insert(treeOrder, b[2])
		table.insert(edges, b)
	end
	local extra = 0
	for i = 2, #P do
		if extra >= math.ceil(#P / 3) then
			break
		end
		local near = {}
		for j, q in P do
			if j ~= i then
				table.insert(near, { j, hypot(P[i].x - q.x, P[i].z - q.z) })
			end
		end
		table.sort(near, function(a, b)
			return a[2] < b[2]
		end)
		local second = near[2]
		if second and second[2] < 330 then
			local have = false
			for _, e in edges do
				if (e[1] == i and e[2] == second[1]) or (e[2] == i and e[1] == second[1]) then
					have = true
				end
			end
			if not have then
				table.insert(edges, { i, second[1], second[2] })
				extra += 1
			end
		end
	end
	local segments: { { { number } } } = {}
	for k, e in edges do
		local a, b, d = P[e[1]], P[e[2]], e[3]
		local nx, nz = -(b.z - a.z) / d, (b.x - a.x) / d
		local points = {}
		local steps = math.max(3, math.floor(d / 45 + 0.5))
		for s = 0, steps do
			local t = s / steps
			local x, z = lerp(a.x, b.x, t), lerp(a.z, b.z, t)
			local bend = math.sin(t * math.pi) * (noise(x + (k - 1) * 31, z, 90, 1) - 0.5) * d * 0.3
			x += nx * bend
			z += nz * bend
			for _, l in lakes do
				local dl = hypot(x - l[1], z - l[2])
				if dl < l[3] + 14 and a.t ~= "Dock" and b.t ~= "Dock" then
					x, z = l[1] + (x - l[1]) / dl * (l[3] + 14), l[2] + (z - l[2]) / dl * (l[3] + 14)
				end
			end
			table.insert(points, { round(x, 10), round(z, 10) })
		end
		table.insert(paths, { id = "trail" .. k, kind = "trail", width = 7, points = points })
		for s = 2, #points do
			table.insert(segments, { points[s - 1], points[s] })
		end
	end
	local function nearPath(x: number, z: number, margin: number): boolean
		for _, seg in segments do
			local a, b = seg[1], seg[2]
			local dx, dz = b[1] - a[1], b[2] - a[2]
			local l2 = dx * dx + dz * dz
			local t = if l2 > 0 then math.clamp(((x - a[1]) * dx + (z - a[2]) * dz) / l2, 0, 1) else 0
			if hypot(x - (a[1] + dx * t), z - (a[2] + dz * t)) < margin then
				return true
			end
		end
		return false
	end
	local function free(x: number, z: number, margin: number): boolean
		return x > 8 and z > 8 and x < S - 8 and z < S - 8 and not inLake(x, z, 7 + margin) and not nearPath(x, z, 5.5 + margin) and not occupied:Any(x, z, margin)
	end
	local function forest(x: number, z: number): number
		return noise(x, z, 170, 3)
	end
	local function rocky(x: number, z: number): number
		return noise(x + 913, z - 577, 130, 2)
	end
	local function drop(kind: string, p: { x: number, z: number }, scale: number?, keepClear: number?)
		local rot = rng:Int(0, 359)
		local rolled = round(rng:Range(0.82, 1.24))
		table.insert(items, { kind = kind, pos = { round(p.x, 10), 0, round(p.z, 10) }, rot = rot, scale = scale or rolled })
		occupied:Add(p.x, p.z, keepClear or 2.5)
	end

	-- 4. a fair start: wood, stone and food within a few seconds of spawn
	for k = 0, 3 do
		local a, d = rng:Range(0, 6.28), 34 + k * 5
		drop(if k % 2 == 1 then "pine" else "oak", { x = c + math.cos(a) * d, z = c + math.sin(a) * d })
	end
	do
		local a = rng:Range(0, 6.28)
		push(setItems("rocks", round(c + math.cos(a) * 44), round(c + math.sin(a) * 44), rng:Int(0, 359), "start_rocks"))
		occupied:Add(c + math.cos(a) * 44, c + math.sin(a) * 44, 9)
		drop("berry_bush", { x = c + math.cos(a + 2.2) * 38, z = c + math.sin(a + 2.2) * 38 }, 1)
	end

	-- 5. resources before decoration, so they get the good spots and stay evenly spread
	for _, p in Scatter.Poisson(rng, 20, 20, S - 20, S - 20, function(x, z)
		return if rocky(x, z) > 0.55 and free(x, z, 5) then 64 else 0
	end, { rMin = 64 }) do
		drop("ore_node", p, 1, 7)
	end
	for _, p in Scatter.Poisson(rng, 20, 20, S - 20, S - 20, function(x, z)
		local f = forest(x, z)
		return if f > 0.4 and f < 0.56 and free(x, z, 4) then 56 else 0
	end, { rMin = 56 }) do
		drop("berry_bush", p, 1, 6)
	end
	for _, p in Scatter.Poisson(rng, 20, 20, S - 20, S - 20, function(x, z)
		return if rocky(x, z) > 0.6 and free(x, z, 9) then 36 else 0
	end, { rMin = 36 }) do
		local group = "rocks" .. #items
		push(setItems("rocks", round(p.x), round(p.z), rng:Int(0, 359), group))
		occupied:Add(p.x, p.z, 12)
	end

	-- 6. trees: dense in forest, thinning at its edge, a few lone ones in the meadows
	local function treeSpacing(x: number, z: number): number
		if not free(x, z, 2.5) then
			return 0
		end
		local f = forest(x, z)
		if f > 0.5 then
			return lerp(19, 10.5, math.clamp((f - 0.5) / 0.22, 0, 1))
		end
		return if f > 0.43 then 28 else 44
	end
	for _, p in Scatter.Poisson(rng, 10, 10, S - 10, S - 10, treeSpacing, { rMin = 10.5, rMax = 44, tries = math.ceil(S * S / 22) }) do
		local f, species = forest(p.x, p.z), noise(p.x - 300, p.z + 200, 240, 1)
		local kind = if f < 0.5 and rng:Chance(0.4) then "birch" elseif species > 0.52 then "pine" else "oak"
		drop(kind, p)
	end
	for _, p in Scatter.Poisson(rng, 10, 10, S - 10, S - 10, function(x, z)
		local f = forest(x, z)
		return if f > 0.4 and f < 0.54 and free(x, z, 3) then 13 else 0
	end, { rMin = 13 }) do
		drop("bush", p)
	end
	for _, p in Scatter.Poisson(rng, 10, 10, S - 10, S - 10, function(x, z)
		return if forest(x, z) < 0.44 and free(x, z, 0.5) then 11 else 0
	end, { rMin = 11 }) do
		table.insert(items, { kind = "flowers", pos = { round(p.x, 10), 0, round(p.z, 10) }, rot = rng:Int(0, 359) })
	end

	return {
		name = o.name or "Wilderness", type = "wilderness", seed = seed,
		spawn = { c, 0, c + 9 }, bounds = { min = { 0, 0 }, max = { S, S } },
		zones = zones, pois = pois, paths = paths, items = items,
	}
end

return WorldGen
