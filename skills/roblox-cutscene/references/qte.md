# Quick-time events

A quick-time event (QTE) asks for an input at a moment the game chooses: a prompt appears, the player responds in a window, the scene branches. Dragon's Lair (1983) was built of them; Shenmue (1999) named them; Resident Evil 4 and God of War made them famous (and infamous); Call of Duty uses them for melee struggles (fighting off a dog, wrestling a knife away).

Contents: 1 Why they're hated and when they work · 2 Types and what they mean · 3 Timing numbers · 4 Prompt design · 5 Failure · 6 Accessibility · 7 Multiplayer and latency · 8 The kit · 9 Checklist

---

## 1. Why they're hated, and when they work

The common complaints, and the design rule each one implies:

| Complaint | Rule |
|---|---|
| "Press X to not die": instant death from a surprise prompt mid-cutscene | Telegraph before the prompt; fail into a consequence or a fast retry, not a long reload |
| You watch the button icon instead of the scene | Put the prompt next to the action, keep it small, slow the scene down, don't cut during the window |
| Arbitrary buttons with no relation to the action | Map the input to the action: mash = struggle, hold = push, a timed press = counter, alternate = climb |
| Too many in a row | Use them for a few peak moments, not as the scene's main interaction |
| Hand pain, can't mash | Offer Hold / Easy / Auto assist modes (§6) |

They work when they **embody effort** (the struggle is in your hands, not just on screen), when they mark **one decisive moment** (the counter-stab), and when failure is **interesting** (you get hurt and fight on, or a different branch plays).

## 2. Types and what they mean

| Kit type | Input | Embodies | Example |
|---|---|---|---|
| `Press` | one press in a window | reflex, a sudden action | dodge the charge |
| `Timing` | one press on the beat (ring closes onto a target), graded Perfect / Good | precision, a counter | knife the grabbing zombie as it lunges |
| `Mash` | repeated presses fill a meter; `Decay` drains it | struggle, raw effort | break free of a grapple, push the door |
| `Alternate` | alternate two buttons | climbing, crawling, pulling hand over hand | drag yourself out of the rubble |
| `Hold` | hold for N seconds (`Continuous` resets on release) | sustained effort, bracing, aiming, charging | hold the door shut |
| `Sequence` | a series of buttons in order, each within `Step` | a combo, a lock pick, Simon-says | a scripted fight exchange |

Name actions, not keys (`Action = "Struggle"`); `CutsceneConfig.Actions` maps them to keyboard, gamepad and touch. Keep mappings consistent for the whole game: if Dodge is Space once, it's Space every time.

## 3. Timing numbers

- **Simple visual reaction** (you know which button, you wait for the signal): about 0.2–0.3 s in healthy adults, longer when tired, distracted or older.
- **Choice reaction** (which button? where on the pad?): 0.4–0.6 s before the hand even moves.
- **Device and network latency**: one or two frames of display, plus input lag, plus the round trip in multiplayer.

So:

| Window | Feels |
|---|---|
| < 0.6 s | unfair for a surprise prompt (the kit's coverage check flags it) |
| 0.8–1.2 s | tense but fair for `Press` |
| 1–1.5 s with slow motion | dramatic `Timing` counters (`SlowMo = 0.35..0.4` stretches scene time, the window stays in real seconds) |
| 2–3.5 s | `Mash` / `Alternate` / `Hold` struggles |

`Timing` grades (kit defaults): Perfect within ±0.06 s of the target, Good within ±0.16 s. Put the target late in the window (`Target = 0.7..0.8`) so the closing ring gives the player time to read it.

Mash rates: casual players manage 5–8 presses/s comfortably, fast players 10–15. With `Decay`, the meter fills only when `presses/s × (1/Count) > Decay`; design for 6–7 presses/s. The kit caps counted presses at 20/s so auto-clickers gain nothing.

## 4. Prompt design

- **Next to the action** (the kit anchors it to the responding actor), large enough to read in peripheral vision, small enough not to cover the scene.
- **Show the right glyph for the device in use** (keyboard key, the platform's gamepad button image via `UserInputService:GetImageForKeyCode`, or an on-screen touch button) and switch live if the player changes device.
- **Show the type**: a ring for timing, a meter for mash/hold, the next button for sequences, a thin timer bar for the window.
- **A word, not only a colour**, for the result: SUCCESS / PERFECT / TOO EARLY / FAILED.
- **Lead time**: show the prompt a moment before the window opens (the kit's server sends it 0.25 s early) and **don't cut the camera during the window**.
- **Sink the keys** while the prompt is up so a QTE on Space doesn't also jump.
- **Diegetic tells**: the enemy's wind-up, a flash, a sound sting a beat before the prompt.

## 5. Failure

Options, from harshest to kindest:

| Failure design | When |
|---|---|
| Death and reload | almost never; only with an instant retry from just before the QTE |
| **Damage and retry the beat** (kit: `OnFail = { Goto = "Caught" }`, the branch ends with `Goto` back to the retry label) | the RE4 pattern done fairly: you feel the consequence, you get another go immediately |
| **A worse branch that continues** (shove instead of the kill; the kit's Grab counter) | best for story and finishers: failing changes what happens, the game goes on |
| Cosmetic only (`OnFail` absent = continue) | low-stakes flourishes |

Never make the player sit through the whole cutscene again after failing at the end of it. Retry labels go just before the QTE's setup.

## 6. Accessibility

Microsoft's Xbox Accessibility Guidelines (XAG 107, input) and the Game Accessibility Guidelines both recommend avoiding rapid mashing, long holds and simultaneous presses, and where you use them, offering alternatives: a single-button or hold option, and a way to simplify or skip QTEs entirely. Uncharted 4 and God of War (2018) shipped "hold instead of tap" options.

The kit's assist modes (a player setting, stored on the Player as the `QteAssist` attribute through `CutsceneController.SetQteAssist(mode)`):

| Mode | Does |
|---|---|
| `Off` | as designed |
| `Easy` | windows × 1.5, Count × 0.6, Hold × 0.7, Decay × 0.5, grades wider |
| `Hold` | every Mash / Alternate becomes a short Hold (0.6–1.5 s) of its first button |
| `Auto` | succeeds on its own about half a second after the prompt appears |

Also: remappable actions, prompts that don't rely on colour, audio cues for prompts, and camera shake scalable to zero.

## 7. Multiplayer and latency

The decision must be the server's (otherwise an exploiter auto-succeeds), but the feel must be the client's (otherwise every press feels late). The kit splits it:

- **Client** runs the same `Qte` state machine on its own inputs for instant feedback and sends every press with its time on the shared clock (`workspace:GetServerTimeNow()`).
- **Server** runs the state machine on those inputs, judging each press at the time the client reports **clamped to what its ping explains** (`Qte.JudgeTime`: no later than arrival, no earlier than arrival minus `BaseLatency + ping`, at most `MaxLatency`). It closes windows `Grace` seconds late for packets still in flight. Its result is final and shown on the client (rarely different from the prediction).
- **Shared scene QTEs** (several players watching): `Player = "ActorName"` picks the responder (the player bound to that actor); without it every watcher gets the prompt and `Rule` decides: `Any` (default), `All`, `Majority`.
- **Holding the scene**: if the window closes before the verdict arrives, every client and the server hold on the window's last frame; the server then re-syncs everyone to the branch (`CutsceneSeek`), so nobody sees the success branch begin and snap back.

## 8. The kit

In a scene:

```lua
Qtes = {
	{
		At = 3, Id = "Dodge", Player = "Player",
		Qte = { Type = "Press", Action = "Dodge", Window = 1, Label = "Dodge!" },
		SlowMo = 0.35,                     -- scene runs at 0.35x during the window
		OnSuccess = nil,                   -- continue (jump to the end of the window)
		OnFail = { Goto = "Caught" },      -- a label in Labels; or "End"; or { Final = true }
		Rule = "Any",                      -- shared scenes only
	},
},
Labels = { Retry = 2.5, Caught = 12 },
Events = { { At = 13.8, Name = "Goto", Label = "Retry" } },   -- the fail branch loops back
```

On its own (a lever, a door, a boss grapple in gameplay):

```lua
local status, grade = QteService:Run(player, { Type = "Mash", Action = "Struggle", Window = 3, Count = 12, Decay = 0.5 })
if status == "Success" then ... end
```

## 9. Checklist

- [ ] Each QTE marks a peak moment; the scene has at most a few.
- [ ] The input matches the action (struggle = mash, counter = timing, brace = hold).
- [ ] A tell (wind-up, flash, sting) comes before the prompt.
- [ ] Window ≥ 0.8 s for a surprise press (or slow motion), 2–3.5 s for a struggle.
- [ ] No cut during the window; the prompt sits next to the action.
- [ ] Failing hurts or branches, then lets you retry fast or carry on.
- [ ] Assist modes and shake scale are in your settings menu.
- [ ] Tested with Studio's network simulation (incoming replication lag) at 150–250 ms.
