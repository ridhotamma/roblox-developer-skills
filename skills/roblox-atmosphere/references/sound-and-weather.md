# Sound and weather

## Contents
1. Ambience layers
2. Reverb by space
3. Music states
4. Finding audio: Creator Store search terms
5. Weather design
6. Wind, lightning, shelter
7. Budgets and settings

---

## 1. Ambience layers
A finished-sounding place has three layers:
1. **Bed** (looping, 2D, quiet): wind, room tone, forest, city hum. Sets the space. `Ambience` crossfades it between presets.
2. **Details** (one-shots in 3D, random, 25-70 studs away): birds, drips, creaks, distant dogs, a door. Make the world feel alive and, in horror, inhabited. `Ambience` plays them at random points around the player.
3. **Sources** (placed by hand, 3D, looping): a waterfall, a generator, a radio, a fire. Parent a looped Sound to a part; RollOffMaxDistance 40-120.

Rules:
- Bed volume 0.3-0.5; details 0.25-0.4 with ±10% PlaybackSpeed variation so repeats don't sound identical.
- 4-8 detail sounds per ambience is enough; intervals of 4-20 s (more often in nature, rarer in horror).
- Crossfade 1.5-3 s between zones; instant cuts sound like bugs.
- Indoors/outdoors: the same rain sounds muffled inside (the Weather module does it with an EqualizerSoundEffect when sheltered).

## 2. Reverb by space
`SoundService.AmbientReverb` (the kit sets it from each preset's `Reverb`). Changing reverb between a cave and the outside is one of the cheapest big wins.

| Space | ReverbType |
|---|---|
| Open fields, beaches, deserts | Plain |
| Forests | Forest |
| Mountains, canyons, vistas | Mountains, Quarry |
| Streets | City, Alley, ParkingLot |
| Houses, small rooms | Room, LivingRoom, CarpetedHallway |
| Corridors, schools, hospitals | Hallway, StoneCorridor |
| Caves, dungeons | Cave, StoneRoom |
| Big halls, hangars, stations | Hangar, Auditorium, ConcertHall |
| Arenas, stadiums | Arena |
| Sewers, pipes | SewerPipe |
| Underwater | UnderWater |
| Space, menus | NoReverb |

For per-sound control (one room echoes, another doesn't), the newer Audio API (AudioPlayer → AudioReverb → AudioEmitter) lets you build effect chains; the kit uses classic Sound objects for simplicity.

## 3. Music states
Atmosphere and music should change together. A simple state machine: `explore` → `tension` → `combat/chase` → `victory/release`. Crossfade 1-3 s, avoid restarting a track that's already playing, and duck music under important sounds. In horror, many areas should have *no* music: the ambience is the score.

Hook it to the controller:
```lua
AtmosphereController.Changed:Connect(function(presetName, source)
	MusicController:SetState(MUSIC_FOR_PRESET[presetName] or "explore")
end)
```

## 4. Finding audio: Creator Store search terms
Search Studio's Toolbox → Audio (or the Creator Store) and check the license/permissions before use. Useful terms per ambience key in `AtmosphereConfig.Ambiences`:

| Key | Bed search | Detail searches |
|---|---|---|
| night_forest | night forest ambience, crickets wind | owl, branch snap, distant howl |
| fog_drone | dark drone, eerie ambience | distant siren, metal creak |
| house_creaks | house ambience night, room tone | floor creak, door creak, footsteps upstairs |
| fluorescent_hum | fluorescent light hum, buzz | light buzz flicker, distant thud |
| birds_meadow | birds ambience, meadow | bird chirp, bee |
| crickets | crickets night | frog, owl |
| light_breeze | wind light, breeze | leaves rustle |
| magic_forest | fantasy forest, magical ambience | chime, sparkle, fairy |
| cave_drips | cave ambience | water drip, rock fall, bat |
| station_hum | spaceship hum, sci-fi ambience | computer beep, vent, door hiss |
| city_rain | rain city, rain ambience | car pass, distant siren |
| wind_desolate | desert wind, howling wind | metal rattle, debris |
| storm | heavy rain, storm | thunder (also in Weather.Sounds.thunder) |
| blizzard | blizzard wind, snow storm | ice crack |
| snow_calm | winter ambience, soft wind | sleigh bells (events), crunch |
| underwater | underwater ambience | bubbles, whale |
| ocean_waves | ocean waves, beach | seagull |
| space_hum | space ambience, low drone | radio static |
| Tension heartbeat | heartbeat loop | |

## 5. Weather design
Weather is mood + gameplay + variety. Each type in the kit:

| Type | Look | Use | Pair with |
|---|---|---|---|
| rain | fast streaks, slight wind | melancholy, city nights, noir | EnvironmentSpecularScale 0.8-1 (wet), city_rain |
| storm | heavy slanted rain, lightning | survival, disasters, horror reveals | `storm` preset, thunder sound |
| snow | slow flakes | cozy winter, events | winter_holiday |
| blizzard | horizontal driven snow | survival, white-out | arctic_blizzard, dense fog |
| dust | large faint drifting puffs | wasteland, western, dungeons | sand ground, orange haze |
| ash | small grey flakes falling | fog horror, volcanic, aftermath | desaturated presets |
| embers | glowing orange rising | forges, volcanoes, burning towns | warm accent |
| fireflies | slow blinking green-yellow | cozy nights, Halloween wisps | night presets |
| spores | slow pale glowing drift | fantasy, swamps, alien | fantasy_forest |
| bubbles | rising | underwater | underwater |

Design notes:
- **Wet world**: rain without wet surfaces looks fake. Raise EnvironmentSpecularScale, darken materials a little (or swap to wetter variants), add puddles with reflective SmoothPlastic or Glass.
- **Splashes** (optional): a few ParticleEmitters on the ground around the camera, or raycast-down spawned splash particles at low rate.
- **Weather as gameplay**: fog reduces sight (stealth easier), storms stop flying, blizzards drain warmth. Telegraph changes with sound and clouds 10-20 s ahead.
- **Replace the default textures** in `AtmosphereConfig.Weather.Textures` with proper streak and flake textures for a better look (the engine defaults are soft blobs).

## 6. Wind, lightning, shelter
- **Wind:** `workspace.GlobalWind` moves Clouds, grass and particles with `WindAffectsDrag`. Set it per weather (blizzard ~ (30, 0, 10), breeze ~ (5, 0, 2)) from the client when weather changes if you want grass/clouds to follow.
- **Lightning:** the kit flashes a separate ColorCorrection (`WeatherFlash`) with a double flicker and a delayed thunder (0.4-2.5 s). Reduce Flashing turns it into one gentle brightening. For a visible bolt, spawn a Beam or a few Neon parts briefly at a random point in the distance (see the `roblox-vfx` skill).
- **Shelter:** the kit raycasts up from the camera every 0.25 s; under a roof, emission stops and the weather sound is muffled. Glass roofs count as roofs; use CanQuery = false on decorative parts that shouldn't block (thin awnings, leaves) if needed.

## 7. Budgets and settings
- Particle budget on phones: keep weather under ~600 particles alive. Heavy rain at Intensity 1 is close; drop Intensity to 0.5-0.6 on low quality.
- Sounds: a bed + 1-2 overlapping details + weather loop + music is plenty. Many simultaneous 3D sounds cost CPU on low-end devices.
- Settings menu: Master, Music, Ambience (`SoundService.Ambience.Volume`) sliders; Reduce Flashing; optionally "Weather effects: Full / Reduced / Off" mapped to Intensity multipliers.
