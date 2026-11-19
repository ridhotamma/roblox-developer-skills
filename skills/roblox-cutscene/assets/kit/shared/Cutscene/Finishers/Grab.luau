-- Enemy grab with a struggle (RE4's zombie grab, Call of Duty's dog and melee struggles): the
-- enemy seizes the player; MASH to fight it off, then a TIMING press to counter with a knife.
--   struggle succeeds -> Counter: timing press (slow motion)  -> Perfect/Good: knife kill
--                                                              -> miss: shove it away, no kill
--   struggle fails    -> Bite: the player takes damage and is released
-- Started by the server (FinisherService:Grab(enemy, player)), never by a prompt.
-- Each branch begins by putting both actors back on its marks, because a QTE jumps straight
-- into the branch's first frame.

return {
	Name = "Grab",
	Kind = "Finisher",
	Letterbox = false,
	BlendIn = 0.2,
	BlendOut = 0.5,
	Line = { "Player", "Enemy" },
	Finisher = {
		Grab = true,
		Attacker = "Enemy",
		Victim = "Player",
		Clearance = 2,
	},
	Labels = { Counter = 3.2, Shove = 6.2, Bite = 7.6 },
	Marks = {
		Player = { Position = Vector3.new(0, 0, 0), Yaw = 0 },
		Enemy = { Position = Vector3.new(0, 0, -1.6), Yaw = 180 },
		EnemyClose = { Position = Vector3.new(0, 0, -1.1) },
		EnemyDead = { Position = Vector3.new(0.3, 0, -2.6), Pitch = 88, Lift = 0.3 },
		EnemyShoved = { Position = Vector3.new(0, 0, -4.2), Pitch = 80, Lift = 0.3 },
		PlayerBack = { Position = Vector3.new(0, 0, 0.7) },
	},
	Actors = {
		Player = { Mark = "Player" },
		Enemy = { Mark = "Enemy" },
	},
	Shots = {
		{
			At = 0,
			Name = "Struggle: tight over the shoulder",
			Type = "OverShoulder",
			Over = "Player",
			Subject = "Enemy",
			Side = "Right",
			Size = "CU",
			Lens = 35,
			Style = "Combat",
			StyleAmount = 0.6,
		},
		{
			At = 3.2,
			Name = "Counter: the knife comes up",
			Subject = "Enemy",
			Size = "CU",
			Yaw = 70,
			Lens = 50,
			Style = "Handheld",
		},
		{
			At = 4.6,
			Name = "Kill: wide as it drops",
			Type = "TwoShot",
			Subjects = { "Player", "Enemy" },
			Side = "Right",
			Size = "FS",
			Lens = 28,
			Style = "Documentary",
		},
		{
			At = 6.2,
			Name = "Shove: profile",
			Type = "TwoShot",
			Subjects = { "Player", "Enemy" },
			Side = "Right",
			Size = "MLS",
			Lens = 35,
			Yaw = -20,
			Style = "Documentary",
		},
		{
			At = 7.6,
			Name = "Bite: on the player",
			Subject = "Player",
			Size = "MCU",
			Yaw = -60,
			Lens = 35,
			Style = "Combat",
		},
	},
	Animations = {
		{ At = 0, Actor = "Enemy", Id = "" }, -- grab and struggle loop
		{ At = 0, Actor = "Player", Id = "" }, -- grabbed, pushing back
		{ At = 3.2, Actor = "Player", Id = "" }, -- knife counter
		{ At = 3.2, Actor = "Enemy", Id = "" }, -- countered
		{ At = 6.2, Actor = "Player", Id = "" }, -- shove
		{ At = 7.6, Actor = "Enemy", Id = "" }, -- bite
		{ At = 7.6, Actor = "Player", Id = "" }, -- bitten
	},
	Moves = {
		{ At = 0.3, Actor = "Enemy", To = "EnemyClose", Duration = 0.4, Ease = "Out" },
		-- Counter branch: back on marks, then the kill
		{ At = 3.2, Actor = "Enemy", To = "EnemyClose", Duration = 0 },
		{ At = 4.8, Actor = "Enemy", To = "EnemyDead", Duration = 0.6, Ease = "In" },
		-- Shove branch
		{ At = 6.2, Actor = "Enemy", To = "EnemyClose", Duration = 0 },
		{ At = 6.5, Actor = "Enemy", To = "EnemyShoved", Duration = 0.5, Ease = "Out" },
		-- Bite branch
		{ At = 7.6, Actor = "Enemy", To = "EnemyClose", Duration = 0 },
		{ At = 8.3, Actor = "Player", To = "PlayerBack", Duration = 0.4, Ease = "Out" },
	},
	Qtes = {
		{
			At = 0.5,
			Id = "Struggle",
			Player = "Player",
			Qte = { Type = "Mash", Action = "Struggle", Window = 2.6, Count = 10, Decay = 0.6, Label = "Struggle!" },
			OnSuccess = { Goto = "Counter" },
			OnFail = { Goto = "Bite" },
		},
		{
			At = 3.4,
			Id = "Counter",
			Player = "Player",
			Qte = { Type = "Timing", Action = "Attack", Window = 1.1, Target = 0.7, Label = "Counter!" },
			SlowMo = 0.4,
			OnFail = { Goto = "Shove" },
		},
	},
	Freezes = { { At = 4.8, Hold = 0.08 } },
	Shakes = {
		{ At = 0.3, Trauma = 0.5 },
		{ At = 4.8, Trauma = 0.7 },
		{ At = 6.5, Trauma = 0.4 },
		{ At = 8, Trauma = 0.8 },
	},
	Events = {
		{ At = 4.8, Name = "Kill", Target = "Enemy" },
		{ At = 4.85, Name = "Ragdoll", Target = "Enemy" },
		{ At = 5.9, Name = "End" },
		{ At = 6.6, Name = "Hit", Target = "Enemy", Damage = 10 },
		{ At = 6.6, Name = "Ragdoll", Target = "Enemy" },
		{ At = 7.4, Name = "End" },
		{ At = 8, Name = "Hit", Target = "Player", Damage = 30 },
		{ At = 8.9, Name = "End" },
	},
	Length = 9,
}
