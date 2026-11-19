# Composing by mood: recipes for game vibes

## Contents
1. Vibe words → musical decisions
2. The moods (presets) and how each one is built
3. Making a new mood (moods.json schema)
4. Pairing cues for hand-overs

---

## 1. Vibe words → musical decisions

Pin the vibe in one sentence ("relentless, the monster is right behind you"), then decide these in order. The first three do most of the work.

| Decision | Calm / safe | Heroic / triumphant | Tense / suspense | Dread / horror | Aggressive / action | Sad / emotional | Wonder / epic scale |
|---|---|---|---|---|---|---|---|
| **Tempo** | 80-105 | 110-130 | 90-110 (felt slow) | 50-70, or none | 130-170 | 60-80 | 70-95 |
| **Mode** | ionian, mixolydian | ionian, with bVII | dorian, aeolian | phrygian, locrian, harmonic or hungarian minor | aeolian, phrygian, harmonic minor | aeolian | lydian |
| **Harmony** | I-vi-IV-V, slow changes | I-bVII-IV-I, I-V-vi-IV | i-IV (dorian), pedal point | i-bII (Neapolitan), clusters, tritone, one chord for a long time | i-VI-VII, i-VI-III-VII, i-iv-V | i-VI-III-VII, vi-IV-I-V | I-II (lydian), I-vii |
| **Rhythm** | swing or straight 8ths, light | march snare, 4/4 pulse | ticking 8ths, syncopated bass, holds | heartbeat, irregular single hits, silence | 16th ostinatos, toms, taiko, four-on-floor | sparse, rubato feel | slow, wide, arpeggios |
| **Bass** | walking, root-fifth | sustained roots | syncopated, plucked | drones, sub pulses | 16th chug, octaves, gallop | sustained | sub, long |
| **Melody** | singable, stepwise, mid-high | big leaps up (5ths, octaves), fanfare | short motifs, chromatic neighbours | none, or a detuned music box | brass motifs, short, rhythmic | stepwise, falling, long notes | slow, high, wide intervals |
| **Colour** | guitar, marimba, e-piano, warm pads | brass, strings, choir, snare | pizzicato, muted bass, clock tick, tremolo strings | low drones, tremolo clusters, scrapes, shepard tones, braams | spiccato strings, synth bass, brass, taiko | piano, strings, choir | glassy pads, harp, flute, choir |
| **Space (reverb)** | small room | hall | dry-ish, close | huge, dark | medium, punchy | large, soft | huge, bright |

Fast ways to push a mood further:
- **More tension:** add a pedal (one bass note under changing chords), a ticking 8th-note pulse, a minor 2nd or tritone, a rising shepard tone, take the melody away.
- **More energy:** double the hat/ostinato rate, add toms, raise the bass an octave in the top layer, add a riser into each 4-bar phrase.
- **More heroic:** major chord on bVII before I, brass on the melody, a fanfare stinger, crash on bar 1.
- **More scary:** detune something that should be in tune (music box -12 to -45 cents), slow down, remove the beat, play clusters with tremolo.
- **More sad:** slower, fewer notes, minor iv, piano alone first, strings only in the top layer.

## 2. The moods

Each preset ships 5 stems ordered by intensity (bed first) and its stingers. `node scripts/compose.cjs show <mood>` prints the chords and the intensity map; the lab plays it.

| Mood | Vibe | Grid | Stems (bed → peak) | Stingers |
|---|---|---|---|---|
| `exploration` | Wide, curious, hopeful | 92 BPM, D lydian, I II vi V | warm pad + sub → harp arpeggio + shaker → half-time groove + bass → flute melody → strings counterline + choir | discover, hit, levelup |
| `action_combat` | Driving, aggressive, heroic danger | 140, D minor, i VI VII i iv V | drone + dark pad → 16th synth-bass ostinato + hats → full drums + spiccato ostinato → brass melody + horn stabs → braams, risers, crashes | alert, hit, victory, fail |
| `car_chase` | Pulsing sequencer, wanted level | 128, E minor, i VII VI VII | synth sequencer + dark pad → octave bass with pump + 16th hats → chase drums → synth lead hook (delay) → brass tresillo stabs, risers | alert, hit, fail |
| `heist_stealth` | Cool, ticking, sneaky | 96, A dorian, i IV i VII | clock tick + dark pad → syncopated plucked bass + pizzicato → tremolo strings + music-box pulse → breakbeat → brass pushes + riser (alarm) | alert, discover, fail, victory |
| `horror_dread` | Something is here with you | 60, C# phrygian, i (4 bars) bII i | minor-2nd drone + wind → tremolo cluster + detuned music box → heartbeat + dark pad → shepard tone + fast heartbeat → braams, scrapes, low hits | jumpscare, tension, fail, discover |
| `horror_chase` | Run | 165, D phrygian, i bII i vii | spiccato ostinato + drone → pounding kick/taiko/toms → reese bass chug → screeching cluster + scrapes → shepard + crashes | jumpscare, fail, hit |
| `horror_lullaby` | A child's music box in an empty house | 84, 3/4, A harmonic minor | detuned music-box melody → celesta waltz + soft kick → choir + semitone cluster → second, more detuned music box + falling shepard → scrapes, braams | jumpscare, tension, discover |
| `epic_boss` | Mythic and dangerous | 150, C minor, i VI III VII i VI iv V | choir + drone → taiko ensemble → spiccato ostinato + sub → brass melody + horn counterline → epic drums, braams, choir stabs | alert, hit, victory, fail |
| `cozy_village` | Warm, safe, bouncy | 100, F major, swing | strummed guitar + warm pad → walking pizzicato bass + shaker → lo-fi drums → marimba melody → celesta sparkles + strings | discover, levelup, victory |
| `sad_emotional` | Loss and memory | 72, E minor | broken-chord piano → strings → piano melody → cello-range counterline → choir | fail, discover |
| `victory_triumph` | You did it | 120, Bb major, I bVII IV I | strings + sub → march snare → brass fanfare → horn counterline → choir + taiko/crash | victory, levelup, hit |
| `cyberpunk_night` | Neon, rain, chrome | 105, A minor | supersaw pad + 8th arp (delay) → octave bass with pump → synthwave drums → lead hook → glass bells, risers | alert, discover, hit |
| `scifi_space` | Vast, weightless, alien | 80, E lydian, I II I vii | glass pad + drone → plucked "pinky" arpeggio (delay) → half-time drums + 8th sub → sparse lead → shepard + strings | discover, alert, levelup |
| `western_desert` | Sun, dust, a standoff | 100, 12/8 feel, A phrygian dominant | tremolo guitar triplets + drone → gallop percussion + bass → whistle melody → choir + horn → impacts + brass hits | alert, victory, fail |
| `menu_lobby` | Relaxed, friendly lo-fi | 84, F major ii7 V7 Imaj7 vi7, swing | e-piano 7th chords → syncopated sub bass → lo-fi beat → e-piano melody (delay) → celesta + warm pad | levelup, discover |
| `racing_drive` | Foot down, bright and fast | 128, E major I bVII IV I | supersaw pad + 16th arp → offbeat bass with pump → four-on-floor → lead hook → pad stabs, risers, crashes | hit, victory, levelup |
| `obby_upbeat` | Bouncy, bright, silly | 132, C major I V vi IV | marimba arpeggio → FM octave bass → chiptune drums → square-wave hook → chip counterline + celesta | levelup, fail, victory, discover |
| `battle_lobby_countdown` | Get ready | 120, G minor i VI iv V | clock + dark pad → 8th bass + plucked pulse → snare roll + spiccato → 4-bar riser + strings → action drums + crashes | alert, hit |

Why they work (the parts worth copying into custom moods):
- **Combat:** the 16th-note ostinato in the bass (layer 2) is the engine; drums at 0.45-0.6 turn "danger" into "fight"; the melody arrives late (0.7+) so the climax feels earned; braams and risers only at the top.
- **Chase (GTA-flavoured):** the arpeggiated sequencer is there from intensity 0, so even 1 star feels like motion; the sidechain pump on the bass layer gives the "engine" feel; a hook (one bar repeated, re-fitted to each chord) is more memorable at speed than a long melody.
- **Heist:** dorian's major IV keeps it cool instead of sad; the clock tick is the bed; the brass "alarm" layer only appears when it all goes wrong.
- **Horror dread:** no melody (Dead Space's rule), a minor-second drone, intensity mostly means *closer*: the heartbeat appears at 0.4, the shepard tone (an endless rise that never resolves) at 0.65. The jump-scare stinger is a 5-note cluster with a sforzando and an impact; use it sparingly (every scare loses power).
- **Horror chase:** tempo 165, everything low and percussive; screeching clusters at 0.7+. Same key family as horror_dread (phrygian) so the hand-over feels like the same nightmare speeding up.
- **Lullaby:** wrongness = a familiar sound slightly out of tune; the top layers detune further.
- **Cozy:** swing at 20%, walking bass, small room. Nothing above 0.8 intensity is loud: cozy games rarely need a climax.
- **Victory:** bVII → I is the "triumphant" move in film and games; the fanfare melody style uses whole-bar rhythmic cells and chord tones.

## 3. Making a new mood

Add an entry to `assets/moods.json` (or pass `--file my-mood.json` to the CLI), run `node scripts/compose.cjs check`, then `render` / `show`, and `build` to refresh the lab and `MusicCues.luau`.

```json
"jungle_ruins": {
  "title": "Jungle ruins",
  "vibe": "Humid, ancient and watchful",
  "genres": ["adventure", "temple"],
  "bpm": 96, "beatsPerBar": 4, "steps": 16, "bars": 8,
  "key": "E", "mode": "dorian", "melodyScale": "pentatonic_minor",
  "progression": "i:2 IV:2 i VII i:2",
  "swing": 0, "swingGrid": 8,
  "room": { "size": 0.8, "damp": 0.4 },
  "stems": [
    { "name": "bed", "min": 0, "full": 0, "reverb": 0.45, "parts": [
      { "role": "pad", "inst": "warmpad", "octave": 3 },
      { "role": "drums", "pattern": "shaker16", "level": -3 } ] },
    { "name": "drums", "min": 0.3, "full": 0.5, "reverb": 0.25, "parts": [
      { "role": "drums", "pattern": "taiko", "fill": true } ] },
    { "name": "melody", "min": 0.6, "full": 0.8, "reverb": 0.5, "parts": [
      { "role": "melody", "inst": "flute", "density": "sparse" } ] }
  ],
  "stingers": ["discover", "alert"]
}
```

Fields:
- `progression`: roman numerals in the cue's **own mode** (in aeolian, `VI` is the major chord on the 6th degree). Upper case = major, lower = minor; `b`/`#` alter the root; suffixes `°`, `+`, `sus2`, `sus4`, `5`, `7`, `maj7`, `ø`, `add9`; `N` = Neapolitan (bII); `-` = no chord; `:n` = bars (one bar by default). It repeats to fill `bars`.
- `mode` (chords, 7-note): ionian/major, dorian, phrygian, lydian, mixolydian, aeolian/minor, locrian, harmonic_minor, melodic_minor, phrygian_dominant, hungarian_minor. `melodyScale` can also be pentatonic_major, pentatonic_minor, blues, whole_tone, chromatic.
- `steps`: per bar; 16 = straight 16ths, 12 with 4 beats = triplet/12-8 feel, 12 with `beatsPerBar: 3` = waltz.
- Stem: `name`, `min`, `full` (intensity range; first stem 0/0), `reverb` 0-1, `delay` `{beats, feedback, mix}`, `pump` 0-0.5 (sidechain breathing), `parts`.
- Part `role` and its options:

| role | options | inst (default) |
|---|---|---|
| `drums` | `pattern` (see below), `voices` subset, `fill` (roll in the last bar), `crash` | kit voices |
| `bass` | `style`: sustain, drone, walking, ostinato16, chug, gallop, eighths, offbeat, octaves, quarters, syncopated, tresillo, 808, halftime, heartbeat; `octave` (2) | synthbass |
| `pad` | `octave` (4), `voices` (4) | pad |
| `stabs` | `rhythm`, `octave`, `length` (beats), `bassNote` | brass |
| `arp` | `pattern` up/down/updown/pinky/random, `rate` (steps), `octave`, `span` (octaves) | pluck |
| `ostinato` | `shape` (chord-tone indices), `rate`, `accents`, `octave` (3) | spiccato |
| `broken` | `octave`, `rate` | piano |
| `strum` | `rhythm`, `octave` | guitar |
| `pulse` | `rhythm`, `notes` (scale degrees, 0-based), `octave` | musicbox |
| `drone` | `octave` (2), `intervals` ([0, 7]) | drone |
| `cluster` | `octave`, `intervals` ([0, 1, 6, 11]) | tremolo |
| `melody` | `style` motif/hook/fanfare, `density` sparse/medium/dense, `range` [lo, hi] MIDI or `octave`, `phrase` bars, `ending` open/tonic, `legato` | lead |
| `counter` | `range`, `every` (beats per note) | strings |
| `bells` | `chance` per beat, `range` | bell |
| `fx` | `style` riser/swell/crash/impact/braam/shepard/wind/scrape, `every` (bars), `bars`, `octave`, `count`, `down` | (the style) |

Every part also takes `level` (dB vs its role's default), `pan` (-1..1), `detune` (cents, mallets).

- Drum patterns: four_floor, synthwave, backbeat, halftime, trap, breakbeat, lofi, chiptune, disco, action, action_light, taiko, epic, march, chase, dnb, clock, tick8, heartbeat, heartbeat_fast, horror_pulse, stalk, pound, shuffle, gallop (12 steps), waltz (12), hats16, hats8, shaker16, ride. Voices: kick, snare, clap, rim, tick, hat, openhat, ride, crash, shaker, tom, taiko.
- Rhythm names: ostinato16, chug16, gallop16, eighths, offbeat, quarters, syncopated, tresillo, pushes, stab2, stab_end, trap808, halftime, heartbeat, once, twice, triplet12, or a literal string like `"X..x..x.X..x..x."` (X accent, x normal, - ghost, . rest).
- Instruments: subbass, synthbass, reese, fmbass, bass808, pluckbass · pluck, harp, guitar, tremguitar, pizz · epiano, piano, musicbox, marimba, celesta, bell, organ · strings, tremolo, spiccato, pad, warmpad, darkpad, glass, drone, choir · brass, horn, braam · arp, lead, sqlead, whistle, flute · riser, swell, impact, shepard, wind, scrape · drum voices.
- `stingers`: hit, alert, victory, fail, jumpscare, discover, levelup, tension (an intro and an ending are always made unless `"intro": false` / `"ending": false`).

Variation without editing: `--seed` (new melody, rhythms, fills), `--key`, `--bpm`, `--bars`, `--progression "i VI III VII"`.

## 4. Pairing cues for hand-overs

| Calm cue | Action cue | Why it works |
|---|---|---|
| exploration | action_combat | D lydian → D minor: same tonic, the mode darkens. Use combat's Ending to come back. |
| horror_dread | horror_chase | Both phrygian; the dread's heartbeat becomes the chase's pounding. Jumpscare stinger on the switch. |
| heist_stealth | car_chase | Stealth goes loud → getaway. Use the alert stinger; render car_chase at 96 BPM (`--bpm 96`) to share the grid and use `Entry = "Match"`. |
| cozy_village / menu_lobby | victory_triumph | Results screens. |
| battle_lobby_countdown | action_combat | Countdown's 4-bar riser lands on bar 1 of the match: switch with `Sync = "Phrase"`. |
| scifi_space / exploration | epic_boss | Boss entrance: `Intro = true`, `Sync = "Bar"`, alert stinger. |

Same tempo + same tonic is the smoothest hand-over; same tempo alone lets you keep the bar position (`Entry = "Match"`); different tempos should switch on a bar with an Ending or a stinger covering the seam.
