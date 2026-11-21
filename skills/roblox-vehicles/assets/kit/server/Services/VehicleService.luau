--!strict
-- Turns any vehicle model into a working chassis, so one spec drives any mesh. The spec's Type picks
-- the physics: Car (default), Motorcycle, Boat, Plane, Helicopter, Tank or Train.
--
-- A vehicle model needs:
--   * attribute Vehicle = a key of VehicleSpecs (Hatchback, SportBike, Speedboat, LightPlane...)
--   * the CollectionService tag "Vehicle"
--   * a VehicleSeat (named DriverSeat, or the first VehicleSeat found)
--   * cars: wheels named WheelFL, WheelFR, WheelRL, WheelRR (BaseParts or Models); more axles as
--     WheelRL2, WheelRR2 ... (F = front/steered, R = rear; L/R = side)
--   * motorcycles: WheelF and WheelR
--   * planes: landing gear wheels (WheelF nose + WheelRL/WheelRR mains, or WheelFL/WheelFR mains +
--     WheelR tail wheel for a tail-dragger), optional Propeller, Aileron*, Elevator, Rudder, Flap*
--   * helicopters: Skid* parts (long thin landing skids) or gear wheels; MainRotor, TailRotor
--   * boats: nothing else; the lowest point of the body is the keel. Optional Propeller.
--   * tanks: TrackL and TrackR (their bottoms are the ground line, their centres the tread), Turret
--     and Gun (visuals turned by VehicleVisuals; a Muzzle attachment at the barrel's end), optional
--     road wheels WheelL1.. / WheelR1..
--   * trains: the lead vehicle's parts, and cars as child Models Car1, Car2 ... in a line behind it
--     (each becomes its own assembly); a TrainTrack (tag "TrainTrack") to run on, the one named by
--     attribute Track or the nearest. Optional per car: attributes Mass (kg), BogieSpacing (m).
--   * all but cars: the model's pivot faces forward (LookVector to the nose or bow, UpVector up)
--   * optional: attribute EngineSound = "rbxassetid://..." (engine loop)
--   * optional per wheel: attribute WheelRadius (studs) if the mesh's bounding box is misleading
--
-- Building (once per model): an invisible ChassisRoot part at the spec's centre of mass carries all
-- the mass; body parts are welded to it, made massless and stop colliding (a rounded low-friction
-- hull collides instead); wheels, rotors, propellers and control surfaces become anchored visuals.
-- Cars get suspension mounts with VectorForces (VehicleSim); the other types get one SimForce and
-- one SimTorque (SimUtil) plus wheel or skid mounts. Performance comes only from the spec.
--
-- Ownership: the driver's client simulates the vehicle while seated (smooth, no input lag); the
-- server simulates it when empty, and anchors it once it has settled to save work. Seated players
-- go into the VehicleRider collision group (limbs don't scrape the road, casts ignore them).
--
-- Tank guns: the driver's shots come through VehicleControl; the server checks the driver, the
-- reload and that the shot leaves the muzzle along the gun, then fires VehicleService.Fired(player,
-- model, origin, direction, gun) for your projectiles (roblox-combat), and with Gun.DefaultShell a
-- harmless prototype shell (raycast and explosion).

local CollectionService = game:GetService("CollectionService")
local Players = game:GetService("Players")
local ReplicatedStorage = game:GetService("ReplicatedStorage")
local PhysicsService = game:GetService("PhysicsService")
local RunService = game:GetService("RunService")
local ServerStorage = game:GetService("ServerStorage")

local Sims = require(ReplicatedStorage.Shared.Vehicle.Sims)
local VehicleMath = require(ReplicatedStorage.Shared.Vehicle.VehicleMath)
local VehicleSpecs = require(ReplicatedStorage.Shared.Vehicle.VehicleSpecs)
local Water = require(ReplicatedStorage.Shared.Vehicle.Water)

local TAG = "Vehicle"
local WHEEL_PATTERN = "^Wheel([FR])([LR])(%d*)$"
local SLEEP_AFTER = 2 -- seconds settled before a parked car is anchored
local SPEED_MARGIN = 1.35 -- flag drivers going this much over the spec's top speed
local COLLISION_GROUP = "VehicleHull"
local IGNORE_GROUP = "VehicleIgnore"
local RIDER_GROUP = "VehicleRider"
local MIN_ROOT_MASS = 150 -- assembly mass units for the chassis root (see build)
local BOAT_DENSITY = 100 -- boat roots are dense so Terrain water's own buoyancy is ~1-2% of the weight
local LOOSE_WHEEL_PATTERN = "^Wheel([FR])([LR]?)(%d*)$"
local SKID_RADIUS_M = 0.15
local RMU_PER_KG = MIN_ROOT_MASS / 1300 -- tanks and trains: a car's root mass per kg, so they outweigh cars in proportion
local ROAD_WHEEL_PATTERN = "^Wheel([LR])%d*$"
local CAR_PATTERN = "^Car(%d+)$"
local TRAIN_HULL_CLEARANCE = 0.8 -- metres above the rail: train hulls clear the rails and platforms' edges
local MPS = VehicleMath.METERS_PER_STUD
-- Visual parts that spin (rotors, propellers) or hinge (control surfaces), by name prefix.
local SPIN_ROLES = { "MainRotor", "TailRotor", "Rotor", "Propeller" }
local HINGE_ROLES = { "Aileron", "Elevator", "Rudder", "Flap" }
local CONTROL_RATE = 15 -- VehicleControl messages per second per player

-- Optional: roblox-security's Sanctions for implausible speeds.
local securityFolder = script.Parent.Parent:FindFirstChild("Security")
local sanctionsModule = securityFolder and securityFolder:FindFirstChild("Sanctions")
local Sanctions: any = if sanctionsModule then (require :: any)(sanctionsModule) else nil

type Parked = { sim: any, kind: string, settledFor: number }

local VehicleService = {}

local parked: { [Model]: Parked } = {}
local drivers: { [Model]: Player } = {}
local topSpeeds: { [any]: number } = {}
local lastShot: { [Model]: number } = {}

local firedEvent = Instance.new("BindableEvent")
-- Fired(player, model, origin: Vector3, direction: Vector3, gun: spec.Gun) for every accepted shot.
VehicleService.Fired = firedEvent.Event

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
				table.insert(wheels, { instance = d :: Instance, front = axle == "F", left = side == "L" })
			end
		end
	end
	return wheels
end

-- Collision groups: vehicle hulls ignore anything in "VehicleIgnore" (grass, flowers, small
-- rocks, bushes, debris) for both collisions and suspension casts.
local function ensureCollisionGroups()
	for _, group in { COLLISION_GROUP, IGNORE_GROUP, RIDER_GROUP } do
		if not PhysicsService:IsCollisionGroupRegistered(group) then
			PhysicsService:RegisterCollisionGroup(group)
		end
	end
	PhysicsService:CollisionGroupSetCollidable(COLLISION_GROUP, IGNORE_GROUP, false)
	-- Seated players: welded into the vehicle, so their limbs neither drag on the road (a leaning
	-- rider's knee) nor block the vehicle's own ground casts.
	PhysicsService:CollisionGroupSetCollidable(RIDER_GROUP, COLLISION_GROUP, false)
	PhysicsService:CollisionGroupSetCollidable(RIDER_GROUP, "Default", false)
end

-- Roblox's own aerodynamics (Workspace.FluidForces) would double up with the sims' forces.
local function noFluidForces(part: BasePart)
	pcall(function()
		part.EnableFluidForces = false
	end)
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
	-- Weight 100 on both: Roblox mixes two parts' friction and elasticity as weighted averages, so at
	-- weight 1 a 0.05 hull against a plastic wall (0.5) would bounce at ~0.28.
	local physics = PhysicalProperties.new(0.7, friction, 0, 100, 100)

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
		noFluidForces(part)
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

local function buildCar(model: Model, spec: any): boolean
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
	noFluidForces(root)
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

-- ---------------------------------------------------------------------------------------------
-- Motorcycles, boats, planes and helicopters

local function roleOf(name: string, roles: { string }): string?
	for _, role in roles do
		if string.sub(name, 1, #role) == role then
			return role
		end
	end
	return nil
end

local function insideAny(part: Instance, set: { [Instance]: boolean }, model: Model): boolean
	local p: Instance? = part
	while p and p ~= model do
		if set[p] then
			return true
		end
		p = p.Parent
	end
	return false
end

-- The axis of a visual in its pivot's frame: the thinnest dimension for spinning parts (a rotor or
-- propeller disc), the longest for hinged ones (an aileron's span). Attribute Axis = "X"/"Y"/"Z"
-- (in the pivot's frame) overrides it.
local function visualAxis(visual: Instance, spin: boolean): Vector3
	local override = visual:GetAttribute("Axis")
	if override == "X" then
		return Vector3.xAxis
	elseif override == "Y" then
		return Vector3.yAxis
	elseif override == "Z" then
		return Vector3.zAxis
	end
	local frame: CFrame, size: Vector3
	if visual:IsA("BasePart") then
		frame, size = visual.CFrame, visual.Size
	else
		frame, size = (visual :: Model):GetBoundingBox()
	end
	local pick, best = Vector3.xAxis, size.X
	if (spin and size.Y < best) or (not spin and size.Y > best) then
		pick, best = Vector3.yAxis, size.Y
	end
	if (spin and size.Z < best) or (not spin and size.Z > best) then
		pick = Vector3.zAxis
	end
	return pivotOf(visual):VectorToObjectSpace(frame:VectorToWorldSpace(pick))
end

local function weldToRoot(root: BasePart, part: BasePart)
	local weld = Instance.new("WeldConstraint")
	weld.Part0 = root
	weld.Part1 = part
	weld.Parent = root
end

local function makeForces(root: BasePart)
	local attachment = Instance.new("Attachment")
	attachment.Name = "SimAttachment"
	attachment.Parent = root
	local force = Instance.new("VectorForce")
	force.Name = "SimForce"
	force.Attachment0 = attachment
	force.RelativeTo = Enum.ActuatorRelativeTo.World
	force.ApplyAtCenterOfMass = true
	force.Force = Vector3.zero
	force.Parent = attachment
	local torque = Instance.new("Torque")
	torque.Name = "SimTorque"
	torque.Attachment0 = attachment
	torque.RelativeTo = Enum.ActuatorRelativeTo.World
	torque.Torque = Vector3.zero
	torque.Parent = attachment
end

type Contact = { name: string, center: Vector3, radius: number, front: boolean, left: boolean, visual: Instance? }

local function buildOther(model: Model, spec: any, kind: string): boolean
	local pivot = model:GetPivot()
	local forward, up = pivot.LookVector, pivot.UpVector

	-- Wheels, skids and visual parts (rotors, propellers, control surfaces).
	local wheels: { Contact } = {}
	local skids: { BasePart } = {}
	local visuals: { { instance: Instance, role: string, spin: boolean } } = {}
	local special: { [Instance]: boolean } = {}
	local isHeli = kind == "Helicopter"
	local isBoat = kind == "Boat"
	for _, d in model:GetDescendants() do
		local parent = d.Parent
		if not (d:IsA("BasePart") or d:IsA("Model")) or (parent and insideAny(parent, special, model)) then
			continue
		end
		local axle, side = string.match(d.Name, LOOSE_WHEEL_PATTERN)
		local spinRole = roleOf(d.Name, SPIN_ROLES)
		local hingeRole = roleOf(d.Name, HINGE_ROLES)
		if axle and not isBoat then
			special[d] = true
			table.insert(wheels, { name = d.Name, center = centerOf(d), radius = radiusOf(d), front = axle == "F", left = side == "L", visual = d :: Instance })
		elseif spinRole or hingeRole then
			special[d] = true
			table.insert(visuals, { instance = d :: Instance, role = (spinRole or hingeRole) :: string, spin = spinRole ~= nil })
		elseif isHeli and d:IsA("BasePart") and string.sub(d.Name, 1, 4) == "Skid" then
			table.insert(skids, d)
		end
	end
	local fronts, rears = 0, 0
	for _, w in wheels do
		if w.front then
			fronts += 1
		else
			rears += 1
		end
	end
	if kind == "Motorcycle" and (fronts ~= 1 or rears ~= 1) then
		warn(`[VehicleService] {model:GetFullName()} needs wheels named WheelF and WheelR`)
		return false
	end

	-- Body extents in the pivot's frame (not wheels, rotors or control surfaces).
	local minCorner = Vector3.one * math.huge
	local maxCorner = -Vector3.one * math.huge
	for _, d in model:GetDescendants() do
		if d:IsA("BasePart") and not insideAny(d, special, model) then
			for _, sx in { -0.5, 0.5 } do
				for _, sy in { -0.5, 0.5 } do
					for _, sz in { -0.5, 0.5 } do
						local corner = pivot:PointToObjectSpace((d.CFrame * CFrame.new(d.Size * Vector3.new(sx, sy, sz))).Position)
						minCorner = minCorner:Min(corner)
						maxCorner = maxCorner:Max(corner)
					end
				end
			end
		end
	end
	if minCorner.X == math.huge then
		warn(`[VehicleService] {model:GetFullName()} has no body parts`)
		return false
	end

	-- Ground contacts: wheels, and skid ends (two per skid at its bottom, along its long axis).
	local skidRadius = SKID_RADIUS_M / MPS
	local contacts: { Contact } = {}
	for _, w in wheels do
		table.insert(contacts, w)
	end
	for i, skid in skids do
		local size = skid.Size
		local cf = skid.CFrame
		local long = if size.X > size.Z then cf.RightVector * size.X / 2 else cf.LookVector * size.Z / 2
		local bottom = cf.Position - up * (math.abs(cf.UpVector:Dot(up)) * size.Y / 2)
		for e, sign in { -1, 1 } do
			local p = bottom + long * sign * 0.85
			local l = pivot:PointToObjectSpace(p)
			table.insert(contacts, {
				name = `{skid.Name}_{i}_{e}`,
				center = p + up * skidRadius,
				radius = skidRadius,
				front = l.Z < 0,
				left = l.X < 0,
				visual = nil,
			})
		end
	end

	-- Ground height and centre of mass (in the pivot's frame).
	local groundY = minCorner.Y
	if #contacts > 0 then
		groundY = 0
		for _, c in contacts do
			groundY += (pivot:PointToObjectSpace(c.center).Y - c.radius) / #contacts
		end
	end
	local center = (minCorner + maxCorner) / 2
	local frontAvg, rearAvg = Vector3.zero, Vector3.zero
	for _, w in wheels do
		local l = pivot:PointToObjectSpace(w.center)
		if w.front then
			frontAvg += l / fronts
		else
			rearAvg += l / rears
		end
	end
	local rotor = model:FindFirstChild("MainRotor", true)
	local hasRotor = rotor ~= nil and (rotor:IsA("BasePart") or rotor:IsA("Model"))
	local com: Vector3
	if kind == "Helicopter" and rotor and hasRotor then
		local hub = pivot:PointToObjectSpace(pivotOf(rotor).Position)
		com = Vector3.new(hub.X, groundY + spec.ComHeight / MPS, hub.Z)
	elseif fronts > 0 and rears > 0 then
		local along = rearAvg:Lerp(frontAvg, spec.FrontWeight)
		com = Vector3.new(along.X, groundY + spec.ComHeight / MPS, along.Z)
	elseif kind == "Boat" then
		com = Vector3.new(center.X, minCorner.Y + spec.ComHeight / MPS, center.Z)
	else
		com = Vector3.new(center.X, groundY + spec.ComHeight / MPS, center.Z)
	end
	local comWorld = pivot:PointToWorldSpace(com)

	-- The root carries all the mass; its size (from the spec) sets the inertia the sims expect.
	local sizeM: Vector3
	if kind == "Motorcycle" then
		local wheelbase = math.abs(frontAvg.Z - rearAvg.Z) * MPS
		sizeM = Vector3.new(0.5, 0.9, math.max(wheelbase, 0.5) * 1.1)
	elseif kind == "Boat" then
		sizeM = Vector3.new(spec.Hull.Beam * 0.8, spec.Hull.Depth * 0.6, spec.Hull.Length * 0.8)
	elseif kind == "Plane" then
		sizeM = Vector3.new(spec.Wing.Span * 0.55, 1.2, spec.Length * 0.8)
	else
		sizeM = Vector3.new(2.2, 1.8, spec.Length * 0.7)
	end
	local root = Instance.new("Part")
	root.Name = "ChassisRoot"
	root.Size = sizeM / MPS
	root.CFrame = CFrame.lookAt(comWorld, comWorld + forward, up)
	root.Transparency = 1
	root.CanCollide = false
	root.CanQuery = false
	root.CanTouch = false
	local volume = root.Size.X * root.Size.Y * root.Size.Z
	local density = if kind == "Boat" then BOAT_DENSITY else math.clamp(MIN_ROOT_MASS / volume, 0.7, 100)
	root.CustomPhysicalProperties = PhysicalProperties.new(density, 0.3, 0.5)
	root.CollisionGroup = COLLISION_GROUP
	noFluidForces(root)
	root.Parent = model

	-- Joints between the body and wheels or visuals would pin the vehicle to anchored visuals.
	for _, d in model:GetDescendants() do
		if d:IsA("JointInstance") or d:IsA("WeldConstraint") then
			local a = (d :: any).Part0 :: Instance?
			local b = (d :: any).Part1 :: Instance?
			if a and b and insideAny(a, special, model) ~= insideAny(b, special, model) then
				d:Destroy()
			end
		end
	end

	-- Body: welded, massless, no collision of its own unless KeepCollision.
	local autoHull = model:GetAttribute("KeepCollision") ~= true
	for _, d in model:GetDescendants() do
		if d:IsA("BasePart") and d ~= root then
			if insideAny(d, special, model) then
				makeVisual(d)
			else
				d.Anchored = false
				d.Massless = true
				d.CollisionGroup = COLLISION_GROUP
				noFluidForces(d)
				if autoHull then
					d.CanCollide = false
				end
				weldToRoot(root, d)
			end
		end
	end

	-- Collision hull, in the root's frame.
	if autoHull then
		local toRoot = root.CFrame:Inverse() * pivot
		local mn, mx = toRoot * minCorner, toRoot * minCorner
		for _, sx in { minCorner.X, maxCorner.X } do
			for _, sy in { minCorner.Y, maxCorner.Y } do
				for _, sz in { minCorner.Z, maxCorner.Z } do
					local c = toRoot * Vector3.new(sx, sy, sz)
					mn, mx = mn:Min(c), mx:Max(c)
				end
			end
		end
		local ground = (toRoot * Vector3.new(com.X, groundY, com.Z)).Y
		local friction = if spec.Body and spec.Body.HullFriction then spec.Body.HullFriction else 0.12
		if kind == "Motorcycle" then
			-- Narrow and above 1.4 wheel radii: a 50 degree lean never scrapes it.
			local radius = 0
			for _, w in wheels do
				radius = math.max(radius, w.radius)
			end
			local half = 0.15 / MPS
			buildHull(root, Vector3.new(-half, mn.Y, mn.Z), Vector3.new(half, mx.Y, mx.Z), ground + 1.4 * radius, friction)
		elseif kind == "Boat" then
			buildHull(root, mn, mx, mn.Y, friction)
		elseif kind == "Helicopter" then
			buildHull(root, mn, mx, ground + 0.5 / MPS, friction)
		else
			local axle = ground
			for _, w in wheels do
				axle = math.max(axle, root.CFrame:PointToObjectSpace(w.center).Y)
			end
			buildHull(root, mn, mx, axle, friction)
		end
	end

	-- Wheel and skid mounts.
	local suspension = if kind == "Motorcycle" then spec.Suspension elseif kind == "Boat" then nil else spec.Gear
	if suspension then
		local staticLength = suspension.MaxLength * suspension.RideHeight
		local frontWeight = spec.FrontWeight or 0.5
		local tailDragger = frontWeight > 0.5
		for _, c in contacts do
			local mount = Instance.new("Attachment")
			mount.Name = "Mount_" .. c.name
			local mountCFrame = root.CFrame.Rotation + c.center + up * staticLength
			mount.WorldCFrame = mountCFrame
			mount:SetAttribute("WheelName", c.name)
			mount:SetAttribute("Front", c.front)
			mount:SetAttribute("Left", c.left)
			mount:SetAttribute("Radius", c.radius)
			mount:SetAttribute("StaticLength", staticLength)
			mount:SetAttribute("MaxLength", suspension.MaxLength)
			local visual = c.visual
			if visual then
				mount:SetAttribute("Wheel", true)
				mount:SetAttribute("VisualOffset", mountCFrame:ToObjectSpace(pivotOf(visual)))
				local link = Instance.new("ObjectValue")
				link.Name = "Visual"
				link.Value = visual
				link.Parent = mount
			end
			if kind ~= "Motorcycle" then
				local isWheel = visual ~= nil
				local share = 1 / #contacts
				if isWheel and fronts > 0 and rears > 0 then
					share = if c.front then frontWeight / fronts else (1 - frontWeight) / rears
				end
				mount:SetAttribute("Gear", true)
				mount:SetAttribute("Skid", not isWheel)
				mount:SetAttribute("Steer", isWheel and (if tailDragger then not c.front else c.front))
				mount:SetAttribute("Share", share)
			end
			mount.Parent = root
		end
	end

	-- Visual parts: rotors and propellers spin, control surfaces hinge (VehicleVisuals).
	local folder = Instance.new("Folder")
	folder.Name = "Visuals"
	folder.Parent = root
	for _, v in visuals do
		local link = Instance.new("ObjectValue")
		link.Name = v.role
		link.Value = v.instance
		local pv = pivotOf(v.instance)
		link:SetAttribute("Role", v.role)
		link:SetAttribute("Spin", v.spin)
		link:SetAttribute("Axis", visualAxis(v.instance, v.spin))
		link:SetAttribute("Offset", root.CFrame:ToObjectSpace(pv))
		link:SetAttribute("Side", if root.CFrame:PointToObjectSpace(pv.Position).X < 0 then -1 else 1)
		link.Parent = folder
	end
	if kind == "Helicopter" then
		local hub = Instance.new("Attachment")
		hub.Name = "RotorHub"
		hub.WorldPosition = if rotor and hasRotor
			then pivotOf(rotor).Position
			else comWorld + up * ((spec.Rotor.HubHeight - spec.ComHeight) / MPS)
		hub.Parent = root
	end

	makeForces(root)
	model.PrimaryPart = root
	model:SetAttribute("ChassisBuilt", true)
	return true
end

-- ---------------------------------------------------------------------------------------------
-- Tanks and trains

local function boundsOf(instance: Instance): (CFrame, Vector3)
	if instance:IsA("BasePart") then
		return instance.CFrame, instance.Size
	end
	return (instance :: Model):GetBoundingBox()
end

-- Corners of parts in a frame's space.
local function extentsOf(parts: { BasePart }, frame: CFrame): (Vector3, Vector3)
	local mn, mx = Vector3.one * math.huge, -Vector3.one * math.huge
	for _, part in parts do
		for _, sx in { -0.5, 0.5 } do
			for _, sy in { -0.5, 0.5 } do
				for _, sz in { -0.5, 0.5 } do
					local corner = frame:PointToObjectSpace((part.CFrame * CFrame.new(part.Size * Vector3.new(sx, sy, sz))).Position)
					mn, mx = mn:Min(corner), mx:Max(corner)
				end
			end
		end
	end
	return mn, mx
end

local function partsOf(instance: Instance): { BasePart }
	local parts: { BasePart } = {}
	if instance:IsA("BasePart") then
		table.insert(parts, instance)
	end
	for _, d in instance:GetDescendants() do
		if d:IsA("BasePart") then
			table.insert(parts, d)
		end
	end
	return parts
end

-- An invisible root carrying a heavy vehicle's mass (heavier than a car's in proportion).
local function heavyRoot(name: string, parent: Instance, sizeM: Vector3, cframe: CFrame, massKg: number): BasePart
	local root = Instance.new("Part")
	root.Name = name
	root.Size = sizeM / MPS
	root.CFrame = cframe
	root.Transparency = 1
	root.CanCollide = false
	root.CanQuery = false
	root.CanTouch = false
	local volume = root.Size.X * root.Size.Y * root.Size.Z
	root.CustomPhysicalProperties = PhysicalProperties.new(math.clamp(massKg * RMU_PER_KG / volume, 0.7, 100), 0.3, 0.5)
	root.CollisionGroup = COLLISION_GROUP
	noFluidForces(root)
	root.Parent = parent
	return root
end

-- Body parts: welded to the root, massless, no collision of their own (the hull collides).
local function weldBody(root: BasePart, parts: { BasePart }, autoHull: boolean)
	for _, part in parts do
		part.Anchored = false
		part.Massless = true
		part.CollisionGroup = COLLISION_GROUP
		noFluidForces(part)
		if autoHull then
			part.CanCollide = false
		end
		weldToRoot(root, part)
	end
end

-- Root-space box of a vehicle's body (from corners in the pivot's frame).
local function rootBox(root: BasePart, pivot: CFrame, minCorner: Vector3, maxCorner: Vector3): (Vector3, Vector3)
	local toRoot = root.CFrame:Inverse() * pivot
	local mn, mx = Vector3.one * math.huge, -Vector3.one * math.huge
	for _, sx in { minCorner.X, maxCorner.X } do
		for _, sy in { minCorner.Y, maxCorner.Y } do
			for _, sz in { minCorner.Z, maxCorner.Z } do
				local c = toRoot * Vector3.new(sx, sy, sz)
				mn, mx = mn:Min(c), mx:Max(c)
			end
		end
	end
	return mn, mx
end

local function visualLink(folder: Instance, root: BasePart, instance: Instance, role: string, spin: boolean): ObjectValue
	local link = Instance.new("ObjectValue")
	link.Name = role
	link.Value = instance
	local pv = pivotOf(instance)
	link:SetAttribute("Role", role)
	link:SetAttribute("Spin", spin)
	link:SetAttribute("Axis", visualAxis(instance, spin))
	link:SetAttribute("Offset", root.CFrame:ToObjectSpace(pv))
	link:SetAttribute("Side", if root.CFrame:PointToObjectSpace(pv.Position).X < 0 then -1 else 1)
	link.Parent = folder
	return link
end

local function buildTank(model: Model, spec: any): boolean
	local pivot = model:GetPivot()
	local forward, up = pivot.LookVector, pivot.UpVector
	local tracks = spec.Tracks

	-- Visuals VehicleVisuals turns: the turret, the gun, road wheels.
	local special: { [Instance]: boolean } = {}
	local turret = model:FindFirstChild("Turret", true)
	local gun = model:FindFirstChild("Gun", true)
	if turret and not (turret:IsA("BasePart") or turret:IsA("Model")) then
		turret = nil
	end
	if gun and not (gun:IsA("BasePart") or gun:IsA("Model")) then
		gun = nil
	end
	if turret then
		special[turret] = true
	end
	if gun then
		special[gun] = true
	end
	local roadWheels: { Instance } = {}
	for _, d in model:GetDescendants() do
		if string.match(d.Name, ROAD_WHEEL_PATTERN) and (d:IsA("BasePart") or d:IsA("Model")) and not insideAny(d, special, model) then
			special[d] = true
			table.insert(roadWheels, d)
		end
	end
	local body: { BasePart } = {}
	for _, d in model:GetDescendants() do
		if d:IsA("BasePart") and not insideAny(d, special, model) then
			table.insert(body, d)
		end
	end
	if #body == 0 then
		warn(`[VehicleService] {model:GetFullName()} has no body parts`)
		return false
	end
	local minCorner, maxCorner = extentsOf(body, pivot)

	-- Tracks: their bottoms are the ground line, their centres the tread and the contact patches.
	local groundY = minCorner.Y
	local centerZ = (minCorner.Z + maxCorner.Z) / 2
	local midX = (minCorner.X + maxCorner.X) / 2
	local leftX, rightX = midX - tracks.Tread / 2 / MPS, midX + tracks.Tread / 2 / MPS
	local trackL, trackR = model:FindFirstChild("TrackL", true), model:FindFirstChild("TrackR", true)
	if trackL and trackR and (trackL:IsA("BasePart") or trackL:IsA("Model")) and (trackR:IsA("BasePart") or trackR:IsA("Model")) then
		local pl = pivot:PointToObjectSpace(boundsOf(trackL).Position)
		local pr = pivot:PointToObjectSpace(boundsOf(trackR).Position)
		leftX, rightX, centerZ = pl.X, pr.X, (pl.Z + pr.Z) / 2
		local lMin = extentsOf(partsOf(trackL), pivot)
		local rMin = extentsOf(partsOf(trackR), pivot)
		groundY = math.min(lMin.Y, rMin.Y)
	else
		warn(`[VehicleService] {model:GetFullName()}: no TrackL / TrackR, using the spec's tread`)
	end

	-- The root at the centre of mass carries the mass; its size (from the spec) sets the inertia.
	local com = Vector3.new((leftX + rightX) / 2, groundY + spec.ComHeight / MPS, centerZ)
	local comWorld = pivot:PointToWorldSpace(com)
	local sizeM = Vector3.new(spec.Width * 0.8, spec.Height * 0.5, spec.Length * 0.8)
	local root = heavyRoot("ChassisRoot", model, sizeM, CFrame.lookAt(comWorld, comWorld + forward, up), spec.Mass)

	-- Joints between the body and the visuals would pin the tank to anchored visuals.
	for _, d in model:GetDescendants() do
		if d:IsA("JointInstance") or d:IsA("WeldConstraint") then
			local a = (d :: any).Part0 :: Instance?
			local b = (d :: any).Part1 :: Instance?
			if a and b and insideAny(a, special, model) ~= insideAny(b, special, model) then
				d:Destroy()
			end
		end
	end
	local autoHull = model:GetAttribute("KeepCollision") ~= true
	weldBody(root, body, autoHull)
	for _, d in model:GetDescendants() do
		if d:IsA("BasePart") and d ~= root and insideAny(d, special, model) then
			makeVisual(d)
		end
	end

	-- Collision hull: hull and turret above the track tops; below it the track contacts carry
	-- everything, so the idlers climb steps instead of the hull snagging on them.
	if autoHull then
		local mn, mx = rootBox(root, pivot, minCorner, maxCorner)
		local toRoot = root.CFrame:Inverse() * pivot
		local bottom = (toRoot * Vector3.new(com.X, groundY + (2 * tracks.WheelRadius + tracks.Approach) / MPS, com.Z)).Y
		local top = math.max(mx.Y, (toRoot * Vector3.new(com.X, groundY + spec.Height / MPS, com.Z)).Y)
		buildHull(root, Vector3.new(mn.X, bottom, mn.Z), Vector3.new(mx.X, top, mx.Z), bottom, spec.Body.HullFriction)
	end

	-- Track contacts: Tracks.Contacts along each track's ground length, plus the idler and sprocket
	-- at the hull ends, raised by the approach height.
	local radius = tracks.WheelRadius / MPS
	local staticLength = spec.Suspension.MaxLength * spec.Suspension.RideHeight
	local endZ = math.max(spec.Length / 2 - tracks.WheelRadius, tracks.ContactLength / 2 + tracks.WheelRadius) / MPS
	local n = math.max(tracks.Contacts, 2)
	for _, side in { -1, 1 } do
		local x = if side < 0 then leftX else rightX
		local points: { { z: number, lift: number, isEnd: boolean } } = {}
		for i = 0, n - 1 do
			table.insert(points, { z = centerZ + (i / (n - 1) - 0.5) * tracks.ContactLength / MPS, lift = 0, isEnd = false })
		end
		for _, e in { -1, 1 } do
			table.insert(points, { z = centerZ + e * endZ, lift = tracks.Approach / MPS, isEnd = true })
		end
		for i, point in points do
			local center = pivot:PointToWorldSpace(Vector3.new(x, groundY + radius + point.lift, point.z))
			local mount = Instance.new("Attachment")
			mount.Name = `Track{if side < 0 then "L" else "R"}_{i}`
			mount.WorldCFrame = root.CFrame.Rotation + center + up * staticLength
			mount:SetAttribute("TrackContact", true)
			mount:SetAttribute("Left", side < 0)
			mount:SetAttribute("End", point.isEnd)
			mount:SetAttribute("Radius", radius)
			mount:SetAttribute("StaticLength", staticLength)
			mount:SetAttribute("MaxLength", spec.Suspension.MaxLength)
			mount.Parent = root
		end
	end

	-- Visuals: turret and gun (VehicleVisuals turns them from TurretYaw / GunPitch), road wheels.
	local folder = Instance.new("Folder")
	folder.Name = "Visuals"
	folder.Parent = root
	if turret then
		visualLink(folder, root, turret, "Turret", false)
	end
	if gun then
		visualLink(folder, root, gun, "Gun", false)
	end
	for _, wheel in roadWheels do
		local link = visualLink(folder, root, wheel, "RoadWheel", true)
		link:SetAttribute("Radius", radiusOf(wheel))
	end
	model:SetAttribute("TurretYaw", 0)
	model:SetAttribute("GunPitch", 0)

	makeForces(root)
	model.PrimaryPart = root
	model:SetAttribute("ChassisBuilt", true)
	return true
end

local function buildTrain(model: Model, spec: any): boolean
	local pivot = model:GetPivot()
	local forward, up = pivot.LookVector, pivot.UpVector

	-- The lead vehicle (every part not inside a car) and the cars, Car1, Car2 ... in order.
	local cars: { { model: Model, index: number } } = {}
	local carSet: { [Instance]: boolean } = {}
	for _, child in model:GetChildren() do
		local index = string.match(child.Name, CAR_PATTERN)
		if index and child:IsA("Model") then
			table.insert(cars, { model = child, index = tonumber(index) :: number })
			carSet[child] = true
		end
	end
	table.sort(cars, function(a, b)
		return a.index < b.index
	end)
	local autoHull = model:GetAttribute("KeepCollision") ~= true

	-- One vehicle: a root at its centre of mass (ComHeight above its lowest point, the rail), its
	-- parts welded to it, a hull clear of the rails.
	local function vehicle(container: Model, parts: { BasePart }, massKg: number, name: string): (BasePart?, number)
		if #parts == 0 then
			return nil, 0
		end
		local mn, mx = extentsOf(parts, pivot)
		local railY = mn.Y
		local center = (mn + mx) / 2
		local lengthM = (mx.Z - mn.Z) * MPS
		local com = Vector3.new(center.X, railY + spec.ComHeight / MPS, center.Z)
		local comWorld = pivot:PointToWorldSpace(com)
		local sizeM = Vector3.new(3, 3, math.max(lengthM * 0.9, 2))
		local root = heavyRoot(name, container, sizeM, CFrame.lookAt(comWorld, comWorld + forward, up), massKg)
		weldBody(root, parts, autoHull)
		if autoHull then
			local bmn, bmx = rootBox(root, pivot, mn, mx)
			local bottom = ((root.CFrame:Inverse() * pivot) * Vector3.new(com.X, railY + TRAIN_HULL_CLEARANCE / MPS, com.Z)).Y
			buildHull(root, bmn, bmx, bottom, 0.3)
		end
		makeForces(root)
		return root, lengthM
	end
	local function hullsOf(container: Instance): { BasePart }
		local hulls: { BasePart } = {}
		for _, child in container:GetChildren() do
			if child:IsA("BasePart") and (child.Name == "HullBody" or child.Name == "HullEnd") then
				table.insert(hulls, child)
			end
		end
		return hulls
	end
	local function bogieHalf(container: Instance, default: number, lengthM: number): number
		local attr = container:GetAttribute("BogieSpacing")
		local spacing = if typeof(attr) == "number" then attr else default
		return math.min(spacing, lengthM * 0.9) / 2 / MPS
	end

	local leadParts: { BasePart } = {}
	for _, d in model:GetDescendants() do
		if d:IsA("BasePart") and not insideAny(d, carSet, model) then
			table.insert(leadParts, d)
		end
	end
	local leadRoot, leadLength = vehicle(model, leadParts, spec.Mass, "ChassisRoot")
	if not leadRoot then
		warn(`[VehicleService] {model:GetFullName()} has no body parts`)
		return false
	end
	leadRoot:SetAttribute("BogieHalf", bogieHalf(model, spec.BogieSpacing, leadLength))
	local hulls = { hullsOf(model) }
	local folder = Instance.new("Folder")
	folder.Name = "Cars"
	folder.Parent = leadRoot
	for i, car in cars do
		local massAttr = car.model:GetAttribute("Mass")
		local massKg = if typeof(massAttr) == "number" then massAttr else spec.Cars.Mass
		local carRoot, carLength = vehicle(car.model, partsOf(car.model), massKg, "CarRoot")
		if carRoot then
			car.model.PrimaryPart = carRoot
			local link = Instance.new("ObjectValue")
			link.Name = car.model.Name
			link.Value = carRoot
			link:SetAttribute("Index", i)
			link:SetAttribute("Offset", leadRoot.CFrame:PointToObjectSpace(carRoot.Position).Z)
			link:SetAttribute("BogieHalf", bogieHalf(car.model, spec.Cars.BogieSpacing, carLength))
			link:SetAttribute("MassKg", massKg)
			link.Parent = folder
			table.insert(hulls, hullsOf(car.model))
		end
	end
	-- Neighbouring cars don't collide with each other (their corners meet in tight curves).
	for i = 1, #hulls - 1 do
		for _, a in hulls[i] do
			for _, b in hulls[i + 1] do
				local constraint = Instance.new("NoCollisionConstraint")
				constraint.Part0 = a
				constraint.Part1 = b
				constraint.Parent = a
			end
		end
	end

	model.PrimaryPart = leadRoot
	model:SetAttribute("ChassisBuilt", true)
	-- Onto the rails: every car at its place on the nearest track, stopped.
	local sim = Sims.new(model)
	if sim then
		sim:Recover()
		sim:Destroy()
	end
	return true
end

local function build(model: Model, spec: any): boolean
	local kind = Sims.Kind(spec)
	if kind == "Car" then
		return buildCar(model, spec)
	elseif kind == "Tank" then
		return buildTank(model, spec)
	elseif kind == "Train" then
		return buildTrain(model, spec)
	end
	return buildOther(model, spec, kind)
end

-- Every assembly of a vehicle: its ChassisRoot, plus a train's car roots.
local function assemblyRoots(model: Model): { BasePart }
	local root = model.PrimaryPart
	if not root then
		return {}
	end
	local roots = { root }
	local cars = root:FindFirstChild("Cars")
	if cars then
		for _, link in cars:GetChildren() do
			local value = if link:IsA("ObjectValue") then link.Value else nil
			if value and value:IsA("BasePart") then
				table.insert(roots, value)
			end
		end
	end
	return roots
end

-- ---------------------------------------------------------------------------------------------

local function driverSeat(model: Model): VehicleSeat?
	local named = model:FindFirstChild("DriverSeat", true)
	if named and named:IsA("VehicleSeat") then
		return named
	end
	return model:FindFirstChildWhichIsA("VehicleSeat", true)
end

-- What an empty vehicle does: hill hold (cars), kickstand (bikes), idle (boats), parking brake
-- (planes), rotor winding down (helicopters).
local function idleInput(model: Model, kind: string): any
	if kind == "Motorcycle" then
		return { Throttle = 0, Steer = 0, Handbrake = false, Lean = 0, Rider = false }
	elseif kind == "Plane" then
		return { Pitch = 0, Roll = 0, Yaw = 0, Power = -1, Brake = true, GearDown = model:GetAttribute("GearDown") ~= false }
	elseif kind == "Helicopter" then
		return { Pitch = 0, Roll = 0, Yaw = 0, Power = -1, Engine = false }
	end
	return { Throttle = 0, Steer = 0, Handbrake = false }
end

local function park(model: Model)
	local root = model.PrimaryPart
	if not root then
		return
	end
	for _, part in assemblyRoots(model) do
		part.Anchored = false
		pcall(function()
			part:SetNetworkOwner(nil)
		end)
	end
	local sim, kind = Sims.new(model)
	if sim and kind then
		parked[model] = { sim = sim, kind = kind, settledFor = 0 }
	end
end

-- Seated players join the VehicleRider collision group, restored when they leave the seat.
local riderGroups: { [BasePart]: string } = {}

local function setRider(character: Model, riding: boolean)
	for _, part in character:GetDescendants() do
		if part:IsA("BasePart") then
			if riding then
				if riderGroups[part] == nil then
					riderGroups[part] = part.CollisionGroup
				end
				part.CollisionGroup = RIDER_GROUP
			else
				part.CollisionGroup = riderGroups[part] or "Default"
				riderGroups[part] = nil
			end
		end
	end
end

local function watchSeat(seat: Seat | VehicleSeat)
	local current: Model? = nil
	seat:GetPropertyChangedSignal("Occupant"):Connect(function()
		if current then
			setRider(current, false)
			current = nil
		end
		local occupant = seat.Occupant
		local character = occupant and occupant.Parent
		if character and character:IsA("Model") then
			current = character
			setRider(character, true)
		end
	end)
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
	for _, d in model:GetDescendants() do
		if d:IsA("Seat") or d:IsA("VehicleSeat") then
			watchSeat(d)
		end
	end

	seat:GetPropertyChangedSignal("Occupant"):Connect(function()
		local occupant = seat.Occupant
		local player = occupant and Players:GetPlayerFromCharacter(occupant.Parent)
		local root = model.PrimaryPart
		if player and root then
			-- Hand the physics to the driver; their client runs the sim from now on.
			local entry = parked[model]
			if entry then
				entry.sim:Destroy()
				parked[model] = nil
			end
			drivers[model] = player
			for _, part in assemblyRoots(model) do
				part.Anchored = false
				pcall(function()
					part:SetNetworkOwner(player)
				end)
			end
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
	lastShot[model] = nil
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

-- The driver's client reports what other players need to see and the server can't measure (engine
-- throttle for props, rotors and sound; landing gear; flaps) and bike crashes (bail).
local optionalRagdoll: any = nil
local function ragdollService(): any
	if optionalRagdoll == nil then
		local module = script.Parent:FindFirstChild("RagdollService")
		optionalRagdoll = if module then (require :: any)(module) else false
	end
	return if optionalRagdoll then optionalRagdoll else nil
end

local rates: { [Player]: { count: number, window: number } } = {}

-- Prototype shell (Gun.DefaultShell): a raycast to Gun.Range and a harmless explosion where it hits.
local function defaultShell(model: Model, origin: Vector3, direction: Vector3, gun: any)
	local params = RaycastParams.new()
	params.FilterType = Enum.RaycastFilterType.Exclude
	params.FilterDescendantsInstances = { model }
	local hit = workspace:Raycast(origin, direction * math.min(gun.Range / MPS, 15000), params)
	if hit then
		local explosion = Instance.new("Explosion")
		explosion.Position = hit.Position
		explosion.BlastRadius = 8
		explosion.BlastPressure = 0
		explosion.DestroyJointRadiusPercent = 0
		explosion.ExplosionType = Enum.ExplosionType.NoCraters
		explosion.Parent = workspace
	end
end

-- A shot from the driver: within the reload, from the tank, along its gun (from the aim it reported).
local function fire(player: Player, model: Model, spec: any, origin: any, direction: any)
	if typeof(origin) ~= "Vector3" or typeof(direction) ~= "Vector3" or origin ~= origin or direction ~= direction or direction.Magnitude < 0.5 then
		return
	end
	local root = model.PrimaryPart
	if not root then
		return
	end
	local now = os.clock()
	if now - (lastShot[model] or -math.huge) < spec.Gun.Reload * 0.9 then
		return
	end
	if (origin - root.Position).Magnitude > spec.Length / MPS + 8 then
		return
	end
	local cf = root.CFrame
	local yaw = math.rad((model:GetAttribute("TurretYaw") :: number?) or 0)
	local pitch = math.rad((model:GetAttribute("GunPitch") :: number?) or 0)
	local turret = CFrame.fromAxisAngle(cf.UpVector, -yaw)
	local expected = CFrame.fromAxisAngle(turret:VectorToWorldSpace(cf.RightVector), pitch):VectorToWorldSpace(turret:VectorToWorldSpace(cf.LookVector))
	if expected:Dot(direction.Unit) < math.cos(math.rad(12)) then
		return
	end
	lastShot[model] = now
	model:SetAttribute("LastShot", workspace:GetServerTimeNow())
	firedEvent:Fire(player, model, origin, direction.Unit, spec.Gun)
	if spec.Gun.DefaultShell then
		defaultShell(model, origin, direction.Unit, spec.Gun)
	end
end

local function onControl(player: Player, model: any, state: any)
	if typeof(model) ~= "Instance" or not model:IsA("Model") or drivers[model] ~= player or typeof(state) ~= "table" then
		return
	end
	local now = os.clock()
	local previous = rates[player]
	local rate = if previous and now - previous.window <= 1 then previous else { count = 0, window = now }
	rates[player] = rate
	rate.count += 1
	if rate.count > CONTROL_RATE then
		return
	end
	local throttle = state.Throttle
	if typeof(throttle) == "number" and throttle == throttle then
		model:SetAttribute("EngineThrottle", math.clamp(throttle, 0, 1))
	end
	if typeof(state.GearDown) == "boolean" then
		model:SetAttribute("GearDown", state.GearDown)
	end
	if typeof(state.Flaps) == "boolean" then
		model:SetAttribute("Flaps", state.Flaps)
	end
	local spec = Sims.Spec(model)
	local kind = if spec then Sims.Kind(spec) else nil
	if kind == "Tank" then
		-- Turret aim for everyone else to see (degrees), then any shot along it.
		local yaw, pitch = state.TurretYaw, state.GunPitch
		if typeof(yaw) == "number" and yaw == yaw and math.abs(yaw) <= 180 then
			model:SetAttribute("TurretYaw", yaw)
		end
		if typeof(pitch) == "number" and pitch == pitch then
			model:SetAttribute("GunPitch", math.clamp(pitch, spec.Turret.MinElevation, spec.Turret.MaxElevation))
		end
		if state.Fire == true then
			fire(player, model, spec, state.Origin, state.Direction)
		end
	elseif kind == "Train" and typeof(state.Horn) == "boolean" then
		model:SetAttribute("Horn", state.Horn)
	end
	if state.Bail == true then
		-- Thrown off a crashing bike: out of the seat, ragdolled when roblox-ragdoll is installed.
		local seat = driverSeat(model)
		local occupant = seat and seat.Occupant
		local character = player.Character
		if seat and occupant and character and occupant.Parent == character then
			local weld = seat:FindFirstChild("SeatWeld")
			if weld then
				weld:Destroy()
			end
			occupant.Sit = false
			local root = model.PrimaryPart
			local Ragdoll = ragdollService()
			if Ragdoll and root then
				Ragdoll:Ragdoll(character, { Seconds = 2.5, Velocity = root.AssemblyLinearVelocity })
			end
		end
	end
end

function VehicleService:Init()
	ensureCollisionGroups()
	local remote = ReplicatedStorage:FindFirstChild("VehicleControl")
	if not remote then
		local created = Instance.new("RemoteEvent")
		created.Name = "VehicleControl"
		created.Parent = ReplicatedStorage
		remote = created
	end
	(remote :: RemoteEvent).OnServerEvent:Connect(onControl)
	Players.PlayerRemoving:Connect(function(player)
		rates[player] = nil
	end)
end

function VehicleService:Start()
	CollectionService:GetInstanceAddedSignal(TAG):Connect(bind)
	CollectionService:GetInstanceRemovedSignal(TAG):Connect(unbind)
	for _, model in CollectionService:GetTagged(TAG) do
		task.spawn(bind, model)
	end

	-- Empty vehicles: cars brake on all four wheels (hill hold), bikes stand on the kickstand,
	-- planes hold the parking brake, helicopter rotors wind down, boats float. They sleep (anchor)
	-- once settled; boats only on a calm sea, so they keep riding the waves.
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
			local telemetry = entry.sim:Step(dt, idleInput(model, entry.kind))
			local still = root.AssemblyLinearVelocity.Magnitude < 0.3 and root.AssemblyAngularVelocity.Magnitude < 0.1
			local calm = entry.kind ~= "Boat" or Water.IsCalm()
			entry.settledFor = if still and calm and telemetry.Grounded > 0 then entry.settledFor + dt else 0
			if entry.settledFor >= SLEEP_AFTER then
				entry.sim:Destroy()
				for _, part in assemblyRoots(model) do
					part.Anchored = true -- asleep until someone sits in it
				end
			end
		end
	end)

	-- Plausibility check on driven vehicles (the driver's client owns the physics).
	task.spawn(function()
		while true do
			task.wait(1)
			for model, player in drivers do
				local root = model.PrimaryPart
				local spec = (VehicleSpecs :: any)[model:GetAttribute("Vehicle")]
				if root and spec then
					local limitKmh = topSpeeds[spec] or Sims.SpeedLimitKmh(spec)
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
