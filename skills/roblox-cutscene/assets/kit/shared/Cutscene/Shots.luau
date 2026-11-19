--!strict
-- Shots: turns a shot written in film language ("medium close-up on the Boss from a low angle,
-- 24 mm, slow push-in, subject on the left third") into a camera CFrame and FieldOfView for any
-- moment of the shot. Pure: actors come in as poses, so the same code runs in Studio, in the
-- luau CLI tests and in the previs.
--
-- Shot types
--   Frame        (default) frame one Subject by shot Size, angle (Yaw / Pitch) and Lens
--   OverShoulder camera behind Over's shoulder looking at Subject (dialogue coverage)
--   TwoShot      both Subjects in frame, camera on one Side of the line between them
--   POV          through an actor's eyes, at a Subject or LookAt point
--   Path         along a spline of scene-space Points (crane, drone, dolly track)
--   Static       a fixed Position looking at an actor or point (security cam, locked-off)
--
-- Angles follow Roblox: positive Yaw swings the camera counter-clockwise seen from above.
-- Frame Yaw is measured from the subject's face: 0 in front, 45 front-left three-quarter,
-- -45 front-right, 90 their left profile, -90 their right profile, 180 behind.
-- Pitch is the camera's elevation above the aim point (or a name from Lens.Angles).
--
-- Moves (Move = "PushIn", Amount = 0.3, or Moves = { { "ArcLeft", 20 }, { "PushIn" } })
--   PushIn / PullOut         dolly toward / away from the aim (fraction of the distance)
--   ArcLeft / ArcRight       orbit around the aim (degrees)
--   TruckLeft / TruckRight   slide sideways, camera and aim together (studs)
--   PedestalUp / PedestalDown  rise / sink, camera and aim together (studs)
--   CraneUp / CraneDown      rise / sink keeping the aim, so the camera tilts (studs)
--   PanLeft / PanRight       turn the camera in place (degrees)
--   TiltUp / TiltDown        tilt the camera in place (degrees)
--   ZoomIn / ZoomOut         change focal length only (fraction): flat, "video" feel
--   DollyZoom                change lens and distance together, subject keeps its size
--                            (Amount = final lens multiplier: 0.5 = dolly in + zoom out, Jaws)

local Ease = require(script.Parent.Ease)
local Lens = require(script.Parent.Lens)

local Shots = {}

export type ActorPose = {
	CFrame: CFrame, -- ground point under the actor, facing their way (world space)
	Height: number, -- studs, feet to top of head
}

export type Context = {
	Actors: { [string]: ActorPose },
	StartActors: { [string]: ActorPose }?, -- poses at the shot's first frame (Lock)
	Origin: CFrame, -- scene origin (scene-space points are relative to it)
	Aspect: number, -- viewport width / height
	Letterbox: number?, -- letterbox aspect while it's on (for framing in the visible area)
}

export type CameraState = {
	CFrame: CFrame,
	Fov: number, -- Roblox vertical FieldOfView
	Lens: number, -- mm
	Aim: Vector3,
	Focus: Vector3?, -- point to keep sharp (depth of field)
	Subject: string?,
}

Shots.Types = table.freeze({ "Frame", "OverShoulder", "TwoShot", "POV", "Path", "Static" })

Shots.MoveDefaults = table.freeze({
	PushIn = 0.3,
	PullOut = 0.4,
	ArcLeft = 25,
	ArcRight = 25,
	TruckLeft = 2,
	TruckRight = 2,
	PedestalUp = 2,
	PedestalDown = 2,
	CraneUp = 3,
	CraneDown = 3,
	PanLeft = 30,
	PanRight = 30,
	TiltUp = 15,
	TiltDown = 15,
	ZoomIn = 0.6,
	ZoomOut = 0.6,
	DollyZoom = 0.5,
} :: { [string]: number })

local DEFAULT_LENS: { [string]: number } = {
	Frame = 35,
	OverShoulder = 50,
	TwoShot = 35,
	POV = 30,
	Path = 28,
	Static = 35,
}

local UP = Vector3.yAxis
local EYE = 0.91 -- eye height as a fraction of actor height
local MIN_CAMERA_HEIGHT = 0.25 -- studs above the subject's ground

---------------------------------------------------------------------------------------------
-- Helpers

local function flat(v: Vector3): Vector3
	return Vector3.new(v.X, 0, v.Z)
end

-- The horizontal direction an actor faces, even when they lie down (pitched marks).
local function facing(pose: ActorPose): Vector3
	local look = flat(pose.CFrame.LookVector)
	if look.Magnitude < 1e-3 then
		look = flat(pose.CFrame.UpVector)
	end
	return if look.Magnitude < 1e-3 then Vector3.new(0, 0, -1) else look.Unit
end

local function bodyPoint(pose: ActorPose, fraction: number): Vector3
	return pose.CFrame * Vector3.new(0, fraction * pose.Height, 0)
end

function Shots.Eye(pose: ActorPose): Vector3
	return bodyPoint(pose, EYE)
end

local function actor(ctx: Context, name: string?, start: boolean?): ActorPose
	assert(name, "shot needs a subject")
	local set = if start and ctx.StartActors then ctx.StartActors else ctx.Actors
	local pose = set[name] or ctx.Actors[name]
	assert(pose, `no actor "{name}" in the scene`)
	return pose
end

local function rotateY(v: Vector3, degrees: number): Vector3
	return CFrame.Angles(0, math.rad(degrees), 0) * v
end

local function pitchOf(shot: any): number
	local p = shot.Pitch
	if type(p) == "string" then
		return Lens.Angles[p] or 0
	end
	return math.clamp(p or 0, -85, 85)
end

local function sizeOf(name: string?): Lens.ShotSize
	return Lens.Sizes[name or "MS"] or Lens.Sizes.MS
end

local function scenePoint(ctx: Context, p: Vector3): Vector3
	return ctx.Origin * p
end

-- Resolves an actor name or a scene-space Vector3 into a world point.
local function target(ctx: Context, value: any, fraction: number, start: boolean?): Vector3
	if typeof(value) == "Vector3" then
		return scenePoint(ctx, value)
	end
	return bodyPoint(actor(ctx, value, start), fraction)
end

---------------------------------------------------------------------------------------------
-- Framing rigs (Frame shots): numeric parameters that can be blended for moves between two
-- framings of the same subject (push to a tighter size, arc round, dolly zoom...).

type Rig = {
	Subject: string,
	Extent: number?, -- fraction of height to fill the frame (from Size)
	Distance: number?, -- studs (overrides Extent)
	Aim: number,
	Yaw: number,
	Pitch: number,
	Lens: number,
	ScreenX: number,
	ScreenY: number,
	Roll: number,
	AimOffset: Vector3,
}

local function rigFrom(spec: any, base: Rig?): Rig
	local size = if spec.Size then sizeOf(spec.Size) else nil
	local rig: Rig = if base
		then table.clone(base)
		else {
			Subject = spec.Subject,
			Extent = sizeOf(spec.Size).Extent,
			Distance = nil,
			Aim = sizeOf(spec.Size).Aim,
			Yaw = 0,
			Pitch = 0,
			Lens = DEFAULT_LENS.Frame,
			ScreenX = 0,
			ScreenY = 0,
			Roll = 0,
			AimOffset = Vector3.zero,
		}
	if spec.Subject then
		rig.Subject = spec.Subject
	end
	if size then
		rig.Extent = size.Extent
		rig.Aim = size.Aim
		rig.Distance = nil
	end
	if spec.Distance then
		rig.Distance = spec.Distance
	end
	if spec.Yaw then
		rig.Yaw = spec.Yaw
	end
	if spec.Pitch then
		rig.Pitch = pitchOf(spec)
	end
	if spec.Lens then
		rig.Lens = spec.Lens
	end
	if spec.ScreenX then
		rig.ScreenX = spec.ScreenX
	end
	if spec.ScreenY then
		rig.ScreenY = spec.ScreenY
	end
	if spec.Roll then
		rig.Roll = spec.Roll
	end
	if spec.AimOffset then
		rig.AimOffset = spec.AimOffset
	end
	return rig
end

local function rigDistance(rig: Rig, pose: ActorPose, ctx: Context): number
	if rig.Distance then
		return rig.Distance
	end
	local fov = Lens.VerticalFov(rig.Lens, ctx.Aspect)
	return Lens.DistanceForExtent((rig.Extent or 0.56) * pose.Height, fov, Lens.VisibleFraction(ctx.Aspect, ctx.Letterbox))
end

local function mixRigs(a: Rig, b: Rig, k: number, pose: ActorPose, ctx: Context): Rig
	local out = table.clone(a)
	out.Aim = Ease.Lerp(a.Aim, b.Aim, k)
	out.Yaw = Ease.AngleLerp(a.Yaw, b.Yaw, k)
	out.Pitch = Ease.Lerp(a.Pitch, b.Pitch, k)
	out.Lens = Ease.Lerp(a.Lens, b.Lens, k)
	out.ScreenX = Ease.Lerp(a.ScreenX, b.ScreenX, k)
	out.ScreenY = Ease.Lerp(a.ScreenY, b.ScreenY, k)
	out.Roll = Ease.Lerp(a.Roll, b.Roll, k)
	out.AimOffset = a.AimOffset:Lerp(b.AimOffset, k)
	if a.Distance or b.Distance then
		out.Distance = Ease.Lerp(rigDistance(a, pose, ctx), rigDistance(b, pose, ctx), k)
		out.Extent = nil
	else
		-- Same lens-independent size: blend the size and let the distance follow the lens,
		-- which is exactly a dolly zoom when only the lens changes.
		out.Extent = Ease.Lerp(a.Extent or 0.56, b.Extent or 0.56, k)
	end
	return out
end

type Placed = {
	Position: Vector3,
	Aim: Vector3,
	Lens: number,
	Roll: number,
	ScreenX: number,
	ScreenY: number,
	Subject: string?,
}

local function placeRig(rig: Rig, ctx: Context, start: boolean?): Placed
	local pose = actor(ctx, rig.Subject, start)
	local aim = bodyPoint(pose, rig.Aim) + pose.CFrame:VectorToWorldSpace(rig.AimOffset)
	local distance = rigDistance(rig, pose, ctx)
	local horizontal = rotateY(facing(pose), rig.Yaw)
	local p = math.rad(math.clamp(rig.Pitch, -85, 85))
	local position = aim + (horizontal * math.cos(p) + UP * math.sin(p)) * distance
	local floor = pose.CFrame.Position.Y + MIN_CAMERA_HEIGHT
	if position.Y < floor then
		position = Vector3.new(position.X, floor, position.Z)
	end
	return {
		Position = position,
		Aim = aim,
		Lens = rig.Lens,
		Roll = rig.Roll,
		ScreenX = rig.ScreenX,
		ScreenY = rig.ScreenY,
		Subject = rig.Subject,
	}
end

---------------------------------------------------------------------------------------------
-- Placement per shot type (before moves and composition)

local function lensOf(shot: any): number
	return shot.Lens or DEFAULT_LENS[shot.Type or "Frame"] or 35
end

local function placeFrame(shot: any, k: number, ctx: Context, start: boolean?): Placed
	local from = rigFrom(shot)
	if not shot.To then
		return placeRig(from, ctx, start)
	end
	local to = rigFrom(shot.To, from)
	if to.Subject == from.Subject then
		local pose = actor(ctx, from.Subject, start)
		return placeRig(mixRigs(from, to, k, pose, ctx), ctx, start)
	end
	-- A move from one subject to another (a pan or drift across): blend the two placements.
	local a = placeRig(from, ctx, start)
	local b = placeRig(to, ctx, start)
	return {
		Position = a.Position:Lerp(b.Position, k),
		Aim = a.Aim:Lerp(b.Aim, k),
		Lens = Ease.Lerp(a.Lens, b.Lens, k),
		Roll = Ease.Lerp(a.Roll, b.Roll, k),
		ScreenX = Ease.Lerp(a.ScreenX, b.ScreenX, k),
		ScreenY = Ease.Lerp(a.ScreenY, b.ScreenY, k),
		Subject = if k < 0.5 then a.Subject else b.Subject,
	}
end

local function placeOverShoulder(shot: any, ctx: Context, start: boolean?): Placed
	local over = actor(ctx, shot.Over, start)
	local subject = actor(ctx, shot.Subject, start)
	local size = sizeOf(shot.Size or "MCU")
	local head = bodyPoint(over, 0.93)
	local aim = bodyPoint(subject, size.Aim)
	local dir = flat(aim - head)
	dir = if dir.Magnitude < 1e-3 then facing(over) else dir.Unit
	local right = dir:Cross(UP).Unit
	local side = if shot.Side == "Left" then -1 else 1
	local h = over.Height
	local position = head
		+ right * side * (shot.Shoulder or 0.22 * h)
		- dir * (shot.Back or 0.45 * h)
		+ UP * (0.04 * h)
	return {
		Position = position,
		Aim = aim,
		Lens = lensOf(shot),
		Roll = shot.Roll or 0,
		ScreenX = shot.ScreenX or side / 3,
		ScreenY = shot.ScreenY or 0,
		Subject = shot.Subject,
	}
end

local function placeTwoShot(shot: any, ctx: Context, start: boolean?): Placed
	local names = shot.Subjects
	local a = actor(ctx, names[1], start)
	local b = actor(ctx, names[2], start)
	local pa, pb = a.CFrame.Position, b.CFrame.Position
	local axis = flat(pb - pa)
	local separation = axis.Magnitude
	axis = if separation < 1e-3 then facing(a) else axis.Unit
	local side = if shot.Side == "Right" then -1 else 1
	local yaw = shot.Yaw or 0
	local normal = rotateY(UP:Cross(axis) * side, yaw)
	local size = sizeOf(shot.Size or "FS")
	local h = math.max(a.Height, b.Height)
	local aim = (pa + pb) / 2 + UP * (size.Aim * h)
	local lens = lensOf(shot)
	local fov = Lens.VerticalFov(lens, ctx.Aspect)
	local visible = Lens.VisibleFraction(ctx.Aspect, ctx.Letterbox)
	local byHeight = Lens.DistanceForExtent(size.Extent * h, fov, visible)
	local width = separation * math.abs(math.cos(math.rad(yaw))) + 0.9 * h
	local byWidth = width / (2 * (18 / lens))
	local distance = math.max(byHeight, byWidth)
	local p = math.rad(pitchOf(shot))
	local position = aim + (normal * math.cos(p) + UP * math.sin(p)) * distance
	return {
		Position = position,
		Aim = aim,
		Lens = lens,
		Roll = shot.Roll or 0,
		ScreenX = shot.ScreenX or 0,
		ScreenY = shot.ScreenY or 0,
		Subject = names[1],
	}
end

local function placePov(shot: any, ctx: Context, start: boolean?): Placed
	local viewer = actor(ctx, shot.Actor, start)
	local position = viewer.CFrame * Vector3.new(0, EYE * viewer.Height, -0.06 * viewer.Height)
	local aim
	if shot.Subject then
		aim = target(ctx, shot.Subject, sizeOf(shot.Size or "MCU").Aim, start)
	elseif shot.LookAt then
		aim = target(ctx, shot.LookAt, EYE, start)
	else
		aim = position + facing(viewer) * 10
	end
	return {
		Position = position,
		Aim = aim,
		Lens = lensOf(shot),
		Roll = shot.Roll or 0,
		ScreenX = shot.ScreenX or 0,
		ScreenY = shot.ScreenY or 0,
		Subject = shot.Subject,
	}
end

local function placePath(shot: any, k: number, ctx: Context, start: boolean?): Placed
	local points = {}
	for i, p in shot.Points do
		points[i] = scenePoint(ctx, p)
	end
	local position = Ease.CatmullRom(points, k)
	local aim
	local look = shot.LookAt or shot.Subject
	if look then
		aim = target(ctx, look, sizeOf(shot.Size).Aim, start)
	else
		local ahead = Ease.CatmullRom(points, math.min(1, k + 0.02))
		if (ahead - position).Magnitude < 1e-3 then
			ahead = position + (points[#points] - points[math.max(1, #points - 1)])
		end
		aim = ahead
	end
	return {
		Position = position,
		Aim = aim,
		Lens = lensOf(shot),
		Roll = shot.Roll or 0,
		ScreenX = shot.ScreenX or 0,
		ScreenY = shot.ScreenY or 0,
		Subject = if type(look) == "string" then look else nil,
	}
end

local function placeStatic(shot: any, ctx: Context, start: boolean?): Placed
	local look = shot.LookAt or shot.Subject
	return {
		Position = scenePoint(ctx, shot.Position),
		Aim = target(ctx, look, sizeOf(shot.Size).Aim, start),
		Lens = lensOf(shot),
		Roll = shot.Roll or 0,
		ScreenX = shot.ScreenX or 0,
		ScreenY = shot.ScreenY or 0,
		Subject = if type(look) == "string" then look else nil,
	}
end

local function place(shot: any, k: number, ctx: Context, start: boolean?): Placed
	local kind = shot.Type or "Frame"
	if kind == "Frame" then
		return placeFrame(shot, k, ctx, start)
	elseif kind == "OverShoulder" then
		return placeOverShoulder(shot, ctx, start)
	elseif kind == "TwoShot" then
		return placeTwoShot(shot, ctx, start)
	elseif kind == "POV" then
		return placePov(shot, ctx, start)
	elseif kind == "Path" then
		return placePath(shot, k, ctx, start)
	elseif kind == "Static" then
		return placeStatic(shot, ctx, start)
	end
	error(`unknown shot type "{kind}"`)
end

---------------------------------------------------------------------------------------------
-- Moves

local function movesOf(shot: any): { { any } }
	if shot.Moves then
		return shot.Moves
	elseif shot.Move then
		return { { shot.Move, shot.Amount } }
	end
	return {}
end

local function applyMove(placed: Placed, name: string, amount: number?, k: number)
	local a = (amount or Shots.MoveDefaults[name] or 0) * k
	local pos, aim = placed.Position, placed.Aim
	local offset = pos - aim
	local look = aim - pos
	local right = flat(look):Cross(UP)
	right = if right.Magnitude < 1e-3 then Vector3.xAxis else right.Unit
	if name == "PushIn" then
		pos = aim + offset * (1 - a)
	elseif name == "PullOut" then
		pos = aim + offset * (1 + a)
	elseif name == "ArcLeft" then
		pos = aim + rotateY(offset, -a)
	elseif name == "ArcRight" then
		pos = aim + rotateY(offset, a)
	elseif name == "TruckLeft" then
		pos, aim = pos - right * a, aim - right * a
	elseif name == "TruckRight" then
		pos, aim = pos + right * a, aim + right * a
	elseif name == "PedestalUp" then
		pos, aim = pos + UP * a, aim + UP * a
	elseif name == "PedestalDown" then
		pos, aim = pos - UP * a, aim - UP * a
	elseif name == "CraneUp" then
		pos = pos + UP * a
	elseif name == "CraneDown" then
		pos = pos - UP * a
	elseif name == "PanLeft" then
		aim = pos + rotateY(look, a)
	elseif name == "PanRight" then
		aim = pos + rotateY(look, -a)
	elseif name == "TiltUp" or name == "TiltDown" then
		local sign = if name == "TiltUp" then 1 else -1
		local frame = CFrame.lookAt(pos, aim) * CFrame.Angles(math.rad(a * sign), 0, 0)
		aim = pos + frame.LookVector * look.Magnitude
	elseif name == "ZoomIn" then
		placed.Lens *= 1 + a
	elseif name == "ZoomOut" then
		placed.Lens /= 1 + a
	elseif name == "DollyZoom" then
		local multiplier = amount or Shots.MoveDefaults.DollyZoom
		local newLens = placed.Lens * (1 + (multiplier - 1) * k)
		pos = aim + offset * (newLens / placed.Lens)
		placed.Lens = newLens
	else
		error(`unknown move "{name}"`)
	end
	placed.Position, placed.Aim = pos, aim
end

---------------------------------------------------------------------------------------------
-- Public

function Shots.IsMove(name: string): boolean
	return Shots.MoveDefaults[name] ~= nil
end

-- Composition: turn the camera so the aim point lands at (screenX, screenY) of the visible
-- frame (-1..1 each way; ±1/3 is the rule-of-thirds line), then roll (Dutch angle).
function Shots.Compose(position: Vector3, aim: Vector3, lens: number, ctx: Context, screenX: number, screenY: number, roll: number): CFrame
	local look = aim - position
	local up = if math.abs(look.Unit:Dot(UP)) > 0.999 then Vector3.zAxis else UP
	local cframe = CFrame.lookAt(position, aim, up)
	local tanHalfH = 18 / lens
	local tanHalfV = tanHalfH / ctx.Aspect * Lens.VisibleFraction(ctx.Aspect, ctx.Letterbox)
	if screenX ~= 0 then
		cframe *= CFrame.Angles(0, math.atan(screenX * tanHalfH), 0)
	end
	if screenY ~= 0 then
		cframe *= CFrame.Angles(-math.atan(screenY * tanHalfV), 0, 0)
	end
	if roll ~= 0 then
		cframe *= CFrame.Angles(0, 0, math.rad(roll))
	end
	return cframe
end

-- Where the camera is at `localTime` seconds into a shot lasting `duration`, before any
-- operator style (noise) is added.
function Shots.Evaluate(shot: any, localTime: number, duration: number, ctx: Context): CameraState
	local moveTime = shot.MoveTime or duration
	local k = if moveTime > 0 then Ease.Apply(shot.Ease, localTime / moveTime) else 1
	local lock = shot.Lock
	local placed = place(shot, k, ctx, lock == "Fixed" or lock == "Pan")
	if lock == "Pan" then
		placed.Aim = place(shot, k, ctx, false).Aim
	end
	for _, move in movesOf(shot) do
		applyMove(placed, move[1], move[2], k)
	end
	local lens = math.clamp(placed.Lens, 4, 1200)
	local cframe = Shots.Compose(placed.Position, placed.Aim, lens, ctx, placed.ScreenX, placed.ScreenY, placed.Roll)
	if shot.Offset then
		cframe *= CFrame.new(shot.Offset)
	end

	local focus: Vector3? = nil
	local focusName = shot.Focus or placed.Subject
	if typeof(focusName) == "string" and ctx.Actors[focusName] then
		focus = Shots.Eye(ctx.Actors[focusName])
		if shot.FocusTo and ctx.Actors[shot.FocusTo] then
			local rackAt = shot.RackAt or duration * 0.4
			local rack = Ease.Apply("InOut", (localTime - rackAt) / (shot.RackTime or 0.6))
			focus = (focus :: Vector3):Lerp(Shots.Eye(ctx.Actors[shot.FocusTo]), rack)
		end
	end

	return {
		CFrame = cframe,
		Fov = math.clamp(Lens.VerticalFov(lens, ctx.Aspect), 1, 120),
		Lens = lens,
		Aim = placed.Aim,
		Focus = focus,
		Subject = placed.Subject,
	}
end

function Shots.Blend(a: CameraState, b: CameraState, k: number): CameraState
	return {
		CFrame = a.CFrame:Lerp(b.CFrame, k),
		Fov = Ease.Lerp(a.Fov, b.Fov, k),
		Lens = Ease.Lerp(a.Lens, b.Lens, k),
		Aim = a.Aim:Lerp(b.Aim, k),
		Focus = if a.Focus and b.Focus then a.Focus:Lerp(b.Focus, k) else b.Focus,
		Subject = if k < 0.5 then a.Subject else b.Subject,
	}
end

-- Problems with one shot's fields, for Timeline.Compile.
function Shots.Validate(shot: any, actors: { [string]: any }): { string }
	local errors = {}
	local kind = shot.Type or "Frame"
	local function needActor(field: string, value: any)
		if typeof(value) == "Vector3" then
			return
		end
		if type(value) ~= "string" or actors[value] == nil then
			table.insert(errors, `{field} "{tostring(value)}" is not an actor`)
		end
	end
	if not table.find(Shots.Types, kind) then
		table.insert(errors, `unknown Type "{kind}"`)
		return errors
	end
	if kind == "Frame" then
		needActor("Subject", shot.Subject)
		if shot.To and shot.To.Subject then
			needActor("To.Subject", shot.To.Subject)
		end
	elseif kind == "OverShoulder" then
		needActor("Over", shot.Over)
		needActor("Subject", shot.Subject)
	elseif kind == "TwoShot" then
		if type(shot.Subjects) ~= "table" or #shot.Subjects ~= 2 then
			table.insert(errors, "TwoShot needs Subjects = { a, b }")
		else
			needActor("Subjects[1]", shot.Subjects[1])
			needActor("Subjects[2]", shot.Subjects[2])
		end
	elseif kind == "POV" then
		needActor("Actor", shot.Actor)
		if shot.Subject then
			needActor("Subject", shot.Subject)
		end
	elseif kind == "Path" then
		if type(shot.Points) ~= "table" or #shot.Points < 2 then
			table.insert(errors, "Path needs at least 2 Points")
		end
		if shot.LookAt or shot.Subject then
			needActor("LookAt", shot.LookAt or shot.Subject)
		end
	elseif kind == "Static" then
		if typeof(shot.Position) ~= "Vector3" then
			table.insert(errors, "Static needs a Position")
		end
		needActor("LookAt", shot.LookAt or shot.Subject)
	end
	for _, size in { shot.Size, shot.To and shot.To.Size } do
		if size ~= nil and Lens.Sizes[size] == nil then
			table.insert(errors, `unknown Size "{tostring(size)}" (use {table.concat(Lens.SizeOrder, ", ")})`)
		end
	end
	if type(shot.Pitch) == "string" and Lens.Angles[shot.Pitch] == nil then
		table.insert(errors, `unknown Pitch "{shot.Pitch}"`)
	end
	for _, move in movesOf(shot) do
		if not Shots.IsMove(move[1]) then
			table.insert(errors, `unknown move "{tostring(move[1])}"`)
		end
	end
	if not Ease.IsValid(shot.Ease) then
		table.insert(errors, `unknown Ease "{tostring(shot.Ease)}"`)
	end
	if shot.Lock ~= nil and shot.Lock ~= "Pan" and shot.Lock ~= "Fixed" then
		table.insert(errors, `Lock must be "Pan" or "Fixed"`)
	end
	return errors
end

return Shots
