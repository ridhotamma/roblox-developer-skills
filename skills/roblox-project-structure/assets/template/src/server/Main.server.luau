--!strict
-- The only server Script. Loads every Service, runs Init then Start, then binds Components.

local ReplicatedStorage = game:GetService("ReplicatedStorage")

local Component = require(ReplicatedStorage.Shared.Util.Component)
local Loader = require(ReplicatedStorage.Shared.Util.Loader)

Loader.Start(Loader.RequireChildren(script.Parent.Services), "Service")
Component.BindFolder(script.Parent.Components)
