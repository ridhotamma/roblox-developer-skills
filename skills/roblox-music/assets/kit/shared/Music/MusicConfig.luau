--!strict
-- Everything about how the music behaves lives here: which cue plays in which game state, how
-- states hand over, how fast intensity follows the action, stingers, ducking and volume.
-- The cues themselves (tempo, bars, stems and their asset ids) are in MusicCues.luau.

local MusicCues = require(script.Parent.MusicCues)

local MusicConfig = {
	Cues = MusicCues,

	-- The state when nothing is happening. Server code can change it per round or area
	-- (MusicService:SetBase) and client code with MusicController:SetBase.
	BaseState = "explore",

	-- Game states, highest Priority wins (see MusicDirector). Per state:
	--   Cue        MusicCues key to play (nil = silence)
	--   Intensity  floor intensity while in the state (0-1); sources push it higher
	--   Hold       seconds with no source before the state is allowed to end
	--   MinDwell   minimum seconds in the state before it may step down
	--   Sync       when the cue may start: "Immediate" | "Beat" | "Bar" | "Phrase" | "Loop"
	--   Fade       crossfade seconds;  Entry  "Start" | "Match" (keep the bar position)
	--   Intro      play the cue's Intro one-shot first (lands on the loop's downbeat)
	--   Ending     when LEAVING this state, play the cue's Ending on the boundary instead of a long fade
	--   Stinger    stinger to play when ENTERING this state from a lower priority
	States = {
		silence = { Priority = 0 },
		explore = { Priority = 1, Cue = "exploration", Intensity = 0.2, Fade = 3, Sync = "Bar" },
		tension = { Priority = 2, Cue = "heist_stealth", Intensity = 0.3, Hold = 6, Fade = 2 },
		combat = {
			Priority = 3,
			Cue = "action_combat",
			Intensity = 0.45,
			Hold = 8,
			MinDwell = 12,
			Sync = "Beat",
			Fade = 0.5,
			Stinger = "alert",
			Ending = true,
		},
		chase = { Priority = 3, Cue = "car_chase", Intensity = 0.3, Hold = 10, Sync = "Beat", Fade = 0.75, Ending = true },
		boss = { Priority = 4, Cue = "epic_boss", Intensity = 0.55, Hold = 5, Sync = "Bar", Intro = true, Ending = true },
	},

	Director = {
		Attack = 1.5, -- intensity units per second going up (0 -> 1 in ~0.7 s)
		Release = 0.15, -- per second going down (1 -> 0 in ~7 s): the music calms slower than it reacts
		IntensityHold = 3, -- seconds at the peak before it starts to fall
		StateHold = 6, -- default Hold for states that don't set one
	},

	Transition = {
		Sync = "Bar",
		Fade = 1.5,
		Entry = "Start",
		Lead = 0.12, -- seconds of scheduling headroom: never schedule closer than this to "now"
		LoadTimeout = 8, -- seconds to wait for a cue's stems to load before starting it anyway
	},

	-- Seconds for a stem to fade in/out when intensity crosses its Min/Full range.
	LayerFade = 0.8,

	Stinger = {
		Sync = "Beat", -- stingers land on the next beat of the playing cue
		Duck = 0.5, -- music drops by 50% under a stinger...
		Release = 1.2, -- ...and comes back over this many seconds after it
	},

	-- Music bus volume before the player's own setting (Player attribute MusicVolume, 0-1).
	Volume = 0.5,
	VolumeAttribute = "MusicVolume",

	-- "Fear emitters" (Dead Space): parts tagged with this push a state and intensity by proximity.
	-- Attributes: State (string), Intensity (0-1, at the centre), Radius (studs, default 60).
	Emitters = {
		Tag = "MusicEmitter",
		Interval = 0.2,
		DefaultRadius = 60,
	},

	-- Attributes MusicService sets (workspace = everyone, Player = one player).
	Attributes = {
		State = "MusicState",
		Intensity = "MusicIntensity",
		Base = "MusicBase",
		Stinger = "MusicStinger",
	},
}

return MusicConfig
