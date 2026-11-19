-- RE4-style roundhouse kick: shoot an enemy in the head (or stagger it) and a prompt appears;
-- the kick knocks it down and sends everyone close by flying. Not lethal on its own.
--
-- One continuous over-the-shoulder shot, a short hit freeze and shake on contact: a gameplay
-- finisher should feel like a bigger attack, not a cutscene. Animation ids are empty until you
-- author them (roblox-animation skill): both clips start from these marks, attacker 3 studs in
-- front of the victim, and the Moves below stand in for root motion until then.

return {
	Name = "Kick",
	Kind = "Finisher",
	Letterbox = false,
	BlendIn = 0.2,
	BlendOut = 0.45,
	Line = { "Attacker", "Victim" },
	Finisher = {
		Prompt = "Kick",
		Input = "Press",
		Priority = 1,
		Requires = {
			Posture = { "Stagger" },
			Side = { "Front", "Left", "Right" },
			Range = 7,
		},
		Lethal = false,
		Clearance = 2.5,
	},
	Marks = {
		Victim = { Position = Vector3.new(0, 0, 0), Yaw = 0 },
		Attacker = { Position = Vector3.new(0, 0, -3), Yaw = 180 },
		Landed = { Position = Vector3.new(0, 0, 4.8), Pitch = 80, Lift = 0.4 },
	},
	Actors = {
		Attacker = { Mark = "Attacker" },
		Victim = { Mark = "Victim" },
	},
	Shots = {
		{
			At = 0,
			Name = "Over the shoulder, drifting round",
			Type = "OverShoulder",
			Over = "Attacker",
			Subject = "Victim",
			Side = "Right",
			Size = "MS",
			Lens = 28,
			Back = 5,
			Shoulder = 2.2,
			Move = "ArcLeft",
			Amount = 12,
			Style = "Handheld",
			StyleAmount = 0.6,
		},
	},
	Animations = {
		{ At = 0, Actor = "Attacker", Id = "" }, -- roundhouse kick, contact at 0.55 s
		{ At = 0, Actor = "Victim", Id = "" }, -- hit in the chest, thrown back (holds the last frame)
	},
	Sounds = {
		{ At = 0.15, Id = "", Actor = "Attacker", Volume = 0.6 }, -- whoosh
		{ At = 0.55, Id = "", Actor = "Victim", Volume = 1 }, -- heavy thud
	},
	Moves = {
		{ At = 0.58, Actor = "Victim", To = "Landed", Duration = 0.5, Ease = "Out" },
	},
	Freezes = { { At = 0.55, Hold = 0.07 } },
	Shakes = { { At = 0.55, Trauma = 0.6 } },
	Events = {
		-- Server: damage the target and knock back anyone within the splash radius (RE4's crowd kick).
		{ At = 0.55, Name = "Hit", Target = "Victim", Damage = 40, Splash = { Radius = 7, Damage = 10, Knockback = 55 } },
		{ At = 0.6, Name = "Ragdoll", Target = "Victim" },
	},
	Length = 1.4,
}
