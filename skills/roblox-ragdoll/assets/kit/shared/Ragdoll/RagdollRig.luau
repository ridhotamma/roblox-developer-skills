--!strict
-- Builds and switches the physical ragdoll for any Humanoid rig (R15, R6, custom).
--
-- Build (server, once per character, cheap to keep around):
--   * for every body Motor6D except the root joint: a BallSocketConstraint or HingeConstraint
--     at the same pivot, disabled, with limits from RagdollConfig.Joints
--   * for every body part: a smaller invisible collider welded to it, not colliding yet
--     (Humanoids force limb CanCollide off, so limbs need their own colliders to land on)
--   * NoCollisionConstraints so neighbouring parts don't fight at the joint
--
-- Switch (RagdollRig.SetActive): Motor6D.Enabled off + constraint on (+ colliders on).
-- Disabling a Motor6D keeps it in place, so switching back is instant and animations resume.
-- The root joint (HumanoidRootPart -> torso) always stays rigid: the root rides with the torso.

local PhysicsService = game:GetService("PhysicsService")
local RunService = game:GetService("RunService")

local BodyZones = require(script.Parent.BodyZones)
local RagdollConfig = require(script.Parent.RagdollConfig)

local FOLDER = "RagdollRig"
local ATTACHMENT = "RagdollAttachment"
local ROOT = "HumanoidRootPart"

local rig = RagdollConfig.Rig

local RagdollRig = {
	FolderName = FOLDER,
}

local groupReady = false
local function ensureGroup()
	if groupReady or not RunService:IsServer() then
		return
	end
	groupReady = true
	if not PhysicsService:IsCollisionGroupRegistered(rig.CollisionGroup) then
		PhysicsService:RegisterCollisionGroup(rig.CollisionGroup)
	end
	-- Limb colliders ignore each other (cheaper, no self-jams) but hit the world and torsos.
	PhysicsService:CollisionGroupSetCollidable(rig.CollisionGroup, rig.CollisionGroup, false)
end

local function isRootJoint(motor: Motor6D): boolean
	local part0, part1 = motor.Part0, motor.Part1
	return BodyZones.JointName(motor.Name) == "Root"
		or (part0 ~= nil and part0.Name == ROOT)
		or (part1 ~= nil and part1.Name == ROOT)
end

-- Body joints by normalized name ("LeftShoulder", "Neck", "Root"...). Only Motor6Ds joining two
-- parts that sit directly in the character, so tool and accessory joints are left alone.
function RagdollRig.Motors(character: Model): { [string]: Motor6D }
	local out: { [string]: Motor6D } = {}
	for _, descendant in character:GetDescendants() do
		if descendant:IsA("Motor6D") then
			local part0, part1 = descendant.Part0, descendant.Part1
			if part0 and part1 and part0.Parent == character and part1.Parent == character then
				out[if isRootJoint(descendant) then "Root" else BodyZones.JointName(descendant.Name)] = descendant
			end
		end
	end
	return out
end

-- The Transform that would reproduce the joint's current physical pose.
function RagdollRig.JointTransform(motor: Motor6D): CFrame?
	local part0, part1 = motor.Part0, motor.Part1
	if not part0 or not part1 then
		return nil
	end
	return motor.C0:Inverse() * part0.CFrame:ToObjectSpace(part1.CFrame) * motor.C1
end

local function makeCollider(part: BasePart, folder: Instance): BasePart
	local collider = Instance.new("Part")
	collider.Name = part.Name .. "Collider"
	collider.Size = Vector3.new(
		math.max(part.Size.X * rig.ColliderScale, 0.2),
		math.max(part.Size.Y * rig.ColliderScale, 0.2),
		math.max(part.Size.Z * rig.ColliderScale, 0.2)
	)
	collider.CFrame = part.CFrame
	collider.Transparency = 1
	collider.CanCollide = false
	collider.CanQuery = false -- raycasts and hitboxes keep hitting the real body part
	collider.CanTouch = false
	collider.Massless = true
	collider.CastShadow = false
	collider.CollisionGroup = rig.CollisionGroup
	collider.CustomPhysicalProperties = PhysicalProperties.new(rig.Density, rig.Friction, rig.Elasticity)

	local weld = Instance.new("WeldConstraint")
	weld.Part0 = part
	weld.Part1 = collider
	weld.Parent = collider
	collider.Parent = folder
	return collider
end

local function noCollide(a: BasePart?, b: BasePart?, folder: Instance)
	if a and b then
		local constraint = Instance.new("NoCollisionConstraint")
		constraint.Part0 = a
		constraint.Part1 = b
		constraint.Parent = folder
	end
end

local function makeAttachment(part: BasePart, cframe: CFrame): Attachment
	local attachment = Instance.new("Attachment")
	attachment.Name = ATTACHMENT
	attachment.CFrame = cframe
	attachment.Parent = part
	return attachment
end

local function makeJoint(name: string, motor: Motor6D, part0: BasePart, part1: BasePart, folder: Instance)
	local limit = RagdollConfig.Joints[name] or RagdollConfig.Joints.Default
	-- Where Part1 sits in Part0's space in the rest pose (Transform = identity).
	local rest = motor.C0 * motor.C1:Inverse()
	local pivot = motor.C0.Position

	local frame: CFrame
	local constraint: Constraint
	if limit.Kind == "Hinge" then
		-- Hinge axis = the attachment's X axis = Part0's X axis (the character's right on R15).
		frame = CFrame.new(pivot)
		local joint = Instance.new("HingeConstraint")
		joint.LimitsEnabled = true
		joint.LowerAngle = limit.Lower or -45
		joint.UpperAngle = limit.Upper or 45
		joint.Restitution = 0
		constraint = joint
	else
		-- Cone axis = the attachment's X axis, pointed from the pivot towards the child part,
		-- so limits are measured from the limb's rest direction on any rig.
		local toChild = rest.Position - pivot
		local axis = if toChild.Magnitude > 1e-3 then toChild.Unit else Vector3.yAxis
		local reference = if math.abs(axis.Z) < 0.9 then Vector3.zAxis else Vector3.xAxis
		local side = axis:Cross(reference).Unit
		frame = CFrame.fromMatrix(pivot, axis, side)
		local joint = Instance.new("BallSocketConstraint")
		joint.LimitsEnabled = true
		joint.UpperAngle = limit.Cone or 45
		joint.TwistLimitsEnabled = true
		joint.TwistLowerAngle = -(limit.Twist or 30)
		joint.TwistUpperAngle = limit.Twist or 30
		joint.MaxFrictionTorque = rig.FrictionTorque
		joint.Restitution = 0
		constraint = joint
	end

	constraint.Name = motor.Name
	constraint.Attachment0 = makeAttachment(part0, frame)
	constraint.Attachment1 = makeAttachment(part1, rest:Inverse() * frame)
	constraint.Enabled = false
	constraint.Parent = folder
end

-- Server. Safe to call twice. Returns false if the model has no Humanoid or no joints.
function RagdollRig.Build(character: Model): boolean
	if character:FindFirstChild(FOLDER) then
		return true
	end
	local humanoid = character:FindFirstChildOfClass("Humanoid")
	if not humanoid then
		return false
	end
	ensureGroup()

	local folder = Instance.new("Folder")
	folder.Name = FOLDER

	local colliders: { [BasePart]: BasePart } = {}
	local built = 0
	for name, motor in RagdollRig.Motors(character) do
		local part0, part1 = motor.Part0, motor.Part1
		if name == "Root" or not part0 or not part1 then
			continue
		end
		for _, part in { part0, part1 } do
			if part.Name ~= ROOT and not colliders[part] then
				colliders[part] = makeCollider(part, folder)
			end
		end
		makeJoint(name, motor, part0, part1, folder)
		-- Neighbours overlap at the joint: never let them push each other apart.
		noCollide(part0, colliders[part1], folder)
		noCollide(part1, colliders[part0], folder)
		built += 1
	end
	if built == 0 then
		folder:Destroy()
		return false
	end

	humanoid.BreakJointsOnDeath = false -- death becomes a ragdoll instead of a pile of parts
	humanoid.RequiresNeck = false -- a disabled neck Motor6D would otherwise kill the Humanoid
	folder.Parent = character
	return true
end

-- Removes everything Build added (call before rebuilding after a rescale or body swap).
function RagdollRig.Destroy(character: Model)
	local folder = character:FindFirstChild(FOLDER)
	if folder then
		folder:Destroy()
	end
	for _, descendant in character:GetDescendants() do
		if descendant:IsA("Attachment") and descendant.Name == ATTACHMENT then
			descendant:Destroy()
		elseif descendant:IsA("Motor6D") then
			descendant.Enabled = true
		end
	end
end

function RagdollRig.IsBuilt(character: Model): boolean
	return character:FindFirstChild(FOLDER) ~= nil
end

-- Server. Switches joints between animated (Motor6D) and physical (constraint).
-- `only` limits it to some joints (a dangling arm); colliders only switch for the whole body.
function RagdollRig.SetActive(character: Model, active: boolean, only: { string }?)
	local folder = character:FindFirstChild(FOLDER)
	if not folder then
		return
	end
	local filter: { [string]: boolean }? = nil
	if only then
		local set = {}
		for _, name in only do
			set[name] = true
		end
		filter = set
	end

	for name, motor in RagdollRig.Motors(character) do
		if name == "Root" or (filter and not filter[name]) then
			continue
		end
		local constraint = folder:FindFirstChild(motor.Name)
		if constraint and constraint:IsA("Constraint") then
			if active then
				constraint.Enabled = true
				motor.Enabled = false
			else
				motor.Enabled = true
				constraint.Enabled = false
			end
		end
	end

	if not only then
		for _, child in folder:GetChildren() do
			if child:IsA("BasePart") then
				child.CanCollide = active
			end
		end
	end
end

local function capped(velocity: Vector3): Vector3
	local max = RagdollConfig.Ragdoll.MaxLaunch
	if velocity.Magnitude ~= velocity.Magnitude then
		return Vector3.zero -- NaN
	end
	return if velocity.Magnitude > max then velocity.Unit * max else velocity
end

-- Throws the body. Must run on whoever owns the character's physics: the server for NPCs,
-- the player's own client for player characters (RagdollController does that on "RagdollImpulse").
-- Sets velocities instead of adding impulses, so it gives the same result whether or not the
-- joints have already gone loose on this machine.
function RagdollRig.Launch(character: Model, velocity: Vector3, part: BasePart?, partVelocity: Vector3?)
	local root = character:FindFirstChild(ROOT)
	if not root or not root:IsA("BasePart") then
		return
	end
	local push = capped(velocity)
	local target = capped(root.AssemblyLinearVelocity + push)
	for _, child in character:GetChildren() do
		if child:IsA("BasePart") then
			child.AssemblyLinearVelocity = target
		end
	end
	-- Roll in the direction of travel, like a body going over a bonnet.
	root.AssemblyAngularVelocity = Vector3.yAxis:Cross(push) * (RagdollConfig.Ragdoll.Tumble / 100)
	if part and partVelocity and part:IsDescendantOf(character) then
		part.AssemblyLinearVelocity = target + capped(partVelocity)
	end
end

-- True when the body is lying on its back.
function RagdollRig.FacingUp(character: Model): boolean
	local torso = character:FindFirstChild("UpperTorso") or character:FindFirstChild("Torso") or character:FindFirstChild(ROOT)
	return torso ~= nil and torso:IsA("BasePart") and torso.CFrame.LookVector.Y > 0
end

-- Stands the root upright on the ground under it (owner only, see Launch). Used when
-- RagdollConfig.Ragdoll.SnapUpright is on.
function RagdollRig.Upright(character: Model)
	local root = character:FindFirstChild(ROOT)
	local humanoid = character:FindFirstChildOfClass("Humanoid")
	if not root or not root:IsA("BasePart") or not humanoid then
		return
	end
	local params = RaycastParams.new()
	params.FilterType = Enum.RaycastFilterType.Exclude
	params.FilterDescendantsInstances = { character }
	local hit = workspace:Raycast(root.Position + Vector3.new(0, 2, 0), Vector3.new(0, -12, 0), params)
	local ground = if hit then hit.Position else root.Position - Vector3.new(0, root.Size.Y / 2, 0)

	local legs = if humanoid.RigType == Enum.HumanoidRigType.R6 then 2 else 0
	local position = ground + Vector3.new(0, humanoid.HipHeight + legs + root.Size.Y / 2, 0)
	-- Lying down, the body's "up" points where the head is: face that way when standing.
	local lying = root.CFrame.UpVector
	local facing = Vector3.new(lying.X, 0, lying.Z)
	if facing.Magnitude < 0.3 then
		local look = root.CFrame.LookVector
		facing = Vector3.new(look.X, 0, look.Z)
	end
	if facing.Magnitude < 1e-3 then
		facing = Vector3.zAxis
	end
	root.CFrame = CFrame.lookAt(position, position + facing.Unit)
	root.AssemblyLinearVelocity = Vector3.zero
	root.AssemblyAngularVelocity = Vector3.zero
end

return table.freeze(RagdollRig)
