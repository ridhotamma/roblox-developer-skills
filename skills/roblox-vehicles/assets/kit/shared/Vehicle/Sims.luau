--!strict
-- Picks the physics sim for a built vehicle model from its spec's Type:
--   Car (default) -> VehicleSim     Motorcycle -> BikeSim     Boat -> BoatSim
--   Plane -> PlaneSim               Helicopter -> HeliSim
-- Every sim has Step(dt, input) -> telemetry, Recover() and Destroy(). The controller builds the
-- input each type expects (see the Input types in each module).

local BikeSim = require(script.Parent.BikeSim)
local BoatSim = require(script.Parent.BoatSim)
local HeliSim = require(script.Parent.HeliSim)
local PlaneSim = require(script.Parent.PlaneSim)
local SimUtil = require(script.Parent.SimUtil)
local VehicleMath = require(script.Parent.VehicleMath)
local VehicleSim = require(script.Parent.VehicleSim)
local VehicleSpecs = require(script.Parent.VehicleSpecs)

local Sims = {}

export type Sim = {
	Step: (self: any, dt: number, input: any) -> any,
	Recover: (self: any) -> (),
	Destroy: (self: any) -> (),
}

function Sims.Kind(spec: any): string
	return spec.Type or "Car"
end

function Sims.Spec(model: Model): any?
	return (VehicleSpecs :: any)[model:GetAttribute("Vehicle")]
end

function Sims.new(model: Model): (Sim?, string?)
	local spec = Sims.Spec(model)
	if not spec then
		return nil, nil
	end
	local kind = Sims.Kind(spec)
	local sim: any
	if kind == "Motorcycle" then
		sim = BikeSim.new(model, spec)
	elseif kind == "Boat" then
		sim = BoatSim.new(model, spec)
	elseif kind == "Plane" then
		sim = PlaneSim.new(model, spec)
	elseif kind == "Helicopter" then
		sim = HeliSim.new(model, spec)
	else
		sim = VehicleSim.new(model)
	end
	return sim, kind
end

-- Highest believable speed (km/h) for the server's plausibility check: top speed with margin for
-- dives and downhills.
function Sims.SpeedLimitKmh(spec: any): number
	local kind = Sims.Kind(spec)
	if kind == "Car" or kind == "Motorcycle" then
		return VehicleMath.TopSpeedKmh(spec)
	elseif kind == "Boat" then
		if spec.Drive.SpeedLimitKmh > 0 then
			return spec.Drive.SpeedLimitKmh
		end
		-- Thrust against resistance at the steady planing immersion (boat.cjs topSpeed).
		local hull = spec.Hull
		local vp = BoatSim.PlaningSpeed(spec)
		local best = 0
		for v = 0.25, 60, 0.25 do
			local x2 = math.min(v / vp, 1) ^ 2
			local d1 = 1 - hull.PlaningLift * x2
			local immersion = if d1 >= hull.PlaneDraft then d1 else 1 / (1 + hull.PlaningLift * x2 / hull.PlaneDraft)
			local resistance = BoatSim.Resistance(spec, v, 1 - immersion, immersion)
			if BoatSim.Thrust(spec, v, 1) <= resistance then
				break
			end
			best = v
		end
		return best * 3.6
	elseif kind == "Plane" then
		if spec.Engine.SpeedLimitKmh > 0 then
			return spec.Engine.SpeedLimitKmh * 1.25
		end
		local thrust = if spec.Engine.Type == "jet" then math.max(spec.Engine.Afterburner, spec.Engine.Thrust) * 1000 else nil
		local w = spec.Wing
		local cd = w.Cd0 * (1 + w.MachDragRise)
		local best = 0
		for v = 10, 900, 2 do
			local available = thrust or PlaneSim.Thrust(spec, v, 1, SimUtil.RHO_AIR, false)
			if available < 0.5 * SimUtil.RHO_AIR * v * v * w.Area * cd then
				break
			end
			best = v
		end
		return best * 3.6 * 1.25 -- dives
	elseif kind == "Helicopter" then
		return spec.Rotor.TipSpeed * (spec.Rotor.BladeStallMu + 0.1) * 3.6 * 1.2
	end
	return 300
end

return Sims
