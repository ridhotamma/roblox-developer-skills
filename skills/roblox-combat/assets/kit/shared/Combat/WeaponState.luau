--!strict
-- A gun's rules as a pure state machine: trigger, fire modes, fire rate, click buffering, ammo,
-- reload, bloom, spread and recoil size. WeaponController runs one per weapon to predict shots;
-- WeaponService uses ServerFire for the authoritative fire-rate and ammo check. The clock is
-- passed in (os.clock() in game), so the same code runs in the luau CLI tests.
--
--   local gun = WeaponState.new(CombatConfig.Weapons.Rifle, CombatConfig.FireBuffer)
--   gun:Press(now)  gun:Release()  gun:SetAiming(true)  gun:StartReload(now)
--   local event = gun:Step(now, dt, moving) -- "Fire" | "Empty" | "Reloaded" | nil, once per frame

local MOVE_SPREAD = 1 -- extra degrees of spread while moving
local BURST = 3

local WeaponState = {}
WeaponState.__index = WeaponState

export type Event = "Fire" | "Empty" | "Reloaded"

export type WeaponState = typeof(setmetatable(
	{} :: {
		Stats: any,
		Buffer: number,
		Magazine: number,
		Reserve: number,
		ReloadingUntil: number, -- 0 = not reloading
		NextShot: number,
		TriggerDown: boolean,
		PressedAt: number,
		ShotsThisPress: number,
		BurstLeft: number,
		Bloom: number,
		Aiming: boolean,
		-- Set when Step returns "Fire": what this shot should use.
		LastSpread: number,
		LastRecoilUp: number,
		LastRecoilSide: number, -- multiply by a random -1..1
	},
	WeaponState
))

function WeaponState.new(stats: any, buffer: number?): WeaponState
	return setmetatable({
		Stats = stats,
		Buffer = buffer or 0,
		Magazine = stats.Magazine,
		Reserve = stats.Reserve,
		ReloadingUntil = 0,
		NextShot = 0,
		TriggerDown = false,
		PressedAt = -math.huge,
		ShotsThisPress = 0,
		BurstLeft = 0,
		Bloom = 0,
		Aiming = false,
		LastSpread = 0,
		LastRecoilUp = 0,
		LastRecoilSide = 0,
	}, WeaponState)
end

function WeaponState.Interval(self: WeaponState): number
	return 60 / self.Stats.Rpm
end

function WeaponState.Press(self: WeaponState, now: number)
	self.TriggerDown = true
	self.PressedAt = now
	self.ShotsThisPress = 0
	if self.Stats.Mode == "Burst" and self.BurstLeft == 0 then
		self.BurstLeft = BURST
	end
end

function WeaponState.Release(self: WeaponState)
	self.TriggerDown = false
end

function WeaponState.SetAiming(self: WeaponState, aiming: boolean)
	self.Aiming = aiming
end

function WeaponState.IsReloading(self: WeaponState): boolean
	return self.ReloadingUntil > 0
end

function WeaponState.CanReload(self: WeaponState): boolean
	return self.ReloadingUntil == 0 and self.Magazine < self.Stats.Magazine and self.Reserve > 0
end

function WeaponState.StartReload(self: WeaponState, now: number): boolean
	if not self:CanReload() then
		return false
	end
	self.ReloadingUntil = now + self.Stats.ReloadSeconds
	self.BurstLeft = 0
	return true
end

function WeaponState.CancelReload(self: WeaponState)
	self.ReloadingUntil = 0
end

-- Unequipping lets go of the trigger and cancels a reload in progress (the server does the same).
function WeaponState.Unequip(self: WeaponState)
	self.TriggerDown = false
	self.BurstLeft = 0
	self.PressedAt = -math.huge
	self.Aiming = false
	self:CancelReload()
end

-- Server correction of the predicted ammo.
function WeaponState.SetAmmo(self: WeaponState, magazine: number, reserve: number)
	self.Magazine = magazine
	self.Reserve = reserve
end

-- Current cone half-angle in degrees (the crosshair gap shows this).
function WeaponState.Spread(self: WeaponState, moving: boolean?): number
	local stats = self.Stats
	return (if self.Aiming then stats.SpreadAds else stats.SpreadHip) + self.Bloom + (if moving then MOVE_SPREAD else 0)
end

local function wantsShot(self: WeaponState, now: number): boolean
	local mode = self.Stats.Mode
	if mode == "Auto" then
		return self.TriggerDown
	elseif mode == "Burst" then
		return self.BurstLeft > 0
	end
	-- Semi: one shot per press. Held, it fires as soon as the gun is ready; a click that was
	-- already released still fires if it came within Buffer seconds of the gun being ready.
	return self.ShotsThisPress == 0 and (self.TriggerDown or now - self.PressedAt <= self.Buffer)
end

-- Call once per frame. Returns what happened this frame, if anything.
function WeaponState.Step(self: WeaponState, now: number, dt: number, moving: boolean?): Event?
	local stats = self.Stats
	-- Bloom recovers only while the gun sits ready and unfired; between shots at full rate it
	-- holds, so sustained fire really widens the cone (recovering every frame would undo it).
	if now > self.NextShot then
		self.Bloom = math.max(0, self.Bloom - stats.BloomRecovery * dt)
	end

	if self.ReloadingUntil > 0 then
		if now < self.ReloadingUntil then
			return nil
		end
		local moved = math.min(stats.Magazine - self.Magazine, self.Reserve)
		self.Magazine += moved
		self.Reserve -= moved
		self.ReloadingUntil = 0
		return "Reloaded"
	end

	if not wantsShot(self, now) or now < self.NextShot then
		return nil
	end
	if self.Magazine <= 0 then
		-- Dry fire: one click per press, then the caller starts a reload.
		self.TriggerDown = false
		self.ShotsThisPress = 1
		self.BurstLeft = 0
		self.PressedAt = -math.huge
		return "Empty"
	end

	local interval = self:Interval()
	-- Keep the schedule when firing continuously so frame rounding never lowers the fire rate;
	-- restart it after a pause.
	self.NextShot = if now - self.NextShot <= dt then self.NextShot + interval else now + interval
	self.Magazine -= 1

	local adsFactor = if self.Aiming then 0.7 else 1
	local firstShot = if self.ShotsThisPress == 0 then 0.7 else 1
	self.LastSpread = self:Spread(moving)
	self.LastRecoilUp = stats.RecoilUp * adsFactor * firstShot
	self.LastRecoilSide = stats.RecoilSide * adsFactor

	self.ShotsThisPress += 1
	if self.BurstLeft > 0 then
		self.BurstLeft -= 1
	end
	self.Bloom = math.min(stats.BloomMax, self.Bloom + stats.BloomPerShot)
	return "Fire"
end

export type ServerAmmo = { magazine: number, reserve: number, reloadingUntil: number, nextShot: number }

-- The server's check for one Fire request: not reloading, ammo left, and not faster than the
-- weapon's rate. Shots may arrive up to a quarter interval + `tolerance` early (network bunching);
-- the schedule still advances one interval per shot, so the average rate can't be beaten.
function WeaponState.ServerFire(state: ServerAmmo, stats: any, now: number, tolerance: number): boolean
	local interval = 60 / stats.Rpm
	if now < state.reloadingUntil or state.magazine <= 0 then
		return false
	end
	if now < state.nextShot - interval * 0.25 - tolerance then
		return false
	end
	state.nextShot = math.max(state.nextShot, now) + interval
	state.magazine -= 1
	return true
end

return table.freeze(WeaponState)
