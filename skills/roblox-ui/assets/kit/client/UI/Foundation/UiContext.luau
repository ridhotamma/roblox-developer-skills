--!strict
-- The UI environment every component reads with `UiContext.useUi()`: screen metrics and size
-- class, input mode, the player's accessibility settings, the active theme and palette, and
-- helpers that turn design values into Roblox values. UiProvider builds it; nothing else should
-- measure the screen or pick colours.
--
--   local ui = UiContext.useUi()
--   local style = ui.theme.components.Card            -- a component's look, from the theme
--   BackgroundColor3 = ui.color("Accent")              -- palette key, rarity or Color3
--   Padding = UDim.new(0, ui.space("L"))               -- space step or design units -> pixels
--   CornerRadius = ui.corner(style.radius)             -- radius step, units or "Full" -> UDim
--   Size = UDim2.fromOffset(ui.px(320), ui.px(ui.theme.control.Medium))
--   if ui.sizeClass == "Compact" then ... end

local ReplicatedStorage = game:GetService("ReplicatedStorage")

local React = require(ReplicatedStorage.Packages.React)
local Responsive = require(script.Parent.Responsive)
local Theme = require(script.Parent.Parent.Theme.Theme)
local Tokens = require(script.Parent.Parent.Theme.Tokens)

export type Insets = Responsive.Insets
export type Rect = Responsive.Rect

export type Ui = {
	-- Screen (see Responsive.Metrics)
	viewport: Vector2,
	safe: Vector2,
	room: Vector2, -- pixels a Safe layer's content gets: the safe area minus TV overscan
	overscan: Insets, -- pixels Safe and Device layers pad on a TV (zero elsewhere)
	design: Vector2,
	scale: number,
	sizeClass: Responsive.SizeClass,
	orientation: Responsive.Orientation,
	input: Responsive.InputMode,
	tenFoot: boolean,

	-- Roblox's own UI that takes room (Foundation/CoreUi), in pixels of a Safe layer's content:
	chatWindow: Rect?, -- the default chat window, or nil when there is none
	keyboard: number, -- height the on-screen keyboard covers at the bottom of the room; 0 when hidden

	-- Player accessibility settings (Settings -> Accessibility in the Roblox menu)
	reducedMotion: boolean, -- GuiService.ReducedMotionEnabled: skip or shorten animation
	preferredTransparency: number, -- GuiService.PreferredTransparency: 1 default, 0 = wants opaque

	-- Look
	theme: Theme.Theme,
	palette: Theme.Palette,
	paletteName: string,

	-- Design units -> whole pixels (whole pixels keep 1-unit strokes and text crisp).
	px: (units: number) -> number,
	-- Theme references -> Roblox values.
	color: (ref: Theme.ColorRef) -> Color3,
	space: (ref: Theme.SpaceRef) -> number, -- pixels
	stroke: (ref: Theme.StrokeRef) -> number, -- pixels, at least 1
	corner: (ref: Theme.RadiusRef) -> UDim,
	-- Background transparency adjusted for the player's Background Transparency setting.
	transparency: (base: number) -> number,
	-- Smallest interactive size for the current input, in design units.
	hitTarget: number,

	-- Story previews: true when UiProvider simulates a device instead of measuring the screen.
	simulated: boolean,
	insets: Insets, -- simulated device insets (pixels); zero when live
	topbar: number, -- simulated Roblox top bar height (pixels); zero when live
	previewScale: number, -- extra UIScale above the UI (story previews); 1 when live
}

export type BuildOptions = {
	theme: Theme.Theme?,
	palette: string?, -- a palette of the theme; default theme.defaultPalette
	reducedMotion: boolean?,
	preferredTransparency: number?,
	simulated: boolean?,
	insets: Insets?,
	topbar: number?,
	previewScale: number?,
	chatWindow: Rect?, -- relative to the safe area's top-left, pixels
	keyboard: number?, -- pixels the on-screen keyboard covers at the bottom of the safe area
}

local NO_INSETS: Insets = table.freeze({ Top = 0, Bottom = 0, Left = 0, Right = 0 })

-- Safe-area pixels -> pixels of a Safe layer's content (which starts after the overscan), and
-- dropped when it doesn't reach into the content at all.
local function intoRoom(rect: Rect?, metrics: Responsive.Metrics): Rect?
	if rect == nil then
		return nil
	end
	local origin = Vector2.new(metrics.overscan.Left, metrics.overscan.Top)
	local position = rect.position - origin
	local finish = position + rect.size
	if finish.X <= 0 or finish.Y <= 0 or position.X >= metrics.room.X or position.Y >= metrics.room.Y then
		return nil
	end
	return { position = position, size = rect.size }
end
local FULL = UDim.new(0.5, 0)

local UiContext = {}

UiContext.Context = React.createContext(nil :: Ui?)

function UiContext.build(metrics: Responsive.Metrics, options: BuildOptions): Ui
	local scale = metrics.scale
	local theme = options.theme or Theme.default
	local paletteName = options.palette or theme.defaultPalette
	local palette = theme.palettes[paletteName]
	if palette == nil then
		paletteName = theme.defaultPalette
		palette = theme.palettes[paletteName]
	end
	local preferred = math.clamp(options.preferredTransparency or 1, 0, 1)

	local function px(units: number): number
		return math.round(units * scale)
	end

	return {
		viewport = metrics.viewport,
		safe = metrics.safe,
		room = metrics.room,
		overscan = metrics.overscan,
		design = metrics.design,
		scale = scale,
		sizeClass = metrics.sizeClass,
		orientation = metrics.orientation,
		input = metrics.input,
		tenFoot = metrics.tenFoot,

		chatWindow = intoRoom(options.chatWindow, metrics),
		keyboard = math.clamp((options.keyboard or 0) - metrics.overscan.Bottom, 0, metrics.room.Y),

		reducedMotion = options.reducedMotion == true,
		preferredTransparency = preferred,

		theme = theme,
		palette = palette,
		paletteName = paletteName,

		px = px,
		color = function(ref: Theme.ColorRef): Color3
			return Theme.color(theme, palette, ref)
		end,
		space = function(ref: Theme.SpaceRef): number
			return px(Theme.space(theme, ref))
		end,
		stroke = function(ref: Theme.StrokeRef): number
			return math.max(1, px(Theme.stroke(theme, ref)))
		end,
		corner = function(ref: Theme.RadiusRef): UDim
			local units = Theme.radius(theme, ref)
			return if units == nil then FULL else UDim.new(0, px(units))
		end,
		transparency = function(base: number): number
			return base * preferred
		end,
		hitTarget = Tokens.HitTarget[metrics.input],

		simulated = options.simulated == true,
		insets = options.insets or NO_INSETS,
		topbar = options.topbar or 0,
		previewScale = options.previewScale or 1,
	}
end

function UiContext.useUi(): Ui
	local ui = React.useContext(UiContext.Context)
	if ui == nil then
		error("useUi() was called outside a UiProvider: wrap the app (or the story) in UiProvider", 2)
	end
	return ui
end

return UiContext
