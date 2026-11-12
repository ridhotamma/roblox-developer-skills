---
name: roblox-combat
description: Make Roblox combat feel great and play fair - hit feedback (hitstop, hit flash, knockback, camera shake, FOV punch, faked slow motion before the hit, invulnerability blink, layered impact sound, damage numbers), melee attack anatomy (startup, active, recovery, hitboxes, hit-stun, poise, combos, input buffering, block, parry, dodge), guns and ranged weapons (hitscan vs projectile, camera-to-muzzle aiming, spread and bloom, recoil with recovery, muzzle flash, smoke, tracers, bullet drop, impacts by material, bullet holes, hit markers, headshots, damage falloff, ammo and reload, ADS, explosives), and enemy design (archetypes, telegraphs, attack patterns, state-machine AI, attack tokens, waves, difficulty scaling, bosses). Ships a server-authoritative Luau kit with client-side prediction (HitFeedback, CameraFx, WeaponFx, Knockback, Ballistics, CombatService, WeaponService, EnemyService) and a browser feel lab for tuning hits by feel. Use this whenever the user is building combat, a fighting or battlegrounds game, an FPS or shooter, guns, bows, spells or projectiles, enemies, NPC AI, bosses, waves, or says combat feels floaty, weak, laggy or unfair, even if they only say "make hitting feel better".
---

# Roblox combat

Good combat is two things at once: **it feels powerful** (every hit lands with sound, freeze, flash, push and shake sized to its strength) and **it's fair** (attacks are readable, the server decides damage, enemies give you a chance). This skill covers both for melee, guns and enemies, with a kit that already wires them together.

## The principles

1. **Stack the feedback on one frame.** Sound, hitstop, flash, VFX and shake start on the contact frame; knockback launches when the hitstop ends. One layer alone feels weak; five cheap layers feel great.
2. **Size feedback by weight.** Light, Medium, Heavy, Finisher (and Gun) each have their own hitstop, shake, knockback and pitch. Contrast is what makes heavy hits feel heavy. Escalate through combos.
3. **Predict the feel, confirm the damage.** The attacker's client plays the cosmetic hit instantly at its own contact frame; the server validates and applies damage, then broadcasts so everyone (including the attacker, for damage numbers and hit markers) sees it. Lag never delays the feel, and exploiters never decide damage.
4. **Telegraph everything that hurts the player.** Wind-ups, red flashes, ground indicators, direction locked when the wind-up starts. Unreadable damage feels like a bug.
5. **Respect ownership.** Server owns NPCs and pushes them; a player's client owns its character, so the server asks that client to apply knockback.
6. **Restraint.** Shake only when the local player is involved, cap flashes and numbers, offer a screen-shake slider.

## Decide the mode

| The user wants... | Do this |
|---|---|
| "Combat feels weak/floaty" | Diagnose against the feedback stack (`references/hit-feedback.md` §1, the problems table in `references/combat-flow.md` §8). Add the missing layers in order: sound → hitstop → flash → knockback → shake. Give numbers from the weight table. |
| Melee combat system | Attack anatomy, hitboxes, combos and stun from `references/combat-flow.md`; install the kit (melee parts). |
| Guns / FPS / bows / spells | `references/ranged-weapons.md`; install the kit (weapon parts). Pick hitscan or projectile per weapon; start from the archetype stat table. |
| Enemies, AI, bosses, waves | `references/enemy-design.md`; the kit's `EnemyService` gives a working state machine with telegraphs, tokens, stagger and respawn. |
| Tune the feel by playing | Send/publish `assets/feel-lab.html`: a browser sandbox where the user hits a dummy with adjustable hitstop, flash, knockback, shake, FOV punch, slow-mo, i-frames and sound, then copies the tuned values as a Luau `HitWeights` table. |

## The kit

`assets/kit/` mirrors the `roblox-project-structure` layout (`shared` → `ReplicatedStorage.Shared`, `server` → `ServerScriptService.Server`, `client` → `StarterPlayerScripts.Client`); copy the folders over the project's `src`. Services and Controllers are started by the scaffold's Loader, components by its binder. It uses the scaffold's `Net` module and the Trove/Signal packages.

| File | Side | Does |
|---|---|---|
| `shared/Combat/CombatConfig.luau` | both | Hit weights, melee combo, i-frames, enemy archetypes, weapons, sounds, caps. All tuning lives here. |
| `shared/Combat/Hitbox.luau` | both | Box query in front of a root part, unique living character models. |
| `shared/Combat/Knockback.luau` | both | `LinearVelocity` push for a set time, with caps. |
| `shared/Combat/Ballistics.luau` | both | Spread cone, damage falloff, projectile stepping with gravity and raycasts. |
| `server/Services/CombatService.luau` | server | The one place damage happens: i-frames, damage, poise, delayed knockback, broadcast; melee `Swing` handler with server combo and hitbox. |
| `server/Services/WeaponService.luau` | server | `Fire`/`Reload` handlers: rate, ammo, origin and direction validation, hitscan or simulated projectiles, headshots, falloff, shot broadcast. |
| `server/Services/EnemyService.luau` | server | Enemy state machine (Idle, Chase, Hover, Telegraph, Attack, Recover, Stagger, Dead), attack tokens, server network ownership, respawn, `Defeated` signal. |
| `client/Combat/HitFeedback.luau` | client | Hitstop, flash, sound, shake, FOV punch, faked slow-mo, i-frame blink, damage numbers; dedupes predicted hits. |
| `client/Combat/CameraFx.luau` | client | Trauma camera shake, recoil spring, FOV punch, shake scale setting. |
| `client/Combat/WeaponFx.luau` | client | Muzzle flash and light, smoke, tracers, projectile visuals, impacts by material, bullet holes, hit marker. |
| `client/Controllers/CombatController.luau` | client | Melee input (mouse, gamepad, touch button), combo mirror, pre-hit slow-mo, predicted hits, knockback listener, hit events. |
| `client/Controllers/WeaponController.luau` | client | Equipped-weapon input, fire modes, spread and bloom, recoil, ADS, reload, ammo display and crosshair, others' shots. |
| `client/Components/EnemyVisuals.luau` | client | Red telegraph pulse and "!" from the enemy's `State` attribute. |

Install steps to give the user:
1. Copy the kit folders into `src` (merge with the scaffold).
2. Add the remotes to `REMOTES` in `src/shared/Net/init.luau` (the list is at the top of `CombatConfig.luau`, with directions): `Swing`, `Fire`, `Reload`, `CombatHit`, `Knockback`, `Ammo` as `"Event"`, and `ShotFired` as `"Unreliable"`.
3. Enemies: put an R15 or R6 rig (Humanoid + HumanoidRootPart) in Workspace, tag it `Enemy`, set attribute `Archetype` = `Grunt` or `Brute`. Or put templates in `ServerStorage.Assets.Enemies` and call `EnemyService:Spawn("Grunt", cframe)`.
4. Guns: a Tool with a `Handle`, an `Attachment` named `Muzzle` at the barrel tip, and attribute `Weapon` = a name from `CombatConfig.Weapons` (`Pistol`, `Rifle`, `Shotgun`, `Bow`).
5. Sounds: paste audio asset ids into `CombatConfig.Sounds` (empty ids are skipped, so everything works silently until then). Animations: optional ids in the config; until then the timings in the config drive everything.
6. If `roblox-security` is installed, the services call `AntiCheatService:Grant` around knockback automatically.
7. Play, hit, tune values in `CombatConfig` (or in the feel lab first).

When writing new combat code for a project, follow the same split: input and cosmetics in Controllers and `client/Combat`, validation and damage only through `CombatService:Hit`, tuning only in `CombatConfig`.

## Feel lab

`assets/feel-lab.html` is a single-file page (no dependencies). Publish it as an artifact or send the file. The user presses Space or clicks to attack a dummy through a Light → Light → Medium → Finisher combo, adjusts sliders per weight (hitstop, flash, knockback, knock-up, shake, FOV punch, slow-mo, i-frames, sound pitch), toggles each layer on and off to hear and see what it adds, and clicks **Copy Luau** to get a `HitWeights` table for `CombatConfig.luau`. It's 2D and approximate, but the timing feel transfers directly.

## Limits to be honest about

- Roblox has no global time scale: slow motion is local and cosmetic (animations, sound, color, FOV); physics and other players keep normal speed.
- The kit's Luau is a reviewed starting point, not battle-tested in a live game: test in Studio with two players (Test → Clients and Servers) and with emulated latency (Studio's network simulation settings) before shipping.
- Lag compensation, viewmodels, pathfinding, ranged enemies and bosses are documented in the references but not implemented in the kit.

## References

- `references/hit-feedback.md` — the feedback stack, weight table, hitstop, flash, knockback, shake, slow-mo, blink, sound, damage numbers, who sees what, accessibility.
- `references/combat-flow.md` — startup/active/recovery, hitboxes, stun, poise, combos, buffering, defense, prediction vs authority, wiring markers and VFX, common problems.
- `references/ranged-weapons.md` — hitscan vs projectile, aiming, spread, recoil, muzzle flash and smoke, tracers, impacts, hit markers, damage model, ammo, ADS, security, weapon stat table, explosives.
- `references/enemy-design.md` — archetypes, telegraphs, patterns, state machine, attack tokens, waves, scaling, bosses, readability checklist, performance.
