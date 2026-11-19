--!strict
-- Musical time for adaptive playback. Pure functions (no Instances), so they run in the luau CLI
-- tests and the browser lab runs a line-for-line port of them.
--
-- A cue's grid starts at the mixer time its stems started playing; every transition, stinger and
-- layer change is placed on that grid: the next beat, bar, phrase or loop end.

export type Cue = {
	Bpm: number,
	BeatsPerBar: number,
	Bars: number,
	PhraseBars: number?,
}
export type Sync = "Immediate" | "Beat" | "Bar" | "Phrase" | "Loop"

local MusicTimeline = {}

function MusicTimeline.BeatLength(cue: Cue): number
	return 60 / cue.Bpm
end

function MusicTimeline.BarLength(cue: Cue): number
	return 60 / cue.Bpm * cue.BeatsPerBar
end

function MusicTimeline.LoopLength(cue: Cue): number
	return 60 / cue.Bpm * cue.BeatsPerBar * cue.Bars
end

function MusicTimeline.SyncLength(cue: Cue, sync: Sync): number
	if sync == "Beat" then
		return MusicTimeline.BeatLength(cue)
	elseif sync == "Bar" then
		return MusicTimeline.BarLength(cue)
	elseif sync == "Phrase" then
		return MusicTimeline.BarLength(cue) * math.min(cue.PhraseBars or 4, cue.Bars)
	elseif sync == "Loop" then
		return MusicTimeline.LoopLength(cue)
	end
	return 0
end

-- First grid point at or after `earliest`, on the grid that started at `startTime`.
function MusicTimeline.NextBoundary(cue: Cue, startTime: number, earliest: number, sync: Sync): number
	local unit = MusicTimeline.SyncLength(cue, sync)
	if unit <= 0 then
		return earliest
	end
	local k = math.ceil((earliest - startTime) / unit - 1e-6)
	return startTime + math.max(k, 0) * unit
end

-- Where the playhead is: seconds into the loop, bar (1-based), beat (1-based).
function MusicTimeline.Position(cue: Cue, startTime: number, now: number): (number, number, number)
	local loop = MusicTimeline.LoopLength(cue)
	local t = (now - startTime) % loop
	local beats = t / MusicTimeline.BeatLength(cue)
	return t, math.floor(beats / cue.BeatsPerBar) + 1, math.floor(beats % cue.BeatsPerBar) + 1
end

-- Stem gain for an intensity: 0 below Min, 1 above Full, smoothstep between.
function MusicTimeline.LayerGain(min: number, full: number, intensity: number): number
	if full <= min then
		return if intensity >= min then 1 else 0
	end
	local x = math.clamp((intensity - min) / (full - min), 0, 1)
	return x * x * (3 - 2 * x)
end

-- Where to start a new cue: "Start" = its first bar; "Match" = the same position as the old
-- cue (for cues that share tempo and meter, like a calm and a combat arrangement of one theme).
function MusicTimeline.EntryOffset(newCue: Cue, oldCue: Cue?, oldStart: number, at: number, entry: string?): number
	if entry == "Match" and oldCue and oldCue.Bpm == newCue.Bpm and oldCue.BeatsPerBar == newCue.BeatsPerBar then
		return (at - oldStart) % MusicTimeline.LoopLength(newCue)
	end
	return 0
end

return MusicTimeline
