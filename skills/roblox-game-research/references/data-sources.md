# Data sources and how to read them

## Endpoints used by `rbxresearch.cjs`

All are public, need no login, and are the same ones the Roblox website calls. The explore-api (charts) is undocumented and can change without notice; if a call starts failing, open roblox.com/charts in a browser and compare.

| Data | Endpoint |
|---|---|
| Chart sorts (Charts page) | `apis.roblox.com/explore-api/v1/get-sort-content?sessionId=<uuid>&sortId=<id>&device=<d>&country=<c>` |
| Place → universe id | `apis.roblox.com/universes/v1/places/<placeId>/universe` |
| Game details (up to 50 ids) | `games.roblox.com/v1/games?universeIds=<ids>` |
| Likes / dislikes | `games.roblox.com/v1/games/votes?universeIds=<ids>` |
| Game passes with prices | `apis.roblox.com/game-passes/v1/universes/<universeId>/game-passes?passView=Full&pageSize=100` |

Not public: revenue, developer products and their sales, retention rates, session length, DAU. Don't present guesses about these as data.

Be polite: the script makes sequential requests with a delay and retries on HTTP 429. Don't loop it at high frequency; a snapshot once or twice a day is plenty.

## Chart sorts

| Sort id | Means | Use it to find |
|---|---|---|
| `top-trending` | Largest relative increase in daily active users over the past week | What's going viral right now (includes old games that just had a big update) |
| `up-and-coming` | Published in the last 28 days, sorted by user growth | New breakouts: fresh loops and themes, what fast followers are copying |
| `top-earning` | Robux spent in the last 7 days (among games with 5k+ daily users, top 10% DAU or top 30 played) | Loops that monetize |
| `top-revisited` | Share of users who return after a week (same eligibility) | Loops that retain: the best signal of lasting design |
| `top-playing-now` | Concurrent users | Raw size right now |
| `top-rated` | High number and share of positive ratings (5k+ daily users) | Quality and player satisfaction |
| `fun-with-friends` | Share of time spent playing in groups (5k+ daily users) | Social loops |
| `top-paid-access` | Paid-access games by daily revenue | Paid-entry models |

Filters: `device` (`all`, `computer`, `low_end_phone`, `high_end_phone`, `low_end_tablet`, `high_end_tablet`, `console`, `vr`) and `country` (`all` or a lowercase country code). Roblox notes that order depends on the filters, so compare like with like. Games marked **sponsored** are paid placements; their presence says nothing about organic performance.

## Game metrics

| Metric | What it tells you | Traps |
|---|---|---|
| Playing (CCU) | Size right now | Swings hugely by hour and weekday (school hours and time zones). Compare snapshots taken at the same time of day; weekends run higher. |
| Visits | Lifetime joins | Counts every join, including rejoins and very short sessions. Old games carry years of visits. |
| Visits/day (lifetime) | Average pull since launch | Misleading for old games (early years were smaller) and for games that spiked and faded. Use snapshot deltas for recent pull. |
| Visits/day (snapshot delta) | Recent pull | Needs 6+ hours between snapshots, ideally 24 h or more. The best public momentum signal. |
| Favorites per 1k visits | How many visitors cared enough to favorite | Genre-dependent and skewed by massive old games; compare within a genre and age bracket. A new game far above its peers has a strong hook. |
| Like % and vote count | Satisfaction | New games and small games skew high. Low vote counts mean little. A drop after an update means the update hurt. |
| Age (days) | Breakout vs veteran | A game under 60 days old in top-earning is a fresh pattern worth studying now. |
| Days since update | Live-ops cadence | Top games update weekly or more. A leader that hasn't updated in months is vulnerable. |
| Max players | Server size, a design decision | Small servers (5–10) concentrate interaction (stealing, competition) and fill quickly; large servers (25–50) suit social and roleplay games. |
| Genre (L1 / L2) | Roblox's own classification | Developer-chosen; useful for grouping, not always precise. |
| Description | Often the whole loop in "How to play" lines, update notes, notify prompts, group perks | Marketing text; verify by playing. |
| Game passes | Permanent perks and prices | Shows what's offered, not what sells. Most revenue in many games comes from developer products, which aren't listed. |

## Reading signals together

- **Viral and sticky**: trending or up-and-coming, plus in top-revisited later. Rare and valuable to study.
- **Viral but shallow**: high growth, low favorites/likes, absent from revisited. The hook works, the loop doesn't hold. A better-retaining take on the same hook is an opportunity.
- **Lucrative and saturated**: top-earning, many similar games, all old. Hard to enter without a clear twist or a big budget.
- **Neglected leader**: high CCU but long since an update, falling likes. Players may move to a well-made alternative.
- **Wave**: several new games with the same loop in up-and-coming within days. A live trend; the window is short, and only the first or the clearly best usually win.

## Other public sources

Use these when web access is available, and cite them:
- The game's page: description, update notes, badges, community links.
- Community wikis for big games: mechanics, rarities, drop rates, prices, update history.
- DevForum posts, talks and interviews by the developers (postmortems are gold).
- Roblox's own creator docs on discovery and analytics (how recommendations treat engagement, retention and monetization).
- Third-party trackers that chart historical player counts. Check them manually in a browser and follow their terms; the script doesn't scrape them.
- Video platforms: what creators make videos about shows what's shareable. You can't watch videos; ask the user, or read titles and descriptions.
- The user's own play session (teardown-template.md) and screenshots.

For the user's own game, Creator Hub analytics shows real retention, session length, funnels and revenue, with benchmarks against similar experiences. That's the data to optimize on after launch.
