--!strict
-- Shared style props -> the UI* modifier children Roblox needs (UICorner, UIStroke, UIPadding,
-- size constraints, UIFlexItem). Every primitive uses this, so `radius = "M"` or `padding = "L"`
-- means the same thing on a Box, a Stack, a Grid or a Scroller.
--
-- Style props take theme references, Tailwind style:
--   color = "Surface"            a palette key (or a rarity, or a Color3)
--   radius = "L" | "Full" | 12   a radius step (scaled by theme roundness), a pill, or design units
--   padding = "L" | 16 | { x = "L", y = "S" }
--   stroke = { color = "Border", thickness = "Thin" }
-- so a theme change reaches every component built from these primitives.

local ReplicatedStorage = game:GetService("ReplicatedStorage")

local React = require(ReplicatedStorage.Packages.React)
local Theme = require(script.Parent.Parent.Theme.Theme)
local UiContext = require(script.Parent.Parent.Foundation.UiContext)

local e = React.createElement

export type Padding = Theme.SpaceRef | {
	x: Theme.SpaceRef?,
	y: Theme.SpaceRef?,
	top: Theme.SpaceRef?,
	bottom: Theme.SpaceRef?,
	left: Theme.SpaceRef?,
	right: Theme.SpaceRef?,
}

export type Stroke = {
	color: Theme.ColorRef?, -- default "Border"
	thickness: Theme.StrokeRef?, -- default "Thin"
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
	color: Theme.ColorRef?, -- background; nil = no background
	transparency: any?, -- number or Binding<number>; adjusted for the player's preference
	radius: Theme.RadiusRef?,
	stroke: (Stroke | false)?,
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

export type Sides = { top: number, bottom: number, left: number, right: number }

local Decorate = {}

-- Padding resolved per side, in pixels (`x` / `y` set both sides of an axis).
function Decorate.sides(padding: Padding?, ui: UiContext.Ui): Sides
	if padding == nil then
		return { top = 0, bottom = 0, left = 0, right = 0 }
	elseif type(padding) ~= "table" then
		local all = ui.space(padding :: Theme.SpaceRef)
		return { top = all, bottom = all, left = all, right = all }
	end
	local p = padding :: any
	return {
		top = ui.space(p.top or p.y or 0),
		bottom = ui.space(p.bottom or p.y or 0),
		left = ui.space(p.left or p.x or 0),
		right = ui.space(p.right or p.x or 0),
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

	if props.radius ~= nil then
		children.Corner = e("UICorner", { CornerRadius = ui.corner(props.radius) })
	end

	local stroke = props.stroke
	if stroke then
		children.Stroke = e("UIStroke", {
			Color = ui.color(stroke.color or "Border"),
			Thickness = ui.stroke(stroke.thickness or "Thin"),
			Transparency = stroke.transparency or 0,
			ApplyStrokeMode = Enum.ApplyStrokeMode.Border,
		})
	end

	if props.padding ~= nil then
		local sides = Decorate.sides(props.padding, ui)
		children.Padding = e("UIPadding", {
			PaddingTop = UDim.new(0, sides.top),
			PaddingBottom = UDim.new(0, sides.bottom),
			PaddingLeft = UDim.new(0, sides.left),
			PaddingRight = UDim.new(0, sides.right),
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
		BackgroundColor3 = if props.color then ui.color(props.color) else nil,
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
