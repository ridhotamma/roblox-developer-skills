# Music brief: Action combat (`action_combat`)

**Vibe:** Driving, aggressive, heroic danger: a mission shootout or an arena fight.

**Use for:** shooter, battlegrounds, action, gta-style mission.

## Grid

- Tempo **140 BPM**, **4/4**, key **D aeolian**.
- Loop: **8 bars = 13.714 s** (658286 samples at 48 kHz). Every stem exactly this long.
- Progression: `i:2 VI VII i:2 iv V` (one chord per bar unless marked).

## Stems (vertical layers, bottom to top)

| Stem | Fades in at | Full at | Contents |
|---|---|---|---|
| bed | 0 | 0 | drone on drone; pad on darkpad |
| pulse | 0.2 | 0.35 | bass (ostinato16) on synthbass; drums (action_light) on kit |
| drums | 0.45 | 0.6 | drums (action) on kit; ostinato on spiccato |
| brass | 0.7 | 0.85 | melody on brass; stabs on horn |
| peak | 0.9 | 1 | fx (braam) on braam; fx (roll) on roll |

Any combination of stems from the bottom up must sound finished: the bed alone is the calm version, all stems together the climax.

## One-shots

- **alert** (stinger): 4 beats (1.71 s) + natural tail, in key, lands on a beat.
- **hit** (stinger): 2 beats (0.86 s) + natural tail, in key, lands on a beat.
- **victory** (stinger): 5.5 beats (2.36 s) + natural tail, in key, lands on a beat.
- **fail** (stinger): 6.25 beats (2.68 s) + natural tail, in key, lands on a beat.
- **intro** (intro): 4 beats (1.71 s) + natural tail; its last beat leads into bar 1 of the loop.
- **ending** (ending): 8 beats (3.43 s) + natural tail; starts on a bar line, ends the cue.

## Delivery spec

- WAV or FLAC, 48 kHz (or 44.1 kHz), 16 or 24-bit, stereo. No MP3 for loops (encoder padding breaks the seam).
- Every stem starts on the downbeat of bar 1 and is exactly the loop length; render the reverb/delay tail of the last bar onto the start (print the loop twice and keep the second pass, or wrap the tail).
- Mix level: all stems together around **-16 LUFS integrated**, true peak under **-1 dBTP**; stems keep their relative levels (don't normalize each one).
- One-shots: start at sample 0 (intro: its downbeat hit is at the end), trailing silence trimmed.
- File names: `action_combat_<stem>.wav`, `action_combat_<one-shot>.wav`.
- Roblox limits: 7 minutes, 20 MB, 48 kHz max per file; upload with the Asset Manager's bulk import.
