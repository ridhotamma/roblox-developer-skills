# Tooling reference

The standard professional Roblox toolchain, how the pieces fit, and a Studio-only fallback. Versions change: the scaffold's `rokit.toml` pins known-good versions; check the projects' release pages before recommending a specific newer one.

## The stack

| Tool | Job | Config |
|---|---|---|
| **Rokit** (rojo-rbx/rokit) | Toolchain manager: installs exact versions of the tools below per project. Successor to Aftman and Foreman (both still work; Rokit reads `aftman.toml` and `foreman.toml` too). | `rokit.toml` |
| **Rojo** | Syncs files on disk into Studio (`rojo serve` + Studio plugin) and builds place/model files (`rojo build`). | `*.project.json` |
| **Wally** | Package manager. `wally install` writes `Packages/` (shared realm) and `ServerPackages/` (server realm). | `wally.toml` |
| **wally-package-types** | Re-exports package types through Wally's link files so strict Luau sees them. Run after every `wally install`. | none |
| **luau-lsp** | Language server (VS Code extension, also other editors): types, autocomplete, go-to-definition, Roblox API types. Uses a Rojo sourcemap to type Instance paths. | `.vscode/settings.json`, `.luaurc` |
| **StyLua** | Formatter. | `stylua.toml` |
| **Selene** | Linter (unused variables, shadowing, deprecated APIs, Roblox std). | `selene.toml` |
| **Lune** | Standalone Luau runtime for scripts outside Roblox: build steps, asset pipelines, reading/writing place files, codegen. Replaces ad-hoc Python/Node scripts. | scripts in `lune/` or `scripts/` |
| **Darklua** | Code transforms at build time (e.g. convert string requires, strip debug code). Only if needed. | `.darklua.json` |
| **Blink / Zap** | Networking codegen from an IDL file (see architecture.md §3). Optional. | `*.blink` / `*.zap` |
| **Jest Lua** (jsdotlua/jest-lua) | Unit tests that run in Roblox (via `run-in-roblox` or Open Cloud Luau execution). TestEZ is the older option. | `jest.config.luau` |

## Rojo project file

```json
{
  "name": "my-game",
  "tree": {
    "$className": "DataModel",
    "ReplicatedStorage": {
      "Shared": { "$path": "src/shared" },
      "Packages": { "$path": "Packages" }
    },
    "ServerStorage": { "ServerPackages": { "$path": "ServerPackages" } },
    "ServerScriptService": { "Server": { "$path": "src/server" } },
    "StarterPlayer": { "StarterPlayerScripts": { "Client": { "$path": "src/client" } } }
  }
}
```

- File naming: `X.server.luau` → Script, `X.client.luau` → LocalScript, `X.luau` → ModuleScript, `init.luau` inside a folder makes the folder itself that ModuleScript (with the other files as children). `*.model.json`, `*.rbxm(x)` → Instances; `*.json` → ModuleScript returning the data; `*.meta.json` sets properties/attributes on the sibling.
- Services listed without `$path` keep whatever is in the place (`$ignoreUnknownInstances` defaults to true there). That is the "partially managed" mode: code from disk, assets from the place. Fully managed projects (everything, including the map, in files) are possible but painful for builders; few studios do it.
- Map only folders you own. Never map a whole service like `Workspace` with `$path`, or Rojo will delete what builders made.
- `rojo sourcemap default.project.json --output sourcemap.json` (or `--watch`) feeds luau-lsp and wally-package-types. luau-lsp can generate it automatically when configured with the project file.

## Wally

```toml
[package]
name = "studio/my-game"        # scope/name, lowercase
version = "0.1.0"
registry = "https://github.com/UpliftGames/wally-index"
realm = "shared"
private = true

[dependencies]                  # -> Packages/ (ReplicatedStorage)
Trove = "sleitnick/trove@1.8.0"

[server-dependencies]           # -> ServerPackages/ (ServerStorage: never sent to clients)
ProfileStore = "lm-loleris/profilestore@1.0.3"
```

- Commit `wally.toml` and `wally.lock`; git-ignore `Packages/` and `ServerPackages/`.
- Server-only libraries (data, anti-cheat, admin) go in `[server-dependencies]` so clients never receive the code.
- Library code is never edited in `Packages/`. To patch, fork the package or vendor it into `src/` with a note.
- `pesde` is a newer alternative package manager with its own registry; Wally remains the most common.

## Editor setup (VS Code)

Extensions: luau-lsp, StyLua, Selene, Rojo. Settings: `luau-lsp.sourcemap.rojoProjectFile`, format on save with StyLua. Install the luau-lsp companion Studio plugin if the team wants types for Instances that exist only in the place file (not in the Rojo tree).

## CI

Minimum pipeline on every push and PR:

1. Install Rokit, then `rokit install --no-trust-check`
2. `stylua --check src`
3. `selene src`
4. `sh scripts/install-packages.sh` (Wally + types)
5. `rojo build default.project.json --output build/game.rbxl`
6. Optional: `luau-lsp analyze` with the sourcemap and Roblox type definitions for a type-check gate; Jest Lua tests.

Use the `GITHUB_TOKEN` env var for Rokit to avoid GitHub API rate limits. The scaffold's `.github/workflows/ci.yml` does steps 1 to 5.

## Environments and deployment

Real studios run at least two experiences:

| Environment | Experience | Purpose |
|---|---|---|
| dev / staging | a separate private experience (own universe id) | QA, playtests, data migrations on test data; separate DataStores by construction |
| production | the public experience | players |

- Keep place ids in one config (`deploy/places.json` or the deploy tool's config), never hard-coded in game code. Code that needs to know where it runs compares `game.GameId` against a shared `Config/Environments.luau`.
- **Deploy by building** (`rojo build`) and publishing the built file. Manual "publish from Studio" is fine solo, but for teams use Open Cloud's Place Publishing API with an API key held in CI secrets, through a CLI such as `rbxcloud` (Sleitnick) or a Lune script, or **Mantle** (infrastructure-as-code for experiences: places, products, badges, passes, per environment).
- Merge to `main` → deploy to staging automatically. Tag/release → deploy to production. Production publishes should be a deliberate step, with a soft-shutdown or migrate-to-latest-update plan for live servers.
- Developer products, game passes and badges: keep their ids in `shared/Config/Products.luau` per environment, never scattered.

## Studio-only teams

Without Rojo, the same structure applies inside Studio:

- `ServerScriptService.Server` (Folder) with one Script `Main` and Folders `Services`, `Components`.
- `StarterPlayer.StarterPlayerScripts.Client` with one LocalScript `Main` and Folders `Controllers`, `Components`, `UI`.
- `ReplicatedStorage.Shared` with `Config`, `Net`, `Util`; `ReplicatedStorage.Packages` holding libraries inserted from their GitHub releases (each has an `.rbxm`) or via the Wally Studio workflow.
- Enable **Collaborative Editing** with drafts (Script Drafts) so teammates commit script changes deliberately.
- Use Packages (Roblox's asset Packages feature) for models reused across places, with auto-update on.
- Version control is the weak point: Studio's version history is per-place and coarse. When a team grows past one or two scripters, move code to Rojo; the folder layout transfers one-to-one, so the migration is just syncing the existing folders out to disk (Rojo's `rojo syncback` in recent versions, or the "Export" route: right-click → Save to File, or a Lune script that reads the place and writes files).
