-- Ambush: a documentary-handheld action scene with two QTEs and fail branches, the pattern for
-- interactive cutscenes (RE4's knife fight, Call of Duty's campaign struggles).
--
--   0.0   wide, behind the player: quiet street (establishing)
--   2.5   over the shoulder: Raider1 charges -> QTE "Dodge" (press, slow motion)
--            fail -> Caught (12.0): hit, damage, back to Retry (2.5)
--   3.35  cut on the dodge: Raider1 stumbles past
--   5.0   Raider2 tackles the player down
--   6.0   high angle on the player pinned -> QTE "Struggle" (mash, with drain)
--            fail -> Pinned (15.0): damage, back to StruggleRetry (5.0)
--   9.4   kick him off, get up; End at 11.5
--
-- Every branch starts by putting actors back on its marks (Moves with a tiny Duration), because
-- a QTE result jumps straight into the branch. All cameras stay on the left of the line
-- between Player and Raider1. Failing loops back to retry, as RE4 does after a QTE death,
-- without making the player sit through the whole scene again.

return {
	Name = "Ambush",
	Letterbox = 2,
	FadeIn = 0.4,
	FadeOut = 0.4,
	BlendIn = 0,
	BlendOut = 0.6,
	Skippable = true,
	Style = "Documentary",
	Line = { "Player", "Raider1" },
	Labels = { Retry = 2.5, Caught = 12, StruggleRetry = 5, Pinned = 15 },
	Marks = {
		PlayerStart = { Position = Vector3.new(0, 0, 0), Yaw = 0 },
		Raider1Start = { Position = Vector3.new(-6, 0, -10), Face = "PlayerStart" },
		Raider2Start = { Position = Vector3.new(8, 0, -6), Face = "PlayerStart" },
		Raider1Lunge = { Position = Vector3.new(-1, 0, -2) },
		DodgeTo = { Position = Vector3.new(-3, 0, 1) },
		TacklePoint = { Position = Vector3.new(-2.2, 0, 0.2) },
		Down = { Position = Vector3.new(-3, 0, 1.5), Pitch = 85, Lift = 0.3 },
		OnTop = { Position = Vector3.new(-3, 0, 3.4), Yaw = 180, Pitch = -40, Lift = -1 }, -- kneeling over the chest, leaning in
		Thrown = { Position = Vector3.new(-5.5, 0, 3.5), Pitch = -80, Lift = 0.3 },
		PlayerUp = { Position = Vector3.new(-3, 0, 1.5), Pitch = 0 },
	},
	Actors = {
		Player = { Mark = "PlayerStart", Player = true },
		Raider1 = { Mark = "Raider1Start", Template = "Raider" },
		Raider2 = { Mark = "Raider2Start", Template = "Raider" },
	},
	Shots = {
		{ At = 0, Name = "Quiet street", Subject = "Player", Size = "WS", Yaw = 140, Pitch = 10, Lens = 24, Style = "Handheld" },
		{ At = 2.5, Name = "Raider1 charges", Type = "OverShoulder", Over = "Player", Subject = "Raider1", Side = "Left", Lens = 35, Size = "MS" },
		{ At = 3.35, Name = "He stumbles past (cut on the dodge)", Subject = "Raider1", Size = "MS", Yaw = -150, Lens = 28 },
		{ At = 5, Name = "Raider2 from nowhere", Subject = "Player", Size = "MS", Yaw = 60, Lens = 28, Move = "PullOut", Amount = 0.3 },
		{ At = 6, Name = "Pinned", Subject = "Player", Size = "MCU", Pitch = 60, Yaw = 60, Lens = 28, Style = "Combat" },
		{ At = 9.4, Name = "Back on your feet", Subject = "Player", Size = "FS", Yaw = 60, Lens = 24 },
		{ At = 12, Name = "Caught", Subject = "Raider1", Size = "MS", Yaw = -60, Lens = 28, Style = "Combat" },
		{ At = 15, Name = "Pinned, losing", Subject = "Player", Size = "MCU", Pitch = 60, Yaw = 60, Lens = 35, Style = "Combat" },
	},
	Moves = {
		{ At = 2.6, Actor = "Raider1", To = "Raider1Lunge", Duration = 1, Ease = "In" },
		{ At = 3.35, Actor = "Player", To = "DodgeTo", Duration = 0.4, Ease = "Out" },
		{ At = 5.2, Actor = "Raider2", To = "TacklePoint", Duration = 0.8, Ease = "In" },
		{ At = 6, Actor = "Player", To = "Down", Duration = 0.35, Ease = "Out" },
		{ At = 6, Actor = "Raider2", To = "OnTop", Duration = 0.4, Ease = "Out" },
		{ At = 9.4, Actor = "Raider2", To = "Thrown", Duration = 0.5, Ease = "Out" },
		{ At = 9.6, Actor = "Player", To = "PlayerUp", Duration = 0.8 },
		-- Caught branch: back on marks
		{ At = 12, Actor = "Player", To = "PlayerStart", Duration = 0 },
		{ At = 12, Actor = "Raider1", To = "Raider1Lunge", Duration = 0 },
		{ At = 12, Actor = "Raider2", To = "Raider2Start", Duration = 0 },
		-- Pinned branch: back on marks
		{ At = 15, Actor = "Player", To = "Down", Duration = 0 },
		{ At = 15, Actor = "Raider2", To = "OnTop", Duration = 0 },
	},
	Animations = {
		{ At = 0, Actor = "Player", Id = "", Looped = true }, -- walking idle
		{ At = 2.6, Actor = "Raider1", Id = "", Looped = true }, -- sprint
		{ At = 3.35, Actor = "Player", Id = "" }, -- dodge roll
		{ At = 5.2, Actor = "Raider2", Id = "" }, -- tackle
		{ At = 6, Actor = "Player", Id = "", Looped = true }, -- struggling on the ground
		{ At = 9.4, Actor = "Player", Id = "" }, -- kick off and get up
		{ At = 12, Actor = "Raider1", Id = "" }, -- clothesline hit
		{ At = 15, Actor = "Raider2", Id = "" }, -- punch while on top
	},
	Qtes = {
		{
			At = 3,
			Id = "Dodge",
			Player = "Player",
			Qte = { Type = "Press", Action = "Dodge", Window = 1, Label = "Dodge!" },
			SlowMo = 0.35,
			OnFail = { Goto = "Caught" },
		},
		{
			At = 6.2,
			Id = "Struggle",
			Player = "Player",
			Qte = { Type = "Mash", Action = "Struggle", Window = 3, Count = 12, Decay = 0.5, Label = "Struggle!" },
			OnFail = { Goto = "Pinned" },
		},
	},
	Shakes = {
		{ At = 6, Trauma = 0.8 },
		{ At = 9.45, Trauma = 0.4 },
		{ At = 12.3, Trauma = 0.7 },
		{ At = 15.6, Trauma = 0.6 },
	},
	Freezes = { { At = 12.3, Hold = 0.08 } },
	Subtitles = {
		{ At = 0.6, Duration = 1.8, Speaker = "Player", Text = "Too quiet out here." },
		{ At = 9.8, Duration = 1.6, Speaker = "Player", Text = "Stay down." },
	},
	Events = {
		{ At = 11.4, Name = "AmbushOver", Server = true, Essential = true },
		{ At = 11.5, Name = "End" },
		{ At = 12.3, Name = "Hit", Target = "Player", Damage = 20 },
		{ At = 13.8, Name = "Goto", Label = "Retry" },
		{ At = 15.6, Name = "Hit", Target = "Player", Damage = 15 },
		{ At = 16.6, Name = "Goto", Label = "StruggleRetry" },
	},
	Length = 16.8,
}
