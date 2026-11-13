--!strict
-- Named timing scopes. Every scope is a debug.profilebegin label, so it shows up by name in the
-- MicroProfiler (client and server). When accumulating is on (PerfConfig.Profiler.Accumulate),
-- each label also adds up its milliseconds, so the game can answer "which system costs what"
-- without anyone opening a profiler: PerfService prints it when the server slows down, and the
-- dev HUD shows the client's top labels.
--
--   local step = Profiler.Wrap("Npc.Think", function(dt: number) ... end)
--   RunService.Heartbeat:Connect(step)
--
--   Profiler.Begin("Inventory.Rebuild")
--   ...                                  -- same thread, no yielding in between
--   Profiler.End()
--
--   Profiler.Report(5) --> { { Label, MsPerFrame, MsPerCall, Calls, MsTotal }, ... } heaviest first
--
-- Rules:
--   * Labels are fixed strings. A string built per call ("Npc " .. id) allocates every time and
--     floods the profiler with labels.
--   * Wrapped functions and Begin/End pairs must not yield; a yield splits the scope across frames.
--   * Times are inclusive: a scope nested inside another counts towards both.

local RunService = game:GetService("RunService")

local PerfConfig = require(script.Parent.PerfConfig)

export type ReportRow = {
	Label: string,
	MsPerFrame: number,
	MsPerCall: number,
	Calls: number,
	MsTotal: number,
}

type Entry = { Total: number, Calls: number }

local Profiler = {}

local setting = PerfConfig.Profiler.Accumulate
local accumulate = setting == true or (setting == "Studio" and RunService:IsStudio())

local entries: { [string]: Entry } = {}
local labels: { string } = {}
local starts: { number } = {}
local depth = 0
local frames = 0
local frameConnection: RBXScriptConnection? = nil

local function countFrames()
	if frameConnection == nil then
		frameConnection = RunService.Heartbeat:Connect(function()
			frames += 1
		end)
	end
end

if accumulate then
	countFrames()
end

function Profiler.Begin(label: string)
	debug.profilebegin(label)
	if accumulate then
		depth += 1
		labels[depth] = label
		starts[depth] = os.clock()
	end
end

function Profiler.End()
	debug.profileend()
	if accumulate and depth > 0 then
		local elapsed = os.clock() - starts[depth]
		local label = labels[depth]
		depth -= 1
		local entry = entries[label]
		if entry == nil then
			entry = { Total = 0, Calls = 0 }
			entries[label] = entry
		end
		entry.Total += elapsed
		entry.Calls += 1
	end
end

-- Returns a function that runs `fn` inside a scope. Errors still propagate (with the original
-- traceback in the message), and the scope is always closed.
function Profiler.Wrap<A...>(label: string, fn: (A...) -> ()): (A...) -> ()
	return function(...: A...)
		Profiler.Begin(label)
		local ok, err = xpcall(fn, debug.traceback, ...)
		Profiler.End()
		if not ok then
			error(err, 0)
		end
	end
end

-- Heaviest labels since the last Reset, by milliseconds per frame.
function Profiler.Report(limit: number?): { ReportRow }
	local frameCount = math.max(frames, 1)
	local rows: { ReportRow } = {}
	for label, entry in entries do
		table.insert(rows, {
			Label = label,
			MsPerFrame = entry.Total * 1000 / frameCount,
			MsPerCall = entry.Total * 1000 / math.max(entry.Calls, 1),
			Calls = entry.Calls,
			MsTotal = entry.Total * 1000,
		})
	end
	table.sort(rows, function(a, b)
		return a.MsPerFrame > b.MsPerFrame
	end)
	if limit and #rows > limit then
		for i = #rows, limit + 1, -1 do
			rows[i] = nil
		end
	end
	return rows
end

function Profiler.Format(rows: { ReportRow }): string
	local lines = {}
	for _, row in rows do
		table.insert(lines, string.format("%-28s %6.2f ms/frame  %7.3f ms/call  %d calls", row.Label, row.MsPerFrame, row.MsPerCall, row.Calls))
	end
	return table.concat(lines, "\n")
end

function Profiler.Reset()
	table.clear(entries)
	frames = 0
end

function Profiler.IsAccumulating(): boolean
	return accumulate
end

-- Turn accumulation on or off at runtime (for example from an admin command on a live server).
function Profiler.SetAccumulating(on: boolean)
	accumulate = on
	if on then
		countFrames()
	elseif frameConnection then
		frameConnection:Disconnect()
		frameConnection = nil
	end
	Profiler.Reset()
	depth = 0
end

return Profiler
