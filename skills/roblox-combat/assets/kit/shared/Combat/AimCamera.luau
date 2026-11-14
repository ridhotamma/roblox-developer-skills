--!strict
-- Shooter camera maths: first person, and third person over the shoulder (the Resident Evil 4 /
-- The Last of Us / GTA camera: the character sits left or right of the crosshair, the camera
-- looks parallel to the aim, and aiming pulls it in tight to the shoulder with a narrower FOV).
--
-- Pure: no services, no Instances. CameraController feeds it input and the character's root
-- position and writes the result to workspace.CurrentCamera; the tests run it in the luau CLI.
--
--   local cam = AimCamera.new(CombatConfig.Camera)
--   cam:Look(dx, dy)                         -- mouse / touch pixels
--   cam:Stick(x, y, dt)                      -- gamepad right stick
--   local cf, fov = cam:Update(dt, rootPosition, cast)
--
-- `cast(origin, direction, radius)` sweeps a sphere and returns how far its centre travels along
-- `direction` before touching something (nil = clear). In Roblox that's workspace:Spherecast.

export type CastFn = (origin: Vector3, direction: Vector3, radius: number) -> number?
export type Mode = "Third" | "First"

local AimCamera = {}
AimCamera.__index = AimCamera

export type AimCamera = typeof(setmetatable(
	{} :: {
		Config: any,
		Mode: Mode,
		Yaw: number, -- degrees; 0 looks down -Z, positive turns left
		Pitch: number, -- degrees; positive looks up
		Aiming: boolean,
		AimBlend: number, -- 0 = hip, 1 = fully aimed
		Side: number, -- 1 = right shoulder, -1 = left
		SideBlend: number, -- eases between -1 and 1 when the shoulder swaps
		Distance: number, -- current camera distance behind the shoulder (after walls)
		Shoulder: number, -- current sideways offset (after walls), signed
		FaceTimer: number,
		Focus: Vector3, -- the pivot the camera orbits (above the root)
		CFrame: CFrame,
		Fov: number,
	},
	AimCamera
))

local function lerp(a: number, b: number, t: number): number
	return a + (b - a) * t
end

-- Exponential ease that behaves the same at any frame rate.
local function ease(current: number, target: number, rate: number, dt: number): number
	return target + (current - target) * math.exp(-rate * dt)
end

local function wrap(degrees: number): number
	return (degrees + 180) % 360 - 180
end

function AimCamera.new(config: any, mode: Mode?): AimCamera
	local self = setmetatable({
		Config = config,
		Mode = mode or config.StartMode or "Third",
		Yaw = 0,
		Pitch = 0,
		Aiming = false,
		AimBlend = 0,
		Side = 1,
		SideBlend = 1,
		Distance = config.Third.Distance,
		Shoulder = config.Third.Shoulder,
		FaceTimer = 0,
		Focus = Vector3.zero,
		CFrame = CFrame.identity,
		Fov = config.Third.Fov,
	}, AimCamera)
	return self
end

function AimCamera.LookScale(self: AimCamera): number
	return if self.Aiming then self.Config.AimSensitivityScale else 1
end

-- Turn by a mouse or touch drag in pixels (right/down positive, as Roblox reports deltas).
function AimCamera.Look(self: AimCamera, dx: number, dy: number, touch: boolean?)
	local config = self.Config
	local sensitivity = (if touch then config.TouchSensitivity else config.Sensitivity) * self:LookScale()
	self.Yaw = wrap(self.Yaw - dx * sensitivity)
	self.Pitch = math.clamp(self.Pitch - dy * sensitivity, config.PitchMin, config.PitchMax)
end

-- Turn by the gamepad's right stick (x right, y up, each -1..1), with a radial deadzone and a
-- response curve so small tilts give fine control.
function AimCamera.Stick(self: AimCamera, x: number, y: number, dt: number)
	local config = self.Config
	local magnitude = math.sqrt(x * x + y * y)
	if magnitude <= config.GamepadDeadzone then
		return
	end
	local strength = math.clamp((magnitude - config.GamepadDeadzone) / (1 - config.GamepadDeadzone), 0, 1)
	local speed = strength ^ config.GamepadCurve * config.GamepadSpeed * self:LookScale() * dt
	self.Yaw = wrap(self.Yaw - x / magnitude * speed)
	self.Pitch = math.clamp(self.Pitch + y / magnitude * speed, config.PitchMin, config.PitchMax)
end

function AimCamera.SetAiming(self: AimCamera, aiming: boolean)
	self.Aiming = aiming
end

function AimCamera.SwapShoulder(self: AimCamera)
	self.Side = -self.Side
end

function AimCamera.SetMode(self: AimCamera, mode: Mode)
	if mode == self.Mode then
		return
	end
	self.Mode = mode
	if mode == "Third" then
		-- Start close and ease out, instead of popping 8 studs back in one frame.
		self.Distance = 0
		self.Shoulder = 0
	end
end

function AimCamera.ToggleMode(self: AimCamera)
	self:SetMode(if self.Mode == "Third" then "First" else "Third")
end

-- Call when a shot is fired: hip-fire turns the character to face the crosshair for a moment.
function AimCamera.Fired(self: AimCamera)
	self.FaceTimer = self.Config.FaceAimSeconds
end

-- Look direction as a rotation-only CFrame (yaw, then pitch; no roll).
function AimCamera.Rotation(self: AimCamera): CFrame
	return CFrame.fromEulerAnglesYXZ(math.rad(self.Pitch), math.rad(self.Yaw), 0)
end

-- How far along the look direction the character is from the camera. Aim rays start there, so
-- a post or a wall between the camera and the player can't eat the shot (third person).
function AimCamera.AimSkip(self: AimCamera): number
	local look = self.CFrame.LookVector
	return math.max(0, (self.Focus - self.CFrame.Position):Dot(look))
end

-- Advances blends and walls, returns the camera CFrame and field of view for this frame.
function AimCamera.Update(self: AimCamera, dt: number, rootPosition: Vector3, cast: CastFn?): (CFrame, number)
	local config = self.Config
	self.AimBlend = ease(self.AimBlend, if self.Aiming then 1 else 0, config.AimBlendSpeed, dt)
	self.SideBlend = ease(self.SideBlend, self.Side, config.ShoulderSwapSpeed, dt)
	self.FaceTimer = math.max(0, self.FaceTimer - dt)
	local rotation = self:Rotation()
	local a = self.AimBlend

	if self.Mode == "First" then
		local first = config.First
		self.Focus = rootPosition + Vector3.new(0, first.Height, 0)
		self.CFrame = CFrame.new(self.Focus) * rotation
		self.Fov = lerp(first.Fov, first.AimFov, a)
		return self.CFrame, self.Fov
	end

	local hip, aim = config.Third, config.ThirdAim
	local height = lerp(hip.Height, aim.Height, a)
	local wantDistance = lerp(hip.Distance, aim.Distance, a)
	local wantShoulder = lerp(hip.Shoulder, aim.Shoulder, a) * self.SideBlend
	local radius = config.CollisionRadius
	local pivot = rootPosition + Vector3.new(0, height, 0)
	self.Focus = pivot

	-- 1. Slide sideways to the shoulder; a wall on that side squeezes the offset.
	local sideSign = if wantShoulder < 0 then -1 else 1
	local sideLength = math.abs(wantShoulder)
	if cast and sideLength > 1e-3 then
		local hit = cast(pivot, rotation.RightVector * (sideSign * sideLength), radius)
		if hit then
			sideLength = math.min(sideLength, hit)
		end
	end
	self.Shoulder = sideSign * sideLength
	local shoulderPoint = pivot + rotation.RightVector * self.Shoulder

	-- 2. Back away from the shoulder along the look; a wall behind pulls the camera in at once,
	-- and when it stops blocking the camera eases back out.
	local allowed = wantDistance
	if cast then
		local hit = cast(shoulderPoint, rotation.LookVector * -wantDistance, radius)
		if hit then
			allowed = math.min(allowed, hit)
		end
	end
	if allowed < self.Distance then
		self.Distance = allowed
	else
		self.Distance = math.min(allowed, self.Distance + config.PushOutSpeed * dt)
	end

	self.CFrame = CFrame.new(shoulderPoint - rotation.LookVector * self.Distance) * rotation
	self.Fov = lerp(hip.Fov, aim.Fov, a)
	return self.CFrame, self.Fov
end

-- The yaw (degrees) the character should face this frame, or nil to let it turn freely with its
-- movement (Humanoid.AutoRotate). It faces the aim in first person, while aiming, and briefly
-- after a hip-fire shot, turning at most TurnSpeed degrees per second.
function AimCamera.CharacterYaw(self: AimCamera, currentYaw: number, dt: number): number?
	if self.Mode == "First" then
		return self.Yaw
	end
	if not self.Aiming and self.FaceTimer <= 0 then
		return nil
	end
	local delta = wrap(self.Yaw - currentYaw)
	local maxStep = self.Config.TurnSpeed * dt
	return wrap(currentYaw + math.clamp(delta, -maxStep, maxStep))
end

-- Hide the local character when the camera is inside or right next to it.
function AimCamera.HideCharacter(self: AimCamera): boolean
	return self.Mode == "First" or (self.CFrame.Position - self.Focus).Magnitude < 1.2
end

return table.freeze(AimCamera)
