--!strict
-- Landing gear and skids for planes and helicopters: a sphere-cast spring per contact (real
-- gravity, tuned by frequency and damping ratio like the car), wheel friction (rolling resistance,
-- brakes, sideways grip) or skid friction (static grip both ways, so it holds on slopes).
--
-- VehicleService creates the contacts as attachments on the root (Mount_<name>, attributes Gear,
-- Radius, Skid, Steer, Share, StaticLength, MaxLength); wheel visuals are placed by VehicleVisuals
-- like a car's.

local Workspace = game:GetService("Workspace")

local SimUtil = require(script.Parent.SimUtil)

local MPS = SimUtil.MPS
local G = SimUtil.G
local CAST_RADIUS = 0.85
local WALL_NORMAL = 0.35
local STOP_GAIN = 0.5

export type Contact = {
	name: string,
	mount: Attachment,
	radius: number,
	skid: boolean,
	steer: boolean,
	k: number,
	c: number,
	restLength: number,
	staticForce: number,
	cornerMassKg: number,
	length: number,
	grounded: boolean,
	springForce: number,
	load: number,
}

export type Context = { dt: number, steerDeg: number, brake: number, hold: boolean }

local Gear = {}
Gear.__index = Gear

export type Gear = typeof(setmetatable({} :: { rig: SimUtil.Rig, spec: any, contacts: { Contact } }, Gear))

function Gear.new(rig: SimUtil.Rig, gearSpec: any): Gear
	local root = rig.root
	local mass = root.AssemblyMass
	local staticLength = gearSpec.MaxLength * gearSpec.RideHeight
	local contacts: { Contact } = {}
	for _, mount in root:GetChildren() do
		if mount:IsA("Attachment") and mount:GetAttribute("Gear") then
			local share = mount:GetAttribute("Share") :: number
			local cornerMass = mass * share
			local k, c = SimUtil.Spring(cornerMass, gearSpec.Frequency, gearSpec.DampingRatio)
			local staticForce = cornerMass * (G / MPS)
			table.insert(contacts, {
				name = mount:GetAttribute("WheelName") :: string,
				mount = mount,
				radius = mount:GetAttribute("Radius") :: number,
				skid = mount:GetAttribute("Skid") == true,
				steer = mount:GetAttribute("Steer") == true,
				k = k,
				c = c,
				restLength = staticLength + staticForce / k,
				staticForce = staticForce,
				cornerMassKg = rig.spec.Mass * share,
				length = staticLength,
				grounded = false,
				springForce = 0,
				load = 0,
			})
		end
	end
	return setmetatable({ rig = rig, spec = gearSpec, contacts = contacts }, Gear)
end

-- Adds the gear's forces to the rig. Returns contacts on the ground and the weight share they carry.
function Gear.Step(self: Gear, ctx: Context): (number, number)
	local rig = self.rig
	local root = rig.root
	local g = self.spec
	local cf = root.CFrame
	local up, look = cf.UpVector, cf.LookVector
	local maxLength = g.MaxLength
	local grounded, support = 0, 0
	for _, p in self.contacts do
		local castRadius = p.radius * CAST_RADIUS
		local inset = p.radius - castRadius
		local lift = p.radius
		local hit = Workspace:Spherecast(
			p.mount.WorldPosition + up * lift,
			castRadius,
			-up * (maxLength + inset + lift),
			rig.params
		)
		if hit and hit.Normal:Dot(up) < WALL_NORMAL then
			hit = nil
		end
		if not hit then
			p.grounded = false
			p.length = maxLength
			p.springForce = 0
			p.load = 0
			continue
		end
		local length = math.clamp(hit.Distance - inset - lift, 0, maxLength)
		local springForce = math.max(0, p.k * (p.restLength - length) + p.c * ((p.length - length) / ctx.dt))
		p.length = length
		p.grounded = true
		p.springForce = springForce
		grounded += 1
		support += springForce
		p.load = p.cornerMassKg * G * math.clamp(springForce / p.staticForce, 0, 4)
		SimUtil.AddForceRoblox(rig, hit.Normal * springForce, hit.Position)

		-- Friction in the ground plane.
		local n = hit.Normal
		local wheelForward = if p.steer then CFrame.fromAxisAngle(up, math.rad(-ctx.steerDeg)) * look else look
		wheelForward = (wheelForward - n * wheelForward:Dot(n)).Unit
		local wheelRight = wheelForward:Cross(n)
		local contactVelocity = root:GetVelocityAtPosition(hit.Position) * MPS
		local longMs = contactVelocity:Dot(wheelForward)
		local latMs = contactVelocity:Dot(wheelRight)
		local stopLimit = p.cornerMassKg / ctx.dt * STOP_GAIN
		local gripN = g.Grip * p.load
		local latN = -math.clamp(stopLimit * latMs, -gripN, gripN)
		local longN
		if p.skid then
			longN = -math.clamp(stopLimit * longMs, -gripN, gripN)
		else
			local brakeN = (if ctx.hold then 1 else ctx.brake) * g.BrakeG * p.cornerMassKg * G * (if ctx.hold then 2 else 1)
			local resist = math.min(brakeN + g.RollingResistance * p.load, gripN)
			longN = -math.sign(longMs) * math.min(resist, stopLimit * math.abs(longMs))
		end
		SimUtil.AddForce(rig, wheelForward * longN + wheelRight * latN, hit.Position)
	end
	return grounded, support / (root.AssemblyMass * (G / MPS))
end

return Gear
