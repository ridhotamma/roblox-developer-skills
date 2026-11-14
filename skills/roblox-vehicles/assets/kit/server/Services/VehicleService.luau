--!strict
-- Turns any car model into a working chassis, so one spec drives any mesh.
--
-- A vehicle model needs:
--   * attribute Vehicle = a key of VehicleSpecs (Hatchback, SportsCar, PickupTruck, Kart...)
--   * the CollectionService tag "Vehicle"
--   * wheels named WheelFL, WheelFR, WheelRL, WheelRR (BaseParts or Models); add more axles
--     as WheelRL2, WheelRR2 ... (F = front/steered, R = rear; L/R = side)
--   * a VehicleSeat (named DriverSeat, or the first VehicleSeat found)
--   * optional: attribute EngineSound = "rbxassetid://..." (engine loop, pitched by rpm)
--   * optional per wheel: attribute WheelRadius (studs) if the mesh's bounding box is misleading
--
-- Building (once per model): an invisible ChassisRoot part at the spec's centre of mass (from
-- FrontWeight and ComHeight) carries all the mass; body parts are welded to it and made
-- massless; wheels become anchored visuals; each wheel gets a suspension mount and a tire
-- contact attachment with VectorForces. Performance comes only from the spec.
--
-- Ownership: the driver's client simulates the car while seated (smooth, no input lag); the
-- server simulates it when empty, and anchors it once it has settled to save work.

local CollectionService = game:GetService("CollectionService")
local Players = game:GetService("Players")
local ReplicatedStorage = game:GetService("ReplicatedStorage")
local PhysicsService = game:GetService("PhysicsService")
local RunService = game:GetService("RunService")
local ServerStorage = game:GetService("ServerStorage")

local VehicleMath = require(ReplicatedStorage.Shared.Vehicle.VehicleMath)
local VehicleSim = require(ReplicatedStorage.Shared.Vehicle.VehicleSim)
local VehicleSpecs = require(ReplicatedStorage.Shared.Vehicle.VehicleSpecs)

local TAG = "Vehicle"
local WHEEL_PATTERN = "^Wheel([FR])([LR])(%d*)$"
local SLEEP_AFTER = 2 -- seconds settled before a parked car is anchored
local SPEED_MARGIN = 1.35 -- flag drivers going this much over the spec's top speed
local COLLISION_GROUP = "VehicleHull"
local IGNORE_GROUP = "VehicleIgnore"
local MIN_ROOT_MASS = 150 -- assembly mass units for the chassis root (see build)


-- Optional: roblox-security's Sanctions for implausible speeds.
local securityFolder = script.Parent.Parent:FindFirstChild("Security")
local sanctionsModule = securityFolder and securityFolder:FindFirstChild("Sanctions")
local Sanctions: any = if sanctionsModule then (require :: any)(sanctionsModule) else nil

type Parked = { sim: VehicleSim.VehicleSim, settledFor: number }

local VehicleService = {}

local parked: { [Model]: Parked } = {}
local drivers: { [Model]: Player } = {}
local topSpeeds: { [any]: number } = {}

local function centerOf(wheel: Instance): Vector3
	if wheel:IsA("BasePart") then
		return wheel.Position
	end
	local cf = (wheel :: Model):GetBoundingBox()
	return cf.Position
end

local function radiusOf(wheel: Instance): number
	local attr = wheel:GetAttribute("WheelRadius")
	if typeof(attr) == "number" then
		return attr
	end
	local size = if wheel:IsA("BasePart") then wheel.Size else select(2, (wheel :: Model):GetBoundingBox())
	return math.max(size.X, size.Y, size.Z) / 2 -- a wheel's diameter is its largest dimension
end

local function pivotOf(wheel: Instance): CFrame
	return if wheel:IsA("BasePart") then wheel.CFrame else (wheel :: Model):GetPivot()
end

local function makeVisual(part: BasePart)
	part.Anchored = true
	part.CanCollide = false
	part.CanQuery = false
	part.CanTouch = false
	part.Massless = true
end

local function findWheels(model: Model): { { instance: Instance, front: boolean, left: boolean } }
	local wheels = {}
	for _, d in model:GetDescendants() do
		local axle, side = string.match(d.Name, WHEEL_PATTERN)
		if axle and (d:IsA("BasePart") or d:IsA("Model")) then
			-- Skip parts inside another wheel model.
			local parent = d.Parent
			local nested = false
			while parent and parent ~= model do
				if string.match(parent.Name, WHEEL_PATTERN) then
					nested = true
					break
				end
				parent = parent.Parent
			end
			if not nested then
				table.insert(wheels, { instance = d, front = axle == "F", left = side == "L" })
			end
		end
	end
	return wheels
end

-- Collision groups: vehicle hulls ignore anything in "VehicleIgnore" (grass, flowers, small
-- rocks, bushes, debris) for both collisions and suspension casts.
local function ensureCollisionGroups()
	for _, group in { COLLISION_GROUP, IGNORE_GROUP } do
		if not PhysicsService:IsCollisionGroupRegistered(group) then
			PhysicsService:RegisterCollisionGroup(group)
		end
	end
	PhysicsService:CollisionGroupSetCollidable(COLLISION_GROUP, IGNORE_GROUP, false)
end

-- Invisible collision hull in the root's space: a box between rounded nose and tail cylinders,
-- with its bottom no lower than the axles.
local function buildHull(root: BasePart, minCorner: Vector3, maxCorner: Vector3, axleY: number, friction: number)
	local bottom = math.max(minCorner.Y, axleY)
	local top = math.max(maxCorner.Y, bottom + 1)
	local height = top - bottom
	local width = math.max(maxCorner.X - minCorner.X, 1)
	local length = math.max(maxCorner.Z - minCorner.Z, 2)
	local radius = math.min(height / 2, length / 4)
	local centerX = (minCorner.X + maxCorner.X) / 2
	local centerZ = (minCorner.Z + maxCorner.Z) / 2
	local physics = PhysicalProperties.new(0.7, friction, 0.05, 100, 1) -- friction weight 100: ours wins

	local function hullPart(name: string, shape: Enum.PartType, size: Vector3, offset: Vector3)
		local part = Instance.new("Part")
		part.Name = name
		part.Shape = shape
		part.Size = size
		part.CFrame = root.CFrame * CFrame.new(offset)
		part.Transparency = 1
		part.CanCollide = true
		part.CanQuery = false
		part.CanTouch = false
		part.Massless = true
		part.CustomPhysicalProperties = physics
		part.CollisionGroup = COLLISION_GROUP
		part.Parent = root.Parent
		local weld = Instance.new("WeldConstraint")
		weld.Part0 = root
		weld.Part1 = part
		weld.Parent = root
	end

	hullPart(
		"HullBody",
		Enum.PartType.Block,
		Vector3.new(width, height, math.max(length - 2 * radius, 0.5)),
		Vector3.new(centerX, bottom + height / 2, centerZ)
	)
	-- Cylinders lie along X (the car's width): rounded lower edges at the nose (-Z) and tail (+Z).
	for _, z in { minCorner.Z + radius, maxCorner.Z - radius } do
		hullPart(
			"HullEnd",
			Enum.PartType.Cylinder,
			Vector3.new(width, radius * 2, radius * 2),
			Vector3.new(centerX, bottom + radius, z)
		)
	end
end

local function build(model: Model, spec: any): boolean
	local wheels = findWheels(model)
	local fronts, rears = 0, 0
	for _, w in wheels do
		if w.front then
			fronts += 1
		else
			rears += 1
		end
	end
	if fronts == 0 or rears == 0 then
		warn(`[VehicleService] {model:GetFullName()} needs wheels named WheelFL/WheelFR/WheelRL/WheelRR`)
		return false
	end

	-- Geometry from the wheels, so any body mesh works.
	local up = model:GetPivot().UpVector
	local frontCenter, rearCenter, allCenter, groundSum = Vector3.zero, Vector3.zero, Vector3.zero, 0
	local leftmost, rightmost = math.huge, -math.huge
	for _, w in wheels do
		local center = centerOf(w.instance)
		if w.front then
			frontCenter += center / fronts
		else
			rearCenter += center / rears
		end
		allCenter += center / #wheels
		groundSum += center:Dot(up) - radiusOf(w.instance)
	end
	local along = frontCenter - rearCenter
	local forward = (along - up * along:Dot(up)).Unit
	local wheelbase = (along - up * along:Dot(up)).Magnitude
	local right = forward:Cross(up)
	for _, w in wheels do
		local x = centerOf(w.instance):Dot(right)
		leftmost = math.min(leftmost, x)
		rightmost = math.max(rightmost, x)
	end
	local track = math.max(rightmost - leftmost, 2)
	local groundHeight = groundSum / #wheels

	-- Centre of mass: FrontWeight along the wheelbase from the rear axle, ComHeight above ground.
	local com = rearCenter + forward * (wheelbase * spec.FrontWeight)
	com += right * ((allCenter - com):Dot(right))
	com += up * (groundHeight + spec.ComHeight / VehicleMath.METERS_PER_STUD - com:Dot(up))

	local root = Instance.new("Part")
	root.Name = "ChassisRoot"
	root.Size = Vector3.new(track, math.max(1, spec.ComHeight / VehicleMath.METERS_PER_STUD), wheelbase * 1.15)
	root.CFrame = CFrame.lookAt(com, com + forward, up)
	root.Transparency = 1
	root.CanCollide = false
	root.CanQuery = false
	root.CanTouch = false
	-- At least MIN_ROOT_MASS, so a seated character (welded in, and not massless) stays a small
	-- share of the assembly: on a light kart it would otherwise be half the mass, up high and to
	-- one side, leaning the car and shifting its balance. Performance doesn't depend on this mass.
	local volume = root.Size.X * root.Size.Y * root.Size.Z
	local density = math.clamp(MIN_ROOT_MASS / volume, 0.7, 100)
	root.CustomPhysicalProperties = PhysicalProperties.new(density, 0.3, 0.5)
	root.CollisionGroup = COLLISION_GROUP -- VehicleSim's casts use this group's rules
	root.Parent = model

	-- Body: weld to the root, massless, so the root alone defines mass and inertia.
	local wheelSet: { [Instance]: boolean } = {}
	for _, w in wheels do
		wheelSet[w.instance] = true
	end
	local function inWheel(part: Instance): boolean
		local p: Instance? = part
		while p and p ~= model do
			if wheelSet[p] then
				return true
			end
			p = p.Parent
		end
		return false
	end
	-- Joints between the body and a wheel would pin the whole car to the anchored wheel visuals.
	for _, d in model:GetDescendants() do
		if d:IsA("JointInstance") or d:IsA("WeldConstraint") then
			local a = (d :: any).Part0 :: Instance?
			local b = (d :: any).Part1 :: Instance?
			if a and b and inWheel(a) ~= inWheel(b) then
				d:Destroy()
			end
		end
	end
	-- Never stuck, the body side: detailed meshes snag on kerbs, roots and terrain ridges. Unless
	-- the model opts out (attribute KeepCollision = true), the body stops colliding and a hidden
	-- hull takes over: bottom at axle height (clearance), rounded nose and tail (ride over and
	-- deflect off things), very low friction (scrape along walls and trees instead of grabbing).
	local autoHull = spec.Body.AutoHull and model:GetAttribute("KeepCollision") ~= true
	local minCorner = Vector3.one * math.huge
	local maxCorner = -Vector3.one * math.huge
	for _, d in model:GetDescendants() do
		if d:IsA("BasePart") and d ~= root then
			if inWheel(d) then
				makeVisual(d)
			else
				d.Anchored = false
				d.Massless = true
				d.CollisionGroup = COLLISION_GROUP
				if autoHull then
					d.CanCollide = false
					for _, sx in { -0.5, 0.5 } do
						for _, sy in { -0.5, 0.5 } do
							for _, sz in { -0.5, 0.5 } do
								local world = (d.CFrame * CFrame.new(d.Size * Vector3.new(sx, sy, sz))).Position
								local corner = root.CFrame:PointToObjectSpace(world)
								minCorner = minCorner:Min(corner)
								maxCorner = maxCorner:Max(corner)
							end
						end
					end
				end
				local weld = Instance.new("WeldConstraint")
				weld.Part0 = root
				weld.Part1 = d
				weld.Parent = root
			end
		end
	end
	if autoHull and minCorner.X < math.huge then
		local axleY = 0
		for _, w in wheels do
			axleY += root.CFrame:PointToObjectSpace(centerOf(w.instance)).Y / #wheels
		end
		buildHull(root, minCorner, maxCorner, axleY, spec.Body.HullFriction)
	end

	-- Suspension mounts and tire contacts per wheel.
	local staticLength = spec.Suspension.MaxLength * spec.Suspension.RideHeight
	for _, w in wheels do
		local name = w.instance.Name
		local center = centerOf(w.instance)
		local mountCFrame = root.CFrame.Rotation + center + up * staticLength

		local mount = Instance.new("Attachment")
		mount.Name = "Mount_" .. name
		mount.WorldCFrame = mountCFrame
		mount:SetAttribute("Wheel", true)
		mount:SetAttribute("WheelName", name)
		mount:SetAttribute("Front", w.front)
		mount:SetAttribute("Left", w.left)
		mount:SetAttribute("Radius", radiusOf(w.instance))
		mount:SetAttribute("StaticLength", staticLength)
		mount:SetAttribute("VisualOffset", mountCFrame:ToObjectSpace(pivotOf(w.instance)))
		mount.Parent = root

		local visual = Instance.new("ObjectValue")
		visual.Name = "Visual"
		visual.Value = w.instance
		visual.Parent = mount

		local spring = Instance.new("VectorForce")
		spring.Name = "Spring"
		spring.Attachment0 = mount
		spring.RelativeTo = Enum.ActuatorRelativeTo.World
		spring.ApplyAtCenterOfMass = false
		spring.Force = Vector3.zero
		spring.Parent = mount

		local contact = Instance.new("Attachment")
		contact.Name = "Contact_" .. name
		contact.WorldPosition = center - up * radiusOf(w.instance)
		contact.Parent = root
		local tire = Instance.new("VectorForce")
		tire.Name = "Tire"
		tire.Attachment0 = contact
		tire.RelativeTo = Enum.ActuatorRelativeTo.World
		tire.ApplyAtCenterOfMass = false
		tire.Force = Vector3.zero
		tire.Parent = contact
	end

	local aeroAttachment = Instance.new("Attachment")
	aeroAttachment.Name = "AeroAttachment"
	aeroAttachment.Parent = root
	local aero = Instance.new("VectorForce")
	aero.Name = "Aero"
	aero.Attachment0 = aeroAttachment
	aero.RelativeTo = Enum.ActuatorRelativeTo.World
	aero.ApplyAtCenterOfMass = true
	aero.Force = Vector3.zero
	aero.Parent = aeroAttachment

	-- Air control: VehicleSim levels the car with this while all wheels are off the ground.
	local stabilizer = Instance.new("Torque")
	stabilizer.Name = "Stabilizer"
	stabilizer.Attachment0 = aeroAttachment
	stabilizer.RelativeTo = Enum.ActuatorRelativeTo.World
	stabilizer.Torque = Vector3.zero
	stabilizer.Parent = aeroAttachment

	model.PrimaryPart = root
	model:SetAttribute("ChassisBuilt", true)
	return true
end

local function driverSeat(model: Model): VehicleSeat?
	local named = model:FindFirstChild("DriverSeat", true)
	if named and named:IsA("VehicleSeat") then
		return named
	end
	return model:FindFirstChildWhichIsA("VehicleSeat", true)
end

local function park(model: Model)
	local root = model.PrimaryPart
	if not root then
		return
	end
	root.Anchored = false
	pcall(function()
		root:SetNetworkOwner(nil)
	end)
	local sim = VehicleSim.new(model)
	if sim then
		parked[model] = { sim = sim, settledFor = 0 }
	end
end

local function bind(instance: Instance)
	if not instance:IsA("Model") or not instance:IsDescendantOf(workspace) then
		return
	end
	local model = instance :: Model
	local spec = (VehicleSpecs :: any)[model:GetAttribute("Vehicle")]
	if not spec then
		warn(`[VehicleService] {model:GetFullName()}: attribute Vehicle must be one of the VehicleSpecs keys`)
		return
	end
	if model:GetAttribute("ChassisBuilt") ~= true and not build(model, spec) then
		return
	end

	local seat = driverSeat(model)
	if not seat then
		warn(`[VehicleService] {model:GetFullName()} has no VehicleSeat`)
		return
	end
	seat:SetAttribute("DriverSeat", true)
	seat.HeadsUpDisplay = false

	seat:GetPropertyChangedSignal("Occupant"):Connect(function()
		local occupant = seat.Occupant
		local player = occupant and Players:GetPlayerFromCharacter(occupant.Parent)
		local root = model.PrimaryPart
		if player and root then
			-- Hand the physics to the driver; their client runs VehicleSim from now on.
			local entry = parked[model]
			if entry then
				entry.sim:Destroy()
				parked[model] = nil
			end
			root.Anchored = false
			drivers[model] = player
			pcall(function()
				root:SetNetworkOwner(player)
			end)
		else
			drivers[model] = nil
			park(model)
		end
	end)

	park(model)
end

local function unbind(instance: Instance)
	local model = instance :: Model
	local entry = parked[model]
	if entry then
		entry.sim:Destroy()
	end
	parked[model] = nil
	drivers[model] = nil
end

-- Spawns a vehicle from ServerStorage.Assets.Vehicles[name] (any model following the rules above).
function VehicleService:Spawn(name: string, cframe: CFrame, parent: Instance?): Model?
	local assets = ServerStorage:FindFirstChild("Assets")
	local folder = assets and assets:FindFirstChild("Vehicles")
	local template = folder and folder:FindFirstChild(name)
	if not template or not template:IsA("Model") then
		warn(`[VehicleService] no template ServerStorage.Assets.Vehicles.{name}`)
		return nil
	end
	local model = template:Clone()
	model:PivotTo(cframe)
	CollectionService:AddTag(model, TAG)
	model.Parent = parent or workspace
	return model
end

function VehicleService:Init()
	ensureCollisionGroups()
end

function VehicleService:Start()
	CollectionService:GetInstanceAddedSignal(TAG):Connect(bind)
	CollectionService:GetInstanceRemovedSignal(TAG):Connect(unbind)
	for _, model in CollectionService:GetTagged(TAG) do
		task.spawn(bind, model)
	end

	-- No pedal: VehicleSim's hill hold brakes all four wheels once stopped. (The handbrake would
	-- only lower rear grip - it's a drift control - and let parked cars slide off slopes.)
	local idle = { Throttle = 0, Steer = 0, Handbrake = false }
	RunService.PreSimulation:Connect(function(dt)
		for model, entry in parked do
			local root = model.PrimaryPart
			if not root or not model.Parent then
				parked[model] = nil
				continue
			end
			if root.Anchored then
				continue
			end
			local telemetry = entry.sim:Step(dt, idle)
			local still = root.AssemblyLinearVelocity.Magnitude < 0.3 and root.AssemblyAngularVelocity.Magnitude < 0.1
			entry.settledFor = if still and telemetry.Grounded > 0 then entry.settledFor + dt else 0
			if entry.settledFor >= SLEEP_AFTER then
				entry.sim:Destroy()
				root.Anchored = true -- asleep until someone sits in it
			end
		end
	end)

	-- Plausibility check on driven cars (the driver's client owns the physics).
	task.spawn(function()
		while true do
			task.wait(1)
			for model, player in drivers do
				local root = model.PrimaryPart
				local spec = (VehicleSpecs :: any)[model:GetAttribute("Vehicle")]
				if root and spec then
					local limitKmh = topSpeeds[spec] or VehicleMath.TopSpeedKmh(spec)
					topSpeeds[spec] = limitKmh
					local kmh = VehicleMath.KmhFromStudsPerSecond(root.AssemblyLinearVelocity.Magnitude)
					if kmh > limitKmh * SPEED_MARGIN + 30 then
						warn(`[VehicleService] {player.Name} driving {model.Name} at {math.floor(kmh)} km/h`)
						if Sanctions then
							Sanctions.Flag(player, "VehicleSpeed", 2, `{math.floor(kmh)} km/h`)
						end
					end
				end
			end
		end
	end)
end

return VehicleService
