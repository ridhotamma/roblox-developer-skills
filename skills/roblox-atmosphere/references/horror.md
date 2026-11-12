# Horror atmosphere

Horror is the genre where atmosphere *is* the game. Fear comes from anticipation, not from darkness: the player has to see enough to imagine what they can't see.

## Contents
1. What actually scares players
2. Readable darkness
3. Light as safety and resource
4. Sound does most of the work
5. Tension and release (pacing)
6. Monsters and threats
7. Scares: earned, rare, fair
8. Spaces and set dressing
9. Multiplayer horror
10. Audience, maturity and comfort
11. Kit recipes

---

## 1. What actually scares players
- **Uncertainty**: something might be there. Short sight lines, sounds without sources, doors that were closed.
- **Vulnerability**: limited light, limited stamina, nowhere obvious to hide, the monster is faster.
- **Anticipation**: the build-up is scarier than the reveal. Keep the monster unseen for as long as possible.
- **Wrongness**: familiar places made slightly off (liminal spaces, a school at night, a room that repeats).
Pure darkness, gore and constant jumpscares are *not* on this list; they numb players quickly.

## 2. Readable darkness
The most common horror failure on Roblox: a black screen. Players can't navigate, so they leave, especially on phones in daylight.

- **Silhouettes against fog.** At night, make the fog (`Atmosphere.Color`) slightly *brighter* than the geometry. Trees, doorframes and the monster read as dark shapes against grey-blue haze. `horror_woods` does this.
- **Never zero fill outdoors.** OutdoorAmbient around (35-45, 40-45, 55-60) at night keeps the ground readable; desaturate and darken with the grade instead of killing ambient.
- **Interiors may be near-black only if the player has a light.** `horror_interior` is built around a flashlight. Without one, keep Ambient ≥ (20,20,25) and add moonlit windows.
- **Lead with light.** Place a lit doorway, a flickering exit sign, a window at the end of the corridor: players move toward light, so you control the route without arrows.
- **Test at graphics quality 1 on a phone.** Future-lighting shadows and point-light detail drop; ambient and fog are what's left.
- The lab's "Mean brightness" check: below ~7% the scene relies entirely on placed lights.

## 3. Light as safety and resource
- **Warm = safe, cold = danger.** Safe rooms, checkpoints, the lobby: warm accent light, a soft sound bed, Saturation back toward normal. Danger zones: cold, desaturated, quiet.
- **Flashlight:** a SpotLight in the character's head or a held tool. Angle 45-60, Range 40-60, Brightness 2-4, warm white (255,230,200), Shadows on (only on this one light, it's the hero). Battery drain plus flicker when low is a whole game mechanic.
- **Lights failing** is the cheapest scare: tag a corridor's lights `Flicker` with `Style = "Broken"` when the monster is near (set the attribute from your AI), or switch the zone preset to a darker one.
- **Lights that come back** are the release. A breaker puzzle that restores light is both a goal and a breather.

## 4. Sound does most of the work
- **Bed:** a low drone, wind, or room tone, never silence-silence. Changing the bed between zones tells players "this place is different" before they see anything.
- **Details:** creaks, distant footsteps, a door, a whisper, played at random 3D points 25-70 studs away (`Ambience` details). The brain tries to locate them; that's the dread.
- **Silence as a signal:** duck the ambience when the monster is close (`Tension` does this). The world going quiet is scarier than a stinger.
- **Telegraph the monster by sound first:** a unique footstep, breathing or music cue the player learns. Sound that tells players where it is makes the game fair and scarier (they hear it coming).
- **Reverb:** Hallway, StoneCorridor, Room for interiors; Forest for woods. Matching reverb makes footsteps feel like they're really in the space.
- **Stingers:** short, loud, rare. Pair with a real event (something actually appears), never random noise.

## 5. Tension and release (pacing)
Horror needs rhythm: **calm → unease → dread → peak → release**. Without release, fear flattens into annoyance.

- **Director pattern:** keep a tension budget. After a peak (chase, scare), force a cooldown of 60-120 s: no monster near, ambience back, maybe a safe room. Build again with details, a light failing, a distant sound.
- **Drive `Tension` from gameplay:** monster distance, line of sight, the player being chased. Map it smoothly; Tension has its own smoothing.
- **Escalate across a session:** early areas = mostly atmosphere and sounds; middle = the monster appears at a distance; late = chases. Don't spend the reveal in minute one.
- **Rounds-based horror (one monster vs survivors):** lobby (`cozy_*` or warm interior) → round start (blend to the horror preset over 5-10 s with a sound sweep) → last survivor (fog thickens, Tension floor rises) → round end (release to warm).

## 6. Monsters and threats
- **Readable but not clear:** the monster should be identifiable as a shape and by its sound; details stay hidden. Dark body, maybe glowing eyes (a small Neon part or a PointLight with Range 4).
- **Telegraph before damage:** sound cue → visible shape → attack wind-up. A monster that kills from the dark without a cue feels like a bug. (See `roblox-combat` for telegraph and enemy AI patterns.)
- **Let fog do the reveal:** a monster walking out of fog toward the player is the genre's best shot. Fog Density 0.4-0.5 gives a 30-50 stud reveal distance; tune it to the monster's speed so the player gets 2-4 seconds to react.
- **Chase atmosphere:** on chase start, `Tension.Pulse(1, 3)`, swap ambience to chase music, maybe narrow FOV slightly. On escape, let tension decay naturally.

## 7. Scares: earned, rare, fair
- **Rare:** one strong scare per 5-10 minutes beats one per minute.
- **Earned:** after build-up (quiet, a sound, a pause). The silence before matters as much as the scare.
- **Fair:** the scare shouldn't kill without a chance. A scare that just startles is fine; a scare that costs progress needs a warning.
- **No hard flashes:** a white full-screen flash is a photosensitivity risk and cheap. Use darkness, a sudden sound, the monster in the flashlight. If you flash, keep it under 3 per second and respect Reduce Flashing.
- **Per-player scares** (a face in the window only you see): `AtmosphereService:SetPlayerPreset(player, "scare_moment")` for a beat, then clear it.

## 8. Spaces and set dressing
- **Familiar made wrong:** schools, houses, hospitals, malls, playgrounds at night; repeated rooms; rooms slightly too large; furniture in the wrong place.
- **Sight lines:** corridors that turn, doorways into darkness, windows at night, stairs going down. Every corner is a question.
- **Liminal spaces:** flat even lighting, yellowed or fluorescent, hum, carpet, no people, no exits in sight; the horror is emptiness. `liminal` preset; Fluorescent flicker on one light out of many.
- **Environmental storytelling:** notes, barricaded doors, drag marks, a lit candle someone left. They make players imagine the threat.
- **Map edges:** fog hides them; never let players see the map end.

## 9. Multiplayer horror
- Groups dilute fear: give reasons to split (separate objectives, small hiding spots, one flashlight per player).
- **Proximity matters:** keep voice/proximity chat-friendly spaces; sound cues should be positional so teammates hear different things.
- **Spectating dead players** still get the atmosphere (keep their camera in the zone presets).
- Hide-and-seek / asymmetric: the hunter can get a different preset (clearer sight, red tint) via `SetPlayerPreset`, so both sides have a distinct experience.

## 10. Audience, maturity and comfort
- Roblox's audience skews young, and horror games are popular with them. Fill out the Maturity & Compliance questionnaire honestly: strong or frequent fear content, blood or realistic violence raises the content label, which limits who can find and play the game. Check Roblox's current guidelines; keep gore out and let atmosphere carry the fear.
- Thumbnails and icons must follow the same rules.
- Offer: Reduce Flashing (the kit respects it), a brightness/gamma slider (adjust `ExposureCompensation` locally via a small offset you apply on the client after presets, or a separate ColorCorrection Brightness), master and ambience volume sliders.
- Mobile: test brightness outdoors; consider a slightly brighter preset variant for touch devices (`UserInputService.TouchEnabled` and no keyboard → +0.2 exposure).

## 11. Kit recipes

**Monster proximity → tension**
```lua
-- client, e.g. in a HorrorController
local Tension = require(script.Parent.Parent.Atmosphere.Tension)
RunService.Heartbeat:Connect(function()
	local monster = workspace:FindFirstChild("Monster")
	local root = player.Character and player.Character:FindFirstChild("HumanoidRootPart")
	if monster and root then
		local distance = (monster:GetPivot().Position - root.Position).Magnitude
		Tension.Set(1 - math.clamp((distance - 15) / 60, 0, 1))
	else
		Tension.Set(0)
	end
end)
```

**Lights fail near the monster** (server, inside the monster AI's step)
```lua
for _, lamp in CollectionService:GetTagged("Flicker") do
	local near = (lamp:GetPivot().Position - monsterPosition).Magnitude < 40
	lamp:SetAttribute("Style", if near then "Broken" else "Fluorescent")
end
```
The attribute replicates and LightFlicker picks up the new style live. Server-side distance checks every 0.5 s are plenty.

**Round flow**
```lua
-- server
AtmosphereService:SetPreset("cozy_morning")     -- lobby
AtmosphereService:SetPreset("horror_woods")     -- round start; clients blend over TransitionSeconds
AtmosphereService:SetPreset("horror_interior")  -- generator fails: blackout for everyone
AtmosphereService:SetPreset(nil)                -- back to DefaultPreset
```

**Safe room**: a zone part with `Preset = "cozy_night"` (or a custom warm interior), `Priority = 10`, `TransitionSeconds = 1.5`. Entering it is the release.
