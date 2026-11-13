--!strict
-- The shop: category tabs, a responsive grid of items, and the selected item's details.
--
-- One component, three layouts:
--   * Expanded (desktop, console, tablet landscape): grid on the left, a details column on the
--     right with a big picture, description and the Buy button.
--   * Medium (tablet portrait, small windows): same, with a narrower details column.
--   * Compact (phones): the grid takes the whole sheet and the selected item sits in a bar pinned
--     to the bottom with the Buy button under the player's thumb.
-- The grid picks its own column count from the width, so no layout lists device sizes.
--
-- Purchases are requests: onBuy asks the server, which checks the price and balance and answers
-- with a toast. The client never adds the item itself.

local ReplicatedStorage = game:GetService("ReplicatedStorage")

local React = require(ReplicatedStorage.Packages.React)
local Box = require(script.Parent.Parent.Primitives.Box)
local Button = require(script.Parent.Parent.Primitives.Button)
local Card = require(script.Parent.Parent.Components.Card)
local Grid = require(script.Parent.Parent.Primitives.Grid)
local ItemTile = require(script.Parent.Parent.Components.ItemTile)
local Modal = require(script.Parent.Parent.Components.Modal)
local Navigation = require(script.Parent.Parent.Foundation.Navigation)
local NumberFormat = require(script.Parent.Parent.Foundation.NumberFormat)
local Responsive = require(script.Parent.Parent.Foundation.Responsive)
local Scroller = require(script.Parent.Parent.Primitives.Scroller)
local Stack = require(script.Parent.Parent.Primitives.Stack)
local Tabs = require(script.Parent.Parent.Components.Tabs)
local Text = require(script.Parent.Parent.Primitives.Text)
local UiContext = require(script.Parent.Parent.Foundation.UiContext)

local e = React.createElement

local ALL = "all"

export type Props = {
	open: boolean,
	items: { ItemTile.Item },
	coins: number,
	owned: { [string]: boolean },
	onBuy: (itemId: string) -> (),
	onClose: () -> (),
}

type Purchase = { label: string, disabled: boolean }

local function purchaseState(item: ItemTile.Item?, coins: number, owned: { [string]: boolean }): Purchase
	if item == nil then
		return { label = "Select an item", disabled = true }
	elseif owned[item.id] then
		return { label = "Owned", disabled = true }
	elseif coins < item.price then
		return { label = `Need {NumberFormat.Short(item.price - coins)} more`, disabled = true }
	end
	return { label = `Buy for {NumberFormat.Short(item.price)}`, disabled = false }
end

local function categoriesOf(items: { ItemTile.Item }): { Tabs.Tab }
	local tabs: { Tabs.Tab } = { { id = ALL, label = "All" } }
	local seen = {}
	for _, item in items do
		local category = item.category
		if category and not seen[category] then
			seen[category] = true
			table.insert(tabs, { id = category, label = category })
		end
	end
	return tabs
end

local function Details(props: { item: ItemTile.Item?, purchase: Purchase, onBuy: () -> (), width: number })
	local ui = UiContext.useUi()
	local item = props.item
	return e(Stack, {
		size = UDim2.new(0, ui.px(props.width), 1, 0),
		gap = "M",
		padding = "L",
		color = "SurfaceRaised",
		align = "Stretch",
		layoutOrder = 2,
	}, {
		Picture = e(Card, {
			size = UDim2.fromScale(1, 0),
			aspectRatio = 1,
			color = ui.theme.components.Tile.artColor,
			stroke = false,
			padding = 0,
			layoutOrder = 1,
		}, {
			Image = if item and item.image
				then e("ImageLabel", {
					Image = item.image,
					Size = UDim2.fromScale(1, 1),
					ScaleType = Enum.ScaleType.Fit,
					BackgroundTransparency = 1,
				})
				else nil,
		}),
		Name = e(Text, {
			text = if item then item.name else "",
			variant = "Heading",
			width = UDim.new(1, 0),
			layoutOrder = 2,
		}),
		Rarity = if item
			then e(Text, {
				text = item.rarity or "Common",
				variant = "Label",
				color = item.rarity or "Common",
				layoutOrder = 3,
			})
			else nil,
		Description = e(Scroller, { size = UDim2.fromScale(1, 0), flex = "Fill", layoutOrder = 4 }, {
			Text = e(Text, {
				text = if item then item.description or "" else "",
				muted = true,
				width = UDim.new(1, 0),
				verticalAlign = "Top",
			}),
		}),
		Buy = e(Button, {
			text = props.purchase.label,
			variant = "Positive",
			width = UDim.new(1, 0),
			disabled = props.purchase.disabled,
			hint = Enum.KeyCode.ButtonX,
			onActivate = props.onBuy,
			layoutOrder = 5,
		}),
	})
end

local function BuyBar(props: { item: ItemTile.Item?, purchase: Purchase, onBuy: () -> () })
	local item = props.item
	return e(Stack, {
		direction = "Row",
		align = "Center",
		gap = "M",
		size = UDim2.fromScale(1, 0),
		automaticSize = Enum.AutomaticSize.Y,
		padding = "M",
		color = "SurfaceRaised",
		layoutOrder = 3,
	}, {
		Info = e(Stack, { size = UDim2.fromScale(0, 0), automaticSize = Enum.AutomaticSize.Y, flex = "Fill", layoutOrder = 1 }, {
			Name = e(Text, {
				text = if item then item.name else "",
				variant = "Label",
				width = UDim.new(1, 0),
				truncate = true,
				layoutOrder = 1,
			}),
			Rarity = if item
				then e(Text, {
					text = item.rarity or "Common",
					variant = "Caption",
					color = item.rarity or "Common",
					layoutOrder = 2,
				})
				else nil,
		}),
		Buy = e(Button, {
			text = props.purchase.label,
			variant = "Positive",
			disabled = props.purchase.disabled,
			hint = Enum.KeyCode.ButtonX,
			onActivate = props.onBuy,
			layoutOrder = 2,
		}),
	})
end

local function ShopScreen(props: Props)
	local ui = UiContext.useUi()
	local category, setCategory = React.useState(ALL)
	local selectedId, setSelectedId = React.useState(nil :: string?)

	local tabs = React.useMemo(function()
		return categoriesOf(props.items)
	end, { props.items })

	local visible: { ItemTile.Item } = {}
	local selected: ItemTile.Item? = nil
	for _, item in props.items do
		if category == ALL or item.category == category then
			table.insert(visible, item)
			if item.id == selectedId then
				selected = item
			end
		end
	end
	if selected == nil then
		selected = visible[1] -- keep something selected so the Buy button always has a target
	end

	local purchase = purchaseState(selected, props.coins, props.owned)
	local function buy()
		if selected and not purchase.disabled then
			props.onBuy(selected.id)
		end
	end
	Navigation.useShortcut({ Enum.KeyCode.ButtonX }, buy, props.open)

	local tiles: { [string]: any } = {}
	for index, item in visible do
		tiles[`Item_{item.id}`] = e(ItemTile, {
			item = item,
			selected = selected ~= nil and item.id == selected.id,
			owned = props.owned[item.id] == true,
			affordable = props.coins >= item.price,
			onSelect = setSelectedId,
			layoutOrder = index,
		})
	end

	local compact = ui.sizeClass == "Compact"
	local detailsWidth = Responsive.pick(ui.sizeClass, { Compact = 0, Medium = 240, Expanded = 300 })

	-- Both layouts stack tabs over the grid in a column; the grid takes the height that's left.
	local tabStrip = e(Box, {
		size = UDim2.fromScale(1, 0),
		automaticSize = Enum.AutomaticSize.Y,
		padding = { x = "M", top = if compact then "S" else "M" },
		layoutOrder = 1,
	}, {
		Tabs = e(Tabs, { tabs = tabs, selected = category, onSelect = setCategory, shortcuts = props.open }),
	})
	local gridArea = e(Scroller, {
		size = UDim2.fromScale(1, 0),
		flex = "Fill",
		padding = "M",
		layoutOrder = 2,
	}, {
		Grid = e(Grid, {
			minItemWidth = Responsive.pick(ui.sizeClass, { Compact = 112, Expanded = 136 }),
			aspectRatio = 0.78,
			gap = "S",
		}, tiles),
	})

	local body
	if compact then
		body = e(Stack, { align = "Stretch" }, {
			Tabs = tabStrip,
			Grid = gridArea,
			BuyBar = e(BuyBar, { item = selected, purchase = purchase, onBuy = buy }),
		})
	else
		body = e(Stack, { direction = "Row", align = "Stretch" }, {
			Browse = e(Stack, { size = UDim2.fromScale(0, 1), flex = "Fill", align = "Stretch", layoutOrder = 1 }, {
				Tabs = tabStrip,
				Grid = gridArea,
			}),
			Details = e(Details, { item = selected, purchase = purchase, onBuy = buy, width = detailsWidth }),
		})
	end

	return e(Modal, {
		open = props.open,
		title = "Shop",
		onClose = props.onClose,
		width = 1040,
		height = 680,
		scroll = false,
	}, { Body = body })
end

return ShopScreen
