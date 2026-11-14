# Roblox Developer Skills

Claude skills for Roblox development: turn a plain-language description into Studio assets with a 3D browser preview, set up a clean codebase, research what's working on Roblox right now, give them a mood that fits the genre, build UI that works on phones, desktops and consoles, replace the default backpack with the inventory your genre needs, lay out rooms, buildings and maps at natural distances, design games players stick with, keep them running smoothly on every device, and protect them from exploiters.

| Skill | Makes |
|---|---|
| [roblox-animation](skills/roblox-animation/) | R6 / R15 character animations, exported as a `KeyframeSequence` |
| [roblox-vfx](skills/roblox-vfx/) | Particle, beam and light effects, exported as a `ModuleScript` plus textures |
| [roblox-atmosphere](skills/roblox-atmosphere/) | Genre atmospheres (horror, cozy, sci-fi, cyberpunk and 20 more): lighting, fog, grading, weather and ambience presets, a Luau kit with zones and day/night, and a browser preview lab |
| [roblox-ragdoll](skills/roblox-ragdoll/) | Ragdoll physics and procedural hit reactions: knockdowns from any animation (cars, falls, finishers, death) with a blended get-up, flinches by body part, limping and limb injuries, and a server-authoritative Luau kit that plugs into the combat and vehicles kits |
| [roblox-combat](skills/roblox-combat/) | Combat feel and fairness: hitstop, knockback, flash, shake, slow-mo, guns (recoil, muzzle flash, tracers, impacts), enemy AI, a server-authoritative Luau kit and a browser feel lab |
| [roblox-ui](skills/roblox-ui/) | Responsive React (react-lua) UI: a theme config (palettes, corner roundness, per-component styles, live switching, contrast check), a modular component kit (layers, stacks, auto-column grids, buttons, modals, tabs, toasts), a HUD and shop that adapt to phone, tablet, desktop and console, gamepad navigation, device-matrix stories, a component generator and a UI code scanner |
| [roblox-inventory](skills/roblox-inventory/) | Custom inventories that replace the built-in backpack: attache-case grid with shaped items, eight-slot survival horror with an item box, weapon wheel, hotbar and backpack, weight-limited list, extraction loadout; a server-authoritative Luau kit (Tools still equip, saved with ProfileStore, pickups, chests, stash, drag and drop on mouse, touch and gamepad), an installer and an item-sheet builder |
| [roblox-layout](skills/roblox-layout/) | Room, building and map layouts with natural spacing: generators for restaurants, shops, houses, obbies, tycoons, cities and procedural survival maps; a spacing checker (dead gaps, blocked furniture, unreachable spots, empty floor, impossible jumps); a 3D and floor-plan browser preview; export to `.rbxmx`, a command-bar script or a ModuleScript; and a Luau kit that generates the same seeded maps at runtime |
| [roblox-project-structure](skills/roblox-project-structure/) | A studio-style codebase: Rojo / Wally / Rokit project scaffold, architecture guidance and audits of existing games |
| [roblox-game-design](skills/roblox-game-design/) | Game design docs, hooks and onboarding, core loops, progression, level design and playtest plans |
| [roblox-game-research](skills/roblox-game-research/) | Live Roblox chart and game data, teardowns of viral and top-earning games, and an original game brief with a monetization plan |
| [roblox-vehicles](skills/roblox-vehicles/) | Reusable car chassis driven by real-life specs (torque curve, gears, brakes, grip, suspension) that never gets stuck, with drifting, tire smoke and skid marks, a performance report tool and a Luau kit |
| [roblox-performance](skills/roblox-performance/) | Lag, FPS, memory and load-time fixes: profiling guides, device budgets, a scanner for Luau source and `.rbxlx` places, a Studio command-bar audit, and a Luau kit (frame-budget scheduler, pools, distance LOD, adaptive quality, perf HUD, server heartbeat and leak monitor) |
| [roblox-security](skills/roblox-security/) | Anti-exploit and anti-cheat: secure remotes, a server-side anti-cheat kit, and a scanner for backdoors and exploitable code |

## Install

With the [skills CLI](https://github.com/vercel-labs/skills) (Claude Code, Cursor, Codex and other agents):

```bash
npx skills add ridhotamma/roblox-developer-skills
```

To install just one skill:

```bash
npx skills add ridhotamma/roblox-developer-skills --skill roblox-animation
```

For the Claude apps, upload the packaged `.skill` file from [`dist/`](dist/) in Claude's skills settings.

Then ask for what you want, for example "make an R15 uppercut animation", "set up a new Roblox project with Rojo" or "design the first five minutes of my tycoon".

## Layout

- `skills/` — skill sources (`SKILL.md`, scripts, references, example specs)
- `examples/` — built example outputs; open each folder's `preview.html`
- `dist/` — packaged `.skill` files

## License

[MIT](LICENSE)
