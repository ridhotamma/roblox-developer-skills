-- Just enough of Roblox to run the combat kit's pure modules in the standalone luau CLI:
-- Vector3, CFrame, Random (deterministic), RaycastParams, Enum, a box World with
-- workspace:Raycast / workspace:Spherecast, a camera, RunService render steps, game:GetService
-- and Instance-path requires (ReplicatedStorage.Shared.Combat.X, script.Parent.Parent.Combat.Y).
--
-- Not a module: run-luau.cjs pastes this at the top of a bundle so every kit module sees these
-- as globals, exactly as in Studio. Semantics follow the Roblox API reference (CFrame columns =
-- Right, Up, -Look; fromEulerAnglesYXZ = Ry * Rx * Rz; raycasts ignore parts they start inside).

local Vector3 = {}
local Vector3Meta = {}

local function v3(x: number, y: number, z: number)
	return setmetatable({ X = x, Y = y, Z = z }, Vector3Meta)
end

local function isV3(v: any): boolean
	return type(v) == "table" and getmetatable(v) == Vector3Meta
end

Vector3Meta.__index = function(v: any, key: string): any
	if key == "Magnitude" then
		return math.sqrt(v.X * v.X + v.Y * v.Y + v.Z * v.Z)
	elseif key == "Unit" then
		local m = math.sqrt(v.X * v.X + v.Y * v.Y + v.Z * v.Z)
		if m == 0 then
			return v3(0 / 0, 0 / 0, 0 / 0)
		end
		return v3(v.X / m, v.Y / m, v.Z / m)
	end
	return Vector3[key]
end
Vector3Meta.__add = function(a: any, b: any)
	return v3(a.X + b.X, a.Y + b.Y, a.Z + b.Z)
end
Vector3Meta.__sub = function(a: any, b: any)
	return v3(a.X - b.X, a.Y - b.Y, a.Z - b.Z)
end
Vector3Meta.__mul = function(a: any, b: any)
	if type(a) == "number" then
		return v3(a * b.X, a * b.Y, a * b.Z)
	elseif type(b) == "number" then
		return v3(a.X * b, a.Y * b, a.Z * b)
	end
	return v3(a.X * b.X, a.Y * b.Y, a.Z * b.Z)
end
Vector3Meta.__div = function(a: any, b: any)
	if type(b) == "number" then
		return v3(a.X / b, a.Y / b, a.Z / b)
	end
	return v3(a.X / b.X, a.Y / b.Y, a.Z / b.Z)
end
Vector3Meta.__unm = function(a: any)
	return v3(-a.X, -a.Y, -a.Z)
end
Vector3Meta.__eq = function(a: any, b: any)
	return a.X == b.X and a.Y == b.Y and a.Z == b.Z
end
Vector3Meta.__tostring = function(a: any)
	return `{a.X}, {a.Y}, {a.Z}`
end

function Vector3.new(x: number?, y: number?, z: number?)
	return v3(x or 0, y or 0, z or 0)
end
function Vector3.Dot(a: any, b: any): number
	return a.X * b.X + a.Y * b.Y + a.Z * b.Z
end
function Vector3.Cross(a: any, b: any)
	return v3(a.Y * b.Z - a.Z * b.Y, a.Z * b.X - a.X * b.Z, a.X * b.Y - a.Y * b.X)
end
function Vector3.Lerp(a: any, b: any, t: number)
	return a + (b - a) * t
end
Vector3.zero = v3(0, 0, 0)
Vector3.one = v3(1, 1, 1)
Vector3.xAxis = v3(1, 0, 0)
Vector3.yAxis = v3(0, 1, 0)
Vector3.zAxis = v3(0, 0, 1)

---------------------------------------------------------------------------------------------
-- CFrame: position + 3x3 rotation (rows r[1..3][1..3]).

local CFrame = {}
local CFrameMeta = {}

local function cf(x: number, y: number, z: number, r: { { number } })
	return setmetatable({ X = x, Y = y, Z = z, R = r }, CFrameMeta)
end

local function matMul(a: { { number } }, b: { { number } }): { { number } }
	local out = {}
	for i = 1, 3 do
		out[i] = {}
		for j = 1, 3 do
			out[i][j] = a[i][1] * b[1][j] + a[i][2] * b[2][j] + a[i][3] * b[3][j]
		end
	end
	return out
end

local function matVec(r: { { number } }, x: number, y: number, z: number)
	return r[1][1] * x + r[1][2] * y + r[1][3] * z, r[2][1] * x + r[2][2] * y + r[2][3] * z, r[3][1] * x + r[3][2] * y + r[3][3] * z
end

local IDENTITY = { { 1, 0, 0 }, { 0, 1, 0 }, { 0, 0, 1 } }

CFrameMeta.__index = function(c: any, key: string): any
	local r = c.R
	if key == "Position" or key == "p" then
		return v3(c.X, c.Y, c.Z)
	elseif key == "LookVector" then
		return v3(-r[1][3], -r[2][3], -r[3][3])
	elseif key == "RightVector" then
		return v3(r[1][1], r[2][1], r[3][1])
	elseif key == "UpVector" then
		return v3(r[1][2], r[2][2], r[3][2])
	elseif key == "Rotation" then
		return cf(0, 0, 0, r)
	end
	return CFrame[key]
end
CFrameMeta.__mul = function(a: any, b: any): any
	if isV3(b) then
		local x, y, z = matVec(a.R, b.X, b.Y, b.Z)
		return v3(a.X + x, a.Y + y, a.Z + z)
	end
	local x, y, z = matVec(a.R, b.X, b.Y, b.Z)
	return cf(a.X + x, a.Y + y, a.Z + z, matMul(a.R, b.R))
end
CFrameMeta.__add = function(a: any, b: any)
	return cf(a.X + b.X, a.Y + b.Y, a.Z + b.Z, a.R)
end
CFrameMeta.__sub = function(a: any, b: any)
	return cf(a.X - b.X, a.Y - b.Y, a.Z - b.Z, a.R)
end
CFrameMeta.__eq = function(a: any, b: any)
	if a.X ~= b.X or a.Y ~= b.Y or a.Z ~= b.Z then
		return false
	end
	for i = 1, 3 do
		for j = 1, 3 do
			if a.R[i][j] ~= b.R[i][j] then
				return false
			end
		end
	end
	return true
end

function CFrame.new(x: any?, y: number?, z: number?)
	if isV3(x) then
		return cf(x.X, x.Y, x.Z, IDENTITY)
	end
	return cf((x :: number?) or 0, y or 0, z or 0, IDENTITY)
end

local function rx(a: number)
	local c, s = math.cos(a), math.sin(a)
	return { { 1, 0, 0 }, { 0, c, -s }, { 0, s, c } }
end
local function ry(a: number)
	local c, s = math.cos(a), math.sin(a)
	return { { c, 0, s }, { 0, 1, 0 }, { -s, 0, c } }
end
local function rz(a: number)
	local c, s = math.cos(a), math.sin(a)
	return { { c, -s, 0 }, { s, c, 0 }, { 0, 0, 1 } }
end

-- CFrame.Angles = fromEulerAnglesXYZ: Rx * Ry * Rz.
function CFrame.Angles(x: number, y: number, z: number)
	return cf(0, 0, 0, matMul(matMul(rx(x), ry(y)), rz(z)))
end
CFrame.fromEulerAnglesXYZ = CFrame.Angles
function CFrame.fromEulerAnglesYXZ(x: number, y: number, z: number)
	return cf(0, 0, 0, matMul(matMul(ry(y), rx(x)), rz(z)))
end
function CFrame.lookAt(at: any, target: any, up: any?)
	local look = (target - at).Unit
	local right = look:Cross(up or Vector3.yAxis).Unit
	local upv = right:Cross(look)
	return cf(at.X, at.Y, at.Z, {
		{ right.X, upv.X, -look.X },
		{ right.Y, upv.Y, -look.Y },
		{ right.Z, upv.Z, -look.Z },
	})
end
function CFrame.Inverse(c: any)
	local r = c.R
	local t = { { r[1][1], r[2][1], r[3][1] }, { r[1][2], r[2][2], r[3][2] }, { r[1][3], r[2][3], r[3][3] } }
	local x, y, z = matVec(t, -c.X, -c.Y, -c.Z)
	return cf(x, y, z, t)
end
function CFrame.PointToObjectSpace(c: any, p: any)
	return CFrame.Inverse(c) * p
end
function CFrame.VectorToWorldSpace(c: any, v: any)
	local x, y, z = matVec(c.R, v.X, v.Y, v.Z)
	return v3(x, y, z)
end
CFrame.identity = cf(0, 0, 0, IDENTITY)

---------------------------------------------------------------------------------------------
-- Random: deterministic (Park-Miller), so Luau and the JS lab draw the same numbers.

local Random = {}
Random.__index = Random
function Random.new(seed: number?)
	local s = math.floor(math.abs(seed or 1)) % 2147483647
	return setmetatable({ state = if s == 0 then 1 else s }, Random)
end
function Random.NextNumber(self: any, min: number?, max: number?): number
	self.state = (self.state * 48271) % 2147483647
	local u = (self.state - 1) / 2147483646
	local lo, hi = min or 0, max or 1
	return lo + (hi - lo) * u
end
function Random.NextInteger(self: any, min: number, max: number): number
	return math.min(max, min + math.floor(self:NextNumber() * (max - min + 1)))
end

---------------------------------------------------------------------------------------------
-- Enum, RaycastParams, a world of axis-aligned boxes, workspace, camera, RunService.

local Enum = {
	RaycastFilterType = { Exclude = "Exclude", Include = "Include" },
	RenderPriority = { Camera = { Value = 200 }, Input = { Value = 100 }, Character = { Value = 300 } },
	Material = { Plastic = "Plastic" },
}

local RaycastParams = {}
function RaycastParams.new()
	return { FilterType = "Exclude", FilterDescendantsInstances = {}, RespectCanCollide = false }
end

-- A box is { Name, Model?, Min: Vector3, Max: Vector3 }. Boxes act as both the BasePart and the
-- instance a raycast reports.
local World = { boxes = {} :: { any } }
function World.Clear()
	World.boxes = {}
end
function World.Box(name: string, center: any, size: any, model: any?)
	local half = size * 0.5
	local box = { Name = name, Model = model, Min = center - half, Max = center + half, Size = size, Position = center }
	box.IsA = function(_, class: string)
		return class == "BasePart" or class == "Instance"
	end
	box.GetAttribute = function(_, _name: string)
		return nil
	end
	table.insert(World.boxes, box)
	return box
end

local function excluded(box: any, params: any?): boolean
	if not params then
		return false
	end
	local inList = false
	for _, item in params.FilterDescendantsInstances do
		if item == box or (box.Model ~= nil and item == box.Model) then
			inList = true
			break
		end
	end
	if params.FilterType == "Include" then
		return not inList
	end
	return inList
end

-- Slab test against a box grown by `grow` on every side. Returns entry distance (0..1 of the
-- direction) and the entry normal, or nil. Starting inside = no hit (Roblox behaviour).
local function sweep(origin: any, dir: any, minV: any, maxV: any, grow: number): (number?, any)
	local o = { origin.X, origin.Y, origin.Z }
	local d = { dir.X, dir.Y, dir.Z }
	local lo = { minV.X - grow, minV.Y - grow, minV.Z - grow }
	local hi = { maxV.X + grow, maxV.Y + grow, maxV.Z + grow }
	local inside = true
	for i = 1, 3 do
		if o[i] <= lo[i] or o[i] >= hi[i] then
			inside = false
		end
	end
	if inside then
		return nil, nil
	end
	local tEnter, tExit, axis, sign = -math.huge, math.huge, 1, 1
	for i = 1, 3 do
		if math.abs(d[i]) < 1e-12 then
			if o[i] < lo[i] or o[i] > hi[i] then
				return nil, nil
			end
		else
			local t1 = (lo[i] - o[i]) / d[i]
			local t2 = (hi[i] - o[i]) / d[i]
			local s = -1
			if t1 > t2 then
				t1, t2 = t2, t1
				s = 1
			end
			if t1 > tEnter then
				tEnter, axis, sign = t1, i, s
			end
			tExit = math.min(tExit, t2)
		end
	end
	if tEnter > tExit or tEnter < 0 or tEnter > 1 then
		return nil, nil
	end
	local n = { 0, 0, 0 }
	n[axis] = sign
	return tEnter, v3(n[1], n[2], n[3])
end

local function cast(origin: any, dir: any, params: any?, radius: number): any?
	local best, bestBox, bestNormal = math.huge, nil, nil
	for _, box in World.boxes do
		if not excluded(box, params) then
			local t, normal = sweep(origin, dir, box.Min, box.Max, radius)
			if t and t < best then
				best, bestBox, bestNormal = t, box, normal
			end
		end
	end
	if not bestBox then
		return nil
	end
	local position = origin + dir * best
	return {
		Instance = bestBox,
		Position = position,
		Normal = bestNormal,
		Distance = dir.Magnitude * best,
		Material = Enum.Material.Plastic,
	}
end

local RunService = { steps = {} :: { any } }
function RunService.BindToRenderStep(_, name: string, priority: number, fn: (number) -> ())
	table.insert(RunService.steps, { name = name, priority = priority, fn = fn })
	table.sort(RunService.steps, function(a, b)
		return a.priority < b.priority
	end)
end
function RunService.UnbindFromRenderStep(_, name: string)
	for i = #RunService.steps, 1, -1 do
		if RunService.steps[i].name == name then
			table.remove(RunService.steps, i)
		end
	end
end
function RunService.RenderFrame(dt: number)
	for _, step in table.clone(RunService.steps) do
		step.fn(dt)
	end
end

local workspace = {
	Gravity = 196.2,
	CurrentCamera = { CFrame = CFrame.identity, FieldOfView = 70, ViewportSize = { X = 1280, Y = 720 } },
}
function workspace.Raycast(_, origin: any, direction: any, params: any?)
	return cast(origin, direction, params, 0)
end
function workspace.Spherecast(_, origin: any, radius: number, direction: any, params: any?)
	return cast(origin, direction, params, radius)
end

-- Instance paths for require: ReplicatedStorage.Shared.Combat.X -> "ReplicatedStorage/Shared/Combat/X".
local PathMeta = {}
local function Path(path: string)
	return setmetatable({ __path = path }, PathMeta)
end
PathMeta.__index = function(self: any, key: string)
	local path = rawget(self, "__path")
	if key == "Parent" then
		return Path(string.match(path, "^(.*)/[^/]+$") or "")
	end
	return Path(path .. "/" .. key)
end

-- A settable clock: os.clock() inside the bundled modules reads this (shake noise, timers).
local Clock = { now = 0 }
local os = { clock = function(): number
	return Clock.now
end }

local services = { RunService = RunService }
local game = {}
function game.GetService(_, name: string)
	return services[name] or Path(name)
end
