# Motion cookbook

Timing tables and pose recipes. Times assume 30 fps (one frame = 0.033 s). Numbers are starting points; always check them in the storyboard.

Contents: 1. Universal structure · 2. Combat · 3. Sports · 4. Locomotion loops and idles · 5. Acrobatics and advanced moves · 6. R6 translation · 7. Troubleshooting

## 1. Universal structure

| Phase | Purpose | Typical share of the clip | Ease leaving the key |
|---|---|---|---|
| Ready | A stance the move can start from and return to | key 0 | `smooth` |
| Anticipation | Move opposite to the action; coil hips and chest away | 20 to 35% | `in` (accelerate into the action) |
| Action / contact | The moment gameplay cares about | 2 to 4 frames | `out` |
| Follow-through | Momentum carries past the target | 10 to 20%, often with a short hold | `smooth` |
| Recover | Back to ready | 25 to 40% | `smooth` |

- Make the last key `{"copy": "<ready label>"}` so the move blends cleanly with whatever plays next.
- Offset the body parts in time: hips reach their extreme a frame or two before the chest, the chest before the hand. With few keys, fake it by giving the hips most of their rotation at the action key and saving the last third of the arm travel for the follow-through key.
- Keep the head stable. Whatever the chest turns, turn `Head` roughly the same amount the other way.
- Bend the knees. A dead-straight leg (`bend: 0`) under a moving body looks stiff; standing poses read better at 10 to 25.

Standard stances (R15):

- Neutral: `UpperLeg fwd 6, out 4`, `LowerLeg bend 10`, feet `"flat"`, arms `fwd 5, out 8`, `LowerArm bend 15`.
- Athletic: `LowerTorso bendFwd 5`, `UpperTorso bendFwd 8`, `Head bendBack 6`, `UpperLeg fwd 12..30, out 5`, `LowerLeg bend 20..45`, arms `fwd 10, out 12`, `LowerArm bend 35`.
- Fighting (orthodox, left side forward): `LowerTorso turnR 22`, `Head turnL 28`, lead leg `fwd 30, twistOut 15`, `bend 30`; rear leg `back 12, out 12`, `bend 28`; fists up with `UpperArm fwd 35..50`, `LowerArm bend 120..135`. Southpaw: add `"mirror": true` at the top level.

## 2. Combat

Priority `Action` (or `Action2` and up for moves that must override other actions). Add a `Hit` marker at the contact frame; scripts open the hitbox there. For combos, one marker per hit with the `value` naming it.

| Move | Total | Anticipation | Strike | Notes |
|---|---|---|---|---|
| Jab | 0.25 to 0.35 s | almost none | 3 frames | Arm goes straight out (`UpperArm fwd 86, in 20`, `LowerArm bend 5`), shoulder turns in behind it, snaps back along the same line |
| Cross / straight | 0.4 to 0.5 s | 2 to 3 frames | 3 to 4 frames | Rear hip and chest rotate 35 to 50° through the punch; rear foot up on the toes with the leg `twistIn 25` |
| Hook | 0.45 s | 4 frames | 3 frames | Elbow stays bent near 90; `UpperArm fwd 80, out 60` swinging to `in 30`; the torso turn does the work |
| Uppercut | 0.5 s | dip the knees and drop the fist | 3 frames | Legs extend as the fist rises: `UpperArm fwd 20 → 110`, `LowerArm bend 100` throughout |
| Front kick | 0.55 s | chamber: knee up (`UpperLeg fwd 95`, `LowerLeg bend 110`) | 3 frames to `bend 10` | Lean the torso back 10 to 15° as a counterbalance; support foot `"flat"` |
| Roundhouse | 0.6 to 0.7 s | chamber with hip opening | 3 to 4 frames | Root `turnL/R 60 to 90` during the kick, kicking leg `out 70 to 90`, support leg `twistOut` |
| Sword slash | 0.5 to 0.8 s | weapon high or far back, chest coiled | 3 to 4 frames | Blade travels a long diagonal; chest uncoils through 60 to 90°; follow through low across the body |
| Heavy overhead | 0.9 to 1.2 s | long (0.35 s+), rise onto toes | 3 frames | Deep knee bend on impact and a 3 to 5 frame hold before recovery sells the weight |
| Block / parry | 0.2 s in, held | none | n/a | Use `ease: "out"` in; make it loopable if it is held |
| Dodge roll / dash | 0.5 to 0.7 s | 2 to 3 frames | n/a | The controller moves the character; animate the body only |
| Hit reaction | 0.3 to 0.4 s | none: the first frame after 0 is the extreme | n/a | `ease: "out"` from the snap, then drift back. Chest and head whip away from the blow |
| Knockdown | 0.8 to 1.2 s | none | n/a | Root `bendBack` to about 85 with `lift 0`; grounding lays the body on the floor |

Weapons: add a preview prop attached to the hand (R15 `RightHand`, R6 `Right Arm`) so the blade arc can be judged, e.g. `{"type":"sword","size":[0.14,0.5,3.4],"at":"RightHand","offset":[0,-0.2,1.7]}`. Two-handed weapons: pose the off hand near the main hand by reading both hand positions in the report and adjusting until they are within about 0.6 studs.

## 3. Sports

Add a prop for the ball so contact can be verified, and a marker on contact or release for the script that launches the real ball.

**Soccer instep kick (about 1.2 s).** Step and plant the support foot beside the ball (0.3 s) → backswing: kicking `UpperLeg back 45`, `LowerLeg bend 115`, chest turned away, opposite arm out wide (0.47 s) → contact: thigh `fwd 20`, knee still `bend 30`, ankle locked `Foot back 40`, chest over the ball (0.57 s) → follow-through: `UpperLeg fwd 90, in 12`, body up on the support toes → land → recover. Check in the report that the foot's U and F at contact match the ball. Pass: same shape at half the amplitude, strike with `UpperLeg twistOut 60` for the inside of the foot. Header, volley, slide tackle and goalkeeper dives follow the same plan-and-check method; a dive uses `lift` plus root `leanL/R` toward 80.

**Basketball jump shot (about 1.3 s).** Gather with knees at `bend 75` and the ball at the hip → set: ball above the eyes, shooting `UpperArm fwd 105`, `LowerArm bend 105`, `Hand back 70` → take-off (`lift 0.35`, legs straight, toes pointed) → release at the apex (`lift 1.5`): `UpperArm fwd 150`, `LowerArm bend 10`, `Hand fwd 65` (the wrist snap) → hang with the follow-through held → land with knees bending → recover. The ball prop follows `RightHand` until the release key, then flies to a fixed point with `arc`.

**Dribble (loop, 0.5 to 0.6 s).** Low athletic stance, `UpperTorso bendFwd 25`. The dribbling hand pumps from `LowerArm bend 80` down to `bend 25` with `Hand fwd 30` at the bottom; the ball prop alternates between the hand and a floor point `[right, radius, fwd]`. Marker `Bounce` at the floor key.

**Swings and throws (bat, racket, golf club, pitch).** These are the sword slash with a longer wind-up: weight shifts onto the back foot (`moveBack 0.2`, back knee bent), then hips → chest → arm unwind in that order, finishing with the chest turned past the target and the back heel off the floor.

**Catch / save.** Hands lead, eyes follow: reach in 0.15 s with `ease: "out"`, then pull the ball into the body over 0.2 s.

## 4. Locomotion loops and idles

Set `"loop": true`, priority `Movement` (walk, run) or `Idle`. Author half a stride and mirror it:

```json
{ "t": 0,    "label": "contact R", "pose": { ... } },
{ "t": 0.13, "label": "pass R",    "pose": { ... } },
{ "t": 0.27, "copy": "contact R", "mirror": true },
{ "t": 0.4,  "copy": "pass R",    "mirror": true },
{ "t": 0.53, "copy": "contact R" }
```

The last key must equal the first (the report says if the loop does not close).

| Cycle | Stride (two steps) | Key ideas |
|---|---|---|
| Walk | 0.9 to 1.1 s | Legs `fwd 28 / back 22`, opposite arm swing 20 to 25, chest counter-turns 5 to 8 against the hips, heel strike with `Foot fwd 15` |
| Jog | 0.65 to 0.75 s | Lean 8 to 10, elbows `bend 80`, small `lift` on the passing keys |
| Sprint | 0.45 to 0.55 s | Lean 14 to 20, knees drive to `UpperLeg fwd 70` with `bend 100` behind, flight phase `lift 0.3` |
| Idle breathe | 2.5 to 4 s | 2 to 3° on `UpperTorso bendBack`, tiny shoulder rise (`UpperArm out` +2), `ease: "inOut"`; keep the feet `"flat"` |
| Combat idle | 0.8 to 1.2 s | Fighting stance with a 0.1 stud bounce on the knees and small fist circles |

Footstep markers go on the contact keys. Run and walk animations are moved by the controller, so the root stays at `moveFwd 0`.

## 5. Acrobatics and advanced moves

- **Flips.** Root rotation is continuous: front flip `bendFwd` 0 → 360, backflip `bendBack` 0 → 360, side flip / cartwheel `leanR` 0 → 360, spins `turnL` 0 → 360 or 720. Put intermediate keys roughly every 90 to 150° so the path is unambiguous. Tuck in the middle (`UpperLeg fwd 120`, `LowerLeg bend 135`) and open before landing.
- **Jump arc.** Airborne `lift` values should follow a parabola: with take-off at t0 and landing at t1, a key at fraction u between them sits at `apex × 4u(1−u)`. Apex 2.5 to 3 studs suits a 0.5 s flip.
- **Anticipation and landing matter more than the air phase.** Deep crouch with the arms behind (0.25 s), explosive extension, then a landing crouch at `bend 90+` held for 2 to 3 frames before standing.
- **Cartwheel / handspring.** Hands become the lowest point automatically; grounding plants them. Legs `out 60` in a straddle through the vertical.
- **Spin kick, tornado kick.** Root `turn` through 360 with keys every 90 to 120°, kicking leg `out 85` between 180 and 300°, head turns ahead of the body (spotting).
- **Dance and emotes.** Work to a beat: at 120 BPM a beat is 0.5 s (15 frames). Put the accent poses on the beat, use `overshoot` or `elastic` leaving a key for snappy hits, and loop over 4 or 8 beats.
- **Climb, swim, crawl.** `"grounding": "off"` and place the root with `moveUp`; for crawling keep grounding on and pitch the root `bendFwd 80`.
- **Very fast segments.** If the report says a joint turns more than about 75° in one frame, add an in-between key, stretch the segment by a frame, or set `"fps": 60`.
- **Layering.** An animation that names only arm and chest joints exports only those, so it plays over the walk cycle. Use that for reloads, waves, casting and carrying.

## 6. R6 translation

R6 parts: `Torso` (root), `Head`, `Left Arm`, `Right Arm`, `Left Leg`, `Right Leg`. No elbows or knees.

- Take the R15 idea and keep only the upper-limb angles, then enlarge them 20 to 30% and lean on the torso (`turn`, `bendFwd`, `lean`) for expression.
- Rotating the `Torso` swings the legs with it. Counter it on the legs (`Torso bendFwd 15` ⇒ both legs `fwd 15`) if the feet should stay under the body.
- A punch is a straight arm: `fwd 90` with `in 10`, driven by `Torso turn` 30 to 40. A kick is `Leg fwd 80 to 100` with the torso leaning back.
- Crouch substitute: `Torso bendFwd 20` with legs `fwd 20`, split a little (`out 10`).
- Classic R6 swings (the tool slash) are 0.3 to 0.5 s and very snappy; `ease: "out"` on the strike and `overshoot` into the follow-through fit the style.

## 7. Troubleshooting

| Symptom in the storyboard or report | Likely cause and fix |
|---|---|
| Limb points the wrong way | Used `out` where `fwd` was meant, or forgot the parent's rotation. Check the hand/foot position line in the report |
| Forearm passes through the chest | Too much `in` on the upper arm with a bent elbow; add `twistOut` on the upper arm or reduce `in` |
| Elbow or knee bends backwards | Negative `bend` (the report warns). Use positive `bend` only |
| Feet slide (WARN) | The hips moved or turned while both feet stayed down. Lift one foot in an in-between key, or adjust leg angles until the foot's R/F numbers match the previous key |
| Body sinks or pops between keys | A foot switches between `"flat"` and pointed; add a key or give the foot explicit angles on both sides |
| Jump looks floaty | Air time too long for the height. Shorten it or follow the parabola rule above |
| Move has no impact | Keys evenly spaced. Shorten the strike to 2 to 4 frames, lengthen the anticipation, add a 2 to 3 frame hold after contact |
| Loop hitches | Last key is not a copy of the first, or the stride halves are different lengths |
| Animation fights the walk cycle in game | Priority too low, or it animates the legs when it should be upper-body only |
