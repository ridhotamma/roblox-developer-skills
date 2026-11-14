-- Tests for the shooter modules (AimCamera, WeaponState, Ballistics, CameraFx), in plain Luau.
--
--   node tests/run-luau.cjs            (from the skill folder; bundles RobloxShim + the kit)
--
-- In Studio: put this in a Script (Run mode), add `local Shared = game.ReplicatedStorage.Shared`
-- at the top and remove the CameraFx section (it needs a render loop). Nothing else here uses
-- workspace: walls are a fake `cast` function, so it runs the same in Studio and the CLI.
--
-- The browser lab (examples/roblox-combat) runs 33 more scenarios and checks every number it
-- shows against these modules; this file is the quick Luau-only safety net.

local AimCamera = require(Shared.Combat.AimCamera)
local Ballistics = require(Shared.Combat.Ballistics)
local CombatConfig = require(Shared.Combat.CombatConfig)
local WeaponState = require(Shared.Combat.WeaponState)

local passed, failed = 0, 0
local function check(name: string, condition: any, detail: any?)
	if condition then
		passed += 1
	else
		failed += 1
		print(`FAIL {name}{if detail then " (" .. tostring(detail) .. ")" else ""}`)
	end
end
local function near(a: number, b: number, tolerance: number): boolean
	return math.abs(a - b) <= tolerance
end

local DT = 1 / 60
local CAM = CombatConfig.Camera
local ROOT = Vector3.new(0, 3, 0)

-- A wall plane at z = `z` (facing +Z): sphere casts stop `radius` before it.
local function wallBehind(z: number)
	return function(origin: Vector3, direction: Vector3, radius: number): number?
		if direction.Z <= 0 then
			return nil
		end
		local distance = (z - radius - origin.Z) / direction.Unit.Z
		return if distance >= 0 and distance <= direction.Magnitude then distance else nil
	end
end

---------------------------------------------------------------------------------------------
-- AimCamera: first person

do
	local cam = AimCamera.new(CAM, "First")
	local cf, fov = cam:Update(DT, ROOT)
	check("first person: camera at the eyes", (cf.Position - (ROOT + Vector3.new(0, CAM.First.Height, 0))).Magnitude < 1e-9)
	check("first person: hip FOV", near(fov, CAM.First.Fov, 1e-9))
	check("first person: body hidden", cam:HideCharacter())
	check("first person: body faces the aim", cam:CharacterYaw(123, DT) == cam.Yaw)

	cam:Look(100, 0)
	check("mouse right turns right (yaw down)", near(cam.Yaw, -100 * CAM.Sensitivity, 1e-9), cam.Yaw)
	cam:Look(0, -100000)
	check("pitch clamps up", cam.Pitch == CAM.PitchMax)
	cam:Look(0, 100000)
	check("pitch clamps down", cam.Pitch == CAM.PitchMin)
	cam:Look(5000, 0)
	check("yaw wraps to [-180, 180)", cam.Yaw >= -180 and cam.Yaw < 180, cam.Yaw)

	cam:SetAiming(true)
	for _ = 1, 15 do
		cf, fov = cam:Update(DT, ROOT)
	end
	check("aim: FOV within 1° of the ADS FOV after 0.25 s", near(fov, CAM.First.AimFov, 1), fov)
	local yaw = cam.Yaw
	cam:Look(-100, 0)
	check("aim: slower look", near(cam.Yaw - yaw, 100 * CAM.Sensitivity * CAM.AimSensitivityScale, 1e-6))
end

---------------------------------------------------------------------------------------------
-- AimCamera: third person over the shoulder

do
	local cam = AimCamera.new(CAM, "Third")
	local cf, fov = cam:Update(DT, ROOT)
	local localChest = cf:PointToObjectSpace(ROOT)
	check("third person: camera behind", near(cam.Distance, CAM.Third.Distance, 1e-9))
	check("third person: right shoulder (character left of the crosshair)", localChest.X < -1, localChest.X)
	check("third person: camera looks parallel to the aim", (cf.LookVector - cam:Rotation().LookVector).Magnitude < 1e-9)
	check("third person: hip FOV", near(fov, CAM.Third.Fov, 1e-9))
	check("third person: aim skip reaches the character", near(cam:AimSkip(), CAM.Third.Distance, 1e-6), cam:AimSkip())
	check("third person: free run when not aiming", cam:CharacterYaw(0, DT) == nil)

	cam:SetAiming(true)
	for _ = 1, 30 do
		cf, fov = cam:Update(DT, ROOT)
	end
	check("aim: pulls in to the aim distance", near(cam.Distance, CAM.ThirdAim.Distance, 0.05), cam.Distance)
	check("aim: aim FOV", near(fov, CAM.ThirdAim.Fov, 0.2), fov)
	cam.Yaw = 90
	local turned = cam:CharacterYaw(0, DT)
	check("aim: body turns toward the aim at TurnSpeed", turned ~= nil and near(turned, CAM.TurnSpeed * DT, 1e-6), turned)

	cam:SwapShoulder()
	for _ = 1, 40 do
		cam:Update(DT, ROOT)
	end
	check("swap: left shoulder", near(cam.Shoulder, -CAM.ThirdAim.Shoulder, 0.02), cam.Shoulder)

	-- A wall 2.5 studs behind: the camera pulls in at once and stays in front of it.
	local cam2 = AimCamera.new(CAM, "Third")
	cam2:Update(DT, ROOT)
	local cf2 = cam2:Update(DT, ROOT, wallBehind(2.5))
	check("wall behind: pulled in the same frame", cf2.Position.Z <= 2.5 - CAM.CollisionRadius + 1e-6, cf2.Position.Z)
	local before = cam2.Distance
	cam2:Update(DT, ROOT)
	check("wall gone: eases out, no pop", near(cam2.Distance - before, CAM.PushOutSpeed * DT, 1e-6))

	-- Toggle: third -> first -> third eases back out from the head.
	cam2:ToggleMode()
	check("toggle to first", cam2.Mode == "First")
	cam2:Update(DT, ROOT)
	cam2:ToggleMode()
	cam2:Update(DT, ROOT)
	check("toggle back: starts close", cam2.Distance <= CAM.PushOutSpeed * DT + 1e-9, cam2.Distance)

	-- Gamepad stick: deadzone and full tilt.
	local cam3 = AimCamera.new(CAM, "Third")
	cam3:Stick(CAM.GamepadDeadzone * 0.9, 0, 1)
	check("stick: deadzone ignores drift", cam3.Yaw == 0)
	cam3:Stick(1, 0, 0.25)
	check("stick: full tilt speed", near(cam3.Yaw, -CAM.GamepadSpeed * 0.25, 1e-9), cam3.Yaw)
end

---------------------------------------------------------------------------------------------
-- WeaponState

local function fireFor(gun: any, seconds: number, dt: number): number
	local shots = 0
	gun:Press(0)
	for i = 0, math.floor(seconds / dt + 0.5) - 1 do
		if gun:Step(i * dt, dt) == "Fire" then
			shots += 1
		end
	end
	gun:Release()
	return shots
end

do
	local rifle = CombatConfig.Weapons.Rifle
	for _, fps in { 30, 60, 144 } do
		local gun = WeaponState.new(table.clone(rifle), CombatConfig.FireBuffer)
		gun.Magazine = 1000
		local shots = fireFor(gun, 3, 1 / fps)
		check(`auto: {rifle.Rpm} RPM held at {fps} FPS`, math.abs(shots - rifle.Rpm / 20) <= 1, shots)
	end

	local pistol = WeaponState.new(CombatConfig.Weapons.Pistol, CombatConfig.FireBuffer)
	check("semi: holding fires once", fireFor(pistol, 1, DT) == 1)
	pistol:Press(2)
	pistol:Release() -- a click between two frames
	check("semi: a click between frames still fires", pistol:Step(2 + DT, DT) == "Fire")
	pistol:Press(2.1) -- 0.05 s before ready: buffered
	pistol:Release()
	local fired = false
	for i = 1, 12 do
		if pistol:Step(2.1 + i * DT, DT) == "Fire" then
			fired = true
		end
	end
	check("semi: an early click within the buffer fires when ready", fired)

	local burst = table.clone(CombatConfig.Weapons.Rifle)
	burst.Mode = "Burst"
	local b = WeaponState.new(burst)
	b:Press(0)
	b:Release()
	local count = 0
	for i = 0, 40 do
		if b:Step(i * DT, DT) == "Fire" then
			count += 1
		end
	end
	check("burst: a tap fires 3", count == 3, count)

	local shotgun = WeaponState.new(CombatConfig.Weapons.Shotgun)
	shotgun:SetAmmo(0, 3)
	shotgun:Press(0)
	check("empty: dry click", shotgun:Step(0, DT) == "Empty")
	check("empty: one click per press", shotgun:Step(DT, DT) == nil)
	check("reload starts", shotgun:StartReload(0))
	check("reload can't double-start", not shotgun:StartReload(0.1))
	shotgun:Press(0.2)
	check("no firing while reloading", shotgun:Step(0.2, DT) == nil)
	check("reload finishes", shotgun:Step(CombatConfig.Weapons.Shotgun.ReloadSeconds, DT) == "Reloaded")
	check("reload moves only what's in reserve", shotgun.Magazine == 3 and shotgun.Reserve == 0)
	check("full reserve-less reload refused", not shotgun:StartReload(5))

	local swap = WeaponState.new(CombatConfig.Weapons.Rifle)
	swap:SetAmmo(5, 50)
	swap:StartReload(0)
	swap:Unequip()
	check("unequip cancels the reload", not swap:IsReloading() and swap:Step(10, DT) == nil and swap.Magazine == 5)

	local bloom = WeaponState.new(table.clone(rifle))
	bloom.Magazine = 1000
	fireFor(bloom, 2, DT)
	check("bloom builds under sustained fire", near(bloom.Bloom, rifle.BloomMax, 1e-9), bloom.Bloom)
	check("aimed spread is tighter", bloom:Spread(false) > (function()
		bloom:SetAiming(true)
		return bloom:Spread(false)
	end)())

	-- Server gate: honest jittery stream accepted, spam capped.
	local state = { magazine = 1e9, reserve = 0, reloadingUntil = 0, nextShot = 0 }
	local rng = Random.new(5)
	local accepted, arrival = 0, 0
	for k = 0, 39 do
		arrival = math.max(arrival, k * 0.1 + rng:NextNumber(0, 0.08))
		if WeaponState.ServerFire(state, rifle, arrival, CombatConfig.FireJitterTolerance) then
			accepted += 1
		end
	end
	check("server: honest jittery shots all accepted", accepted == 40, accepted)
	local spam = { magazine = 1e9, reserve = 0, reloadingUntil = 0, nextShot = 0 }
	local spamAccepted = 0
	for k = 0, 499 do
		if WeaponState.ServerFire(spam, rifle, k * 0.01, CombatConfig.FireJitterTolerance) then
			spamAccepted += 1
		end
	end
	check("server: 10x spam held to the rate", spamAccepted <= 53, spamAccepted)
end

---------------------------------------------------------------------------------------------
-- Ballistics

do
	local rng = Random.new(9)
	local forward = Vector3.new(0, 0, -1)
	local worst = 0
	for _ = 1, 500 do
		local d = Ballistics.Spread(forward, 3, rng)
		worst = math.max(worst, math.deg(math.acos(math.min(1, d:Dot(forward)))))
	end
	check("spread stays inside the cone", worst <= 3 + 1e-6, worst)
	check("falloff: full before start", Ballistics.Falloff(10, CombatConfig.Weapons.Pistol) == 1)
	check("falloff: min after end", near(Ballistics.Falloff(500, CombatConfig.Weapons.Pistol), CombatConfig.Weapons.Pistol.FalloffMin, 1e-9))

	-- Aim skip: something between the camera and the character is ignored.
	local camera = CFrame.new(0, 5, 10)
	local bushAt = function(origin: Vector3, direction: Vector3): Vector3?
		-- a bush at z = 5 (between the camera and the player at z = 0), a target at z = -40
		for _, z in { 5, -40 } do
			local t = (z - origin.Z) / direction.Z
			if t >= 0 and t <= 1 then
				return origin + direction * t
			end
		end
		return nil
	end
	check("aim from the camera hits the bush", near(Ballistics.AimFrom(camera, 400, 0, bushAt).Z, 5, 1e-9))
	check("aim skipping to the character hits the target", near(Ballistics.AimFrom(camera, 400, 10, bushAt).Z, -40, 1e-9))
	check("obstruction: blocked muzzle reported", Ballistics.Obstruction(Vector3.new(0, 5, 8), Vector3.new(0, 5, -40), bushAt) ~= nil)
	check("obstruction: clear line is nil", Ballistics.Obstruction(Vector3.new(0, 5, 2), Vector3.new(0, 5, -40), bushAt) == nil)
end

---------------------------------------------------------------------------------------------
-- CameraFx (CLI only: needs the shim's render loop)

do
	local CameraFx = require(ClientRoot.Combat.CameraFx)
	local camera = workspace.CurrentCamera
	CameraFx.SetFovOwned(true)
	CameraFx.Recoil(2, 0, 10)
	camera.CFrame = CFrame.identity
	camera.FieldOfView = 50
	RunService.RenderFrame(DT)
	check("recoil kicks the camera up", camera.CFrame.LookVector.Y > 0)
	check("FOV owned by the camera controller is kept", near(camera.FieldOfView, 50, 1e-9), camera.FieldOfView)
	for _ = 1, 60 do
		camera.CFrame = CFrame.identity
		RunService.RenderFrame(DT)
	end
	check("recoil recovers", math.abs(camera.CFrame.LookVector.Y) < 1e-3, camera.CFrame.LookVector.Y)
	CameraFx.FovPunch(4)
	camera.FieldOfView = 50
	RunService.RenderFrame(DT)
	check("FOV punch narrows the owned FOV", camera.FieldOfView < 50 and camera.FieldOfView > 45, camera.FieldOfView)
end

print(`{passed} passed, {failed} failed`)
