---
name: roblox-game-design
description: Design Roblox games that players understand in seconds and come back to - the hook (icon, thumbnail, title and the first minute that pays them off), first-time user experience and onboarding, core / meta / social loops, progression and economy, level and map design with real Roblox avatar metrics (jump gaps, walk speed, camera room), session pacing, retention, ethical monetization, playtesting and analytics funnels. Produces a one-page game design doc, a second-by-second first-session script, loop diagrams, level blockout specs, tuning tables and playtest plans, or audits an existing game with a scorecard and ranked fixes. Use this whenever the user is brainstorming or pitching a Roblox game idea, asks how to make their game fun, addictive, sticky or easier to start, has players leaving early or low retention, wants to design a tutorial, lobby, map, obby course, tycoon, simulator, round system, progression or shop, or asks "why aren't people playing my game", even if they don't use the word "design".
---

# Roblox game design

On Roblox a player is one tap from leaving and one tap from the next game. They arrive from a thumbnail, often on a phone, often because a friend is already inside, and they decide within the first minute whether this game is worth their evening. Most games lose most of their players before the fun starts: a menu, a loading screen, a wall of text, a spawn room with no direction.

So the job of design here is: **make a clear promise, pay it off almost immediately, then reveal a reason to stay and a reason to come back.** Everything in this skill serves that sequence.

## The five questions every design must answer

Answer these in one line each before anything else. If you can't, the concept isn't ready, and that is the first thing to tell the user.

1. **The promise** — what fantasy or feeling does the thumbnail sell? ("Build the biggest candy factory", "Survive the night in a haunted school with friends")
2. **The verb** — what does the player physically do most of the time? (jump, collect, build, fight, hide, drive, trade). The best Roblox games have one verb you could explain to a 9-year-old by doing it once.
3. **The first payoff** — what happens in the first 30 seconds that delivers a taste of the promise?
4. **The reason to stay** — what visible goal pulls them from minute 2 to minute 20? (next zone, next upgrade, the round's win condition, the boss)
5. **The reason to return** — what changes or waits for them tomorrow? (progress, a timed reward, friends, a limited event, an unfinished goal)

The one-sentence pitch combines them: **"In [game], you [verb] to [short goal] so you can [long goal / fantasy]."**

## Decide the mode

| The user wants... | Produce |
|---|---|
| A new idea shaped into a game | One-page GDD from `assets/gdd-template.md`, with the five answers, loop diagram, first-session script, and the first three things to prototype. Offer 2–3 hook variants if the idea is vague. |
| Better onboarding / players leave early | First-session script (second by second), the onboarding funnel steps to instrument, and the specific changes. Read `references/hook-and-onboarding.md`. |
| A map, level, obby course or lobby | Blockout spec: purpose, critical path, landmarks, beats with timings, dimensions in studs using `references/level-design.md` metrics, and a playtest checklist. |
| Progression, economy, upgrades, shop | Loop diagram + tuning table (costs, rewards, time per step) with the formula behind it. Read `references/loops-and-progression.md`. |
| A genre game (obby, tycoon, simulator, tower defense, battlegrounds, horror...) | Start from that genre's playbook in `references/genre-playbooks.md`, then make it specific. Name what will make *this* one different. |
| A review of an existing game | Scorecard (below) + top 5 fixes ranked by expected impact on the first session. Ask for the game link, a video, or a description of the first 2 minutes. |
| Measuring / playtesting | Playtest plan and analytics funnel from `references/playtesting-and-metrics.md`. |

Ask at most two questions before producing something (target audience/age and platform priority are the usual ones); otherwise state assumptions and go. Designs are easier to react to than questions.

## Principles

**Promise before permission.** The player should be moving and doing the verb before you ask anything of them: no title screen, no "Play" button, no class selection, no settings. If a menu is truly needed (choosing a team), make it a choice inside the world (walk through one of two doors) or auto-pick with a change-later option.

**Time to fun is the number one metric of the first session.** Targets for a first-time player, from the moment the world appears:
- **under 5 s**: in control of the character, facing something interesting
- **under 15 s**: doing the core verb
- **under 30 s**: first reward with satisfying feedback (sound, number pop, particles)
- **under 2 min**: the core loop has closed once (do → earn → spend/upgrade → do better)
- **under 5 min**: the long-term goal is visible (the big locked zone, the leaderboard, the rare item someone else has)
- **before they leave**: a reason to come back is planted

**Teach by doing, one thing at a time.** Put the player where the only thing to do is the thing you're teaching. Use the world (a glowing path, a Beam to the objective, an arrow, a single lit door) before UI, and UI before text. Text is a last resort: under eight words, on screen at the moment of need, never blocking movement. Introduce a mechanic safely, then test it, then twist it (`references/level-design.md` explains teach → test → twist).

**Always show the next goal.** At every moment the player should be able to answer "what am I doing right now and what is next?" from the screen alone: a quest pill, a progress bar to the next upgrade, a waypoint, a countdown. Confusion, not difficulty, is what makes Roblox players leave.

**Make the loop feel good before making it long.** A 3-second action with great feedback beats a deep system with weak feedback. Juice the verb (sound, camera kick, particles, numbers flying to the counter) before adding a second currency.

**Design for the phone first.** Most Roblox players are on mobile. Big readable shapes, thumb-reachable buttons (44 px minimum, away from the joystick and jump button), no tiny text, no hover-only info, short sessions supported. Then make sure keyboard, gamepad and VR (if supported) all work.

**Friends are the hook multiplier.** Many players join because a friend is already in. A friend joining mid-session must be able to find and play with them within seconds (spawn near friends, party/team-up, shared goals, visible other players doing cool things). Social proof (other players' pets, builds, ranks) sells the long-term goal better than any tutorial.

**Respect the player.** Many players are children. No deceptive countdowns, no frustration designed in to sell the fix, no hidden odds, no punishing players who don't pay. Paid random items must show their odds before purchase, and monetization must follow Roblox's current policies; check them when designing a shop. Sustainable games monetize speed, convenience, expression and access, not relief from manufactured pain.

## Scorecard (for reviews)

Score each 0 (missing), 1 (present but weak), 2 (strong), with one line of evidence. Total out of 24.

| # | Criterion | 2 looks like |
|---|---|---|
| 1 | Promise | Icon, thumbnail and title show the verb and the fantasy; a stranger can say what the game is from the thumbnail alone. |
| 2 | Time to control | In control and facing something interesting within 5 s of the world appearing; no menus or long loading screens. |
| 3 | Time to verb and first reward | Doing the core verb by 15 s, first juicy reward by 30 s. |
| 4 | Goal clarity | The current goal and next step are always readable on screen without text walls. |
| 5 | Teaching | Mechanics taught by doing, one at a time, at the moment they're needed; nothing is explained twice. |
| 6 | Core loop | Closes within 2 minutes; each repetition feels slightly better (bigger numbers, new options). |
| 7 | Long-term goal | Visible early (locked zone, leaderboard, rare items on other players). |
| 8 | Feedback / juice | Every action has sound + visual response; rewards feel physical. |
| 9 | Mobile readiness | UI readable and tappable on a phone, controls work with touch, performance OK on low-end. |
| 10 | Social | Friends can join and play together immediately; other players' progress is visible and aspirational. |
| 11 | Return reason | Session ends with progress saved and something waiting tomorrow. |
| 12 | Fairness | Monetization sells convenience/expression/access, odds disclosed, free players can enjoy and progress. |

Under 12: fix the first session before anything else. 12–18: solid base; focus on the lowest two. 19+: the bottleneck is likely discovery (icon/thumbnail testing) or long-term content cadence.

Rank fixes by **(players affected × size of drop-off) ÷ effort**. Anything in the first 60 seconds affects every player, so it almost always ranks first.

## Output style

- Lead with the one-sentence pitch and the five answers. Then the artifact the user asked for.
- Be concrete: seconds, studs, coin amounts, number of steps, not "make it engaging".
- Draw loops as small diagrams (Mermaid or ASCII arrows), first sessions as timelines, economies as tables with the formula.
- Mark assumptions clearly ("Assuming 9–14 audience, mobile-first").
- End with **what to prototype first** (the smallest build that tests whether the verb is fun) and **how to tell if it worked** (the metric or playtest observation).
- When the user also wants it built, hand off structure decisions to the `roblox-project-structure` skill if installed, effects to `roblox-vfx`, and animations to `roblox-animation`.

## References

- `references/hook-and-onboarding.md` — discovery assets (icon, thumbnail, title), the first-session timeline, FTUE patterns and anti-patterns, guiding the player, first-time vs returning flows, loading, instrumenting the onboarding funnel with `AnalyticsService`.
- `references/loops-and-progression.md` — core / meta / social / session / live-ops loops, reward schedules, progression curves with formulas, economy sources and sinks, rebirth/prestige, daily systems, ethical monetization patterns.
- `references/level-design.md` — Roblox avatar and camera metrics, jump-gap maths, spawn and hub design, critical path, landmarks and wayfinding, teach → test → twist, pacing and intensity curves, checkpoints, PvP map layout, blockout workflow.
- `references/genre-playbooks.md` — obby, tycoon, simulator, round-based, battlegrounds/fighting, tower defense, horror/story, roleplay/hangout, survival/crafting, RPG/adventure, racing, minigame/party: fantasy, loops, first 60 seconds, retention driver, pitfalls.
- `references/playtesting-and-metrics.md` — playtest protocol, what to watch for, key metrics and rough benchmarks, funnel design, A/B testing, iteration cadence.
- `assets/gdd-template.md` — the one-page game design doc to fill in.
