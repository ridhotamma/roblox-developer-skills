--!strict
-- Raycast-suspension vehicle simulation for one chassis built by VehicleService.
--
-- Runs on whoever owns the car's physics: the driver's client while someone drives it, the
-- server while it's parked. Each physics step, per wheel:
--   1. raycast down from the suspension mount -> spring length
--   2. spring + damper force along the chassis up axis (Roblox units, frequency-tuned)
--   3. anti-roll bars move force between the left and right wheel of each axle
--   4. tire forces in real units: lateral grip from the slip angle (tire curve), drive and
--      brake force along the wheel, all limited by mu * load (friction circle)
--   5. converted to Roblox force and written to that wheel's VectorForces
-- plus drag and downforce at the centre of mass. Wheels are visual only (VehicleVisuals).

local Workspace = game:GetService("Workspace")

local VehicleMath = require(script.Parent.VehicleMath)
local VehicleSpecs = require(script.Parent.VehicleSpecs)

local MPS = VehicleMath.METERS_PER_STUD
local G = VehicleMath.G

export type Input = { Throttle: number, Steer: number, Handbrake: boolean }

export type Telemetry = {
	SpeedKmh: number, -- signed: negative when rolling backwards
	Rpm: number,
	Gear: number, -- -1 reverse, 1..n
	Steer: number, -- degrees
	Grounded: number, -- wheels touching the ground
	Slip: number, -- 0..1+, how far past grip the worst tire is (for smoke and skid sounds)
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
	k: number,
	c: number,
	restLength: number,
	staticForce: number,
	axleWeightN: number, -- real static load on this wheel (N)
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
		aero: VectorForce,
		params: RaycastParams,
		gear: number,
		shiftTimer: number,
		steer: number,
		rpm: number,
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

	local wheels: { Wheel } = {}
	local counts = { front = 0, rear = 0, frontDrive = 0, rearDrive = 0 }
	for _, child in root:GetChildren() do
		if child:IsA("Attachment") and child:GetAttribute("Wheel") then
			if child:GetAttribute("Front") then
				counts.front += 1
			else
				counts.rear += 1
			end
		end
	end

	local drivetrain = spec.Drivetrain
	local frontDriveShare = if drivetrain == "FWD" then 1 elseif drivetrain == "RWD" then 0 else spec.AwdFrontSplit

	for _, mount in root:GetChildren() do
		if not (mount:IsA("Attachment") and mount:GetAttribute("Wheel")) then
			continue
		end
		local name = mount:GetAttribute("WheelName") :: string
		local front = mount:GetAttribute("Front") == true
		local axleCount = if front then counts.front else counts.rear
		local axleShare = if front then spec.FrontWeight else 1 - spec.FrontWeight
		local cornerMass = mass * axleShare / axleCount
		local frequency = if front then suspension.FrequencyFront else suspension.FrequencyRear
		local k, c = VehicleMath.Spring(cornerMass, frequency, suspension.DampingRatio)
		local staticForce = cornerMass * Workspace.Gravity
		local staticLength = suspension.MaxLength * suspension.RideHeight
		local driveAxleShare = if front then frontDriveShare else 1 - frontDriveShare

		table.insert(wheels, {
			name = name,
			mount = mount,
			contact = root:FindFirstChild("Contact_" .. name) :: Attachment,
			spring = mount:FindFirstChild("Spring") :: VectorForce,
			tire = (root:FindFirstChild("Contact_" .. name) :: Attachment):FindFirstChild("Tire") :: VectorForce,
			radius = mount:GetAttribute("Radius") :: number,
			front = front,
			left = mount:GetAttribute("Left") == true,
			driveShare = driveAxleShare / axleCount,
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

	local self = setmetatable({
		model = model,
		root = root,
		spec = spec,
		wheels = wheels,
		aero = (root:FindFirstChild("AeroAttachment") :: Attachment):FindFirstChild("Aero") :: VectorForce,
		params = params,
		gear = 1,
		shiftTimer = 0,
		steer = 0,
		rpm = spec.Engine.IdleRpm,
	}, VehicleSim)
	return self
end

function VehicleSim.Step(self: VehicleSim, dt: number, input: Input): Telemetry
	local spec = self.spec
	local root = self.root
	local cf = root.CFrame
	local up = cf.UpVector
	local forward = cf.LookVector
	local velocity = root.AssemblyLinearVelocity
	local forwardMs = velocity:Dot(forward) * MPS
	local speedKmh = math.abs(forwardMs) * 3.6
	local toRoblox = root.AssemblyMass / spec.Mass / MPS -- newtons -> Roblox force

	-- Steering: speed-sensitive lock, eased toward the input.
	local steering = spec.Steering
	local lock = steering.MaxAngle
		* (1 + (steering.HighSpeedScale - 1) * math.clamp(speedKmh / steering.HighSpeedKmh, 0, 1))
	local target = math.clamp(input.Steer, -1, 1) * lock
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
	self.rpm += (rpm - self.rpm) * math.min(1, dt * 12) -- smooth for sound and HUD

	-- Pass 1: suspension lengths.
	local maxLength = spec.Suspension.MaxLength
	local grounded = 0
	for _, wheel in self.wheels do
		local origin = wheel.mount.WorldPosition
		local hit = Workspace:Raycast(origin, -up * (maxLength + wheel.radius), self.params)
		wheel.hit = hit
		if hit then
			local length = math.clamp(hit.Distance - wheel.radius, 0, maxLength)
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
	local rollCenter = spec.Suspension.RollCenter or 0.5
	local worstSlip = 0
	local steerRotation = CFrame.fromAxisAngle(up, -math.rad(self.steer))

	for _, wheel in self.wheels do
		local hit = wheel.hit
		if not hit then
			wheel.spring.Force = Vector3.zero
			wheel.tire.Force = Vector3.zero
			continue
		end
		local springForce = math.max(0, wheel.springForce)
		local loadRatio = math.clamp(springForce / wheel.staticForce, 0, 3)
		local loadN = wheel.axleWeightN * loadRatio + downforceN / #self.wheels

		local mu = if wheel.front then tires.GripFront else tires.GripRear
		if input.Handbrake and not wheel.front then
			mu *= brakes.HandbrakeGripScale
		end
		local gripN = mu * loadN

		local wheelForward = if wheel.front then steerRotation * forward else forward
		local wheelRight = wheelForward:Cross(up)
		local contactVelocity = root:GetVelocityAtPosition(hit.Position)
		local longMs = contactVelocity:Dot(wheelForward) * MPS
		local latMs = contactVelocity:Dot(wheelRight) * MPS
		local stopLimit = wheel.cornerMassKg / dt -- N per (m/s): never push past zero in one step

		-- Lateral grip from the slip angle.
		local slipAngle = math.atan2(latMs, math.max(math.abs(longMs), 0.5))
		local latN = -gripN * VehicleMath.TireCurve(slipAngle, tires.Stiffness, tires.Shape)
		latN = math.clamp(latN, -stopLimit * math.abs(latMs), stopLimit * math.abs(latMs))

		-- Longitudinal: drive, brakes, handbrake, rolling resistance.
		local longN = driveN * wheel.driveShare
		local brakeN = brake * spec.Mass * G * brakes.DecelG
			* (if wheel.front then brakes.FrontBias else 1 - brakes.FrontBias)
			/ (if wheel.front then self:_axleCount(true) else self:_axleCount(false))
		if input.Handbrake and not wheel.front then
			brakeN += spec.Mass * G * brakes.DecelG * 0.5 / self:_axleCount(false)
		end
		local resistN = brakeN + tires.RollingResistance * loadN
		local direction = if longMs >= 0 then 1 else -1
		longN -= direction * math.min(resistN, stopLimit * math.abs(longMs))

		-- Friction circle: combined force can't exceed grip.
		local total = math.sqrt(latN * latN + longN * longN)
		wheel.slip = if gripN > 0 then total / gripN else 0
		if total > gripN and total > 0 then
			local scale = gripN / total
			latN *= scale
			longN *= scale
		end
		worstSlip = math.max(worstSlip, wheel.slip)

		-- Tire forces act between the contact patch and the CoM height (RollCenter blends them):
		-- 0 = at the ground (most body roll), 1 = at CoM height (no roll from cornering).
		local lift = (root.Position - hit.Position):Dot(up) * rollCenter
		wheel.contact.WorldPosition = hit.Position + up * lift
		wheel.spring.Force = up * springForce
		wheel.tire.Force = (wheelForward * longN + wheelRight * latN) * toRoblox
	end

	-- Aero: drag against the motion, downforce as a share of real weight.
	local speedMs = velocity.Magnitude * MPS
	local aeroForce = Vector3.zero
	if speedMs > 0.1 then
		aeroForce -= velocity.Unit * VehicleMath.Drag(spec, speedMs) * toRoblox
	end
	if downforceN > 0 then
		aeroForce -= up * (downforceN / (spec.Mass * G)) * root.AssemblyMass * Workspace.Gravity
	end
	self.aero.Force = aeroForce

	return {
		SpeedKmh = forwardMs * 3.6,
		Rpm = self.rpm,
		Gear = self.gear,
		Steer = self.steer,
		Grounded = grounded,
		Slip = worstSlip,
	}
end

function VehicleSim._axleCount(self: VehicleSim, front: boolean): number
	local n = 0
	for _, wheel in self.wheels do
		if wheel.front == front then
			n += 1
		end
	end
	return math.max(n, 1)
end

-- Zeroes every force (call when this machine stops simulating the car).
function VehicleSim.Destroy(self: VehicleSim)
	for _, wheel in self.wheels do
		wheel.spring.Force = Vector3.zero
		wheel.tire.Force = Vector3.zero
	end
	self.aero.Force = Vector3.zero
end

return VehicleSim
