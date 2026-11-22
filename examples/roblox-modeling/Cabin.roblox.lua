-- Low-poly one-room cabin - Roblox setup (roblox-modeling skill)
-- Import Cabin.roblox.glb with the 3D Importer (Scale Unit: Stud, the default: the file is already in studs,
-- 4.5 per metre, 31.5 x 22.5 x 35.55 studs), select the imported model in the Explorer, then paste this into the
-- command bar (View > Command Bar) and press Enter. It checks the size, sets CollisionFidelity on every MeshPart and
-- turns collision off on decoration. 4 MeshParts (static parts are merged per material and collision class).

local SETTINGS = { -- name = { CollisionFidelity, CanCollide }
  ["Door"] = { "Box", true }, -- box
  ["Knob"] = { "Box", false }, -- none
  ["CabinStatic1"] = { "PreciseConvexDecomposition", true }, -- precise: Deck, Step, WallFrontL, WallFrontR, WallFrontTop, WallBackL, WallBackR, WallBackLow, WallBackTop, BackGlass, WallSideL, WallSideR, GableL, GableR, Roof, Table, Bench, Bed, Stove
  ["CabinStatic2"] = { "Box", false }, -- none: Mattress, Blanket, StovePipe, Shelf, Rug
}
local root = game:GetService("Selection"):Get()[1]
assert(root, "select the imported Cabin model in the Explorer first")
-- Size: if the model arrived at another size (another Scale Unit, or scaled by hand), scale it back so doors,
-- steps and ceilings match the avatar. Set SIZE to nil to keep whatever size it has.
local SIZE: Vector3? = Vector3.new(31.5, 22.5, 35.55)
if SIZE and root:IsA("Model") then
  local _, got = root:GetBoundingBox()
  local k = math.max(SIZE.X, SIZE.Y, SIZE.Z) / math.max(got.X, got.Y, got.Z)
  if math.abs(k - 1) > 0.02 then
    root:ScaleTo(root:GetScale() * k)
    print(("[rmodel] scaled Cabin by %.3f to its intended size (4.5 studs per metre)"):format(k))
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
print(("[rmodel] collision set on %d of 4 MeshParts"):format(done))
