--!strict
-- Client performance: measures this device, picks a quality tier, sends a small telemetry sample,
-- and owns the dev HUD.
--
-- Measures every frame (cheap: one Heartbeat push) and summarises once a second:
--   median FPS, 1% low FPS, client memory (total, Luau heap, instances, textures), network in/out,
--   ping, instance count and scene draw calls / triangles where the engine exposes them.
--
-- Quality tier ("Low" | "Medium" | "High"):
--   starts from the player's Roblox graphics level (or the device default when it's Automatic),
--   steps down when the median FPS stays under the device's MinFps, steps back up when there is
--   headroom (with a growing cooldown so it doesn't flip-flop), and a settings menu can pin it with
--   PerfController:SetQualityOverride("Low") / (nil). Other systems don't need to require this
--   module: it sets LocalPlayer attributes PerfQuality, PerfLodScale and PerfParticleScale.
--
-- HUD: F7 or "/perf" in chat (see PerfConfig.Hud for who may open it).
-- Telemetry: needs `PerfSample = "Unreliable"` in Net's REMOTES list; PerfService validates it.

local GuiService = game:GetService("GuiService")
local Players = game:GetService("Players")
local ReplicatedStorage = game:GetService("ReplicatedStorage")
local RunService = game:GetService("RunService")
local Stats = game:GetService("Stats")
local TextChatService = game:GetService("TextChatService")
local UserInputService = game:GetService("UserInputService")

local Net = require(ReplicatedStorage.Shared.Net)
local PerfConfig = require(ReplicatedStorage.Shared.Perf.PerfConfig)
local PerfHud = require(script.Parent.Parent.Perf.PerfHud)
local Profiler = require(ReplicatedStorage.Shared.Perf.Profiler)
local RollingStats = require(ReplicatedStorage.Shared.Perf.RollingStats)
local Signal = require(ReplicatedStorage.Packages.Signal)

type Quality = PerfConfig.Quality
type DeviceClass = PerfConfig.DeviceClass

export type Snapshot = {
	Fps: number,
	LowFps: number,
	FrameMs: number,
	WorstFrameMs: number,
	MemoryMb: number,
	LuaHeapMb: number?,
	InstancesMb: number?,
	TextureMb: number?,
	ReceiveKBps: number?,
	SendKBps: number?,
	PingMs: number?,
	InstanceCount: number?,
	DrawCalls: number?,
	Triangles: number?,
	CpuFrameMs: number?,
	GpuFrameMs: number?,
	Quality: Quality,
	QualitySource: string,
	Device: DeviceClass,
}

local QUALITIES: { Quality } = { "Low", "Medium", "High" }
local player = Players.LocalPlayer
local qualityConfig = PerfConfig.Quality

local PerfController = {}
-- Fires (quality: Quality, source: "start" | "auto" | "override")
PerfController.QualityChanged = Signal.new()

local frames = RollingStats.new(600) -- ~10 s at 60 FPS
local device: DeviceClass = "Desktop"
local budget = PerfConfig.Budgets.Desktop
local qualityIndex = 3
local qualitySource = "start"
local override: Quality? = nil
local snapshot: Snapshot? = nil
local hud: PerfHud.PerfHud? = nil
local focused = true
local startedAt = os.clock()
local belowSince: number? = nil
local aboveSince: number? = nil
local blockedUntil: { [number]: number } = {}
local drops: { [number]: number } = {}

local function readStat(name: string): number?
	local ok, value = pcall(function()
		return (Stats :: any)[name]
	end)
	return if ok and type(value) == "number" then value else nil
end

local function memoryForTag(tagName: string): number?
	local ok, value = pcall(function()
		return Stats:GetMemoryUsageMbForTag((Enum.DeveloperMemoryTag :: any)[tagName])
	end)
	return if ok and type(value) == "number" then value else nil
end

local function detectDevice(): DeviceClass
	if GuiService:IsTenFootInterface() then
		return "Console"
	end
	if UserInputService.TouchEnabled and not UserInputService.KeyboardEnabled then
		local camera = workspace.CurrentCamera
		local size = if camera then camera.ViewportSize else Vector2.new(1000, 500)
		return if math.min(size.X, size.Y) >= 600 then "Tablet" else "Phone"
	end
	return "Desktop"
end

local function startingQuality(): number
	local level = 0
	pcall(function()
		local settings = UserSettings():GetService("UserGameSettings")
		level = settings.SavedQualityLevel.Value -- 0 = Automatic, 1-10 = manual
	end)
	if level >= 8 then
		return 3
	elseif level >= 4 then
		return 2
	elseif level >= 1 then
		return 1
	end
	return table.find(QUALITIES, qualityConfig.Default[device]) or 2
end

local function applyQuality(index: number, source: string)
	qualityIndex = math.clamp(index, 1, #QUALITIES)
	qualitySource = source
	local quality = QUALITIES[qualityIndex]
	player:SetAttribute("PerfQuality", quality)
	player:SetAttribute("PerfLodScale", qualityConfig.LodScale[quality])
	player:SetAttribute("PerfParticleScale", qualityConfig.ParticleScale[quality])
	PerfController.QualityChanged:Fire(quality, source)
end

local function adapt(medianFps: number)
	if override or not qualityConfig.Adaptive or not focused then
		belowSince, aboveSince = nil, nil
		return
	end
	local now = os.clock()
	if now - startedAt < qualityConfig.IgnoreFirstSeconds or frames:Count() < 120 then
		return
	end
	if medianFps < budget.MinFps then
		aboveSince = nil
		belowSince = belowSince or now
		if qualityIndex > 1 and now - (belowSince :: number) >= qualityConfig.StepDownSeconds then
			local from = qualityIndex
			drops[from] = (drops[from] or 0) + 1
			blockedUntil[from] = now + qualityConfig.StepUpCooldownSeconds * 2 ^ (drops[from] - 1)
			belowSince = nil
			applyQuality(from - 1, "auto")
		end
	elseif medianFps >= budget.TargetFps * 0.95 then
		belowSince = nil
		aboveSince = aboveSince or now
		local target = qualityIndex + 1
		if
			target <= #QUALITIES
			and now - (aboveSince :: number) >= qualityConfig.StepUpSeconds
			and now >= (blockedUntil[target] or 0)
		then
			aboveSince = nil
			applyQuality(target, "auto")
		end
	else
		belowSince, aboveSince = nil, nil
	end
end

local function summarise(): Snapshot
	local median = frames:Percentile(0.5)
	local slow = frames:Percentile(0.99)
	local ok, ping = pcall(function()
		return player:GetNetworkPing() * 1000
	end)
	return {
		Fps = if median > 0 then 1 / median else 0,
		LowFps = if slow > 0 then 1 / slow else 0,
		FrameMs = median * 1000,
		WorstFrameMs = frames:Max() * 1000,
		MemoryMb = Stats:GetTotalMemoryUsageMb(),
		LuaHeapMb = memoryForTag("LuaHeap"),
		InstancesMb = memoryForTag("Instances"),
		TextureMb = memoryForTag("GraphicsTexture"),
		ReceiveKBps = readStat("DataReceiveKbps"),
		SendKBps = readStat("DataSendKbps"),
		PingMs = if ok and type(ping) == "number" then ping else nil,
		InstanceCount = readStat("InstanceCount"),
		DrawCalls = readStat("SceneDrawcallCount"),
		Triangles = readStat("SceneTriangleCount"),
		CpuFrameMs = readStat("RenderCPUFrameTime"),
		GpuFrameMs = readStat("RenderGPUFrameTime"),
		Quality = QUALITIES[qualityIndex],
		QualitySource = if override then "override" else qualitySource,
		Device = device,
	}
end

local function canOpenHud(): boolean
	local hudConfig = PerfConfig.Hud
	if hudConfig.Everyone or (hudConfig.StudioAlways and RunService:IsStudio()) then
		return true
	end
	if table.find(hudConfig.AllowedUserIds, player.UserId) then
		return true
	end
	if hudConfig.GroupId > 0 then
		local ok, rank = pcall(function()
			return player:GetRankInGroup(hudConfig.GroupId)
		end)
		return ok and rank >= hudConfig.MinRank
	end
	return false
end

local function toggleHud()
	if hud then
		hud:Destroy()
		hud = nil
		return
	end
	if not canOpenHud() then
		return
	end
	local newHud = PerfHud.new(budget)
	hud = newHud
	if snapshot then
		newHud:Update(snapshot, Profiler.Report(PerfConfig.Hud.ProfilerRows))
	end
end

local function sendSample(current: Snapshot)
	local ok, err = pcall(function()
		Net.Unreliable("PerfSample"):FireServer({
			Fps = math.floor(current.Fps * 10 + 0.5) / 10,
			LowFps = math.floor(current.LowFps * 10 + 0.5) / 10,
			MemoryMb = math.floor(current.MemoryMb + 0.5),
			PingMs = if current.PingMs then math.floor(current.PingMs + 0.5) else 0,
			Device = current.Device,
			Quality = current.Quality,
		})
	end)
	if not ok then
		warn(`[Perf] telemetry off: {err} (add PerfSample = "Unreliable" to Net's REMOTES)`)
	end
	return ok
end

-- Public API -----------------------------------------------------------------------------

function PerfController:GetQuality(): Quality
	return QUALITIES[qualityIndex]
end

function PerfController:GetDevice(): DeviceClass
	return device
end

-- Latest one-second summary (nil during the first second).
function PerfController:GetSnapshot(): Snapshot?
	return snapshot
end

-- Pin a tier from your settings menu, or nil to go back to automatic.
function PerfController:SetQualityOverride(quality: Quality?)
	override = quality
	if quality then
		applyQuality(table.find(QUALITIES, quality) or qualityIndex, "override")
	else
		applyQuality(startingQuality(), "start")
	end
end

function PerfController:ToggleHud()
	toggleHud()
end

-- Lifecycle ------------------------------------------------------------------------------

function PerfController:Init()
	device = detectDevice()
	budget = PerfConfig.Budgets[device]
	applyQuality(startingQuality(), "start")
end

function PerfController:Start()
	RunService.Heartbeat:Connect(function(dt: number)
		frames:Push(dt)
	end)
	UserInputService.WindowFocused:Connect(function()
		focused = true
		frames:Clear() -- unfocused windows are throttled; don't judge FPS from those frames
	end)
	UserInputService.WindowFocusReleased:Connect(function()
		focused = false
	end)

	local hudConfig = PerfConfig.Hud
	if hudConfig.ToggleKey then
		UserInputService.InputBegan:Connect(function(input, processed)
			if not processed and input.KeyCode == hudConfig.ToggleKey then
				toggleHud()
			end
		end)
	end
	if hudConfig.ChatCommand then
		pcall(function()
			local command = Instance.new("TextChatCommand")
			command.Name = "PerfHudCommand"
			command.PrimaryAlias = hudConfig.ChatCommand :: string
			command.Triggered:Connect(function(source: TextSource)
				if source.UserId == player.UserId then
					toggleHud()
				end
			end)
			command.Parent = TextChatService
		end)
	end

	local telemetry = PerfConfig.Telemetry
	local nextSample = os.clock() + telemetry.FirstAfterSeconds
	local telemetryOn = telemetry.Enabled

	-- Summarise once a second, or at the HUD's refresh rate while it is open.
	while true do
		task.wait(if hud then hudConfig.RefreshSeconds else 1)
		if frames:Count() > 0 then
			local current = summarise()
			snapshot = current
			adapt(current.Fps)
			local now = os.clock()
			local openHud = hud
			if openHud then
				openHud:Update(current, Profiler.Report(hudConfig.ProfilerRows))
			end
			if telemetryOn and focused and now >= nextSample then
				nextSample = now + telemetry.IntervalSeconds
				telemetryOn = sendSample(current)
			end
		end
	end
end

return PerfController
