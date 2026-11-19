---
name: roblox-music
description: Compose and implement dynamic, adaptive game music for Roblox the way GTA, Red Dead, Dead Space and DOOM do it - a soundtrack that follows the action. Generates original cues from a mood (action combat, car chase / wanted level, heist and stealth, horror dread, horror chase, creepy lullaby, epic boss, exploration, cozy village, sad, victory, cyberpunk, sci-fi, western, lo-fi lobby, racing, obby chiptune, round countdown, acoustic campfire, blues, punk, rock anthem, funk, or a custom mood) with chord progressions, beats, basslines, main melodies, hooks, ostinatos, drones, snare builds and braams, guitar parts played like a guitarist (fretboard chord shapes, strumming, Travis picking, power chords, blues shuffle, funk scratch, blues licks with bends) through amp models, and a performance pass (groove pocket, accents, humanizing, drum variation, slides and vibrato), rendered as intensity stems that loop seamlessly plus stingers, intro and ending one-shots, MIDI, a composer brief and a Luau cue entry. Ships a Luau kit (MusicDirector with states, intensity, hysteresis and Dead Space-style fear emitters; MusicPlayer on the Audio API with Play(atTime) beat/bar-synced transitions, vertical layering, stingers and ducking; MusicController; MusicService), Luau tests, a stem analyzer and a browser lab to hear it all. Use this whenever the user wants game music, a soundtrack, background music, combat or boss music, a wanted-level or chase theme, horror music or scares, stingers, music that changes with gameplay, music layers or stems, music transitions, beat-synced events, or guitar music (acoustic, blues, punk, rock, funk), or says the music sounds generic, robotic or repetitive, or asks why their music loops badly, cuts off or never changes, even if they only say "add music to my game".
---

# Roblox adaptive music

Game music has two jobs: **set the vibe** (the player should feel the game's promise in the first five seconds) and **follow the play** (calm when exploring, rising when danger is near, exploding in a fight, resolving when it's over). A great track that never changes gets muted; a soundtrack that reacts makes players feel like the protagonist.

This skill writes the music (original cues composed from a mood, rendered to stems) and plays it adaptively in Roblox (a director and a sample-synced player).

## The principles

1. **Vibe first, in one sentence.** "Relentless, the monster is right behind you." Every choice (tempo, mode, rhythm, instruments, space) serves it. Mixed signals (a happy major key in a chase) read as unfinished.
2. **Stems, not tracks.** Split each cue into 4-6 layers that loop together on one grid: bed (always on) → motion → groove → lead → peak. Intensity fades layers in; any bottom-up subset must sound finished.
3. **States switch on the music's grid.** Explore → combat → boss change on the next beat, bar or phrase, with an intro, an ending or a stinger covering the seam. Never mid-beat, never a hard cut.
4. **Sources, not switches.** Gameplay reports what's happening (an enemy saw me, wanted level 3, monster 20 studs away); the director picks state and intensity with hysteresis: escalate immediately, calm down slowly, never flip-flop.
5. **Seamless and in sync.** Every stem exactly the loop length with its tail wrapped to the start; all stems started with one `Play(atTime)`; volumes changed only through faders.
6. **Develop an idea, don't loop a pattern.** One motif, restated as a sequence, answered, fragmented toward a single climax, then cadenced on a non-tonic note so the loop rolls on. Strong beats take 3rds, 7ths and 9ths, not the root; dissonances resolve by step; the mode's colour note is heard. Arpeggios voice-lead between chords and the bass steps into each change. A cue full of 1-3-5 arpeggios and roots and fifths sounds generic however good the sounds are (`references/music-theory.md` §5). Then **play it, don't program it**: a groove pocket, accents, small human timing, drums that vary every few bars, vibrato and slides (§9). Builds and transitions are musical (snare rolls, tom fills, taiko hits, braams), never synthetic whooshes, noise washes, cymbal swells or laser sweeps.
7. **Leave room.** Melody arrives late in intensity, silence is a state, music ducks under dialogue and stingers, and the mix sits around -16 LUFS so SFX can cut through.
8. **Per player, and adjustable.** Music runs on each client; the server only states facts. Always give a volume slider and an off switch.
9. **Original.** Borrow techniques from famous scores, never their melodies or sound-alikes.

## Decide the mode

| The user wants... | Do this |
|---|---|
| "Music for my X game" / a vibe | Pick moods from the table in `references/composing-by-mood.md` §2 (`compose.cjs list`), one per game state. Render them, install the kit, map states. |
| Music that changes with gameplay (GTA-style, combat music, wanted level) | `references/adaptive-music.md`: states, signals → intensity, hysteresis, transitions. Then the kit's `MusicConfig.States` and sources. |
| Horror music, scares | `horror_dread` (proximity-driven, no melody), `horror_chase`, `horror_lullaby`; fear emitters (`MusicEmitter` tag); jumpscare stinger. Pair with the `roblox-atmosphere` skill's Tension module. |
| Guitar music: acoustic, blues, punk, rock, funk | `acoustic_campfire`, `blues_roadhouse`, `punk_skate`, `rock_anthem`, `funk_strut`; the `guitar` role and the genre recipes in `references/music-theory.md` §10. |
| "It sounds robotic / programmed" | Give the mood a `feel` (laidback, push, tight; humanize) and see `references/music-theory.md` §9: pocket, accents, drum variation, articulation, space, turnarounds. |
| "The melody is boring / generic / repetitive" | `references/music-theory.md` §5: set the melody's `form` and `contour`, give arps a `pattern` (broken, groups3, pedal...) and `colors`, try `--seed` values; to keep a theme exactly, edit the MIDI. |
| A custom vibe ("jungle temple", "pirate tavern") | Translate the vibe with `references/composing-by-mood.md` §1, write a mood entry (§3 schema), `check`, `show`, `render`. |
| Theory help: chords, modes, melody, layering | `references/music-theory.md`. |
| Implementation trouble (sync, clicks, silence, uploads) | `references/roblox-audio.md` (troubleshooting table at the end). |
| Their own stems from a DAW, composer or AI tool | `compose.cjs analyze` them, then a `MusicCues` entry by hand (same format). |
| Hear it / show options | Publish or send `assets/music-lab.html`. |

## Workflow

1. **Map the music.** List the game states (lobby, explore, tension, combat/chase, boss, results), give each a mood sentence and a mood preset, and pick the signals that drive intensity (`references/adaptive-music.md` §3, §5). Start right away for a clear request and state your assumptions.
2. **Compose.** `node <skill>/scripts/compose.cjs show <mood>` to check chords and the intensity map; tweak with `--seed`, `--key`, `--bpm`, `--bars`, `--progression`, or a custom mood file. Share pairs on one tempo when they hand over often.
3. **Render.** `node <skill>/scripts/compose.cjs render <mood> --seed N --out <project>/music` writes, per cue: `<cue>_<stem>.wav` (seamless loops), one-shots (`intro`, `ending`, stingers), `<cue>.mid`, `<cue>.cue.json`, `<cue>.luau` (the MusicCues entry) and `BRIEF.md` (for a composer). It prints levels: full mix -16 LUFS, peaks under -1 dBFS.
4. **Let them listen.** `compose.cjs demo <mood>` writes a single preview WAV (intensity sweep + ending). The lab (below) plays the same cue with an intensity slider, a game director simulation, stingers and a piano roll. Rendered WAVs can also be opened directly.
5. **Install the kit** (below), upload the WAVs (Asset Manager → Bulk Import), paste the ids into the `MusicCues.luau` entry printed by `render`, and set `MusicConfig.States`.
6. **Wire the game.** Server facts through `MusicService`, client perception through `MusicController:SetSource`, monsters and scare spots tagged `MusicEmitter`, settings menu → `MusicVolume` attribute.
7. **Test in play.** A fight with cover breaks, losing a chase, a scare that turns out to be nothing, a boss entrance, two players in different situations. Tune Hold, MinDwell, Attack and Release in `MusicConfig`.

## The kit

`assets/kit/` mirrors the `roblox-project-structure` layout (`shared` → `ReplicatedStorage.Shared`, `client` → `StarterPlayerScripts.Client`, `server` → `ServerScriptService.Server`). Services and Controllers are started by the scaffold's Loader. Uses the Signal package.

| File | Side | Does |
|---|---|---|
| `shared/Music/MusicCues.luau` | both | One entry per cue: Bpm, BeatsPerBar, Bars, Stems (`Name`, `Asset`, `Min`, `Full`, optional `Volume`), Intro, Ending, Stingers. Generated for every mood (seed 1); `render` prints the entry for the exact files it made. Empty assets are skipped. |
| `shared/Music/MusicConfig.luau` | both | States (Priority, Cue, Intensity floor, Hold, MinDwell, Sync, Fade, Entry, Intro, Ending, Stinger), director speeds, transition defaults, layer fade, stinger ducking, volume, fear-emitter tag, attribute names. |
| `shared/Music/MusicDirector.luau` | both | Pure: sources → state + smoothed intensity with hysteresis. Tested in the luau CLI. |
| `shared/Music/MusicTimeline.luau` | both | Pure: beat/bar/phrase/loop grid, `NextBoundary`, `Position`, `LayerGain`, `EntryOffset`. Tested. |
| `client/Music/MusicPlayer.luau` | client | Audio API graph: AudioPlayer per stem → AudioFader → bus → AudioDeviceOutput. Loads, schedules with `Play(atTime)` on `GetMixerTime`, crossfades or plays Intro/Ending on the boundary, layers by intensity, stingers on the next beat with ducking, `Preload`, `Position`. |
| `client/Controllers/MusicController.luau` | client | Runs the director every frame, reads server attributes, fear emitters, volume; API: `SetSource`, `ClearSource`, `SetBase`, `PlayStinger`, `Preload`, `Duck`, `SetEnabled`, `GetState`; signals `Changed(state, cue)` and `Beat(bar, beat)` for music-synced gameplay and VFX. |
| `server/Services/MusicService.luau` | server | Attributes only (no remotes): `SetState` (everyone), `SetPlayerState`, `SetBase`, `Stinger(name, player?)`. |

Install steps to give the user:
1. Copy the kit folders into `src` (merge with the scaffold). Without the scaffold: require `MusicController` from a LocalScript and call `:Init()` then `:Start()`; require `MusicService` from server Scripts. Replace `ReplicatedStorage.Packages.Signal` with any Signal module if the project has no Packages.
2. Render the cues for the states in `MusicConfig.States` (defaults: exploration, heist_stealth, action_combat, car_chase, epic_boss), upload the WAVs to the group that owns the experience, paste ids into `MusicCues.luau` (use the entry `render` printed if the seed/key/tempo changed).
3. Edit `MusicConfig.States` to the game's states and cues; set `BaseState`.
4. Report sources. Client: `MusicController:SetSource("enemy:" .. id, "combat", 0.6)` when an enemy becomes aware, `ClearSource` when it loses you or dies; pulses with a ttl (`SetSource("hit", "combat", 1, 2)`). Server: `MusicService:SetPlayerState(player, "chase", stars / 5)`, `MusicService:SetState("boss", 0.6)` for everyone, `MusicService:SetBase("silence")` for an intermission, `MusicService:Stinger("victory")`.
5. Fear emitters: tag monsters or scare spots `MusicEmitter`, attributes `State` ("tension"/"combat"), `Intensity` (at the centre), `Radius` (studs).
6. Settings: a slider sets the Player attribute `MusicVolume` (0-1); a toggle calls `MusicController:SetEnabled(on)`.
7. Optional: `MusicController:Preload(cue)` on loading screens; `MusicController.Beat` to pulse lights or time events to the music.

## Tools

- `node <skill>/scripts/compose.cjs list | show <mood> | render <mood> | demo <mood> | midi <mood> | brief <mood>`: `demo` writes one WAV of the loop with intensity rising 0 → 1 and the ending, the quickest way to let someone hear a mood. options `--seed --key --mode --bpm --bars --progression --name --file custom.json --out DIR --sr 44100|48000 --target -16`. Rendering takes a few seconds per cue, deterministic per seed.
- `node <skill>/scripts/compose.cjs analyze stems/*.wav --bpm 140 --bars 8`: loudness, peaks, equal lengths, expected length for the grid, loop-seam check. Use it on stems from any source.
- `node <skill>/scripts/compose.cjs check` validates `assets/moods.json`; `build` regenerates `MusicCues.luau` and the lab after editing moods or the engine.
- `node <skill>/tests/run-luau.cjs`: the Luau spec (timeline, director, config/cue consistency) plus a replay of shared scenarios through the kit's Luau and the lab's JS port, failing on any difference (needs the `luau` CLI: `brew install luau` or `rokit add luau-lang/luau`).
- `node <skill>/scripts/selftest.cjs`: engine checks (scales, melody craft: tonic/fifth share, repeated notes, unresolved dissonances, counterline under the melody; seamless loops, levels, MIDI, WAV round trip, generated files current) and the Luau tests.

## Music lab

`assets/music-lab.html` is a single file (engine inlined, no other dependencies; fonts optional). Publish it as an artifact or send the file. Pick a mood and it composes and renders the stems in a Web Worker, then plays them: **Layers** tab = drag intensity and watch stems fade in; **Game director** tab = the kit's director logic (ported line for line, checked by the tests) with "enemy spots you", "firefight", "lose them" and "threat nearby" events, switching to a paired action cue on the beat/bar/phrase with its intro, ending and alert stinger; stinger buttons; mute/solo per stem; piano roll; seed/key/BPM/bars; levels; Luau entry and CLI command to copy; WAV/MIDI/zip downloads when opened as a local file.

## Limits to be honest about

- Instruments are synthesized (subtractive, FM, Karplus-Strong string models with amp simulation, noise). Synthwave, chiptune, horror textures, hybrid-cinematic percussion and plucked/strummed guitars sound convincing; distorted and lead guitars are good sketches (a modelled amp, not a miked cabinet); orchestral and acoustic instruments (strings, brass, choir, piano, guitar) are good sketches, not sample libraries. For a release-quality score, take the MIDI and `BRIEF.md` to a DAW or a composer and keep the same structure; the kit doesn't care where stems come from.
- The generator develops a motif with real phrase forms, chord-aware note choice and counterpoint, so lines sound composed rather than random, but it doesn't judge which theme is the catchiest. Try a few seeds (each changes the motif, form and contour), keep the best, or write the theme by hand in the MIDI.
- `MusicPlayer` relies on `AudioPlayer:Play(atTime)` and `SoundService:GetMixerTime()`; it falls back to frame-accurate starts without them. The kit is a reviewed starting point, not battle-tested in a live game: test with several players, slow devices and StreamingEnabled.
- Uploaded audio is private until shared with the experience, and each upload counts against the monthly quota.

## References

- `references/adaptive-music.md`: vertical layering, horizontal re-sequencing, stingers, intros/endings, the director (states, intensity, hysteresis, fear emitters), how GTA V, Red Dead, Dead Space and DOOM do it, designing a game's music map, repetition, multiplayer; sources.
- `references/composing-by-mood.md`: vibe → tempo, mode, harmony, rhythm, bass, melody, colour, space; every preset explained; the moods.json schema; cue pairings.
- `references/music-theory.md`: modes, progressions by mood, performance and feel (§9), guitar styles and genre recipes for acoustic, blues, punk, rock and funk (§10), tension devices, grooves, melody writing (motifs, contours, development, sentence/period/AABA forms, guide and colour tones, appoggiaturas, gap-fill, climax, counterlines, non-generic arpeggios, leitmotif stingers), arranging stems, mixing levels, working with a DAW, composer or AI tool.
- `references/roblox-audio.md`: Audio API vs Sound, keeping stems in sync, seamless loops, upload formats and limits, permissions, loading, ducking with a sidechain compressor, licensing, troubleshooting.
