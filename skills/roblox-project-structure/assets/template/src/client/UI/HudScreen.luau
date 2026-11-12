--!strict
-- View only: builds the HUD's Instances and returns references to the parts a controller
-- needs. No game logic here. Swap this for a React / Fusion / Vide component later without
-- touching HudController's behaviour.

export type HudScreen = {
	Gui: ScreenGui,
	CoinsLabel: TextLabel,
	DailyButton: TextButton,
	Toast: TextLabel,
}

local function corner(parent: Instance)
	local c = Instance.new("UICorner")
	c.CornerRadius = UDim.new(0, 10)
	c.Parent = parent
end

local function label(name: string, parent: Instance): TextLabel
	local l = Instance.new("TextLabel")
	l.Name = name
	l.BackgroundColor3 = Color3.fromRGB(20, 22, 28)
	l.BackgroundTransparency = 0.25
	l.TextColor3 = Color3.new(1, 1, 1)
	l.Font = Enum.Font.GothamBold
	l.TextScaled = true
	l.Parent = parent
	corner(l)
	return l
end

return function(): HudScreen
	local gui = Instance.new("ScreenGui")
	gui.Name = "Hud"
	gui.ResetOnSpawn = false
	gui.ZIndexBehavior = Enum.ZIndexBehavior.Sibling

	-- Top-left, clear of the Roblox menu buttons; sized in scale so it reads on phones.
	local coins = label("Coins", gui)
	coins.AnchorPoint = Vector2.new(0, 0)
	coins.Position = UDim2.new(0, 16, 0, 64)
	coins.Size = UDim2.new(0.18, 0, 0.06, 0)
	coins.Text = "Coins: 0"
	local coinsLimit = Instance.new("UISizeConstraint")
	coinsLimit.MinSize = Vector2.new(140, 36)
	coinsLimit.MaxSize = Vector2.new(260, 56)
	coinsLimit.Parent = coins

	local daily = Instance.new("TextButton")
	daily.Name = "DailyReward"
	daily.AnchorPoint = Vector2.new(0, 0)
	daily.Position = UDim2.new(0, 16, 0, 128)
	daily.Size = UDim2.new(0, 160, 0, 44) -- 44 px: comfortable touch target
	daily.BackgroundColor3 = Color3.fromRGB(255, 196, 61)
	daily.TextColor3 = Color3.fromRGB(30, 24, 8)
	daily.Font = Enum.Font.GothamBold
	daily.TextScaled = true
	daily.Text = "Daily reward"
	daily.Parent = gui
	corner(daily)

	local toast = label("Toast", gui)
	toast.AnchorPoint = Vector2.new(0.5, 0)
	toast.Position = UDim2.new(0.5, 0, 0, 72)
	toast.Size = UDim2.new(0.4, 0, 0, 44)
	toast.Visible = false

	return {
		Gui = gui,
		CoinsLabel = coins,
		DailyButton = daily,
		Toast = toast,
	}
end
