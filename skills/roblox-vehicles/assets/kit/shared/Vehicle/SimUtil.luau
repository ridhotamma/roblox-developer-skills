--!strict
-- Shared plumbing for the motorcycle, boat, plane and helicopter sims (BikeSim, BoatSim, PlaneSim,
-- HeliSim), plus the momentum-theory and atmosphere maths they share with scripts/types/*.cjs.
--
-- Every new vehicle type works the same way:
--   * VehicleService builds an invisible root part at the centre of mass carrying all the mass,
--     with one VectorForce ("SimForce", at the centre of mass) and one Torque ("SimTorque").
--   * Each physics step the sim collects forces in real units (newtons, at world points) and
--     torques, converts them with toRoblox = AssemblyMass / spec.Mass / METERS_PER_STUD, and writes
--     the totals to SimForce and SimTorque. Performance never depends on part sizes or densities.
--   * These vehicles live in real gravity: an upward force cancels the part of Workspace.Gravity
--     beyond 9.81 m/s² (196.2 studs/s² is ~5.6 g at 0.28 m per stud), so lift, buoyancy, wheelies,
--     lean balance and suspension sag all behave like the real vehicle.
--   * Rotation is steered by tracking target angular velocities with a torque I k (target - ω) per
--     root axis, using the root box's inertia (the root carries all the mass).

local Workspace = game:GetService("Workspace")

local SimUtil = {}

SimUtil.G = 9.81 -- m/s²
SimUtil.MPS = 0.28 -- metres per stud
SimUtil.RHO_AIR = 1.225 -- kg/m³ at sea level

local MPS = SimUtil.MPS
local G = SimUtil.G

export type Rig = {
	model: Model,
	root: BasePart,
	spec: any,
	force: VectorForce,
	torque: Torque,
	params: RaycastParams,
	F: Vector3, -- this step's force, Roblox units
	T: Vector3, -- this step's torque about the centre of mass, Roblox units
	com: Vector3,
	toRoblox: number, -- newtons -> Roblox force
	lastRecover: number,
	prevV: Vector3?,
}

function SimUtil.Clamp(x: number, a: number, b: number): number
	return math.clamp(x, a, b)
end

function SimUtil.Lerp(a: number, b: number, t: number): number
	return a + (b - a) * t
end

function SimUtil.SmoothStep(a: number, b: number, x: number): number
	local t = math.clamp((x - a) / (b - a), 0, 1)
	return t * t * (3 - 2 * t)
end

-- Horizontal unit vector along v (forward on the ground plane).
function SimUtil.Flat(v: Vector3): Vector3
	local f = Vector3.new(v.X, 0, v.Z)
	return if f.Magnitude > 1e-6 then f.Unit else Vector3.new(0, 0, -1)
end

-- Spring rate and damper (Roblox units) for a corner mass and natural frequency.
function SimUtil.Spring(cornerMass: number, frequency: number, dampingRatio: number): (number, number)
	local omega = 2 * math.pi * frequency
	local k = cornerMass * omega * omega
	return k, 2 * dampingRatio * math.sqrt(k * cornerMass)
end

-- Induced velocity (m/s) of an actuator disk making thrust T (N) with axial inflow V through area A.
function SimUtil.InducedVelocity(T: number, rho: number, A: number, V: number): number
	if T <= 0 then
		return 0
	end
	local v = math.max(V, 0)
	return -v / 2 + math.sqrt(v * v / 4 + T / (2 * rho * A))
end

-- Thrust (N) of a propeller, rotor or water jet from shaft power P (W), by momentum theory:
-- eta P = T (V + vi). Static thrust is (2 rho A (eta P)^2)^(1/3); at speed it tends to eta P / V.
function SimUtil.DiskThrust(P: number, rho: number, A: number, V: number, eta: number): number
	if P <= 0 or A <= 0 then
		return 0
	end
	local pe = eta * P
	local v = math.max(V, 0)
	local lo, hi = 0, (2 * rho * A * pe * pe) ^ (1 / 3) * 1.001 + 1
	for _ = 1, 24 do
		local mid = (lo + hi) / 2
		if mid * (v + SimUtil.InducedVelocity(mid, rho, A, v)) > pe then
			hi = mid
		else
			lo = mid
		end
	end
	return lo
end

-- Fixed-propeller efficiency: staticEff at standstill, rising to eff by fullSpeed (m/s).
function SimUtil.PropEfficiency(staticEff: number, eff: number, fullSpeed: number, V: number): number
	return staticEff + (eff - staticEff) * math.clamp(math.max(V, 0) / math.max(fullSpeed, 0.1), 0, 1)
end

-- Air density (kg/m³) at an altitude (m): exponential atmosphere, scale height 8500 m.
function SimUtil.AirDensity(altitudeM: number): number
	return SimUtil.RHO_AIR * math.exp(-math.max(altitudeM, 0) / 8500)
end

-- Raycast params for a vehicle's ground casts: its own parts and occupants (VehicleRider group,
-- which doesn't collide with VehicleHull) are skipped, and so is Terrain water.
function SimUtil.Params(model: Model, root: BasePart): RaycastParams
	local params = RaycastParams.new()
	params.FilterType = Enum.RaycastFilterType.Exclude
	params.FilterDescendantsInstances = { model }
	params.RespectCanCollide = true
	params.IgnoreWater = true
	params.CollisionGroup = root.CollisionGroup
	return params
end

-- The rig of a model VehicleService has built, or nil.
function SimUtil.Rig(model: Model, spec: any): Rig?
	local root = model.PrimaryPart
	if not root or model:GetAttribute("ChassisBuilt") ~= true then
		return nil
	end
	return SimUtil.RootRig(model, root, spec)
end

-- The rig of one root part with a SimForce and SimTorque (a train car is its own assembly).
-- spec.Mass (kg) is the mass that assembly stands for.
function SimUtil.RootRig(model: Model, root: BasePart, spec: any): Rig?
	local attachment = root:FindFirstChild("SimAttachment")
	local force = attachment and attachment:FindFirstChild("SimForce")
	local torque = attachment and attachment:FindFirstChild("SimTorque")
	if not (force and force:IsA("VectorForce") and torque and torque:IsA("Torque")) then
		return nil
	end
	return {
		model = model,
		root = root,
		spec = spec,
		force = force,
		torque = torque,
		params = SimUtil.Params(model, root),
		F = Vector3.zero,
		T = Vector3.zero,
		com = root.Position,
		toRoblox = 1,
		lastRecover = -math.huge,
		prevV = nil,
	}
end

function SimUtil.Begin(rig: Rig)
	rig.F = Vector3.zero
	rig.T = Vector3.zero
	rig.com = rig.root.AssemblyCenterOfMass
	rig.toRoblox = rig.root.AssemblyMass / rig.spec.Mass / MPS
end

-- A force in Roblox units at a world point (nil = at the centre of mass).
function SimUtil.AddForceRoblox(rig: Rig, force: Vector3, at: Vector3?)
	rig.F += force
	if at then
		rig.T += (at - rig.com):Cross(force)
	end
end

-- A force in newtons at a world point (nil = at the centre of mass).
function SimUtil.AddForce(rig: Rig, newtons: Vector3, at: Vector3?)
	SimUtil.AddForceRoblox(rig, newtons * rig.toRoblox, at)
end

-- A torque in newton-metres.
function SimUtil.AddTorque(rig: Rig, newtonMeters: Vector3)
	rig.T += newtonMeters * (rig.toRoblox / MPS)
end

function SimUtil.AddTorqueRoblox(rig: Rig, torque: Vector3)
	rig.T += torque
end

-- Net gravity of g (m/s²) instead of Workspace.Gravity.
function SimUtil.RealGravity(rig: Rig, g: number)
	rig.F += Vector3.yAxis * rig.root.AssemblyMass * (Workspace.Gravity - g / MPS)
end

-- Principal moments of the root box (X right, Y up, Z back) with the assembly's mass.
function SimUtil.Inertia(rig: Rig): Vector3
	local s = rig.root.Size
	local m = rig.root.AssemblyMass
	return Vector3.new(m * (s.Y * s.Y + s.Z * s.Z), m * (s.X * s.X + s.Z * s.Z), m * (s.X * s.X + s.Y * s.Y)) / 12
end

-- Torque that drives the angular velocity toward `target` (world, rad/s): I k (target - ω) per root
-- axis, gains and authority given per axis (X pitch, Y yaw, Z roll).
function SimUtil.TrackRates(rig: Rig, target: Vector3, gains: Vector3, authority: Vector3)
	local cf = rig.root.CFrame
	local err = cf:VectorToObjectSpace(target - rig.root.AssemblyAngularVelocity)
	rig.T += cf:VectorToWorldSpace(SimUtil.Inertia(rig) * gains * authority * err)
end

function SimUtil.Finish(rig: Rig)
	rig.force.Force = rig.F
	rig.torque.Torque = rig.T
end

function SimUtil.Clear(rig: Rig)
	rig.force.Force = Vector3.zero
	rig.torque.Torque = Vector3.zero
end

-- Horizontal velocity change in one step beyond limitG (real g): a crash. Returns the g or 0.
function SimUtil.Impact(rig: Rig, dt: number, limitG: number): number
	local v = rig.root.AssemblyLinearVelocity
	local prev = rig.prevV
	rig.prevV = v
	if not prev then
		return 0
	end
	local dv = v - prev
	local g = Vector3.new(dv.X, 0, dv.Z).Magnitude / dt * MPS / G
	return if g > limitG then g else 0
end

-- Puts the vehicle upright `height` studs above the ground (or water) below it, same heading.
-- surface: optional water level at that spot (studs).
function SimUtil.Recover(rig: Rig, height: number, surface: number?): boolean
	local now = os.clock()
	if now - rig.lastRecover < 2 then
		return false
	end
	rig.lastRecover = now
	local root = rig.root
	local forward = SimUtil.Flat(root.CFrame.LookVector)
	local position = root.Position
	local hit = Workspace:Raycast(position + Vector3.yAxis * 12, -Vector3.yAxis * 80, rig.params)
	local y = if hit then hit.Position.Y else position.Y
	if surface and surface > y then
		y = surface
	end
	local upright = Vector3.new(position.X, y + height, position.Z)
	root.CFrame = CFrame.lookAt(upright, upright + forward)
	root.AssemblyLinearVelocity = Vector3.zero
	root.AssemblyAngularVelocity = Vector3.zero
	rig.prevV = nil
	return true
end

-- Lean / heel angle (rad, + = right side down) and pitch (rad, + = nose up) of a CFrame.
function SimUtil.Bank(cf: CFrame): number
	return math.atan2(-cf.RightVector.Y, cf.UpVector.Y)
end

function SimUtil.Pitch(cf: CFrame): number
	return math.asin(math.clamp(cf.LookVector.Y, -1, 1))
end

return table.freeze(SimUtil)
