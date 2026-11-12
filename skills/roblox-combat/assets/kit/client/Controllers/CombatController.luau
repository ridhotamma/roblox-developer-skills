--!strict
-- Melee on the local player's client, plus the listeners every client needs:
--   * input: left mouse, gamepad R2, and an on-screen touch button (ContextActionService)
--   * combo mirror (Light, Light, Medium, Finisher) and a short input buffer
--   * finisher slow-mo that starts just before contact if something is in reach
--   * at the contact frame: predicted hit feedback on targets in the local hitbox, then "Swing"
--   * "Knockback" from the server: push our own character (we own its physics)
--   * "CombatHit" from the server: confirmed feedback for every hit we can see
-- Melee is disabled while a gun (a Tool with a Weapon attribute) is equipped.

local CollectionService = game:GetService("CollectionService")
local ContextActionService = game:GetService("ContextActionService")
local Players = game:GetService("Players")
local ReplicatedStorage = game:GetService("ReplicatedStorage")

local CombatConfig = require(ReplicatedStorage.Shared.Combat.CombatConfig)
local HitFeedback = require(script.Parent.Parent.Combat.HitFeedback)
local Hitbox = require(ReplicatedStorage.Shared.Combat.Hitbox)
local Knockback = require(ReplicatedStorage.Shared.Combat.Knockback)
local Net = require(ReplicatedStorage.Shared.Net)

local BUFFER_SECONDS = 0.2

local player = Players.LocalPlayer
local melee = CombatConfig.Melee

local CombatController = {}

local lastSwing = -math.huge
local nextSwing = 0
local step = 0
local buffered = false
local loadedTracks: { [string]: AnimationTrack } = {}

local function character(): (Model?, BasePart?, Humanoid?)
	local char = player.Character
	local root = char and char:FindFirstChild("HumanoidRootPart")
	local humanoid = char and char:FindFirstChildOfClass("Humanoid")
	if char and root and root:IsA("BasePart") and humanoid and humanoid.Health > 0 then
		return char, root, humanoid
	end
	return nil, nil, nil
end

local function holdingGun(char: Model): boolean
	local tool = char:FindFirstChildOfClass("Tool")
	return tool ~= nil and tool:GetAttribute("Weapon") ~= nil
end

local function validTarget(model: Model): boolean
	if CollectionService:HasTag(model, CombatConfig.EnemyTag) then
		return true
	end
	return CombatConfig.PvP and Players:GetPlayerFromCharacter(model) ~= nil
end

local function targetsInReach(char: Model, root: BasePart): { Model }
	local cframe, size = Hitbox.InFront(root, melee.Hitbox)
	local out = {}
	for _, model in Hitbox.Query(cframe, size, { char }) do
		if validTarget(model) then
			table.insert(out, model)
		end
	end
	return out
end

local function playSwingAnimation(humanoid: Humanoid, index: number)
	local id = melee.SwingAnimations[index]
	if not id or id == "" then
		return
	end
	local animator = humanoid:FindFirstChildOfClass("Animator")
	if not animator then
		return
	end
	local track = loadedTracks[id]
	if not track then
		local animation = Instance.new("Animation")
		animation.AnimationId = id
		track = animator:LoadAnimation(animation)
		loadedTracks[id] = track
	end
	(track :: AnimationTrack):Play(0.05)
end

local function attack()
	local char, root, humanoid = character()
	if not (char and root and humanoid) or holdingGun(char) then
		return
	end
	local now = os.clock()
	if now < nextSwing then
		-- Pressed slightly early: remember it and swing as soon as allowed.
		if not buffered and nextSwing - now <= BUFFER_SECONDS then
			buffered = true
			task.delay(nextSwing - now, function()
				buffered = false
				attack()
			end)
		end
		return
	end

	step = if now - lastSwing <= melee.ComboResetSeconds then step % #melee.Combo + 1 else 1
	lastSwing = now
	nextSwing = now + melee.Cooldown
	local weightName = melee.Combo[step]
	local weight = CombatConfig.HitWeights[weightName]

	playSwingAnimation(humanoid, step)
	HitFeedback.PlayLocal(CombatConfig.Sounds.Swing, 1 + (step - 1) * 0.05)

	-- Finisher: slow down just before contact if something is about to be hit.
	if weight.SlowMo > 0 then
		task.delay(math.max(0, melee.ActiveDelay - melee.SlowMoLead), function()
			local c, r = character()
			if c and r then
				local targets = targetsInReach(c, r)
				if #targets > 0 then
					local models: { Model? } = { c }
					for _, t in targets do
						table.insert(models, t)
					end
					HitFeedback.SlowMo(weight.SlowMo, 0.3, models)
				end
			end
		end)
	end

	-- Contact frame: predicted feedback now, damage decided by the server.
	task.delay(melee.ActiveDelay, function()
		local c, r = character()
		if not (c and r) then
			return
		end
		for _, target in targetsInReach(c, r) do
			local targetRoot = target:FindFirstChild("HumanoidRootPart")
			HitFeedback.Play({
				Attacker = c,
				Victim = target,
				Weight = weightName,
				Damage = 0,
				Position = if targetRoot and targetRoot:IsA("BasePart") then targetRoot.Position else r.Position,
				IFrames = 0,
				Headshot = false,
				Killed = false,
				Kind = "Melee",
			}, "predicted")
		end
		Net.Event("Swing"):FireServer()
	end)
end

function CombatController:Start()
	ContextActionService:BindAction("CombatMelee", function(_, state)
		local char = player.Character
		if char and holdingGun(char) then
			return Enum.ContextActionResult.Pass
		end
		if state == Enum.UserInputState.Begin then
			attack()
		end
		return Enum.ContextActionResult.Sink
	end, true, Enum.UserInputType.MouseButton1, Enum.KeyCode.ButtonR2)
	ContextActionService:SetTitle("CombatMelee", "Hit")
	ContextActionService:SetPosition("CombatMelee", UDim2.new(1, -150, 1, -150))

	Net.Event("Knockback").OnClientEvent:Connect(function(velocity: unknown, seconds: unknown)
		local _, root = character()
		if root and typeof(velocity) == "Vector3" and typeof(seconds) == "number" then
			Knockback.Push(root, velocity, seconds)
		end
	end)

	Net.Event("CombatHit").OnClientEvent:Connect(function(raw: unknown)
		local info = HitFeedback.FromServer(raw)
		if info then
			HitFeedback.Play(info, "confirmed")
		end
	end)
end

return CombatController
