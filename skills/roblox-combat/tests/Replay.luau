-- Replays an input trace against the real Luau modules and prints what they did, one line per
-- query. The browser lab's JS port records the same trace while it runs a scenario, and
-- run-tests.cjs checks that both print the same numbers: the lab is only trusted because of this.
--
-- TRACE is set by run-luau.cjs. One command per line (see the table in the lab's kit.js).

local AimCamera = require(Shared.Combat.AimCamera)
local Ballistics = require(Shared.Combat.Ballistics)
local CombatConfig = require(Shared.Combat.CombatConfig)
local WeaponState = require(Shared.Combat.WeaponState)
local CAMERA_FX = "StarterPlayerScripts/Client/Combat/CameraFx"

local function n(x: number): string
	if x ~= x then
		return "nan"
	end
	local s = string.format("%.6f", x)
	return if s == "-0.000000" then "0.000000" else s
end

local function v(x: any): string
	return `{n(x.X)} {n(x.Y)} {n(x.Z)}`
end

local function cloneStats(stats: any): any
	local out = {}
	for key, value in stats do
		out[key] = value
	end
	return out
end

local models: { [string]: any } = {}
local player = { Name = "Player" }
local cam: any = nil
local gun: any = nil
local rng = Random.new(1)
local sv: { [string]: any } = {}
local fx: any = nil
local out: { string } = {}

local function emit(line: string)
	table.insert(out, line)
end

local function params(): any
	local p = RaycastParams.new()
	p.FilterType = Enum.RaycastFilterType.Exclude
	p.FilterDescendantsInstances = { player }
	return p
end

local function rayCast(origin: any, direction: any): any
	local result = workspace:Raycast(origin, direction, params())
	return if result then result.Position else nil
end

-- The camera's casts ignore CanCollide-off parts (CameraController sets RespectCanCollide);
-- in traces those are the boxes of the "NoCollide" model.
local function sphereCast(origin: any, direction: any, radius: number): number?
	local p = params()
	if models.NoCollide then
		p.FilterDescendantsInstances = { player, models.NoCollide }
	end
	local result = workspace:Spherecast(origin, radius, direction, p)
	return if result then result.Distance else nil
end

local function cameraFx(): any
	if not fx then
		fx = require(Path(CAMERA_FX))
	end
	return fx
end

local function begin()
	World.Clear()
	models = { Player = player }
	cam, gun, fx = nil, nil, nil
	rng = Random.new(1)
	sv = {}
	__cache[CAMERA_FX] = nil
	RunService.steps = {}
	workspace.CurrentCamera.CFrame = CFrame.identity
	workspace.CurrentCamera.FieldOfView = 70
	Clock.now = 0
end

local commands: { [string]: (args: { string }, num: (number) -> number) -> () } = {
	begin = function(args)
		begin()
		emit("## " .. args[2])
	end,
	box = function(args, num)
		local modelName = args[9]
		local model = nil
		if modelName then
			model = models[modelName] or { Name = modelName }
			models[modelName] = model
		end
		World.Box(args[2], Vector3.new(num(3), num(4), num(5)), Vector3.new(num(6), num(7), num(8)), model)
	end,
	cam = function(args)
		cam = AimCamera.new(CombatConfig.Camera, args[2] :: any)
	end,
	look = function(args, num)
		cam:Look(num(2), num(3), args[4] == "1")
	end,
	stick = function(_, num)
		cam:Stick(num(2), num(3), num(4))
	end,
	caim = function(args)
		cam:SetAiming(args[2] == "1")
	end,
	swap = function()
		cam:SwapShoulder()
	end,
	mode = function(args)
		cam:SetMode(args[2] :: any)
	end,
	toggle = function()
		cam:ToggleMode()
	end,
	fired = function()
		cam:Fired()
	end,
	setyaw = function(_, num)
		cam.Yaw, cam.Pitch = num(2), num(3)
	end,
	upd = function(_, num)
		local c, fov = cam:Update(num(2), Vector3.new(num(3), num(4), num(5)), sphereCast)
		emit(
			`cam {v(c.Position)} {v(c.LookVector)} {v(c.RightVector)} {n(fov)} {n(cam.Distance)} {n(cam.Shoulder)} {n(cam.Yaw)} {n(cam.Pitch)} {n(cam.AimBlend)}`
		)
	end,
	cyaw = function(_, num)
		local yaw = cam:CharacterYaw(num(2), num(3))
		emit(if yaw then `cyaw {n(yaw)}` else "cyaw nil")
	end,
	skip = function()
		emit(`skip {n(cam:AimSkip())}`)
	end,
	hide = function()
		emit(`hide {if cam:HideCharacter() then 1 else 0}`)
	end,
	gun = function(args)
		gun = WeaponState.new(cloneStats((CombatConfig.Weapons :: any)[args[2]]), CombatConfig.FireBuffer)
	end,
	gunset = function(args)
		local value: any = tonumber(args[3])
		if value == nil then
			value = if args[3] == "true" then true elseif args[3] == "false" then false else args[3]
		end
		gun.Stats[args[2]] = value
		if args[2] == "Magazine" then
			gun.Magazine = value
		elseif args[2] == "Reserve" then
			gun.Reserve = value
		end
	end,
	press = function(_, num)
		gun:Press(num(2))
	end,
	release = function()
		gun:Release()
	end,
	gaim = function(args)
		gun:SetAiming(args[2] == "1")
	end,
	unequip = function()
		gun:Unequip()
	end,
	setammo = function(_, num)
		gun:SetAmmo(num(2), num(3))
	end,
	reload = function(_, num)
		emit(`reload {if gun:StartReload(num(2)) then 1 else 0}`)
	end,
	step = function(args, num)
		local event = gun:Step(num(2), num(3), args[4] == "1")
		emit(
			`step {event or "-"} {gun.Magazine} {gun.Reserve} {n(gun.Bloom)} {n(gun.LastSpread)} {n(gun.LastRecoilUp)} {n(gun.LastRecoilSide)} {n(gun:Spread(args[4] == "1"))}`
		)
	end,
	aim = function(args, num)
		local skip = if args[1] == "aim0" then 0 else cam:AimSkip()
		emit(`aim {v(Ballistics.AimFrom(cam.CFrame, num(2), skip, rayCast))}`)
	end,
	obst = function(_, num)
		local hit = Ballistics.Obstruction(Vector3.new(num(2), num(3), num(4)), Vector3.new(num(5), num(6), num(7)), rayCast)
		emit(if hit then `obst {v(hit)}` else "obst nil")
	end,
	rng = function(_, num)
		rng = Random.new(num(2))
	end,
	spread = function(_, num)
		emit(`spread {v(Ballistics.Spread(Vector3.new(num(2), num(3), num(4)), num(5), rng))}`)
	end,
	falloff = function(args, num)
		emit(`falloff {n(Ballistics.Falloff(num(2), (CombatConfig.Weapons :: any)[args[3]]))}`)
	end,
	sv = function(args, num)
		local name = args[2]
		local stats = (CombatConfig.Weapons :: any)[name]
		local state = sv[name]
		if not state then
			state = { magazine = 1e9, reserve = 0, reloadingUntil = 0, nextShot = 0 }
			sv[name] = state
		end
		local ok = WeaponState.ServerFire(state, stats, num(3), num(4))
		emit(`sv {if ok then 1 else 0} {n(state.nextShot)}`)
	end,
	svreset = function()
		sv = {}
	end,
	proj = function(_, num)
		local p, vel, hit = Ballistics.Step(
			Vector3.new(num(2), num(3), num(4)),
			Vector3.new(num(5), num(6), num(7)),
			num(8),
			num(9),
			params()
		)
		emit(`proj {v(p)} {v(vel)} {if hit then hit.Instance.Name else "-"}`)
	end,
	ray = function(_, num)
		local result = workspace:Raycast(Vector3.new(num(2), num(3), num(4)), Vector3.new(num(5), num(6), num(7)), params())
		emit(if result then `ray {v(result.Position)} {result.Instance.Name}` else "ray nil")
	end,
	noise = function(_, num)
		emit(`noise {n(math.noise(num(2), num(3), num(4)))}`)
	end,
	clock = function(_, num)
		Clock.now = num(2)
	end,
	fx = function(_, num)
		cameraFx().Recoil(num(2), num(3), num(4))
	end,
	fxtrauma = function(_, num)
		cameraFx().AddTrauma(num(2))
	end,
	fxpunch = function(_, num)
		cameraFx().FovPunch(num(2))
	end,
	fxowned = function(args)
		cameraFx().SetFovOwned(args[2] == "1")
	end,
	-- One render frame the way CameraController + CameraFx run it in game.
	fxframe = function(_, num)
		cameraFx()
		local camera = workspace.CurrentCamera
		camera.CFrame = cam.CFrame
		camera.FieldOfView = cam.Fov
		RunService.RenderFrame(num(2))
		emit(`fx {v(camera.CFrame.Position)} {v(camera.CFrame.LookVector)} {n(camera.FieldOfView)}`)
	end,
}

for line in string.gmatch(TRACE, "[^\n]+") do
	local args = string.split(line, " ")
	local fn = commands[args[1]] or (args[1] == "aim0" and commands.aim)
	if not fn then
		error("unknown trace command: " .. line)
	end
	fn(args, function(i: number): number
		return assert(tonumber(args[i]), line)
	end)
end
print(table.concat(out, "\n"))
