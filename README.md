# Roblox Developer Skills

Two Claude skills for Roblox developers. Each one turns a plain-language description into something you can preview in a browser and drop into Roblox Studio.

| Skill | What it makes | Output |
|---|---|---|
| [roblox-animation](roblox-animation-skill/) | Character animations for R6 and R15 rigs: combat moves, sports actions, locomotion loops, emotes, acrobatics | `KeyframeSequence` as `.rbxmx` and a Studio command-bar script |
| [roblox-vfx](roblox-vfx-skill/) | Visual effects built from ParticleEmitters, Beams and PointLights: impacts, explosions, auras, fire, lightning | `ModuleScript` with a `play()` function as `.rbxmx` and a command-bar script, plus particle texture PNGs |

Both skills also produce an interactive 3D `preview.html` and a storyboard image, so the result can be checked before it goes into Studio.

## How they work

You describe the motion or effect. Claude writes a small JSON spec (key poses for an animation, layers for an effect), and the bundled engine builds the preview, a report with warnings, and the Studio files. The engines are single Node scripts with no dependencies.

## Repository layout

Each skill folder has the same three parts:

```
roblox-animation-skill/
  roblox-animation.skill   packaged skill, ready to install
  skill-source/            SKILL.md, engine script, example specs, cookbook
  examples-output/         built examples: preview, storyboards, .rbxmx, .lua
roblox-vfx-skill/
  roblox-vfx.skill
  skill-source/
  examples-output/
```

Open `examples-output/preview.html` in either folder to see the bundled examples:

- **Animation:** jab-cross, R6 sword slash, R6 run, soccer instep kick, basketball jump shot, backflip
- **VFX:** hit spark, explosion, ground slam, heal aura, campfire, lightning strike

## Installing

**Claude apps:** upload the `.skill` file from the skill's folder in the skills settings.

**Claude Code:** copy the skill source into your skills directory.

```bash
cp -r roblox-animation-skill/skill-source ~/.claude/skills/roblox-animation
```

```bash
cp -r roblox-vfx-skill/skill-source ~/.claude/skills/roblox-vfx
```

Then ask for what you want, for example "make an R15 uppercut animation" or "make a ground slam effect with a 10-stud shockwave".

## Running the engines directly

Node is the only requirement.

```bash
node roblox-animation-skill/skill-source/scripts/ranim.cjs roblox-animation-skill/skill-source/examples/jab_cross.json --out out
```

```bash
node roblox-vfx-skill/skill-source/scripts/rvfx.cjs roblox-vfx-skill/skill-source/examples/explosion.json --out out
```

Each run writes `preview.html`, a storyboard and the Studio files into `out/`, and prints a report to the terminal. The spec format is documented in each skill's `SKILL.md`.

Each engine has a self-test to run after editing it:

```bash
node roblox-animation-skill/skill-source/scripts/selftest.cjs
```

```bash
node roblox-vfx-skill/skill-source/scripts/selftest.cjs
```
