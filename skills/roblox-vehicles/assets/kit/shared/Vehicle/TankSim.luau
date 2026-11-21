--!strict
-- Tank physics for one tank built by VehicleService (Type = "Tank"). Runs on the driver's client
-- (the server while parked), like the other sims. Mirrors Tank in
-- examples/roblox-vehicles/lab/heavy.js. See references/tank-physics.md §9.
--
-- Per step:
--   * real gravity; each track is sampled at Tracks.Contacts sphere-cast springs plus a raised
--     idler and sprocket at the hull ends (rigid past full compression, so the track climbs steps)
--   * the sticks set track speeds like a steering unit: v = throttle × MaxSpeed, a yaw rate from
--     PivotRate at a standstill down to MaxLateralG g / v at speed, v_L,R = v ± r B / 2; each track
--     is driven toward its speed within traction (MaxTractiveG), brakes (DecelG) and the engine's
--     net power η P (regenerative steering: the braked inner track feeds the outer one)
--   * per contact: its share of its track's force, rolling resistance, lateral friction, all inside
--     the friction circle; the skid-steer turning moment μ W L / 4 emerges from the front and rear
--     of the tracks sliding opposite ways
--   * off the throttle the track speed falls at 0.15 g (engine braking); stopped, the brakes hold
--   * turret and gun turn toward a world direction (the camera) at their rates: stabilised
--   * firing puts the recoil impulse (Gun.Recoil kN·s) into the hull at the trunnion
--   * never stuck: stuck assist (not against walls), auto-upright, Reset

local Workspace = game:GetService("Workspace")

local SimUtil = require(script.Parent.SimUtil)

local MPS = SimUtil.MPS
local G = SimUtil.G
local RHO = SimUtil.RHO_AIR
local smoothstep = SimUtil.SmoothStep

local CAST_RADIUS = 0.85
local WALL_NORMAL = 0.35
local STOP_GAIN = 0.5
local K_TRACK = 60 -- track speed control gain (1/s)
local COAST_G = 0.15 -- engine braking off the throttle (g)
local BUMP = 4 -- bump stop rate past full compression (× spring rate)
local CONTACT_MAX = 0.5 -- most one contact can push (× the tank's weight)
local ESC_GAIN = 6
local HOLD_MS = 0.5
local AIR_LEVEL, AIR_MAX, AIR_DAMP = 2, 1, 8
local IDLE = 0.2 -- engine state at idle (spools to 1 over Engine.Spool)

export type Input = {
	Throttle: number,
	Steer: number, -- + = turn right; pivots on the spot when stopped
	Aim: Vector3?, -- world direction for the turret and gun (the camera's)
	Fire: boolean?,
}

export type Telemetry = {
	Kind: string,
	SpeedKmh: number,
	TrackLeft: number, -- km/h
	TrackRight: number,
	YawRate: number, -- deg/s, + = right
	TurretYaw: number, -- degrees from the hull's nose, + = right
	GunPitch: number, -- degrees, + = up
	Reload: number, -- seconds until the gun can fire
	Fired: boolean, -- fired this step
	GunDirection: Vector3,
	Trunnion: Vector3, -- world point the gun pivots about
	Grounded: number,
	Stuck: boolean,
	Pitch: number,
	Roll: number,
}

type Contact = {
	mount: Attachment,
	left: boolean,
	radius: number,
	k: number,
	c: number,
	restLength: number,
	staticForce: number,
	cornerMassKg: number,
	length: number,
	grounded: boolean,
	hit: RaycastResult?,
	springForce: number,
}

local TankSim = {}
TankSim.__index = TankSim

export type TankSim = typeof(setmetatable(
	{} :: {
		Kind: string,
		rig: SimUtil.Rig,
		spec: any,
		contacts: { Contact },
		state: number,
		coastV: number,
		turretYaw: number,
		gunPitch: number,
		reload: number,
		flipTimer: number,
		stuckTimer: number,
		unstickUntil: number,
	},
	TankSim
))

function TankSim.new(model: Model, spec: any): TankSim?
	local rig = SimUtil.Rig(model, spec)
	if not rig then
		return nil
	end
	local root = rig.root
	local mounts: { Attachment } = {}
	local perSide = 0
	for _, mount in root:GetChildren() do
		if mount:IsA("Attachment") and mount:GetAttribute("TrackContact") then
			table.insert(mounts, mount)
			if mount:GetAttribute("End") ~= true and mount:GetAttribute("Left") == true then
				perSide += 1
			end
		end
	end
	if perSide == 0 then
		return nil
	end
	local suspension = spec.Suspension
	local staticLength = suspension.MaxLength * suspension.RideHeight
	local cornerMass = root.AssemblyMass / (2 * perSide)
	local k, c = SimUtil.Spring(cornerMass, suspension.Frequency, suspension.DampingRatio)
	local staticForce = cornerMass * (G / MPS)
	local contacts: { Contact } = {}
	for _, mount in mounts do
		table.insert(contacts, {
			mount = mount,
			left = mount:GetAttribute("Left") == true,
			radius = mount:GetAttribute("Radius") :: number,
			k = k,
			c = c,
			restLength = staticLength + staticForce / k,
			staticForce = staticForce,
			cornerMassKg = spec.Mass / (2 * perSide),
			length = staticLength,
			grounded = false,
			hit = nil,
			springForce = 0,
		})
	end
	return setmetatable({
		Kind = "Tank",
		rig = rig,
		spec = spec,
		contacts = contacts,
		state = IDLE,
		coastV = 0,
		turretYaw = math.rad((model:GetAttribute("TurretYaw") :: number?) or 0),
		gunPitch = math.rad((model:GetAttribute("GunPitch") :: number?) or 0),
		reload = 0,
		flipTimer = 0,
		stuckTimer = 0,
		unstickUntil = 0,
	}, TankSim)
end

function TankSim.Recover(self: TankSim)
	SimUtil.Recover(self.rig, self.spec.ComHeight / MPS + 1.5)
end

function TankSim.Step(self: TankSim, dt: number, input: Input): Telemetry
	local spec = self.spec
	local tracks, engine, steering = spec.Tracks, spec.Engine, spec.Steering
	local rig = self.rig
	local root = rig.root
	SimUtil.Begin(rig)
	local cf = root.CFrame
	local up, forward, right = cf.UpVector, cf.LookVector, cf.RightVector
	local velocity = root.AssemblyLinearVelocity * MPS
	local flatF = SimUtil.Flat(forward)
	local vF = velocity:Dot(flatF)
	local yawRate = -root.AssemblyAngularVelocity.Y -- + = turning right
	local throttle = math.clamp(input.Throttle, -1, 1)
	local steer = math.clamp(input.Steer, -1, 1)
	local weight = spec.Mass * G
	local active = math.abs(throttle) > 0.05 or math.abs(steer) > 0.05
	self.state += math.clamp((if active then 1 else IDLE) - self.state, -dt / engine.Spool, dt / engine.Spool)

	-- Track speeds, like a steering unit: a forward speed and a yaw rate. Off the throttle it coasts
	-- down at COAST_G (engine braking and track losses), uphill or down, then the brakes hold.
	local coasting = math.abs(throttle) <= 0.05
	self.coastV = if coasting then math.sign(self.coastV) * math.max(math.abs(self.coastV) - COAST_G * G * dt, 0) else vF
	local vCmd = if coasting
		then self.coastV
		elseif throttle > 0 then throttle * engine.MaxSpeedKmh / 3.6
		else throttle * engine.ReverseSpeedKmh / 3.6
	local atSpeed = math.min(math.rad(steering.TurnRate), steering.MaxLateralG * G / math.max(math.abs(vF), 1))
	local rMax = math.rad(steering.PivotRate) + (atSpeed - math.rad(steering.PivotRate)) * smoothstep(0, 4, math.abs(vF))
	local rCmd = steer * rMax
	local tread = tracks.Tread
	local cmd = { vCmd + rCmd * tread / 2, vCmd - rCmd * tread / 2 } -- left, right
	local measured = { vF + yawRate * tread / 2, vF - yawRate * tread / 2 }
	local holding = not active and math.abs(vF) < HOLD_MS
	local sideDrive = engine.MaxTractiveG * weight / 2 * self.state
	local sideBrake = spec.Brakes.DecelG * weight / 2
	local force = { 0, 0 }
	for i = 1, 2 do
		local f = K_TRACK * (spec.Mass / 2) * (cmd[i] - measured[i])
		local driving = math.sign(f) == math.sign(measured[i]) or math.abs(measured[i]) < 0.3
		force[i] = if driving then math.clamp(f, -sideDrive, sideDrive) else math.clamp(f, -sideBrake, sideBrake)
	end
	-- Net power within η P: the braked inner track's power goes to the outer one (regenerative
	-- steering), so only the driving side is scaled back.
	local pMax = engine.Efficiency * engine.Power * 1000 * self.state
	local pDrive = math.max(0, force[1] * measured[1]) + math.max(0, force[2] * measured[2])
	local pNet = force[1] * measured[1] + force[2] * measured[2]
	if pNet > pMax and pDrive > 0 then
		local scale = math.clamp(1 - (pNet - pMax) / pDrive, 0, 1)
		for i = 1, 2 do
			if force[i] * measured[i] > 0 then
				force[i] *= scale
			end
		end
	end
	if holding then
		force = { 0, 0 }
	end

	-- Suspension: sphere casts, springs, a stiff bump stop past full compression.
	local maxLength = spec.Suspension.MaxLength
	local grounded = 0
	local sideCount = { 0, 0 }
	local contactMax = CONTACT_MAX * root.AssemblyMass * (G / MPS)
	for _, p in self.contacts do
		local castRadius = p.radius * CAST_RADIUS
		local inset = p.radius - castRadius
		local lift = p.radius
		local hit = Workspace:Spherecast(p.mount.WorldPosition + up * lift, castRadius, -up * (maxLength + inset + lift), rig.params)
		if hit and hit.Normal:Dot(up) < WALL_NORMAL then
			hit = nil
		end
		p.hit = hit
		if not hit then
			p.grounded, p.length, p.springForce = false, maxLength, 0
			continue
		end
		local raw = hit.Distance - inset - lift
		local length = math.clamp(raw, 0, maxLength)
		local f = p.k * (p.restLength - length) + p.c * ((p.length - length) / dt)
		if raw < 0 then
			f += p.k * BUMP * -raw
		end
		p.springForce = math.clamp(f, 0, contactMax)
		p.length, p.grounded = length, true
		grounded += 1
		local side = if p.left then 1 else 2
		sideCount[side] += 1
	end

	-- Track forces per contact: drive share, rolling resistance, lateral friction; gravity's pull
	-- along the ground is part of what friction stops (no creep on slopes).
	for _, p in self.contacts do
		local hit = p.hit
		if not (p.grounded and hit) then
			continue
		end
		local n = hit.Normal
		local load = p.cornerMassKg * G * math.clamp(p.springForce / p.staticForce, 0, 4)
		SimUtil.AddForceRoblox(rig, n * p.springForce, hit.Position)
		local along = forward - n * forward:Dot(n)
		local tf = if along.Magnitude > 1e-6 then along.Unit else flatF
		local tr = tf:Cross(n)
		local contactVelocity = root:GetVelocityAtPosition(hit.Position) * MPS
		local longMs, latMs = contactVelocity:Dot(tf), contactVelocity:Dot(tr)
		local stop = p.cornerMassKg / dt * STOP_GAIN
		local grip, latGrip = tracks.Grip * load, tracks.LateralGrip * load
		local latF = math.clamp(-stop * latMs + load * tr.Y, -latGrip, latGrip)
		local longF
		if holding then
			local hold = spec.Brakes.DecelG * load * 2
			longF = math.clamp(-stop * longMs + load * tf.Y, -hold, hold)
		else
			local side = if p.left then 1 else 2
			longF = force[side] / math.max(sideCount[side], 1)
			longF -= math.sign(longMs) * math.min(tracks.RollingResistance * load, stop * math.abs(longMs))
		end
		local total = math.sqrt(longF * longF + latF * latF)
		if total > grip and total > 0 then
			longF *= grip / total
			latF *= grip / total
		end
		SimUtil.AddForce(rig, tf * longF + tr * latF, hit.Position)
	end

	local inertia = SimUtil.Inertia(rig)
	if grounded > 0 then
		-- Stability assist: yaw beyond what the sticks ask for.
		if spec.Assists.Stability > 0 and math.abs(vF) > 1 then
			local over = yawRate - math.clamp(yawRate, math.min(0, rCmd), math.max(0, rCmd))
			SimUtil.AddTorqueRoblox(rig, Vector3.yAxis * (over * ESC_GAIN * spec.Assists.Stability * inertia.Y))
		end
	else
		-- In the air: level out gently.
		local rate = up:Cross(Vector3.yAxis) * AIR_LEVEL
		if rate.Magnitude > AIR_MAX then
			rate = rate.Unit * AIR_MAX
		end
		local angular = root.AssemblyAngularVelocity
		SimUtil.TrackRates(rig, Vector3.new(rate.X, angular.Y, rate.Z), Vector3.new(AIR_DAMP, 0, AIR_DAMP), Vector3.new(1, 0, 1))
	end
	SimUtil.RealGravity(rig, G)
	local speed = velocity.Magnitude
	if speed > 0.1 then
		SimUtil.AddForce(rig, velocity.Unit * (-0.5 * RHO * spec.Aero.Cd * spec.Aero.Area * speed * speed))
	end

	-- Never stuck: throttle held without moving -> a lift and a push (not against a wall, which it
	-- would only climb); on its side or roof -> upright.
	local now = os.clock()
	local stuck = false
	local blocked = false
	if math.abs(throttle) > 0.5 then
		local wall = Workspace:Spherecast(root.Position, 1, flatF * math.sign(throttle) * (spec.Length / 2 / MPS + 2), rig.params)
		blocked = wall ~= nil and wall.Normal.Y < WALL_NORMAL
	end
	if spec.Recovery.StuckAssist and math.abs(throttle) > 0.5 and not blocked and speed < 0.3 and now >= self.unstickUntil then
		self.stuckTimer += dt
	elseif speed > 1 then
		self.stuckTimer = 0
	end
	if self.stuckTimer > 1.5 then
		self.stuckTimer = 0
		self.unstickUntil = now + 0.5
	end
	if now < self.unstickUntil then
		stuck = true
		SimUtil.AddForce(rig, Vector3.yAxis * (0.5 * weight) + flatF * (math.sign(throttle) * 0.4 * weight))
	end
	if spec.Recovery.AutoFlip and up.Y < 0.3 and root.AssemblyLinearVelocity.Magnitude < 4 then
		self.flipTimer += dt
		if self.flipTimer > 1.5 then
			self.flipTimer = 0
			self:Recover()
		end
	else
		self.flipTimer = 0
	end

	-- Turret and gun: turn toward the aim (a world direction) at their rates, so they hold it in
	-- space while the hull pitches and turns.
	local turret = spec.Turret
	if input.Aim and input.Aim.Magnitude > 1e-3 then
		local l = cf:VectorToObjectSpace(input.Aim.Unit)
		local yawTarget = math.atan2(l.X, -l.Z)
		local pitchTarget = math.clamp(math.atan2(l.Y, math.sqrt(l.X * l.X + l.Z * l.Z)), math.rad(turret.MinElevation), math.rad(turret.MaxElevation))
		local traverse = math.rad(turret.TraverseRate) * dt
		local dYaw = math.atan2(math.sin(yawTarget - self.turretYaw), math.cos(yawTarget - self.turretYaw))
		self.turretYaw += math.clamp(dYaw, -traverse, traverse)
		self.turretYaw = math.atan2(math.sin(self.turretYaw), math.cos(self.turretYaw))
		local elevate = math.rad(turret.ElevationRate) * dt
		self.gunPitch += math.clamp(pitchTarget - self.gunPitch, -elevate, elevate)
	end
	local turretRotation = CFrame.fromAxisAngle(up, -self.turretYaw)
	local turretRight = turretRotation:VectorToWorldSpace(right)
	local gunDirection = CFrame.fromAxisAngle(turretRight, self.gunPitch):VectorToWorldSpace(turretRotation:VectorToWorldSpace(forward))
	local trunnion = root.Position + up * ((turret.Height - spec.ComHeight) / MPS)
	self.reload = math.max(0, self.reload - dt)
	local fired = false
	if input.Fire and self.reload <= 0 then
		fired = true
		self.reload = spec.Gun.Reload
		SimUtil.AddForce(rig, gunDirection * (-spec.Gun.Recoil * 1000 / dt), trunnion)
	end

	SimUtil.Finish(rig)
	return {
		Kind = "Tank",
		SpeedKmh = vF * 3.6,
		TrackLeft = measured[1] * 3.6,
		TrackRight = measured[2] * 3.6,
		YawRate = math.deg(yawRate),
		TurretYaw = math.deg(self.turretYaw),
		GunPitch = math.deg(self.gunPitch),
		Reload = self.reload,
		Fired = fired,
		GunDirection = gunDirection,
		Trunnion = trunnion,
		Grounded = grounded,
		Stuck = stuck,
		Pitch = math.deg(SimUtil.Pitch(cf)),
		Roll = math.deg(SimUtil.Bank(cf)),
	}
end

function TankSim.Destroy(self: TankSim)
	SimUtil.Clear(self.rig)
end

return TankSim
