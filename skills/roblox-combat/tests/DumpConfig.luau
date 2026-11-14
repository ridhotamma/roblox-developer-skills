-- Prints CombatConfig as JSON (Vector3 -> [x, y, z]) so the browser lab uses the kit's numbers.
local CombatConfig = require(Shared.Combat.CombatConfig)

local function encode(value: any): string
	local t = type(value)
	if t == "number" then
		return if value == math.huge then "1e308" elseif value ~= value then "null" else string.format("%.17g", value)
	elseif t == "string" then
		return '"' .. value:gsub('[%c"\\]', function(c)
			return string.format("\\u%04x", string.byte(c))
		end) .. '"'
	elseif t == "boolean" then
		return tostring(value)
	elseif t == "table" then
		if getmetatable(value) ~= nil and value.X ~= nil and value.Magnitude ~= nil then
			return `[{encode(value.X)},{encode(value.Y)},{encode(value.Z)}]`
		end
		if #value > 0 then
			local items = {}
			for _, item in ipairs(value) do
				table.insert(items, encode(item))
			end
			return "[" .. table.concat(items, ",") .. "]"
		end
		local keys = {}
		for key in pairs(value) do
			table.insert(keys, key)
		end
		table.sort(keys)
		local items = {}
		for _, key in keys do
			table.insert(items, encode(tostring(key)) .. ":" .. encode(value[key]))
		end
		return "{" .. table.concat(items, ",") .. "}"
	end
	return "null"
end

print(encode(CombatConfig))
