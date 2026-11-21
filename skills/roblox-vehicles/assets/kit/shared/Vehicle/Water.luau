--!strict
-- Where is the water surface? Used by BoatSim (buoyancy, the prop), VehicleVisuals (spray, wakes)
-- and anything else that floats. In order of precedence:
--   1. a custom height function: Water.SetHeightFunction(function(position, time) return y end)
--      for a game's own ocean (return nil where there is no water)
--   2. a sea plane: Workspace attribute SeaLevel (studs), with optional waves from the Workspace
--      attributes WaveHeight (m, crest to trough), WaveLength (m) and WaveDirection (degrees).
--      Three sine trains with real deep-water speeds (c = sqrt(g lambda / 2 pi)), phased by
--      Workspace:GetServerTimeNow() so the server and every client see the same sea. Render the sea
--      with the same function (a flat part at SeaLevel when WaveHeight is 0).
--   3. Terrain water: a downward raycast against Terrain only, with IgnoreWater = false.
-- Heights are in studs (world Y).

local Workspace = game:GetService("Workspace")

local MPS = 0.28
local G = 9.81
-- length share, direction offset (deg), amplitude share, phase
local WAVES = { { 1, 0, 1, 0 }, { 0.61, 35, 0.5, 1.7 }, { 0.37, -50, 0.25, 4.1 } }
local TERRAIN_PROBE = 60 -- studs above the point the terrain probe starts

local Water = {}

local custom: ((Vector3, number) -> number?)? = nil

local terrainParams = RaycastParams.new()
terrainParams.FilterType = Enum.RaycastFilterType.Include
terrainParams.FilterDescendantsInstances = { Workspace.Terrain }
terrainParams.IgnoreWater = false

function Water.SetHeightFunction(fn: ((Vector3, number) -> number?)?)
	custom = fn
end

function Water.Time(): number
	return Workspace:GetServerTimeNow()
end

-- Wave height (studs) above SeaLevel at x, z at time t.
function Water.WaveOffset(x: number, z: number, t: number): number
	local height = Workspace:GetAttribute("WaveHeight")
	if typeof(height) ~= "number" or height <= 0 then
		return 0
	end
	local lengthAttr = Workspace:GetAttribute("WaveLength")
	local directionAttr = Workspace:GetAttribute("WaveDirection")
	local waveLength = if typeof(lengthAttr) == "number" then math.max(lengthAttr, 1) else 30
	local direction = if typeof(directionAttr) == "number" then directionAttr else 0
	local y = 0
	for _, wave in WAVES do
		local len = waveLength * wave[1] -- m
		local k = 2 * math.pi / len
		local omega = math.sqrt(G * k)
		local d = math.rad(direction + wave[2])
		local a = height / 2 * wave[3] / 1.75 -- m
		y += a * math.sin(k * (math.cos(d) * x + math.sin(d) * z) * MPS - omega * t + wave[4])
	end
	return y / MPS
end

-- The base level for a spot (a sea plane or terrain water), or nil. One probe per vehicle per
-- step; points of a hull then use Water.Surface with this base for their own waves.
function Water.Level(position: Vector3): number?
	local sea = Workspace:GetAttribute("SeaLevel")
	if typeof(sea) == "number" then
		return sea
	end
	local hit = Workspace:Raycast(position + Vector3.yAxis * TERRAIN_PROBE, -Vector3.yAxis * (TERRAIN_PROBE * 2), terrainParams)
	if hit and hit.Material == Enum.Material.Water then
		return hit.Position.Y
	end
	return nil
end

-- Surface height at a point: custom function, or base level plus waves.
function Water.Surface(position: Vector3, base: number?, t: number): number?
	if custom then
		return custom(position, t)
	end
	if base == nil then
		return nil
	end
	return base + Water.WaveOffset(position.X, position.Z, t)
end

-- Convenience: the surface at a point right now.
function Water.HeightAt(position: Vector3): number?
	local t = Water.Time()
	if custom then
		return custom(position, t)
	end
	return Water.Surface(position, Water.Level(position), t)
end

-- True when the sea is flat here (parked boats may then sleep).
function Water.IsCalm(): boolean
	local height = Workspace:GetAttribute("WaveHeight")
	return custom == nil and (typeof(height) ~= "number" or height <= 0)
end

return Water
