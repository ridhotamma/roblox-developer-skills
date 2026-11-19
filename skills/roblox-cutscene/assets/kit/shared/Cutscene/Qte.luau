--!strict
-- Quick-time events: one pure state machine used by the client prompt (instant feedback) and by
-- the server (the decision). Times are seconds on a shared clock (workspace:GetServerTimeNow()
-- in game), passed in, never read, so the tests and both sides replay the same inputs exactly.
--
-- Types (match the input to what the character is doing; see references/qte.md):
--   Press     press Action inside the window ("Dodge!")
--   Timing    press when the closing ring meets the target; graded Perfect / Good (a counter)
--   Mash      fill a meter by pressing repeatedly; with Decay it drains (a struggle)
--   Alternate fill a meter by alternating two Actions (climbing, crawling, pushing a door)
--   Hold      hold Action for Hold seconds (pushing, aiming, bracing); Continuous resets on release
--   Sequence  press Actions in order, each within Step seconds (a combo, a lock pick)
--
-- Assist modes (a player setting, references/qte.md §6):
--   Off    as designed
--   Easy   wider windows, fewer presses, slower drain
--   Hold   every Mash / Alternate becomes a short Hold (no rapid pressing)
--   Auto   succeeds on its own shortly after the prompt appears

local Qte = {}

export type Spec = {
	Type: string,
	Action: string?,
	Actions: { string }?,
	Window: number,
	Count: number?,
	Decay: number?,
	Hold: number?,
	Continuous: boolean?,
	Target: number?,
	Perfect: number?,
	Good: number?,
	Step: number?,
	Strict: boolean?,
	Label: string?,
}

export type Status = "Pending" | "Success" | "Fail"

export type State = {
	Spec: Spec,
	Start: number,
	Assist: string,
	Status: Status,
	Grade: string?, -- "Perfect" | "Good" for Timing; "Auto" for assisted
	Meter: number, -- 0..1 (Mash, Alternate, Hold)
	Index: number, -- next Sequence step
	StepStart: number,
	HeldSince: number?,
	Held: number,
	LastAction: string?,
	LastCounted: number,
	LastUpdate: number,
	Presses: number,
	ResolvedAt: number?,
}

Qte.Types = table.freeze({ "Press", "Timing", "Mash", "Alternate", "Hold", "Sequence" })
Qte.Assists = table.freeze({ "Off", "Easy", "Hold", "Auto" })

Qte.MaxPressRate = 20 -- presses per second counted; humans top out around 12-16
Qte.AutoDelay = 0.45 -- Auto assist succeeds this long after the start (or 30% of the window)

local DEFAULT_PERFECT = 0.06
local DEFAULT_GOOD = 0.16

function Qte.Validate(spec: any): string?
	if type(spec) ~= "table" then
		return "spec must be a table"
	end
	if not table.find(Qte.Types, spec.Type) then
		return `Type must be one of {table.concat(Qte.Types, ", ")}`
	end
	if type(spec.Window) ~= "number" or spec.Window <= 0 then
		return "Window (seconds) must be > 0"
	end
	if spec.Type == "Sequence" or spec.Type == "Alternate" then
		if type(spec.Actions) ~= "table" or #spec.Actions < 2 then
			return `{spec.Type} needs Actions = {"{"} "A", "B", ... {"}"}`
		end
	elseif type(spec.Action) ~= "string" then
		return `{spec.Type} needs an Action`
	end
	if (spec.Type == "Mash" or spec.Type == "Alternate") and (type(spec.Count) ~= "number" or spec.Count < 1) then
		return `{spec.Type} needs Count >= 1`
	end
	if spec.Type == "Hold" and (type(spec.Hold) ~= "number" or spec.Hold <= 0) then
		return "Hold needs Hold (seconds) > 0"
	end
	if spec.Type == "Hold" and spec.Hold > spec.Window then
		return "Hold is longer than the Window: it can never succeed"
	end
	if spec.Type == "Timing" then
		local target = (spec.Target or 0.75) * spec.Window
		if target <= 0 or target > spec.Window then
			return "Target must be in (0, 1]"
		end
	end
	if spec.Type == "Mash" and spec.Decay and spec.Count and spec.Decay * spec.Count >= Qte.MaxPressRate then
		return "Decay is faster than anyone can press: the meter can never fill"
	end
	return nil
end

-- The spec a player with `assist` actually plays.
function Qte.Effective(spec: Spec, assist: string?): Spec
	local out = table.clone(spec)
	if assist == "Easy" then
		out.Window = spec.Window * 1.5
		if spec.Count then
			out.Count = math.max(1, math.ceil(spec.Count * 0.6))
		end
		if spec.Hold then
			out.Hold = spec.Hold * 0.7
		end
		if spec.Decay then
			out.Decay = spec.Decay * 0.5
		end
		out.Perfect = (spec.Perfect or DEFAULT_PERFECT) * 1.5
		out.Good = (spec.Good or DEFAULT_GOOD) * 1.6
		if spec.Step then
			out.Step = spec.Step * 1.5
		end
	elseif assist == "Hold" and (spec.Type == "Mash" or spec.Type == "Alternate") then
		out.Type = "Hold"
		out.Action = spec.Action or (spec.Actions and spec.Actions[1])
		out.Hold = math.clamp((spec.Count or 10) * 0.1, 0.6, math.min(1.5, spec.Window * 0.8))
		out.Continuous = false
		out.Decay = nil
	end
	return out
end

function Qte.Start(spec: Spec, now: number, assist: string?): State
	local mode = assist or "Off"
	return {
		Spec = Qte.Effective(spec, mode),
		Start = now,
		Assist = mode,
		Status = "Pending",
		Grade = nil,
		Meter = 0,
		Index = 1,
		StepStart = now,
		HeldSince = nil,
		Held = 0,
		LastAction = nil,
		LastCounted = -math.huge,
		LastUpdate = now,
		Presses = 0,
		ResolvedAt = nil,
	}
end

local function resolve(state: State, status: Status, now: number, grade: string?)
	state.Status = status
	state.Grade = grade
	state.ResolvedAt = now
	state.HeldSince = nil
end

local function windowEnd(state: State): number
	return state.Start + state.Spec.Window
end

local function drain(state: State, now: number)
	local decay = state.Spec.Decay
	if decay and now > state.LastUpdate and state.Spec.Type ~= "Hold" then
		state.Meter = math.max(0, state.Meter - decay * (now - state.LastUpdate))
	end
	state.LastUpdate = math.max(state.LastUpdate, now)
end

local function heldNow(state: State, now: number): number
	return state.Held + (if state.HeldSince then math.max(0, now - state.HeldSince) else 0)
end

-- Advances time: drains meters, completes holds, expires windows. Returns the status.
function Qte.Update(state: State, now: number): Status
	if state.Status ~= "Pending" then
		return state.Status
	end
	local spec = state.Spec
	if state.Assist == "Auto" and now >= state.Start + math.min(Qte.AutoDelay, spec.Window * 0.3) then
		resolve(state, "Success", now, "Auto")
		return state.Status
	end
	if spec.Type == "Hold" then
		local total = heldNow(state, math.min(now, windowEnd(state)))
		state.Meter = math.clamp(total / (spec.Hold or 1), 0, 1)
		if total >= (spec.Hold or 1) - 1e-9 then
			resolve(state, "Success", now)
			return state.Status
		end
	else
		drain(state, math.min(now, windowEnd(state)))
	end
	if spec.Type == "Sequence" and spec.Step and now > state.StepStart + spec.Step then
		resolve(state, "Fail", now)
	elseif now > windowEnd(state) then
		resolve(state, "Fail", now)
	end
	return state.Status
end

local function countPress(state: State, now: number): boolean
	if now - state.LastCounted < 1 / Qte.MaxPressRate then
		return false
	end
	state.LastCounted = now
	state.Presses += 1
	return true
end

-- A button change. `action` is the logical action name; `down` true for press, false for release.
function Qte.Input(state: State, action: string, down: boolean, now: number): Status
	if now < state.Start then
		return state.Status -- pressed before the prompt: ignored, never punished
	end
	if Qte.Update(state, now) ~= "Pending" then
		return state.Status
	end
	local spec = state.Spec
	local kind = spec.Type

	if kind == "Hold" then
		if action ~= spec.Action then
			return state.Status
		end
		if down and not state.HeldSince then
			state.HeldSince = now
		elseif not down and state.HeldSince then
			state.Held = if spec.Continuous then 0 else state.Held + (now - state.HeldSince)
			state.HeldSince = nil
		end
		return Qte.Update(state, now)
	end

	if not down then
		return state.Status
	end

	if kind == "Press" then
		if action == spec.Action or spec.Action == "Any" then
			resolve(state, "Success", now)
		elseif spec.Strict then
			resolve(state, "Fail", now)
		end
	elseif kind == "Timing" then
		if action ~= spec.Action then
			if spec.Strict then
				resolve(state, "Fail", now)
			end
			return state.Status
		end
		local target = state.Start + (spec.Target or 0.75) * spec.Window
		local miss = math.abs(now - target)
		if miss <= (spec.Perfect or DEFAULT_PERFECT) then
			resolve(state, "Success", now, "Perfect")
		elseif miss <= (spec.Good or DEFAULT_GOOD) then
			resolve(state, "Success", now, "Good")
		else
			resolve(state, "Fail", now, if now < target then "Early" else "Late")
		end
	elseif kind == "Mash" then
		if action == spec.Action and countPress(state, now) then
			state.Meter = math.min(1, state.Meter + 1 / (spec.Count or 1))
			if state.Meter >= 1 - 1e-9 then
				resolve(state, "Success", now)
			end
		end
	elseif kind == "Alternate" then
		local actions = spec.Actions or {}
		if table.find(actions, action) and action ~= state.LastAction and countPress(state, now) then
			state.LastAction = action
			state.Meter = math.min(1, state.Meter + 1 / (spec.Count or 1))
			if state.Meter >= 1 - 1e-9 then
				resolve(state, "Success", now)
			end
		end
	elseif kind == "Sequence" then
		local actions = spec.Actions or {}
		if action == actions[state.Index] then
			state.Index += 1
			state.StepStart = now
			state.Meter = (state.Index - 1) / #actions
			if state.Index > #actions then
				resolve(state, "Success", now)
			end
		elseif spec.Strict ~= false then
			resolve(state, "Fail", now)
		end
	end
	return state.Status
end

-- What the prompt should draw.
export type View = {
	Remaining: number, -- 0..1 of the window left
	Meter: number, -- 0..1
	Ring: number, -- Timing: ring size, 1 at the start, 0 at the target (negative after it)
	Expected: string?, -- the action to press now
	Status: Status,
	Grade: string?,
}

function Qte.View(state: State, now: number): View
	local spec = state.Spec
	local remaining = math.clamp(1 - (now - state.Start) / spec.Window, 0, 1)
	local ring = 0
	if spec.Type == "Timing" then
		local targetTime = (spec.Target or 0.75) * spec.Window
		ring = 1 - (now - state.Start) / targetTime
	end
	local meter = state.Meter
	if spec.Type == "Hold" and state.Status == "Pending" then
		meter = math.clamp(heldNow(state, now) / (spec.Hold or 1), 0, 1)
	elseif spec.Decay and state.Status == "Pending" and spec.Type ~= "Hold" then
		meter = math.max(0, state.Meter - spec.Decay * math.max(0, now - state.LastUpdate))
	end
	local expected = spec.Action
	if spec.Type == "Sequence" then
		expected = (spec.Actions or {})[state.Index]
	elseif spec.Type == "Alternate" then
		local actions = spec.Actions or {}
		expected = if state.LastAction == actions[1] then actions[2] else actions[1]
	end
	return {
		Remaining = remaining,
		Meter = meter,
		Ring = ring,
		Expected = expected,
		Status = state.Status,
		Grade = state.Grade,
	}
end

-- Server side: the time to judge a press by. The client says when it pressed (on the shared
-- clock); trust it only within what the connection can explain: no later than arrival, no
-- earlier than arrival minus the allowed latency.
function Qte.JudgeTime(reported: any, received: number, allowedLatency: number): number
	if type(reported) ~= "number" or reported ~= reported then
		return received
	end
	return math.clamp(reported, received - allowedLatency, received)
end

return Qte
