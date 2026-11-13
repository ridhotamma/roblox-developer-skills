--!strict
-- The theme: every visual decision the kit makes, in one table you override without touching
-- component code. It plays the role of MUI's createTheme, Tailwind's config and shadcn's CSS
-- variables:
--
--   local Theme = require(script.Parent.Theme)
--   return Theme.create({
--       roundness = 1.5,                                      -- every corner 1.5x rounder
--       palettes = { Dark = { Accent = Color3.fromRGB(190, 70, 0) } },
--       components = {
--           Button = { radius = "Full", depth = 0 },          -- flat pill buttons
--           Card = { stroke = false },                         -- borderless cards
--       },
--   })
--
-- How it works:
--   * Overrides merge into the defaults key by key: write only what differs. Unknown keys warn
--     once (a typo like `raduis` would otherwise do nothing silently).
--   * Values can be references, resolved against the active theme: a palette key ("Accent"), a
--     space step ("L"), a radius step ("M") or "Full", a stroke step ("Thin"). Change the palette
--     or a scale and every component that refers to it follows.
--   * `roundness` multiplies the radius scale: 0 = square everywhere, 1 = default, 2 = very round.
--     Like shadcn's single --radius variable.
--   * `components` holds each component's look (Button, Card, Modal, Tile, Toast, Pill,
--     ProgressBar, Tabs, Text, Scroller). Add entries for your own components too:
--     `components = { QuestCard = { radius = "XL" } }`, read with `ui.theme.components.QuestCard`.
--   * New palettes start from the default palette, so `palettes = { Halloween = { Accent = ... } }`
--     is a complete palette. New Button variants start from `{ text = "Text" }`.
--   * Theme.create(overrides, base) extends any theme, so presets can build on your game theme.
--
-- Not in the theme, on purpose: hit targets, breakpoints, device scale and layers (Tokens).
-- They are ergonomics and device behaviour, not looks; lowering them breaks phones.

local Tokens = require(script.Parent.Tokens)

export type Palette = Tokens.Palette
export type TypeStyle = Tokens.TypeStyle
export type Spring = Tokens.Spring

export type ColorRef = string | Color3 -- a palette key ("Accent"), a rarity ("Epic"), or a colour
export type SpaceRef = number | string -- design units, or a space step ("L")
export type RadiusRef = number | string -- design units, a radius step ("M"), or "Full"
export type StrokeRef = number | string -- design units, or a stroke step ("Thin", "Regular", "Thick")

export type ButtonVariant = {
	fill: ColorRef | false, -- false = no background (Ghost)
	text: ColorRef,
	stroke: ColorRef | false,
}

export type ButtonStyle = {
	radius: RadiusRef,
	depth: number, -- the lip under solid buttons, design units; 0 = flat
	hoverTint: number, -- 0..1 toward white on pointer hover
	disabledMix: number, -- 0..1 toward Surface when disabled
	strokeWidth: StrokeRef, -- border width for variants with a stroke
	focusWidth: StrokeRef, -- gamepad / keyboard focus ring width
	gap: SpaceRef, -- between icon, label and hint
	padding: { Small: SpaceRef, Medium: SpaceRef, Large: SpaceRef }, -- horizontal
	text: { Small: string, Medium: string, Large: string }, -- type styles
	icon: { Small: string, Medium: string, Large: string }, -- icon steps
	badge: { size: number, dot: number, color: ColorRef, text: ColorRef },
	variants: { [string]: ButtonVariant },
}

export type CardStyle = {
	radius: RadiusRef,
	color: ColorRef,
	raisedColor: ColorRef, -- tone = "Raised"
	transparency: number,
	stroke: ColorRef | false,
	strokeWidth: StrokeRef,
	padding: SpaceRef,
	gap: SpaceRef,
}

export type ModalStyle = {
	radius: RadiusRef, -- dialogs; phone sheets are always square
	color: ColorRef,
	transparency: number,
	stroke: ColorRef | false,
	strokeWidth: StrokeRef,
	padding: SpaceRef, -- body and header inset
	margin: SpaceRef, -- minimum gap between a dialog and the safe-area edge
	scrim: number, -- transparency of the dimmed world
	width: number, -- default dialog size, design units
	height: number,
	headerHeight: number,
	dividerColor: ColorRef,
	footerColor: ColorRef,
	footerPadding: SpaceRef,
}

export type TileStyle = {
	radius: RadiusRef,
	color: ColorRef,
	selectedColor: ColorRef,
	stroke: ColorRef,
	rarityBorder: boolean, -- border in the item's rarity colour instead of `stroke`
	selectedStroke: ColorRef,
	strokeWidth: StrokeRef,
	selectedStrokeWidth: StrokeRef,
	padding: SpaceRef,
	gap: SpaceRef,
	artRadius: RadiusRef,
	artColor: ColorRef,
}

export type ToastStyle = {
	radius: RadiusRef,
	color: ColorRef,
	transparency: number,
	strokeWidth: StrokeRef,
	maxWidth: number,
	paddingX: SpaceRef,
	paddingY: SpaceRef,
	gap: SpaceRef,
	offset: SpaceRef, -- distance from the top of the safe area
	tones: { Info: ColorRef, Positive: ColorRef, Danger: ColorRef },
}

export type PillStyle = { radius: RadiusRef, color: ColorRef, transparency: number, gap: SpaceRef, glyph: ColorRef }
export type ProgressBarStyle = { radius: RadiusRef, height: number, track: ColorRef, fill: ColorRef }
export type TabsStyle = { selected: string, idle: string, size: string, gap: SpaceRef }
export type TextStyle = { lineHeight: number, outlineColor: ColorRef, outlineWidth: number, outlineTransparency: number }
export type ScrollerStyle = { barWidth: number, touchBarWidth: number, barColor: ColorRef, barTransparency: number }

export type Components = {
	Button: ButtonStyle,
	Card: CardStyle,
	Modal: ModalStyle,
	Tile: TileStyle,
	Toast: ToastStyle,
	Pill: PillStyle,
	ProgressBar: ProgressBarStyle,
	Tabs: TabsStyle,
	Text: TextStyle,
	Scroller: ScrollerStyle,
	[string]: any, -- your own components' styles
}

export type Theme = {
	name: string,
	defaultPalette: string,
	palettes: { [string]: Palette },
	rarity: { [string]: Color3 },
	font: string,
	type: { [string]: TypeStyle },
	space: { [string]: number },
	roundness: number,
	radius: { [string]: number }, -- the radius scale with roundness applied
	stroke: { [string]: number },
	control: { Small: number, Medium: number, Large: number },
	icon: { [string]: number },
	transparency: { Surface: number, Hud: number, Scrim: number, Disabled: number },
	springs: { [string]: Spring },
	components: Components,
	config: { [string]: any }, -- the merged settings before resolving; what Theme.create extends
}

local DEFAULTS = {
	name = "Default",
	defaultPalette = "Dark",
	palettes = Tokens.Palettes,
	rarity = Tokens.Rarity,
	font = Tokens.FontFamily,
	type = Tokens.Type,
	space = Tokens.Space,
	roundness = 1,
	radius = Tokens.Radius,
	stroke = Tokens.Stroke,
	control = Tokens.Control,
	icon = Tokens.IconSize,
	transparency = Tokens.Transparency,
	springs = Tokens.Motion.Springs,
	components = {
		Button = {
			radius = "M",
			depth = 3,
			hoverTint = 0.12,
			disabledMix = 0.6,
			strokeWidth = "Thin",
			focusWidth = "Thick",
			gap = "S",
			padding = { Small = "M", Medium = "L", Large = "XL" },
			text = { Small = "Label", Medium = "Button", Large = "Heading" },
			icon = { Small = "S", Medium = "M", Large = "L" },
			badge = { size = 18, dot = 12, color = "Danger", text = "TextOnAccent" },
			variants = {
				Primary = { fill = "Accent", text = "TextOnAccent", stroke = false },
				Secondary = { fill = "SurfaceRaised", text = "Text", stroke = "Border" },
				Positive = { fill = "Positive", text = "TextOnAccent", stroke = false },
				Danger = { fill = "Danger", text = "TextOnAccent", stroke = false },
				Ghost = { fill = false, text = "Text", stroke = false },
			},
		},
		Card = {
			radius = "L",
			color = "Surface",
			raisedColor = "SurfaceRaised",
			transparency = Tokens.Transparency.Surface,
			stroke = "Border",
			strokeWidth = "Thin",
			padding = "L",
			gap = "S",
		},
		Modal = {
			radius = "L",
			color = "Surface",
			transparency = Tokens.Transparency.Surface,
			stroke = "Border",
			strokeWidth = "Thin",
			padding = "L",
			margin = "XL",
			scrim = Tokens.Transparency.Scrim,
			width = 640,
			height = 560,
			headerHeight = Tokens.Control.Large,
			dividerColor = "Border",
			footerColor = "SurfaceRaised",
			footerPadding = "M",
		},
		Tile = {
			radius = "L",
			color = "Surface",
			selectedColor = "SurfaceRaised",
			stroke = "Border",
			rarityBorder = true,
			selectedStroke = "Accent",
			strokeWidth = "Regular",
			selectedStrokeWidth = "Thick",
			padding = "S",
			gap = "XS",
			artRadius = "M",
			artColor = "SurfaceSunken",
		},
		Toast = {
			radius = "M",
			color = "Surface",
			transparency = Tokens.Transparency.Surface,
			strokeWidth = "Regular",
			maxWidth = 420,
			paddingX = "L",
			paddingY = "M",
			gap = "S",
			offset = "S",
			tones = { Info = "Accent", Positive = "Positive", Danger = "Danger" },
		},
		Pill = {
			radius = "Full",
			color = "Surface",
			transparency = Tokens.Transparency.Hud,
			gap = "S",
			glyph = "Currency",
		},
		ProgressBar = {
			radius = "Full",
			height = 14,
			track = "SurfaceSunken",
			fill = "Accent",
		},
		Tabs = {
			selected = "Primary",
			idle = "Ghost",
			size = "Small",
			gap = "XS",
		},
		Text = {
			lineHeight = 1.1,
			outlineColor = Color3.new(0, 0, 0),
			outlineWidth = 1.5,
			outlineTransparency = 0.35,
		},
		Scroller = {
			barWidth = 6,
			touchBarWidth = 3,
			barColor = "TextMuted",
			barTransparency = 0.4,
		},
	},
}

-- Maps that accept new keys (new palettes, variants, steps, your own components). Everything
-- else only accepts keys the defaults have, so typos are caught.
local OPEN: { [string]: boolean } = {
	palettes = true,
	rarity = true,
	type = true,
	space = true,
	radius = true,
	icon = true,
	stroke = true,
	springs = true,
	components = true,
	["components.Button.variants"] = true,
}

local VARIANT_TEMPLATE = table.freeze({ fill = false, text = "Text", stroke = false })

-- Fields whose string values must name a palette colour or a rarity.
local COLOR_FIELDS: { [string]: boolean } = {
	color = true,
	raisedColor = true,
	selectedColor = true,
	stroke = true,
	selectedStroke = true,
	artColor = true,
	dividerColor = true,
	footerColor = true,
	track = true,
	fill = true,
	glyph = true,
	outlineColor = true,
	barColor = true,
	Info = true,
	Positive = true,
	Danger = true,
}

local warned: { [string]: boolean } = {}
local function warnOnce(message: string)
	if not warned[message] then
		warned[message] = true
		warn(`[Theme] {message}`)
	end
end

local function isTable(value: any): boolean
	return type(value) == "table"
end

local function merge(base: { [string]: any }, overrides: { [string]: any }, path: string, root: { [string]: any }): { [string]: any }
	local result = table.clone(base)
	for key, value in overrides do
		if type(key) ~= "string" then
			warnOnce(`ignored a non-string key under "{path}"`)
			continue
		end
		local keyPath = if path == "" then key else `{path}.{key}`
		local current = base[key]
		if current == nil then
			if not OPEN[path] then
				warnOnce(`unknown key "{keyPath}" ignored (typo?)`)
			elseif path == "palettes" and isTable(value) then
				-- A new palette starts as a copy of the default one.
				result[key] = merge(root.palettes[root.defaultPalette], value, keyPath, root)
			elseif path == "components.Button.variants" and isTable(value) then
				result[key] = merge(VARIANT_TEMPLATE :: any, value, keyPath, root)
			else
				result[key] = value
			end
		elseif isTable(current) then
			if isTable(value) then
				result[key] = merge(current, value, keyPath, root)
			else
				warnOnce(`"{keyPath}" should be a table, ignored`)
			end
		elseif isTable(value) then
			warnOnce(`"{keyPath}" should be a {typeof(current)}, not a table, ignored`)
		else
			result[key] = value
		end
	end
	return result
end

local function deepFreeze(value: any): any
	if type(value) == "table" and not table.isfrozen(value) then
		for _, child in value do
			deepFreeze(child)
		end
		table.freeze(value)
	end
	return value
end

local function checkColorRefs(node: any, path: string, palette: { [string]: any }, rarity: { [string]: any })
	for key, value in node do
		local keyPath = `{path}.{key}`
		if type(value) == "table" then
			checkColorRefs(value, keyPath, palette, rarity)
		elseif type(value) == "string" and COLOR_FIELDS[key] and palette[value] == nil and rarity[value] == nil then
			warnOnce(`"{keyPath}" = "{value}" is not a palette colour`)
		end
	end
end

local function resolve(config: { [string]: any }): Theme
	local roundness = math.max(0, tonumber(config.roundness) or 1)
	local radius = {}
	for name, value in config.radius do
		radius[name] = value * roundness
	end

	local theme = table.clone(config)
	theme.roundness = roundness
	theme.radius = radius
	theme.config = config
	if config.palettes[config.defaultPalette] == nil then
		warnOnce(`defaultPalette "{config.defaultPalette}" is not in palettes; using Dark`)
		theme.defaultPalette = "Dark"
	end
	checkColorRefs(config.components, "components", theme.palettes[theme.defaultPalette], config.rarity)
	for size, style in config.components.Button.text do
		if config.type[style] == nil then
			warnOnce(`components.Button.text.{size} = "{style}" is not a type style`)
		end
	end
	return deepFreeze(theme) :: Theme
end

local Theme = {}

Theme.default = resolve(DEFAULTS)

-- A theme from overrides on top of `base` (default: the kit's default theme).
function Theme.create(overrides: { [string]: any }?, base: Theme?): Theme
	local from = (base or Theme.default).config
	return resolve(merge(from, overrides or {}, "", from))
end

-- Resolvers. Components use the `ui.color / ui.space / ui.corner` wrappers from UiContext.

function Theme.color(theme: Theme, palette: Palette, ref: ColorRef): Color3
	if typeof(ref) == "Color3" then
		return ref
	end
	local found = (palette :: any)[ref] or theme.rarity[ref :: string]
	if found then
		return found
	end
	warnOnce(`colour "{ref}" is not in the palette`)
	return palette.Text
end

function Theme.space(theme: Theme, ref: SpaceRef): number
	if type(ref) == "number" then
		return ref
	end
	local found = theme.space[ref :: string]
	if found then
		return found
	end
	warnOnce(`space "{ref}" is not a space step`)
	return 0
end

function Theme.stroke(theme: Theme, ref: StrokeRef): number
	if type(ref) == "number" then
		return ref
	end
	local found = theme.stroke[ref :: string]
	if found then
		return found
	end
	warnOnce(`stroke "{ref}" is not a stroke step`)
	return 1
end

-- Returns design units, or nil for "Full" (a pill or circle).
function Theme.radius(theme: Theme, ref: RadiusRef): number?
	if ref == "Full" then
		return nil
	elseif type(ref) == "number" then
		return ref
	end
	local found = theme.radius[ref :: string]
	if found then
		return found
	end
	warnOnce(`radius "{ref}" is not a radius step`)
	return 0
end

return Theme
