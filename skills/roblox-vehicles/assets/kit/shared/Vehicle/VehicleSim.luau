--!strict
-- Raycast-suspension vehicle simulation for one chassis built by VehicleService.
--
-- Runs on whoever owns the car's physics: the driver's client while someone drives it, the
-- server while it's parked. Each physics step, per wheel:
--   1. sphere-cast down from the suspension mount (a sphere almost the tire's size rolls over
--      curbs, kerbs and terrain steps instead of catching them; steep walls are not "ground")
--   2. spring + damper force along the chassis up axis (Roblox units, frequency-tuned)
--   3. anti-roll bars move force between the left and right wheel of each axle
--   4. tire forces in real units: lateral grip from the slip angle (tire curve with slide
--      grip), drive and brake force along the wheel, all limited by mu * load
--   5. converted to Roblox force and written to that wheel's VectorForces
-- plus drag and downforce at the centre of mass, and the never-get-stuck layer:
--   * stuck assist: throttle held but not moving -> lift and push; repeated -> recover
--   * flip recovery: on its side or roof and slow -> set upright
--   * air control: gently levels the car while airborne so it lands on its wheels
-- Drift helpers: countersteer assist and a yaw stabilizer past the spec's max drift angle.

local Workspace = game:GetService("Workspace")

local VehicleMath = require(script.Parent.VehicleMath)
local VehicleSpecs = require(script.Parent.VehicleSpecs)

local MPS = VehicleMath.METERS_PER_STUD
local G = VehicleMath.G

local CAST_RADIUS = 0.85 -- sphere-cast radius as a share of the wheel radius
local WALL_NORMAL = 0.35 -- ground must face at least this much up (cos ~70°); steeper = wall
local STUCK_SECONDS = 1.0 -- throttle held with no movement before the assist kicks in
local UNSTICK_SECONDS = 0.45
local MAX_UNSTICK_TRIES = 3 -- then recover (lift, upright, small step back)
local FLIP_SECONDS = 1.5
local DRIFT_MIN_ANGLE = 10 -- degrees of body slip that count as drifting
local DRIFT_MIN_KMH = 25

export type Input = { Throttle: number, Steer: number, Handbrake: boolean }

export type Telemetry = {
	SpeedKmh: number, -- signed: negative when rolling backwards
	Rpm: number,
	Gear: number, -- -1 reverse, 1..n
	Steer: number, -- degrees at the wheels
	Grounded: number, -- wheels touching the ground
	Slip: number, -- 0..1+, how far past grip the worst tire is
	DriftAngle: number, -- body slip angle in degrees (signed)
	Drifting: boolean,
	Stuck: boolean, -- the unstick assist is active
}

type Wheel = {
	name: string,
	mount: Attachment,
	contact: Attachment,
	spring: VectorForce,
	tire: VectorForce,
	radius: number,
	front: boolean,
	left: boolean,
	driveShare: number,
	brakeShare: number,
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

local VehicleSim = {}
VehicleSim.__index = VehicleSim

export type VehicleSim = typeof(setmetatable(
	{} :: {
		model: Model,
		root: BasePart,
		spec: any,
		wheels: { Wheel },
		rearCount: number,
		aero: VectorForce,
		stabilizer: Torque?,
		params: RaycastParams,
		gear: number,
		shiftTimer: number,
		steer: number,
		rpm: number,
		stuckTimer: number,
		unstickUntil: number,
		unstickTries: number,
		flipTimer: number,
		lastRecover: number,
		inertia: number,
	},
	VehicleSim
))

-- Returns nil if the model hasn't been built by VehicleService yet.
function VehicleSim.new(model: Model): VehicleSim?
	local root = model.PrimaryPart
	local spec = (VehicleSpecs :: any)[model:GetAttribute("Vehicle")]
	if not root or not spec or model:GetAttribute("ChassisBuilt") ~= true then
		return nil
	end
	local suspension = spec.Suspension
	local mass = root.AssemblyMass

	local frontCount, rearCount = 0, 0
	for _, child in root:GetChildren() do
		if child:IsA("Attachment") and child:GetAttribute("Wheel") then
			if child:GetAttribute("Front") then
				frontCount += 1
			else
				rearCount += 1
			end
		end
	end

	local drivetrain = spec.Drivetrain
	local frontDriveShare = if drivetrain == "FWD" then 1 elseif drivetrain == "RWD" then 0 else spec.AwdFrontSplit
	local staticLength = suspension.MaxLength * suspension.RideHeight

	local wheels: { Wheel } = {}
	for _, mount in root:GetChildren() do
		if not (mount:IsA("Attachment") and mount:GetAttribute("Wheel")) then
			continue
		end
		local name = mount:GetAttribute("WheelName") :: string
		local front = mount:GetAttribute("Front") == true
		local axleCount = if front then frontCount else rearCount
		local axleShare = if front then spec.FrontWeight else 1 - spec.FrontWeight
		local cornerMass = mass * axleShare / axleCount
		local frequency = if front then suspension.FrequencyFront else suspension.FrequencyRear
		local k, c = VehicleMath.Spring(cornerMass, frequency, suspension.DampingRatio)
		local staticForce = cornerMass * Workspace.Gravity
		local contact = root:FindFirstChild("Contact_" .. name) :: Attachment

		table.insert(wheels, {
			name = name,
			mount = mount,
			contact = contact,
			spring = mount:FindFirstChild("Spring") :: VectorForce,
			tire = contact:FindFirstChild("Tire") :: VectorForce,
			radius = mount:GetAttribute("Radius") :: number,
			front = front,
			left = mount:GetAttribute("Left") == true,
			driveShare = (if front then frontDriveShare else 1 - frontDriveShare) / axleCount,
			brakeShare = (if front then spec.Brakes.FrontBias else 1 - spec.Brakes.FrontBias) / axleCount,
			k = k,
			c = c,
			restLength = staticLength + staticForce / k,
			staticForce = staticForce,
			axleWeightN = spec.Mass * G * axleShare / axleCount,
			cornerMassKg = spec.Mass * axleShare / axleCount,
			length = staticLength,
			grounded = false,
			hit = nil,
			springForce = 0,
			slip = 0,
		})
	end

	local params = RaycastParams.new()
	params.FilterType = Enum.RaycastFilterType.Exclude
	params.FilterDescendantsInstances = { model }
	params.RespectCanCollide = true
	params.CollisionGroup = root.CollisionGroup -- skips parts in "VehicleIgnore" (grass, small props)

	-- Rough rotational inertia of the root box (the only part with mass) for air control.
	local size = root.Size
	local inertia = mass * (size.X * size.X + size.Z * size.Z) / 12

	local aeroAttachment = root:FindFirstChild("AeroAttachment") :: Attachment
	return setmetatable({
		model = model,
		root = root,
		spec = spec,
		wheels = wheels,
		rearCount = math.max(rearCount, 1),
		aero = aeroAttachment:FindFirstChild("Aero") :: VectorForce,
		stabilizer = aeroAttachment:FindFirstChild("Stabilizer") :: Torque?,
		params = params,
		gear = 1,
		shiftTimer = 0,
		steer = 0,
		rpm = spec.Engine.IdleRpm,
		stuckTimer = 0,
		unstickUntil = 0,
		unstickTries = 0,
		flipTimer = 0,
		lastRecover = -math.huge,
		inertia = inertia,
	}, VehicleSim)
end

-- Puts the car upright on the ground below it, a little higher, facing the same way.
-- Used automatically (flipped, hopelessly stuck) and by the driver's Reset button.
function VehicleSim.Recover(self: VehicleSim, stepBack: number?)
	local now = os.clock()
	if now - self.lastRecover < 2 then
		return
	end
	self.lastRecover = now
	local root = self.root
	local look = root.CFrame.LookVector
	local flat = Vector3.new(look.X, 0, look.Z)
	local forward = if flat.Magnitude > 0.1 then flat.Unit else Vector3.zAxis
	local position = root.Position - forward * (stepBack or 0)
	local ground = Workspace:Raycast(position + Vector3.yAxis * 12, -Vector3.yAxis * 60, self.params)
	local groundY = if ground then ground.Position.Y else position.Y
	local height = self.spec.ComHeight / MPS + self.spec.Suspension.MaxLength + 1.5
	local upright = Vector3.new(position.X, groundY + height, position.Z)
	root.CFrame = CFrame.lookAt(upright, upright + forward)
	root.AssemblyLinearVelocity = Vector3.zero
	root.AssemblyAngularVelocity = Vector3.zero
	self.stuckTimer = 0
	self.unstickTries = 0
	self.flipTimer = 0
end

function VehicleSim.Step(self: VehicleSim, dt: number, input: Input): Telemetry
	local spec = self.spec
	local root = self.root
	local cf = root.CFrame
	local up = cf.UpVector
	local forward = cf.LookVector
	local right = cf.RightVector
	local velocity = root.AssemblyLinearVelocity
	local forwardMs = velocity:Dot(forward) * MPS
	local lateralMs = velocity:Dot(right) * MPS
	local speedKmh = math.abs(forwardMs) * 3.6
	local toRoblox = root.AssemblyMass / spec.Mass / MPS -- newtons -> Roblox force
	local now = os.clock()

	-- Body slip angle: how far the car is travelling sideways relative to where it points.
	local driftAngle = if math.abs(forwardMs) > 1 then math.deg(math.atan2(lateralMs, math.abs(forwardMs))) else 0
	local drifting = math.abs(driftAngle) > DRIFT_MIN_ANGLE and speedKmh > DRIFT_MIN_KMH and forwardMs > 0

	-- Steering: speed-sensitive lock, plus countersteer assist while sliding (steer toward
	-- the direction of travel, like a driver catching a slide), eased toward the target.
	local steering = spec.Steering
	local lock = steering.MaxAngle
		* (1 + (steering.HighSpeedScale - 1) * math.clamp(speedKmh / steering.HighSpeedKmh, 0, 1))
	local target = math.clamp(input.Steer, -1, 1) * lock
	if drifting then
		target += spec.Drift.Countersteer * driftAngle
	end
	target = math.clamp(target, -steering.MaxAngle, steering.MaxAngle)
	local maxStep = steering.MaxAngle * steering.Speed * dt
	self.steer += math.clamp(target - self.steer, -maxStep, maxStep)

	-- Pedals: throttle forward, brake when moving the other way, reverse from a stop.
	local drive, brake = 0, 0
	if input.Throttle > 0.05 then
		if forwardMs < -1 then
			brake = input.Throttle
		else
			if self.gear < 1 then
				self.gear = 1
			end
			drive = input.Throttle
		end
	elseif input.Throttle < -0.05 then
		if forwardMs > 1 then
			brake = -input.Throttle
		else
			self.gear = -1
			drive = -input.Throttle
		end
	end

	-- Gearbox.
	if self.shiftTimer > 0 then
		self.shiftTimer -= dt
	elseif self.gear >= 1 then
		local nextGear = VehicleMath.AutoShift(spec, self.gear, forwardMs)
		if nextGear ~= self.gear then
			self.gear = nextGear
			self.shiftTimer = spec.Gearbox.ShiftTime
		end
	end
	local driveN, rpm = VehicleMath.Drive(spec, forwardMs, self.gear, drive)
	if self.shiftTimer > 0 then
		driveN = 0
	end
	if self.gear < 0 then
		driveN = -driveN
	end
	self.rpm += (rpm - self.rpm) * math.min(1, dt * 12)

	-- Pass 1: suspension lengths from a sphere cast per wheel.
	local maxLength = spec.Suspension.MaxLength
	local grounded = 0
	for _, wheel in self.wheels do
		local castRadius = wheel.radius * CAST_RADIUS
		local inset = wheel.radius - castRadius -- sphere centre sits this far below the wheel centre
		local hit = Workspace:Spherecast(wheel.mount.WorldPosition, castRadius, -up * (maxLength + inset), self.params)
		if hit and hit.Normal:Dot(up) < WALL_NORMAL then
			hit = nil -- a wall or the side of a curb: let the body hull deal with it, don't climb it
		end
		wheel.hit = hit
		if hit then
			local length = math.clamp(hit.Distance - inset, 0, maxLength)
			local compressionSpeed = (wheel.length - length) / dt
			wheel.springForce = wheel.k * (wheel.restLength - length) + wheel.c * compressionSpeed
			wheel.length = length
			wheel.grounded = true
			grounded += 1
		else
			wheel.length = maxLength
			wheel.springForce = 0
			wheel.grounded = false
		end
	end

	-- Pass 2: anti-roll bars (per axle, left vs right compression).
	local antiRoll = spec.Suspension.AntiRoll
	if antiRoll > 0 then
		for _, front in { true, false } do
			local leftSum, rightSum, leftN, rightN, k = 0, 0, 0, 0, 0
			for _, wheel in self.wheels do
				if wheel.front == front then
					k = wheel.k
					if wheel.left then
						leftSum += maxLength - wheel.length
						leftN += 1
					else
						rightSum += maxLength - wheel.length
						rightN += 1
					end
				end
			end
			if leftN > 0 and rightN > 0 then
				local transfer = antiRoll * k * (leftSum / leftN - rightSum / rightN)
				for _, wheel in self.wheels do
					if wheel.front == front and wheel.grounded then
						wheel.springForce += if wheel.left then transfer else -transfer
					end
				end
			end
		end
	end

	-- Pass 3: tire forces.
	local tires = spec.Tires
	local brakes = spec.Brakes
	local downforceN = VehicleMath.Downforce(spec, velocity.Magnitude * MPS)
	local rollCenter = spec.Suspension.RollCenter
	local worstSlip = 0
	local steerRotation = CFrame.fromAxisAngle(up, -math.rad(self.steer))

	-- Yaw stabilizer: past the spec's max drift angle, the rear finds grip again so the car
	-- swings back instead of spinning out.
	local overRotation = math.max(0, math.abs(driftAngle) - spec.Drift.MaxAngle) / spec.Drift.MaxAngle
	local rearGripBoost = 1 + spec.Drift.Stabilizer * math.min(overRotation * 3, 1)

	for _, wheel in self.wheels do
		local hit = wheel.hit
		if not hit then
			wheel.spring.Force = Vector3.zero
			wheel.tire.Force = Vector3.zero
			wheel.slip = 0
			continue
		end
		local springForce = math.max(0, wheel.springForce)
		local loadRatio = math.clamp(springForce / wheel.staticForce, 0, 3)
		local loadN = wheel.axleWeightN * loadRatio + downforceN / #self.wheels

		local mu = if wheel.front then tires.GripFront else tires.GripRear
		if not wheel.front then
			mu *= rearGripBoost
			if input.Handbrake then
				mu *= brakes.HandbrakeGripScale
			end
		end
		local gripN = mu * loadN

		local wheelForward = if wheel.front then steerRotation * forward else forward
		local wheelRight = wheelForward:Cross(up)
		local contactVelocity = root:GetVelocityAtPosition(hit.Position)
		local longMs = contactVelocity:Dot(wheelForward) * MPS
		local latMs = contactVelocity:Dot(wheelRight) * MPS
		local stopLimit = wheel.cornerMassKg / dt -- N per (m/s): never push past zero in one step

		local slipAngle = math.atan2(latMs, math.max(math.abs(longMs), 0.5))
		local latN = -gripN * VehicleMath.TireCurve(slipAngle, tires.Stiffness, tires.Shape, tires.SlideGrip)
		latN = math.clamp(latN, -stopLimit * math.abs(latMs), stopLimit * math.abs(latMs))

		local longN = driveN * wheel.driveShare
		local brakeN = brake * spec.Mass * G * brakes.DecelG * wheel.brakeShare
		if input.Handbrake and not wheel.front then
			brakeN += spec.Mass * G * brakes.DecelG * 0.5 / self.rearCount
		end
		local resistN = brakeN + tires.RollingResistance * loadN
		local direction = if longMs >= 0 then 1 else -1
		longN -= direction * math.min(resistN, stopLimit * math.abs(longMs))

		local total = math.sqrt(latN * latN + longN * longN)
		wheel.slip = if gripN > 0 then total / gripN else 0
		if total > gripN and total > 0 then
			local scale = gripN / total
			latN *= scale
			longN *= scale
		end
		worstSlip = math.max(worstSlip, wheel.slip)

		local lift = (root.Position - hit.Position):Dot(up) * rollCenter
		wheel.contact.WorldPosition = hit.Position + up * lift
		wheel.spring.Force = up * springForce
		wheel.tire.Force = (wheelForward * longN + wheelRight * latN) * toRoblox
	end

	-- Aero: drag against the motion, downforce as a share of real weight.
	local speedMs = velocity.Magnitude * MPS
	local extraForce = Vector3.zero
	if speedMs > 0.1 then
		extraForce -= velocity.Unit * VehicleMath.Drag(spec, speedMs) * toRoblox
	end
	if downforceN > 0 then
		extraForce -= up * (downforceN / (spec.Mass * G)) * root.AssemblyMass * Workspace.Gravity
	end

	-- Never stuck, part 1: throttle held but going nowhere (beached on a kerb, wedged against a
	-- tree, wheels hanging in a ditch) -> lift and push for a moment; after several tries, recover.
	local recovery = spec.Recovery
	local stuck = false
	if recovery.StuckAssist then
		local trying = math.abs(input.Throttle) > 0.5
		if trying and velocity.Magnitude * MPS < 0.4 and now >= self.unstickUntil then
			self.stuckTimer += dt
		elseif not trying or velocity.Magnitude * MPS > 1.5 then
			self.stuckTimer = 0
			if velocity.Magnitude * MPS > 3 then
				self.unstickTries = 0
			end
		end
		if self.stuckTimer >= STUCK_SECONDS then
			self.stuckTimer = 0
			self.unstickTries += 1
			if self.unstickTries > MAX_UNSTICK_TRIES then
				self:Recover(if input.Throttle > 0 then 3 else -3)
			else
				self.unstickUntil = now + UNSTICK_SECONDS
			end
		end
		if now < self.unstickUntil then
			stuck = true
			local weight = root.AssemblyMass * Workspace.Gravity
			local push = if input.Throttle >= 0 then forward else -forward
			extraForce += Vector3.yAxis * weight * 0.6 + push * spec.Mass * G * 0.45 * toRoblox
		end
	end
	self.aero.Force = extraForce

	-- Never stuck, part 2: on its side or roof and nearly stopped -> set it upright.
	local uprightness = up:Dot(Vector3.yAxis)
	if recovery.AutoFlip and uprightness < 0.3 and velocity.Magnitude < 4 then
		self.flipTimer += dt
		if self.flipTimer >= FLIP_SECONDS then
			self:Recover()
		end
	else
		self.flipTimer = 0
	end

	-- Never stuck, part 3: in the air, gently level the car so it lands on its wheels.
	local stabilizer = self.stabilizer
	if stabilizer then
		if grounded == 0 and recovery.AirControl > 0 then
			local axis = up:Cross(Vector3.yAxis) -- rotation that brings "up" back to world up
			local angular = root.AssemblyAngularVelocity
			local level = axis * 10 - (angular - Vector3.yAxis * angular.Y) * 3
			stabilizer.Torque = level * self.inertia * recovery.AirControl
		else
			stabilizer.Torque = Vector3.zero
		end
	end

	return {
		SpeedKmh = forwardMs * 3.6,
		Rpm = self.rpm,
		Gear = self.gear,
		Steer = self.steer,
		Grounded = grounded,
		Slip = worstSlip,
		DriftAngle = driftAngle,
		Drifting = drifting,
		Stuck = stuck,
	}
end

-- Zeroes every force (call when this machine stops simulating the car).
function VehicleSim.Destroy(self: VehicleSim)
	for _, wheel in self.wheels do
		wheel.spring.Force = Vector3.zero
		wheel.tire.Force = Vector3.zero
	end
	self.aero.Force = Vector3.zero
	if self.stabilizer then
		self.stabilizer.Torque = Vector3.zero
	end
end

return VehicleSim
