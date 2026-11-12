---
name: roblox-project-structure
description: Set up, audit and grow a Roblox codebase the way professional Roblox studios do - Rojo file sync, Wally packages, Rokit toolchain, a single bootstrap script per side that loads Services and Controllers, tag-based components, one declared networking layer, session-locked player data, typed strict Luau, Selene / StyLua linting and CI. Scaffolds a new project that runs out of the box, reviews an existing place or repo against a checklist and produces a migration plan, and decides where new features, modules, remotes, configs and assets belong. Use this whenever the user asks how to structure or organise a Roblox game, set up Rojo / Wally / Rokit, start a new Roblox project or repo, clean up messy scripts, choose an architecture (Knit or alternatives, services and controllers, ECS, components), design RemoteEvents or a data layer, or asks "where should this script go", even if they never say "architecture".
---

# Roblox project structure

Most Roblox games die of their codebase before they die of their design: hundreds of loose Scripts inside parts, RemoteEvents created ad hoc, `_G` everywhere, data saving copy-pasted into three places, and nobody able to say where a feature lives. Studios that ship and keep updating games converge on the same answers. This skill encodes them and gives you a generator for a clean starting point.

The guiding idea: **every piece of code has exactly one obvious home, every side (server, client, shared) has exactly one entry point, and every boundary (network, data, UI) goes through one module.** A new teammate should find any feature in under a minute by following the folder names.

## Decide the mode first

| The user wants... | Do this |
|---|---|
| A new project / repo | Ask only what changes the output (name, UI library if any, solo or team), then run the scaffold (below) and explain the tour. |
| To fix an existing game | Get the tree (Explorer screenshot, a `rojo sourcemap`, or the repo), run the audit in `references/audit-checklist.md`, deliver findings + a staged migration plan. Never propose a big-bang rewrite. |
| To know where X goes / add a feature | Answer from the placement table below, then write the code in that shape (a Service, a Controller, a Component, a config entry, a remote declaration). |
| An architecture decision (Knit? ECS? which UI lib? which networking lib?) | Give one recommendation with the reason, using `references/architecture.md`. Mention the runner-up only if the trade-off really depends on their situation. |

If the user works purely in Studio (no external editor), everything here still applies to the DataModel layout; `references/tooling.md` has a Studio-only section. Recommend Rojo when there is more than one programmer or any wish for Git, code review or CI.

## The layout

```
my-game/
├─ default.project.json      Rojo: maps folders below into the DataModel
├─ rokit.toml                pinned tool versions (rojo, wally, selene, stylua, lune...)
├─ wally.toml                third-party packages
├─ selene.toml  stylua.toml  .luaurc
├─ .github/workflows/ci.yml  format check, lint, build on every push
└─ src/
   ├─ shared/                → ReplicatedStorage.Shared   (both sides may require)
   │  ├─ Config/             tunables and content tables: no logic, no Instances
   │  ├─ Net/                the one networking module + every remote declared in one list
   │  ├─ Util/               Loader, Component binder, small pure helpers
   │  └─ Types.luau          shared type definitions
   ├─ server/                → ServerScriptService.Server (never replicated)
   │  ├─ Main.server.luau    the ONLY server Script: loads Services, then Components
   │  ├─ Services/           one ModuleScript per system: DataService, CurrencyService...
   │  ├─ Components/         behaviour bound to tagged Instances (CollectionService)
   └─ client/                → StarterPlayer.StarterPlayerScripts.Client
      ├─ Main.client.luau    the ONLY client LocalScript: loads Controllers, then Components
      ├─ Controllers/        one ModuleScript per client system: HudController, InputController...
      ├─ Components/         client-side tag behaviour (visual spinners, proximity prompts)
      └─ UI/                 UI components / screens (React, Fusion, Vide or plain Instances)
Packages/                    → ReplicatedStorage.Packages   (Wally shared realm, git-ignored)
ServerPackages/              → ServerStorage.ServerPackages (Wally server realm, git-ignored)
```

Instances that are content rather than code (maps, models, VFX templates, sounds, UI art) stay in the place file, under `ReplicatedStorage.Assets` (needed by clients) or `ServerStorage.Assets` (server only, cloned on demand). Rojo manages only the code folders; the place file is the source of truth for builds. This "partially managed" setup is what most studios run, because artists and builders keep working in Studio while code goes through Git.

## Where does it go?

| Thing | Home | Why |
|---|---|---|
| Rules, authority, anything a cheater would want to change (currency, damage, inventory, cooldowns) | `server/Services/<System>Service` | The server is the only trusted side. |
| Input, camera, HUD, sounds, local effects, prediction | `client/Controllers/<System>Controller` | Owned by the player's machine. |
| Behaviour attached to many world objects (doors, coins, kill parts, spawn pads) | `server/Components` or `client/Components`, bound by a CollectionService tag | No Scripts inside parts; tag the part in Studio instead. |
| Numbers designers tweak (prices, speeds, drop rates, level XP) and content lists (items, pets, quests) | `shared/Config/<Thing>.luau` returning a frozen table | Designers edit one file, both sides read it, no logic mixed in. |
| A RemoteEvent / RemoteFunction / UnreliableRemoteEvent | A line in `shared/Net/init.luau`'s `REMOTES` list | One list = the full attack surface, reviewable at a glance. |
| Player save data shape | `shared/Config/DataTemplate.luau`; access only through `DataService` | One owner of persistence. |
| Pure helpers used by both sides (math, formatting, tables) | `shared/Util` | Must not touch services or Instances that only exist on one side. |
| Third-party libraries | `wally.toml` → `Packages` | Versioned and reproducible; never paste library code into `Util`. |
| One-off admin/debug commands, migration scripts | `server/Services/DebugService` gated by `RunService:IsStudio()` or an allow-list | Keep it out of production paths. |

## Rules that keep it clean

1. **One Script per side.** `Main.server.luau` and `Main.client.luau` are the only runnable scripts. Everything else is a ModuleScript loaded by them. Order is explicit, errors surface in one place, and there are no races between dozens of scripts starting in arbitrary order.
2. **Two-phase lifecycle.** The Loader requires every module in `Services/` (or `Controllers/`), then calls `:Init()` on each in order (synchronous: set up state, no yielding, no calling other modules), then `:Start()` on each in its own thread (connect events, talk to other modules, yield freely). Modules that need each other just `require` each other; Init/Start ordering means nobody uses a dependency before it is ready.
3. **Dependencies point one way.** `client` and `server` may require `shared`; `shared` never requires `client` or `server`; `server` and `client` never require each other. Within a side, Services depend on Services by `require`; avoid cycles (if two modules need each other, a third module or a Signal is missing).
4. **The server decides, the client asks.** Remotes from the client are requests ("I want to buy item 12"), never facts ("I now have 500 coins"). Every handler checks types, rate, ownership, distance and cooldown before acting. See the Net module in the scaffold for the pattern.
5. **Everything you connect, you clean up.** Per-player and per-instance work goes in a Trove (or Janitor/Maid) that is destroyed when the player leaves or the instance is untagged. Leaks are the most common cause of late-session lag in Roblox games.
6. **No globals.** No `_G`, no `shared`, no values stuffed into ReplicatedStorage as `StringValue`s for code to read. Module returns are the API. Use Attributes for state that genuinely belongs to an Instance (a door's `Open`, a player's `Coins` for display).
7. **Strict typing on.** `.luaurc` sets `"languageMode": "strict"`. Typed modules catch most nil-index and wrong-argument bugs in the editor instead of in a live server.
8. **Config is data.** Never hard-code a price, cooldown or drop rate in a Service. Put it in `Config`, `table.freeze` it, and let both sides read it (the client to display, the server to enforce).
9. **Names say what things are.** Modules and their public methods are `PascalCase` (matching Roblox's own API) and modules are named by role suffix (`ShopService`, `ShopController`, `ShopConfig`). Locals and private functions `camelCase`, constants `UPPER_SNAKE`. Folders are plural (`Services`), modules singular. A file named `Utils2` or `NewScript` is a bug.
10. **Formatter and linter are not optional.** StyLua and Selene run in CI; a red build blocks merge. Arguments about style stop on day one.

## Scaffolding a new project

```bash
node <skill>/scripts/scaffold.cjs --name "My Game" --out ./my-game
```

Options: `--scope <wally-scope>` (default `studio`), `--no-ci` (skip the GitHub workflow), `--force` (write into a non-empty folder). Needs only Node. The HUD is built from plain Instances so the slice has no UI-library opinion; `references/architecture.md` covers choosing React, Fusion or Vide.

The scaffold is a small but complete vertical slice, not empty folders: a Loader with the Init/Start lifecycle, a declared Net layer with rate limiting, `DataService` wrapping ProfileStore (session-locked saves), `CurrencyService` (coins via Player attributes), a `CoinPickup` tag component, a `DailyRewardService` reached through a validated remote, a `HudController` that shows coins and toasts, and a config folder. Running `rojo serve` and pressing Play gives a working game loop the team can extend by copying the shape.

After running it, tell the user the setup commands (they are in the generated `README.md`):

```bash
rokit install                    # installs the pinned rojo, wally, selene, stylua
sh scripts/install-packages.sh   # wally install + sourcemap + wally-package-types
rojo serve                       # then connect from the Rojo plugin in Studio
```

…and two Studio steps: publish the place, and turn on Game Settings → Security → "Enable Studio Access to API Services" if they want data to save during Studio play tests (without it ProfileStore falls back to a mock store and says so in Output). Tag a part `CoinPickup` (and `Spinner`) with the Tag Editor to see the component work.

Tool versions pinned in `rokit.toml` and `wally.toml` are known-good baselines, not necessarily the newest. If you can browse, check the latest releases and bump them; otherwise tell the user to do so.

Then walk the user through the slice in three or four sentences: how a feature is added (new `XService` + `XController` + `XConfig` + remotes in the Net list), and where the example code shows each pattern. Show the tree, not every file.

## Auditing an existing game

Read `references/audit-checklist.md`. Collect evidence first (the Explorer tree, a sample of the worst scripts, how remotes and data saving are done), then report:

1. **Score** each area (structure, networking/security, data, lifecycle/cleanup, performance, tooling) as healthy / risky / broken, with the evidence.
2. **Top fixes** ordered by risk to players, not by tidiness: data loss and exploitable remotes first, then leaks and crashes, then structure.
3. **A staged migration** that keeps the game shippable at every step (the checklist has the standard sequence: tooling → entry points → remotes → data → components → UI). Each stage is one PR-sized change with a way to verify it.

Quote the actual script names and paths you found. Generic advice ("use services") without pointing at their code is not useful.

## Adding a feature in the existing shape

When asked to build a feature in a project that already follows this layout (or after scaffolding), produce the full slice, not a single script:

- `shared/Config/<Feature>Config.luau` for its numbers and content
- remote declarations added to the Net list (with which direction each one goes)
- `server/Services/<Feature>Service.luau` that owns state and validates every request
- `client/Controllers/<Feature>Controller.luau` (and a UI component if it has a screen)
- tags to add in Studio, if it uses components
- where its player data lives in `DataTemplate` (and a migration note if existing saves lack the field)

State the files you are adding and what each owns before writing them.

## References

- `references/architecture.md` — lifecycle and loaders, Services vs Knit vs ECS, components, networking (built-in remotes vs Blink / Zap / ByteNet), data (ProfileStore, DataStore budgets, migrations), state and UI libraries (React, Fusion, Vide, Charm/Reflex), signals, promises, error handling, performance. Read the section relevant to the question.
- `references/tooling.md` — Rokit, Rojo project files, Wally realms, Selene, StyLua, luau-lsp, Lune scripts, CI, environments (dev / staging / prod places), deployment through Open Cloud, and a Studio-only workflow.
- `references/audit-checklist.md` — smells with severity, how to detect each, the fix, and the staged migration plan.
- `scripts/scaffold.cjs` — generator for the starter project described above.
- `assets/template/` — the files the scaffold copies (`_`-prefixed names become dotfiles). Read these when writing new code for a project in this layout, so new Services, Controllers, Components and remotes match the existing patterns.
