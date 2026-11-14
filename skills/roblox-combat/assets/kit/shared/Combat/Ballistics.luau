--!strict
-- Shot maths shared by the server (authoritative) and clients (prediction and visuals).

local Ballistics = {}

-- A direction inside a cone of `degrees` half-angle around `direction`, uniformly over the
-- cone's disk (a uniform angle would cluster shots in the middle).
function Ballistics.Spread(direction: Vector3, degrees: number, rng: Random): Vector3
	if degrees <= 0 then
		return direction.Unit
	end
	local radius = math.tan(math.rad(degrees)) * math.sqrt(rng:NextNumber())
	local angle = rng:NextNumber() * 2 * math.pi
	local up = if math.abs(direction.Unit.Y) > 0.99 then Vector3.xAxis else Vector3.yAxis
	local frame = CFrame.lookAt(Vector3.zero, direction, up)
	local offset = frame.RightVector * (math.cos(angle) * radius) + frame.UpVector * (math.sin(angle) * radius)
	return (direction.Unit + offset).Unit
end

export type FalloffStats = { FalloffStart: number, FalloffEnd: number, FalloffMin: number }

-- Damage multiplier at a distance: 1 until FalloffStart, linear down to FalloffMin at FalloffEnd.
function Ballistics.Falloff(distance: number, stats: FalloffStats): number
	if distance <= stats.FalloffStart or stats.FalloffEnd <= stats.FalloffStart then
		return 1
	end
	local t = math.clamp((distance - stats.FalloffStart) / (stats.FalloffEnd - stats.FalloffStart), 0, 1)
	return 1 + (stats.FalloffMin - 1) * t
end

-- One step of a projectile with gravity. Returns the new position and velocity, and the
-- raycast result if it hit something on the way (position is then the hit point).
function Ballistics.Step(
	position: Vector3,
	velocity: Vector3,
	gravity: number,
	dt: number,
	params: RaycastParams
): (Vector3, Vector3, RaycastResult?)
	local acceleration = Vector3.new(0, -gravity, 0)
	local nextPosition = position + velocity * dt + acceleration * (0.5 * dt * dt)
	local nextVelocity = velocity + acceleration * dt
	local result = workspace:Raycast(position, nextPosition - position, params)
	if result then
		return result.Position, nextVelocity, result
	end
	return nextPosition, nextVelocity, nil
end

export type RayFn = (origin: Vector3, direction: Vector3) -> Vector3? -- hit position or nil

-- The aim point: where the crosshair ray from `cameraCFrame` lands (or max range). Bullets fly
-- from the muzzle toward this point, so the crosshair stays honest even though the gun is offset.
-- `skip` studs at the start of the ray are ignored: in third person that's the stretch between
-- the camera and the character (AimCamera:AimSkip()), so a post behind you can't eat the shot.
function Ballistics.AimFrom(cameraCFrame: CFrame, range: number, skip: number, cast: RayFn): Vector3
	local look = cameraCFrame.LookVector
	local origin = cameraCFrame.Position + look * skip
	local hit = cast(origin, look * (range - skip))
	return hit or origin + look * (range - skip)
end

function Ballistics.AimPoint(camera: Camera, range: number, params: RaycastParams, skip: number?): Vector3
	return Ballistics.AimFrom(camera.CFrame, range, skip or 0, function(origin, direction)
		local result = workspace:Raycast(origin, direction, params)
		return if result then result.Position else nil
	end)
end

-- Where the bullet from the muzzle toward `aimPoint` actually stops, if something sits between
-- them (the gun pokes past a corner the camera sees around). Nil when the line is clear.
function Ballistics.Obstruction(muzzle: Vector3, aimPoint: Vector3, cast: RayFn): Vector3?
	local toAim = aimPoint - muzzle
	local distance = toAim.Magnitude
	if distance < 1e-3 then
		return nil
	end
	local hit = cast(muzzle, toAim)
	if hit and (aimPoint - hit).Magnitude > 0.5 then
		return hit
	end
	return nil
end

function Ballistics.IsHead(part: Instance): boolean
	return part.Name == "Head" or part:GetAttribute("Hitzone") == "Head"
end

return table.freeze(Ballistics)
