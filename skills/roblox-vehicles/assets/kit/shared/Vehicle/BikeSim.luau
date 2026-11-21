--!strict
-- Motorcycle physics for one bike built by VehicleService (Type = "Motorcycle"). Runs on the
-- driver's client (the server while parked), like VehicleSim. See references/motorcycle-physics.md.
--
-- Per step:
--   * real gravity (Recovery.AirGravity g in the air), so wheelie / stoppie limits (g b / h),
--     lean balance (tan φ = v ω / g) and suspension sag are the real bike's
--   * front and rear sphere-cast suspension along the leaned up axis; spring and tire forces at the
--     contact patch, so a leaned bike's roll torques are physical
--   * tires: slip-angle force (the car's tire curve) + camber thrust (CamberThrust x load x tan φ),
--     drive on the rear (the car's engine and gearbox), brakes by FrontBias, friction circle;
--     cornering ABS and traction control give cornering grip priority
--   * the rider: the stick asks for a lean angle; the rider steers whatever turn keeps the bike
--     balanced at the lean it has (ground steer atan(L g tan φ / v²) / cos φ); a lean controller
--     places the bike and cancels the contact patches' roll torque (riderless or crashed bikes
--     don't get this, so they fall over)
--   * wheelies: rider lean moves the centre of mass (RiderShift); wheelie control trims drive as
--     the front goes light; lean back holds Wheelie.BalanceAngle; stoppies likewise
--   * air control (lean pitches, steer rolls), crash detection (Recovery.BailG, low-sides),
--     stability assist, hill hold, auto-upright

local Workspace = game:GetService("Workspace")

local SimUtil = require(script.Parent.SimUtil)
local VehicleMath = require(script.Parent.VehicleMath)

local MPS = SimUtil.MPS
local G = SimUtil.G
local RHO = SimUtil.RHO_AIR
local smoothstep = SimUtil.SmoothStep

local CAST_RADIUS = 0.85
local WALL_NORMAL = 0.35
local LEAN_GAIN = 7 -- lean rate (1/s) per radian of lean error
local ROLL_TRACK = 18 -- roll-rate tracking (1/s)
local PITCH_TRACK = 10 -- wheelie / stoppie balance tracking (1/s), times Wheelie.Assist
local AIR_LEVEL, AIR_MAX, AIR_DAMP, AIR_INPUT_GAIN = 2.5, 1.2, 14, 8
local STOP_GAIN = 0.4
local HOLD_MS = 0.6
local ESC_GAIN = 14
local STAND_LEAN = 8 -- degrees on the kickstand
local LOW_SIDE_LEAN = 75
local FLIP_LEAN = 70

export type Input = {
	Throttle: number,
	Steer: number,
	Handbrake: boolean,
	Lean: number?, -- -1 lean back (wheelie) .. 1 lean forward
	Rider: boolean?, -- false when nobody rides it (parked): no drive, no balance, kickstand
}

export type Telemetry = {
	Kind: string,
	SpeedKmh: number,
	Rpm: number,
	Gear: number,
	Steer: number, -- degrees at the bars
	Lean: number, -- degrees, + = right
	Pitch: number, -- degrees against the ground, + = front up
	Wheelie: boolean,
	Stoppie: boolean,
	Crashed: boolean,
	Grounded: number,
	Slip: number,
	Stuck: boolean,
}

type Wheel = {
	mount: Attachment,
	front: boolean,
	radius: number,
	k: number,
	c: number,
	restLength: number,
	staticForce: number,
	axleWeightN: number,
	cornerMassKg: number,
	length: number,
	grounded: boolean,
	hit: RaycastResult?,
	springForce: number,
	slip: number,
}

local BikeSim = {}
BikeSim.__index = BikeSim

export type BikeSim = typeof(setmetatable(
	{} :: {
		Kind: string,
		rig: SimUtil.Rig,
		spec: any,
		front: Wheel,
		rear: Wheel,
		wheelbaseM: number,
		steer: number,
		gear: number,
		shiftTimer: number,
		rpm: number,
		crashed: boolean,
		flipTimer: number,
		wasAirborne: boolean,
		latchPitch: number,
		latchRoll: number,
	},
	BikeSim
))

function BikeSim.new(model: Model, spec: any): BikeSim?
	local rig = SimUtil.Rig(model, spec)
	if not rig then
		return nil
	end
	local root = rig.root
	local mass = root.AssemblyMass
	local suspension = spec.Suspension
	local staticLength = suspension.MaxLength * suspension.RideHeight
	local wheels: { [boolean]: Wheel } = {}
	for _, mount in root:GetChildren() do
		if mount:IsA("Attachment") and mount:GetAttribute("Wheel") then
			local front = mount:GetAttribute("Front") == true
			local share = if front then spec.FrontWeight else 1 - spec.FrontWeight
			local cornerMass = mass * share
			local k, c = SimUtil.Spring(
				cornerMass,
				if front then suspension.FrequencyFront else suspension.FrequencyRear,
				suspension.DampingRatio
			)
			local staticForce = cornerMass * (G / MPS)
			wheels[front] = {
				mount = mount,
				front = front,
				radius = mount:GetAttribute("Radius") :: number,
				k = k,
				c = c,
				restLength = staticLength + staticForce / k,
				staticForce = staticForce,
				axleWeightN = spec.Mass * G * share,
				cornerMassKg = spec.Mass * share,
				length = staticLength,
				grounded = false,
				hit = nil,
				springForce = 0,
				slip = 0,
			}
		end
	end
	local front, rear = wheels[true], wheels[false]
	if not front or not rear then
		return nil
	end
	local wheelbaseM =
		math.max(math.abs(root.CFrame:PointToObjectSpace(front.mount.WorldPosition).Z - root.CFrame:PointToObjectSpace(rear.mount.WorldPosition).Z) * MPS, 0.5)
	return setmetatable({
		Kind = "Motorcycle",
		rig = rig,
		spec = spec,
		front = front,
		rear = rear,
		wheelbaseM = wheelbaseM,
		steer = 0,
		gear = 1,
		shiftTimer = 0,
		rpm = spec.Engine.IdleRpm,
		crashed = false,
		flipTimer = 0,
		wasAirborne = false,
		latchPitch = 0,
		latchRoll = 0,
	}, BikeSim)
end

function BikeSim.Recover(self: BikeSim)
	if SimUtil.Recover(self.rig, self.spec.ComHeight / MPS + self.spec.Suspension.MaxLength + 1) then
		self.crashed = false
	end
end

function BikeSim.Step(self: BikeSim, dt: number, input: Input): Telemetry
	local spec = self.spec
	local rig = self.rig
	local root = rig.root
	local rider = input.Rider ~= false
	SimUtil.Begin(rig)
	local cf = root.CFrame
	local up, forward, right = cf.UpVector, cf.LookVector, cf.RightVector
	local velocity = root.AssemblyLinearVelocity * MPS
	local flatF = SimUtil.Flat(forward)
	local lean = SimUtil.Bank(cf) -- + = leaning right
	local pitch = SimUtil.Pitch(cf)
	local forwardMs = velocity:Dot(flatF)
	local kmh = math.abs(forwardMs) * 3.6
	local L = self.wheelbaseM
	local throttle = math.clamp(input.Throttle, -1, 1)

	-- Crash: a hard hit, or lying over at speed (low-side).
	local recovery = spec.Recovery
	local hitG = SimUtil.Impact(rig, dt, if recovery.BailG > 0 then recovery.BailG else math.huge)
	if rider and hitG > 0 then
		self.crashed = true
	end

	-- Lean and steering, the way a rider does it (see header). Braking hard, the rider picks the bike
	-- up a little, so it runs wide instead of sliding out; stopping, the bars straighten.
	local steering = spec.Steering
	local steerIn = math.clamp(input.Steer, -1, 1)
	local lowBlend = smoothstep(steering.LowSpeedKmh * 0.5, steering.LowSpeedKmh * 1.5, kmh)
	local braking = if throttle < -0.05 and forwardMs > 0.3 then -throttle else 0
	local leanCmd = steerIn
		* math.rad(steering.MaxLean)
		* smoothstep(steering.LowSpeedKmh * 0.5, steering.LowSpeedKmh * 3, kmh)
		* (1 - 0.35 * braking)
	local leanTarget = if rider then leanCmd else -math.rad(STAND_LEAN) -- riderless: on the kickstand
	local v = math.max(math.abs(forwardMs), 0.5)
	local groundSteer = math.atan(L * G * math.tan(math.clamp(lean, -1.2, 1.2)) / (v * v))
	local balanceSteer = math.atan(math.tan(groundSteer) / math.max(math.cos(lean), 0.3))
	local maxAngle = math.rad(steering.MaxAngle)
	local target = math.clamp(SimUtil.Lerp(steerIn * maxAngle, balanceSteer, lowBlend), -maxAngle, maxAngle)
	if throttle < -0.5 and forwardMs > 0.3 and kmh < steering.LowSpeedKmh then
		target = 0
	end
	local maxStep = maxAngle * steering.Speed * dt
	self.steer += math.clamp(target - self.steer, -maxStep, maxStep)
	local rKin = forwardMs * math.tan(self.steer * math.cos(lean)) / L -- right turn +

	-- Pedals and gearbox (the car's VehicleMath). Reverse only from a stop, at walking pace.
	local drive, brake = 0, 0
	if throttle > 0.05 then
		if forwardMs < -1 then
			brake = throttle
		else
			if self.gear < 1 then
				self.gear = 1
			end
			drive = throttle
		end
	elseif throttle < -0.05 then
		if forwardMs > 0.3 then
			brake = -throttle
		else
			self.gear = -1
			drive = if kmh < spec.Gearbox.ReverseSpeedKmh then -throttle else 0
		end
	end
	local holding = math.abs(throttle) <= 0.05 and math.abs(forwardMs) < HOLD_MS
	if holding or not rider then
		brake = 1
	end
	if self.shiftTimer > 0 then
		self.shiftTimer -= dt
	elseif self.gear >= 1 then
		local nextGear = VehicleMath.AutoShift(spec, self.gear, forwardMs)
		if nextGear ~= self.gear then
			self.gear = nextGear
			self.shiftTimer = spec.Gearbox.ShiftTime
		end
	end
	local driveN, rpm = VehicleMath.Drive(spec, forwardMs, self.gear, if rider then drive else 0)
	if self.shiftTimer > 0 then
		driveN = 0
	end
	if self.gear < 0 then
		driveN = -driveN
	end
	self.rpm += (rpm - self.rpm) * math.min(1, dt * 12)

	-- Suspension along the leaned up axis.
	local maxLength = spec.Suspension.MaxLength
	local grounded = 0
	for _, wheel in { self.front, self.rear } do
		local castRadius = wheel.radius * CAST_RADIUS
		local inset = wheel.radius - castRadius
		local lift = wheel.radius
		local hit = Workspace:Spherecast(wheel.mount.WorldPosition + up * lift, castRadius, -up * (maxLength + inset + lift), rig.params)
		if hit and hit.Normal.Y < WALL_NORMAL then
			hit = nil
		end
		wheel.hit = hit
		if hit then
			local length = math.clamp(hit.Distance - inset - lift, 0, maxLength)
			wheel.springForce = math.max(0, wheel.k * (wheel.restLength - length) + wheel.c * ((wheel.length - length) / dt))
			wheel.length = length
			wheel.grounded = true
			grounded += 1
		else
			wheel.length = maxLength
			wheel.springForce = 0
			wheel.grounded = false
		end
	end
	local front, rear = self.front, self.rear
	local frontHit, rearHit = front.hit, rear.hit
	local n = if rearHit then rearHit.Normal elseif frontHit then frontHit.Normal else Vector3.yAxis
	local pitchRel = pitch - math.asin(math.clamp(-n:Dot(flatF), -1, 1)) -- pitch against the slope
	local leanIn = math.clamp(input.Lean or 0, -1, 1)
	local wheelieSpec = spec.Wheelie
	local wheelie = rear.grounded and not front.grounded
	local stoppie = front.grounded and not rear.grounded

	-- Wheelie control: without lean-back, drive is trimmed as the front goes light (launches run at
	-- the wheelie limit). Past the balance point the rider rolls off (no looping out). Stoppie
	-- control: unless leaning forward, the front brake eases as the rear goes light.
	local driveScale, frontBrakeScale = 1, 1
	local frontLoad = if front.grounded then front.springForce / front.staticForce else 0
	if wheelieSpec.Control and leanIn > -0.3 and frontLoad < 0.15 then
		driveScale = math.clamp(frontLoad / 0.15, 0, 1)
	end
	if wheelieSpec.Assist > 0 and pitchRel > math.rad(wheelieSpec.BalanceAngle) then
		driveScale = math.min(driveScale, math.clamp(1 - (pitchRel - math.rad(wheelieSpec.BalanceAngle)) / math.rad(8), 0, 1))
	end
	local rearLoad = if rear.grounded then rear.springForce / rear.staticForce else 0
	if leanIn < 0.3 and brake > 0 and rearLoad < 0.15 then
		frontBrakeScale = math.clamp(0.3 + 0.7 * rearLoad / 0.15, 0.3, 1)
	end

	-- Tires.
	local tires = spec.Tires
	local brakes = spec.Brakes
	local stopGain = STOP_GAIN + (1 - STOP_GAIN) * math.clamp(math.abs(forwardMs) / 4, 0, 1)
	local worstSlip = 0
	local torqueBefore = rig.T
	local steerRotation = CFrame.fromAxisAngle(up, -self.steer)
	for _, wheel in { front, rear } do
		local hit = wheel.hit
		if not hit then
			wheel.slip = 0
			continue
		end
		local nn = hit.Normal
		local mu = if wheel.front then tires.GripFront else tires.GripRear
		local load = wheel.axleWeightN * math.clamp(wheel.springForce / wheel.staticForce, 0, 3)
		local gripN = mu * load
		local wheelForward = if wheel.front then steerRotation * forward else forward
		wheelForward = (wheelForward - nn * wheelForward:Dot(nn)).Unit
		local wheelRight = wheelForward:Cross(nn)
		local contactVelocity = root:GetVelocityAtPosition(hit.Position) * MPS
		local longMs = contactVelocity:Dot(wheelForward)
		local latMs = contactVelocity:Dot(wheelRight)
		local stopLimit = wheel.cornerMassKg / dt * stopGain
		local slipAngle = math.atan2(latMs, math.max(math.abs(longMs), 0.5))
		local latN = -load * mu * VehicleMath.TireCurve(slipAngle, tires.Stiffness, tires.Shape, tires.SlideGrip)
		latN = math.clamp(latN, -stopLimit * math.abs(latMs), stopLimit * math.abs(latMs))
		local camber = math.asin(math.clamp(up:Dot(wheelRight), -1, 1))
		latN += tires.CamberThrust * load * math.tan(math.clamp(camber, -1.2, 1.2)) * smoothstep(1, 4, math.abs(longMs))
		-- Cornering ABS and lean-sensitive traction control: cornering grip comes first; drive and
		-- brakes get what's left of the friction circle (the rear brake lever still slides it).
		local spare = math.sqrt(math.max(gripN * gripN - latN * latN, 0)) * 0.95
		local longN = if wheel.front then 0 else math.clamp(driveN * driveScale, -spare, spare)
		local share = if wheel.front then brakes.FrontBias * frontBrakeScale else 1 - brakes.FrontBias
		local brakeN = math.min(brake * spec.Mass * G * brakes.DecelG * share, spare)
		if input.Handbrake and not wheel.front then
			brakeN += spec.Mass * G * brakes.DecelG * 0.6
		end
		local resist = brakeN + tires.RollingResistance * load
		longN -= (if longMs >= 0 then 1 else -1) * math.min(resist, stopLimit * math.abs(longMs))
		local total = math.sqrt(latN * latN + longN * longN)
		wheel.slip = if gripN > 0 then total / gripN else 0
		if total > gripN and total > 0 then
			latN *= gripN / total
			longN *= gripN / total
		end
		worstSlip = math.max(worstSlip, wheel.slip)
		SimUtil.AddForceRoblox(rig, nn * wheel.springForce, hit.Position)
		SimUtil.AddForce(rig, wheelForward * longN + wheelRight * latN, hit.Position)
	end

	-- The rider's balance: the contact forces' roll torque is cancelled and the lean controller places
	-- the bike (a real rider steers the patches back under the centre of mass).
	local balance = rider and not self.crashed
	if balance then
		local contactRoll = (rig.T - torqueBefore):Dot(forward)
		SimUtil.AddTorqueRoblox(rig, -forward * contactRoll)
	end
	-- Rider lean moves the centre of mass fore and aft: lean back lifts the front.
	if rider then
		SimUtil.AddTorque(rig, right * (-leanIn * spec.Mass * G * wheelieSpec.RiderShift))
	end

	local angular = root.AssemblyAngularVelocity
	local airborne = grounded == 0
	if not airborne then
		-- Lean controller.
		if balance or math.abs(lean) < math.rad(35) then
			local leanRate = math.rad(steering.LeanRate)
			local rate = math.clamp((leanTarget - lean) * LEAN_GAIN, -leanRate, leanRate)
			SimUtil.TrackRates(rig, angular + forward * (rate - angular:Dot(forward)), Vector3.new(0, 0, ROLL_TRACK), Vector3.zAxis)
		end
		-- Wheelie and stoppie balance, and no looping out.
		local pitchRate: number? = nil
		if wheelieSpec.Assist > 0 then
			if wheelie and leanIn < -0.3 then
				pitchRate = math.clamp((math.rad(wheelieSpec.BalanceAngle) - pitchRel) * 3, -1.5, 1.5)
			elseif stoppie and leanIn > 0.3 then
				pitchRate = math.clamp((math.rad(wheelieSpec.StoppieAngle) - pitchRel) * 3, -1.5, 1.5)
			end
			if pitchRel > math.rad(wheelieSpec.BalanceAngle + 15) then
				pitchRate = -1.5
			end
			if pitchRel < math.rad(wheelieSpec.StoppieAngle - 12) then
				pitchRate = 1.5
			end
		end
		if pitchRate then
			SimUtil.TrackRates(rig, angular + right * (pitchRate - angular:Dot(right)), Vector3.new(PITCH_TRACK * wheelieSpec.Assist, 0, 0), Vector3.xAxis)
		end
		-- Stability assist: yaw beyond what the steering asks for.
		local stability = spec.Assists.Stability
		if stability > 0 and grounded == 2 and forwardMs > 0.5 then
			local yawRight = -angular.Y
			local cap = tires.GripRear * G / math.max(forwardMs, 3)
			local wanted = math.clamp(rKin, -cap, cap)
			local over = yawRight - math.clamp(yawRight, math.min(0, wanted), math.max(0, wanted))
			SimUtil.AddTorqueRoblox(rig, Vector3.yAxis * over * ESC_GAIN * stability * SimUtil.Inertia(rig).Y)
		end
	else
		-- Air: lean pitches (flips), steer rolls; otherwise turn toward the ground below. Keys held at
		-- take-off are ignored until released.
		if not self.wasAirborne then
			self.latchPitch = if math.abs(leanIn) > 0.05 then math.sign(leanIn) else 0
			self.latchRoll = if math.abs(steerIn) > 0.05 then math.sign(steerIn) else 0
		end
		if math.abs(leanIn) < 0.05 then
			self.latchPitch = 0
		end
		if math.abs(steerIn) < 0.05 then
			self.latchRoll = 0
		end
		local pIn = if math.sign(leanIn) ~= self.latchPitch then leanIn else 0
		local rIn = if math.sign(steerIn) ~= self.latchRoll then steerIn else 0
		local below = Workspace:Raycast(root.Position, -Vector3.yAxis * 80, rig.params)
		local targetUp = if below and below.Normal.Y > 0.5 then below.Normal else Vector3.yAxis
		local rate = up:Cross(targetUp) * AIR_LEVEL
		if rate.Magnitude > AIR_MAX then
			rate = rate.Unit * AIR_MAX
		end
		local inputRate = math.rad(recovery.AirInput)
		if pIn ~= 0 then
			rate += right * (-pIn * inputRate - rate:Dot(right))
		end
		if rIn ~= 0 then
			rate += forward * (rIn * inputRate - rate:Dot(forward))
		end
		local gain = AIR_DAMP * recovery.AirControl + (if pIn ~= 0 or rIn ~= 0 then AIR_INPUT_GAIN else 0)
		if gain > 0 then
			SimUtil.TrackRates(rig, rate + Vector3.yAxis * (angular.Y - rate.Y), Vector3.new(gain, 0, gain), Vector3.new(1, 0, 1))
		end
	end
	self.wasAirborne = airborne

	-- Gravity: real on the ground, Recovery.AirGravity in the air; air drag.
	SimUtil.RealGravity(rig, if airborne then recovery.AirGravity * G else G)
	local speed = velocity.Magnitude
	if speed > 0.1 then
		SimUtil.AddForce(rig, velocity.Unit * (-0.5 * RHO * spec.Aero.Cd * spec.Aero.Area * speed * speed))
	end

	-- Low-side: lying over at speed. Never stuck: upright when on its side and slow with a rider.
	if rider and not airborne and math.abs(lean) > math.rad(LOW_SIDE_LEAN) and kmh > 15 then
		self.crashed = true
	end
	if rider and recovery.AutoFlip and math.abs(lean) > math.rad(FLIP_LEAN) and root.AssemblyLinearVelocity.Magnitude < 4 then
		self.flipTimer += dt
		if self.flipTimer > 1.5 then
			self.flipTimer = 0
			self:Recover()
		end
	else
		self.flipTimer = 0
	end

	SimUtil.Finish(rig)
	return {
		Kind = "Motorcycle",
		SpeedKmh = forwardMs * 3.6,
		Rpm = self.rpm,
		Gear = self.gear,
		Steer = math.deg(self.steer),
		Lean = math.deg(lean),
		Pitch = math.deg(pitchRel),
		Wheelie = wheelie,
		Stoppie = stoppie,
		Crashed = self.crashed,
		Grounded = grounded,
		Slip = worstSlip,
		Stuck = false,
	}
end

function BikeSim.Destroy(self: BikeSim)
	SimUtil.Clear(self.rig)
end

return BikeSim
