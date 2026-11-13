--!strict
-- Procedural body language layered over whatever animation is playing, on every client:
--
--   Flinch    a hit kicks a few joints, a damped spring brings them back (0.3-0.5 s)
--   Injury    lasting poses driven by the Injury* attributes: a limp that keeps weight on the
--             healthy leg, an arm held against the body, a hunch over a stomach wound, a dizzy head
--   Get-up    limbs blend from where the ragdoll left them back into the animation
--
-- How: every frame, after the Animator has written Motor6D.Transform and before physics uses
-- it (RunService.PreSimulation), the joint's Transform is multiplied by a small extra rotation.
-- Nothing replicates and no animation is stopped, so it works mid-run, mid-reload, mid-attack.
--
-- Angles are written in the parent part's space (for torso joints that is the character's own
-- space): X = pitch (+ leans back, - folds forward), Y = yaw (+ left shoulder back),
-- Z = roll (+ leans to the character's left). For a hanging limb, +X swings it forward.
-- All of it is converted through the joint's C0, so R6 and R15 share the same recipes.

local ReplicatedStorage = game:GetService("ReplicatedStorage")
local RunService = game:GetService("RunService")

local BodyZones = require(ReplicatedStorage.Shared.Ragdoll.BodyZones)
local RagdollConfig = require(ReplicatedStorage.Shared.Ragdoll.RagdollConfig)
local RagdollRig = require(ReplicatedStorage.Shared.Ragdoll.RagdollRig)

local STATE = RagdollConfig.StateAttribute
local reactions = RagdollConfig.Reactions
local BLEND_SECONDS = RagdollConfig.Ragdoll.BlendSeconds
local MAX_KICK = math.rad(70)

-- Spring: angular frequency, and the velocity that makes a kick peak at exactly the asked angle.
local OMEGA = 2 * math.pi * reactions.Frequency
local ZETA = math.clamp(reactions.Damping, 0.05, 1)
local KICK_GAIN = if ZETA < 0.999
	then OMEGA / math.exp(-ZETA * math.atan2(math.sqrt(1 - ZETA * ZETA), ZETA) / math.sqrt(1 - ZETA * ZETA))
	else OMEGA * math.exp(1)

type JointState = {
	motor: Motor6D,
	toJoint: CFrame, -- parent-part space -> joint space (inverse of C0's rotation)
	fromJoint: CFrame,
	angle: Vector3, -- flinch spring, radians
	velocity: Vector3,
	base: CFrame?, -- the animation's Transform under our last write
	written: CFrame?, -- what we last wrote
	blendFrom: CFrame?, -- ragdoll pose captured for the get-up blend
}

type Entry = {
	character: Model,
	root: BasePart,
	joints: { [string]: JointState },
	injuries: { [string]: number },
	hurt: boolean,
	flinching: boolean,
	ragdolled: boolean,
	blendStart: number?,
	phase: number,
	dirty: boolean,
	connection: RBXScriptConnection?,
}

type Hold = { pose: CFrame, weight: number }

local ProceduralPose = {}

local entries: { [Model]: Entry } = {}

-- Scratch tables reused for every character, every frame.
local offsets: { [string]: Vector3 } = {}
local holds: { [string]: Hold } = {}
local rootShift = Vector3.zero

local function add(name: string, pitch: number, yaw: number, roll: number)
	local extra = Vector3.new(math.rad(pitch), math.rad(yaw), math.rad(roll))
	offsets[name] = (offsets[name] or Vector3.zero) + extra
end

local function hold(name: string, pitch: number, yaw: number, roll: number, weight: number)
	holds[name] = { pose = CFrame.Angles(math.rad(pitch), math.rad(yaw), math.rad(roll)), weight = math.clamp(weight, 0, 1) }
end

local function sideName(side: number): string
	return if side > 0 then "Left" else "Right"
end

-- Lasting poses. `i` values are 0..1 injuries; `t` is the clock; `dip` is the hobble (0..1).
local function injuryPose(entry: Entry, t: number, dip: number)
	local injuries = entry.injuries

	-- Legs: favour the injured leg, carry the weight on the healthy one.
	for _, side in { 1, -1 } do
		local name = sideName(side)
		local i = injuries[name .. "Leg"] or 0
		if i > 0 then
			add(name .. "Hip", 14 * i, 0, -side * 4 * i) -- thigh lifted forward and slightly out
			add(name .. "Knee", -30 * i, 0, 0) -- knee bent: the foot barely touches down
			add(name .. "Ankle", 12 * i, 0, 0)
			add("Waist", -5 * i - 7 * i * dip, 0, -side * 7 * i) -- chest leans over the healthy leg
			add("Neck", 0, 0, side * 4 * i) -- head stays level
			-- Hips slide over the healthy foot (left is -X, so a left injury shifts +X), and
			-- drop on every step that lands on the bad leg.
			rootShift += Vector3.new(side * 0.22 * i, -0.2 * i * dip, 0)
		end
	end

	-- Arms: held bent against the body instead of swinging with the animation.
	for _, side in { 1, -1 } do
		local name = sideName(side)
		local i = injuries[name .. "Arm"] or 0
		if i > 0 then
			hold(name .. "Shoulder", 12, 0, side * 6, 0.85 * i)
			hold(name .. "Elbow", 70, 0, 0, 0.85 * i)
			hold(name .. "Wrist", 0, 0, 0, 0.85 * i)
			add("Waist", 0, 0, side * 3 * i) -- shoulder drops on the hurt side
		end
	end

	-- Torso: hunched over, slow heavy breathing, the better arm clutching the stomach.
	local torso = injuries.Torso or 0
	if torso > 0 then
		local breath = math.sin(t * 2.4)
		add("Waist", -16 * torso + 2 * torso * breath, 0, 0)
		add("Neck", -9 * torso, 0, 0)
		add("LeftHip", 6 * torso, 0, 0)
		add("RightHip", 6 * torso, 0, 0)
		add("LeftKnee", -8 * torso, 0, 0)
		add("RightKnee", -8 * torso, 0, 0)
		local side = if (injuries.RightArm or 0) <= (injuries.LeftArm or 0) then -1 else 1
		local name = sideName(side)
		if (injuries[name .. "Arm"] or 0) < 0.3 then
			-- Upper arm forward and across the body, forearm folded over the wound.
			hold(name .. "Shoulder", 28, -side * 50, side * 15, 0.8 * torso)
			hold(name .. "Elbow", 100, 0, 0, 0.8 * torso)
		end
	end

	-- Head: unsteady.
	local head = injuries.Head or 0
	if head > 0 then
		add("Neck", -6 * head + 3 * head * math.sin(t * 0.9), 0, 8 * head * math.sin(t * 1.3))
		add("Waist", 0, 0, 3 * head * math.sin(t * 0.7))
	end
end

local function stepSprings(entry: Entry, dt: number)
	local steps = math.clamp(math.ceil(dt * 120), 1, 4)
	local h = dt / steps
	local moving = false
	for _, joint in entry.joints do
		local angle, velocity = joint.angle, joint.velocity
		if angle == Vector3.zero and velocity == Vector3.zero then
			continue
		end
		for _ = 1, steps do
			velocity += (angle * (-OMEGA * OMEGA) - velocity * (2 * ZETA * OMEGA)) * h
			angle += velocity * h
		end
		if angle.Magnitude < 2e-3 and velocity.Magnitude < 2e-2 then
			angle, velocity = Vector3.zero, Vector3.zero
		else
			moving = true
		end
		joint.angle, joint.velocity = angle, velocity
	end
	entry.flinching = moving
end

-- Gives the joint back to the animation.
local function releaseJoint(joint: JointState)
	local written, base = joint.written, joint.base
	if written and base and joint.motor.Transform:FuzzyEq(written, 1e-5) then
		joint.motor.Transform = base -- nothing else is writing it: undo our offset
	end
	joint.written = nil
	joint.base = nil
end

local function release(entry: Entry)
	for _, joint in entry.joints do
		if joint.written then
			releaseJoint(joint)
		end
	end
	entry.dirty = false
end

local function pose(entry: Entry, dt: number, now: number)
	table.clear(offsets)
	table.clear(holds)
	rootShift = Vector3.zero

	stepSprings(entry, dt)

	if entry.hurt then
		-- Hobble: a dip per stride while walking. Stride rate follows speed (about 2 steps a
		-- second at 16 studs/s), so it reads as a limp without needing the animation's phase.
		local velocity = entry.root.AssemblyLinearVelocity
		local speed = Vector3.new(velocity.X, 0, velocity.Z).Magnitude
		local dip = 0
		if speed > 1 then
			entry.phase = (entry.phase + dt * math.pi * 2 * math.clamp(speed / 16, 0.4, 1.6)) % (math.pi * 2)
			dip = math.max(0, math.sin(entry.phase))
		end
		injuryPose(entry, now, dip)
	end

	local blend: number? = nil
	if entry.blendStart then
		local alpha = (now - entry.blendStart) / BLEND_SECONDS
		if alpha >= 1 then
			entry.blendStart = nil
			for _, joint in entry.joints do
				joint.blendFrom = nil
			end
		else
			blend = alpha * alpha * (3 - 2 * alpha) -- smoothstep
		end
	end

	for name, joint in entry.joints do
		local extra = offsets[name]
		local total = if extra then joint.angle + extra else joint.angle
		local held = holds[name]
		local shift = if name == "Root" then rootShift else Vector3.zero
		local from = if blend then joint.blendFrom else nil

		if total == Vector3.zero and not held and shift == Vector3.zero and not from then
			if joint.written then
				releaseJoint(joint)
			end
			continue
		end

		local motor = joint.motor
		local current = motor.Transform
		-- If the Transform is still what we wrote last frame, no animation touched this joint:
		-- keep building on the same base instead of stacking offsets on offsets.
		local written, previous = joint.written, joint.base
		local base = if written and previous and current:FuzzyEq(written, 1e-5) then previous else current

		local out = base
		if held then
			out = out:Lerp(joint.toJoint * held.pose * joint.fromJoint, held.weight)
		end
		if total ~= Vector3.zero then
			out = (joint.toJoint * CFrame.Angles(total.X, total.Y, total.Z) * joint.fromJoint) * out
		end
		if shift ~= Vector3.zero then
			out = CFrame.new(joint.toJoint * shift) * out
		end
		if from and blend then
			out = from:Lerp(out, blend)
		end

		motor.Transform = out
		joint.base = base
		joint.written = out
		entry.dirty = true
	end
end

local function readInjuries(entry: Entry)
	local hurt = false
	for _, key in BodyZones.InjuryKeys do
		local value = entry.character:GetAttribute(BodyZones.InjuryAttribute(key))
		local amount = if typeof(value) == "number" then math.clamp(value, 0, 1) else 0
		entry.injuries[key] = amount
		hurt = hurt or amount > 0
	end
	entry.hurt = hurt
end

local function onState(entry: Entry)
	local state = entry.character:GetAttribute(STATE)
	if state == "Ragdoll" then
		-- Physics owns the joints now. Forget springs and offsets.
		entry.ragdolled = true
		entry.blendStart = nil
		for _, joint in entry.joints do
			joint.angle, joint.velocity = Vector3.zero, Vector3.zero
			joint.written, joint.base, joint.blendFrom = nil, nil, nil
		end
		entry.dirty = false
	elseif state == "Recovering" then
		-- Joints lock again in a moment: remember where the ragdoll left every limb.
		for name, joint in entry.joints do
			joint.blendFrom = if name == "Root" then nil else RagdollRig.JointTransform(joint.motor)
		end
	else
		if entry.ragdolled then
			entry.blendStart = os.clock()
		end
		entry.ragdolled = false
	end
end

-- Starts drawing procedural poses for a character built by RagdollService (the RagdollVisuals
-- component calls this for everything tagged "Ragdollable").
function ProceduralPose.Register(character: Model)
	if entries[character] then
		return
	end
	local root = character:FindFirstChild("HumanoidRootPart")
	if not root or not root:IsA("BasePart") then
		return
	end

	local joints: { [string]: JointState } = {}
	for name, motor in RagdollRig.Motors(character) do
		local rotation = motor.C0.Rotation
		joints[name] = {
			motor = motor,
			toJoint = rotation:Inverse(),
			fromJoint = rotation,
			angle = Vector3.zero,
			velocity = Vector3.zero,
			base = nil,
			written = nil,
			blendFrom = nil,
		}
	end

	local entry: Entry = {
		character = character,
		root = root,
		joints = joints,
		injuries = {},
		hurt = false,
		flinching = false,
		ragdolled = false,
		blendStart = nil,
		phase = 0,
		dirty = false,
		connection = nil,
	}
	entries[character] = entry
	readInjuries(entry)
	entry.ragdolled = character:GetAttribute(STATE) == "Ragdoll" or character:GetAttribute(STATE) == "Recovering"

	entry.connection = character.AttributeChanged:Connect(function(attribute)
		if attribute == STATE then
			onState(entry)
		elseif string.sub(attribute, 1, 6) == "Injury" then
			readInjuries(entry)
		end
	end)
end

function ProceduralPose.Unregister(character: Model)
	local entry = entries[character]
	if entry then
		entries[character] = nil
		if entry.connection then
			entry.connection:Disconnect()
		end
		release(entry)
	end
end

-- Plays a flinch. `zone` is a BodyZones zone, `localDirection` the blow's travel direction in
-- the character's own space (+Z = it came from the front, +X = it came from the left),
-- `strength` 0..1.
function ProceduralPose.Flinch(character: Model, zone: string, localDirection: Vector3, strength: number)
	local entry = entries[character]
	if not entry or entry.ragdolled then
		return
	end
	local a = math.clamp(strength, 0, 1) * reactions.Strength
	local dx = math.clamp(localDirection.X, -1, 1)
	local dz = math.clamp(localDirection.Z, -1, 1)
	local side = BodyZones.Side(zone)

	local function kick(name: string, pitch: number, yaw: number, roll: number)
		local joint = entry.joints[name]
		local scale = a
		if not joint and name == "Waist" then
			joint = entry.joints.Root -- R6 has no waist: lean the whole torso, but less
			scale *= 0.5
		end
		if not joint then
			return
		end
		local velocity = joint.velocity + Vector3.new(math.rad(pitch), math.rad(yaw), math.rad(roll)) * (scale * KICK_GAIN)
		local limit = MAX_KICK * KICK_GAIN
		joint.velocity = if velocity.Magnitude > limit then velocity.Unit * limit else velocity
	end

	if zone == "Head" then
		-- The head snaps the way the blow travels; the chest follows a little.
		kick("Neck", 28 * dz, 0, -22 * dx)
		kick("Waist", 8 * dz, 0, -6 * dx)
	elseif zone == "Chest" then
		-- The chest is driven back, the head and arms lag behind it.
		kick("Waist", 16 * dz, 0, -8 * dx)
		kick("Neck", -12 * dz, 0, 6 * dx)
		kick("LeftShoulder", 8 * dz, 0, 0)
		kick("RightShoulder", 8 * dz, 0, 0)
	elseif zone == "Stomach" then
		-- From the front or side: double over the wound. From behind: arch the back.
		local fold = if dz > -0.3 then 1 else -0.5
		local arms = math.max(fold, 0)
		kick("Waist", -26 * fold, 0, -8 * dx)
		kick("Neck", -14 * fold, 0, 0)
		kick("LeftShoulder", 18 * arms, 0, 8 * arms)
		kick("RightShoulder", 18 * arms, 0, -8 * arms)
		kick("LeftElbow", 30 * arms, 0, 0)
		kick("RightElbow", 30 * arms, 0, 0)
		kick("LeftHip", 10 * arms, 0, 0)
		kick("RightHip", 10 * arms, 0, 0)
		kick("LeftKnee", -14 * arms, 0, 0)
		kick("RightKnee", -14 * arms, 0, 0)
	elseif zone == "LeftArm" or zone == "RightArm" then
		-- The arm is thrown along the blow and the shoulders twist after it.
		local name = sideName(side)
		kick(name .. "Shoulder", -32 * dz, 0, -side * 10)
		kick(name .. "Elbow", 22, 0, 0)
		kick("Waist", 0, side * 12 * dz, 0)
		kick("Neck", 0, -side * 6 * dz, 0)
	elseif zone == "LeftLeg" or zone == "RightLeg" then
		-- The leg buckles; the body throws its weight onto the other leg to stay up.
		local name = sideName(side)
		local other = sideName(-side)
		kick(name .. "Hip", 20, 0, 0)
		kick(name .. "Knee", -42, 0, 0)
		kick(other .. "Knee", -8, 0, 0)
		kick("Waist", -10, 0, -side * 9)
		kick("Neck", -6, 0, side * 5)
	end
	entry.flinching = true
end

RunService.PreSimulation:Connect(function(dt)
	local camera = workspace.CurrentCamera
	local eye = if camera then camera.CFrame.Position else nil
	local now = os.clock()
	local step = math.min(dt, 1 / 20)

	for _, entry in entries do
		if entry.ragdolled then
			continue
		end
		local busy = entry.flinching or entry.hurt or entry.blendStart ~= nil
		local near = eye == nil or (entry.root.Position - eye).Magnitude <= reactions.MaxDistance
		if busy and near then
			pose(entry, step, now)
		elseif entry.dirty then
			release(entry)
		end
	end
end)

return table.freeze(ProceduralPose)
