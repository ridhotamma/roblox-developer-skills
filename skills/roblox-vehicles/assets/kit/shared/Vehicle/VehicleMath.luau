--!strict
-- Pure vehicle maths in real units (kg, m, s, N, N·m). Mirrors scripts/rveh.cjs, so the
-- performance the report prints is what the car does in game.
--
-- Unit bridge: horizontal dynamics (engine, brakes, tires, drag) are computed in SI with the
-- spec's real mass and real gravity, then converted to Roblox force with
--     robloxForce = newtons * (assemblyMass / spec.Mass) / METERS_PER_STUD
-- so the result is independent of the model's part masses. Suspension lives in Roblox's world
-- (Workspace.Gravity) and is tuned by frequency, which is also mass-independent.

local VehicleMath = {
	G = 9.81,
	AIR_DENSITY = 1.225,
	METERS_PER_STUD = 0.28,
}

-- Engine torque (N·m) at an rpm, linear between curve points, 0 past the redline.
function VehicleMath.TorqueAt(curve: { { number } }, rpm: number, redline: number): number
	if rpm > redline then
		return 0
	end
	if rpm <= curve[1][1] then
		return curve[1][2]
	end
	for i = 2, #curve do
		local r1, t1 = curve[i][1], curve[i][2]
		if rpm <= r1 then
			local r0, t0 = curve[i - 1][1], curve[i - 1][2]
			return t0 + (t1 - t0) * (rpm - r0) / (r1 - r0)
		end
	end
	return curve[#curve][2]
end

-- Engine rpm for a road speed (m/s) through a gear ratio, from the spec's wheel radius.
function VehicleMath.EngineRpm(spec: any, speedMs: number, ratio: number): number
	return math.abs(speedMs) / spec.WheelRadius * ratio * spec.Gearbox.FinalDrive * (60 / (2 * math.pi))
end

-- Gear ratio for a gear index: 1..n forward, -1 reverse.
function VehicleMath.Ratio(spec: any, gear: number): number
	if gear < 0 then
		return spec.Gearbox.Reverse
	end
	return spec.Gearbox.Ratios[math.clamp(gear, 1, #spec.Gearbox.Ratios)]
end

-- Total drive force (N) at the contact patches and the engine rpm, before traction limits.
-- `throttle` is 0..1. First gear and reverse slip the clutch up to LaunchRpm when pulling away.
function VehicleMath.Drive(spec: any, speedMs: number, gear: number, throttle: number): (number, number)
	local engine = spec.Engine
	if engine.SpeedLimitKmh > 0 and math.abs(speedMs) * 3.6 >= engine.SpeedLimitKmh then
		throttle = 0
	end
	local ratio = VehicleMath.Ratio(spec, gear)
	local rpm = VehicleMath.EngineRpm(spec, speedMs, ratio)
	if (gear == 1 or gear < 0) and throttle > 0 and rpm < engine.LaunchRpm then
		rpm = engine.LaunchRpm
	end
	rpm = math.max(rpm, engine.IdleRpm)
	local torque = VehicleMath.TorqueAt(engine.TorqueCurve, rpm, engine.RedlineRpm) * throttle
	return torque * ratio * spec.Gearbox.FinalDrive * engine.Efficiency / spec.WheelRadius, rpm
end

-- Automatic gearbox: returns the gear to use (may be unchanged).
function VehicleMath.AutoShift(spec: any, gear: number, speedMs: number): number
	if gear < 1 then
		return gear
	end
	local gearbox = spec.Gearbox
	local rpm = VehicleMath.EngineRpm(spec, speedMs, VehicleMath.Ratio(spec, gear))
	if rpm >= gearbox.ShiftUpRpm and gear < #gearbox.Ratios then
		return gear + 1
	elseif gear > 1 then
		local lowerRpm = VehicleMath.EngineRpm(spec, speedMs, VehicleMath.Ratio(spec, gear - 1))
		if rpm <= gearbox.ShiftDownRpm and lowerRpm < gearbox.ShiftUpRpm * 0.95 then
			return gear - 1
		end
	end
	return gear
end

-- Best guess of gear and rpm from speed alone (for other players' engine sound and HUDs).
function VehicleMath.EstimateGear(spec: any, speedMs: number): (number, number)
	local gear = 1
	for g = 1, #spec.Gearbox.Ratios do
		gear = g
		local rpm = VehicleMath.EngineRpm(spec, speedMs, VehicleMath.Ratio(spec, g))
		if rpm < spec.Gearbox.ShiftUpRpm then
			break
		end
	end
	local rpm = VehicleMath.EngineRpm(spec, speedMs, VehicleMath.Ratio(spec, gear))
	return gear, math.max(rpm, spec.Engine.IdleRpm)
end

function VehicleMath.Drag(spec: any, speedMs: number): number
	return 0.5 * VehicleMath.AIR_DENSITY * spec.Aero.Cd * spec.Aero.Area * speedMs * speedMs
end

function VehicleMath.Downforce(spec: any, speedMs: number): number
	return 0.5 * VehicleMath.AIR_DENSITY * spec.Aero.DownforceCl * spec.Aero.Area * speedMs * speedMs
end

-- Normalised lateral tire force (-1..1) for a slip angle in radians: a simplified Pacejka
-- "magic formula" sin(C * atan(B * slip)). B (stiffness) sets how fast grip builds; C (shape)
-- how it falls off past the peak, which is what makes slides catchable or snappy.
function VehicleMath.TireCurve(slipAngle: number, stiffness: number, shape: number): number
	return math.sin(shape * math.atan(stiffness * slipAngle))
end

-- Spring rate and damping (Roblox units) for a corner mass and natural frequency.
function VehicleMath.Spring(cornerMass: number, frequency: number, dampingRatio: number): (number, number)
	local omega = 2 * math.pi * frequency
	local k = cornerMass * omega * omega
	local c = 2 * dampingRatio * math.sqrt(k * cornerMass)
	return k, c
end

-- Top speed (km/h) on flat ground: where the best gear's drive force no longer beats drag and
-- rolling resistance, or the redline / speed limiter stops it. Same search as rveh.cjs.
function VehicleMath.TopSpeedKmh(spec: any): number
	local best = 0
	for kmh = 1, 600, 0.5 do
		local v = kmh / 3.6
		local resist = VehicleMath.Drag(spec, v) + spec.Tires.RollingResistance * spec.Mass * VehicleMath.G
		local maxDrive, anyBelowRedline = 0, false
		for gear = 1, #spec.Gearbox.Ratios do
			if VehicleMath.EngineRpm(spec, v, VehicleMath.Ratio(spec, gear)) <= spec.Engine.RedlineRpm then
				anyBelowRedline = true
				maxDrive = math.max(maxDrive, (VehicleMath.Drive(spec, v, gear, 1)))
			end
		end
		if not anyBelowRedline or maxDrive <= resist then
			break
		end
		if spec.Engine.SpeedLimitKmh > 0 and kmh >= spec.Engine.SpeedLimitKmh then
			return spec.Engine.SpeedLimitKmh
		end
		best = kmh
	end
	return best
end

function VehicleMath.KmhFromStudsPerSecond(studsPerSecond: number): number
	return studsPerSecond * VehicleMath.METERS_PER_STUD * 3.6
end

function VehicleMath.StudsPerSecondFromKmh(kmh: number): number
	return kmh / 3.6 / VehicleMath.METERS_PER_STUD
end

return table.freeze(VehicleMath)
