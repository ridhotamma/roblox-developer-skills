--!strict
-- Helicopter physics for one aircraft built by VehicleService (Type = "Helicopter"). See
-- references/helicopter-physics.md.
--
-- Rotor thrust along the body's up axis (the cyclic tilt is the body tilt), in real gravity:
--   * available thrust T_max: the largest thrust whose power fits Engine.Power x rotor speed, by
--     momentum theory with Glauert's forward-flight inflow (translational lift falls out of it),
--     blade profile power with advance ratio, tail rotor share and the axial term T v (climb, and
--     the tilted disk pushing the fuselage through the air); x ground effect (Cheeseman-Bennett);
--     x a retreating-blade-stall loss past Rotor.BladeStallMu; x rotor speed²
--   * command: vertical-speed hold (Assists.AltitudeHold = 1, GTA-like) or a collective lever
--     with heave damping (0, sim-like); optional vortex ring state (Realism.VortexRing)
--   * fuselage drag per body axis; skids or wheels (Gear)
--   * attitude: stick sets target pitch / bank (Assists.Level = 1, returns to level) or rates (0);
--     stick released, Assists.HoverHold tilts against drift; pedals yaw, and at speed bank into a
--     coordinated turn (Assists.Coordination) while the tail fin weathervanes (Assists.Weathervane)
--   * the rotor spools up over Rotor.SpoolTime with a pilot aboard, down without one

local Workspace = game:GetService("Workspace")

local Gear = require(script.Parent.Gear)
local SimUtil = require(script.Parent.SimUtil)

local MPS = SimUtil.MPS
local G = SimUtil.G
local smoothstep = SimUtil.SmoothStep
local lerp = SimUtil.Lerp

local K_VS = 1.5 -- vertical-speed hold gain (1/s)
local K_ATT = 3 -- attitude hold: rate (1/s) per radian of error
local K_HOLD = 0.06 -- hover hold: radians of tilt per m/s of drift, times 4 x Assists.HoverHold
local HOLD_MAX = 20 -- degrees
local K_WV = 3 -- weathervane: yaw rate (1/s) per radian of sideslip, times Assists.Weathervane
local TRACK = Vector3.new(6, 5, 6) -- rate tracking (1/s): pitch, yaw, roll
local LEVER_RATE = 0.35 -- collective lever travel per second (no altitude hold)

export type Input = {
	Pitch: number, -- +1 = nose down (fly forward)
	Roll: number, -- +1 = bank right (strafe)
	Yaw: number, -- +1 = yaw right (pedals)
	Power: number, -- +1 = up (collective), -1 = down
	Engine: boolean?, -- false when nobody flies it: the rotor winds down
}

export type Telemetry = {
	Kind: string,
	SpeedKmh: number, -- forward ground speed
	AirspeedKmh: number,
	Altitude: number?, -- m above the ground under the rotor (nil past 1.5 rotor diameters)
	VerticalSpeed: number,
	RotorSpeed: number, -- 0..1
	PowerShare: number, -- thrust / available thrust
	GroundEffect: number,
	Pitch: number,
	Bank: number,
	Grounded: number,
	Stuck: boolean,
}

local HeliSim = {}
HeliSim.__index = HeliSim

-- ------------------------------------------------------------------ rotor (mirrors helicopter.cjs)
local function diskArea(spec: any): number
	return math.pi * (spec.Rotor.Diameter / 2) ^ 2
end

local function inducedVelocity(T: number, rho: number, A: number, vx: number, vz: number): number
	if T <= 0 then
		return 0
	end
	local vh2 = T / (2 * rho * A)
	local vh = math.sqrt(vh2)
	local vi = vh
	for _ = 1, 12 do
		local through = math.max(vz + vi, 0.25 * vh)
		vi = 0.5 * vi + 0.5 * vh2 / math.sqrt(vx * vx + through * through)
	end
	return vi
end

-- Shaft power (W) for thrust T with in-plane speed vx and axial speed vz (+ = climbing through it).
function HeliSim.PowerRequired(spec: any, T: number, rho: number, vx: number, vz: number): number
	local r = spec.Rotor
	local A = diskArea(spec)
	local mu = math.abs(vx) / r.TipSpeed
	local induced = r.InducedFactor * T * inducedVelocity(T, rho, A, vx, vz)
	local profile = r.Solidity * r.ProfileCd / 8 * rho * A * r.TipSpeed ^ 3 * (1 + 4.65 * mu * mu)
	return math.max(0, (induced + profile) * (1 + r.TailPower) + T * vz)
end

function HeliSim.MaxThrust(spec: any, rho: number, vx: number, vz: number, power: number): number
	if HeliSim.PowerRequired(spec, 0, rho, vx, vz) >= power then
		return 0
	end
	local lo, hi = 0, spec.Mass * G * 4
	for _ = 1, 20 do
		local mid = (lo + hi) / 2
		if HeliSim.PowerRequired(spec, mid, rho, vx, vz) > power then
			hi = mid
		else
			lo = mid
		end
	end
	return lo
end

local function groundEffect(spec: any, z: number?): number
	if z == nil then
		return 1
	end
	local R = spec.Rotor.Diameter / 2
	if z <= 0 then
		return 1 + 0.26 * spec.Realism.GroundEffect
	end
	local zz = math.max(z, 0.55 * R)
	return 1 + (1 / (1 - (R / (4 * zz)) ^ 2) - 1) * spec.Realism.GroundEffect
end

local function bladeStall(spec: any, mu: number): number
	local muStall = spec.Rotor.BladeStallMu
	return 1 - 0.6 * smoothstep(muStall, muStall + 0.1, mu)
end

export type HeliSim = typeof(setmetatable(
	{} :: {
		Kind: string,
		rig: SimUtil.Rig,
		spec: any,
		gear: Gear.Gear,
		hub: Attachment?,
		rotorSpeed: number,
		lever: number,
		wow: number,
		flipTimer: number,
	},
	HeliSim
))

function HeliSim.new(model: Model, spec: any): HeliSim?
	local rig = SimUtil.Rig(model, spec)
	if not rig then
		return nil
	end
	local rotorAttr = model:GetAttribute("RotorSpeed")
	return setmetatable({
		Kind = "Helicopter",
		rig = rig,
		spec = spec,
		gear = Gear.new(rig, spec.Gear),
		hub = rig.root:FindFirstChild("RotorHub") :: Attachment?,
		rotorSpeed = if typeof(rotorAttr) == "number" then rotorAttr else 0,
		lever = 0.5,
		wow = 1,
		flipTimer = 0,
	}, HeliSim)
end

function HeliSim.Recover(self: HeliSim)
	if self.wow > 0.2 or self.rig.root.AssemblyLinearVelocity.Magnitude < 4 then
		SimUtil.Recover(self.rig, self.spec.ComHeight / MPS + 1)
	end
end

function HeliSim.Step(self: HeliSim, dt: number, input: Input): Telemetry
	local spec = self.spec
	local rotor, controls, assists = spec.Rotor, spec.Controls, spec.Assists
	local rig = self.rig
	local root = rig.root
	SimUtil.Begin(rig)
	local cf = root.CFrame
	local U, F, R = cf.UpVector, cf.LookVector, cf.RightVector
	local velocity = root.AssemblyLinearVelocity * MPS
	local rho = SimUtil.AirDensity(root.Position.Y * MPS)
	local W = spec.Mass * G
	local spool = dt / math.max(rotor.SpoolTime, 0.01)
	self.rotorSpeed += math.clamp((if input.Engine == false then 0 else 1) - self.rotorSpeed, -spool, spool)
	local rs = self.rotorSpeed

	-- Available thrust.
	local vz = velocity:Dot(U)
	local vx = (velocity - U * vz).Magnitude
	local hub = if self.hub then self.hub.WorldPosition else root.Position + U * ((rotor.HubHeight - spec.ComHeight) / MPS)
	local below = Workspace:Raycast(hub, -Vector3.yAxis * (rotor.Diameter * 1.5 / MPS), rig.params)
	local z = if below then below.Distance * MPS else nil
	local ge = groundEffect(spec, z)
	local mu = vx / rotor.TipSpeed
	local tMax = HeliSim.MaxThrust(spec, rho, vx, vz, spec.Engine.Power * 1000) * rs * rs * ge * bladeStall(spec, mu)

	-- Command: vertical-speed hold or the collective lever.
	local power = math.clamp(input.Power, -1, 1)
	local vsCmd = if power >= 0 then power * controls.ClimbRate else power * controls.DescentRate
	local hold = spec.Mass * (G + K_VS * (vsCmd - velocity.Y)) / math.max(U.Y, 0.4)
	self.lever = math.clamp(self.lever + power * LEVER_RATE * dt, 0, 1)
	local raw = self.lever * tMax - rotor.HeaveDamping * spec.Mass * vz
	local thrust = math.clamp(lerp(raw, hold, assists.AltitudeHold), 0, tMax)
	if spec.Realism.VortexRing > 0 then
		local vh = math.sqrt(W / (2 * rho * diskArea(spec)))
		local descent = -velocity.Y / vh
		local severity = smoothstep(0.2, 0.7, descent) * (1 - smoothstep(0.9, 1.6, descent)) * (1 - smoothstep(0.3, 1, vx / vh))
		thrust *= 1 - 0.35 * severity * spec.Realism.VortexRing
	end
	SimUtil.AddForce(rig, U * thrust)

	-- Fuselage drag per body axis.
	local fuselage = spec.Fuselage
	local vf, vr = velocity:Dot(F), velocity:Dot(R)
	local drag = F * (-fuselage.DragArea * vf * math.abs(vf)) + R * (-fuselage.SideArea * vr * math.abs(vr)) + U * (-fuselage.TopArea * vz * math.abs(vz))
	SimUtil.AddForce(rig, drag * (0.5 * rho))

	-- Skids or wheels.
	local grounded, wowRaw = self.gear:Step({
		dt = dt,
		steerDeg = 0,
		brake = if power <= 0 then 1 else 0,
		hold = power <= 0 and velocity.Magnitude < 1,
	})
	self.wow = wowRaw
	local wow = math.clamp(wowRaw, 0, 1)

	-- Attitude.
	local pitch = SimUtil.Pitch(cf)
	local bank = SimUtil.Bank(cf)
	local flatF = SimUtil.Flat(F)
	local flatR = flatF:Cross(Vector3.yAxis)
	local vF, vR = velocity:Dot(flatF), velocity:Dot(flatR)
	local vH = math.sqrt(vF * vF + vR * vR)
	local pIn = math.clamp(input.Pitch, -1, 1)
	local rIn = math.clamp(input.Roll, -1, 1)
	local yIn = math.clamp(input.Yaw, -1, 1)
	local pitchTarget = -pIn * math.rad(controls.MaxPitch)
	local bankTarget = rIn * math.rad(controls.MaxBank)
	if math.abs(pIn) < 0.1 and math.abs(rIn) < 0.1 and assists.HoverHold > 0 then
		local maxHold = math.rad(HOLD_MAX)
		pitchTarget += math.clamp(vF * K_HOLD * assists.HoverHold * 4, -maxHold, maxHold)
		bankTarget -= math.clamp(vR * K_HOLD * assists.HoverHold * 4, -maxHold, maxHold)
	end
	local coordination = assists.Coordination * smoothstep(8, 20, vH)
	local pedal = yIn * math.rad(controls.YawRate)
	bankTarget += math.atan(vH * pedal / G) * coordination
	bankTarget = math.clamp(bankTarget, -math.rad(controls.MaxBank), math.rad(controls.MaxBank))
	local maxPitchRate, maxRollRate = math.rad(controls.PitchRate), math.rad(controls.RollRate)
	local qAtt = math.clamp(K_ATT * (pitchTarget - pitch), -maxPitchRate, maxPitchRate)
	local pAtt = math.clamp(K_ATT * (bankTarget - bank), -maxRollRate, maxRollRate)
	local qCmd = lerp(-pIn * maxPitchRate, qAtt, assists.Level)
	local pCmd = lerp(rIn * maxRollRate, pAtt, assists.Level)
	local beta = if vH > 1 then math.atan2(velocity:Dot(R), math.max(velocity:Dot(F), 0.1)) else 0
	local turn = if vH > 1 then G * math.tan(bank) / math.max(vH, 8) else 0
	local yawCmd = lerp(pedal, turn, coordination) + assists.Weathervane * K_WV * beta * smoothstep(5, 25, vH)
	local target = R * qCmd + F * pCmd - Vector3.yAxis * yawCmd
	local onSkids = wow > 0.05 and thrust < W * 0.9
	local attitude = if onSkids then 1 - wow else 1
	SimUtil.TrackRates(rig, target, TRACK, Vector3.new(attitude, if onSkids then 1 - 0.7 * wow else 1, attitude))
	SimUtil.RealGravity(rig, G)

	-- Never stuck: upright when on its side on the ground and slow.
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
		Kind = "Helicopter",
		SpeedKmh = vF * 3.6,
		AirspeedKmh = velocity.Magnitude * 3.6,
		Altitude = z,
		VerticalSpeed = velocity.Y,
		RotorSpeed = rs,
		PowerShare = thrust / math.max(tMax, 1),
		GroundEffect = ge,
		Pitch = math.deg(pitch),
		Bank = math.deg(bank),
		Grounded = grounded,
		Stuck = false,
	}
end

function HeliSim.Destroy(self: HeliSim)
	SimUtil.Clear(self.rig)
end

return HeliSim
