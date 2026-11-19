# Adaptive music: how games make the score follow the player

## Contents
1. The two building blocks: vertical layering and horizontal re-sequencing
2. Stingers, intros, endings and transitions
3. States, intensity and hysteresis (the director)
4. How shipped games do it (GTA V, Red Dead, Dead Space, DOOM, middleware)
5. Designing a game's music map
6. Repetition, silence and the mix
7. Multiplayer and Roblox specifics
8. Sources

---

## 1. The two building blocks

**Vertical layering (re-orchestration).** One piece of music is split into *stems* (layers) that play in sync and are faded in or out as the action changes. Same harmony, same bar, more or less of the band. The calm version is the bottom stems; the climax is all of them.
- Changes are instant and smooth (a fade, no musical "seam"), so it suits continuous parameters: threat distance, enemies alive, speed, wanted level, health.
- Constraint: every stem must sound finished on top of the ones below it. Write the bed first, then add each layer so that "bed", "bed + 1", "bed + 1 + 2"... all work.
- In this kit: each stem has `Min` (starts fading in) and `Full` (fully up). `MusicTimeline.LayerGain` is a smoothstep between them; `MusicPlayer` eases toward it over `LayerFade` seconds.

**Horizontal re-sequencing.** The music moves to a *different* segment or cue at a musically sensible point: the next beat, bar, phrase or end of the loop. Explore music becomes combat music; combat ends with a final hit and the calm theme comes back.
- Suits discrete changes: entering a boss arena, a heist going loud, winning, dying.
- Transitions are scheduled on the playing cue's beat grid so they land in time. Options in this kit: `Sync = "Immediate" | "Beat" | "Bar" | "Phrase" | "Loop"`, plus `Fade`, `Entry = "Match"` (keep the bar position when both cues share tempo and meter) and `Intro` / `Ending` one-shots.

**Use both.** The standard modern setup is horizontal for states (explore, tension, combat, boss) and vertical inside each state for intensity. That's exactly the director → player split in the kit.

## 2. Stingers, intros, endings and transitions

| Piece | What | When | Rules |
|---|---|---|---|
| **Stinger** | Short one-shot over the music (hit, alert braam, discovery chime, jump-scare cluster) | An event: spotted, item found, level up, death, a scare | Lands on the next beat (or immediately for scares). In key with the cue, or key-less (percussion, noise, atonal). Duck the music 30-60% under it for its length, release over ~1 s. |
| **Intro** | 1 bar (or more) that leads into bar 1 of a loop: a snare build, a drum fill | Entering a high-energy state | Starts on the old cue's boundary, its last beat lands on the new loop's downbeat. |
| **Ending (outro)** | Final chord + hit with a tail | Leaving combat/chase/boss | Plays on the boundary while the old loop cuts out fast; the next cue fades in under the tail. Without an ending, combat music that simply fades sounds like a bug. |
| **Transition segment** | A bespoke bridge between two specific cues | Big scripted moments | Only worth writing for set pieces; the generic intro/ending cover most cases. |
| **Crossfade** | Old fades out while new fades in | Calm ↔ calm, similar tempos | 1.5-3 s. Two different grooves overlapping for long sounds messy: keep combat crossfades short (0.3-0.75 s) or use an Ending. |

Middleware vocabulary, for reading docs and talking to composers: Wwise calls the sync point the *transition rule* ("next bar", "next beat", "next cue", "exit cue") with *pre-entry* (an anacrusis before bar 1, our Intro) and *post-exit* (the release tail after the exit cue, our Ending's tail). FMOD uses *transition regions* and *quantization* on its timeline, plus *transition timelines* for bespoke bridges.

## 3. States, intensity and hysteresis (the director)

Raw game signals are noisy: an enemy blinks in and out of sight, a gunshot lasts a frame. Music that follows them directly flip-flops. A director smooths them.

**Sources, not switches.** Game code reports what is happening; it never picks a track:
```lua
MusicController:SetSource("enemy:" .. id, "combat", 0.6)   -- while that enemy is aware of you
MusicController:SetSource("gunfire", "combat", 0.95, 2)     -- a 2-second spike
MusicService:SetPlayerState(player, "chase", stars / 5)     -- server: GTA-style wanted level
```
**Priority picks the state.** silence 0 < explore 1 < tension 2 < combat/chase 3 < boss 4. Equal priorities resolve to the higher intensity.

**Hysteresis.**
- Escalation is immediate (on the next Sync boundary): the player must hear the danger now.
- De-escalation waits for `Hold` seconds with no source *and* `MinDwell` seconds in the state. Typical: combat Hold 6-10 s, MinDwell 10-15 s; tension Hold 4-8 s. This is what stops "combat music, silence, combat music" when you duck behind cover.
- Intensity rises fast (`Attack` 1-2 per second) and falls slowly (`Release` 0.1-0.25 per second) after holding its peak for `IntensityHold` 2-4 s. Music should react in under a second and calm down over 5-10.
- Each state has a floor `Intensity` so its cue never plays too thin (combat 0.4-0.5 keeps drums in).

**Mapping signals to intensity.** Pick one or two signals per state, normalize to 0-1, take the max:

| Game | Signal → intensity |
|---|---|
| Shooter / battlegrounds | enemies aware of you (1 → 0.5, 3+ → 0.8), recent damage dealt/taken (spike 1.0 for 2 s), low health (+0.2) |
| GTA-style open world | wanted stars / 5 (chase state), being shot at (combat spike) |
| Horror | distance to the monster (fear emitter: 1 at contact → 0 at 60 studs), monster sees you (chase state) |
| Stealth / heist | guard suspicion 0-1 (tension), alarm (combat) |
| Racing | position (1st → 0.9), final lap (+0.3), speed / top speed |
| Boss | boss phase (1 → 0.6, 2 → 0.8, 3 → 1.0) |
| Round-based (BR, minigames) | time left (last 30 s → 0.9), players left |

**Fear emitters** (Dead Space): tag parts or monsters `MusicEmitter` with `State`, `Intensity`, `Radius`. The controller turns the nearest one into a source with linear falloff. Put one on every monster and on scripted scare spots: the music swells before the player sees anything.

## 4. How shipped games do it

| Game | System | Take-away for Roblox |
|---|---|---|
| **Grand Theft Auto V** | Score supervisor Ivan Pavlovich: the score is "completely dynamic", built on Rockstar's interactive *stem system*; missions were scored with layers for the outcomes a player could make. Radio plays while driving; the score takes over on foot. Wanted-level music starts around 3 stars and intensifies at 4-5; city and countryside use different composers' material. | Stems + a wanted/heat parameter. Let player radios or ambient music win while nothing is happening; the score takes over for missions and chases. Different cues per region with the same director. |
| **Red Dead Redemption** (2010) | Five stem tracks per piece, all recorded in the same key and tempo (130 BPM, A minor) so any stems could combine and any cue could follow any other. | The simplest robust system: one key, one tempo for a whole game's dynamic music. `Entry = "Match"` makes cues that share tempo continue at the same bar. |
| **Red Dead Redemption 2** | Up to 11 stem tracks and no fixed key/tempo; composers marked where an emotion changes and switched keys there instead of only stacking stems. | Horizontal changes at emotional turning points; vertical within. Different keys are fine *if* transitions happen on a boundary with an ending or stinger. |
| **Dead Space** | "Fear emitters" on enemies and scare spots broadcast fear by proximity; four layered stereo streams mixed in real time by how much fear is in range. Jason Graves wrote no melodies or themes for the exploration score: aleatoric, dissonant, clusters. | Horror music is a proximity meter, not a song. The kit's `MusicEmitter` tag and the `horror_dread` mood do this. |
| **DOOM** (2016) | Almost all of the composer's effort went into dynamic combat music; levels of combat (high, medium, incidental) vs exploration. | Most players remember combat music: give it the most stems and the best stingers. |
| **Wwise / FMOD games** | States + switches pick segments; RTPCs (game parameters) drive layer volumes; transition rules quantize changes; stingers on triggers. | Same model as this kit, without middleware: Roblox has no FMOD/Wwise, so the director + player are the middleware. |

## 5. Designing a game's music map

1. **List the states players spend time in.** Usually 3-6: lobby/menu, explore (per biome), tension/stealth, combat (or chase), boss, results. Write each as a mood sentence ("lonely dread", "safe and bouncy").
2. **Pick a cue per state** (`compose.cjs list`), or one cue per biome for explore. Pair cues that will hand over often: same tempo makes `Entry = "Match"` and short crossfades possible (e.g. render combat at the explore BPM with `--bpm`).
3. **Pick the signals** that drive intensity in each state (table in §3) and who reports them (server for authoritative facts like wanted level or boss phase; client for perception like line of sight or proximity).
4. **Decide transitions:** Sync per state (combat: Beat; explore: Bar or Phrase), Intro for big entrances (boss), Ending for leaving action states, stingers for the 3-6 events that deserve a musical punctuation.
5. **Set hysteresis** (Hold, MinDwell, Attack, Release) and test with real play: a firefight with cover breaks, a chase that loses the cops, a scare that turns out to be nothing.
6. **Plan silence.** Some states (horror exploration, puzzles) work better with ambience only (`silence` state, or a bed stem that is nearly just a drone).

## 6. Repetition, silence and the mix

- **Loop length vs time in state:** players notice a loop after about 3 repeats. 8 bars (15-30 s) is fine for combat, where intensity keeps changing the mix; explore music wants 16+ bars, two seeds of the same mood alternated, or a few minutes of silence between plays.
- **Vertical changes hide repetition:** the same 8 bars with different stems sound like development.
- **Silence is a state.** Music that never stops loses its power to signal. Give explore a "rest" (a silence state for 1-3 minutes after a cue ends) in long-session games.
- **Duck under what matters:** dialogue (-6 to -10 dB), stingers (the kit ducks 50%), big SFX. In Roblox the cleanest way is the `MusicController:Duck(amount)` call, or wiring SFX into an AudioCompressor sidechain (see `roblox-audio.md`).
- **Leave room for SFX:** gunshots and footsteps live at 1-5 kHz; combat stems that are bright and dense there fight them. The presets keep combat melody in brass/strings (warmer) and let drums carry the energy.
- **Loudness:** all stems together around -16 LUFS integrated, true peak under -1 dBTP (mobile-friendly; console titles mix quieter, around -23/-24 LUFS). Per-stem normalisation would break the balance: level the full mix once.

## 7. Multiplayer and Roblox specifics

- **Music is per player.** Play it on the client. The server only states facts (round phase, boss fight, a player's wanted level) through `MusicService` attributes. Never play music from a server Script: everyone hears the same thing, and nobody's own fight drives it.
- **Shared moments:** a global `MusicService:SetState("boss", 0.6)` gives everyone the boss music; each client still layers by its own intensity.
- **Let players turn it down:** a Music volume slider (`Player.MusicVolume` attribute) and an off switch (`MusicController:SetEnabled(false)`). Many players stream or play their own music.
- **Loading:** stems load on first use. Preload the next likely cue (call `Play` early from a loading screen) or accept that the first switch waits up to `LoadTimeout`.

## 8. Sources

- Rolling Stone, "Inside the 'Grand Theft Auto V' Soundtrack" (Ivan Pavlovich on the interactive stem system): https://www.rollingstone.com/music/music-news/inside-the-grand-theft-auto-v-soundtrack-75495/
- Wikipedia, Music of Grand Theft Auto V: https://en.wikipedia.org/wiki/Music_of_Grand_Theft_Auto_V ; GTA wiki, wanted level soundtracks: https://gta.fandom.com/wiki/Grand_Theft_Auto_Online_Official_Score
- Wikipedia, Music of Red Dead Redemption 2 (Pavlovich: 5 same-key/tempo stems in RDR, 11 without limits in RDR2): https://en.wikipedia.org/wiki/Music_of_Red_Dead_Redemption_2 ; Woody Jackson interview: https://news.yahoo.com/music-red-dead-redemption-2-050000775.html
- Game Informer, "Noises in the Dark: Exploring the Sounds of Dead Space" (fear emitters): https://gameinformer.com/b/features/archive/2009/12/11/feature-noises-in-the-dark-exploring-the-sounds-of-dead-space.aspx ; Music of the Dead Space series: https://en.wikipedia.org/wiki/Music_of_the_Dead_Space_series
- Bethesda, "Inside the DOOM score: Mick Gordon interview": https://bethesda.net/en-US/news/inside-the-doom-score-mick-gordon-interview
- Audiokinetic, "How to Use Interactive Music to Score Gameplay": https://www.audiokinetic.com/en/blog/how-to-use-interactive-music-to-score-gameplay/
- Game Developer, "Composing adaptive music for video games": https://gamedeveloper.com/audio/composing-adaptive-music-for-video-games-using-elias
- Designing Sound, Sony's Garry Taylor on loudness for games: https://designingsound.org/2012/07/30/video-games-and-loudness-standards-interview-with-sonys-garry-taylor/
