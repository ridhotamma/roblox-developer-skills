--!strict
-- One ScreenGui per layer of the UI (HUD, menus, modals, toasts, loading). Layers stack by
-- DisplayOrder from Tokens.Layers, so a toast is always above a modal whatever mounts first.
--
-- insets:
--   "Safe"   (default) clear of the Roblox top bar, notches and the home indicator. Use for
--            anything the player reads or touches.
--   "Device" clear of notches only, under the top bar. Full-width bars and backdrops that
--            should reach the top edge.
--   "Topbar" the strip beside the Roblox top-bar buttons, for a top-bar style button row.
--   "None"   the whole screen. Backdrops, scrims and loading art only; never put text or
--            buttons here, phones will cut them off.
--
-- In a story the UI renders inside a plugin widget where ScreenGuis can't draw, so a Layer
-- becomes a full-size Frame that applies the simulated insets instead.

local ReplicatedStorage = game:GetService("ReplicatedStorage")

local React = require(ReplicatedStorage.Packages.React)
local Tokens = require(script.Parent.Parent.Theme.Tokens)
local UiContext = require(script.Parent.Parent.Foundation.UiContext)

local e = React.createElement

export type Insets = "Safe" | "Device" | "Topbar" | "None"

export type Props = {
	name: string,
	order: number?, -- a Tokens.Layers value
	insets: Insets?,
	enabled: any?, -- boolean or Binding<boolean>; a disabled layer neither draws nor takes input
	children: any,
}

local SCREEN_INSETS: { [Insets]: Enum.ScreenInsets } = {
	Safe = Enum.ScreenInsets.CoreUISafeInsets,
	Device = Enum.ScreenInsets.DeviceSafeInsets,
	Topbar = Enum.ScreenInsets.TopbarSafeInsets,
	None = Enum.ScreenInsets.None,
}

local function simulatedFrame(props: Props, ui: UiContext.Ui, insets: Insets)
	local i = ui.insets
	local top, bottom, left, right = 0, 0, 0, 0
	if insets == "Safe" then
		top, bottom, left, right = i.Top + ui.topbar, i.Bottom, i.Left, i.Right
	elseif insets == "Device" then
		top, bottom, left, right = i.Top, i.Bottom, i.Left, i.Right
	elseif insets == "Topbar" then
		top, left, right = i.Top, i.Left, i.Right
	end
	local height = if insets == "Topbar" then UDim.new(0, ui.topbar) else UDim.new(1, -(top + bottom))
	return e("Frame", {
		Name = props.name,
		Size = UDim2.new(UDim.new(1, -(left + right)), height),
		Position = UDim2.fromOffset(left, top),
		BackgroundTransparency = 1,
		ZIndex = (props.order or Tokens.Layers.Hud) + 1,
		Visible = if props.enabled == nil then true else props.enabled,
	}, props.children)
end

local function Layer(props: Props)
	local ui = UiContext.useUi()
	local insets: Insets = props.insets or "Safe"

	if ui.simulated then
		return simulatedFrame(props, ui, insets)
	end

	return e("ScreenGui", {
		-- react-lua names Instances after their key (or the nearest ancestor's); an explicit Name
		-- keeps PlayerGui readable when several screens use the same component.
		Name = props.name,
		DisplayOrder = props.order or Tokens.Layers.Hud,
		ScreenInsets = SCREEN_INSETS[insets],
		SafeAreaCompatibility = Enum.SafeAreaCompatibility.None,
		ResetOnSpawn = false, -- React owns this UI; respawning must not delete it
		ZIndexBehavior = Enum.ZIndexBehavior.Sibling,
		Enabled = if props.enabled == nil then true else props.enabled,
	}, props.children)
end

return Layer
