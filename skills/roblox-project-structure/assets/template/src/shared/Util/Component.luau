--!strict
-- Binds behaviour to every Instance carrying a CollectionService tag: the ones that exist now
-- and the ones added later. Builders tag parts in Studio; no Scripts live inside parts.
--
-- A component module looks like:
--
--   return {
--       Tag = "CoinPickup",
--       Setup = function(instance: Instance, trove) ... end,
--   }
--
-- Everything added to `trove` (connections, instances, cleanup functions) is cleaned up
-- when the tag is removed, the instance is destroyed, or it streams out on the client.

local CollectionService = game:GetService("CollectionService")
local ReplicatedStorage = game:GetService("ReplicatedStorage")

local Trove = require(ReplicatedStorage.Packages.Trove)

export type ComponentModule = {
	Tag: string,
	Setup: (instance: Instance, trove: any) -> (),
	-- Only bind instances under this ancestor. Defaults to Workspace, so tagged templates
	-- sitting in ServerStorage or ReplicatedStorage are not brought to life.
	Ancestor: Instance?,
}

local Component = {}

function Component.Bind(component: ComponentModule): () -> ()
	local ancestor = component.Ancestor or workspace
	local troves: { [Instance]: any } = {}

	local function onAdded(instance: Instance)
		if troves[instance] or not instance:IsDescendantOf(ancestor) then
			return
		end
		local trove = Trove.new()
		troves[instance] = trove
		task.spawn(function()
			local ok, err = xpcall(component.Setup, debug.traceback, instance, trove)
			if not ok then
				warn(`[{component.Tag}] {instance:GetFullName()}: {err}`)
			end
		end)
	end

	local function onRemoved(instance: Instance)
		local trove = troves[instance]
		if trove then
			troves[instance] = nil
			trove:Destroy()
		end
	end

	local addedConnection = CollectionService:GetInstanceAddedSignal(component.Tag):Connect(onAdded)
	local removedConnection = CollectionService:GetInstanceRemovedSignal(component.Tag):Connect(onRemoved)
	for _, instance in CollectionService:GetTagged(component.Tag) do
		onAdded(instance)
	end

	return function()
		addedConnection:Disconnect()
		removedConnection:Disconnect()
		for instance in troves do
			onRemoved(instance)
		end
	end
end

-- Binds every component ModuleScript in a folder.
function Component.BindFolder(folder: Instance)
	for _, child in folder:GetChildren() do
		if child:IsA("ModuleScript") then
			Component.Bind((require :: any)(child))
		end
	end
end

return Component
