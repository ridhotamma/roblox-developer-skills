-- Low-poly treasure chest - Roblox setup (roblox-modeling skill)
-- Import TreasureChest.roblox.glb with the 3D Importer, select the imported model in the Explorer, then paste this
-- into the command bar (View > Command Bar) and press Enter. It sets CollisionFidelity on every MeshPart and turns
-- collision off on decoration. 7 MeshParts (static parts are merged per material and collision class).
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
