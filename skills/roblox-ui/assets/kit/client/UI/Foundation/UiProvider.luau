--!strict
-- Measures the screen, the player's input and their accessibility settings, and provides the
-- result (UiContext.Ui) with the active theme and palette to everything below. Mount it once,
-- at the root of the app. Pass a different `theme` or `palette` to restyle the whole UI live
-- (a high-contrast setting, a seasonal event): every component re-renders with the new look.
--
-- Live mode measures:
--   * the safe area with a hidden ScreenGui that uses the same insets as our layers, so notches,
--     the home indicator and the Roblox top bar are accounted for (ViewportSize alone is not);
--   * the input with UserInputService.PreferredInput (falls back to last input type on older
--     clients), which changes when a player picks up a gamepad or plugs in a keyboard;
--   * GuiService.ReducedMotionEnabled and GuiService.PreferredTransparency.
-- Everything is event-driven: nothing runs per frame, and consumers re-render only when a value
-- they can see actually changed.
--
-- With `simulate`, it measures nothing and pretends to be a device. Stories use this to preview
-- a screen on a phone, a tablet, a desktop and a TV side by side (Stories/Devices).

local GuiService = game:GetService("GuiService")
local Players = game:GetService("Players")
local ReplicatedStorage = game:GetService("ReplicatedStorage")
local UserInputService = game:GetService("UserInputService")
local Workspace = game:GetService("Workspace")

local React = require(ReplicatedStorage.Packages.React)
local Responsive = require(script.Parent.Responsive)
local Theme = require(script.Parent.Parent.Theme.Theme)
local UiContext = require(script.Parent.UiContext)

export type Simulation = {
	size: Vector2, -- device screen in pixels
	input: Responsive.InputMode,
	tenFoot: boolean?,
	insets: UiContext.Insets?, -- notch / home indicator, pixels
	topbar: number?, -- Roblox top bar height, pixels
	previewScale: number?, -- UIScale the preview applies on top
	reducedMotion: boolean?,
	preferredTransparency: number?,
}

export type Props = {
	simulate: Simulation?,
	theme: Theme.Theme?, -- default: the kit's default theme (App passes your GameTheme)
	palette: string?, -- a palette of the theme; default theme.defaultPalette
	children: any,
}

type Environment = {
	viewport: Vector2,
	safe: Vector2,
	input: Responsive.InputMode,
	tenFoot: boolean,
	reducedMotion: boolean,
	preferredTransparency: number,
}

-- Some properties are newer than some clients (and than older type definitions): read them
-- defensively so the UI still works, with defaults, where they don't exist.
local function readProperty(object: Instance, name: string): any
	local ok, value = pcall(function()
		return (object :: any)[name]
	end)
	return if ok then value else nil
end

local function watchProperty(object: Instance, name: string, callback: () -> ()): RBXScriptConnection?
	local ok, signal = pcall(object.GetPropertyChangedSignal, object, name)
	return if ok then signal:Connect(callback) else nil
end

local HAS_PREFERRED_INPUT = readProperty(UserInputService, "PreferredInput") ~= nil

local function currentInput(): Responsive.InputMode
	local preferred = readProperty(UserInputService, "PreferredInput")
	if typeof(preferred) == "EnumItem" then
		local name = (preferred :: EnumItem).Name
		if name == "Touch" then
			return "Touch"
		elseif name == "Gamepad" then
			return "Gamepad"
		end
		return "Pointer"
	end
	-- Older clients: approximate PreferredInput from the devices present and the last input.
	local last = UserInputService:GetLastInputType()
	if string.find(last.Name, "^Gamepad") then
		return "Gamepad"
	elseif last == Enum.UserInputType.Touch then
		return "Touch"
	-- A touch screen with no keyboard is the closest old-client equivalent of PreferredInput Touch.
	elseif UserInputService.TouchEnabled and not UserInputService.KeyboardEnabled then -- ui:ignore ismobile-check
		return "Touch"
	end
	return "Pointer"
end

local function readEnvironment(probe: Frame?): Environment
	local camera = Workspace.CurrentCamera
	local viewport = if camera then camera.ViewportSize else Vector2.new(1280, 720)
	local safe = if probe and probe.AbsoluteSize.X > 0 then probe.AbsoluteSize else viewport
	local transparency = readProperty(GuiService, "PreferredTransparency")
	return {
		viewport = viewport,
		safe = safe,
		input = currentInput(),
		tenFoot = GuiService:IsTenFootInterface(),
		reducedMotion = readProperty(GuiService, "ReducedMotionEnabled") == true,
		preferredTransparency = if type(transparency) == "number" then transparency else 1,
	}
end

local function sameEnvironment(a: Environment, b: Environment): boolean
	return a.viewport == b.viewport
		and a.safe == b.safe
		and a.input == b.input
		and a.tenFoot == b.tenFoot
		and a.reducedMotion == b.reducedMotion
		and a.preferredTransparency == b.preferredTransparency
end

local function useLiveEnvironment(enabled: boolean): Environment?
	local environment, setEnvironment = React.useState(nil :: Environment?)

	React.useEffect(function()
		if not enabled then
			return nil
		end

		local player = Players.LocalPlayer
		local playerGui = player and player:FindFirstChildOfClass("PlayerGui")

		local probeGui = Instance.new("ScreenGui")
		probeGui.Name = "UiSafeAreaProbe"
		probeGui.ResetOnSpawn = false
		probeGui.ScreenInsets = Enum.ScreenInsets.CoreUISafeInsets
		probeGui.SafeAreaCompatibility = Enum.SafeAreaCompatibility.None
		local probe = Instance.new("Frame")
		probe.Name = "SafeArea"
		probe.Size = UDim2.fromScale(1, 1)
		probe.BackgroundTransparency = 1
		probe.Parent = probeGui
		probeGui.Parent = playerGui

		local function refresh()
			local nextEnvironment = readEnvironment(probe)
			setEnvironment(function(previous: Environment?): Environment?
				if previous and sameEnvironment(previous, nextEnvironment) then
					return previous -- same reference: React skips the re-render
				end
				return nextEnvironment
			end)
		end

		local connections: { RBXScriptConnection } = {}
		local cameraConnection: RBXScriptConnection? = nil
		local function watchCamera()
			if cameraConnection then
				cameraConnection:Disconnect()
				cameraConnection = nil
			end
			local camera = Workspace.CurrentCamera
			if camera then
				cameraConnection = camera:GetPropertyChangedSignal("ViewportSize"):Connect(refresh)
			end
			refresh()
		end

		table.insert(connections, probe:GetPropertyChangedSignal("AbsoluteSize"):Connect(refresh))
		table.insert(connections, Workspace:GetPropertyChangedSignal("CurrentCamera"):Connect(watchCamera))
		if HAS_PREFERRED_INPUT then
			local connection = watchProperty(UserInputService, "PreferredInput", refresh)
			if connection then
				table.insert(connections, connection)
			end
		else
			table.insert(connections, UserInputService.LastInputTypeChanged:Connect(refresh))
		end
		for _, name in { "ReducedMotionEnabled", "PreferredTransparency" } do
			local connection = watchProperty(GuiService, name, refresh)
			if connection then
				table.insert(connections, connection)
			end
		end
		watchCamera()

		return function()
			for _, connection in connections do
				connection:Disconnect()
			end
			if cameraConnection then
				cameraConnection:Disconnect()
			end
			probeGui:Destroy()
		end
	end, { enabled })

	return environment
end

local function simulatedEnvironment(simulation: Simulation): Environment
	local insets = simulation.insets
	local top = (if insets then insets.Top else 0) + (simulation.topbar or 0)
	local bottom = if insets then insets.Bottom else 0
	local left = if insets then insets.Left else 0
	local right = if insets then insets.Right else 0
	return {
		viewport = simulation.size,
		safe = simulation.size - Vector2.new(left + right, top + bottom),
		input = simulation.input,
		tenFoot = simulation.tenFoot == true,
		reducedMotion = simulation.reducedMotion == true,
		preferredTransparency = simulation.preferredTransparency or 1,
	}
end

local function UiProvider(props: Props)
	local simulation = props.simulate
	local live = useLiveEnvironment(simulation == nil)
	local environment = if simulation
		then simulatedEnvironment(simulation)
		else live or readEnvironment(nil) -- first render, before the probe has measured

	local theme = props.theme or Theme.default
	local paletteName = props.palette or theme.defaultPalette
	local insets = if simulation then simulation.insets else nil
	local topbar = if simulation then simulation.topbar or 0 else 0
	local previewScale = if simulation then simulation.previewScale or 1 else 1

	local ui = React.useMemo(function()
		local metrics = Responsive.measure(environment.viewport, environment.safe, environment.input, environment.tenFoot)
		return UiContext.build(metrics, {
			theme = theme,
			palette = paletteName,
			reducedMotion = environment.reducedMotion,
			preferredTransparency = environment.preferredTransparency,
			simulated = simulation ~= nil,
			insets = insets,
			topbar = topbar,
			previewScale = previewScale,
		})
	end, {
		environment.viewport,
		environment.safe,
		environment.input,
		environment.tenFoot,
		environment.reducedMotion,
		environment.preferredTransparency,
		theme,
		paletteName,
		simulation ~= nil,
		insets or false, -- never nil inside a dependency array: a nil hole changes its length
		topbar,
		previewScale,
	})

	return React.createElement(UiContext.Context.Provider, { value = ui }, props.children)
end

return UiProvider
