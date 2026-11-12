--!strict
-- Pushes a character with a LinearVelocity for a short time.
--
-- Whoever owns the character's physics must apply it:
--   NPCs (server-owned)      -> the server calls Knockback.Push
--   Player characters        -> the server fires "Knockback" to that player, whose client calls
--                               Knockback.Push on its own root (see CombatController)
-- A LinearVelocity beats ApplyImpulse on Humanoids: friction and walking eat a single impulse.

local MAX_SPEED = 160 -- studs/s, cap for safety (also used to validate server requests)
local MAX_SECONDS = 0.6

local Knockback = {
	MaxSpeed = MAX_SPEED,
	MaxSeconds = MAX_SECONDS,
}

local active: { [BasePart]: LinearVelocity } = {}

function Knockback.Push(root: BasePart, velocity: Vector3, seconds: number)
	if velocity.Magnitude ~= velocity.Magnitude or seconds <= 0 then
		return -- NaN or nothing to do
	end
	if velocity.Magnitude > MAX_SPEED then
		velocity = velocity.Unit * MAX_SPEED
	end
	seconds = math.min(seconds, MAX_SECONDS)

	local previous = active[root]
	if previous then
		previous:Destroy() -- a new hit replaces the old push
	end

	local attachment = root:FindFirstChild("KnockbackAttachment")
	if not attachment then
		attachment = Instance.new("Attachment")
		attachment.Name = "KnockbackAttachment"
		attachment.Parent = root
	end

	local mover = Instance.new("LinearVelocity")
	mover.Name = "Knockback"
	mover.Attachment0 = attachment :: Attachment
	mover.RelativeTo = Enum.ActuatorRelativeTo.World
	mover.VelocityConstraintMode = Enum.VelocityConstraintMode.Vector
	mover.VectorVelocity = velocity
	mover.MaxForce = root.AssemblyMass * 4000
	mover.Parent = root
	active[root] = mover

	task.delay(seconds, function()
		if active[root] == mover then
			active[root] = nil
		end
		mover:Destroy()
	end)
end

-- Horizontal direction from `from` to `to`, falling back to `fallback` when they overlap.
function Knockback.Direction(from: Vector3, to: Vector3, fallback: Vector3): Vector3
	local flat = Vector3.new(to.X - from.X, 0, to.Z - from.Z)
	if flat.Magnitude < 1e-3 then
		flat = Vector3.new(fallback.X, 0, fallback.Z)
	end
	return if flat.Magnitude < 1e-3 then Vector3.zAxis else flat.Unit
end

return table.freeze(Knockback)
