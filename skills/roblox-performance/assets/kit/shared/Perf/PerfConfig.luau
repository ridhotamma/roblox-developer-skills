--!strict
-- Budgets and tuning for the performance kit. Every number here is a starting point taken from
-- common practice, not a Roblox limit: once the game is live, replace them with what the Creator
-- Hub performance dashboard says about your players' real devices.

export type DeviceClass = "Desktop" | "Tablet" | "Phone" | "Console"
export type Quality = "Low" | "Medium" | "High"

export type Budget = {
	TargetFps: number, -- what the game aims for on this device
	MinFps: number, -- median below this for a while = automatic quality step down
	MemoryWarnMb: number, -- client total memory: yellow on the HUD
	MemoryCriticalMb: number, -- red: crash rates on these devices climb past here
	ReceiveWarnKBps: number, -- steady download from the server
}

local PerfConfig = {
	Budgets = {
		Desktop = { TargetFps = 60, MinFps = 45, MemoryWarnMb = 1500, MemoryCriticalMb = 2500, ReceiveWarnKBps = 50 },
		Console = { TargetFps = 60, MinFps = 45, MemoryWarnMb = 1200, MemoryCriticalMb = 1800, ReceiveWarnKBps = 50 },
		Tablet = { TargetFps = 60, MinFps = 28, MemoryWarnMb = 1000, MemoryCriticalMb = 1500, ReceiveWarnKBps = 40 },
		Phone = { TargetFps = 60, MinFps = 28, MemoryWarnMb = 800, MemoryCriticalMb = 1200, ReceiveWarnKBps = 40 },
	} :: { [DeviceClass]: Budget },

	Quality = {
		-- Starting tier per device when the player's Roblox graphics setting is Automatic.
		-- A manual graphics level overrides it: 1-3 Low, 4-7 Medium, 8-10 High.
		Default = { Desktop = "High", Console = "High", Tablet = "Medium", Phone = "Medium" } :: { [DeviceClass]: Quality },
		-- Automatic adaptation (the player's own choice from your settings menu always wins).
		Adaptive = true,
		IgnoreFirstSeconds = 15, -- loading hitches after joining don't count
		StepDownSeconds = 8, -- median FPS below MinFps this long -> one tier down
		StepUpSeconds = 45, -- median FPS at 95% of TargetFps this long -> one tier up
		StepUpCooldownSeconds = 60, -- doubles each time a tier has to be dropped again
		-- What each tier means. Other systems read these through the LocalPlayer attributes
		-- PerfQuality, PerfLodScale and PerfParticleScale (set by PerfController).
		LodScale = { Low = 0.6, Medium = 0.8, High = 1 } :: { [Quality]: number },
		ParticleScale = { Low = 0.4, Medium = 0.7, High = 1 } :: { [Quality]: number },
	},

	Hud = {
		ToggleKey = Enum.KeyCode.F7 :: Enum.KeyCode?, -- nil to disable the key
		ChatCommand = "/perf" :: string?, -- nil to disable; works on phones and consoles too
		StudioAlways = true, -- anyone can open it in Studio play tests
		Everyone = false, -- true: any player can open it (shows only their own stats + server Hz)
		AllowedUserIds = {} :: { number },
		GroupId = 0, -- with MinRank: members at or above this rank can open it
		MinRank = 255,
		RefreshSeconds = 0.5,
		ProfilerRows = 5, -- top client Profiler labels shown (when the Profiler is accumulating)
	},

	Telemetry = {
		Enabled = true, -- clients send a small sample every IntervalSeconds (needs the PerfSample remote)
		IntervalSeconds = 120,
		FirstAfterSeconds = 60,
		-- Also log AnalyticsService custom events PerfFps / PerfMemoryMb, split by device and tier,
		-- so the numbers show up in Creator Hub analytics. Off until you want them there.
		AnalyticsEvents = false,
		LogSummaryMinutes = 10, -- server prints per-device averages to the server log
	},

	Server = {
		SampleSeconds = 2, -- heartbeat measured over this window
		HeartbeatWarnHz = 45,
		HeartbeatCriticalHz = 30,
		WarnAfterWindows = 3, -- consecutive slow windows before warning
		WarnCooldownSeconds = 300,
		PublishStats = true, -- ReplicatedStorage.PerfServerStats attributes for the dev HUD
		MemorySampleSeconds = 30,
		LeakWindowMinutes = 30,
		LeakWarnMbPerHour = 150, -- total memory slope with a steady player count
	},

	Lod = {
		Tag = "PerfLod", -- tag Models or parts; see LodController for attributes
		DefaultDistance = 160, -- studs; per instance with the LodDistance attribute
		Hysteresis = 12, -- studs either side of the distance, so things don't flicker on the edge
		DetailName = "Detail", -- child removed when far
		SimpleName = "Simple", -- child shown only when far (an impostor), optional
		BudgetMs = 0.4, -- per frame for the whole LOD system
		MinCheckSeconds = 0.15,
		MaxCheckSeconds = 1.5,
		AssumedCameraSpeed = 120, -- studs/s, decides how soon an object is checked again
	},

	Profiler = {
		-- Accumulate per-label milliseconds (Profiler.Report). debug.profilebegin labels for the
		-- MicroProfiler are always on. "Studio" = only in Studio; true = also in live servers
		-- (cheap, but leave off unless you are investigating).
		Accumulate = "Studio" :: boolean | "Studio",
	},
}

return table.freeze(PerfConfig)
