--!strict
-- Mounts the React UI and connects it to the game. The only module that knows both React and
-- the network: it mirrors server truth into AppState atoms (the Coins attribute CurrencyService
-- sets, Notify toasts) and turns UI actions into remote requests. Screens never touch remotes.
--
-- Other controllers drive the UI through this module's methods (`UiController:Toast(...)`,
-- `UiController:OpenShop()`), never by reaching into React.

local Players = game:GetService("Players")
local ReplicatedStorage = game:GetService("ReplicatedStorage")

local React = require(ReplicatedStorage.Packages.React)
local ReactRoblox = require(ReplicatedStorage.Packages.ReactRoblox)
local App = require(script.Parent.Parent.UI.App)
local AppState = require(script.Parent.Parent.UI.AppState)
local ItemTile = require(script.Parent.Parent.UI.Components.ItemTile)
local Net = require(ReplicatedStorage.Shared.Net)
local Toasts = require(script.Parent.Parent.UI.Components.Toasts)

local COINS_ATTRIBUTE = "Coins" -- set by CurrencyService
local DAILY_READY_ATTRIBUTE = "DailyRewardReady" -- optional: set it on the server to drive the badge
local PURCHASE_REMOTE = "PurchaseItem" -- (itemId: string) declare in Net.REMOTES to enable buying

local UiController = {}

local state: AppState.State
local root: any = nil

function UiController:Init()
	state = AppState.create()
end

function UiController:Start()
	local player = Players.LocalPlayer
	local playerGui = player:WaitForChild("PlayerGui")

	local function syncCoins()
		local coins = player:GetAttribute(COINS_ATTRIBUTE)
		state.coins:set(if typeof(coins) == "number" then coins else 0)
	end
	player:GetAttributeChangedSignal(COINS_ATTRIBUTE):Connect(syncCoins)
	syncCoins()

	local function syncDaily()
		local ready = player:GetAttribute(DAILY_READY_ATTRIBUTE)
		if typeof(ready) == "boolean" then
			state.dailyReady:set(ready)
		end
	end
	player:GetAttributeChangedSignal(DAILY_READY_ATTRIBUTE):Connect(syncDaily)
	syncDaily()

	Net.Event("Notify").OnClientEvent:Connect(function(message: unknown)
		if typeof(message) == "string" then
			Toasts.push(message)
		end
	end)

	local claim = Net.Event("ClaimDailyReward")
	local hasPurchase, purchase = pcall(Net.Event, PURCHASE_REMOTE)
	if not hasPurchase then
		warn(`[UiController] {PURCHASE_REMOTE} is not declared in Net.REMOTES; the shop's Buy button will explain this.`)
	end

	local actions: AppState.Actions = {
		claimDaily = function()
			claim:FireServer()
			state.dailyReady:set(false)
		end,
		buy = function(itemId: string)
			if hasPurchase then
				-- A request: the server checks the price, balance and ownership, then answers
				-- with Notify and updates Coins. Nothing changes here until it does.
				(purchase :: RemoteEvent):FireServer(itemId)
			else
				Toasts.push(`Declare {PURCHASE_REMOTE} in Net.REMOTES to enable buying`, "Danger")
			end
		end,
	}

	-- Render into a Folder root and portal into PlayerGui: React then manages only its own
	-- ScreenGuis and leaves anything else in PlayerGui alone.
	root = ReactRoblox.createRoot(Instance.new("Folder"))
	root:render(ReactRoblox.createPortal(React.createElement(App, { state = state, actions = actions }), playerGui))
end

function UiController:OpenShop()
	state.shopOpen:set(true)
end

function UiController:CloseShop()
	state.shopOpen:set(false)
end

function UiController:Toast(message: string, tone: Toasts.Tone?)
	Toasts.push(message, tone)
end

-- Feed these from your inventory / catalogue replication.
function UiController:SetOwned(itemIds: { string })
	local owned = {}
	for _, id in itemIds do
		owned[id] = true
	end
	state.owned:set(owned)
end

function UiController:SetItems(items: { ItemTile.Item })
	state.items:set(items)
end

-- For tests and hot-reload tools: tears the whole UI down cleanly.
function UiController:Unmount()
	if root then
		root:unmount()
		root = nil
	end
end

return UiController
