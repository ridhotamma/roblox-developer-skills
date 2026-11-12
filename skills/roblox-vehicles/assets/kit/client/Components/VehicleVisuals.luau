--!strict
-- Wheel visuals and engine sound for every vehicle near this client (tag "Vehicle").
--
-- Wheels are anchored, non-colliding visuals. Each frame this client raycasts each wheel's
-- suspension itself (cheap, and nothing needs replicating), places the wheel at the spring
-- length, steers the front wheels from the driver seat's SteerFloat (which replicates), and
-- spins every wheel from its ground speed. The engine loop's pitch follows an rpm estimate.

local ReplicatedStorage = game:GetService("ReplicatedStorage")
local RunService = game:GetService("RunService")

local VehicleMath = require(ReplicatedStorage.Shared.Vehicle.VehicleMath)
local VehicleSpecs = require(ReplicatedStorage.Shared.Vehicle.VehicleSpecs)

local DRAW_DISTANCE = 450 -- studs from the camera; farther cars skip suspension raycasts

type WheelVisual = {
	mount: Attachment,
	visual: Instance,
	radius: number,
	staticLength: number,
	offset: CFrame,
	front: boolean,
	spin: number,
}

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

	local wheels: { WheelVisual } = {}
	for _, mount in root:GetChildren() do
		if mount:IsA("Attachment") and mount:GetAttribute("Wheel") then
			local link = mount:WaitForChild("Visual", 5) :: ObjectValue?
			if link and link.Value then
				table.insert(wheels, {
					mount = mount,
					visual = link.Value,
					radius = mount:GetAttribute("Radius") :: number,
					staticLength = mount:GetAttribute("StaticLength") :: number,
					offset = mount:GetAttribute("VisualOffset") :: CFrame,
					front = mount:GetAttribute("Front") == true,
					spin = 0,
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

	local engine: Sound? = nil
	local soundId = model:GetAttribute("EngineSound")
	if typeof(soundId) == "string" and soundId ~= "" then
		local s = Instance.new("Sound")
		s.SoundId = soundId
		s.Looped = true
		s.Volume = 0.6
		s.RollOffMaxDistance = 250
		s.Parent = root
		s:Play()
		engine = s
		trove:Add(s)
	end

	local params = RaycastParams.new()
	params.FilterType = Enum.RaycastFilterType.Exclude
	params.FilterDescendantsInstances = { model }
	params.RespectCanCollide = true
	local maxLength = spec.Suspension.MaxLength

	trove:Connect(RunService.RenderStepped, function(dt: number)
		local camera = workspace.CurrentCamera
		-- Far away: keep wheels attached at rest height, skip the raycasts.
		local near = camera ~= nil and (camera.CFrame.Position - root.Position).Magnitude <= DRAW_DISTANCE
		local cf = root.CFrame
		local up = cf.UpVector
		local forwardSpeed = root.AssemblyLinearVelocity:Dot(cf.LookVector) -- studs/s
		local speedMs = forwardSpeed * VehicleMath.METERS_PER_STUD
		local kmh = math.abs(speedMs) * 3.6

		local steering = spec.Steering
		local lock = steering.MaxAngle
			* (1 + (steering.HighSpeedScale - 1) * math.clamp(kmh / steering.HighSpeedKmh, 0, 1))
		local steerDeg = if seat then seat.SteerFloat * lock else 0

		for _, wheel in wheels do
			local origin = wheel.mount.WorldPosition
			local length = wheel.staticLength
			if near then
				local hit = workspace:Raycast(origin, -up * (maxLength + wheel.radius), params)
				length = if hit then math.clamp(hit.Distance - wheel.radius, 0, maxLength) else maxLength
			end
			wheel.spin -= forwardSpeed / wheel.radius * dt
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
		end

		if engine and near then
			local _, rpm = VehicleMath.EstimateGear(spec, speedMs)
			local driving = seat ~= nil and seat.Occupant ~= nil
			local fraction = math.clamp(rpm / spec.Engine.RedlineRpm, 0, 1)
			engine.PlaybackSpeed = 0.55 + fraction * 1.1
			engine.Volume = if driving then 0.35 + 0.45 * math.abs(seat and seat.ThrottleFloat or 0) else 0.15
		end
	end)
end

return {
	Tag = "Vehicle",
	Setup = setup,
}
