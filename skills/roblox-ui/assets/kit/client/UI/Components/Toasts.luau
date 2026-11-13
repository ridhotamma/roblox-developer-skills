--!strict
-- Short notifications at the top of the screen ("Purchased Sword", "Not enough coins").
-- Anything can push one, React or not; the Host (mounted once by App) shows them.
--
--   Toasts.push("Daily reward claimed!", "Positive")
--   Toasts.push("Not enough coins", "Danger", 4)
--
-- At most MAX_VISIBLE at once (oldest drops), each for a few seconds. Toasts are for feedback the
-- player can miss; anything they must act on belongs in a Modal.

local ReplicatedStorage = game:GetService("ReplicatedStorage")

local React = require(ReplicatedStorage.Packages.React)
local Atom = require(script.Parent.Parent.Foundation.Atom)
local Box = require(script.Parent.Parent.Primitives.Box)
local Layer = require(script.Parent.Parent.Primitives.Layer)
local Motion = require(script.Parent.Parent.Foundation.Motion)
local Stack = require(script.Parent.Parent.Primitives.Stack)
local Text = require(script.Parent.Parent.Primitives.Text)
local Tokens = require(script.Parent.Parent.Theme.Tokens)
local UiContext = require(script.Parent.Parent.Foundation.UiContext)

local e = React.createElement

local MAX_VISIBLE = 3
local DEFAULT_SECONDS = 3
local MAX_WIDTH = 420 -- design units

export type Tone = "Info" | "Positive" | "Danger"
export type Toast = { id: number, message: string, tone: Tone }

local queue = Atom.new({} :: { Toast })
local nextId = 0

local Toasts = {}

Toasts.queue = queue

function Toasts.push(message: string, tone: Tone?, seconds: number?)
	nextId += 1
	local toast: Toast = { id = nextId, message = message, tone = tone or "Info" }
	queue:update(function(list: { Toast })
		local kept = {}
		for i = math.max(1, #list - MAX_VISIBLE + 2), #list do
			table.insert(kept, list[i])
		end
		table.insert(kept, toast)
		return kept
	end)
	task.delay(seconds or DEFAULT_SECONDS, function()
		queue:update(function(list: { Toast })
			local kept = {}
			for _, item in list do
				if item.id ~= toast.id then
					table.insert(kept, item)
				end
			end
			return kept
		end)
	end)
end

local function toneColor(tone: Tone, palette: Tokens.Palette): Color3
	if tone == "Positive" then
		return palette.Positive
	elseif tone == "Danger" then
		return palette.Danger
	end
	return palette.Accent
end

local function ToastItem(props: { toast: Toast, layoutOrder: number })
	local ui = UiContext.useUi()
	local appear = Motion.useSpring(1, Tokens.Motion.Springs.Snappy, 0) -- fades in on mount
	local fade = appear:map(function(a: number)
		return 1 - a
	end)
	return e(Box, {
		size = UDim2.fromScale(1, 0),
		automaticSize = Enum.AutomaticSize.Y,
		color = ui.palette.Surface,
		transparency = appear:map(function(a: number)
			return Motion.lerp(1, Tokens.Transparency.Surface, a)
		end),
		radius = Tokens.Radius.M,
		stroke = { color = toneColor(props.toast.tone, ui.palette), thickness = Tokens.Stroke.Regular },
		padding = { x = Tokens.Space.L, y = Tokens.Space.M },
		layoutOrder = props.layoutOrder,
	}, {
		Message = e(Text, {
			text = props.toast.message,
			width = UDim.new(1, 0),
			align = "Center",
			transparency = fade,
		}),
	})
end

function Toasts.Host()
	local ui = UiContext.useUi()
	local list = Atom.use(queue)
	local width = math.min(ui.px(MAX_WIDTH), ui.safe.X - ui.px(Tokens.Space.L) * 2)

	local items: { [string]: any } = {}
	for _, toast in list do
		items[`Toast_{toast.id}`] = e(ToastItem, { toast = toast, layoutOrder = toast.id })
	end

	return e(Layer, { name = "Toasts", order = Tokens.Layers.Toast }, {
		Column = e(Stack, {
			size = UDim2.fromOffset(width, 0),
			automaticSize = Enum.AutomaticSize.Y,
			anchor = Vector2.new(0.5, 0),
			position = UDim2.new(0.5, 0, 0, ui.px(Tokens.Space.S)),
			gap = Tokens.Space.S,
			align = "Stretch",
		}, items),
	})
end

return Toasts
