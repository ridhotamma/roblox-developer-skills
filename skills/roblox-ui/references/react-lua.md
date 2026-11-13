# React in Luau (react-lua)

react-lua is Roblox's port of React 17 (published on Wally as `jsdotlua/react` and `jsdotlua/react-roblox`). It is the same model as React on the web (components, props, hooks, context) rendering Roblox Instances instead of DOM nodes, plus a few Roblox-specific features. This file covers what you need to write it well and the places where Luau changes the rules.

Contents: 1 Install and mount · 2 Elements and host props · 3 Events, change signals, refs, tags · 4 Children, keys and order · 5 Hooks and their Luau gotchas · 6 Bindings · 7 Context · 8 Re-renders and performance · 9 Portals · 10 Typing under strict mode · 11 Testing · 12 Migrating from Roact or Studio-built UI · 13 Common errors

---

## 1. Install and mount

```toml
# wally.toml, shared realm (UI code runs on the client but Packages live in ReplicatedStorage)
[dependencies]
React = "jsdotlua/react@17.2.1"
ReactRoblox = "jsdotlua/react-roblox@17.2.1"
```

Mount once, from a client controller, after `PlayerGui` exists:

```lua
local React = require(ReplicatedStorage.Packages.React)
local ReactRoblox = require(ReplicatedStorage.Packages.ReactRoblox)

local root = ReactRoblox.createRoot(Instance.new("Folder"))
root:render(ReactRoblox.createPortal(React.createElement(App, props), playerGui))
```

- **Root on a Folder, portal into PlayerGui.** React manages only the ScreenGuis it creates; anything else in PlayerGui (the Roblox chat, other systems' UI) is left alone.
- **Rendering is scheduled, not synchronous.** After `root:render(...)` or a state change, Instances update on the scheduler's next pass, not on the next line. Never render and then immediately `FindFirstChild` the result; use a ref and an effect, which run after the commit.
- `root:unmount()` destroys everything the tree created and runs every effect cleanup.
- Dev warnings (bad keys, invalid hook calls with more detail) are enabled by setting the global `_G.__DEV__ = true` before React is first required. Do it only in Studio (`RunService:IsStudio()`), it costs performance. This is the one sanctioned use of `_G`: it is the library's own switch.
- ScreenGuis created by React must have `ResetOnSpawn = false`, or respawning deletes them out from under React. The kit's `Layer` sets it.

## 2. Elements and host props

```lua
local e = React.createElement

e("TextLabel", {
	Text = "Hello",
	TextSize = ui.px(16),
	Size = UDim2.fromScale(1, 0),
	AutomaticSize = Enum.AutomaticSize.Y,
	BackgroundTransparency = 1,
}, {
	Padding = e("UIPadding", { PaddingLeft = UDim.new(0, ui.px(8)) }),
})
```

- A string first argument is a host Instance class; its props are Roblox property names (PascalCase). A function (or a component table) first argument is a component; its props are whatever it defines. The kit uses **camelCase props for its own components** (`size`, `layoutOrder`, `onActivate`) so a reader can tell at a glance which is which.
- Removing a prop on a later render restores the property's default.
- The element's key becomes the Instance's `Name` (an unkeyed element takes the nearest keyed ancestor's key, section 4). Props are applied after that, so pass `Name` only when a specific name matters, such as ScreenGuis in PlayerGui (the kit's Layer does).
- Any property can take a binding instead of a value (section 6).

## 3. Events, change signals, refs, tags

```lua
e("TextButton", {
	[React.Event.Activated] = function(button: TextButton, input: InputObject, clickCount: number)
		onBuy()
	end,
	[React.Change.AbsoluteSize] = function(button: TextButton)
		setWidth(button.AbsoluteSize.X)
	end,
	[React.Tag] = "ShopButton", -- CollectionService tags (space separated)
	ref = buttonRef,
})
```

- `React.Event.X` connects to the Instance's event X; the handler receives the Instance first, then the event's arguments. Handlers are swapped when they change between renders, so inline functions are fine.
- `React.Change.Prop` fires when that property changes (it is `GetPropertyChangedSignal`). It does not fire for the initial value; read that in an effect via a ref if you need it.
- `ref` takes a ref object from `React.useRef()` (or a callback). `ref.current` is the Instance after commit, so read it in `useEffect`, never during render. Function components only receive a ref when wrapped in `React.forwardRef` (the kit's primitives are, so you can pass `ref` to a Box or a Button).
- Attributes are not props; set them on the ref'd Instance in an effect.

## 4. Children, keys and order

```lua
e(Stack, { gap = "S" }, {
	Title = e(Text, { text = "Shop", layoutOrder = 1 }),
	Grid = e(Grid, { minItemWidth = 136, layoutOrder = 2 }, tiles),
})
```

- Children are a table. **Keyed children** (string keys) become Instances named by their key, and the key is React's identity: the same key across renders updates the same Instance. Build lists keyed by a stable id: `tiles[`Item_{item.id}`] = e(ItemTile, ...)`.
- **Array children** get keys "1", "2", ... by position. Inserting at the front re-uses the wrong Instances and loses their state; use keyed tables for anything dynamic.
- **Order is LayoutOrder, never table order.** A Luau dictionary has no order, and UIListLayout / UIGridLayout sort by LayoutOrder when `SortOrder = LayoutOrder`. Give every child in a layout a `layoutOrder`.
- `nil` and `false` children render nothing, so conditional UI is `Badge = if count > 0 then e(Badge, ...) else nil`.
- A component receives its children as `props.children`. Forward them with `e(React.Fragment, nil, props.children)` inside your own children table, as the kit's primitives do, so decorators (UICorner, UIPadding) and user children live side by side.

## 5. Hooks and their Luau gotchas

The rules are React's: call hooks at the top level of a component (or another hook), in the same order every render, never inside `if`, loops or callbacks. Luau linters don't enforce this, so review for it.

| Hook | Notes for Luau |
|---|---|
| `useState(initial)` | Returns `value, setValue`. `setValue(fn)` calls `fn(previous)`: if the state itself is a function, wrap it: `setValue(function() return fn end)`. Lazy initial value: `useState(function() return expensive() end)`. Setting an equal value (`==`, so tables by reference) skips the re-render. |
| `useEffect(fn, deps)` | Runs after commit. Return a cleanup function; it runs before the next run and on unmount. `deps` is a table compared item by item with `==`. **Never put `nil` in a deps table**: `{ a, nil, c }` has an unreliable length in Luau, so changes to `c` can be missed. Use `{ a, b or false, c }`. Omit `deps` only when the effect must run after every render (rare). `{}` runs once. |
| `useLayoutEffect` | Runs before the frame is shown; use it to measure and correct layout without a visible jump. |
| `useMemo(fn, deps)` / `useCallback(fn, deps)` | Keep expensive derived data and callbacks stable so memoised children don't re-render. Same deps rules. |
| `useRef(initial)` | A mutable `{ current = ... }` that survives renders without causing them: Instance refs, the latest callback, motor state. |
| `useReducer(reducer, initial)` | For screens with many related state changes (a crafting UI, a multi-step purchase). |
| `useContext(Context)` | Reads the nearest Provider. |
| `useBinding(initial)` | Roblox addition, section 6. |

Values in deps compare with `==`: `Vector2`, `UDim2`, `Color3`, `EnumItem` compare by value, tables and functions by reference.

## 6. Bindings

A binding is a value that updates Instance properties directly, without re-rendering anything. It is the tool for anything that changes often: health bars, timers, countdowns, spring animations, drag positions.

```lua
local progress, setProgress = React.useBinding(0)

e("Frame", {
	Size = progress:map(function(p) return UDim2.fromScale(p, 1) end),
})

-- elsewhere (an effect, an event, a spring): no re-render
setProgress(0.4)
```

- `binding:map(fn)` derives a new binding; `binding:getValue()` reads it now; `React.joinBindings({ a = a, b = b })` combines several into a binding of a table.
- A binding can feed any property, including `Text`, `Visible`, `ScreenGui.Enabled` and `Transparency`.
- `React.createBinding(initial)` makes one outside a component (a module-level timer every screen can show).
- The kit's `Motion.useSpring(target)` returns a binding driven by a spring: animate one number 0 to 1 and map it onto several properties.
- Per-frame code that calls a `useState` setter re-renders the whole subtree 60 times a second. That is the most common react-lua performance bug, and the scanner flags it (`state-per-frame`). Use a binding.

## 7. Context

```lua
local ThemeContext = React.createContext(defaultValue)
e(ThemeContext.Provider, { value = value }, children)
local theme = React.useContext(ThemeContext)
```

Every consumer re-renders when the Provider's `value` changes identity, so memoise the value (`useMemo`) and split contexts by how often they change. The kit's `UiContext` changes only on resize, input switch or accessibility change. Don't put fast-changing game state (health, timers) in context; use atoms or bindings.

## 8. Re-renders and performance

A component re-renders when its state changes, its parent re-renders, or a context it reads changes. Rendering is Luau work plus property writes to changed Instances; it is cheap for a screen and expensive when it happens every frame or across hundreds of items.

- Read shared state with selectors (`Atom.use(owned, function(o) return o[itemId] == true end)`) so a change elsewhere doesn't re-render you.
- Wrap list items in `React.memo(Component)` when the list re-renders often, and pass stable callbacks (`useCallback`) and stable item tables.
- Keep per-frame changes in bindings.
- Lists of more than ~100 rows: paginate, or render only the visible rows (`jsdotlua/virtualized-list`, or a ScrollingFrame that maps `CanvasPosition` to a visible range).
- Hidden menus stay mounted with `Enabled = false` on their ScreenGui (the kit's Modal does this) rather than unmounting, so reopening is instant; unmount screens that are rarely opened and heavy.
- `roblox-performance` has the UI rendering costs (transparency overdraw, CanvasGroups, ViewportFrames, text updates).

## 9. Portals

`ReactRoblox.createPortal(children, targetInstance)` renders part of the tree under another Instance while keeping it in the same React tree (same context, state and lifecycle):

- the app root into `PlayerGui` (section 1);
- a BillboardGui over each NPC or player: a component per character that portals into an Attachment or the character's Head;
- a SurfaceGui on a shop counter part.

## 10. Typing under strict mode

- Useful types: `React.ReactNode` (children), `React.ReactElement`, `React.Binding<T>`, `React.Ref<T>`, `React.Context<T>`.
- Type component props with an exported `Props` table type and annotate the parameter: `local function ItemTile(props: Props)`.
- `React.forwardRef(function(props: Props, ref: any) ... end)` keeps the ref loosely typed; that is normal.
- Host-element props are checked at runtime by react-roblox, not by the type checker: a misspelt property errors when it renders, so stories catch these before players do.
- Run `wally-package-types` after `wally install` (the `roblox-project-structure` scaffold's install script does) so luau-lsp sees the package types.

## 11. Testing

- Pure modules (the kit's `Responsive`, `NumberFormat`, your formatters and reducers) are the cheapest to test: plain inputs and outputs.
- Components run under Jest Lua (`jsdotlua/jest` and `jsdotlua/jest-globals` in `[dev-dependencies]`) inside Roblox (Studio or Open Cloud Luau execution). Render into a Folder with `ReactRoblox.act(function() root:render(tree) end)` so the scheduler flushes, then assert on the Instances. Wrap the subject in `UiProvider` with `simulate` to test the Compact and Expanded layouts deterministically.
- Stories (UI Labs) are the visual test: every component on every device, every state via controls.

## 12. Migrating from Roact or Studio-built UI

From **Roact**: `jsdotlua/roact-compat` exposes the Roact API on top of react-lua, so old screens keep working while new ones are written with hooks. Then convert screen by screen:

| Roact | react-lua |
|---|---|
| `Roact.mount(tree, parent)` | `ReactRoblox.createRoot(Instance.new("Folder"))` then `root:render(ReactRoblox.createPortal(tree, parent))` |
| `Roact.Component:extend` with `init`, `render`, `didMount`, `willUnmount` | function component with `useState`, `useEffect` (cleanup replaces `willUnmount`) |
| `self:setState({...})` | `setX(value)` per piece of state, or `useReducer` |
| `Roact.createRef()` / `[Roact.Ref] = ref` | `React.useRef()` / `ref = ref` |
| `Roact.Event.X`, `Roact.Change.X` | `React.Event.X`, `React.Change.X` |
| `Roact.createBinding` | `React.useBinding` in components, `React.createBinding` outside |
| `Roact.createContext` | `React.createContext` + `useContext` |
| `Roact.Children` key | the `children` table / `props.children` |

From **Studio-built UI** (ScreenGuis authored in StarterGui, scripts poking at them): keep the art (images, 9-slice frames, icons) as assets, rebuild the layout as components from the kit, and move the logic into a controller plus props. Do it one screen at a time behind the same controller method (`ShopController:Open()` keeps working while its implementation switches from cloning the old ScreenGui to setting an atom). Delete each old ScreenGui when its replacement ships.

## 13. Common errors

| Symptom | Cause | Fix |
|---|---|---|
| `useUi() was called outside a UiProvider` | A kit component rendered without the provider (often a story) | Wrap the tree in `UiProvider` (stories: `Devices.Matrix` does it). |
| Hook errors after adding a condition | A hook inside `if` or a loop, so hook order changed between renders | Call every hook unconditionally at the top; branch on the values afterwards. |
| Instances named "1", "2"... and state jumps between rows | Array children | Key children by a stable id. |
| Children in a list in a random order | No `layoutOrder`, or layout `SortOrder` is Name | `SortOrder = LayoutOrder` and a `layoutOrder` on every child. |
| UI vanishes after the character respawns | ScreenGui with `ResetOnSpawn = true` | `ResetOnSpawn = false` (the kit's Layer). |
| Frame-rate drop while a bar animates | `useState` setter called per frame | A binding (`useBinding` / `Motion.useSpring`). |
| Effect runs twice as often each time the screen opens; memory climbs | Effect without cleanup, or deps with `nil` holes | Return a cleanup; `x or false` in deps. |
| `attempt to call a nil value (method 'map')` | A plain number passed where a component expects a binding (or the reverse) | Check the prop's documented type; the kit's ProgressBar accepts both. |
| Element renders at size 0 | `AutomaticSize` on a child whose parent gives it no room, or Scale size inside an AutomaticSize parent | Give the parent a real size on that axis, or size the child with offsets. |
| Blurry 1-pixel lines or text | Fractional pixel sizes from multiplying by a scale | Round to whole pixels (`ui.px` does). |
| Tap does nothing on a button | Another `Active` frame above it, a disabled layer, or the handler is on `MouseButton1Click` | Check ZIndex / layers; use `Activated`. |
