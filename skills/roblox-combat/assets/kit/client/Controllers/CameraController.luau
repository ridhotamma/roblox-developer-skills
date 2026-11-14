--!strict
-- Shooter camera on the local player's client: first person, or third person over the shoulder
-- (Resident Evil 4 / The Last of Us / GTA style). The maths lives in AimCamera (shared, tested in
-- the luau CLI); this file is only Roblox glue: input, raycasts, the Camera and the character.
--
--   look:   mouse (locked to the centre) / right stick / drag on the right of the screen
--   view:   V / D-pad up / touch button        shoulder: Q / R3 / touch button
--   aim:    WeaponController calls CameraController.SetAiming while the aim input is held
--
-- Settings live in CombatConfig.Camera. Set Enabled = false to keep Roblox's default camera.

local ContextActionService = game:GetService("ContextActionService")
local Players = game:GetService("Players")
local ReplicatedStorage = game:GetService("ReplicatedStorage")
local RunService = game:GetService("RunService")
local UserInputService = game:GetService("UserInputService")

local AimCamera = require(ReplicatedStorage.Shared.Combat.AimCamera)
local CameraFx = require(script.Parent.Parent.Combat.CameraFx)
local CombatConfig = require(ReplicatedStorage.Shared.Combat.CombatConfig)

local config = CombatConfig.Camera
local player = Players.LocalPlayer

local CameraController = {
	-- Runs before CameraFx (shake, recoil) and WeaponController (fires with the final camera).
	RenderPriority = Enum.RenderPriority.Camera.Value,
	Active = false,
}

local rig = AimCamera.new(config)
local touchLook: InputObject? = nil
local stick = Vector2.zero
local hidden = false

local function keyCodes(names: { string }): { Enum.KeyCode }
	local out = {}
	for _, name in names do
		local ok, code = pcall(function()
			return (Enum.KeyCode :: any)[name]
		end)
		if ok and code then
			table.insert(out, code)
		end
	end
	return out
end

local function character(): (Model?, BasePart?, Humanoid?)
	local model = player.Character
	local root = model and model:FindFirstChild("HumanoidRootPart")
	local humanoid = model and model:FindFirstChildOfClass("Humanoid")
	if model and root and root:IsA("BasePart") and humanoid then
		return model, root, humanoid
	end
	return nil, nil, nil
end

local function setHidden(model: Model, hide: boolean)
	if hide == hidden then
		return
	end
	hidden = hide
	for _, part in model:GetDescendants() do
		if part:IsA("BasePart") or part:IsA("Decal") then
			-- Tools stay visible so a first-person view still shows the gun.
			if not part:FindFirstAncestorOfClass("Tool") then
				part.LocalTransparencyModifier = if hide then 1 else 0
			end
		end
	end
end

local function yawOf(cframe: CFrame): number
	local look = cframe.LookVector
	return math.deg(math.atan2(-look.X, -look.Z))
end

local function step(dt: number)
	local camera = workspace.CurrentCamera
	local model, root, humanoid = character()
	if not (camera and model and root and humanoid) then
		return
	end
	camera.CameraType = Enum.CameraType.Scriptable
	UserInputService.MouseBehavior = Enum.MouseBehavior.LockCenter
	UserInputService.MouseIconEnabled = false

	rig:Stick(stick.X, stick.Y, dt)

	local params = RaycastParams.new()
	params.FilterType = Enum.RaycastFilterType.Exclude
	params.FilterDescendantsInstances = { model }
	params.RespectCanCollide = true -- glass panes, foliage and triggers with CanCollide off don't push the camera
	local cframe, fov = rig:Update(dt, root.Position, function(origin, direction, radius)
		local result = workspace:Spherecast(origin, radius, direction, params)
		return if result then result.Distance else nil
	end)
	camera.CFrame = cframe
	camera.Focus = CFrame.new(rig.Focus)
	camera.FieldOfView = fov

	-- Face the aim (strafe) in first person, while aiming and right after a shot.
	local yaw = rig:CharacterYaw(yawOf(root.CFrame), dt)
	humanoid.AutoRotate = yaw == nil
	if yaw then
		root.CFrame = CFrame.new(root.Position) * CFrame.Angles(0, math.rad(yaw), 0)
	end
	setHidden(model, rig:HideCharacter())
end

local function start()
	if CameraController.Active then
		return
	end
	CameraController.Active = true
	CameraFx.SetFovOwned(true)
	RunService:BindToRenderStep("ShooterCamera", CameraController.RenderPriority, step)

	if config.AllowToggle then
		ContextActionService:BindAction("ShooterView", function(_, state)
			if state == Enum.UserInputState.Begin then
				rig:ToggleMode()
			end
			return Enum.ContextActionResult.Sink
		end, true, table.unpack(keyCodes(config.Keys.ToggleView)))
		ContextActionService:SetTitle("ShooterView", "View")
		ContextActionService:SetPosition("ShooterView", UDim2.new(1, -310, 1, -150))
	end
	ContextActionService:BindAction("ShooterShoulder", function(_, state)
		if state == Enum.UserInputState.Begin then
			rig:SwapShoulder()
		end
		return Enum.ContextActionResult.Sink
	end, true, table.unpack(keyCodes(config.Keys.SwapShoulder)))
	ContextActionService:SetTitle("ShooterShoulder", "Swap")
	ContextActionService:SetPosition("ShooterShoulder", UDim2.new(1, -310, 1, -70))
end

local function stop()
	if not CameraController.Active then
		return
	end
	CameraController.Active = false
	CameraFx.SetFovOwned(false)
	RunService:UnbindFromRenderStep("ShooterCamera")
	stick = Vector2.zero
	for _, name in { "ShooterView", "ShooterShoulder" } do
		ContextActionService:UnbindAction(name)
	end
	local camera = workspace.CurrentCamera
	if camera then
		camera.CameraType = Enum.CameraType.Custom
	end
	UserInputService.MouseBehavior = Enum.MouseBehavior.Default
	UserInputService.MouseIconEnabled = true
	local model, _, humanoid = character()
	if model and humanoid then
		humanoid.AutoRotate = true
		setHidden(model, false)
	end
end

-- Mouse and right-stick look, and touch look: drags that start on the right half of the screen
-- and aren't on a button or the thumbstick.
local function bindLook()
	UserInputService.InputChanged:Connect(function(input)
		if not CameraController.Active then
			return
		end
		if input.UserInputType == Enum.UserInputType.MouseMovement then
			rig:Look(input.Delta.X, input.Delta.Y)
		elseif input.KeyCode == Enum.KeyCode.Thumbstick2 then
			stick = Vector2.new(input.Position.X, input.Position.Y)
		end
	end)
	UserInputService.InputEnded:Connect(function(input)
		if input.KeyCode == Enum.KeyCode.Thumbstick2 then
			stick = Vector2.zero
		end
	end)
	UserInputService.TouchStarted:Connect(function(input, processed)
		local camera = workspace.CurrentCamera
		if processed or touchLook or not camera then
			return
		end
		if input.Position.X > camera.ViewportSize.X * 0.5 then
			touchLook = input
		end
	end)
	UserInputService.TouchMoved:Connect(function(input)
		if CameraController.Active and input == touchLook then
			rig:Look(input.Delta.X, input.Delta.Y, true)
		end
	end)
	UserInputService.TouchEnded:Connect(function(input)
		if input == touchLook then
			touchLook = nil
		end
	end)
end

---------------------------------------------------------------------------------------------
-- API for WeaponController and game code

function CameraController.SetAiming(aiming: boolean)
	rig:SetAiming(aiming)
end

function CameraController.Fired()
	rig:Fired()
end

-- Studs along the crosshair ray to skip (the stretch between the camera and the character).
function CameraController.AimSkip(): number
	return if CameraController.Active then rig:AimSkip() else 0
end

function CameraController.SetMode(mode: AimCamera.Mode)
	rig:SetMode(mode)
end

function CameraController.GetRig()
	return rig
end

-- Turn the shooter camera on or off at runtime (cutscenes, menus, vehicles).
function CameraController.SetEnabled(enabled: boolean)
	if enabled then
		start()
	else
		stop()
	end
end

function CameraController:Start()
	if not config.Enabled then
		return
	end
	bindLook()
	player.CharacterAdded:Connect(function(model)
		hidden = false
		local root = model:WaitForChild("HumanoidRootPart", 10)
		if root and root:IsA("BasePart") then
			rig.Yaw = yawOf(root.CFrame)
			rig.Pitch = 0
		end
	end)
	if player.Character then
		local _, root = character()
		if root then
			rig.Yaw = yawOf(root.CFrame)
		end
	end
	start()
end

return CameraController
