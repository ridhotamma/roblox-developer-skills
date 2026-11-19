--!strict
-- Takes the camera from gameplay, drives it from Timeline states, and hands it back.
--
--   Begin(blendIn)   remember the gameplay camera, go Scriptable, pause the combat kit's
--                    CameraController if it's installed, ease from where the player was looking
--                    into the first shot over `blendIn` seconds (0 = cut)
--   Apply(state)     every frame: CFrame, FieldOfView, Focus and depth of field
--   End(blendOut)    give the camera back to Roblox (or the combat kit) and ease from the last
--                    shot into whatever the gameplay camera does over `blendOut` seconds
--
-- Depth of field: a shot with Aperture (an f-stop: 1.4 very shallow, 2.8 cinematic, 8 deep)
-- gets a DepthOfFieldEffect focused on its Focus actor with a real-optics in-focus band
-- (Lens.FocusSettings). Shots without Aperture switch it off.

local Players = game:GetService("Players")
local ReplicatedStorage = game:GetService("ReplicatedStorage")
local RunService = game:GetService("RunService")

local CutsceneConfig = require(ReplicatedStorage.Shared.Cutscene.CutsceneConfig)
local Ease = require(ReplicatedStorage.Shared.Cutscene.Ease)
local Lens = require(ReplicatedStorage.Shared.Cutscene.Lens)

local CinemaCamera = {}

local BLEND_OUT_STEP = "CutsceneCameraBlendOut"

type Captured = { CFrame: CFrame, Fov: number, Type: Enum.CameraType, Subject: Instance? }

local captured: Captured? = nil
local active = false
local beganAt = 0
local blendIn = 0
local dof: DepthOfFieldEffect? = nil
local last: { CFrame: CFrame, Fov: number }? = nil

local function shooterCamera(): any?
	-- The roblox-combat kit's CameraController, if it sits next to our controller.
	local player = Players.LocalPlayer
	local scripts = player and player:FindFirstChild("PlayerScripts")
	local client = scripts and scripts:FindFirstChild("Client")
	local controllers = client and client:FindFirstChild("Controllers")
	local module = controllers and controllers:FindFirstChild("CameraController")
	if module and module:IsA("ModuleScript") then
		local ok, controller = pcall(require, module)
		if ok and type(controller) == "table" and controller.SetEnabled then
			return controller
		end
	end
	return nil
end

function CinemaCamera.IsActive(): boolean
	return active
end

function CinemaCamera.Begin(blendSeconds: number?)
	local camera = workspace.CurrentCamera
	RunService:UnbindFromRenderStep(BLEND_OUT_STEP)
	if not active then
		captured = {
			CFrame = camera.CFrame,
			Fov = camera.FieldOfView,
			Type = camera.CameraType,
			Subject = camera.CameraSubject,
		}
		local shooter = shooterCamera()
		if shooter then
			shooter.SetEnabled(false)
		end
	end
	active = true
	beganAt = os.clock()
	blendIn = blendSeconds or CutsceneConfig.Camera.BlendIn
	camera.CameraType = Enum.CameraType.Scriptable
	if not dof then
		local effect = Instance.new("DepthOfFieldEffect")
		effect.Name = "CutsceneDepthOfField"
		effect.Enabled = false
		effect.FarIntensity = CutsceneConfig.Camera.DofFarIntensity
		effect.NearIntensity = CutsceneConfig.Camera.DofNearIntensity
		effect.Parent = camera
		dof = effect
	end
end

export type ApplyState = {
	CFrame: CFrame,
	Fov: number,
	Lens: number,
	Aim: Vector3,
	Focus: Vector3?,
	Aperture: number?,
}

function CinemaCamera.Apply(state: ApplyState)
	if not active then
		return
	end
	local camera = workspace.CurrentCamera
	local cframe, fov = state.CFrame, state.Fov
	local from = captured
	if from and blendIn > 0 then
		local k = Ease.Apply("InOut", (os.clock() - beganAt) / blendIn)
		if k < 1 then
			cframe = from.CFrame:Lerp(cframe, k)
			fov = Ease.Lerp(from.Fov, fov, k)
		end
	end
	camera.CFrame = cframe
	camera.FieldOfView = math.clamp(fov, 1, 120)
	camera.Focus = CFrame.new(state.Focus or state.Aim)
	last = { CFrame = cframe, Fov = fov }

	local effect = dof
	if effect then
		if state.Aperture and state.Focus then
			local distance = (state.Focus - cframe.Position).Magnitude
			local focusDistance, radius = Lens.FocusSettings(distance, state.Lens, state.Aperture)
			effect.FocusDistance = focusDistance
			effect.InFocusRadius = radius
			effect.Enabled = true
		else
			effect.Enabled = false
		end
	end
end

function CinemaCamera.End(blendSeconds: number?)
	if not active then
		return
	end
	active = false
	local camera = workspace.CurrentCamera
	local from = captured
	captured = nil
	if dof then
		dof:Destroy()
		dof = nil
	end
	local player = Players.LocalPlayer
	local humanoid = player.Character and player.Character:FindFirstChildOfClass("Humanoid")
	camera.CameraType = if from and from.Type ~= Enum.CameraType.Scriptable then from.Type else Enum.CameraType.Custom
	camera.CameraSubject = humanoid or (from and from.Subject)
	local shooter = shooterCamera()
	if shooter then
		shooter.SetEnabled(true)
	end

	local seconds = blendSeconds or CutsceneConfig.Camera.BlendOut
	local start = last
	local gameplayFov = if from then from.Fov else 70
	if seconds <= 0 or not start then
		camera.FieldOfView = gameplayFov
		return
	end
	local startedAt = os.clock()
	-- Runs after the gameplay camera each frame and eases from the last shot into its result.
	RunService:BindToRenderStep(BLEND_OUT_STEP, CutsceneConfig.Camera.RenderPriority + 5, function()
		local k = Ease.Apply("InOut", (os.clock() - startedAt) / seconds)
		camera.CFrame = start.CFrame:Lerp(camera.CFrame, k)
		camera.FieldOfView = Ease.Lerp(start.Fov, gameplayFov, k)
		if k >= 1 then
			RunService:UnbindFromRenderStep(BLEND_OUT_STEP)
		end
	end)
end

return CinemaCamera
