--!strict
-- Railway track for TrainSim: a Catmull-Rom spline through ordered nodes, sampled into an
-- arc-length table with position, tangent, signed curvature, cant, grade and speed limit at any
-- distance along it. Mirrors TrainTrack in examples/roblox-vehicles/lab/heavy.js. See
-- references/train-physics.md §8-9.
--
-- Setup: a Folder or Model tagged "TrainTrack" holding nodes named 1, 2, 3 ... (Parts or
-- Attachments, in order, at rail-top height, 20-60 studs apart).
--   node attributes:  SpeedLimit (km/h, from this node on), Cant (degrees, banked into the curve)
--   track attributes: Loop (bool), DesignSpeedKmh (auto cant for that speed, at most 6 degrees)
-- A train uses the track named by its model's Track attribute, or the nearest one.

local CollectionService = game:GetService("CollectionService")

local TAG = "TrainTrack"
local MPS = 0.28
local G = 9.81
local PER_SEGMENT = 12 -- samples per node-to-node segment
local CURVE_WINDOW = 4 -- curvature from the heading change over ± this many samples
local MAX_CANT = math.rad(6)
local GAUGE = 1.435 -- metres, standard gauge (BuildRails)

export type Sample = {
	Position: Vector3, -- rail top, centre of the track
	Tangent: Vector3, -- unit, toward increasing distance
	Up: Vector3, -- unit, tilted by the cant
	Curvature: number, -- rad per stud, + = turning left (toward increasing distance)
	Cant: number, -- rad, same sign as the curve it banks into
	Grade: number, -- rise / run toward increasing distance
	SpeedLimit: number, -- km/h, 0 = none
	RadiusM: number, -- metres, math.huge on straights
}

type Point = { pos: Vector3, s: number, tan: Vector3, kappa: number, cant: number, grade: number, limit: number }

local TrainTrack = {}
TrainTrack.__index = TrainTrack
TrainTrack.Tag = TAG

export type Track = typeof(setmetatable(
	{} :: {
		Instance: Instance?,
		Length: number, -- studs
		Loop: boolean,
		points: { Point },
	},
	TrainTrack
))

export type Node = { Position: Vector3, SpeedLimit: number?, Cant: number? }

local function tiltedUp(tangent: Vector3, cant: number): Vector3
	local flat = Vector3.yAxis - tangent * tangent.Y
	flat = if flat.Magnitude > 1e-6 then flat.Unit else Vector3.yAxis
	return CFrame.fromAxisAngle(tangent, -cant):VectorToWorldSpace(flat)
end

local function wrapAngle(a: number): number
	return math.atan2(math.sin(a), math.cos(a))
end

-- A track from nodes (studs). options: Loop, DesignSpeedKmh.
function TrainTrack.new(nodes: { Node }, options: { Loop: boolean?, DesignSpeedKmh: number? }?): Track
	local loop = options ~= nil and options.Loop == true
	local design = if options and options.DesignSpeedKmh then options.DesignSpeedKmh else 0
	local n = #nodes
	assert(n >= 2, "a track needs at least 2 nodes")
	local function node(i: number): Vector3
		if loop then
			return nodes[(i - 1) % n + 1].Position
		end
		return nodes[math.clamp(i, 1, n)].Position
	end

	-- Catmull-Rom samples (uniform), then arc length along them.
	local positions: { Vector3 } = {}
	local nodeAt: { number } = {}
	local segments = if loop then n else n - 1
	for i = 1, segments do
		local p0, p1, p2, p3 = node(i - 1), node(i), node(i + 1), node(i + 2)
		for k = 0, PER_SEGMENT - 1 do
			local u = k / PER_SEGMENT
			local u2, u3 = u * u, u * u * u
			table.insert(positions, 0.5 * (2 * p1 + (p2 - p0) * u + (2 * p0 - 5 * p1 + 4 * p2 - p3) * u2 + (3 * p1 - p0 - 3 * p2 + p3) * u3))
			table.insert(nodeAt, i)
		end
	end
	if not loop then
		table.insert(positions, node(n))
		table.insert(nodeAt, n)
	end
	local count = #positions
	local cumulative = { 0 }
	for i = 2, count do
		cumulative[i] = cumulative[i - 1] + (positions[i] - positions[i - 1]).Magnitude
	end
	local length = if loop then cumulative[count] + (positions[1] - positions[count]).Magnitude else cumulative[count]
	local function index(i: number): number
		return if loop then (i - 1) % count + 1 else math.clamp(i, 1, count)
	end
	local tangents: { Vector3 } = {}
	local headings: { number } = {}
	for i = 1, count do
		local d = positions[index(i + 1)] - positions[index(i - 1)]
		tangents[i] = if d.Magnitude > 1e-9 then d.Unit else Vector3.zAxis
		headings[i] = math.atan2(tangents[i].X, tangents[i].Z)
	end

	local points: { Point } = {}
	local limit = 0
	for i = 1, count do
		local a, b = index(i - CURVE_WINDOW), index(i + CURVE_WINDOW)
		local ds = if loop then 2 * CURVE_WINDOW * length / count else math.max(cumulative[b] - cumulative[a], 1e-6)
		local kappa = if a == b then 0 else wrapAngle(headings[b] - headings[a]) / ds
		local source = nodes[(nodeAt[i] - 1) % n + 1]
		if source.SpeedLimit and source.SpeedLimit > 0 then
			limit = source.SpeedLimit
		end
		local cant = 0
		if source.Cant then
			cant = math.rad(source.Cant) * (if kappa < 0 then -1 else 1)
		elseif design > 0 then
			local v = design / 3.6
			cant = math.sign(kappa) * math.min(math.atan(v * v * math.abs(kappa / MPS) / G), MAX_CANT)
		end
		local t = tangents[i]
		points[i] = {
			pos = positions[i],
			s = cumulative[i],
			tan = t,
			kappa = kappa,
			cant = cant,
			grade = t.Y / math.max(math.sqrt(t.X * t.X + t.Z * t.Z), 1e-6),
			limit = limit,
		}
	end
	return setmetatable({ Instance = nil :: Instance?, Length = length, Loop = loop, points = points }, TrainTrack)
end

-- Distance along the track, wrapped on a loop, clamped on a line.
function TrainTrack.Wrap(self: Track, s: number): number
	if self.Loop then
		return s % self.Length
	end
	return math.clamp(s, 0, self.Length)
end

function TrainTrack.Sample(self: Track, sIn: number): Sample
	local s = self:Wrap(sIn)
	local points = self.points
	local count = #points
	local lo, hi = 1, count
	if s >= points[hi].s then
		lo = hi
	else
		while hi - lo > 1 do
			local mid = (lo + hi) // 2
			if points[mid].s <= s then
				lo = mid
			else
				hi = mid
			end
		end
	end
	local a = points[lo]
	local b = points[lo % count + 1]
	local segment = if lo < count then b.s - a.s else self.Length - a.s
	local u = if segment > 1e-9 then math.clamp((s - a.s) / segment, 0, 1) else 0
	local tangent = a.tan:Lerp(b.tan, u)
	tangent = if tangent.Magnitude > 1e-9 then tangent.Unit else a.tan
	local kappa = a.kappa + (b.kappa - a.kappa) * u
	local cant = a.cant + (b.cant - a.cant) * u
	return {
		Position = a.pos:Lerp(b.pos, u),
		Tangent = tangent,
		Up = tiltedUp(tangent, cant),
		Curvature = kappa,
		Cant = cant,
		Grade = a.grade + (b.grade - a.grade) * u,
		SpeedLimit = a.limit,
		RadiusM = if math.abs(kappa) > 1e-9 then MPS / math.abs(kappa) else math.huge,
	}
end

-- Distance along the track of the point nearest to p, and how far p is from it (studs).
function TrainTrack.Nearest(self: Track, p: Vector3): (number, number)
	local best, bestDistance = 0, math.huge
	for _, point in self.points do
		local d = (point.pos - p).Magnitude
		if d < bestDistance then
			best, bestDistance = point.s, d
		end
	end
	return best, bestDistance
end

local cache: { [Instance]: Track } = setmetatable({} :: any, { __mode = "k" })

-- The track a tagged Folder or Model describes (cached).
function TrainTrack.FromInstance(container: Instance): Track?
	local cached = cache[container]
	if cached then
		return cached
	end
	local list: { { index: number, node: Node } } = {}
	for _, child in container:GetChildren() do
		local index = tonumber(child.Name)
		local position: Vector3? = nil
		if child:IsA("BasePart") then
			position = child.Position
		elseif child:IsA("Attachment") then
			position = child.WorldPosition
		end
		if index and position then
			local limit = child:GetAttribute("SpeedLimit")
			local cant = child:GetAttribute("Cant")
			table.insert(list, {
				index = index,
				node = {
					Position = position,
					SpeedLimit = if typeof(limit) == "number" then limit else nil,
					Cant = if typeof(cant) == "number" then cant else nil,
				},
			})
		end
	end
	if #list < 2 then
		warn(`[TrainTrack] {container:GetFullName()} needs at least 2 nodes named 1, 2, 3 ...`)
		return nil
	end
	table.sort(list, function(a, b)
		return a.index < b.index
	end)
	local nodes: { Node } = {}
	for i, entry in list do
		nodes[i] = entry.node
	end
	local design = container:GetAttribute("DesignSpeedKmh")
	local track = TrainTrack.new(nodes, {
		Loop = container:GetAttribute("Loop") == true,
		DesignSpeedKmh = if typeof(design) == "number" then design else nil,
	})
	track.Instance = container
	cache[container] = track
	return track
end

-- The track named `name` (tag "TrainTrack"), or the tagged track nearest to `near`.
function TrainTrack.Find(name: string?, near: Vector3?): Track?
	local best: Track? = nil
	local bestDistance = math.huge
	for _, container in CollectionService:GetTagged(TAG) do
		if name and name ~= "" then
			if container.Name == name then
				return TrainTrack.FromInstance(container)
			end
			continue
		end
		local track = TrainTrack.FromInstance(container)
		if track and near then
			local _, d = track:Nearest(near)
			if d < bestDistance then
				best, bestDistance = track, d
			end
		elseif track and not best then
			best = track
		end
	end
	return best
end

-- Prototype rails and sleepers along a track (anchored parts in a Model under `parent`).
function TrainTrack.BuildRails(track: Track, parent: Instance?): Model
	local model = Instance.new("Model")
	model.Name = "Rails"
	local halfGauge = GAUGE / 2 / MPS
	local railSize = Vector3.new(0.07, 0.15, 0) / MPS
	local function part(name: string, size: Vector3, cframe: CFrame, color: Color3, material: Enum.Material)
		local p = Instance.new("Part")
		p.Name = name
		p.Anchored = true
		p.CanCollide = false
		p.CanTouch = false
		p.Size = size
		p.CFrame = cframe
		p.Color = color
		p.Material = material
		p.TopSurface = Enum.SurfaceType.Smooth
		p.BottomSurface = Enum.SurfaceType.Smooth
		p.Parent = model
	end
	local step = 2.4 -- studs between rail segments
	local s = 0
	while s < track.Length - (if track.Loop then 0 else 1e-3) do
		local nextS = math.min(s + step, track.Length)
		local a, b = track:Sample(s), track:Sample(nextS)
		for _, side in { -1, 1 } do
			local right = a.Tangent:Cross(a.Up).Unit
			local pa = a.Position + right * side * halfGauge - a.Up * railSize.Y / 2
			local pb = b.Position + b.Tangent:Cross(b.Up).Unit * side * halfGauge - b.Up * railSize.Y / 2
			local length = (pb - pa).Magnitude
			if length > 1e-3 then
				part("Rail", Vector3.new(railSize.X, railSize.Y, length + 0.05), CFrame.lookAt((pa + pb) / 2, pb, a.Up), Color3.fromRGB(150, 150, 155), Enum.Material.Metal)
			end
		end
		local sleeper = CFrame.lookAt(a.Position - a.Up * (railSize.Y + 0.09 / MPS), a.Position - a.Up * (railSize.Y + 0.09 / MPS) + a.Tangent, a.Up)
		part("Sleeper", Vector3.new(2.6, 0.18, 0.25) / MPS, sleeper, Color3.fromRGB(92, 72, 56), Enum.Material.Wood)
		s = nextS
	end
	model.Parent = parent or workspace
	return model
end

return TrainTrack
