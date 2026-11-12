---
name: roblox-atmosphere
description: Design the atmosphere and mood of a Roblox game for any genre - horror (night woods, fog, dark interiors, liminal spaces), cozy, simulator, obby, fantasy, dungeon, sci-fi, space, cyberpunk, post-apocalyptic, storms, desert, western, arctic, underwater, tropical, PvP, FPS, noir, seasonal events. Covers Lighting, Atmosphere fog, ColorCorrection, Bloom, SunRays, DepthOfField, Clouds, Sky, practical lights and flicker, weather, ambient sound, reverb, day/night cycles, area zones and horror tension. Ships 25 genre presets with real values, a Luau kit, a Studio command-bar exporter and a browser lab to preview and tune. Use this whenever the user wants a game to feel scary, cozy, epic, eerie or magical, asks for lighting settings, fog, post-processing, weather, ambience or a day/night cycle, or says their game looks flat, bland, too dark or "default Roblox", even if they only say "make my map look better".
---

# Roblox atmosphere

Atmosphere is everything the player feels before anything happens: light, fog, colour, sky, weather and sound. It does two jobs at once: **set the mood** the genre promises (dread, comfort, wonder, tension) and **serve the gameplay** (players must still read the path, the threat and each other). A horror map that is pure black is not scary, it's unplayable; a battlegrounds arena drowned in bloom is pretty and unfair.

## The principles

1. **Mood is a promise; keep it.** Name the one feeling in a sentence ("lonely dread", "safe and sunny", "neon danger"). Every setting should push toward it. Mixed signals (cheerful music in a dark forest) read as unfinished.
2. **Value structure first, colour second.** Decide what's light and what's dark: the path, the goal and the players should stand out from the background. Check it desaturated; if it reads in greyscale, colour only adds.
3. **Temperature contrast sells everything.** Cool fill (ambient, fog) plus warm accents (lamps, fire, windows), or the reverse for alien and sci-fi spaces. One dominant hue, one accent hue, little else.
4. **Fog is depth and pacing.** Density controls how far the player sees, so it controls how far ahead they can plan. Short view distance creates tension and hides map edges; long view distance invites exploration.
5. **Light is a signal.** Players walk toward light. Use practical lights (lamps, torches, neon) to lead, mark safety and mark goals. In horror, light is a resource.
6. **Sound is half the atmosphere.** A looping bed, random details in 3D and the right reverb make a mediocre visual feel finished. Silence is a tool too.
7. **Readable on the weakest device.** Many players are on phones at low graphics quality, often outdoors. Post effects can be dropped and Future lighting falls back. Gameplay-critical things must read with ambient light alone.
8. **Comfort and accessibility.** No fast full-screen flashing (keep it under 3 flashes per second), a Reduce Flashing setting, a screen-shake-free alternative, and a brightness that works on a bright phone screen.

## Decide the mode

| The user wants... | Do this |
|---|---|
| "Make my game feel like X" / a genre look | Find the genre in `references/genre-atmospheres.md`, pick its preset(s), state the mood sentence and the light plan, then deliver the preset (command-bar script for a quick look, kit for the full system). Tune one or two values to their map, don't hand over a preset blind. |
| Horror of any kind | Read `references/horror.md` too: darkness that stays readable, fog lighter than silhouettes, sound-first scares, tension and pacing, the Tension and Flicker kit parts, audience and maturity questionnaire. |
| "My game looks flat / bland / default" | Diagnose with the checklist in `references/lighting-reference.md` §1 (the usual culprits: default Brightness and grey ambient, no fog, no colour grade, no practical lights, no sound bed). Fix in order: fog → ambient/temperature → grade → practical lights → bloom → sound. |
| Specific settings ("what do Haze and Glare do", "why is my Ambient ignored") | `references/lighting-reference.md` has every Lighting, Atmosphere and post-effect property with ranges and gotchas. |
| Weather, ambience, music, reverb | `references/sound-and-weather.md`. The kit's `Weather` and `Ambience` modules do the work. |
| Day/night, areas with different moods, scripted moments | The kit: `AtmosphereService` (world clock, base preset, per-player preset), `AtmosphereController` (zones, overrides, blending). |
| Tune by eye / show options | Send or publish `assets/atmosphere-lab.html`. |

## Workflow

1. **Pin down the mood and the play.** Genre, the mood sentence, time of day, indoor or outdoor, how far players need to see (combat range, chase distance, puzzle clues), PC or phone audience. Start straight away for a clear request and say what you assumed.
2. **Pick the starting preset(s).** `node <skill>/scripts/presets.cjs list` shows all 25 with genres. Most games want 2-4: a base (outdoor), interiors or special areas (zones), and maybe a day/night pair or a scripted moment (a blackout, a boss arena, an event).
3. **Adjust to the map.** Common tweaks: ClockTime for the sun angle the map was built for, Atmosphere.Density for the play distance, Accent for the map's light sources, Grade.TintColor and Saturation to match the art style.
4. **Deliver.**
   - Quick look in Studio: `node <skill>/scripts/presets.cjs command <name>` prints a command-bar script that applies the preset to the open place (undoable, sets Technology too). Also works with `--file custom.json`.
   - Full system: install the kit (below); add custom presets to `AtmospherePresets.luau` (`presets.cjs show <name>` prints a Luau entry).
   - Tuning by eye: the lab, then "Copy Luau entry" or "Copy command-bar script".
5. **Place practical lights and sound.** Presets set the global look; the map still needs lamps, torches, neon, windows (tag them `AtmosphereAccent` to take the preset's accent colour, `Flicker` to animate them) and audio ids in `AtmosphereConfig`.
6. **Check readability.** Play on a phone or with Studio's device emulator at graphics quality 1-3, check the avatar against the background, the path, enemies and pickups. The lab's "Avatar contrast" and "Mean brightness" checks catch the worst cases before Studio.

## The kit

`assets/kit/` mirrors the `roblox-project-structure` layout (`shared` → `ReplicatedStorage.Shared`, `server` → `ServerScriptService.Server`, `client` → `StarterPlayerScripts.Client`). Copy the folders over the project's `src`; Services and Controllers are started by the scaffold's Loader, Components by its binder. It uses the Signal package.

| File | Side | Does |
|---|---|---|
| `shared/Atmosphere/AtmospherePresets.luau` | both | The 25 presets (generated from `assets/presets.json`). Add your own entries here. |
| `shared/Atmosphere/AtmosphereConfig.luau` | both | Default preset, blend time, zone tag, day/night phases, weather textures and sounds, tension, ambience audio ids. |
| `shared/Atmosphere/Atmosphere.luau` | both | `Apply(preset, seconds)`: blends Lighting, Atmosphere, grade, bloom, sun rays, DOF, clouds, sky, reverb and accent lights; ClockTime wraps through midnight correctly. Owns its named effects and leaves others (e.g. combat slow-mo) alone. |
| `server/Services/AtmosphereService.luau` | server | Sets attributes only: base preset for everyone, a per-player preset, the shared world clock (clients extrapolate it, zero traffic), `IsNight()`. |
| `client/Controllers/AtmosphereController.luau` | client | Picks the preset (player override → scripted override → zone → base / day-night phase), blends it, drives ClockTime, weather and ambience. `SetOverride(name)`, `Changed` signal. |
| `client/Atmosphere/Weather.luau` | client | Rain, storm with lightning and thunder, snow, blizzard, dust, ash, embers, fireflies, spores, bubbles around the camera; stops under roofs and muffles its sound. |
| `client/Atmosphere/Ambience.luau` | client | Crossfading ambience bed plus random 3D detail sounds, in a `SoundService.Ambience` group for a volume slider; ducking. |
| `client/Atmosphere/Tension.luau` | client | Horror: `Set(0..1)` / `Pulse()` → desaturate, contrast, red tint, vignette, heartbeat, ambience duck. |
| `client/Components/LightFlicker.luau` | client | Tag `Flicker`: Candle, Fluorescent, Broken, Pulse styles for lights and Neon; respects Reduce Flashing. |

Install steps to give the user:
1. Copy the kit folders into `src` (merge with the scaffold). If the project doesn't use the scaffold, the modules still work: require the controller and call `:Init()` and `:Start()` from a LocalScript, bind `LightFlicker` with CollectionService, and require the service from a Script.
2. Remove extra post effects the place already has in Lighting (a stray Bloom or ColorCorrection stacks on top of the kit's). Keep one `Atmosphere`, one `Sky` (the kit reuses them).
3. Set `AtmosphereConfig.DefaultPreset`. For a day/night cycle set `DayNight.Enabled = true` and edit `Phases`.
4. Zones: an invisible, anchored, non-colliding part (CanQuery and CanTouch off) covering the area, tagged `AtmosphereZone`, attribute `Preset` = a preset name, optional `Priority`, `TransitionSeconds`, `FollowClock`. Put zones in a Model with `ModelStreamingMode = Persistent` if StreamingEnabled is on.
5. Practical lights: tag lamps `AtmosphereAccent` to follow the preset's accent; tag flickering ones `Flicker` with a `Style` attribute.
6. Audio: paste ids into `AtmosphereConfig.Ambiences`, `Weather.Sounds`, `Tension.HeartbeatSoundId` (empty ids are skipped, so it all runs silently until then). Search terms are in `references/sound-and-weather.md`.
7. Settings menu: a Reduce Flashing toggle sets the player attribute `ReduceFlashing`; a volume slider sets `SoundService.Ambience.Volume`.
8. Lighting.Technology can't be changed by scripts at runtime: set it once in Studio (the command-bar script does it). Presets list the recommended one.

Server code that changes atmosphere uses only `AtmosphereService` (e.g. `AtmosphereService:SetPreset("horror_interior")` when the lights go out, `SetPlayerPreset(player, "...")` for one player's scare). Never set Lighting properties from the server while the kit runs: they replicate and overwrite every client.

## Presets

`assets/presets.json` is the source of truth. After editing it run `node <skill>/scripts/presets.cjs build` (regenerates the Luau module and the lab's data) and `check` (validates ranges, enum names and ambience keys). Each preset maps 1:1 to Roblox properties: `Lighting`, `Atmosphere`, `Grade` (ColorCorrectionEffect), `Bloom`, `SunRays`, `DepthOfField`, `Clouds`, `Sky` (no skybox ids; add your own), plus `Technology` (advice), `Accent` (practical-light colour), `Weather`, `Ambience`, `Reverb`. A missing effect section fades that effect out.

## Atmosphere lab

`assets/atmosphere-lab.html` is a single file with no dependencies. Publish it as an artifact or send the file. Pick a preset (filter by genre), switch the test scene (outdoor, street, corridor) and ground, toggle flashlight, flicker and Reduce Flashing, drag the horror Tension slider, tune every property, and copy a Luau entry, a command-bar script or JSON. It's an approximation of the Roblox renderer: right for mood, colour relationships and readability; confirm final values in Studio.

## Limits to be honest about

- The lab approximates; real results depend on the map's materials, the skybox, Technology and the player's graphics quality.
- Post effects (Bloom, SunRays, DepthOfField) and Future lighting are reduced or off at low graphics quality and on many phones. Never rely on them for gameplay readability.
- Presets carry no skybox, texture or audio asset ids: the user picks those from the Creator Store. Starfield and space looks need a skybox.
- The kit is a reviewed starting point, not battle-tested in a live game: test with several players, StreamingEnabled and low graphics quality before shipping.

## References

- `references/genre-atmospheres.md` — per genre: mood sentence, preset, light plan, palette, fog distance, weather, sound bed, set dressing and common mistakes; variants and events.
- `references/horror.md` — fear design: readable darkness, light as a resource, sound-first scares, tension and pacing, monsters, safe rooms, multiplayer horror, audience and comfort.
- `references/lighting-reference.md` — the flat-game checklist, every Lighting, Atmosphere and post-effect property, Technology, practical lights, colour and value, readability, performance by device.
- `references/sound-and-weather.md` — ambience layers, reverb, music states, Creator Store search terms, weather design, wind, lightning, shelter, budgets.
