-- Low-poly fish - Roblox setup (roblox-modeling skill)
-- Import Fish.roblox.glb with the 3D Importer (Scale Unit: Stud, the default: the file is already in studs,
-- 3.5714 per metre, 0.243 x 0.55 x 1.086 studs), select the imported model in the Explorer, then paste this into the
-- command bar (View > Command Bar) and press Enter. It checks the size, sets CollisionFidelity on every MeshPart and
-- turns collision off on decoration. 9 MeshParts (static parts are merged per material and collision class).
-- Level of detail: this model is skinned, so its cheaper version is a separate rig, Fish.lod.roblox.glb
-- (same bone names: the clip files animate it). Swap to it at distance, e.g. for crowds and schools.

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
-- Size: if the model arrived at another size (another Scale Unit, or scaled by hand), scale it back so doors,
-- steps and ceilings match the avatar. Set SIZE to nil to keep whatever size it has.
local SIZE: Vector3? = Vector3.new(0.243, 0.55, 1.086)
if SIZE and root:IsA("Model") then
  local _, got = root:GetBoundingBox()
  local k = math.max(SIZE.X, SIZE.Y, SIZE.Z) / math.max(got.X, got.Y, got.Z)
  if math.abs(k - 1) > 0.02 then
    root:ScaleTo(root:GetScale() * k)
    print(("[rmodel] scaled Fish by %.3f to its intended size (3.5714 studs per metre)"):format(k))
  end
end
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
