--!strict
-- Plays adaptive cues with the Audio API: every stem is an AudioPlayer wired through its own
-- AudioFader into a music bus, all started with Play(atTime) against SoundService:GetMixerTime()
-- so they begin on the same sample and stay locked while they loop.
--
--   SoundService.Music
--     Bus (AudioFader: volume x player setting x duck) --> Out (AudioDeviceOutput)
--     <cue>#n (Folder) per playing cue
--       <stem> (AudioPlayer, Looping) --> <stem>Fader (AudioFader: layer gain x cue fade) --> Bus
--     Stingers / intro / ending: AudioPlayer --> Bus
--
-- Vertical layering: SetIntensity(x) moves each stem toward MusicTimeline.LayerGain(Min, Full, x).
-- Horizontal re-sequencing: Play(cue, { Sync = "Bar" }) schedules the new cue on the next bar of
-- the current one (or its Intro first), crossfades or plays the old cue's Ending, then stops it.
--
-- Stems with an empty Asset are skipped, so a cue with no ids yet just plays silently.

local ReplicatedStorage = game:GetService("ReplicatedStorage")
local SoundService = game:GetService("SoundService")

local MusicTimeline = require(ReplicatedStorage.Shared.Music.MusicTimeline)

type Sync = MusicTimeline.Sync
export type PlayOptions = {
	Sync: Sync?,
	Fade: number?,
	Entry: string?,
	Intro: boolean?,
	Ending: boolean?, -- end the OLD cue with its Ending one-shot
}
type StemState = { def: any, player: AudioPlayer, fader: AudioFader, gain: number }
type CueState = {
	name: string,
	def: any,
	folder: Folder,
	stems: { StemState },
	origin: number, -- mixer time of the loop's bar 1, beat 1 (grid origin)
	fadeFrom: number,
	fadeTo: number,
	fadeStart: number,
	fadeEnd: number,
	stopAt: number?,
	started: boolean,
}
type Duck = { from: number, hold: number, release: number, amount: number }

local MusicPlayer = {}
MusicPlayer.__index = MusicPlayer

local function wire(source: Instance, target: Instance, parent: Instance): Wire
	local w = Instance.new("Wire")
	w.SourceInstance = source
	w.TargetInstance = target
	w.Parent = parent
	return w
end

local function assetOf(id: any): string?
	if typeof(id) == "number" then
		return `rbxassetid://{id}`
	elseif typeof(id) == "string" and id ~= "" then
		return if string.match(id, "^%d+$") then `rbxassetid://{id}` else id
	end
	return nil
end

-- GetMixerTime is the clock Play(atTime) is scheduled against. If it isn't available, fall back
-- to os.clock() and unscheduled Play() (stems still start together, within a frame).
local hasMixer = pcall(function()
	return (SoundService :: any):GetMixerTime()
end)
local function mixerNow(): number
	if hasMixer then
		return (SoundService :: any):GetMixerTime()
	end
	return os.clock()
end
local function playAt(player: AudioPlayer, at: number)
	if hasMixer then
		(player :: any):Play(at)
	else
		local delay = at - os.clock()
		if delay > 0.01 then
			task.delay(delay, function()
				if player.Parent then
					player:Play()
				end
			end)
		else
			player:Play()
		end
	end
end
local function stopAt(player: AudioPlayer, at: number)
	if hasMixer then
		(player :: any):Stop(at)
	else
		task.delay(math.max(0, at - os.clock()), function()
			if player.Parent then
				player:Stop()
			end
		end)
	end
end

export type MusicPlayer = typeof(setmetatable(
	{} :: {
		config: any,
		root: Folder,
		bus: AudioFader,
		current: CueState?,
		fading: { CueState },
		pending: { name: string?, options: PlayOptions, since: number, cue: CueState? }?,
		preloaded: { [string]: CueState },
		intensity: number,
		volume: number,
		userDuck: number,
		ducks: { Duck },
		counter: number,
		warned: { [string]: boolean },
	},
	MusicPlayer
))

function MusicPlayer.new(config: any): MusicPlayer
	local root = SoundService:FindFirstChild("Music")
	if root then
		root:Destroy() -- a previous player (e.g. after a reset); start clean
	end
	local folder = Instance.new("Folder")
	folder.Name = "Music"
	local bus = Instance.new("AudioFader")
	bus.Name = "Bus"
	bus.Parent = folder
	local out = Instance.new("AudioDeviceOutput")
	out.Name = "Out"
	out.Parent = folder
	wire(bus, out, bus)
	folder.Parent = SoundService

	local self = setmetatable({
		config = config,
		root = folder,
		bus = bus,
		current = nil,
		fading = {},
		pending = nil,
		preloaded = {},
		intensity = 0,
		volume = config.Volume or 0.5,
		userDuck = 0,
		ducks = {},
		counter = 0,
		warned = {},
	}, MusicPlayer)
	bus.Volume = self.volume
	return self
end

function MusicPlayer.Now(_self: MusicPlayer): number
	return mixerNow()
end

local function makeOneShot(self: MusicPlayer, asset: string, name: string): AudioPlayer
	local p = Instance.new("AudioPlayer")
	p.Name = name
	p.Asset = asset
	p.Looping = false
	p.Parent = self.root
	wire(p, self.bus, p)
	p.Ended:Once(function()
		p:Destroy()
	end)
	return p
end

local function buildCue(self: MusicPlayer, name: string): CueState?
	local def = self.config.Cues[name]
	if not def then
		warn(`[MusicPlayer] no cue '{name}' in MusicCues`)
		return nil
	end
	self.counter += 1
	local folder = Instance.new("Folder")
	folder.Name = `{name}#{self.counter}`
	folder.Parent = self.root
	local stems = {}
	for _, stemDef in def.Stems do
		local asset = assetOf(stemDef.Asset)
		if not asset then
			continue
		end
		local player = Instance.new("AudioPlayer")
		player.Name = stemDef.Name
		player.Asset = asset
		player.Looping = true
		player.AutoLoad = true
		player.Parent = folder
		local fader = Instance.new("AudioFader")
		fader.Name = stemDef.Name .. "Fader"
		fader.Volume = 0
		fader.Parent = folder
		wire(player, fader, fader)
		wire(fader, self.bus, fader)
		table.insert(stems, { def = stemDef, player = player, fader = fader, gain = 0 })
	end
	if #stems == 0 and not self.warned[name] then
		self.warned[name] = true
		warn(`[MusicPlayer] cue '{name}' has no stem asset ids yet; it plays silently`)
	end
	return {
		name = name,
		def = def,
		folder = folder,
		stems = stems,
		origin = 0,
		fadeFrom = 0,
		fadeTo = 1,
		fadeStart = 0,
		fadeEnd = 0,
		stopAt = nil,
		started = false,
	}
end

local function isReady(cue: CueState): boolean
	for _, stem in cue.stems do
		if not stem.player.IsReady then
			return false
		end
	end
	return true
end

local function cueLevel(cue: CueState, now: number): number
	if now <= cue.fadeStart then
		return cue.fadeFrom
	elseif now >= cue.fadeEnd then
		return cue.fadeTo
	end
	local k = (now - cue.fadeStart) / math.max(cue.fadeEnd - cue.fadeStart, 1e-3)
	return cue.fadeFrom + (cue.fadeTo - cue.fadeFrom) * k
end

local function retire(self: MusicPlayer, cue: CueState, at: number, fade: number)
	cue.fadeFrom = cueLevel(cue, at)
	cue.fadeTo = 0
	cue.fadeStart = at
	cue.fadeEnd = at + math.max(fade, 0.05)
	cue.stopAt = cue.fadeEnd + 0.05
	for _, stem in cue.stems do
		stopAt(stem.player, cue.stopAt :: number)
	end
	table.insert(self.fading, cue)
end

-- Make the switch now that the new cue (if any) is loaded.
local function commit(self: MusicPlayer, name: string?, options: PlayOptions, nextCue: CueState?)
	local cfg = self.config.Transition
	local now = mixerNow()
	local lead = cfg.Lead or 0.12
	local old = self.current
	local sync: Sync = options.Sync or cfg.Sync or "Bar"
	local fade = options.Fade or cfg.Fade or 1.5
	local boundary = if old then MusicTimeline.NextBoundary(old.def, old.origin, now + lead, sync) else now + lead

	local loopStart = boundary
	if nextCue and options.Intro and nextCue.def.Intro then
		local asset = assetOf(nextCue.def.Intro.Asset)
		if asset then
			playAt(makeOneShot(self, asset, "Intro"), boundary)
			loopStart = boundary + (nextCue.def.Intro.Beats or nextCue.def.BeatsPerBar) * MusicTimeline.BeatLength(nextCue.def)
		end
	end

	-- The old cue: its Ending on the boundary (and a quick fade), or a crossfade.
	local endingPlayed = false
	if old then
		if options.Ending and old.def.Ending then
			local asset = assetOf(old.def.Ending.Asset)
			if asset then
				playAt(makeOneShot(self, asset, "Ending"), boundary)
				endingPlayed = true
			end
		end
		retire(self, old, boundary, if endingPlayed then 0.08 else fade)
	end

	self.current = nil
	if nextCue then
		local offset = if loopStart == boundary
			then MusicTimeline.EntryOffset(nextCue.def, old and old.def, old and old.origin or 0, loopStart, options.Entry or cfg.Entry)
			else 0
		for _, stem in nextCue.stems do
			stem.player.TimePosition = offset
			stem.gain = MusicTimeline.LayerGain(stem.def.Min or 0, stem.def.Full or 0, self.intensity) * (stem.def.Volume or 1)
			playAt(stem.player, loopStart)
		end
		nextCue.origin = loopStart - offset
		nextCue.started = true
		nextCue.fadeFrom = 0
		nextCue.fadeTo = 1
		-- After an Ending or an Intro the new cue comes in clean on its downbeat; otherwise it
		-- crossfades from the boundary.
		local quick = endingPlayed or loopStart ~= boundary or old == nil
		nextCue.fadeStart = loopStart
		nextCue.fadeEnd = loopStart + (if quick then (if old == nil then math.min(fade, 1) else 0.03) else fade)
		self.current = nextCue
	end
end

-- Switch to cue `name` (nil = silence) on the next Sync boundary of the playing cue.
function MusicPlayer.Play(self: MusicPlayer, name: string?, options: PlayOptions?)
	local opts = options or {}
	local current = self.current
	local pending = self.pending
	if pending and pending.name == name then
		return
	end
	if pending then
		-- superseded before it finished loading
		if pending.cue then
			pending.cue.folder:Destroy()
		end
		self.pending = nil
	end
	if current and current.name == name and current.stopAt == nil then
		return
	end
	local nextCue = nil
	if name then
		nextCue = self.preloaded[name] or buildCue(self, name)
		self.preloaded[name] = nil
	end
	if name and not nextCue then
		return
	end
	self.pending = { name = name, options = opts, since = os.clock(), cue = nextCue }
end

-- Start loading a cue's stems now (a loading screen, a boss door) so switching to it later is
-- instant. Safe to call repeatedly.
function MusicPlayer.Preload(self: MusicPlayer, name: string)
	if self.preloaded[name] or (self.current and self.current.name == name) then
		return
	end
	local cue = buildCue(self, name)
	if cue then
		self.preloaded[name] = cue
	end
end

function MusicPlayer.SetIntensity(self: MusicPlayer, intensity: number)
	self.intensity = math.clamp(intensity, 0, 1)
end

function MusicPlayer.SetVolume(self: MusicPlayer, volume: number)
	self.volume = math.max(0, volume)
end

-- Lower the music by `amount` (0-1) until called again with 0 (dialogue, cutscenes, menus).
function MusicPlayer.Duck(self: MusicPlayer, amount: number)
	self.userDuck = math.clamp(amount, 0, 1)
end

-- Play a stinger on the next beat (or the given Sync) of the playing cue, ducking the music
-- under it. Looks in the playing cue's Stingers first, then in `options.Cue`'s.
function MusicPlayer.PlayStinger(self: MusicPlayer, stinger: string, options: { Sync: Sync?, Cue: string? }?)
	local opts = options or {}
	local current = self.current
	local def = nil
	local candidates: { string } = {}
	if current then
		table.insert(candidates, current.name)
	end
	if opts.Cue then
		table.insert(candidates, opts.Cue)
	end
	for _, cueName in candidates do
		local cue = self.config.Cues[cueName]
		if cue and cue.Stingers and cue.Stingers[stinger] then
			def = { shot = cue.Stingers[stinger], cue = cue }
			break
		end
	end
	if not def then
		warn(`[MusicPlayer] no stinger '{stinger}' in the playing cue`)
		return
	end
	local asset = assetOf(def.shot.Asset)
	if not asset then
		return
	end
	local cfg = self.config.Stinger
	local now = mixerNow()
	local lead = self.config.Transition.Lead or 0.12
	local at = if current
		then MusicTimeline.NextBoundary(current.def, current.origin, now + lead, opts.Sync or cfg.Sync or "Beat")
		else now + lead
	playAt(makeOneShot(self, asset, "Stinger_" .. stinger), at)
	local length = (def.shot.Beats or 2) * MusicTimeline.BeatLength(def.cue)
	table.insert(self.ducks, { from = at, hold = at + length * 0.6, release = cfg.Release or 1.2, amount = cfg.Duck or 0.5 })
end

-- Playhead of the current cue: name, bar, beat (nil if nothing is playing yet).
function MusicPlayer.Position(self: MusicPlayer): (string?, number?, number?)
	local cue = self.current
	if not cue or not cue.started then
		return nil, nil, nil
	end
	local now = mixerNow()
	if now < cue.origin then
		return cue.name, nil, nil
	end
	local _, bar, beat = MusicTimeline.Position(cue.def, cue.origin, now)
	return cue.name, bar, beat
end

local function duckLevel(self: MusicPlayer, now: number): number
	local level = 1 - self.userDuck
	for i = #self.ducks, 1, -1 do
		local d = self.ducks[i]
		if now >= d.hold + d.release then
			table.remove(self.ducks, i)
		elseif now >= d.from then
			local k = if now <= d.hold then 1 else 1 - (now - d.hold) / d.release
			level *= 1 - d.amount * k
		end
	end
	return level
end

function MusicPlayer.Update(self: MusicPlayer, dt: number)
	local now = mixerNow()
	local pending = self.pending
	if pending then
		local timeout = self.config.Transition.LoadTimeout or 8
		if pending.cue == nil or isReady(pending.cue) or os.clock() - pending.since > timeout then
			self.pending = nil
			commit(self, pending.name, pending.options, pending.cue)
		end
	end

	local duck = duckLevel(self, now)
	self.bus.Volume = self.volume
	local step = dt / math.max(self.config.LayerFade or 0.8, 0.01)
	local function drive(cue: CueState)
		local level = cueLevel(cue, now) * duck
		for _, stem in cue.stems do
			local target = MusicTimeline.LayerGain(stem.def.Min or 0, stem.def.Full or 0, self.intensity) * (stem.def.Volume or 1)
			if stem.gain < target then
				stem.gain = math.min(target, stem.gain + step)
			elseif stem.gain > target then
				stem.gain = math.max(target, stem.gain - step)
			end
			stem.fader.Volume = stem.gain * level
		end
	end
	if self.current then
		drive(self.current)
	end
	for i = #self.fading, 1, -1 do
		local cue = self.fading[i]
		if now > (cue.stopAt or 0) + 0.25 then
			cue.folder:Destroy()
			table.remove(self.fading, i)
		else
			drive(cue)
		end
	end
end

function MusicPlayer.Destroy(self: MusicPlayer)
	self.root:Destroy()
end

return MusicPlayer
