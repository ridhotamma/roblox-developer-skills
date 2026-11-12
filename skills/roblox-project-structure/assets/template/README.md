# {{NAME}}

## Setup

Install [Rokit](https://github.com/rojo-rbx/rokit) once per machine, then in this folder:

```bash
rokit install
sh scripts/install-packages.sh
rojo serve
```

In Studio, install the Rojo plugin, open your place and press **Connect**. Recommended VS Code extensions are listed in `.vscode/extensions.json` (luau-lsp, StyLua, Selene, Rojo).

To let player data save during Studio play tests, publish the place and turn on Game Settings → Security → **Enable Studio Access to API Services**. Without it ProfileStore uses a mock store.

Try the example slice: tag a part `CoinPickup` and `Spinner` with the Tag Editor, press Play, touch it, then press **Daily reward**.

## Where things go

| Path | In Studio | Holds |
|---|---|---|
| `src/shared/Config` | ReplicatedStorage.Shared.Config | Tunable numbers and content tables. Data only. |
| `src/shared/Net` | ReplicatedStorage.Shared.Net | Every remote, declared in one list. |
| `src/shared/Util` | ReplicatedStorage.Shared.Util | Loader, Component binder, pure helpers. |
| `src/server/Services` | ServerScriptService.Server.Services | One module per server system. Owns rules and state. |
| `src/server/Components` | ServerScriptService.Server.Components | Behaviour for tagged world objects (server). |
| `src/client/Controllers` | StarterPlayerScripts.Client.Controllers | One module per client system: input, camera, HUD. |
| `src/client/Components` | StarterPlayerScripts.Client.Components | Client-only behaviour for tagged objects (visuals). |
| `src/client/UI` | StarterPlayerScripts.Client.UI | Screens and UI components (view only). |
| `Packages`, `ServerPackages` | ReplicatedStorage / ServerStorage | Wally packages. Generated, not committed. |

Maps, models, sounds and other assets live in the place file under `ReplicatedStorage.Assets` or `ServerStorage.Assets`.

## Adding a feature

1. Numbers and content → `src/shared/Config/<Feature>Config.luau`
2. Remotes → add them to `REMOTES` in `src/shared/Net/init.luau`, with direction and arguments
3. Rules and state → `src/server/Services/<Feature>Service.luau` (validate every client request)
4. Input and UI → `src/client/Controllers/<Feature>Controller.luau` + `src/client/UI/...`
5. Saved fields → `src/shared/Config/DataTemplate.luau`

Every module may define `Init()` (set up own state, no yielding) and `Start()` (connect, use other modules).

## Checks

```bash
stylua src        # format
selene src        # lint
rojo build default.project.json --output build/game.rbxl
```

CI runs the same checks on every push (`.github/workflows/ci.yml`).
