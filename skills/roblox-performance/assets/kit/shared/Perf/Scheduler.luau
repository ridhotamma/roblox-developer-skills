--!strict
-- One loop per system, with a time budget per frame.
--
-- Instead of every coin, door, NPC or light connecting its own Heartbeat (hundreds of connections,
-- each with call overhead, all running every frame), a system adds its objects to one Scheduler.
-- The scheduler visits them round-robin, stops for the frame once its budget is spent, and carries
-- on from there next frame. Items can also ask to be skipped for a while, which is how distance
-- LOD for updates works: near things every frame, far things a few times a second.
--
--   local npcs = Scheduler.new("Npc.Think", {
--       BudgetMs = 1,                  -- max ms per frame for this whole system
--       Event = "Heartbeat",           -- or "PreRender" (client, camera/visual work), "PreSimulation", "PostSimulation"
--       Begin = function(dt) ... end,  -- optional: once per frame before any item (read the camera, the clock...)
--       Step = function(npc, dt)       -- dt = seconds since THIS item was last stepped
--           ...
--           return 0.25                -- optional: skip this item for 0.25 s
--       end,
--   })
--   npcs:Add(npc)        npcs:Remove(npc)        npcs:Destroy()
--
-- Begin and Step must not yield (no task.wait, WaitForChild or async calls): spawn a thread for
-- slow work instead. At least one item is stepped every frame even when one Step blows the
-- budget, so the system always makes progress. Steps run inside one MicroProfiler label (the scheduler's name)
-- and are error-isolated: an item that errors is warned about and backed off for 5 seconds.
--
-- Scheduler.Every(seconds, fn) is a repeating timer whose first run is randomly offset, so dozens
-- of timers created at startup don't all land on the same frame.

local RunService = game:GetService("RunService")

local Profiler = require(script.Parent.Profiler)

export type Options = {
	BudgetMs: number?,
	Event: ("Heartbeat" | "PreRender" | "PreSimulation" | "PostSimulation")?,
	Begin: ((dt: number) -> ())?,
	Step: (item: any, dt: number) -> number?,
}

local ERROR_BACKOFF = 5

local Scheduler = {}
Scheduler.__index = Scheduler

export type Scheduler = typeof(setmetatable(
	{} :: {
		Name: string,
		_budget: number,
		_begin: ((dt: number) -> ())?,
		_step: (item: any, dt: number) -> number?,
		_items: { any },
		_index: { [any]: number },
		_last: { [any]: number },
		_nextAt: { [any]: number },
		_cursor: number,
		_connection: RBXScriptConnection?,
	},
	Scheduler
))

function Scheduler.new(name: string, options: Options): Scheduler
	local self = setmetatable({
		Name = name,
		_budget = (options.BudgetMs or 1) / 1000,
		_begin = options.Begin,
		_step = options.Step,
		_items = {},
		_index = {},
		_last = {},
		_nextAt = {},
		_cursor = 1,
		_connection = nil :: RBXScriptConnection?,
	}, Scheduler)

	local eventName = options.Event or "Heartbeat"
	local signal = (RunService :: any)[eventName] :: RBXScriptSignal
	self._connection = signal:Connect(function(dt: number)
		self:_run(dt)
	end)
	return self
end

function Scheduler.Add(self: Scheduler, item: any)
	if self._index[item] then
		return
	end
	table.insert(self._items, item)
	self._index[item] = #self._items
	self._nextAt[item] = 0
end

function Scheduler.Remove(self: Scheduler, item: any)
	local index = self._index[item]
	if index == nil then
		return
	end
	local items = self._items
	local last = #items
	local moved = items[last]
	items[index] = moved
	items[last] = nil
	if moved ~= item then
		self._index[moved] = index
	end
	self._index[item] = nil
	self._last[item] = nil
	self._nextAt[item] = nil
end

function Scheduler.Has(self: Scheduler, item: any): boolean
	return self._index[item] ~= nil
end

function Scheduler.Count(self: Scheduler): number
	return #self._items
end

-- Make an item run on the next frame regardless of the delay it asked for.
function Scheduler.Wake(self: Scheduler, item: any)
	if self._index[item] then
		self._nextAt[item] = 0
	end
end

function Scheduler.SetBudget(self: Scheduler, ms: number)
	self._budget = ms / 1000
end

function Scheduler.Clear(self: Scheduler)
	table.clear(self._items)
	table.clear(self._index)
	table.clear(self._last)
	table.clear(self._nextAt)
	self._cursor = 1
end

function Scheduler.Destroy(self: Scheduler)
	if self._connection then
		self._connection:Disconnect()
		self._connection = nil
	end
	self:Clear()
end

function Scheduler._run(self: Scheduler, dt: number)
	local items = self._items
	if #items == 0 and self._begin == nil then
		return
	end
	Profiler.Begin(self.Name)
	local begin = self._begin
	if begin then
		local ok, err = pcall(begin, dt)
		if not ok then
			warn(`[Scheduler {self.Name}] Begin failed: {err}`)
		end
	end

	local deadline = os.clock() + self._budget
	local cursor = self._cursor
	local nextAt = self._nextAt
	local last = self._last
	local step = self._step
	-- Visit each item at most once per frame. Items removed during a Step shift the array
	-- (swap-remove), which can skip or revisit one item this frame; that's harmless.
	for _ = 1, #items do
		local count = #items
		if count == 0 then
			break
		end
		if cursor > count then
			cursor = 1
		end
		local item = items[cursor]
		cursor += 1
		local now = os.clock()
		if now >= (nextAt[item] or 0) then
			local elapsed = now - (last[item] or now)
			last[item] = now
			local ok, delay = pcall(step, item, elapsed)
			if not ok then
				warn(`[Scheduler {self.Name}] Step failed for {tostring(item)}: {delay}`)
				delay = ERROR_BACKOFF
			end
			if self._index[item] then
				nextAt[item] = if type(delay) == "number" and delay > 0 then now + delay else 0
			end
			if os.clock() >= deadline then
				break
			end
		end
	end
	self._cursor = cursor
	Profiler.End()
end

-- Repeating timer with a random first offset. `fn` may yield (the next run waits for it).
-- Returns a function that stops it.
function Scheduler.Every(seconds: number, fn: () -> (), label: string?): () -> ()
	local running = true
	local name = label or "Scheduler.Every"
	task.spawn(function()
		task.wait(math.random() * seconds)
		while running do
			local ok, err = pcall(fn)
			if not ok then
				warn(`[{name}] {err}`)
			end
			task.wait(seconds)
		end
	end)
	return function()
		running = false
	end
end

return Scheduler
