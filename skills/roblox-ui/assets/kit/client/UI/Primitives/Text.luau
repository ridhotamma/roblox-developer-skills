--!strict
-- Text from the theme's type scale. Font, sizes and weights come from `ui.theme` (font, type)
-- times the device scale, so every label of a variant is the same size on a screen and a theme
-- can change the font or make buttons bolder everywhere. The engine applies the player's Text
-- Size accessibility setting on top (TextScaled would ignore it). Line height and the outline
-- style come from theme.components.Text.
--
--   e(Text, { text = "Shop", variant = "Title" })                       -- hugs its content
--   e(Text, { text = description, width = UDim.new(1, 0), muted = true }) -- wraps, grows down
--   e(Text, { text = coinsBinding, variant = "Heading", outline = true })  -- binding, over the world
--
-- Sizing: give `width` to wrap at that width and grow downward (the usual case for paragraphs),
-- `size` for a fixed box, or neither to hug the text on one line.

local ReplicatedStorage = game:GetService("ReplicatedStorage")

local React = require(ReplicatedStorage.Packages.React)
local Theme = require(script.Parent.Parent.Theme.Theme)
local UiContext = require(script.Parent.Parent.Foundation.UiContext)

local e = React.createElement

-- "Display" | "Title" | "Heading" | "Button" | "Body" | "Label" | "Caption", or a style your
-- theme adds under `type`.
export type Variant = string

export type Props = {
	text: any, -- string or Binding<string>
	variant: Variant?, -- default Body
	color: Theme.ColorRef?, -- palette key ("Accent"), rarity or Color3; default "Text"
	muted: boolean?, -- "TextMuted"
	align: ("Left" | "Center" | "Right")?,
	verticalAlign: ("Top" | "Center" | "Bottom")?,
	width: UDim?,
	size: UDim2?,
	automaticSize: Enum.AutomaticSize?,
	wrap: boolean?,
	truncate: boolean?, -- "Long item na..." instead of overflowing (needs a fixed width)
	rich: boolean?, -- RichText; off by default so player-provided text can't inject tags
	outline: boolean?, -- dark outline for text drawn over the 3D world
	transparency: any?, -- number or Binding<number>
	localize: boolean?, -- false for names, numbers and anything that must not be auto-translated
	flex: ("Fill" | "Grow" | "Shrink")?, -- inside a Stack, e.g. a title that pushes a button aside
	position: UDim2?,
	anchor: Vector2?,
	layoutOrder: number?,
	zIndex: number?,
	visible: any?,
	native: { [any]: any }?,
	children: any,
}

local X_ALIGN = {
	Left = Enum.TextXAlignment.Left,
	Center = Enum.TextXAlignment.Center,
	Right = Enum.TextXAlignment.Right,
}
local Y_ALIGN = {
	Top = Enum.TextYAlignment.Top,
	Center = Enum.TextYAlignment.Center,
	Bottom = Enum.TextYAlignment.Bottom,
}
local FLEX_MODES = {
	Fill = Enum.UIFlexMode.Fill,
	Grow = Enum.UIFlexMode.Grow,
	Shrink = Enum.UIFlexMode.Shrink,
}

-- One Font object per family and weight, built once. This is the one place the kit builds
-- fonts, always from the theme's family.
local fonts: { [string]: Font } = {}
local function fontFor(family: string, weight: Enum.FontWeight): Font
	local key = `{family}|{weight.Name}`
	local font = fonts[key]
	if not font then
		font = Font.new(family, weight) -- ui:ignore hardcoded-style
		fonts[key] = font
	end
	return font
end

local Text = React.forwardRef(function(props: Props, ref: any)
	local ui = UiContext.useUi()
	local style = ui.theme.type[props.variant or "Body"] or ui.theme.type.Body
	local textStyle = ui.theme.components.Text

	-- Truncated text stays on one line ("Long item na..."); everything else wraps when it has a width.
	local wrapByDefault = props.wrap ~= false and not props.truncate
	local size: UDim2
	local automaticSize: Enum.AutomaticSize
	local wrap: boolean
	if props.size then
		size = props.size
		automaticSize = props.automaticSize or Enum.AutomaticSize.None
		wrap = wrapByDefault
	elseif props.width then
		size = UDim2.new(props.width, UDim.new(0, 0))
		automaticSize = Enum.AutomaticSize.Y
		wrap = wrapByDefault
	else
		size = UDim2.new()
		automaticSize = props.automaticSize or Enum.AutomaticSize.XY
		wrap = props.wrap == true
	end

	local hostProps: { [any]: any } = {
		Text = props.text,
		FontFace = fontFor(ui.theme.font, style.Weight),
		TextSize = ui.px(style.Size),
		LineHeight = textStyle.lineHeight,
		TextColor3 = ui.color(props.color or (if props.muted then "TextMuted" else "Text")),
		TextTransparency = props.transparency,
		TextXAlignment = X_ALIGN[props.align or "Left"],
		TextYAlignment = Y_ALIGN[props.verticalAlign or "Center"],
		TextWrapped = wrap,
		TextTruncate = if props.truncate then Enum.TextTruncate.AtEnd else Enum.TextTruncate.None,
		RichText = props.rich == true,
		AutoLocalize = props.localize ~= false,
		Size = size,
		AutomaticSize = automaticSize,
		Position = props.position,
		AnchorPoint = props.anchor,
		LayoutOrder = props.layoutOrder,
		ZIndex = props.zIndex,
		Visible = props.visible,
		BackgroundTransparency = 1,
		ref = ref,
	}
	if props.native then
		for key, value in props.native do
			hostProps[key] = value
		end
	end

	local children: { [string]: any } = {}
	if props.flex then
		children.Flex = e("UIFlexItem", { FlexMode = FLEX_MODES[props.flex] })
	end
	if props.outline then
		children.Outline = e("UIStroke", {
			ApplyStrokeMode = Enum.ApplyStrokeMode.Contextual,
			Color = ui.color(textStyle.outlineColor),
			Thickness = ui.stroke(textStyle.outlineWidth),
			Transparency = textStyle.outlineTransparency,
		})
	end
	children.Content = e(React.Fragment, nil, props.children)

	return e("TextLabel", hostProps, children)
end)

return Text
