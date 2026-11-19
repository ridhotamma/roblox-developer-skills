--!strict
-- Server side of the music kit. Music plays on each client (every player hears their own mix);
-- the server only sets attributes that MusicController reads, so it costs one attribute
-- replication per change and needs no remotes:
--
--   MusicService:SetState("boss", 0.6)                 everyone: boss music (a source, Priority applies)
--   MusicService:SetState(nil)                         clear it
--   MusicService:SetPlayerState(player, "chase", 0.8)  one player (their wanted level, their fight)
--   MusicService:SetBase("silence")                    the resting state (lobby, intermission...)
--   MusicService:Stinger("victory")                    everyone; :Stinger("fail", player) for one

local ReplicatedStorage = game:GetService("ReplicatedStorage")

local MusicConfig = require(ReplicatedStorage.Shared.Music.MusicConfig)

local attrs = MusicConfig.Attributes
local MusicService = {}

local stingerCounter = 0

local function check(state: string?)
	if state ~= nil and not MusicConfig.States[state] then
		error(`[MusicService] unknown music state '{state}'`, 3)
	end
end

function MusicService:SetState(state: string?, intensity: number?)
	check(state)
	workspace:SetAttribute(attrs.Intensity, if state then math.clamp(intensity or 0, 0, 1) else nil)
	workspace:SetAttribute(attrs.State, state)
end

function MusicService:SetPlayerState(player: Player, state: string?, intensity: number?)
	check(state)
	player:SetAttribute(attrs.Intensity, if state then math.clamp(intensity or 0, 0, 1) else nil)
	player:SetAttribute(attrs.State, state)
end

function MusicService:SetBase(state: string?)
	check(state)
	workspace:SetAttribute(attrs.Base, state)
end

function MusicService:Stinger(name: string, player: Player?)
	stingerCounter += 1
	local value = `{name}#{stingerCounter}`
	if player then
		player:SetAttribute(attrs.Stinger, value)
	else
		workspace:SetAttribute(attrs.Stinger, value)
	end
end

return MusicService
