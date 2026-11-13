--!strict
-- Server health and client performance telemetry.
--
-- * Heartbeat: frames per second over PerfConfig.Server.SampleSeconds. When it stays under
--   HeartbeatWarnHz it warns in the server log with the heaviest Profiler labels (when the
--   Profiler is accumulating), so the log says which system to look at.
-- * Memory: total, Luau heap and Instances every MemorySampleSeconds. When total memory keeps
--   climbing across LeakWindowMinutes while the player count is steady, it warns: that's a leak
--   (per-player tables, connections, instances parented to nil, tracks...), not load.
-- * Publishes HeartbeatHz, WorstFrameMs, MemoryMb and Players as attributes of
--   ReplicatedStorage.PerfServerStats for the dev HUD, rounded and only when they change.
-- * PerfSample (Unreliable remote, client -> server): rate-limited, every field validated, kept
--   per device class. Summary printed every LogSummaryMinutes; optional AnalyticsService events.
--
-- Add to Net's REMOTES:  PerfSample = "Unreliable", -- (sample) client perf telemetry; PerfService validates

local AnalyticsService = game:GetService("AnalyticsService")
local Players = game:GetService("Players")
local ReplicatedStorage = game:GetService("ReplicatedStorage")
local RunService = game:GetService("RunService")
local Stats = game:GetService("Stats")

local Net = require(ReplicatedStorage.Shared.Net)
local PerfConfig = require(ReplicatedStorage.Shared.Perf.PerfConfig)
local Profiler = require(ReplicatedStorage.Shared.Perf.Profiler)
local RollingStats = require(ReplicatedStorage.Shared.Perf.RollingStats)

type Sample = {
	Fps: number,
	LowFps: number,
	MemoryMb: number,
	PingMs: number,
	Device: string,
	Quality: string,
}

type DeviceAggregate = {
	Samples: number,
	FpsSum: number,
	LowFpsSum: number,
	MemorySum: number,
	PingSum: number,
	BelowMin: number,
}

local DEVICES = { "Desktop", "Tablet", "Phone", "Console" }
local QUALITIES = { "Low", "Medium", "High" }
local serverConfig = PerfConfig.Server
local telemetryConfig = PerfConfig.Telemetry

local PerfService = {}

local statsFolder: Folder? = nil
local heartbeatHz = 60
local worstFrameMs = 0
local aggregates: { [string]: DeviceAggregate } = {}
local lastSample: { [Player]: Sample } = {}

local function memoryForTag(tagName: string): number
	local ok, value = pcall(function()
		return Stats:GetMemoryUsageMbForTag((Enum.DeveloperMemoryTag :: any)[tagName])
	end)
	return if ok and type(value) == "number" then value else 0
end

local function publish(name: string, value: number)
	local folder = statsFolder
	if folder and folder:GetAttribute(name) ~= value then
		folder:SetAttribute(name, value)
	end
end

-- Least-squares slope of evenly spaced samples, in units per hour.
local function slopePerHour(values: { number }, spacingSeconds: number): number
	local n = #values
	if n < 3 then
		return 0
	end
	local meanX = (n - 1) / 2
	local meanY = 0
	for _, y in values do
		meanY += y
	end
	meanY /= n
	local num, den = 0, 0
	for i, y in values do
		local dx = (i - 1) - meanX
		num += dx * (y - meanY)
		den += dx * dx
	end
	return (num / den) * (3600 / spacingSeconds)
end

local function profilerHint(): string
	if not Profiler.IsAccumulating() then
		return "Wrap your systems with Profiler.Wrap and set PerfConfig.Profiler.Accumulate = true to see which one."
	end
	local rows = Profiler.Report(5)
	if #rows == 0 then
		return "No Profiler labels recorded: wrap your systems with Profiler.Wrap / Scheduler."
	end
	return "Heaviest labels:\n" .. Profiler.Format(rows)
end

local function watchHeartbeat()
	local frames = 0
	local worst = 0
	local windowStart = os.clock()
	local slowWindows = 0
	local lastWarn = -math.huge

	RunService.Heartbeat:Connect(function(dt: number)
		frames += 1
		if dt > worst then
			worst = dt
		end
		local now = os.clock()
		local elapsed = now - windowStart
		if elapsed < serverConfig.SampleSeconds then
			return
		end
		heartbeatHz = frames / elapsed
		worstFrameMs = worst * 1000
		frames, worst, windowStart = 0, 0, now

		publish("HeartbeatHz", math.floor(heartbeatHz * 10 + 0.5) / 10)
		publish("WorstFrameMs", math.floor(worstFrameMs + 0.5))

		if heartbeatHz < serverConfig.HeartbeatWarnHz then
			slowWindows += 1
		else
			slowWindows = 0
		end
		if slowWindows >= serverConfig.WarnAfterWindows and now - lastWarn >= serverConfig.WarnCooldownSeconds then
			lastWarn = now
			local level = if heartbeatHz < serverConfig.HeartbeatCriticalHz then "CRITICAL" else "slow"
			local message = string.format(
				"[Perf] Server heartbeat %s: %.1f Hz (worst frame %.0f ms) with %d players. %s",
				level,
				heartbeatHz,
				worstFrameMs,
				#Players:GetPlayers(),
				profilerHint()
			)
			warn(message)
			Profiler.Reset()
		end
	end)
end

local function watchMemory()
	local window = math.max(3, math.floor(serverConfig.LeakWindowMinutes * 60 / serverConfig.MemorySampleSeconds))
	local memoryWindow = RollingStats.new(window)
	local luaWindow = RollingStats.new(window)
	local instanceWindow = RollingStats.new(window)
	local playerWindow = RollingStats.new(window)
	local lastWarn = -math.huge

	while true do
		local total = Stats:GetTotalMemoryUsageMb()
		local players = #Players:GetPlayers()
		memoryWindow:Push(total)
		luaWindow:Push(memoryForTag("LuaHeap"))
		instanceWindow:Push(memoryForTag("Instances"))
		playerWindow:Push(players)
		publish("MemoryMb", math.floor(total + 0.5))
		publish("Players", players)

		if memoryWindow:IsFull() and os.clock() - lastWarn >= serverConfig.WarnCooldownSeconds then
			local spacing = serverConfig.MemorySampleSeconds
			local slope = slopePerHour(memoryWindow:Ordered(), spacing)
			local minPlayers, maxPlayers = playerWindow:Min(), playerWindow:Max()
			local steady = maxPlayers - minPlayers <= math.max(2, maxPlayers * 0.1)
			if steady and slope >= serverConfig.LeakWarnMbPerHour then
				lastWarn = os.clock()
				warn(
					string.format(
						"[Perf] Server memory rising %.0f MB/hour over %d min with players steady (%d-%d): Luau heap %+.0f MB/h, Instances %+.0f MB/h, now %.0f MB. Likely a leak: per-player tables not cleared on PlayerRemoving, connections never disconnected, instances parented to nil instead of destroyed.",
						slope,
						serverConfig.LeakWindowMinutes,
						minPlayers,
						maxPlayers,
						slopePerHour(luaWindow:Ordered(), spacing),
						slopePerHour(instanceWindow:Ordered(), spacing),
						total
					)
				)
			end
		end
		task.wait(serverConfig.MemorySampleSeconds)
	end
end

local function finite(value: unknown, low: number, high: number): number?
	if type(value) ~= "number" or value ~= value or value < low or value > high then
		return nil
	end
	return value
end

local function validate(payload: unknown): Sample?
	if type(payload) ~= "table" then
		return nil
	end
	local data = payload :: { [any]: unknown }
	local fps = finite(data.Fps, 0, 1000)
	local lowFps = finite(data.LowFps, 0, 1000)
	local memory = finite(data.MemoryMb, 0, 100000)
	local ping = finite(data.PingMs, 0, 60000)
	local device = data.Device
	local quality = data.Quality
	if not (fps and lowFps and memory and ping) then
		return nil
	end
	if type(device) ~= "string" or not table.find(DEVICES, device) then
		return nil
	end
	if type(quality) ~= "string" or not table.find(QUALITIES, quality) then
		return nil
	end
	return { Fps = fps, LowFps = lowFps, MemoryMb = memory, PingMs = ping, Device = device, Quality = quality }
end

local function logAnalytics(player: Player, sample: Sample)
	local fields = {
		[Enum.AnalyticsCustomFieldKeys.CustomField01.Name] = sample.Device,
		[Enum.AnalyticsCustomFieldKeys.CustomField02.Name] = sample.Quality,
	}
	pcall(function()
		AnalyticsService:LogCustomEvent(player, "PerfFps", math.floor(sample.Fps + 0.5), fields)
		AnalyticsService:LogCustomEvent(player, "PerfMemoryMb", math.floor(sample.MemoryMb + 0.5), fields)
	end)
end

local function onSample(player: Player, payload: unknown)
	local sample = validate(payload)
	if sample == nil then
		return
	end
	lastSample[player] = sample
	local aggregate = aggregates[sample.Device]
	if aggregate == nil then
		aggregate = { Samples = 0, FpsSum = 0, LowFpsSum = 0, MemorySum = 0, PingSum = 0, BelowMin = 0 }
		aggregates[sample.Device] = aggregate
	end
	aggregate.Samples += 1
	aggregate.FpsSum += sample.Fps
	aggregate.LowFpsSum += sample.LowFps
	aggregate.MemorySum += sample.MemoryMb
	aggregate.PingSum += sample.PingMs
	local budget = (PerfConfig.Budgets :: any)[sample.Device]
	if budget and sample.Fps < budget.MinFps then
		aggregate.BelowMin += 1
	end
	if telemetryConfig.AnalyticsEvents then
		logAnalytics(player, sample)
	end
end

-- Public API -----------------------------------------------------------------------------

function PerfService:GetHeartbeatHz(): number
	return heartbeatHz
end

-- Per device class: average FPS, 1% low, memory, ping and the share of samples under MinFps,
-- since the last summary.
function PerfService:GetClientSummary(): { [string]: { [string]: number } }
	local out = {}
	for device, a in aggregates do
		if a.Samples > 0 then
			out[device] = {
				Samples = a.Samples,
				Fps = a.FpsSum / a.Samples,
				LowFps = a.LowFpsSum / a.Samples,
				MemoryMb = a.MemorySum / a.Samples,
				PingMs = a.PingSum / a.Samples,
				BelowMinShare = a.BelowMin / a.Samples,
			}
		end
	end
	return out
end

-- The latest sample from one player (for support tools: "why is it laggy for this player?").
function PerfService:GetPlayerSample(player: Player): Sample?
	return lastSample[player]
end

function PerfService:LogSummary()
	local lines = {}
	for device, s in PerfService:GetClientSummary() do
		table.insert(
			lines,
			string.format(
				"  %-8s %4d samples  fps %.0f (1%% low %.0f)  mem %.0f MB  ping %.0f ms  under min %.0f%%",
				device,
				s.Samples,
				s.Fps,
				s.LowFps,
				s.MemoryMb,
				s.PingMs,
				s.BelowMinShare * 100
			)
		)
	end
	if #lines > 0 then
		print(string.format("[Perf] Server %.1f Hz, %d players. Clients:\n%s", heartbeatHz, #Players:GetPlayers(), table.concat(lines, "\n")))
	end
	table.clear(aggregates)
end

-- Lifecycle ------------------------------------------------------------------------------

function PerfService:Init()
	if serverConfig.PublishStats then
		local folder = Instance.new("Folder")
		folder.Name = "PerfServerStats"
		folder.Parent = ReplicatedStorage
		statsFolder = folder
	end
end

function PerfService:Start()
	Players.PlayerRemoving:Connect(function(player)
		lastSample[player] = nil
	end)

	if telemetryConfig.Enabled then
		local ok, result = pcall(Net.Unreliable, "PerfSample")
		if ok then
			local remote = result :: UnreliableRemoteEvent
			local allow = Net.RateLimiter(1 / 20, 2)
			remote.OnServerEvent:Connect(function(player: Player, payload: unknown)
				if allow(player) then
					onSample(player, payload)
				end
			end)
			task.spawn(function()
				while true do
					task.wait(telemetryConfig.LogSummaryMinutes * 60)
					PerfService:LogSummary()
				end
			end)
		else
			warn(`[Perf] telemetry off: {result} (add PerfSample = "Unreliable" to Net's REMOTES)`)
		end
	end

	watchHeartbeat()
	watchMemory() -- loops forever; Start runs in its own thread
end

return PerfService
