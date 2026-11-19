--!strict
-- Coverage: the script supervisor and editor's checks, run on a compiled scene before anyone
-- watches it. Pure. Run it with `node scripts/previs.cjs <Scene> --check` or from the tests.
--
--   Line      a cut crosses the 180° line between the two Line actors (screen direction flips)
--   Jump      a cut to the same subject with < 30° change of angle and < one shot size change
--   Flash     a shot under 0.4 s (unless Flash = true)
--   Static    a locked-off, unmoving shot over 10 s
--   Pan       the camera turns faster than the eye can follow without motion blur (> 150°/s),
--             unless the shot says Whip = true
--   Establish the scene doesn't open on a wide shot (scenes only, not finishers)
--   Subtitle  reading speed over 17 characters/s, over 2 lines of 42, under 1.2 s, overlaps
--   Qte       a window under 0.6 s, a cut during a QTE window, a fail branch with no way back
--   Skip      an unskippable scene longer than 20 s
-- Each warning says when, what, and the usual fix. Errors in film grammar are allowed when
-- they're on purpose: mark the shot (CrossLine, Flash, Whip, JumpCut) and the check stays quiet.

local Lens = require(script.Parent.Lens)
local Timeline = require(script.Parent.Timeline)

local Coverage = {}

export type Warning = { Time: number, Kind: string, Message: string }

local NEUTRAL_DEGREES = 12
local MIN_ANGLE_CHANGE = 30
local MAX_PAN_SPEED = 150
local SAMPLE_RATE = 30

local function flat(v: Vector3): Vector3
	return Vector3.new(v.X, 0, v.Z)
end

local function fmt(t: number): string
	return string.format("%.2fs", t)
end

-- 1 = left of the line looking from a to b, -1 = right, 0 = on the line (within ±12° of it).
function Coverage.SideOfLine(a: Vector3, b: Vector3, point: Vector3): number
	local axis = flat(b - a)
	local mid = (a + b) / 2
	local toPoint = flat(point - mid)
	if axis.Magnitude < 1e-3 or toPoint.Magnitude < 1e-3 then
		return 0
	end
	local cross = axis.Unit:Cross(toPoint.Unit).Y
	if math.abs(cross) < math.sin(math.rad(NEUTRAL_DEGREES)) then
		return 0
	end
	return if cross > 0 then 1 else -1
end

local function angleBetween(a: Vector3, b: Vector3): number
	local fa, fb = flat(a), flat(b)
	if fa.Magnitude < 1e-3 or fb.Magnitude < 1e-3 then
		return 180
	end
	return math.deg(math.acos(math.clamp(fa.Unit:Dot(fb.Unit), -1, 1)))
end

local ORIGIN = CFrame.new()
local ASPECT = 16 / 9

local function cameraAt(c: Timeline.Compiled, t: number)
	local state = Timeline.Camera(c, t, ORIGIN, ASPECT, { Noise = false })
	return state
end

local function checkCuts(c: Timeline.Compiled, out: { Warning })
	local shots = c.Shots
	for i = 2, #shots do
		local shot, prev = shots[i], shots[i - 1]
		if (shot.Blend or 0) > 0 then
			continue -- a blend is a camera move, not a cut
		end
		local t = shot.At
		local before = Timeline.Camera(c, t - 1e-3, ORIGIN, ASPECT, { Noise = false })
		local after = Timeline.Camera(c, t, ORIGIN, ASPECT, { Noise = false })
		local poses = Timeline.Poses(c, t, ORIGIN)

		local line = shot.Line or c.Line
		if line and not shot.CrossLine and poses[line[1]] and poses[line[2]] then
			local a, b = poses[line[1]].CFrame.Position, poses[line[2]].CFrame.Position
			local s0 = Coverage.SideOfLine(a, b, before.CFrame.Position)
			local s1 = Coverage.SideOfLine(a, b, after.CFrame.Position)
			if s0 ~= 0 and s1 ~= 0 and s0 ~= s1 then
				table.insert(out, {
					Time = t,
					Kind = "Line",
					Message = `cut {i - 1}→{i} crosses the 180° line between {line[1]} and {line[2]}: they swap sides of the screen. Keep the camera on one side, cut to a neutral shot on the line first, show the camera crossing in a move, or set CrossLine = true if it's on purpose.`,
				})
			end
		end

		local subject = after.Subject
		if subject and subject == before.Subject and not shot.JumpCut and poses[subject] then
			local center = poses[subject].CFrame.Position
			local angle = angleBetween(before.CFrame.Position - center, after.CFrame.Position - center)
			local function framed(state: any): number
				return Lens.ExtentAtDistance((state.CFrame.Position - state.Aim).Magnitude, state.Fov)
			end
			local ratio = framed(before) / framed(after)
			if ratio < 1 then
				ratio = 1 / ratio
			end
			if angle < MIN_ANGLE_CHANGE and ratio < 1.45 then
				table.insert(out, {
					Time = t,
					Kind = "Jump",
					Message = `cut {i - 1}→{i} on {subject} changes angle by {math.floor(angle + 0.5)}° and size by x{string.format("%.2f", ratio)}: reads as a jump cut. Move the camera 30°+ or change at least one shot size (or set JumpCut = true for a deliberate one).`,
				})
			end
		end
		local _ = prev
	end
end

local function checkShots(c: Timeline.Compiled, out: { Warning })
	local total = 0
	for i, shot in c.Shots do
		local length = shot.End - shot.At
		total += length
		if length < 0.4 and not shot.Flash then
			table.insert(out, {
				Time = shot.At,
				Kind = "Flash",
				Message = `shot {i} is on screen {string.format("%.2f", length)}s: too short to read. Give it 0.6s+ or set Flash = true for an impact frame.`,
			})
		end
		local moving = shot.Move or shot.Moves or shot.To or shot.Type == "Path"
		local still = (shot.Style or c.Def.Style or "Locked") == "Locked"
		if length > 10 and not moving and still then
			table.insert(out, {
				Time = shot.At,
				Kind = "Static",
				Message = `shot {i} holds still for {string.format("%.1f", length)}s. Add a slow push-in, a Steadicam style, or cut to coverage.`,
			})
		end
		if not shot.Whip then
			local steps = math.max(2, math.floor(length * SAMPLE_RATE))
			local last = cameraAt(c, shot.At + 1e-4).CFrame.LookVector
			for s = 1, steps do
				local t = shot.At + length * s / steps - 1e-4
				local look = cameraAt(c, t).CFrame.LookVector
				local degrees = math.deg(math.acos(math.clamp(last:Dot(look), -1, 1)))
				local speed = degrees / (length / steps)
				if speed > MAX_PAN_SPEED then
					table.insert(out, {
						Time = t,
						Kind = "Pan",
						Message = `shot {i} turns at {math.floor(speed)}°/s: judders without motion blur. Slow the move, or mark Whip = true and hide it under a cut.`,
					})
					break
				end
				last = look
			end
		end
	end
	if c.Kind ~= "Finisher" and c.Shots[1] then
		local first = c.Shots[1]
		local wide = first.Size == "EWS" or first.Size == "WS" or first.Type == "Path" or first.Type == "TwoShot" or first.Establishing
		if not wide then
			table.insert(out, {
				Time = 0,
				Kind = "Establish",
				Message = "the scene doesn't open on a wide shot: the player may not know where everyone is. Open wide (EWS/WS, a Path or a TwoShot) or set Establishing = true on the first shot.",
			})
		end
	end
end

local function checkSubtitles(c: Timeline.Compiled, out: { Warning })
	local previousEnd = -math.huge
	for _, item in c.Subtitles do
		local chars = #item.Text
		if item.Duration < 1.2 then
			table.insert(out, { Time = item.At, Kind = "Subtitle", Message = `subtitle "{item.Text}" shows for {item.Duration}s; give every line 1.2s+.` })
		end
		if chars / item.Duration > 17 then
			table.insert(out, {
				Time = item.At,
				Kind = "Subtitle",
				Message = `subtitle "{item.Text}" needs {string.format("%.1f", chars / 17)}s to read at 17 characters/s but shows {item.Duration}s. Lengthen it or split the line.`,
			})
		end
		if chars > 84 then
			table.insert(out, { Time = item.At, Kind = "Subtitle", Message = `subtitle "{item.Text}" is over two lines of 42 characters; split it.` })
		end
		if item.At < previousEnd - 1e-6 then
			table.insert(out, { Time = item.At, Kind = "Subtitle", Message = "two subtitles overlap; the first is cut short." })
		end
		previousEnd = item.At + item.Duration
	end
end

local function checkQtes(c: Timeline.Compiled, out: { Warning })
	for _, item in c.Qtes do
		local window = item.Qte.Window
		if window < 0.6 then
			table.insert(out, {
				Time = item.At,
				Kind = "Qte",
				Message = `QTE {item.Id} gives {window}s to react; reaction to a surprise prompt takes 0.4-0.6s before the hand moves. Use 0.8s+ or slow motion.`,
			})
		end
		local closeAt = Timeline.QteEnd(item)
		for i, shot in c.Shots do
			if shot.At > item.At + 0.05 and shot.At < closeAt then
				table.insert(out, {
					Time = shot.At,
					Kind = "Qte",
					Message = `shot {i} cuts during QTE {item.Id}'s window: the player loses the thing they're reacting to. Hold the shot until the window closes.`,
				})
			end
		end
		if item.OnFail == nil or item.OnFail == "Continue" then
			-- fine: failing just plays on
		elseif type(item.OnFail) == "table" and item.OnFail.Goto ~= nil then
			local at = Timeline.Label(c, item.OnFail.Goto)
			if at and at > item.At and Timeline.EndFrom(c, at) >= c.Length and not item.OnFail.Final then
				table.insert(out, {
					Time = item.At,
					Kind = "Qte",
					Message = `QTE {item.Id}'s fail branch never returns (no End or Goto back). If failing should end the scene, set OnFail.Final = true; otherwise end the branch with a Goto to a retry label.`,
				})
			end
		end
	end
end

-- All warnings, in time order.
function Coverage.Check(c: Timeline.Compiled): { Warning }
	local out: { Warning } = {}
	checkCuts(c, out)
	checkShots(c, out)
	checkSubtitles(c, out)
	checkQtes(c, out)
	if c.Def.Skippable == false and c.Length > 20 and c.Kind ~= "Finisher" then
		table.insert(out, { Time = 0, Kind = "Skip", Message = `an unskippable {math.floor(c.Length)}s scene: players replaying it will hate it. Make it skippable (state changes go in Essential events).` })
	end
	table.sort(out, function(a, b)
		return a.Time < b.Time
	end)
	return out
end

-- Average shot length and cut count, the editor's pacing numbers.
function Coverage.Pacing(c: Timeline.Compiled): { Shots: number, AverageShot: number, Length: number }
	local count = #c.Shots
	return { Shots = count, AverageShot = if count > 0 then c.Length / count else 0, Length = c.Length }
end

return Coverage
