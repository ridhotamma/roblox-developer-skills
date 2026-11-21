--!strict
-- Boat physics for one hull built by VehicleService (Type = "Boat"). See references/boat-physics.md.
--
-- Per step, in real gravity (Recovery.AirGravity g when fully out of the water):
--   * buoyancy: the hull is a grid of columns (Hull.SamplesAlong x SamplesAcross, centred on the
--     centre of mass, at the keel), each rho g A d with A = waterplane / n, so the boat floats at the
--     spec's draft whatever the mesh; vertical water damping per column (Hull.Damping)
--   * planing lift per column, ½ rho min(u, Vp)² A C min(d / dPlane, 1), weighted toward the bow
--     (Hull.LiftBow), square to the hull bottom (a heeled hull carves), with speed-proportional
--     damping; C makes the hull carry Hull.PlaningLift of its weight at full planing speed
--   * resistance in the boat's frame from the measured planing share and immersion (friction +
--     wave hump + planing drag W tan(trim)), shared across the wet columns; bow rise over the hump
--   * lateral resistance per column (keel, chines), weighted aft (Hull.KeelAft)
--   * propulsion: actuator-disk thrust at the prop, only when the prop is in the water; outboards
--     and jets swivel the thrust, rudders (and outboard gearcases) add lift in the prop wash
--   * heel in turns (Hull.Bank), anti-capsize (Recovery.SelfRight), yaw stability assist, air
--     levelling, a beach push, auto-flip

local Workspace = game:GetService("Workspace")

local SimUtil = require(script.Parent.SimUtil)
local Water = require(script.Parent.Water)

local MPS = SimUtil.MPS
local G = SimUtil.G
local RHO_AIR = SimUtil.RHO_AIR
local NU_WATER = 1.19e-6

local PLANE_DAMP = 4 -- planing surface damping per (m/s) of forward speed
local TURN_LENGTHS = 3.5 -- stability assist: tightest turn ~3.5 hull lengths / tan(steer)
local ESC_GAIN = 6
local SELF_RIGHT = 25 -- degrees of heel before the anti-capsize assist
local AIR_LEVEL, AIR_MAX, AIR_DAMP = 2, 1, 10
local LAT_FLOOR = 0.4 -- m/s added to the lateral speed in the quadratic drag (low-speed damping)

export type Input = { Throttle: number, Steer: number, Handbrake: boolean? }

export type Telemetry = {
	Kind: string,
	SpeedKmh: number,
	Throttle: number,
	Thrust: number, -- N
	Planing: number, -- 0..1 share of the weight carried by planing lift
	Draft: number, -- m, mean
	Heel: number, -- degrees, + = right side down
	Trim: number, -- degrees, + = bow up
	Airborne: boolean,
	PropWet: number,
	Grounded: number, -- wet hull columns
	Stuck: boolean, -- beached
}

type Column = { x: number, y: number, z: number, liftW: number, keelW: number, d: number, world: Vector3 }

local BoatSim = {}
BoatSim.__index = BoatSim

-- ------------------------------------------------------------------ hull maths (mirrors boat.cjs)
local function displacement(spec: any): number
	return spec.Mass / spec.Hull.WaterDensity
end

local function waterplane(spec: any): number
	return spec.Hull.Length * spec.Hull.Beam * spec.Hull.BlockCoefficient
end

function BoatSim.Draft(spec: any): number
	return displacement(spec) / waterplane(spec)
end

function BoatSim.PlaningSpeed(spec: any): number
	local hull = spec.Hull
	return if hull.PlaningSpeedKmh > 0 then hull.PlaningSpeedKmh / 3.6 else 1.2 * math.sqrt(G * hull.Length)
end

local function wetted0(spec: any): number
	local T = BoatSim.Draft(spec)
	return 1.7 * spec.Hull.Length * T + displacement(spec) / T
end

local function waveBump(spec: any, fn: number): number
	local x = fn / 0.5
	local x4 = x * x * x * x
	if x <= 1 then
		return x4
	end
	local planing = 2 * x4 / (1 + x4 * x * x)
	return planing + (x4 - planing) * spec.Hull.WaveWall
end

local function frictionCoefficient(v: number, L: number): number
	local re = math.max(math.abs(v) * L / NU_WATER, 1e5)
	local lg = math.log10(re) - 2
	return 0.075 / (lg * lg)
end

-- Hull resistance (N) at forward speed v for a planing share and immersion (d / draft).
function BoatSim.Resistance(spec: any, v: number, lift: number, immersion: number): (number, number)
	local hull = spec.Hull
	local W = spec.Mass * G
	local fn = math.abs(v) / math.sqrt(G * hull.Length)
	local wet = wetted0(spec) * (0.25 + 0.75 * math.clamp(immersion, 0, 1.5))
	local friction = 0.5 * hull.WaterDensity * v * v * wet * frictionCoefficient(v, hull.Length)
	local wave = W * hull.HumpRW * waveBump(spec, fn) * (1 - math.clamp(lift, 0, 1))
	local planing = W * math.clamp(lift, 0, 1) * math.tan(math.rad(hull.Trim))
	return friction + wave + planing, wave
end

-- Propulsion thrust (N) at forward speed v for a throttle -1..1.
function BoatSim.Thrust(spec: any, v: number, throttle: number): number
	local d = spec.Drive
	if d.SpeedLimitKmh > 0 and v * 3.6 >= d.SpeedLimitKmh and throttle > 0 then
		return 0
	end
	local area = math.pi * (d.PropDiameter / 2) ^ 2
	local vin = if throttle >= 0 then v else -v
	local eta = SimUtil.PropEfficiency(d.StaticEfficiency, d.Efficiency, d.EfficiencySpeedKmh / 3.6, vin)
	local power = math.abs(throttle) * d.Power * 1000 * (if throttle < 0 then d.Reverse else 1)
	local t = SimUtil.DiskThrust(power, spec.Hull.WaterDensity, area, vin, eta)
	return if throttle < 0 then -t else t
end

export type BoatSim = typeof(setmetatable(
	{} :: {
		Kind: string,
		rig: SimUtil.Rig,
		spec: any,
		columns: { Column },
		draft: number,
		area: number,
		dPlane: number,
		vPlane: number,
		cPlane: number,
		damp: number,
		prop: Vector3,
		staticThrust: number,
		throttle: number,
		steerDeg: number,
		flipTimer: number,
	},
	BoatSim
))

function BoatSim.new(model: Model, spec: any): BoatSim?
	local rig = SimUtil.Rig(model, spec)
	if not rig then
		return nil
	end
	local hull = spec.Hull
	local T = BoatSim.Draft(spec)
	local nA, nB = hull.SamplesAlong, hull.SamplesAcross
	local n = nA * nB
	local keel = -spec.ComHeight / MPS
	local columns: { Column } = {}
	for i = 0, nA - 1 do
		for k = 0, nB - 1 do
			local along = (i / (nA - 1) - 0.5) * 0.8 * hull.Length -- m, + = bow
			local across = (k / (nB - 1) - 0.5) * 0.7 * hull.Beam
			local aft = -along / (0.4 * hull.Length) -- -1 bow .. 1 stern
			table.insert(columns, {
				x = across / MPS,
				y = keel,
				z = -along / MPS,
				liftW = 1 - hull.LiftBow * aft,
				keelW = 1 + hull.KeelAft * aft,
				d = 0,
				world = Vector3.zero,
			})
		end
	end
	local area = waterplane(spec) / n
	local vp = BoatSim.PlaningSpeed(spec)
	return setmetatable({
		Kind = "Boat",
		rig = rig,
		spec = spec,
		columns = columns,
		draft = T,
		area = area,
		dPlane = hull.PlaneDraft * T,
		vPlane = vp,
		cPlane = hull.PlaningLift * spec.Mass * G / (0.5 * hull.WaterDensity * vp * vp * waterplane(spec)),
		damp = 2 * hull.Damping * math.sqrt(hull.WaterDensity * G * area * (spec.Mass / n)),
		prop = Vector3.new(0, (-spec.ComHeight + T - spec.Drive.Depth) / MPS, 0.48 * hull.Length / MPS),
		staticThrust = BoatSim.Thrust(spec, 0, 1),
		throttle = 0,
		steerDeg = 0,
		flipTimer = 0,
	}, BoatSim)
end

function BoatSim.Recover(self: BoatSim)
	local root = self.rig.root
	SimUtil.Recover(self.rig, self.spec.ComHeight / MPS, Water.HeightAt(root.Position))
end

function BoatSim.Step(self: BoatSim, dt: number, input: Input): Telemetry
	local spec = self.spec
	local hull = spec.Hull
	local rig = self.rig
	local root = rig.root
	SimUtil.Begin(rig)
	local cf = root.CFrame
	local up, forward, right = cf.UpVector, cf.LookVector, cf.RightVector
	local velocity = root.AssemblyLinearVelocity * MPS
	local flatF = SimUtil.Flat(forward)
	local flatR = flatF:Cross(Vector3.yAxis)
	local u = velocity:Dot(flatF)
	local rho = hull.WaterDensity
	local W = spec.Mass * G
	local T = self.draft
	local t = Water.Time()
	local base = Water.Level(root.Position)

	-- Buoyancy, damping and planing lift per hull column.
	local sumD, wetCount, liftN = 0, 0, 0
	local liftDir = (up - flatF * up:Dot(flatF)).Unit
	local ue = math.min(math.max(u, 0), self.vPlane)
	for _, column in self.columns do
		local p = cf:PointToWorldSpace(Vector3.new(column.x, column.y, column.z))
		column.world = p
		local surface = Water.Surface(p, base, t)
		column.d = if surface then math.clamp((surface - p.Y) * MPS, 0, hull.Depth) else 0
		if column.d <= 0 then
			continue
		end
		wetCount += 1
		sumD += column.d
		local vy = root:GetVelocityAtPosition(p).Y * MPS
		local buoyancy = rho * G * self.area * column.d
		local damping = -self.damp * vy * math.min(column.d / (0.25 * T), 1)
		local immersed = math.min(column.d / self.dPlane, 1)
		local lift = 0.5 * rho * ue * ue * self.area * self.cPlane * immersed * column.liftW
		local liftDamping = -0.5 * rho * math.max(u, 0) * self.area * self.cPlane * PLANE_DAMP * vy * immersed
		liftN += lift
		SimUtil.AddForce(rig, Vector3.yAxis * (buoyancy + damping), p)
		SimUtil.AddForce(rig, liftDir * (lift + liftDamping), p)
	end
	local immersion = sumD / #self.columns / T
	local share = math.clamp(liftN / W, 0, 1)

	-- Resistance and lateral resistance, shared by the wet columns.
	local resistance, waveDrag = BoatSim.Resistance(spec, u, share, immersion)
	if wetCount > 0 then
		local direction = if u >= 0 then 1 else -1
		for _, column in self.columns do
			if column.d <= 0 then
				continue
			end
			local p = column.world
			SimUtil.AddForce(rig, flatF * (-direction * resistance * column.d / sumD), p + Vector3.yAxis * (column.d / 2 / MPS))
			local vl = root:GetVelocityAtPosition(p):Dot(flatR) * MPS
			local aLat = 0.8 * hull.Length / hull.SamplesAlong * column.d / hull.SamplesAcross
			local lateral = -0.5 * rho * hull.LateralDrag * aLat * (math.abs(vl) + LAT_FLOOR) * vl * column.keelW
			SimUtil.AddForce(rig, flatR * lateral, Vector3.new(p.X, rig.com.Y, p.Z)) -- yaw, no roll
		end
		SimUtil.AddTorque(rig, right * (hull.ProwRise * waveDrag * 0.25 * hull.Length)) -- bow rise
	end

	-- Propulsion: thrust only with the prop in the water.
	local drive = spec.Drive
	local throttleIn = math.clamp(input.Throttle, -1, 1)
	local spoolStep = dt / math.max(drive.Spool, 0.01)
	self.throttle += math.clamp(throttleIn - self.throttle, -spoolStep, spoolStep)
	local steerStep = drive.SteerSpeed * dt
	self.steerDeg += math.clamp(math.clamp(input.Steer, -1, 1) * drive.MaxSteer - self.steerDeg, -steerStep, steerStep)
	local prop = cf:PointToWorldSpace(self.prop)
	local propSurface = Water.Surface(prop, base, t)
	local wet = if propSurface then math.clamp((propSurface - prop.Y) * MPS / drive.PropDiameter + 0.5, 0, 1) else 0
	local thrust = BoatSim.Thrust(spec, u, self.throttle) * wet
	local steer = math.rad(self.steerDeg)
	local thrustDirection = if drive.Type == "inboard" then forward else CFrame.fromAxisAngle(up, steer) * forward
	SimUtil.AddForce(rig, thrustDirection * thrust, prop)
	local propAtCom = Vector3.new(prop.X, rig.com.Y, prop.Z)
	if drive.Type ~= "jet" then
		-- Rudder lift (an inboard's rudder, an outboard's gearcase) in the prop wash.
		local area = math.pi * (drive.PropDiameter / 2) ^ 2
		local wash = 2 * SimUtil.InducedVelocity(math.abs(thrust), rho, area, math.abs(u))
		local vr = u + math.sign(thrust) * wash
		local rudder = 0.5 * rho * vr * math.abs(vr) * drive.RudderArea * math.clamp(3 * steer, -1.1, 1.1) * wet
		SimUtil.AddForce(rig, flatR * -rudder, propAtCom)
	else
		-- Jets steer with thrust only; keep Drive.IdleSteer of it off throttle.
		local idle = drive.IdleSteer * self.staticThrust * math.min(1, math.abs(u) / 3) * wet
		SimUtil.AddForce(rig, flatR * (-math.sin(steer) * math.max(0, idle - math.abs(thrust))), propAtCom)
	end

	-- Air drag.
	local speed = velocity.Magnitude
	if speed > 0.1 then
		SimUtil.AddForce(rig, velocity.Unit * (-0.5 * RHO_AIR * spec.Aero.Cd * spec.Aero.Area * speed * speed))
	end

	local airborne = wetCount == 0 and wet == 0
	local angular = root.AssemblyAngularVelocity
	local yawRight = -angular.Y
	local recovery = spec.Recovery
	-- Stability assist: yaw beyond what the helm asks for.
	local stability = spec.Assists.Stability
	if not airborne and stability > 0 and u > 2 then
		local wanted = u * math.tan(steer) / (TURN_LENGTHS * hull.Length)
		local over = yawRight - math.clamp(yawRight, math.min(0, wanted), math.max(0, wanted))
		SimUtil.AddTorqueRoblox(rig, Vector3.yAxis * over * ESC_GAIN * stability * SimUtil.Inertia(rig).Y)
	end
	-- Heel in turns: planing hulls bank in (Hull.Bank > 0, by the planing share), displacement hulls
	-- heel out (Bank < 0), as a share of a motorcycle's balanced lean.
	local heel = SimUtil.Bank(cf)
	if not airborne and wetCount > 0 and math.abs(heel) < math.rad(SELF_RIGHT + 10) then
		local lean = math.atan(math.max(u, 0) * yawRight / G) * 0.5 * hull.Bank * (if hull.Bank > 0 then share else 1)
		local heelTarget = math.clamp(lean, -math.rad(25), math.rad(25))
		local rate = math.clamp((heelTarget - heel) * 2, -0.6, 0.6)
		SimUtil.TrackRates(rig, angular + forward * (rate - angular:Dot(forward)), Vector3.new(0, 0, 6), Vector3.zAxis)
	end
	-- Anti-capsize: past SELF_RIGHT degrees, roll back harder the further over it is.
	if not airborne and recovery.SelfRight > 0 and math.abs(heel) > math.rad(SELF_RIGHT) then
		local back = -math.sign(heel) * math.min(1.2, (math.abs(heel) - math.rad(SELF_RIGHT)) * 4)
		SimUtil.TrackRates(rig, angular + forward * (back - angular:Dot(forward)), Vector3.new(0, 0, 12 * recovery.SelfRight), Vector3.zAxis)
	end
	if airborne and recovery.AirControl > 0 then
		local rate = up:Cross(Vector3.yAxis) * AIR_LEVEL
		if rate.Magnitude > AIR_MAX then
			rate = rate.Unit * AIR_MAX
		end
		local gain = AIR_DAMP * recovery.AirControl
		SimUtil.TrackRates(rig, Vector3.new(rate.X, angular.Y, rate.Z), Vector3.new(gain, 0, gain), Vector3.new(1, 0, 1))
	end
	-- Beached: hull aground and dry, throttle held -> push off.
	local beached = false
	if wetCount == 0 and recovery.BeachPush and math.abs(throttleIn) > 0.5 then
		local ground = Workspace:Raycast(root.Position, -Vector3.yAxis * (spec.ComHeight / MPS + 2), rig.params)
		if ground then
			beached = true
			SimUtil.AddForce(rig, flatF * (math.sign(throttleIn) * 0.35 * W) + Vector3.yAxis * (0.3 * W))
		end
	end
	SimUtil.RealGravity(rig, if airborne then recovery.AirGravity * G else G)
	if recovery.AutoFlip and up.Y < 0.2 and root.AssemblyLinearVelocity.Magnitude < 4 then
		self.flipTimer += dt
		if self.flipTimer > 1.5 then
			self.flipTimer = 0
			self:Recover()
		end
	else
		self.flipTimer = 0
	end

	SimUtil.Finish(rig)
	return {
		Kind = "Boat",
		SpeedKmh = u * 3.6,
		Throttle = self.throttle,
		Thrust = thrust,
		Planing = share,
		Draft = immersion * T,
		Heel = math.deg(heel),
		Trim = math.deg(SimUtil.Pitch(cf)),
		Airborne = airborne,
		PropWet = wet,
		Grounded = wetCount,
		Stuck = beached,
	}
end

function BoatSim.Destroy(self: BoatSim)
	SimUtil.Clear(self.rig)
end

return BoatSim
