--!strict
-- Anti-cheat settings. Lives on the server (ServerScriptService.Server.Security) so exploiters
-- can't read the thresholds.

return table.freeze({
	-- "observe": log every flag and what WOULD have happened, take no action except rubber-banding.
	-- "enforce": kick and ban per the thresholds below.
	-- Launch in "observe", fix false positives from the logs, then switch.
	Mode = "observe" :: "observe" | "enforce",

	-- Developers, testers and moderators: flagged in logs but never kicked or banned.
	ExemptUserIds = table.freeze({
		-- 123456789,
	}) :: { number },

	-- Suspicion score: each flag adds its weight; the score halves every HalfLifeSeconds.
	Score = table.freeze({
		HalfLifeSeconds = 60,
		KickAt = 12, -- continuous cheating crosses this in seconds; rare lag spikes never do
	}),

	Ban = table.freeze({
		-- Seconds per offence (escalates with ban history). -1 = permanent.
		DurationsSeconds = table.freeze({ 24 * 3600, 7 * 24 * 3600, -1 }),
		DisplayReason = "You were banned for exploiting.",
		ApplyToUniverse = true,
		ExcludeAltAccounts = false, -- false = let Roblox's alt detection extend the ban
	}),

	Movement = table.freeze({
		Enabled = true,
		CheckInterval = 0.5, -- seconds between checks per player
		RespawnGraceSeconds = 3,

		-- Speed: allowed horizontal studs/s = WalkSpeed * SpeedTolerance + SpeedAllowance
		SpeedTolerance = 1.4,
		SpeedAllowance = 6,
		TeleportDistance = 60, -- horizontal studs in a single check = teleport

		-- Fly: airborne (no ground under the server raycast) this long without descending
		MaxHoverSeconds = 3,
		RiseAllowance = 4, -- studs above the expected jump height before "high jump"
		GroundProbeDepth = 8, -- studs below the feet that count as "on the ground"

		Noclip = true,

		Weights = table.freeze({
			Speed = 2,
			Teleport = 6,
			Fly = 3,
			HighJump = 2,
			Noclip = 4,
		}),
	}),

	-- RemoteEvents no real code ever fires. Firing one is treated as certain evidence.
	-- Make sure no real remote uses these names. Created next to the real remotes.
	HoneypotRemotes = table.freeze({ "AdminGiveCurrency", "SetPlayerLevel", "GrantItemAdmin" }),
	HoneypotFolderName = "Remotes",
})
