# Roblox Developer Skills

Claude skills for Roblox development: turn a plain-language description into Studio assets with a 3D browser preview, set up a clean codebase, research what's working on Roblox right now, give them a mood that fits the genre, design games players stick with, keep them running smoothly on every device, and protect them from exploiters.

| Skill | Makes |
|---|---|
| [roblox-animation](skills/roblox-animation/) | R6 / R15 character animations, exported as a `KeyframeSequence` |
| [roblox-vfx](skills/roblox-vfx/) | Particle, beam and light effects, exported as a `ModuleScript` plus textures |
| [roblox-atmosphere](skills/roblox-atmosphere/) | Genre atmospheres (horror, cozy, sci-fi, cyberpunk and 20 more): lighting, fog, grading, weather and ambience presets, a Luau kit with zones and day/night, and a browser preview lab |
| [roblox-combat](skills/roblox-combat/) | Combat feel and fairness: hitstop, knockback, flash, shake, slow-mo, guns (recoil, muzzle flash, tracers, impacts), enemy AI, a server-authoritative Luau kit and a browser feel lab |
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
