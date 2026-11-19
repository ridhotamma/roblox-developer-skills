-- Tests for the cutscene kit's pure modules (Ease, Lens, CameraNoise, Shots, Timeline, Coverage,
-- Qte, Finisher) and for every shipped scene and finisher (they must compile and pass coverage).
--
--   node tests/run-luau.cjs        (from the skill folder; needs the luau CLI)
--
-- In Studio: put this in a Script, add `local Shared = game.ReplicatedStorage.Shared` at the top.

local Ease = require(Shared.Cutscene.Ease)
local Lens = require(Shared.Cutscene.Lens)
local CameraNoise = require(Shared.Cutscene.CameraNoise)
local Shots = require(Shared.Cutscene.Shots)
local Timeline = require(Shared.Cutscene.Timeline)
local Coverage = require(Shared.Cutscene.Coverage)
local Qte = require(Shared.Cutscene.Qte)
local Finisher = require(Shared.Cutscene.Finisher)

local passed, failed = 0, 0
local function check(name: string, condition: any, detail: any?)
	if condition then
		passed += 1
	else
		failed += 1
		print(`FAIL {name}{if detail ~= nil then " (" .. tostring(detail) .. ")" else ""}`)
	end
end
local function near(a: number, b: number, tolerance: number?): boolean
	return math.abs(a - b) <= (tolerance or 1e-6)
end
local function vnear(a: Vector3, b: Vector3, tolerance: number?): boolean
	return (a - b).Magnitude <= (tolerance or 1e-4)
end

local ASPECT = 16 / 9

-- Normalised screen position (-1..1) of a world point seen by a camera, and whether it's in front.
local function project(cframe: CFrame, fov: number, aspect: number, point: Vector3): (number, number, boolean)
	local p = cframe:PointToObjectSpace(point)
	local depth = -p.Z
	local tanV = math.tan(math.rad(fov) / 2)
	local tanH = tanV * aspect
	return (p.X / depth) / tanH, (p.Y / depth) / tanV, depth > 0
end

---------------------------------------------------------------------------------------------
-- Ease

do
	for _, name in Ease.Names do
		check(`ease {name} starts at 0`, near(Ease.Apply(name, 0), 0, 1e-9))
		check(`ease {name} ends at 1`, near(Ease.Apply(name, 1), 1, 1e-9))
	end
	check("linear midpoint", near(Ease.Apply("Linear", 0.5), 0.5))
	check("inout symmetric", near(Ease.Apply("InOut", 0.25) + Ease.Apply("InOut", 0.75), 1))
	local last, monotonic = -1, true
	for i = 0, 100 do
		local v = Ease.Apply("InOut", i / 100)
		monotonic = monotonic and v >= last
		last = v
	end
	check("inout monotonic", monotonic)
	check("snap does most of the move early", Ease.Apply("Snap", 0.2) > 0.7)
	check("settle overshoots", Ease.Apply("Settle", 0.8) > 1)
	check("angle lerp wraps", near(math.abs(Ease.AngleLerp(170, -170, 0.5)), 180))
	check("angle lerp short way", near(Ease.AngleLerp(350, 10, 0.5) % 360, 0, 1e-6))
	local pts = { Vector3.new(0, 0, 0), Vector3.new(10, 0, 0), Vector3.new(10, 0, 10), Vector3.new(0, 5, 10) }
	check("spline starts at the first point", vnear(Ease.CatmullRom(pts, 0), pts[1]))
	check("spline passes the second point", vnear(Ease.CatmullRom(pts, 1 / 3), pts[2]))
	check("spline ends at the last point", vnear(Ease.CatmullRom(pts, 1), pts[4]))
end

---------------------------------------------------------------------------------------------
-- Lens

do
	check("18 mm sees 90° across", near(Lens.HorizontalFov(18), 90))
	check("Roblox default 70 on 16:9 is ~14 mm", near(Lens.FocalForVerticalFov(70, ASPECT), 14.3, 0.2), Lens.FocalForVerticalFov(70, ASPECT))
	for _, mm in { 14, 24, 35, 50, 85, 135 } do
		local fov = Lens.VerticalFov(mm, ASPECT)
		check(`{mm} mm round trip`, near(Lens.FocalForVerticalFov(fov, ASPECT), mm, 1e-6))
	end
	check("same lens, narrower vertical FOV on a phone", Lens.VerticalFov(35, 19.5 / 9) < Lens.VerticalFov(35, ASPECT))
	check("same lens, same horizontal view on any screen", near(
		math.tan(math.rad(Lens.VerticalFov(35, 19.5 / 9)) / 2) * 19.5 / 9,
		math.tan(math.rad(Lens.VerticalFov(35, ASPECT)) / 2) * ASPECT
	))
	check("letterbox 2.39 on 16:9 leaves 74%", near(Lens.VisibleFraction(ASPECT, 2.39), ASPECT / 2.39))
	check("no bars when the screen is wider", Lens.VisibleFraction(2.4, 2.39) == 1)
	local fov = Lens.VerticalFov(50, ASPECT)
	local d = Lens.DistanceForExtent(3, fov, 0.8)
	check("extent/distance inverse", near(Lens.ExtentAtDistance(d, fov, 0.8), 3))
	local d2 = Lens.DollyZoomDistance(d, 50, 25)
	check("dolly zoom keeps subject size", near(Lens.ExtentAtDistance(d2, Lens.VerticalFov(25, ASPECT), 0.8), 3, 1e-9))
	local nearS, farS = Lens.DepthOfField(3 / 0.28, 50, 2.8)
	check("50mm f/2.8 at 3 m: near limit ~2.73 m", near(nearS * 0.28, 2.729, 0.01), nearS * 0.28)
	check("50mm f/2.8 at 3 m: far limit ~3.33 m", near(farS * 0.28, 3.330, 0.01), farS * 0.28)
	local n16, f16 = Lens.DepthOfField(10, 50, 16)
	check("stopping down deepens focus", f16 - n16 > farS - nearS)
	local n85, f85 = Lens.DepthOfField(3 / 0.28, 85, 2.8)
	check("longer lens, shallower focus", f85 - n85 < farS - nearS)
	local _, beyond = Lens.DepthOfField(500, 18, 11)
	check("past hyperfocal the far limit is infinite", beyond == math.huge)
	local focus, radius = Lens.FocusSettings(3 / 0.28, 50, 2.8)
	check("focus on the subject", near(focus, 3 / 0.28))
	check("radius to the nearer limit", near(radius, 3 / 0.28 - nearS))
	check("nearest size", Lens.NearestSize(0.28 * 5.2, 5.2) == "CU")
end

---------------------------------------------------------------------------------------------
-- CameraNoise

do
	local r, p = CameraNoise.Sample("Locked", 3.3, 7)
	check("tripod doesn't move", r == Vector3.zero and p == Vector3.zero)
	local a1 = CameraNoise.Sample("Handheld", 1.234, 99)
	local a2 = CameraNoise.Sample("Handheld", 1.234, 99)
	check("deterministic", a1 == a2)
	local b1 = CameraNoise.Sample("Handheld", 1.234, 100)
	check("seed changes it", a1 ~= b1)
	local prof = CameraNoise.Profiles.Handheld
	local maxPitch, maxJump = 0, 0
	local last = CameraNoise.Sample("Handheld", 0, 5)
	for i = 1, 4000 do
		local rot = CameraNoise.Sample("Handheld", i / 240, 5)
		maxPitch = math.max(maxPitch, math.abs(math.deg(rot.X)))
		maxJump = math.max(maxJump, math.deg((rot - last).Magnitude))
		last = rot
	end
	check("handheld stays within its amplitude", maxPitch <= prof.Rot.X + prof.Jitter + 1e-9, maxPitch)
	check("handheld actually moves", maxPitch > prof.Rot.X * 0.3, maxPitch)
	check("handheld is smooth frame to frame", maxJump < 0.1, maxJump)
	local combat = 0
	for i = 1, 2000 do
		combat = math.max(combat, math.abs(math.deg(CameraNoise.Sample("Combat", i / 120, 5).Y)))
	end
	check("combat shakes more than handheld", combat > maxPitch)
	check("noise continuous across lattice", near(CameraNoise.Noise(3 - 1e-9, 1), CameraNoise.Noise(3, 1), 1e-6))
	check("noise in range", math.abs(CameraNoise.Noise(-12.7, 3)) <= 1)
	check("no trauma no shake", CameraNoise.Shake(0, 1, 1, Vector3.new(3, 3, 3), 14) == Vector3.zero)
	local maxHalf = 0
	for i = 1, 500 do
		local s = CameraNoise.Shake(0.5, i / 60, 1, Vector3.new(4, 4, 4), 14)
		maxHalf = math.max(maxHalf, math.abs(math.deg(s.X)))
	end
	check("half trauma is a quarter of the shake", maxHalf <= 1 + 1e-9, maxHalf)
	check("amount scales", near(CameraNoise.Sample("Handheld", 2, 3, 2).X, 2 * CameraNoise.Sample("Handheld", 2, 3, 1).X, 1e-12))
end

---------------------------------------------------------------------------------------------
-- Shots

local HERO: Shots.ActorPose = { CFrame = CFrame.new(0, 0, 0), Height = 5.2 } -- faces -Z
local BOSS: Shots.ActorPose = { CFrame = CFrame.new(0, 0, -12) * CFrame.Angles(0, math.pi, 0), Height = 8 } -- faces +Z
local function ctxWith(actors: any?, letterbox: number?): Shots.Context
	return { Actors = actors or { Hero = HERO, Boss = BOSS }, Origin = CFrame.new(), Aspect = ASPECT, Letterbox = letterbox }
end

do
	local ctx = ctxWith()
	local ms = Shots.Evaluate({ Subject = "Hero", Size = "MS", Lens = 35 }, 0, 2, ctx)
	local aim = Vector3.new(0, 0.76 * 5.2, 0)
	check("MS aims at the waist-up centre", vnear(ms.Aim, aim))
	check("yaw 0 is in front of the subject", ms.CFrame.Position.Z < -1, ms.CFrame.Position)
	local x, y = project(ms.CFrame, ms.Fov, ASPECT, aim)
	check("subject centred", near(x, 0, 1e-6) and near(y, 0, 1e-6))
	local half = 0.56 * 5.2 / 2
	local _, top = project(ms.CFrame, ms.Fov, ASPECT, aim + Vector3.new(0, half, 0))
	check("MS fills the frame height", near(top, 1, 1e-3), top)
	check("35 mm field of view", near(ms.Fov, Lens.VerticalFov(35, ASPECT)))

	local lb = Shots.Evaluate({ Subject = "Hero", Size = "MS", Lens = 35 }, 0, 2, ctxWith(nil, 2.39))
	local _, topLb = project(lb.CFrame, lb.Fov, ASPECT, aim + Vector3.new(0, half, 0))
	check("letterboxed MS fills the visible frame", near(topLb, Lens.VisibleFraction(ASPECT, 2.39), 1e-3), topLb)

	local thirds = Shots.Evaluate({ Subject = "Hero", Size = "CU", ScreenX = 1 / 3, ScreenY = 0 }, 0, 2, ctx)
	local tx = project(thirds.CFrame, thirds.Fov, ASPECT, thirds.Aim)
	check("rule of thirds: subject on the right third", near(tx, 1 / 3, 1e-6), tx)
	local up = Shots.Evaluate({ Subject = "Hero", Size = "CU", ScreenY = 0.2 }, 0, 2, ctx)
	local _, ty = project(up.CFrame, up.Fov, ASPECT, up.Aim)
	check("ScreenY lifts the subject", near(ty, 0.2, 1e-6), ty)

	local left = Shots.Evaluate({ Subject = "Hero", Size = "MS", Yaw = 90 }, 0, 2, ctx)
	check("yaw +90 is the subject's left side", left.CFrame.Position.X < -1 and math.abs(left.CFrame.Position.Z) < 1e-3, left.CFrame.Position)
	local behind = Shots.Evaluate({ Subject = "Hero", Size = "MS", Yaw = 180 }, 0, 2, ctx)
	check("yaw 180 is behind", behind.CFrame.Position.Z > 1)

	local low = Shots.Evaluate({ Subject = "Boss", Size = "MS", Pitch = "Low" }, 0, 2, ctx)
	check("low angle: camera below the aim", low.CFrame.Position.Y < low.Aim.Y)
	check("low angle: looking up", low.CFrame.LookVector.Y > 0.2)
	local ground = Shots.Evaluate({ Subject = "Hero", Size = "FS", Pitch = "Ground" }, 0, 2, ctx)
	check("never below the floor", ground.CFrame.Position.Y >= 0.25 - 1e-9, ground.CFrame.Position.Y)
	local high = Shots.Evaluate({ Subject = "Hero", Size = "WS", Pitch = "Overhead" }, 0, 2, ctx)
	check("overhead looks down", high.CFrame.LookVector.Y < -0.9)

	local dutch = Shots.Evaluate({ Subject = "Hero", Size = "MS", Roll = 12 }, 0, 2, ctx)
	local rx = dutch.CFrame.RightVector
	check("dutch angle rolls 12°", near(math.deg(math.asin(rx.Y)), 12, 1e-3), math.deg(math.asin(rx.Y)))

	local ots = Shots.Evaluate({ Type = "OverShoulder", Over = "Hero", Subject = "Boss", Side = "Right" }, 0, 2, ctx)
	local ox = project(ots.CFrame, ots.Fov, ASPECT, ots.Aim)
	check("OTS right: camera at the hero's right", ots.CFrame.Position.X > 0.5, ots.CFrame.Position)
	check("OTS right: camera behind the hero", ots.CFrame.Position.Z > 0)
	check("OTS: subject on the far third", near(ox, 1 / 3, 1e-6), ox)
	local hx = project(ots.CFrame, ots.Fov, ASPECT, Vector3.new(0, 0.85 * 5.2, 0))
	check("OTS: foreground shoulder on the near side", hx < 0, hx)
	local otsL = Shots.Evaluate({ Type = "OverShoulder", Over = "Hero", Subject = "Boss", Side = "Left" }, 0, 2, ctx)
	check("OTS left mirrors", otsL.CFrame.Position.X < -0.5)

	local two = Shots.Evaluate({ Type = "TwoShot", Subjects = { "Hero", "Boss" }, Side = "Left" }, 0, 2, ctx)
	local ax = project(two.CFrame, two.Fov, ASPECT, Vector3.new(0, 3, 0))
	local bx = project(two.CFrame, two.Fov, ASPECT, Vector3.new(0, 4, -12))
	check("two-shot frames both", math.abs(ax) < 1 and math.abs(bx) < 1, `{ax} {bx}`)
	check("two-shot on the left of the line", Coverage.SideOfLine(Vector3.zero, Vector3.new(0, 0, -12), two.CFrame.Position) == 1)

	local pov = Shots.Evaluate({ Type = "POV", Actor = "Hero", Subject = "Boss" }, 0, 2, ctx)
	check("POV at the eyes", near(pov.CFrame.Position.Y, 0.91 * 5.2, 1e-6))
	local px = project(pov.CFrame, pov.Fov, ASPECT, pov.Aim)
	check("POV looks at the subject", near(px, 0, 1e-6))

	local path = { Type = "Path", Points = { Vector3.new(-10, 20, 10), Vector3.new(-6, 8, 8), Vector3.new(-3, 3, 6) }, LookAt = "Hero", Ease = "Linear" }
	check("path starts at its first point", vnear(Shots.Evaluate(path, 0, 4, ctx).CFrame.Position, Vector3.new(-10, 20, 10)))
	check("path ends at its last point", vnear(Shots.Evaluate(path, 4, 4, ctx).CFrame.Position, Vector3.new(-3, 3, 6)))
	local static = Shots.Evaluate({ Type = "Static", Position = Vector3.new(5, 10, 5), LookAt = "Hero" }, 1, 2, ctx)
	check("static stays put", vnear(static.CFrame.Position, Vector3.new(5, 10, 5)))

	-- Moves
	local function dist(state: any): number
		return (state.CFrame.Position - state.Aim).Magnitude
	end
	local base = { Subject = "Hero", Size = "MS", Ease = "Linear" }
	local push = table.clone(base)
	push.Move = "PushIn"
	check("push-in: 30% closer at the end", near(dist(Shots.Evaluate(push, 2, 2, ctx)), dist(ms) * 0.7, 1e-6))
	check("push-in: halfway at half time", near(dist(Shots.Evaluate(push, 1, 2, ctx)), dist(ms) * 0.85, 1e-6))
	local arc = table.clone(base)
	arc.Move, arc.Amount = "ArcRight", 25
	local arcEnd = Shots.Evaluate(arc, 2, 2, ctx)
	local before = ms.CFrame.Position - ms.Aim
	local after = arcEnd.CFrame.Position - arcEnd.Aim
	check("arc keeps distance", near(before.Magnitude, after.Magnitude, 1e-6))
	check("arc right moves to the camera's right", (arcEnd.CFrame.Position - ms.CFrame.Position):Dot(ms.CFrame.RightVector) > 0)
	check("arc 25°", near(math.deg(math.acos(before.Unit:Dot(after.Unit))), 25, 1e-3))
	local dz = table.clone(base)
	dz.Move, dz.Amount = "DollyZoom", 0.5
	local dzEnd = Shots.Evaluate(dz, 2, 2, ctx)
	check("dolly zoom halves the lens", near(dzEnd.Lens, 17.5))
	local _, dzTop = project(dzEnd.CFrame, dzEnd.Fov, ASPECT, aim + Vector3.new(0, half, 0))
	check("dolly zoom keeps the subject's size", near(dzTop, 1, 1e-3), dzTop)
	local zoom = table.clone(base)
	zoom.Move = "ZoomIn"
	local zEnd = Shots.Evaluate(zoom, 2, 2, ctx)
	check("zoom doesn't move the camera", vnear(zEnd.CFrame.Position, ms.CFrame.Position))
	check("zoom narrows the view", zEnd.Fov < ms.Fov)
	local crane = table.clone(base)
	crane.Move = "CraneUp"
	local cEnd = Shots.Evaluate(crane, 2, 2, ctx)
	check("crane rises", near(cEnd.CFrame.Position.Y - ms.CFrame.Position.Y, 3))
	check("crane keeps the subject", vnear(cEnd.Aim, ms.Aim))
	local pan = table.clone(base)
	pan.Move = "PanLeft"
	local pEnd = Shots.Evaluate(pan, 2, 2, ctx)
	check("pan stays in place", vnear(pEnd.CFrame.Position, ms.CFrame.Position))
	check("pan left turns left", pEnd.CFrame.LookVector:Dot(ms.CFrame.RightVector) < -0.4)
	local tighten = { Subject = "Hero", Size = "MS", To = { Size = "CU" }, Ease = "Linear" }
	local d0, d1, d2 = dist(Shots.Evaluate(tighten, 0, 2, ctx)), dist(Shots.Evaluate(tighten, 1, 2, ctx)), dist(Shots.Evaluate(tighten, 2, 2, ctx))
	check("To: MS to CU closes in", d0 > d1 and d1 > d2)
	local cu = Shots.Evaluate({ Subject = "Hero", Size = "CU" }, 0, 2, ctx)
	check("To: lands on the CU framing", vnear(Shots.Evaluate(tighten, 2, 2, ctx).CFrame.Position, cu.CFrame.Position, 1e-6))

	-- Lock
	local moved = { Hero = { CFrame = CFrame.new(6, 0, 0), Height = 5.2 }, Boss = BOSS }
	local lockCtx = ctxWith(moved)
	lockCtx.StartActors = { Hero = HERO, Boss = BOSS }
	local fixed = Shots.Evaluate({ Subject = "Hero", Size = "MS", Lock = "Fixed" }, 1, 2, lockCtx)
	check("Lock Fixed: camera ignores the actor moving", vnear(fixed.CFrame.Position, ms.CFrame.Position))
	local panLock = Shots.Evaluate({ Subject = "Hero", Size = "MS", Lock = "Pan" }, 1, 2, lockCtx)
	check("Lock Pan: camera stays", vnear(panLock.CFrame.Position, ms.CFrame.Position))
	check("Lock Pan: but turns to follow", panLock.CFrame.LookVector.X > 0.3)
	local follow = Shots.Evaluate({ Subject = "Hero", Size = "MS" }, 1, 2, lockCtx)
	check("no lock: camera rides along", near(follow.CFrame.Position.X - ms.CFrame.Position.X, 6, 1e-6))

	-- Focus and rack focus
	check("focus on the subject's eyes", vnear(ms.Focus :: Vector3, Shots.Eye(HERO)))
	local rack = { Subject = "Hero", Size = "MS", Focus = "Hero", FocusTo = "Boss", RackAt = 1, RackTime = 0.5 }
	check("rack focus before", vnear(Shots.Evaluate(rack, 0.9, 3, ctx).Focus :: Vector3, Shots.Eye(HERO)))
	check("rack focus after", vnear(Shots.Evaluate(rack, 1.6, 3, ctx).Focus :: Vector3, Shots.Eye(BOSS)))

	-- Validation
	local actors = { Hero = {}, Boss = {} }
	check("valid shot", #Shots.Validate({ Subject = "Hero", Size = "CU", Move = "PushIn" }, actors) == 0)
	check("unknown subject", #Shots.Validate({ Subject = "Nobody" }, actors) == 1)
	check("unknown size", #Shots.Validate({ Subject = "Hero", Size = "Huge" }, actors) == 1)
	check("unknown move", #Shots.Validate({ Subject = "Hero", Move = "Barrel" }, actors) == 1)
	check("two-shot needs two", #Shots.Validate({ Type = "TwoShot", Subjects = { "Hero" } }, actors) == 1)
end

---------------------------------------------------------------------------------------------
-- Timeline

local TEST_SCENE = {
	Name = "Test",
	Letterbox = 2.39,
	FadeIn = 0.5,
	FadeOut = 0.5,
	Line = { "Hero", "Boss" },
	Length = 7,
	Marks = {
		HeroStart = { Position = Vector3.new(0, 0, 6), Face = "BossStart" },
		BossStart = { Position = Vector3.new(0, 0, -6), Face = "HeroStart" },
		Near = { Position = Vector3.new(0, 0, -2) },
	},
	Actors = { Hero = { Mark = "HeroStart" }, Boss = { Mark = "BossStart", Height = 8 } },
	Shots = {
		{ At = 0, Subject = "Hero", Size = "WS", Yaw = 30, Lens = 24 },
		{ At = 2, Type = "OverShoulder", Over = "Hero", Subject = "Boss", Side = "Left" },
		{ At = 4, Subject = "Boss", Size = "MCU", Yaw = -30, Blend = 0.5, Style = "Handheld" },
	},
	Moves = { { At = 3, Actor = "Boss", To = "Near", Duration = 1 } },
	Animations = {
		{ At = 0, Actor = "Hero", Id = "rbxassetid://1" },
		{ At = 1, Actor = "Hero", Id = "rbxassetid://2" },
		{ At = 1.5, Actor = "Boss", Id = "", Duration = 1 },
	},
	Sounds = { { At = 0.5, Id = "rbxassetid://9" } },
	Subtitles = { { At = 1, Duration = 2, Speaker = "Hero", Text = "Hello." } },
	Events = { { At = 2.5, Name = "Door", Essential = true }, { At = 3.5, Name = "Ragdoll", Target = "Boss" } },
	Shakes = { { At = 4.5, Trauma = 0.8 } },
	Freezes = { { At = 4.5, Hold = 0.1 } },
	SlowMo = { { At = 5, Duration = 0.5, Scale = 0.25 } },
}

do
	local c, errors = Timeline.Compile(TEST_SCENE)
	check("test scene compiles", #errors == 0, table.concat(errors, "; "))
	check("length", c.Length == 7)
	check("wall length adds freeze and slow motion", near(c.WallLength, 7 + 0.1 + 0.5 / 0.25 - 0.5), c.WallLength)
	local roundTrip = true
	for i = 0, 70 do
		local t = i / 10
		if not near(t, 4.5) then
			roundTrip = roundTrip and near(Timeline.SceneTime(c, Timeline.WallTime(c, t)), t, 1e-9)
		end
	end
	check("scene <-> wall round trip", roundTrip)
	local freezeWall = Timeline.WallTime(c, 4.5)
	check("freeze holds scene time", near(Timeline.SceneTime(c, freezeWall + 0.05), 4.5))
	check("speed 0 in a freeze", Timeline.SpeedAtWall(c, freezeWall + 0.05) == 0)
	check("quarter speed in slow motion", Timeline.SpeedAtWall(c, Timeline.WallTime(c, 5.2)) == 0.25)
	check("normal speed after", Timeline.SpeedAtWall(c, Timeline.WallTime(c, 6)) == 1)
	check("slow motion takes 4x the wall time", near(Timeline.WallTime(c, 5.5) - Timeline.WallTime(c, 5), 2))
	check("negative wall time before the start", near(Timeline.SceneTime(c, -0.3), -0.3))

	local hero = Timeline.Poses(c, 0, CFrame.new()).Hero
	check("Face turns the hero to the boss", vnear(hero.CFrame.LookVector, Vector3.new(0, 0, -1)))
	check("default height", hero.Height == 5.2)
	check("actor height override", Timeline.Poses(c, 0, CFrame.new()).Boss.Height == 8)
	check("move halfway", near(Timeline.ActorPose(c, "Boss", 3.5).Position.Z, -4, 1e-6))
	check("move done", near(Timeline.ActorPose(c, "Boss", 6).Position.Z, -2, 1e-6))
	check("a mark without a facing keeps the actor's", near(math.abs(Timeline.ActorPose(c, "Boss", 6).Yaw), 180, 1e-6))
	local origin = CFrame.new(100, 5, 0) * CFrame.Angles(0, math.pi / 2, 0)
	local world = Timeline.Poses(c, 0, origin).Hero.CFrame.Position
	check("origin moves the whole scene", vnear(world, origin * Vector3.new(0, 0, 6)))

	check("shot lookup", Timeline.ShotIndexAt(c, 2.5) == 2 and Timeline.ShotIndexAt(c, 0) == 1 and Timeline.ShotIndexAt(c, 6) == 3)
	local items = Timeline.ItemsBetween(c, -1, 1)
	local kinds = {}
	for _, item in items do
		table.insert(kinds, item.Kind)
	end
	check("fire order", table.concat(kinds, ",") == "Animation,Sound,Animation,Subtitle", table.concat(kinds, ","))
	check("t0 exclusive", #Timeline.ItemsBetween(c, 1, 1.4) == 0)

	local active = Timeline.ActiveAt(c, 1.2)
	check("seek: latest animation per actor", #active.Animations == 1 and active.Animations[1].Item.Id == "rbxassetid://2")
	check("seek: offset into it", near(active.Animations[1].Offset, 0.2))
	check("seek: sound offset", #active.Sounds == 1 and near(active.Sounds[1].Offset, 0.7))
	check("seek: finished animation dropped", #Timeline.ActiveAt(c, 2.6).Animations == 1)
	check("seek: ragdolls", Timeline.ActiveAt(c, 3.6).Ragdolls[1] == "Boss")

	check("fade in from black", near(Timeline.FadeAt(c, 0), 1) and near(Timeline.FadeAt(c, 0.25), 0.5) and near(Timeline.FadeAt(c, 3), 0))
	check("fade out to black", near(Timeline.FadeAt(c, 6.75), 0.5) and near(Timeline.FadeAt(c, 7), 1))
	check("letterbox slides", Timeline.LetterboxAt(c, 0) == 0 and Timeline.LetterboxAt(c, 3) == 1)
	check("subtitle shows", Timeline.SubtitleAt(c, 1.5) and Timeline.SubtitleAt(c, 1.5).Text == "Hello.")
	check("subtitle gone", Timeline.SubtitleAt(c, 3.5) == nil)
	check("trauma hits", near(Timeline.TraumaAt(c, 4.5), 0.8))
	check("trauma decays", near(Timeline.TraumaAt(c, 4.75), 0.4) and Timeline.TraumaAt(c, 5.5) == 0)
	check("essential events survive a skip", #Timeline.EssentialAfter(c, 2) == 1 and #Timeline.EssentialAfter(c, 3) == 0)
	check("ends at its length", Timeline.EndFrom(c, 0) == 7)

	local opts = { Noise = false }
	local o = CFrame.new()
	local atBlend = Timeline.Camera(c, 4, o, ASPECT, opts)
	local justBefore = Timeline.Camera(c, 4 - 1e-4, o, ASPECT, opts)
	check("blend starts where the last shot was", vnear(atBlend.CFrame.Position, justBefore.CFrame.Position, 0.01))
	local blended = Timeline.Camera(c, 4.25, o, ASPECT, opts)
	local alone = Shots.Evaluate(c.Shots[3], 0.25, 3, { Actors = Timeline.Poses(c, 4.25, o), Origin = o, Aspect = ASPECT, Letterbox = 2.39 })
	local prevAlone = Shots.Evaluate(c.Shots[2], 2.25, 2, { Actors = Timeline.Poses(c, 4.25, o), Origin = o, Aspect = ASPECT, Letterbox = 2.39 })
	check("blend is between", (blended.CFrame.Position - alone.CFrame.Position).Magnitude < (prevAlone.CFrame.Position - alone.CFrame.Position).Magnitude)
	local after = Timeline.Camera(c, 4.6, o, ASPECT, opts)
	local alone2 = Shots.Evaluate(c.Shots[3], 0.6, 3, { Actors = Timeline.Poses(c, 4.6, o), Origin = o, Aspect = ASPECT, Letterbox = 2.39 })
	check("after the blend it's the shot", vnear(after.CFrame.Position, alone2.CFrame.Position))
	local noisy = Timeline.Camera(c, 6, o, ASPECT)
	local clean = Timeline.Camera(c, 6, o, ASPECT, opts)
	check("handheld style moves the camera", not vnear(noisy.CFrame.LookVector, clean.CFrame.LookVector, 1e-5))
	local calm = Timeline.Camera(c, 1, o, ASPECT)
	check("locked shot has no noise", vnear(calm.CFrame.LookVector, Timeline.Camera(c, 1, o, ASPECT, opts).CFrame.LookVector, 1e-9))
	local noShake = Timeline.Camera(c, 4.55, o, ASPECT, { ShakeScale = 0 })
	local shake = Timeline.Camera(c, 4.55, o, ASPECT)
	check("shake setting 0 removes impact shake", not vnear(noShake.CFrame.LookVector, shake.CFrame.LookVector, 1e-6))

	local bad = {
		Name = "Bad",
		Actors = { A = { Mark = "Missing" } },
		Shots = { { At = 0, Subject = "Ghost" } },
		SlowMo = { { At = 1, Duration = 2, Scale = 0.5 }, { At = 2, Duration = 1, Scale = 0.5 } },
		Qtes = { { At = 1, Qte = { Type = "Mash", Action = "Struggle", Window = 2 } } },
	}
	local _, badErrors = Timeline.Compile(bad)
	check("errors: missing mark, ghost subject, overlap, bad QTE", #badErrors == 4, table.concat(badErrors, "; "))
	local _, noShots = Timeline.Compile({ Name = "Empty", Actors = {} })
	check("errors: no shots", #noShots == 1)
end

---------------------------------------------------------------------------------------------
-- Coverage

local function kindsOf(warnings: { any }): string
	local out = {}
	for _, w in warnings do
		table.insert(out, w.Kind)
	end
	return table.concat(out, ",")
end

do
	local c = Timeline.Compile(TEST_SCENE)
	local warnings = Coverage.Check(c)
	check("test scene keeps to the rules", #warnings == 0, kindsOf(warnings) .. " " .. (warnings[1] and warnings[1].Message or ""))

	local crossing = table.clone(TEST_SCENE)
	crossing.Shots = table.clone(TEST_SCENE.Shots)
	crossing.Shots[2] = { At = 2, Type = "OverShoulder", Over = "Hero", Subject = "Boss", Side = "Right" }
	local cw = Coverage.Check(Timeline.Compile(crossing))
	check("crossing the line is caught", string.find(kindsOf(cw), "Line") ~= nil, kindsOf(cw))
	crossing.Shots[2] = { At = 2, Type = "OverShoulder", Over = "Hero", Subject = "Boss", Side = "Right", CrossLine = true }
	crossing.Shots[3] = table.clone(TEST_SCENE.Shots[3])
	crossing.Shots[3].Blend = nil
	crossing.Shots[3].CrossLine = true
	local okW = Coverage.Check(Timeline.Compile(crossing))
	check("deliberate crossings pass", string.find(kindsOf(okW), "Line") == nil, kindsOf(okW))

	local jump = table.clone(TEST_SCENE)
	jump.Shots = {
		{ At = 0, Subject = "Hero", Size = "WS", Yaw = 30 },
		{ At = 2, Subject = "Hero", Size = "MS", Yaw = 30 },
		{ At = 4, Subject = "Hero", Size = "MS", Yaw = 45 },
	}
	check("jump cut is caught", string.find(kindsOf(Coverage.Check(Timeline.Compile(jump))), "Jump") ~= nil)

	local quick = table.clone(TEST_SCENE)
	quick.Shots = { { At = 0, Subject = "Hero", Size = "CU" }, { At = 1, Subject = "Boss", Size = "CU", Yaw = -30 }, { At = 1.2, Subject = "Hero", Size = "WS", Yaw = 40 } }
	quick.Subtitles = { { At = 1, Duration = 1, Speaker = "Hero", Text = "This line is far too long to read in a single second." } }
	local qw = kindsOf(Coverage.Check(Timeline.Compile(quick)))
	check("flash cut caught", string.find(qw, "Flash") ~= nil, qw)
	check("no establishing shot caught", string.find(qw, "Establish") ~= nil, qw)
	check("fast subtitle caught", string.find(qw, "Subtitle") ~= nil, qw)

	local qte = table.clone(TEST_SCENE)
	qte.Qtes = { { At = 3, Id = "Dodge", Qte = { Type = "Press", Action = "Dodge", Window = 0.4 } } }
	qte.Shots = table.clone(TEST_SCENE.Shots)
	qte.Shots[3] = { At = 3.2, Subject = "Boss", Size = "MCU", Yaw = -30 }
	local qtw = Coverage.Check(Timeline.Compile(qte))
	local qtCount = 0
	for _, w in qtw do
		if w.Kind == "Qte" then
			qtCount += 1
		end
	end
	check("short window and cut during a QTE caught", qtCount == 2, kindsOf(qtw))
	local pacing = Coverage.Pacing(c)
	check("pacing", pacing.Shots == 3 and near(pacing.AverageShot, 7 / 3))
end

---------------------------------------------------------------------------------------------
-- QTE

do
	local press = Qte.Start({ Type = "Press", Action = "Dodge", Window = 1 }, 10)
	check("press: before the start ignored", Qte.Input(press, "Dodge", true, 9.9) == "Pending")
	check("press: wrong button forgiven", Qte.Input(press, "Action", true, 10.1) == "Pending")
	check("press: hit", Qte.Input(press, "Dodge", true, 10.5) == "Success")
	check("press: resolved stays", Qte.Input(press, "Dodge", true, 10.6) == "Success" and press.ResolvedAt == 10.5)
	local strict = Qte.Start({ Type = "Press", Action = "Dodge", Window = 1, Strict = true }, 0)
	check("press strict: wrong button fails", Qte.Input(strict, "Action", true, 0.2) == "Fail")
	local late = Qte.Start({ Type = "Press", Action = "Dodge", Window = 1 }, 0)
	check("press: pending in window", Qte.Update(late, 0.99) == "Pending")
	check("press: window expires", Qte.Update(late, 1.01) == "Fail")
	local tooLate = Qte.Start({ Type = "Press", Action = "Dodge", Window = 1 }, 0)
	check("press: a press after the window fails", Qte.Input(tooLate, "Dodge", true, 1.2) == "Fail")

	local timing = { Type = "Timing", Action = "Attack", Window = 1, Target = 0.75 }
	local t1 = Qte.Start(timing, 0)
	Qte.Input(t1, "Attack", true, 0.77)
	check("timing: perfect", t1.Status == "Success" and t1.Grade == "Perfect")
	local t2 = Qte.Start(timing, 0)
	Qte.Input(t2, "Attack", true, 0.62)
	check("timing: good", t2.Status == "Success" and t2.Grade == "Good")
	local t3 = Qte.Start(timing, 0)
	Qte.Input(t3, "Attack", true, 0.3)
	check("timing: early fails", t3.Status == "Fail" and t3.Grade == "Early")
	local view = Qte.View(Qte.Start(timing, 0), 0.75)
	check("timing ring meets the target", near(view.Ring, 0))

	local mash = Qte.Start({ Type = "Mash", Action = "Struggle", Window = 2, Count = 5 }, 0)
	for i = 1, 4 do
		Qte.Input(mash, "Struggle", true, i * 0.1)
	end
	check("mash: meter fills", near(mash.Meter, 0.8) and mash.Status == "Pending")
	Qte.Input(mash, "Struggle", true, 0.5)
	check("mash: success at count", mash.Status == "Success")
	local capped = Qte.Start({ Type = "Mash", Action = "Struggle", Window = 2, Count = 5 }, 0)
	for i = 1, 10 do
		Qte.Input(capped, "Struggle", true, 0.1 + i * 0.001)
	end
	check("mash: auto-clicker capped", capped.Presses == 1)
	local drain = Qte.Start({ Type = "Mash", Action = "Struggle", Window = 3, Count = 10, Decay = 1 }, 0)
	for i = 1, 20 do
		Qte.Input(drain, "Struggle", true, i * 0.14) -- ~7 presses/s: fills 0.7/s, drains 1/s
	end
	check("mash with decay: too slow never fills", drain.Status ~= "Success", drain.Meter)
	local fast = Qte.Start({ Type = "Mash", Action = "Struggle", Window = 3, Count = 10, Decay = 1 }, 0)
	for i = 1, 40 do
		Qte.Input(fast, "Struggle", true, i * 0.07) -- ~14 presses/s: net +0.43/s
	end
	check("mash with decay: fast enough fills", fast.Status == "Success")

	local alt = Qte.Start({ Type = "Alternate", Actions = { "Left", "Right" }, Window = 3, Count = 4 }, 0)
	for i = 1, 3 do
		Qte.Input(alt, "Left", true, i * 0.1)
	end
	check("alternate: same button counts once", alt.Presses == 1)
	Qte.Input(alt, "Right", true, 0.5)
	Qte.Input(alt, "Left", true, 0.6)
	Qte.Input(alt, "Right", true, 0.7)
	check("alternate: success", alt.Status == "Success")

	local hold = Qte.Start({ Type = "Hold", Action = "Action", Window = 2, Hold = 1 }, 0)
	Qte.Input(hold, "Action", true, 0.1)
	check("hold: pending while held", Qte.Update(hold, 0.9) == "Pending")
	check("hold: success after the time", Qte.Update(hold, 1.15) == "Success")
	local cumulative = Qte.Start({ Type = "Hold", Action = "Action", Window = 2, Hold = 1 }, 0)
	Qte.Input(cumulative, "Action", true, 0)
	Qte.Input(cumulative, "Action", false, 0.6)
	Qte.Input(cumulative, "Action", true, 0.8)
	check("hold: cumulative by default", Qte.Update(cumulative, 1.25) == "Success")
	local continuous = Qte.Start({ Type = "Hold", Action = "Action", Window = 2, Hold = 1, Continuous = true }, 0)
	Qte.Input(continuous, "Action", true, 0)
	Qte.Input(continuous, "Action", false, 0.6)
	Qte.Input(continuous, "Action", true, 0.8)
	check("hold: continuous resets on release", Qte.Update(continuous, 1.25) == "Pending")

	local seq = Qte.Start({ Type = "Sequence", Actions = { "Up", "Left", "Attack" }, Window = 3, Step = 1 }, 0)
	Qte.Input(seq, "Up", true, 0.3)
	Qte.Input(seq, "Left", true, 0.6)
	check("sequence: expected next", Qte.View(seq, 0.7).Expected == "Attack")
	Qte.Input(seq, "Attack", true, 0.9)
	check("sequence: success", seq.Status == "Success")
	local wrong = Qte.Start({ Type = "Sequence", Actions = { "Up", "Left" }, Window = 3 }, 0)
	check("sequence: wrong button fails", Qte.Input(wrong, "Left", true, 0.2) == "Fail")
	local slow = Qte.Start({ Type = "Sequence", Actions = { "Up", "Left" }, Window = 3, Step = 0.5 }, 0)
	Qte.Input(slow, "Up", true, 0.3)
	check("sequence: step timeout", Qte.Update(slow, 0.9) == "Fail")

	local spec = { Type = "Mash", Action = "Struggle", Window = 2, Count = 10, Decay = 0.5 }
	local easy = Qte.Effective(spec, "Easy")
	check("easy: wider window, fewer presses", easy.Window == 3 and easy.Count == 6 and easy.Decay == 0.25)
	local holdAssist = Qte.Effective(spec, "Hold")
	check("hold assist: mash becomes a hold", holdAssist.Type == "Hold" and holdAssist.Action == "Struggle" and near(holdAssist.Hold :: number, 1))
	local assisted = Qte.Start(spec, 0, "Hold")
	Qte.Input(assisted, "Struggle", true, 0.1)
	check("hold assist: holding wins", Qte.Update(assisted, 1.2) == "Success")
	local auto = Qte.Start(spec, 0, "Auto")
	check("auto: waits a moment", Qte.Update(auto, 0.2) == "Pending")
	check("auto: then succeeds", Qte.Update(auto, 0.5) == "Success" and auto.Grade == "Auto")

	check("judge: trust a plausible time", near(Qte.JudgeTime(9.9, 10, 0.3), 9.9))
	check("judge: never from the future", near(Qte.JudgeTime(10.5, 10, 0.3), 10))
	check("judge: never too old", near(Qte.JudgeTime(5, 10, 0.3), 9.7))
	check("judge: garbage", near(Qte.JudgeTime("x", 10, 0.3), 10))

	check("validate ok", Qte.Validate({ Type = "Press", Action = "Dodge", Window = 1 }) == nil)
	check("validate: unknown type", Qte.Validate({ Type = "Dance", Window = 1 }) ~= nil)
	check("validate: hold longer than window", Qte.Validate({ Type = "Hold", Action = "A", Window = 1, Hold = 2 }) ~= nil)
	check("validate: impossible decay", Qte.Validate({ Type = "Mash", Action = "A", Window = 3, Count = 10, Decay = 3 }) ~= nil)
	check("validate: alternate needs two", Qte.Validate({ Type = "Alternate", Actions = { "A" }, Window = 1, Count = 3 }) ~= nil)
end

---------------------------------------------------------------------------------------------
-- Finisher

local finishers: { [string]: any } = {}
for _, key in __keys do
	local name = string.match(key, "^ReplicatedStorage/Shared/Cutscene/Finishers/(.+)$")
	if name then
		finishers[name] = require(key)
	end
end

do
	local victim = CFrame.new(0, 0, 0) -- faces -Z
	check("side: front", Finisher.Side(Vector3.new(0, 0, -5), victim) == "Front")
	check("side: back", Finisher.Side(Vector3.new(0, 0, 5), victim) == "Back")
	check("side: right", Finisher.Side(Vector3.new(5, 0, 0), victim) == "Right")
	check("side: left", Finisher.Side(Vector3.new(-5, 0, 0), victim) == "Left")
	check("side: 40° off front is still front", Finisher.Side(Vector3.new(math.sin(math.rad(40)), 0, -math.cos(math.rad(40))) * 5, victim) == "Front")
	local sides = Finisher.SidesNear(Vector3.new(math.sin(math.rad(50)), 0, -math.cos(math.rad(50))) * 5, victim, 10)
	check("side tolerance spans the boundary", sides.Front and sides.Right)

	check("shipped finishers found", finishers.Kick and finishers.Suplex and finishers.BackStab and finishers.GloryKill and finishers.Grab)
	local moves = {}
	for name, move in finishers do
		if move.Finisher and move.Finisher.Requires then
			moves[name] = move
		end
	end
	local function choose(ctx: any): string?
		local move = Finisher.Choose(moves, ctx)
		return move and move.Name
	end
	local base = { Side = "Front", Posture = "Stagger", HealthFraction = 0.6, Distance = 4, Height = 0, Unaware = false }
	check("RE4: stagger from the front = kick", choose(base) == "Kick", choose(base))
	local low = table.clone(base)
	low.HealthFraction = 0.15
	check("low health stagger from the front = glory kill", choose(low) == "GloryKill", choose(low))
	local kneelBack = table.clone(base)
	kneelBack.Posture, kneelBack.Side = "Kneel", "Back"
	check("RE4: kneeling, from behind = suplex", choose(kneelBack) == "Suplex", choose(kneelBack))
	local kneelFront = table.clone(base)
	kneelFront.Posture = "Kneel"
	check("kneeling from the front: no suplex", choose(kneelFront) ~= "Suplex")
	local sneak = table.clone(base)
	sneak.Posture, sneak.Side, sneak.Unaware = nil, "Back", true
	check("CoD: unaware, from behind = back stab", choose(sneak) == "BackStab", choose(sneak))
	local aware = table.clone(sneak)
	aware.Unaware = false
	check("aware enemy: no stab", choose(aware) == nil, choose(aware))
	local far = table.clone(base)
	far.Distance = 20
	check("out of range: nothing", choose(far) == nil)
	local boss = table.clone(kneelBack)
	boss.Kind = "Boss"
	check("no suplexing bosses", choose(boss) ~= "Suplex")
	local again = table.clone(low)
	again.Last = "GloryKill"
	check("repeat avoided only within a priority", choose(again) == "GloryKill")
	check("weighted pick returns a fitting move", Finisher.Choose(moves, base, 0.99).Name == "Kick")

	local suplex = finishers.Suplex
	local ground = CFrame.new(10, 2, 3) * CFrame.Angles(0, math.rad(60), 0)
	local origin, attackerAt = Finisher.Align(suplex, ground)
	local victimMark = suplex.Marks[suplex.Actors.Victim.Mark]
	local attackerMark = suplex.Marks[suplex.Actors.Attacker.Mark]
	check("align: victim mark lands on the victim", vnear(origin * victimMark.Position, ground.Position, 1e-6))
	check("align: attacker behind the victim", Finisher.Side(attackerAt.Position, ground) == "Back")
	check("align: attacker distance from the scene", near((attackerAt.Position - ground.Position).Magnitude, (attackerMark.Position - victimMark.Position).Magnitude, 1e-6))
	local g = Finisher.Ground(CFrame.new(0, 3, 0) * CFrame.Angles(0.3, 1, 0), 3)
	check("ground strips tilt", near(g.Position.Y, 0) and near(g.LookVector.Y, 0, 1e-9))
end

---------------------------------------------------------------------------------------------
-- Every shipped scene and finisher compiles and keeps to the rules

do
	for _, key in __keys do
		local kind, name = string.match(key, "^ReplicatedStorage/Shared/Cutscene/(%a+)/(.+)$")
		if kind == "Scenes" or kind == "Finishers" then
			local def = require(key)
			local c, errors = Timeline.Compile(def)
			check(`{kind}/{name} compiles`, #errors == 0, table.concat(errors, "; "))
			check(`{kind}/{name} is named after its module`, def.Name == name, def.Name)
			local warnings = Coverage.Check(c)
			check(`{kind}/{name} passes coverage`, #warnings == 0, (warnings[1] and `{warnings[1].Kind} at {warnings[1].Time}: {warnings[1].Message}`) or "")
			if kind == "Finishers" then
				check(`{name} has Attacker and Victim actors`, def.Actors[def.Finisher.Attacker or "Attacker"] and def.Actors[def.Finisher.Victim or "Victim"])
				check(`{name} is short`, c.WallLength <= 12, c.WallLength)
			end
		end
	end
end

print(`{passed} passed, {failed} failed`)
