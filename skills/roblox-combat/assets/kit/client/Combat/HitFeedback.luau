--!strict
-- Plays the hit feedback stack on this client:
--   hitstop (animation freeze) · flash (Highlight) · impact sound · camera shake · FOV punch
--   · faked slow motion · i-frame blink · damage number
--
-- Two entry points:
--   HitFeedback.Play(info, "predicted")  the attacker's own client, at its contact frame
--   HitFeedback.Play(info, "confirmed")  every client, from the server's CombatHit event
-- A confirmed hit that this client already predicted skips the cosmetic parts it played and
-- adds only what needs the server (damage number, blink, kill sound).

local Lighting = game:GetService("Lighting")
local Players = game:GetService("Players")
local ReplicatedStorage = game:GetService("ReplicatedStorage")
local RunService = game:GetService("RunService")
local SoundService = game:GetService("SoundService")
local TweenService = game:GetService("TweenService")

local CameraFx = require(script.Parent.CameraFx)
local CombatConfig = require(ReplicatedStorage.Shared.Combat.CombatConfig)

export type HitInfo = {
	Attacker: Model?,
	Victim: Model,
	Weight: string,
	Damage: number,
	Position: Vector3,
	IFrames: number,
	Headshot: boolean,
	Killed: boolean,
	Kind: string,
}

local player = Players.LocalPlayer
local feedback = CombatConfig.Feedback
local rng = Random.new()

local HitFeedback = {}

---------------------------------------------------------------------------------------------
-- Animation time: hitstop (speed 0) and slow motion (speed x scale), per track, without
-- fighting each other. Each track remembers its real speed until every effect has ended.

type Dilation = { base: number, freezeUntil: number, slowUntil: number, slowScale: number }
local dilated: { [AnimationTrack]: Dilation } = {}
local dilationConnection: RBXScriptConnection? = nil

local function animatorOf(model: Model?): Animator?
	if not model then
		return nil
	end
	local controller: Instance? = model:FindFirstChildOfClass("Humanoid")
		or model:FindFirstChildOfClass("AnimationController")
	return if controller then controller:FindFirstChildOfClass("Animator") else nil
end

local function updateDilation()
	local now = os.clock()
	for track, d in dilated do
		if not track.IsPlaying then
			dilated[track] = nil
		elseif now >= d.freezeUntil and now >= d.slowUntil then
			track:AdjustSpeed(d.base)
			dilated[track] = nil
		else
			local speed = if now < d.freezeUntil then 0 else d.base * d.slowScale
			if track.Speed ~= speed then
				track:AdjustSpeed(speed)
			end
		end
	end
	if next(dilated) == nil and dilationConnection then
		dilationConnection:Disconnect()
		dilationConnection = nil
	end
end

local function dilate(models: { Model? }, freezeSeconds: number, slowSeconds: number, slowScale: number)
	if freezeSeconds <= 0 and slowSeconds <= 0 then
		return
	end
	local now = os.clock()
	for _, model in models do
		local animator = animatorOf(model)
		if animator then
			for _, track in animator:GetPlayingAnimationTracks() do
				local d = dilated[track]
				if not d then
					d = { base = track.Speed, freezeUntil = 0, slowUntil = 0, slowScale = 1 }
					dilated[track] = d
				end
				d.freezeUntil = math.max(d.freezeUntil, now + freezeSeconds)
				if slowSeconds > 0 then
					d.slowUntil = math.max(d.slowUntil, now + slowSeconds)
					d.slowScale = slowScale
				end
			end
		end
	end
	if not dilationConnection then
		dilationConnection = RunService.RenderStepped:Connect(updateDilation)
	end
	updateDilation()
end

---------------------------------------------------------------------------------------------
-- Flash

local flashes: { [Model]: Highlight } = {}
local flashCount = 0

local function flash(model: Model, seconds: number, color: Color3)
	if seconds <= 0 then
		return
	end
	local highlight = flashes[model]
	if not highlight then
		if flashCount >= feedback.MaxFlashes then
			return
		end
		local h = Instance.new("Highlight")
		h.Name = "HitFlash"
		h.DepthMode = Enum.HighlightDepthMode.Occluded
		h.OutlineTransparency = 1
		h.Adornee = model
		h.Parent = model
		flashes[model] = h
		flashCount += 1
		highlight = h
	end
	local h = highlight :: Highlight
	h.FillColor = color
	h.FillTransparency = 0.15
	local token = (h:GetAttribute("Token") or 0) + 1
	h:SetAttribute("Token", token)
	task.delay(seconds, function()
		if h:GetAttribute("Token") == token then
			flashes[model] = nil
			flashCount -= 1
			h:Destroy()
		end
	end)
end

---------------------------------------------------------------------------------------------
-- Sound

local soundCache: { [string]: Sound } = {}

-- 2D (always heard, for the local player's own important moments).
function HitFeedback.PlayLocal(soundId: string, pitch: number?)
	if soundId == "" then
		return
	end
	local sound = soundCache[soundId]
	if not sound then
		local s = Instance.new("Sound")
		s.SoundId = soundId
		s.Parent = SoundService
		soundCache[soundId] = s
		sound = s
	end
	local s = sound :: Sound
	s.PlaybackSpeed = (pitch or 1) * (1 + rng:NextNumber(-0.06, 0.06))
	SoundService:PlayLocalSound(s)
end

-- 3D at a position, with pitch variation so repeats don't sound robotic.
function HitFeedback.PlayAt(soundId: string, position: Vector3, pitch: number?, volume: number?)
	if soundId == "" then
		return
	end
	local attachment = Instance.new("Attachment")
	attachment.WorldPosition = position
	attachment.Parent = workspace.Terrain
	local sound = Instance.new("Sound")
	sound.SoundId = soundId
	sound.Volume = volume or 0.8
	sound.RollOffMinDistance = 10
	sound.RollOffMaxDistance = 150
	sound.PlaybackSpeed = (pitch or 1) * (1 + rng:NextNumber(-0.07, 0.07))
	sound.Parent = attachment
	sound:Play()
	task.delay(4, function()
		attachment:Destroy()
	end)
end

---------------------------------------------------------------------------------------------
-- Damage numbers

local numberCount = 0
local damageNumbersEnabled = feedback.DamageNumbers

local function damageNumber(position: Vector3, damage: number, scale: number, headshot: boolean, killed: boolean)
	if not damageNumbersEnabled or numberCount >= feedback.MaxDamageNumbers or damage <= 0 then
		return
	end
	local playerGui = player:FindFirstChildOfClass("PlayerGui")
	if not playerGui then
		return
	end
	numberCount += 1

	local anchor = Instance.new("Attachment")
	anchor.WorldPosition = position + Vector3.new(rng:NextNumber(-1, 1), 1.5, rng:NextNumber(-1, 1))
	anchor.Parent = workspace.Terrain

	local gui = Instance.new("BillboardGui")
	gui.Adornee = anchor
	gui.AlwaysOnTop = true
	gui.Size = UDim2.fromOffset(math.floor(110 * scale), math.floor(44 * scale))
	gui.LightInfluence = 0
	gui.Parent = playerGui

	local label = Instance.new("TextLabel")
	label.BackgroundTransparency = 1
	label.Size = UDim2.fromScale(1, 1)
	label.Font = Enum.Font.GothamBlack
	label.TextScaled = true
	label.Text = if damage % 1 == 0 then tostring(damage) else string.format("%.1f", damage)
	label.TextColor3 = if killed
		then Color3.fromRGB(255, 80, 80)
		elseif headshot then Color3.fromRGB(255, 210, 60)
		else Color3.new(1, 1, 1)
	label.TextStrokeTransparency = 0.3
	label.Parent = gui

	local info = TweenInfo.new(0.7, Enum.EasingStyle.Quad, Enum.EasingDirection.Out)
	TweenService:Create(gui, info, { StudsOffset = Vector3.new(0, 2.5, 0) }):Play()
	TweenService:Create(label, TweenInfo.new(0.35, Enum.EasingStyle.Linear, Enum.EasingDirection.In, 0, false, 0.35), {
		TextTransparency = 1,
		TextStrokeTransparency = 1,
	}):Play()
	task.delay(0.75, function()
		numberCount -= 1
		gui:Destroy()
		anchor:Destroy()
	end)
end

---------------------------------------------------------------------------------------------
-- Invulnerability blink

local blinking: { [Model]: number } = {}

local function blink(model: Model, seconds: number)
	local untilTime = os.clock() + seconds
	if blinking[model] then
		blinking[model] = math.max(blinking[model], untilTime)
		return
	end
	blinking[model] = untilTime
	task.spawn(function()
		local visible = false
		while blinking[model] and os.clock() < blinking[model] and model.Parent do
			for _, part in model:GetDescendants() do
				if part:IsA("BasePart") and part.Name ~= "HumanoidRootPart" then
					part.LocalTransparencyModifier = if visible then 0 else 0.6
				end
			end
			visible = not visible
			task.wait(feedback.IFrameBlinkInterval)
		end
		blinking[model] = nil
		for _, part in model:GetDescendants() do
			if part:IsA("BasePart") and part.Name ~= "HumanoidRootPart" then
				part.LocalTransparencyModifier = 0
			end
		end
	end)
end

---------------------------------------------------------------------------------------------
-- Slow motion (cosmetic: Roblox has no global time scale)

local correction: ColorCorrectionEffect? = nil

function HitFeedback.SlowMo(seconds: number, scale: number, models: { Model? })
	if seconds <= 0 then
		return
	end
	dilate(models, 0, seconds, scale)
	CameraFx.FovPunch(4)
	if not correction then
		local c = Instance.new("ColorCorrectionEffect")
		c.Name = "CombatSlowMo"
		c.Parent = Lighting
		correction = c
	end
	local c = correction :: ColorCorrectionEffect
	TweenService:Create(c, TweenInfo.new(0.08), { Saturation = -0.35, Contrast = 0.15 }):Play()
	task.delay(seconds, function()
		TweenService:Create(c, TweenInfo.new(0.2), { Saturation = 0, Contrast = 0 }):Play()
	end)
end

---------------------------------------------------------------------------------------------

local predicted: { [Model]: number } = {}
local WHITE = Color3.new(1, 1, 1)
local HURT = Color3.fromRGB(255, 70, 70)

function HitFeedback.Play(info: HitInfo, mode: "predicted" | "confirmed")
	local weight = CombatConfig.HitWeights[info.Weight]
	if not weight or not info.Victim then
		return
	end
	local victim = info.Victim
	local attacker = info.Attacker
	local myCharacter = player.Character
	local iAmAttacker = myCharacter ~= nil and attacker == myCharacter
	local iAmVictim = myCharacter ~= nil and victim == myCharacter
	local now = os.clock()

	local predictedAt = predicted[victim]
	local alreadyPlayed = mode == "confirmed" and iAmAttacker and predictedAt ~= nil and now - predictedAt < 1
	if mode == "predicted" then
		predicted[victim] = now
	end

	if not alreadyPlayed then
		dilate({ attacker, victim }, weight.Hitstop, 0, 1)
		flash(victim, weight.Flash, if iAmVictim then HURT else WHITE)
		HitFeedback.PlayAt((CombatConfig.Sounds.Hit :: any)[info.Weight] or "", info.Position, weight.SoundPitch)

		if iAmAttacker then
			CameraFx.AddTrauma(weight.Shake)
			CameraFx.FovPunch(weight.FovPunch)
		elseif iAmVictim then
			CameraFx.AddTrauma(weight.Shake * feedback.VictimShakeMultiplier)
			CameraFx.FovPunch(weight.FovPunch)
		elseif weight.Shake >= 0.6 and myCharacter and myCharacter.PrimaryPart then
			local distance = (myCharacter.PrimaryPart.Position - info.Position).Magnitude
			local falloff = 1 - math.clamp(distance / feedback.BystanderShakeRange, 0, 1)
			CameraFx.AddTrauma(weight.Shake * 0.5 * falloff)
		end
	end

	if mode == "confirmed" then
		predicted[victim] = nil
		damageNumber(info.Position, info.Damage, weight.NumberScale, info.Headshot, info.Killed)
		if info.IFrames > 0 then
			blink(victim, info.IFrames)
		end
		if iAmAttacker and info.Killed then
			HitFeedback.PlayLocal(CombatConfig.Sounds.Kill)
		end
	end
end

-- Accessibility: 0 turns camera shake off.
function HitFeedback.SetShakeScale(scale: number)
	CameraFx.SetShakeScale(scale)
end

-- Player setting: show or hide damage numbers.
function HitFeedback.SetDamageNumbers(enabled: boolean)
	damageNumbersEnabled = enabled
end

-- Validates a CombatHit payload from the server into a HitInfo (models may be streamed out).
function HitFeedback.FromServer(raw: unknown): HitInfo?
	if typeof(raw) ~= "table" then
		return nil
	end
	local t = raw :: any
	if typeof(t.Victim) ~= "Instance" or not t.Victim:IsA("Model") or typeof(t.Weight) ~= "string" then
		return nil
	end
	return {
		Attacker = if typeof(t.Attacker) == "Instance" and t.Attacker:IsA("Model") then t.Attacker else nil,
		Victim = t.Victim,
		Weight = t.Weight,
		Damage = if typeof(t.Damage) == "number" then t.Damage else 0,
		Position = if typeof(t.Position) == "Vector3" then t.Position else t.Victim:GetPivot().Position,
		IFrames = if typeof(t.IFrames) == "number" then t.IFrames else 0,
		Headshot = t.Headshot == true,
		Killed = t.Killed == true,
		Kind = if typeof(t.Kind) == "string" then t.Kind else "Melee",
	}
end

return HitFeedback
