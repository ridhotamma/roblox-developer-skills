--!strict
-- Drives the vehicle the local player sits in (as driver), for every vehicle type:
--   * input from the VehicleSeat (keyboard WASD/arrows, gamepad stick, mobile thumbstick come for
--     free) plus per-type actions (keyboard, gamepad, touch buttons), bound at High priority so
--     they win over default bindings (R2/L2 stop feeding the seat's throttle in aircraft)
--   * runs the vehicle's sim every physics step (the server gave this client network ownership)
--   * speed-dependent field of view and a small HUD per type
--   * Reset (R / gamepad Y / touch) puts the vehicle back on its wheels or keel, with a cooldown
--   * tells the server what others should see (engine throttle, landing gear, flaps, turret aim,
--     horn), bike crashes (the rider is thrown off) and tank shots, through the VehicleControl remote
--
-- Controls (see references/vehicle-setup.md §6):
--   Car         W/S throttle-brake, A/D steer, LeftShift / X handbrake ("Drift")
--   Motorcycle  W/S, A/D (lean), LeftShift / X rear brake, Q / L1 lean back (wheelie), E / R1 lean forward
--   Boat        W/S throttle-reverse, A/D helm
--   Plane       W/S pitch (W = nose down), A/D roll, Q/E / L1-R1 rudder, LeftShift / R2 throttle up
--               (hold at full = afterburner), LeftCtrl / L2 throttle down (and wheel brakes),
--               G / D-pad down gear, F / D-pad up flaps
--   Helicopter  W/S pitch (fly forward / back), A/D yaw (turn), Q/E / L1-R1 roll (strafe),
--               LeftShift / R2 up, LeftCtrl / L2 down
--   Tank        W/S throttle-reverse, A/D steer (pivots when stopped), the camera aims the turret,
--               left click / R1 / touch "Fire" fires
--   Train       W power (hold to notch up), S brake (S when stopped reverses), LeftShift / X
--               emergency brake, H / L1 horn, R / Y puts a derailed train back on the rails
-- The drift score (cars) is cosmetic: validate on the server before rewarding anything.

local ContextActionService = game:GetService("ContextActionService")
local Players = game:GetService("Players")
local ReplicatedStorage = game:GetService("ReplicatedStorage")
local RunService = game:GetService("RunService")

local Sims = require(ReplicatedStorage.Shared.Vehicle.Sims)

local USE_MPH = false -- HUD units for cars, bikes and helicopters; boats show knots, planes km/h
local RESET_COOLDOWN = 3
local DRIFT_BANK_DELAY = 1.2 -- seconds after a drift ends before its points are banked
local AIM_FLIGHT = false -- planes: with the stick centred, fly toward where the camera looks
local CONTROL_HZ = 8
local HIGH = Enum.ContextActionPriority.High.Value
local FOV_BOOST = { Car = { 14, 220 }, Motorcycle = { 16, 220 }, Boat = { 10, 90 }, Plane = { 10, 700 }, Helicopter = { 8, 250 }, Tank = { 6, 70 }, Train = { 8, 200 } }

local player = Players.LocalPlayer

local VehicleController = {}

type Hud = { gui: ScreenGui, speed: TextLabel, badge: TextLabel, fill: Frame, info: TextLabel, banner: TextLabel }

local session: {
	sim: any,
	kind: string,
	seat: VehicleSeat,
	model: Model,
	spec: any,
	connection: RBXScriptConnection,
	baseFov: number,
	hud: Hud,
	actions: { string },
}? = nil

local held = {
	handbrake = false,
	leanBack = false,
	leanForward = false,
	yawLeft = false,
	yawRight = false,
	rollLeft = false,
	rollRight = false,
	powerUp = false,
	powerDown = false,
	fire = false,
	horn = false,
}
local toggles = { gearDown = true, flaps = false }

local function label(parent: Instance, position: UDim2, size: UDim2, font: Enum.Font, color: Color3): TextLabel
	local l = Instance.new("TextLabel")
	l.BackgroundTransparency = 1
	l.Position = position
	l.Size = size
	l.Font = font
	l.TextScaled = true
	l.TextXAlignment = Enum.TextXAlignment.Left
	l.TextColor3 = color
	l.Text = ""
	l.Parent = parent
	return l
end

local function buildHud(): Hud
	local gui = Instance.new("ScreenGui")
	gui.Name = "VehicleHud"
	gui.ResetOnSpawn = false
	local panel = Instance.new("Frame")
	panel.AnchorPoint = Vector2.new(1, 1)
	panel.Position = UDim2.new(1, -20, 1, -20)
	panel.Size = UDim2.fromOffset(210, 112)
	panel.BackgroundColor3 = Color3.fromRGB(15, 17, 22)
	panel.BackgroundTransparency = 0.25
	panel.Parent = gui
	local corner = Instance.new("UICorner")
	corner.CornerRadius = UDim.new(0, 12)
	corner.Parent = panel

	local speed = label(panel, UDim2.fromOffset(12, 6), UDim2.fromOffset(140, 46), Enum.Font.GothamBlack, Color3.new(1, 1, 1))
	local badge = label(panel, UDim2.new(1, -62, 0, 10), UDim2.fromOffset(52, 36), Enum.Font.GothamBold, Color3.fromRGB(255, 196, 61))
	badge.TextXAlignment = Enum.TextXAlignment.Right
	local info = label(panel, UDim2.fromOffset(12, 56), UDim2.new(1, -24, 0, 18), Enum.Font.GothamMedium, Color3.fromRGB(200, 205, 215))

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

	local banner = label(gui, UDim2.new(0.5, 0, 0, 90), UDim2.fromOffset(360, 48), Enum.Font.GothamBlack, Color3.fromRGB(255, 196, 61))
	banner.AnchorPoint = Vector2.new(0.5, 0)
	banner.TextXAlignment = Enum.TextXAlignment.Center
	banner.TextStrokeTransparency = 0.3

	gui.Parent = player:WaitForChild("PlayerGui")
	return { gui = gui, speed = speed, badge = badge, fill = fill, info = info, banner = banner }
end

local function stop()
	local s = session
	if not s then
		return
	end
	session = nil
	s.connection:Disconnect()
	s.sim:Destroy()
	s.hud.gui:Destroy()
	s.model:SetAttribute("LocalAim", nil)
	for _, name in s.actions do
		ContextActionService:UnbindAction(name)
	end
	local camera = workspace.CurrentCamera
	if camera then
		camera.FieldOfView = s.baseFov
	end
	for key in held do
		(held :: any)[key] = false
	end
end

local function axis(positive: boolean, negative: boolean): number
	return (if positive then 1 else 0) - (if negative then 1 else 0)
end

local function speedText(kmh: number, kind: string): string
	if kind == "Boat" then
		return `{math.floor(kmh / 1.852)} kn`
	elseif USE_MPH and kind ~= "Plane" then
		return `{math.floor(kmh / 1.609)} mph`
	end
	return `{math.floor(kmh)} km/h`
end

local function start(seat: VehicleSeat, model: Model)
	stop()
	local sim, kind = Sims.new(model)
	local spec = Sims.Spec(model)
	if not sim or not kind or not spec then
		return
	end
	local camera = workspace.CurrentCamera
	local hud = buildHud()
	local actions: { string } = {}

	local function hold(name: string, key: string, title: string?, position: UDim2?, ...: Enum.KeyCode | Enum.UserInputType)
		ContextActionService:BindActionAtPriority(name, function(_, state)
			(held :: any)[key] = state == Enum.UserInputState.Begin or state == Enum.UserInputState.Change
			return Enum.ContextActionResult.Sink
		end, title ~= nil, HIGH, ...)
		if title then
			ContextActionService:SetTitle(name, title)
			if position then
				ContextActionService:SetPosition(name, position)
			end
		end
		table.insert(actions, name)
	end
	local function press(name: string, fn: () -> (), title: string?, position: UDim2?, ...: Enum.KeyCode)
		ContextActionService:BindActionAtPriority(name, function(_, state)
			if state == Enum.UserInputState.Begin then
				fn()
			end
			return Enum.ContextActionResult.Sink
		end, title ~= nil, HIGH, ...)
		if title then
			ContextActionService:SetTitle(name, title)
			if position then
				ContextActionService:SetPosition(name, position)
			end
		end
		table.insert(actions, name)
	end

	local lastReset = -math.huge
	press("VehicleReset", function()
		if os.clock() - lastReset >= RESET_COOLDOWN then
			lastReset = os.clock()
			sim:Recover()
		end
	end, "Reset", UDim2.new(1, -230, 1, -190), Enum.KeyCode.R, Enum.KeyCode.ButtonY)

	if kind == "Car" then
		hold("VehicleHandbrake", "handbrake", "Drift", UDim2.new(1, -150, 1, -150), Enum.KeyCode.LeftShift, Enum.KeyCode.ButtonX)
	elseif kind == "Motorcycle" then
		hold("VehicleHandbrake", "handbrake", "Brake", UDim2.new(1, -150, 1, -150), Enum.KeyCode.LeftShift, Enum.KeyCode.ButtonX)
		hold("VehicleLeanBack", "leanBack", "Wheelie", UDim2.new(1, -150, 1, -230), Enum.KeyCode.Q, Enum.KeyCode.ButtonL1)
		hold("VehicleLeanForward", "leanForward", nil, nil, Enum.KeyCode.E, Enum.KeyCode.ButtonR1)
	elseif kind == "Plane" or kind == "Helicopter" then
		local up = if kind == "Plane" then "Throttle +" else "Up"
		local down = if kind == "Plane" then "Throttle -" else "Down"
		hold("VehiclePowerUp", "powerUp", up, UDim2.new(1, -150, 1, -230), Enum.KeyCode.LeftShift, Enum.KeyCode.ButtonR2)
		hold("VehiclePowerDown", "powerDown", down, UDim2.new(1, -150, 1, -150), Enum.KeyCode.LeftControl, Enum.KeyCode.ButtonL2)
		if kind == "Plane" then
			hold("VehicleYawLeft", "yawLeft", nil, nil, Enum.KeyCode.Q, Enum.KeyCode.ButtonL1)
			hold("VehicleYawRight", "yawRight", nil, nil, Enum.KeyCode.E, Enum.KeyCode.ButtonR1)
			toggles.gearDown = model:GetAttribute("GearDown") ~= false
			toggles.flaps = model:GetAttribute("Flaps") == true
			if spec.Gear.Retractable then
				press("VehicleGear", function()
					toggles.gearDown = not toggles.gearDown
				end, "Gear", UDim2.new(1, -230, 1, -110), Enum.KeyCode.G, Enum.KeyCode.DPadDown)
			end
			press("VehicleFlaps", function()
				toggles.flaps = not toggles.flaps
			end, nil, nil, Enum.KeyCode.F, Enum.KeyCode.DPadUp)
		else
			hold("VehicleRollLeft", "rollLeft", nil, nil, Enum.KeyCode.Q, Enum.KeyCode.ButtonL1)
			hold("VehicleRollRight", "rollRight", nil, nil, Enum.KeyCode.E, Enum.KeyCode.ButtonR1)
		end
	elseif kind == "Tank" then
		hold("VehicleFire", "fire", "Fire", UDim2.new(1, -150, 1, -150), Enum.UserInputType.MouseButton1, Enum.KeyCode.ButtonR1)
	elseif kind == "Train" then
		hold("VehicleHandbrake", "handbrake", "E-Brake", UDim2.new(1, -150, 1, -150), Enum.KeyCode.LeftShift, Enum.KeyCode.ButtonX)
		hold("VehicleHorn", "horn", "Horn", UDim2.new(1, -150, 1, -230), Enum.KeyCode.H, Enum.KeyCode.ButtonL1)
	end

	local remote = ReplicatedStorage:FindFirstChild("VehicleControl") :: RemoteEvent?
	local sent: { [string]: any } = {}
	local sinceSend = 0
	local bailed = false
	local driftPoints, bankedPoints, sinceDrift = 0, 0, 0
	local fov = FOV_BOOST[kind] or FOV_BOOST.Car
	local muzzle = model:FindFirstChild("Muzzle", true)

	local connection = RunService.PreSimulation:Connect(function(dt)
		local throttle, steer = seat.ThrottleFloat, seat.SteerFloat
		local t: any
		if kind == "Motorcycle" then
			t = sim:Step(dt, {
				Throttle = throttle,
				Steer = steer,
				Handbrake = held.handbrake,
				Lean = axis(held.leanForward, held.leanBack),
				Rider = true,
			})
		elseif kind == "Boat" then
			t = sim:Step(dt, { Throttle = throttle, Steer = steer })
		elseif kind == "Plane" then
			local pitch, roll = throttle, steer
			if AIM_FLIGHT and camera and math.abs(pitch) < 0.05 and math.abs(roll) < 0.05 then
				pitch, roll = (sim :: any):AimInput(camera.CFrame.LookVector)
			end
			t = sim:Step(dt, {
				Pitch = pitch,
				Roll = roll,
				Yaw = axis(held.yawRight, held.yawLeft),
				Power = axis(held.powerUp, held.powerDown),
				Brake = held.powerDown,
				Flaps = toggles.flaps,
				GearDown = toggles.gearDown,
			})
		elseif kind == "Helicopter" then
			t = sim:Step(dt, {
				Pitch = throttle,
				Yaw = steer,
				Roll = axis(held.rollRight, held.rollLeft),
				Power = axis(held.powerUp, held.powerDown),
				Engine = true,
			})
		elseif kind == "Tank" then
			t = sim:Step(dt, {
				Throttle = throttle,
				Steer = steer,
				Aim = if camera then camera.CFrame.LookVector else nil,
				Fire = held.fire,
			})
			-- This client's turret, straight from the sim (others see the replicated TurretYaw).
			model:SetAttribute("LocalAim", Vector2.new(t.TurretYaw, t.GunPitch))
		elseif kind == "Train" then
			t = sim:Step(dt, { Throttle = throttle, Handbrake = held.handbrake })
		else
			t = sim:Step(dt, { Throttle = throttle, Steer = steer, Handbrake = held.handbrake })
		end

		-- HUD.
		local kmh = math.abs(if kind == "Plane" or kind == "Helicopter" then t.AirspeedKmh else t.SpeedKmh)
		hud.speed.Text = speedText(kmh, kind)
		local fill, red, banner = 0, false, ""
		if kind == "Car" or kind == "Motorcycle" then
			hud.badge.Text = if t.Gear < 0 then "R" else tostring(t.Gear)
			fill = math.clamp(t.Rpm / spec.Engine.RedlineRpm, 0, 1)
			red = fill > 0.9
			if kind == "Motorcycle" then
				hud.info.Text = `LEAN {math.floor(math.abs(t.Lean))}°`
				banner = if t.Wheelie then "WHEELIE" elseif t.Stoppie then "STOPPIE" else ""
			else
				-- Drift score: angle x speed while sliding; a spin-out or a stuck assist loses it.
				if t.Drifting then
					sinceDrift = 0
					driftPoints += math.abs(t.DriftAngle) * kmh * dt * 0.05
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
				banner = if driftPoints >= 1 then `DRIFT +{math.floor(driftPoints)}` elseif bankedPoints > 0 then `{bankedPoints} pts` else ""
			end
		elseif kind == "Boat" then
			hud.badge.Text = if t.Throttle < -0.05 then "R" else `{math.floor(math.abs(t.Throttle) * 100)}%`
			fill = math.abs(t.Throttle)
			hud.info.Text = if t.Planing > 0.5 then "ON THE PLANE" elseif t.Stuck then "AGROUND" else ""
		elseif kind == "Plane" then
			hud.badge.Text = if t.Afterburner then "AB" else `{math.floor(t.Throttle * 100)}%`
			fill = t.Throttle
			red = t.Afterburner
			hud.info.Text = `ALT {math.floor(t.Altitude)} m  V/S {string.format("%+.1f", t.VerticalSpeed)}`
				.. (if spec.Gear.Retractable then (if t.GearDown then "  GEAR" else "") else "")
				.. (if t.Flaps > 0.5 then "  FLAPS" else "")
			banner = if t.Stall then "STALL" else ""
		elseif kind == "Helicopter" then
			hud.badge.Text = `{math.floor(t.RotorSpeed * 100)}%`
			fill = t.PowerShare
			red = t.PowerShare > 0.97
			local altitude = if t.Altitude then `{math.floor(t.Altitude)} m` else "—"
			hud.info.Text = `ALT {altitude}  V/S {string.format("%+.1f", t.VerticalSpeed)}`
			banner = if t.RotorSpeed < 0.95 then `ROTOR {math.floor(t.RotorSpeed * 100)}%` else ""
		elseif kind == "Tank" then
			hud.badge.Text = if t.Reload > 0 then string.format("%.1f", t.Reload) else "READY"
			fill = 1 - t.Reload / math.max(spec.Gun.Reload, 0.1)
			red = t.Reload > 0
			hud.info.Text = `TURRET {math.floor(t.TurretYaw + 0.5)}°  GUN {string.format("%+d", math.floor(t.GunPitch + 0.5))}°`
			banner = if t.Stuck then "STUCK ASSIST" else ""
		elseif kind == "Train" then
			local braking = t.Brake > 0.05 and t.Power < 0.05
			hud.badge.Text = (if t.Reverse then "R " else "") .. (if braking then `B{math.floor(t.Brake * 100)}` else `P{math.floor(t.Power * 100)}`)
			fill = if braking then t.Brake else t.Power
			red = braking
			hud.info.Text = `GRADE {string.format("%+.1f", t.Grade)}%` .. (if t.SpeedLimit > 0 then `  LIMIT {math.floor(t.SpeedLimit)}` else "")
			banner = if t.Derailed then "DERAILED - press R"
				elseif t.SpeedLimit > 0 and kmh > t.SpeedLimit + 5 then "OVERSPEED"
				elseif t.Wheelslip then "WHEELSLIP"
				else ""
		end
		hud.fill.Size = UDim2.fromScale(math.clamp(fill, 0, 1), 1)
		hud.fill.BackgroundColor3 = if red then Color3.fromRGB(255, 80, 70) else Color3.fromRGB(90, 200, 120)
		hud.banner.Text = banner

		if camera then
			local target = (session and session.baseFov or 70) + fov[1] * math.clamp(kmh / fov[2], 0, 1)
			camera.FieldOfView += (target - camera.FieldOfView) * math.min(1, dt * 3)
		end

		-- Tell the server what other players should see; bike crashes throw the rider off.
		if remote then
			sinceSend += dt
			local state: { [string]: any } = {}
			if kind == "Plane" then
				state.Throttle = t.Throttle
				state.GearDown = toggles.gearDown
				state.Flaps = toggles.flaps
			elseif kind == "Boat" then
				state.Throttle = math.abs(t.Throttle)
			elseif kind == "Helicopter" then
				state.Throttle = t.PowerShare * t.RotorSpeed
			elseif kind == "Tank" then
				state.Throttle = math.max(math.abs(throttle), math.abs(steer))
				state.TurretYaw = math.floor(t.TurretYaw * 2 + 0.5) / 2
				state.GunPitch = math.floor(t.GunPitch * 2 + 0.5) / 2
			elseif kind == "Train" then
				state.Throttle = t.Power
				state.Horn = held.horn
			end
			local changed = false
			for key, value in state do
				local old = sent[key]
				if old == nil or (typeof(value) == "number" and math.abs(value - old) > 0.05) or (typeof(value) ~= "number" and value ~= old) then
					changed = true
				end
			end
			if changed and sinceSend >= 1 / CONTROL_HZ then
				sinceSend = 0
				for key, value in state do
					sent[key] = value
				end
				remote:FireServer(model, state) -- perf:ignore remote-in-frame (only on change, at most CONTROL_HZ a second)
			end
			if kind == "Tank" and t.Fired then
				-- The shot leaves the Muzzle attachment (or the barrel's end) along the gun.
				local origin = if muzzle and muzzle:IsA("Attachment")
					then muzzle.WorldPosition
					else t.Trunnion + t.GunDirection * (spec.Length * 0.6 / 0.28)
				model:SetAttribute("LocalShot", os.clock())
				remote:FireServer(model, { Fire = true, Origin = origin, Direction = t.GunDirection, TurretYaw = t.TurretYaw, GunPitch = t.GunPitch }) -- perf:ignore remote-in-frame (once per shot)
			end
			if kind == "Motorcycle" and t.Crashed and not bailed then
				bailed = true
				remote:FireServer(model, { Bail = true }) -- perf:ignore remote-in-frame (once per crash)
				local character = player.Character
				local humanoid = character and character:FindFirstChildOfClass("Humanoid")
				local rootPart = character and character:FindFirstChild("HumanoidRootPart")
				local bike = model.PrimaryPart
				if humanoid and rootPart and rootPart:IsA("BasePart") and bike then
					local velocity = bike.AssemblyLinearVelocity
					humanoid.Sit = false
					task.defer(function()
						rootPart.AssemblyLinearVelocity = velocity + Vector3.yAxis * 15
						humanoid:ChangeState(Enum.HumanoidStateType.FallingDown)
					end)
				end
			end
		end
	end)

	session = {
		sim = sim,
		kind = kind,
		seat = seat,
		model = model,
		spec = spec,
		connection = connection,
		baseFov = if camera then camera.FieldOfView else 70,
		hud = hud,
		actions = actions,
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
