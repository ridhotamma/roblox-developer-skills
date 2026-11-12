--!strict
-- Client-side gun cosmetics: muzzle flash + light, smoke puff, tracers, projectile visuals,
-- impacts by surface material, bullet holes, and the crosshair / hit marker / ammo HUD.
-- Nothing here affects gameplay; the server decides hits.
--
-- Particle textures are ones that ship with Roblox, so effects work before you upload art.
-- For hand-made effects, author them with the roblox-vfx skill and play them from here.

local Players = game:GetService("Players")
local ReplicatedStorage = game:GetService("ReplicatedStorage")
local RunService = game:GetService("RunService")
local TweenService = game:GetService("TweenService")

local Ballistics = require(ReplicatedStorage.Shared.Combat.Ballistics)
local CombatConfig = require(ReplicatedStorage.Shared.Combat.CombatConfig)

local TEX_SPARK = "rbxasset://textures/particles/sparkles_main.dds"
local TEX_SMOKE = "rbxasset://textures/particles/smoke_main.dds"

local player = Players.LocalPlayer
local WeaponFx = {}

---------------------------------------------------------------------------------------------
-- Emitter helpers

local function emitter(props: { [string]: any }): ParticleEmitter
	local e = Instance.new("ParticleEmitter")
	e.Rate = 0
	e.Enabled = true
	e.LockedToPart = false
	for key, value in props do
		(e :: any)[key] = value
	end
	return e
end

local function seq(a: number, b: number): NumberSequence
	return NumberSequence.new(a, b)
end

local function range(a: number, b: number): NumberRange
	return NumberRange.new(a, b)
end

---------------------------------------------------------------------------------------------
-- Muzzle: flash particles, a light blink and a smoke puff, all at the Muzzle attachment.

local function muzzleKit(muzzle: Attachment): (ParticleEmitter, ParticleEmitter, PointLight)
	local flash = muzzle:FindFirstChild("FxFlash") :: ParticleEmitter?
	local smoke = muzzle:FindFirstChild("FxSmoke") :: ParticleEmitter?
	local light = muzzle:FindFirstChild("FxLight") :: PointLight?
	if not flash then
		local e = emitter({
			Name = "FxFlash",
			Texture = TEX_SPARK,
			Lifetime = range(0.03, 0.06),
			Speed = range(6, 14),
			SpreadAngle = Vector2.new(18, 18),
			EmissionDirection = Enum.NormalId.Front,
			Size = seq(0.9, 0),
			LightEmission = 1,
			Color = ColorSequence.new(Color3.fromRGB(255, 240, 190), Color3.fromRGB(255, 150, 40)),
		})
		e.Parent = muzzle
		flash = e
	end
	if not smoke then
		local e = emitter({
			Name = "FxSmoke",
			Texture = TEX_SMOKE,
			Lifetime = range(0.5, 0.9),
			Speed = range(1.5, 3.5),
			SpreadAngle = Vector2.new(25, 25),
			EmissionDirection = Enum.NormalId.Front,
			Drag = 3,
			Acceleration = Vector3.new(0, 2.5, 0),
			Size = seq(0.35, 1.4),
			Transparency = NumberSequence.new({
				NumberSequenceKeypoint.new(0, 0.55),
				NumberSequenceKeypoint.new(1, 1),
			}),
			LightEmission = 0,
			Color = ColorSequence.new(Color3.fromRGB(190, 190, 190)),
			Rotation = range(0, 360),
			RotSpeed = range(-40, 40),
		})
		e.Parent = muzzle
		smoke = e
	end
	if not light then
		local l = Instance.new("PointLight")
		l.Name = "FxLight"
		l.Color = Color3.fromRGB(255, 190, 110)
		l.Range = 12
		l.Brightness = 4
		l.Enabled = false
		l.Parent = muzzle
		light = l
	end
	return flash :: ParticleEmitter, smoke :: ParticleEmitter, light :: PointLight
end

function WeaponFx.Muzzle(muzzle: Attachment, heavy: boolean?)
	local flash, smoke, light = muzzleKit(muzzle)
	flash:Emit(if heavy then 10 else 6)
	smoke:Emit(if heavy then 4 else 2)
	light.Enabled = true
	task.delay(0.045, function()
		light.Enabled = false
	end)
end

---------------------------------------------------------------------------------------------
-- Tracers and projectiles

local function tracerPart(): Part
	local p = Instance.new("Part")
	p.Anchored = true
	p.CanCollide = false
	p.CanQuery = false
	p.CanTouch = false
	p.CastShadow = false
	p.Material = Enum.Material.Neon
	p.Color = Color3.fromRGB(255, 220, 140)
	return p
end

-- A short bright streak travelling from `from` to `to`.
function WeaponFx.Tracer(from: Vector3, to: Vector3)
	local distance = (to - from).Magnitude
	if distance < 1 then
		return
	end
	local length = math.min(distance, 10)
	local duration = math.clamp(distance / 900, 0.03, 0.1)
	local part = tracerPart()
	part.Size = Vector3.new(0.08, 0.08, length)
	part.Transparency = 0.15
	part.Parent = workspace
	local direction = (to - from).Unit
	local started = os.clock()
	local connection: RBXScriptConnection
	connection = RunService.RenderStepped:Connect(function()
		local t = math.min(1, (os.clock() - started) / duration)
		local headDistance = length + (distance - length) * t
		local head = from + direction * headDistance
		part.CFrame = CFrame.lookAt(head - direction * (length / 2), head)
		if t >= 1 then
			connection:Disconnect()
			part:Destroy()
		end
	end)
end

-- A visible projectile following the same maths the server uses.
function WeaponFx.Projectile(
	origin: Vector3,
	velocity: Vector3,
	gravity: number,
	maxDistance: number,
	params: RaycastParams
)
	local part = tracerPart()
	part.Size = Vector3.new(0.15, 0.15, 1.6)
	part.Color = Color3.fromRGB(240, 230, 200)
	part.Parent = workspace
	local position, vel, travelled = origin, velocity, 0
	local connection: RBXScriptConnection
	connection = RunService.RenderStepped:Connect(function(dt)
		local before = position
		local result
		position, vel, result = Ballistics.Step(position, vel, gravity, dt, params)
		travelled += (position - before).Magnitude
		if vel.Magnitude > 0 then
			part.CFrame = CFrame.lookAt(position, position + vel)
		end
		if result then
			WeaponFx.Impact(result.Position, result.Normal, result.Material, result.Instance)
		end
		if result or travelled >= maxDistance then
			connection:Disconnect()
			part:Destroy()
		end
	end)
end

---------------------------------------------------------------------------------------------
-- Impacts

type ImpactStyle = { texture: string, color: Color3, count: number, speed: NumberRange, size: number, light: number }

local SPARKS: ImpactStyle = {
	texture = TEX_SPARK,
	color = Color3.fromRGB(255, 200, 90),
	count = 10,
	speed = range(12, 26),
	size = 0.35,
	light = 1,
}
local DUST: ImpactStyle = {
	texture = TEX_SMOKE,
	color = Color3.fromRGB(150, 135, 115),
	count = 6,
	speed = range(3, 8),
	size = 1.1,
	light = 0,
}
local CHIPS: ImpactStyle = {
	texture = TEX_SPARK,
	color = Color3.fromRGB(120, 85, 50),
	count = 8,
	speed = range(8, 16),
	size = 0.3,
	light = 0,
}
local SPLASH: ImpactStyle = {
	texture = TEX_SMOKE,
	color = Color3.fromRGB(190, 225, 255),
	count = 8,
	speed = range(6, 14),
	size = 0.8,
	light = 0.3,
}
local SHARDS: ImpactStyle = {
	texture = TEX_SPARK,
	color = Color3.fromRGB(210, 240, 255),
	count = 9,
	speed = range(10, 20),
	size = 0.3,
	light = 0.6,
}
local FLESH: ImpactStyle = {
	texture = TEX_SPARK,
	color = Color3.fromRGB(255, 255, 255),
	count = 7,
	speed = range(6, 14),
	size = 0.45,
	light = 1,
}

local BY_MATERIAL: { [Enum.Material]: ImpactStyle } = {
	[Enum.Material.Metal] = SPARKS,
	[Enum.Material.CorrodedMetal] = SPARKS,
	[Enum.Material.DiamondPlate] = SPARKS,
	[Enum.Material.Foil] = SPARKS,
	[Enum.Material.Wood] = CHIPS,
	[Enum.Material.WoodPlanks] = CHIPS,
	[Enum.Material.Water] = SPLASH,
	[Enum.Material.Glass] = SHARDS,
	[Enum.Material.Ice] = SHARDS,
	[Enum.Material.Glacier] = SHARDS,
}

local holes: { BasePart } = {}

local function bulletHole(position: Vector3, normal: Vector3, hit: Instance)
	if not hit:IsA("BasePart") or not hit.Anchored then
		return
	end
	local side = normal:Cross(Vector3.yAxis)
	if side.Magnitude < 1e-3 then
		side = normal:Cross(Vector3.xAxis)
	end
	local hole = Instance.new("Part")
	hole.Shape = Enum.PartType.Cylinder -- the cylinder's axis is X, so X points along the normal
	hole.Size = Vector3.new(0.04, 0.28, 0.28)
	hole.CFrame = CFrame.fromMatrix(position + normal * 0.02, normal, side.Unit)
	hole.Color = Color3.fromRGB(25, 25, 25)
	hole.Material = Enum.Material.SmoothPlastic
	hole.Anchored = true
	hole.CanCollide = false
	hole.CanQuery = false
	hole.CanTouch = false
	hole.CastShadow = false
	hole.Parent = workspace
	table.insert(holes, hole)
	if #holes > CombatConfig.Feedback.MaxBulletHoles then
		local oldest = table.remove(holes, 1)
		if oldest then
			oldest:Destroy()
		end
	end
	task.delay(6, function()
		TweenService:Create(hole, TweenInfo.new(1), { Transparency = 1 }):Play()
		task.wait(1)
		local index = table.find(holes, hole)
		if index then
			table.remove(holes, index)
		end
		hole:Destroy()
	end)
end

function WeaponFx.Impact(position: Vector3, normal: Vector3, material: Enum.Material, hit: Instance)
	local model = hit:FindFirstAncestorOfClass("Model")
	local isCharacter = model ~= nil and model:FindFirstChildOfClass("Humanoid") ~= nil
	local style = if isCharacter then FLESH else (BY_MATERIAL[material] or DUST)

	local anchor = Instance.new("Attachment")
	anchor.WorldCFrame = CFrame.lookAt(position, position + normal)
	anchor.Parent = workspace.Terrain
	local e = emitter({
		Texture = style.texture,
		Lifetime = range(0.15, 0.45),
		Speed = style.speed,
		SpreadAngle = Vector2.new(45, 45),
		EmissionDirection = Enum.NormalId.Front,
		Drag = 4,
		Acceleration = Vector3.new(0, if style.light > 0 then -30 else 1, 0),
		Size = seq(style.size, 0),
		Transparency = seq(0.1, 1),
		LightEmission = style.light,
		Color = ColorSequence.new(style.color),
	})
	e.Parent = anchor
	e:Emit(style.count)
	task.delay(1, function()
		anchor:Destroy()
	end)

	if not isCharacter then
		bulletHole(position, normal, hit)
	end
end

---------------------------------------------------------------------------------------------
-- HUD: crosshair (gap shows spread), hit marker, ammo

local hud: ScreenGui? = nil
local arms: { Frame } = {}
local marker: Frame? = nil
local ammoLabel: TextLabel? = nil

local function ensureHud(): ScreenGui
	if hud and hud.Parent then
		return hud
	end
	local gui = Instance.new("ScreenGui")
	gui.Name = "WeaponHud"
	gui.ResetOnSpawn = false
	gui.IgnoreGuiInset = true
	gui.Enabled = false
	gui.Parent = player:WaitForChild("PlayerGui")

	arms = {}
	for i = 1, 4 do
		local arm = Instance.new("Frame")
		arm.AnchorPoint = Vector2.new(0.5, 0.5)
		arm.BackgroundColor3 = Color3.new(1, 1, 1)
		arm.BorderSizePixel = 0
		arm.Size = if i <= 2 then UDim2.fromOffset(2, 9) else UDim2.fromOffset(9, 2)
		arm.Parent = gui
		arms[i] = arm
	end

	local m = Instance.new("Frame")
	m.AnchorPoint = Vector2.new(0.5, 0.5)
	m.Position = UDim2.fromScale(0.5, 0.5)
	m.Size = UDim2.fromOffset(26, 26)
	m.BackgroundTransparency = 1
	m.Visible = false
	m.Parent = gui
	for _, rotation in { 45, -45 } do
		local bar = Instance.new("Frame")
		bar.AnchorPoint = Vector2.new(0.5, 0.5)
		bar.Position = UDim2.fromScale(0.5, 0.5)
		bar.Size = UDim2.new(1, 0, 0, 2)
		bar.Rotation = rotation
		bar.BorderSizePixel = 0
		bar.BackgroundColor3 = Color3.new(1, 1, 1)
		bar.Parent = m
	end
	marker = m

	local label = Instance.new("TextLabel")
	label.AnchorPoint = Vector2.new(1, 1)
	label.Position = UDim2.new(1, -24, 1, -24)
	label.Size = UDim2.fromOffset(180, 44)
	label.BackgroundTransparency = 1
	label.Font = Enum.Font.GothamBold
	label.TextScaled = true
	label.TextXAlignment = Enum.TextXAlignment.Right
	label.TextColor3 = Color3.new(1, 1, 1)
	label.TextStrokeTransparency = 0.4
	label.Parent = gui
	ammoLabel = label

	hud = gui
	return gui
end

function WeaponFx.ShowHud(visible: boolean)
	ensureHud().Enabled = visible
end

-- Spread in degrees -> crosshair gap in pixels.
function WeaponFx.SetSpread(degrees: number)
	ensureHud()
	local camera = workspace.CurrentCamera
	if not camera then
		return
	end
	local pixelsPerDegree = camera.ViewportSize.Y / camera.FieldOfView
	local gap = 4 + degrees * pixelsPerDegree
	local offsets = { Vector2.new(0, -gap), Vector2.new(0, gap), Vector2.new(-gap, 0), Vector2.new(gap, 0) }
	for i, arm in arms do
		arm.Position = UDim2.new(0.5, offsets[i].X, 0.5, offsets[i].Y)
	end
end

function WeaponFx.SetAmmo(magazine: number, reserve: number, reloading: boolean?)
	ensureHud()
	local label = ammoLabel :: TextLabel
	label.Text = if reloading then "Reloading..." else `{magazine} / {reserve}`
	label.TextColor3 = if magazine == 0 then Color3.fromRGB(255, 90, 90) else Color3.new(1, 1, 1)
end

local markerToken = 0
function WeaponFx.HitMarker(headshot: boolean, killed: boolean)
	ensureHud()
	local m = marker :: Frame
	local color = if killed
		then Color3.fromRGB(255, 70, 70)
		elseif headshot then Color3.fromRGB(255, 210, 60)
		else Color3.new(1, 1, 1)
	for _, bar in m:GetChildren() do
		(bar :: Frame).BackgroundColor3 = color
	end
	m.Size = if killed then UDim2.fromOffset(34, 34) else UDim2.fromOffset(24, 24)
	m.Visible = true
	markerToken += 1
	local token = markerToken
	task.delay(if killed then 0.25 else 0.12, function()
		if markerToken == token then
			m.Visible = false
		end
	end)
end

return WeaponFx
