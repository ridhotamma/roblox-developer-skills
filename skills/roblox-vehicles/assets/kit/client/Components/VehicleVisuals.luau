--!strict
-- Visuals for every vehicle near this client (tag "Vehicle"): wheels, tire smoke, skid marks,
-- tire squeal, rotors, propellers, control surfaces, boat spray, rotor downwash and engine sound.
--
-- Wheels (cars, bikes, landing gear): each frame this client sphere-casts each wheel's suspension
-- itself (same cast as the physics, nothing needs replicating), places the wheel at the spring
-- length, steers it from the driver seat's SteerFloat (which replicates) and spins it from its
-- ground speed. Retracted landing gear (model attribute GearDown = false) is hidden.
-- Tires (cars and bikes) estimate slip from what every client can see: sideways slip, wheelspin
-- at full throttle from a standstill, lock-up under hard braking. Slip drives smoke, skid marks
-- and squeal.
-- Rotors and propellers (ChassisRoot.Visuals, made by VehicleService) spin about their thinnest
-- axis: helicopter rotors spool up over Rotor.SpoolTime while someone flies it; propellers follow
-- the EngineThrottle attribute (from the driver, via VehicleControl). Control surfaces hinge about
-- their longest axis: ailerons from SteerFloat, elevators from ThrottleFloat, flaps from the Flaps
-- attribute. Attribute Invert = true on a surface flips it, MaxDeflection (degrees) sizes it.

local ReplicatedStorage = game:GetService("ReplicatedStorage")
local RunService = game:GetService("RunService")
local TweenService = game:GetService("TweenService")

local VehicleMath = require(ReplicatedStorage.Shared.Vehicle.VehicleMath)
local VehicleSpecs = require(ReplicatedStorage.Shared.Vehicle.VehicleSpecs)
local Water = require(ReplicatedStorage.Shared.Vehicle.Water)

local MPS = VehicleMath.METERS_PER_STUD
local DRAW_DISTANCE = 450 -- studs from the camera; farther vehicles skip casts and effects
local CAST_RADIUS = 0.85 -- must match the sims
local CAST_LIFT = 1 -- must match VehicleSim
local WALL_NORMAL = 0.35
local SMOKE_TEXTURE = "rbxasset://textures/particles/smoke_main.dds"
local SMOKE_MAX_RATE = 70 -- particles per second per wheel at full slip
local SKID_THRESHOLD = 0.45 -- slip above this leaves marks
local SKID_SEGMENT = 0.6 -- studs between skid segments
local SKID_LIFETIME = 12
local MAX_SKIDS = 500 -- shared by every vehicle on this client
local ROTOR_REVS = { MainRotor = 4, TailRotor = 18, Rotor = 4, Propeller = 25 } -- rev/s at full speed (visual)
local DEFLECTION = 22 -- degrees, default control surface travel

type WheelVisual = {
	mount: Attachment,
	visual: Instance,
	radius: number,
	staticLength: number,
	maxLength: number,
	offset: CFrame,
	front: boolean,
	steers: boolean,
	driven: boolean,
	gear: boolean,
	spin: number,
	smoke: ParticleEmitter?,
	smokeAnchor: Attachment?,
	lastSkid: Vector3?,
	hidden: boolean,
}

type PartVisual = {
	instance: Instance,
	role: string,
	spin: boolean,
	axis: Vector3,
	offset: CFrame,
	side: number,
	angle: number,
	invert: number,
	maxDeflection: number,
}

local skidFolder: Folder? = nil
local skids: { BasePart } = {}

local function skidParent(): Folder
	if skidFolder and skidFolder.Parent then
		return skidFolder
	end
	local f = Instance.new("Folder")
	f.Name = "SkidMarks"
	f.Parent = workspace
	skidFolder = f
	return f
end

local function addSkid(from: Vector3, to: Vector3, normal: Vector3, width: number, strength: number)
	local length = (to - from).Magnitude
	if length < 0.05 then
		return
	end
	local mid = (from + to) / 2 + normal * 0.03
	local mark = Instance.new("Part")
	mark.Anchored = true
	mark.CanCollide = false
	mark.CanQuery = false
	mark.CanTouch = false
	mark.CastShadow = false
	mark.Material = Enum.Material.SmoothPlastic
	mark.Color = Color3.fromRGB(20, 20, 20)
	mark.Transparency = 0.75 - 0.4 * math.clamp(strength, 0, 1)
	mark.Size = Vector3.new(width, 0.02, length + 0.05)
	mark.CFrame = CFrame.lookAt(mid, mid + (to - from), normal)
	mark.Parent = skidParent()
	table.insert(skids, mark)
	if #skids > MAX_SKIDS then
		local oldest = table.remove(skids, 1)
		if oldest then
			oldest:Destroy()
		end
	end
	task.delay(SKID_LIFETIME, function()
		if mark.Parent then
			TweenService:Create(mark, TweenInfo.new(2), { Transparency = 1 }):Play()
			task.wait(2)
			local index = table.find(skids, mark)
			if index then
				table.remove(skids, index)
			end
			mark:Destroy()
		end
	end)
end

local function emitter(parent: Attachment, size: number, color: Color3, lifetime: NumberRange, speed: NumberRange): ParticleEmitter
	local e = Instance.new("ParticleEmitter")
	e.Texture = SMOKE_TEXTURE
	e.Rate = 0
	e.Lifetime = lifetime
	e.Speed = speed
	e.SpreadAngle = Vector2.new(50, 50)
	e.EmissionDirection = Enum.NormalId.Top
	e.Drag = 1.6
	e.Acceleration = Vector3.new(0, 2.5, 0)
	e.Size = NumberSequence.new({ NumberSequenceKeypoint.new(0, size * 1.2), NumberSequenceKeypoint.new(1, size * 6) })
	e.Transparency = NumberSequence.new({
		NumberSequenceKeypoint.new(0, 0.55),
		NumberSequenceKeypoint.new(0.3, 0.6),
		NumberSequenceKeypoint.new(1, 1),
	})
	e.Rotation = NumberRange.new(0, 360)
	e.RotSpeed = NumberRange.new(-30, 30)
	e.LightInfluence = 1
	e.Color = ColorSequence.new(color)
	e.Parent = parent
	return e
end

local function place(visual: Instance, cframe: CFrame)
	if visual:IsA("BasePart") then
		visual.CFrame = cframe
	elseif visual:IsA("Model") then
		visual:PivotTo(cframe)
	end
end

local function setHidden(visual: Instance, hidden: boolean)
	local modifier = if hidden then 1 else 0
	if visual:IsA("BasePart") then
		visual.LocalTransparencyModifier = modifier
	end
	for _, d in visual:GetDescendants() do
		if d:IsA("BasePart") then
			d.LocalTransparencyModifier = modifier
		end
	end
end

local function setup(instance: Instance, trove: any)
	if not instance:IsA("Model") then
		return
	end
	local model = instance :: Model
	while model.Parent and model:GetAttribute("ChassisBuilt") ~= true do
		model:GetAttributeChangedSignal("ChassisBuilt"):Wait()
	end
	local spec = (VehicleSpecs :: any)[model:GetAttribute("Vehicle")]
	local root = model.PrimaryPart or model:WaitForChild("ChassisRoot", 10)
	if not spec or not root or not root:IsA("BasePart") then
		return
	end
	local kind = spec.Type or "Car"
	local tires = kind == "Car" or kind == "Motorcycle"

	-- Wheels.
	local drivetrain = spec.Drivetrain or (if kind == "Motorcycle" then "RWD" else "")
	local wheels: { WheelVisual } = {}
	for _, mount in root:GetChildren() do
		if mount:IsA("Attachment") and mount:GetAttribute("Wheel") then
			local link = mount:WaitForChild("Visual", 5) :: ObjectValue?
			if link and link.Value then
				local front = mount:GetAttribute("Front") == true
				local radius = mount:GetAttribute("Radius") :: number
				local smoke, anchor = nil, nil
				if tires then
					anchor = Instance.new("Attachment")
					anchor.Name = "TireSmoke"
					anchor.Parent = workspace.Terrain
					trove:Add(anchor)
					smoke = emitter(anchor, radius, Color3.fromRGB(225, 225, 225), NumberRange.new(1.2, 2.4), NumberRange.new(2, 6))
				end
				local gear = mount:GetAttribute("Gear") == true
				table.insert(wheels, {
					mount = mount,
					visual = link.Value,
					radius = radius,
					staticLength = mount:GetAttribute("StaticLength") :: number,
					maxLength = (mount:GetAttribute("MaxLength") :: number?) or spec.Suspension.MaxLength,
					offset = mount:GetAttribute("VisualOffset") :: CFrame,
					front = front,
					steers = if gear then mount:GetAttribute("Steer") == true else front,
					driven = drivetrain == "AWD" or drivetrain == (if front then "FWD" else "RWD"),
					gear = gear,
					spin = 0,
					smoke = smoke,
					smokeAnchor = anchor,
					lastSkid = nil,
					hidden = false,
				})
			end
		end
	end

	-- Rotors, propellers, control surfaces.
	local parts: { PartVisual } = {}
	local folder = root:FindFirstChild("Visuals")
	if folder then
		for _, link in folder:GetChildren() do
			if link:IsA("ObjectValue") and link.Value then
				local v = link.Value
				local maxDeflection = v:GetAttribute("MaxDeflection")
				table.insert(parts, {
					instance = v,
					role = link:GetAttribute("Role") :: string,
					spin = link:GetAttribute("Spin") == true,
					axis = link:GetAttribute("Axis") :: Vector3,
					offset = link:GetAttribute("Offset") :: CFrame,
					side = link:GetAttribute("Side") :: number,
					angle = 0,
					invert = if v:GetAttribute("Invert") == true then -1 else 1,
					maxDeflection = if typeof(maxDeflection) == "number" then maxDeflection else DEFLECTION,
				})
			end
		end
	end

	local seat: VehicleSeat? = nil
	for _, d in model:GetDescendants() do
		if d:IsA("VehicleSeat") and d:GetAttribute("DriverSeat") then
			seat = d
		end
	end

	local function loopSound(attribute: string, volume: number): Sound?
		local id = model:GetAttribute(attribute)
		if typeof(id) ~= "string" or id == "" then
			return nil
		end
		local s = Instance.new("Sound")
		s.SoundId = id
		s.Looped = true
		s.Volume = volume
		s.RollOffMaxDistance = if kind == "Plane" or kind == "Helicopter" then 600 else 250
		s.Parent = root
		s:Play()
		trove:Add(s)
		return s
	end
	local engine = loopSound("EngineSound", 0.6)
	local squeal = if tires then loopSound("TireSound", 0) else nil

	-- Spray and wake (boats), downwash dust (helicopters).
	local effectAnchor: Attachment? = nil
	local sprayAnchor: Attachment? = nil
	local wake: ParticleEmitter? = nil
	local spray: ParticleEmitter? = nil
	if kind == "Boat" or kind == "Helicopter" then
		local a = Instance.new("Attachment")
		a.Name = "VehicleEffect"
		a.Parent = workspace.Terrain
		trove:Add(a)
		effectAnchor = a
		local color = if kind == "Boat" then Color3.fromRGB(240, 248, 255) else Color3.fromRGB(190, 175, 150)
		local size = if kind == "Boat" then 1.5 else 3
		wake = emitter(a, size, color, NumberRange.new(0.8, 1.6), NumberRange.new(4, 10))
		if kind == "Boat" then
			local b = Instance.new("Attachment")
			b.Name = "BowSpray"
			b.Parent = workspace.Terrain
			trove:Add(b)
			sprayAnchor = b
			spray = emitter(b, 1, Color3.fromRGB(240, 248, 255), NumberRange.new(0.4, 0.9), NumberRange.new(6, 14))
		end
	end

	local params = RaycastParams.new()
	params.FilterType = Enum.RaycastFilterType.Exclude
	params.FilterDescendantsInstances = { model }
	params.RespectCanCollide = true
	params.IgnoreWater = true
	params.CollisionGroup = root.CollisionGroup
	local rotorSpeed = 0

	trove:Connect(RunService.RenderStepped, function(dt: number)
		local camera = workspace.CurrentCamera
		local near = camera ~= nil and (camera.CFrame.Position - root.Position).Magnitude <= DRAW_DISTANCE
		local cf = root.CFrame
		local up = cf.UpVector
		local forward = cf.LookVector
		local forwardSpeed = root.AssemblyLinearVelocity:Dot(forward) -- studs/s
		local speedMs = forwardSpeed * MPS
		local kmh = math.abs(speedMs) * 3.6
		local throttle = if seat then seat.ThrottleFloat else 0
		local steerFloat = if seat then seat.SteerFloat else 0
		local occupied = seat ~= nil and seat.Occupant ~= nil
		local engineThrottle = model:GetAttribute("EngineThrottle")
		local power = if typeof(engineThrottle) == "number" then engineThrottle else 0

		-- Steering angle of the steered wheels.
		local steerDeg = 0
		if kind == "Car" then
			local steering = spec.Steering
			local lock = steering.MaxAngle * (1 + (steering.HighSpeedScale - 1) * math.clamp(kmh / steering.HighSpeedKmh, 0, 1))
			steerDeg = steerFloat * lock
		elseif kind == "Motorcycle" then
			steerDeg = steerFloat * spec.Steering.MaxAngle * math.clamp(1 - kmh / (spec.Steering.LowSpeedKmh * 2), 0.05, 1)
		elseif spec.Gear and spec.Gear.SteerAngle then
			steerDeg = steerFloat * spec.Gear.SteerAngle * math.clamp(1 - kmh / 90, 0.15, 1)
		end
		local steerRotation = CFrame.fromAxisAngle(up, -math.rad(steerDeg))
		local gearHidden = model:GetAttribute("GearDown") == false
		local worstSlip = 0

		for _, wheel in wheels do
			if wheel.gear and wheel.hidden ~= gearHidden then
				wheel.hidden = gearHidden
				setHidden(wheel.visual, gearHidden)
			end
			local length = wheel.staticLength
			local hit: RaycastResult? = nil
			if near and not wheel.hidden then
				local castRadius = wheel.radius * CAST_RADIUS
				local inset = wheel.radius - castRadius
				local lift = wheel.radius * CAST_LIFT
				hit = workspace:Spherecast(wheel.mount.WorldPosition + up * lift, castRadius, -up * (wheel.maxLength + inset + lift), params)
				if hit and hit.Normal:Dot(up) < WALL_NORMAL then
					hit = nil
				end
				length = if hit then math.clamp(hit.Distance - inset - lift, 0, wheel.maxLength) else wheel.maxLength
			end
			if hit or kmh > 1 then
				wheel.spin -= forwardSpeed / wheel.radius * dt
			end
			local steer = if wheel.steers then CFrame.Angles(0, -math.rad(steerDeg), 0) else CFrame.identity
			place(
				wheel.visual,
				wheel.mount.WorldCFrame
					* CFrame.new(0, wheel.staticLength - length, 0)
					* CFrame.new(wheel.offset.Position)
					* steer
					* CFrame.Angles(wheel.spin, 0, 0)
					* wheel.offset.Rotation
			)

			-- Tires: slip estimate -> smoke, skids.
			local smoke, anchor = wheel.smoke, wheel.smokeAnchor
			if not (smoke and anchor) then
				continue
			end
			local slip = 0
			if hit then
				local contact = hit.Position
				local velocity = root:GetVelocityAtPosition(contact)
				local wheelForward = if wheel.steers then steerRotation * forward else forward
				local wheelRight = wheelForward:Cross(up)
				local longMs = velocity:Dot(wheelForward) * MPS
				local latMs = velocity:Dot(wheelRight) * MPS
				local slipAngle = math.deg(math.atan2(math.abs(latMs), math.max(math.abs(longMs), 1)))
				local sideways = if kmh > 12 then math.clamp((slipAngle - 7) / 18, 0, 1) else 0
				local wheelspin = if wheel.driven and throttle > 0.8 and kmh < 30 then (1 - kmh / 30) * throttle * 0.9 else 0
				local lockup = if math.sign(throttle) == -math.sign(speedMs) and math.abs(throttle) > 0.8 and kmh > 60 then 0.35 else 0
				slip = math.max(sideways, wheelspin, lockup)
				anchor.WorldPosition = contact + up * 0.2
				if slip > SKID_THRESHOLD then
					local last = wheel.lastSkid
					if last and (contact - last).Magnitude >= SKID_SEGMENT then
						if (contact - last).Magnitude < 6 then -- skip teleports and gaps
							addSkid(last, contact, hit.Normal, wheel.radius * 0.6, slip)
						end
						wheel.lastSkid = contact
					elseif not last then
						wheel.lastSkid = contact
					end
				else
					wheel.lastSkid = nil
				end
			else
				wheel.lastSkid = nil
			end
			smoke.Rate = if near then SMOKE_MAX_RATE * slip * slip else 0
			worstSlip = math.max(worstSlip, slip)
		end

		-- Rotors and propellers spin, control surfaces hinge.
		if kind == "Helicopter" then
			local spoolTime = math.max(spec.Rotor.SpoolTime, 0.1)
			rotorSpeed += math.clamp((if occupied then 1 else 0) - rotorSpeed, -dt / spoolTime, dt / spoolTime)
		end
		local flaps = model:GetAttribute("Flaps") == true
		for _, p in parts do
			if p.spin then
				local revs = ROTOR_REVS[p.role] or 10
				local rate = if kind == "Helicopter"
					then rotorSpeed
					elseif kind == "Boat" then power
					else (if occupied then 0.3 + 0.7 * power else 0) + math.min(math.abs(speedMs) / 60, 0.3)
				p.angle = (p.angle + revs * rate * 2 * math.pi * dt) % (2 * math.pi)
			else
				local target = 0
				if p.role == "Aileron" then
					target = steerFloat * p.side
				elseif p.role == "Elevator" then
					target = -throttle
				elseif p.role == "Rudder" then
					target = if kind == "Plane" then 0 else steerFloat
				elseif p.role == "Flap" then
					target = if flaps then -1 else 0
				end
				local wanted = math.rad(target * p.maxDeflection) * p.invert
				p.angle += math.clamp(wanted - p.angle, -4 * dt, 4 * dt)
			end
			if near then
				place(p.instance, cf * p.offset * CFrame.fromAxisAngle(p.axis, p.angle))
			end
		end

		-- Boat spray and wake; helicopter downwash.
		if near and kind == "Boat" and effectAnchor and wake and sprayAnchor and spray then
			local stern = cf:PointToWorldSpace(Vector3.new(0, 0, spec.Hull.Length * 0.45 / MPS))
			local bow = cf:PointToWorldSpace(Vector3.new(0, 0, -spec.Hull.Length * 0.35 / MPS))
			local sternWater = Water.HeightAt(stern)
			local bowWater = Water.HeightAt(bow)
			local sternWet = sternWater ~= nil and stern.Y - sternWater < spec.Hull.Depth / MPS
			local bowWet = bowWater ~= nil and bow.Y - bowWater < spec.Hull.Depth * 0.6 / MPS
			if sternWater then
				effectAnchor.WorldPosition = Vector3.new(stern.X, sternWater + 0.2, stern.Z)
			end
			if bowWater then
				sprayAnchor.WorldPosition = Vector3.new(bow.X, bowWater + 0.3, bow.Z)
			end
			wake.Rate = if sternWet then 50 * power + 2 * math.min(kmh, 60) else 0
			spray.Rate = if bowWet and kmh > 15 then math.min((kmh - 15) * 1.5, 90) else 0
		elseif kind == "Helicopter" and effectAnchor and wake then
			local below = if near and rotorSpeed > 0.3 then workspace:Raycast(root.Position, -Vector3.yAxis * (spec.Rotor.Diameter * 1.5 / MPS), params) else nil
			if below then
				effectAnchor.WorldPosition = below.Position + Vector3.yAxis * 0.5
				local height = below.Distance * MPS / (spec.Rotor.Diameter * 1.5)
				wake.Rate = 60 * rotorSpeed * math.clamp(1 - height, 0, 1)
			else
				wake.Rate = 0
			end
		end

		if squeal then
			squeal.Volume = if near then math.clamp((worstSlip - 0.3) * 1.2, 0, 0.8) else 0
			squeal.PlaybackSpeed = 0.9 + worstSlip * 0.2
		end
		if engine and near then
			if kind == "Car" or kind == "Motorcycle" then
				local _, rpm = VehicleMath.EstimateGear(spec, speedMs)
				local fraction = math.clamp(rpm / spec.Engine.RedlineRpm, 0, 1)
				engine.PlaybackSpeed = 0.55 + fraction * 1.1
				engine.Volume = if occupied then 0.35 + 0.45 * math.abs(throttle) else 0.15
			elseif kind == "Helicopter" then
				engine.PlaybackSpeed = 0.4 + 0.7 * rotorSpeed + 0.15 * power
				engine.Volume = 0.15 + 0.6 * rotorSpeed
			else
				engine.PlaybackSpeed = 0.6 + 0.8 * power
				engine.Volume = if occupied then 0.3 + 0.5 * power else 0
			end
		end
	end)
end

return {
	Tag = "Vehicle",
	Setup = setup,
}
