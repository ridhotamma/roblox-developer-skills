--!strict
-- The one button. Works the same with mouse, touch, gamepad and keyboard navigation:
--   * `Activated` (not MouseButton1Click), so taps and the gamepad A button work;
--   * never shorter than the hit target for the current input (44 units on touch and gamepad);
--   * hover only tints on a pointer; touch gets a press-down instead;
--   * draws its own focus ring when selected by gamepad / keyboard navigation;
--   * `hint` shows the platform's glyph for a shortcut (ButtonX, ButtonY...) only on gamepad.
--     The hint is visual: bind the key with Navigation.useShortcut where the action lives.
--
--   e(Button, { text = "Buy", variant = "Positive", onActivate = buy, hint = Enum.KeyCode.ButtonX })
--   e(Button, { icon = closeIcon, variant = "Ghost", size = "Small", onActivate = close })
--   e(Button, { text = "Play", size = "Large", width = UDim.new(1, 0) })    -- full width
--
-- Its whole look is theme.components.Button: corner radius, the lip depth (0 = flat), hover and
-- disabled tints, border and focus widths, padding, type and icon per size, the badge, and the
-- variants (fill / text / stroke colours). Add a variant in your theme and use it by name:
--   components = { Button = { variants = { Gold = { fill = "Currency", text = "Background" } } } }
--
-- Width hugs the content (localised text can be 30-50% longer than English) unless `width` is set.

local ReplicatedStorage = game:GetService("ReplicatedStorage")
local UserInputService = game:GetService("UserInputService")

local React = require(ReplicatedStorage.Packages.React)
local Icon = require(script.Parent.Icon)
local Motion = require(script.Parent.Parent.Foundation.Motion)
local Text = require(script.Parent.Text)
local UiContext = require(script.Parent.Parent.Foundation.UiContext)

local e = React.createElement

-- "Primary" | "Secondary" | "Positive" | "Danger" | "Ghost", or a variant your theme adds.
export type Variant = string
export type Size = "Small" | "Medium" | "Large"

export type Props = {
	text: string?,
	icon: string?,
	variant: Variant?, -- default Primary
	size: Size?, -- default Medium
	width: UDim?, -- nil = hug content
	disabled: boolean?,
	onActivate: (() -> ())?,
	onSelected: (() -> ())?, -- gamepad / keyboard selection moved onto this button
	hint: Enum.KeyCode?,
	badge: (boolean | string)?, -- a dot, or a short count like "3"
	selectable: boolean?,
	position: UDim2?,
	anchor: Vector2?,
	layoutOrder: number?,
	zIndex: number?,
	visible: any?,
	native: { [any]: any }?,
	children: any, -- custom content instead of icon + text
}

local WHITE = Color3.new(1, 1, 1)
local BLACK = Color3.new(0, 0, 0)

-- Roblox's default selection box is replaced by our own focus ring.
local NO_SELECTION_IMAGE = Instance.new("Frame")
NO_SELECTION_IMAGE.BackgroundTransparency = 1

local function isPress(input: InputObject): boolean
	local inputType = input.UserInputType
	return inputType == Enum.UserInputType.MouseButton1
		or inputType == Enum.UserInputType.Touch
		or input.KeyCode == Enum.KeyCode.ButtonA
end

local Button = React.forwardRef(function(props: Props, ref: any)
	local ui = UiContext.useUi()
	local style = ui.theme.components.Button
	local hovered, setHovered = React.useState(false)
	local pressed, setPressed = React.useState(false)
	local focused, setFocused = React.useState(false)

	local disabled = props.disabled == true
	local size: Size = props.size or "Medium"
	local variant = style.variants[props.variant or "Primary"] or style.variants.Primary
	local fill = if variant.fill then ui.color(variant.fill) else nil
	local textColor = ui.color(variant.text)
	local pointerHover = hovered and ui.input == "Pointer" and not disabled

	local press = Motion.useSpring(if pressed and not disabled then 1 else 0)
	local height = ui.px(math.max(ui.theme.control[size], ui.hitTarget))
	local depth = if fill then ui.px(style.depth) else 0 -- the lip under solid buttons

	local faceColor = fill
	if fill and disabled then
		faceColor = fill:Lerp(ui.palette.Surface, style.disabledMix)
	elseif fill and pointerHover then
		faceColor = fill:Lerp(WHITE, style.hoverTint)
	end
	local labelColor = if disabled then ui.palette.TextMuted else textColor

	local hintImage = React.useMemo(function(): string?
		local key = props.hint
		if key == nil then
			return nil
		end
		local ok, image = pcall(UserInputService.GetImageForKeyCode, UserInputService, key)
		return if ok and type(image) == "string" and image ~= "" then image else nil
	end, { props.hint or false })

	local content = props.children
	if content == nil then
		content = {
			Icon = if props.icon
				then e(Icon, { image = props.icon, size = style.icon[size], color = labelColor, layoutOrder = 1 })
				else nil,
			Label = if props.text
				then e(Text, { text = props.text, variant = style.text[size], color = labelColor, layoutOrder = 2 })
				else nil,
			Hint = if hintImage and ui.input == "Gamepad"
				then e(Icon, { image = hintImage, size = style.icon[size], layoutOrder = 3 })
				else nil,
		}
	end

	local hug = props.width == nil
	local hostProps: { [any]: any } = {
		Text = "",
		AutoButtonColor = false,
		BackgroundTransparency = 1,
		Size = if props.width then UDim2.new(props.width, UDim.new(0, height)) else UDim2.fromOffset(0, height),
		AutomaticSize = if hug then Enum.AutomaticSize.X else Enum.AutomaticSize.None,
		Position = props.position,
		AnchorPoint = props.anchor,
		LayoutOrder = props.layoutOrder,
		ZIndex = props.zIndex,
		Visible = props.visible,
		Selectable = not disabled and props.selectable ~= false,
		SelectionImageObject = NO_SELECTION_IMAGE,
		ref = ref,
		[React.Event.Activated] = function()
			if not disabled and props.onActivate then
				props.onActivate()
			end
		end,
		[React.Event.MouseEnter] = function()
			setHovered(true)
		end,
		[React.Event.MouseLeave] = function()
			setHovered(false)
			setPressed(false)
		end,
		[React.Event.InputBegan] = function(_, input: InputObject)
			if isPress(input) then
				setPressed(true)
			end
		end,
		[React.Event.InputEnded] = function(_, input: InputObject)
			if isPress(input) then
				setPressed(false)
			end
		end,
		[React.Event.SelectionGained] = function()
			setFocused(true)
			if props.onSelected then
				props.onSelected()
			end
		end,
		[React.Event.SelectionLost] = function()
			setFocused(false)
		end,
	}
	if props.native then
		for key, value in props.native do
			hostProps[key] = value
		end
	end

	local radius = ui.corner(style.radius)
	local faceStroke = nil
	if focused then
		faceStroke = e("UIStroke", {
			Color = ui.palette.Focus,
			Thickness = math.max(2, ui.stroke(style.focusWidth)),
			ApplyStrokeMode = Enum.ApplyStrokeMode.Border,
		})
	elseif variant.stroke then
		faceStroke = e("UIStroke", {
			Color = ui.color(variant.stroke),
			Thickness = ui.stroke(style.strokeWidth),
			ApplyStrokeMode = Enum.ApplyStrokeMode.Border,
		})
	end

	local badge = props.badge
	local badgeElement = nil
	if badge then
		local label = if type(badge) == "string" then badge else nil
		local side = ui.px(if label then style.badge.size else style.badge.dot)
		local inset = ui.space("XS")
		badgeElement = e("Frame", {
			AnchorPoint = Vector2.new(0.5, 0.5),
			Position = UDim2.new(1, -inset, 0, inset),
			Size = UDim2.fromOffset(side, side),
			AutomaticSize = if label then Enum.AutomaticSize.X else Enum.AutomaticSize.None,
			BackgroundColor3 = ui.color(style.badge.color),
			ZIndex = 3,
		}, {
			Corner = e("UICorner", { CornerRadius = ui.corner("Full") }),
			Padding = if label
				then e("UIPadding", {
					PaddingLeft = UDim.new(0, inset),
					PaddingRight = UDim.new(0, inset),
				})
				else nil,
			Label = if label
				then e(Text, {
					text = label,
					variant = "Caption",
					color = style.badge.text,
					size = UDim2.fromScale(0, 1),
					automaticSize = Enum.AutomaticSize.X,
					align = "Center",
					localize = false,
				})
				else nil,
		})
	end

	return e("TextButton", hostProps, {
		Lip = if fill and depth > 0
			then e("Frame", {
				Size = UDim2.new(1, 0, 1, -depth),
				Position = UDim2.fromOffset(0, depth),
				BackgroundColor3 = (faceColor :: Color3):Lerp(BLACK, 0.4),
				BorderSizePixel = 0,
				ZIndex = 1,
			}, { Corner = e("UICorner", { CornerRadius = radius }) })
			else nil,
		Face = e("Frame", {
			Size = if hug then UDim2.new(0, 0, 1, -depth) else UDim2.new(1, 0, 1, -depth),
			AutomaticSize = if hug then Enum.AutomaticSize.X else Enum.AutomaticSize.None,
			Position = press:map(function(alpha: number)
				return UDim2.fromOffset(0, math.round(depth * alpha))
			end),
			BackgroundColor3 = faceColor or textColor,
			BackgroundTransparency = if faceColor then 0 elseif pointerHover then 0.9 else 1,
			BorderSizePixel = 0,
			ZIndex = 2,
		}, {
			Corner = e("UICorner", { CornerRadius = radius }),
			Stroke = faceStroke,
			Padding = e("UIPadding", {
				PaddingLeft = UDim.new(0, ui.space(style.padding[size])),
				PaddingRight = UDim.new(0, ui.space(style.padding[size])),
			}),
			Layout = e("UIListLayout", {
				FillDirection = Enum.FillDirection.Horizontal,
				HorizontalAlignment = Enum.HorizontalAlignment.Center,
				VerticalAlignment = Enum.VerticalAlignment.Center,
				Padding = UDim.new(0, ui.space(style.gap)),
				SortOrder = Enum.SortOrder.LayoutOrder,
			}),
			Content = e(React.Fragment, nil, content),
		}),
		Badge = badgeElement,
	})
end)

return Button
