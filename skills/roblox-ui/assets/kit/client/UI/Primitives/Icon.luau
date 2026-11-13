--!strict
-- A square image sized from the theme's icon steps. Tint with `color` (works best with white
-- artwork), and use `rectOffset` / `rectSize` for sprite sheets, which load as one texture.
--
--   e(Icon, { image = "rbxassetid://<id>", size = "L", color = "Currency" })

local ReplicatedStorage = game:GetService("ReplicatedStorage")

local React = require(ReplicatedStorage.Packages.React)
local Theme = require(script.Parent.Parent.Theme.Theme)
local UiContext = require(script.Parent.Parent.Foundation.UiContext)

local e = React.createElement

export type Props = {
	image: string,
	size: (number | string)?, -- an icon step ("S", "M", "L", "XL") or design units; default "M"
	color: Theme.ColorRef?, -- default: untinted
	transparency: any?, -- number or Binding<number>
	rectOffset: Vector2?, -- sprite sheet cell, in texture pixels
	rectSize: Vector2?,
	position: UDim2?,
	anchor: Vector2?,
	layoutOrder: number?,
	zIndex: number?,
	visible: any?,
}

local function Icon(props: Props)
	local ui = UiContext.useUi()
	local size = props.size or "M"
	local units = if type(size) == "number" then size else ui.theme.icon[size] or ui.theme.icon.M
	local side = ui.px(units)
	return e("ImageLabel", {
		Image = props.image,
		ImageColor3 = if props.color then ui.color(props.color) else Color3.new(1, 1, 1),
		ImageTransparency = props.transparency,
		ImageRectOffset = props.rectOffset,
		ImageRectSize = props.rectSize,
		ScaleType = Enum.ScaleType.Fit,
		Size = UDim2.fromOffset(side, side),
		Position = props.position,
		AnchorPoint = props.anchor,
		LayoutOrder = props.layoutOrder,
		ZIndex = props.zIndex,
		Visible = props.visible,
		BackgroundTransparency = 1,
	})
end

return Icon
