--!strict
-- Maps body parts to hit zones, for R15, R6 and anything named like them.
--
--   Zone        Head | Chest | Stomach | LeftArm | RightArm | LeftLeg | RightLeg   (flinches)
--   Injury key  Head | Torso | LeftArm | RightArm | LeftLeg | RightLeg             (lasting injuries)
--
-- Custom rigs: give any part a "Hitzone" attribute with a zone name (the combat kit already
-- reads Hitzone = "Head" for headshots).

export type Zone = "Head" | "Chest" | "Stomach" | "LeftArm" | "RightArm" | "LeftLeg" | "RightLeg"

local ZONE_BY_PART: { [string]: Zone } = {
	Head = "Head",
	UpperTorso = "Chest",
	LowerTorso = "Stomach",
	LeftUpperArm = "LeftArm",
	LeftLowerArm = "LeftArm",
	LeftHand = "LeftArm",
	RightUpperArm = "RightArm",
	RightLowerArm = "RightArm",
	RightHand = "RightArm",
	LeftUpperLeg = "LeftLeg",
	LeftLowerLeg = "LeftLeg",
	LeftFoot = "LeftLeg",
	RightUpperLeg = "RightLeg",
	RightLowerLeg = "RightLeg",
	RightFoot = "RightLeg",
	-- R6
	["Left Arm"] = "LeftArm",
	["Right Arm"] = "RightArm",
	["Left Leg"] = "LeftLeg",
	["Right Leg"] = "RightLeg",
}

-- One-piece torsos: the hit height decides chest or stomach.
local SPLIT_BY_HEIGHT: { [string]: boolean } = {
	Torso = true,
	HumanoidRootPart = true,
}

local INJURY_KEY: { [string]: string } = {
	Head = "Head",
	Chest = "Torso",
	Stomach = "Torso",
	LeftArm = "LeftArm",
	RightArm = "RightArm",
	LeftLeg = "LeftLeg",
	RightLeg = "RightLeg",
}

local BodyZones = {
	Zones = table.freeze({ "Head", "Chest", "Stomach", "LeftArm", "RightArm", "LeftLeg", "RightLeg" }),
	InjuryKeys = table.freeze({ "Head", "Torso", "LeftArm", "RightArm", "LeftLeg", "RightLeg" }),

	-- Joints (normalized Motor6D names) that go limp when an arm dangles.
	ArmJoints = table.freeze({
		LeftArm = table.freeze({ "LeftShoulder", "LeftElbow", "LeftWrist" }),
		RightArm = table.freeze({ "RightShoulder", "RightElbow", "RightWrist" }),
	}) :: { [string]: { string } },
}

-- "Left Shoulder" -> "LeftShoulder", "RootJoint" -> "Root".
function BodyZones.JointName(name: string): string
	local compact = string.gsub(name, "%s", "")
	return if compact == "RootJoint" then "Root" else compact
end

function BodyZones.IsZone(value: unknown): boolean
	return typeof(value) == "string" and INJURY_KEY[value] ~= nil
end

function BodyZones.InjuryKey(zone: string): string
	return INJURY_KEY[zone] or "Torso"
end

function BodyZones.InjuryAttribute(key: string): string
	return "Injury" .. key
end

local function zoneOfPart(part: BasePart, position: Vector3?): Zone?
	local tagged = part:GetAttribute("Hitzone")
	if BodyZones.IsZone(tagged) then
		return tagged :: any
	end
	local zone = ZONE_BY_PART[part.Name]
	if zone then
		return zone
	end
	if SPLIT_BY_HEIGHT[part.Name] then
		local height = if position then part.CFrame:PointToObjectSpace(position).Y else 0.1
		return if height >= 0 then "Chest" else "Stomach"
	end
	return nil
end

-- The zone for a hit on `part` at `position`. Accessories, tools and unknown parts fall back to
-- the closest known body part, then to the chest.
function BodyZones.FromHit(character: Model, part: BasePart?, position: Vector3?): Zone
	if part then
		local direct = zoneOfPart(part, position)
		if direct then
			return direct
		end
	end
	local at = position or (if part then part.Position else nil)
	if not at then
		return "Chest"
	end
	local best: Zone = "Chest"
	local bestDistance = math.huge
	for _, child in character:GetChildren() do
		if child:IsA("BasePart") then
			local zone = zoneOfPart(child, at)
			if zone then
				local distance = (child.Position - at).Magnitude
				if distance < bestDistance then
					best, bestDistance = zone, distance
				end
			end
		end
	end
	return best
end

-- +1 for the left side, -1 for the right, 0 for the middle.
function BodyZones.Side(zone: string): number
	if string.sub(zone, 1, 4) == "Left" then
		return 1
	elseif string.sub(zone, 1, 5) == "Right" then
		return -1
	end
	return 0
end

return table.freeze(BodyZones)
