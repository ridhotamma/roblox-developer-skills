# Roblox Developer Skills

Claude skills that turn a plain-language description into Roblox Studio assets, with a 3D browser preview.

| Skill | Makes |
|---|---|
| [roblox-animation](roblox-animation-skill/) | R6 / R15 character animations, exported as a `KeyframeSequence` |
| [roblox-vfx](roblox-vfx-skill/) | Particle, beam and light effects, exported as a `ModuleScript` plus textures |

Each folder holds the packaged `.skill` file, its source in `skill-source/`, and built examples in `examples-output/` (open `preview.html`).

## Install

Upload the `.skill` file in Claude's skills settings, or for Claude Code:

```bash
cp -r roblox-animation-skill/skill-source ~/.claude/skills/roblox-animation
```

```bash
cp -r roblox-vfx-skill/skill-source ~/.claude/skills/roblox-vfx
```

Then ask for what you want, for example "make an R15 uppercut animation".

## License

[MIT](LICENSE)
