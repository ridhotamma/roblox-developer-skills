-- Runs the kit's generators outside Roblox (needs the `luau` CLI) and prints the layout as JSON,
-- so selftest.cjs can check it and compare it with the JavaScript generators.
--   luau kitdump.luau -a wilderness 7      luau kitdump.luau -a obby 7      luau kitdump.luau -a rng 7
--   luau kitdump.luau -a terrain <case module path>   (heights, water and materials on a grid)
local WorldGen = require("../assets/kit/shared/Layout/WorldGen")
local ObbyGen = require("../assets/kit/shared/Layout/ObbyGen")
local Rng = require("../assets/kit/shared/Layout/Rng")
local Spacing = require("../assets/kit/shared/Layout/Spacing")
local Scatter = require("../assets/kit/shared/Layout/Scatter")
local TerrainGen = require("../assets/kit/shared/Layout/TerrainGen")

local function encode(v: any): string
	local t = type(v)
	if t == "table" then
		local parts = {}
		if #v > 0 or next(v) == nil then
			for _, x in v do
				table.insert(parts, encode(x))
			end
			return "[" .. table.concat(parts, ",") .. "]"
		end
		local keys = {}
		for k in v do
			table.insert(keys, k)
		end
		table.sort(keys)
		for _, k in keys do
			table.insert(parts, string.format("%q:%s", k, encode(v[k])))
		end
		return "{" .. table.concat(parts, ",") .. "}"
	elseif t == "string" then
		return string.format("%q", v)
	elseif t == "number" then
		return if v ~= v or v == math.huge or v == -math.huge then "null" else string.format("%.10g", v)
	end
	return tostring(v)
end

local args = { ... }
local what, seed = args[1] or "wilderness", tonumber(args[2]) or 1
if what == "terrain" then
	-- the case module returns { spec = ..., paths = ..., probe = { { x, z }, ... } }
	local case = require(args[2])
	local t = TerrainGen.Sample(case.spec, case.paths)
	local out = { levels = {}, h = {}, w = {}, m = {}, s = {} }
	for _, b in t.bodies do
		table.insert(out.levels, b.level)
	end
	for _, p in case.probe do
		table.insert(out.h, t:Height(p[1], p[2]))
		table.insert(out.w, t:Water(p[1], p[2]) or -1e9)
		table.insert(out.m, t:Material(p[1], p[2]))
		table.insert(out.s, t:Slope(p[1], p[2]))
	end
	print(encode(out))
elseif what == "wilderness" then
	print(encode(WorldGen.Generate({ seed = seed, size = tonumber(args[3]) })))
elseif what == "obby" then
	print(encode(ObbyGen.Generate({ seed = seed })))
elseif what == "rng" then
	local r, n = Rng.new(seed), Rng.Noise(seed)
	local out = {}
	for i = 1, 8 do
		table.insert(out, r:Next())
	end
	for i = 1, 4 do
		table.insert(out, n(i * 37.5, -i * 11.25, 90, 2))
	end
	table.insert(out, Spacing.JumpReach(0))
	table.insert(out, Spacing.JumpDifficulty(6, 2, 5))
	local d = Spacing.Distribute(30, { 6, 6, 6 }, 4, "even") :: { number }
	table.insert(out, d[2])
	local ok, reason = Spacing.CanPlace({ x = 0, z = 0, w = 4, d = 4 }, { { x = 6, z = 0, w = 4, d = 4 } })
	table.insert(out, if ok then 1 else 0)
	table.insert(out, reason or "none")
	local ok2 = Spacing.CanPlace({ x = 0, z = 0, w = 4, d = 4 }, { { x = 9, z = 0, w = 4, d = 4 } })
	table.insert(out, if ok2 then 1 else 0)
	local x, z = Scatter.JitterCell(seed, 3, -2, 12)
	local x2, z2 = Scatter.JitterCell(seed, 3, -2, 12)
	table.insert(out, if x == x2 and z == z2 and x ~= nil then 1 else 0)
	table.insert(out, #Scatter.JitterRect(seed, 0, 0, 120, 120, 12))
	print(encode(out))
end
