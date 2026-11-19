--!strict
-- All cutscene, finisher and QTE tuning in one place. Data only.
--
-- Remotes to declare in src/shared/Net/init.luau REMOTES:
--   CutscenePlay = "Event",    -- server -> client  (payload: see CutsceneService) start a scene, with or without the camera
--   CutsceneSeek = "Event",    -- server -> client  (id: string, sceneTime: number, serverTime: number, resolvedQte: string?) re-sync after a branch
--   CutsceneEnd = "Event",     -- server -> client  (id: string, skipped: boolean, keep: { [string]: boolean }) finish and restore
--   CutsceneSkip = "Event",    -- client -> server  (id: string) vote to skip
--   CutsceneVotes = "Event",   -- server -> client  (id: string, votes: number, needed: number)
--   FinisherRequest = "Event", -- client -> server  (victim: Model) ask to perform a finisher on it
--   QteStart = "Event",        -- server -> client  (id: string, spec: table, startAt: number, anchor: Instance?) show a prompt
--   QteInput = "Event",        -- client -> server  (id: string, action: string, down: boolean, time: number)
--   QteResult = "Event",       -- server -> client  (id: string, status: string, grade: string?)
--   QteAssist = "Event",       -- client -> server  (mode: string) the player's QTE accessibility setting
--
-- Replicated state (attributes, no remotes):
--   On characters / NPC models:  InCutscene (string id while acting in a scene or finisher),
--                                Posture ("Stagger" | "Kneel" | "Down" while open to a finisher),
--                                FinisherKilled (true on a victim a finisher killed)
--   On Players:                  QteAssist ("Off" | "Easy" | "Hold" | "Auto")
-- Local only (set by the client on its own Player): InCutscene (true while the camera is taken).

local CutsceneConfig = {
	-- Folders under ReplicatedStorage.Shared.Cutscene holding scene and finisher ModuleScripts.
	ScenesFolder = "Scenes",
	FinishersFolder = "Finishers",
	-- Models cloned for actors a scene needs but the server didn't bind (ReplicatedStorage path).
	ActorTemplates = "CutsceneActors",

	Lead = 0.35, -- seconds between the server starting a scene and frame 0 (clients load in this time)
	EndTimeout = 2, -- a client waits this long past its own end for the server's CutsceneEnd
	CorpseSeconds = 12, -- a killed victim's stand-in stays this long if the real body lingers
	ObserverRange = 250, -- clients further than this from a finisher ignore it
	DefaultActorHeight = 5.2, -- studs; measured from the real model in game

	Camera = {
		RenderPriority = Enum.RenderPriority.Camera.Value + 5, -- after Roblox's camera and the combat kit's
		BlendIn = 0.6, -- seconds from the gameplay camera into the first shot (scene can override)
		BlendOut = 0.8, -- seconds from the last shot back to the gameplay camera
		ShakeDecay = 1.6, -- trauma per second
		ShakeAngles = Vector3.new(2.5, 2.5, 3.5), -- degrees (pitch, yaw, roll) at trauma 1
		ShakeFrequency = 14, -- Hz
		DofFarIntensity = 0.45,
		DofNearIntensity = 0.6,
	},

	Overlay = {
		DisplayOrder = 60,
		LetterboxTime = 0.45,
		FadeBackTime = 0.4, -- fade from the scene's last black frame back into gameplay
		SubtitleTextSize = 22,
		SubtitleSpeakerColors = {
			Default = Color3.fromRGB(255, 214, 92),
		} :: { [string]: Color3 },
	},

	Skip = {
		Rule = "All", -- shared scenes: "All" | "Majority" | "Any" of the watchers must vote
		HoldTime = 0.8, -- hold the key this long to skip (never skip by accident)
		Keys = { Enum.KeyCode.Space, Enum.KeyCode.Return, Enum.KeyCode.ButtonB },
	},

	Triggers = {
		Tag = "CutsceneTrigger", -- a part with attributes Scene, Once ("Server" | "Player"), Shared (bool), PlayerActor
		SharedRadius = 60, -- players this close join a Shared trigger's scene
	},

	-- Logical actions -> keys. QTE specs and finisher prompts name actions, never keys, so
	-- players can rebind and every device gets a sensible button.
	Actions = {
		Action = { Key = Enum.KeyCode.F, Pad = Enum.KeyCode.ButtonX, Label = "Act" },
		Dodge = { Key = Enum.KeyCode.Space, Pad = Enum.KeyCode.ButtonA, Label = "Dodge" },
		Struggle = { Key = Enum.KeyCode.F, Pad = Enum.KeyCode.ButtonX, Label = "Struggle" },
		Attack = { Key = Enum.KeyCode.E, Pad = Enum.KeyCode.ButtonY, Label = "Attack" },
		Left = { Key = Enum.KeyCode.A, Pad = Enum.KeyCode.ButtonL1, Label = "Left" },
		Right = { Key = Enum.KeyCode.D, Pad = Enum.KeyCode.ButtonR1, Label = "Right" },
		Up = { Key = Enum.KeyCode.W, Pad = Enum.KeyCode.DPadUp, Label = "Up" },
		Down = { Key = Enum.KeyCode.S, Pad = Enum.KeyCode.DPadDown, Label = "Down" },
	} :: { [string]: { Key: Enum.KeyCode, Pad: Enum.KeyCode, Label: string } },

	Qte = {
		DefaultAssist = "Off",
		Lead = 0.25, -- the server sends a scene QTE this early so the prompt is up on time
		BaseLatency = 0.08, -- always allowed between a press and its arrival (seconds)
		MaxLatency = 0.35, -- never trust a press older than this on arrival
		Grace = 0.12, -- the server waits this long past a window for late packets
		ResultHold = 0.6, -- seconds the prompt shows Success / Fail
	},

	Finisher = {
		Tags = { "Enemy", "Finishable" }, -- models with these tags can be finished
		PromptRange = 10, -- studs: show the prompt within this range (moves have their own Range)
		ScanInterval = 0.1,
		Key = Enum.KeyCode.F,
		Pad = Enum.KeyCode.ButtonY,
		Cooldown = 0.8, -- per attacker, seconds after a finisher ends
		RangeSlack = 2.5, -- studs the server allows past a move's Range (latency)
		SideTolerance = 20, -- degrees the server allows across a side boundary (latency)
		AttackerInvulnerable = true, -- an invisible ForceField while finishing
		VictimInvulnerable = true, -- nobody else steals the kill mid-animation

		-- Postures (RE4-style openings). The server sets the Posture attribute; moves require it.
		HeadshotStagger = true, -- a head hit staggers ("Stagger")
		LegHitKneel = true, -- a leg hit drops them to a knee ("Kneel")
		LowHealth = 0.2, -- at or under this health fraction they stagger (Doom-style glory window)
		StaggerSeconds = 2.5,
		KneelSeconds = 2.5,
		LowHealthSeconds = 3,
		PostureAnimations = { Stagger = "", Kneel = "" } :: { [string]: string }, -- ids played on NPCs while open
		LegParts = { "LeftUpperLeg", "LeftLowerLeg", "LeftFoot", "RightUpperLeg", "RightLowerLeg", "RightFoot", "Left Leg", "Right Leg" },
		HeadParts = { "Head" },
		-- An enemy counts as unaware (for stealth moves) when its State attribute is one of these.
		UnawareStates = { "Idle", "Patrol" },
	},
}

return CutsceneConfig
