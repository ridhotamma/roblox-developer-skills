--!strict
-- Finisher rules, shared so the client's prompt and the server's decision always agree:
--   * which side of the victim the attacker is on (front, back, left, right)
--   * which moves are allowed (posture, side, health, range, stealth, victim kind)
--   * which one to play (priority, then not the one you just saw, then weight)
--   * where both bodies must stand so the paired animations line up
-- Pure: no Instances. FinisherService (server) and CutsceneController (client prompt) call it.
--
-- A finisher move is a scene (references/scene-format.md) with a `Finisher` block:
--   Finisher = {
--     Prompt = "Suplex",            label on the prompt ("[F] Suplex")
--     Input = "Press" | "Hold",     Hold = press and hold HoldTime seconds (CoD-style)
--     HoldTime = 0.35,
--     Priority = 2,                 higher wins when several fit
--     Weight = 1,                   random share among equal priorities
--     Requires = {
--       Posture = { "Kneel" },      any of these victim postures ("Stagger", "Kneel", "Down"...)
--       Side = { "Back" },          attacker must be on one of these sides of the victim
--       MaxHealth = 0.25,           victim health fraction at or below
--       Unaware = true,             victim hasn't noticed the attacker (stealth)
--       Range = 6,                  studs between roots
--       MaxHeight = 3,              studs of height difference
--       Kinds = { "Grunt" },        only these victim kinds (Archetype attribute)
--       NotKinds = { "Boss" },      never these
--     },
--     Attacker = "Attacker", Victim = "Victim",   actor names in the scene
--     Lethal = true,                kills at the scene's Kill event (or at the end)
--     Clearance = 2.5,              studs of free space needed around the attacker's mark
--   }

local Finisher = {}

export type Context = {
	Side: string,
	Posture: string?,
	HealthFraction: number,
	Distance: number,
	Height: number,
	Unaware: boolean,
	Kind: string?,
	Last: string?,
}

Finisher.Sides = table.freeze({ "Front", "Back", "Left", "Right" })

-- Which side of the victim a point is on. Front and back get 90° each (±45°), as do the sides.
function Finisher.Side(attackerPosition: Vector3, victimCFrame: CFrame): string
	local offset = victimCFrame:PointToObjectSpace(attackerPosition)
	local x, z = offset.X, -offset.Z -- z > 0: in front of the victim
	if x * x + z * z < 1e-6 then
		return "Front"
	end
	local angle = math.deg(math.atan2(x, z)) -- 0 front, +90 victim's right, ±180 back
	if math.abs(angle) <= 45 then
		return "Front"
	elseif math.abs(angle) >= 135 then
		return "Back"
	end
	return if angle > 0 then "Right" else "Left"
end

-- Same, but also accepts sides within `tolerance` degrees of a boundary (the server uses this
-- so a prompt the client saw a frame earlier isn't refused over latency).
function Finisher.SidesNear(attackerPosition: Vector3, victimCFrame: CFrame, tolerance: number): { [string]: boolean }
	local offset = victimCFrame:PointToObjectSpace(attackerPosition)
	local angle = math.deg(math.atan2(offset.X, -offset.Z))
	local sides = {}
	for _, delta in { -tolerance, 0, tolerance } do
		local probe = math.rad(angle + delta)
		local point = victimCFrame * Vector3.new(math.sin(probe), 0, -math.cos(probe))
		sides[Finisher.Side(point, victimCFrame)] = true
	end
	return sides
end

local function contains(list: { string }?, value: string?): boolean
	if list == nil then
		return true
	end
	return value ~= nil and table.find(list, value) ~= nil
end

-- Why a move doesn't fit (nil when it does).
function Finisher.Rejects(move: any, ctx: Context, sides: { [string]: boolean }?): string?
	local spec = move.Finisher
	if not spec then
		return "not a finisher"
	end
	local req = spec.Requires or {}
	if req.Posture and not contains(req.Posture, ctx.Posture) then
		return "posture"
	end
	if req.Side then
		local ok = false
		for _, side in req.Side do
			if side == ctx.Side or (sides and sides[side]) then
				ok = true
			end
		end
		if not ok then
			return "side"
		end
	end
	if req.MaxHealth and ctx.HealthFraction > req.MaxHealth then
		return "health"
	end
	if req.Unaware and not ctx.Unaware then
		return "aware"
	end
	if ctx.Distance > (req.Range or 6) then
		return "range"
	end
	if math.abs(ctx.Height) > (req.MaxHeight or 3) then
		return "height"
	end
	if req.Kinds and not contains(req.Kinds, ctx.Kind) then
		return "kind"
	end
	if req.NotKinds and ctx.Kind and table.find(req.NotKinds, ctx.Kind) then
		return "kind"
	end
	return nil
end

-- Every fitting move, best first.
function Finisher.Candidates(moves: { [string]: any }, ctx: Context, sides: { [string]: boolean }?): { any }
	local out = {}
	for _, move in moves do
		if Finisher.Rejects(move, ctx, sides) == nil then
			table.insert(out, move)
		end
	end
	table.sort(out, function(a, b)
		local pa, pb = a.Finisher.Priority or 0, b.Finisher.Priority or 0
		if pa ~= pb then
			return pa > pb
		end
		local ra, rb = a.Name == ctx.Last, b.Name == ctx.Last
		if ra ~= rb then
			return rb -- the one we didn't just play first
		end
		return a.Name < b.Name
	end)
	return out
end

-- The move to play: the top priority, avoiding a repeat of `ctx.Last` when another move of the
-- same priority fits, picked by Weight with `roll` in 0..1 (nil = deterministic first).
function Finisher.Choose(moves: { [string]: any }, ctx: Context, roll: number?, sides: { [string]: boolean }?): any?
	local candidates = Finisher.Candidates(moves, ctx, sides)
	local best = candidates[1]
	if not best or roll == nil then
		return best
	end
	local top = best.Finisher.Priority or 0
	local pool, total = {}, 0
	for _, move in candidates do
		if (move.Finisher.Priority or 0) == top and (move.Name ~= ctx.Last or #candidates == 1) then
			table.insert(pool, move)
			total += move.Finisher.Weight or 1
		end
	end
	if #pool == 0 then
		return best
	end
	local pick = roll * total
	for _, move in pool do
		pick -= move.Finisher.Weight or 1
		if pick <= 0 then
			return move
		end
	end
	return pool[#pool]
end

local function mark(move: any, role: string): CFrame
	local name = move.Finisher[role] or role
	local actorDef = move.Actors[name]
	assert(actorDef, `finisher {move.Name} has no actor "{name}"`)
	local spec = actorDef.Mark
	if type(spec) == "string" then
		spec = move.Marks[spec]
	end
	spec = spec or {}
	return CFrame.new(spec.Position or Vector3.zero) * CFrame.Angles(0, math.rad(spec.Yaw or 0), 0)
end

-- Scene origin that puts the move's Victim mark exactly on the victim's ground CFrame (yaw only),
-- and where the attacker's root must stand (ground CFrame) for the animations to connect.
function Finisher.Align(move: any, victimGround: CFrame): (CFrame, CFrame)
	local origin = victimGround * mark(move, "Victim"):Inverse()
	return origin, origin * mark(move, "Attacker")
end

-- A ground CFrame (position on the floor, facing flattened) from a root CFrame.
function Finisher.Ground(root: CFrame, groundOffset: number): CFrame
	local look = root.LookVector
	local flat = Vector3.new(look.X, 0, look.Z)
	if flat.Magnitude < 1e-3 then
		flat = Vector3.new(0, 0, -1)
	end
	local position = root.Position - Vector3.new(0, groundOffset, 0)
	return CFrame.lookAt(position, position + flat.Unit)
end

return Finisher
