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
export type Insets = { Top: number, Bottom: number, Left: number, Right: number }
export type Rect = { position: Vector2, size: Vector2 }

export type Metrics = {
	viewport: Vector2, -- whole screen, pixels
	safe: Vector2, -- what a ScreenGui with CoreUISafeInsets gets, pixels
	overscan: Insets, -- extra padding inside the safe area on TVs (Tokens.Overscan), pixels
	room: Vector2, -- the safe area minus overscan: what a Safe layer's content gets, pixels
	scale: number, -- design units -> pixels
	design: Vector2, -- the room in design units: what a layout really has
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

local NO_INSETS: Insets = table.freeze({ Top = 0, Bottom = 0, Left = 0, Right = 0 })

-- TVs may crop the outer edge of the picture. On a ten-foot interface keep Tokens.Overscan of
-- the screen clear on every edge, minus what the safe insets already clear (the Roblox top bar
-- is taller than 5% of a 1080p screen, so the top usually needs nothing extra). Horizontal
-- insets are assumed symmetric and vertical ones at the top, which is true for TVs.
function Responsive.overscanFor(viewport: Vector2, safe: Vector2, tenFoot: boolean): Insets
	local share = if tenFoot then Tokens.Overscan.TenFoot else 0
	if share <= 0 then
		return NO_INSETS
	end
	local side = math.max(0, math.round(viewport.X * share - (viewport.X - safe.X) / 2))
	local edgeY = math.round(viewport.Y * share)
	return {
		Top = math.max(0, edgeY - math.round(viewport.Y - safe.Y)),
		Bottom = edgeY,
		Left = side,
		Right = side,
	}
end

function Responsive.measure(viewport: Vector2, safe: Vector2, input: InputMode, tenFoot: boolean): Metrics
	-- Scale comes from the whole safe area, so a TV keeps its ten-foot scale; the layout room
	-- excludes overscan.
	local scale = Responsive.scaleFor(safe, input, tenFoot)
	local overscan = Responsive.overscanFor(viewport, safe, tenFoot)
	local room = Vector2.new(
		math.max(0, safe.X - overscan.Left - overscan.Right),
		math.max(0, safe.Y - overscan.Top - overscan.Bottom)
	)
	local design = room / scale
	return {
		viewport = viewport,
		safe = safe,
		overscan = overscan,
		room = room,
		scale = scale,
		design = design,
		sizeClass = Responsive.classify(design),
		orientation = if room.Y > room.X then "Portrait" else "Landscape",
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

-- How many items of `item` size fit in a row or column of `available`, with `gap` between
-- them. Unlike `columns`, this can be 0: the caller decides what gives way.
function Responsive.fit(available: number, item: number, gap: number): number
	if item <= 0 then
		return 0
	end
	return math.max(0, math.floor((available + gap) / (item + gap)))
end

-- Splits `items` into what is shown and what overflows into a "More" button, for a strip with
-- room for `capacity` slots. When everything fits, nothing overflows and no More is needed;
-- otherwise More takes one slot and the most important items keep the rest. `priority` returns
-- a number per item (lower = more important; nil = its position), ties keep list order. Both
-- results keep the original order, so the strip doesn't reshuffle as the screen changes.
function Responsive.overflow<T>(items: { T }, capacity: number, priority: ((T, number) -> number?)?): ({ T }, { T })
	if #items <= capacity then
		return table.clone(items), {}
	end
	local keep = math.max(0, capacity - 1)
	local ranked = {}
	for index, item in items do
		local rank = if priority then priority(item, index) else nil
		table.insert(ranked, { index = index, rank = rank or index })
	end
	table.sort(ranked, function(a, b)
		if a.rank ~= b.rank then
			return a.rank < b.rank
		end
		return a.index < b.index
	end)
	local kept: { [number]: boolean } = {}
	for i = 1, keep do
		kept[ranked[i].index] = true
	end
	local shown, hidden = {}, {}
	for index, item in items do
		table.insert(if kept[index] then shown else hidden, item)
	end
	return shown, hidden
end

-- When a piece of UI should exist at all, by the room and the input (never by device name):
--   { sizeClass = "Expanded" }                   -- only with room for it
--   { sizeClass = { "Medium", "Expanded" } }    -- everything but phones
--   { input = "Gamepad" }                        -- button glyph legends
--   { orientation = "Landscape", minHeight = 400 }
-- Every field given must match; an empty rule always matches. minWidth / minHeight are design
-- units of the room. Use it through Primitives/Show, or as a `visible` value to keep the
-- element mounted (and its state) while hidden.
export type Rule = {
	sizeClass: (SizeClass | { SizeClass })?,
	input: (InputMode | { InputMode })?,
	orientation: Orientation?,
	tenFoot: boolean?,
	minWidth: number?,
	minHeight: number?,
}

export type Situation = {
	sizeClass: SizeClass,
	input: InputMode,
	orientation: Orientation,
	tenFoot: boolean,
	design: Vector2,
}

-- A rule field is one value or a list of values; nil matches anything.
local function oneOf(value: string, wanted: any): boolean
	if wanted == nil then
		return true
	elseif type(wanted) == "table" then
		return table.find(wanted :: { string }, value) ~= nil
	end
	return value == wanted
end

function Responsive.matches(situation: Situation, rule: Rule?): boolean
	if rule == nil then
		return true
	end
	return oneOf(situation.sizeClass, rule.sizeClass)
		and oneOf(situation.input, rule.input)
		and (rule.orientation == nil or situation.orientation == rule.orientation)
		and (rule.tenFoot == nil or situation.tenFoot == rule.tenFoot)
		and (rule.minWidth == nil or situation.design.X >= rule.minWidth)
		and (rule.minHeight == nil or situation.design.Y >= rule.minHeight)
end

return Responsive
