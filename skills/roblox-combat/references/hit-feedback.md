# Hit feedback

A hit feels good when the player gets several signals at the same instant, sized to how strong the hit was. Each layer below is cheap; together they make the difference between "the number went down" and "I smacked it".

## Contents
1. The feedback stack and its timeline
2. Tuning by hit weight
3. Hitstop
4. Hit flash
5. Knockback
6. Camera shake and FOV punch
7. Slow motion (and why it must be faked on Roblox)
8. Invulnerability blink
9. Sound
10. Damage numbers
11. Who sees what (attacker, victim, bystanders)
12. Accessibility and restraint

---

## 1. The feedback stack and its timeline

```
t = 0            contact frame (animation marker "Hit")
0 – hitstop      both fighters' animations frozen; flash on the victim; impact sound; VFX spawn; shake kicks
hitstop end      animations resume; knockback launches the victim; hit-reaction animation plays
+0.1 – 0.3 s     shake decays; flash gone; damage number floating up
+ i-frames       victim blinks while invulnerable (player victims)
```

Before the hit (heavy attacks and finishers only): anticipation in the animation, an optional brief slow-down 0.06–0.12 s before contact, then hitstop on contact. The slow-down sells "this one is going to hurt"; the hitstop sells the impact.

Everything that happens at `t = 0` must be on the same frame. A sound 100 ms after the flash reads as lag, not impact.

## 2. Tuning by hit weight

Start from these (the kit's `CombatConfig.HitWeights` uses them) and tune in the feel lab (`assets/feel-lab.html`):

| Weight | Hitstop | Flash | Shake (trauma) | FOV punch | Knockback (studs/s, up) | Knock time | Slow-mo | Sound pitch |
|---|---|---|---|---|---|---|---|---|
| Light (jab, first combo hits) | 0.04–0.06 s | 0.08 s | 0.2–0.3 | 0 | 15–20, 3–5 | 0.12 s | – | 1.1–1.2 |
| Medium (combo middle) | 0.07–0.09 s | 0.1 s | 0.35–0.45 | 1–2° | 25–35, 6–10 | 0.15 s | – | 1.0 |
| Heavy (charged, slam) | 0.1–0.13 s | 0.12 s | 0.6–0.7 | 3–4° | 45–60, 15–20 | 0.2 s | – | 0.85–0.9 |
| Finisher (combo end, kill) | 0.14–0.18 s | 0.15 s | 0.85–1 | 5–7° | 70–90, 25–35 | 0.25 s | 0.25–0.4 s at 0.3× | 0.75–0.8 |

Rules of thumb:
- **Contrast** is what makes heavies feel heavy. If light hits shake the camera, heavy ones have nowhere to go.
- **Escalate through a combo**: Light → Light → Medium → Finisher. The last hit pays off the sequence.
- Hitstop scales with damage; knockback scales with the move's purpose (combo starters keep the target close, enders send it away).
- Enemies hitting the player use slightly less hitstop than the player hitting enemies, so the player's own power feels bigger.

## 3. Hitstop

A short freeze of both attacker and victim on contact (also called hit-pause or impact freeze). It gives the eye time to register the hit and makes contact feel solid.

Roblox implementation (client, cosmetic): for each `AnimationTrack` playing on the attacker's and victim's `Animator`, store `track.Speed`, call `track:AdjustSpeed(0)`, and restore after the hitstop duration. Delay the knockback by the same duration (the kit's server does `task.delay(weight.Hitstop, ...)`) so the victim freezes, then flies.

- Freeze only the two fighters, not the world.
- Too long (> 0.2 s) feels like lag. Very fast games use 0.03–0.08 s.
- Multi-hit attacks (flurries) use tiny hitstop per hit and a bigger one on the last.

## 4. Hit flash

The victim turns white (or a hit color) for one to a few frames.

Roblox: a `Highlight` instance adorned to the victim model: `FillColor` white, `FillTransparency` 0–0.3, `OutlineTransparency` 1, `DepthMode` `Occluded`, destroyed after 0.08–0.15 s. Clients render at most 31 `Highlight`s at once, so cap concurrent flashes (the kit caps at 12) and reuse rather than stacking several on one model.

Variants: red for damage taken by the local player, yellow/blue for blocked hits, a hit color per element (fire, ice). Keep one meaning per color.

## 5. Knockback

Pushes the victim away from the attacker. It's the most physical signal of power and the main tool for spacing in combat.

- **Direction**: from attacker to victim, flattened, plus an upward component (more up = juggle/launch).
- **Implementation**: a `LinearVelocity` constraint on the victim's root attachment (`VelocityConstraintMode.Vector`, `RelativeTo` World, a high `MaxForce`) for 0.1–0.25 s, then removed. It beats `ApplyImpulse` on Humanoids because ground friction and the Humanoid's own movement eat a single impulse unpredictably.
- **Network ownership decides who applies it**:
  - NPCs: owned by the server (`root:SetNetworkOwner(nil)`), so the server applies it.
  - Player characters: owned by their client, so the server tells that client to push itself (a server-set velocity is overwritten by the owner's simulation). The client validates the request (type and magnitude caps), applies it, and the server tells the anti-cheat to expect it (`AntiCheatService:Grant`).
- Knockback during hit-stun only: the victim can't move until it ends, so the push reads clearly.
- Walls: a strong knockback into a wall is a great moment (extra shake, wall-splat VFX). Detect with a raycast along the knockback direction.

## 6. Camera shake and FOV punch

**Trauma model** (smooth and stackable): each hit adds trauma (0–1); every frame the shake amount is `trauma²` and trauma decays linearly (about 1.5–2 per second). The offset is Perlin noise (`math.noise`) on pitch, yaw and roll, scaled by a max angle (2–4°) and a little translation. Squaring makes small hits subtle and big hits dramatic.

Roblox: apply in `RunService:BindToRenderStep` at a priority just after `Enum.RenderPriority.Camera`, multiplying `camera.CFrame` by the noise rotation. The default camera rebuilds its CFrame every frame, so the offset doesn't accumulate.

**FOV punch**: briefly narrow `Camera.FieldOfView` by a few degrees and ease back over 0.15–0.25 s; reads as a zoom-in on impact without moving the camera.

Who shakes:
- The local player as attacker: light shake (their hit landed).
- The local player as victim: stronger shake plus a red vignette or flash.
- Bystanders: only for big area impacts, scaled down by distance.

## 7. Slow motion

Roblox has no global time scale: physics, other players and the server keep running at normal speed. Slow motion is a **local, cosmetic illusion**:

- slow the animation tracks of nearby characters (`AdjustSpeed(scale)`)
- lower `PlaybackSpeed` on the impact sound (deeper, longer)
- a `ColorCorrectionEffect` (less saturation, more contrast) and a slight FOV narrow
- optionally slow the local camera's movement

Keep it short (0.2–0.4 s) and rare (finishers, last enemy of a wave, parries). Physics keeps moving, so long slow-mo looks wrong. Never slow anything the server simulates for gameplay.

"Slow before the hit": the attacker's client knows its own animation timing. Shortly before the contact frame (0.06–0.12 s), check whether a target is inside the hitbox; if so and the move is a finisher, start the slow-mo, then resume and hitstop on contact. Other players see the result through the server event, without the pre-hit slow-down.

## 8. Invulnerability blink

After a player is hit they get a short invulnerability window (i-frames, 0.4–0.8 s) so multiple enemies can't chain-damage them, shown by blinking:
- Toggle `LocalTransparencyModifier` on the character's parts (0 ↔ 0.6) every 0.06–0.08 s (a local, non-replicated property, so every client can blink the character for itself).
- The server is the authority on i-frames; clients only show them.
- Enemies usually don't get i-frames (combos must work on them); bosses may get them during phase transitions.

## 9. Sound

Sound is half of impact.
- **Layer** an impact: a punchy transient (crack/thud), a body (whoosh/meaty), and optionally a tail (debris, ring). Heavy hits add a low boom.
- **Vary**: randomize `PlaybackSpeed` ±5–10% per play so repeated hits don't sound robotic; rotate between 2–4 variations.
- **Pitch by weight**: lighter hits higher, heavy ones lower (the config's `SoundPitch`).
- **Position**: impacts are 3D sounds at the hit point (a `Sound` in an `Attachment` there); the local player's own important hits can be partly 2D so they're always heard.
- **Swing sounds** on the swing (whoosh), separate from impact sounds, so a miss still feels like an attack.
- Find sounds in the Creator Store (Audio) or upload your own; respect licenses.

## 10. Damage numbers

Optional per genre (RPG and simulator players love them; realistic fighters often skip them).
- `BillboardGui` at the hit point with `AlwaysOnTop`, a random horizontal jitter, rising 2–3 studs and fading over 0.6–0.8 s.
- Size and color by weight; crits bigger with a different color.
- Show only server-confirmed damage (never predicted values).
- Pool the GUIs; dozens per second is normal in a busy fight.

## 11. Who sees what

| Signal | Attacker (local) | Victim (local) | Bystanders |
|---|---|---|---|
| Hitstop | yes, predicted at the contact frame | yes, from the server event | yes (cheap and readable) |
| Flash | yes, predicted | yes | yes |
| Impact sound | yes, predicted | yes | 3D, by distance |
| Shake | small | larger | big hits only, by distance |
| FOV punch | heavy hits | heavy hits | no |
| Slow-mo | finishers | rarely | no |
| Knockback | sees result | applies it (owner) | sees result |
| Damage number | server-confirmed | optional | optional |
| I-frame blink | sees it | sees it | sees it |

The attacker's client predicts the cosmetic parts at its own contact frame, so a 150 ms ping doesn't delay the feel; the server confirms damage and broadcasts to everyone, and the attacker's client skips the parts it already played (the kit does this dedupe).

## 12. Accessibility and restraint

- Offer a "Screen shake" slider (the kit has `HitFeedback.SetShakeScale`) and a reduced-flashing option; respect any reduced-motion setting your game offers.
- Avoid full-screen white flashes; never flash the screen faster than 3 times per second.
- Big crowds: cap per-frame effects (one shake source, limited flashes and numbers) or everything blurs into noise.
- Test on phones: small screens exaggerate shake and hide damage numbers.
