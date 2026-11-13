--!strict
-- A tiny observable value for UI state that lives outside components: what the server told us
-- (coins, owned items), which menu is open, the toast queue. Controllers write atoms; components
-- read them with `Atom.use`, which re-renders only the components whose selected value changed.
--
--   local coins = Atom.new(0)
--   coins:set(250)                                  -- from a controller
--   local amount = Atom.use(coins)                  -- in a component
--   local count = Atom.use(owned, countOwned)       -- with a selector (keep it a stable function)
--
-- Treat values as immutable: `update` with a copy (`table.clone`) instead of mutating a table in
-- place, or subscribers won't see a change (equality is by reference).
-- For large games with lots of shared and server-synced state, Charm (littensy/charm) is the same
-- idea with derived atoms and server sync; moving to it later is mostly a rename.

local ReplicatedStorage = game:GetService("ReplicatedStorage")

local React = require(ReplicatedStorage.Packages.React)

export type Atom<T> = {
	get: (self: Atom<T>) -> T,
	set: (self: Atom<T>, value: T) -> (),
	update: (self: Atom<T>, transform: (T) -> T) -> (),
	subscribe: (self: Atom<T>, listener: (value: T, previous: T) -> ()) -> () -> (),
}

local Atom = {}

function Atom.new<T>(initial: T): Atom<T>
	local value = initial
	local listeners: { [(T, T) -> ()]: boolean } = {}

	local function set(_: any, nextValue: T)
		if nextValue == value then
			return
		end
		local previous = value
		value = nextValue
		-- Copy first so a listener can unsubscribe while being notified; spawn so one failing
		-- listener can't stop the rest.
		for listener in table.clone(listeners) do
			task.spawn(listener, nextValue, previous)
		end
	end

	return {
		get = function(_: any): T
			return value
		end,
		set = set,
		update = function(self: any, transform: (T) -> T)
			set(self, transform(value))
		end,
		subscribe = function(_: any, listener: (T, T) -> ()): () -> ()
			listeners[listener] = true
			return function()
				listeners[listener] = nil
			end
		end,
	}
end

-- Reads an atom in a component and re-renders when the (selected) value changes.
function Atom.use<T, U>(atom: Atom<T>, selector: ((T) -> U)?): U
	local selectorRef = React.useRef(selector)
	selectorRef.current = selector

	local function select(value: T): U
		local current = selectorRef.current
		return if current then current(value) else value :: any
	end

	local selected, setSelected = React.useState(function()
		return select(atom:get())
	end)

	React.useEffect(function()
		local function sync(value: T)
			local nextSelected = select(value)
			-- Wrapped in a function so a selected value that is itself a function isn't mistaken
			-- for a state updater.
			setSelected(function()
				return nextSelected
			end)
		end
		sync(atom:get()) -- catch a change between render and subscribe
		return atom:subscribe(sync)
	end, { atom })

	return selected
end

return Atom
