---
name: roblox-cutscene
description: Cinematic cutscenes, finishers and quick-time events for Roblox built on real film craft - cinematography (shot sizes, angles, lenses in mm converted to FieldOfView per device, composition, dolly / crane / arc / push-in / dolly zoom / snap zoom, rack focus and depth of field), camera operator styles (tripod, Steadicam, handheld, documentary, war-film, drone) with trauma shake, editing rules (180° line, 30° rule, cut on action, pacing) checked automatically, and choreography (blocking, fight phrasing, paired two-character animation). Finishers like Resident Evil 4's stagger kick and suplex, Call of Duty's hold-to-finish from behind, Doom's glory kills and enemy grabs; QTEs like RE4 and Call of Duty struggles (press, timing ring, mash, alternate, hold, sequence, slow motion, fail branches, accessibility modes, latency-fair server judging). Ships a server-authoritative multiplayer Luau kit (scenes as data on a shared clock, local stand-ins so paired animations line up on every screen, letterbox, subtitles, hold-to-skip votes), five finisher moves, two example scenes, Luau tests and a browser previs with a blocking map, timeline and coverage report. Use this whenever the user wants a cutscene, cinematic, intro, boss reveal, story or dialogue scene, cinematic camera, finisher, execution, takedown, glory kill, grab or struggle, QTE, letterbox or subtitles, or asks how to make Roblox scenes look like a movie or AAA game, even if they only say "make the camera do something cool when the boss appears".
---

# Roblox cutscenes, finishers and QTEs

A cutscene is film craft running inside a multiplayer game. This skill brings both: the grammar directors, cinematographers, editors and fight choreographers use (in `references/`), and a kit that turns a scene written in that grammar ("MCU on the boss, low angle, 24 mm, handheld, the roar shakes the camera") into a camera, stand-ins, sound, subtitles, QTEs and server events that play in sync on every client.

## How it works

1. **A scene is data.** A ModuleScript lists marks, actors and tracks: shots, animations, moves (root motion), sounds, subtitles, events, QTEs, shakes, fades, slow motion and hit freezes, all on scene time (`references/scene-format.md`). Finishers are scenes with a `Finisher` block.
2. **Time is a pure function.** `Timeline` answers everything for any time t: camera, actor poses, what fires, what's already playing, fade, letterbox, subtitle, slow-motion mapping. The server and every client compute the same thing from `workspace:GetServerTimeNow()`, so they agree on every frame and seeking (late joiners, QTE branches, retries) is free.
3. **Stand-ins perform.** Each client clones the actors locally and plays the scene on the clones while the real characters wait hidden, anchored and invulnerable. Paired animations (a suplex) line up on every screen, which replicated animations never do. The real characters are moved to where the scene leaves them, so nothing pops.
4. **The server decides.** It fires game events (damage, kills, heals, Essential state changes), judges QTEs (latency-fair), branches, handles skip votes, validates finisher requests.
5. **The rules are checked.** `Coverage` flags crossing the 180° line, jump cuts, flash cuts, pans too fast for no motion blur, unreadable subtitles, QTE windows that are too short or cut during, fail branches with no way back. All shipped content passes it.

## Decide the mode

| The user wants... | Do this |
|---|---|
| A story cutscene / boss intro / cinematic | Write the beat sheet first (`references/choreography.md` §8), pick shots with `references/cinematography.md` (§12 has recipes by moment), write the scene file starting from `Scenes/BossIntro.luau`, run `node scripts/previs.cjs <file>` and look at it, fix coverage warnings, then wire a trigger or `CutsceneService:Play`. |
| An interactive scene with QTEs | `references/qte.md`; start from `Scenes/Ambush.luau` (press with slow motion, mash with drain, fail branches that retry). |
| Finishers / executions / takedowns | `references/finishers.md`; install the kit, tag enemies, tune `CutsceneConfig.Finisher`, add moves from the five shipped ones. |
| An enemy grab with a struggle | `Finishers/Grab.luau` and `FinisherService:Grab(enemy, player)` from the enemy's grab attack. |
| A gameplay QTE (lever, door, grapple) | `QteService:Run(player, spec)` on the server; no scene needed. |
| "Make my camera feel cinematic" | Explain lens choice (Roblox's 70° default ≈ a 14 mm lens), operator style and moves; a short scene or `CinemaCamera` blend for the moment. |
| Review an existing cutscene | Convert it to a scene (or read its code), run the coverage check, critique against cinematography.md and game-cutscenes.md §2–5 (length, skip, subtitles, hand-off). |
| Animations for a scene or finisher | The roblox-animation skill, with the contract in `references/choreography.md` §6 (shared origin, contact frames, end marks). |

Give the user the previs: `node scripts/previs.cjs <Scene> --out <dir>/` writes a self-contained page (lens view with letterbox and subtitles, top-down blocking with the 180° line and camera wedge, timeline in wall time, contact sheet, coverage report). Publish it as an artifact or send the file; the repo's `examples/roblox-cutscene/` has all seven shipped scenes.

## The rules that make it work

1. **Write it like a film, judge it like a game.** Shot sizes, lenses, the line and cutting on action make it read; short length, hold-to-skip, Essential events and fast retries make it playable.
2. **Every camera move has a motive** (a character, a reveal, a feeling); the default is still.
3. **Change the lens from gameplay.** 35–50 mm for people, 18–24 mm for places, 85 mm for intimacy.
4. **Stay on one side of the line**; cross only on purpose (`CrossLine`).
5. **Cut on action, never during a QTE window.**
6. **Stack feedback on contact frames**: freeze, shake, sound, flash, ragdoll.
7. **Never skip state.** Anything the game needs after the scene is an `Essential` server event.
8. **Server decides, clients perform.** Damage, kills, QTE results and finisher choice are the server's; cameras, stand-ins and prompts are each client's.
9. **Respect players**: subtitles with speakers, shake scale, QTE assist modes, hold-to-skip, short finishers.

## The kit

`assets/kit/` follows the `roblox-project-structure` layout (`shared` → `ReplicatedStorage.Shared`, `server` → `ServerScriptService.Server`, `client` → `StarterPlayerScripts.Client`). Services and Controllers start through the scaffold's Loader; it uses the scaffold's `Net` module and the Signal package.

| File | Side | Does |
|---|---|---|
| `shared/Cutscene/CutsceneConfig.luau` | both | Remotes list, lead time, camera, overlay, skip rule, triggers, action → key map, QTE latency, finisher openings and rules. All tuning. |
| `shared/Cutscene/Lens.luau` | both | mm ↔ FieldOfView per aspect, shot sizes, distance for a size, letterbox visible area, dolly zoom, thin-lens depth of field. |
| `shared/Cutscene/Ease.luau` | both | Easing curves, angle blending, Catmull-Rom camera paths. |
| `shared/Cutscene/CameraNoise.luau` | both | Operator styles as deterministic smooth noise; trauma shake. |
| `shared/Cutscene/Shots.luau` | both | Frame / OverShoulder / TwoShot / POV / Path / Static shots, moves, Lock, composition (thirds, Dutch), focus and rack focus. |
| `shared/Cutscene/Timeline.luau` | both | Compiles and validates scenes; camera with blends, styles and shake; actor poses; items between times; seek state; fades, letterbox, subtitles; slow motion and freezes; labels and branches. |
| `shared/Cutscene/Coverage.luau` | both | The film-grammar and playability checks. |
| `shared/Cutscene/Qte.luau` | both | QTE state machine (six types, assist modes, press-rate cap, server judging time). |
| `shared/Cutscene/Finisher.luau` | both | Sides, move filtering and choice, alignment, ground CFrames. |
| `shared/Cutscene/Scenes/` | both | `BossIntro` (cinematic), `Ambush` (interactive, two QTEs, fail branches). |
| `shared/Cutscene/Finishers/` | both | `Kick`, `Suplex`, `BackStab`, `GloryKill`, `Grab`. |
| `server/Services/CutsceneService.luau` | server | Plays scenes on the shared clock: actors frozen and parked, server events, QTEs and branching, skip votes, Essential events, end placement, triggers. `Started` / `Event` / `Ended` signals. |
| `server/Services/QteService.luau` | server | `Begin` / `Run` / `Cancel`; latency-fair judging; assist setting. |
| `server/Services/FinisherService.luau` | server | Openings (Posture), finisher requests, move choice, clearance, alignment, lethal ends, grabs, `Performed` signal. |
| `client/Cutscene/CutscenePlayer.luau` | client | One scene on this client: stand-ins, firing and seeking, camera, overlay, end and corpse handling. |
| `client/Cutscene/Doubles.luau` | client | Stand-ins: clone, hide the real actor, place on marks, play/hold/slow clips, ragdoll. |
| `client/Cutscene/CinemaCamera.luau` | client | Takes and returns the camera with blends, depth of field, pauses the combat kit's camera. |
| `client/Cutscene/CinemaOverlay.luau` | client | Letterbox per viewport, fades, subtitles, flash, skip hint, hide/restore HUD and controls. |
| `client/Cutscene/QtePrompt.luau` | client | Prompt for keyboard / gamepad glyphs / touch, ring, meter, timer, results; sinks the keys it uses. |
| `client/Controllers/CutsceneController.luau` | client | Remotes, hold-to-skip, QTE wiring, the RE4-style finisher prompt, `OnEvent` hooks, `SetShakeScale`, `SetQteAssist`. |

Install steps to give the user:
1. Copy the kit folders into `src` (merge with the scaffold).
2. Add the ten remotes listed at the top of `CutsceneConfig.luau` to `REMOTES` in `src/shared/Net/init.luau` (all `"Event"`).
3. Scenes: put scene modules in `Shared/Cutscene/Scenes`; start them with `CutsceneService:Play(name, { Origin, Actors, Players })` or a part tagged `CutsceneTrigger` with a `Scene` attribute. Scene-only actors: models in `ReplicatedStorage.CutsceneActors` named after the actor's `Template`.
4. Finishers: tag enemies `Enemy` (the combat kit does) or `Finishable`. Postures come from head/leg hits (combat kit), low health, or `FinisherService:SetPosture`. Enemy AI: skip models with the `InCutscene` attribute (one line, `references/finishers.md` §10). Grabs: call `FinisherService:Grab(enemy, player)` from the grab attack.
5. Animations: empty ids play nothing (stand-ins still move with the scene's Moves); add ids from the roblox-animation skill following `references/choreography.md` §6.
6. Settings menu: `CutsceneController.SetShakeScale(0..1)` and `CutsceneController.SetQteAssist("Off" | "Easy" | "Hold" | "Auto")`. Other client input should pause while `Players.LocalPlayer:GetAttribute("InCutscene")`.
7. Test with Test → Clients and Servers and network simulation (`references/game-cutscenes.md` §11).

When writing new scenes, keep the split: data in scene modules, game consequences in server events, look in shots and styles. Run the checks after every change.

## Tools and tests

- `node scripts/previs.cjs <Name | Finishers/Name | path.luau> [--out file-or-dir] [--check]` samples the scene through the real Luau Timeline (luau CLI) and writes the previs page, or with `--check` prints errors and coverage warnings (exit 1 if any). `--all --out dir/` does every shipped scene and finisher plus an index.
- `node tests/run-luau.cjs` runs `tests/Cutscene.spec.luau`: 258 checks of Ease, Lens (optics against known values), CameraNoise, every shot type and move (projected framing, thirds, sizes, letterbox, dolly zoom keeps size), Timeline (slow motion round trips, freezes, seek state, blends, fades, subtitles, trauma), Coverage (each rule fires and stays quiet when deliberate), Qte (every type, assist modes, rate cap, judging), Finisher (sides, RE4/CoD/Doom choices, alignment) and every shipped scene and finisher (compiles, named right, passes coverage). It bundles `tests/RobloxShim.luau` with the kit modules unmodified.
- `node scripts/selftest.cjs` runs the spec, checks the previs builds for every scene, Luau syntax of every kit file, and that references and kit files exist.

All need the `luau` CLI (`brew install luau` or `rokit add luau-lang/luau`).

## Limits to be honest about

- The pure modules are tested in the luau CLI; the Roblox-facing scripts (services, controllers, camera, overlay, stand-ins, prompt) are reviewed and syntax-checked but haven't been run in Studio as part of building this skill. First things to check in play: the camera blend back into your gameplay camera, hiding of the real characters (scripts that reset transparency), and the stand-ins' ground offset on custom rigs.
- Stand-ins are visual: a scene can't be affected by physics in the world, and anything the world should keep (a corpse, a broken door) must be done by server events.
- Roblox has no camera motion blur, no real global time scale and a symmetric depth of field: slow motion is the scene's own clock (the world keeps normal speed), fast pans judder (hence the pan check), and focus effects vary with graphics quality.
- The previs shows blocking, cameras, timing and overlays, not animation clips; mannequins stand in for the actors.
- Branching scenes play their sections in timeline order in the previs; labels, End and Goto markers show which section belongs to which outcome.

## References

- `references/cinematography.md` — shot sizes, angles, lens table per device, composition, camera moves and what they mean, operator styles, focus, coverage and the 180°/30° rules, editing, pacing, light, recipes by moment.
- `references/choreography.md` — blocking and marks, staging, acting beats, fight phrasing and rhythm, selling contact, paired-animation contract, root motion on Roblox, timing sheets.
- `references/finishers.md` — design principles, RE4 / CoD / Doom / Sekiro / Arkham patterns, openings, move choice, camera, contact-frame feel, multiplayer fairness, the kit's flow, writing a move, combat and ragdoll integration, troubleshooting.
- `references/qte.md` — why QTEs fail and when they work, types and their meaning, reaction-time numbers, prompt design, failure design, accessibility (XAG 107), latency-fair multiplayer, kit usage.
- `references/game-cutscenes.md` — kinds of cinematic, when to take control, hand-off in and out, skipping, subtitles and audio, multiplayer and streaming, how the kit runs a scene, Roblox API notes, performance, troubleshooting, test checklist.
- `references/scene-format.md` — every field of a scene and finisher, event names, playing from code, triggers.
