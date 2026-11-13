--!strict
-- A tile for shop, inventory and reward grids: picture, name, price, rarity, owned state.
-- Fills whatever cell the Grid gives it. Selecting a tile (click, tap, or moving gamepad
-- selection onto it) calls onSelect, so console players see details as they browse.
-- Rarity is shown as a coloured border and as a word, never colour alone. Look (corners,
-- colours, border widths, rarity border on or off, picture well): theme.components.Tile;
-- rarity colours: theme.rarity.
--
--   e(ItemTile, { item = item, selected = item.id == selectedId, owned = owned[item.id],
--                 affordable = coins >= item.price, onSelect = setSelectedId, layoutOrder = i })

local ReplicatedStorage = game:GetService("ReplicatedStorage")

local React = require(ReplicatedStorage.Packages.React)
local Box = require(script.Parent.Parent.Primitives.Box)
local NumberFormat = require(script.Parent.Parent.Foundation.NumberFormat)
local Stack = require(script.Parent.Parent.Primitives.Stack)
local Text = require(script.Parent.Parent.Primitives.Text)
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
	local style = ui.theme.components.Tile
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
		color = style.artColor,
		radius = style.artRadius,
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
	local style = ui.theme.components.Tile
	local focused, setFocused = React.useState(false)
	local item = props.item
	local rarity: Rarity = item.rarity or "Common"
	local rarityColor = ui.color(rarity)

	local function select()
		if props.onSelect then
			props.onSelect(item.id)
		end
	end

	local borderColor = if focused
		then ui.palette.Focus
		elseif props.selected then ui.color(style.selectedStroke)
		elseif style.rarityBorder then rarityColor
		else ui.color(style.stroke)
	local borderThickness = if focused or props.selected then style.selectedStrokeWidth else style.strokeWidth

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
		BackgroundColor3 = ui.color(if props.selected then style.selectedColor else style.color),
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
		Corner = e("UICorner", { CornerRadius = ui.corner(style.radius) }),
		Stroke = e("UIStroke", {
			Color = borderColor,
			Thickness = ui.stroke(borderThickness),
			ApplyStrokeMode = Enum.ApplyStrokeMode.Border,
		}),
		Content = e(Stack, {
			gap = style.gap,
			padding = style.padding,
			align = "Stretch",
		}, {
			Picture = e(Picture, { item = item, color = rarityColor }),
			Name = e(Text, {
				text = item.name,
				variant = "Label",
				size = UDim2.new(1, 0, 0, ui.px(ui.theme.type.Label.Size + 4)),
				truncate = true,
				layoutOrder = 2,
			}),
			Footer = e(Stack, {
				direction = "Row",
				justify = "SpaceBetween",
				align = "Center",
				size = UDim2.new(1, 0, 0, ui.px(ui.theme.type.Caption.Size + 4)),
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
