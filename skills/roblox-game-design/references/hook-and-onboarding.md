# Hook and onboarding

## Contents
1. The hook has two halves
2. Discovery assets: icon, thumbnail, title, description
3. Loading and spawn
4. The first-session timeline
5. Guiding without text
6. FTUE patterns that work
7. Anti-patterns
8. Returning players and friends joining
9. Instrumenting the onboarding funnel

---

## 1. The hook has two halves

- **Outside the game**: the icon, thumbnail and title make a promise good enough to tap.
- **Inside the game**: the first minute keeps that promise, fast.

A great thumbnail with a slow start produces high click-through and terrible retention, which teaches the recommendation system to stop sending players. A great first minute behind a dull icon never gets tested. Design both, and make them about **the same thing**: whatever the thumbnail shows should be what the player is doing within 15 seconds.

Hook types (most hits combine two):

| Hook | Promise | Must pay off in the first minute with |
|---|---|---|
| Fantasy | "Be a ___" (pet owner, ninja, restaurant boss) | the identity: costume, ability or place that makes them feel it |
| Mechanic | a fresh or satisfying verb (grapple, shrink, merge, fling) | using the verb, freely, in a space built to show it off |
| Progression | "number goes up", grow from tiny to huge | the first upgrade and the first visible jump in power |
| Social | play with / against friends | other players visible and interactable immediately |
| Curiosity / story | a mystery, a scary place, a secret | an intriguing first scene and a question they want answered |
| Competition | be the best, win the round | a round they can join now (or within 15 s) with a fair chance |

## 2. Discovery assets

**Icon** (small, square, seen in grids on phones):
- One subject, one emotion, readable at thumbnail size. A character's face reacting, or the hero object, on a high-contrast background.
- Minimal or no text (a single big word at most). Bright saturated colors stand out in the grid.
- Seasonal/update badges ("UPDATE", event theme) can lift clicks, but only if the update is real.

**Thumbnails** (16:9, shown on the game page and in some sorts):
- First thumbnail: the core verb in action at its most exciting moment, from a dramatic angle, with other players present.
- The set should answer: what do I do, what can I become, who do I play with.
- No misleading content: showing things that aren't in the game burns retention and breaks Roblox's policies.

**Title**: short, says the genre or the fantasy, easy to search and to say to a friend. Update tags in brackets (`[UPDATE]`) are common; keep the base name stable.

**Description**: first line = the one-sentence pitch. Then controls, update notes, group/community links. Players and the search index read the top.

Test icons and thumbnails rather than guessing: Creator Hub offers thumbnail/icon experimentation for many experiences; otherwise rotate them in fixed windows and compare click-through rate in analytics (account for traffic changes).

## 3. Loading and spawn

- Turn on **StreamingEnabled** for any sizeable map, so phones get into the world fast. Keep the spawn area light (few unique meshes, small textures).
- A custom loading screen in `ReplicatedFirst` can show the game's identity, but **remove it as soon as the spawn area is ready**, not when the whole map is loaded. Never make players wait on a loading screen to "preload" assets they don't need yet. Allow a skip.
- **No main menu before play.** If the game needs a lobby (round-based), the lobby is a playable space with something to do (mini-obby, cosmetics to look at, other players), and the next round is visibly counting down.
- **Spawn facing the action.** Orient `SpawnLocation`s so the camera looks at the first objective or the most impressive view. The first frame is a composed shot; treat it like one.
- First-time players may spawn somewhere different from returning players (a short onboarding path that merges into the hub).

## 4. The first-session timeline

Write this as a table for any onboarding design. The default target:

| Time | What the player sees/does | Purpose |
|---|---|---|
| 0–5 s | In control, in a striking spot, the goal visible (landmark, glowing path, NPC with "!") | Promise confirmed |
| 5–15 s | First use of the core verb, prompted by the world (the only open path, the only coin) | Learn by doing |
| 15–30 s | First reward: number pop, sound, counter fills, maybe a small level-up | Feel the payoff |
| 30–90 s | Spend the reward: first upgrade/purchase/unlock that visibly improves the verb | Close the loop once |
| 90 s–3 min | Repeat with one twist (bigger target, new area, first opponent) | Show depth |
| 3–5 min | Reveal the long-term goal (the giant locked world, the top of the leaderboard, a rare pet on another player) | Reason to stay |
| 5–15 min | Second system introduced (pets, rebirth, quests, crafting) only once the first is mastered | Expand |
| 10–20 min | Social moment (trade, team-up, someone helps or competes) | Belonging |
| End of session | Progress clearly saved, next goal stated, timed reward ticking ("Free chest in 4h") | Reason to return |

Only introduce one new idea per row. If two rows teach at once, split them or cut one.

## 5. Guiding without text

In order of preference:

1. **Level geometry**: one open path, a lit doorway, the only interactive object in view. Funnel the first 30 seconds.
2. **Light and color**: brighter = go here. Keep a consistent color language (for example yellow/gold = collectable or interactable, red = danger, green = safe/checkpoint). Never reuse a meaning.
3. **Motion**: things that spin, bob or sparkle draw the eye. Other players moving toward something is the strongest pointer of all.
4. **World markers**: a `Beam` or dotted trail from the character to the objective, a floating arrow, `BillboardGui` icons. Fade them out once the player has learned the route.
5. **Contextual prompts**: `ProximityPrompt` with a 1–3 word action ("Open", "Collect", "Sit"). Built-in, works on all platforms.
6. **UI highlights**: pulse the button they need next, with a hand/finger icon on touch devices.
7. **Text**: last. Fewer than eight words, never a modal that blocks movement, never more than one at a time.

## 6. FTUE patterns that work

- **The golden path**: a short, linear, impossible-to-fail sequence for first-timers that teaches the verb, gives the first reward and the first upgrade, then opens into the full game. 60–120 s long. Returning players skip it automatically.
- **Pre-filled progress**: start the first progress bar at 20–40% so the first reward arrives fast (the "endowed progress" effect).
- **Guaranteed first win**: the first enemy dies in one hit, the first egg gives a good pet, the first round is against a forgiving bot or a lenient timer.
- **Show the ceiling early**: a glimpse of the end-game (a giant boss, a max-level player, a glittering final world behind glass) makes the grind meaningful.
- **Quest pill**: a small, always-visible current objective ("Collect 10 coins 3/10") that updates live and advances automatically. Players who skip everything still know what to do.
- **Progressive disclosure of UI**: HUD starts with only what's needed; buttons appear (with a little celebration) when their system unlocks.
- **Celebrate firsts**: first purchase, first rebirth, first win get bigger feedback than later ones.
- **Fail fast, fail cheap**: early failure costs seconds, not progress (checkpoints, instant respawn, retry button).

## 7. Anti-patterns (each one costs players)

- Title screen / "Play" button / long intro cutscene before control.
- Text walls, multi-page tutorials, "Read the rules" signs.
- Forced settings, character creator or class choice before playing.
- Spawning in a huge empty hub with ten portals and no indication of which one first.
- Teaching every system in the first minute ("here's pets, here's trading, here's rebirth...").
- A first task that takes longer than 60 s before any reward.
- UI that covers the play area on phones, or buttons under the thumbstick.
- Waiting for a round with nothing to do in the lobby.
- A store popup or premium offer before the player has had fun. Offer starter packs after the first loop closes, never at spawn.
- Punishing new players with stronger veterans in the same space with no protection (spawn protection, separate servers or zones by level, matchmaking).

## 8. Returning players and friends joining

- **Returning players** skip onboarding, spawn at their furthest unlocked area or at the hub with their next goal highlighted, and see what's new (update board, claimable reward) within the first 10 seconds.
- **Friend joins** (`Player:GetJoinData()` / following a friend): spawn near the friend or give a one-tap "teleport to friend" button; let new players help friends meaningfully (shared kills, shared rewards, a team mechanic) so the friend isn't held back by them.
- **Invites**: `SocialService:PromptGameInvite` at natural moments (after a win, when starting a co-op activity), never on a timer. Reward the inviter only within Roblox's rules.

## 9. Instrumenting the onboarding funnel

Log every onboarding step once per player with `AnalyticsService:LogOnboardingFunnelStepEvent(player, step, stepName)`. Steps are numbered from 1 in order; the Creator Hub Analytics funnel then shows the percentage of new players reaching each step, which tells you exactly where they leave.

Good steps are concrete, observable actions, 6–12 of them across the first 5–10 minutes:

```lua
-- Server side, in the Service that owns each step (once per player: track in their data).
local AnalyticsService = game:GetService("AnalyticsService")

local STEPS = {
	"Spawned",            -- 1
	"FirstMove",          -- 2
	"FirstCollect",       -- 3
	"FirstReward",        -- 4
	"FirstUpgrade",       -- 5
	"ReachedZone2",       -- 6
	"SawLongTermGoal",    -- 7
	"FirstSessionEnd5m",  -- 8 (still here after 5 minutes)
}

local function logStep(player: Player, step: number)
	AnalyticsService:LogOnboardingFunnelStepEvent(player, step, STEPS[step])
end
```

Rules: keep step numbers stable once live (add new steps only at the end or start a new funnel), log on the server where possible, and log only for new players (onboarding funnels are meant for first-time users). For flows that repeat (shop visits, round stages) use `LogFunnelStepEvent` with a funnel session id instead.

Read the funnel: the biggest single drop is the next thing to fix. A drop at step 1→2 is a loading/spawn problem; 2→4 is teaching/clarity; 4→6 is loop satisfaction; after 6 it's long-term motivation.
