--!strict
-- The one place remotes are declared and created.
--
-- Every remote in the game is listed in REMOTES below, with its direction and arguments.
-- Reviewing this list is reviewing the game's whole network attack surface, so keep the
-- comments accurate. The server creates the Instances when this module is first required;
-- clients wait for them.
--
-- Rules for client -> server remotes:
--   * They are requests ("I want to claim"), never facts ("I now have 500 coins").
--   * The handler checks every argument's type and range, rate, ownership and distance
--     before acting. `Net.Handle` gives you the rate limit and a safe wrapper; the checks
--     specific to the request are yours to write.

local Players = game:GetService("Players")
local ReplicatedStorage = game:GetService("ReplicatedStorage")
local RunService = game:GetService("RunService")

type Kind = "Event" | "Function" | "Unreliable"

local REMOTES: { [string]: Kind } = {
	-- server -> client
	Notify = "Event", -- (message: string) show a toast on the HUD

	-- client -> server
	ClaimDailyReward = "Event", -- () ask for today's reward; the server decides
}

local CLASS_NAMES: { [Kind]: string } = {
	Event = "RemoteEvent",
	Function = "RemoteFunction",
	Unreliable = "UnreliableRemoteEvent",
}

local FOLDER_NAME = "Remotes"
local IS_SERVER = RunService:IsServer()

local folder: Instance
if IS_SERVER then
	folder = ReplicatedStorage:FindFirstChild(FOLDER_NAME) or Instance.new("Folder")
	folder.Name = FOLDER_NAME
	for name, kind in REMOTES do
		if not folder:FindFirstChild(name) then
			local remote = Instance.new(CLASS_NAMES[kind])
			remote.Name = name
			remote.Parent = folder
		end
	end
	folder.Parent = ReplicatedStorage
else
	folder = ReplicatedStorage:WaitForChild(FOLDER_NAME)
end

local function get(name: string, kind: Kind): Instance
	local declared = REMOTES[name]
	if declared == nil then
		error(`Remote "{name}" is not declared in Net.REMOTES`, 3)
	elseif declared ~= kind then
		error(`Remote "{name}" is declared as {declared}, not {kind}`, 3)
	end
	return if IS_SERVER then folder:FindFirstChild(name) :: Instance else folder:WaitForChild(name)
end

local Net = {}

function Net.Event(name: string): RemoteEvent
	return get(name, "Event") :: RemoteEvent
end

function Net.Function(name: string): RemoteFunction
	return get(name, "Function") :: RemoteFunction
end

function Net.Unreliable(name: string): UnreliableRemoteEvent
	return get(name, "Unreliable") :: UnreliableRemoteEvent
end

-- Token bucket per player: allows `perSecond` calls on average, bursts up to `burst`.
-- Returns a function `allow(player): boolean`.
function Net.RateLimiter(perSecond: number, burst: number?): (player: Player) -> boolean
	local capacity = burst or math.max(1, perSecond)
	local buckets: { [Player]: { tokens: number, last: number } } = {}
	Players.PlayerRemoving:Connect(function(player)
		buckets[player] = nil
	end)
	return function(player: Player): boolean
		local now = os.clock()
		local bucket = buckets[player]
		if not bucket then
			bucket = { tokens = capacity, last = now }
			buckets[player] = bucket
		end
		bucket.tokens = math.min(capacity, bucket.tokens + (now - bucket.last) * perSecond)
		bucket.last = now
		if bucket.tokens < 1 then
			return false
		end
		bucket.tokens -= 1
		return true
	end
end

-- Server only. Connects a client -> server RemoteEvent with a rate limit and error isolation.
-- Arguments arrive as `...: unknown`: check each with typeof() before use.
function Net.Handle(name: string, perSecond: number, handler: (player: Player, ...unknown) -> ()): RBXScriptConnection
	assert(IS_SERVER, "Net.Handle is server-only")
	local allow = Net.RateLimiter(perSecond)
	return Net.Event(name).OnServerEvent:Connect(function(player: Player, ...: unknown)
		if not allow(player) then
			return
		end
		local ok, err = pcall(handler, player, ...)
		if not ok then
			warn(`[Net] {name} from {player.Name} failed: {err}`)
		end
	end)
end

return Net
