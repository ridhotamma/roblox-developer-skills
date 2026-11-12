--!strict
-- The shape of a player's saved data, and the defaults for new players.
-- ProfileStore's Reconcile() fills in any field an older save is missing, so ADDING a field
-- is safe. RENAMING or changing a field's type needs a migration in DataService.

return table.freeze({
	Coins = 0,
	LastDailyClaim = 0, -- os.time() of the last claim; 0 = never
})
