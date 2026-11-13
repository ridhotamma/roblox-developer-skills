--!strict
-- A fixed-size window of numbers (frame times, heartbeat samples, memory readings).
-- Push is O(1) and allocation-free, so it is safe to call every frame. Mean, Min, Max and
-- Percentile walk the window (Percentile also sorts a reused scratch array): call them a few
-- times a second, not per frame.
--
--   local frames = RollingStats.new(600)
--   RunService.Heartbeat:Connect(function(dt) frames:Push(dt) end)
--   local medianFps = 1 / frames:Percentile(0.5)
--   local onePercentLowFps = 1 / frames:Percentile(0.99)

local RollingStats = {}
RollingStats.__index = RollingStats

export type RollingStats = typeof(setmetatable(
	{} :: {
		_values: { number },
		_capacity: number,
		_count: number,
		_next: number,
		_scratch: { number },
	},
	RollingStats
))

function RollingStats.new(capacity: number): RollingStats
	assert(capacity >= 1, "RollingStats capacity must be at least 1")
	return setmetatable({
		_values = table.create(capacity, 0),
		_capacity = capacity,
		_count = 0,
		_next = 1,
		_scratch = table.create(capacity, 0),
	}, RollingStats)
end

function RollingStats.Push(self: RollingStats, value: number)
	self._values[self._next] = value
	self._next = if self._next >= self._capacity then 1 else self._next + 1
	if self._count < self._capacity then
		self._count += 1
	end
end

function RollingStats.Count(self: RollingStats): number
	return self._count
end

function RollingStats.IsFull(self: RollingStats): boolean
	return self._count >= self._capacity
end

-- Most recent value, or nil when empty.
function RollingStats.Latest(self: RollingStats): number?
	if self._count == 0 then
		return nil
	end
	local index = if self._next == 1 then self._capacity else self._next - 1
	return self._values[index]
end

function RollingStats.Mean(self: RollingStats): number
	local count = self._count
	if count == 0 then
		return 0
	end
	local sum = 0
	for i = 1, count do
		sum += self._values[i]
	end
	return sum / count
end

function RollingStats.Min(self: RollingStats): number
	local count = self._count
	if count == 0 then
		return 0
	end
	local low = math.huge
	for i = 1, count do
		low = math.min(low, self._values[i])
	end
	return low
end

function RollingStats.Max(self: RollingStats): number
	local count = self._count
	if count == 0 then
		return 0
	end
	local high = -math.huge
	for i = 1, count do
		high = math.max(high, self._values[i])
	end
	return high
end

-- p in [0, 1]: 0.5 = median, 0.99 = the value 99% of samples are below.
function RollingStats.Percentile(self: RollingStats, p: number): number
	local count = self._count
	if count == 0 then
		return 0
	end
	local scratch = self._scratch
	table.clear(scratch)
	for i = 1, count do
		scratch[i] = self._values[i]
	end
	table.sort(scratch)
	local index = math.clamp(math.ceil(p * count), 1, count)
	return scratch[index]
end

-- Values in the order they were pushed, oldest first (allocates; for reports, not per frame).
function RollingStats.Ordered(self: RollingStats): { number }
	local out = table.create(self._count)
	local start = if self._count < self._capacity then 1 else self._next
	for i = 0, self._count - 1 do
		local index = (start - 1 + i) % self._capacity + 1
		table.insert(out, self._values[index])
	end
	return out
end

function RollingStats.Clear(self: RollingStats)
	self._count = 0
	self._next = 1
end

return RollingStats
