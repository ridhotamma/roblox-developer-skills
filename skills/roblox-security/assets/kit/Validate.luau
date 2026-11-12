--!strict
-- Server-side checks for values that come from clients (remote arguments, Touched hits,
-- prompt triggers). Each check returns the cleaned value, or nil if it fails:
--
--   local itemId = Validate.OneOf(rawItemId, ShopConfig.Items)
--   local amount = Validate.Integer(rawAmount, 1, 99)
--   if not (itemId and amount) then return end
--
-- Everything from a client is untrusted: any type, NaN, ±inf, huge strings, nested tables,
-- or any Instance the client can see.

local Players = game:GetService("Players")

local Validate = {}

-- A finite number in [min, max]. Rejects NaN (fails both comparisons) and ±inf (out of range).
function Validate.Number(value: unknown, min: number, max: number): number?
	if typeof(value) ~= "number" then
		return nil
	end
	if value >= min and value <= max then
		return value
	end
	return nil
end

-- A whole number in [min, max].
function Validate.Integer(value: unknown, min: number, max: number): number?
	local n = Validate.Number(value, min, max)
	if n ~= nil and n % 1 == 0 then
		return n
	end
	return nil
end

function Validate.Boolean(value: unknown): boolean?
	if typeof(value) == "boolean" then
		return value
	end
	return nil
end

-- A valid UTF-8 string of at most maxBytes, optionally matching a Lua pattern
-- (anchor it: "^[%w_ ]+$").
function Validate.String(value: unknown, maxBytes: number, pattern: string?): string?
	if typeof(value) ~= "string" or #value > maxBytes or utf8.len(value) == nil then
		return nil
	end
	if pattern and string.match(value, pattern) == nil then
		return nil
	end
	return value
end

-- Looks the value up in an allow-list table keyed by id (a config table such as
-- ShopConfig.Items). Returns the entry, or nil for unknown ids or non-string/number values.
function Validate.OneOf<T>(value: unknown, allowed: { [any]: T }): T?
	local kind = typeof(value)
	if kind ~= "string" and kind ~= "number" then
		return nil
	end
	if kind == "number" and (value :: number) ~= (value :: number) then
		return nil -- NaN can't be a key
	end
	return allowed[value :: any]
end

-- A Vector3 with finite components and magnitude <= maxMagnitude.
function Validate.Vector3(value: unknown, maxMagnitude: number): Vector3?
	if typeof(value) ~= "Vector3" then
		return nil
	end
	local v = value :: Vector3
	if v.Magnitude <= maxMagnitude then -- NaN and inf components fail this comparison
		return v
	end
	return nil
end

-- A CFrame whose position passes Validate.Vector3 and whose rotation has no NaN.
function Validate.CFrame(value: unknown, maxMagnitude: number): CFrame?
	if typeof(value) ~= "CFrame" then
		return nil
	end
	local cf = value :: CFrame
	local look = cf.LookVector
	if Validate.Vector3(cf.Position, maxMagnitude) and look.Magnitude == look.Magnitude then
		return cf
	end
	return nil
end

-- An Instance of the given class, optionally required to be a descendant of `ancestor`.
function Validate.Instance(value: unknown, className: string, ancestor: Instance?): Instance?
	if typeof(value) ~= "Instance" then
		return nil
	end
	local instance = value :: Instance
	if not instance:IsA(className) then
		return nil
	end
	if ancestor and not instance:IsDescendantOf(ancestor) then
		return nil
	end
	return instance
end

-- An array of at most maxLength items, each passed through `each` (which returns the cleaned
-- item or nil). Returns a new clean array, or nil if anything is wrong (holes, extra keys,
-- too long, a failing item).
function Validate.Array<T>(value: unknown, maxLength: number, each: (unknown) -> T?): { T }?
	if typeof(value) ~= "table" then
		return nil
	end
	local raw = value :: { [unknown]: unknown }
	local count = 0
	for key in raw do
		count += 1
		if count > maxLength or typeof(key) ~= "number" then
			return nil
		end
	end
	local out = table.create(count)
	for i = 1, count do
		local item = raw[i]
		if item == nil then
			return nil -- holes or non-sequential keys
		end
		local clean = each(item)
		if clean == nil then
			return nil
		end
		out[i] = clean
	end
	return out
end

-- The player's living character root part, or nil.
function Validate.Root(player: Player): BasePart?
	local character = player.Character
	if not character then
		return nil
	end
	local humanoid = character:FindFirstChildOfClass("Humanoid")
	local root = character:FindFirstChild("HumanoidRootPart")
	if humanoid and humanoid.Health > 0 and root and root:IsA("BasePart") then
		return root
	end
	return nil
end

-- True if the player's living character is within maxDistance studs of position.
-- Use for every Touched / ProximityPrompt / ClickDetector reward and every "use this
-- object" request: exploits trigger those from anywhere on the map.
function Validate.Near(player: Player, position: Vector3, maxDistance: number): boolean
	local root = Validate.Root(player)
	return root ~= nil and (root.Position - position).Magnitude <= maxDistance
end

-- Per-player cooldown on the server clock. Returns `ready(player): boolean`, which is true
-- (and starts the cooldown) at most once per `seconds`.
function Validate.Cooldown(seconds: number): (player: Player) -> boolean
	local last: { [Player]: number } = {}
	Players.PlayerRemoving:Connect(function(player)
		last[player] = nil
	end)
	return function(player: Player): boolean
		local now = os.clock()
		local previous = last[player]
		if previous and now - previous < seconds then
			return false
		end
		last[player] = now
		return true
	end
end

return table.freeze(Validate)
