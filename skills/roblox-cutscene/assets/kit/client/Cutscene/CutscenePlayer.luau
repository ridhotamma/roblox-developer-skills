--!strict
-- Plays one scene on this client, in lockstep with the server's clock.
--
-- Every frame it asks the Timeline for scene time t (from the shared clock, through slow
-- motion and freezes, holding at an unanswered QTE), then:
--   * places each stand-in on its mark / move pose, sets its playback rate, holds last frames
--   * fires what happened since last frame: animations, sounds, voice lines, events
--   * if this client has the camera: camera from the Timeline, letterbox, fade, subtitles
-- If t jumps (a late start, a QTE branch, a retry) it seeks instead: stops everything and
-- restarts what should already be playing at t, part-way through. That's why every branch
-- of every scene works without special cases.
--
-- Two ways to watch:
--   Camera   the player is in the scene: their camera, HUD and controls are taken
--   Observer the player just sees it happen in the world (a finisher across the room)

local Players = game:GetService("Players")
local ReplicatedStorage = game:GetService("ReplicatedStorage")
local RunService = game:GetService("RunService")
local SoundService = game:GetService("SoundService")

local CutsceneConfig = require(ReplicatedStorage.Shared.Cutscene.CutsceneConfig)
local Timeline = require(ReplicatedStorage.Shared.Cutscene.Timeline)
local CinemaCamera = require(script.Parent.CinemaCamera)
local CinemaOverlay = require(script.Parent.CinemaOverlay)
local Doubles = require(script.Parent.Doubles)

export type Payload = {
	Id: string,
	Scene: string,
	Folder: string,
	Origin: CFrame,
	Actors: { [string]: Model },
	SceneTime: number,
	ServerTime: number,
	Camera: boolean,
	Skippable: boolean,
}

export type Hooks = {
	OnEvent: (item: any, play: any) -> (),
	ShakeScale: () -> number,
}

local CutscenePlayer = {}
CutscenePlayer.__index = CutscenePlayer

export type CutscenePlayer = typeof(setmetatable(
	{} :: {
		Id: string,
		Payload: Payload,
		Compiled: Timeline.Compiled,
		Camera: boolean,
		Hooks: Hooks,
		Doubles: { [string]: Model },
		Real: { [string]: Model },
		Heights: { [string]: number },
		AnchorScene: number,
		AnchorServer: number,
		LastT: number?,
		Rate: number,
		Sounds: { Sound },
		LocalEnded: boolean,
		Finished: boolean,
		StepName: string,
		Kept: { [string]: boolean },
	},
	CutscenePlayer
))

local function now(): number
	return workspace:GetServerTimeNow()
end

function CutscenePlayer.new(payload: Payload, compiled: Timeline.Compiled, hooks: Hooks): CutscenePlayer
	local self = setmetatable({
		Id = payload.Id,
		Payload = payload,
		Compiled = compiled,
		Camera = payload.Camera,
		Hooks = hooks,
		Doubles = {},
		Real = {},
		Heights = {},
		AnchorScene = payload.SceneTime,
		AnchorServer = payload.ServerTime,
		LastT = nil,
		Rate = 1,
		Sounds = {},
		LocalEnded = false,
		Finished = false,
		StepName = `CutscenePlayer_{payload.Id}`,
		Kept = {},
	}, CutscenePlayer)
	return self
end

---------------------------------------------------------------------------------------------
-- Time

local function pendingQtes(self: CutscenePlayer): { any }
	local out = {}
	for _, item in self.Compiled.Qtes do
		if item.At >= self.AnchorScene - 1e-6 then
			table.insert(out, item)
		end
	end
	return out
end

function CutscenePlayer.Time(self: CutscenePlayer, at: number): (number, number)
	local c = self.Compiled
	local wall = Timeline.WallTime(c, self.AnchorScene) + (at - self.AnchorServer)
	local t = Timeline.SceneTime(c, wall)
	local rate = Timeline.SpeedAtWall(c, wall)
	for _, item in pendingQtes(self) do
		local close = Timeline.QteEnd(item)
		if item.At <= t and t > close then
			return close, 0 -- waiting for the server's verdict
		end
	end
	for _, item in c.Events do
		if item.Name == "Goto" and item.At >= self.AnchorScene - 1e-6 and t > item.At then
			return item.At, 0 -- the server is about to jump us
		end
	end
	return t, rate
end

---------------------------------------------------------------------------------------------
-- Items

local function playSound(self: CutscenePlayer, item: any, offset: number)
	local id = item.Sound or item.Id
	if type(id) ~= "string" or id == "" then
		return
	end
	local sound = Instance.new("Sound")
	sound.SoundId = id
	sound.Volume = item.Volume or 1
	sound.PlaybackSpeed = item.Pitch or 1
	local double = item.Actor and self.Doubles[item.Actor]
	local root = double and (double:FindFirstChild("Head") or double.PrimaryPart)
	sound.Parent = if root then root else SoundService
	if offset > 0.05 then
		-- Seeking: start part-way through if the sound is still going at t.
		if not sound.IsLoaded then
			sound.Loaded:Wait()
		end
		if offset >= sound.TimeLength then
			sound:Destroy()
			return
		end
		sound.TimePosition = offset
	end
	sound:Play()
	table.insert(self.Sounds, sound)
	sound.Ended:Connect(function()
		sound:Destroy()
	end)
end

local function playAnimation(self: CutscenePlayer, item: any, offset: number)
	local double = self.Doubles[item.Actor]
	if not double or type(item.Id) ~= "string" or item.Id == "" then
		return
	end
	local speed = item.Speed or 1
	Doubles.Play(double, item.Id, {
		Speed = speed,
		Looped = item.Looped,
		FadeTime = item.FadeTime,
		Weight = item.Weight,
		Layer = item.Layer,
		TimePosition = offset * speed,
		Hold = item.Hold,
	})
end

local function fire(self: CutscenePlayer, item: any, t: number)
	local offset = t - item.At
	if item.Kind == "Animation" then
		playAnimation(self, item, offset)
	elseif item.Kind == "Sound" or (item.Kind == "Subtitle" and item.Sound) then
		task.spawn(playSound, self, item, offset)
	elseif item.Kind == "Event" then
		local target = item.Target and self.Doubles[item.Target]
		if item.Name == "Ragdoll" and target then
			Doubles.Ragdoll(target, item.Velocity)
		elseif item.Name == "Hide" and target then
			Doubles.SetVisible(target, false)
		elseif item.Name == "Show" and target then
			Doubles.SetVisible(target, true)
		elseif item.Name == "Flash" and self.Camera then
			CinemaOverlay.Flash(item.Duration)
		elseif item.Name == "End" then
			self:EndLocally()
			return
		end
		self.Hooks.OnEvent(item, self)
	end
end

function CutscenePlayer.Seek(self: CutscenePlayer, t: number)
	for _, double in self.Doubles do
		Doubles.StopAll(double, 0.1)
	end
	for _, sound in self.Sounds do
		sound:Destroy()
	end
	self.Sounds = {}
	local active = Timeline.ActiveAt(self.Compiled, t)
	for _, entry in active.Animations do
		playAnimation(self, entry.Item, entry.Offset)
	end
	for _, entry in active.Sounds do
		task.spawn(playSound, self, entry.Item, entry.Offset)
	end
	for name, double in self.Doubles do
		Doubles.SetVisible(double, not active.Hidden[name])
	end
	for _, name in active.Ragdolls do
		local double = self.Doubles[name]
		if double then
			Doubles.Ragdoll(double)
		end
	end
	self.LastT = t
end

---------------------------------------------------------------------------------------------
-- Frame

function CutscenePlayer.Step(self: CutscenePlayer)
	if self.Finished then
		return
	end
	local c = self.Compiled
	local t, rate = self:Time(now())
	local frame = math.max(0, t)

	if t >= 0 and not self.LocalEnded then
		local last = self.LastT
		if last == nil or t < last - 1e-6 or t - last > 0.75 then
			self:Seek(t)
		else
			for _, item in Timeline.ItemsBetween(c, last, t) do
				fire(self, item, t)
				if self.LocalEnded then
					return
				end
			end
			self.LastT = t
		end
	end

	-- Bodies
	local poses = Timeline.Poses(c, frame, self.Payload.Origin, self.Heights)
	for name, double in self.Doubles do
		local pose = poses[name]
		if pose then
			Doubles.Place(double, pose.CFrame)
		end
		Doubles.SetRate(double, if t < 0 then 0 else rate)
		Doubles.Step(double)
	end
	Doubles.KeepHidden()

	-- Camera and screen
	if self.Camera and not self.LocalEnded then
		local viewport = workspace.CurrentCamera.ViewportSize
		local aspect = viewport.X / math.max(1, viewport.Y)
		local state, index = Timeline.Camera(c, frame, self.Payload.Origin, aspect, {
			ShakeScale = self.Hooks.ShakeScale(),
			Heights = self.Heights,
		})
		local shot = c.Shots[index]
		CinemaCamera.Apply({
			CFrame = state.CFrame,
			Fov = state.Fov,
			Lens = state.Lens,
			Aim = state.Aim,
			Focus = state.Focus,
			Aperture = shot.Aperture or c.Def.Aperture,
		})
		CinemaOverlay.SetLetterbox(c.Letterbox, Timeline.LetterboxAt(c, frame))
		CinemaOverlay.SetFade(Timeline.FadeAt(c, frame))
		CinemaOverlay.SetSubtitle(Timeline.SubtitleAt(c, frame))
	end

	if t >= c.Length and not self.LocalEnded then
		self:EndLocally()
	end
end

---------------------------------------------------------------------------------------------
-- Lifecycle

function CutscenePlayer.Start(self: CutscenePlayer)
	local c = self.Compiled
	-- Stand-ins for every actor: the bound model, or a template, or nobody.
	for name, actorDef in c.Actors do
		local real = self.Payload.Actors[name]
		local double: Model? = nil
		if real and real.Parent then
			double = Doubles.Make(real)
			if double then
				self.Real[name] = real
				self.Heights[name] = Doubles.Height(real)
				Doubles.Hide(real)
			end
		elseif actorDef.Template then
			double = Doubles.FromTemplate(actorDef.Template)
			if double then
				self.Heights[name] = Doubles.Height(double)
			end
		end
		if double then
			self.Doubles[name] = double
		end
	end
	local ids = {}
	for _, item in c.Animations do
		table.insert(ids, item.Id)
	end
	task.spawn(Doubles.Preload, ids)

	if self.Camera then
		Players.LocalPlayer:SetAttribute("InCutscene", true)
		CinemaOverlay.HideGameUi()
		CinemaOverlay.SetControlsEnabled(false)
		CinemaCamera.Begin(c.Def.BlendIn or CutsceneConfig.Camera.BlendIn)
		if self.Payload.Skippable then
			CinemaOverlay.SetSkip("Hold to skip")
		end
	end
	RunService:BindToRenderStep(self.StepName, CutsceneConfig.Camera.RenderPriority, function()
		self:Step()
	end)
end

-- The server re-synced us (QTE result, Goto, retry): from `serverTime`, scene time is `sceneTime`.
function CutscenePlayer.Rebase(self: CutscenePlayer, sceneTime: number, serverTime: number)
	self.AnchorScene = sceneTime
	self.AnchorServer = serverTime
	self.LastT = nil -- forces a seek on the next frame
	if self.LocalEnded and not self.Finished then
		-- We'd run off the end (e.g. a fail branch) but the server says otherwise.
		self.LocalEnded = false
	end
end

-- The scene reached its end on this client: give the camera back, keep the stand-ins on their
-- last frame until the server confirms (it moves the real actors first).
function CutscenePlayer.EndLocally(self: CutscenePlayer)
	if self.LocalEnded then
		return
	end
	self.LocalEnded = true
	if self.Camera then
		self:ReleaseCamera()
	end
	local id = self.Id
	task.delay(CutsceneConfig.EndTimeout, function()
		if not self.Finished and self.LocalEnded and self.Id == id then
			self:Finish({})
		end
	end)
end

function CutscenePlayer.ReleaseCamera(self: CutscenePlayer)
	if not self.Camera then
		return
	end
	self.Camera = false
	CinemaCamera.End(self.Compiled.Def.BlendOut or CutsceneConfig.Camera.BlendOut)
	CinemaOverlay.Clear()
	CinemaOverlay.FadeBack()
	CinemaOverlay.SetSkip(nil)
	CinemaOverlay.RestoreGameUi()
	CinemaOverlay.SetControlsEnabled(true)
	Players.LocalPlayer:SetAttribute("InCutscene", nil)
end

-- The server ended the scene. `keep` names actors whose stand-ins stay as corpses.
function CutscenePlayer.Finish(self: CutscenePlayer, keep: { [string]: boolean })
	if self.Finished then
		return
	end
	self.Finished = true
	RunService:UnbindFromRenderStep(self.StepName)
	self:ReleaseCamera()
	for _, sound in self.Sounds do
		sound:Destroy()
	end
	for name, double in self.Doubles do
		local real = self.Real[name]
		if keep[name] and real then
			-- The real body died in the scene: our stand-in is the corpse until it goes away.
			local humanoid = real:FindFirstChildOfClass("Humanoid")
			local started = os.clock()
			task.spawn(function()
				while real.Parent and os.clock() - started < CutsceneConfig.CorpseSeconds do
					if humanoid and humanoid.Health > 0 then
						break -- respawned in place
					end
					Doubles.KeepHidden()
					task.wait(0.25)
				end
				Doubles.Destroy(double)
				if real.Parent then
					Doubles.Show(real)
				end
			end)
		else
			Doubles.Destroy(double)
			if real then
				Doubles.Show(real)
			end
		end
	end
	self.Doubles = {}
end

return CutscenePlayer
