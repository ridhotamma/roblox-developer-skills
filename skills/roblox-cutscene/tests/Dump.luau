-- Samples a scene through the kit's real Timeline for the previs page and the coverage check.
-- run-luau.cjs prepends TARGET (module key), FPS and ASPECT. Prints one JSON object.
--
-- Frames are sampled in WALL time, so slow motion plays slowly and freezes hold in the previs,
-- exactly as in game. Branches (QTE fail sections) play in timeline order; the page marks the
-- labels and End events so you can see which part belongs to which outcome.

local Timeline = require(Shared.Cutscene.Timeline)
local Coverage = require(Shared.Cutscene.Coverage)
local Lens = require(Shared.Cutscene.Lens)

local def = require(TARGET)

local function round(n: number): number
	if n ~= n or n == math.huge or n == -math.huge then
		return 0
	end
	return math.floor(n * 10000 + 0.5) / 10000
end

local encode
local function encodeString(s: string): string
	s = string.gsub(s, '[%c"\\]', function(ch: string)
		local map = { ['"'] = '\\"', ["\\"] = "\\\\", ["\n"] = "\\n", ["\t"] = "\\t", ["\r"] = "\\r" }
		return map[ch] or string.format("\\u%04x", string.byte(ch))
	end)
	return '"' .. s .. '"'
end
encode = function(v: any): string
	local kind = typeof(v)
	if kind == "nil" then
		return "null"
	elseif kind == "boolean" then
		return tostring(v)
	elseif kind == "number" then
		return tostring(round(v))
	elseif kind == "string" then
		return encodeString(v)
	elseif kind == "Vector3" then
		return `[{round(v.X)},{round(v.Y)},{round(v.Z)}]`
	elseif kind == "table" then
		if #v > 0 or next(v) == nil then
			local parts = {}
			for _, item in v do
				table.insert(parts, encode(item))
			end
			return "[" .. table.concat(parts, ",") .. "]"
		end
		local parts = {}
		for key, item in v do
			if type(key) == "string" and string.sub(key, 1, 2) ~= "__" and typeof(item) ~= "CFrame" then
				table.insert(parts, encodeString(key) .. ":" .. encode(item))
			end
		end
		table.sort(parts)
		return "{" .. table.concat(parts, ",") .. "}"
	end
	return "null"
end

local function frameOf(cf: CFrame): { number }
	local p, r, u = cf.Position, cf.RightVector, cf.UpVector
	local l = cf.LookVector
	return {
		round(p.X), round(p.Y), round(p.Z),
		round(r.X), round(r.Y), round(r.Z),
		round(u.X), round(u.Y), round(u.Z),
		round(-l.X), round(-l.Y), round(-l.Z),
	}
end

local c, errors = Timeline.Compile(def)
local out: { [string]: any } = {
	name = def.Name or "Scene",
	kind = c.Kind,
	errors = errors,
	aspect = ASPECT,
	fps = FPS,
}

if #errors == 0 then
	local origin = CFrame.new()
	out.length = c.Length
	out.wallLength = c.WallLength
	out.letterbox = c.Letterbox
	out.line = c.Line
	out.labels = c.Labels

	local actorNames = {}
	for name in c.Actors do
		table.insert(actorNames, name)
	end
	table.sort(actorNames)
	local actors = {}
	for _, name in actorNames do
		local a = c.Actors[name]
		table.insert(actors, { name = name, height = a.Height or 5.2, template = a.Template, player = a.Player == true })
	end
	out.actors = actors

	local marks = {}
	for name, pose in c.Marks do
		table.insert(marks, { name = name, position = pose.Position, yaw = pose.Yaw })
	end
	out.marks = marks

	local shots = {}
	for i, shot in c.Shots do
		local style = shot.Style or def.Style or "Locked"
		local moves = {}
		if shot.Moves then
			for _, m in shot.Moves do
				table.insert(moves, m[1])
			end
		elseif shot.Move then
			table.insert(moves, shot.Move)
		end
		local mid = Timeline.Camera(c, (shot.At + shot.End) / 2, origin, ASPECT, { Noise = false })
		local subjectPose = mid.Subject and c.Actors[mid.Subject] and Timeline.Poses(c, (shot.At + shot.End) / 2, origin)[mid.Subject]
		local size = shot.Size
		if not size and subjectPose then
			size = Lens.NearestSize(Lens.ExtentAtDistance((mid.CFrame.Position - mid.Aim).Magnitude, mid.Fov), subjectPose.Height)
		end
		table.insert(shots, {
			index = i,
			at = shot.At,
			["end"] = shot.End,
			wallAt = Timeline.WallTime(c, shot.At),
			wallEnd = Timeline.WallTime(c, shot.End),
			name = shot.Name or "",
			type = shot.Type or "Frame",
			subject = mid.Subject,
			size = size,
			lens = round(shot.Lens or mid.Lens),
			style = style,
			moves = moves,
			blend = shot.Blend or 0,
			aperture = shot.Aperture,
			pitch = shot.Pitch,
		})
	end
	out.shots = shots

	local track = {}
	for _, item in c.Fire do
		table.insert(track, {
			at = item.At,
			wall = Timeline.WallTime(c, item.At),
			kind = item.Kind,
			actor = item.Actor,
			name = item.Name or item.Id or item.Text,
			target = item.Target,
			id = item.Id,
			looped = item.Looped,
			server = item.Server,
			essential = item.Essential,
			label = item.Label,
		})
	end
	out.items = track

	local qtes = {}
	for _, item in c.Qtes do
		local function branch(b: any): string
			if type(b) == "table" and b.Goto then
				return `Goto {tostring(b.Goto)}`
			end
			return if type(b) == "string" then b else "Continue"
		end
		table.insert(qtes, {
			id = item.Id,
			at = item.At,
			["end"] = Timeline.QteEnd(item),
			wallAt = Timeline.WallTime(c, item.At),
			wallEnd = Timeline.WallTime(c, Timeline.QteEnd(item)),
			type = item.Qte.Type,
			action = item.Qte.Action or table.concat(item.Qte.Actions or {}, "/"),
			label = item.Qte.Label,
			window = item.Qte.Window,
			slowmo = item.SlowMo,
			onSuccess = branch(item.OnSuccess),
			onFail = branch(item.OnFail),
		})
	end
	out.qtes = qtes

	local subtitles = {}
	for _, item in c.Subtitles do
		table.insert(subtitles, { at = item.At, duration = item.Duration, speaker = item.Speaker, text = item.Text, wall = Timeline.WallTime(c, item.At), wallEnd = Timeline.WallTime(c, item.At + item.Duration) })
	end
	out.subtitles = subtitles

	local regions = {}
	for _, r in c.Regions do
		table.insert(regions, { start = r.Start, ["end"] = r.End, scale = r.Scale, hold = r.Hold, wallStart = r.WallStart, wallEnd = r.WallStart + (if r.Hold > 0 then r.Hold else (r.End - r.Start) / r.Scale) })
	end
	out.regions = regions

	local ends = {}
	for _, item in c.Events do
		if item.Name == "End" or item.Name == "Goto" then
			table.insert(ends, { at = item.At, wall = Timeline.WallTime(c, item.At), name = item.Name, label = item.Label })
		end
	end
	out.flow = ends

	local frames = {}
	local count = math.floor(c.WallLength * FPS + 0.5)
	for i = 0, count do
		local wall = i / FPS
		local t = math.min(Timeline.SceneTime(c, wall), c.Length)
		local state, index = Timeline.Camera(c, t, origin, ASPECT)
		local poses = Timeline.Poses(c, t, origin)
		local actorFrames = {}
		for _, name in actorNames do
			table.insert(actorFrames, frameOf(poses[name].CFrame))
		end
		local sub = Timeline.SubtitleAt(c, t)
		local subIndex = -1
		if sub then
			for j, item in c.Subtitles do
				if item == sub then
					subIndex = j - 1
				end
			end
		end
		table.insert(frames, {
			t = round(t),
			cam = frameOf(state.CFrame),
			fov = round(state.Fov),
			lens = round(state.Lens),
			shot = index - 1,
			fade = round(Timeline.FadeAt(c, t)),
			lb = round(Timeline.LetterboxAt(c, t)),
			sub = subIndex,
			trauma = round(Timeline.TraumaAt(c, t)),
			speed = Timeline.SpeedAtWall(c, wall),
			focus = state.Focus,
			actors = actorFrames,
		})
	end
	out.frames = frames

	local warnings = {}
	for _, w in Coverage.Check(c) do
		table.insert(warnings, { time = w.Time, kind = w.Kind, message = w.Message })
	end
	out.warnings = warnings
	out.pacing = Coverage.Pacing(c)
end

print(encode(out))
