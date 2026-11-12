--!strict
-- Drives the car the local player sits in (as driver):
--   * input from the VehicleSeat (keyboard WASD/arrows, gamepad stick, mobile thumbstick all
--     come for free), plus handbrake on LeftShift / gamepad X / a touch button
--   * runs VehicleSim every physics step (the server gave this client network ownership)
--   * speed-dependent field of view and a small HUD: speed, gear, rpm bar
--   * Reset (R / gamepad Y / touch button) puts the car back on its wheels, with a cooldown
--   * drift score: points build while sliding (angle x speed), banked shortly after the slide
--     ends; reset by a spin-out or a stuck assist. Cosmetic here: validate on the server
--     before rewarding anything (see references/drifting.md).
-- When the player leaves the seat the sim stops and the server takes the car back.

local ContextActionService = game:GetService("ContextActionService")
local Players = game:GetService("Players")
local ReplicatedStorage = game:GetService("ReplicatedStorage")
local RunService = game:GetService("RunService")

local VehicleSim = require(ReplicatedStorage.Shared.Vehicle.VehicleSim)
local VehicleSpecs = require(ReplicatedStorage.Shared.Vehicle.VehicleSpecs)

local USE_MPH = false -- HUD units
local FOV_BOOST = 14 -- extra degrees of field of view at high speed
local FOV_BOOST_KMH = 220
local RESET_COOLDOWN = 3
local DRIFT_BANK_DELAY = 1.2 -- seconds after a drift ends before its points are banked

local player = Players.LocalPlayer

local VehicleController = {}

local session: {
	sim: VehicleSim.VehicleSim,
	seat: VehicleSeat,
	spec: any,
	connection: RBXScriptConnection,
	baseFov: number,
	gui: ScreenGui,
}? = nil
local handbrake = false

local function buildHud(): (ScreenGui, TextLabel, TextLabel, Frame, TextLabel)
	local gui = Instance.new("ScreenGui")
	gui.Name = "VehicleHud"
	gui.ResetOnSpawn = false
	local panel = Instance.new("Frame")
	panel.AnchorPoint = Vector2.new(1, 1)
	panel.Position = UDim2.new(1, -20, 1, -20)
	panel.Size = UDim2.fromOffset(190, 92)
	panel.BackgroundColor3 = Color3.fromRGB(15, 17, 22)
	panel.BackgroundTransparency = 0.25
	panel.Parent = gui
	local corner = Instance.new("UICorner")
	corner.CornerRadius = UDim.new(0, 12)
	corner.Parent = panel

	local speed = Instance.new("TextLabel")
	speed.BackgroundTransparency = 1
	speed.Position = UDim2.fromOffset(12, 6)
	speed.Size = UDim2.fromOffset(120, 50)
	speed.Font = Enum.Font.GothamBlack
	speed.TextScaled = true
	speed.TextXAlignment = Enum.TextXAlignment.Left
	speed.TextColor3 = Color3.new(1, 1, 1)
	speed.Parent = panel

	local gear = Instance.new("TextLabel")
	gear.BackgroundTransparency = 1
	gear.Position = UDim2.new(1, -56, 0, 10)
	gear.Size = UDim2.fromOffset(44, 44)
	gear.Font = Enum.Font.GothamBold
	gear.TextScaled = true
	gear.TextColor3 = Color3.fromRGB(255, 196, 61)
	gear.Parent = panel

	local bar = Instance.new("Frame")
	bar.Position = UDim2.new(0, 12, 1, -22)
	bar.Size = UDim2.new(1, -24, 0, 8)
	bar.BackgroundColor3 = Color3.fromRGB(45, 50, 62)
	bar.BorderSizePixel = 0
	bar.Parent = panel
	local fill = Instance.new("Frame")
	fill.Size = UDim2.fromScale(0, 1)
	fill.BackgroundColor3 = Color3.fromRGB(90, 200, 120)
	fill.BorderSizePixel = 0
	fill.Parent = bar

	local drift = Instance.new("TextLabel")
	drift.AnchorPoint = Vector2.new(0.5, 0)
	drift.Position = UDim2.new(0.5, 0, 0, 90)
	drift.Size = UDim2.fromOffset(320, 48)
	drift.BackgroundTransparency = 1
	drift.Font = Enum.Font.GothamBlack
	drift.TextScaled = true
	drift.TextColor3 = Color3.fromRGB(255, 196, 61)
	drift.TextStrokeTransparency = 0.3
	drift.Text = ""
	drift.Parent = gui

	gui.Parent = player:WaitForChild("PlayerGui")
	return gui, speed, gear, fill, drift
end

local function stop()
	local s = session
	if not s then
		return
	end
	session = nil
	s.connection:Disconnect()
	s.sim:Destroy()
	s.gui:Destroy()
	ContextActionService:UnbindAction("VehicleHandbrake")
	ContextActionService:UnbindAction("VehicleReset")
	local camera = workspace.CurrentCamera
	if camera then
		camera.FieldOfView = s.baseFov
	end
	handbrake = false
end

local function start(seat: VehicleSeat, model: Model)
	stop()
	local sim = VehicleSim.new(model)
	local spec = (VehicleSpecs :: any)[model:GetAttribute("Vehicle")]
	if not sim or not spec then
		return
	end
	local camera = workspace.CurrentCamera
	local gui, speedLabel, gearLabel, rpmFill, driftLabel = buildHud()

	ContextActionService:BindAction("VehicleHandbrake", function(_, state)
		handbrake = state == Enum.UserInputState.Begin or state == Enum.UserInputState.Change
		return Enum.ContextActionResult.Sink
	end, true, Enum.KeyCode.LeftShift, Enum.KeyCode.ButtonX)
	ContextActionService:SetTitle("VehicleHandbrake", "Drift")
	ContextActionService:SetPosition("VehicleHandbrake", UDim2.new(1, -150, 1, -150))

	local lastReset = -math.huge
	ContextActionService:BindAction("VehicleReset", function(_, state)
		if state == Enum.UserInputState.Begin and os.clock() - lastReset >= RESET_COOLDOWN then
			lastReset = os.clock()
			sim:Recover()
		end
		return Enum.ContextActionResult.Sink
	end, true, Enum.KeyCode.R, Enum.KeyCode.ButtonY)
	ContextActionService:SetTitle("VehicleReset", "Reset")
	ContextActionService:SetPosition("VehicleReset", UDim2.new(1, -230, 1, -190))

	local driftPoints, bankedPoints, sinceDrift = 0, 0, 0
	local connection = RunService.PreSimulation:Connect(function(dt)
		local t = sim:Step(dt, { Throttle = seat.ThrottleFloat, Steer = seat.SteerFloat, Handbrake = handbrake })

		-- Drift score: angle x speed while sliding; a spin-out (way past the max angle) or a
		-- stuck assist loses the current drift, a clean exit banks it.
		if t.Drifting then
			sinceDrift = 0
			driftPoints += math.abs(t.DriftAngle) * math.abs(t.SpeedKmh) * dt * 0.05
			if math.abs(t.DriftAngle) > spec.Drift.MaxAngle + 25 or t.Stuck then
				driftPoints = 0
			end
		elseif driftPoints > 0 then
			sinceDrift += dt
			if sinceDrift >= DRIFT_BANK_DELAY then
				bankedPoints += math.floor(driftPoints)
				driftPoints = 0
			end
		end
		driftLabel.Text = if driftPoints >= 1
			then `DRIFT +{math.floor(driftPoints)}`
			elseif bankedPoints > 0 then `{bankedPoints} pts`
			else ""
		local kmh = math.abs(t.SpeedKmh)
		speedLabel.Text = if USE_MPH then `{math.floor(kmh / 1.609)} mph` else `{math.floor(kmh)} km/h`
		gearLabel.Text = if t.Gear < 0 then "R" else tostring(t.Gear)
		local rpmFraction = math.clamp(t.Rpm / spec.Engine.RedlineRpm, 0, 1)
		rpmFill.Size = UDim2.fromScale(rpmFraction, 1)
		local redZone = rpmFraction > 0.9
		rpmFill.BackgroundColor3 = if redZone then Color3.fromRGB(255, 80, 70) else Color3.fromRGB(90, 200, 120)
		if camera then
			local target = (session and session.baseFov or 70) + FOV_BOOST * math.clamp(kmh / FOV_BOOST_KMH, 0, 1)
			camera.FieldOfView += (target - camera.FieldOfView) * math.min(1, dt * 3)
		end
	end)

	session = {
		sim = sim,
		seat = seat,
		spec = spec,
		connection = connection,
		baseFov = if camera then camera.FieldOfView else 70,
		gui = gui,
	}
end

local function onSeated(humanoid: Humanoid)
	local seat = humanoid.SeatPart
	if seat and seat:IsA("VehicleSeat") and seat:GetAttribute("DriverSeat") then
		local model = seat:FindFirstAncestorWhichIsA("Model")
		while model and model:GetAttribute("Vehicle") == nil do
			model = model:FindFirstAncestorWhichIsA("Model")
		end
		if model then
			start(seat, model)
			return
		end
	end
	stop()
end

function VehicleController:Start()
	local function onCharacter(character: Model)
		stop()
		local humanoid = character:WaitForChild("Humanoid") :: Humanoid
		humanoid:GetPropertyChangedSignal("SeatPart"):Connect(function()
			onSeated(humanoid)
		end)
		humanoid.Died:Connect(stop)
	end
	player.CharacterAdded:Connect(onCharacter)
	if player.Character then
		task.spawn(onCharacter, player.Character)
	end
end

return VehicleController
