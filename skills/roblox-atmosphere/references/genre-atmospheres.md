# Genre atmospheres

For each genre: the **mood sentence** to aim for, the **preset(s)** to start from, the **light plan**, **fog** (how far the player should see), **palette**, **weather**, **sound**, and the mistakes that break it. Values are in `assets/presets.json`; tweak, don't copy blind.

How to read the light plan: *key* = the main light (sun, moon or the dominant practical light), *fill* = Ambient / OutdoorAmbient (what shadows look like), *accent* = practical lights that lead the eye.

## Contents
1. Horror family (night woods, fog, interiors, liminal)
2. Cozy, simulator, pet and roleplay
3. Obby, tycoon, minigames
4. Adventure, open world, racing
5. Fantasy and RPG
6. Dungeon, cave, mining
7. Sci-fi interior and space
8. Cyberpunk and night city
9. Post-apocalyptic, zombie, survival, storms and disasters
10. Desert and western
11. Arctic and winter
12. Underwater and ocean
13. Tropical and vacation
14. Battlegrounds, fighting, PvP
15. FPS, tactical, extraction
16. Mystery, noir, murder mystery
17. Seasonal events
18. Anime and stylized
19. Variants: one map, many moods

---

## 1. Horror family
Full design guide in `horror.md`. Quick picks:

| Sub-genre | Preset | Mood sentence | Fog / sight |
|---|---|---|---|
| Night woods, chase | `horror_woods` | Moonlit dread; lantern light is the only warm thing. | 30-60 studs readable, treeline dissolves |
| Fog town, psychological | `horror_fog` | Grey silence; daylight that doesn't help. | 20-40 studs, shapes before details |
| House, hospital, school, hide-and-seek | `horror_interior` | Near-black; your flashlight is your world. | Interior; light is the limit, not fog |
| Liminal / backrooms-like / poolrooms | `liminal` | Too bright, too empty, humming. | Long corridors fading to haze |
| Survival horror outdoors by day | `storm` | Oppressive weather, lightning reveals. | 60-100 studs |

Shared rules: fog slightly brighter than silhouettes so threats read as shapes; warm accent = safety; desaturate (Saturation -0.3 to -0.6); sound does most of the scaring.

## 2. Cozy, simulator, pet, roleplay
- **Presets:** `cozy_morning` (base), `cozy_night` (night that stays friendly), `golden_hour` (dusk transition). Ideal for a day/night cycle: the default `DayNight.Phases` uses these.
- **Mood:** warm, soft, safe; a world you want to idle in.
- **Light plan:** key = soft warm sun (ClockTime 8-10 or 16-17), ShadowSoftness 0.5-0.8; fill = warm grey-beige OutdoorAmbient (140-160) so shadows are never dark; accent = warm windows, string lights, lanterns.
- **Fog:** light haze (Density 0.25-0.35, Haze 1-2) that softens the far map and hides pop-in. Never heavy.
- **Palette:** pastels, Saturation +0.1 to +0.2, warm tint (255,245,232).
- **Weather:** none, light snow in winter, fireflies at night.
- **Sound:** birds, gentle wind, distant water; crickets at night. Soft reverb (Plain/Forest). Music light and looping.
- **Mistakes:** pure-white noon lighting (looks default), dark nights that make players leave (cozy nights must stay readable: OutdoorAmbient around (90,100,150), ExposureCompensation +0.3), bloom so strong UI-like objects glow.

## 3. Obby, tycoon, minigames
- **Preset:** `cartoon_day`.
- **Mood:** clean, bright, saturated; zero ambiguity.
- **Light plan:** high sun (ClockTime 12-14), Brightness ~3, high neutral fill so every platform's top and side read; ShadowMap is enough (and cheaper) on big maps.
- **Fog:** minimal (Density 0.2-0.25); players must see the next jumps and the goal.
- **Palette:** strong primaries for interactive parts, desaturated or neutral backgrounds so platforms pop; kill bricks a unique colour (red/neon) that nothing decorative uses.
- **Sound:** light breeze bed, upbeat music, satisfying UI and checkpoint sounds matter more than ambience.
- **Mistakes:** decorative bloom and sun rays that wash out platform edges; sunset lighting that makes platforms silhouette; fog that hides the next stage. Themed obby stages can each use a zone with a different preset (lava stage, ice stage, space stage) - keep readability per stage.

## 4. Adventure, open world, racing
- **Presets:** `golden_hour` (hero look), `cartoon_day` or `desert_noon` (gameplay hours), `storm` (events).
- **Mood:** wonder and scale; the vista is the reward.
- **Light plan:** low sun for long shadows and rim light on terrain; strong ColorShift_Top warm and a cooler ambient for depth.
- **Fog:** aerial perspective is everything: Density 0.3-0.35, Haze 1.5-2, Glare 1+ toward the sun. Distant mountains should go blue-hazy; that's what makes the world look big.
- **Racing:** keep the road readable at speed: less fog, no DOF, sun behind the camera on the main straight; use SunRays sparingly (blinding on curves).
- **Weather:** dynamic weather sells open worlds; blend presets with zones or a scheduled server `SetPreset`.
- **Sound:** wind with altitude, birds in valleys, water near rivers via zones with their own ambience.

## 5. Fantasy and RPG
- **Presets:** `fantasy_forest` (enchanted), `golden_hour` (overworld), `dungeon` (caves), `cozy_morning` (villages).
- **Mood:** magical, inviting, slightly unreal colour.
- **Light plan:** teal or violet fill with warm god rays (SunRays 0.2-0.3, Spread 0.8-1); bioluminescent accents (cyan, mint, magenta Neon) in shadowed areas.
- **Fog:** coloured haze (Atmosphere.Color tinted, not grey) is the fastest way to "magic".
- **Weather:** spores or fireflies; embers near forges or volcanoes.
- **Sound:** layered forest with chimes or shimmer details; reverb Forest; towns warmer with crowd murmur.
- **Mistakes:** every colour at once. Pick one magic hue per region (Forest = teal, Swamp = green-yellow, Crystal cave = violet) so regions are recognisable at a glance.

## 6. Dungeon, cave, mining
- **Preset:** `dungeon`.
- **Mood:** pitch black stone, warm pools of light, safety lives in light.
- **Light plan:** Brightness 0 (no sun underground), very low warm-grey Ambient (15-25), torches as PointLights (Range 12-20, warm orange, Shadows on for a few hero torches only), Candle flicker.
- **Fog:** dark warm fog (Density 0.35-0.45) so corridors fade to black instead of ending visibly.
- **Readability:** ore, chests, exits get their own coloured light or Neon; enemies get a rim or glowing eyes.
- **Sound:** drips, distant rumbles, Cave reverb (huge contribution for almost no work).
- **Mistakes:** Ambient so low that a phone at low quality sees nothing (Future lights fall back); test at graphics quality 1.

## 7. Sci-fi interior and space
- **Presets:** `scifi_lab` (stations, labs), `space` (vacuum exterior; needs a starfield skybox).
- **Sci-fi interior mood:** sterile precision. High cool-white Ambient, glossy floors (EnvironmentSpecularScale 1), cyan accent strips, low haze.
- **Space mood:** no air means **no fog** (Density 0), hard shadows (ShadowSoftness 0), near-black fill and a blinding key light. The contrast is the look.
- **Alarm/emergency variant:** copy `scifi_lab`, drop Ambient to near black, red accent, `Pulse` flicker on red lights, Hangar reverb with an alarm bed: make it a zone or a server `SetPreset` during an event.
- **Sound:** station hum, vents, distant machinery; in space: silence or suit sounds (breath, radio), not explosions.

## 8. Cyberpunk and night city
- **Preset:** `cyberpunk_night`.
- **Mood:** dark but saturated; neon bleeding into haze.
- **Light plan:** low Brightness, purple-blue fill, magenta and cyan Neon accents, wet ground (EnvironmentSpecularScale 1 plus reflective materials) to double every light.
- **Fog:** coloured (purple), Decay toward magenta, Haze 2+; Bloom high (Intensity 1, low Threshold ~0.9) because neon is the subject.
- **Weather:** rain (the reflections sell it). City/Alley reverb, rain on surfaces, distant traffic and sirens.
- **Mistakes:** too many neon colours (pick 2), bloom so strong signs become blobs (raise Threshold), streets too dark to navigate (add streetlamps).

## 9. Post-apocalyptic, zombie, survival, storms and disasters
- **Presets:** `wasteland` (dust), `storm` (weather), `horror_woods` (night survival), `arctic_blizzard`.
- **Mood:** hostile world, drained colour, the environment is an enemy.
- **Light plan:** desaturated (Saturation -0.3 to -0.4), dusty warm haze or cold grey overcast; the player's base/campfire gets the only warm saturated light (makes building a base feel like progress).
- **Fog:** heavy and coloured (orange dust, grey storm); vary it with weather events to change how far players can scout.
- **Disaster games:** the atmosphere change is the telegraph: tween to `storm` or a custom preset 10-20 s before the disaster hits, with sound first. Server: `AtmosphereService:SetPreset("storm")`.
- **Sound:** wind, debris, distant thunder, creaking metal; music sparse.

## 10. Desert and western
- **Presets:** `desert_noon` (harsh heat), `western_dusk` (showdown).
- **Desert:** overexposed (ExposureCompensation +0.25), hard short shadows, pale hazy sky with glare; heat is communicated by brightness, not colour.
- **Western dusk:** sun on the horizon (ClockTime ~18), red-orange sky, long silhouettes, Glare 1.5+, dust.
- **Sound:** wind, distant birds of prey, tumbleweed details; Mountains reverb; sparse guitar music.

## 11. Arctic and winter
- **Presets:** `arctic_blizzard` (survival), `winter_holiday` (event, cozy).
- **Blizzard:** white-out fog (Density 0.6+, Haze 4), cold blue tint, desaturated, wind-driven snow; the warm accent of a shelter or fire is the reward.
- **Holiday:** blue hour (ClockTime ~18.8), gentle snow, warm string lights, bloom up (Intensity 0.8) so lights glow.
- **Snow ground** is bright: lower ExposureCompensation if it clips, keep players' clothing darker than snow for contrast.

## 12. Underwater and ocean
- **Preset:** `underwater` (as a zone below the water surface, or `SetOverride` while the camera is submerged).
- **Mood:** blue-green murk, light from above.
- **Light plan:** teal fill, sun rays strong (they read as caustic shafts), dense coloured fog (0.6-0.75) so visibility is short, DOF far blur, bubbles.
- **Sound:** muffled bed, UnderWater reverb, bubbles; muffle all other sounds (EqualizerSoundEffect HighGain -20 on the master/ambience group while submerged).
- **Swap trigger:** check `workspace.CurrentCamera.CFrame.Position` against the water height (or Terrain:ReadVoxels for terrain water) every few frames and call `AtmosphereController:SetOverride("underwater", 0.3)` / `SetOverride(nil, 0.3)`.

## 13. Tropical and vacation
- **Preset:** `tropical_beach`.
- **Mood:** airy, saturated, turquoise and white sand.
- **Light plan:** high sun, high fill, Saturation +0.3, light airy haze (Offset 0.2) so the sea horizon softens.
- **Sound:** waves, gulls, palm rustle; music laid-back.

## 14. Battlegrounds, fighting, PvP
- **Preset:** `arena_competitive`.
- **Mood:** the atmosphere's job is to disappear. Neutral, high contrast, low fog.
- **Rules:** players and attacks must read against every background: no heavy bloom (Threshold 2+), no DOF, no dense fog in fight ranges, no sun at the horizon (glare blinds one team). VFX supply the colour; the map stays neutral so effects pop.
- **Variety:** use different maps or ClockTime for variety, not different readability. A sunset arena is fine if the sun sits behind a wall.
- **Sound:** light ambience (crowd, wind); combat sounds dominate. Arena reverb.

## 15. FPS, tactical, extraction
- **Preset:** `tactical_overcast`.
- **Mood:** grounded and serious; flat soft light.
- **Rules:** soft shadows (ShadowSoftness 0.8) so players hiding in shadow are not invisible, muted palette, fog only beyond engagement range (keep Density ≤ 0.35), no SunRays/DOF. Night maps: give players NVG/flashlight gameplay rather than making the map dark for everyone.
- **Sound:** City/ParkingLot reverb matters for gunshot feel; distant combat details in the ambience.

## 16. Mystery, noir, murder mystery
- **Preset:** `noir_rain`.
- **Mood:** near black-and-white, hard contrast, one warm lamp.
- **Light plan:** Saturation -0.85, Contrast +0.3, strong pools of light from streetlamps, wet reflective streets, rain.
- **Murder mystery games:** players must recognise each other: keep character colours readable (don't go fully monochrome; -0.6 instead) and keep ambient high enough indoors. Use a darker preset only during a "lights out" event.
- **Sound:** rain, distant city, a lonely saxophone or piano; Alley reverb.

## 17. Seasonal events
- **Presets:** `halloween_event`, `winter_holiday`.
- **Halloween (spooky-cute):** purple night, orange pumpkin glow, big moon (MoonAngularSize 20+), saturated (+0.3), fireflies as wisps. Scary for a 9-year-old, not a horror game; no stingers, no Tension.
- **Winter holiday:** see §11.
- **Other events:** start from the base preset and change three things: Accent colour (event colour), Grade.TintColor (subtle event tint), one weather type. Players recognise the event without the game becoming a different game. Ship as a server `SetPreset` toggled by the event schedule.

## 18. Anime and stylized
- Start from `cartoon_day` or `fantasy_forest`: Saturation +0.25 to +0.35, Contrast +0.1, a pastel sky, soft shadows, bloom on highlights (Threshold ~1.2), SunRays for drama.
- Cel-shaded looks come from materials and textures, not Lighting; keep EnvironmentSpecularScale low (0.2-0.4) so plastic doesn't look glossy-realistic.

## 19. Variants: one map, many moods
A map gets years of use from a few presets:
- **Time of day:** same preset family at ClockTime 8 / 13 / 17.5 / 22 (`cozy_morning`, `cartoon_day`, `golden_hour`, `cozy_night`).
- **Weather states:** base, overcast (+Clouds cover, -Brightness, -Saturation), storm.
- **Event overrides:** Accent + tint + weather.
- **Story beats:** the "lights go out" moment (`horror_interior`), the boss arrival (fog colour shifts red, Contrast up), victory (golden hour).
Name the variants after the gameplay state (`lobby`, `round_night`, `boss`) in `AtmospherePresets.luau` so code reads well: `AtmosphereService:SetPreset("boss")`.
