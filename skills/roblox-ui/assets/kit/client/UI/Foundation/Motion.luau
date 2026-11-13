--!strict
-- Springs as React bindings: animate any property without re-rendering the component.
--
--   local open = Motion.useSpring(if props.open then 1 else 0)
--   Position = open:map(function(a)
--       return UDim2.fromScale(0.5, Motion.lerp(1.2, 0.5, a))
--   end)
--
-- Animate one number (usually 0 -> 1) and map it onto as many properties as you need. The spring
-- connects to Heartbeat only while it is moving and disconnects when it settles, so idle UI costs
-- nothing per frame. When the player has Reduced Motion on, it jumps straight to the target.
-- Changing the target mid-flight keeps the current velocity, so interrupted animations stay smooth.

local ReplicatedStorage = game:GetService("ReplicatedStorage")
local RunService = game:GetService("RunService")

local React = require(ReplicatedStorage.Packages.React)
local Tokens = require(script.Parent.Parent.Theme.Tokens)
local UiContext = require(script.Parent.UiContext)

local SUBSTEP = 1 / 240 -- fixed small steps keep stiff springs stable at low frame rates
local MAX_FRAME = 0.1 -- after a hitch, don't simulate seconds of motion in one frame
local REST_DISTANCE = 1e-3
local REST_SPEED = 1e-2

export type Motor = { value: number, velocity: number }

local Motion = {}

function Motion.lerp(from: number, to: number, alpha: number): number
	return from + (to - from) * alpha
end

-- Advances a motor toward `target`; returns true once it has settled (and snaps it there).
function Motion.step(motor: Motor, target: number, spring: Tokens.Spring, dt: number): boolean
	local omega = 2 * math.pi * spring.Frequency
	local damping = 2 * spring.Damping * omega
	local stiffness = omega * omega
	local remaining = math.min(dt, MAX_FRAME)
	while remaining > 0 do
		local h = math.min(SUBSTEP, remaining)
		local acceleration = -stiffness * (motor.value - target) - damping * motor.velocity
		motor.velocity += acceleration * h
		motor.value += motor.velocity * h
		remaining -= h
	end
	if math.abs(motor.value - target) < REST_DISTANCE and math.abs(motor.velocity) < REST_SPEED then
		motor.value = target
		motor.velocity = 0
		return true
	end
	return false
end

-- `spring` is a theme spring name ("Snappy", "Bouncy", "Gentle", or one your theme adds) or a
-- { Frequency, Damping } table; default "Snappy". Names follow the theme, so a theme can make
-- the whole UI springier or snappier.
-- `initial` (optional) is where the value starts on mount: useSpring(1, nil, 0) animates in.
function Motion.useSpring(target: number, spring: (Tokens.Spring | string)?, initial: number?): React.Binding<number>
	local ui = UiContext.useUi()
	local springs = ui.theme.springs
	local config: Tokens.Spring = if type(spring) == "table"
		then spring
		else springs[(spring :: string?) or "Snappy"] or springs.Snappy
	local start = if initial ~= nil then initial else target
	local binding, setBinding = React.useBinding(start)
	local motorRef = React.useRef({ value = start, velocity = 0 } :: Motor)

	React.useEffect(function()
		local motor = motorRef.current :: Motor
		if ui.reducedMotion then
			motor.value = target
			motor.velocity = 0
			setBinding(target)
			return nil
		end
		if motor.value == target and motor.velocity == 0 then
			return nil
		end

		local connection: RBXScriptConnection? = nil
		connection = RunService.Heartbeat:Connect(function(dt: number)
			local settled = Motion.step(motor, target, config, dt)
			setBinding(motor.value)
			if settled and connection then
				connection:Disconnect()
				connection = nil
			end
		end)
		return function()
			if connection then
				connection:Disconnect()
			end
		end
	end, { target, config.Frequency, config.Damping, ui.reducedMotion })

	return binding
end

return Motion
