--!strict
-- Reuse Instances instead of creating and destroying them: bullets, shells, hit markers, damage
-- numbers, coins, footprints, VFX. Cloning, parenting and destroying an Instance costs far more
-- than moving one that already exists, and the churn shows up as GC and render-cluster spikes in
-- the MicroProfiler.
--
--   local bullets = Pool.new(ReplicatedStorage.Assets.Bullet, {
--       Prewarm = 30,          -- created up front, a few per frame
--       Max = 200,             -- hard cap on objects alive at once
--       Recycle = true,        -- at the cap, Get() takes back the oldest active object
--       Parent = workspace.Effects,
--   })
--   local bullet = bullets:Get(cframe)   -- placed and enabled (nil only at the cap with Recycle = false)
--   bullets:ReleaseAfter(bullet, 2)      -- or bullets:Release(bullet)
--
-- Modes:
--   "Park" (default) keeps released objects parented and moves them far away. No reparenting
--   cost, the fastest option for things that come and go many times a second. Needs anchored
--   parts (cosmetic objects); a template with unanchored parts uses "Parent" automatically.
--   "Parent" sets Parent = nil on release: no render or physics cost while idle, better for big
--   models used now and then.
--
-- On Get, ParticleEmitters, Beams, Trails, lights, Fire/Smoke/Sparkles go back to the Enabled
-- state they had in the template and Trails are cleared (otherwise a trail streaks from the park
-- position). On Release they are all disabled and Sounds stop. Use OnGet / OnRelease for
-- anything else (reset text, colour, attributes).
--
-- Pools belong on the client. A server-side pool of replicated parts still sends every move to
-- every client; for server projectiles, simulate with raycasts and let clients draw them.

export type Options = {
	Prewarm: number?,
	Max: number?,
	Recycle: boolean?,
	Parent: Instance?,
	Mode: ("Park" | "Parent")?,
	OnGet: ((instance: Instance) -> ())?,
	OnRelease: ((instance: Instance) -> ())?,
}

type Toggle = { Instance: Instance, Enabled: boolean }
type Record = { Toggles: { Toggle }, Trails: { Trail }, Sounds: { Sound }, Stamp: number }

local PARK = CFrame.new(0, 1e7, 0)
local TOGGLE_CLASSES = { "ParticleEmitter", "Beam", "Trail", "Light", "Fire", "Smoke", "Sparkles" }

local function isToggle(instance: Instance): boolean
	for _, className in TOGGLE_CLASSES do
		if instance:IsA(className) then
			return true
		end
	end
	return false
end

local function hasUnanchoredParts(template: Instance): boolean
	if template:IsA("BasePart") and not template.Anchored then
		return true
	end
	for _, descendant in template:GetDescendants() do
		if descendant:IsA("BasePart") and not descendant.Anchored then
			return true
		end
	end
	return false
end

local function place(instance: Instance, cframe: CFrame)
	if instance:IsA("BasePart") then
		instance.CFrame = cframe
	elseif instance:IsA("Model") then
		instance:PivotTo(cframe)
	end
end

local Pool = {}
Pool.__index = Pool

export type Pool = typeof(setmetatable(
	{} :: {
		_template: Instance,
		_free: { Instance },
		_active: { [Instance]: boolean },
		_records: { [Instance]: Record },
		_total: number,
		_stamp: number,
		_max: number,
		_recycle: boolean,
		_parent: Instance,
		_mode: "Park" | "Parent",
		_onGet: ((instance: Instance) -> ())?,
		_onRelease: ((instance: Instance) -> ())?,
		_destroyed: boolean,
	},
	Pool
))

function Pool.new(template: Instance, options: Options?): Pool
	local opts: Options = options or {}
	local mode = opts.Mode or "Park"
	if mode == "Park" and hasUnanchoredParts(template) then
		mode = "Parent"
	end
	local self = setmetatable({
		_template = template,
		_free = {},
		_active = {},
		_records = {},
		_total = 0,
		_stamp = 0,
		_max = opts.Max or math.huge,
		_recycle = opts.Recycle == true,
		_parent = opts.Parent or workspace,
		_mode = mode,
		_onGet = opts.OnGet,
		_onRelease = opts.OnRelease,
		_destroyed = false,
	}, Pool)

	local prewarm = math.min(opts.Prewarm or 0, self._max)
	if prewarm > 0 then
		task.spawn(function()
			for i = 1, prewarm do
				if self._destroyed or self._total >= self._max then
					return
				end
				local instance = self:_create()
				self:_park(instance)
				table.insert(self._free, instance)
				if i % 10 == 0 then
					task.wait() -- spread the cloning so prewarming doesn't hitch
				end
			end
		end)
	end
	return self
end

function Pool._create(self: Pool): Instance
	local instance = self._template:Clone()
	local record: Record = { Toggles = {}, Trails = {}, Sounds = {}, Stamp = 0 }
	local function scan(item: Instance)
		if isToggle(item) then
			table.insert(record.Toggles, { Instance = item, Enabled = (item :: any).Enabled })
		end
		if item:IsA("Trail") then
			table.insert(record.Trails, item)
		elseif item:IsA("Sound") then
			table.insert(record.Sounds, item)
		end
	end
	scan(instance)
	for _, descendant in instance:GetDescendants() do
		scan(descendant)
	end
	self._records[instance] = record
	self._total += 1
	return instance
end

function Pool._park(self: Pool, instance: Instance)
	local record = self._records[instance]
	for _, toggle in record.Toggles do
		(toggle.Instance :: any).Enabled = false
	end
	for _, sound in record.Sounds do
		sound:Stop()
	end
	if self._mode == "Park" then
		place(instance, PARK)
		if instance.Parent ~= self._parent then
			instance.Parent = self._parent
		end
	else
		instance.Parent = nil
	end
end

function Pool.Get(self: Pool, cframe: CFrame?): Instance?
	if self._destroyed then
		return nil
	end
	local instance = table.remove(self._free)
	if instance == nil then
		if self._total < self._max then
			instance = self:_create()
		elseif self._recycle then
			local oldest: Instance? = nil
			local oldestStamp = math.huge
			for active in self._active do
				local stamp = self._records[active].Stamp
				if stamp < oldestStamp then
					oldest, oldestStamp = active, stamp
				end
			end
			if oldest then
				self:Release(oldest)
				instance = table.remove(self._free)
			end
		end
	end
	if instance == nil then
		return nil
	end

	local record = self._records[instance]
	self._stamp += 1
	record.Stamp = self._stamp
	self._active[instance] = true
	if cframe then
		place(instance, cframe)
	end
	if instance.Parent ~= self._parent then
		instance.Parent = self._parent
	end
	for _, trail in record.Trails do
		trail:Clear()
	end
	for _, toggle in record.Toggles do
		(toggle.Instance :: any).Enabled = toggle.Enabled
	end
	if self._onGet then
		self._onGet(instance)
	end
	return instance
end

function Pool.Release(self: Pool, instance: Instance)
	if not self._active[instance] then
		return -- not ours, or already released
	end
	self._active[instance] = nil
	if self._destroyed then
		instance:Destroy()
		return
	end
	if self._onRelease then
		self._onRelease(instance)
	end
	self:_park(instance)
	table.insert(self._free, instance)
end

-- Release after a delay unless it was released (and possibly reused) in the meantime.
function Pool.ReleaseAfter(self: Pool, instance: Instance, seconds: number)
	local record = self._records[instance]
	local stamp = record and record.Stamp
	task.delay(seconds, function()
		local current = self._records[instance]
		if current and current.Stamp == stamp then
			self:Release(instance)
		end
	end)
end

function Pool.ActiveCount(self: Pool): number
	local count = 0
	for _ in self._active do
		count += 1
	end
	return count
end

function Pool.Destroy(self: Pool)
	self._destroyed = true
	for instance in self._records do
		instance:Destroy()
	end
	table.clear(self._records)
	table.clear(self._free)
	table.clear(self._active)
	self._total = 0
end

return Pool
