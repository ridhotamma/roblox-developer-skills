# Impacts: cars, falls, explosions

Knocking a character down because the world hit it, whatever it was doing at the time.

## 1. It works from any animation

Nothing special is needed for "mid-run". Disabling a Motor6D stops the Animator's pose from being applied to that joint; the track keeps playing unseen. The body keeps the velocity it had, the launch is added, and when the motors come back the run (or idle) is simply visible again under the get-up blend.

## 2. Vehicles and other impactors

Tag anything that should run characters over: `Vehicle` (the `roblox-vehicles` kit's cars already are) or `Impactor` (boulders, swinging hammers, trains, minecarts). Models need a `PrimaryPart`; single parts work as they are.

`ImpactService` checks 15 times a second:

1. Skip impactors that are anchored or slower than `MinSpeed`. Parked cars cost nothing.
2. Take the impactor's bounding box and stretch it along its velocity to cover the distance it will travel before the next check, plus `Padding`.
3. `GetPartBoundsInBox` with an **include** filter of registered characters only. Map geometry is never tested.
4. For each character found: skip seated ones (drivers and passengers), skip those hit within `Cooldown`.
5. Compute the **closing speed**: the relative velocity along the line from the impactor to the character. A car driving alongside a runner at the same speed has a closing speed near zero and doesn't knock them down; a car reversing into someone at 25 studs/s does.
6. At or above `MinSpeed`: ragdoll for `Seconds`, launch, optional damage, fire `ImpactService.Hit`.

### Why not `Touched`

`Touched` on a fast car fires late or not at all (tunnelling), fires dozens of times per contact, and depends on which machine simulates which part. A predictive sweep is deterministic, server-side and cheaper.

### Launch maths

```
launch = relativeVelocity × Transfer  +  up × closingSpeed × Lift
```

| Setting | Default | Feel |
|---|---|---|
| `MinSpeed` | 22 studs/s (about 22 km/h at 0.28 m per stud) | Below this the car just pushes the walking Humanoid |
| `Transfer` | 0.85 | 1 = carried at the car's speed; 0.5 = heavy thud, short flight |
| `Lift` | 0.3 | 0.15 = swept under; 0.5 = cartoon launch over the roof |
| `Seconds` | 2.5 | Minimum time down |
| `DamagePerSpeed` | 0.7 per stud/s over `MinSpeed` | 60 studs/s hit ≈ 27 damage; lethal near 165 |
| `MaxLaunch` | 160 studs/s | Hard cap (shared with every launch) |

The character's own velocity is kept, so being hit from behind while sprinting adds up, and a head-on hit partly cancels.

Use `ImpactService.Hit:Connect(function(character, impactor, closingSpeed) ...)` for hit sounds, wanted levels, score, or slowing the car down (apply an opposing impulse on the driver's client through the vehicles kit).

### Pedestrian NPCs

Tag them `Ragdollable`. They are server-owned, so their reaction has no network delay. For crowds, keep `MaxActive` in mind and remove bodies quickly.

## 3. Falls

A landing is detected as "was falling faster than `Fall.Speed` at the last check, and has now stopped". Default 85 studs/s is a drop of about 18 studs under Roblox gravity (`v = √(2 × 196.2 × height)`):

| Drop | Landing speed |
|---|---|
| 10 studs | 63 studs/s |
| 18 studs | 84 studs/s |
| 30 studs | 108 studs/s |
| 50 studs | 140 studs/s |

Obbies and parkour games usually want this off or very high. Survival and realism games pair it with `DamagePerSpeed`. A landing roll (a short authored animation when the player holds crouch on landing) is a good skill-based way to avoid it.

## 4. Other triggers

Everything else is one call from the server code that owns the event:

```lua
-- Explosion: push away from the centre, stronger when closer.
local offset = root.Position - center
local falloff = math.clamp(1 - offset.Magnitude / radius, 0, 1)
RagdollService:Ragdoll(character, {
	Seconds = 1.5 + 1.5 * falloff,
	Velocity = (offset.Unit + Vector3.new(0, 0.6, 0)) * 90 * falloff,
})

-- Tackle or shoulder charge.
RagdollService:Ragdoll(victim, { Seconds = 1.8, Velocity = attackerRoot.CFrame.LookVector * 45 + Vector3.new(0, 15, 0) })

-- Shot off a ledge: flinch only, unless they are already falling.
-- Slippery floor, banana peel, trip wire: no velocity, the body's own momentum does the work.
RagdollService:Ragdoll(character, { Seconds = 1.2 })
```

Don't use Roblox `Explosion` instances with `BlastPressure` on ragdolls: they push per part and tear limbs in different directions. Set `BlastPressure = 0`, find characters in radius yourself, and launch through the service.

## 5. Latency and prediction

A player's body is simulated on that player's client. The path for a car hit is: driver's client → server sees the car → server detects → victim's client ragdolls. That is roughly the two players' pings added together, typically 100–250 ms.

What covers it:
- The car's collision hull physically shoves the standing Humanoid on the victim's client immediately, so there is motion from the first frame; the ragdoll then takes over.
- The sweep looks one interval ahead, which hides part of the delay.
- Raising `Rate` to 30 halves the server's share for a small cost.

If it still reads late (high-speed racing with pedestrians), the victim's client can predict: detect the same closing-speed condition locally against `Vehicle`-tagged models, start a local launch at once, and let the server's ragdoll confirm it. Never let the client *decide* the hit or the damage; prediction is cosmetic and the server's result wins.

## 6. Security and abuse

- Ragdolling is server-triggered only. There is no client → server remote in this kit; don't add a "ragdoll me" remote without a rate limit, and never a "ragdoll them" one.
- Launch velocity is capped, and values the client receives are type- and NaN-checked before use.
- With `roblox-security` installed, `AntiCheatService:Grant` covers the flight and the get-up; without it, make sure speed and fly checks skip characters whose `RagdollState` isn't `"None"`. Exploiters can't set that attribute for the server, so it is safe to read there.
- Griefing: in social games, cars that knock players down are a harassment tool. Options: only above a high `MinSpeed`, no knockdown inside safe zones (check before calling `Ragdoll`), a short immunity after getting up, or no damage.
- Knockdown chains in PvP: give 0.5–1 s of immunity after recovery (`RagdollService.Recovered` is the hook).
