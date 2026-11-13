-- Roblox performance audit for the open place.
--
-- Paste this whole file into Studio's command bar (View -> Command Bar) in Edit mode and press
-- Enter. It reads the place and prints a report to Output. It changes nothing.
--
-- To fix one finding in bulk: set SELECT to its id (the word after the severity, e.g.
-- "small-shadow-casters"), run it again, and the offenders are selected in Explorer, ready to be
-- edited together in the Properties window (Ctrl+Z still works).
--
-- Thresholds match scripts/perfscan.cjs in the roblox-performance skill. They are rules of thumb:
-- a finding means "look here", not "this is definitely the problem". Measure in game to confirm.

local SELECT: string? = nil
local TOP = 10

local Selection = game:GetService("Selection")

local findings = {}
local offenders: { [string]: { Instance } } = {}

local function add(id: string, severity: string, title: string, fix: string, list: { Instance }?)
	table.insert(findings, { id = id, severity = severity, title = title, fix = fix })
	if list then
		offenders[id] = list
	end
end

local function fmt(n: number): string
	local s = tostring(math.floor(n + 0.5))
	local out = s:reverse():gsub("(%d%d%d)", "%1,"):reverse()
	return (out:gsub("^,", ""))
end

local function descendants(instance: Instance): { Instance }
	local ok, list = pcall(function()
		return instance:GetDescendants()
	end)
	return if ok then list else {}
end

local function get(instance: Instance, property: string): any
	local ok, value = pcall(function()
		return (instance :: any)[property]
	end)
	return if ok then value else nil
end

local function maxDimension(part: BasePart): number
	local size = part.Size
	return math.max(size.X, size.Y, size.Z)
end

-- Settings -----------------------------------------------------------------------------

local Lighting = game:GetService("Lighting")
local Workspace = workspace
local terrain = Workspace.Terrain

local streaming = get(Workspace, "StreamingEnabled")

-- Workspace content ------------------------------------------------------------------------

local parts, anchored, unanchored = 0, 0, 0
local meshParts, unions = 0, 0
local smallShadow: { Instance } = {}
local semiTransparent: { Instance } = {}
local preciseCollision: { Instance } = {}
local preciseUnused: { Instance } = {}
local preciseRender: { Instance } = {}
local unanchoredList: { Instance } = {}
local shadowLights: { Instance } = {}
local lights = 0
local emitters: { { Instance: Instance, Alive: number, Rate: number } } = {}
local aliveParticles = 0
local beams, trails = 0, 0
local humanoids: { Instance } = {}
local workspaceScripts: { Instance } = {}
local surfaceGuis, billboards, viewports = 0, 0, 0
local billboardsNoLimit: { Instance } = {}
local loopedSounds: { Instance } = {}
local persistentModels: { Instance } = {}
local persistentParts = 0
local meshIds: { [string]: boolean } = {}
local textureIds: { [string]: boolean } = {}
local uniqueMeshes, uniqueTextures = 0, 0
local wsInstances = 0

local function texture(id: any)
	if type(id) == "string" and id ~= "" and not textureIds[id] then
		textureIds[id] = true
		uniqueTextures += 1
	end
end

for _, d in descendants(Workspace) do
	wsInstances += 1
	if d:IsA("BasePart") and d ~= terrain then
		parts += 1
		local part = d :: BasePart
		if part.Anchored then
			anchored += 1
		else
			unanchored += 1
			table.insert(unanchoredList, part)
		end
		if part.CastShadow and part.Transparency < 1 and maxDimension(part) < 1.5 then
			table.insert(smallShadow, part)
		end
		if part.Transparency > 0 and part.Transparency < 1 then
			table.insert(semiTransparent, part)
		end
		local fidelity = get(part, "CollisionFidelity")
		if fidelity == Enum.CollisionFidelity.PreciseConvexDecomposition then
			table.insert(preciseCollision, part)
			if not part.CanCollide and not part.CanQuery and not part.CanTouch then
				table.insert(preciseUnused, part)
			end
		end
		if get(part, "RenderFidelity") == Enum.RenderFidelity.Precise then
			table.insert(preciseRender, part)
		end
		if part:IsA("MeshPart") then
			meshParts += 1
			local meshId = get(part, "MeshId")
			if type(meshId) == "string" and meshId ~= "" and not meshIds[meshId] then
				meshIds[meshId] = true
				uniqueMeshes += 1
			end
			texture(get(part, "TextureID"))
		elseif part:IsA("UnionOperation") then
			unions += 1
		end
	elseif d:IsA("Light") then
		lights += 1
		if d.Enabled and d.Shadows then
			table.insert(shadowLights, d)
		end
	elseif d:IsA("ParticleEmitter") then
		local lifetime = d.Lifetime
		local alive = d.Rate * (lifetime.Min + lifetime.Max) / 2
		if d.Enabled then
			aliveParticles += alive
		end
		table.insert(emitters, { Instance = d, Alive = alive, Rate = d.Rate })
	elseif d:IsA("Beam") then
		beams += 1
	elseif d:IsA("Trail") then
		trails += 1
	elseif d:IsA("Humanoid") then
		table.insert(humanoids, d)
	elseif d:IsA("Script") or d:IsA("LocalScript") then
		table.insert(workspaceScripts, d)
	elseif d:IsA("SurfaceGui") then
		surfaceGuis += 1
	elseif d:IsA("BillboardGui") then
		billboards += 1
		if d.MaxDistance == math.huge or d.MaxDistance <= 0 then
			table.insert(billboardsNoLimit, d)
		end
	elseif d:IsA("ViewportFrame") then
		viewports += 1
	elseif d:IsA("Sound") then
		if d.Looped and d.Playing then
			table.insert(loopedSounds, d)
		end
	elseif d:IsA("Decal") or d:IsA("Texture") then
		texture(d.Texture)
	elseif d:IsA("SurfaceAppearance") then
		texture(get(d, "ColorMap"))
	end
	if d:IsA("Model") then
		local mode = get(d, "ModelStreamingMode")
		if mode == Enum.ModelStreamingMode.Persistent or mode == Enum.ModelStreamingMode.PersistentPerPlayer then
			table.insert(persistentModels, d)
			for _, inner in descendants(d) do
				if inner:IsA("BasePart") then
					persistentParts += 1
				end
			end
		end
	end
end

-- Heaviest top-level models by part count
local heavy = {}
local function scanModels(container: Instance)
	for _, child in container:GetChildren() do
		if child:IsA("Model") and child ~= terrain then
			local count = 0
			for _, inner in descendants(child) do
				if inner:IsA("BasePart") then
					count += 1
				end
			end
			table.insert(heavy, { Instance = child, Parts = count })
		elseif child:IsA("Folder") then
			scanModels(child)
		end
	end
end
scanModels(Workspace)
table.sort(heavy, function(a, b)
	return a.Parts > b.Parts
end)

-- What every client downloads at join, besides the (streamed) Workspace
local replicatedInstances = 0
local replicatedParts = 0
for _, name in { "ReplicatedStorage", "ReplicatedFirst", "StarterGui", "StarterPack", "StarterPlayer", "Lighting" } do
	local ok, service = pcall(game.GetService, game, name)
	if ok and service then
		for _, d in descendants(service) do
			replicatedInstances += 1
			if d:IsA("BasePart") then
				replicatedParts += 1
			elseif d:IsA("ViewportFrame") then
				viewports += 1
			end
		end
	end
end

-- Findings (ids and thresholds shared with perfscan.cjs) -------------------------------------

if streaming == false and parts > 3000 then
	add(
		"streaming-off",
		if parts > 20000 then "HIGH" else "MEDIUM",
		`StreamingEnabled is off with {fmt(parts)} parts: every client loads and keeps the whole map`,
		"Turn Workspace.StreamingEnabled on, then make client code handle parts that aren't there yet (tags + components, WaitForChild with timeouts)."
	)
end
if #shadowLights > 8 then
	add(
		"shadowed-lights",
		if #shadowLights > 25 then "HIGH" else "MEDIUM",
		`{#shadowLights} enabled lights cast shadows ({lights} lights total, Technology {Lighting.Technology.Name})`,
		"Keep Shadows on only for a few key lights near where players are; turn it off on fill, decorative and small lights.",
		shadowLights
	)
end
if #smallShadow > 500 then
	add(
		"small-shadow-casters",
		if #smallShadow > 5000 then "MEDIUM" else "LOW",
		`{fmt(#smallShadow)} parts under 1.5 studs cast shadows`,
		"Turn CastShadow off on small props, trim, interior detail and anything players won't miss.",
		smallShadow
	)
end
if #semiTransparent > 300 then
	add(
		"semi-transparent",
		if #semiTransparent > 2000 then "MEDIUM" else "LOW",
		`{fmt(#semiTransparent)} parts are semi-transparent (0 < Transparency < 1): sorted and overdrawn every frame`,
		"Make them opaque or fully invisible where possible; avoid stacking glass, water and fog layers.",
		semiTransparent
	)
end
if #preciseCollision > 100 then
	add(
		"precise-collision",
		"MEDIUM",
		`{fmt(#preciseCollision)} MeshParts/unions use PreciseConvexDecomposition collision`,
		"Use Box or Hull for decor and anything players don't need to collide with precisely.",
		preciseCollision
	)
end
if #preciseUnused > 0 then
	add(
		"precise-collision-unused",
		"LOW",
		`{fmt(#preciseUnused)} parts have precise collision geometry but CanCollide, CanQuery and CanTouch all off`,
		"Set CollisionFidelity to Box: the geometry is built and stored for nothing.",
		preciseUnused
	)
end
if #preciseRender > 200 then
	add(
		"precise-render",
		"LOW",
		`{fmt(#preciseRender)} MeshParts/unions use RenderFidelity Precise (no distance LOD)`,
		"Use Automatic except for hero meshes the camera sees up close.",
		preciseRender
	)
end
if unanchored > 500 then
	add(
		"unanchored-parts",
		if unanchored > 3000 then "HIGH" else "MEDIUM",
		`{fmt(unanchored)} unanchored parts in Workspace (physics simulates and replicates them)`,
		"Anchor everything that doesn't need to move; weld moving pieces into few assemblies.",
		unanchoredList
	)
end
if #humanoids > 50 then
	add(
		"humanoid-npcs",
		if #humanoids > 150 then "HIGH" else "MEDIUM",
		`{#humanoids} Humanoids in Workspace`,
		"Humanoids are among the most expensive instances. NPCs that don't need one: AnimationController + Animator; crowds: simulate positions on the server and render models on clients.",
		humanoids
	)
end
table.sort(emitters, function(a, b)
	return a.Alive > b.Alive
end)
if aliveParticles > 5000 then
	add(
		"particle-load",
		if aliveParticles > 20000 then "HIGH" else "MEDIUM",
		`~{fmt(aliveParticles)} particles alive at once from always-on emitters (Rate x Lifetime)`,
		"Lower Rate, shorten Lifetime, use bigger textures with fewer particles, and disable emitters far from the camera (PerfLod tag).",
		(function()
			local list = {}
			for i = 1, math.min(#emitters, 200) do
				table.insert(list, emitters[i].Instance)
			end
			return list
		end)()
	)
end
if #workspaceScripts > 20 then
	add(
		"workspace-scripts",
		"MEDIUM",
		`{#workspaceScripts} Scripts/LocalScripts inside Workspace`,
		"Replace copies of the same script in many parts with a CollectionService tag and one component.",
		workspaceScripts
	)
end
if replicatedInstances > 20000 then
	add(
		"replicated-heavy",
		if replicatedInstances > 60000 then "HIGH" else "MEDIUM",
		`{fmt(replicatedInstances)} instances ({fmt(replicatedParts)} parts) in ReplicatedStorage/ReplicatedFirst/Starter*/Lighting: every client downloads them at join`,
		"Move server-only assets to ServerStorage and clone them in when needed; keep rarely used maps and models out of ReplicatedStorage."
	)
end
if uniqueMeshes > 500 then
	add(
		"unique-meshes",
		"MEDIUM",
		`{fmt(uniqueMeshes)} different meshes in Workspace`,
		"Reuse the same mesh (same MeshId and texture) for repeated props so they instance into one draw call; merge small one-offs."
	)
end
if uniqueTextures > 300 then
	add(
		"unique-textures",
		"MEDIUM",
		`{fmt(uniqueTextures)} different textures in Workspace (texture memory is the biggest cause of mobile crashes)`,
		"Share textures and atlases across props; use 256-512 px for small props; keep SurfaceAppearance for what's seen up close."
	)
end
if surfaceGuis > 150 then
	add(
		"surface-guis",
		"MEDIUM",
		`{surfaceGuis} SurfaceGuis in Workspace (each renders its own texture)`,
		"Use decals/textures for static signs; limit live SurfaceGuis to what players read; set MaxDistance."
	)
end
if #billboardsNoLimit > 50 then
	add(
		"billboards-no-limit",
		"LOW",
		`{#billboardsNoLimit} BillboardGuis draw at any distance`,
		"Set MaxDistance on nameplates, markers and labels (60-150 studs is typical).",
		billboardsNoLimit
	)
end
if viewports > 20 then
	add(
		"viewport-frames",
		"LOW",
		`{viewports} ViewportFrames`,
		"Each one renders its own scene. Show few at once (inventory pages), and use images for static icons."
	)
end
if #loopedSounds > 30 then
	add(
		"looped-sounds",
		"LOW",
		`{#loopedSounds} looped sounds playing in Workspace`,
		"Play ambience on the client, and only near the player; stop sounds that are out of range.",
		loopedSounds
	)
end
if persistentParts > 2000 then
	add(
		"persistent-models",
		"MEDIUM",
		`{#persistentModels} Persistent models hold {fmt(persistentParts)} parts that never stream out`,
		"Keep ModelStreamingMode Persistent for the few models clients must always have; use Atomic or Default for the rest.",
		persistentModels
	)
end
if terrain.Decoration then
	add(
		"terrain-decoration",
		"INFO",
		"Terrain decoration (animated grass) is on",
		"It costs GPU on low-end phones; keep it if it matters to the look, and measure on a phone."
	)
end

-- Report -------------------------------------------------------------------------------------

local ORDER = { HIGH = 1, MEDIUM = 2, LOW = 3, INFO = 4 }
table.sort(findings, function(a, b)
	return ORDER[a.severity] < ORDER[b.severity]
end)

local lines = {}
local function line(s: string)
	table.insert(lines, s)
end

line(`==== Performance audit: {game.Name} ====`)
line("Settings")
line(
	`  StreamingEnabled {tostring(streaming)}  target {tostring(get(Workspace, "StreamingTargetRadius"))}  min {tostring(get(Workspace, "StreamingMinRadius"))}  out {tostring(get(Workspace, "StreamOutBehavior"))}`
)
line(`  Lighting.Technology {Lighting.Technology.Name}  GlobalShadows {tostring(Lighting.GlobalShadows)}`)
local effects = {}
for _, child in Lighting:GetChildren() do
	if child:IsA("PostEffect") or child:IsA("Atmosphere") or child:IsA("Clouds") then
		table.insert(effects, `{child.ClassName}{if get(child, "Enabled") == false then " (off)" else ""}`)
	end
end
line(`  Effects: {if #effects > 0 then table.concat(effects, ", ") else "none"}`)
line("Workspace")
line(`  {fmt(wsInstances)} instances, {fmt(parts)} parts ({fmt(anchored)} anchored, {fmt(unanchored)} unanchored), {fmt(meshParts)} MeshParts, {fmt(unions)} unions`)
line(`  {fmt(uniqueMeshes)} unique meshes, {fmt(uniqueTextures)} unique textures`)
line(`  {lights} lights ({#shadowLights} with shadows), {#emitters} particle emitters (~{fmt(aliveParticles)} alive), {beams} beams, {trails} trails`)
line(`  {#humanoids} Humanoids, {#workspaceScripts} scripts, {surfaceGuis} SurfaceGuis, {billboards} BillboardGuis, {viewports} ViewportFrames`)
line(`Replicated at join (outside Workspace): {fmt(replicatedInstances)} instances, {fmt(replicatedParts)} parts`)

line("")
line(`Findings ({#findings})`)
if #findings == 0 then
	line("  none at these thresholds; measure in game (MicroProfiler, F9 console) before optimising further")
end
for _, f in findings do
	line(`  [{f.severity}] {f.id}  {f.title}`)
	line(`      fix: {f.fix}{if offenders[f.id] then "  (selectable)" else ""}`)
end

line("")
line(`Heaviest models (parts)`)
for i = 1, math.min(TOP, #heavy) do
	line(`  {fmt(heavy[i].Parts)}  {heavy[i].Instance:GetFullName()}`)
end
if #emitters > 0 then
	line(`Heaviest particle emitters (~alive)`)
	for i = 1, math.min(TOP, #emitters) do
		local e = emitters[i]
		line(`  {fmt(e.Alive)}  rate {e.Rate}  {e.Instance:GetFullName()}`)
	end
end

if SELECT then
	local list = offenders[SELECT]
	if list then
		Selection:Set(list)
		line("")
		line(`Selected {#list} instance(s) for "{SELECT}". Edit them together in Properties.`)
	else
		line("")
		line(`Nothing to select for "{SELECT}" (no finding with that id, or it isn't selectable).`)
	end
else
	line("")
	line('Set SELECT = "<finding id>" at the top and run again to select its offenders.')
end

print("\n" .. table.concat(lines, "\n"))
