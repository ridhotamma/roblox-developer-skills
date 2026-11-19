-- Replays tests/scenarios.cjs through the kit's MusicDirector and MusicTimeline and prints one
-- line per step in the same format as the JS port (run-luau.cjs compares them).
local MusicDirector = require(Shared.Music.MusicDirector)
local MusicTimeline = require(Shared.Music.MusicTimeline)

local function f5(x: number): string
	local s = string.format("%.5f", x)
	return if s == "-0.00000" then "0.00000" else s
end

for _, sc in SCENARIOS do
	local d = MusicDirector.new(sc.config)
	local ai = 1
	for step = 1, sc.steps do
		local t = step * sc.dt
		while ai <= #sc.actions and sc.actions[ai].t <= t - sc.dt / 2 do
			local a = sc.actions[ai]
			ai += 1
			if a.op == "set" then
				d:SetSource(a.id, a.state, a.intensity, a.ttl)
			elseif a.op == "clear" then
				d:ClearSource(a.id)
			elseif a.op == "base" then
				d:SetBase(a.state)
			end
		end
		local state, intensity, changed = d:Update(sc.dt)
		print(`{sc.name} {step} {state} {f5(intensity)} {changed}`)
	end
end

for _, c in TIMELINE_CASES do
	local loopTime, bar, beat = MusicTimeline.Position(c.cue, c.start, c.now)
	print(
		`tl {c.name} {f5(MusicTimeline.NextBoundary(c.cue, c.start, c.now, c.sync))} {f5(loopTime)} {bar} {beat} {f5(
			MusicTimeline.LayerGain(c.min, c.full, c.intensity)
		)} {f5(MusicTimeline.EntryOffset(c.cue, c.old, c.start, c.now, c.entry))}`
	)
end
