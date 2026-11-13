--!strict
-- A tile for shop, inventory and reward grids: picture, name, price, rarity, owned state.
-- Fills whatever cell the Grid gives it. Selecting a tile (click, tap, or moving gamepad
-- selection onto it) calls onSelect, so console players see details as they browse.
-- Rarity is shown as a coloured border and as a word, never colour alone.
--
--   e(ItemTile, { item = item, selected = item.id == selectedId, owned = owned[item.id],
--                 affordable = coins >= item.price, onSelect = setSelectedId, layoutOrder = i })

local ReplicatedStorage = game:GetService("ReplicatedStorage")

local React = require(ReplicatedStorage.Packages.React)
local Box = require(script.Parent.Parent.Primitives.Box)
local NumberFormat = require(script.Parent.Parent.Foundation.NumberFormat)
local Stack = require(script.Parent.Parent.Primitives.Stack)
local Text = require(script.Parent.Parent.Primitives.Text)
local Tokens = require(script.Parent.Parent.Theme.Tokens)
local UiContext = require(script.Parent.Parent.Foundation.UiContext)

local e = React.createElement

export type Rarity = "Common" | "Uncommon" | "Rare" | "Epic" | "Legendary"

export type Item = {
	id: string,
	name: string,
	price: number,
	rarity: Rarity?,
	category: string?,
	description: string?,
	image: string?, -- rbxassetid://...; without one the tile shows the name's initial
}

export type Props = {
	item: Item,
	selected: boolean?,
	owned: boolean?,
	affordable: boolean?,
	onSelect: ((id: string) -> ())?,
	layoutOrder: number?,
}

-- Roblox's default selection box is replaced by the tile's own border.
local NO_SELECTION_IMAGE = Instance.new("Frame")
NO_SELECTION_IMAGE.BackgroundTransparency = 1

local function Picture(props: { item: Item, color: Color3 })
	local ui = UiContext.useUi()
	if props.item.image then
		return e("ImageLabel", {
			Image = props.item.image,
			ScaleType = Enum.ScaleType.Fit,
			Size = UDim2.fromScale(1, 0),
			BackgroundTransparency = 1,
			LayoutOrder = 1,
		}, {
			Flex = e("UIFlexItem", { FlexMode = Enum.UIFlexMode.Fill }),
		})
	end
	return e(Box, {
		size = UDim2.fromScale(1, 0),
		flex = "Fill",
		color = ui.palette.SurfaceSunken,
		radius = Tokens.Radius.M,
		layoutOrder = 1,
	}, {
		Initial = e(Text, {
			text = string.upper(string.sub(props.item.name, 1, 1)),
			variant = "Title",
			color = props.color,
			size = UDim2.fromScale(1, 1),
			align = "Center",
			localize = false,
		}),
	})
end

local function ItemTile(props: Props)
	local ui = UiContext.useUi()
	local focused, setFocused = React.useState(false)
	local item = props.item
	local rarity: Rarity = item.rarity or "Common"
	local rarityColor = Tokens.Rarity[rarity]

	local function select()
		if props.onSelect then
			props.onSelect(item.id)
		end
	end

	local borderColor = if focused then ui.palette.Focus elseif props.selected then ui.palette.Accent else rarityColor
	local borderThickness = if focused or props.selected then Tokens.Stroke.Thick else Tokens.Stroke.Regular

	local priceText: string
	local priceColor: Color3
	if props.owned then
		priceText = "Owned"
		priceColor = ui.palette.TextMuted
	else
		priceText = NumberFormat.Short(item.price)
		priceColor = if props.affordable == false then ui.palette.Danger else ui.palette.Currency
	end

	return e("TextButton", {
		Text = "",
		AutoButtonColor = false,
		BackgroundColor3 = if props.selected then ui.palette.SurfaceRaised else ui.palette.Surface,
		BackgroundTransparency = 0,
		BorderSizePixel = 0,
		LayoutOrder = props.layoutOrder,
		SelectionImageObject = NO_SELECTION_IMAGE,
		[React.Event.Activated] = select,
		[React.Event.SelectionGained] = function()
			setFocused(true)
			select()
		end,
		[React.Event.SelectionLost] = function()
			setFocused(false)
		end,
	}, {
		Corner = e("UICorner", { CornerRadius = UDim.new(0, ui.px(Tokens.Radius.L)) }),
		Stroke = e("UIStroke", {
			Color = borderColor,
			Thickness = math.max(1, ui.px(borderThickness)),
			ApplyStrokeMode = Enum.ApplyStrokeMode.Border,
		}),
		Content = e(Stack, {
			gap = Tokens.Space.XS,
			padding = Tokens.Space.S,
			align = "Stretch",
		}, {
			Picture = e(Picture, { item = item, color = rarityColor }),
			Name = e(Text, {
				text = item.name,
				variant = "Label",
				size = UDim2.new(1, 0, 0, ui.px(Tokens.Type.Label.Size + 4)),
				truncate = true,
				layoutOrder = 2,
			}),
			Footer = e(Stack, {
				direction = "Row",
				justify = "SpaceBetween",
				align = "Center",
				size = UDim2.new(1, 0, 0, ui.px(Tokens.Type.Caption.Size + 4)),
				layoutOrder = 3,
			}, {
				Rarity = e(Text, { text = rarity, variant = "Caption", color = rarityColor, layoutOrder = 1 }),
				Price = e(Text, {
					text = priceText,
					variant = "Caption",
					color = priceColor,
					localize = props.owned == true,
					layoutOrder = 2,
				}),
			}),
		}),
	})
end

return ItemTile
