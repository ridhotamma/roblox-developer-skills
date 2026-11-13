--!strict
-- Device previews for stories: render any UI as it would look on a phone, a tablet, a laptop,
-- a monitor and a TV, side by side, each scaled down to fit the story canvas.
--
--   Devices.Matrix { device = "All", render = function() return e(ShopScreen, ...) end }
--
-- Each preview runs a simulated UiProvider (size class, scale, input mode, insets), so the
-- components lay out exactly as on the device. Overlays mark the Roblox top bar and, on touch
-- devices, where the thumbstick and jump button sit; nothing interactive belongs under them.
--
-- Sizes and insets approximate current devices (iPhone 14 / iPad Air class, 1366x768 laptop,
-- 1080p monitor and TV). Confirm on real hardware or Studio's Device Emulator before shipping.

local ReplicatedStorage = game:GetService("ReplicatedStorage")

local React = require(ReplicatedStorage.Packages.React)
local Responsive = require(script.Parent.Parent.Foundation.Responsive)
local UiContext = require(script.Parent.Parent.Foundation.UiContext)
local UiProvider = require(script.Parent.Parent.Foundation.UiProvider)

local e = React.createElement

export type Device = {
	name: string,
	size: Vector2,
	input: Responsive.InputMode,
	tenFoot: boolean?,
	insets: UiContext.Insets,
	topbar: number,
}

local function insets(top: number, bottom: number, left: number, right: number): UiContext.Insets
	return { Top = top, Bottom = bottom, Left = left, Right = right }
end

local Devices = {}

Devices.List = {
	{ name = "Phone landscape", size = Vector2.new(844, 390), input = "Touch", insets = insets(0, 21, 47, 47), topbar = 58 },
	{ name = "Phone portrait", size = Vector2.new(390, 844), input = "Touch", insets = insets(47, 34, 0, 0), topbar = 58 },
	{ name = "Small phone", size = Vector2.new(667, 375), input = "Touch", insets = insets(0, 0, 0, 0), topbar = 58 },
	{ name = "Tablet landscape", size = Vector2.new(1180, 820), input = "Touch", insets = insets(0, 20, 0, 0), topbar = 58 },
	{ name = "Tablet portrait", size = Vector2.new(820, 1180), input = "Touch", insets = insets(24, 20, 0, 0), topbar = 58 },
	{ name = "Laptop", size = Vector2.new(1366, 768), input = "Pointer", insets = insets(0, 0, 0, 0), topbar = 58 },
	{ name = "Desktop 1080p", size = Vector2.new(1920, 1080), input = "Pointer", insets = insets(0, 0, 0, 0), topbar = 58 },
	{ name = "Console TV", size = Vector2.new(1920, 1080), input = "Gamepad", tenFoot = true, insets = insets(0, 0, 0, 0), topbar = 58 },
} :: { Device }

-- "All", or any part of a device name ("phone", "tv", "tablet portrait").
function Devices.find(query: string): { Device }
	local wanted = string.lower(query)
	if wanted == "" or wanted == "all" then
		return Devices.List
	end
	local found = {}
	for _, device in Devices.List do
		if string.find(string.lower(device.name), wanted, 1, true) then
			table.insert(found, device)
		end
	end
	return if #found > 0 then found else Devices.List
end

local function zone(name: string, center: Vector2, diameter: number)
	return e("Frame", {
		AnchorPoint = Vector2.new(0.5, 0.5),
		Position = UDim2.fromOffset(center.X, center.Y),
		Size = UDim2.fromOffset(diameter, diameter),
		BackgroundColor3 = Color3.new(1, 1, 1),
		BackgroundTransparency = 0.85,
		ZIndex = 1000,
	}, {
		Corner = e("UICorner", { CornerRadius = UDim.new(0.5, 0) }),
		Label = e("TextLabel", {
			Text = name,
			Size = UDim2.fromScale(1, 1),
			BackgroundTransparency = 1,
			TextColor3 = Color3.new(1, 1, 1),
			TextTransparency = 0.3,
			TextSize = 14,
			ZIndex = 1001,
		}),
	})
end

-- One device, drawn at its real pixel size and shrunk with a UIScale to fit `box`.
function Devices.Preview(props: { device: Device, box: Vector2, palette: string?, render: () -> any, layoutOrder: number? })
	local device = props.device
	local fit = math.min(props.box.X / device.size.X, (props.box.Y - 20) / device.size.Y, 1)
	local i = device.insets
	local touch = device.input == "Touch"

	return e("Frame", {
		Size = UDim2.fromOffset(math.ceil(device.size.X * fit), math.ceil(device.size.Y * fit) + 20),
		BackgroundTransparency = 1,
		LayoutOrder = props.layoutOrder,
	}, {
		Caption = e("TextLabel", {
			Text = `{device.name}  {device.size.X}x{device.size.Y}  {device.input}`,
			Size = UDim2.new(1, 0, 0, 18),
			BackgroundTransparency = 1,
			TextColor3 = Color3.fromRGB(200, 205, 215),
			TextSize = 13,
			TextXAlignment = Enum.TextXAlignment.Left,
		}),
		Screen = e("Frame", {
			Position = UDim2.fromOffset(0, 20),
			Size = UDim2.fromOffset(device.size.X, device.size.Y),
			-- Stand-in for the 3D world, so contrast problems over a bright scene show up.
			BackgroundColor3 = Color3.fromRGB(122, 160, 120),
			BorderSizePixel = 0,
			ClipsDescendants = true,
		}, {
			Scale = e("UIScale", { Scale = fit }),
			Sky = e("Frame", {
				Size = UDim2.fromScale(1, 0.45),
				BackgroundColor3 = Color3.fromRGB(150, 200, 240),
				BorderSizePixel = 0,
			}),
			Topbar = e("Frame", {
				Position = UDim2.fromOffset(0, i.Top),
				Size = UDim2.new(1, 0, 0, device.topbar),
				BackgroundColor3 = Color3.new(0, 0, 0),
				BackgroundTransparency = 0.75,
				BorderSizePixel = 0,
				ZIndex = 999,
			}),
			Thumbstick = if touch
				then zone("move", Vector2.new(i.Left + 110, device.size.Y - i.Bottom - 110), 160)
				else nil,
			Jump = if touch
				then zone("jump", Vector2.new(device.size.X - i.Right - 90, device.size.Y - i.Bottom - 90), 96)
				else nil,
			Ui = e(UiProvider, {
				palette = props.palette,
				simulate = {
					size = device.size,
					input = device.input,
					tenFoot = device.tenFoot,
					insets = device.insets,
					topbar = device.topbar,
					previewScale = fit,
				},
			}, { App = props.render() }),
		}),
	})
end

-- Every matching device in a wrapping row. Measures the canvas so previews fill it.
function Devices.Matrix(props: { device: string?, palette: string?, render: () -> any })
	local canvas, setCanvas = React.useState(Vector2.new(1200, 800))
	local devices = Devices.find(props.device or "All")
	local single = #devices == 1
	local gap = 16
	local box = if single
		then canvas - Vector2.new(gap * 2, gap * 2)
		else Vector2.new(math.max(260, (canvas.X - gap * 3) / 2), 380)

	local previews: { [string]: any } = {}
	for index, device in devices do
		previews[device.name] = e(Devices.Preview, {
			device = device,
			box = box,
			palette = props.palette,
			render = props.render,
			layoutOrder = index,
		})
	end

	return e("ScrollingFrame", {
		Size = UDim2.fromScale(1, 1),
		CanvasSize = UDim2.new(),
		AutomaticCanvasSize = Enum.AutomaticSize.Y,
		BackgroundColor3 = Color3.fromRGB(24, 26, 32),
		BorderSizePixel = 0,
		ScrollBarThickness = 6,
		[React.Change.AbsoluteSize] = function(frame: ScrollingFrame)
			setCanvas(frame.AbsoluteSize)
		end,
	}, {
		Padding = e("UIPadding", {
			PaddingTop = UDim.new(0, gap),
			PaddingBottom = UDim.new(0, gap),
			PaddingLeft = UDim.new(0, gap),
			PaddingRight = UDim.new(0, gap),
		}),
		Layout = e("UIListLayout", {
			FillDirection = Enum.FillDirection.Horizontal,
			Wraps = true,
			Padding = UDim.new(0, gap),
			SortOrder = Enum.SortOrder.LayoutOrder,
		}),
		Previews = e(React.Fragment, nil, previews),
	})
end

return Devices
