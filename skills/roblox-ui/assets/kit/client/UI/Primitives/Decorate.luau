--!strict
-- Shared style props -> the UI* modifier children Roblox needs (UICorner, UIStroke, UIPadding,
-- size constraints, UIFlexItem). Every primitive uses this, so `radius = Tokens.Radius.M` or
-- `padding = Tokens.Space.L` means the same thing on a Box, a Stack, a Grid or a Scroller.
-- All sizes are design units; this is where they become pixels.

local ReplicatedStorage = game:GetService("ReplicatedStorage")

local React = require(ReplicatedStorage.Packages.React)
local Tokens = require(script.Parent.Parent.Theme.Tokens)
local UiContext = require(script.Parent.Parent.Foundation.UiContext)

local e = React.createElement

export type Padding = number | {
	x: number?,
	y: number?,
	top: number?,
	bottom: number?,
	left: number?,
	right: number?,
}

export type Stroke = {
	color: Color3?,
	thickness: number?, -- design units; default Tokens.Stroke.Thin
	transparency: number?,
}

export type StyleProps = {
	-- geometry (Roblox values; offsets in UDim2 are pixels, so prefer scale or ui.px)
	size: UDim2?,
	position: UDim2?,
	anchor: Vector2?,
	automaticSize: Enum.AutomaticSize?,
	layoutOrder: number?,
	zIndex: number?,
	visible: any?, -- boolean or Binding<boolean>
	-- surface
	color: Color3?, -- background; nil = no background
	transparency: any?, -- number or Binding<number>; adjusted for the player's preference
	radius: (number | "Full")?,
	stroke: Stroke?,
	padding: Padding?,
	clip: boolean?,
	-- constraints (design units)
	aspectRatio: number?,
	minSize: Vector2?,
	maxSize: Vector2?,
	-- inside a Stack: take the remaining space ("Fill"), only grow, or only shrink
	flex: ("Fill" | "Grow" | "Shrink")?,
	-- escape hatch: extra host properties and events, e.g. { [React.Event.InputBegan] = fn }
	native: { [any]: any }?,
	children: any,
}

local FLEX_MODES = {
	Fill = Enum.UIFlexMode.Fill,
	Grow = Enum.UIFlexMode.Grow,
	Shrink = Enum.UIFlexMode.Shrink,
}

type Sides = { top: number, bottom: number, left: number, right: number }

local Decorate = {}

-- Padding in design units, resolved per side (`x`/`y` set both sides of an axis).
function Decorate.sides(padding: Padding?): Sides
	if padding == nil then
		return { top = 0, bottom = 0, left = 0, right = 0 }
	elseif type(padding) == "number" then
		return { top = padding, bottom = padding, left = padding, right = padding }
	end
	local p = padding :: any
	return {
		top = p.top or p.y or 0,
		bottom = p.bottom or p.y or 0,
		left = p.left or p.x or 0,
		right = p.right or p.x or 0,
	}
end

-- Background transparency for a surface, honouring GuiService.PreferredTransparency.
function Decorate.surfaceTransparency(props: StyleProps, ui: UiContext.Ui): any
	if props.color == nil then
		return 1
	end
	local base = props.transparency
	if base == nil then
		return 0
	elseif type(base) == "number" then
		return ui.transparency(base)
	end
	return base:map(ui.transparency) -- a Binding<number>
end

function Decorate.children(props: StyleProps, ui: UiContext.Ui): { [string]: any }
	local children: { [string]: any } = {}

	local radius = props.radius
	if radius ~= nil then
		children.Corner = e("UICorner", {
			CornerRadius = if radius == "Full" then UDim.new(0.5, 0) else UDim.new(0, ui.px(radius :: number)),
		})
	end

	local stroke = props.stroke
	if stroke then
		children.Stroke = e("UIStroke", {
			Color = stroke.color or ui.palette.Border,
			Thickness = math.max(1, ui.px(stroke.thickness or Tokens.Stroke.Thin)),
			Transparency = stroke.transparency or 0,
			ApplyStrokeMode = Enum.ApplyStrokeMode.Border,
		})
	end

	if props.padding ~= nil then
		local sides = Decorate.sides(props.padding)
		children.Padding = e("UIPadding", {
			PaddingTop = UDim.new(0, ui.px(sides.top)),
			PaddingBottom = UDim.new(0, ui.px(sides.bottom)),
			PaddingLeft = UDim.new(0, ui.px(sides.left)),
			PaddingRight = UDim.new(0, ui.px(sides.right)),
		})
	end

	if props.aspectRatio then
		children.AspectRatio = e("UIAspectRatioConstraint", { AspectRatio = props.aspectRatio })
	end

	if props.minSize or props.maxSize then
		local minSize = props.minSize or Vector2.zero
		local maxSize = props.maxSize
		children.SizeConstraint = e("UISizeConstraint", {
			MinSize = Vector2.new(ui.px(minSize.X), ui.px(minSize.Y)),
			MaxSize = if maxSize
				then Vector2.new(ui.px(maxSize.X), ui.px(maxSize.Y))
				else Vector2.new(math.huge, math.huge),
		})
	end

	if props.flex then
		children.Flex = e("UIFlexItem", { FlexMode = FLEX_MODES[props.flex] })
	end

	return children
end

-- Host properties shared by every Frame-like primitive.
function Decorate.hostProps(props: StyleProps, ui: UiContext.Ui): { [any]: any }
	local hostProps: { [any]: any } = {
		Size = props.size or (if props.automaticSize then UDim2.new() else UDim2.fromScale(1, 1)),
		Position = props.position,
		AnchorPoint = props.anchor,
		AutomaticSize = props.automaticSize,
		LayoutOrder = props.layoutOrder,
		ZIndex = props.zIndex,
		Visible = props.visible,
		BackgroundColor3 = props.color or Color3.new(),
		BackgroundTransparency = Decorate.surfaceTransparency(props, ui),
		BorderSizePixel = 0,
		ClipsDescendants = props.clip,
	}
	if props.native then
		for key, value in props.native do
			hostProps[key] = value
		end
	end
	return hostProps
end

return Decorate
