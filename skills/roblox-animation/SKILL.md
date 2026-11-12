---
name: roblox-animation
description: Design, preview and export Roblox character animations for R6 and R15 avatars. Turns a described motion (combat moves like punches, kicks, sword slashes, dodges; sports like a soccer kick, basketball shot or dribble; locomotion loops, emotes, dances, flips and other acrobatics) into a 3D-previewed motion with an interactive viewer and storyboard, then generates baked keyframes as a KeyframeSequence (.rbxmx file and a Studio command-bar script). Use this whenever the user wants a Roblox animation, keyframes, a KeyframeSequence, Motor6D poses, an attack / emote / idle / run cycle for a Roblox rig, or asks to fix or retime an existing one, even if they only say "make my Roblox character do X".
---

# Roblox animation (R6 / R15)

You author a motion as a small JSON **motion spec**: a handful of key poses written in anatomical terms ("right upper arm 90° forward", "knee bent 60°"). The bundled engine does everything that is error-prone by hand: Roblox joint maths for both rigs, interpolation, keeping feet on the floor, a 3D previewer, sanity warnings, and the baked keyframe export.

The user judges the result by watching it, so the loop is: **plan the phases → write the spec → build → look at the storyboard yourself → fix → deliver preview + keyframes.** Do not skip the looking step; pose numbers that seem right on paper are often visibly wrong (an arm through the chest, a kick that never reaches the ball).

## Workflow

1. **Pin down the motion.** Rig (R6 or R15; ask only if it truly cannot be inferred, otherwise default to R15 and say so), handedness, looping or one-shot, rough duration, and what gameplay hooks are needed (hit frame, ball release, footsteps). Start building straight away for a clear request.
2. **Break it into phases** before writing numbers. Almost every action is: ready → anticipation → action → follow-through → recover. Read `references/motion-cookbook.md` for the genre you are doing (combat, sports, locomotion loops, acrobatics, R6 specifics); it has timing tables and pose recipes.
3. **Write the spec** to `<name>.json`. Start from the closest file in `examples/` rather than from nothing.
4. **Build:** `node <skill>/scripts/ranim.cjs <name>.json --out out` (several specs can be passed; they become tabs in one preview). Needs only Node, no packages.
5. **Read the report** printed on stdout. It lists where the head, hands and feet actually are at every key (studs: R = to the character's right, U = above the floor, F = in front) and prints `WARN` lines. Use the positions to check intent: is the fist really in front of the chest, is the foot at ball height?
6. **Look at `out/storyboard-<Name>.png`** with the Read tool (every key from a 3/4 view and a side view). If no PNG was produced, screenshot `out/preview.html` with a headless browser or read the SVG. Compare each panel with the phase you intended.
7. **Fix and rebuild** until the poses read clearly and the warnings are gone or consciously accepted. Two or three rounds is normal.
8. **Deliver:** the interactive `out/preview.html` (publish it as an artifact or send the file), plus `out/<Name>.rbxmx` and `out/<Name>.lua`. Show the storyboard image inline if you can. Tell the user briefly how to get it into Studio (below) and which animation events exist.

## Motion spec

```json
{
  "name": "JabCross",            // becomes the KeyframeSequence name and file name
  "title": "Jab-cross combo",    // shown in the previewer
  "rig": "R15",                  // "R15" or "R6"
  "priority": "Action",          // Idle | Movement | Action | Action2..4 | Core
  "loop": false,
  "description": "One or two sentences shown beside the preview.",
  "keys": [
    { "t": 0, "label": "guard", "note": "Shown in the phase list.",
      "pose": { "UpperTorso": { "turnR": 10, "bendFwd": 8 },
                "LeftUpperArm": { "fwd": 50, "out": 8 }, "LeftLowerArm": { "bend": 120 },
                "LeftFoot": "flat" } },
    { "t": 0.1, "label": "jab", "ease": "out", "copy": "guard",
      "pose": { "LeftUpperArm": { "fwd": 86, "in": 22 }, "LeftLowerArm": { "bend": 6 } } },
    { "t": 0.8, "label": "recover", "copy": "guard" }
  ],
  "markers": [ { "t": 0.1, "name": "Hit", "value": "jab" } ],
  "props": [ { "type": "ball", "radius": 0.6, "color": "#e07a2c", "keys": [ ... ] } ]
}
```
(Comments are for explanation only; the file must be plain JSON.)

Optional top-level fields: `fps` (default 30; use 60 for very fast moves), `duration` (defaults to the last key), `grounding` (`"off"` to control height by hand), `mirror: true` (flip the whole clip left/right, e.g. a left-footed version), `endKeyframe: true`.

### Keys

- `t` seconds (snapped to a frame). The first key is at 0.
- `pose` maps joint name → channels in **degrees**. A joint left out of a key is simply interpolated through that key, so in-between keys can mention only the joints that matter. A joint never mentioned stays at rest and is not exported; one first mentioned after key 0 starts from rest (0°).
- `copy`: an earlier key's label or index. The pose starts as a copy and `pose` overrides parts of it. `"mirror": true` with `copy` swaps left and right, which is how walk/run cycles are made from half a stride.
- `ease` shapes the segment **leaving** this key: `smooth` (default, eases naturally without overshoot), `linear`, `in` (starts slow, ends fast: wind-ups releasing into a strike), `out` (starts fast, settles: impacts), `inOut`, `hold`, `overshoot`, `anticipate`, `bounce`, `elastic`.
- `lift`: height in studs of the lowest body point above the floor at this key (default 0). This is how jumps are made; see Grounding.

### Joints and channels

Angles are anatomical and the same word means the same thing on both sides of the body, so a mirrored pose needs no sign changes. Each channel has an opposite-direction alias; use whichever reads naturally.

| Joints | Channels (alias for the opposite direction) |
|---|---|
| Root: `LowerTorso` (R15), `Torso` (R6) | `bendFwd` (`bendBack`), `turnL` (`turnR`), `leanR` (`leanL`), `moveFwd` (`moveBack`), `moveR` (`moveL`), `moveUp` (`moveDown`) in studs |
| Spine: `UpperTorso`, `Head` | `bendFwd` (`bendBack`), `turnL` (`turnR`), `leanR` (`leanL`) |
| Upper limbs: `Left/RightUpperArm`, `Left/RightUpperLeg`; R6 `Left Arm`, `Right Arm`, `Left Leg`, `Right Leg` | `fwd` (`back`) swings the limb forward/up, `out` (`in`) away from / across the body, `twistOut` (`twistIn`) rolls it about its own length |
| `Left/RightLowerArm`, `Left/RightLowerLeg` | `bend`: elbows and knees in their natural direction (0 = straight) |
| `Left/RightHand`, `Left/RightFoot` | `fwd` (`back`), `out` (`in`), `twistOut` (`twistIn`). Feet also accept the string `"flat"` |

Landmarks: arm `fwd: 90` points straight ahead, `fwd: 180` straight up, `out: 90` is a T-pose. Leg `fwd: 90` is a waist-high front kick. Rotations compose parent-to-child, so the chest's turn carries the arms with it; turn the `Head` the opposite way to keep the eyes on the target.

R6 has six parts and no elbows, knees, hands or feet, so the silhouette comes from the torso and whole-limb angles; exaggerate a little. R6 limb names contain a space (`"Right Arm"`).

### Grounding

By default the engine lowers or raises the root every frame so the lowest point of the body sits exactly `lift` studs above the floor. Consequences:

- Crouches, lunges and splits automatically drop the hips; never hand-tune hip height for a standing pose.
- `"flat"` on an R15 foot solves the ankle so the sole lies flat whatever the leg is doing. Use it for every planted foot; give explicit angles (`"back": 40` = toes pointed) for feet in the air or up on the toes.
- A jump is `lift` values on the airborne keys (take-off small, apex largest, 0 on landing). Body rotation in the air goes on the root: a backflip is the root's `bendBack` running 0 → 360 across the keys (angles are continuous, so 360 is a full turn, not "back to 0").
- `moveUp` on the root is ignored while grounding is on. Set `"grounding": "off"` only for things like swimming or climbing where the floor is irrelevant.
- In-game jumps and dashes are normally moved by the character controller, not the animation. For an animation meant to play *during* a gameplay jump, pose the body and leave `lift` at 0. Use `lift` and `moveFwd` for self-contained emotes, attacks with a hop, and flips. If the clip ends displaced from where it started the report warns, because Roblox snaps the body back when the track stops.

### Markers and props

- `markers` become `KeyframeMarker`s, read in game with `track:GetMarkerReachedSignal("Hit")` (the `roblox-combat` skill, if installed, hangs hitstop, flash, knockback and shake off the `Hit` marker). Put one on every frame gameplay cares about: hit windows, ball contact or release, footsteps, sound cues.
- `props` are **preview only** (they are not exported) and exist so the motion can be judged against the thing it interacts with. `type: "ball"` with `radius`, or any other type for a box with `size: [x, y, z]` (a sword is a long thin box). `at` is either a part name (the prop follows that part; `offset: [right, up, fwd]` in the part's own axes) or a fixed point `[right, up, fwd]` in studs from the floor point under the character. With several `keys` the prop moves between anchors; `arc` adds a parabolic rise to the segment leaving that key (a shot or a pass). See `examples/jump_shot.json` and `examples/soccer_kick.json`.

## What good looks like

- **Readable silhouettes.** In the storyboard each key should be recognisable from its outline alone. If two neighbouring keys look alike, one of them is not doing any work.
- **Contrast in timing.** Slow anticipation, very fast action (2 to 4 frames), a short hold on the follow-through, slower recovery. Even spacing between keys is the most common reason a move feels weightless.
- **The whole body takes part.** Power starts at the feet and hips, then chest, then shoulder, then hand or foot. Give the hips and chest a counter-rotation in the wind-up and let the far arm balance the near one.
- **Feet stay put.** A planted foot keeps its R and F numbers in the report from key to key. If it must move, lift it in a key between (a step).
- **Zero warnings**, or a reason for each one you keep. The limits are natural joint ranges; exceeding them usually means a different channel was intended.

## Getting it into Roblox Studio

Give the user both routes and the event names.

- **Command bar (fastest):** select the rig in Explorer, open View → Command Bar, paste the whole contents of `<Name>.lua`, press Enter. The KeyframeSequence appears in the rig's `AnimSaves` (or in ServerStorage if nothing is selected), where the Animation Editor can load it for tweaking.
- **File:** drag `<Name>.rbxmx` into the Studio viewport, or right-click a service → Insert from File.
- **Publishing:** to play it in a live game it must be uploaded: open it in the Animation Editor and publish, or right-click the KeyframeSequence → Save to Roblox, then use the resulting asset id in an `Animation` object and `Animator:LoadAnimation`. For quick local testing in Studio, `game:GetService("KeyframeSequenceProvider"):RegisterKeyframeSequence(seq)` returns a temporary id. Studio's menus change from time to time; if a step does not match what the user sees, say so and look up the current wording rather than insisting.

The export is baked: one keyframe per frame with linear easing, so Studio plays exactly what the preview shows on any rig of that type. Only joints the spec animates are written, so an upper-body-only animation leaves the legs free for the default walk. R15 output carries `AuthoredHipHeight` so it retargets to avatars of other proportions.

## Files

- `scripts/ranim.cjs` — engine, previewer and exporter in one file. Also usable as a module: `const R = require('.../ranim.cjs'); const c = R.compile(spec); R.report(c); R.sample(c, t)`.
- `scripts/selftest.cjs` — checks the joint maths against Roblox's Motor6D formula. Run it after editing the engine.
- `examples/` — `soccer_kick`, `jump_shot` (sports with ball props), `jab_cross` (R15 combat), `r6_sword_slash` (R6 combat with a weapon), `backflip` (full-body rotation and a jump), `r6_run` (mirrored loop).
- `references/motion-cookbook.md` — timing tables and pose recipes by genre. Read the relevant section before authoring.
