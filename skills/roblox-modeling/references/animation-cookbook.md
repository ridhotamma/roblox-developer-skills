# Animation cookbook

## Pivots and hierarchy

- A part rotates about its `pivot` (model-space point, rest pose). Put it on the physical hinge: the back edge of a lid (just behind the rim), the shoulder of a wing, the front edge of a fin, the joint between two spine bones, the grip of a sword, the bottom of a tree trunk for sway.
- Children move with their parent: lid strap → lid, outer wing → inner wing, eyes → head bone. Mirrored children follow their mirrored parent automatically.
- The root node (named after the model) can be animated: whole-body bob, roll, recoil, float.
- Rotation signs (right hand rule): **+X** tips the top toward the front, **+Y** turns the front toward the right, **+Z** rolls the top toward the left. A lid hinged at the back opens with **negative X**. Mirrored tracks (`"mirror": true`) flip Y and Z for the partner, so a pair of fins or wings flaps symmetrically.

## Timing and easing

- Make one-shots short: lid open 0.6-1.0 s, close 0.4-0.7 s, hit react 0.2-0.4 s, death 1.5-3 s.
- `backOut` gives a small overshoot (lids, doors, pop-ups); `bounceOut` or a manual key pair (`[t, -5°, "out"], [t+0.1, 0°, "in"]`) gives a slam-and-settle; `in` for falling under gravity; `inOut` / `sine` for rolling over and slow moves; `step` for clicks.
- Anticipation: a tiny opposite move first (the chest lid lifts 4° before swinging open).
- Put `markers` on moments the game needs (sound, particles, damage): `Creak`, `Slam`, `BellyUp`. They are exported in the glTF animation `extras`.

## Waves (loops)

`{ "wave": { "axis": "y", "amp": 12, "cycles": 2, "phase": 0.25 } }` = 12° about Y, two full cycles per clip, a quarter cycle late. Use whole `cycles` in loops so they are seamless. `offset` shifts the centre (a lid that chatters around 1.5° open), `shape: "bounce"` gives |sin| (hops, paddling), `saw` a ramp.

**Travelling wave** (swimming, tails, tentacles, snakes, flags): one wave per bone along the chain, amplitudes growing toward the free end, phases increasing by 0.1-0.15 per bone. Because rotations accumulate down the chain, keep per-bone amplitudes modest (fish: 4 / 7 / 11 / 16°).

**Envelope** fades a wave in or out over the clip: `"envelope": [[0, 1], [0.5, 1], [1.4, 0, "out"]]` (seconds, multiplier). Use `hz` (cycles per second) for one-shots.

## Skinned chains

For bodies that must bend smoothly (fish, snakes, tails, tentacles, worms, ropes): `none` bones chained head → tail with pivots along the axis, the body `loft` with `"skin": { "bones": [...], "axis": "z" }`. Vertices are weighted between the two nearest bones along the axis. Place bones where the body should bend most (fish: just behind the head, mid-body, in front of the tail and at the tail root). Rigid attachments (fins, eyes) are parented to the bone nearest their root; keep the bend moderate where a rigid part spans two bones, or its root separates from the surface. The automatic attachment test reports exactly which pair opens, by how much and when.

## Recipes

**Lid / door / hatch open + close** (chest example): Open: lid X angle 0° → -4° at 0.12 s (`out`) → -105° at 0.9 s (`backOut`). Close: -105° → 0° at 0.38 s (`in`) → -5° at 0.48 s (`out`) → 0° at 0.6 s (`in`). In the spec each key is `[time, [x, y, z], ease]`, e.g. `[0.9, [-105, 0, 0], "backOut"]`. Checks: `angle` at the end of Open, `pose` Close end = rest, `pose` Close start = Open end, `apart` lid / base through Open, `contact` lid rim on base rim at rest. Optional loop: Rattle (locked): lid wave 1.5° around offset -1.5°, root `pos` x wave 4 mm.

**Fish Swim / Idle / Die** (fish example): Swim 1.0 s loop, 2 cycles, travelling wave 4/7/11/16°, pectorals mirrored flap 18°, tiny root bob. Idle 2.0 s loop: slow tail (1 cycle, 3/7°), pectorals fanning 3 cycles at 28°, root bob 4 mm + pitch 2.5°. Die 2.6 s: tail + spine wave at 5 Hz with an envelope fading over 0.5-1.4 s (thrash, weakening), root roll Z 0 → 180° from 0.9 to 2.2 s (`inOut`), root float up 3.5 cm, spine slight curl, fins droop. Checks: `angle` root Z ≈ 180 at the end, `contact` tail / body at peak bend.

**Bird Fly / Glide / Idle**: wings rotate about Z at the shoulder (mirrored): downstroke fast, upstroke slow (keys, not a sine: Z 30° at 0 → -40° at 0.12 s (`in`) → 30° at 0.35 s (`inOut`)), outer wing lags the inner by 0.05 s; body bobs opposite to the wings (up on the downstroke). Glide: wings held at 5-10°, slow 1-2° wave. Idle: head turns (Y keys with holds), tail flicks.

**Walk bob for simple creatures / mascots**: root `pos` y wave `shape: "bounce"`, 2 cycles per step cycle; legs rotate X waves in opposite phase (0 and 0.5); body slight Z roll wave at half the frequency.

**Pickup / collectible**: root rot Y `saw` 360° per cycle (or keys 0 → 360 linear), pos y sine 5-10 cm. Loop 2-3 s.

**Hit react**: root pos back 3-5 cm and rot X -8° in 0.06 s, return with `elasticOut` in 0.3 s.

**Tree sway**: canopy pivot at the trunk top, rot X and Z waves 1-3° with different `cycles` (1 and 2 over a 4 s loop) so it never looks mechanical.

**Spin / open / pop for props**: `scale` keys `[0, 0.01], [0.25, 1.15, "out"], [0.4, 1, "inOut"]` for appear; reverse for disappear.

## Loops checklist

- Whole cycles; last key equals the first (the seam test fails otherwise).
- No root drift in a loop (keep root translation waves or return keys).
- Vary speeds between the animations of one model (idle slower than move) and keep amplitudes small in idle.
