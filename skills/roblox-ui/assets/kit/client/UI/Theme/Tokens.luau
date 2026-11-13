--!strict
-- Design tokens: the only place raw colours, sizes, spacing, type, motion and layer numbers live.
-- Components read tokens and never hard-code a Color3 or a pixel size, so changing a value here
-- changes the whole UI, and adding a palette re-themes every screen at once.
--
-- Sizes are in design units: 1 unit = 1 pixel at scale 1. Components turn units into pixels
-- with `ui.px(n)` (Foundation/UiContext), which applies the device scale computed from `Scale`.
-- Think of a unit as a "point" on a phone: 44 units is a comfortable thumb target everywhere.

export type Palette = {
	Background: Color3, -- full-screen backdrops (loading, menus that hide the world)
	Surface: Color3, -- panels, cards, toasts
	SurfaceRaised: Color3, -- secondary buttons, selected rows, inputs
	SurfaceSunken: Color3, -- wells: progress tracks, the area behind a grid
	Border: Color3,
	Scrim: Color3, -- dims the world behind a modal
	Text: Color3,
	TextMuted: Color3,
	TextOnAccent: Color3, -- text on Accent / Positive / Danger fills
	Accent: Color3,
	Positive: Color3,
	Danger: Color3,
	Warning: Color3,
	Currency: Color3,
	Focus: Color3, -- gamepad / keyboard selection ring
}

export type TypeStyle = { Size: number, Weight: Enum.FontWeight }
export type Spring = { Frequency: number, Damping: number }
export type ScaleProfile = { Reference: number, Min: number, Max: number }

local function deepFreeze<T>(value: T): T
	for _, child in value :: any do
		if type(child) == "table" and not table.isfrozen(child) then
			deepFreeze(child)
		end
	end
	return table.freeze(value :: any) :: any
end

local Tokens = {}

-- Every palette has the same keys. Text colours meet WCAG AA (4.5:1) on Surface; fills meet it
-- with TextOnAccent. Check new palettes with a contrast checker before shipping them.
Tokens.Palettes = {
	Dark = {
		Background = Color3.fromRGB(15, 17, 23),
		Surface = Color3.fromRGB(26, 29, 38),
		SurfaceRaised = Color3.fromRGB(38, 43, 57),
		SurfaceSunken = Color3.fromRGB(17, 19, 26),
		Border = Color3.fromRGB(58, 64, 84),
		Scrim = Color3.fromRGB(0, 0, 0),
		Text = Color3.fromRGB(242, 244, 248),
		TextMuted = Color3.fromRGB(163, 171, 189),
		TextOnAccent = Color3.fromRGB(255, 255, 255),
		Accent = Color3.fromRGB(40, 98, 240),
		Positive = Color3.fromRGB(20, 130, 65),
		Danger = Color3.fromRGB(210, 45, 60),
		Warning = Color3.fromRGB(245, 170, 40),
		Currency = Color3.fromRGB(255, 200, 60),
		Focus = Color3.fromRGB(255, 255, 255),
	} :: Palette,
	-- For players who need more contrast, or a setting in your options menu.
	HighContrast = {
		Background = Color3.fromRGB(0, 0, 0),
		Surface = Color3.fromRGB(8, 8, 10),
		SurfaceRaised = Color3.fromRGB(30, 30, 36),
		SurfaceSunken = Color3.fromRGB(0, 0, 0),
		Border = Color3.fromRGB(235, 235, 235),
		Scrim = Color3.fromRGB(0, 0, 0),
		Text = Color3.fromRGB(255, 255, 255),
		TextMuted = Color3.fromRGB(225, 225, 225),
		TextOnAccent = Color3.fromRGB(255, 255, 255),
		Accent = Color3.fromRGB(0, 80, 220),
		Positive = Color3.fromRGB(0, 115, 50),
		Danger = Color3.fromRGB(190, 0, 30),
		Warning = Color3.fromRGB(255, 190, 0),
		Currency = Color3.fromRGB(255, 215, 0),
		Focus = Color3.fromRGB(255, 230, 0),
	} :: Palette,
}

-- Rarity colours are also shown as a label (never colour alone: about 1 in 12 boys is colourblind).
Tokens.Rarity = {
	Common = Color3.fromRGB(170, 176, 190),
	Uncommon = Color3.fromRGB(80, 200, 120),
	Rare = Color3.fromRGB(70, 150, 255),
	Epic = Color3.fromRGB(175, 95, 255),
	Legendary = Color3.fromRGB(255, 170, 40),
}

-- Spacing scale. Use these names, not numbers, so spacing stays on one rhythm.
Tokens.Space = {
	None = 0,
	XXS = 2,
	XS = 4,
	S = 8,
	M = 12,
	L = 16,
	XL = 24,
	XXL = 32,
	XXXL = 48,
}

-- Corner radii. Primitives also accept "Full" for pills and circles.
Tokens.Radius = {
	None = 0,
	S = 4,
	M = 8,
	L = 12,
	XL = 16,
}

Tokens.Stroke = {
	Thin = 1,
	Regular = 2,
	Thick = 3,
}

-- Builder Sans ships with every Roblox client (Regular, Medium, Bold, ExtraBold), so no font
-- download is needed and text renders on the first frame. Gotham and Arial are deprecated.
Tokens.FontFamily = "rbxasset://fonts/families/BuilderSans.json"

-- Type scale. TextSize comes from here (times the device scale), never TextScaled: TextScaled
-- makes every label a different size and ignores the player's Text Size accessibility setting.
Tokens.Type = {
	Display = { Size = 40, Weight = Enum.FontWeight.ExtraBold } :: TypeStyle,
	Title = { Size = 28, Weight = Enum.FontWeight.ExtraBold } :: TypeStyle,
	Heading = { Size = 20, Weight = Enum.FontWeight.Bold } :: TypeStyle,
	Button = { Size = 16, Weight = Enum.FontWeight.Bold } :: TypeStyle,
	Body = { Size = 16, Weight = Enum.FontWeight.Regular } :: TypeStyle,
	Label = { Size = 14, Weight = Enum.FontWeight.Bold } :: TypeStyle,
	Caption = { Size = 12, Weight = Enum.FontWeight.Medium } :: TypeStyle,
}

-- Control heights. Buttons never go below the hit target for the current input (HitTarget).
Tokens.Control = {
	Small = 32,
	Medium = 44,
	Large = 56,
}

Tokens.IconSize = {
	S = 16,
	M = 24,
	L = 32,
	XL = 48,
}

-- Minimum interactive size per input, in design units. 44 is Apple's and Roblox's touch guideline.
Tokens.HitTarget = {
	Touch = 44,
	Pointer = 24,
	Gamepad = 44,
}

Tokens.Motion = {
	-- Seconds, for TweenService-style transitions.
	Fast = 0.12,
	Base = 0.2,
	Slow = 0.35,
	-- Springs for Motion.useSpring. Frequency in Hz (higher = faster); Damping 1 = no overshoot.
	Springs = {
		Snappy = { Frequency = 5, Damping = 1 } :: Spring,
		Bouncy = { Frequency = 4, Damping = 0.55 } :: Spring,
		Gentle = { Frequency = 2, Damping = 1 } :: Spring,
	},
}

-- ScreenGui.DisplayOrder per layer. Higher draws on top, whatever order things mount in.
Tokens.Layers = {
	Hud = 0,
	Menu = 10,
	Modal = 20,
	Toast = 30,
	Loading = 100,
}

-- Size classes, measured in design units of the safe area (see Foundation/Responsive):
--   Compact:  short side < CompactShortSide           (phones, either orientation)
--   Medium:   width < ExpandedWidth                    (tablets in portrait, small windows)
--   Expanded: everything else                          (desktop, laptop, console, tablet landscape)
Tokens.Breakpoints = {
	CompactShortSide = 500,
	ExpandedWidth = 1100,
}

-- Device scale = clamp(safe area short side / Reference, Min, Max), by profile:
--   Touch: phones stay at 1 (44 units = 44 points), tablets grow a little.
--   Pointer: about 1.18 at 1080p, 1.6 at 1440p, 2 at 4K, so desktop layouts get roughly the same
--            ~1600 x 860 design units on any monitor.
--   TenFoot: consoles on a TV, read from across the room.
Tokens.Scale = {
	Touch = { Reference = 720, Min = 1, Max = 1.25 } :: ScaleProfile,
	Pointer = { Reference = 864, Min = 0.75, Max = 2 } :: ScaleProfile,
	TenFoot = { Reference = 720, Min = 1.25, Max = 1.5 } :: ScaleProfile,
}

Tokens.Transparency = {
	Surface = 0.04,
	Hud = 0.25, -- HUD chips over the 3D world
	Scrim = 0.4,
	Disabled = 0.5,
}

return deepFreeze(Tokens)
