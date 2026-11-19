# Choreography: blocking, fights and paired animation

Cinematography decides where the camera is; choreography decides where the people are and what they do. In games it also decides whether two animations, made separately, connect.

Contents: 1 Blocking · 2 Staging for the camera · 3 Acting beats · 4 Fight choreography · 5 Selling contact · 6 Paired (synced) animation · 7 Root motion on Roblox · 8 Timing sheets · 9 Checklist

---

## 1. Blocking

Blocking is placing and moving actors through a scene. In the kit, **marks** are where actors stand (`Marks`), **moves** carry them between marks (`Moves`), and everything is relative to the scene's origin so the same scene plays anywhere.

- **Start everyone on a mark** and give every mark a reason (a doorway, cover, a body).
- **Movement motivates cuts and camera moves.** Someone stands, walks to the window, turns: three beats, three chances to cut or move.
- **Distance is relationship.** Close = intimacy or threat; far = estrangement; someone stepping into another's space is an action.
- **Height is status.** Standing over someone, a throne on steps, a boss twice the hero's size.
- **Triangle staging.** Three characters in a triangle (not a line) gives depth and a clear dominant point (the apex).
- **Depth staging.** Put people at different distances from the camera; flat lines of characters look like a police line-up.
- **Facing**: `Face = "OtherMark"` makes a mark look at another; a mark without `Yaw`/`Face` is just a place and keeps the actor's facing when they walk to it.
- **Re-block every branch.** Interactive scenes jump between sections (QTE results, retries); start each section by snapping actors to its marks (`Moves` with `Duration = 0`).

## 2. Staging for the camera

- Stage along the **line** (the 180° axis) so a camera on one side sees every face.
- **Cheat**: actors in film stand closer and more open to the lens than people really would. In-game, a three-quarter open stance reads better than a true profile.
- Leave the camera **somewhere to be**: a fight against a wall has one usable side.
- **Entrances and exits** through the frame edge read better than appearing mid-frame.
- Big subjects (bosses) need their eyes framed, not their belt: give them a `Height` and the kit frames by their size.

## 3. Acting beats

A beat is one unit of intention: notice → react → decide → act. Animate and time them separately; each beat is a candidate shot.

- **Anticipation, action, follow-through** (the animation principles): the wind-up tells the audience something is coming, the action is quick, the follow-through and settle sell weight.
- **Hold the reaction.** The most important frames in a scene are often the reaction after the line or the hit; give them 0.5–1.5 s.
- **Eyes lead.** Characters look before they move and turn the head before the body.
- **Stillness is a choice.** One still character among moving ones draws the eye.

## 4. Fight choreography

What fight choreographers (the Hong Kong school, the John Wick team, Jackie Chan) build on, and what makes game fights readable.

**Structure**

- A fight is **phrases** of 3–6 moves (attack, defence, counter), separated by **beats**: a pause, a reset, a look, a line. Without beats it's noise.
- **Rhythm**, not speed: vary the tempo. Fast-fast-SLOW-hit. A held moment before the big hit makes it land. Uniform tempo reads as fake ("dancing").
- **Escalation**: each phrase raises the stakes (fists → weapons → environment → the finisher).
- **Story in every exchange**: who's winning changes. The hero takes damage before turning it around; the boss should look unbeatable once.
- **Geography**: establish where everyone is (a wide) before the close action, and keep screen direction (who is attacking from which side).
- **Character**: a brawler, a fencer and a monster move differently; style is characterisation.
- **Environment**: walls, tables and railings make fights specific and give the camera framing.

**Readability**

- **Telegraph** every attack: the tell (wind-up) is longer than the strike. A strike without a tell reads as a glitch.
- **Clear silhouettes**: attacks along the frame plane (left-right in the shot) read; attacks toward the lens hide the gap (§5).
- **Reaction sells the hit.** The victim's reaction (head snap, stagger, sound, a freeze frame) is what makes a hit real. The roblox-ragdoll skill's flinches and ragdolls do this in gameplay.
- **Impact frames**: a 2–6 frame freeze (`Freezes = { { At, Hold = 0.06 } }`), a shake, a flash and the sound, all on the contact frame (the roblox-combat skill's hit feedback stack).
- **Space between fighters**: real full-contact distance looks cramped; film fights work at arm's length plus a little, cheated for the lens.

## 5. Selling contact

On set, punches miss by inches; the camera angle hides it. In a game the bodies are virtual so you *can* make contact, but small misalignments read worse than a clean cheat.

- **Hide the gap along the lens**: put the camera behind the attacker's shoulder or behind the victim so the strike travels toward or away from the lens. The miss disappears in depth.
- **Cut on the contact frame**: end the attacker's shot on contact and start the victim's on the reaction (a cut on action hides any mismatch).
- **Freeze on contact**: the hit freeze gives the brain time to register contact even if the limbs only nearly touch.
- **Sound is half of it**: a dry, close impact sound on the exact contact frame.

## 6. Paired (synced) animation

Two characters animated to interact (a grab, a throw, a takedown) are one performance split into two clips. Games call them paired, synced or contextual animations (Unreal's contextual animation scenes, Batman Arkham's takedowns, RE4's suplex, CoD's finishers).

**The contract** (give this to the animator, or to the roblox-animation skill):

1. **One shared origin.** Both clips are authored together from the same scene origin: the victim's root at the origin facing -Z, the attacker's root at the move's attacker mark (e.g. 2.2 studs behind for a suplex, 3 in front for a kick). Export both from the same timeline.
2. **Same frame rate, same length** (or the shorter clip holds its last pose).
3. **Contact frames** on the same frame number in both clips, written down in seconds: the kit's Freeze, Shake, Hit and Kill events go there.
4. **End on marks.** Both clips end with their roots where the scene's end marks say (or back on their start mark), upright unless they end on the floor, because the real characters are put there when it ends.
5. **Names by role**: `Suplex_Attacker`, `Suplex_Victim`. Never mix up roles between clips.
6. **Paired QTE loops**: a struggle needs a short looping clip for both (the kit holds the scene during the window), plus a clip per outcome.

**Aligning at runtime** (the kit does this in `Finisher.Align`): the victim's current ground CFrame becomes the scene origin (with the victim's mark offset removed), and the attacker is put at the attacker mark. Real games warp the attacker into place over 0.1–0.3 s; the kit cuts to the stand-ins instead, which looks the same under the camera blend.

**Why stand-ins.** On Roblox each player's animations replicate from that player's client and NPC animations from the server, each with its own delay. Two bodies that must touch drift apart on everyone else's screen (a common devforum complaint: "both clients see different distorted versions of the animation"). The kit clones both bodies locally on every client and drives the clones from the shared server clock, so contact frames line up exactly everywhere. The real bodies wait hidden and frozen.

## 7. Root motion on Roblox

Roblox animations move the body's limbs; they do not move the HumanoidRootPart (an animation can offset the Root joint, which moves the visible body away from the root, then snaps back when the clip ends). So:

- **Author in place**, and let the scene's `Moves` carry the root along the path (the kit's finishers do this; their Moves are the root motion).
- Or author with the body travelling via the Root joint, and set the end mark to where the body ends so the swap back to the real character doesn't pop.
- **Falls and lying poses**: marks take `Pitch`, `Roll` and `Lift`. Marks pivot at the feet, so a body lying face-up is `Pitch = 85..95` with a small `Lift`, and an upside-down body (mid-suplex) needs `Lift` about equal to its height so the head meets the floor.
- The stand-in holds the last frame of one-shot clips (`Hold`, default on) instead of snapping back to the bind pose.

## 8. Timing sheets

Write the scene as a beat sheet in seconds before anything else. It becomes the scene file almost line for line:

```
0.00  grab: attacker steps in, hands on shoulders        Shot 1 low two-shot
0.90  lift begins (effort grunt)                          Shot 2 worm's-eye wide (cut on the lift)
1.20  top of the arc: slow motion 0.35x for 0.25s
1.75  IMPACT: freeze 0.1s, shake 0.95, crunch, Kill       Shot 3 high angle on the body (cut on impact)
1.80  victim goes limp (Ragdoll)
2.05  attacker gets up
2.60  end, control returns
```

Rules of thumb for game timings:

- Finisher total 0.8–2.5 s; the kill lands before 70% of the way through so the end is the release, not a wait.
- Tell (wind-up) 0.25–0.6 s before a hit the player must react to.
- Hit freeze 0.05–0.12 s; longer feels like a stall.
- Slow motion 0.25–0.4× for 0.2–0.6 s of scene time, around the peak, never over the whole move.
- After the climax, 0.3–0.8 s of settle before giving control back.

## 9. Checklist

- [ ] Every actor starts on a mark; every branch re-blocks its actors.
- [ ] The line between the two main actors is declared; the camera stays on one side.
- [ ] Every hit has a tell, a contact frame, a freeze, a sound and a reaction.
- [ ] Paired clips share one origin and their contact frames are written down.
- [ ] Clips end on their end marks (or the Moves stand in for root motion).
- [ ] Tempo varies; there's a beat between phrases.
- [ ] The previs shows bodies where they should be (`node scripts/previs.cjs`).
