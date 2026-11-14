--!strict
-- All combat tuning in one place. Data only.
--
-- Remotes to declare in src/shared/Net/init.luau REMOTES:
--   Swing = "Event",          -- client -> server  ()                         melee attack at the contact frame
--   Fire = "Event",           -- client -> server  (origin: Vector3, direction: Vector3)
--   Reload = "Event",         -- client -> server  ()
--   CombatHit = "Event",      -- server -> client  (info: table)              a confirmed hit, for feedback
--   Knockback = "Event",      -- server -> client  (velocity: Vector3, seconds: number)  push your own character
--   Ammo = "Event",           -- server -> client  (weapon: string, magazine: number, reserve: number)
--   ShotFired = "Unreliable", -- server -> client  (shooter: Player, weapon: string, origin: Vector3, target: Vector3)

export type HitWeight = {
	Damage: number, -- default damage (melee); weapons and enemies can override
	Hitstop: number, -- seconds both fighters freeze on contact
	Flash: number, -- seconds the victim flashes
	Shake: number, -- camera trauma added (0-1) for the attacker; victim gets 1.5x
	FovPunch: number, -- degrees the FOV narrows for a moment (local attacker/victim)
	Knockback: number, -- horizontal studs/s
	KnockUp: number, -- vertical studs/s
	KnockTime: number, -- seconds the push lasts
	SlowMo: number, -- seconds of cosmetic slow motion (0 = none)
	Poise: number, -- poise damage dealt to enemies
	SoundPitch: number, -- impact sound playback speed
	NumberScale: number, -- damage number size
}

local function weight(t: HitWeight): HitWeight
	return table.freeze(t)
end

local HitWeights: { [string]: HitWeight } = table.freeze({
	-- Tune by feel in assets/feel-lab.html, then paste its "Copy Luau" output here.
	Light = weight({
		Damage = 8,
		Hitstop = 0.05,
		Flash = 0.08,
		Shake = 0.25,
		FovPunch = 0,
		Knockback = 18,
		KnockUp = 4,
		KnockTime = 0.12,
		SlowMo = 0,
		Poise = 1,
		SoundPitch = 1.15,
		NumberScale = 1,
	}),
	Medium = weight({
		Damage = 14,
		Hitstop = 0.08,
		Flash = 0.1,
		Shake = 0.4,
		FovPunch = 2,
		Knockback = 30,
		KnockUp = 8,
		KnockTime = 0.15,
		SlowMo = 0,
		Poise = 2,
		SoundPitch = 1,
		NumberScale = 1.15,
	}),
	Heavy = weight({
		Damage = 22,
		Hitstop = 0.12,
		Flash = 0.12,
		Shake = 0.65,
		FovPunch = 4,
		Knockback = 55,
		KnockUp = 18,
		KnockTime = 0.2,
		SlowMo = 0,
		Poise = 3,
		SoundPitch = 0.9,
		NumberScale = 1.3,
	}),
	Finisher = weight({
		Damage = 30,
		Hitstop = 0.16,
		Flash = 0.15,
		Shake = 0.9,
		FovPunch = 6,
		Knockback = 80,
		KnockUp = 30,
		KnockTime = 0.25,
		SlowMo = 0.3,
		Poise = 5,
		SoundPitch = 0.8,
		NumberScale = 1.5,
	}),
	-- Bullets: no freeze, a quick flash, almost no push.
	Gun = weight({
		Damage = 20,
		Hitstop = 0,
		Flash = 0.06,
		Shake = 0.05,
		FovPunch = 0,
		Knockback = 0,
		KnockUp = 0,
		KnockTime = 0,
		SlowMo = 0,
		Poise = 1,
		SoundPitch = 1.1,
		NumberScale = 0.9,
	}),
	GunHeavy = weight({
		Damage = 60,
		Hitstop = 0.03,
		Flash = 0.1,
		Shake = 0.2,
		FovPunch = 1,
		Knockback = 25,
		KnockUp = 6,
		KnockTime = 0.12,
		SlowMo = 0,
		Poise = 3,
		SoundPitch = 0.9,
		NumberScale = 1.2,
	}),
})

return table.freeze({
	HitWeights = HitWeights,

	-- Players hitting players. Enemies always hit players; players always hit enemies.
	PvP = false,
	PlayerIFrames = 0.5, -- seconds of invulnerability after a player is hit
	EnemyTag = "Enemy",

	Melee = table.freeze({
		Combo = table.freeze({ "Light", "Light", "Medium", "Finisher" }),
		ComboResetSeconds = 0.9, -- next attack within this keeps the combo going
		Cooldown = 0.32, -- seconds between swings
		ActiveDelay = 0.12, -- input -> contact frame (replace with the animation's "Hit" marker)
		SlowMoLead = 0.08, -- finisher slow-mo starts this long before contact
		Hitbox = Vector3.new(6, 6, 7), -- width, height, reach (in front of the root)
		LatencyPadding = 2, -- extra studs on the server hitbox
		SwingAnimations = table.freeze({ "", "", "", "" }), -- rbxassetid per combo step (optional)
	}),

	Enemies = table.freeze({
		Grunt = table.freeze({
			Health = 60,
			WalkSpeed = 12,
			AggroRange = 60,
			LoseRange = 90,
			AttackRange = 6,
			Hitbox = Vector3.new(5, 5, 6),
			Telegraph = 0.45,
			Recover = 0.6,
			Cooldown = 1.2,
			Weight = "Light",
			Damage = 10,
			Poise = 1, -- poise damage needed to stagger
			Stagger = 0.5,
			RespawnSeconds = 10,
			TokenCost = 1,
		}),
		Brute = table.freeze({
			Health = 220,
			WalkSpeed = 9,
			AggroRange = 50,
			LoseRange = 80,
			AttackRange = 8,
			Hitbox = Vector3.new(9, 7, 9),
			Telegraph = 0.85,
			Recover = 1,
			Cooldown = 2.2,
			Weight = "Heavy",
			Damage = 25,
			Poise = 6,
			Stagger = 0.8,
			RespawnSeconds = 20,
			TokenCost = 2,
		}),
	}),
	EnemyTokensPerPlayer = 2, -- how many token points can attack one player at once
	EnemyHoverDistance = 11,
	EnemyTickRate = 20, -- brain updates per second

	Weapons = table.freeze({
		Pistol = table.freeze({
			Mode = "Semi", -- "Semi" | "Auto" | "Burst"
			Rpm = 400,
			Damage = 22,
			HeadshotMultiplier = 1.8,
			Pellets = 1,
			Magazine = 12,
			Reserve = 96,
			ReloadSeconds = 1.4,
			Range = 400,
			FalloffStart = 40,
			FalloffEnd = 120,
			FalloffMin = 0.6,
			SpreadHip = 2,
			SpreadAds = 0.5,
			BloomPerShot = 0.5,
			BloomMax = 4,
			BloomRecovery = 6, -- degrees per second
			RecoilUp = 1.2, -- degrees per shot
			RecoilSide = 0.3,
			RecoilRecovery = 10, -- spring stiffness
			Projectile = false,
			Weight = "Gun",
		}),
		Rifle = table.freeze({
			Mode = "Auto",
			Rpm = 600,
			Damage = 20,
			HeadshotMultiplier = 1.6,
			Pellets = 1,
			Magazine = 30,
			Reserve = 180,
			ReloadSeconds = 2,
			Range = 600,
			FalloffStart = 60,
			FalloffEnd = 180,
			FalloffMin = 0.65,
			SpreadHip = 2.5,
			SpreadAds = 0.4,
			BloomPerShot = 0.35,
			BloomMax = 5,
			BloomRecovery = 5,
			RecoilUp = 0.7,
			RecoilSide = 0.3,
			RecoilRecovery = 8,
			Projectile = false,
			Weight = "Gun",
		}),
		Shotgun = table.freeze({
			Mode = "Semi",
			Rpm = 70,
			Damage = 9, -- per pellet
			HeadshotMultiplier = 1.25,
			Pellets = 8,
			Magazine = 6,
			Reserve = 36,
			ReloadSeconds = 2.4,
			Range = 120,
			FalloffStart = 10,
			FalloffEnd = 35,
			FalloffMin = 0.2,
			SpreadHip = 6,
			SpreadAds = 5,
			BloomPerShot = 0,
			BloomMax = 0,
			BloomRecovery = 10,
			RecoilUp = 3,
			RecoilSide = 0.8,
			RecoilRecovery = 7,
			Projectile = false,
			Weight = "GunHeavy",
		}),
		Bow = table.freeze({
			Mode = "Semi",
			Rpm = 60,
			Damage = 45,
			HeadshotMultiplier = 2,
			Pellets = 1,
			Magazine = 1,
			Reserve = 40,
			ReloadSeconds = 0.6,
			Range = 500,
			FalloffStart = 1000,
			FalloffEnd = 1000,
			FalloffMin = 1,
			SpreadHip = 1,
			SpreadAds = 0.3,
			BloomPerShot = 0,
			BloomMax = 0,
			BloomRecovery = 10,
			RecoilUp = 1,
			RecoilSide = 0,
			RecoilRecovery = 9,
			Projectile = true,
			ProjectileSpeed = 180, -- studs/s
			ProjectileGravity = 60, -- studs/s^2 (Workspace gravity is 196.2; less = flatter arc)
			Weight = "GunHeavy",
		}),
	}),
	AdsFov = 55,
	OriginTolerance = 8, -- max studs between the fire origin and the character's head (server check)
	FireBuffer = 0.12, -- seconds: a semi-auto click this close before the gun is ready fires when it is
	FireJitterTolerance = 0.12, -- seconds of network bunching the server's fire-rate check forgives

	-- Shooter camera (CameraController + AimCamera). "Third" = over the shoulder, like Resident
	-- Evil 4, The Last of Us or GTA; "First" = from the head. Distances in studs, angles in degrees.
	Camera = table.freeze({
		Enabled = true, -- false = keep Roblox's default camera (the weapon kit still works)
		StartMode = "Third", -- "Third" | "First"
		AllowToggle = true, -- the view key switches modes
		Sensitivity = 0.22, -- degrees per mouse pixel
		TouchSensitivity = 0.3, -- degrees per dragged pixel
		GamepadSpeed = 260, -- degrees per second at full right-stick tilt
		GamepadDeadzone = 0.15,
		GamepadCurve = 2, -- stick response exponent (1 = linear; 2 = fine control near the centre)
		AimSensitivityScale = 0.6, -- look speed multiplier while aiming
		PitchMin = -80,
		PitchMax = 80,
		Third = table.freeze({ Distance = 8, Height = 1.6, Shoulder = 2.2, Fov = 70 }),
		ThirdAim = table.freeze({ Distance = 4, Height = 1.5, Shoulder = 1.9, Fov = 50 }),
		First = table.freeze({ Height = 1.5, Fov = 80, AimFov = 55 }),
		AimBlendSpeed = 14, -- per second: hip <-> aim transition (~0.2 s)
		ShoulderSwapSpeed = 10, -- per second
		CollisionRadius = 0.5, -- camera sphere; walls never come closer than this
		PushOutSpeed = 18, -- studs/s the camera eases back out after a wall stops blocking it
		FaceAimSeconds = 0.6, -- after a shot, the character keeps facing the crosshair this long
		TurnSpeed = 900, -- degrees per second the character turns to face the aim
		Keys = table.freeze({
			ToggleView = table.freeze({ "V", "DPadUp" }),
			SwapShoulder = table.freeze({ "Q", "ButtonR3" }),
		}),
	}),

	-- Audio asset ids ("rbxassetid://123"). Empty = silent. Find sounds in the Creator Store.
	Sounds = table.freeze({
		Swing = "",
		Hit = table.freeze({ Light = "", Medium = "", Heavy = "", Finisher = "", Gun = "", GunHeavy = "" }),
		HitMarker = "",
		Kill = "",
		Fire = table.freeze({ Pistol = "", Rifle = "", Shotgun = "", Bow = "" }),
		Empty = "",
		Reload = "",
	}),

	Feedback = table.freeze({
		MaxFlashes = 12, -- Highlight instances at once (Roblox renders at most 31)
		MaxDamageNumbers = 30,
		MaxBulletHoles = 60,
		DamageNumbers = true,
		IFrameBlinkInterval = 0.07,
		VictimShakeMultiplier = 1.5,
		BystanderShakeRange = 40, -- studs; heavy hits shake nearby cameras, scaled by distance
	}),
})
