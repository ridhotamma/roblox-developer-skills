--!strict
-- Wheel visuals, tire smoke, skid marks, tire squeal and engine sound for every vehicle near
-- this client (tag "Vehicle").
--
-- Each frame this client sphere-casts each wheel's suspension itself (same cast as the physics,
-- nothing needs replicating), places the wheel at the spring length, steers the front wheels
-- from the driver seat's SteerFloat (which replicates), and spins every wheel from its ground
-- speed. Per wheel it also estimates slip from what every client can see:
--   * sideways slip: the contact patch's sideways speed vs where the wheel points (drifts,
--     handbrake turns, slides)
--   * wheelspin: full throttle at low speed on a driven wheel (launches, burnouts)
--   * lock-up: hard braking at speed
-- Slip drives the smoke emitter rate, skid-mark segments and the squeal volume.

local ReplicatedStorage = game:GetService("ReplicatedStorage")
local RunService = game:GetService("RunService")
local TweenService = game:GetService("TweenService")

local VehicleMath = require(ReplicatedStorage.Shared.Vehicle.VehicleMath)
local VehicleSpecs = require(ReplicatedStorage.Shared.Vehicle.VehicleSpecs)

local DRAW_DISTANCE = 450 -- studs from the camera; farther cars skip casts and effects
local CAST_RADIUS = 0.85 -- must match VehicleSim
local WALL_NORMAL = 0.35
local SMOKE_TEXTURE = "rbxasset://textures/particles/smoke_main.dds"
local SMOKE_MAX_RATE = 70 -- particles per second per wheel at full slip
local SKID_THRESHOLD = 0.45 -- slip above this leaves marks
local SKID_SEGMENT = 0.6 -- studs between skid segments
local SKID_LIFETIME = 12
local MAX_SKIDS = 500 -- shared by every car on this client

type WheelVisual = {
	mount: Attachment,
	visual: Instance,
	radius: number,
	staticLength: number,
	offset: CFrame,
	front: boolean,
	driven: boolean,
	spin: number,
	smoke: ParticleEmitter,
	smokeAnchor: Attachment,
	lastSkid: Vector3?,
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

local function smokeEmitter(parent: Attachment, radius: number): ParticleEmitter
	local e = Instance.new("ParticleEmitter")
	e.Texture = SMOKE_TEXTURE
	e.Rate = 0
	e.Lifetime = NumberRange.new(1.2, 2.4)
	e.Speed = NumberRange.new(2, 6)
	e.SpreadAngle = Vector2.new(50, 50)
	e.EmissionDirection = Enum.NormalId.Top
	e.Drag = 1.6
	e.Acceleration = Vector3.new(0, 2.5, 0)
	e.Size = NumberSequence.new({
		NumberSequenceKeypoint.new(0, radius * 1.2),
		NumberSequenceKeypoint.new(1, radius * 6),
	})
	e.Transparency = NumberSequence.new({
		NumberSequenceKeypoint.new(0, 0.55),
		NumberSequenceKeypoint.new(0.3, 0.6),
		NumberSequenceKeypoint.new(1, 1),
	})
	e.Rotation = NumberRange.new(0, 360)
	e.RotSpeed = NumberRange.new(-30, 30)
	e.LightEmission = 0
	e.LightInfluence = 1
	e.Color = ColorSequence.new(Color3.fromRGB(225, 225, 225))
	e.Parent = parent
	return e
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

	local drivetrain = spec.Drivetrain
	local wheels: { WheelVisual } = {}
	for _, mount in root:GetChildren() do
		if mount:IsA("Attachment") and mount:GetAttribute("Wheel") then
			local link = mount:WaitForChild("Visual", 5) :: ObjectValue?
			if link and link.Value then
				local front = mount:GetAttribute("Front") == true
				local radius = mount:GetAttribute("Radius") :: number
				local anchor = Instance.new("Attachment")
				anchor.Name = "TireSmoke"
				anchor.Parent = workspace.Terrain
				trove:Add(anchor)
				table.insert(wheels, {
					mount = mount,
					visual = link.Value,
					radius = radius,
					staticLength = mount:GetAttribute("StaticLength") :: number,
					offset = mount:GetAttribute("VisualOffset") :: CFrame,
					front = front,
					driven = drivetrain == "AWD" or drivetrain == (if front then "FWD" else "RWD"),
					spin = 0,
					smoke = smokeEmitter(anchor, radius),
					smokeAnchor = anchor,
					lastSkid = nil,
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
		s.RollOffMaxDistance = 250
		s.Parent = root
		s:Play()
		trove:Add(s)
		return s
	end
	local engine = loopSound("EngineSound", 0.6)
	local squeal = loopSound("TireSound", 0)

	local params = RaycastParams.new()
	params.FilterType = Enum.RaycastFilterType.Exclude
	params.FilterDescendantsInstances = { model }
	params.RespectCanCollide = true
	params.CollisionGroup = root.CollisionGroup
	local maxLength = spec.Suspension.MaxLength

	trove:Connect(RunService.RenderStepped, function(dt: number)
		local camera = workspace.CurrentCamera
		local near = camera ~= nil and (camera.CFrame.Position - root.Position).Magnitude <= DRAW_DISTANCE
		local cf = root.CFrame
		local up = cf.UpVector
		local forward = cf.LookVector
		local forwardSpeed = root.AssemblyLinearVelocity:Dot(forward) -- studs/s
		local speedMs = forwardSpeed * VehicleMath.METERS_PER_STUD
		local kmh = math.abs(speedMs) * 3.6
		local throttle = if seat then seat.ThrottleFloat else 0

		local steering = spec.Steering
		local lock = steering.MaxAngle
			* (1 + (steering.HighSpeedScale - 1) * math.clamp(kmh / steering.HighSpeedKmh, 0, 1))
		local steerDeg = if seat then seat.SteerFloat * lock else 0
		local steerRotation = CFrame.fromAxisAngle(up, -math.rad(steerDeg))
		local worstSlip = 0

		for _, wheel in wheels do
			local length = wheel.staticLength
			local hit: RaycastResult? = nil
			if near then
				local castRadius = wheel.radius * CAST_RADIUS
				local inset = wheel.radius - castRadius
				hit = workspace:Spherecast(wheel.mount.WorldPosition, castRadius, -up * (maxLength + inset), params)
				if hit and hit.Normal:Dot(up) < WALL_NORMAL then
					hit = nil
				end
				length = if hit then math.clamp(hit.Distance - inset, 0, maxLength) else maxLength
			end
			wheel.spin -= forwardSpeed / wheel.radius * dt

			-- Place the visual wheel.
			local steer = if wheel.front then CFrame.Angles(0, -math.rad(steerDeg), 0) else CFrame.identity
			local placed = wheel.mount.WorldCFrame
				* CFrame.new(0, wheel.staticLength - length, 0)
				* CFrame.new(wheel.offset.Position)
				* steer
				* CFrame.Angles(wheel.spin, 0, 0)
				* wheel.offset.Rotation
			if wheel.visual:IsA("BasePart") then
				wheel.visual.CFrame = placed
			elseif wheel.visual:IsA("Model") then
				wheel.visual:PivotTo(placed)
			end

			-- Slip estimate -> smoke, skids.
			local slip = 0
			if hit then
				local contact = hit.Position
				local velocity = root:GetVelocityAtPosition(contact)
				local wheelForward = if wheel.front then steerRotation * forward else forward
				local wheelRight = wheelForward:Cross(up)
				local longMs = velocity:Dot(wheelForward) * VehicleMath.METERS_PER_STUD
				local latMs = velocity:Dot(wheelRight) * VehicleMath.METERS_PER_STUD
				local slipAngle = math.deg(math.atan2(math.abs(latMs), math.max(math.abs(longMs), 1)))
				local sideways = if kmh > 12 then math.clamp((slipAngle - 7) / 18, 0, 1) else 0
				local wheelspin = if wheel.driven and throttle > 0.8 and kmh < 30
					then (1 - kmh / 30) * throttle * 0.9
					else 0
				local lockup = if math.sign(throttle) == -math.sign(speedMs) and math.abs(throttle) > 0.8 and kmh > 60
					then 0.35
					else 0
				slip = math.max(sideways, wheelspin, lockup)

				wheel.smokeAnchor.WorldPosition = contact + up * 0.2
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
			wheel.smoke.Rate = if near then SMOKE_MAX_RATE * slip * slip else 0
			worstSlip = math.max(worstSlip, slip)
		end

		if squeal then
			squeal.Volume = if near then math.clamp((worstSlip - 0.3) * 1.2, 0, 0.8) else 0
			squeal.PlaybackSpeed = 0.9 + worstSlip * 0.2
		end
		if engine and near then
			local _, rpm = VehicleMath.EstimateGear(spec, speedMs)
			local driving = seat ~= nil and seat.Occupant ~= nil
			local fraction = math.clamp(rpm / spec.Engine.RedlineRpm, 0, 1)
			engine.PlaybackSpeed = 0.55 + fraction * 1.1
			engine.Volume = if driving then 0.35 + 0.45 * math.abs(throttle) else 0.15
		end
	end)
end

return {
	Tag = "Vehicle",
	Setup = setup,
}
