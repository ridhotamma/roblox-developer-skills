# Combat flow

## Contents
1. Anatomy of an attack
2. Hitboxes
3. Hit-stun, poise and stagger
4. Combos, input buffering and cancels
5. Defense: block, parry, dodge
6. Client prediction and server authority
7. Wiring animation markers, VFX and sound
8. Common problems

---

## 1. Anatomy of an attack

Every attack has three phases (fighting-game terms: startup, active, recovery):

| Phase | What happens | Player experience |
|---|---|---|
| **Startup** (anticipation) | Wind-up animation; no hitbox yet | Readability: the opponent can react. Longer = heavier, more punishable. |
| **Active** | Hitbox exists (often a single frame on Roblox: the "Hit" marker) | The impact moment |
| **Recovery** | Follow-through; attacker can't act (or only cancel into specific moves) | The risk: whiffing leaves you open |

Typical timings (seconds):

| Move | Startup | Active | Recovery | Cooldown |
|---|---|---|---|---|
| Jab / light | 0.08–0.12 | 1 frame–0.05 | 0.15–0.2 | 0.3–0.4 |
| Medium | 0.15–0.2 | 0.05 | 0.25 | 0.5 |
| Heavy / charged | 0.3–0.6 | 0.05–0.1 | 0.4–0.6 | 1+ |
| Enemy grunt attack | 0.4–0.5 telegraph | 0.05 | 0.5–0.7 | 1–1.5 |
| Enemy brute slam | 0.7–1.0 telegraph | 0.1 | 0.8–1.2 | 2+ |

The animation sets these: the `roblox-animation` skill's anticipation → strike → follow-through → recover phases map directly to startup → active → recovery, and its `Hit` marker is the active frame.

## 2. Hitboxes

Roblox options:
- **Box/sphere query at the active frame**: `workspace:GetPartBoundsInBox(cframe, size, overlapParams)` in front of the attacker (kit: `Hitbox.Query`). Simple, cheap, reliable. Default.
- **Multiple queries along a swing arc** for long weapons: 3–5 boxes along the blade path over the active window.
- **Raycasts** for thin weapons, hitscan guns and precise sweeps (cast from the previous to the current blade tip position each frame).
- **Touched events**: avoid for combat; unreliable and client-triggerable (see `roblox-security`).

Rules:
- Size hitboxes generously (players forgive hits that "should have missed" far more than misses that "should have hit"), and make enemy hitboxes slightly smaller than their visuals for the same reason.
- Each target can be hit once per swing: collect unique models.
- Exclude the attacker and its team.
- Visualize hitboxes in Studio during tuning (a transparent red part for a frame).

## 3. Hit-stun, poise and stagger

- **Hit-stun**: after being hit, the victim can't act for a short time (≈ hitstop + 0.15–0.4 s). This is what makes combos possible. Show it with a hit-reaction animation.
- **Poise**: a meter that absorbs hits without stun. Light enemies have none (every hit staggers), brutes need several hits, bosses only stagger at thresholds. Each hit adds poise damage by weight (kit: Light 1, Medium 2, Heavy 3, Finisher 5). Poise resets after a few seconds without hits.
- **Stagger** interrupts the enemy's current action, including a telegraphed attack. Interrupting a wind-up with a heavy hit is one of the most satisfying moments in combat; design for it.
- **Hit-stun on players** must be short and capped, or being hit by a group feels like losing control. Pair it with i-frames.

## 4. Combos, input buffering and cancels

- **Combo chain**: consecutive attacks within a window (0.6–1.0 s after the previous one) advance a step: Light → Light → Medium → Finisher. Missing the window resets to step 1. The server tracks the step from its own clock; the client mirrors it for animation and prediction.
- **Input buffer**: an attack pressed slightly too early (during recovery, up to ~0.2 s before it ends) is remembered and fires as soon as possible. Without buffering, combos feel unresponsive on phones.
- **Cancels**: allow recovery to be cancelled into dodge (always) and into specific follow-ups. Cancel windows reward skill.
- **Mobile**: one big attack button (`ContextActionService` touch button) with auto-combo works better than complex inputs. Specials go on separate buttons with cooldown rings.

## 5. Defense: block, parry, dodge

- **Block**: hold to reduce damage (and maybe knockback) from the front; costs stamina or has a guard meter; heavy attacks break guard.
- **Parry**: block pressed within a short window (0.12–0.2 s) before the hit: no damage, the attacker is staggered, big feedback (flash, sound, slow-mo). Server-validated timing with latency tolerance.
- **Dodge**: short dash with i-frames (0.2–0.3 s) and a cooldown. Call `AntiCheatService:Grant` on the server when a dodge starts.
- Telegraphs exist to make defense possible; if enemies attack without wind-ups, defense is meaningless.

## 6. Client prediction and server authority

The server decides damage; the client decides feel. The kit's flow:

```
Client (attacker)                         Server                               All clients
press attack
 play swing anim + whoosh
 combo step++ (local mirror)
 [finisher] pre-hit check → slow-mo
 contact frame (ActiveDelay):
   local hitbox query
   predicted hitstop/flash/sound/shake
   fire "Swing" ------------------------> rate limit + cooldown + combo step
                                          hitbox query (padded for latency)
                                          CombatService:Hit(attacker, victim)
                                            i-frames check, damage
                                            poise / stagger (enemies)
                                            delay(hitstop) → knockback
                                          fire "CombatHit" ------------------> HitFeedback.Play
                                                                              (attacker skips predicted parts,
                                                                               shows damage number)
```

- The client never sends targets, damage or positions; the server runs its own hitbox from the player's character (with padding for latency). This is the secure default from `roblox-security`.
- Competitive PvP games may need lag compensation (server checks against where the target was `ping` ago); see the security skill's anticheat reference.
- If the server rejects a predicted hit, the attacker saw a flash and heard a hit that didn't count. Keep prediction to cosmetics so this is harmless, and keep hitbox padding so it's rare.

## 7. Wiring animation markers, VFX and sound

- Animation markers: `Hit` on the contact frame, `Swing` at the start of the fast motion (whoosh), `PreHit` 0.08 s before contact for finishers (slow-mo check). Read them with `track:GetMarkerReachedSignal("Hit")`. The kit's controller uses config timings by default (`ActiveDelay`), so it works before animations exist; switch to markers once they do.
- VFX: play the impact effect (for example a `roblox-vfx` HitSpark module) at the hit position in `HitFeedback.Play`, sized by weight. Effects run on clients only.
- Sound and shake can also hang off the VFX's markers for multi-stage effects (ground slams).

## 8. Common problems

| Problem | Cause | Fix |
|---|---|---|
| Hits feel weak | No hitstop, sound late or quiet, knockback missing | Add the stack in order: sound → hitstop → flash → knockback → shake |
| Everything feels the same | Same values for every hit | Use weights and escalate through combos |
| Combat feels laggy | Waiting for the server before any feedback | Predict cosmetics on the attacker's client |
| Victims jitter or snap during knockback | Server pushing a client-owned character | Let the owner client apply knockback; server owns NPCs |
| Players stunlocked by groups | Unlimited simultaneous attackers, no i-frames | Attack tokens (enemy-design.md) and player i-frames |
| Enemies interrupted forever | Every hit staggers big enemies | Poise |
| Anti-cheat flags knockback | Movement checks see the push | `AntiCheatService:Grant(player, knockTime + 0.3)` |
| Screen chaos in crowds | Every hit shakes and flashes | Caps, distance scaling, only local-involved shake |
