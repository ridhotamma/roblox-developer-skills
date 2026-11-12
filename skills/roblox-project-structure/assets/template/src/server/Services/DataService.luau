--!strict
-- Owns player persistence. Nothing else in the game touches DataStores.
--
-- ProfileStore gives session locking (a player's data is only ever open on one server, so
-- trading or server hopping cannot duplicate items), periodic autosave and safe shutdown.
-- In Studio without "Enable Studio Access to API Services", ProfileStore uses a mock store
-- and nothing is saved.

local Players = game:GetService("Players")
local ReplicatedStorage = game:GetService("ReplicatedStorage")
local ServerStorage = game:GetService("ServerStorage")

local DataTemplate = require(ReplicatedStorage.Shared.Config.DataTemplate)
local ProfileStore = require(ServerStorage.ServerPackages.ProfileStore)
local Signal = require(ReplicatedStorage.Packages.Signal)
local Types = require(ReplicatedStorage.Shared.Types)

type PlayerData = Types.PlayerData

-- Changing this name starts everyone from scratch. Migrate inside the profile instead.
local STORE_NAME = "PlayerData"

local DataService = {
	-- Fires (player, data) once a player's profile is loaded and safe to use.
	ProfileLoaded = Signal.new(),
}

local store: any
local profiles: { [Player]: any } = {}

local function loadProfile(player: Player)
	local profile = store:StartSessionAsync(`Player_{player.UserId}`, {
		-- Stop retrying if the player left while we were waiting for the session lock.
		Cancel = function()
			return player.Parent ~= Players
		end,
	})

	if profile == nil then
		player:Kick("Your data could not be loaded. Please rejoin.")
		return
	end

	profile:AddUserId(player.UserId) -- GDPR: lets Roblox erasure requests find this key
	profile:Reconcile() -- fill fields added to DataTemplate since this save was written

	profile.OnSessionEnd:Connect(function()
		profiles[player] = nil
		player:Kick("Your data was opened on another server. Please rejoin.")
	end)

	if player.Parent ~= Players then
		profile:EndSession() -- left during loading
		return
	end

	profiles[player] = profile
	DataService.ProfileLoaded:Fire(player, profile.Data)
end

function DataService:Init()
	store = ProfileStore.New(STORE_NAME, DataTemplate)
end

function DataService:Start()
	Players.PlayerAdded:Connect(loadProfile)
	for _, player in Players:GetPlayers() do
		task.spawn(loadProfile, player)
	end

	Players.PlayerRemoving:Connect(function(player)
		local profile = profiles[player]
		if profile then
			profile:EndSession()
		end
	end)
end

-- The live, mutable data table for a loaded player, or nil while loading / after leaving.
-- Only Services should call this, and only the Service that owns a field should write it.
function DataService:Get(player: Player): PlayerData?
	local profile = profiles[player]
	return if profile then profile.Data else nil
end

-- Calls `callback(player, data)` for every player already loaded and every one loaded later.
-- Use this instead of ProfileLoaded so you never miss players who loaded before you connected.
function DataService:ObserveProfiles(callback: (player: Player, data: PlayerData) -> ())
	for player, profile in profiles do
		task.spawn(callback, player, profile.Data)
	end
	return DataService.ProfileLoaded:Connect(callback)
end

return DataService
