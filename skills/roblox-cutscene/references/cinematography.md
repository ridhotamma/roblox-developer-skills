# Cinematography for game cutscenes

The film grammar the kit's shot vocabulary is built on, and the numbers behind it. Every rule here has a reason the audience feels even when they can't name it; break a rule on purpose, never by accident (the kit's coverage check flags accidents).

Contents: 1 Shot sizes · 2 Angles · 3 Lenses · 4 Composition · 5 Camera movement · 6 Operator styles · 7 Focus · 8 Coverage and the 180° line · 9 Editing · 10 Pacing · 11 Light and colour · 12 Recipes by moment

---

## 1. Shot sizes

Shot size is how much of a person fills the frame. It sets emotional distance: wide = context and isolation, close = emotion and intimacy. In the kit, `Size` is measured on the actor's height, so it frames a 5-stud R15 and an 11-stud boss the same way.

| Size | Shows | Use it for | Kit |
|---|---|---|---|
| Extreme wide (EWS) | the place; people are specks | establishing, scale, loneliness, aftermath | `EWS` |
| Wide (WS) | whole body, lots of space | where everyone is, entrances, action geography | `WS` |
| Full (FS) | head to toe | body language, fights, a hero pose | `FS` |
| Medium long / cowboy (MLS) | knees up | standoffs, walk-and-talks, weapons on the hip | `MLS` |
| Medium (MS) | waist up | the default for dialogue and reactions | `MS` |
| Medium close-up (MCU) | chest up | conversation with feeling, decisions | `MCU` |
| Close-up (CU) | head and shoulders | emotion, realisation, the line that matters | `CU` |
| Extreme close-up (ECU) | eyes, a hand, a trigger | tension peaks, details, the snap-zoom payoff | `ECU` |
| Insert | an object | the key, the wound, the countdown | `Static` / `Path` on a point |

Rules of thumb:

- **Go tighter as the scene intensifies.** Open wide, settle into mediums, save close-ups for the moment that matters. A scene that is all close-ups has nowhere to go.
- **Change by at least one size when you cut to the same person** (see §8, the 30° rule).
- **Match sizes in shot/reverse shot.** Two people talking get matching sizes and lenses; give one of them a tighter size and the audience reads that person as dominant or more important.

## 2. Angles

| Angle | Kit | Reads as |
|---|---|---|
| Eye level | `Pitch = "Eye"` (0) | neutral, equal |
| Low angle (camera below, looking up) | `"Low"` (-20) or a number | power, threat, heroism: the boss intro |
| Worm's eye | `"Ground"` (-32), clamped to the floor | monumental, giant, a body falling onto the lens |
| High angle | `"High"` (25) | weakness, vulnerability, being watched |
| Overhead / bird's eye | `"Overhead"` (80) | detachment, pattern, fate, a body on the floor |
| Dutch (rolled horizon) | `Roll = 8` | unease, madness, disorientation; 5–15° is plenty |
| Front (Yaw 0) / three-quarter (±30–45) / profile (±90) / from behind (180) | `Yaw` | front is confrontational; three-quarter is the most natural and flattering; profile is detached; behind is "following" or hiding the face |

Yaw follows Roblox angles: positive swings the camera to the subject's **left**, so `Yaw = 35` is front-left three-quarter and `Yaw = -90` is their right profile.

## 3. Lenses

Focal length changes **perspective**, not just zoom: a wide lens close to a face exaggerates the nose and pushes the background away; a long lens far away flattens the face and pulls the background up behind it. Pick the lens for the feeling, then move the camera to get the size.

Kit convention: millimetres are full-frame equivalents across the **width** of the frame (36 mm sensor). Roblox's `Camera.FieldOfView` is **vertical over the whole viewport**, so the kit converts per device every frame (`Lens.VerticalFov`):

| Lens | Horizontal view | Roblox FOV on 16:9 | on a 19.5:9 phone | on 4:3 | Use |
|---|---|---|---|---|---|
| 14 mm | 104° | 71.7 | 61.4 | 87.9 | Roblox's default (70) is this: very wide |
| 18 mm | 90° | 58.7 | 49.6 | 73.7 | establishing shots, cramped rooms, speed |
| 24 mm | 74° | 45.7 | 38.2 | 58.7 | wide with people, low hero angles |
| 28 mm | 66° | 39.8 | 33.1 | 51.5 | action coverage, two-shots |
| 35 mm | 54° | 32.3 | 26.7 | 42.2 | the workhorse: mediums, walk-and-talk |
| 50 mm | 40° | 22.9 | 18.9 | 30.2 | "normal": over-the-shoulder dialogue |
| 85 mm | 24° | 13.6 | 11.2 | 18.0 | portrait close-ups, soft backgrounds |
| 135 mm | 15° | 8.6 | 7.0 | 11.4 | compression, surveillance, heat-haze chases |

Why gameplay looks "gamey" and cutscenes shouldn't: the default 70° FOV is a 14 mm lens. Cutting to 35–50 mm is the single biggest step from "game camera" to "film camera".

Same lens across a dialogue exchange; change lens between scenes or beats, not randomly between cuts.

**Zoom vs dolly**: a zoom (`ZoomIn`) changes focal length with the camera still; everything magnifies equally and it looks like video or documentary (or a deliberate 70s crash zoom with `Ease = "Snap"`). A dolly (`PushIn`) moves the camera; perspective shifts and it feels like *moving towards* the subject. Use the dolly unless you want the zoom's look.

**Dolly zoom** (Vertigo, Jaws): dolly and zoom in opposite directions so the subject keeps its size while the background stretches or compresses. Realisation, vertigo, dread. `Move = "DollyZoom", Amount = 0.45` (final lens multiplier; < 1 = dolly in while zooming out, the Jaws direction). Once per scene, at most.

## 4. Composition

- **Rule of thirds.** Put eyes on the upper third line and the subject on a vertical third, not dead centre (`ScreenX = ±1/3`). Centre framing is for symmetry, authority, confrontation, or a deliberate stare into the lens.
- **Look room / lead room.** Leave space on the side the subject is looking or moving toward. A character looking screen-left belongs on the right third. Cramping the look side on purpose makes them feel trapped.
- **Headroom.** Little space above the head in close shots; the kit's sizes already place the head near the top. Cutting off the top of the head in a CU is normal; cutting the chin is not.
- **Depth: foreground, middle, background.** Something near the lens (a shoulder, a doorframe, a pillar) makes a flat game scene feel deep. Over-the-shoulder shots do this for free; `Offset` or a `Path` past a prop does it on purpose.
- **Leading lines and frames-within-frames.** Corridors, railings and doorways point at the subject.
- **Balance and weight.** A big dark mass on one side needs something on the other; empty space is a choice (isolation).
- **Eyelines match.** In a conversation A looks screen-right, B screen-left; the 180° line (§8) guarantees it.

## 5. Camera movement

Movement should be **motivated**: by a character moving (follow them), by information (reveal it), or by emotion (push in as they realise). Unmotivated movement is noise.

| Move | Kit | Means |
|---|---|---|
| Push in (dolly in) | `PushIn` | realisation, focus, rising tension; the most useful move there is |
| Pull out (dolly out) | `PullOut` | reveal context, isolate, end a scene, "and then we see..." |
| Arc / orbit | `ArcLeft` `ArcRight` | heroism, two characters circling, building tension around a still subject |
| Truck (crab) | `TruckLeft` `TruckRight` | travel alongside, parallax past foreground |
| Pedestal | `PedestalUp` `PedestalDown` | rise with a character standing up |
| Crane | `CraneUp` `CraneDown`, or `Path` | reveal scale, open (down from the sky) or close (up and away) a scene |
| Pan / tilt | `PanLeft` `TiltUp` | follow from a fixed spot, reveal along a line; tilting up a giant |
| Whip pan | a fast `Pan` + `Whip = true`, cut inside it | energy, a jump in place or time |
| Tracking / follow | no `Lock` (the camera rides with its subject) | travel, chases, walk-and-talks |
| Locked / pan-with | `Lock = "Fixed"` / `"Pan"` | the subject moves through a still frame: authority, observation, horror |
| Snap / crash zoom | `ZoomIn` + `Ease = "Snap"` | shock, comedy, a 70s or anime punch |

Speed: a human eye loses detail when the view turns faster than ~120–150°/s without motion blur, and Roblox has no camera motion blur, so fast pans judder. The coverage check flags turns over 150°/s (measured in wall time, so slow motion makes a fast move legal).

Ease: real dollies and cranes start and stop gently (`InOut`, the default). `Out` for a move already running when you cut in, `In` for a move that accelerates into the next cut, `Linear` only for mechanical rigs.

## 6. Operator styles (`Style`)

How the camera is held tells the audience how to feel. The kit's styles are smooth noise on rotation (plus a little drift), deterministic so every client sees the same wobble:

| Style | Real rig | Feels | Use |
|---|---|---|---|
| `Locked` | tripod | calm, authority, observation, dread | dialogue, horror, composed shots |
| `Steadicam` | Steadicam, gimbal | floating, smooth, following | walk-and-talks, reveals, dream calm |
| `Drone` | drone, helicopter | big slow drift | establishing aerials |
| `Handheld` | hand-held | present, human, slightly uneasy | most action cutscenes, intimate drama |
| `Shoulder` | shoulder rig | heavier, more roll | news / found reality, soldiers |
| `Documentary` | reactive operator | catching events as they happen | ambushes, chaos, "we're there" |
| `Combat` | war-film operator | panic, shell shock | explosions, being pinned, near-death |
| `Vehicle` | car mount | engine buzz, bumps | inside or on vehicles |
| `Dream` | slow rolling | unease, underwater, drunk | hallucinations, waking up |
| `FoundFootage` | amateur camcorder | barely framed, frightened | horror POV |

Use `StyleAmount` (0.5 calmer, 2 wilder). The same angular shake looks bigger on a long lens, exactly as with a real camera, so a handheld 85 mm close-up wobbles more than a handheld 24 mm wide.

**Impact shake** is separate: `Shakes = { { At, Trauma } }`. Trauma 0..1 decays linearly; the shake is trauma², so a 0.3 bump is gentle and a 1.0 hit is violent. Players can scale it to zero (`CutsceneController.SetShakeScale`).

## 7. Focus

- **Shallow focus** (long lens, wide aperture) isolates a subject; deep focus (wide lens, small aperture) shows everything at once.
- **Rack focus** moves attention without a cut: `Focus = "A", FocusTo = "B", RackAt, RackTime`.
- Kit: a shot with `Aperture` (f-stop: 1.4 very shallow, 2.8 cinematic, 8 deep) gets a DepthOfFieldEffect whose in-focus band comes from real thin-lens maths (1 stud = 0.28 m, 0.03 mm circle of confusion). Roblox's DoF is symmetric around the focus distance and gets cheaper or disappears on low graphics quality, so never hide story information in focus alone.

## 8. Coverage and the 180° line

**Coverage** is filming a scene from enough angles to edit it: a master (wide, the whole scene), singles on each person, over-the-shoulders, inserts, reactions, cutaways. In a game you author only the shots you'll use, but think in coverage: what's the master, whose single comes when.

**The 180° rule.** Draw a line through the two people in a scene (the axis of action). Keep every camera on one side of it. Then A always looks screen-right and B screen-left, and a cut never flips them. Crossing the line makes the audience feel the characters swapped places. Ways to cross legally:

1. move the camera across the line *in* a shot (a visible dolly or arc),
2. cut to a neutral shot on the line (a head-on single or a POV), then cross,
3. a character walks across the line on screen, which redraws it,
4. a cutaway that resets geography (a wide).

Kit: `Line = { "Hero", "Boss" }` on the scene (or `Line` per shot after the axis changes). The coverage check computes each camera's side from the real poses at every cut. The line runs through the bodies, so when actors swap places (a suplex throw) the check still judges by where they are at the cut.

**The 30° rule.** Two consecutive shots of the same subject must differ by at least 30° of camera angle or by a clear change of size, otherwise the cut looks like a skip in the film (a jump cut). Deliberate jump cuts (time passing, panic) are a style: `JumpCut = true`.

**Screen direction** extends the line to movement: a character running screen-left to right keeps doing so across cuts, or the chase reads as reversing.

## 9. Editing

- **Cut on action.** Cut in the middle of a movement (a punch, a turn, standing up); the motion carries the eye across the cut and hides it. Kit scenes cut on contact frames and dodges.
- **Cut when the information is used up.** A shot lasts until the audience has got it, not until the line finishes.
- **J- and L-cuts.** Let sound lead the picture (hear the roar before we see the boss) or trail it (the line continues over the reaction shot). Subtitles and sounds in the kit aren't tied to shots, so this is natural.
- **Match cut.** Cut between two shapes or movements that match (a spinning coin to a spinning wheel).
- **Smash cut.** A violent cut from loud to silent or calm to chaos, for shock or comedy.
- **Reaction shots** sell events: the hit lands on the attacker's shot, the pain lands on the victim's.
- **Kuleshov effect.** The same neutral face reads as hunger, grief or desire depending on the shot before it; reaction shots borrow meaning from what they follow.
- **Don't cut during a QTE window**: the player loses the thing they're reacting to (the check flags it).

## 10. Pacing

Average shot length (ASL, `Coverage.Pacing`) is the editor's tempo:

| Scene | Typical shot length |
|---|---|
| Fast action, impacts | 0.6–2 s |
| Action with geography (a chase, a finisher) | 1.5–3 s |
| Dialogue | 3–6 s |
| Contemplation, establishing, horror build-up | 5–12 s |

Vary it. Accelerate cutting into a climax and hold a long shot after it. A single unbroken shot (a "oner", God of War 2018's whole game) trades editing power for immersion and needs choreography that moves the camera between beats instead of cutting.

For games, shorter is kinder: every second of cutscene is a second without control. Most story beats land in 10–40 s; finishers in 1–3 s.

## 11. Light and colour

- **Three-point light**: key (main, sets the mood), fill (softens shadows; less fill = more drama), rim/back light (separates the subject from the background). In Roblox: a SpotLight or SurfaceLight parented near the actors for the scene, a rim light behind them, turned on and off by scene events.
- **Low key** (few lights, deep shadow) for horror and noir, **high key** for comedy and cosy.
- **Colour grade per beat**: ColorCorrectionEffect and Atmosphere changes driven by events (the roblox-atmosphere skill has genre presets and a kit for transitions).
- **Silhouettes** for reveals: backlight the boss and hold before showing the face.

## 12. Recipes by moment

| Moment | Shots |
|---|---|
| Boss reveal | EWS crane down (`Path`, 18 mm, Drone) → hero MS three-quarter → OTS onto the boss (50 mm) → boss FS low angle Dutch, handheld, roar + shake → hero CU dolly zoom → two-shot as it charges, slow motion → snap zoom → cut to black |
| Dialogue | establishing WS → matched OTS shot/reverse shot (50 mm, same side of the line) → push to MCU/CU singles as it gets important → a wide to end |
| Ambush | quiet handheld WS → OTS as the threat appears → cut on the dodge (QTE) → documentary mediums → high angle when pinned |
| Death / defeat | slow push-in on the face, then a high-angle pull-out or crane up and away; hold the silence |
| Victory | low-angle hero FS with an arc, then pull out to a wide; music swells |
| Horror scare | locked-off wide holding too long, foreground darkness, then a hard cut to a handheld close-up with the sting on the cut |
| Arrival in a new place | POV or over-the-shoulder entering, then a crane or EWS reveal |
| Realisation | slow push-in on a CU (or a dolly zoom if it's world-shattering) |
