--!strict
-- The root of the UI: the provider (with the active theme and palette), then every screen and
-- layer. Screens read atoms here and get plain props, so each screen stays a pure function of
-- its props (easy to preview and test). Setting the theme or palette atom restyles everything.
--
-- To add a screen: write it in Screens/, give it an atom for "is it open" in AppState if it is a
-- menu, and mount it here. Only App knows about AppState; screens don't.

local ReplicatedStorage = game:GetService("ReplicatedStorage")

local React = require(ReplicatedStorage.Packages.React)
local AppState = require(script.Parent.AppState)
local Atom = require(script.Parent.Foundation.Atom)
local HudScreen = require(script.Parent.Screens.HudScreen)
local ShopScreen = require(script.Parent.Screens.ShopScreen)
local Toasts = require(script.Parent.Components.Toasts)
local UiProvider = require(script.Parent.Foundation.UiProvider)

local e = React.createElement

export type Props = {
	state: AppState.State,
	actions: AppState.Actions,
	simulate: UiProvider.Simulation?,
}

local function Screens(props: Props)
	local state = props.state
	local coins = Atom.use(state.coins)
	local dailyReady = Atom.use(state.dailyReady)
	local shopOpen = Atom.use(state.shopOpen)
	local owned = Atom.use(state.owned)
	local items = Atom.use(state.items)

	local openShop = React.useCallback(function()
		state.shopOpen:set(true)
	end, { state })
	local closeShop = React.useCallback(function()
		state.shopOpen:set(false)
	end, { state })

	-- The HUD's menu buttons, most important first. What doesn't fit on a small screen moves
	-- into a More button (priority decides what stays); `show` rules drop an action where it
	-- doesn't belong. Add your game's menus here.
	local hudActions: { HudScreen.Action } = React.useMemo(function(): { HudScreen.Action }
		return {
			{ id = "Shop", text = "Shop", variant = "Primary", hint = Enum.KeyCode.ButtonY, onActivate = openShop },
			{
				id = "Daily",
				text = "Daily",
				hint = Enum.KeyCode.ButtonX,
				badge = dailyReady == true,
				onActivate = props.actions.claimDaily,
			},
		}
	end, { openShop, dailyReady, props.actions } :: { any })

	return e(React.Fragment, nil, {
		Hud = e(HudScreen, {
			coins = coins,
			actions = hudActions,
			shortcuts = not shopOpen,
			onOpenShop = openShop,
		}),
		Shop = e(ShopScreen, {
			open = shopOpen,
			items = items,
			coins = coins,
			owned = owned,
			onBuy = props.actions.buy,
			onClose = closeShop,
		}),
		Toasts = e(Toasts.Host),
	})
end

local function App(props: Props)
	local theme = Atom.use(props.state.theme)
	local palette = Atom.use(props.state.palette)
	return e(UiProvider, { theme = theme, palette = palette, simulate = props.simulate }, {
		Screens = e(Screens, props),
	})
end

return App
