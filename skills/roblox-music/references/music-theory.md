# Music theory and arranging cheat sheet for game cues

## Contents
1. Modes and what they feel like
2. Chord progressions by mood
3. Tension and release devices
4. Rhythm and grooves
5. Writing the main melody (motifs, development, forms, fitting chords, counterlines, arpeggios)
6. Arranging stems so every layer works
7. Mixing and levels
8. Working with a composer, a DAW or an AI music tool
9. Performance: what makes it sound played, not programmed
10. Guitar music: acoustic, blues, punk, rock, funk

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
| Build | A snare roll that thickens (8ths, then 16ths) and grows louder into the downbeat | `fx` roll, `intro` one-shot |
| Fill | Toms high to low across the last beat of a phrase | `fx` fill, drum variation every 4 bars |
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

A generic line is chord roots and fifths, every bar the same, notes moving at random. A melody people remember is one idea, developed. This is what the `melody` generator does, in this order. Write it the same way by hand.

### 5.1 The motif
- **3-7 notes, 1-2 bars, a rhythm you could tap.** The rhythm is more recognisable than the pitches; give it one syncopation or a pickup (`CELLS.hook`).
- **A contour, in scale steps,** not a chord shape. The generator's shapes (`contour`):

| Contour | Shape | Feels | Default for |
|---|---|---|---|
| `leap` | jump up a 4th-6th, then step down (leap and fill) | heroic, a call to arms | aeolian, mixolydian, fanfares |
| `arch` | step up to a peak, step down | open, singing | lydian, ionian |
| `valley` | down, then back up | wistful, searching | harmonic minor |
| `rise` / `fall` | mostly up / mostly down, with a turn | hope / sadness | lydian / sad cues |
| `zigzag` | up a 3rd, down a step, repeat (a climbing sequence of 3rds) | restless, clever | dorian |
| `neighbor` | circles one note: up a step, back, below, back | stalking, uneasy | phrygian, locrian |
| `turn` | step up, down, down, then a leap | ornamental, exotic, folk | phrygian dominant, dorian |

### 5.2 Development: never the same thing twice in a row
| Device | What changes | In the generator |
|---|---|---|
| Repetition | nothing (use once, then vary) | `BI` (basic idea) |
| Sequence | same shape from another scale step; the new chord re-colours it | `SEQ` |
| Varied ending (answer) | same start, last 1-2 notes go somewhere new | `VARY` |
| Inversion | contour upside down | `INV` |
| Fragmentation | the first 2 beats only, three times, climbing: the phrase speeds up toward its climax | `CONT` |
| Contrast | new rhythm, opposite contour, higher register | `CI` |
| Cadence | the head of the idea, then a long note on a cadence tone | `CAD` |

### 5.3 Phrase forms (`form`)
- **Sentence** `BI SEQ CONT CAD`: state the idea, state it again on another chord, break it into fragments that climb, then cadence. The drive of action and boss music.
- **Period** `BI CI SEQ CAD`: a question (the idea, then a contrast that stops on a half cadence) and an answer (the idea again, then a cadence). Lyrical and sad cues.
- **AABA** `BI VARY CI CAD`: two statements, a bridge, a return. Songs and lobbies.
- **Call** `BI INV SEQ CAD`: an idea and its mirror image.
- **Hook** (8 one-bar units) `BI VARY BI CI BI VARY CONT CAD`: call and response. The bar comes back four times, never more than once in a row.

### 5.4 Fitting notes to chords
- **Strong beats prefer guide tones (3rds and 7ths), then colour tones (the 9th), then the 5th, last the root.** The 3rd and 7th say which chord it is; the root just doubles the bass.
- **Tensions:** 9ths on major and minor chords, the 11th on minor chords, #11 in lydian. **Avoid notes** are a semitone above a chord tone (the 4th over a major chord, b6 over a minor one, b2 over anything) or a minor 3rd over a major chord: fine in passing, never held on a strong beat unless they resolve.
- **Appoggiatura:** a dissonance *on* the beat that steps onto a chord tone. It is the most expressive note in a melody (the "sigh"), so the generator allows one when the next note resolves it by step.
- **Weak beats:** passing notes (step, step through) and neighbour notes (step away, step back) connect the chord tones.
- **The key's tonic and 5th are cadence notes.** Leaning on them mid-phrase is what makes a line sound generic, so the generator charges extra for them away from cadences. Phrases end on the 2nd, 3rd, 5th or 7th (open, so the loop rolls on); only an `ending: "tonic"` melody closes on 1.
- **Use the mode's colour note** (lydian #4, dorian 6, mixolydian b7, aeolian b6, phrygian b2, harmonic minor's raised 7th). Without it a mode sounds like plain major or minor.

### 5.5 Shape rules
- **Mostly steps, some leaps.** About half the intervals are steps; leaps of a 4th-6th mark the important notes.
- **Gap-fill:** after a leap, change direction, usually by step (Meyer; Narmour; von Hippel and Huron call it regression to the middle of the range). Two leaps in a row in the same direction only to outline one chord.
- **No tritone leaps, no leaps over an octave, few 7ths.**
- **One climax per loop,** about 60-75% through, reached once (the end of the fragmentation in a sentence). Everything else stays a few steps below it.
- **Range:** about a 10th to a 12th. Brass 55-74 (G3-D5), flute 72-91, whistle 72-90, lead synths 60-84, music box 69-93.

### 5.6 The other melodic parts
- **Counterline:** guide tones (3rds, 7ths) that move by step against the melody's direction (contrary motion), below it, with no parallel 5ths or octaves. It moves when the melody holds and holds when the melody moves; passing notes fill the gaps (`counter`).
- **Arpeggios:** each chord enters on the inversion nearest the last one, so the figure keeps its register as chords change, and the 9th (or 7th) adds colour. The figure can be broken thirds, Alberti, 3+3+2 groups across the beat, a pedal tone under a moving top, a cascade or a wave, plus a seeded riff. The last bar of every four mirrors it as a turnaround. Root-3rd-5th-up, repeated, is the most generic sound in game music.
- **Bass:** a one-bar riff on chord degrees (root, octave, 5th, a 7th below) that repeats like a groove, plus an approach note: the last note before a chord change steps into the new root.
- **Leitmotif:** stingers quote the cue's own motif. Victory plays it in the parallel major, in brass 3rds, and lands on the 3rd. Fail plays it inverted and slowed in minor. Discover plays the head on bells and ends on the 9th. Level-up sequences the first three notes up the scale. For a character theme across cues, write it once in a DAW from the MIDI export and reuse it.
- **When not to have a melody:** horror exploration, stealth beds, anything under dialogue. Melody pulls attention.

## 6. Arranging stems so every layer works

Give each layer its own job and register, so adding one never muddies the others:

| Layer (typical intensity) | Job | Register |
|---|---|---|
| Bed (0) | Harmony and space: pad, drone, sustained strings | low-mid, soft attacks |
| Motion (0.15-0.4) | Time: arpeggio, ostinato, shaker, pulse | mid-high, short notes |
| Groove (0.35-0.65) | Energy: drums + bass | low and top end |
| Lead (0.55-0.85) | Identity: the melody or hook | mid-high, one instrument |
| Peak (0.85-1) | Size: counterlines, choir, braams, snare builds, crashes | everywhere, used sparingly |

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
9. Performance: what makes it sound played, not programmed
10. Guitar music: acoustic, blues, punk, rock, funk

The generated stems are a working temp score: right structure, tempo, harmony, layering and levels, synthesized instruments. To go further:
- **DAW:** open the `.mid` (one track per part, General MIDI programs, tempo and loop markers), swap in real instruments, keep the bar length, bounce each stem from bar 1 for exactly the loop length with the tail wrapped onto the start, and check with `analyze`.
- **Composer:** send `BRIEF.md` (written by `render`) plus the MIDI and the rendered stems as a reference. It states tempo, key, loop length, the stem stack with intensity thresholds, one-shots and the delivery spec.
- **AI music generators:** most produce a finished stereo track, not aligned stems; use them for linear pieces (menu, credits) or as inspiration. For adaptive layers you need stems that share one grid: keep using the generated stems, or split a generated track with a stem separator and re-cut it to an exact bar length (then `analyze` it).
- Whatever the source, the Roblox side doesn't change: same `MusicCues` entry format, new asset ids.

## 9. Performance: what makes it sound played, not programmed

Right notes on a perfect grid at one velocity still sound like a demo. Taste lives in how each note is played. `perform.js` does this to every cue, set by the mood's `feel`.

- **Pocket (timing feel).** Players sit in different places against the beat. In blues, soul, funk and lo-fi the snare lands 10-15 ms late and the bass a little late too (`groove: "laidback"`); that drag is the groove. Punk and chases rush a few ms ahead (`push`). Sequenced electronic music stays on the grid (`tight`). Swing (`swing`) is separate: it moves whole off-beats; the pocket moves instruments.
- **Human variation.** Every note a few ms off and a few percent louder or softer (`humanize`), less on downbeats. Kick drums are the steadiest, melodies the loosest. Synths and arpeggiators get a quarter of it.
- **Accents.** Downbeats strongest, beat 3 next, off-beats softest. Uniform velocity is the number one reason programmed music sounds robotic.
- **Phrase dynamics.** A slight swell across every 4 bars, so a phrase has a shape and not just a level.
- **Articulation.** Vibrato that arrives late on long notes; slides into a note after a leap; bends up into a note on guitar and harmonica (`slides`, `bends`). Short notes stay short.
- **Variation.** A drummer never plays the same bar 8 times. The kit adds a kick variation every second bar, a snare pickup and an open hi-hat at the end of every fourth bar, and quiet ghost notes in backbeat grooves. A `fill` or `roll` marks the phrase.
- **Space.** Leave gaps. The blues lead plays in bars 1-2, rests in 3-4, and lets the band answer. Melodies breathe at phrase ends. Layers arrive one at a time.
- **Turnarounds.** A dominant or bVII in the last half bar (`turnaround`) turns "the loop starts again" into "here we go again".

## 10. Guitar music: acoustic, blues, punk, rock, funk

The `guitar` role plays the instrument the way a guitarist does: chord shapes come from a fretboard in standard tuning (open chords low on the neck, barre shapes higher, the root in the bass, at most four fingers, the nearest shape to the last chord). Electric guitars go through an amp after the strings are summed, so power chords growl like one amplifier and not six separate fuzz boxes.

| Style | What it is | Use it for |
|---|---|---|
| Strum | Down-strums on the beat, up-strums between; muted "chk" strokes (`x`); the strum before a chord change already plays the new chord (a push) | acoustic songs, folk, country, pop-rock beds |
| Fingerpick (Travis) | The thumb alternates root and another bass string on every beat; fingers pick the treble strings in between; a pinch on beat 1; occasional hammer-ons | campfire, folk, gentle exploration, sad scenes |
| Power chords | Root, 5th, octave. Palm-muted 8ths (`m`) for the verse, open ringing chords (`O`) for the lift. Two takes panned hard left and right make the wall of sound | punk, rock, metal-lite, sports, races |
| Boogie shuffle | Root-5th / root-6th pairs on a shuffle, with the b7 in alternate bars: the blues and early rock'n'roll engine | blues, roadhouse, noir, western saloons |
| Funk scratch | 16th-note strumming hand, mostly muted scratches, short 9th-chord stabs on the top strings | funk, heists in style, city hubs |

Genre recipes:
- **Acoustic:** 85-110 BPM, major keys guitars like (G, C, D, E, A), I V vi IV or I IV V. Fingerpicking in the bed, strumming one layer up, panned apart. Harmonica, whistle or a fingerpicked melody on top. Laid back, light swing.
- **Blues:** a 12-bar form (I I I I · IV IV I I · V IV I V) in a triplet shuffle at 70-100 BPM. Dominant 7th chords on I, IV and V, and the blues scale for the lead. The lead plays call (bars 1-2), the same call over IV (bars 5-6), an answer (bars 9-11) and a turnaround (bar 12), with space in between: the AAB of a blues verse. Bends into the 5th and the root, a quarter-tone curl on the minor 3rd, vibrato on the last note.
- **Punk:** 160-200 BPM, three or four chords as power chords, a palm-muted verse into an open chorus, the skate beat (kick on the beat, snare on every off-beat) or the punk beat (an offset kick), everything rushing a little. An octave-doubled guitar hook or gang vocals on top.
- **Rock:** 110-140 BPM, mixolydian (I bVII IV) or aeolian. Ringing chords to start, then chugging 8ths with pushes, a singing lead guitar with bends and vibrato, a crash on every phrase.
- **Funk:** 95-115 BPM, one or two chords (i7 IV7 in dorian), the 16th-note scratch guitar, a bass with octave pops and ghost notes, tight horns, the snare a hair late, light 16th swing.

