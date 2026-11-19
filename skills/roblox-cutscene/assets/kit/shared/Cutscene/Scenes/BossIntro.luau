-- Boss reveal, written like a film scene. Use it as the pattern for story cutscenes.
--
--   1  0.0  Establishing crane down from the sky (18 mm, drone): where we are, who's where
--   2  4.5  Hero, medium, three-quarter front, slow push-in: who we're with (look room left)
--   3  7.5  Over the hero's left shoulder onto the boss (50 mm): what they're facing
--   4 10.5  Boss from a low angle, Dutch tilt, handheld; the roar shakes the camera: power
--   5 13.5  Hero close-up, dolly zoom (Vertigo): the moment of dread, shallow focus
--   6 16.0  Two-shot as the boss charges; slow motion at the peak: the clash is coming
--   7 18.4  Snap zoom into the boss, cut to black, fight starts
--
-- Every camera stays on the hero's left of the line between Hero and Boss, so the hero always
-- looks screen-left and the boss screen-right. The fight starts in an Essential server event,
-- so skipping the scene still starts the fight.
--
-- Bind it with CutsceneService:Play("BossIntro", { Origin = arenaCenter, Actors = { Hero =
-- character } }) or a CutsceneTrigger part; the Boss comes from ReplicatedStorage.CutsceneActors.Boss
-- if you don't bind one.

return {
	Name = "BossIntro",
	Letterbox = 2.39,
	FadeIn = 0.6,
	FadeOut = 0.6,
	BlendIn = 0,
	BlendOut = 0.8,
	Skippable = true,
	Line = { "Hero", "Boss" },
	Marks = {
		HeroStart = { Position = Vector3.new(0, 0, 10), Face = "BossStart" },
		BossStart = { Position = Vector3.new(0, 0, -14), Face = "HeroStart" },
		BossCharge = { Position = Vector3.new(0, 0, -6) },
	},
	Actors = {
		Hero = { Mark = "HeroStart", Player = true },
		Boss = { Mark = "BossStart", Height = 11, Template = "Boss" },
	},
	Shots = {
		{
			At = 0,
			Name = "Establishing crane",
			Type = "Path",
			Points = { Vector3.new(-34, 28, 36), Vector3.new(-22, 14, 28), Vector3.new(-12, 6, 22) },
			LookAt = Vector3.new(0, 4, -4),
			Lens = 18,
			Style = "Drone",
			Establishing = true,
		},
		{
			At = 4.5,
			Name = "Hero, medium three-quarter",
			Subject = "Hero",
			Size = "MS",
			Yaw = 35,
			Lens = 35,
			ScreenX = 1 / 3,
			Move = "PushIn",
			Amount = 0.15,
			Style = "Steadicam",
		},
		{
			At = 7.5,
			Name = "Over the hero's shoulder",
			Type = "OverShoulder",
			Over = "Hero",
			Subject = "Boss",
			Side = "Left",
			Size = "MS",
			Lens = 50,
			Style = "Steadicam",
		},
		{
			At = 10.5,
			Name = "Boss low angle, Dutch",
			Subject = "Boss",
			Size = "FS",
			Yaw = -45,
			Pitch = "Low",
			Lens = 24,
			Roll = 8,
			Style = "Handheld",
		},
		{
			At = 13.5,
			Name = "Hero close-up, dolly zoom",
			Subject = "Hero",
			Size = "CU",
			Yaw = 30,
			Lens = 35,
			Move = "DollyZoom",
			Amount = 0.45,
			Style = "Handheld",
			StyleAmount = 0.5,
			Aperture = 2,
		},
		{
			At = 16,
			Name = "Two-shot, the charge",
			Type = "TwoShot",
			Subjects = { "Hero", "Boss" },
			Side = "Left",
			Size = "FS",
			Lens = 28,
			Pitch = 8,
			Style = "Handheld",
		},
		{
			At = 18.4,
			Name = "Snap zoom on the boss",
			Subject = "Boss",
			Size = "MCU",
			Yaw = -20,
			Lens = 35,
			Move = "ZoomIn",
			Amount = 1.4,
			MoveTime = 0.25,
			Ease = "Snap",
			Style = "Handheld",
		},
	},
	Animations = {
		{ At = 0, Actor = "Hero", Id = "", Looped = true }, -- wary idle
		{ At = 0, Actor = "Boss", Id = "", Looped = true }, -- breathing idle
		{ At = 10.6, Actor = "Boss", Id = "" }, -- roar
		{ At = 15.8, Actor = "Hero", Id = "" }, -- draw weapon / brace
		{ At = 16.4, Actor = "Boss", Id = "", Looped = true }, -- charge run
	},
	Moves = {
		{ At = 16.4, Actor = "Boss", To = "BossCharge", Duration = 1.6, Ease = "In" },
	},
	Sounds = {
		{ At = 0, Id = "", Volume = 0.5, Duration = 4.5 }, -- wind bed (2D)
		{ At = 10.9, Id = "", Actor = "Boss", Volume = 1 }, -- roar
		{ At = 16.5, Id = "", Actor = "Boss", Volume = 0.8 }, -- footfalls
	},
	Subtitles = {
		{ At = 5, Duration = 3, Speaker = "Hero", Text = "So you're what's been eating the miners." },
		{ At = 8.2, Duration = 2, Speaker = "Hero", Text = "Bigger than they said." },
	},
	Shakes = {
		{ At = 11, Trauma = 0.7 },
		{ At = 17.2, Trauma = 0.35 },
	},
	SlowMo = { { At = 16.8, Duration = 0.6, Scale = 0.3 } },
	Events = {
		{ At = 3, Name = "BossMusic" }, -- client hook: start the boss cue (roblox-music)
		{ At = 19.9, Name = "StartBossFight", Server = true, Essential = true },
	},
	Length = 20,
}
