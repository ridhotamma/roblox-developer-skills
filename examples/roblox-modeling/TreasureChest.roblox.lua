-- Low-poly treasure chest - Roblox setup (roblox-modeling skill)
-- Import TreasureChest.roblox.glb with the 3D Importer, select the imported model in the Explorer, then paste this
-- into the command bar (View > Command Bar) and press Enter. It sets CollisionFidelity on every MeshPart and turns
-- collision off on decoration, then sets up level of detail. 7 MeshParts (static parts are merged per material and collision class).

local SETTINGS = { -- name = { CollisionFidelity, CanCollide }
  ["Lid"] = { "Hull", true }, -- hull
  ["Hasp"] = { "Box", false }, -- none
  ["TreasureChestStatic1"] = { "Default", true }, -- default: Plinth, Base
  ["TreasureChestStatic2"] = { "Default", true }, -- default: Rim, StrapL, StrapR, Gold
  ["TreasureChestStatic3"] = { "Box", false }, -- none: LockPlate, HandleL, HandleR, Coin1, Coin2
  ["TreasureChestStatic4"] = { "Box", false }, -- none: Keyhole, HandlePlateL, HandlePlateR, RubyGem, SapphireGem
  ["LidStatic1"] = { "Default", true }, -- default: LidRim, LidStrapL, LidStrapR
}
local root = game:GetService("Selection"):Get()[1]
assert(root, "select the imported TreasureChest model in the Explorer first")
local done = 0
for _, d in ipairs(root:GetDescendants()) do
  local s = d:IsA("MeshPart") and SETTINGS[d.Name]
  if s then
    d.CollisionFidelity = Enum.CollisionFidelity[s[1]]
    d.CanCollide = s[2]
    if not s[2] then d.CanTouch = false end
    done += 1
  end
end
print(("[rmodel] collision set on %d of 7 MeshParts"):format(done))

-- Level of detail (the roblox-performance skill's LodController): near, the full model in "Detail" shows; far, it is
-- removed and the one-mesh stand-in "Simple" shows instead (about half the triangles, 1 draw call).
local simple = root:FindFirstChild("Simple", true)
if simple and simple:IsA("MeshPart") then
  local holder = simple.Parent :: Instance
  local detail = holder:FindFirstChild("Detail") or Instance.new("Model")
  detail.Name = "Detail"
  for _, c in ipairs(holder:GetChildren()) do
    if c ~= simple and c ~= detail then c.Parent = detail end
  end
  detail.Parent = holder
  simple.CanCollide = false
  simple.CanTouch = false
  simple.CanQuery = false
  simple.CastShadow = false
  game:GetService("CollectionService"):AddTag(holder, "PerfLod")
  print("[rmodel] LOD set up on " .. holder:GetFullName() .. ": Detail near, Simple far (tag PerfLod)")
else
  warn("[rmodel] no Simple stand-in found: import TreasureChest.roblox.glb (not TreasureChest.glb)")
end
