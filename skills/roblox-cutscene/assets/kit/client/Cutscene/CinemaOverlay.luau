--!strict
-- The screen layer of a cutscene: letterbox bars, fades, subtitles, a hit flash and the skip
-- hint; plus hiding and restoring the game's own UI and the player's controls.
--
-- Letterbox bars are computed from the real viewport every frame, so a 2.39:1 scene gets thick
-- bars on a 16:9 monitor, thin ones on a 19.5:9 phone, and none on an ultrawide.
-- Subtitles follow broadcast practice: bottom centre, above the bars, at most two lines,
-- speaker name in their colour, a dark box behind the text for any background.

local Players = game:GetService("Players")
local ReplicatedStorage = game:GetService("ReplicatedStorage")
local StarterGui = game:GetService("StarterGui")

local CutsceneConfig = require(ReplicatedStorage.Shared.Cutscene.CutsceneConfig)

local CinemaOverlay = {}

local KEEP_ATTRIBUTE = "KeepInCutscene" -- ScreenGuis with this attribute stay visible

type Ui = {
	Gui: ScreenGui,
	Top: Frame,
	Bottom: Frame,
	Fade: Frame,
	Flash: Frame,
	Subtitle: TextLabel,
	Skip: TextLabel,
}

local ui: Ui? = nil
local hiddenGuis: { ScreenGui } = {}
local coreState: { [Enum.CoreGuiType]: boolean }? = nil
local controlsDisabled = false

local function make(): Ui
	local player = Players.LocalPlayer
	local gui = Instance.new("ScreenGui")
	gui.Name = "CinemaOverlay"
	gui.IgnoreGuiInset = true
	gui.ScreenInsets = Enum.ScreenInsets.None
	gui.ResetOnSpawn = false
	gui.DisplayOrder = CutsceneConfig.Overlay.DisplayOrder
	gui.ZIndexBehavior = Enum.ZIndexBehavior.Sibling
	gui:SetAttribute(KEEP_ATTRIBUTE, true)

	local function bar(name: string, anchorY: number): Frame
		local frame = Instance.new("Frame")
		frame.Name = name
		frame.BackgroundColor3 = Color3.new(0, 0, 0)
		frame.BorderSizePixel = 0
		frame.AnchorPoint = Vector2.new(0, anchorY)
		frame.Position = UDim2.fromScale(0, anchorY)
		frame.Size = UDim2.fromScale(1, 0)
		frame.ZIndex = 2
		frame.Parent = gui
		return frame
	end
	local top = bar("Top", 0)
	local bottom = bar("Bottom", 1)

	local fade = Instance.new("Frame")
	fade.Name = "Fade"
	fade.BackgroundColor3 = Color3.new(0, 0, 0)
	fade.BorderSizePixel = 0
	fade.Size = UDim2.fromScale(1, 1)
	fade.BackgroundTransparency = 1
	fade.ZIndex = 5
	fade.Parent = gui

	local flash = Instance.new("Frame")
	flash.Name = "Flash"
	flash.BackgroundColor3 = Color3.new(1, 1, 1)
	flash.BorderSizePixel = 0
	flash.Size = UDim2.fromScale(1, 1)
	flash.BackgroundTransparency = 1
	flash.ZIndex = 4
	flash.Parent = gui

	local subtitle = Instance.new("TextLabel")
	subtitle.Name = "Subtitle"
	subtitle.AnchorPoint = Vector2.new(0.5, 1)
	subtitle.Position = UDim2.new(0.5, 0, 1, -24)
	subtitle.Size = UDim2.new(0.8, 0, 0, 0)
	subtitle.AutomaticSize = Enum.AutomaticSize.Y
	subtitle.BackgroundColor3 = Color3.new(0, 0, 0)
	subtitle.BackgroundTransparency = 0.45
	subtitle.TextColor3 = Color3.new(1, 1, 1)
	subtitle.Font = Enum.Font.GothamMedium
	subtitle.TextSize = CutsceneConfig.Overlay.SubtitleTextSize
	subtitle.TextWrapped = true
	subtitle.RichText = true
	subtitle.Visible = false
	subtitle.ZIndex = 6
	local padding = Instance.new("UIPadding")
	padding.PaddingTop = UDim.new(0, 6)
	padding.PaddingBottom = UDim.new(0, 6)
	padding.PaddingLeft = UDim.new(0, 12)
	padding.PaddingRight = UDim.new(0, 12)
	padding.Parent = subtitle
	local corner = Instance.new("UICorner")
	corner.CornerRadius = UDim.new(0, 6)
	corner.Parent = subtitle
	local constraint = Instance.new("UISizeConstraint")
	constraint.MaxSize = Vector2.new(900, math.huge)
	constraint.Parent = subtitle
	subtitle.Parent = gui

	local skip = Instance.new("TextLabel")
	skip.Name = "Skip"
	skip.AnchorPoint = Vector2.new(1, 1)
	skip.Position = UDim2.new(1, -20, 1, -16)
	skip.Size = UDim2.fromOffset(260, 22)
	skip.BackgroundTransparency = 1
	skip.TextColor3 = Color3.fromRGB(220, 220, 220)
	skip.TextStrokeTransparency = 0.6
	skip.Font = Enum.Font.Gotham
	skip.TextSize = 15
	skip.TextXAlignment = Enum.TextXAlignment.Right
	skip.Visible = false
	skip.ZIndex = 7
	skip.Parent = gui

	gui.Parent = player:WaitForChild("PlayerGui")
	return { Gui = gui, Top = top, Bottom = bottom, Fade = fade, Flash = flash, Subtitle = subtitle, Skip = skip }
end

local function get(): Ui
	if not ui or not ui.Gui.Parent then
		ui = make()
	end
	return ui :: Ui
end

-- `aspect` is the letterbox ratio (2.39, 2, 1.85...), `amount` 0..1 slides the bars.
function CinemaOverlay.SetLetterbox(aspect: number?, amount: number)
	local u = get()
	local viewport = workspace.CurrentCamera.ViewportSize
	local screen = viewport.X / math.max(1, viewport.Y)
	local bar = 0
	if aspect and aspect > screen then
		bar = (1 - screen / aspect) / 2
	end
	local height = UDim2.fromScale(1, bar * math.clamp(amount, 0, 1))
	u.Top.Size = height
	u.Bottom.Size = height
	u.Subtitle.Position = UDim2.new(0.5, 0, 1 - bar * amount, -16)
	u.Skip.Position = UDim2.new(1, -20, 1, -8)
end

function CinemaOverlay.SetFade(level: number)
	get().Fade.BackgroundTransparency = 1 - math.clamp(level, 0, 1)
end

function CinemaOverlay.GetFade(): number
	return if ui then 1 - ui.Fade.BackgroundTransparency else 0
end

local function hex(color: Color3): string
	return string.format("#%02X%02X%02X", math.floor(color.R * 255), math.floor(color.G * 255), math.floor(color.B * 255))
end

local function escape(text: string): string
	return (text:gsub("&", "&amp;"):gsub("<", "&lt;"):gsub(">", "&gt;"))
end

function CinemaOverlay.SetSubtitle(item: any?)
	local u = get()
	if not item then
		u.Subtitle.Visible = false
		return
	end
	local text = escape(item.Text)
	if item.Speaker then
		local colors = CutsceneConfig.Overlay.SubtitleSpeakerColors
		local color = colors[item.Speaker] or colors.Default
		text = `<font color="{hex(color)}"><b>{escape(item.Speaker)}</b></font>  {text}`
	end
	u.Subtitle.Text = text
	u.Subtitle.Visible = true
end

function CinemaOverlay.Flash(seconds: number?)
	local u = get()
	u.Flash.BackgroundTransparency = 0.2
	local started = os.clock()
	local duration = seconds or 0.08
	task.spawn(function()
		while os.clock() - started < duration do
			u.Flash.BackgroundTransparency = 0.2 + 0.8 * (os.clock() - started) / duration
			task.wait()
		end
		u.Flash.BackgroundTransparency = 1
	end)
end

function CinemaOverlay.SetSkip(text: string?)
	local u = get()
	u.Skip.Visible = text ~= nil
	u.Skip.Text = text or ""
end

function CinemaOverlay.Clear()
	if not ui then
		return
	end
	ui.Top.Size = UDim2.fromScale(1, 0)
	ui.Bottom.Size = UDim2.fromScale(1, 0)
	ui.Subtitle.Visible = false
	ui.Skip.Visible = false
end

-- Fades the black back out over `seconds` (after the scene's own FadeOut).
function CinemaOverlay.FadeBack(seconds: number?)
	local u = get()
	local from = 1 - u.Fade.BackgroundTransparency
	if from <= 0 then
		return
	end
	local duration = seconds or CutsceneConfig.Overlay.FadeBackTime
	local started = os.clock()
	task.spawn(function()
		while os.clock() - started < duration do
			u.Fade.BackgroundTransparency = 1 - from * (1 - (os.clock() - started) / duration)
			task.wait()
		end
		u.Fade.BackgroundTransparency = 1
	end)
end

---------------------------------------------------------------------------------------------
-- The game's UI and controls

function CinemaOverlay.HideGameUi()
	if coreState then
		return
	end
	local state = {}
	for _, kind in Enum.CoreGuiType:GetEnumItems() do
		if kind ~= Enum.CoreGuiType.All then
			state[kind] = StarterGui:GetCoreGuiEnabled(kind)
		end
	end
	coreState = state
	pcall(function()
		StarterGui:SetCoreGuiEnabled(Enum.CoreGuiType.All, false)
	end)
	hiddenGuis = {}
	local playerGui = Players.LocalPlayer:FindFirstChild("PlayerGui")
	if playerGui then
		for _, gui in playerGui:GetChildren() do
			if gui:IsA("ScreenGui") and gui.Enabled and not gui:GetAttribute(KEEP_ATTRIBUTE) then
				gui.Enabled = false
				table.insert(hiddenGuis, gui)
			end
		end
	end
end

function CinemaOverlay.RestoreGameUi()
	if coreState then
		for kind, enabled in coreState do
			pcall(function()
				StarterGui:SetCoreGuiEnabled(kind, enabled)
			end)
		end
		coreState = nil
	end
	for _, gui in hiddenGuis do
		if gui.Parent then
			gui.Enabled = true
		end
	end
	hiddenGuis = {}
end

local function controls(): any?
	local scripts = Players.LocalPlayer:FindFirstChild("PlayerScripts")
	local module = scripts and scripts:FindFirstChild("PlayerModule")
	if not module then
		return nil
	end
	local ok, playerModule = pcall(require, module)
	return if ok and playerModule then (playerModule :: any):GetControls() else nil
end

function CinemaOverlay.SetControlsEnabled(enabled: boolean)
	if enabled == not controlsDisabled then
		return
	end
	local c = controls()
	if c then
		if enabled then
			c:Enable()
		else
			c:Disable()
		end
	end
	controlsDisabled = not enabled
end

return CinemaOverlay
