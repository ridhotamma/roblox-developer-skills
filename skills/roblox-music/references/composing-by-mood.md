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
| **Mode** | ionian, mixolydian | ionian, with bVII | dorian, aeolian | phrygian, locrian, harmonic or hungarian minor | aeolian, phrygian, harmonic minor | aeolian, dorian | lydian |
| **Harmony** | I-vi-IV-V, slow changes | I-bVII-IV-I, I-V-vi-IV | i-IV (dorian), pedal point | i-bII (Neapolitan), clusters, tritone, one chord for a long time | i-VI-VII, i-VI-III-VII, i-iv-V | i-VII-VI-IV (dorian: bittersweet), a pedal on the 5th, sus chords | I-II (lydian), I-vii |
| **Rhythm** | swing or straight 8ths, light | march snare, 4/4 pulse | ticking 8ths, syncopated bass, holds | heartbeat, slow dusty trip-hop, metal hits, silence | 16th ostinatos, toms, taiko, four-on-floor | ticking clock, a simple figure repeated, rubato | slow, wide, arpeggios |
| **Bass** | walking, root-fifth | sustained roots | syncopated, plucked | drones, sub pulses | 16th chug, octaves, gallop | sustained | sub, long |
| **Melody** | singable, stepwise, mid-high | big leaps up (5ths, octaves), fanfare | short motifs, chromatic neighbours | none, a detuned music box, or one lonely tremolo-picked guitar line | brass motifs, short, rhythmic | stepwise, falling, long notes; a solo cello, then a violin above | slow, high, wide intervals |
| **Colour** | guitar, marimba, e-piano, warm pads | brass, strings, choir, snare | pizzicato, muted bass, clock tick, tremolo strings | low drones, tremolo clusters, out-of-tune piano, tremolo-picked clean guitar, struck metal, distorted bass, braams | spiccato strings, synth bass, brass, taiko | pipe organ, piano, solo cello / violin, blooming strings, choir | glassy pads, harp, flute, choir |
| **Space (reverb)** | small room | hall | dry-ish, close | huge, dark | medium, punchy | large, soft | huge, bright |

Fast ways to push a mood further:
- **More tension:** add a pedal (one bass note under changing chords), a ticking 8th-note pulse, a minor 2nd or tritone, tremolo strings, take the melody away.
- **More energy:** double the hat/ostinato rate, add toms, raise the bass an octave in the top layer, add a snare roll or tom fill into each 4-bar phrase (`fx` roll / fill).
- **More heroic:** major chord on bVII before I, brass on the melody, a fanfare stinger, a taiko or impact on bar 1.
- **More scary:** detune something that should be in tune (music box -12 to -45 cents), slow down, remove the beat, play clusters with tremolo.
- **More sad:** slower, fewer notes, minor iv, piano alone first, strings only in the top layer.

## 2. The moods

Each preset ships 5 stems ordered by intensity (bed first) and its stingers. `node scripts/compose.cjs show <mood>` prints the chords and the intensity map; the lab plays it.

| Mood | Vibe | Grid | Stems (bed → peak) | Stingers |
|---|---|---|---|---|
| `exploration` | Wide, curious, hopeful | 92 BPM, D lydian, I II vi V | warm pad + sub → harp arpeggio + shaker → half-time groove + bass → flute melody → strings counterline + choir | discover, hit, levelup |
| `action_combat` | Driving, aggressive, heroic danger | 140, D minor, i VI VII i iv V | drone + dark pad → 16th synth-bass ostinato + hats → full drums + spiccato ostinato → brass melody + horn stabs → braams, snare roll | alert, hit, victory, fail |
| `car_chase` | Pulsing sequencer, wanted level | 128, E minor, i VII VI VII | synth sequencer + dark pad → octave bass with pump + 16th hats → chase drums → synth lead hook (delay) → brass tresillo stabs, tom fills | alert, hit, fail |
| `heist_stealth` | Cool, ticking, sneaky | 96, A dorian, i IV i VII | clock tick + dark pad → syncopated plucked bass + pizzicato → tremolo strings + music-box pulse → breakbeat → brass pushes + tom fills (alarm) | alert, discover, fail, victory |
| `horror_dread` | Fog, rust, loneliness: something is here with you | 60, C# phrygian, i (4 bars) bII i | minor-2nd drone + dark pad → out-of-tune piano fragments + tremolo cluster → heartbeat + distant metal-pipe hits → semitone tremolo, fast heartbeat, low cello → braams + industrial metal percussion | jumpscare, tension, fail, discover |
| `horror_chase` | Run | 165, D phrygian, i bII i vii | spiccato ostinato + drone → pounding kick/taiko/toms + metal hits → reese bass chug + distorted-guitar chug → screeching cluster → pounding toms + tom fills | jumpscare, fail, hit |
| `horror_lullaby` | A child's music box in an empty house | 84, 3/4, A harmonic minor | detuned music-box melody → celesta waltz + soft kick → choir + semitone cluster → second, more detuned music box + tritone dark pad → braams | jumpscare, tension, discover |
| `horror_fog` | A town lost in fog: sad more than scary | 76, E minor i VI bII V, light 16th swing, laid back | dark pad + drone → slow dusty trip-hop beat (lo-fi) + sub → lonely tremolo-picked clean guitar (delay) → out-of-tune piano + cello counterline → industrial metal percussion + ringing crunch chords | jumpscare, tension, discover |
| `epic_boss` | Mythic and dangerous | 150, C minor, i VI III VII i VI iv V | choir + drone → taiko ensemble → spiccato ostinato + sub → brass melody + horn counterline → epic drums, braams, choir stabs | alert, hit, victory, fail |
| `cozy_village` | Warm, safe, bouncy | 100, F major, swing | strummed guitar + warm pad → walking pizzicato bass + shaker → lo-fi drums → marimba melody → celesta sparkles + strings | discover, levelup, victory |
| `sad_emotional` | Loss, memory and a little hope | 68, E dorian i VII VI IV | pipe organ holding the 5th (pedal) + organ chords → piano repeating a simple figure → blooming strings + ticking clock → solo cello melody → violin descant above it + choir + low taiko | fail, discover |
| `emotional_epic` | Time running out: sacrifice, distance, hope | 84, A minor i VI VII v | ticking clock + organ pedal → pipe-organ figure repeated in 8ths → blooming strings + sub → solo violin theme rising → full organ, cello counterline, taiko, low impacts | discover, victory, fail |
| `victory_triumph` | You did it | 120, Bb major, I bVII IV I | strings + sub → march snare → brass fanfare → horn counterline → choir + taiko | victory, levelup, hit |
| `cyberpunk_night` | Neon, rain, chrome | 105, A minor | supersaw pad + 8th arp (delay) → octave bass with pump → synthwave drums → lead hook → glass bells, snare roll | alert, discover, hit |
| `scifi_space` | Vast, weightless, alien | 80, E lydian, I II I vii | glass pad + drone → plucked "pinky" arpeggio (delay) → half-time drums + 8th sub → sparse lead → high glass bells + strings | discover, alert, levelup |
| `western_desert` | Sun, dust, a standoff | 100, 12/8 feel, A phrygian dominant | tremolo guitar triplets + drone → gallop percussion + bass → whistle melody → choir + horn → impacts + brass hits | alert, victory, fail |
| `menu_lobby` | Relaxed, friendly lo-fi | 84, F major ii7 V7 Imaj7 vi7, swing | e-piano 7th chords → syncopated sub bass → lo-fi beat → e-piano melody (delay) → celesta + warm pad | levelup, discover |
| `racing_drive` | Foot down, bright and fast | 128, E major I bVII IV I | supersaw pad + 16th arp → offbeat bass with pump → four-on-floor → lead hook → pad stabs, snare roll | hit, victory, levelup |
| `obby_upbeat` | Bouncy, bright, silly | 132, C major I V vi IV | marimba arpeggio → FM octave bass → chiptune drums → square-wave hook → chip counterline + celesta | levelup, fail, victory, discover |
| `battle_lobby_countdown` | Get ready | 120, G minor i VI iv V | clock + dark pad → 8th bass + plucked pulse → snare roll + spiccato → 2-bar snare build + strings → action drums | alert, hit |
| `acoustic_campfire` | Wood smoke, stars and friends | 96, G major, I V vi IV I IV V, light swing, laid back | Travis-picked acoustic + warm pad → strummed acoustic (folk pattern) → folk kit + upright bass → harmonica melody → strings counterline + celesta | discover, levelup, victory |
| `blues_roadhouse` | Smoky bar, slow swagger | 88, A, 12-bar blues in triplet shuffle, laid back | boogie shuffle guitar → shuffle drums + walking bass → organ → lead guitar licks with bends (AAB, turnaround) → horn stabs | hit, victory, fail |
| `punk_skate` | Fast, loud, reckless fun | 184, E major I V vi IV I IV V, pushed | palm-muted power chords (left) → skate beat + 8th bass → open power chords (right) → octave lead-guitar hook → gang-vocal counterline + tom fills | hit, levelup, fail, victory |
| `rock_anthem` | Big, proud, arena lights | 126, D mixolydian I bVII IV I V | ringing crunch chords + pad → rock beat + 8th bass → two driving distorted guitars (L/R) → singing lead guitar → strings, choir, tom fills | hit, victory, levelup |
| `funk_strut` | Cool, sly, in the pocket | 104, E dorian i7 IV7, light 16th swing, laid back | chicken-scratch clean guitar + e-piano → funk bass with ghost notes → funk drums → brass hook + stabs → organ + tom fills | hit, discover, victory |

Why they work (the parts worth copying into custom moods):
- **Combat:** the 16th-note ostinato in the bass (layer 2) is the engine; drums at 0.45-0.6 turn "danger" into "fight"; the melody arrives late (0.7+) so the climax feels earned; braams and snare rolls only at the top.
- **Chase (GTA-flavoured):** the arpeggiated sequencer is there from intensity 0, so even 1 star feels like motion; the sidechain pump on the bass layer gives the "engine" feel; a hook is more memorable at speed than a long melody: one syncopated bar stated, answered with a new ending, contrasted, then broken into climbing fragments (call and response, not the same bar eight times). The sequencer cuts across the beat in 3+3+2 groups.
- **Heist:** dorian's major IV keeps it cool instead of sad; the clock tick is the bed; the brass "alarm" layer only appears when it all goes wrong.
- **Horror dread:** no melody (Dead Space's rule), a minor-second drone, intensity mostly means *closer*: the heartbeat appears at 0.4, a semitone tremolo and a faster heartbeat at 0.65. The jump-scare stinger is a 5-note cluster with a sforzando and an impact; use it sparingly (every scare loses power).
- **Horror chase:** tempo 165, everything low and percussive; screeching clusters at 0.7+. Same key family as horror_dread (phrygian) so the hand-over feels like the same nightmare speeding up.
- **Lullaby:** wrongness = a familiar sound slightly out of tune; the top layers detune further.
- **Horror as sadness (Silent Hill techniques):** the most haunting horror is lonely, not loud. `horror_fog` puts a melancholic, tremolo-picked clean guitar over a slow, dusty trip-hop beat in a minor key with a Neapolitan (bII) for unease, and adds an out-of-tune piano and a cello. Industrial weight comes from struck metal pipes, distorted guitar and distorted bass, never from noise washes. Music plays almost all the time, so silence and a single piano note can carry as much fear as a hit.
- **Emotional (Nolan film techniques):** one simple figure, repeated, with layers added one at a time and octave by octave. That suits vertical stems, because the layering is the drama. A pedal note held on the 5th by the organ keeps the harmony suspended. Strings bloom in instead of attacking. A ticking clock is the pulse. A solo instrument (cello, then violin) carries the tune before the full ensemble arrives. Dorian's major IV turns sad into bittersweet.
- **Cozy:** swing at 20%, walking bass, small room. Nothing above 0.8 intensity is loud: cozy games rarely need a climax.
- **Guitar moods:** the guitar decides the genre more than the drums. Acoustic: fingerpicking in the bed and strumming one layer up, two guitars panned apart. Blues: the boogie (root-5th / root-6th / root-b7th) shuffle is the bed, the 12-bar form does the storytelling, and the lead leaves space between licks for the band to answer. Punk: palm-muted 8ths first, open chords one layer up (the verse-to-chorus lift), everything pushed slightly ahead of the beat. Rock: ringing chords alone, then two distorted guitars hard left and right. Funk: muted scratches and short stabs; the bass's ghost notes and the late snare make the pocket.
- **Victory:** bVII → I is the "triumphant" move in film and games; the fanfare melody opens with a leap and steps back down (leap-and-fill), climbs through a sentence to one high point, and the victory stinger quotes the cue's own motif in the major key, harmonised in thirds.

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
- Stem: `name`, `min`, `full` (intensity range; first stem 0/0), `reverb` 0-1, `delay` `{beats, feedback, mix}`, `pump` 0-0.5 (sidechain breathing), `lofi` (`true` or `{cut, drive, low}`: dusty low-pass and tape saturation, no added noise), `parts`.
- Part `role` and its options:

| role | options | inst (default) |
|---|---|---|
| `drums` | `pattern` (see below), `voices` subset, `fill` (roll in the last bar), `variation` (default on), `ghosts` | kit voices |
| `bass` | `style`: sustain, drone, walking, ostinato16, chug, gallop, eighths, offbeat, octaves, quarters, syncopated, tresillo, funk (16ths with octave pops and ghost notes), 808, halftime, heartbeat; `octave` (2). Rhythmic styles play a one-bar riff (root, octave, 5th, 3rd, 7th below) and step into each new chord | synthbass |
| `pad` | `octave` (4), `voices` (4), `bloom` (notes swell in over half their length) | pad |
| `stabs` | `rhythm`, `octave`, `length` (beats), `bassNote` | brass |
| `arp` | `pattern` broken (thirds), alberti, groups3 (3+3+2), pedal, cascade, wave, spread, motif (seeded riff), auto, or the plain up/down/updown/pinky/random; `colors` 0/1/2 (add the 9th / 9th and 7th, default 1); `rate` (steps), `octave`, `span` (octaves). Chords enter on the nearest inversion; every 4th bar mirrors the figure | pluck |
| `ostinato` | `shape` (chord-tone indices; the seed picks one if absent), `rate`, `accents`, `octave` (3). Every 4th bar the shape turns up a chord tone | spiccato |
| `broken` | `pattern` classic (1 5 10 5), rising (1 5 8 10), nine (1 5 9 10), waltz; `octave`, `rate` | piano |
| `strum` | `rhythm`, `octave` | guitar |
| `pulse` | `rhythm`, `notes` (scale degrees, 0-based), `octave` | musicbox |
| `drone` | `octave` (2), `intervals` ([0, 7]) | drone |
| `cluster` | `octave`, `intervals` ([0, 1, 6, 11]) | tremolo |
| `melody` | `style` motif/hook/fanfare; `form` sentence/period/aaba/call/hook (seeded if absent); `contour` leap/arch/valley/rise/fall/zigzag/neighbor/turn (picked from the mode if absent); `density` sparse/medium/dense; `syncopation` 0-1; `range` [lo, hi] MIDI or `octave`; `phrase` (bars per unit); `ending` open/tonic; `legato` | lead |
| `counter` | `range`, `every` (beats per note), `above` (a descant; by default from the range). Guide tones moving against the melody, on one side of it, with passing notes where it holds | strings |
| `bells` | `chance` per beat, `range`. Colour tones (3rd, 5th, 7th, 9th) with grace notes | bell |
| `fx` | `style` roll (snare build into the phrase, `bars` long), fill (tom fill on the last beat), impact (a low thud), braam; `every` (bars), `bars`, `octave` | (the style) |
| `guitar` | `style` strum (`pattern` folk/pop/ballad/drive/island/country/reggae/shuffle/whole/folk16/strummy16 or a string of D d U u x .), fingerpick (`pattern` travis/roll/ballad/waltz, `palmMute`, `hammers`), power (`pattern` punk/punk_open/drive/rock/anthem/stop/gallop/chug16/pushes or a string of O o m . -), boogie (`palmMute`, `seventh`), funk (`pattern`: 16 chars of X x .); `push` (anticipate chord changes, default on), `center` | acoustic |

Every part also takes `level` (dB vs its role's default), `pan` (-1..1), `detune` (cents, mallets), `humanize` (scales the mood's timing looseness for this part); melodies and counterlines take `tremolo` (beats per repeat, e.g. 0.125: tremolo picking, mandolin style), melodies `octaves: true` (double an octave up) and `style: "licks"` (blues lead from a lick vocabulary; `range`).

Mood-level options:
- `feel`: `{ "groove": "straight" | "laidback" | "push" | "tight", "humanize": 0-1, "slides": 0-1, "bends": 0-1 }`. Laid back puts the snare and bass a few ms late (blues, soul, funk, lo-fi); push rushes slightly (punk, chases); tight is for sequenced electronic music. See `references/music-theory.md` §9.
- `turnaround`: a chord (e.g. `"V7"`) that replaces the second half of the last bar and pulls the loop back to bar 1.
- `oneShotInst`: instruments for the stingers (`brass`, `strings`, `keys`, `bell`, `lead`, `low`), e.g. `{ "brass": "crunchgtr" }` for a guitar victory riff.

- Drum patterns: triphop, industrial (kick, metal, tom), rust (sparse metal), punk, skate, rock, funk, folk, train, four_floor, synthwave, backbeat, halftime, trap, breakbeat, lofi, chiptune, disco, action, action_light, taiko, epic, march, chase, dnb, clock, tick8, heartbeat, heartbeat_fast, horror_pulse, stalk, pound, shuffle, gallop (12 steps), waltz (12), hats16, hats8, shaker16, ride. Voices: kick, snare, clap, rim, tick, hat, openhat, ride, shaker, tom, taiko, metal.
- Rhythm names: ostinato16, chug16, gallop16, eighths, offbeat, quarters, syncopated, tresillo, pushes, stab2, stab_end, trap808, halftime, heartbeat, once, twice, triplet12, or a literal string like `"X..x..x.X..x..x."` (X accent, x normal, - ghost, . rest).
- Instruments: subbass, synthbass, reese, fmbass, bass808, pluckbass, ebass · acoustic, nylon, cleangtr, bluesgtr, crunchgtr, distgtr, leadgtr (electric guitars go through an amp: clean, blues, crunch, distortion, lead) · pluck, harp, guitar, tremguitar, pizz · harmonica · epiano, piano, musicbox, marimba, celesta, bell, organ · strings, tremolo, spiccato, pad, warmpad, darkpad, glass, drone, choir · brass, horn, braam · arp, lead, sqlead, whistle, flute · pipeorgan, cello, violin (solo, expressive) · impact · drum voices (incl. metal: a struck pipe).
- `stingers`: hit, alert, victory, fail, jumpscare, discover, levelup, tension (an intro and an ending are always made unless `"intro": false` / `"ending": false`).

Variation without editing: `--seed` (new motif, form, contour, rhythms, arpeggio riffs, fills), `--key`, `--bpm`, `--bars`, `--progression "i VI III VII"`.

## 4. Pairing cues for hand-overs

| Calm cue | Action cue | Why it works |
|---|---|---|
| exploration | action_combat | D lydian → D minor: same tonic, the mode darkens. Use combat's Ending to come back. |
| horror_dread | horror_chase | Both phrygian; the dread's heartbeat becomes the chase's pounding. Jumpscare stinger on the switch. |
| heist_stealth | car_chase | Stealth goes loud → getaway. Use the alert stinger; render car_chase at 96 BPM (`--bpm 96`) to share the grid and use `Entry = "Match"`. |
| cozy_village / menu_lobby | victory_triumph | Results screens. |
| battle_lobby_countdown | action_combat | Countdown's snare build lands on bar 1 of the match: switch with `Sync = "Phrase"`. |
| scifi_space / exploration | epic_boss | Boss entrance: `Intro = true`, `Sync = "Bar"`, alert stinger. |

Same tempo + same tonic is the smoothest hand-over; same tempo alone lets you keep the bar position (`Entry = "Match"`); different tempos should switch on a bar with an Ending or a stinger covering the seam.
