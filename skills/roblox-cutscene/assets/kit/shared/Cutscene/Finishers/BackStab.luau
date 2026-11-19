-- Call of Duty-style finishing move: walk up behind an enemy that hasn't seen you and HOLD the
-- melee key. The camera pulls out of the shoulder view to a third-person angle for the kill,
-- then hands back. Holding (not tapping) stops it firing when you only meant to hit them.

return {
	Name = "BackStab",
	Kind = "Finisher",
	Letterbox = false,
	BlendIn = 0.3,
	BlendOut = 0.5,
	Line = { "Attacker", "Victim" },
	Finisher = {
		Prompt = "Finish",
		Input = "Hold",
		HoldTime = 0.3,
		Priority = 3,
		Requires = {
			Side = { "Back" },
			Unaware = true,
			Range = 5,
		},
		Lethal = true,
		Clearance = 2,
	},
	Marks = {
		Victim = { Position = Vector3.new(0, 0, 0), Yaw = 0 },
		Attacker = { Position = Vector3.new(0, 0, 1.8), Yaw = 0 },
		Slumped = { Position = Vector3.new(0, 0, -0.4), Pitch = -88, Lift = 0.3 },
	},
	Actors = {
		Attacker = { Mark = "Attacker" },
		Victim = { Mark = "Victim" },
	},
	Shots = {
		{
			At = 0,
			Name = "Shoulder view pulls out",
			Type = "OverShoulder",
			Over = "Attacker",
			Subject = "Victim",
			Side = "Right",
			Size = "MCU",
			Lens = 35,
			Move = "PullOut",
			Amount = 0.5,
			Style = "Handheld",
			StyleAmount = 0.5,
		},
		{
			At = 1,
			Name = "Profile: the stab",
			Subject = "Attacker",
			Size = "MCU",
			Yaw = -100,
			Lens = 50,
			ScreenX = 0.2,
			Style = "Handheld",
			Aperture = 2.8,
			Focus = "Attacker",
		},
	},
	Animations = {
		{ At = 0, Actor = "Attacker", Id = "" }, -- grab the shoulder, stab at 1.1 s, step back
		{ At = 0, Actor = "Victim", Id = "" }, -- grabbed, stabbed, slumps forward
	},
	Sounds = {
		{ At = 0.2, Id = "", Actor = "Victim", Volume = 0.5 }, -- cloth grab
		{ At = 1.1, Id = "", Actor = "Victim", Volume = 0.9 }, -- stab
	},
	Moves = {
		{ At = 1.35, Actor = "Victim", To = "Slumped", Duration = 0.55, Ease = "In" },
	},
	Freezes = { { At = 1.1, Hold = 0.06 } },
	Shakes = { { At = 1.1, Trauma = 0.4 } },
	Events = {
		{ At = 1.1, Name = "Kill", Target = "Victim" },
		{ At = 1.4, Name = "Ragdoll", Target = "Victim" },
	},
	Length = 2.2,
}
