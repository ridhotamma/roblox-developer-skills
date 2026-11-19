--!strict
-- The on-screen QTE prompt, for keyboard, gamepad and touch.
--
--   * shows the button for the device the player is using right now (key cap, the platform's
--     gamepad glyph from UserInputService:GetImageForKeyCode, or a big touch button)
--   * draws what the type needs: a closing ring onto a target (Timing), a meter that fills and
--     drains (Mash, Alternate, Hold), the next button in a Sequence, a window timer
--   * sits next to the action when it has an anchor (projected every frame), else lower centre
--   * runs the same Qte state machine as the server for instant feedback, sends every press to
--     the server with its time on the shared clock, and shows the server's verdict when it lands
--   * sinks the keys it uses while it's up, so a QTE "Space" never also jumps
-- Colour is never the only signal: results are words and the ring has a shape.

local ContextActionService = game:GetService("ContextActionService")
local Players = game:GetService("Players")
local ReplicatedStorage = game:GetService("ReplicatedStorage")
local RunService = game:GetService("RunService")
local UserInputService = game:GetService("UserInputService")

local CutsceneConfig = require(ReplicatedStorage.Shared.Cutscene.CutsceneConfig)
local Qte = require(ReplicatedStorage.Shared.Cutscene.Qte)

local QtePrompt = {}

local STEP_NAME = "CutsceneQtePrompt"
local ACTION_PREFIX = "CutsceneQte_"
local ACCENT = Color3.fromRGB(255, 214, 92)
local GOOD = Color3.fromRGB(120, 230, 140)
local BAD = Color3.fromRGB(255, 100, 90)

type Current = {
	Id: string,
	State: Qte.State,
	Anchor: Instance?,
	Send: (action: string, down: boolean, time: number) -> (),
	Bound: { string },
	Final: string?,
	FinalAt: number?,
}

local current: Current? = nil
local gui: ScreenGui? = nil
local parts: { [string]: any } = {}

local function now(): number
	return workspace:GetServerTimeNow()
end

local function device(): string
	local last = UserInputService:GetLastInputType()
	if last == Enum.UserInputType.Touch then
		return "Touch"
	elseif string.find(last.Name, "Gamepad") then
		return "Gamepad"
	end
	return if UserInputService.TouchEnabled and not UserInputService.KeyboardEnabled then "Touch" else "Keyboard"
end

local function build()
	if gui and gui.Parent then
		return
	end
	local screen = Instance.new("ScreenGui")
	screen.Name = "QtePrompt"
	screen.IgnoreGuiInset = true
	screen.ResetOnSpawn = false
	screen.DisplayOrder = CutsceneConfig.Overlay.DisplayOrder + 1
	screen:SetAttribute("KeepInCutscene", true)

	local root = Instance.new("Frame")
	root.Name = "Prompt"
	root.AnchorPoint = Vector2.new(0.5, 0.5)
	root.Position = UDim2.fromScale(0.5, 0.66)
	root.Size = UDim2.fromOffset(150, 150)
	root.BackgroundTransparency = 1
	root.Visible = false
	root.Parent = screen

	local ring = Instance.new("Frame")
	ring.Name = "Ring"
	ring.AnchorPoint = Vector2.new(0.5, 0.5)
	ring.Position = UDim2.fromScale(0.5, 0.42)
	ring.BackgroundTransparency = 1
	ring.Parent = root
	Instance.new("UICorner", ring).CornerRadius = UDim.new(1, 0)
	local ringStroke = Instance.new("UIStroke", ring)
	ringStroke.Thickness = 4
	ringStroke.Color = ACCENT

	local target = ring:Clone()
	target.Name = "Target"
	target.Size = UDim2.fromOffset(74, 74)
	target.Parent = root
	local targetStroke = target:FindFirstChildOfClass("UIStroke") :: UIStroke
	targetStroke.Thickness = 2
	targetStroke.Color = Color3.new(1, 1, 1)
	targetStroke.Transparency = 0.3

	local key = Instance.new("TextButton")
	key.Name = "Key"
	key.AnchorPoint = Vector2.new(0.5, 0.5)
	key.Position = UDim2.fromScale(0.5, 0.42)
	key.Size = UDim2.fromOffset(60, 60)
	key.BackgroundColor3 = Color3.fromRGB(20, 20, 24)
	key.BackgroundTransparency = 0.15
	key.TextColor3 = Color3.new(1, 1, 1)
	key.Font = Enum.Font.GothamBold
	key.TextSize = 26
	key.AutoButtonColor = false
	key.Parent = root
	Instance.new("UICorner", key).CornerRadius = UDim.new(0, 12)
	local keyStroke = Instance.new("UIStroke", key)
	keyStroke.Thickness = 2
	keyStroke.Color = ACCENT
	keyStroke.ApplyStrokeMode = Enum.ApplyStrokeMode.Border

	local glyph = Instance.new("ImageLabel")
	glyph.Name = "Glyph"
	glyph.AnchorPoint = Vector2.new(0.5, 0.5)
	glyph.Position = UDim2.fromScale(0.5, 0.5)
	glyph.Size = UDim2.fromScale(0.8, 0.8)
	glyph.BackgroundTransparency = 1
	glyph.Visible = false
	glyph.Parent = key

	local label = Instance.new("TextLabel")
	label.Name = "Label"
	label.AnchorPoint = Vector2.new(0.5, 0)
	label.Position = UDim2.fromScale(0.5, 0.78)
	label.Size = UDim2.fromOffset(240, 26)
	label.BackgroundTransparency = 1
	label.TextColor3 = Color3.new(1, 1, 1)
	label.TextStrokeTransparency = 0.4
	label.Font = Enum.Font.GothamBlack
	label.TextSize = 22
	label.Parent = root

	local meter = Instance.new("Frame")
	meter.Name = "Meter"
	meter.AnchorPoint = Vector2.new(0.5, 0)
	meter.Position = UDim2.fromScale(0.5, 0.98)
	meter.Size = UDim2.fromOffset(170, 10)
	meter.BackgroundColor3 = Color3.fromRGB(30, 30, 34)
	meter.BackgroundTransparency = 0.2
	meter.Parent = root
	Instance.new("UICorner", meter).CornerRadius = UDim.new(1, 0)
	local fill = Instance.new("Frame")
	fill.Name = "Fill"
	fill.Size = UDim2.fromScale(0, 1)
	fill.BackgroundColor3 = ACCENT
	fill.Parent = meter
	Instance.new("UICorner", fill).CornerRadius = UDim.new(1, 0)

	local timer = Instance.new("Frame")
	timer.Name = "Timer"
	timer.AnchorPoint = Vector2.new(0.5, 0)
	timer.Position = UDim2.new(0.5, 0, 0.98, 14)
	timer.Size = UDim2.fromOffset(170, 3)
	timer.BackgroundColor3 = Color3.new(1, 1, 1)
	timer.BackgroundTransparency = 0.3
	timer.BorderSizePixel = 0
	timer.Parent = root

	local result = Instance.new("TextLabel")
	result.Name = "Result"
	result.AnchorPoint = Vector2.new(0.5, 1)
	result.Position = UDim2.fromScale(0.5, 0.05)
	result.Size = UDim2.fromOffset(240, 34)
	result.BackgroundTransparency = 1
	result.Font = Enum.Font.GothamBlack
	result.TextSize = 28
	result.TextStrokeTransparency = 0.3
	result.Text = ""
	result.Parent = root

	-- Touch: a second big button for Alternate's other side.
	local second = key:Clone()
	second.Name = "Second"
	second.Position = UDim2.new(0.5, 80, 0.42, 0)
	second.Visible = false
	second.Parent = root

	screen.Parent = Players.LocalPlayer:WaitForChild("PlayerGui")
	gui = screen
	parts = {
		Root = root,
		Ring = ring,
		RingStroke = ringStroke,
		Target = target,
		Key = key,
		KeyStroke = keyStroke,
		Glyph = glyph,
		Label = label,
		Meter = meter,
		Fill = fill,
		Timer = timer,
		Result = result,
		Second = second,
	}
end

local function actionsOf(spec: Qte.Spec): { string }
	if spec.Actions then
		return spec.Actions
	end
	return { spec.Action or "Action" }
end

local function showButton(button: TextButton, glyph: ImageLabel?, action: string?)
	local binding = action and CutsceneConfig.Actions[action]
	local kind = device()
	if glyph then
		glyph.Visible = false
	end
	if not binding then
		button.Text = "?"
		return
	end
	if kind == "Gamepad" then
		local image = ""
		pcall(function()
			image = UserInputService:GetImageForKeyCode(binding.Pad)
		end)
		if glyph and image ~= "" then
			glyph.Image = image
			glyph.Visible = true
			button.Text = ""
			return
		end
		button.Text = string.gsub(binding.Pad.Name, "^Button", "")
	elseif kind == "Touch" then
		button.Text = binding.Label
		button.TextSize = 14
		return
	else
		local name = binding.Key.Name
		button.Text = if #name <= 2 then name else string.sub(name, 1, 5)
	end
	button.TextSize = if #button.Text > 2 then 16 else 26
end

local function unbind(c: Current)
	for _, name in c.Bound do
		ContextActionService:UnbindAction(name)
	end
	c.Bound = {}
end

local function input(c: Current, action: string, down: boolean)
	if c.Final then
		return
	end
	local t = now()
	Qte.Input(c.State, action, down, t)
	c.Send(action, down, t)
	if down then
		parts.KeyStroke.Thickness = 5
		task.delay(0.06, function()
			parts.KeyStroke.Thickness = 2
		end)
	end
end

local function bindInputs(c: Current)
	for _, action in actionsOf(c.State.Spec) do
		local binding = CutsceneConfig.Actions[action]
		if binding then
			local name = ACTION_PREFIX .. action
			ContextActionService:BindActionAtPriority(name, function(_, inputState: Enum.UserInputState)
				if inputState == Enum.UserInputState.Begin then
					input(c, action, true)
				elseif inputState == Enum.UserInputState.End then
					input(c, action, false)
				end
				return Enum.ContextActionResult.Sink
			end, false, Enum.ContextActionPriority.High.Value + 100, binding.Key, binding.Pad)
			table.insert(c.Bound, name)
		end
	end
end

local function render()
	local c = current
	if not c then
		return
	end
	local t = now()
	local state = c.State
	if not c.Final then
		Qte.Update(state, t)
	end
	local view = Qte.View(state, t)
	local spec = state.Spec
	parts.Root.Visible = t >= state.Start - 0.25

	-- Position: next to the action when anchored.
	local anchor = c.Anchor
	local world: Vector3? = nil
	if anchor and anchor.Parent then
		world = if anchor:IsA("BasePart") then anchor.Position + Vector3.new(0, 1.5, 0) elseif anchor:IsA("Attachment") then anchor.WorldPosition else nil
	end
	if world then
		local point, visible = workspace.CurrentCamera:WorldToViewportPoint(world)
		local size = workspace.CurrentCamera.ViewportSize
		if visible then
			parts.Root.Position = UDim2.fromOffset(math.clamp(point.X, 110, size.X - 110), math.clamp(point.Y, 110, size.Y - 140))
		end
	else
		parts.Root.Position = UDim2.fromScale(0.5, 0.66)
	end

	showButton(parts.Key, parts.Glyph, view.Expected)
	local touch = device() == "Touch"
	parts.Second.Visible = touch and spec.Type == "Alternate"
	if parts.Second.Visible then
		parts.Key.Position = UDim2.new(0.5, -45, 0.42, 0)
		parts.Second.Position = UDim2.new(0.5, 45, 0.42, 0)
		showButton(parts.Second, nil, (spec.Actions or {})[2])
		showButton(parts.Key, parts.Glyph, (spec.Actions or {})[1])
	else
		parts.Key.Position = UDim2.fromScale(0.5, 0.42)
	end
	parts.Label.Text = spec.Label or (CutsceneConfig.Actions[view.Expected or ""] or { Label = "" }).Label

	local timing = spec.Type == "Timing"
	parts.Ring.Visible = timing
	parts.Target.Visible = timing
	if timing then
		local scale = math.max(0, view.Ring)
		local size = 74 + 110 * scale
		parts.Ring.Size = UDim2.fromOffset(size, size)
		parts.RingStroke.Transparency = if view.Ring < -0.3 then 0.8 else 0
	end
	local metered = spec.Type == "Mash" or spec.Type == "Alternate" or spec.Type == "Hold" or spec.Type == "Sequence"
	parts.Meter.Visible = metered
	parts.Fill.Size = UDim2.fromScale(view.Meter, 1)
	parts.Timer.Size = UDim2.fromOffset(170 * view.Remaining, 3)

	local final = c.Final or (if state.Status ~= "Pending" then state.Status else nil)
	if final then
		local grade = state.Grade
		parts.Result.Text = if final == "Success" then (if grade == "Perfect" then "PERFECT" elseif grade == "Good" then "GOOD" else "SUCCESS") else (if grade == "Early" then "TOO EARLY" elseif grade == "Late" then "TOO LATE" else "FAILED")
		parts.Result.TextColor3 = if final == "Success" then GOOD else BAD
		parts.KeyStroke.Color = parts.Result.TextColor3
	else
		parts.Result.Text = ""
		parts.KeyStroke.Color = ACCENT
	end
	if c.FinalAt and os.clock() - c.FinalAt > CutsceneConfig.Qte.ResultHold then
		QtePrompt.Hide()
	end
end

-- Shows a QTE. `send(action, down, time)` forwards inputs to the server.
function QtePrompt.Show(id: string, spec: Qte.Spec, startAt: number, assist: string?, anchor: Instance?, send: (string, boolean, number) -> ())
	if current then
		QtePrompt.Hide()
	end
	build()
	local c: Current = {
		Id = id,
		State = Qte.Start(spec, startAt, assist),
		Anchor = anchor,
		Send = send,
		Bound = {},
	}
	current = c
	bindInputs(c)
	parts.Key.InputBegan:Connect(function(io: InputObject)
		if current == c and io.UserInputType == Enum.UserInputType.Touch then
			input(c, actionsOf(c.State.Spec)[1], true)
		end
	end)
	parts.Key.InputEnded:Connect(function(io: InputObject)
		if current == c and io.UserInputType == Enum.UserInputType.Touch then
			input(c, actionsOf(c.State.Spec)[1], false)
		end
	end)
	parts.Second.InputBegan:Connect(function(io: InputObject)
		local actions = actionsOf(c.State.Spec)
		if current == c and io.UserInputType == Enum.UserInputType.Touch and actions[2] then
			input(c, actions[2], true)
		end
	end)
	RunService:BindToRenderStep(STEP_NAME, Enum.RenderPriority.Last.Value, render)
end

-- The server's verdict ("Success" | "Fail" | "Cancelled").
function QtePrompt.Result(id: string, status: string, grade: string?)
	local c = current
	if not c or c.Id ~= id then
		return
	end
	if status == "Cancelled" then
		QtePrompt.Hide()
		return
	end
	c.Final = status
	c.State.Status = status :: any
	c.State.Grade = grade
	c.FinalAt = os.clock()
	unbind(c)
end

function QtePrompt.Hide()
	local c = current
	current = nil
	if c then
		unbind(c)
	end
	RunService:UnbindFromRenderStep(STEP_NAME)
	if parts.Root then
		parts.Root.Visible = false
	end
	-- Fresh buttons next time (drops this prompt's touch connections).
	if gui then
		gui:Destroy()
		gui = nil
	end
end

function QtePrompt.IsShowing(): boolean
	return current ~= nil
end

return QtePrompt
