-- Tests for the music kit's pure modules (MusicTimeline, MusicDirector) and its config.
--
--   node tests/run-luau.cjs        (from the skill folder; also replays tests/scenarios.cjs
--                                   through the lab's JS port and diffs the output)
--
-- In Studio: put this in a Script, add `local Shared = game.ReplicatedStorage.Shared` at the top.

local MusicConfig = require(Shared.Music.MusicConfig)
local MusicDirector = require(Shared.Music.MusicDirector)
local MusicTimeline = require(Shared.Music.MusicTimeline)

local passed, failed = 0, 0
local function check(name: string, condition: any, detail: any?)
	if condition then
		passed += 1
	else
		failed += 1
		print(`FAIL {name}{if detail ~= nil then " (" .. tostring(detail) .. ")" else ""}`)
	end
end
local function near(a: number, b: number, tolerance: number?): boolean
	return math.abs(a - b) <= (tolerance or 1e-6)
end

---------------------------------------------------------------------------------------------
-- MusicTimeline

do
	local cue = { Bpm = 120, BeatsPerBar = 4, Bars = 8 }
	check("beat length", near(MusicTimeline.BeatLength(cue), 0.5))
	check("bar length", near(MusicTimeline.BarLength(cue), 2))
	check("loop length", near(MusicTimeline.LoopLength(cue), 16))
	check("phrase defaults to 4 bars", near(MusicTimeline.SyncLength(cue, "Phrase"), 8))
	check("immediate has no grid", MusicTimeline.SyncLength(cue, "Immediate") == 0)

	-- started at t = 100
	check("next beat", near(MusicTimeline.NextBoundary(cue, 100, 100.2, "Beat"), 100.5))
	check("on a beat stays", near(MusicTimeline.NextBoundary(cue, 100, 101.0, "Beat"), 101.0))
	check("next bar", near(MusicTimeline.NextBoundary(cue, 100, 102.01, "Bar"), 104))
	check("next phrase", near(MusicTimeline.NextBoundary(cue, 100, 101, "Phrase"), 108))
	check("next loop", near(MusicTimeline.NextBoundary(cue, 100, 117, "Loop"), 132))
	check("immediate = earliest", near(MusicTimeline.NextBoundary(cue, 100, 103.33, "Immediate"), 103.33))
	check("before the start waits for the start", near(MusicTimeline.NextBoundary(cue, 100, 99, "Bar"), 100))
	check("float noise doesn't skip a bar", near(MusicTimeline.NextBoundary(cue, 100, 104 + 1e-9, "Bar"), 104))

	local t, bar, beat = MusicTimeline.Position(cue, 100, 100 + 16 + 2.6)
	check("position wraps the loop", near(t, 2.6))
	check("bar 2", bar == 2, bar)
	check("beat 2", beat == 2, beat)
	local _, bar8, beat4 = MusicTimeline.Position(cue, 100, 115.99)
	check("last beat of bar 8", bar8 == 8 and beat4 == 4, `{bar8}.{beat4}`)

	check("bed layer always on", MusicTimeline.LayerGain(0, 0, 0) == 1)
	check("below min silent", MusicTimeline.LayerGain(0.4, 0.6, 0.39) == 0)
	check("above full on", MusicTimeline.LayerGain(0.4, 0.6, 0.61) == 1)
	check("midpoint half", near(MusicTimeline.LayerGain(0.4, 0.6, 0.5), 0.5))
	check("smoothstep eases in", MusicTimeline.LayerGain(0.4, 0.6, 0.42) < 0.1)
	local last, monotonic = -1, true
	for i = 0, 100 do
		local g = MusicTimeline.LayerGain(0.3, 0.7, i / 100)
		if g < last then
			monotonic = false
		end
		last = g
	end
	check("layer gain never goes down as intensity rises", monotonic)

	local other = { Bpm = 120, BeatsPerBar = 4, Bars = 4 }
	check("match keeps bar position", near(MusicTimeline.EntryOffset(other, cue, 100, 100 + 16 + 6.5, "Match"), 6.5))
	check("match wraps the shorter cue", near(MusicTimeline.EntryOffset(other, cue, 100, 100 + 10, "Match"), 2))
	check("start = 0", MusicTimeline.EntryOffset(other, cue, 100, 110, "Start") == 0)
	check("match needs the same tempo", MusicTimeline.EntryOffset({ Bpm = 90, BeatsPerBar = 4, Bars = 8 }, cue, 100, 110, "Match") == 0)
end

---------------------------------------------------------------------------------------------
-- MusicDirector

local function director()
	return MusicDirector.new({
		BaseState = "explore",
		Attack = 1,
		Release = 0.5,
		IntensityHold = 2,
		StateHold = 4,
		States = {
			silence = { Priority = 0 },
			explore = { Priority = 1, Intensity = 0.2 },
			combat = { Priority = 3, Intensity = 0.4, Hold = 5, MinDwell = 0 },
			boss = { Priority = 4, Intensity = 0.6 },
		},
	})
end
local function run(d: any, seconds: number, dt: number?): (string, number, boolean)
	local step = dt or 0.1
	local state, intensity, changedAny = d.state, d.intensity, false
	for _ = 1, math.floor(seconds / step + 0.5) do
		local changed
		state, intensity, changed = d:Update(step)
		changedAny = changedAny or changed
	end
	return state, intensity, changedAny
end

do
	local d = director()
	local state, intensity = run(d, 1)
	check("starts in the base state", state == "explore", state)
	check("base floor intensity", near(intensity, 0.2), intensity)

	d:SetSource("enemy", "combat", 0.7)
	local s1, i1, changed = d:Update(0.1)
	check("escalates on the next update", s1 == "combat" and changed, s1)
	check("jumps to the source intensity on a state change", near(i1, 0.7), i1)

	d:SetSource("gunfire", "combat", 1, 1)
	local _, i2 = run(d, 0.2)
	check("intensity rises at Attack per second", near(i2, 0.9, 1e-6), i2)
	local _, i3 = run(d, 0.2)
	check("capped at the strongest source", near(i3, 1), i3)

	-- gunfire expires at ~1 s: intensity holds 2 s at the peak, then releases 0.5/s toward 0.7
	run(d, 1.0)
	local _, held = run(d, 1.4)
	check("holds the peak", near(held, 1), held)
	local _, released = run(d, 0.5)
	check("then releases toward the remaining source", released < 1 and released > 0.7, released)

	d:ClearSource("enemy")
	local s4 = run(d, 4.5)
	check("stays in combat during Hold", s4 == "combat", s4)
	local s5, i5 = run(d, 1.0)
	check("steps down after Hold", s5 == "explore", s5)
	check("new state starts at its target", near(i5, 0.2, 0.05), i5)
end

do
	local d = director()
	d:SetSource("a", "combat", 0.5)
	run(d, 0.5)
	d:SetSource("b", "boss", 0.8)
	local s = run(d, 0.1)
	check("higher priority wins at once", s == "boss", s)
	d:ClearSource("b")
	local s2 = run(d, 3.9)
	check("boss uses StateHold (4 s) as its Hold", s2 == "boss", s2)
	local s3 = run(d, 0.3)
	check("falls to the next supported state, not the base", s3 == "combat", s3)
end

do
	local d = MusicDirector.new({
		BaseState = "explore",
		StateHold = 0,
		States = {
			explore = { Priority = 1 },
			combat = { Priority = 3, Hold = 0, MinDwell = 10 },
		},
	})
	d:SetSource("peek", "combat", 0.5, 0.3)
	local s = run(d, 5)
	check("MinDwell keeps a short blip from flip-flopping", s == "combat", s)
	local s2 = run(d, 5.2)
	check("leaves after MinDwell", s2 == "explore", s2)
end

do
	local d = director()
	d:SetBase("silence")
	local s = run(d, 0.1)
	check("base change moves immediately when nothing is playing", s == "silence", s)
	local ok = pcall(function()
		d:SetSource("x", "nope", 1)
	end)
	check("unknown state is an error", not ok)
end

---------------------------------------------------------------------------------------------
-- MusicConfig / MusicCues

do
	check("BaseState exists", MusicConfig.States[MusicConfig.BaseState] ~= nil)
	for name, state in MusicConfig.States do
		check(`state {name} has a Priority`, typeof(state.Priority) == "number")
		if state.Cue then
			local cue = MusicConfig.Cues[state.Cue]
			check(`state {name}: cue '{state.Cue}' exists in MusicCues`, cue ~= nil)
			if cue and state.Stinger then
				check(`state {name}: stinger '{state.Stinger}' exists in cue '{state.Cue}'`, cue.Stingers and cue.Stingers[state.Stinger] ~= nil)
			end
			if cue and state.Intro then
				check(`state {name}: cue has an Intro`, cue.Intro ~= nil)
			end
			if cue and state.Ending then
				check(`state {name}: cue has an Ending`, cue.Ending ~= nil)
			end
		end
		for _, sync in { state.Sync } do
			check(
				`state {name}: Sync '{sync}' is valid`,
				sync == "Immediate" or sync == "Beat" or sync == "Bar" or sync == "Phrase" or sync == "Loop"
			)
		end
	end
	local count = 0
	for cueName, cue in MusicConfig.Cues do
		count += 1
		check(`{cueName}: tempo`, cue.Bpm >= 40 and cue.Bpm <= 200, cue.Bpm)
		check(`{cueName}: bars`, cue.Bars >= 1 and cue.BeatsPerBar >= 2)
		check(`{cueName}: has stems`, #cue.Stems >= 1)
		check(`{cueName}: bed stem always on`, cue.Stems[1].Min == 0)
		local prev = -1
		for _, stem in cue.Stems do
			check(`{cueName}.{stem.Name}: Min <= Full`, stem.Min <= stem.Full)
			check(`{cueName}.{stem.Name}: ordered by Min`, stem.Min >= prev)
			check(`{cueName}.{stem.Name}: Asset is a string`, typeof(stem.Asset) == "string")
			prev = stem.Min
		end
		-- Every intensity from 0 to 1 must have at least one stem playing.
		for i = 0, 10 do
			local any = false
			for _, stem in cue.Stems do
				if MusicTimeline.LayerGain(stem.Min, stem.Full, i / 10) > 0 then
					any = true
				end
			end
			check(`{cueName}: something plays at intensity {i / 10}`, any)
		end
	end
	check("cues present", count >= 10, count)
end

print(`{passed} passed, {failed} failed`)
