# Monetization teardown

## 1. Catalogue what the games sell

**Game passes** (permanent, one-time): `rbxresearch.cjs games ... --passes` lists every pass for sale with its price, sorts it into a ladder, groups passes into types, and aggregates the price distribution across the games you pass in. Run it on the 3–6 games in the teardown set and on a wider set from `top-earning` in the same genre.

**Developer products** (repeatable) aren't public. Collect them from play sessions and screenshots:
- currency packs (how many tiers, Robux price per tier, bonus % on bigger packs)
- timed boosts (2× money, 2× luck, for 15/30/60 minutes)
- random rewards (eggs, crates, spins): price, whether odds are shown before purchase
- skips, revives, instant finishes
- gifts (buying for another player)
- limited-time or starter offers (price, what's inside, when shown)

**Other**: subscriptions, private server price, paid access, avatar items, Premium benefits.

## 2. Pass archetypes

The script groups passes by name into these types:

| Type | Examples | Notes |
|---|---|---|
| 2× / multiplier | x2 Cash, x2 Growth Speed | Usually the bestseller in progression games; often several (one per stat) |
| VIP / premium perks | VIP, Premium plots | Bundle of small perks plus status (tag, area, chat color) |
| Luck / odds | Lucky, +luck | Collection games; pairs with eggs/spins |
| Capacity / slots | +1 slot, bigger backpack | Removes friction the player already feels |
| Automation | Auto collect, auto sell, AFK | Popular with idle-style players |
| Speed / movement | Faster walk, fly, teleport | Common in big maps |
| Skip / instant | Skip stage, instant hatch | Obbies, timers |
| Cosmetic / expression | Trails, auras, titles | Safe in competitive games |
| Tools / items | Special tool, vehicle, pet | Can tip into pay-to-win |
| Admin / fun commands | Commands, boombox | Social games |

A **price ladder** has a cheap entry pass (impulse), several mid passes, and one or two premium passes. Look at where the leaders put their cheapest and most expensive pass, and how many passes they have: some top earners have only two or three passes and earn mainly from products.

## 3. Placement teardown

Note for each offer: where it appears and what triggered it.
- The shop the player opens (always available, low pressure)
- Contextual prompts at the moment of need (inventory full → "+slots"; a rare egg → "luck boost")
- After success (a celebration with an offer) or after failure (a revive)
- Timed popups (often annoying; measure how often)
- Physical in-world stands or VIP doors (visible aspiration)
- Starter pack after the first loop closes

Good placements sell relief from friction the player already feels and boosts at moments of excitement. Avoid copying aggressive popups: they hurt retention, and retention drives discovery.

## 4. A launch monetization plan (template)

For an MVP, model it on the observed ladder in the target genre, then adjust after launch data:

| Item | Type | Price (R$) | Why |
|---|---|---|---|
| 2× [main currency] | pass | from the genre's observed range | Progression accelerator |
| VIP | pass | | Status plus small perks |
| +[slots/storage] | pass | | Removes the first friction players hit |
| Auto-[collect/train] | pass | | For idle-leaning players |
| Currency packs (3–5 tiers) | product | | Bigger tiers with bonus % |
| 15-min boost | product | | Impulse at moments of excitement |
| Starter pack (once) | product | | Offered after the first loop closes, good value |

Fill the price column from `--passes` data on the shortlist (median and typical range for each type), not from memory. Add events, limited items and subscriptions after launch.

## 5. Revenue estimation (only with stated assumptions)

Public data can't give revenue. If the user wants a rough model for their own plan:

```
daily Robux spent  ≈ DAU × payer conversion × average Robux per payer per day
creator Robux      ≈ daily Robux spent × creator share (for passes/products the creator
                     receives the larger share after Roblox's fee; check current terms)
USD via DevEx      ≈ creator Robux × current DevEx rate (check Roblox's DevEx page)
```

Ask for or state each assumption, compute a low/mid/high range, and say it's a model. DAU can't be read from public data (only CCU), and conversion and spend vary hugely by genre and audience. Premium Payouts (earnings from Premium subscribers' playtime) add revenue that grows with engagement, not purchases.

## 6. Policy and fairness limits

Check Roblox's current policies before finalizing a shop; they change:
- Paid random items (eggs, crates, spins bought with Robux, directly or through a premium currency) must show odds before purchase, and some regions restrict them.
- Don't mislead about prices, contents or time limits; no fake countdowns.
- Rules on advertising, age ratings and content maturity affect who can see the game.
- Pay-to-win in competitive modes drives away the free majority that makes servers feel alive. Selling speed, convenience, capacity and expression scales better.
- Grant purchases securely (ProcessReceipt, idempotent): see the `roblox-security` skill.
