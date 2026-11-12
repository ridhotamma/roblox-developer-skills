# Level design

## Contents
1. Roblox metrics (avatar, movement, camera)
2. Jump maths for obbies and platforming
3. The spawn and the hub
4. Critical path, landmarks, wayfinding
5. Teach → test → twist
6. Pacing and the intensity curve
7. Checkpoints and failure
8. Gating and the visible goal
9. Multiplayer / PvP layout
10. Blockout workflow and the level spec

---

## 1. Roblox metrics

Defaults for a new experience (check the game's own settings; many games change them, and every number below scales with them):

| Thing | Default | Design consequence |
|---|---|---|
| Walk speed | `Humanoid.WalkSpeed` = 16 studs/s | 100 studs takes ~6 s to cross. On a first visit, never more than ~10 s (≈160 studs) of walking without something to see or do. |
| Jump height | `Humanoid.JumpHeight` = 7.2 studs (JumpPower 50) | Ledges up to ~5 studs are comfortable, 6–7 need precise timing. |
| Gravity | `Workspace.Gravity` = 196.2 studs/s² | Airtime of a flat jump ≈ 0.54 s. |
| Character height | ≈ 5 studs (R15 default, varies with avatar scale) | Doors ≥ 8 studs tall (hats, big avatars), ≥ 5 wide; 8+ wide for busy routes. |
| Root part footprint | 2 × 2 × 1 studs | Platforms narrower than 2 studs are "precision" platforms. |
| Camera | third person, starts ~12.5 studs away, max zoom 128 by default | Interiors need height (≥ 12–15 studs) and width or the camera pops into walls; tight indoor games often lock or shorten zoom on purpose. |
| Touch controls | thumbstick bottom-left, jump bottom-right | Keep in-world prompts and UI clear of those corners; precision jumping is harder on touch, so tune obbies for phones. |

Avatars vary (scale, R6 vs R15, emotes, accessories). Either force a consistent rig and scale in Game Settings → Avatar for skill-based games, or leave margin in every dimension.

## 2. Jump maths

With jump take-off speed `v0 = sqrt(2 · g · h)` (≈ 53.2 studs/s for defaults) and walk speed `s`:

```
airtime landing Δy higher:   t = (v0 + sqrt(v0² − 2·g·Δy)) / g
horizontal reach:            d = s · t
```

| Landing height vs take-off | Airtime | Reach (centre travel) | Comfortable gap (edge to edge) | Hard gap |
|---|---|---|---|---|
| 4 studs lower | 0.61 s | 9.7 studs | 7 | 10 |
| same height | 0.54 s | 8.7 studs | 6 | 9 |
| 2 studs higher | 0.50 s | 8.0 studs | 5 | 8 |
| 4 studs higher | 0.45 s | 7.2 studs | 4 | 7 |
| 6 studs higher | 0.38 s | 6.1 studs | 2 | 5 |

The player can take off with the root part partly over the edge and land with it partly on the platform, so the real edge-to-edge maximum is roughly reach + 1. "Comfortable" leaves margin for phones and lag; "hard" is for late stages only. If the game changes WalkSpeed or JumpHeight, recompute (ask, or compute it for them).

Obby difficulty knobs, roughly from easiest to hardest: gap length, platform size, height change, moving platforms (speed, pattern predictability), timing hazards (kill bricks that toggle), narrow beams, wall-hops/truss tricks, conveyor/ice, combinations. Raise one knob at a time.

## 3. The spawn and the hub

The spawn is the most-seen place in the game. Design it like a title screen you can walk in.

- **Composed first view**: spawn facing the main attraction (the first objective, a dramatic landmark, the giant locked world). Check it at phone aspect ratio.
- **One obvious first action** for new players; other options visible but quieter.
- **Short distances**: the most-used destinations (shop, first area, upgrade station) within ~5 s walk; place a teleport pad or button for anything farther.
- **Uncluttered**: no dense decoration around spawn; it costs load time and hides affordances.
- **Social stage**: a hub where players naturally see each other (and each other's rare items, pets, ranks) is free marketing for the long-term goal.
- **Safe**: no damage, no PvP, no griefing at spawn. Spawn protection when spawning into PvP.
- **Multiple SpawnLocations** to avoid stacking, all facing the action.

## 4. Critical path, landmarks, wayfinding

- **Critical path**: the route the designer intends. Make it the most readable route (wider, brighter, more detailed) and make optional routes clearly optional (narrower, darker, reward at the end).
- **Landmarks**: large unique silhouettes visible from most of the map (a tower, a volcano, a giant tree). Players orient by them; put important destinations at or near them. A distant landmark at the end of the critical path is the classic "weenie" that pulls players forward.
- **Breadcrumbs**: collectables along the path (coins in a line lead the way while rewarding movement).
- **Sightlines**: frame the next objective through arches, gaps, corridors. Reveal big spaces after a narrow passage for impact.
- **Readability**: big shapes and strong value contrast read on small screens. Interactive things should look interactive (consistent color/material/glow); decoration should not.
- **Consistent visual language**: one color for danger (kill parts), one for safety (checkpoints), one for interactables. Never break it.
- **Lighting**: brighter and warmer toward goals; darker away. Use `Atmosphere` and fog to give depth and hide far streaming boundaries.

## 5. Teach → test → twist

The standard sequence for introducing any mechanic, used in obby stages, levels, boss fights and tutorials:

1. **Teach**: the mechanic alone, in a safe space, where failure is free and success is nearly guaranteed. (A wide moving platform over a floor.)
2. **Test**: the same mechanic with stakes. (The moving platform over a kill floor.)
3. **Twist**: the mechanic combined with something known, or in an unexpected way. (Two moving platforms out of sync; a moving platform under a swinging hazard.)
4. *(optional)* **Conclude/master**: a short climax using everything, then a reward and a rest.

One new mechanic per sequence. A level is a series of these, with rests between.

## 6. Pacing and the intensity curve

Plot intensity (difficulty, threat, action) over time for any level, round or session. Good curves are **saw-tooth rising**: tension up, peak, release (reward, safe area, view), slightly higher next peak.

- Rest beats after peaks: a checkpoint with a view, a shop, a cutscene-free reward moment.
- The first peak is low and early; the biggest is near the end.
- For round-based games, script the round: setup (≤ 15 s), build-up, climax (final 30 s, sudden death, shrinking zone), resolution (results screen ≤ 10 s, then straight into the next round).
- For horror, the curve is the whole design: long build-ups, short spikes, real rests, and never the same scare twice.

Write pacing as a table: `beat | duration | intensity 1–5 | what happens | reward`.

## 7. Checkpoints and failure

- Failure should cost **seconds**, not minutes. Checkpoint every 30–60 s of expected play (obby: every stage or every 3–6 jumps early on, longer later).
- Respawn instantly near the failure point; keep momentum (no long death screens).
- Show progress persistently (stage number, % of the course), and save it.
- Offer a skip (paid or earned) only for optional difficulty, never as the intended way through. If many players buy skips at the same stage, that stage is badly tuned, not well monetized.
- Track deaths per checkpoint; the outliers are the stages to fix first.

## 8. Gating and the visible goal

- **Visible but locked** content motivates more than hidden content: a glass wall to the next world, a gate with the price on it, a boss visible across a chasm.
- **Soft gates** (difficulty, cost) are better than hard gates (time locks) for retention early; time gates fit daily/session loops later.
- Put the price and a progress bar on the gate itself.
- Each new zone should change at least two of: look, verb modifier, enemy/hazard types, reward scale, music.

## 9. Multiplayer / PvP layout

- **Time to first engagement** 10–20 s from spawn for action games. Too big a map for the player count = empty, boring rounds; too small = spawn chaos. Support dynamic play areas (shrinking zone, closing doors) if player counts vary.
- **Lanes**: three-lane layouts (two flanks and a centre) with connectors give choices without confusion.
- **Cover**: half cover below head height (~3 studs) for peeking, full cover ≥ 6 studs. Break long sightlines unless long-range weapons are the point.
- **Spawn safety**: spawns out of enemy sightlines, multiple spawn points chosen away from enemies, brief spawn protection (3–5 s, ended early by attacking).
- **Chokepoints** create fights; give each one an alternate route so it doesn't become a permanent stalemate.
- **Symmetry** for competitive fairness; asymmetry for objective modes (attack/defend), balanced by testing win rates per side.
- **Verticality** adds depth but costs readability on phones; use it deliberately.

## 10. Blockout workflow and the level spec

1. **Paper/diagram**: the beat list (pacing table) and a top-down sketch with the critical path, landmarks and gates.
2. **Blockout** in Studio with plain parts, one material per meaning (e.g. grey = walkable, red = kill, yellow = interactable, blue = water). Use the metrics above. No art yet.
3. **Playtest the blockout** (yourself, then others): time each beat, record deaths and confusion points, check the first view at spawn on a phone.
4. **Iterate** until the beats hit their target times.
5. **Art pass** that preserves readability (keep the color language; decorate away from the path).
6. **Performance pass**: StreamingEnabled, part count and unique meshes per area, test on a low-end phone.

Level spec format to deliver:

```
Name / purpose:      what this level teaches or tests; where it sits in progression
Player state:        abilities and upgrades the player has on entry
Critical path:       start → beat → beat → end, with target time per beat
Beats table:         beat | duration | intensity | mechanic (teach/test/twist) | reward
Landmarks:           what is visible from where
Dimensions:          key gaps, heights, widths in studs (from the metrics tables)
Checkpoints:         where, how often
Exit/hook:           what pulls the player into the next level
Playtest checks:     what to watch for (times, deaths, confusion points)
```
