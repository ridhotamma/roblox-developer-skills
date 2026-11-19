--!strict
-- Timeline: compiles a scene definition (see references/scene-format.md) and answers every
-- question a player of it needs, for any scene time, without state:
--   * where the camera is (shot, blend between shots, operator style, impact shake)
--   * where each actor stands (marks and moves)
--   * what fires between two times (animations, sounds, voice lines, events, QTEs)
--   * what is already playing at a time (for seeking: late joiners, QTE branches, skips)
--   * fade, letterbox and subtitle state
--   * how scene time maps to wall time through slow motion and hit freezes
-- Because every answer is a pure function of time, the server, every client and the previs
-- agree on every frame, and seeking anywhere is free. Pure: no Instances.

local CameraNoise = require(script.Parent.CameraNoise)
local CutsceneConfig = require(script.Parent.CutsceneConfig)
local Ease = require(script.Parent.Ease)
local Qte = require(script.Parent.Qte)
local Shots = require(script.Parent.Shots)

local Timeline = {}

export type Pose = { Position: Vector3, Yaw: number, Pitch: number, Roll: number, Lift: number }

type Region = { Start: number, End: number, Scale: number, Hold: number, WallStart: number }

export type Compiled = {
	Name: string,
	Kind: string,
	Def: any,
	Length: number,
	WallLength: number,
	Seed: number,
	Actors: { [string]: any },
	Marks: { [string]: Pose },
	Shots: { any },
	Fire: { any }, -- animations, sounds, subtitles, events, QTEs sorted by At
	Animations: { any },
	Sounds: { any },
	Subtitles: { any },
	Events: { any },
	Qtes: { any },
	Moves: { [string]: { any } }, -- per actor
	Shakes: { any },
	Fades: { any },
	Regions: { Region },
	Labels: { [string]: number },
	Line: { string }?,
	Letterbox: number?,
}

local KIND_ORDER = { Animation = 1, Sound = 2, Subtitle = 3, Event = 4, Qte = 5 }

---------------------------------------------------------------------------------------------
-- Marks and poses

local function yawToward(from: Vector3, to: Vector3): number
	local d = to - from
	if d.X * d.X + d.Z * d.Z < 1e-8 then
		return 0
	end
	return math.deg(math.atan2(-d.X, -d.Z))
end

local function markPosition(spec: any, marks: { [string]: any }): Vector3
	if typeof(spec) == "Vector3" then
		return spec
	end
	local named = marks[spec]
	assert(named, `no mark "{tostring(spec)}"`)
	return named.Position or Vector3.zero
end

local function resolveMark(spec: any, marks: { [string]: any }): Pose
	if type(spec) == "string" then
		local named = marks[spec]
		assert(named, `no mark "{spec}"`)
		spec = named
	end
	local position = spec.Position or Vector3.zero
	local yaw = spec.Yaw or 0
	if spec.Face ~= nil then
		-- Facing only needs where the other mark is, so two marks may face each other.
		yaw = yawToward(position, markPosition(spec.Face, marks))
	end
	return { Position = position, Yaw = yaw, Pitch = spec.Pitch or 0, Roll = spec.Roll or 0, Lift = spec.Lift or 0 }
end

function Timeline.PoseCFrame(pose: Pose): CFrame
	return CFrame.new(pose.Position + Vector3.new(0, pose.Lift, 0))
		* CFrame.Angles(0, math.rad(pose.Yaw), 0)
		* CFrame.Angles(math.rad(pose.Pitch), 0, math.rad(pose.Roll))
end

local function mixPose(a: Pose, b: Pose, k: number, keepYaw: boolean): Pose
	return {
		Position = a.Position:Lerp(b.Position, k),
		Yaw = if keepYaw then a.Yaw else Ease.AngleLerp(a.Yaw, b.Yaw, k),
		Pitch = Ease.Lerp(a.Pitch, b.Pitch, k),
		Roll = Ease.Lerp(a.Roll, b.Roll, k),
		Lift = Ease.Lerp(a.Lift, b.Lift, k),
	}
end

-- Scene-space pose of an actor at scene time t.
function Timeline.ActorPose(c: Compiled, name: string, t: number): Pose
	local actorDef = c.Actors[name]
	local pose = resolveMark(actorDef.Mark or {}, c.Marks)
	for _, move in c.Moves[name] or {} do
		if move.At > t then
			break
		end
		local k = if move.Duration > 0 then Ease.Apply(move.Ease, (t - move.At) / move.Duration) else 1
		local goal = resolveMark(move.To, c.Marks)
		-- A mark is a place; it only turns the actor if it says which way to face.
		local raw = if type(move.To) == "string" then (c.Def.Marks or {})[move.To] or {} else move.To
		local keepYaw = raw.Yaw == nil and raw.Face == nil
		if move.Face ~= nil then
			local faceAt = if typeof(move.Face) == "Vector3" then move.Face else resolveMark(move.Face, c.Marks).Position
			goal.Yaw = yawToward(goal.Position, faceAt)
			keepYaw = false
		end
		if move.Path then
			local points = { pose.Position }
			for _, p in move.Path do
				table.insert(points, p)
			end
			table.insert(points, goal.Position)
			local mixed = mixPose(pose, goal, k, keepYaw)
			mixed.Position = Ease.CatmullRom(points, k)
			pose = mixed
		else
			pose = mixPose(pose, goal, k, keepYaw)
		end
	end
	return pose
end

-- World poses of every actor (the Shots context). `heights` overrides the scene's heights with
-- measured ones in game.
function Timeline.Poses(c: Compiled, t: number, origin: CFrame, heights: { [string]: number }?): { [string]: Shots.ActorPose }
	local poses = {}
	for name, def in c.Actors do
		poses[name] = {
			CFrame = origin * Timeline.PoseCFrame(Timeline.ActorPose(c, name, t)),
			Height = (heights and heights[name]) or def.Height or CutsceneConfig.DefaultActorHeight,
		}
	end
	return poses
end

---------------------------------------------------------------------------------------------
-- Time: slow motion, freezes and the wall clock

function Timeline.SceneTime(c: Compiled, wall: number): number
	local cursor, wallCursor = 0, 0
	for _, r in c.Regions do
		if wall < r.WallStart then
			return r.Start - (r.WallStart - wall)
		end
		if r.Hold > 0 then
			if wall < r.WallStart + r.Hold then
				return r.Start
			end
			wallCursor = r.WallStart + r.Hold
		else
			local span = (r.End - r.Start) / r.Scale
			if wall < r.WallStart + span then
				return r.Start + (wall - r.WallStart) * r.Scale
			end
			wallCursor = r.WallStart + span
		end
		cursor = r.End
	end
	return cursor + (wall - wallCursor)
end

function Timeline.WallTime(c: Compiled, t: number): number
	local cursor, wallCursor = 0, 0
	for _, r in c.Regions do
		if t <= r.Start then
			return r.WallStart - (r.Start - t)
		end
		if t < r.End then
			return r.WallStart + (t - r.Start) / r.Scale
		end
		wallCursor = r.WallStart + (if r.Hold > 0 then r.Hold else (r.End - r.Start) / r.Scale)
		cursor = r.End
	end
	return wallCursor + (t - cursor)
end

-- Playback rate at a wall time: 1 normally, <1 in slow motion, 0 in a freeze.
function Timeline.SpeedAtWall(c: Compiled, wall: number): number
	for _, r in c.Regions do
		if wall < r.WallStart then
			return 1
		end
		local span = if r.Hold > 0 then r.Hold else (r.End - r.Start) / r.Scale
		if wall < r.WallStart + span then
			return if r.Hold > 0 then 0 else r.Scale
		end
	end
	return 1
end

---------------------------------------------------------------------------------------------
-- Continuous state

function Timeline.ShotIndexAt(c: Compiled, t: number): number
	local index = 1
	for i, shot in c.Shots do
		if shot.At <= t then
			index = i
		else
			break
		end
	end
	return index
end

-- Impact trauma 0..1 at t (Shake items add, trauma decays linearly).
function Timeline.TraumaAt(c: Compiled, t: number): number
	local decay = c.Def.ShakeDecay or CutsceneConfig.Camera.ShakeDecay
	local trauma, last = 0, 0
	for _, item in c.Shakes do
		if item.At > t then
			break
		end
		trauma = math.min(1, math.max(0, trauma - decay * (item.At - last)) + item.Trauma)
		last = item.At
	end
	return math.max(0, trauma - decay * (t - last))
end

export type CameraOptions = {
	Noise: boolean?, -- default true
	ShakeScale: number?, -- player's camera shake setting (0 = off)
	Heights: { [string]: number }?,
}

local function styleOffset(c: Compiled, shot: any, t: number): (Vector3, Vector3)
	local style = shot.Style or c.Def.Style or "Locked"
	return CameraNoise.Sample(style, t, c.Seed, shot.StyleAmount or c.Def.StyleAmount or 1)
end

local function shotState(c: Compiled, index: number, t: number, origin: CFrame, aspect: number, letterbox: number?, heights: { [string]: number }?): Shots.CameraState
	local shot = c.Shots[index]
	local ctx: Shots.Context = {
		Actors = Timeline.Poses(c, t, origin, heights),
		StartActors = if shot.Lock then Timeline.Poses(c, shot.At, origin, heights) else nil,
		Origin = origin,
		Aspect = aspect,
		Letterbox = letterbox,
	}
	return Shots.Evaluate(shot, t - shot.At, shot.End - shot.At, ctx)
end

-- The camera at scene time t. `aspect` is the viewport's width / height.
function Timeline.Camera(c: Compiled, t: number, origin: CFrame, aspect: number, options: CameraOptions?): (Shots.CameraState, number)
	local opts = options or {}
	local index = Timeline.ShotIndexAt(c, t)
	local shot = c.Shots[index]
	local letterbox = if Timeline.LetterboxAt(c, t) > 0 then c.Letterbox else nil
	local state = shotState(c, index, t, origin, aspect, letterbox, opts.Heights)
	local rotation, offset = Vector3.zero, Vector3.zero
	if opts.Noise ~= false then
		rotation, offset = styleOffset(c, shot, t)
	end

	local blend = shot.Blend or 0
	local localTime = t - shot.At
	if index > 1 and blend > 0 and localTime < blend then
		local k = Ease.Apply(shot.BlendEase, localTime / blend)
		local previous = shotState(c, index - 1, t, origin, aspect, letterbox, opts.Heights)
		state = Shots.Blend(previous, state, k)
		if opts.Noise ~= false then
			local r0, p0 = styleOffset(c, c.Shots[index - 1], t)
			rotation, offset = r0:Lerp(rotation, k), p0:Lerp(offset, k)
		end
	end

	local shakeScale = opts.ShakeScale or 1
	if shakeScale > 0 and opts.Noise ~= false then
		local trauma = Timeline.TraumaAt(c, t)
		if trauma > 0 then
			local cam = CutsceneConfig.Camera
			rotation += CameraNoise.Shake(trauma, t, c.Seed, cam.ShakeAngles * shakeScale, cam.ShakeFrequency)
		end
	end
	if rotation ~= Vector3.zero or offset ~= Vector3.zero then
		state.CFrame = CameraNoise.Apply(state.CFrame, rotation, offset)
	end
	return state, index
end

-- Black-screen level 0..1 at t (FadeIn / FadeOut plus the Fades track).
function Timeline.FadeAt(c: Compiled, t: number): number
	local level = if (c.Def.FadeIn or 0) > 0 then 1 else 0
	for _, item in c.Fades do
		if item.At > t then
			break
		end
		local from = item.From or level
		local k = if item.Duration > 0 then math.clamp((t - item.At) / item.Duration, 0, 1) else 1
		level = from + (item.To - from) * k
	end
	return level
end

-- Letterbox amount 0..1 (bars slide in at the start and out at the end).
function Timeline.LetterboxAt(c: Compiled, t: number): number
	if not c.Letterbox then
		return 0
	end
	local slide = c.Def.LetterboxTime or CutsceneConfig.Overlay.LetterboxTime
	if slide <= 0 then
		return 1
	end
	return math.clamp(math.min(t / slide, (c.Length - t) / slide), 0, 1)
end

-- The subtitle showing at t, or nil.
function Timeline.SubtitleAt(c: Compiled, t: number): any?
	local current = nil
	for _, item in c.Subtitles do
		if item.At > t then
			break
		end
		if t < item.At + item.Duration then
			current = item
		end
	end
	return current
end

---------------------------------------------------------------------------------------------
-- Discrete items

-- Items whose At is in (t0, t1], in order.
function Timeline.ItemsBetween(c: Compiled, t0: number, t1: number): { any }
	local out = {}
	for _, item in c.Fire do
		if item.At > t1 then
			break
		end
		if item.At > t0 then
			table.insert(out, item)
		end
	end
	return out
end

-- What is already under way at t, for seeking: the latest animation per actor and layer (with
-- how far into it we are), sounds and voice lines that started before t, and actors that were
-- ragdolled before t.
function Timeline.ActiveAt(c: Compiled, t: number): { Animations: { any }, Sounds: { any }, Ragdolls: { string }, Hidden: { [string]: boolean } }
	local latest: { [string]: any } = {}
	for _, item in c.Animations do
		if item.At > t then
			break
		end
		local key = `{item.Actor}/{item.Layer or "Action"}`
		if item.Duration and t >= item.At + item.Duration then
			latest[key] = nil
		else
			latest[key] = item
		end
	end
	local animations = {}
	for _, item in latest do
		table.insert(animations, { Item = item, Offset = t - item.At })
	end
	table.sort(animations, function(a, b)
		return a.Item.At < b.Item.At
	end)
	local sounds = {}
	for _, item in c.Fire do
		if item.At > t then
			break
		end
		if (item.Kind == "Sound" or (item.Kind == "Subtitle" and item.Sound)) and (item.Duration == nil or t < item.At + item.Duration) then
			table.insert(sounds, { Item = item, Offset = t - item.At })
		end
	end
	local ragdolls, hidden = {}, {}
	for _, item in c.Events do
		if item.At > t then
			break
		end
		if item.Name == "Ragdoll" and item.Target then
			table.insert(ragdolls, item.Target)
		elseif item.Name == "Hide" and item.Target then
			hidden[item.Target] = true
		elseif item.Name == "Show" and item.Target then
			hidden[item.Target] = nil
		end
	end
	return { Animations = animations, Sounds = sounds, Ragdolls = ragdolls, Hidden = hidden }
end

-- Scene time at which the scene ends if it plays on from t without branching.
function Timeline.EndFrom(c: Compiled, t: number): number
	for _, item in c.Events do
		if item.Name == "End" and item.At >= t then
			return item.At
		end
	end
	return c.Length
end

-- Events flagged Essential after t: game-state changes a skip must still apply.
function Timeline.EssentialAfter(c: Compiled, t: number): { any }
	local out = {}
	for _, item in c.Events do
		if item.At > t and item.Essential then
			table.insert(out, item)
		end
	end
	return out
end

-- Scene time at which a QTE's response window closes.
function Timeline.QteEnd(item: any): number
	return item.At + item.Qte.Window * (item.SlowMo or 1)
end

function Timeline.Label(c: Compiled, label: any): number?
	if type(label) == "number" then
		return label
	end
	return c.Labels[label]
end

---------------------------------------------------------------------------------------------
-- Compile

local function sortByAt(list: { any })
	table.sort(list, function(a, b)
		if a.At == b.At then
			return (a.__order or 0) < (b.__order or 0)
		end
		return a.At < b.At
	end)
end

local function seedOf(name: string): number
	local seed = 0
	for i = 1, #name do
		seed = (seed * 31 + string.byte(name, i)) % 100000
	end
	return seed
end

-- Returns the compiled scene and a list of errors (empty when valid). A scene with errors
-- still compiles as far as it can so tools can show everything that's wrong at once.
function Timeline.Compile(def: any): (Compiled, { string })
	local errors: { string } = {}
	local function err(message: string)
		table.insert(errors, message)
	end
	local name = def.Name or "Scene"
	local actors = def.Actors or {}
	local rawMarks = def.Marks or {}

	local marks: { [string]: Pose } = {}
	for markName, spec in rawMarks do
		local ok, result = pcall(resolveMark, spec, rawMarks)
		if ok then
			marks[markName] = result
		else
			err(`mark {markName}: {result}`)
		end
	end
	for actorName, actorDef in actors do
		if type(actorDef.Mark) == "string" and rawMarks[actorDef.Mark] == nil then
			err(`actor {actorName}: no mark "{actorDef.Mark}"`)
		end
	end

	local order = 0
	local function list(field: string, kind: string?): { any }
		local out = {}
		for _, item in def[field] or {} do
			local copy = table.clone(item)
			order += 1
			copy.__order = order
			copy.Kind = kind
			if type(copy.At) ~= "number" or copy.At < 0 then
				err(`{field}: every item needs At >= 0`)
				copy.At = 0
			end
			if copy.Actor and actors[copy.Actor] == nil then
				err(`{field} at {copy.At}: no actor "{copy.Actor}"`)
			end
			table.insert(out, copy)
		end
		sortByAt(out)
		return out
	end

	local shots = list("Shots")
	local animations = list("Animations", "Animation")
	local sounds = list("Sounds", "Sound")
	local subtitles = list("Subtitles", "Subtitle")
	local events = list("Events", "Event")
	local qtes = list("Qtes", "Qte")
	local shakes = list("Shakes")
	local fades = list("Fades")
	local moveList = list("Moves")
	local slowmo = list("SlowMo")
	local freezes = list("Freezes")

	if #shots == 0 then
		err("a scene needs at least one shot")
	end
	for i, shot in shots do
		for _, message in Shots.Validate(shot, actors) do
			err(`shot {i} ({shot.Name or shot.Type or "Frame"} at {shot.At}): {message}`)
		end
		if shot.Style and CameraNoise.Profiles[shot.Style] == nil then
			err(`shot {i}: unknown Style "{shot.Style}"`)
		end
	end
	if def.Style and CameraNoise.Profiles[def.Style] == nil then
		err(`unknown scene Style "{def.Style}"`)
	end
	for _, item in animations do
		if type(item.Id) ~= "string" then
			err(`animation at {item.At}: Id must be a string ("" until you have one)`)
		end
	end
	for _, item in subtitles do
		if type(item.Text) ~= "string" or type(item.Duration) ~= "number" then
			err(`subtitle at {item.At}: needs Text and Duration`)
			item.Duration = item.Duration or 1
		end
	end
	for _, item in shakes do
		item.Trauma = item.Trauma or 0.5
	end
	for _, item in fades do
		item.Duration = item.Duration or 0.5
		if type(item.To) ~= "number" then
			err(`fade at {item.At}: needs To (0 = clear, 1 = black)`)
			item.To = 0
		end
	end
	local moves: { [string]: { any } } = {}
	for _, move in moveList do
		if type(move.Duration) ~= "number" or move.Duration < 0 then
			err(`move at {move.At}: needs Duration >= 0 (0 = snap onto the mark)`)
			move.Duration = 1
		end
		if type(move.To) == "string" and rawMarks[move.To] == nil then
			err(`move at {move.At}: no mark "{move.To}"`)
			move.To = {}
		end
		if move.Actor then
			moves[move.Actor] = moves[move.Actor] or {}
			table.insert(moves[move.Actor], move)
		end
	end
	for _, item in qtes do
		local problem = if type(item.Qte) == "table" then Qte.Validate(item.Qte) else "needs a Qte spec"
		if problem then
			err(`QTE at {item.At}: {problem}`)
			item.Qte = { Type = "Press", Action = "Action", Window = 1 }
		end
		item.Id = item.Id or `Qte{item.At}`
	end

	-- Length
	local length = def.Length
	if not length then
		length = 0
		for _, group in { animations, sounds, subtitles, events, qtes, fades, moveList } do
			for _, item in group do
				length = math.max(length, item.At + (item.Duration or 0))
			end
		end
		if #shots > 0 then
			length = math.max(length, shots[#shots].At + (shots[#shots].Duration or 2))
		end
	end
	for i, shot in shots do
		shot.Index = i
		shot.End = if shots[i + 1] then shots[i + 1].At else length
		if shot.End <= shot.At then
			err(`shot {i} at {shot.At} has no time on screen (next shot starts at the same time)`)
			shot.End = shot.At + 1e-3
		end
	end

	-- Implicit fades
	if (def.FadeIn or 0) > 0 then
		table.insert(fades, 1, { At = 0, From = 1, To = 0, Duration = def.FadeIn })
	end
	if (def.FadeOut or 0) > 0 then
		table.insert(fades, { At = math.max(0, length - def.FadeOut), To = 1, Duration = def.FadeOut })
	end
	sortByAt(fades)

	-- Speed regions: slow motion, hit freezes, and QTE slow motion
	local regions: { Region } = {}
	for _, item in slowmo do
		if type(item.Duration) ~= "number" or type(item.Scale) ~= "number" or item.Scale <= 0 or item.Scale > 1 then
			err(`slow motion at {item.At}: needs Duration and 0 < Scale <= 1`)
		else
			table.insert(regions, { Start = item.At, End = item.At + item.Duration, Scale = item.Scale, Hold = 0, WallStart = 0 })
		end
	end
	for _, item in freezes do
		if type(item.Hold) ~= "number" or item.Hold <= 0 then
			err(`freeze at {item.At}: needs Hold > 0 (wall seconds)`)
		else
			table.insert(regions, { Start = item.At, End = item.At, Scale = 0, Hold = item.Hold, WallStart = 0 })
		end
	end
	for _, item in qtes do
		if item.SlowMo then
			table.insert(regions, { Start = item.At, End = Timeline.QteEnd(item), Scale = item.SlowMo, Hold = 0, WallStart = 0 })
		end
	end
	table.sort(regions, function(a, b)
		if a.Start == b.Start then
			return a.Hold > b.Hold -- a freeze before a slow-motion region starting on the same frame
		end
		return a.Start < b.Start
	end)
	local wall, cursor = 0, 0
	for i, r in regions do
		if r.Start < cursor - 1e-9 then
			err(`slow motion / freeze at {r.Start} overlaps the one before it`)
		end
		wall += math.max(0, r.Start - cursor)
		r.WallStart = wall
		wall += if r.Hold > 0 then r.Hold else (r.End - r.Start) / r.Scale
		cursor = math.max(cursor, r.End)
		regions[i] = r
	end
	local wallLength = wall + math.max(0, length - cursor)

	-- Labels (for QTE branches and Goto)
	local labels: { [string]: number } = {}
	for labelName, at in def.Labels or {} do
		labels[labelName] = at
	end
	local function checkTarget(where: string, branch: any)
		if type(branch) == "table" and branch.Goto ~= nil and Timeline.Label({ Labels = labels } :: any, branch.Goto) == nil then
			err(`{where}: no label "{tostring(branch.Goto)}"`)
		end
	end
	for _, item in qtes do
		checkTarget(`QTE {item.Id}`, item.OnSuccess)
		checkTarget(`QTE {item.Id}`, item.OnFail)
	end
	for _, item in events do
		if item.Name == "Goto" then
			checkTarget(`Goto at {item.At}`, { Goto = item.Label })
		end
		if item.Target and actors[item.Target] == nil then
			err(`event {item.Name} at {item.At}: no actor "{item.Target}"`)
		end
	end

	local fire = {}
	for _, group in { animations, sounds, subtitles, events, qtes } do
		for _, item in group do
			table.insert(fire, item)
		end
	end
	table.sort(fire, function(a, b)
		if a.At == b.At then
			return KIND_ORDER[a.Kind] < KIND_ORDER[b.Kind]
		end
		return a.At < b.At
	end)

	local line = def.Line
	if line then
		for _, actorName in line do
			if actors[actorName] == nil then
				err(`Line: no actor "{actorName}"`)
			end
		end
	end

	local compiled: Compiled = {
		Name = name,
		Kind = def.Kind or "Scene",
		Def = def,
		Length = length,
		WallLength = wallLength,
		Seed = def.Seed or seedOf(name),
		Actors = actors,
		Marks = marks,
		Shots = shots,
		Fire = fire,
		Animations = animations,
		Sounds = sounds,
		Subtitles = subtitles,
		Events = events,
		Qtes = qtes,
		Moves = moves,
		Shakes = shakes,
		Fades = fades,
		Regions = regions,
		Labels = labels,
		Line = line,
		Letterbox = if def.Letterbox == false then nil else def.Letterbox,
	}
	return compiled, errors
end

return Timeline
