--!strict
-- Real-camera optics for Roblox: focal length <-> FieldOfView, shot sizes -> camera distance,
-- the dolly zoom, and depth of field from an f-stop. Pure: no Instances.
--
-- Conventions (say these out loud when talking about lenses with the user):
--   * Lens millimetres are full-frame 35 mm equivalents measured across the WIDTH of the frame
--     (36 mm sensor width). That is how cinema lenses behave: a letterbox crops the top and
--     bottom, it doesn't change how wide a 35 mm lens sees.
--   * Roblox's Camera.FieldOfView is VERTICAL and covers the whole viewport, bars included, so
--     the same lens needs a different FieldOfView on a 16:9 monitor and a 19.5:9 phone.
--     Lens.VerticalFov does that conversion every frame from the real viewport aspect.
--   * Roblox's default FieldOfView of 70 on a 16:9 screen is about a 14 mm lens: very wide.
--     That is why gameplay cameras feel "gamey" and why cutscenes should change lens.
--   * 1 stud = 0.28 m (Roblox's avatar scale) for depth of field.

local Lens = {}

local SENSOR_HALF_WIDTH = 18 -- mm
local STUD_METERS = 0.28
local CIRCLE_OF_CONFUSION = 0.03 -- mm, full frame

-- Shot sizes as a fraction of the subject's height: how tall a slice of them fills the visible
-- frame (Extent) and where the frame centre sits on their body (Aim, 0 = feet, 1 = top of head).
export type ShotSize = { Extent: number, Aim: number, Label: string }

Lens.Sizes = table.freeze({
	EWS = table.freeze({ Extent = 12, Aim = 0.5, Label = "Extreme wide: the place, people are specks" }),
	WS = table.freeze({ Extent = 3.2, Aim = 0.5, Label = "Wide: whole body with lots of space around" }),
	FS = table.freeze({ Extent = 1.3, Aim = 0.52, Label = "Full: head to toe" }),
	MLS = table.freeze({ Extent = 0.8, Aim = 0.65, Label = "Medium long / cowboy: knees up" }),
	MS = table.freeze({ Extent = 0.56, Aim = 0.76, Label = "Medium: waist up" }),
	MCU = table.freeze({ Extent = 0.4, Aim = 0.84, Label = "Medium close-up: chest up" }),
	CU = table.freeze({ Extent = 0.28, Aim = 0.9, Label = "Close-up: head and shoulders" }),
	ECU = table.freeze({ Extent = 0.1, Aim = 0.91, Label = "Extreme close-up: the eyes" }),
} :: { [string]: ShotSize })

-- Widest to tightest; one step along this list is "one shot size".
Lens.SizeOrder = table.freeze({ "EWS", "WS", "FS", "MLS", "MS", "MCU", "CU", "ECU" })

-- Named camera heights as elevation angles in degrees (camera above the aim point looking down
-- is positive). A low angle makes the subject powerful; a high angle makes them small.
Lens.Angles = table.freeze({
	Eye = 0,
	High = 25,
	Low = -20,
	Overhead = 80, -- bird's eye / god's eye
	Ground = -32, -- worm's eye
} :: { [string]: number })

-- What each focal length is for (shown to the user when suggesting lenses).
Lens.Guide = table.freeze({
	{ Mm = 14, Use = "Ultra wide: Roblox's default view; distorts faces, exaggerates speed and depth" },
	{ Mm = 18, Use = "Wide establishing shots, cramped interiors, action you want to feel fast" },
	{ Mm = 24, Use = "Wide: environments with people in them, low-angle hero shots" },
	{ Mm = 35, Use = "Normal-wide: the workhorse for medium shots and walk-and-talks" },
	{ Mm = 50, Use = "Normal: close to the eye's perspective, over-the-shoulder dialogue" },
	{ Mm = 85, Use = "Portrait: flattering close-ups, soft backgrounds, intimacy" },
	{ Mm = 135, Use = "Telephoto: compressed depth, voyeur / sniper feel, heat-haze chases" },
})

function Lens.HorizontalFov(mm: number): number -- degrees
	return math.deg(2 * math.atan(SENSOR_HALF_WIDTH / mm))
end

function Lens.FocalForHorizontalFov(degrees: number): number
	return SENSOR_HALF_WIDTH / math.tan(math.rad(degrees) / 2)
end

-- Roblox Camera.FieldOfView (vertical, whole viewport) for a lens on a viewport of `aspect`
-- (width / height).
function Lens.VerticalFov(mm: number, aspect: number): number
	local tanHalfH = SENSOR_HALF_WIDTH / mm
	return math.deg(2 * math.atan(tanHalfH / aspect))
end

function Lens.FocalForVerticalFov(fieldOfView: number, aspect: number): number
	local tanHalfV = math.tan(math.rad(fieldOfView) / 2)
	return SENSOR_HALF_WIDTH / (tanHalfV * aspect)
end

-- Fraction of the viewport height left visible by letterbox bars of aspect `letterbox`.
function Lens.VisibleFraction(aspect: number, letterbox: number?): number
	if letterbox and letterbox > aspect then
		return aspect / letterbox
	end
	return 1
end

-- Distance at which `extent` studs fill the visible frame height.
function Lens.DistanceForExtent(extent: number, fieldOfView: number, visible: number?): number
	local tanHalf = math.tan(math.rad(fieldOfView) / 2)
	return extent / (2 * tanHalf * (visible or 1))
end

-- Vertical studs visible at `distance` (the inverse of DistanceForExtent).
function Lens.ExtentAtDistance(distance: number, fieldOfView: number, visible: number?): number
	return 2 * distance * math.tan(math.rad(fieldOfView) / 2) * (visible or 1)
end

-- The dolly zoom (Vertigo / Jaws): change lens and move so the subject keeps its size.
-- Subject size is proportional to focal / distance, so distance scales with the focal length.
function Lens.DollyZoomDistance(distance: number, fromMm: number, toMm: number): number
	return distance * toMm / fromMm
end

-- Thin-lens depth of field. Returns the near and far limits of acceptable sharpness in studs
-- (far is math.huge past the hyperfocal distance).
function Lens.DepthOfField(distance: number, mm: number, fStop: number): (number, number)
	local s = distance * STUD_METERS * 1000
	local hyper = mm * mm / (fStop * CIRCLE_OF_CONFUSION) + mm
	local near = s * (hyper - mm) / (hyper + s - 2 * mm)
	local far = if s >= hyper then math.huge else s * (hyper - mm) / (hyper - s)
	local toStuds = 1 / (STUD_METERS * 1000)
	return near * toStuds, if far == math.huge then math.huge else far * toStuds
end

-- DepthOfFieldEffect values that keep the subject sharp: FocusDistance on the subject and the
-- in-focus radius to the nearer sharpness limit (Roblox's band is symmetric, real optics
-- aren't), clamped to the property ranges.
function Lens.FocusSettings(distance: number, mm: number, fStop: number): (number, number)
	local near, far = Lens.DepthOfField(distance, mm, fStop)
	local radius = math.min(distance - near, far - distance)
	return math.clamp(distance, 0, 200), math.clamp(radius, 0, 50)
end

-- Name of the shot size whose extent is closest (in log space) to `extent` / `height`.
function Lens.NearestSize(extent: number, height: number): string
	local best, bestError = "MS", math.huge
	for _, name in Lens.SizeOrder do
		local err = math.abs(math.log(extent / (Lens.Sizes[name].Extent * height)))
		if err < bestError then
			best, bestError = name, err
		end
	end
	return best
end

return Lens
