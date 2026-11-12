--!strict
-- The one place where suspicion becomes consequences.
--
--   Sanctions.Flag(player, "MeleeRange", 2, "dist=48")   -- evidence with a weight
--   Sanctions.Ban(player, "Honeypot", "fired AdminGiveCurrency")  -- certain evidence only
--
-- Each flag adds its weight to a per-player score that halves every Score.HalfLifeSeconds.
-- Crossing Score.KickAt kicks (enforce mode). Everything is logged with an [AntiCheat] prefix
-- and sent to Creator Hub analytics as a custom event. In observe mode, in Studio, and for
-- exempt users, nothing is enforced: the log says what would have happened.

local AnalyticsService = game:GetService("AnalyticsService")
local Players = game:GetService("Players")
local RunService = game:GetService("RunService")

local SecurityConfig = require(script.Parent.SecurityConfig)

local Sanctions = {}

type Suspicion = { score: number, updated: number }

local suspicion: { [Player]: Suspicion } = {}
local banning: { [Player]: boolean } = {}

local exempt: { [number]: boolean } = {}
for _, userId in SecurityConfig.ExemptUserIds do
	exempt[userId] = true
end

Players.PlayerRemoving:Connect(function(player)
	suspicion[player] = nil
	banning[player] = nil
end)

local function canEnforce(player: Player): (boolean, string?)
	if RunService:IsStudio() then
		return false, "studio"
	elseif exempt[player.UserId] then
		return false, "exempt"
	elseif SecurityConfig.Mode ~= "enforce" then
		return false, "observe mode"
	end
	return true, nil
end

local function decayedScore(entry: Suspicion, now: number): number
	local halfLife = SecurityConfig.Score.HalfLifeSeconds
	return entry.score * 0.5 ^ ((now - entry.updated) / halfLife)
end

local function log(player: Player, message: string)
	warn(`[AntiCheat] {player.Name} ({player.UserId}) {message}`)
end

-- Current (decayed) suspicion score.
function Sanctions.Score(player: Player): number
	local entry = suspicion[player]
	return if entry then decayedScore(entry, os.clock()) else 0
end

-- Records evidence. `reason` should be a short fixed name ("Speed", "MeleeRange"), not a
-- free-form string: it becomes an analytics event name. Returns the new score.
function Sanctions.Flag(player: Player, reason: string, weight: number, details: string?): number
	local now = os.clock()
	local entry = suspicion[player]
	if not entry then
		entry = { score = 0, updated = now }
		suspicion[player] = entry
	end
	entry.score = decayedScore(entry, now) + weight
	entry.updated = now

	log(player, `flag {reason} +{weight} -> score {string.format("%.1f", entry.score)} {details or ""}`)
	pcall(function()
		AnalyticsService:LogCustomEvent(player, `AntiCheat_{reason}`, weight)
	end)

	if entry.score >= SecurityConfig.Score.KickAt then
		local ok, why = canEnforce(player)
		if ok then
			log(player, `kicked: score {string.format("%.1f", entry.score)} (last: {reason})`)
			player:Kick("You were disconnected for unusual activity.")
		else
			log(player, `WOULD KICK (score over {SecurityConfig.Score.KickAt}) - not enforced: {why}`)
			entry.score = 0 -- avoid repeating the message every flag
		end
	end
	return entry.score
end

-- Bans through Players:BanAsync with escalating durations. Use only for certain evidence
-- (honeypots, impossible values) or after human review. Yields.
function Sanctions.Ban(player: Player, reason: string, details: string?)
	if banning[player] then
		return
	end
	local ok, why = canEnforce(player)
	if not ok then
		log(player, `WOULD BAN for {reason} - not enforced: {why}. {details or ""}`)
		return
	end
	banning[player] = true

	local config = SecurityConfig.Ban
	local durations = config.DurationsSeconds
	local previousBans = 0
	pcall(function()
		-- First page of history is enough to escalate; unban entries are skipped.
		local pages = Players:GetBanHistoryAsync(player.UserId)
		for _, entry in pages:GetCurrentPage() do
			if typeof(entry) == "table" and (entry :: any).Ban ~= false then
				previousBans += 1
			end
		end
	end)
	local duration = durations[math.min(previousBans + 1, #durations)]

	log(player, `banning for {reason} (offence {previousBans + 1}, duration {duration}s). {details or ""}`)
	pcall(function()
		AnalyticsService:LogCustomEvent(player, `AntiCheatBan_{reason}`, 1)
	end)

	local banned, err = pcall(function()
		Players:BanAsync({
			UserIds = { player.UserId },
			ApplyToUniverse = config.ApplyToUniverse,
			Duration = duration,
			DisplayReason = string.sub(config.DisplayReason, 1, 400),
			PrivateReason = string.sub(`{reason}: {details or ""}`, 1, 1000),
			ExcludeAltAccounts = config.ExcludeAltAccounts,
		})
	end)
	if not banned then
		log(player, `BanAsync failed ({err}); kicking instead`)
		if player.Parent == Players then
			player:Kick("You were disconnected for unusual activity.")
		end
	end
end

return Sanctions
