--!strict
-- Pure responsive maths: device scale, size class, orientation, and helpers to choose values
-- per size class. No Instances and no React, so UiProvider (live screen), stories (simulated
-- devices) and tests all get the same answers.
--
-- Two independent questions drive every responsive decision:
--   * How much room is there?        -> sizeClass (Compact / Medium / Expanded) and `design` size
--   * How is the player interacting? -> input (Touch / Pointer / Gamepad) and tenFoot
-- Never infer one from the other: a tablet with a keyboard is Pointer, a phone is not always
-- small in design units, a PC can have a gamepad. "isMobile" checks are the classic bug.

local Tokens = require(script.Parent.Parent.Theme.Tokens)

export type SizeClass = "Compact" | "Medium" | "Expanded"
export type InputMode = "Touch" | "Pointer" | "Gamepad"
export type Orientation = "Portrait" | "Landscape"

export type Metrics = {
	viewport: Vector2, -- whole screen, pixels
	safe: Vector2, -- what a ScreenGui with CoreUISafeInsets gets, pixels
	scale: number, -- design units -> pixels
	design: Vector2, -- the safe area in design units: the room a layout really has
	sizeClass: SizeClass,
	orientation: Orientation,
	input: InputMode,
	tenFoot: boolean,
}

local Responsive = {}

function Responsive.profile(input: InputMode, tenFoot: boolean): Tokens.ScaleProfile
	if tenFoot then
		return Tokens.Scale.TenFoot
	elseif input == "Touch" then
		return Tokens.Scale.Touch
	end
	return Tokens.Scale.Pointer
end

-- Rounded to 0.01 so dragging a window edge doesn't re-render the whole UI every pixel.
function Responsive.scaleFor(safe: Vector2, input: InputMode, tenFoot: boolean): number
	local shortSide = math.min(safe.X, safe.Y)
	if shortSide <= 0 then
		return 1
	end
	local profile = Responsive.profile(input, tenFoot)
	local scale = math.clamp(shortSide / profile.Reference, profile.Min, profile.Max)
	return math.round(scale * 100) / 100
end

function Responsive.classify(design: Vector2): SizeClass
	if math.min(design.X, design.Y) < Tokens.Breakpoints.CompactShortSide then
		return "Compact"
	elseif design.X < Tokens.Breakpoints.ExpandedWidth then
		return "Medium"
	end
	return "Expanded"
end

function Responsive.measure(viewport: Vector2, safe: Vector2, input: InputMode, tenFoot: boolean): Metrics
	local scale = Responsive.scaleFor(safe, input, tenFoot)
	local design = safe / scale
	return {
		viewport = viewport,
		safe = safe,
		scale = scale,
		design = design,
		sizeClass = Responsive.classify(design),
		orientation = if safe.Y > safe.X then "Portrait" else "Landscape",
		input = input,
		tenFoot = tenFoot,
	}
end

-- Mobile-first value per size class, like min-width media queries: Compact is required,
-- Medium falls back to Compact, Expanded falls back to Medium (then Compact).
--   Responsive.pick(ui.sizeClass, { Compact = 2, Expanded = 4 })  -- Medium gets 2
-- Works with false/0 values (checks for nil, not truthiness).
function Responsive.pick<T>(sizeClass: SizeClass, values: { Compact: T, Medium: T?, Expanded: T? }): T
	if sizeClass == "Expanded" and values.Expanded ~= nil then
		return values.Expanded :: T
	end
	if sizeClass ~= "Compact" and values.Medium ~= nil then
		return values.Medium :: T
	end
	return values.Compact
end

-- How many columns of at least `minItem` fit in `available`, with `gap` between them.
-- All three in the same unit (pixels in practice). Always at least 1.
function Responsive.columns(available: number, minItem: number, gap: number, maxColumns: number?): number
	if available <= 0 or minItem <= 0 then
		return 1
	end
	local fit = math.floor((available + gap) / (minItem + gap))
	return math.clamp(fit, 1, maxColumns or math.huge)
end

return Responsive
