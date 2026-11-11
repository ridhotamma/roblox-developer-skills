# Roblox Developer Skills

Claude skills that turn a plain-language description into Roblox Studio assets, with a 3D browser preview.

| Skill | Makes |
|---|---|
| [roblox-animation](skills/roblox-animation/) | R6 / R15 character animations, exported as a `KeyframeSequence` |
| [roblox-vfx](skills/roblox-vfx/) | Particle, beam and light effects, exported as a `ModuleScript` plus textures |

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

Then ask for what you want, for example "make an R15 uppercut animation".

## Layout

- `skills/` — skill sources (`SKILL.md`, scripts, references, example specs)
- `examples/` — built example outputs; open each folder's `preview.html`
- `dist/` — packaged `.skill` files

## License

[MIT](LICENSE)
