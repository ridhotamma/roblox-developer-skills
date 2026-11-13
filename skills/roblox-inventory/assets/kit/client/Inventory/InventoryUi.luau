--!strict
-- Small helpers for building the inventory's Instances in code, the colour themes for each
-- style, and the item tile every view draws. No behaviour lives here.

local InventoryUi = {}

export type Theme = {
	Dim: Color3, -- full-screen backdrop
	DimTransparency: number,
	Panel: Color3,
	PanelTransparency: number,
	Cell: Color3,
	CellHover: Color3,
	Line: Color3,
	Accent: Color3,
	Text: Color3,
	Muted: Color3,
	Good: Color3,
	Bad: Color3,
	Font: Font,
	Heading: Font,
	Radius: number,
}

local function font(name: Enum.Font): Font
	return Font.fromEnum(name)
end

InventoryUi.Themes = {
	-- Neutral blue-grey. Hotbar style.
	Slate = {
		Dim = Color3.fromRGB(10, 12, 16),
		DimTransparency = 0.45,
		Panel = Color3.fromRGB(34, 38, 46),
		PanelTransparency = 0.05,
		Cell = Color3.fromRGB(52, 58, 70),
		CellHover = Color3.fromRGB(72, 80, 96),
		Line = Color3.fromRGB(88, 96, 112),
		Accent = Color3.fromRGB(240, 196, 80),
		Text = Color3.fromRGB(240, 242, 246),
		Muted = Color3.fromRGB(160, 168, 182),
		Good = Color3.fromRGB(96, 200, 120),
		Bad = Color3.fromRGB(220, 90, 90),
		Font = font(Enum.Font.GothamMedium),
		Heading = font(Enum.Font.GothamBold),
		Radius = 6,
	},
	-- Dark leather and brass. Attache style.
	Case = {
		Dim = Color3.fromRGB(8, 6, 4),
		DimTransparency = 0.3,
		Panel = Color3.fromRGB(38, 30, 24),
		PanelTransparency = 0,
		Cell = Color3.fromRGB(58, 48, 38),
		CellHover = Color3.fromRGB(84, 70, 54),
		Line = Color3.fromRGB(110, 92, 66),
		Accent = Color3.fromRGB(222, 178, 92),
		Text = Color3.fromRGB(238, 228, 208),
		Muted = Color3.fromRGB(170, 152, 124),
		Good = Color3.fromRGB(120, 190, 110),
		Bad = Color3.fromRGB(205, 80, 70),
		Font = font(Enum.Font.Gotham),
		Heading = font(Enum.Font.GothamBold),
		Radius = 3,
	},
	-- Black and phosphor green. Survivor style.
	Terminal = {
		Dim = Color3.fromRGB(0, 0, 0),
		DimTransparency = 0.2,
		Panel = Color3.fromRGB(12, 18, 14),
		PanelTransparency = 0,
		Cell = Color3.fromRGB(20, 32, 24),
		CellHover = Color3.fromRGB(32, 54, 38),
		Line = Color3.fromRGB(60, 120, 76),
		Accent = Color3.fromRGB(140, 240, 150),
		Text = Color3.fromRGB(200, 240, 204),
		Muted = Color3.fromRGB(104, 150, 112),
		Good = Color3.fromRGB(140, 240, 150),
		Bad = Color3.fromRGB(240, 110, 90),
		Font = font(Enum.Font.Code),
		Heading = font(Enum.Font.Code),
		Radius = 0,
	},
	-- Translucent black and white. Wheel style.
	Street = {
		Dim = Color3.fromRGB(0, 0, 0),
		DimTransparency = 0.55,
		Panel = Color3.fromRGB(14, 14, 16),
		PanelTransparency = 0.25,
		Cell = Color3.fromRGB(30, 30, 34),
		CellHover = Color3.fromRGB(60, 60, 66),
		Line = Color3.fromRGB(120, 120, 128),
		Accent = Color3.fromRGB(255, 255, 255),
		Text = Color3.fromRGB(245, 245, 245),
		Muted = Color3.fromRGB(165, 165, 172),
		Good = Color3.fromRGB(110, 205, 130),
		Bad = Color3.fromRGB(225, 80, 80),
		Font = font(Enum.Font.GothamMedium),
		Heading = font(Enum.Font.GothamBlack),
		Radius = 4,
	},
	-- Warm paper and ink. Weight style.
	Parchment = {
		Dim = Color3.fromRGB(12, 9, 6),
		DimTransparency = 0.4,
		Panel = Color3.fromRGB(44, 38, 30),
		PanelTransparency = 0.05,
		Cell = Color3.fromRGB(62, 54, 43),
		CellHover = Color3.fromRGB(88, 76, 60),
		Line = Color3.fromRGB(132, 114, 86),
		Accent = Color3.fromRGB(226, 196, 132),
		Text = Color3.fromRGB(236, 226, 206),
		Muted = Color3.fromRGB(172, 158, 132),
		Good = Color3.fromRGB(140, 190, 120),
		Bad = Color3.fromRGB(205, 96, 80),
		Font = font(Enum.Font.Merriweather),
		Heading = font(Enum.Font.Merriweather),
		Radius = 2,
	},
	-- Olive and orange. Extraction style.
	Tactical = {
		Dim = Color3.fromRGB(6, 8, 6),
		DimTransparency = 0.35,
		Panel = Color3.fromRGB(28, 32, 28),
		PanelTransparency = 0.03,
		Cell = Color3.fromRGB(44, 50, 44),
		CellHover = Color3.fromRGB(64, 72, 62),
		Line = Color3.fromRGB(92, 102, 88),
		Accent = Color3.fromRGB(236, 150, 60),
		Text = Color3.fromRGB(226, 230, 220),
		Muted = Color3.fromRGB(150, 158, 144),
		Good = Color3.fromRGB(120, 196, 110),
		Bad = Color3.fromRGB(214, 84, 70),
		Font = font(Enum.Font.RobotoCondensed),
		Heading = font(Enum.Font.RobotoCondensed),
		Radius = 2,
	},
} :: { [string]: Theme }

-- Instance.new with properties and children in one call. Parent is set last.
function InventoryUi.New(className: string, props: { [string]: any }, children: { Instance }?): any
	local instance = Instance.new(className) :: any
	local parent = nil
	for key, value in props do
		if key == "Parent" then
			parent = value
		else
			instance[key] = value
		end
	end
	if children then
		for _, child in children do
			child.Parent = instance
		end
	end
	if parent then
		instance.Parent = parent
	end
	return instance
end

local New = InventoryUi.New

function InventoryUi.Corner(parent: Instance, radius: number)
	if radius > 0 then
		New("UICorner", { CornerRadius = UDim.new(0, radius), Parent = parent })
	end
end

function InventoryUi.Stroke(parent: Instance, color: Color3, thickness: number?, transparency: number?): UIStroke
	return New("UIStroke", {
		Color = color,
		Thickness = thickness or 1,
		Transparency = transparency or 0,
		ApplyStrokeMode = Enum.ApplyStrokeMode.Border,
		Parent = parent,
	})
end

function InventoryUi.Padding(parent: Instance, pixels: number)
	local pad = UDim.new(0, pixels)
	New("UIPadding", { PaddingTop = pad, PaddingBottom = pad, PaddingLeft = pad, PaddingRight = pad, Parent = parent })
end

function InventoryUi.Label(theme: Theme, props: { [string]: any }): TextLabel
	local label = New("TextLabel", {
		BackgroundTransparency = 1,
		FontFace = theme.Font,
		TextColor3 = theme.Text,
		TextSize = 14,
		TextXAlignment = Enum.TextXAlignment.Left,
		TextTruncate = Enum.TextTruncate.AtEnd,
		Text = "",
	})
	for key, value in props do
		(label :: any)[key] = value
	end
	return label
end

function InventoryUi.Button(theme: Theme, text: string, props: { [string]: any }, onActivated: () -> ()): TextButton
	local button = New("TextButton", {
		AutoButtonColor = true,
		BackgroundColor3 = theme.Cell,
		BorderSizePixel = 0,
		FontFace = theme.Font,
		Text = text,
		TextColor3 = theme.Text,
		TextSize = 14,
		Size = UDim2.new(1, 0, 0, 32),
	})
	InventoryUi.Corner(button, theme.Radius)
	InventoryUi.Stroke(button, theme.Line, 1, 0.4)
	for key, value in props do
		(button :: any)[key] = value
	end
	button.Activated:Connect(onActivated)
	return button
end

-- "Pump Shotgun" -> "PS", "Bandage" -> "BA"
function InventoryUi.Initials(name: string): string
	local letters = ""
	for word in string.gmatch(name, "%S+") do
		letters ..= string.upper(string.sub(word, 1, 1))
	end
	if #letters < 2 then
		return string.upper(string.sub(name, 1, 2))
	end
	return string.sub(letters, 1, 3)
end

export type TileOptions = {
	Rot: boolean?, -- drawn rotated a quarter turn (width / height already swapped by the caller)
	Equipped: boolean?,
	Selected: boolean?,
	Count: number?, -- overrides item.Count (quick slots show the total carried)
	Faded: boolean?,
}

-- The picture of one item: tinted plate, icon (or initials), stack count, equipped mark.
-- Never interactive: clicks fall through to the cell button underneath.
function InventoryUi.Tile(theme: Theme, def: any, count: number, width: number, height: number, options: TileOptions?): Frame
	local opts: TileOptions = options or {}
	local tint = if def and def.Color then theme.Cell:Lerp(def.Color, 0.42) else theme.CellHover
	local inset = 2
	local tile = New("Frame", {
		Name = "Tile",
		BackgroundColor3 = tint,
		BackgroundTransparency = if opts.Faded then 0.6 else 0,
		BorderSizePixel = 0,
		Position = UDim2.fromOffset(inset, inset),
		Size = UDim2.fromOffset(width - inset * 2, height - inset * 2),
		ZIndex = 2,
	})
	InventoryUi.Corner(tile, theme.Radius)
	InventoryUi.Stroke(
		tile,
		if opts.Selected or opts.Equipped then theme.Accent else theme.Line,
		if opts.Selected then 2 else 1,
		if opts.Selected or opts.Equipped then 0 else 0.3
	)

	local short = math.min(width, height)
	if def and def.Icon then
		-- A rotated item keeps its picture's own proportions and turns the image instead.
		local iconW = if opts.Rot then height else width
		local iconH = if opts.Rot then width else height
		New("ImageLabel", {
			AnchorPoint = Vector2.new(0.5, 0.5),
			BackgroundTransparency = 1,
			Image = def.Icon,
			ImageTransparency = if opts.Faded then 0.5 else 0,
			Position = UDim2.fromScale(0.5, 0.5),
			Rotation = if opts.Rot then 90 else 0,
			ScaleType = Enum.ScaleType.Fit,
			Size = UDim2.fromOffset(iconW - 10, iconH - 10),
			ZIndex = 3,
			Parent = tile,
		})
	else
		New("TextLabel", {
			BackgroundTransparency = 1,
			FontFace = theme.Heading,
			Size = UDim2.fromScale(1, 1),
			Text = if def then InventoryUi.Initials(def.Name) else "?",
			TextColor3 = theme.Text,
			TextSize = math.clamp(math.floor(short * 0.36), 10, 28),
			TextTransparency = if opts.Faded then 0.5 else 0.1,
			ZIndex = 3,
			Parent = tile,
		})
	end

	local shown = opts.Count or count
	if shown > 1 or opts.Count ~= nil then
		New("TextLabel", {
			AnchorPoint = Vector2.new(1, 1),
			BackgroundTransparency = 1,
			FontFace = theme.Heading,
			Position = UDim2.new(1, -4, 1, -2),
			Size = UDim2.fromOffset(width, 14),
			Text = tostring(shown),
			TextColor3 = theme.Text,
			TextSize = math.clamp(math.floor(short * 0.28), 10, 16),
			TextStrokeTransparency = 0.5,
			TextXAlignment = Enum.TextXAlignment.Right,
			ZIndex = 4,
			Parent = tile,
		})
	end
	if opts.Equipped then
		New("Frame", {
			BackgroundColor3 = theme.Accent,
			BorderSizePixel = 0,
			Position = UDim2.fromOffset(4, 4),
			Size = UDim2.fromOffset(6, 6),
			ZIndex = 4,
			Parent = tile,
		}, { New("UICorner", { CornerRadius = UDim.new(1, 0) }) })
	end
	return tile
end

return InventoryUi
