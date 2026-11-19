--!strict
-- Camera operator styles (tripod, steadicam, handheld, shoulder rig, documentary, war-film
-- combat, drone, vehicle mount, dream, found footage) and trauma shake for impacts.
-- Pure and deterministic: the same time and seed always give the same wobble, so a scene looks
-- identical on every client, after a seek, and in the previs.
--
-- How it works: smooth value noise (not random numbers, which look like vibration, not a
-- person) on each rotation axis, in two layers: a slow sway (the operator's body, breathing,
-- re-framing) and a faster, smaller jitter (hands and footsteps). Rotation does most of the
-- work; a little position drift sells weight. Real operators shake in angles, so the same
-- profile automatically looks shakier on a long lens, exactly as it does on a real camera.
--
-- Trauma shake (Squirrel Eiserloh's GDC talk "Juicing Your Cameras With Math"): impacts add
-- trauma 0..1 that decays linearly; the shake is trauma squared, so small bumps barely move the
-- frame and big ones really hit.

local CameraNoise = {}

export type Profile = {
	Rot: Vector3, -- degrees (pitch, yaw, roll) of the slow sway
	Freq: number, -- Hz of the sway
	Jitter: number, -- degrees of the fast layer (all axes, roll halved)
	JitterFreq: number, -- Hz of the fast layer
	Pos: Vector3, -- studs of drift in camera space (right, up, back)
	Breath: number, -- studs of slow vertical bob
	Label: string,
}

local function profile(rot: Vector3, freq: number, jitter: number, jitterFreq: number, pos: Vector3, breath: number, label: string): Profile
	return table.freeze({
		Rot = rot,
		Freq = freq,
		Jitter = jitter,
		JitterFreq = jitterFreq,
		Pos = pos,
		Breath = breath,
		Label = label,
	})
end

CameraNoise.Profiles = table.freeze({
	Locked = profile(Vector3.zero, 0, 0, 0, Vector3.zero, 0, "Tripod / locked-off: authority, calm, observation"),
	Steadicam = profile(Vector3.new(0.35, 0.5, 0.25), 0.18, 0, 0, Vector3.new(0.04, 0.05, 0.03), 0.01, "Steadicam / gimbal: floating, following, dreamlike calm"),
	Drone = profile(Vector3.new(0.4, 0.6, 0.5), 0.12, 0, 0, Vector3.new(0.15, 0.12, 0.1), 0, "Drone / helicopter: big slow drift for aerials"),
	Handheld = profile(Vector3.new(0.7, 0.9, 0.5), 0.5, 0.12, 4, Vector3.new(0.03, 0.04, 0.02), 0.015, "Handheld: present, human, slightly uneasy"),
	Shoulder = profile(Vector3.new(0.6, 0.7, 0.9), 0.35, 0.08, 3, Vector3.new(0.02, 0.06, 0.02), 0.02, "Shoulder rig: heavier, more roll, news-crew"),
	Documentary = profile(Vector3.new(1.2, 1.6, 0.8), 0.9, 0.3, 6, Vector3.new(0.05, 0.05, 0.04), 0.02, "Documentary: reactive operator catching the action"),
	Combat = profile(Vector3.new(2.2, 2.8, 1.4), 1.6, 0.6, 9, Vector3.new(0.08, 0.08, 0.05), 0.03, "War-film combat: chaos, panic, shell shock"),
	Vehicle = profile(Vector3.new(0.3, 0.3, 0.4), 0.6, 0.25, 12, Vector3.new(0.02, 0.05, 0.01), 0, "Vehicle mount: engine buzz and road bumps"),
	Dream = profile(Vector3.new(1.5, 1.5, 3.5), 0.12, 0, 0, Vector3.new(0.1, 0.1, 0.05), 0.05, "Dream / underwater / drunk: slow rolling unease"),
	FoundFootage = profile(Vector3.new(2.5, 3.5, 2), 1.2, 0.8, 7, Vector3.new(0.1, 0.1, 0.06), 0.04, "Found footage: amateur, frightened, barely framed"),
} :: { [string]: Profile })

local MOD = 2147483647

-- Deterministic value in -1..1 for an integer lattice point (Park-Miller steps; every product
-- stays below 2^53 so Luau doubles give exact integers on every platform).
local function lattice(i: number, seed: number): number
	local n = (i * 7919 + seed * 104729 + 12345) % MOD
	if n == 0 then
		n = 1
	end
	n = (n * 48271) % MOD
	n = (n * 48271) % MOD
	return n / MOD * 2 - 1
end

-- Smooth 1D value noise in -1..1 (quintic fade: continuous velocity and acceleration).
function CameraNoise.Noise(x: number, seed: number): number
	local i = math.floor(x)
	local f = x - i
	local u = f * f * f * (f * (f * 6 - 15) + 10)
	local a = lattice(i, seed)
	local b = lattice(i + 1, seed)
	return a + (b - a) * u
end

local function layered(x: number, seed: number): number
	return CameraNoise.Noise(x, seed) * 0.7 + CameraNoise.Noise(x * 2.13 + 17.3, seed + 31) * 0.3
end

-- Rotation (radians: pitch, yaw, roll) and position (studs, camera space) for a profile at
-- time `t`, scaled by `amount` (0 = none, 1 = the profile, 2 = twice as shaky).
function CameraNoise.Sample(profileName: string?, t: number, seed: number, amount: number?): (Vector3, Vector3)
	local p = CameraNoise.Profiles[profileName or "Locked"]
	local k = amount or 1
	if not p or k == 0 or p.Freq == 0 then
		return Vector3.zero, Vector3.zero
	end
	local x = t * p.Freq
	local jx = t * p.JitterFreq
	local pitch = p.Rot.X * layered(x, seed + 1) + p.Jitter * CameraNoise.Noise(jx, seed + 11)
	local yaw = p.Rot.Y * layered(x, seed + 2) + p.Jitter * CameraNoise.Noise(jx, seed + 12)
	local roll = p.Rot.Z * layered(x, seed + 3) + p.Jitter * 0.5 * CameraNoise.Noise(jx, seed + 13)
	local px = p.Pos.X * layered(x * 0.8, seed + 21)
	local py = p.Pos.Y * layered(x * 0.8, seed + 22) + p.Breath * math.sin(2 * math.pi * 0.25 * t)
	local pz = p.Pos.Z * layered(x * 0.8, seed + 23)
	return Vector3.new(math.rad(pitch) * k, math.rad(yaw) * k, math.rad(roll) * k), Vector3.new(px, py, pz) * k
end

-- Impact shake for a trauma level 0..1: radians (pitch, yaw, roll).
function CameraNoise.Shake(trauma: number, t: number, seed: number, angles: Vector3, frequency: number): Vector3
	if trauma <= 0 then
		return Vector3.zero
	end
	local s = math.min(trauma, 1) ^ 2
	local x = t * frequency
	return Vector3.new(
		math.rad(angles.X) * s * CameraNoise.Noise(x, seed + 41),
		math.rad(angles.Y) * s * CameraNoise.Noise(x, seed + 42),
		math.rad(angles.Z) * s * CameraNoise.Noise(x, seed + 43)
	)
end

-- Applies a rotation offset (from Sample or Shake) and a position offset in camera space.
function CameraNoise.Apply(cframe: CFrame, rotation: Vector3, position: Vector3?): CFrame
	local moved = if position then cframe * CFrame.new(position) else cframe
	return moved * CFrame.fromEulerAnglesYXZ(rotation.X, rotation.Y, rotation.Z)
end

return CameraNoise
