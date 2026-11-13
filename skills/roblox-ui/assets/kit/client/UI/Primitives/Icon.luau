--!strict
-- A square image sized from Tokens.IconSize. Tint with `color` (works best with white artwork),
-- and use `rectOffset` / `rectSize` for sprite sheets, which load as one texture.
--
--   e(Icon, { image = "rbxassetid://<id>", size = Tokens.IconSize.L, color = ui.palette.Currency })

local ReplicatedStorage = game:GetService("ReplicatedStorage")

local React = require(ReplicatedStorage.Packages.React)
local Tokens = require(script.Parent.Parent.Theme.Tokens)
local UiContext = require(script.Parent.Parent.Foundation.UiContext)

local e = React.createElement

export type Props = {
	image: string,
	size: number?, -- design units; default Tokens.IconSize.M
	color: Color3?,
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
	local side = ui.px(props.size or Tokens.IconSize.M)
	return e("ImageLabel", {
		Image = props.image,
		ImageColor3 = props.color or Color3.new(1, 1, 1),
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
