# References and licences

## Why references

Art drawn from memory gets proportions and features wrong (mugs too tall, swords with tiny guards, cats that read as
dogs). Two kinds of reference fix different things:

| Kind | Source | Tells you | Use as |
|---|---|---|---|
| Icons / emoji | Iconify API: Fluent Emoji (MIT), Noto Emoji (Apache-2.0), Twemoji (CC BY 4.0), OpenMoji (CC BY-SA 4.0), EmojiOne (CC BY 4.0), Firefox emoji (Apache-2.0), game-icons.net (CC BY 3.0), UI sets (Phosphor, Tabler, Lucide, Material) | how professionals simplified the object: which features survive, colour blocking, angle | study; or, with attribution, a base shape (`k.svgFile`) you restyle |
| Photos | Wikimedia Commons, Openverse (filtered to licences that allow commercial use and modification) | real proportions, materials, colours, details | measure (`trace`, `palette`), never paste into the art |

`rart refs "<object>" [--kind icons|photos] [--sets color|shape|ui|pixel]`. Query with simple nouns ("burger",
"sword", "cat face"). Icon search matches icon names, so try synonyms. Everything lands in `refs/` with
`sources.json` (title, page, licence, author) and a numbered `contact-sheet.png`: look at it once instead of
opening every file.

Photos: prefer plain backgrounds (product shots, museum photos, natural-history plates) for tracing; side views for
side-view icons; several ordinary examples over one striking but atypical one.

## Using licensed material in a shipped game

- **MIT, Apache-2.0, CC0, public domain**: use and modify freely (keep a credit line in your credits anyway).
- **CC BY (2.0-4.0)**: use and modify, with attribution (author, title, licence, link, and that you changed it).
  The engine writes `CREDITS.md` from the asset's `credits` field; put the credits somewhere players or the game's
  description can see them.
- **CC BY-SA**: as CC BY, and your adapted image must be shared under the same licence. Avoid for game art you
  want to keep proprietary; fine for study.
- **NC (non-commercial) and ND (no derivatives)**: never in a game with any monetization; the search excludes them.
- Photos used only to measure are not copied into the art, but keep `sources.json` anyway.

## What not to do

- Do not trace, copy or imitate another game's assets, logos, characters, map art or UI, or recognisable brands
  (Roblox moderation and copyright law both apply). Learning how a genre presents things (rays behind a rarity item,
  big glossy text) is fine; copying a specific design is not.
- Do not use real people's likeness or trademarks on store media.
- Do not present AI-generated or traced work as a licensed source's original.
