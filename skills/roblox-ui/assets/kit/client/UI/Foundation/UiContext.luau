--!strict
-- The UI environment every component reads with `UiContext.useUi()`: screen metrics and size
-- class, input mode, the player's accessibility settings, the palette, and `px` to turn design
-- units into pixels. UiProvider builds it; nothing else should measure the screen.
--
--   local ui = UiContext.useUi()
--   Size = UDim2.fromOffset(ui.px(320), ui.px(Tokens.Control.Medium))
--   BackgroundTransparency = ui.transparency(Tokens.Transparency.Hud)
--   if ui.sizeClass == "Compact" then ... end

local ReplicatedStorage = game:GetService("ReplicatedStorage")

local React = require(ReplicatedStorage.Packages.React)
local Responsive = require(script.Parent.Responsive)
local Tokens = require(script.Parent.Parent.Theme.Tokens)

export type Insets = { Top: number, Bottom: number, Left: number, Right: number }

export type Ui = {
	-- Screen (see Responsive.Metrics)
	viewport: Vector2,
	safe: Vector2,
	design: Vector2,
	scale: number,
	sizeClass: Responsive.SizeClass,
	orientation: Responsive.Orientation,
	input: Responsive.InputMode,
	tenFoot: boolean,

	-- Player accessibility settings (Settings -> Accessibility in the Roblox menu)
	reducedMotion: boolean, -- GuiService.ReducedMotionEnabled: skip or shorten animation
	preferredTransparency: number, -- GuiService.PreferredTransparency: 1 default, 0 = wants opaque

	palette: Tokens.Palette,
	paletteName: string,

	-- Design units -> whole pixels (whole pixels keep 1-unit strokes and text crisp).
	px: (units: number) -> number,
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
	palette: string?,
	reducedMotion: boolean?,
	preferredTransparency: number?,
	simulated: boolean?,
	insets: Insets?,
	topbar: number?,
	previewScale: number?,
}

local NO_INSETS: Insets = table.freeze({ Top = 0, Bottom = 0, Left = 0, Right = 0 })

local UiContext = {}

UiContext.Context = React.createContext(nil :: Ui?)

function UiContext.build(metrics: Responsive.Metrics, options: BuildOptions): Ui
	local scale = metrics.scale
	local paletteName = options.palette or "Dark"
	local palette = (Tokens.Palettes :: any)[paletteName] or Tokens.Palettes.Dark
	local preferred = math.clamp(options.preferredTransparency or 1, 0, 1)

	return {
		viewport = metrics.viewport,
		safe = metrics.safe,
		design = metrics.design,
		scale = scale,
		sizeClass = metrics.sizeClass,
		orientation = metrics.orientation,
		input = metrics.input,
		tenFoot = metrics.tenFoot,

		reducedMotion = options.reducedMotion == true,
		preferredTransparency = preferred,

		palette = palette,
		paletteName = paletteName,

		px = function(units: number): number
			return math.round(units * scale)
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
