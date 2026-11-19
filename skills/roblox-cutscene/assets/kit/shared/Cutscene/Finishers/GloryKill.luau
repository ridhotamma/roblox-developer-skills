-- Doom-style glory kill: an enemy at low health staggers and glows; finish it from the front
-- for a fast, brutal kill that drops health for the attacker. Short (about a second) so it
-- keeps the fight's rhythm: first-person punch, cut on the impact to a low angle as they fall.

return {
	Name = "GloryKill",
	Kind = "Finisher",
	Letterbox = false,
	BlendIn = 0.15,
	BlendOut = 0.35,
	Line = { "Attacker", "Victim" },
	Finisher = {
		Prompt = "Glory Kill",
		Input = "Press",
		Priority = 2,
		Requires = {
			Posture = { "Stagger" },
			Side = { "Front" },
			MaxHealth = 0.2,
			Range = 6,
		},
		Lethal = true,
		Clearance = 2,
	},
	Marks = {
		Victim = { Position = Vector3.new(0, 0, 0), Yaw = 0 },
		Attacker = { Position = Vector3.new(0, 0, -2.4), Yaw = 180 },
		Fallen = { Position = Vector3.new(0, 0, 0.6), Pitch = 85, Lift = 0.3 },
	},
	Actors = {
		Attacker = { Mark = "Attacker" },
		Victim = { Mark = "Victim" },
	},
	Shots = {
		{
			At = 0,
			Name = "First person: the punch",
			Type = "POV",
			Actor = "Attacker",
			Subject = "Victim",
			Size = "MCU",
			Lens = 24,
			Move = "PushIn",
			Amount = 0.25,
			Style = "Handheld",
		},
		{
			At = 0.55,
			Name = "Low angle: down they go",
			Subject = "Victim",
			Size = "FS",
			Yaw = 50,
			Pitch = "Low",
			Lens = 24,
			Lock = "Fixed",
			Style = "Documentary",
		},
	},
	Animations = {
		{ At = 0, Actor = "Attacker", Id = "" },
		{ At = 0, Actor = "Victim", Id = "" },
	},
	Sounds = {
		{ At = 0.55, Id = "", Actor = "Victim", Volume = 1 },
	},
	Moves = {
		{ At = 0.6, Actor = "Victim", To = "Fallen", Duration = 0.4, Ease = "In" },
	},
	Freezes = { { At = 0.55, Hold = 0.08 } },
	Shakes = { { At = 0.55, Trauma = 0.8 } },
	Events = {
		{ At = 0.55, Name = "Kill", Target = "Victim" },
		{ At = 0.6, Name = "Ragdoll", Target = "Victim" },
		{ At = 0.6, Name = "Heal", Target = "Attacker", Amount = 15 }, -- the reward that makes players seek them out
	},
	Length = 1.2,
}
