--!strict
-- Turns "what's happening" into "what the music should do": one state (which cue plays) and one
-- smoothed intensity (which stems are up). Pure Luau, no Instances: tested in the luau CLI and
-- ported line for line to the browser lab.
--
-- Game code reports *sources*, each with a state, an intensity (0-1) and an optional lifetime:
--
--   director:SetSource("enemy:" .. id, "combat", 0.6)        -- until cleared
--   director:SetSource("gunshot", "combat", 0.9, 3)          -- 3 s pulse, expires by itself
--   director:SetSource("wanted", "chase", stars / 5)          -- GTA-style heat
--   director:ClearSource("enemy:" .. id)
--
-- The highest-Priority state with a source wins. Hysteresis keeps it musical:
--   * escalation (a higher priority) switches at once;
--   * de-escalation waits until the current state has had no source for its Hold seconds and has
--     played for MinDwell seconds (no combat music stopping and starting between shots);
--   * intensity rises at Attack per second, holds for IntensityHold seconds after it peaks, then
--     falls at Release per second. On a state change it jumps to the new state's target.

export type StateDef = {
	Priority: number,
	Cue: string?,
	Intensity: number?, -- floor while in this state
	Hold: number?, -- seconds without a source before leaving (default Config.StateHold)
	MinDwell: number?, -- minimum seconds in the state before leaving it downward
	[string]: any,
}
export type Config = {
	States: { [string]: StateDef },
	BaseState: string,
	Attack: number?,
	Release: number?,
	IntensityHold: number?,
	StateHold: number?,
	[string]: any,
}
type Source = { State: string, Intensity: number, Expires: number? }

local MusicDirector = {}
MusicDirector.__index = MusicDirector

export type Director = typeof(setmetatable(
	{} :: {
		config: Config,
		states: { [string]: StateDef },
		base: string,
		sources: { [string]: Source },
		time: number,
		state: string,
		intensity: number,
		stateSince: number,
		lastSupport: number,
		peakTime: number,
	},
	MusicDirector
))

function MusicDirector.new(config: Config): Director
	assert(config.States[config.BaseState], `BaseState '{config.BaseState}' is not in States`)
	local self = setmetatable({
		config = config,
		states = config.States,
		base = config.BaseState,
		sources = {},
		time = 0,
		state = config.BaseState,
		intensity = config.States[config.BaseState].Intensity or 0,
		stateSince = 0,
		lastSupport = 0,
		peakTime = 0,
	}, MusicDirector)
	return self
end

function MusicDirector.SetSource(self: Director, id: string, state: string, intensity: number?, ttl: number?)
	assert(self.states[state], `unknown music state '{state}'`)
	self.sources[id] = {
		State = state,
		Intensity = math.clamp(intensity or 0, 0, 1),
		Expires = if ttl then self.time + ttl else nil,
	}
end

function MusicDirector.ClearSource(self: Director, id: string)
	self.sources[id] = nil
end

-- The resting state (lobby, round, area). If the old base is playing with no source holding it,
-- the new base takes over on the next update instead of waiting out a Hold.
function MusicDirector.SetBase(self: Director, state: string)
	assert(self.states[state], `unknown music state '{state}'`)
	if self.state == self.base then
		self.lastSupport = -math.huge
	end
	self.base = state
end

function MusicDirector.HasSource(self: Director, id: string): boolean
	return self.sources[id] ~= nil
end

-- Advance by dt seconds. Returns state, intensity, and whether the state changed this step.
function MusicDirector.Update(self: Director, dt: number): (string, number, boolean)
	self.time += dt
	local now = self.time
	local states = self.states
	local config = self.config

	local support: { [string]: number } = {}
	for id, source in self.sources do
		if source.Expires and source.Expires <= now then
			self.sources[id] = nil
			continue
		end
		support[source.State] = math.max(support[source.State] or 0, source.Intensity)
	end

	-- Highest priority wins; ties go to the higher intensity, then the name (deterministic).
	local best, bestPriority, bestIntensity = self.base, states[self.base].Priority, -1
	for name, level in support do
		local priority = states[name].Priority
		if
			priority > bestPriority
			or (priority == bestPriority and name ~= best and (level > bestIntensity or (level == bestIntensity and name < best)))
		then
			best, bestPriority, bestIntensity = name, priority, level
		end
	end
	if support[self.state] ~= nil or self.state == self.base then
		self.lastSupport = now
	end

	local changed = false
	if best ~= self.state then
		local current = states[self.state]
		local up = bestPriority > current.Priority
		local hold = if current.Hold ~= nil then current.Hold else (config.StateHold or 0)
		local held = now - self.lastSupport >= hold - 1e-9
		local dwelt = now - self.stateSince >= (current.MinDwell or 0) - 1e-9
		if up or (held and dwelt) then
			self.state = best
			self.stateSince = now
			self.lastSupport = now
			changed = true
		end
	end

	local def = states[self.state]
	local target = math.max(def.Intensity or 0, support[self.state] or 0)
	if changed then
		self.intensity = target
		self.peakTime = now
	elseif target >= self.intensity then
		self.intensity = math.min(target, self.intensity + (if config.Attack ~= nil then config.Attack else 1) * dt)
		self.peakTime = now
	elseif now - self.peakTime >= (config.IntensityHold or 0) - 1e-9 then
		self.intensity = math.max(target, self.intensity - (if config.Release ~= nil then config.Release else 0.25) * dt)
	end
	return self.state, self.intensity, changed
end

return MusicDirector
