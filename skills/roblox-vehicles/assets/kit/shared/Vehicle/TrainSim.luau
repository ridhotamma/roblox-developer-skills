--!strict
-- Train physics for one train built by VehicleService (Type = "Train"): a lead vehicle (the
-- model's ChassisRoot) and its cars (Car1, Car2 ... each its own assembly with its own root).
-- Runs on the driver's client (the server while parked). Mirrors Train in
-- examples/roblox-vehicles/lab/heavy.js. See references/train-physics.md §8.
--
-- On the track the consist is one longitudinal body:
--   M dv/dt = TE - brakes - Σ cars m g (Rolling + Speed |v| + grade + curve) - ½ ρ CdA v²
--   TE = power lever × min(starting effort, adhesion × loco weight, η P / |v|)
-- The power lever notches up at Controls.NotchRate, the brake lever applies over a second, and a
-- stopped train with no input holds on its brakes. Every car is pulled onto its place on the track
-- (the chord between its bogies, raised by ComHeight, rolled by the cant) by a stiff PD force with
-- gravity and track-acceleration feed-forward, and turned onto it by rate tracking; anything on the
-- line gets shoved by real contacts. A car whose unbalanced lateral acceleration v²/R - g tan(cant)
-- passes Derail.LateralG derails the train: every car flies on with its velocity and real gravity.
-- Recover (Reset) puts it back on the rails at the nearest point, stopped.

local Workspace = game:GetService("Workspace")

local SimUtil = require(script.Parent.SimUtil)
local TrainTrack = require(script.Parent.TrainTrack)

local MPS = SimUtil.MPS
local G = SimUtil.G
local RHO = SimUtil.RHO_AIR

local PD_W, PD_Z = 12, 1 -- car position tracking: natural frequency (rad/s), damping ratio
local ROT_K, ROT_TRACK = 8, 20 -- car orientation: rate per radian of error (1/s), rate tracking (1/s)
local RELEASE = 2 -- lever release per second
local BRAKE_RATE = 1 -- brake application per second
local HOLD_MS = 0.3 -- below this the train counts as stopped
local TIP = 0.8 -- rad/s outward roll given to each car as it derails
local OFF_TRACK = 4 -- studs: a lead this far from its track starts derailed

export type Input = {
	Throttle: number, -- W power (S brakes; S when stopped reverses)
	Handbrake: boolean, -- emergency brake
}

export type Telemetry = {
	Kind: string,
	SpeedKmh: number, -- + = forward
	Power: number, -- power lever 0..1
	Brake: number, -- brake lever 0..1 (1 in emergency)
	Reverse: boolean,
	Grade: number, -- percent, + = uphill ahead
	RadiusM: number,
	SpeedLimit: number, -- km/h from the track, 0 = none
	Wheelslip: boolean,
	Derailed: boolean,
	OnTrack: boolean,
	Grounded: number,
	Stuck: boolean,
}

type Car = { rig: SimUtil.Rig, offset: number, half: number, massKg: number }
type Pose = { position: Vector3, forward: Vector3, up: Vector3, right: Vector3, sample: TrainTrack.Sample }

local TrainSim = {}
TrainSim.__index = TrainSim

export type TrainSim = typeof(setmetatable(
	{} :: {
		Kind: string,
		model: Model,
		spec: any,
		cars: { Car },
		totalMass: number,
		carCount: number,
		track: TrainTrack.Track?,
		s: number,
		dir: number,
		v: number,
		accel: number,
		power: number,
		brake: number,
		reverser: number,
		derailed: boolean,
		wheelslip: boolean,
		connection: RBXScriptConnection?,
	},
	TrainSim
))

-- Röckl curve resistance per unit weight (N/N) for a radius in metres (train.cjs curveResistance).
function TrainSim.CurveResistance(radiusM: number): number
	if not (radiusM > 0) or radiusM > 1e5 then
		return 0
	end
	local r = math.max(radiusM, 35)
	return (if r >= 300 then 650 / (r - 55) else 500 / (r - 30)) / 1000
end

function TrainSim.new(model: Model, spec: any): TrainSim?
	local rig = SimUtil.Rig(model, spec)
	if not rig then
		return nil
	end
	local root = rig.root
	local leadHalf = root:GetAttribute("BogieHalf")
	local cars: { Car } = {
		{ rig = rig, offset = 0, half = if typeof(leadHalf) == "number" then leadHalf else spec.BogieSpacing / 2 / MPS, massKg = spec.Mass },
	}
	local folder = root:FindFirstChild("Cars")
	if folder then
		local links = folder:GetChildren()
		table.sort(links, function(a, b)
			return ((a:GetAttribute("Index") :: number?) or 0) < ((b:GetAttribute("Index") :: number?) or 0)
		end)
		for _, link in links do
			local carRoot = if link:IsA("ObjectValue") then link.Value else nil
			if carRoot and carRoot:IsA("BasePart") and carRoot.Parent and carRoot.Parent:IsA("Model") then
				local massKg = (link:GetAttribute("MassKg") :: number?) or spec.Cars.Mass
				local carRig = SimUtil.RootRig(carRoot.Parent, carRoot, { Mass = massKg })
				if carRig then
					table.insert(cars, {
						rig = carRig,
						offset = (link:GetAttribute("Offset") :: number?) or 0,
						half = (link:GetAttribute("BogieHalf") :: number?) or spec.Cars.BogieSpacing / 2 / MPS,
						massKg = massKg,
					})
				end
			end
		end
	end
	local total = 0
	for _, car in cars do
		total += car.massKg
	end
	local self = setmetatable({
		Kind = "Train",
		model = model,
		spec = spec,
		cars = cars,
		totalMass = total,
		carCount = #cars - 1,
		track = nil :: TrainTrack.Track?,
		s = 0,
		dir = 1,
		v = 0,
		accel = 0,
		power = 0,
		brake = 1,
		reverser = 1,
		derailed = false,
		wheelslip = false,
		connection = nil :: RBXScriptConnection?,
	}, TrainSim)
	self:attach(true)
	-- Switches: setting the model's Track attribute moves the train onto that track where it is.
	self.connection = model:GetAttributeChangedSignal("Track"):Connect(function()
		self:attach(false)
	end)
	return self
end

-- Finds the track (attribute Track, or the nearest) and where on it the lead is.
function TrainSim.attach(self: TrainSim, fresh: boolean)
	local root = self.cars[1].rig.root
	local name = self.model:GetAttribute("Track")
	local track = TrainTrack.Find(if typeof(name) == "string" then name else nil, root.Position)
	self.track = track
	if not track then
		warn(`[TrainSim] {self.model:GetFullName()}: no TrainTrack (tag "TrainTrack") to run on`)
		return
	end
	local s, distance = track:Nearest(root.Position)
	local sample = track:Sample(s)
	self.s = s
	self.dir = if root.CFrame.LookVector:Dot(sample.Tangent) >= 0 then 1 else -1
	if fresh then
		self.v = root.AssemblyLinearVelocity:Dot(sample.Tangent * self.dir) * MPS
		self.derailed = distance > OFF_TRACK
	end
end

-- Where a car belongs: the chord between its bogies, raised by ComHeight, rolled by the cant.
function TrainSim.pose(self: TrainSim, car: Car): Pose
	local track = self.track :: TrainTrack.Track
	local d = self.dir
	local si = self.s - d * car.offset
	local f, r, c = track:Sample(si + d * car.half), track:Sample(si - d * car.half), track:Sample(si)
	local chord = f.Position - r.Position
	local forward = if chord.Magnitude > 1e-6 then chord.Unit else c.Tangent * d
	local up = (c.Up - forward * c.Up:Dot(forward)).Unit
	return {
		position = (f.Position + r.Position) / 2 + up * (self.spec.ComHeight / MPS),
		forward = forward,
		up = up,
		right = forward:Cross(up),
		sample = c,
	}
end

-- Every car onto its place, moving with the train.
function TrainSim.placeCars(self: TrainSim)
	if not self.track then
		return
	end
	local vS = self.v / MPS
	for _, car in self.cars do
		local pose = self:pose(car)
		local root = car.rig.root
		root.CFrame = CFrame.fromMatrix(pose.position, pose.right, pose.up, -pose.forward)
		root.AssemblyLinearVelocity = pose.forward * vS
		root.AssemblyAngularVelocity = Vector3.yAxis * (pose.sample.Curvature * self.dir * vS)
		car.rig.prevV = nil
	end
end

-- Back on the rails at the nearest point, stopped.
function TrainSim.Recover(self: TrainSim)
	self:attach(false)
	if not self.track then
		return
	end
	self.v, self.accel, self.power, self.brake = 0, 0, 0, 1
	self.derailed = false
	self:placeCars()
end

-- Off the rails: every car flies on with its velocity and tips toward the outside of the curve.
function TrainSim.derail(self: TrainSim)
	self.derailed = true
	local track = self.track :: TrainTrack.Track
	for _, car in self.cars do
		local c = track:Sample(self.s - self.dir * car.offset)
		if math.abs(c.Curvature) > 1e-9 then
			local root = car.rig.root
			local outward = Vector3.yAxis:Cross(c.Tangent).Unit * -math.sign(c.Curvature)
			root.AssemblyAngularVelocity += root.CFrame.UpVector:Cross(outward).Unit * TIP
		end
	end
end

function TrainSim.Step(self: TrainSim, dt: number, input: Input): Telemetry
	local spec = self.spec
	local engine = spec.Engine
	local track = self.track
	local throttle = math.clamp(input.Throttle, -1, 1)
	local emergency = input.Handbrake == true

	-- Levers: W notches power up (brakes first if rolling backward); S brakes, or powers in reverse
	-- once stopped. Power notches up at NotchRate, brakes apply at BRAKE_RATE, both release quickly.
	local driveCmd, brakeCmd = 0, 0
	if throttle > 0.05 then
		if self.v < -HOLD_MS then
			brakeCmd = throttle
		else
			self.reverser = 1
			driveCmd = throttle
		end
	elseif throttle < -0.05 then
		if self.v > HOLD_MS then
			brakeCmd = -throttle
		else
			self.reverser = -1
			driveCmd = -throttle
		end
	end
	self.power += math.clamp(driveCmd - self.power, -RELEASE * dt, spec.Controls.NotchRate * dt)
	self.brake += math.clamp(brakeCmd - self.brake, -RELEASE * dt, BRAKE_RATE * dt)
	if math.abs(throttle) <= 0.05 and math.abs(self.v) < HOLD_MS then
		self.brake = 1 -- standing brake
	end

	local mass = self.totalMass
	local weight = mass * G
	if track and not self.derailed then
		-- Tractive effort: starting limit, adhesion, power; nothing past the speed limit.
		local limit = if self.reverser > 0 then engine.SpeedLimitKmh else engine.ReverseSpeedKmh
		local start = engine.StartingTractiveEffort * 1000
		local adhesion = engine.Adhesion * spec.Mass * G
		local te = self.power * math.min(start, adhesion, engine.Efficiency * engine.Power * 1000 / math.max(math.abs(self.v), 0.1))
		if limit > 0 then
			te *= math.clamp((limit - math.abs(self.v) * 3.6) / 2, 0, 1)
		end
		self.wheelslip = self.power > 0.5 and start > adhesion and math.abs(self.v) * 3.6 < 15
		local net = te * self.reverser

		-- Grade and curve, per car at its own position; Davis resistance and air for the consist.
		local curve = 0
		for _, car in self.cars do
			local c = track:Sample(self.s - self.dir * car.offset)
			net -= car.massKg * G * c.Grade * self.dir
			curve += car.massKg * G * TrainSim.CurveResistance(c.RadiusM)
		end
		local r = spec.Resistance
		local cdA = r.CdA + self.carCount * spec.Cars.CdA
		local resist = weight * (r.Rolling / 1000 + r.Speed / 1000 * math.abs(self.v)) + curve + 0.5 * RHO * cdA * self.v * self.v
		local brakeForce = math.min((if emergency then spec.Brakes.Emergency else spec.Brakes.Service * self.brake) * mass, spec.Brakes.Adhesion * weight)
		local opposing = resist + brakeForce
		if math.abs(self.v) < 0.05 and math.abs(net) <= opposing then
			self.v, self.accel = 0, 0
		else
			local sign = if math.abs(self.v) > 1e-6 then math.sign(self.v) else math.sign(net)
			local a = (net - sign * opposing) / mass
			local v2 = self.v + a * dt
			self.v = if math.sign(v2) ~= sign and math.abs(net) <= opposing then 0 else v2
			self.accel = a
		end

		-- Along the track; the ends of a line are buffer stops.
		local s2 = self.s + self.dir * self.v * dt / MPS
		if not track.Loop and (s2 < 0 or s2 > track.Length) then
			s2 = math.clamp(s2, 0, track.Length)
			self.v = 0
		end
		self.s = track:Wrap(s2)

		-- Derailment: unbalanced lateral acceleration of any car past Derail.LateralG.
		if spec.Derail.Enabled then
			for _, car in self.cars do
				local c = track:Sample(self.s - self.dir * car.offset)
				local canted = if math.sign(c.Cant) == math.sign(c.Curvature) then 1 else -1
				local lateral = self.v * self.v * math.abs(c.Curvature / MPS) - G * math.tan(math.abs(c.Cant)) * canted
				if lateral > spec.Derail.LateralG * G then
					self:derail()
					break
				end
			end
		end
	end

	-- Each car: pulled onto its place on the track, or free with real gravity when derailed.
	local w2, damp = PD_W * PD_W, 2 * PD_Z * PD_W
	local vS = self.v / MPS -- studs/s along the train
	local onTrack = track ~= nil and not self.derailed
	for _, car in self.cars do
		local rig = car.rig
		local root = rig.root
		SimUtil.Begin(rig)
		if not onTrack then
			SimUtil.RealGravity(rig, G)
			SimUtil.Finish(rig)
			continue
		end
		local pose = self:pose(car)
		local c = pose.sample
		local m = root.AssemblyMass
		local velocity = root.AssemblyLinearVelocity
		local left = Vector3.yAxis:Cross(c.Tangent).Unit
		local feedForward = pose.forward * (self.accel / MPS) + left * (vS * vS * c.Curvature)
		-- Error against where the car will be after this step, so it arrives on its place.
		local err = pose.position - (rig.com + velocity * dt)
		local vErr = pose.forward * vS - velocity
		SimUtil.AddForceRoblox(rig, (err * w2 + vErr * damp + feedForward) * m)
		SimUtil.AddForceRoblox(rig, Vector3.yAxis * m * Workspace.Gravity)
		local cf = root.CFrame
		local rotErr = (cf.LookVector:Cross(pose.forward) + cf.UpVector:Cross(pose.up) + cf.RightVector:Cross(pose.right)) * 0.5
		local turn = Vector3.yAxis * (c.Curvature * self.dir * vS)
		SimUtil.TrackRates(rig, turn + rotErr * ROT_K, Vector3.one * ROT_TRACK, Vector3.one)
		SimUtil.Finish(rig)
	end

	local lead = if track then track:Sample(self.s) else nil
	return {
		Kind = "Train",
		SpeedKmh = if onTrack then self.v * 3.6 else self.cars[1].rig.root.AssemblyLinearVelocity.Magnitude * MPS * 3.6,
		Power = self.power,
		Brake = if emergency then 1 else self.brake,
		Reverse = self.reverser < 0,
		Grade = if lead then lead.Grade * self.dir * 100 else 0,
		RadiusM = if lead then lead.RadiusM else math.huge,
		SpeedLimit = if lead then lead.SpeedLimit else 0,
		Wheelslip = self.wheelslip,
		Derailed = self.derailed or track == nil,
		OnTrack = onTrack,
		Grounded = 1,
		Stuck = false,
	}
end

function TrainSim.Destroy(self: TrainSim)
	if self.connection then
		self.connection:Disconnect()
		self.connection = nil
	end
	for _, car in self.cars do
		SimUtil.Clear(car.rig)
	end
end

return TrainSim
