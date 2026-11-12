--!strict
-- Server-side movement checks and honeypot remotes. Lives in Server/Services so the Loader
-- starts it; needs Server/Security/{SecurityConfig, Sanctions}.
--
-- Movement: every CheckInterval seconds, each living character is compared with its last
-- VALID position. Too fast, teleporting, hovering, rising above jump height, or passing
-- through an anchored collidable wall = flag + rubber-band back to the last valid position.
--
-- The game's own movement must tell this service about itself, or honest players get flagged:
--   AntiCheatService:Teleport(player, cframe)   -- instead of PivotTo on characters
--   AntiCheatService:Grant(player, seconds)      -- before dashes, launch pads, knockback, flings
-- Speed changes need nothing: the check reads the current WalkSpeed (set it on the server).

local Players = game:GetService("Players")
local ReplicatedStorage = game:GetService("ReplicatedStorage")

local Sanctions = require(script.Parent.Parent.Security.Sanctions)
local SecurityConfig = require(script.Parent.Parent.Security.SecurityConfig)

type Track = {
	lastValid: Vector3,
	lastTime: number,
	graceUntil: number,
	airSince: number?, -- os.clock() when the character left the ground
	groundY: number, -- Y of the root when last on the ground
	peakY: number, -- highest root Y since leaving the ground
}

local AntiCheatService = {}

local tracks: { [Player]: Track } = {}

local function now(): number
	return os.clock()
end

local function jumpHeight(humanoid: Humanoid): number
	if humanoid.UseJumpPower then
		return humanoid.JumpPower ^ 2 / (2 * workspace.Gravity)
	end
	return humanoid.JumpHeight
end

local function getParts(player: Player): (Model?, Humanoid?, BasePart?)
	local character = player.Character
	if not character then
		return nil, nil, nil
	end
	local humanoid = character:FindFirstChildOfClass("Humanoid")
	local root = character:FindFirstChild("HumanoidRootPart")
	if not humanoid or humanoid.Health <= 0 or not root or not root:IsA("BasePart") then
		return nil, nil, nil
	end
	return character, humanoid, root
end

local function reset(player: Player, position: Vector3, grace: number)
	local t = now()
	tracks[player] = {
		lastValid = position,
		lastTime = t,
		graceUntil = t + grace,
		airSince = nil,
		groundY = position.Y,
		peakY = position.Y,
	}
end

local function rubberBand(root: BasePart, track: Track)
	root.AssemblyLinearVelocity = Vector3.zero
	root.CFrame = CFrame.new(track.lastValid) * root.CFrame.Rotation
end

local function raycastParams(character: Model, root: BasePart): RaycastParams
	local params = RaycastParams.new()
	params.FilterType = Enum.RaycastFilterType.Exclude
	params.FilterDescendantsInstances = { character }
	params.RespectCanCollide = true
	params.CollisionGroup = root.CollisionGroup
	return params
end

local function onGround(root: BasePart, humanoid: Humanoid, params: RaycastParams): boolean
	-- Distance from the root to the feet, plus a probe below them.
	local depth = humanoid.HipHeight + root.Size.Y / 2 + SecurityConfig.Movement.GroundProbeDepth
	return workspace:Raycast(root.Position, Vector3.new(0, -depth, 0), params) ~= nil
		or humanoid:GetState() == Enum.HumanoidStateType.Swimming
		or humanoid:GetState() == Enum.HumanoidStateType.Climbing
end

local function check(player: Player, track: Track)
	local config = SecurityConfig.Movement
	local weights = config.Weights
	local character, humanoid, root = getParts(player)
	if not (character and humanoid and root) then
		return
	end

	local t = now()
	local position = root.Position
	local elapsed = math.max(t - track.lastTime, 1e-3)

	-- Seated (vehicles) and granted windows: accept wherever they are.
	if humanoid.SeatPart ~= nil or t < track.graceUntil then
		track.lastValid = position
		track.lastTime = t
		track.airSince = nil
		track.groundY = position.Y
		track.peakY = position.Y
		return
	end

	local delta = position - track.lastValid
	local horizontal = Vector3.new(delta.X, 0, delta.Z).Magnitude
	local allowedSpeed = humanoid.WalkSpeed * config.SpeedTolerance + config.SpeedAllowance
	local params = raycastParams(character, root)
	local violation: string? = nil
	local details = ""

	if horizontal > config.TeleportDistance then
		violation = "Teleport"
		details = `moved {math.floor(horizontal)} studs in {string.format("%.2f", elapsed)}s`
	elseif horizontal / elapsed > allowedSpeed then
		violation = "Speed"
		details = `{math.floor(horizontal / elapsed)} studs/s, allowed {math.floor(allowedSpeed)}`
	elseif config.Noclip and delta.Magnitude > 1 then
		-- Terrain is skipped: rough hills can cross the straight line between two root positions.
		local hit = workspace:Raycast(track.lastValid, delta, params)
		local wall = hit and hit.Instance
		if
			hit
			and wall
			and wall:IsA("BasePart")
			and not wall:IsA("Terrain")
			and wall.Anchored
			and hit.Distance < delta.Magnitude - 1
		then
			violation = "Noclip"
			details = `through {hit.Instance:GetFullName()}`
		end
	end

	-- Air checks (falling is never flagged).
	if violation == nil then
		if onGround(root, humanoid, params) then
			track.airSince = nil
			track.groundY = position.Y
			track.peakY = position.Y
		else
			track.airSince = track.airSince or t
			track.peakY = math.max(track.peakY, position.Y)
			local rise = track.peakY - track.groundY
			local airTime = t - (track.airSince :: number)
			if rise > jumpHeight(humanoid) + config.RiseAllowance then
				violation = "HighJump"
				details = `rose {math.floor(rise)} studs`
			elseif airTime > config.MaxHoverSeconds and position.Y >= track.peakY - 2 then
				violation = "Fly"
				details = `airborne {string.format("%.1f", airTime)}s without falling`
			end
		end
	end

	if violation then
		Sanctions.Flag(player, violation, (weights :: any)[violation], details)
		rubberBand(root, track)
		-- Restart the air tracking from the valid position.
		track.airSince = nil
		track.groundY = track.lastValid.Y
		track.peakY = track.lastValid.Y
	else
		track.lastValid = position
	end
	track.lastTime = t
end

local function setupHoneypots()
	local folder = ReplicatedStorage:FindFirstChild(SecurityConfig.HoneypotFolderName)
	if not folder then
		local created = Instance.new("Folder")
		created.Name = SecurityConfig.HoneypotFolderName
		created.Parent = ReplicatedStorage
		folder = created
	end
	for _, name in SecurityConfig.HoneypotRemotes do
		if (folder :: Instance):FindFirstChild(name) then
			warn(`[AntiCheat] honeypot "{name}" clashes with an existing remote; skipped`)
			continue
		end
		local remote = Instance.new("RemoteEvent")
		remote.Name = name
		remote.Parent = folder
		remote.OnServerEvent:Connect(function(player: Player, ...: unknown)
			local args = {}
			for i = 1, math.min(select("#", ...), 4) do
				table.insert(args, string.sub(tostring((select(i, ...))), 1, 40))
			end
			Sanctions.Ban(player, "Honeypot", `fired {name}({table.concat(args, ", ")})`)
		end)
	end
end

function AntiCheatService:Start()
	setupHoneypots()

	local config = SecurityConfig.Movement
	if not config.Enabled then
		return
	end

	local function onCharacter(player: Player, character: Model)
		local root = character:WaitForChild("HumanoidRootPart", 10)
		if root and root:IsA("BasePart") and player.Character == character then
			reset(player, root.Position, config.RespawnGraceSeconds)
		end
	end

	local function onPlayer(player: Player)
		player.CharacterAdded:Connect(function(character)
			onCharacter(player, character)
		end)
		if player.Character then
			task.spawn(onCharacter, player, player.Character)
		end
	end

	Players.PlayerAdded:Connect(onPlayer)
	for _, player in Players:GetPlayers() do
		onPlayer(player)
	end
	Players.PlayerRemoving:Connect(function(player)
		tracks[player] = nil
	end)

	while true do
		task.wait(config.CheckInterval)
		for player, track in tracks do
			local ok, err = pcall(check, player, track)
			if not ok then
				warn(`[AntiCheat] check failed for {player.Name}: {err}`)
			end
		end
	end
end

-- Moves a character on the server without triggering the movement checks.
function AntiCheatService:Teleport(player: Player, cframe: CFrame)
	local character = player.Character
	if not character then
		return
	end
	reset(player, cframe.Position, 1)
	character:PivotTo(cframe)
end

-- Suspends movement checks for this player for `seconds` (dashes, knockback, launch pads).
function AntiCheatService:Grant(player: Player, seconds: number)
	local track = tracks[player]
	if track then
		track.graceUntil = math.max(track.graceUntil, now() + seconds)
	end
end

return AntiCheatService
