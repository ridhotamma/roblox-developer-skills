--!strict
-- Seeded random numbers and smooth noise. Same seed, same map, on every server and in the
-- browser preview (this is the same generator the rlayout tool uses), so a layout can be
-- regenerated from one number instead of being saved or replicated part by part.

local Rng = {}
Rng.__index = Rng

export type Rng = typeof(setmetatable({} :: { a: number }, Rng))

local TWO32 = 4294967296

-- 32-bit integer multiply (what JavaScript calls Math.imul)
local function imul(a: number, b: number): number
	a %= TWO32
	b %= TWO32
	local al, ah = a % 65536, math.floor(a / 65536)
	local bl, bh = b % 65536, math.floor(b / 65536)
	return (al * bl + ((ah * bl + al * bh) % 65536) * 65536) % TWO32
end

function Rng.new(seed: number?): Rng
	local a = math.floor(seed or 1) % TWO32
	if a == 0 then
		a = 1
	end
	return setmetatable({ a = a }, Rng)
end

-- 0 <= n < 1
function Rng.Next(self: Rng): number
	self.a = (self.a + 0x6D2B79F5) % TWO32
	local t = self.a
	t = imul(bit32.bxor(t, bit32.rshift(t, 15)), bit32.bor(t, 1))
	t = bit32.bxor(t, (t + imul(bit32.bxor(t, bit32.rshift(t, 7)), bit32.bor(t, 61))) % TWO32)
	return bit32.bxor(t, bit32.rshift(t, 14)) / TWO32
end

function Rng.Range(self: Rng, lo: number, hi: number): number
	return lo + (hi - lo) * self:Next()
end

-- whole number, both ends included
function Rng.Int(self: Rng, lo: number, hi: number): number
	return lo + math.floor(self:Next() * (hi - lo + 1))
end

function Rng.Pick<T>(self: Rng, list: { T }): T
	return list[math.floor(self:Next() * #list) + 1]
end

function Rng.Chance(self: Rng, p: number): boolean
	return self:Next() < p
end

function Rng.Sign(self: Rng): number
	return if self:Next() < 0.5 then -1 else 1
end

-- Smooth value noise in 0..1: noise(x, z, scale, octaves). Larger scale = broader features.
function Rng.Noise(seed: number): (x: number, z: number, scale: number?, octaves: number?) -> number
	local seedTerm = imul(math.floor(seed), 1442695041)
	local function hash(x: number, z: number): number
		local n = (imul(x, 374761393) + imul(z, 668265263) + seedTerm) % TWO32
		n = imul(bit32.bxor(n, bit32.rshift(n, 13)), 1274126177)
		return bit32.bxor(n, bit32.rshift(n, 16)) / TWO32
	end
	local function smooth(t: number): number
		return t * t * (3 - 2 * t)
	end
	local function one(x: number, z: number): number
		local xi, zi = math.floor(x), math.floor(z)
		local fx, fz = smooth(x - xi), smooth(z - zi)
		local a = hash(xi, zi) + (hash(xi + 1, zi) - hash(xi, zi)) * fx
		local b = hash(xi, zi + 1) + (hash(xi + 1, zi + 1) - hash(xi, zi + 1)) * fx
		return a + (b - a) * fz
	end
	return function(x: number, z: number, scale: number?, octaves: number?): number
		local v, amp, total, f = 0, 1, 0, 1 / (scale or 100)
		for o = 0, (octaves or 2) - 1 do
			v += one(x * f + o * 17.3, z * f - o * 9.1) * amp
			total += amp
			amp *= 0.5
			f *= 2
		end
		return v / total
	end
end

return Rng
