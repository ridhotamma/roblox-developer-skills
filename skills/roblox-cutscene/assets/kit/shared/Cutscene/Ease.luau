--!strict
-- Easing curves, angle blending and a spline for camera and actor moves. Pure: no Instances.
--
-- Which ease a real operator would give you:
--   InOut   a dolly or crane move that starts and lands gently (the default)
--   Out     a move that is already under way when the shot cuts in, then settles
--   In      a move that accelerates into the next cut (a charge, a fall)
--   Sine    a softer InOut for slow drifts
--   Snap    a snap zoom / crash zoom: almost all of the move in the first few frames
--   Settle  overshoots a little and comes back, like an operator landing a whip pan
--   Linear  mechanical: a track, a security camera pan, a conveyor
--   Hold    stays at the start, jumps to the end at 1 (a step, for testing)

local Ease = {}

Ease.Names = table.freeze({ "Linear", "In", "Out", "InOut", "Sine", "Snap", "Settle", "Hold" })

local VALID: { [string]: boolean } = {}
for _, name in Ease.Names do
	VALID[name] = true
end

function Ease.IsValid(name: string?): boolean
	return name == nil or VALID[name] == true
end

-- Maps 0..1 to 0..1. `nil` means InOut.
function Ease.Apply(name: string?, x: number): number
	x = math.clamp(x, 0, 1)
	if name == nil or name == "InOut" then
		return if x < 0.5 then 4 * x * x * x else 1 - ((-2 * x + 2) ^ 3) / 2
	elseif name == "Linear" then
		return x
	elseif name == "In" then
		return x * x * x
	elseif name == "Out" then
		return 1 - (1 - x) ^ 3
	elseif name == "Sine" then
		return -(math.cos(math.pi * x) - 1) / 2
	elseif name == "Snap" then
		return if x >= 1 then 1 else 1 - 2 ^ (-10 * x)
	elseif name == "Settle" then
		local c1 = 1.2
		local c3 = c1 + 1
		return 1 + c3 * (x - 1) ^ 3 + c1 * (x - 1) ^ 2
	elseif name == "Hold" then
		return if x >= 1 then 1 else 0
	end
	error(`unknown ease "{name}"`)
end

function Ease.Lerp(a: number, b: number, t: number): number
	return a + (b - a) * t
end

-- Degrees, the short way round.
function Ease.AngleLerp(a: number, b: number, t: number): number
	local delta = (b - a + 180) % 360 - 180
	return a + delta * t
end

-- Uniform Catmull-Rom through `points`; u in 0..1 runs from the first point to the last.
-- The camera passes through every point, which is what a camera path should do.
function Ease.CatmullRom(points: { Vector3 }, u: number): Vector3
	local n = #points
	if n == 0 then
		return Vector3.zero
	elseif n == 1 then
		return points[1]
	end
	local segments = n - 1
	local s = math.clamp(u, 0, 1) * segments
	local i = math.min(math.floor(s), segments - 1)
	local f = s - i
	local p0 = points[math.max(1, i)]
	local p1 = points[i + 1]
	local p2 = points[i + 2]
	local p3 = points[math.min(n, i + 3)]
	local f2, f3 = f * f, f * f * f
	return (p1 * 2 + (p2 - p0) * f + (p0 * 2 - p1 * 5 + p2 * 4 - p3) * f2 + (p1 * 3 - p0 - p2 * 3 + p3) * f3) * 0.5
end

return Ease
