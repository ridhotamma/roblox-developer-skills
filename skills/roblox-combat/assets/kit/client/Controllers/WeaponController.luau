--!strict
-- Guns and bows on the local player's client.
--
-- Equip a Tool with attribute Weapon = a key of CombatConfig.Weapons and an Attachment "Muzzle"
-- in its Handle. Then:
--   fire: left mouse / R2 / touch button   aim: right mouse / L2 / touch   reload: R / X / touch
--
-- The rules (fire modes, rate, click buffer, ammo, reload, bloom, recoil size) are WeaponState,
-- shared and tested in the luau CLI. Every shot, in the same frame: predicted ammo, camera
-- recoil, muzzle flash and smoke, fire sound, aim ray from the camera through the crosshair
-- (starting past the character in third person), spread, bullet from the muzzle toward the aim
-- point, tracer (or a visible projectile), predicted impact; then Fire(origin, direction) to the
-- server. Hit markers appear only for server-confirmed hits. With CameraController active,
-- aiming zooms the over-the-shoulder camera and a red dot shows when the muzzle is blocked.

local ContextActionService = game:GetService("ContextActionService")
local Players = game:GetService("Players")
local ReplicatedStorage = game:GetService("ReplicatedStorage")
local RunService = game:GetService("RunService")

local Ballistics = require(ReplicatedStorage.Shared.Combat.Ballistics)
local CameraController = require(script.Parent.CameraController)
local CameraFx = require(script.Parent.Parent.Combat.CameraFx)
local CombatConfig = require(ReplicatedStorage.Shared.Combat.CombatConfig)
local HitFeedback = require(script.Parent.Parent.Combat.HitFeedback)
local Net = require(ReplicatedStorage.Shared.Net)
local WeaponFx = require(script.Parent.Parent.Combat.WeaponFx)
local WeaponState = require(ReplicatedStorage.Shared.Combat.WeaponState)

type Equipped = { tool: Tool, name: string, stats: any, muzzle: Attachment, gun: WeaponState.WeaponState }

local player = Players.LocalPlayer
local rng = Random.new()

local WeaponController = {}

local current: Equipped? = nil
local aiming = false
-- One state per weapon name, so ammo and bloom survive swapping weapons.
local guns: { [string]: WeaponState.WeaponState } = {}

local function refreshAmmo()
	local eq = current
	if eq then
		WeaponFx.SetAmmo(eq.gun.Magazine, eq.gun.Reserve, eq.gun:IsReloading())
	end
end

local function reload()
	local eq = current
	if eq and eq.gun:StartReload(os.clock()) then
		HitFeedback.PlayLocal(CombatConfig.Sounds.Reload)
		Net.Event("Reload"):FireServer()
		refreshAmmo()
	end
end

local function setAiming(on: boolean)
	aiming = on
	if current then
		current.gun:SetAiming(on)
	end
	if CameraController.Active then
		CameraController.SetAiming(on)
	else
		CameraFx.SetBaseFov(if on then CombatConfig.AdsFov else nil)
	end
end

local function rayParams(character: Model): RaycastParams
	local params = RaycastParams.new()
	params.FilterType = Enum.RaycastFilterType.Exclude
	params.FilterDescendantsInstances = { character }
	return params
end

local function shoot(eq: Equipped, character: Model)
	local stats = eq.stats
	local gun = eq.gun
	local camera = workspace.CurrentCamera
	if not camera then
		return
	end
	refreshAmmo()
	local params = rayParams(character)

	-- Aim where the crosshair points (skipping the stretch behind the character in third
	-- person), fire from the muzzle.
	local aimPoint = Ballistics.AimPoint(camera, stats.Range, params, CameraController.AimSkip())
	local origin = eq.muzzle.WorldPosition
	local base = (aimPoint - origin).Unit
	local spread = gun.LastSpread

	-- Recoil and kick.
	CameraFx.Recoil(gun.LastRecoilUp, rng:NextNumber(-1, 1) * gun.LastRecoilSide, stats.RecoilRecovery)
	local heavy = stats.Weight == "GunHeavy"
	CameraFx.AddTrauma(if heavy then 0.18 else 0.06)
	WeaponFx.Muzzle(eq.muzzle, heavy)
	HitFeedback.PlayLocal((CombatConfig.Sounds.Fire :: any)[eq.name] or "")
	CameraController.Fired()

	local direction = Ballistics.Spread(base, spread, rng)
	if stats.Projectile then
		WeaponFx.Projectile(origin, direction * stats.ProjectileSpeed, stats.ProjectileGravity, stats.Range, params)
	else
		for pellet = 1, stats.Pellets do
			local dir = if pellet == 1 then direction else Ballistics.Spread(base, spread, rng)
			local result = workspace:Raycast(origin, dir * stats.Range, params)
			local endPoint = if result then result.Position else origin + dir * stats.Range
			if pellet == 1 or pellet % 2 == 0 then
				WeaponFx.Tracer(origin, endPoint)
			end
			if result then
				WeaponFx.Impact(result.Position, result.Normal, result.Material, result.Instance)
			end
		end
	end
	Net.Event("Fire"):FireServer(origin, direction)
end

local function step(dt: number)
	local eq = current
	if not eq then
		return
	end
	local gun = eq.gun
	local character = player.Character
	local humanoid = character and character:FindFirstChildOfClass("Humanoid")
	local alive = character ~= nil and humanoid ~= nil and humanoid.Health > 0
	local moving = humanoid ~= nil and humanoid.MoveDirection.Magnitude > 0.1
	WeaponFx.SetSpread(gun:Spread(moving))

	-- Show where the shot would really stop when the muzzle is blocked but the camera sees past.
	local camera = workspace.CurrentCamera
	if character and camera and CameraController.Active then
		local params = rayParams(character)
		local cast = function(origin: Vector3, direction: Vector3): Vector3?
			local result = workspace:Raycast(origin, direction, params)
			return if result then result.Position else nil
		end
		local aimPoint = Ballistics.AimFrom(camera.CFrame, eq.stats.Range, CameraController.AimSkip(), cast)
		WeaponFx.SetObstruction(Ballistics.Obstruction(eq.muzzle.WorldPosition, aimPoint, cast))
	end

	if not alive then
		gun:Release()
		return
	end
	local event = gun:Step(os.clock(), dt, moving)
	if event == "Fire" then
		shoot(eq, character :: Model)
	elseif event == "Empty" then
		HitFeedback.PlayLocal(CombatConfig.Sounds.Empty)
		reload()
	elseif event == "Reloaded" then
		refreshAmmo()
	end
end

local function bindInputs()
	ContextActionService:BindAction("WeaponFire", function(_, state)
		local eq = current
		if eq and state == Enum.UserInputState.Begin then
			eq.gun:Press(os.clock())
		elseif eq and (state == Enum.UserInputState.End or state == Enum.UserInputState.Cancel) then
			eq.gun:Release()
		end
		return Enum.ContextActionResult.Sink
	end, true, Enum.UserInputType.MouseButton1, Enum.KeyCode.ButtonR2)
	ContextActionService:SetTitle("WeaponFire", "Fire")
	ContextActionService:SetPosition("WeaponFire", UDim2.new(1, -150, 1, -150))

	ContextActionService:BindAction("WeaponAim", function(_, state)
		if state == Enum.UserInputState.Begin then
			setAiming(true)
		elseif state == Enum.UserInputState.End or state == Enum.UserInputState.Cancel then
			setAiming(false)
		end
		return Enum.ContextActionResult.Sink
	end, true, Enum.UserInputType.MouseButton2, Enum.KeyCode.ButtonL2)
	ContextActionService:SetTitle("WeaponAim", "Aim")
	ContextActionService:SetPosition("WeaponAim", UDim2.new(1, -230, 1, -110))

	ContextActionService:BindAction("WeaponReload", function(_, state)
		if state == Enum.UserInputState.Begin then
			reload()
		end
		return Enum.ContextActionResult.Sink
	end, true, Enum.KeyCode.R, Enum.KeyCode.ButtonX)
	ContextActionService:SetTitle("WeaponReload", "Reload")
	ContextActionService:SetPosition("WeaponReload", UDim2.new(1, -230, 1, -190))
end

local function unbindInputs()
	for _, name in { "WeaponFire", "WeaponAim", "WeaponReload" } do
		ContextActionService:UnbindAction(name)
	end
	if aiming then
		setAiming(false)
	end
	WeaponFx.SetObstruction(nil)
end

local function onToolChanged(character: Model)
	local tool = character:FindFirstChildOfClass("Tool")
	local name = tool and tool:GetAttribute("Weapon")
	local stats = if typeof(name) == "string" then (CombatConfig.Weapons :: any)[name] else nil
	local handle = tool and tool:FindFirstChild("Handle")
	local muzzle = handle and handle:FindFirstChild("Muzzle")

	if current and (not tool or tool ~= current.tool) then
		current.gun:Unequip() -- swapping weapons cancels a reload, on the server too
		current = nil
		unbindInputs()
		WeaponFx.ShowHud(false)
	end
	if tool and stats and not current then
		if not (muzzle and muzzle:IsA("Attachment")) then
			warn(`[WeaponController] {tool:GetFullName()} needs an Attachment named Muzzle in its Handle`)
			return
		end
		local gun = guns[name :: string]
		if not gun then
			gun = WeaponState.new(stats, CombatConfig.FireBuffer)
			guns[name :: string] = gun
		end
		current = { tool = tool, name = name :: string, stats = stats, muzzle = muzzle, gun = gun }
		bindInputs()
		WeaponFx.ShowHud(true)
		refreshAmmo()
	end
end

local function onCharacter(character: Model)
	character.ChildAdded:Connect(function(child)
		if child:IsA("Tool") then
			onToolChanged(character)
		end
	end)
	character.ChildRemoved:Connect(function(child)
		if child:IsA("Tool") then
			onToolChanged(character)
		end
	end)
	onToolChanged(character)
end

function WeaponController:Start()
	RunService:BindToRenderStep("WeaponStep", CameraFx.RenderPriority, step) -- after the camera and its recoil

	player.CharacterAdded:Connect(onCharacter)
	if player.Character then
		onCharacter(player.Character)
	end

	Net.Event("Ammo").OnClientEvent:Connect(function(name: unknown, mag: unknown, res: unknown)
		if typeof(name) == "string" and typeof(mag) == "number" and typeof(res) == "number" then
			local gun = guns[name]
			if gun then
				gun:SetAmmo(mag, res)
				refreshAmmo()
			end
		end
	end)

	-- Other players' shots: flash, tracer or projectile, 3D sound.
	local function onShotFired(shooter: unknown, name: unknown, origin: unknown, target: unknown)
		if shooter == player or typeof(name) ~= "string" then
			return
		end
		if typeof(origin) ~= "Vector3" or typeof(target) ~= "Vector3" then
			return
		end
		local stats = (CombatConfig.Weapons :: any)[name]
		if not stats then
			return
		end
		local isPlayer = typeof(shooter) == "Instance" and shooter:IsA("Player")
		local shooterCharacter = if isPlayer then (shooter :: Player).Character else nil
		local tool = shooterCharacter and shooterCharacter:FindFirstChildOfClass("Tool")
		local handle = tool and tool:FindFirstChild("Handle")
		local muzzle = handle and handle:FindFirstChild("Muzzle")
		if muzzle and muzzle:IsA("Attachment") then
			WeaponFx.Muzzle(muzzle, stats.Weight == "GunHeavy")
		end
		HitFeedback.PlayAt((CombatConfig.Sounds.Fire :: any)[name] or "", origin, 1, 1)
		if stats.Projectile then
			local params = RaycastParams.new()
			params.FilterType = Enum.RaycastFilterType.Exclude
			params.FilterDescendantsInstances = if shooterCharacter then { shooterCharacter } else {}
			local direction = (target - origin).Unit
			WeaponFx.Projectile(origin, direction * stats.ProjectileSpeed, stats.ProjectileGravity, stats.Range, params)
		else
			WeaponFx.Tracer(origin, target)
		end
	end
	Net.Unreliable("ShotFired").OnClientEvent:Connect(onShotFired)

	-- Hit markers for our confirmed gun hits.
	Net.Event("CombatHit").OnClientEvent:Connect(function(raw: unknown)
		local info = HitFeedback.FromServer(raw)
		if info and info.Kind == "Gun" and info.Attacker ~= nil and info.Attacker == player.Character then
			WeaponFx.HitMarker(info.Headshot, info.Killed)
			HitFeedback.PlayLocal(CombatConfig.Sounds.HitMarker, if info.Headshot then 1.25 else 1)
		end
	end)
end

return WeaponController
