--!strict
-- Roblox draws its own UI over every ScreenGui: the chat window (top left), the player list (top
-- right), the backpack hotbar (bottom centre), the emotes menu, and the touch thumbstick and jump
-- button. This module keeps the kit's UI and Roblox's out of each other's way:
--
--   CoreUi.useHidden({ Enum.CoreGuiType.Backpack }, open)
--       Hides core UI while `open` (a full-screen sheet on a phone that the hotbar would cover),
--       and restores exactly what it hid when it closes or unmounts. Requests are counted per
--       type, so two menus never fight, and a type the game had already disabled (a custom
--       inventory that turns the Backpack off for good) is never switched back on.
--   CoreUi.chatWindow()
--       Where the default TextChatService chat window is, in screen pixels, or nil when there is
--       none. UiProvider turns it into `ui.chatWindow` (relative to the Safe layer) so the HUD can
--       move clear of it.
--
-- Never call StarterGui:SetCoreGuiEnabled(type, true) to "restore" core UI by hand: it re-enables
-- things another system turned off. Go through useHidden.

local ReplicatedStorage = game:GetService("ReplicatedStorage")
local StarterGui = game:GetService("StarterGui")
local TextChatService = game:GetService("TextChatService")

local React = require(ReplicatedStorage.Packages.React)
local Responsive = require(script.Parent.Responsive)
local UiContext = require(script.Parent.UiContext)

export type Rect = Responsive.Rect

local CoreUi = {}

local requests: { [Enum.CoreGuiType]: number? } = {}
local hiddenByUs: { [Enum.CoreGuiType]: boolean } = {}
local listeners: { [() -> ()]: boolean } = {}

local function notify()
	for listener in listeners do
		task.spawn(listener)
	end
end

local function isEnabled(coreGuiType: Enum.CoreGuiType): boolean
	local ok, enabled = pcall(StarterGui.GetCoreGuiEnabled, StarterGui, coreGuiType)
	return not ok or enabled == true
end

local function setEnabled(coreGuiType: Enum.CoreGuiType, enabled: boolean)
	pcall(StarterGui.SetCoreGuiEnabled, StarterGui, coreGuiType, enabled)
end

local function acquire(coreGuiType: Enum.CoreGuiType)
	local count = requests[coreGuiType] or 0
	requests[coreGuiType] = count + 1
	if count == 0 and isEnabled(coreGuiType) then
		hiddenByUs[coreGuiType] = true
		setEnabled(coreGuiType, false)
		notify()
	end
end

local function release(coreGuiType: Enum.CoreGuiType)
	local count = (requests[coreGuiType] or 1) - 1
	requests[coreGuiType] = if count > 0 then count else nil
	if count <= 0 and hiddenByUs[coreGuiType] then
		hiddenByUs[coreGuiType] = nil
		setEnabled(coreGuiType, true)
		notify()
	end
end

-- Calls `listener` (deferred) whenever useHidden changes what core UI is shown. Returns the
-- disconnect function.
function CoreUi.onChanged(listener: () -> ()): () -> ()
	listeners[listener] = true
	return function()
		listeners[listener] = nil
	end
end

function CoreUi.isEnabled(coreGuiType: Enum.CoreGuiType): boolean
	return isEnabled(coreGuiType)
end

-- Hides `types` while `active`. Does nothing in stories (they run in Studio's edit mode).
function CoreUi.useHidden(types: { Enum.CoreGuiType }, active: boolean)
	local ui = UiContext.useUi()
	local enabled = active and not ui.simulated and #types > 0
	local names = {}
	for _, coreGuiType in types do
		table.insert(names, coreGuiType.Name)
	end
	local signature = table.concat(names, ",")

	React.useEffect(function()
		if not enabled then
			return nil
		end
		local held = table.clone(types)
		for _, coreGuiType in held do
			acquire(coreGuiType)
		end
		return function()
			for _, coreGuiType in held do
				release(coreGuiType)
			end
		end
	end, { enabled, signature })
end

-- Reads a property that may be newer than the client or the type definitions.
local function read(object: Instance, name: string): any
	local ok, value = pcall(function()
		return (object :: any)[name]
	end)
	return if ok then value else nil
end

-- The default chat window in screen pixels (the same space as GuiObject.AbsolutePosition), or
-- nil when the game uses no default chat window or it is turned off.
function CoreUi.chatWindow(): Rect?
	if not isEnabled(Enum.CoreGuiType.Chat) then
		return nil
	end
	local config = TextChatService:FindFirstChildOfClass("ChatWindowConfiguration")
	if config == nil or read(config, "Enabled") ~= true then
		return nil
	end
	local position = read(config, "AbsolutePosition")
	local size = read(config, "AbsoluteSize")
	if typeof(position) ~= "Vector2" or typeof(size) ~= "Vector2" then
		return nil
	end
	local area = size :: Vector2
	if area.X <= 0 or area.Y <= 0 then
		return nil
	end
	return { position = position :: Vector2, size = area }
end

-- Calls `callback` whenever the chat window moves, resizes, or is turned on or off. Returns the
-- connections to disconnect.
function CoreUi.watchChatWindow(callback: () -> ()): { RBXScriptConnection }
	local connections: { RBXScriptConnection } = {}
	local config = TextChatService:FindFirstChildOfClass("ChatWindowConfiguration")
	if config then
		for _, name in { "Enabled", "AbsolutePosition", "AbsoluteSize" } do
			local ok, signal = pcall(config.GetPropertyChangedSignal, config, name)
			if ok then
				table.insert(connections, signal:Connect(callback))
			end
		end
	end
	return connections
end

return CoreUi
