---
name: roblox-game-research
description: Research which Roblox games are going viral and which are truly successful (trending, up-and-coming, top earning, best retention, most played) using live data from Roblox's public charts and game APIs, then tear down how the winners work - hook, first minute, core and meta loops, mechanics, social and viral drivers, update cadence and monetization (game passes with real prices, products, offer placement) - and turn the patterns into an original game brief with a twist, an MVP scope and a monetization plan. Teaches the line between learning from a game's design (allowed and normal) and cloning its name, art, characters, maps or code (not allowed). Use this whenever the user asks what's trending or popular on Roblox, which games make the most Robux, why a game blew up, wants to analyse or "copy the formula" of a successful game, look for a game idea that can make money, compare competitors in a genre, or study game passes and pricing, even if they just say "what game should I make".
---

# Roblox game research

Most successful Roblox games are not new genres. They are a **proven loop** (collect → upgrade → show off, survive the round, grow the base) wearing a **fresh hook** (a funny theme, a new verb, a social twist) and launched at the right moment. Research is how you find both: which loops are working right now, and what made the winners stand out from the dozens of games using the same loop.

So the output of this skill is never "make game X again". It is: **here is how the winners work, here is what everyone in the genre must have, here is what made the top one different, and here is an original game that uses the proven parts with its own hook.**

## Copy the pattern, not the game

Game mechanics, loops, genres and monetization structures are shared knowledge; every genre on Roblox exists because people built on each other's ideas. The expression of a game belongs to its creator. Be explicit about this with the user from the start:

| Learn from and reuse freely | Never copy |
|---|---|
| Core loop structure (steal → hatch → earn → upgrade) | The game's name, or a name built to be confused with it ("X 2", "X but better") |
| Mechanics and systems (rebirths, rarity tiers, base stealing, rounds, trading) | Characters, creatures, logos, icons, thumbnails, art style lifted from it |
| Pacing and onboarding techniques (first reward in 30 s) | Models, meshes, textures, sounds, music, animations, UI art |
| UX conventions of the genre (quest pill, bottom-bar shop) | Map and level layouts reproduced piece by piece |
| Monetization structure (2× pass, VIP, slots) and price ranges | Text, lore, item names, update descriptions |
| Update cadence and live-ops tactics | Code or assets from stolen/"saveinstance" copies or uncopylocked places without a license |

Refuse to help obtain or reuse another game's files, assets or code (place-stealing tools, ripped models, reuploads), and don't design thumbnails or titles meant to be mistaken for another game. Beyond being wrong, these get games taken down through DMCA claims and Roblox moderation, which ends the monetization plan anyway.

## Workflow

### 1. Frame the question (one message, then go)
Find out, or assume and state: team size and skills (solo scripter? builder? artist?), time to first release (2 weeks vs 3 months), target audience, and whether they're chasing a fast trend or building a long-lived game. These decide which opportunities are realistic: a solo dev with 3 weeks should ride a simple fast-moving trend; a team with months can enter a deep genre with a twist.

### 2. Pull live market data

```bash
node <skill>/scripts/rbxresearch.cjs charts                     # trending, up-and-coming, earning, revisited, playing now
node <skill>/scripts/rbxresearch.cjs charts --genre Simulation --limit 40
node <skill>/scripts/rbxresearch.cjs sorts                      # list every chart sort and what it means
```

Read the charts as signals:
- **Viral now**: `top-trending` (fastest relative growth this week) and `up-and-coming` (new in the last 28 days, by growth).
- **Proven success**: `top-earning` (Robux spent in 7 days), `top-revisited` (players coming back after a week: retention), `top-playing-now` (concurrent players), plus `top-rated` and `fun-with-friends`.
- **The "In several charts" table** is the shortlist generator: a game that is trending *and* earning *and* revisited has a loop that spreads, monetizes and retains.
- **Genre counts per chart** show where the wave is. A genre dominating up-and-coming is a live trend; one dominating top-earning but absent from up-and-coming is lucrative but saturated with established leaders.

`--genre` must match a genre name exactly as printed in the "Genres:" lines (e.g. `"Obby & Platformer"`). Filters: `--device` (`all`, `computer`, `low_end_phone`, `high_end_phone`, `console`...) and `--country` (`all` or a country code such as `us`, `id`, `br`) show regional and platform differences. Mobile-heavy charts are the norm.

Then get details for the candidates:

```bash
node <skill>/scripts/rbxresearch.cjs games u:<universeId> u:<id> https://www.roblox.com/games/<placeId> --passes --snapshot research/snapshots
```

This prints players, visits, visits/day over the game's life, favorites per 1k visits, like %, age, days since last update, max server size, the description (top games often list their whole loop as "How to play" lines), and with `--passes` every game pass with its price plus a summary of pass types and price ranges across the games. `--snapshot` stores the numbers; run the same command again 1–7 days later at the same time of day and it reports **recent** visits/day and player growth, which is the best momentum signal available publicly.

See `references/data-sources.md` for what each number means, how to read it, and its traps (sponsored placement, daily player cycles, bots, old games with inflated lifetime visits).

### 3. Shortlist 3–6 games for teardown
For one opportunity (a genre or a loop), pick: the **leader** (top earning/playing), one or two **rising challengers** (trending), and one **recent breakout** (up-and-coming). Comparing them shows what is table stakes and what made each one win.

### 4. Gather evidence for each
- The script output (stats, description, passes).
- Public sources: the game's page and update notes, its community wiki (most big games have one documenting mechanics, rarities, prices and update history), DevForum posts by the developers, interviews and talks. Use web search/fetch when available, and cite sources.
- **Playing it**: you can't play, so ask the user to play the first 10–15 minutes with the observation sheet in `references/teardown-template.md` (times, first reward, prompts, prices seen, what the shop pushes), or to send screenshots or a recording, which you can read. Developer products (currency packs, boosts, spins) are not in the public API: they're found in-game.

### 5. Tear each game down
Use `references/teardown-template.md`: the promise (icon/thumbnail/title), first 60 seconds, core loop, meta loop, social and viral drivers, retention hooks, live ops, monetization map, and **the one thing that made it different**. Keep facts (from data or observation) separate from inferences, and label inferences.

### 6. Synthesize the pattern
- **Genre baseline**: features every top game in the set has. A new game needs these just to compete.
- **Differentiators**: what the leader or the breakout did that others didn't.
- **Viral mechanics**: why players brought friends or why creators made videos (see `references/pattern-library.md` for the recurring ones).
- **Monetization pattern**: pass types and price ladder, product types, where offers appear.
- **Gaps**: complaints in reviews/comments/wiki discussions, missing features, an audience or platform no one serves well, a theme no one has used for this loop.

### 7. Score opportunities and pick one
Use the opportunity scorecard in `references/pattern-library.md`: demand (players in the genre/loop), trend direction, competition (how strong and how many), build cost for this team, time sensitivity, monetization fit, retention potential, and risk (policy, IP, hype collapse). Recommend one, with the runner-up.

### 8. Write the remix brief
The deliverable: an original game built on the proven pattern. Structure:

1. **Pitch**: "In [game], you [verb] to [goal] so you can [fantasy]." With an original name.
2. **What we keep from the pattern** (the loop and systems, with which reference games prove them).
3. **Our twist** (at least one strong difference players can see in the thumbnail: theme, verb, social mechanic, or audience) and why it should beat or sidestep the leaders.
4. **Originality check**: name, art direction, characters, world and UI are our own; nothing copied from the "Never copy" column.
5. **MVP scope**: the smallest build that delivers the first session (spawn → core verb → first reward → first upgrade → long-term goal visible), what's cut until after launch, and a realistic timeline for this team.
6. **Monetization at launch**: 3–6 game passes and a few developer products modeled on the observed ladder, with prices, plus what's added later (`references/monetization-teardown.md`).
7. **Launch and live ops**: update cadence, first events, how to read the first week's data.
8. **Success criteria**: the onboarding funnel and D1 retention to beat before spending on ads.

Then hand over: the `roblox-game-design` skill for the full design doc and first-session script, `roblox-project-structure` to set up the codebase, `roblox-security` for the economy and remotes (monetized games attract exploiters fast), `roblox-vfx` and `roblox-animation` for juice.

## Be honest about the data

- Public numbers show players, visits, favorites, likes and game pass prices. They don't show revenue, retention rates, session length or developer product sales. Chart rank in `top-earning` is the only public revenue signal; never present a revenue figure as fact. If the user wants an estimate, use the formula in `references/monetization-teardown.md` with their stated assumptions and show the range.
- Trends on Roblox move in weeks. Date every report, and recommend re-running the charts before committing.
- Success has causes you can't see (an existing community, a YouTuber's video, ad spend, a group with millions of members). Say so when a game's rise looks driven by those rather than design.

## References

- `references/data-sources.md` — the endpoints the script uses, every metric and how to interpret it, chart definitions, pitfalls, and other public sources.
- `references/teardown-template.md` — the teardown sheet, the player observation sheet for the user's play session, and the cross-game comparison matrix.
- `references/pattern-library.md` — recurring viral and success patterns on Roblox (loops, social mechanics, distribution tactics) described generically, plus the opportunity scorecard.
- `references/monetization-teardown.md` — cataloguing passes and products, archetypes and price ladders, offer placement, a launch monetization plan, revenue estimation with assumptions, and policy limits.
- `scripts/rbxresearch.cjs` — charts and game data. `scripts/selftest.cjs` checks its calculations (`--live` also calls the charts endpoint once).
