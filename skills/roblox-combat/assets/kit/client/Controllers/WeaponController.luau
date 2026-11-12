--!strict
-- Guns and bows on the local player's client.
--
-- Equip a Tool with attribute Weapon = a key of CombatConfig.Weapons and an Attachment "Muzzle"
-- in its Handle. Then:
--   fire: left mouse / R2 / touch button   aim: right mouse / L2 / touch   reload: R / X / touch
--
-- Every shot, in the same frame: fire-rate gate, predicted ammo, camera recoil, muzzle flash and
-- smoke, fire sound, aim ray from the camera through the crosshair, spread + bloom, bullet from
-- the muzzle toward the aim point, tracer (or a visible projectile), predicted impact; then
-- Fire(origin, direction) to the server. Hit markers appear only for server-confirmed hits.

local ContextActionService = game:GetService("ContextActionService")
local Players = game:GetService("Players")
local ReplicatedStorage = game:GetService("ReplicatedStorage")
local RunService = game:GetService("RunService")

local Ballistics = require(ReplicatedStorage.Shared.Combat.Ballistics)
local CameraFx = require(script.Parent.Parent.Combat.CameraFx)
local CombatConfig = require(ReplicatedStorage.Shared.Combat.CombatConfig)
local HitFeedback = require(script.Parent.Parent.Combat.HitFeedback)
local Net = require(ReplicatedStorage.Shared.Net)
local WeaponFx = require(script.Parent.Parent.Combat.WeaponFx)

type Equipped = { tool: Tool, name: string, stats: any, muzzle: Attachment }

local player = Players.LocalPlayer
local rng = Random.new()

local WeaponController = {}

local current: Equipped? = nil
local triggerDown = false
local shotsThisPress = 0
local nextShot = 0
local bloom = 0
local aiming = false
local reloadingUntil = 0
local magazine: { [string]: number } = {}
local reserve: { [string]: number } = {}

local function refreshAmmo()
	local eq = current
	if eq then
		WeaponFx.SetAmmo(magazine[eq.name] or 0, reserve[eq.name] or 0, os.clock() < reloadingUntil)
	end
end

local function reload()
	local eq = current
	if not eq then
		return
	end
	local mag = magazine[eq.name] or eq.stats.Magazine
	local res = reserve[eq.name] or eq.stats.Reserve
	if os.clock() < reloadingUntil or mag >= eq.stats.Magazine or res <= 0 then
		return
	end
	reloadingUntil = os.clock() + eq.stats.ReloadSeconds
	HitFeedback.PlayLocal(CombatConfig.Sounds.Reload)
	Net.Event("Reload"):FireServer()
	refreshAmmo()
	task.delay(eq.stats.ReloadSeconds, function()
		-- Predict the result; the server's Ammo event corrects it.
		local moved = math.min(eq.stats.Magazine - (magazine[eq.name] or 0), reserve[eq.name] or 0)
		magazine[eq.name] = (magazine[eq.name] or 0) + moved
		reserve[eq.name] = (reserve[eq.name] or 0) - moved
		refreshAmmo()
	end)
end

local function shoot(eq: Equipped, character: Model, humanoid: Humanoid)
	local stats = eq.stats
	local camera = workspace.CurrentCamera
	if not camera then
		return
	end

	magazine[eq.name] = (magazine[eq.name] or stats.Magazine) - 1
	refreshAmmo()

	local params = RaycastParams.new()
	params.FilterType = Enum.RaycastFilterType.Exclude
	params.FilterDescendantsInstances = { character }

	-- Aim where the crosshair points, fire from the muzzle.
	local aimPoint = Ballistics.AimPoint(camera, stats.Range, params)
	local origin = eq.muzzle.WorldPosition
	local base = (aimPoint - origin).Unit
	local moving = humanoid.MoveDirection.Magnitude > 0.1
	local spread = (if aiming then stats.SpreadAds else stats.SpreadHip) + bloom + (if moving then 1 else 0)
	bloom = math.min(stats.BloomMax, bloom + stats.BloomPerShot)

	-- Recoil and kick.
	local adsFactor = if aiming then 0.7 else 1
	local firstShot = if shotsThisPress == 0 then 0.7 else 1
	CameraFx.Recoil(
		stats.RecoilUp * adsFactor * firstShot,
		rng:NextNumber(-1, 1) * stats.RecoilSide * adsFactor,
		stats.RecoilRecovery
	)
	local heavy = stats.Weight == "GunHeavy"
	CameraFx.AddTrauma(if heavy then 0.18 else 0.06)
	WeaponFx.Muzzle(eq.muzzle, heavy)
	HitFeedback.PlayLocal((CombatConfig.Sounds.Fire :: any)[eq.name] or "")
	shotsThisPress += 1

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
	local stats = eq.stats
	bloom = math.max(0, bloom - stats.BloomRecovery * dt)
	WeaponFx.SetSpread((if aiming then stats.SpreadAds else stats.SpreadHip) + bloom)

	if not triggerDown then
		return
	end
	local character = player.Character
	local humanoid = character and character:FindFirstChildOfClass("Humanoid")
	if not (character and humanoid and humanoid.Health > 0) then
		return
	end
	local now = os.clock()
	if now < nextShot or now < reloadingUntil then
		return
	end
	if (magazine[eq.name] or stats.Magazine) <= 0 then
		HitFeedback.PlayLocal(CombatConfig.Sounds.Empty)
		triggerDown = false
		reload()
		return
	end
	if stats.Mode == "Semi" and shotsThisPress >= 1 then
		return
	elseif stats.Mode == "Burst" and shotsThisPress >= 3 then
		return
	end
	nextShot = now + 60 / stats.Rpm
	shoot(eq, character, humanoid)
end

local function bindInputs()
	ContextActionService:BindAction("WeaponFire", function(_, state)
		if state == Enum.UserInputState.Begin then
			triggerDown = true
			shotsThisPress = 0
		elseif state == Enum.UserInputState.End or state == Enum.UserInputState.Cancel then
			triggerDown = false
		end
		return Enum.ContextActionResult.Sink
	end, true, Enum.UserInputType.MouseButton1, Enum.KeyCode.ButtonR2)
	ContextActionService:SetTitle("WeaponFire", "Fire")
	ContextActionService:SetPosition("WeaponFire", UDim2.new(1, -150, 1, -150))

	ContextActionService:BindAction("WeaponAim", function(_, state)
		if state == Enum.UserInputState.Begin then
			aiming = true
			CameraFx.SetBaseFov(CombatConfig.AdsFov)
		elseif state == Enum.UserInputState.End or state == Enum.UserInputState.Cancel then
			aiming = false
			CameraFx.SetBaseFov(nil)
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
	triggerDown = false
	if aiming then
		aiming = false
		CameraFx.SetBaseFov(nil)
	end
end

local function onToolChanged(character: Model)
	local tool = character:FindFirstChildOfClass("Tool")
	local name = tool and tool:GetAttribute("Weapon")
	local stats = if typeof(name) == "string" then (CombatConfig.Weapons :: any)[name] else nil
	local handle = tool and tool:FindFirstChild("Handle")
	local muzzle = handle and handle:FindFirstChild("Muzzle")

	if current and (not tool or tool ~= current.tool) then
		current = nil
		unbindInputs()
		WeaponFx.ShowHud(false)
	end
	if tool and stats and not current then
		if not (muzzle and muzzle:IsA("Attachment")) then
			warn(`[WeaponController] {tool:GetFullName()} needs an Attachment named Muzzle in its Handle`)
			return
		end
		current = { tool = tool, name = name :: string, stats = stats, muzzle = muzzle }
		magazine[name :: string] = magazine[name :: string] or stats.Magazine
		reserve[name :: string] = reserve[name :: string] or stats.Reserve
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
	RunService:BindToRenderStep("WeaponStep", CameraFx.RenderPriority, step)

	player.CharacterAdded:Connect(onCharacter)
	if player.Character then
		onCharacter(player.Character)
	end

	Net.Event("Ammo").OnClientEvent:Connect(function(name: unknown, mag: unknown, res: unknown)
		if typeof(name) == "string" and typeof(mag) == "number" and typeof(res) == "number" then
			magazine[name] = mag
			reserve[name] = res
			refreshAmmo()
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
