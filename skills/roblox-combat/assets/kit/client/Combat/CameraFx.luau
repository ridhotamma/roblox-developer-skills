--!strict
-- Camera feedback, applied every frame right after Roblox's camera has updated:
--   * shake: trauma model (each hit adds trauma 0-1; shake = trauma^2 of Perlin noise; decays)
--   * recoil: a spring offset that kicks up/sideways per shot and recovers; shots fired that
--     frame aim with the recoiled camera, so recoil really moves your aim
--   * FOV: owns Camera.FieldOfView: a base FOV (eased, for aiming down sights) minus a punch
--
-- The default camera rebuilds its CFrame every frame, so these offsets never accumulate.

local RunService = game:GetService("RunService")

local MAX_ANGLE = 3 -- degrees of shake at trauma 1
local MAX_OFFSET = 0.25 -- studs of shake at trauma 1
local FREQUENCY = 18
local TRAUMA_DECAY = 1.6 -- per second
local FOV_PUNCH_DECAY = 14
local FOV_EASE = 12

local CameraFx = {
	-- Fire inside this render step (after CameraFx) to aim with the recoiled camera.
	RenderPriority = Enum.RenderPriority.Camera.Value + 2,
	DefaultFov = nil :: number?, -- the FOV before any aiming, captured on first use
}

local trauma = 0
local shakeScale = 1
local recoilPitch, recoilYaw = 0, 0
local recoilStiffness = 10
local fovPunch = 0
local baseFov: number? = nil
local targetFov: number? = nil
local bound = false

local function step(dt: number)
	local camera = workspace.CurrentCamera
	if not camera then
		return
	end
	baseFov = baseFov or camera.FieldOfView
	targetFov = targetFov or baseFov

	local offset = CFrame.identity
	if trauma > 0 then
		local amount = trauma * trauma
		local t = os.clock() * FREQUENCY
		local pitch = math.noise(t, 1.7) * MAX_ANGLE * amount
		local yaw = math.noise(t, 3.1) * MAX_ANGLE * amount
		local roll = math.noise(t, 5.3) * MAX_ANGLE * amount * 0.5
		local x = math.noise(t, 7.9) * MAX_OFFSET * amount
		local y = math.noise(t, 9.2) * MAX_OFFSET * amount
		offset = CFrame.new(x, y, 0) * CFrame.Angles(math.rad(pitch), math.rad(yaw), math.rad(roll))
		trauma = math.max(0, trauma - TRAUMA_DECAY * dt)
	end

	if recoilPitch ~= 0 or recoilYaw ~= 0 then
		offset = CFrame.Angles(math.rad(recoilPitch), math.rad(recoilYaw), 0) * offset
		local keep = math.exp(-recoilStiffness * dt)
		recoilPitch *= keep
		recoilYaw *= keep
		if math.abs(recoilPitch) < 0.01 and math.abs(recoilYaw) < 0.01 then
			recoilPitch, recoilYaw = 0, 0
		end
	end

	if offset ~= CFrame.identity then
		camera.CFrame = camera.CFrame * offset
	end

	local base = baseFov :: number
	base += ((targetFov :: number) - base) * math.min(1, dt * FOV_EASE)
	baseFov = base
	fovPunch *= math.exp(-FOV_PUNCH_DECAY * dt)
	camera.FieldOfView = base - fovPunch
end

local function ensureBound()
	if not bound then
		bound = true
		RunService:BindToRenderStep("CombatCameraFx", Enum.RenderPriority.Camera.Value + 1, step)
	end
end

-- Adds shake (0-1). Scaled by the player's shake setting.
function CameraFx.AddTrauma(amount: number)
	if amount <= 0 or shakeScale <= 0 then
		return
	end
	trauma = math.min(1, trauma + amount * shakeScale)
	ensureBound()
end

-- Kicks the aim: `up` and `side` in degrees, recovering with `stiffness` (higher = faster).
function CameraFx.Recoil(up: number, side: number, stiffness: number)
	recoilPitch += up
	recoilYaw += side
	recoilStiffness = stiffness
	ensureBound()
end

-- Narrows the FOV by `degrees` for a moment.
function CameraFx.FovPunch(degrees: number)
	if degrees <= 0 then
		return
	end
	fovPunch = math.max(fovPunch, degrees * math.max(shakeScale, 0.3))
	ensureBound()
end

-- Eases the base FOV (aim down sights). Call with nil to return to the default.
function CameraFx.SetBaseFov(fov: number?)
	ensureBound()
	local camera = workspace.CurrentCamera
	if not baseFov and camera then
		baseFov = camera.FieldOfView
	end
	CameraFx.DefaultFov = CameraFx.DefaultFov or baseFov
	targetFov = fov or CameraFx.DefaultFov
end

-- 0 = no shake (accessibility setting), 1 = default.
function CameraFx.SetShakeScale(scale: number)
	shakeScale = math.clamp(scale, 0, 2)
end

return CameraFx
