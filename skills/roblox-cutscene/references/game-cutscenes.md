# Game cutscenes on Roblox

How games use cinematics differently from films, and how the kit does it on Roblox: multiplayer, streaming, the camera hand-off, skipping, subtitles, performance and troubleshooting.

Contents: 1 Kinds of cinematic · 2 When to take control away · 3 In and out of gameplay · 4 Skipping · 5 Subtitles and audio · 6 Multiplayer · 7 How the kit runs a scene · 8 Roblox API notes · 9 Performance · 10 Troubleshooting · 11 Test checklist

---

## 1. Kinds of cinematic

| Kind | Control | Examples | Kit |
|---|---|---|---|
| Pre-rendered video | none | old FMV intros | not on Roblox (VideoFrame exists, but in-engine looks consistent and costs less) |
| In-engine cutscene | none (skippable) | Uncharted, The Last of Us story scenes | a scene with the camera for its watchers (`BossIntro`) |
| Interactive cutscene | QTEs | RE4 knife fight, CoD struggles, Telltale | a scene with `Qtes` and branches (`Ambush`) |
| Scripted in-game event | full control, the world performs | Half-Life's scripted sequences, a dragon flying over | no camera takeover: drive NPCs with your AI, or a scene started with `Players = {}` and `Observers = true` |
| Camera hint / "look-at" | full control, the camera is nudged | Uncharted's "look at this" button | outside the kit: a short `CinemaCamera` blend or a gameplay camera bias |
| Paired gameplay animation | brief | finishers, takedowns, grabs | `Finishers/*` |
| One-take | blended | God of War 2018 | long shots with moves and `Blend` between shots instead of cuts |

## 2. When to take control away

Every second without control has to pay for itself. Guidance:

- **Show in gameplay** what the player can do; **tell in a cutscene** only what they can't experience playing (backstory, another place, a character's face).
- **Short and early**: the first minute of a Roblox game decides whether a player stays (roblox-game-design). An intro cutscene longer than ~20 s loses players; make it skippable and keep the first one under 15 s.
- **Letterbox signals "you're not in control"**: use it for real cutscenes, never for finishers or quick camera moments.
- **End on the gameplay camera's terms**: finish the scene with the camera roughly where the gameplay camera will be, so the blend out is short and the player is oriented (looking toward where they need to go).

## 3. In and out of gameplay

- **In**: blend from where the player was looking into the first shot (`BlendIn`, 0.3–0.8 s), or cut through a fade (`FadeIn` with `BlendIn = 0`). A fade is safer when the first shot is far away.
- **Out**: `BlendOut` eases from the last shot into the live gameplay camera (Roblox's or the combat kit's), 0.5–1 s; or `FadeOut` to black then fade back (`Overlay.FadeBackTime`).
- **HUD and controls** are hidden and disabled for camera watchers only, and restored exactly (the kit records which CoreGui types and ScreenGuis were on). Mark a ScreenGui with the attribute `KeepInCutscene` to keep it.
- **Where the player ends up**: the real character is moved (while hidden) to where the scene leaves it, so control resumes in the right place with no pop.

## 4. Skipping

- **Every story scene is skippable**, especially on replay. Unskippable only for a few seconds of essential gameplay instruction, and even then think twice.
- **Hold to skip** (`Skip.HoldTime`, 0.8 s), never tap: a stray key shouldn't throw away a scene.
- **Skipping must not skip state.** Anything the game needs (start the boss fight, open the door, give the item, set the quest flag) goes in an event with `Essential = true`; the server runs every Essential event after the skip point when a scene is skipped.
- **Shared scenes vote** (`Skip.Rule`: `All`, `Majority`, `Any`) and show "Waiting for others (1/3)".
- **Let players rewatch** important scenes from a menu: `CutsceneService:Play(name, { Players = { player }, Origin = ... })`.

## 5. Subtitles and audio

Subtitles (`Subtitles` track, drawn by `CinemaOverlay`), following broadcast practice (Netflix and BBC style guides) and the Game Accessibility Guidelines:

- On by default for cutscenes, with speaker names (colour per speaker in `Overlay.SubtitleSpeakerColors`, plus the name in text).
- At most two lines of ~42 characters; split longer lines into separate subtitles.
- Reading speed ≤ 17 characters per second (the coverage check enforces it), at least 1.2 s on screen, no overlaps.
- A dark box behind the text so it reads on any background, above the letterbox bar.
- Voice lines: put the sound id on the subtitle (`Sound = "rbxassetid://..."`) so they stay together.

Audio:

- **Sound leads picture**: start the roar or the music sting slightly before the cut (an L-cut/J-cut, cinematography.md §9).
- **Music**: trigger cues from scene events (`CutsceneController.OnEvent("BossMusic", ...)`); the roblox-music skill's director switches states on bar lines.
- **Duck the world**: lower ambience during dialogue (a SoundGroup volume tween on a scene event).
- Sounds with an `Actor` play from that actor's stand-in (3D); without one, they play 2D.

## 6. Multiplayer

Roblox games are multiplayer by default, and cutscenes have to answer who sees what:

| Case | Do |
|---|---|
| Personal story beat (one player triggered it) | `Players = { player }`; others see nothing special |
| Group event (a boss intro for the party) | `Shared` trigger or `Players = partyMembers`; skip by vote |
| World event others should see but not lose control for | `Observers = true`: stand-ins play for everyone, camera only for watchers |
| Finisher | camera for attacker and player victim, observers for everyone else in range |
| Late joiner / streamed in late | the scene's start time is on the shared clock; a client that starts late seeks into the scene (animations resume part-way through) |

**Why stand-ins (local clones) instead of animating the real characters**: animations replicate from whoever owns the character (the player's client or the server), each with its own latency, so interacting characters drift apart on other screens. Local clones driven by `workspace:GetServerTimeNow()` line up on every client, can be slowed and frozen together, and nothing replicates. The real characters are anchored, invulnerable (an invisible ForceField) and hidden (LocalTransparencyModifier, reapplied every frame because Roblox's camera scripts reset it on your own character).

**StreamingEnabled**: a client can only clone actors it has streamed in. For scenes away from the players, call `player:RequestStreamAroundAsync(origin.Position)` on the server before `Play`, or give the actor a `Template` (cloned from `ReplicatedStorage.CutsceneActors`, which always replicates). Templates are also how scene-only actors (a boss that doesn't exist yet) appear.

## 7. How the kit runs a scene

```
Server  CutsceneService:Play(scene, opts)
        ├─ compile (Timeline.Compile), refuse with errors listed
        ├─ freeze real actors: anchored, ForceField, InCutscene = id
        ├─ move them (hidden) to where the scene will leave them
        ├─ start time = GetServerTimeNow() + Lead (0.35 s)
        └─ CutscenePlay → watchers (camera) and observers
Client  CutscenePlayer
        ├─ clone stand-ins, hide the real actors, preload animations
        ├─ watchers: hide HUD, disable controls, CinemaCamera.Begin (blend in)
        └─ every frame: t = Timeline.SceneTime(now - start)  (slow motion, freezes)
              hold at an unanswered QTE window end / a Goto
              seek if t jumped, else fire items in (lastT, t]
              place stand-ins, set their rate, camera, letterbox, fade, subtitles
Server  Heartbeat: same t; fires server events (Hit, Kill, Heal, your own), starts QTEs early,
        branches (rebase + CutsceneSeek to everyone), End / Goto, skip votes
End     real actors placed upright at their end pose, unfrozen; ones that end lying down are
        ragdolled briefly (ragdoll kit) so they get up naturally; CutsceneEnd → clients restore
        everything; killed actors' stand-ins stay as corpses until the real body goes
```

Your code hooks in through `CutsceneService.Event` / `opts.OnEvent` on the server and `CutsceneController.OnEvent(name, fn)` on clients; `CutsceneService.Ended` for "after the intro, start the fight".

## 8. Roblox API notes

- **Camera**: `CameraType = Scriptable` while a scene owns it; the kit's render step runs at `RenderPriority.Camera + 5`, after Roblox's camera and the combat kit's camera effects. `FieldOfView` is vertical (1–120). `Camera.Focus` is set to the subject (it guides streaming and level of detail).
- **Depth of field**: `DepthOfFieldEffect` under the camera: `FocusDistance` (0–200 studs), `InFocusRadius` (0–50), `NearIntensity`, `FarIntensity`. It's a post effect and scales with graphics quality.
- **Letterbox**: a ScreenGui with `IgnoreGuiInset = true` and `ScreenInsets = None` so bars cover the notch and the top bar area.
- **HUD**: `StarterGui:SetCoreGuiEnabled(Enum.CoreGuiType.All, false)`, restored per type afterwards.
- **Controls**: `require(PlayerScripts.PlayerModule):GetControls():Disable()`; other input (combat, tools) should check `Players.LocalPlayer:GetAttribute("InCutscene")`.
- **Animations**: loaded on the stand-ins' Animators, `Priority = Action4`; one-shot clips hold their last frame (speed 0 just before the end); `AdjustSpeed` follows slow motion and freezes; seeking sets `TimePosition`. Animation markers are skipped by seeks, so the scene's events (not markers) carry timing.
- **Shared clock**: `workspace:GetServerTimeNow()` on both sides.
- **Cloning player characters**: they aren't Archivable; the kit sets it, clones and restores it.

## 9. Performance

- One clone per actor per client per scene; clones are inert (no collisions, queries or touches; massless) and destroyed at the end.
- Only one camera scene per player at a time; observers far away (`ObserverRange`) skip finishers entirely.
- Preload animation ids during the Lead time (the kit does it); preload heavy sounds and templates with `ContentProvider:PreloadAsync` before triggering long scenes.
- Each frame costs a Timeline evaluation per scene (pure maths, microseconds) plus moving each stand-in's root.

## 10. Troubleshooting

| Symptom | Cause and fix |
|---|---|
| Nothing plays, Output says "has errors" | the scene doesn't compile; run `node scripts/previs.cjs <file> --check` for the list |
| Camera doesn't move, stays on the player | another script sets `CameraType` or `CFrame` every frame after ours; disable it during scenes (`InCutscene` attribute), or raise `Camera.RenderPriority` |
| Camera snaps instead of blending out | another script forced `CameraType` back mid-blend; let the kit restore it |
| Actors appear twice | the client couldn't hide the real character (a script resets transparency); check for scripts writing `LocalTransparencyModifier` or `Transparency` |
| An actor is missing | not streamed in on that client and no `Template`; see §6 StreamingEnabled |
| Stand-ins T-pose / don't animate | empty or wrong animation ids, or ids owned by another account/group (Roblox only plays animations the game's owner can use) |
| Stand-ins pop back to idle at the end of a clip | the clip is looped or `Hold = false`; one-shot clips hold by default |
| Bodies float or sink | marks are ground points; check `Lift`, and the rig's HipHeight (custom rigs without a Humanoid use their bounding box) |
| Scene runs fast on one client | its clock isn't the server's: never use `os.clock()`/`tick()` for scene timing; the kit uses `GetServerTimeNow()` |
| QTE prompt late or missing | the client got `QteStart` after the window opened (high ping); raise `Qte.Lead` |
| Skip does nothing | the scene has `Skippable = false`, the rule needs more votes, or the key is bound elsewhere with higher priority |
| Player stuck frozen after a scene | the server never ended it (an error in your OnEvent hook); hooks run in their own threads, check Output; `CutsceneService:Stop(play)` ends it |
| Fight starts twice / never after skip | put the start in an `Essential` server event, not in a client hook or after a `task.wait` |

## 11. Test checklist

Play with two or three clients (Test → Clients and Servers) and network simulation on:

- [ ] Watchers lose HUD and controls and get them back; observers keep both.
- [ ] Stand-ins line up on every client, including the one that didn't trigger it.
- [ ] Skip works by holding, the vote count shows, Essential events still happen.
- [ ] A QTE succeeds and fails on a laggy client; failure branches and retries work.
- [ ] A player joining or streaming in mid-scene doesn't see real characters frozen in place.
- [ ] Phone (19.5:9), tablet (4:3) and ultrawide: letterbox, subtitles and framing hold.
- [ ] Camera shake at 0 and subtitles on for accessibility.
- [ ] The scene ends with the player where they should be, facing the right way.
