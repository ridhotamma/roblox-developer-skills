--!strict
-- Builds a layout into anchored Parts. Takes either form: the compact table exported by
-- `rlayout.cjs export --module`, or the spec-style table WorldGen / ObbyGen return (pass
-- Catalog = require(LayoutCatalog) for those). Every object becomes a Model named after its id, sorted
-- into folders, tagged with its kind so game code can find it with CollectionService.
--
--   local model = LayoutBuilder.Build(require(Layouts.Restaurant), { Parent = workspace })
--
-- Swap blockout shapes for real art by passing Prefabs: a Folder whose children are named after
-- kinds ("chair", "oak"...). A prefab is cloned and pivoted to the object's spot (its front must
-- face -Z and its pivot must sit at the centre of its base).

local CollectionService = game:GetService("CollectionService")

local LayoutBuilder = {}

export type Options = {
	Parent: Instance?,
	Origin: CFrame?, -- where the layout's (0, 0, 0) goes
	Prefabs: Instance?,
	SnapToGround: boolean?, -- raycast each ground object down onto terrain or parts under it
	YieldEvery: number?, -- task.wait() after this many objects (big maps at runtime)
	Zones: boolean?, -- build invisible zone volumes (default true)
	Catalog: any?, -- require(LayoutCatalog): needed for WorldGen / ObbyGen layouts
	Skip: { [string]: boolean }?, -- roles to leave out, e.g. { ceiling = true }
}

local FOLDER: { [string]: string } = {
	floor = "Structure", wall = "Structure", window = "Structure", lintel = "Structure", ceiling = "Structure",
	furniture = "Furniture", prop = "Props", decor = "Props", light = "Props", nature = "Nature",
	building = "Buildings", platform = "Gameplay", hazard = "Gameplay", marker = "Gameplay", structure = "Gameplay",
}
local NO_COLLIDE: { [string]: boolean } = { decor = true, light = true }

local function color(hex: string): Color3
	return Color3.fromHex(hex)
end

local function makePart(spec: any, cf: CFrame, fx: number, fy: number, fz: number): BasePart
	local shape = spec[1]
	local part: BasePart
	if shape == "wedge" then
		part = Instance.new("WedgePart")
	else
		local p = Instance.new("Part")
		p.Shape = if shape == "ball" then Enum.PartType.Ball elseif shape == "cylinder" then Enum.PartType.Cylinder else Enum.PartType.Block
		part = p
	end
	local sx, sy, sz = spec[5] * fx, spec[6] * fy, spec[7] * fz
	local local_ = cf * CFrame.new(spec[2] * fx, spec[3] * fy, spec[4] * fz) * CFrame.Angles(0, math.rad(spec[10] or 0), 0)
	if shape == "ball" then
		local u = math.min(sx, sy, sz)
		sx, sy, sz = u, u, u
	elseif shape == "cylinder" then
		local u = math.min(sx, sz)
		sx, sz = u, u
	end
	if shape == "cylinder" then
		-- Roblox cylinders lie along X: stand them up
		part.Size = Vector3.new(sy, sx, sz)
		part.CFrame = local_ * CFrame.Angles(0, 0, math.rad(90))
	else
		part.Size = Vector3.new(sx, sy, sz)
		part.CFrame = local_
	end
	part.Color = color(spec[8])
	local ok, material = pcall(function()
		return (Enum.Material :: any)[spec[9] or "SmoothPlastic"]
	end)
	part.Material = if ok and material then material else Enum.Material.SmoothPlastic
	if part.Material == Enum.Material.Glass then
		part.Transparency = 0.5
	end
	part.Anchored = true
	part.TopSurface = Enum.SurfaceType.Smooth
	part.BottomSurface = Enum.SurfaceType.Smooth
	return part
end

local function folder(root: Instance, name: string): Instance
	local f = root:FindFirstChild(name)
	if not f then
		f = Instance.new("Folder")
		f.Name = name
		f.Parent = root
	end
	return f :: Instance
end

function LayoutBuilder.Build(layout: any, options: Options?): Model
	local opt: Options = options or {}
	local origin = opt.Origin or CFrame.new()
	local kinds = layout.kinds or {}
	local root = Instance.new("Model")
	root.Name = layout.name or "Layout"

	local rayParams = RaycastParams.new()
	rayParams.FilterType = Enum.RaycastFilterType.Exclude
	rayParams.FilterDescendantsInstances = { root }

	local catalog: any = opt.Catalog or {}
	local catalogKinds = catalog.kinds or catalog
	local count = 0
	for index, raw in layout.items do
		-- normalise the two item forms into: parts + scale factors + id, role, kind, position
		local parts: any, fx: number, fy: number, fz: number = nil, 1, 1, 1
		local id: string, role: string, kind: string, x: number, y: number, z: number, rot: number
		local scale, zone, label = 1, nil :: any, nil :: any
		if raw.kind == nil then
			-- exported: { key, id, x, y, z, rot, role, kind, scale, zone, label, tags }
			id, x, y, z, rot, role, kind, scale, zone, label = raw[2], raw[3], raw[4], raw[5], raw[6] or 0, raw[7], raw[8], raw[9] or 1, raw[10], raw[11]
			parts = kinds[raw[1]]
			if not layout.bakedScale then
				fx, fy, fz = scale, scale, scale
			end
		else
			kind, rot, scale, zone, label = raw.kind, raw.rot or 0, raw.scale or 1, raw.zone, raw.label
			x, y, z = raw.pos[1], raw.pos[2], raw.pos[3]
			local info = catalog.info and catalog.info[kind]
			id = raw.id or (kind .. "_" .. index)
			role = raw.role or (info and info.role) or "prop"
			if raw.parts then
				parts = raw.parts
			elseif catalogKinds[kind] then
				parts = catalogKinds[kind]
				if raw.size and info then
					fx, fy, fz = raw.size[1] / info.size[1], raw.size[2] / info.size[2], raw.size[3] / info.size[3]
				else
					fx, fy, fz = scale, scale, scale
				end
			else
				local size = raw.size or { 4, 4, 4 }
				local c = raw.color or "A3A29A"
				local hex = if string.sub(c, 1, 1) == "#" then string.sub(c, 2) else (catalog.colors and catalog.colors[c]) or c
				parts = { { raw.shape or "block", 0, size[2] / 2, 0, size[1], size[2], size[3], hex, raw.material or "SmoothPlastic", 0 } }
			end
		end
		if opt.Skip and opt.Skip[role] then
			continue
		end
		local cf = origin * CFrame.new(x, y, z) * CFrame.Angles(0, math.rad(rot), 0)
		if opt.SnapToGround and role ~= "platform" and role ~= "hazard" and role ~= "floor" and y < 1 then
			local hit = workspace:Raycast(cf.Position + Vector3.new(0, 500, 0), Vector3.new(0, -1000, 0), rayParams)
			if hit then
				cf = cf.Rotation + Vector3.new(cf.X, hit.Position.Y + y, cf.Z)
			end
		end
		local model: Model
		local prefab = opt.Prefabs and opt.Prefabs:FindFirstChild(kind)
		if prefab and prefab:IsA("PVInstance") then
			local clone = prefab:Clone()
			if clone:IsA("Model") then
				model = clone
				if scale ~= 1 then
					model:ScaleTo(scale)
				end
			else
				model = Instance.new("Model")
				clone.Parent = model
			end
			model:PivotTo(cf)
		else
			model = Instance.new("Model")
			for _, spec in parts or {} do
				local part = makePart(spec, cf, fx, fy, fz)
				if NO_COLLIDE[role] then
					part.CanCollide = false
				end
				part.Parent = model
			end
			model.WorldPivot = cf
		end
		model.Name = id
		model:SetAttribute("Kind", kind)
		model:SetAttribute("Role", role)
		if zone then
			model:SetAttribute("Zone", zone)
		end
		if label then
			model:SetAttribute("Label", label)
		end
		for _, tag in (if raw.kind ~= nil then raw.tags else raw[12]) or {} do
			CollectionService:AddTag(model, "Layout_" .. tag)
		end
		CollectionService:AddTag(model, "Layout_" .. kind)
		model.Parent = folder(root, FOLDER[role] or "Props")
		count += 1
		if opt.YieldEvery and count % opt.YieldEvery == 0 then
			task.wait()
		end
	end

	for _, path in layout.paths or {} do
		local f = folder(root, "Paths")
		local width, y = path.width or 6, path.y or 0.05
		local hex = if path.kind == "trail" then "B89466" else "D9CDB4"
		for i = 2, #path.points do
			local a = origin * Vector3.new(path.points[i - 1][1], y, path.points[i - 1][2])
			local b = origin * Vector3.new(path.points[i][1], y, path.points[i][2])
			local seg = Instance.new("Part")
			seg.Name = path.id or "Path"
			seg.Size = Vector3.new(width, 0.2, (b - a).Magnitude)
			seg.CFrame = CFrame.lookAt((a + b) / 2, b)
			local joint = Instance.new("Part")
			joint.Name = "Joint"
			joint.Shape = Enum.PartType.Cylinder
			joint.Size = Vector3.new(0.2, width, width)
			joint.CFrame = CFrame.new(b) * CFrame.Angles(0, 0, math.rad(90))
			for _, p in { seg, joint } do
				p.Anchored = true
				p.CanCollide = false
				p.Color = color(hex)
				p.Material = if path.kind == "trail" then Enum.Material.Ground else Enum.Material.Cobblestone
				p.TopSurface = Enum.SurfaceType.Smooth
				p.Parent = f
			end
		end
	end

	if opt.Zones ~= false then
		for _, zone in layout.zones or {} do
			local part = Instance.new("Part")
			part.Name = zone.id
			if zone.circle then
				part.Shape = Enum.PartType.Cylinder
				part.Size = Vector3.new(24, zone.circle[3] * 2, zone.circle[3] * 2)
				part.CFrame = origin * CFrame.new(zone.circle[1], 12 + (zone.y or 0), zone.circle[2]) * CFrame.Angles(0, 0, math.rad(90))
			else
				local r = zone.rect
				part.Size = Vector3.new(r[3] - r[1], 24, r[4] - r[2])
				part.CFrame = origin * CFrame.new((r[1] + r[3]) / 2, 12, (r[2] + r[4]) / 2)
			end
			part.Transparency = 1
			part.Anchored = true
			part.CanCollide = false
			part.CanQuery = false
			part.CanTouch = false
			part:SetAttribute("Label", zone.label or zone.id)
			if zone.kind then
				part:SetAttribute("Kind", zone.kind)
			end
			CollectionService:AddTag(part, "LayoutZone")
			part.Parent = folder(root, "Zones")
		end
	end

	if layout.spawn then
		root:SetAttribute("Spawn", origin * Vector3.new(layout.spawn[1], layout.spawn[2], layout.spawn[3]))
	end
	root.Parent = opt.Parent or workspace
	return root
end

return LayoutBuilder
