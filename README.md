# Roblox Developer Skills

Claude skills for Roblox development: turn a plain-language description into Studio assets with a 3D browser preview, set up a clean codebase, research what's working on Roblox right now, design games players stick with, and protect them from exploiters.

| Skill | Makes |
|---|---|
| [roblox-animation](skills/roblox-animation/) | R6 / R15 character animations, exported as a `KeyframeSequence` |
| [roblox-vfx](skills/roblox-vfx/) | Particle, beam and light effects, exported as a `ModuleScript` plus textures |
| [roblox-combat](skills/roblox-combat/) | Combat feel and fairness: hitstop, knockback, flash, shake, slow-mo, guns (recoil, muzzle flash, tracers, impacts), enemy AI, a server-authoritative Luau kit and a browser feel lab |
| [roblox-project-structure](skills/roblox-project-structure/) | A studio-style codebase: Rojo / Wally / Rokit project scaffold, architecture guidance and audits of existing games |
| [roblox-game-design](skills/roblox-game-design/) | Game design docs, hooks and onboarding, core loops, progression, level design and playtest plans |
| [roblox-game-research](skills/roblox-game-research/) | Live Roblox chart and game data, teardowns of viral and top-earning games, and an original game brief with a monetization plan |
| [roblox-vehicles](skills/roblox-vehicles/) | Reusable raycast-suspension car chassis driven by real-life specs (torque curve, gears, brakes, grip, suspension), a performance report tool and a Luau kit |
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
