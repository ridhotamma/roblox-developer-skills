# Music theory and arranging cheat sheet for game cues

## Contents
1. Modes and what they feel like
2. Chord progressions by mood
3. Tension and release devices
4. Rhythm and grooves
5. Writing the main melody (motifs, hooks, leitmotifs)
6. Arranging stems so every layer works
7. Mixing and levels
8. Working with a composer, a DAW or an AI music tool

---

## 1. Modes and what they feel like

Brightest to darkest. All seven are rotations of the major scale; the "colour note" is what makes each one sound like itself, so put it in the melody or the chords.

| Mode | Steps from the root | Colour note | Feel | Game use |
|---|---|---|---|---|
| Lydian | 1 2 3 #4 5 6 7 | #4 | wonder, floating, magic | exploration, space, flying, discovery |
| Ionian (major) | 1 2 3 4 5 6 7 | — | happy, safe, plain | cozy, victory, simulator, kids |
| Mixolydian | 1 2 3 4 5 6 b7 | b7 | confident, bluesy, heroic-casual | racing, adventure, rock |
| Dorian | 1 2 b3 4 5 6 b7 | natural 6 | cool, mysterious, hopeful minor | stealth, heists, fantasy towns, lofi |
| Aeolian (minor) | 1 2 b3 4 5 b6 b7 | b6 | sad, serious, epic | combat, boss, drama, cyberpunk |
| Phrygian | 1 b2 b3 4 5 b6 b7 | b2 | dark, threatening, exotic | horror, villains, deserts, chases |
| Locrian | 1 b2 b3 4 b5 b6 b7 | b5 | unstable, wrong | brief horror moments (no stable tonic chord) |

Others: **harmonic minor** (b6 + natural 7: the major V in a minor key, gothic, "classical villain"), **phrygian dominant** (b2 + major 3rd: desert, flamenco, western standoffs), **hungarian minor** (#4 in minor: ancient, sinister), **whole tone** (dreamy, unreal, flashbacks), **pentatonic** (5 notes, no clashes: folk, Asian-inspired, kids, easy hooks), **chromatic clusters** (horror).

## 2. Chord progressions by mood

Roman numerals as in `moods.json` (upper = major, lower = minor, degrees of the cue's mode).

| Mood | Progressions | Notes |
|---|---|---|
| Epic / heroic minor | i VI III VII · i VI VII i · i iv VI V | The "film trailer" minor. V (major) in minor adds drive back to i. |
| Triumphant | I bVII IV I · I V vi IV · IV V I | bVII → I is the movie-hero cadence. |
| Action | i VI VII i · i i bII i (phrygian) · i:2 VI VII | Fast harmonic rhythm (1 bar) feels urgent. Power chords (`i5`) for rock/metal. |
| Tension / stealth | i IV (dorian) · i bII · i over a held bass (pedal) | Slow harmonic rhythm, or one chord for 4+ bars. |
| Horror | i bII · i:4 bII:4 · i°, clusters | Avoid cadences. Semitone moves in the bass. |
| Sad | i VI III VII · vi IV I V · i iv i V | Minor iv in a major key (I iv I) is instant nostalgia. |
| Calm / cozy | I vi IV V · I iii IV V · I IV I V | Swing and 7ths (Imaj7, vi7) make it warmer. |
| Lofi / lobby | ii7 V7 Imaj7 vi7 · Imaj7 IV7 | Jazz ii-V-I with 7th chords. |
| Wonder | I II (lydian) · I vii (lydian) · IV V iii vi | The major II in lydian is the magic chord. |
| Western | I bII (phrygian dominant) · i bVII bVI V (andalusian) | |

Harmonic rhythm (how often chords change) sets energy as much as tempo: 2 bars per chord = calm or tense, 1 bar = driving, 2 per bar = busy.

## 3. Tension and release devices

| Device | How | In the kit |
|---|---|---|
| Ostinato | One rhythmic figure repeated, pitches re-fitted to each chord (the Hans Zimmer engine) | `ostinato`, `bass` ostinato16/chug |
| Pedal point | One bass note held under changing chords | `drone` |
| Pulse / ticking | Repeated 8ths on one note or a clock tick | `pulse`, drum patterns clock/tick8 |
| Riser | Noise or pitch sweep into a downbeat | `fx` riser, `intro` one-shot |
| Shepard tone | Endless rise (or fall) that never arrives | `fx` shepard (loops seamlessly) |
| Braam | Huge low brass hit, distorted | `fx` braam, alert stinger |
| Clusters / minor 2nds / tritones | Notes a semitone apart, or the b5 | `cluster`, drone `intervals: [0, 1]` |
| Tremolo strings | Fast repeated bowing: nervous energy | `tremolo` |
| Silence before a hit | Drop everything for a beat, then hit | write in a stinger, or Sync a stinger after a duck |
| Metric shift | Half-time drums (same tempo, feels slower and heavier) or double-time | patterns halftime vs chase/dnb |
| Detuning | A familiar sound slightly out of tune | `detune` cents on mallets |
| Release | Cadence to the tonic, major chord, long notes, open space, reverb tail | `ending` one-shot, victory stinger |

## 4. Rhythm and grooves

Step grids, 16 steps per 4/4 bar (`X` accent, `x` hit, `.` rest):

```
four on floor   kick X...X...X...X...  clap ....X.......X...  hat ..x...x...x...x.
backbeat        kick X.....x.X.......  snare ....X.......X...  hat x.x.x.x.x.x.x.x.
half-time       kick X.........x.....  snare ........X.......
action          kick X..x..X...X..x..  snare ....X.......X..x  toms ..........x.x.x.
trap            kick X......x..X.....  snare ........X.......  hat x.x.x.x.xxx.x.xx
taiko           taiko X..X..X.X...X.X.  rim x.x.x.x.x.x.x.x.
heartbeat       kick X..x............
tresillo (3-3-2) X..x..x.X..x..x.     the most useful syncopation in game music
```

Tempo bands: 60-80 slow (horror, sad), 85-105 walking (explore, lobby, stealth), 110-130 moving (racing, victory, chase), 135-150 fast (combat, boss), 160-175 frantic (chase, drum and bass; halftime at 170 feels like 85).

Swing (8th-note, 15-30%) makes calm music friendly and human; never swing combat. Triplet feel (12 steps per bar) = gallop, western, shuffle.

## 5. Writing the main melody

- **Motif first.** 3-7 notes, 1-2 bars, with a recognizable rhythm. Repetition is what makes it memorable: state it, repeat it (on the next chord, fitted to it: a *sequence*), vary it, then answer it.
- **Form for an 8-bar loop:** A (2 bars) · A' (same rhythm, re-fitted) · B (contrast: higher, denser) · A'' (returns, ends on the 5th so the loop leads back to bar 1). The kit's `melody` generator follows this.
- **Hooks** (racing, synthwave, obby): one bar repeated every bar, fitted to each chord. Simple rhythms with one syncopation.
- **Strong beats on chord tones,** weak beats on passing notes. Leaps up feel heroic (4ths, 5ths, octaves), steps down feel sad. After a leap, step back the other way.
- **Range:** keep a melody inside about a 10th; brass 55-74 (G3-D5), flute 72-91, whistle 72-90, lead synths 60-84, music box 69-93.
- **Leitmotif:** give a character or faction 3-5 notes and reuse them in every mood: heroic in the victory cue, minor and slow in the sad cue, distorted in the boss fight. In the kit: same seed + a different mood/key keeps rhythms but not pitches; for a true leitmotif, write it once in a DAW from the MIDI export and reuse it.
- **When not to have a melody:** horror exploration, stealth beds, anything under dialogue. Melody pulls attention.

## 6. Arranging stems so every layer works

Give each layer its own job and register, so adding one never muddies the others:

| Layer (typical intensity) | Job | Register |
|---|---|---|
| Bed (0) | Harmony and space: pad, drone, sustained strings | low-mid, soft attacks |
| Motion (0.15-0.4) | Time: arpeggio, ostinato, shaker, pulse | mid-high, short notes |
| Groove (0.35-0.65) | Energy: drums + bass | low and top end |
| Lead (0.55-0.85) | Identity: the melody or hook | mid-high, one instrument |
| Peak (0.85-1) | Size: counterlines, choir, braams, risers, crashes | everywhere, used sparingly |

Rules:
- The bed is always on and must be the quietest-sounding complete piece of music.
- Never put the only bass note in a high layer; if the groove layer brings a bass, the bed should still have a root (pad bottom note or drone).
- Put the melody high enough in the stack that low intensities can be under dialogue or gameplay.
- Thresholds: leave 0.05-0.15 between one layer's `Full` and the next one's `Min`, so layers arrive one at a time. Cover the whole 0-1 range.
- Each stem is exported as its own file and stems sum in the game: render each with its own reverb tail (no shared bus reverb you can't reproduce in Roblox).

## 7. Mixing and levels

- Full mix (all stems) **-16 LUFS integrated**, **true peak under -1 dBTP**: phones and laptops. A console/PC-first game can mix to -18 to -23 and turn up SFX instead.
- Level the full mix once, not each stem: per-stem normalisation destroys the balance.
- Stingers about 1 LU under the music (the player also ducks the music under them); intro/ending about 3 LU under.
- High-pass everything at ~30 Hz; phones play nothing under ~100 Hz, so make basslines audible through their harmonics (saw/square bass, a little saturation) rather than pure sub.
- Leave 1-5 kHz for footsteps, gunshots and voices in combat: warm the brass and strings (low-pass ~3-4 kHz) and let drums carry the top.
- Check: `node scripts/compose.cjs analyze stems/*.wav --bpm 140 --bars 8` reports loudness, peaks, lengths and loop seams of any stems, generated or not.

## 8. Working with a composer, a DAW or an AI music tool

The generated stems are a working temp score: right structure, tempo, harmony, layering and levels, synthesized instruments. To go further:
- **DAW:** open the `.mid` (one track per part, General MIDI programs, tempo and loop markers), swap in real instruments, keep the bar length, bounce each stem from bar 1 for exactly the loop length with the tail wrapped onto the start, and check with `analyze`.
- **Composer:** send `BRIEF.md` (written by `render`) plus the MIDI and the rendered stems as a reference. It states tempo, key, loop length, the stem stack with intensity thresholds, one-shots and the delivery spec.
- **AI music generators:** most produce a finished stereo track, not aligned stems; use them for linear pieces (menu, credits) or as inspiration. For adaptive layers you need stems that share one grid: keep using the generated stems, or split a generated track with a stem separator and re-cut it to an exact bar length (then `analyze` it).
- Whatever the source, the Roblox side doesn't change: same `MusicCues` entry format, new asset ids.
