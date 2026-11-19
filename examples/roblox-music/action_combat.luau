-- Paste into MusicCues.luau (replace the entry with the same name), then fill in the asset ids.
	action_combat = {
		-- Action combat: D aeolian, i:2 VI VII i:2 iv V. Seed 1. Loop 13.7143 s, full mix -16 LUFS.
		Bpm = 140,
		BeatsPerBar = 4,
		Bars = 8,
		Stems = {
			{ Name = "bed", Asset = "", Min = 0, Full = 0 }, -- action_combat_bed.wav
			{ Name = "pulse", Asset = "", Min = 0.2, Full = 0.35 }, -- action_combat_pulse.wav
			{ Name = "drums", Asset = "", Min = 0.45, Full = 0.6 }, -- action_combat_drums.wav
			{ Name = "brass", Asset = "", Min = 0.7, Full = 0.85 }, -- action_combat_brass.wav
			{ Name = "peak", Asset = "", Min = 0.9, Full = 1 }, -- action_combat_peak.wav
		},
		Intro = { Asset = "", Beats = 4 }, -- action_combat_intro.wav
		Ending = { Asset = "", Beats = 8 }, -- action_combat_ending.wav
		Stingers = {
			alert = { Asset = "", Beats = 4 }, -- action_combat_alert.wav
			hit = { Asset = "", Beats = 2 }, -- action_combat_hit.wav
			victory = { Asset = "", Beats = 6 }, -- action_combat_victory.wav
			fail = { Asset = "", Beats = 6 }, -- action_combat_fail.wav
		},
	},
