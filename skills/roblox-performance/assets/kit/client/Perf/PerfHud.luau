--!strict
-- The dev performance overlay, built from plain Instances (no UI library needed). Opened and fed
-- by PerfController; it refreshes a few times a second and only writes a label's Text when the
-- text actually changed, so the HUD itself stays out of the numbers it shows.
--
-- Colours compare against the device budget from PerfConfig: green healthy, amber watch, red act.
-- Values the engine doesn't expose on this client show as "-".
-- Server rows read the attributes PerfService publishes on ReplicatedStorage.PerfServerStats.

local Players = game:GetService("Players")
local ReplicatedStorage = game:GetService("ReplicatedStorage")

local PerfConfig = require(ReplicatedStorage.Shared.Perf.PerfConfig)
local Profiler = require(ReplicatedStorage.Shared.Perf.Profiler)

local GOOD = "#5fd068"
local WATCH = "#f2b84b"
local BAD = "#ff5c5c"
local DIM = "#9aa4ad"
local ROWS = 8

local PerfHud = {}
PerfHud.__index = PerfHud

export type PerfHud = typeof(setmetatable(
	{} :: {
		_gui: ScreenGui,
		_labels: { TextLabel },
		_texts: { string },
		_budget: PerfConfig.Budget,
	},
	PerfHud
))

local function color(text: string, hex: string): string
	return `<font color="{hex}">{text}</font>`
end

-- Higher is better (FPS, heartbeat).
local function rateColor(value: number, good: number, bad: number): string
	return if value >= good then GOOD elseif value >= bad then WATCH else BAD
end

-- Lower is better (memory, bandwidth, ping, ms).
local function costColor(value: number, watch: number, bad: number): string
	return if value < watch then GOOD elseif value < bad then WATCH else BAD
end

local function num(value: number?, decimals: number?): string
	if value == nil then
		return "-"
	end
	if decimals and decimals > 0 then
		return string.format(`%.{decimals}f`, value)
	end
	local rounded = math.floor(value + 0.5)
	if math.abs(rounded) >= 1e6 then
		return string.format("%.1fM", rounded / 1e6)
	elseif math.abs(rounded) >= 1e4 then
		return string.format("%.0fk", rounded / 1e3)
	end
	return tostring(rounded)
end

function PerfHud.new(budget: PerfConfig.Budget): PerfHud
	local gui = Instance.new("ScreenGui")
	gui.Name = "PerfHud"
	gui.ResetOnSpawn = false
	gui.DisplayOrder = 1000
	gui.ZIndexBehavior = Enum.ZIndexBehavior.Sibling
	pcall(function()
		(gui :: any).ScreenInsets = Enum.ScreenInsets.CoreUISafeInsets
	end)

	local panel = Instance.new("Frame")
	panel.Name = "Panel"
	panel.AutomaticSize = Enum.AutomaticSize.XY
	panel.Position = UDim2.fromOffset(8, 8)
	panel.BackgroundColor3 = Color3.fromRGB(12, 14, 18)
	panel.BackgroundTransparency = 0.25
	panel.BorderSizePixel = 0
	panel.Parent = gui

	local corner = Instance.new("UICorner")
	corner.CornerRadius = UDim.new(0, 6)
	corner.Parent = panel

	local padding = Instance.new("UIPadding")
	padding.PaddingTop = UDim.new(0, 6)
	padding.PaddingBottom = UDim.new(0, 6)
	padding.PaddingLeft = UDim.new(0, 8)
	padding.PaddingRight = UDim.new(0, 8)
	padding.Parent = panel

	local layout = Instance.new("UIListLayout")
	layout.SortOrder = Enum.SortOrder.LayoutOrder
	layout.Padding = UDim.new(0, 2)
	layout.Parent = panel

	local labels = {}
	for i = 1, ROWS + PerfConfig.Hud.ProfilerRows do
		local label = Instance.new("TextLabel")
		label.Name = `Row{i}`
		label.LayoutOrder = i
		label.AutomaticSize = Enum.AutomaticSize.XY
		label.BackgroundTransparency = 1
		label.Font = Enum.Font.RobotoMono
		label.TextSize = 13
		label.TextColor3 = Color3.fromRGB(230, 233, 237)
		label.TextXAlignment = Enum.TextXAlignment.Left
		label.RichText = true
		label.Text = ""
		label.Visible = false
		label.Parent = panel
		labels[i] = label
	end

	local playerGui = Players.LocalPlayer:WaitForChild("PlayerGui")
	gui.Parent = playerGui

	return setmetatable({
		_gui = gui,
		_labels = labels,
		_texts = table.create(#labels, ""),
		_budget = budget,
	}, PerfHud)
end

function PerfHud._set(self: PerfHud, index: number, text: string)
	if self._texts[index] == text then
		return
	end
	self._texts[index] = text
	local label = self._labels[index]
	label.Text = text
	label.Visible = text ~= ""
end

function PerfHud.Update(self: PerfHud, s: any, profilerRows: { Profiler.ReportRow })
	local budget = self._budget
	local minFps = budget.MinFps

	self:_set(
		1,
		`FPS {color(num(s.Fps), rateColor(s.Fps, budget.TargetFps * 0.9, minFps))}`
			.. `  1% low {color(num(s.LowFps), rateColor(s.LowFps, s.Fps * 0.5, s.Fps * 0.33))}`
			.. `  frame {num(s.FrameMs, 1)} ms  worst {color(num(s.WorstFrameMs), costColor(s.WorstFrameMs, 50, 100))} ms`
	)

	if s.CpuFrameMs or s.GpuFrameMs then
		self:_set(2, `render CPU {num(s.CpuFrameMs, 1)} ms  GPU {num(s.GpuFrameMs, 1)} ms`)
	else
		self:_set(2, "")
	end

	self:_set(
		3,
		`mem {color(num(s.MemoryMb), costColor(s.MemoryMb, budget.MemoryWarnMb, budget.MemoryCriticalMb))} MB`
			.. color(`  lua {num(s.LuaHeapMb)}  inst {num(s.InstancesMb)}  tex {num(s.TextureMb)}`, DIM)
	)

	local receive = s.ReceiveKBps
	local ping = s.PingMs
	self:_set(
		4,
		`net in {if receive then color(num(receive, 1), costColor(receive, budget.ReceiveWarnKBps, budget.ReceiveWarnKBps * 2)) else "-"}`
			.. `  out {num(s.SendKBps, 1)} KB/s  ping {if ping then color(num(ping), costColor(ping, 120, 250)) else "-"} ms`
	)

	if s.DrawCalls or s.Triangles then
		self:_set(5, `scene {num(s.DrawCalls)} draws  {num(s.Triangles)} tris  {num(s.InstanceCount)} instances`)
	else
		self:_set(5, `{num(s.InstanceCount)} instances`)
	end

	self:_set(6, color(`{s.Device}  quality {s.Quality} ({s.QualitySource})`, DIM))

	local server = ReplicatedStorage:FindFirstChild("PerfServerStats")
	if server then
		local hz = server:GetAttribute("HeartbeatHz")
		local worst = server:GetAttribute("WorstFrameMs")
		local mem = server:GetAttribute("MemoryMb")
		local serverConfig = PerfConfig.Server
		local hzText = if type(hz) == "number"
			then color(num(hz, 1), rateColor(hz, serverConfig.HeartbeatWarnHz + 10, serverConfig.HeartbeatWarnHz))
			else "-"
		self:_set(
			7,
			`server {hzText} Hz  worst {num(if type(worst) == "number" then worst else nil)} ms  mem {num(if type(mem) == "number" then mem else nil)} MB`
		)
	else
		self:_set(7, color("server stats off (PerfService)", DIM))
	end

	if Profiler.IsAccumulating() and #profilerRows > 0 then
		self:_set(8, color("client profiler (ms/frame)", DIM))
	else
		self:_set(8, "")
	end
	for i = 1, PerfConfig.Hud.ProfilerRows do
		local row = profilerRows[i]
		self:_set(ROWS + i, if row then string.format("  %-24s %5.2f", row.Label, row.MsPerFrame) else "")
	end
end

function PerfHud.Destroy(self: PerfHud)
	self._gui:Destroy()
end

return PerfHud
