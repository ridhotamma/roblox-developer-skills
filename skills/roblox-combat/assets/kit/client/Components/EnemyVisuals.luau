--!strict
-- Client-side enemy telegraphs, driven by the "State" attribute EnemyService sets:
--   Telegraph -> red Highlight that intensifies until the strike, plus a "!" above the head
--   anything else -> cleared
-- Runs on every client, costs the server nothing, and cleans up when the enemy streams out.

local TweenService = game:GetService("TweenService")

local function setup(instance: Instance, trove: any)
	if not instance:IsA("Model") then
		return
	end
	local model = instance :: Model
	local head = model:FindFirstChild("Head") or model:FindFirstChild("HumanoidRootPart")

	local highlight: Highlight? = nil
	local icon: BillboardGui? = nil

	local function clear()
		if highlight then
			highlight:Destroy()
			highlight = nil
		end
		if icon then
			icon:Destroy()
			icon = nil
		end
	end
	trove:Add(clear)

	local function onState()
		clear()
		if model:GetAttribute("State") ~= "Telegraph" then
			return
		end
		local seconds = model:GetAttribute("TelegraphTime")
		local duration = if typeof(seconds) == "number" then seconds else 0.5

		local h = Instance.new("Highlight")
		h.DepthMode = Enum.HighlightDepthMode.Occluded
		h.FillColor = Color3.fromRGB(255, 40, 40)
		h.OutlineColor = Color3.fromRGB(255, 120, 120)
		h.FillTransparency = 0.85
		h.OutlineTransparency = 0.2
		h.Adornee = model
		h.Parent = model
		TweenService:Create(h, TweenInfo.new(duration, Enum.EasingStyle.Quad, Enum.EasingDirection.In), {
			FillTransparency = 0.25,
		}):Play()
		highlight = h

		if head and head:IsA("BasePart") then
			local gui = Instance.new("BillboardGui")
			gui.Adornee = head
			gui.Size = UDim2.fromOffset(40, 40)
			gui.StudsOffset = Vector3.new(0, 2.5, 0)
			gui.AlwaysOnTop = true
			local label = Instance.new("TextLabel")
			label.BackgroundTransparency = 1
			label.Size = UDim2.fromScale(1, 1)
			label.Font = Enum.Font.GothamBlack
			label.Text = "!"
			label.TextScaled = true
			label.TextColor3 = Color3.fromRGB(255, 60, 60)
			label.TextStrokeTransparency = 0
			label.Parent = gui
			gui.Parent = model
			icon = gui
		end
	end

	trove:Connect(model:GetAttributeChangedSignal("State"), onState)
	onState()
end

return {
	Tag = "Enemy", -- keep in sync with CombatConfig.EnemyTag
	Setup = setup,
}
