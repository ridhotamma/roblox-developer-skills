-- Low-poly fish - Roblox setup (roblox-modeling skill)
-- Import Fish.roblox.glb with the 3D Importer, select the imported model in the Explorer, then paste this
-- into the command bar (View > Command Bar) and press Enter. It sets CollisionFidelity on every MeshPart and turns
-- collision off on decoration. 9 MeshParts (static parts are merged per material and collision class).
local SETTINGS = { -- name = { CollisionFidelity, CanCollide }
  ["Tail"] = { "Box", false }, -- none
  ["PelvicLMesh"] = { "Box", true }, -- box
  ["PelvicRMesh"] = { "Box", true }, -- box
  ["PectoralL"] = { "Box", false }, -- none
  ["PectoralR"] = { "Box", false }, -- none
  ["BodyMesh"] = { "Box", true }, -- box
  ["DorsalMesh"] = { "Box", true }, -- box
  ["AnalMesh"] = { "Box", true }, -- box
  ["HeadStatic1"] = { "Box", false }, -- none: EyeL, EyeR, PupilL, PupilR
}
local root = game:GetService("Selection"):Get()[1]
assert(root, "select the imported Fish model in the Explorer first")
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
print(("[rmodel] collision set on %d of 9 MeshParts"):format(done))
