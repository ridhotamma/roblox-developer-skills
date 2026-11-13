--!strict
-- All ragdoll, hit-reaction, injury and impact tuning in one place. Data only.
--
-- Remotes to declare in src/shared/Net/init.luau REMOTES:
--   HitReact = "Unreliable",  -- server -> client  (character: Model, zone: string, localDirection: Vector3, strength: number)  play a flinch
--   RagdollImpulse = "Event", -- server -> client  (velocity: Vector3, part: BasePart?, partVelocity: Vector3?)  launch your own ragdoll
--
-- Replicated state (attributes on the character, no remotes needed):
--   RagdollState   "None" | "Ragdoll" | "Recovering"
--   InjuryHead, InjuryTorso, InjuryLeftArm, InjuryRightArm, InjuryLeftLeg, InjuryRightLeg   0..1

export type JointLimit = {
	Kind: "Ball" | "Hinge",
	Cone: number?, -- Ball: degrees the child may swing away from its rest direction
	Twist: number?, -- Ball: degrees of twist either way around the limb
	Lower: number?, -- Hinge: degrees (negative = the knee direction, lower leg swinging back)
	Upper: number?, -- Hinge: degrees (positive = the elbow direction, forearm swinging forward)
}

local function ball(cone: number, twist: number): JointLimit
	return table.freeze({ Kind = "Ball" :: "Ball", Cone = cone, Twist = twist })
end

local function hinge(lower: number, upper: number): JointLimit
	return table.freeze({ Kind = "Hinge" :: "Hinge", Lower = lower, Upper = upper })
end

local RagdollConfig = {
	-- Characters the kit has built get this tag (clients bind their visuals to it).
	Tag = "Ragdollable",
	-- NPC models carrying any of these tags are built automatically. Players always are.
	NpcTags = table.freeze({ "Enemy", "Ragdollable" }),
	StateAttribute = "RagdollState",

	-- Joint limits by Motor6D name with spaces removed, so "Left Shoulder" (R6) and
	-- "LeftShoulder" (R15) share an entry. Anything not listed uses Default.
	Joints = table.freeze({
		Neck = ball(35, 45),
		Waist = ball(25, 20),
		LeftShoulder = ball(110, 60),
		RightShoulder = ball(110, 60),
		LeftElbow = hinge(0, 140),
		RightElbow = hinge(0, 140),
		LeftWrist = ball(25, 10),
		RightWrist = ball(25, 10),
		LeftHip = ball(70, 20),
		RightHip = ball(70, 20),
		LeftKnee = hinge(-130, 0),
		RightKnee = hinge(-130, 0),
		LeftAnkle = ball(25, 10),
		RightAnkle = ball(25, 10),
		Default = ball(45, 30),
	}) :: { [string]: JointLimit },

	Rig = table.freeze({
		ColliderScale = 0.75, -- collider size relative to the limb (smaller = fewer self-jams)
		CollisionGroup = "Ragdoll", -- limb colliders; does not collide with itself
		FrictionTorque = 6, -- joint friction on ball sockets; higher = stiffer, less flailing
		Density = 0.9, -- collider friction/elasticity come from this physical profile
		Friction = 0.6,
		Elasticity = 0.05,
	}),

	Ragdoll = table.freeze({
		OnDeath = true, -- ragdoll instead of falling apart when a Humanoid dies
		MinSeconds = 1.2, -- never get up sooner than this
		MaxSeconds = 6, -- always get up by this (alive characters only)
		SettleSpeed = 3, -- studs/s: slower than this counts as lying still
		SettleSeconds = 0.4, -- lie still this long before getting up
		RecoverGap = 0.1, -- seconds between "Recovering" and the joints locking (clients capture the pose)
		BlendSeconds = 0.35, -- clients blend limbs from the ragdoll pose back to the animation
		SnapUpright = false, -- true: place the root upright on the ground before getting up (fixes stuck get-ups, pops visibly)
		MaxLaunch = 160, -- studs/s cap on any launch velocity
		Tumble = 4, -- rad/s of spin added per 100 studs/s of launch
		DeathPush = 14, -- studs/s along the killing blow
		DeathPartPush = 30, -- extra studs/s on the body part that was hit
		MaxActive = 24, -- more than this many live ragdolls at once: the oldest gets up (or is skipped if dead)
	}),

	-- Optional get-up animation ids ("rbxassetid://..."). Empty = the Humanoid just stands up.
	GetUpAnimations = table.freeze({
		FaceUp = "",
		FaceDown = "",
	}),

	-- Fast heavy things that knock characters over: cars, boulders, swinging hammers.
	Impact = table.freeze({
		Enabled = true,
		Tags = table.freeze({ "Vehicle", "Impactor" }), -- Models (PrimaryPart) or BaseParts
		Rate = 15, -- checks per second
		MinSpeed = 22, -- studs/s closing speed that knocks a character down (about 22 km/h)
		Padding = 1, -- studs added around the impactor's bounding box
		Transfer = 0.85, -- share of the impactor's velocity the character takes
		Lift = 0.3, -- upward launch as a share of closing speed (over the bonnet)
		Seconds = 2.5, -- minimum time on the ground
		Cooldown = 1, -- seconds before the same character can be hit again
		DamagePerSpeed = 0.7, -- damage per stud/s above MinSpeed (0 = no damage)
		MaxDamage = 100,
	}),

	-- Hard landings.
	Fall = table.freeze({
		Enabled = true,
		Speed = 85, -- studs/s downward just before landing (a drop of roughly 18 studs)
		Seconds = 1.5,
		DamagePerSpeed = 0, -- damage per stud/s above Speed
	}),

	-- Flinches: short springy joint kicks layered over whatever animation is playing.
	Reactions = table.freeze({
		Frequency = 3, -- Hz of the return spring (higher = snappier)
		Damping = 0.5, -- 1 = no overshoot, lower = more wobble
		Strength = 1, -- global multiplier on every flinch angle
		FullDamage = 30, -- damage that produces a full-strength flinch
		MinStrength = 0.3,
		MaxDistance = 150, -- studs: clients skip procedural poses beyond this, and the server doesn't send flinches
	}),

	-- Lasting injuries per body zone (0..1). Drive the limp, the held arm and the hunch.
	Injury = table.freeze({
		Enabled = true,
		PerDamage = 0.025, -- injury added per point of damage to that zone (40 damage = fully injured)
		HealDelay = 5, -- seconds after the last hit before healing starts
		HealPerSecond = 0.04,
		LegSpeedPenalty = 0.45, -- WalkSpeed lost with one fully injured leg (both legs: capped at 0.6)
		DangleArmAt = 0.85, -- arm injury at which the arm goes physically limp (0 = never)
		Step = 0.05, -- attribute resolution (fewer replicated changes)
	}),

	-- Used when the roblox-combat kit is installed (CombatService.Damaged).
	Combat = table.freeze({
		-- Seconds on the ground when hit by this weight. Missing or 0 = flinch only.
		KnockdownWeights = table.freeze({ Finisher = 1.4 }) :: { [string]: number },
	}),
}

return table.freeze(RagdollConfig)
