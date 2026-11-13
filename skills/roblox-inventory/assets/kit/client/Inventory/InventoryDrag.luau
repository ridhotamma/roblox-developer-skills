--!strict
-- The item in the player's "hand" while they move it: one implementation for mouse, touch
-- and gamepad.
--
--   Press-drag   (mouse / touch) Begin with the pressing InputObject: the ghost follows the
--                pointer and the item is placed where the press is released.
--   Carry        (gamepad, and "Split") Begin without an input: the item stays held until a
--                cell is activated (PlaceAt) or clicked (Release), or the hold is cancelled.
--
-- Views register themselves; on release each is asked HitTest(position, held) and the first
-- that answers gets the item. Releasing outside every view calls `Outside` (drop on the ground).
-- Positions are in the same space as GuiObject.AbsolutePosition and InputObject.Position.

local GuiService = game:GetService("GuiService")
local UserInputService = game:GetService("UserInputService")

local InventoryUi = require(script.Parent.InventoryUi)

export type Held = {
	ContainerId: string,
	Item: any,
	Def: any,
	Rot: boolean,
	Count: number?, -- nil = the whole stack
	Carry: boolean,
	Cell: number, -- pixel size of one cell, for the ghost
	Shaped: boolean, -- ghost shows the item's grid footprint
}

export type Hit = { Dest: any, TargetUid: string? }

export type View = {
	ContainerId: string,
	HitTest: (self: any, position: Vector2, held: Held) -> Hit?,
	Hover: (self: any, position: Vector2?, held: Held?) -> (),
}

type Options = {
	Theme: InventoryUi.Theme,
	Layer: ScreenGui, -- a ScreenGui above the window; the ghost lives here
	Place: (held: Held, containerId: string, hit: Hit) -> (),
	Outside: (held: Held, position: Vector2) -> (),
}

-- A press released within this many pixels of where it started is a click (select), not a move.
local CLICK_SLOP = 6

local InventoryDrag = {
	Held = nil :: Held?,
}

local options: Options? = nil
local views: { View } = {}
local connections: { RBXScriptConnection } = {}
local ghost: Frame? = nil
local pointer = Vector2.zero

function InventoryDrag.Setup(setup: Options)
	options = setup
end

-- Returns a function that unregisters the view.
function InventoryDrag.Register(view: View): () -> ()
	table.insert(views, view)
	return function()
		local index = table.find(views, view)
		if index then
			table.remove(views, index)
		end
	end
end

local function footprint(held: Held): (number, number)
	local size = held.Def and held.Def.Size
	if not held.Shaped or not size then
		return 1, 1
	end
	if held.Rot then
		return size[2], size[1]
	end
	return size[1], size[2]
end

local function moveGhost()
	local opts = options
	if ghost and opts then
		local origin = opts.Layer.AbsolutePosition
		ghost.Position = UDim2.fromOffset(pointer.X - origin.X, pointer.Y - origin.Y)
	end
end

local function buildGhost()
	local opts = options
	local held = InventoryDrag.Held
	if ghost then
		ghost:Destroy()
		ghost = nil
	end
	if not opts or not held then
		return
	end
	local w, h = footprint(held)
	local tile = InventoryUi.Tile(opts.Theme, held.Def, held.Count or held.Item.Count, w * held.Cell, h * held.Cell, {
		Rot = held.Rot and held.Shaped,
		Faded = true,
	})
	tile.AnchorPoint = Vector2.new(0.5, 0.5)
	tile.ZIndex = 50
	tile.Parent = opts.Layer
	ghost = tile
	moveGhost()
end

local function hover()
	local held = InventoryDrag.Held
	for _, view in views do
		view:Hover(if held then pointer else nil, held)
	end
end

local function clear()
	InventoryDrag.Held = nil
	for _, connection in connections do
		connection:Disconnect()
	end
	table.clear(connections)
	if ghost then
		ghost:Destroy()
		ghost = nil
	end
	hover()
end

local function toVector2(position: Vector3): Vector2
	return Vector2.new(position.X, position.Y)
end

-- Places the held item wherever `position` points, or hands it to `Outside`.
function InventoryDrag.Release(position: Vector2)
	local opts = options
	local held = InventoryDrag.Held
	if not opts or not held then
		return
	end
	local target: View? = nil
	local hit: Hit? = nil
	for _, view in views do
		hit = view:HitTest(position, held)
		if hit then
			target = view
			break
		end
	end
	clear()
	if target and hit then
		opts.Place(held, target.ContainerId, hit)
	else
		opts.Outside(held, position)
	end
end

-- Gamepad: places the held item on a cell the view has already worked out.
function InventoryDrag.PlaceAt(view: View, hit: Hit)
	local opts = options
	local held = InventoryDrag.Held
	if not opts or not held then
		return
	end
	clear()
	opts.Place(held, view.ContainerId, hit)
end

function InventoryDrag.Cancel()
	if InventoryDrag.Held then
		clear()
	end
end

-- Turns the held item a quarter turn (shaped, non-square items only).
function InventoryDrag.Rotate()
	local held = InventoryDrag.Held
	local size = held and held.Def and held.Def.Size
	if not held or not held.Shaped or not size or size[1] == size[2] then
		return
	end
	held.Rot = not held.Rot
	buildGhost()
	hover()
end

function InventoryDrag.Begin(held: Held, input: InputObject?)
	clear()
	InventoryDrag.Held = held
	if input then
		pointer = toVector2(input.Position)
	else
		local selected = GuiService.SelectedObject
		if selected then
			pointer = selected.AbsolutePosition + selected.AbsoluteSize / 2
		else
			pointer = UserInputService:GetMouseLocation() - (GuiService:GetGuiInset())
		end
	end
	buildGhost()
	hover()

	table.insert(
		connections,
		UserInputService.InputChanged:Connect(function(changed)
			local kind = changed.UserInputType
			if kind == Enum.UserInputType.MouseMovement or (kind == Enum.UserInputType.Touch and (input == nil or changed == input)) then
				pointer = toVector2(changed.Position)
				moveGhost()
				hover()
			end
		end)
	)
	-- A carried item rides along with the gamepad selection.
	table.insert(
		connections,
		GuiService:GetPropertyChangedSignal("SelectedObject"):Connect(function()
			local selected = GuiService.SelectedObject
			if selected and held.Carry then
				pointer = selected.AbsolutePosition + selected.AbsoluteSize / 2
				moveGhost()
				hover()
			end
		end)
	)
	if input and not held.Carry then
		local pressKind = input.UserInputType
		local pressedAt = pointer
		table.insert(
			connections,
			UserInputService.InputEnded:Connect(function(ended)
				local sameTouch = pressKind == Enum.UserInputType.Touch and ended == input
				local mouseUp = pressKind == Enum.UserInputType.MouseButton1 and ended.UserInputType == Enum.UserInputType.MouseButton1
				if sameTouch or mouseUp then
					local releasedAt = toVector2(ended.Position)
					if (releasedAt - pressedAt).Magnitude < CLICK_SLOP then
						clear() -- a click, not a drag: the item stays where it is
					else
						InventoryDrag.Release(releasedAt)
					end
				end
			end)
		)
	end
end

return InventoryDrag
