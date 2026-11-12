--!strict
-- The only client LocalScript. Loads every Controller, runs Init then Start, then binds Components.

if not game:IsLoaded() then
	game.Loaded:Wait()
end

local ReplicatedStorage = game:GetService("ReplicatedStorage")

local Component = require(ReplicatedStorage.Shared.Util.Component)
local Loader = require(ReplicatedStorage.Shared.Util.Loader)

Loader.Start(Loader.RequireChildren(script.Parent.Controllers), "Controller")
Component.BindFolder(script.Parent.Components)
