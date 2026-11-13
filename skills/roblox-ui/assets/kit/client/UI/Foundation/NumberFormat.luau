--!strict
-- Number formatting for UI: grouped digits for exact amounts, short suffixes where space is tight.
-- Pure functions, no Instances.

local SUFFIXES = { "", "K", "M", "B", "T", "Qa", "Qi" }

local NumberFormat = {}

-- 1234567 -> "1,234,567"
function NumberFormat.Grouped(value: number): string
	local whole = math.floor(math.abs(value))
	local digits = tostring(whole)
	local grouped = digits:reverse():gsub("(%d%d%d)", "%1,"):reverse()
	if grouped:sub(1, 1) == "," then
		grouped = grouped:sub(2)
	end
	return (if value < 0 then "-" else "") .. grouped
end

-- 950 -> "950", 9999 -> "9,999", 12500 -> "12.5K", 3400000 -> "3.4M", 120000 -> "120K"
-- Exact below 10,000 so small balances never look rounded.
function NumberFormat.Short(value: number): string
	local magnitude = math.abs(value)
	if magnitude < 10000 then
		return NumberFormat.Grouped(value)
	end
	local tier = math.min(math.floor(math.log10(magnitude) / 3), #SUFFIXES - 1)
	local scaled = magnitude / 10 ^ (tier * 3)
	-- Truncate (not round) so 9,999,999 shows 9.9M rather than promising 10M.
	local text = if scaled < 100
		then string.format("%.1f", math.floor(scaled * 10) / 10)
		else string.format("%d", math.floor(scaled))
	text = string.gsub(text, "%.0$", "")
	return (if value < 0 then "-" else "") .. text .. SUFFIXES[tier + 1]
end

return NumberFormat
