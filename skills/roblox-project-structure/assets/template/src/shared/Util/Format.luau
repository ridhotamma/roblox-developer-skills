--!strict
-- Pure formatting helpers shared by server and client. No Instances, no services.

local Format = {}

-- 1234567 -> "1,234,567"
function Format.Number(n: number): string
	local s = tostring(math.floor(n))
	local sign, digits = s:match("^(-?)(%d+)$")
	if not digits then
		return s
	end
	local grouped = digits:reverse():gsub("(%d%d%d)", "%1,"):reverse()
	if grouped:sub(1, 1) == "," then
		grouped = grouped:sub(2)
	end
	return (sign or "") .. grouped
end

-- 3725 -> "1h 2m", 75 -> "1m 15s", 9 -> "9s"
function Format.Duration(seconds: number): string
	seconds = math.max(0, math.floor(seconds))
	local h = seconds // 3600
	local m = (seconds % 3600) // 60
	local s = seconds % 60
	if h > 0 then
		return `{h}h {m}m`
	elseif m > 0 then
		return `{m}m {s}s`
	end
	return `{s}s`
end

return table.freeze(Format)
