-- RE4-style suplex: shoot an enemy in the leg so it drops to a knee, get behind it, and throw
-- it over your head. Lethal on regular enemies, never on bosses.
--
-- The one finisher that cuts like a film: a low wide two-shot as you grab them, a worm's-eye
-- wide for the lift (slow motion at the top of the arc), and a hard cut on the impact with a
-- freeze, a big shake and a handheld high angle on the body. All cameras stay on the attacker's
-- left of the line so the throw reads left-to-right throughout.

return {
	Name = "Suplex",
	Kind = "Finisher",
	Letterbox = false,
	BlendIn = 0.25,
	BlendOut = 0.6,
	Line = { "Attacker", "Victim" },
	Finisher = {
		Prompt = "Suplex",
		Input = "Press",
		Priority = 2,
		Requires = {
			Posture = { "Kneel" },
			Side = { "Back" },
			Range = 6,
			NotKinds = { "Boss" },
		},
		Lethal = true,
		Clearance = 4,
	},
	Marks = {
		Victim = { Position = Vector3.new(0, 0, 0), Yaw = 0 },
		Attacker = { Position = Vector3.new(0, 0, 2.2), Yaw = 0 },
		Lifted = { Position = Vector3.new(0, 2.6, 2.4), Pitch = 70 },
		Slam = { Position = Vector3.new(0, 0, 5.2), Pitch = 170, Lift = 5 }, -- upside down: marks pivot at the feet, so lift the body until the head meets the floor
		Landed = { Position = Vector3.new(0, 0, 5), Pitch = 95, Lift = 0.3 },
		Bridge = { Position = Vector3.new(0, 0, 2.8), Pitch = 65 },
		AttackerUp = { Position = Vector3.new(0, 0, 2.6) },
	},
	Actors = {
		Attacker = { Mark = "Attacker" },
		Victim = { Mark = "Victim" },
	},
	Shots = {
		{
			At = 0,
			Name = "Low two-shot: the grab",
			Type = "TwoShot",
			Subjects = { "Attacker", "Victim" },
			Side = "Left",
			Size = "FS",
			Lens = 28,
			Pitch = -8,
			Move = "PushIn",
			Amount = 0.15,
			Style = "Steadicam",
		},
		{
			At = 0.95,
			Name = "Worm's-eye wide: the lift",
			Subject = "Attacker",
			Size = "WS",
			Yaw = 80,
			Pitch = "Ground",
			Lens = 18,
			Move = "CraneDown",
			Amount = 0.6,
			Style = "Handheld",
		},
		{
			At = 1.75,
			Name = "Impact: high angle on the body",
			Subject = "Victim",
			Size = "MS",
			Yaw = -60, -- the victim is upside down here, so this is still the attacker's left
			Pitch = "High",
			Lens = 35,
			Lock = "Fixed",
			Style = "Documentary",
		},
	},
	Animations = {
		{ At = 0, Actor = "Attacker", Id = "" }, -- grab, lift, bridge, stand
		{ At = 0, Actor = "Victim", Id = "" }, -- grabbed, thrown, lands on head and shoulders
	},
	Sounds = {
		{ At = 0.9, Id = "", Actor = "Attacker", Volume = 0.7 }, -- effort grunt
		{ At = 1.75, Id = "", Actor = "Victim", Volume = 1 }, -- crunch on the floor
	},
	Moves = {
		{ At = 0.9, Actor = "Victim", To = "Lifted", Duration = 0.4, Ease = "Out" },
		{ At = 1.3, Actor = "Victim", To = "Slam", Duration = 0.45, Ease = "In" },
		{ At = 1.75, Actor = "Victim", To = "Landed", Duration = 0.3, Ease = "Out" },
		{ At = 1.15, Actor = "Attacker", To = "Bridge", Duration = 0.6, Ease = "InOut" },
		{ At = 2.05, Actor = "Attacker", To = "AttackerUp", Duration = 0.55, Ease = "InOut" },
	},
	SlowMo = { { At = 1.2, Duration = 0.25, Scale = 0.35 } },
	Freezes = { { At = 1.75, Hold = 0.1 } },
	Shakes = { { At = 1.75, Trauma = 0.95 } },
	Events = {
		{ At = 1.75, Name = "Kill", Target = "Victim" },
		{ At = 1.8, Name = "Ragdoll", Target = "Victim" },
	},
	Length = 2.6,
}
