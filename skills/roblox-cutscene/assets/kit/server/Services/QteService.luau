--!strict
-- Decides quick-time events. The client shows the prompt and predicts the result for instant
-- feedback; this service runs the same Qte state machine on the server's copy of the inputs and
-- its word is final.
--
-- Fair over a real connection:
--   * a press is judged at the time the client says it happened, but only within what its ping
--     can explain (Qte.JudgeTime: never later than arrival, never older than the allowed latency)
--   * the window closes CutsceneConfig.Qte.Grace late on the server, for packets still in flight
--   * presses are capped at Qte.MaxPressRate, so auto-clickers gain nothing over fast fingers
--   * the player's assist mode (Off / Easy / Hold / Auto) is applied here, not trusted per QTE
--
-- Use it inside scenes (CutsceneService does) or on its own for gameplay QTEs:
--   local id = QteService:Begin(player, spec, { OnResult = function(status, grade) ... end })
--   local status, grade = QteService:Run(player, { Type = "Mash", Action = "Struggle", Window = 3, Count = 12 })

local Players = game:GetService("Players")
local ReplicatedStorage = game:GetService("ReplicatedStorage")
local RunService = game:GetService("RunService")

local CutsceneConfig = require(ReplicatedStorage.Shared.Cutscene.CutsceneConfig)
local Net = require(ReplicatedStorage.Shared.Net)
local Qte = require(ReplicatedStorage.Shared.Cutscene.Qte)
local Signal = require(ReplicatedStorage.Packages.Signal)

export type StartOptions = {
	Start: number?, -- server time the window opens (default: now + Lead)
	Id: string?,
	Anchor: Instance?, -- a part or attachment the prompt sits on
	OnResult: ((status: string, grade: string?) -> ())?,
}

type Session = {
	Id: string,
	Player: Player,
	State: Qte.State,
	OnResult: ((status: string, grade: string?) -> ())?,
}

local QteService = {
	Resolved = Signal.new(), -- (player: Player, id: string, status: string, grade: string?)
}

local sessions: { [string]: Session } = {}
local startEvent: RemoteEvent
local resultEvent: RemoteEvent
local counter = 0

local function assistOf(player: Player): string
	local mode = player:GetAttribute("QteAssist")
	return if type(mode) == "string" and table.find(Qte.Assists, mode) then mode else CutsceneConfig.Qte.DefaultAssist
end

local function finish(session: Session)
	sessions[session.Id] = nil
	local state = session.State
	if session.Player.Parent then
		resultEvent:FireClient(session.Player, session.Id, state.Status, state.Grade)
	end
	QteService.Resolved:Fire(session.Player, session.Id, state.Status, state.Grade)
	if session.OnResult then
		task.spawn(session.OnResult, state.Status, state.Grade)
	end
end

-- Starts a QTE for one player. Returns its id.
function QteService:Begin(player: Player, spec: Qte.Spec, options: StartOptions?): string
	local opts = options or {}
	local problem = Qte.Validate(spec)
	assert(problem == nil, `bad QTE spec: {problem}`)
	counter += 1
	local id = opts.Id or `qte{counter}`
	local start = opts.Start or (workspace:GetServerTimeNow() + CutsceneConfig.Qte.Lead)
	local assist = assistOf(player)
	local session: Session = {
		Id = id,
		Player = player,
		State = Qte.Start(spec, start, assist),
		OnResult = opts.OnResult,
	}
	sessions[id] = session
	startEvent:FireClient(player, id, spec, start, assist, opts.Anchor)
	return id
end

-- Starts a QTE and waits for the result. Yields.
function QteService:Run(player: Player, spec: Qte.Spec, options: StartOptions?): (string, string?)
	local thread = coroutine.running()
	local opts: StartOptions = table.clone(options or {})
	opts.OnResult = function(status: string, grade: string?)
		task.spawn(thread, status, grade)
	end
	self:Begin(player, spec, opts)
	return coroutine.yield()
end

-- Drops a QTE without a result (the scene ended or branched another way).
function QteService:Cancel(id: string)
	local session = sessions[id]
	if session then
		sessions[id] = nil
		if session.Player.Parent then
			resultEvent:FireClient(session.Player, id, "Cancelled", nil)
		end
	end
end

function QteService:Init()
	startEvent = Net.Event("QteStart")
	resultEvent = Net.Event("QteResult")
end

local function allowedLatency(player: Player): number
	local ok, ping = pcall(function()
		return player:GetNetworkPing()
	end)
	local base = CutsceneConfig.Qte.BaseLatency + (if ok and type(ping) == "number" then ping else 0.1)
	return math.min(CutsceneConfig.Qte.MaxLatency, base)
end

function QteService:Start()
	Net.Handle("QteInput", 60, function(player: Player, id: unknown, action: unknown, down: unknown, time: unknown)
		if type(id) ~= "string" or type(action) ~= "string" or type(down) ~= "boolean" then
			return
		end
		local session = sessions[id]
		if not session or session.Player ~= player then
			return
		end
		if CutsceneConfig.Actions[action] == nil then
			return
		end
		local now = workspace:GetServerTimeNow()
		local judged = Qte.JudgeTime(time, now, allowedLatency(player))
		Qte.Input(session.State, action, down, judged)
		if session.State.Status ~= "Pending" then
			finish(session)
		end
	end)

	Net.Handle("QteAssist", 2, function(player: Player, mode: unknown)
		if type(mode) == "string" and table.find(Qte.Assists, mode) then
			player:SetAttribute("QteAssist", mode)
		end
	end)

	Players.PlayerRemoving:Connect(function(player)
		for id, session in sessions do
			if session.Player == player then
				sessions[id] = nil
			end
		end
	end)

	RunService.Heartbeat:Connect(function()
		local judgeAt = workspace:GetServerTimeNow() - CutsceneConfig.Qte.Grace
		for _, session in sessions do
			if Qte.Update(session.State, judgeAt) ~= "Pending" then
				finish(session)
			end
		end
	end)
end

return QteService
