--!strict
-- Loads every ModuleScript in a folder and runs the two-phase lifecycle.
--
--   Init()   called on each module in name order, synchronously.
--            Set up the module's own state. Do not yield, do not call other modules.
--   Start()  called on each module in its own thread, after every Init has finished.
--            Connect events, use other modules, yield freely.
--
-- Modules that depend on each other simply `require` each other. Because nothing runs
-- before Init/Start, a module never sees a dependency that is not ready yet.

export type Module = {
	Init: ((self: any) -> ())?,
	Start: ((self: any) -> ())?,
	[any]: any,
}

local Loader = {}

function Loader.RequireChildren(folder: Instance): { [string]: any }
	local modules = {}
	for _, child in folder:GetChildren() do
		if child:IsA("ModuleScript") then
			modules[child.Name] = (require :: any)(child)
		end
	end
	return modules
end

local function sortedNames(modules: { [string]: any }): { string }
	local names = {}
	for name in modules do
		table.insert(names, name)
	end
	table.sort(names)
	return names
end

-- `label` is only used in error messages ("Service", "Controller").
function Loader.Start(modules: { [string]: Module }, label: string)
	local names = sortedNames(modules)

	for _, name in names do
		local module = modules[name]
		local init = module.Init
		if init then
			local ok, err = xpcall(init, debug.traceback, module)
			if not ok then
				-- A failed Init leaves the game in an unknown state: stop loudly.
				error(`{label} {name}:Init() failed: {err}`, 0)
			end
		end
	end

	for _, name in names do
		local module = modules[name]
		local start = module.Start
		if start then
			task.spawn(function()
				local ok, err = xpcall(start, debug.traceback, module)
				if not ok then
					warn(`{label} {name}:Start() failed: {err}`)
				end
			end)
		end
	end
end

return Loader
