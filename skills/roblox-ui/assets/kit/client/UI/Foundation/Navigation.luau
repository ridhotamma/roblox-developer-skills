--!strict
-- Gamepad and keyboard navigation that lives exactly as long as the component that needs it.
--
--   Navigation.useShortcut({ Enum.KeyCode.ButtonB }, props.onClose, props.open)  -- B closes
--   Navigation.useFocus(panelRef, props.open)  -- gamepad selection jumps into the panel
--
-- Shortcuts bind through ContextActionService above the default character controls, so while a
-- menu is open its buttons win, and the key goes back to the game when it closes. Don't bind
-- Escape: Roblox reserves it for its own menu. Always keep a visible button for every shortcut,
-- since touch players have no keys.

local ContextActionService = game:GetService("ContextActionService")
local GuiService = game:GetService("GuiService")
local ReplicatedStorage = game:GetService("ReplicatedStorage")

local React = require(ReplicatedStorage.Packages.React)
local UiContext = require(script.Parent.UiContext)

local PRIORITY = Enum.ContextActionPriority.High.Value

local nextActionId = 0

local Navigation = {}

function Navigation.useShortcut(keys: { Enum.KeyCode }, handler: (() -> ())?, enabled: boolean?)
	local ui = UiContext.useUi()
	local handlerRef = React.useRef(handler)
	handlerRef.current = handler

	-- Stories run in edit mode: never bind real input there.
	local active = handler ~= nil and enabled ~= false and not ui.simulated
	local names = {}
	for _, key in keys do
		table.insert(names, key.Name)
	end
	local keySignature = table.concat(names, ",")

	React.useEffect(function()
		if not active then
			return nil
		end
		nextActionId += 1
		local actionName = `UiShortcut{nextActionId}`
		ContextActionService:BindActionAtPriority(actionName, function(_, state: Enum.UserInputState)
			if state ~= Enum.UserInputState.Begin then
				return Enum.ContextActionResult.Pass
			end
			local current = handlerRef.current
			if current then
				current()
			end
			return Enum.ContextActionResult.Sink
		end, false, PRIORITY, table.unpack(keys))
		return function()
			ContextActionService:UnbindAction(actionName)
		end
	end, { active, keySignature })
end

-- While `active` and the player is on a gamepad, move selection to the first selectable object
-- inside `ref` (a menu that opens without doing this is unusable on console), and give selection
-- back to wherever it was when the menu closes.
function Navigation.useFocus(ref: { current: any }, active: boolean)
	local ui = UiContext.useUi()
	local onGamepad = ui.input == "Gamepad" and not ui.simulated

	React.useEffect(function()
		local container = ref.current
		if not (active and onGamepad and container) then
			return nil
		end
		local previous = GuiService.SelectedObject
		GuiService:Select(container)
		return function()
			local selected = GuiService.SelectedObject
			if selected and selected:IsDescendantOf(container) then
				GuiService.SelectedObject = if previous and previous.Parent then previous else nil
			end
		end
	end, { active, onGamepad })
end

return Navigation
