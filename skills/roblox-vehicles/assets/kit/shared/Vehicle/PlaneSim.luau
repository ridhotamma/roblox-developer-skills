--!strict
-- Airplane physics for one aircraft built by VehicleService (Type = "Plane"). See
-- references/airplane-physics.md.
--
-- Forces (SI, real gravity): lift q S C_L(α) square to the airflow in the plane of symmetry,
-- drag q S C_D (parabolic polar, induced drag reduced in ground effect, Mach drag rise, flaps,
-- gear, stall separation), side force -q S C_Yβ β, thrust along the nose (momentum-theory
-- propeller or jet with spool-up and afterburner), landing gear (Gear).
--
-- Control layer (GTA-like, every assist a 0..1 dial in Assists):
--   * the body follows the flight path's own turn rate ω_path = (v̂ × a) / V
--   * pitch stick sets an angle-of-attack target: neutral holds the flight path (AutoTrim) and
--     eases toward level (AutoLevel); full back = 0.9 × stall angle with StallProtection = 1, up
--     to 10° past it with 0; limited by Controls.MaxG / MinG
--   * roll stick sets a roll rate; neutral rolls the wings level (AutoLevel)
--   * rudder sets a sideslip target; Coordination holds zero sideslip
--   * a torque I k (ω_target - ω) tracks it, with authority q / q_full: soft near the stall, so a
--     stalled plane drops its nose and recovers

local Workspace = game:GetService("Workspace")

local Gear = require(script.Parent.Gear)
local SimUtil = require(script.Parent.SimUtil)

local MPS = SimUtil.MPS
local G = SimUtil.G
local RHO = SimUtil.RHO_AIR
local smoothstep = SimUtil.SmoothStep
local lerp = SimUtil.Lerp

local K_ALPHA = 2.5 -- pitch rate (1/s) per radian of angle-of-attack error
local ALPHA_LEAD = 0.6 -- s of α-rate anticipation near the limit (no protection overshoot)
local PATH_LEVEL = 3 -- g per unit sin(γ), times Assists.AutoLevel: eases the flight path to level
local K_BETA = 2 -- yaw rate (1/s) per radian of sideslip error
local LEVEL_GAIN = 1.5 -- wings-level roll rate (1/s) per radian of bank, times Assists.AutoLevel
local TRACK = Vector3.new(5, 4, 6) -- rate tracking (1/s): pitch, yaw, roll
local THROTTLE_RATE = 0.5 -- throttle lever travel per second

export type Input = {
	Pitch: number, -- +1 = nose down (stick forward)
	Roll: number, -- +1 = roll right
	Yaw: number, -- +1 = yaw right (rudder)
	Power: number, -- -1..1: lever down / up (holding up at full = afterburner)
	Brake: boolean?, -- wheel brakes
	Flaps: boolean?,
	GearDown: boolean?,
}

export type Telemetry = {
	Kind: string,
	SpeedKmh: number, -- forward speed
	AirspeedKmh: number,
	Altitude: number, -- m (world height)
	VerticalSpeed: number, -- m/s
	Alpha: number, -- degrees
	Beta: number,
	Bank: number,
	Throttle: number, -- lever 0..1
	Afterburner: boolean,
	Stall: boolean,
	GLoad: number,
	GearDown: boolean,
	Flaps: number,
	Grounded: number,
	Stuck: boolean,
}

local PlaneSim = {}
PlaneSim.__index = PlaneSim

-- ------------------------------------------------------------------ aerodynamics (mirrors plane.cjs)
local function aspectRatio(spec: any): number
	return spec.Wing.Span * spec.Wing.Span / spec.Wing.Area
end

function PlaneSim.LiftSlope(spec: any): number
	local ar = aspectRatio(spec)
	return 2 * math.pi * ar / (ar + 2)
end

function PlaneSim.StallAlpha(spec: any, flaps: number): number
	local w = spec.Wing
	return (w.ClMax + flaps * w.FlapsCl - (w.Cl0 + flaps * w.FlapsCl * 0.9)) / PlaneSim.LiftSlope(spec)
end

function PlaneSim.LiftCoefficient(spec: any, alpha: number, flaps: number): number
	local w = spec.Wing
	local clMax = w.ClMax + flaps * w.FlapsCl
	local cl0 = w.Cl0 + flaps * w.FlapsCl * 0.9
	local a = PlaneSim.LiftSlope(spec)
	local aPos = PlaneSim.StallAlpha(spec, flaps)
	local aNeg = (-0.8 * clMax - cl0) / a
	if alpha >= aNeg and alpha <= aPos then
		return cl0 + a * alpha
	end
	local over = if alpha > aPos then alpha - aPos else aNeg - alpha
	local peak = if alpha > aPos then clMax else -0.8 * clMax
	local fade = 1 - smoothstep(0.5, math.pi / 2 - math.abs(if alpha > aPos then aPos else aNeg), over)
	return lerp(peak, peak * w.PostStall, smoothstep(0, 0.12, over)) * fade
end

local function groundEffect(spec: any, h: number): number
	if not (h > 0) or h > 2 * spec.Wing.Span then
		return 1
	end
	local x = 16 * h / spec.Wing.Span
	return math.clamp(x * x / (1 + x * x), 0.2, 1)
end

local function dragCoefficient(spec: any, alpha: number, cl: number, flaps: number, gearDown: boolean, mach: number, ge: number): number
	local w = spec.Wing
	local stall = PlaneSim.StallAlpha(spec, flaps)
	local gearDrag = if gearDown and spec.Gear.Retractable then spec.Gear.Drag else 0
	return w.Cd0 * (1 + w.MachDragRise * smoothstep(0.85, 1.1, mach))
		+ flaps * w.FlapsCd
		+ gearDrag
		+ cl * cl / (math.pi * w.Oswald * aspectRatio(spec)) * ge
		+ 1.2 * math.sin(alpha) ^ 2 * smoothstep(stall, stall + 0.12, math.abs(alpha))
end

-- Engine thrust (N) at axial speed V for an engine state 0..1 (afterburner when ab).
function PlaneSim.Thrust(spec: any, V: number, state: number, rho: number, ab: boolean): number
	local e = spec.Engine
	if e.Type == "jet" then
		return (if ab and e.Afterburner > 0 then e.Afterburner else e.Thrust * state) * 1000 * (rho / RHO) ^ 0.7
	end
	local area = math.pi * (e.PropDiameter / 2) ^ 2
	local eta = SimUtil.PropEfficiency(e.StaticEfficiency, e.Efficiency, e.EfficiencySpeedKmh / 3.6, V)
	return SimUtil.DiskThrust(e.Power * 1000 * state * (rho / RHO), rho, area, V, eta)
end

function PlaneSim.StallSpeed(spec: any, flaps: number): number
	return math.sqrt(2 * spec.Mass * G / (RHO * spec.Wing.Area * (spec.Wing.ClMax + flaps * spec.Wing.FlapsCl)))
end

export type PlaneSim = typeof(setmetatable(
	{} :: {
		Kind: string,
		rig: SimUtil.Rig,
		spec: any,
		gear: Gear.Gear,
		lever: number,
		state: number,
		ab: boolean,
		flaps: number,
		flapsTarget: number,
		gearDown: boolean,
		qFull: number,
		alphaTrim: number,
		wow: number,
		prevAlpha: number?,
		prevAlphaCmd: number?,
		flipTimer: number,
	},
	PlaneSim
))

function PlaneSim.new(model: Model, spec: any): PlaneSim?
	local rig = SimUtil.Rig(model, spec)
	if not rig then
		return nil
	end
	local vs = PlaneSim.StallSpeed(spec, 0)
	local gearDownAttr = model:GetAttribute("GearDown")
	return setmetatable({
		Kind = "Plane",
		rig = rig,
		spec = spec,
		gear = Gear.new(rig, spec.Gear),
		lever = 0,
		state = 0,
		ab = false,
		flaps = 0,
		flapsTarget = 0,
		gearDown = gearDownAttr ~= false,
		qFull = 0.5 * RHO * (1.25 * vs) ^ 2,
		alphaTrim = (spec.Wing.ClMax / 1.96 - spec.Wing.Cl0) / PlaneSim.LiftSlope(spec),
		wow = 1,
		prevAlpha = nil,
		prevAlphaCmd = nil,
		flipTimer = 0,
	}, PlaneSim)
end

function PlaneSim.Recover(self: PlaneSim)
	-- Only on the ground: upright on its wheels.
	if self.wow > 0.2 or self.rig.root.AssemblyLinearVelocity.Magnitude < 4 then
		SimUtil.Recover(self.rig, self.spec.ComHeight / MPS + 1)
	end
end

function PlaneSim.Step(self: PlaneSim, dt: number, input: Input): Telemetry
	local spec = self.spec
	local w = spec.Wing
	local rig = self.rig
	local root = rig.root
	SimUtil.Begin(rig)
	local cf = root.CFrame
	local U, F, R = cf.UpVector, cf.LookVector, cf.RightVector
	local velocity = root.AssemblyLinearVelocity * MPS
	local V = velocity.Magnitude
	local altitude = root.Position.Y * MPS
	local rho = SimUtil.AirDensity(altitude)
	local q = 0.5 * rho * V * V
	local u, wv, sv = velocity:Dot(F), velocity:Dot(U), velocity:Dot(R)
	local alpha = if V > 0.5 then math.atan2(-wv, u) else 0
	local beta = if V > 0.5 then math.atan2(sv, math.sqrt(u * u + wv * wv)) else 0
	if input.Flaps ~= nil then
		self.flapsTarget = if input.Flaps then 1 else 0
	end
	self.flaps += math.clamp(self.flapsTarget - self.flaps, -dt / 2, dt / 2)
	if input.GearDown ~= nil and spec.Gear.Retractable then
		self.gearDown = input.GearDown
	end
	local pitchIn = math.clamp(input.Pitch, -1, 1)
	local rollIn = math.clamp(input.Roll, -1, 1)
	local yawIn = math.clamp(input.Yaw, -1, 1)

	-- Landing gear.
	local grounded, wowRaw = 0, 0
	if self.gearDown then
		local steerIn = math.clamp(yawIn + (if self.wow > 0.3 then rollIn else 0), -1, 1)
		grounded, wowRaw = self.gear:Step({
			dt = dt,
			steerDeg = steerIn * spec.Gear.SteerAngle * math.clamp(1 - V * 3.6 / 90, 0.15, 1),
			brake = if input.Brake then 1 else 0,
			hold = self.lever <= 0.02 and V < 1,
		})
	end
	self.wow = wowRaw
	local wow = math.clamp(wowRaw, 0, 1)

	-- Aerodynamic forces at the centre of mass.
	local below = Workspace:Raycast(root.Position, -Vector3.yAxis * (w.Span * 2 / MPS), rig.params)
	local ge = groundEffect(spec, if below then below.Distance * MPS else math.huge)
	local cl = PlaneSim.LiftCoefficient(spec, alpha, self.flaps)
	local cd = dragCoefficient(spec, alpha, cl, self.flaps, self.gearDown, V / 340, ge)
	local aero = Vector3.zero
	if V > 0.5 then
		local vHat = velocity.Unit
		local rPerp = R - vHat * R:Dot(vHat)
		local liftDir = if rPerp.Magnitude > 1e-3 then rPerp:Cross(vHat).Unit else U
		aero += liftDir * (q * w.Area * cl)
		local drag = q * w.Area * cd
		local limit = spec.Engine.SpeedLimitKmh / 3.6
		if limit > 0 and V > limit then
			drag += q * w.Area * w.Cd0 * 20 * (V / limit - 1) -- dives are capped too
		end
		aero -= vHat * drag
		aero -= R * (q * w.Area * w.CyBeta * beta)
	end
	-- Engine: the lever moves with Power; holding Power at full lights the afterburner.
	local engine = spec.Engine
	local power = math.clamp(input.Power, -1, 1)
	self.lever = math.clamp(self.lever + power * THROTTLE_RATE * dt, 0, 1)
	self.ab = engine.Type == "jet" and engine.Afterburner > 0 and self.lever >= 1 and power > 0.5
	local spool = dt / math.max(engine.Spool, 0.01)
	self.state += math.clamp(self.lever - self.state, -spool, spool)
	local thrust = PlaneSim.Thrust(spec, math.max(u, 0), self.state, rho, self.ab and self.state > 0.98)
	if engine.SpeedLimitKmh > 0 and V * 3.6 >= engine.SpeedLimitKmh then
		thrust = 0
	end
	aero += F * thrust
	SimUtil.AddForce(rig, aero)

	-- Control law (see header).
	local controls = spec.Controls
	local assists = spec.Assists
	local stall = PlaneSim.StallAlpha(spec, self.flaps)
	local slope = PlaneSim.LiftSlope(spec)
	local cl0 = w.Cl0 + self.flaps * w.FlapsCl * 0.9
	local thrustLift = thrust * math.sin(alpha) -- thrust tilted up by α carries part of the load
	local function alphaFor(n: number): number
		return if q > 1 then ((n * spec.Mass * G - thrustLift) / (q * w.Area) - cl0) / slope else stall
	end
	local bank = SimUtil.Bank(cf)
	local gamma = if V > 0.5 then math.asin(math.clamp(velocity.Y / V, -1, 1)) else 0
	local negStall = (-0.8 * (w.ClMax + self.flaps * w.FlapsCl) - cl0) / slope
	local alphaMax = math.min(lerp(stall + math.rad(10), 0.9 * stall, assists.StallProtection), math.max(alphaFor(controls.MaxG), 0))
	local alphaMin = math.max(alphaFor(controls.MinG), 0.92 * negStall)
	local nNeutral = math.clamp(math.cos(gamma) / math.max(math.cos(bank), 0.25) - PATH_LEVEL * assists.AutoLevel * math.sin(gamma), 0, controls.MaxG)
	local alphaNeutral = lerp(self.alphaTrim, math.clamp(alphaFor(nNeutral), alphaMin, alphaMax), assists.AutoTrim)
	alphaNeutral = lerp(alphaNeutral, alpha, wow) -- on the wheels: hold the ground attitude
	local alphaCmd = if pitchIn < 0
		then alphaNeutral - pitchIn * (alphaMax - alphaNeutral)
		else alphaNeutral - pitchIn * (alphaNeutral - alphaMin)
	local prevAlpha = self.prevAlpha
	local alphaRate = if prevAlpha then (alpha - prevAlpha) / dt else 0
	self.prevAlpha = alpha
	local lead = if alphaRate > 0 and alpha > 0.6 * alphaMax then ALPHA_LEAD * alphaRate else 0
	local prevCmd = self.prevAlphaCmd
	local cmdRate = if prevCmd then math.clamp((alphaCmd - prevCmd) / dt, -0.5, 0.5) else 0
	self.prevAlphaCmd = alphaCmd
	local maxPitch = math.rad(controls.PitchRate)
	local pitchRate = math.clamp(K_ALPHA * (alphaCmd - alpha - lead) + cmdRate, -maxPitch, maxPitch)
	local rollRate = rollIn * math.rad(controls.RollRate)
	if math.abs(rollIn) < 0.05 and assists.AutoLevel > 0 and math.abs(bank) < math.rad(75) then
		rollRate = -bank * LEVEL_GAIN * assists.AutoLevel
	end
	local betaCmd = -yawIn * math.rad(controls.MaxBeta)
	local yawRate = -K_BETA * math.max(assists.Coordination, 0.3) * (beta - betaCmd)
	-- The flight path's own turn rate, from this step's forces (gravity in, gear out).
	local pathRate = Vector3.zero
	if V > 1 then
		local accel = aero / spec.Mass - Vector3.yAxis * G
		pathRate = velocity.Unit:Cross(accel) / V * (1 - wow)
	end
	local target = pathRate + R * pitchRate + F * rollRate + U * yawRate
	local authority = math.clamp(q / self.qFull, 0.03, 1)
	SimUtil.TrackRates(rig, target, TRACK, Vector3.new(authority, authority * (1 - 0.9 * wow), authority * (1 - 0.95 * wow)))
	SimUtil.RealGravity(rig, G)

	-- Never stuck: upright when on its back on the ground and slow.
	if spec.Recovery.AutoFlip and U.Y < 0.3 and root.AssemblyLinearVelocity.Magnitude < 4 then
		self.flipTimer += dt
		if self.flipTimer > 2 then
			self.flipTimer = 0
			SimUtil.Recover(rig, spec.ComHeight / MPS + 1)
		end
	else
		self.flipTimer = 0
	end

	SimUtil.Finish(rig)
	return {
		Kind = "Plane",
		SpeedKmh = u * 3.6,
		AirspeedKmh = V * 3.6,
		Altitude = altitude,
		VerticalSpeed = velocity.Y,
		Alpha = math.deg(alpha),
		Beta = math.deg(beta),
		Bank = math.deg(bank),
		Throttle = self.lever,
		Afterburner = self.ab,
		Stall = math.abs(alpha) > stall and V > 3 and wow < 0.2,
		GLoad = aero:Dot(U) / spec.Mass / G,
		GearDown = self.gearDown,
		Flaps = self.flaps,
		Grounded = grounded,
		Stuck = false,
	}
end

-- Point-to-fly (War Thunder style): stick inputs that turn the plane toward a world direction.
-- Banks toward the target and pulls; good for mouse or touch when the stick is centred.
function PlaneSim.AimInput(self: PlaneSim, direction: Vector3): (number, number)
	local cf = self.rig.root.CFrame
	local local_ = cf:VectorToObjectSpace(direction.Unit)
	local forward = -local_.Z
	if forward > 0.999 then
		return 0, 0
	end
	-- Bank so the target is "above" the wings, then pull toward it.
	local wanted = math.atan2(local_.X, math.max(local_.Y, 0.05)) -- bank toward the target
	local bankErr = math.clamp(wanted, -math.rad(70), math.rad(70))
	if forward < 0.2 then
		bankErr = math.clamp(math.atan2(local_.X, local_.Y), -math.rad(90), math.rad(90))
	end
	local roll = math.clamp(bankErr * 2.5, -1, 1)
	local pitchUp = math.atan2(local_.Y, math.max(forward, 0.05))
	local pitch = -math.clamp(pitchUp * 4, -0.5, 1) -- negative = pull
	return pitch, roll
end

function PlaneSim.Destroy(self: PlaneSim)
	SimUtil.Clear(self.rig)
end

return PlaneSim
