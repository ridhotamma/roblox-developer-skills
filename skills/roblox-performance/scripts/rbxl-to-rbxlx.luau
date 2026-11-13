-- Converts a binary place or model (.rbxl / .rbxm) to XML (.rbxlx / .rbxmx) so perfscan.cjs can
-- read it. Needs Lune (https://lune-org.github.io/docs), which the roblox-project-structure
-- scaffold already pins in rokit.toml.
--
--   lune run rbxl-to-rbxlx.luau MyGame.rbxl                 -> MyGame.rbxlx
--   lune run rbxl-to-rbxlx.luau MyModel.rbxm out/Model.rbxmx
--
-- Without Lune: open the place in Studio and use File -> Save to File As... -> .rbxlx.

local fs = require("@lune/fs")
local process = require("@lune/process")
local roblox = require("@lune/roblox")

local input = process.args[1]
if not input then
	print("usage: lune run rbxl-to-rbxlx.luau <file.rbxl|file.rbxm> [output]")
	process.exit(2)
end

local isPlace = string.match(input, "%.rbxl$") ~= nil
local isModel = string.match(input, "%.rbxm$") ~= nil
if not isPlace and not isModel then
	print("input must be a binary .rbxl place or .rbxm model")
	process.exit(2)
end

local output = process.args[2] or (input .. "x")
local contents = fs.readFile(input)

if isPlace then
	local game = roblox.deserializePlace(contents)
	fs.writeFile(output, roblox.serializePlace(game, true))
else
	local instances = roblox.deserializeModel(contents)
	fs.writeFile(output, roblox.serializeModel(instances, true))
end

print(`wrote {output}`)
