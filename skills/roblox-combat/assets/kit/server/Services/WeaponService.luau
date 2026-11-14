--!strict
-- Server side of guns, bows and other ranged weapons.
--
-- A weapon is a Tool with attribute Weapon = a key of CombatConfig.Weapons, a Handle, and an
-- Attachment named "Muzzle". The client sends only Fire(origin, direction): the server checks
-- the fire rate on its own clock, ammo, that the origin is near the shooter, and that the
-- direction is a finite unit vector, then raycasts (hitscan) or simulates the projectile itself
-- and applies damage through CombatService (falloff, headshots).

local Players = game:GetService("Players")
local ReplicatedStorage = game:GetService("ReplicatedStorage")
local RunService = game:GetService("RunService")

local Ballistics = require(ReplicatedStorage.Shared.Combat.Ballistics)
local CombatConfig = require(ReplicatedStorage.Shared.Combat.CombatConfig)
local CombatService = require(script.Parent.CombatService)
local Hitbox = require(ReplicatedStorage.Shared.Combat.Hitbox)
local Net = require(ReplicatedStorage.Shared.Net)
local WeaponState = require(ReplicatedStorage.Shared.Combat.WeaponState)

type AmmoState = { magazine: number, reserve: number, reloadingUntil: number, nextShot: number }
type Projectile = {
	shooter: Model,
	weapon: any,
	origin: Vector3,
	position: Vector3,
	velocity: Vector3,
	travelled: number,
	params: RaycastParams,
}

local WeaponService = {}

local ammo: { [Player]: { [string]: AmmoState } } = {}
local projectiles: { Projectile } = {}
local rng = Random.new()
local ammoEvent: RemoteEvent
local shotEvent: UnreliableRemoteEvent

local function equipped(player: Player): (Tool?, any, string?)
	local character = player.Character
	local tool = character and character:FindFirstChildOfClass("Tool")
	local name = tool and tool:GetAttribute("Weapon")
	if typeof(name) == "string" and (CombatConfig.Weapons :: any)[name] then
		return tool, (CombatConfig.Weapons :: any)[name], name
	end
	return nil, nil, nil
end

local function ammoFor(player: Player, name: string, weapon: any): AmmoState
	local perPlayer = ammo[player]
	if not perPlayer then
		perPlayer = {}
		ammo[player] = perPlayer
	end
	local state = perPlayer[name]
	if not state then
		state = { magazine = weapon.Magazine, reserve = weapon.Reserve, reloadingUntil = 0, nextShot = 0 }
		perPlayer[name] = state
	end
	return state
end

local function sendAmmo(player: Player, name: string, state: AmmoState)
	ammoEvent:FireClient(player, name, state.magazine, state.reserve)
end

local function isFiniteVector(v: Vector3): boolean
	local m = v.Magnitude
	return m == m and m < math.huge
end

local function rayParams(exclude: { Instance }): RaycastParams
	local params = RaycastParams.new()
	params.FilterType = Enum.RaycastFilterType.Exclude
	params.FilterDescendantsInstances = exclude
	return params
end

local function applyHit(shooter: Model, weapon: any, result: RaycastResult, origin: Vector3, direction: Vector3)
	local victim = Hitbox.CharacterFromPart(result.Instance)
	if not victim then
		return
	end
	local headshot = Ballistics.IsHead(result.Instance)
	local damage = weapon.Damage * Ballistics.Falloff((result.Position - origin).Magnitude, weapon)
	if headshot then
		damage *= weapon.HeadshotMultiplier
	end
	CombatService:Hit(shooter, victim, weapon.Weight, direction, {
		Damage = math.floor(damage * 10 + 0.5) / 10,
		Headshot = headshot,
		Kind = "Gun",
		Position = result.Position,
		Part = if result.Instance:IsA("BasePart") then result.Instance else nil,
	})
end

local function fire(player: Player, rawOrigin: unknown, rawDirection: unknown)
	if typeof(rawOrigin) ~= "Vector3" or typeof(rawDirection) ~= "Vector3" then
		return
	end
	local origin = rawOrigin :: Vector3
	local direction = rawDirection :: Vector3
	if not isFiniteVector(origin) or not isFiniteVector(direction) then
		return
	end
	if math.abs(direction.Magnitude - 1) > 0.05 then
		return
	end

	local tool, weapon, name = equipped(player)
	local character = player.Character
	local humanoid = character and character:FindFirstChildOfClass("Humanoid")
	local head = character and (character:FindFirstChild("Head") or character:FindFirstChild("HumanoidRootPart"))
	local alive = humanoid ~= nil and humanoid.Health > 0
	if not (tool and weapon and name and character and alive and head and head:IsA("BasePart")) then
		return
	end
	if (origin - head.Position).Magnitude > CombatConfig.OriginTolerance then
		return
	end

	-- Same rules as the client's WeaponState: not reloading, ammo left, not faster than the rate
	-- (with a little slack for network bunching; the average rate can't be beaten).
	local state = ammoFor(player, name, weapon)
	if not WeaponState.ServerFire(state, weapon, os.clock(), CombatConfig.FireJitterTolerance) then
		return
	end

	local params = rayParams({ character })
	if weapon.Projectile then
		table.insert(projectiles, {
			shooter = character,
			weapon = weapon,
			origin = origin,
			position = origin,
			velocity = direction * weapon.ProjectileSpeed,
			travelled = 0,
			params = params,
		})
		shotEvent:FireAllClients(player, name, origin, origin + direction)
		return
	end

	local endPoint = origin + direction * weapon.Range
	for pellet = 1, weapon.Pellets do
		-- Single bullets use the client's spread; pellets get their spread here.
		local dir = if weapon.Pellets > 1 then Ballistics.Spread(direction, weapon.SpreadHip, rng) else direction
		local result = workspace:Raycast(origin, dir * weapon.Range, params)
		if result then
			applyHit(character, weapon, result, origin, dir)
			if pellet == 1 then
				endPoint = result.Position
			end
		end
	end
	shotEvent:FireAllClients(player, name, origin, endPoint)
end

local function reload(player: Player)
	local _, weapon, name = equipped(player)
	if not weapon or not name then
		return
	end
	local state = ammoFor(player, name, weapon)
	local now = os.clock()
	if now < state.reloadingUntil or state.magazine >= weapon.Magazine or state.reserve <= 0 then
		return
	end
	state.reloadingUntil = now + weapon.ReloadSeconds
	local started = state.reloadingUntil
	task.delay(weapon.ReloadSeconds, function()
		-- Cancelled if the weapon was put away meanwhile (see ChildRemoved below).
		local _, _, holding = equipped(player)
		if state.reloadingUntil ~= started or holding ~= name then
			return
		end
		state.reloadingUntil = 0
		local moved = math.min(weapon.Magazine - state.magazine, state.reserve)
		state.magazine += moved
		state.reserve -= moved
		if player.Parent then
			sendAmmo(player, name, state)
		end
	end)
end

local function stepProjectiles(dt: number)
	for i = #projectiles, 1, -1 do
		local p = projectiles[i]
		local before = p.position
		local position, velocity, result =
			Ballistics.Step(p.position, p.velocity, p.weapon.ProjectileGravity, dt, p.params)
		p.travelled += (position - before).Magnitude
		p.position, p.velocity = position, velocity
		if result then
			applyHit(p.shooter, p.weapon, result, p.origin, velocity.Unit)
		end
		if result or p.travelled >= p.weapon.Range or not p.shooter.Parent then
			table.remove(projectiles, i)
		end
	end
end

function WeaponService:Init()
	ammoEvent = Net.Event("Ammo")
	shotEvent = Net.Unreliable("ShotFired")
end

function WeaponService:Start()
	local fastest = 0
	for _, weapon in CombatConfig.Weapons :: any do
		fastest = math.max(fastest, weapon.Rpm)
	end
	Net.Handle("Fire", fastest / 60 * 1.5 + 2, fire)
	Net.Handle("Reload", 2, reload)

	-- Tell the client its ammo whenever it equips a weapon.
	local function watchCharacter(player: Player, character: Model)
		character.ChildAdded:Connect(function(child)
			local name = child:IsA("Tool") and child:GetAttribute("Weapon")
			local weapon = typeof(name) == "string" and (CombatConfig.Weapons :: any)[name]
			if weapon then
				sendAmmo(player, name :: string, ammoFor(player, name :: string, weapon))
			end
		end)
		-- Unequipping cancels a reload in progress (WeaponState:Unequip does the same on the client).
		character.ChildRemoved:Connect(function(child)
			local name = if child:IsA("Tool") then child:GetAttribute("Weapon") else nil
			local perPlayer = ammo[player]
			if typeof(name) ~= "string" or not perPlayer then
				return
			end
			local state = perPlayer[name]
			if state and state.reloadingUntil > 0 then
				state.reloadingUntil = 0
				sendAmmo(player, name, state)
			end
		end)
	end
	local function watchPlayer(player: Player)
		player.CharacterAdded:Connect(function(character)
			watchCharacter(player, character)
		end)
		if player.Character then
			watchCharacter(player, player.Character)
		end
	end
	Players.PlayerAdded:Connect(watchPlayer)
	for _, player in Players:GetPlayers() do
		watchPlayer(player)
	end
	Players.PlayerRemoving:Connect(function(player)
		ammo[player] = nil
	end)

	RunService.Heartbeat:Connect(stepProjectiles)
end

return WeaponService
