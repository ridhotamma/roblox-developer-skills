--!strict
-- Procedural obby courses: a new one per seed, always beatable. Each stage turns one knob
-- (plain hops, stairs, stepping stones, beams, drops, kill bricks), difficulty ramps from the
-- first stage to the last, and a checkpoint platform sits between stages.
--
--   local layout = ObbyGen.Generate({ seed = 42, stages = 8 })
--   LayoutBuilder.Build(layout, { Parent = workspace, Catalog = LayoutCatalog })
--
-- Gaps come from Spacing.JumpBand, so pass your game's metrics if you change WalkSpeed,
-- JumpHeight or Gravity. This is a port of the generator behind `rlayout.cjs new obby`: preview a
-- seed in the browser first, then ship the seed.

local Rng = require("./Rng")
local Spacing = require("./Spacing")

local ObbyGen = {}

export type Options = {
	seed: number?,
	stages: number?, -- default 6
	jumps: number?, -- per stage, default 7
	easy: number?, -- difficulty of the first stage, 0..1 (default 0.15)
	hard: number?, -- difficulty of the last stage (default 0.85)
	metrics: Spacing.Metrics?,
	name: string?,
	origin: { number }?, -- top of the start platform, default { 0, 24, 0 }
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

local function hsl(h: number, s: number, l: number): string
	h %= 360
	s /= 100
	l /= 100
	local a = s * math.min(l, 1 - l)
	local function f(n: number): number
		local k = (n + h / 30) % 12
		return math.floor(255 * (l - a * math.max(-1, math.min(k - 3, math.min(9 - k, 1)))) + 0.5)
	end
	return string.format("#%02X%02X%02X", f(0), f(8), f(4))
end

-- Each pattern returns the next platform: size, rise, turn in degrees.
local ORDER = { "hops", "stairs", "stones", "beams", "drops", "lava" }
local PATTERNS: { [string]: (j: number, t: number, rng: any) -> any } = {
	hops = function(_, t, rng)
		return { w = lerp(9, 5, t), d = lerp(9, 5, t), dy = 0, turn = rng:Range(-14, 14) }
	end,
	stairs = function(_, t)
		return { w = lerp(8, 5, t), d = lerp(7, 4.5, t), dy = lerp(2, 5, t), turn = 16 }
	end,
	stones = function(j, t, rng)
		return { w = lerp(6.5, 3.6, t), d = lerp(6.5, 3.6, t), dy = rng:Pick({ 0, 0, 1, -1 }), turn = (if j % 2 == 1 then 1 else -1) * 28, shape = "cylinder" }
	end,
	beams = function(j, t)
		return { w = lerp(4, 2, t), d = 14, dy = 0, turn = (if j % 2 == 1 then 1 else -1) * 32 }
	end,
	drops = function(_, t, rng)
		return { w = 7, d = 7, dy = -lerp(2, 5, t), turn = rng:Range(-10, 10) }
	end,
	lava = function()
		return { w = 10, d = 13, dy = 0, turn = 0, hazard = true }
	end,
}
ObbyGen.Patterns = PATTERNS

function ObbyGen.Generate(options: Options?): any
	local o: Options = options or {}
	local rng = Rng.new(o.seed or 1)
	local m = { walkSpeed = 16, jumpHeight = 7.2, gravity = 196.2 }
	for k, v in (o.metrics or {}) :: any do
		(m :: any)[k] = v
	end
	local stages, per = o.stages or 6, o.jumps or 7
	local d0, d1 = o.easy or 0.15, o.hard or 0.85
	local items, route, zones, placed = {}, {}, {}, {}
	local origin = o.origin or { 0, 24, 0 }
	local x, y, z, head, n = origin[1], origin[2], origin[3], 0, 0
	local prev: any = nil
	local turnSign = rng:Sign()
	local last = ""

	local function poly(p: any)
		return Spacing.Polygon({ x = p.x, z = p.z, w = p.w, d = p.d, rot = p.rot })
	end

	local function place(spec: any, gap: number, color: string, zone: string, checkpoint: boolean?): any
		local best: any = nil
		for _, tryTurn in { spec.turn, -spec.turn, spec.turn * 2, -spec.turn * 2, 0 } do
			local h = head + tryTurn
			local fx, fz = -math.sin(math.rad(h)), -math.cos(math.rad(h))
			local dist = if prev then prev.d / 2 + gap + spec.d / 2 else 0
			local p: any
			for _ = 1, 6 do
				p = { x = x + fx * dist, z = z + fz * dist, rot = norm(h), w = spec.w, d = spec.d, y = y + spec.dy }
				if not prev then
					break
				end
				local got = Spacing.PolygonGap(poly(prev), poly(p))
				if math.abs(got - gap) < 0.05 then
					break
				end
				dist += gap - got
			end
			-- don't run a later stretch through an earlier one
			local clash = false
			for i = 1, #placed - 2 do
				local q = placed[i]
				if math.abs(q.y - p.y) < 16 and Spacing.PolygonGap(poly(q), poly(p)) < 9 then
					clash = true
					break
				end
			end
			if not clash or not best then
				best = { p = p, h = h }
			end
			if not clash then
				break
			end
		end
		local p = best.p
		head, x, z, y = best.h, p.x, p.z, p.y
		n += 1
		local id = "p" .. n
		table.insert(items, {
			id = id, kind = "platform", role = "platform", shape = spec.shape,
			pos = { round(x), round(y - 1.6), round(z) }, size = { round(spec.w), 1.6, round(spec.d) },
			rot = p.rot, color = color, material = "SmoothPlastic", zone = zone,
			tags = if checkpoint then { "checkpoint" } else nil,
		})
		table.insert(route, id)
		table.insert(placed, p)
		prev = p
		return p
	end

	local function gapFor(dy: number, t: number, landing: number?): number
		local lo, hi, reach = Spacing.JumpBand(dy, m)
		local land = landing or 9
		local penalty = if land < 4 then (4 - land) * 0.12 else 0
		return math.clamp(lerp(lo, hi, math.clamp(t - penalty, 0, 1)), 2, reach - 1)
	end

	local start = place({ w = 18, d = 18, dy = 0, turn = 0 }, 0, "#F2F2F2", "Start", true)
	table.insert(items, { kind = "spawn", pos = { start.x, y, start.z } })

	for s = 0, stages - 1 do
		local t = if stages > 1 then lerp(d0, d1, s / (stages - 1)) else d0
		local zone = "S" .. (s + 1)
		local name: string
		repeat
			name = if s == 0 then "hops" else rng:Pick(ORDER)
		until not (name == last or (name == "drops" and y < 14) or (name == "stairs" and y > 70))
		last = name
		local hue = 205 + s * (300 / math.max(1, stages))
		local color, dark = hsl(hue, 72, 62), hsl(hue, 60, 46)
		for j = 0, per - 1 do
			local sp = PATTERNS[name](j, t, rng)
			sp.w, sp.d, sp.dy = round(sp.w, 2), round(sp.d, 2), round(sp.dy, 2)
			local p = place(sp, gapFor(sp.dy, t, math.min(sp.w, sp.d)), if j % 2 == 1 then color else dark, zone)
			if sp.hazard then
				table.insert(items, {
					kind = "hazard", role = "hazard", walkable = true, pos = { round(p.x), y, round(p.z) },
					size = { sp.w, round(lerp(1, 2.6, t), 10), round(lerp(1.5, 3.5, t), 10) }, rot = p.rot,
					color = "hazard", material = "Neon", zone = zone,
				})
			end
		end
		-- rest platform: a checkpoint, a turn, a breath
		turnSign = -turnSign
		local fin = s == stages - 1
		local size = if fin then 20 else 14
		local cp = place({ w = size, d = size, dy = 0, turn = turnSign * rng:Range(35, 70) }, gapFor(0, math.min(t, 0.4)), if fin then "#FFE08A" else "#F2F2F2", if fin then "Finish" else "S" .. (s + 2), true)
		table.insert(items, { kind = if fin then "finish" else "checkpoint", pos = { round(cp.x), y, round(cp.z) }, rot = cp.rot })
		table.insert(zones, { id = zone, label = ("Stage %d: %s"):format(s + 1, name), circle = { round(cp.x), round(cp.z), 8 }, y = y })
	end

	return {
		name = o.name or "Obby", type = "obby", seed = o.seed or 1, metrics = m,
		spawn = { start.x, start.y, start.z }, zones = zones, route = route, items = items,
	}
end

return ObbyGen
