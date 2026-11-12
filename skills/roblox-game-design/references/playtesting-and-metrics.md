# Playtesting and metrics

## 1. Playtesting protocol

Watch real people play before trusting any design. Five fresh players find most first-session problems.

**Who**: people who have never seen the game, from the target audience, on the target device (phones!). Teammates are blind to their own game's confusing parts.

**How**:
1. Give no instructions beyond "play this however you like". Do not help. Every time you want to explain something, write it down: that's a design bug.
2. Record the screen (and their face/voice if they agree). Ask them to think aloud, or watch silently and note behaviour; both work.
3. Time stamps to capture: first move, first verb, first reward, first upgrade, first confusion, first failure, the moment they look bored, and when they would have left ("tell me when you'd normally close the game").
4. Afterwards, ask: "What was the game about?" "What were you trying to do?" "What was the best moment?" "What was confusing?" "Would you play again tomorrow, why?" Their answer to "what was the game about" should match your one-sentence pitch.
5. Fix the top issue, test again. Small fast rounds beat one big test.

**What to watch for**:
- Spinning the camera / walking in circles in the first 10 s = no clear first goal.
- Tapping UI randomly = the UI doesn't explain itself.
- Skipping text without reading = expected; don't rely on it.
- Repeating a failed jump/fight > 5 times = difficulty spike.
- Looking away from the screen / phone = boredom; note what was happening.
- Smiles, "oh!", "wait, can I...?" = the hook; amplify those moments.

**Live playtests**: private servers or a staging experience with invited testers. Also watch new players in live servers yourself (join quietly) and read community feedback, but weight observed behaviour over opinions.

## 2. The metrics that matter

Creator Hub → Analytics gives these for every experience, with benchmarks against similar experiences where available. Read them per platform (mobile vs desktop vs console) and new vs returning players.

| Metric | Measures | Moved mostly by |
|---|---|---|
| Impressions → plays (click-through) | the promise (icon, thumbnail, title) | discovery assets |
| Onboarding funnel completion | the first minutes | FTUE, spawn, clarity |
| Session length (average / median) | the core and meta loops | loop satisfaction, goals, content |
| Day 1 retention | first session's promise kept + a reason to return | onboarding, return hooks |
| Day 7 / Day 30 retention | long-term goals, social, content cadence | meta loop, live ops, community |
| Playtime per DAU | overall engagement | all loops |
| Payer conversion, ARPPU, ARPDAU | monetization fit | offer design and placement |
| Concurrent users (CCU) and its daily shape | overall health | everything; watch after updates |

Rough community rules of thumb (vary a lot by genre and audience; prefer the Creator Hub benchmarks for your genre):
- Day 1 retention: under ~10% means the first session is broken; ~20%+ is workable; 30%+ is strong.
- Day 7 retention: ~5–8% workable, 10%+ strong.
- Average session: under 5 min means players don't find the loop; 15–20+ min is healthy for most genres.

Discovery: Roblox's recommendation system favors experiences that keep and satisfy the players it sends (engagement and retention signals, among others). Improving the first session therefore also improves traffic. Don't optimize click-through with misleading thumbnails: it raises clicks and lowers the engagement signals.

## 3. Funnels and events

- **Onboarding funnel** (`LogOnboardingFunnelStepEvent`): 6–12 steps across the first 5–10 minutes (see hook-and-onboarding.md §9).
- **Recurring funnels** (`LogFunnelStepEvent` with a funnel session id): shop flow (open → view item → purchase prompt → purchased), round flow (queued → round start → first kill → round end), quest flow.
- **Economy** (`LogEconomyEvent`): every source and sink, with an item/reason name. Answers "where does currency come from and go".
- **Progression** (`LogProgressionEvent`): level/stage reached, completed, failed. Answers "where do players get stuck".
- **Custom** (`LogCustomEvent`): anything else countable (deaths per stage, rebirths, trades).

Instrument on the server, in the system that owns the event, with stable names. Decide the questions before adding events: every event should answer a question someone will act on.

## 4. Changing things safely

- **One change at a time** when measuring, or you won't know what worked. Compare the same days of the week (weekends differ).
- **A/B test** when possible: assign players to variants by `UserId` hash on the server (`userId % 2`), log the variant as a custom field on funnel events, compare funnels. Keep the assignment stable per player. Run long enough to get a few thousand new players per variant before deciding.
- **Watch for side effects**: a change that raises session length but drops D1 is usually a false win (e.g. a longer forced tutorial).
- **Keep a changelog** with dates, so metric changes can be traced to updates.

## 5. Iteration cadence

1. **Prototype** the core verb in a grey box (days, not weeks). Ask only: is doing this for 2 minutes fun?
2. **Vertical slice**: first 10 minutes polished (spawn, onboarding, first loop, first upgrade, first long-term goal reveal). Playtest with 5+ fresh players per iteration.
3. **Soft launch**: publish publicly with minimal promotion; measure the onboarding funnel, D1, session length. Fix the first session until the numbers are healthy before spending on ads or big content.
4. **Grow**: add meta systems and content in regular updates; use sponsored/ads only once D1 and session length are healthy (paid traffic into a leaky first session is wasted).
5. **Live ops**: weekly or bi-weekly updates, events, community. Re-read metrics after each.
