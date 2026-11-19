# Scene format

A scene (or finisher) is a ModuleScript returning one table: `ReplicatedStorage.Shared.Cutscene.Scenes.<Name>` (finishers in `.Finishers.<Name>`). The module name must equal `Name`. All times are **scene seconds** from 0; slow motion and freezes stretch them in wall time. Positions are **studs relative to the scene origin** (the CFrame passed to `Play`; -Z is the origin's forward). Angles are degrees, Roblox convention (positive = counter-clockwise seen from above).

Check a scene with `node scripts/previs.cjs <Name or path> --check`; see it with `node scripts/previs.cjs <Name or path>`.

## Top level

| Field | Type | Default | Meaning |
|---|---|---|---|
| `Name` | string | required | must match the module name |
| `Kind` | `"Scene"` \| `"Finisher"` | `"Scene"` | finishers skip the establishing-shot check |
| `Length` | number | from the items | scene seconds; the scene ends here unless an `End` event comes first |
| `Letterbox` | number \| false | none | bar aspect (2.39, 2, 1.85); bars slide in/out over `LetterboxTime` |
| `LetterboxTime` | number | 0.45 | |
| `FadeIn` / `FadeOut` | number | 0 | seconds from/to black at the start/end |
| `BlendIn` / `BlendOut` | number | 0.6 / 0.8 | camera blend from/to gameplay (0 = cut) |
| `Skippable` | boolean | true | hold-to-skip for watchers |
| `Style` / `StyleAmount` | string / number | `"Locked"` / 1 | default operator style for shots |
| `Aperture` | number | none | default f-stop for depth of field |
| `ShakeDecay` | number | 1.6 | trauma lost per second |
| `Seed` | number | from the name | noise seed |
| `Line` | `{ actorA, actorB }` | none | the 180° line for the coverage check |
| `Marks` | `{ [name]: Mark }` | | named places |
| `Actors` | `{ [name]: Actor }` | | who performs |
| `Labels` | `{ [name]: number }` | | branch targets for QTEs and `Goto` |
| `Shots`, `Animations`, `Moves`, `Sounds`, `Subtitles`, `Events`, `Qtes`, `Shakes`, `Fades`, `SlowMo`, `Freezes` | lists | | tracks below; every item has `At` |
| `Finisher` | table | | makes it a finisher (finishers.md §9) |

## Marks and actors

```lua
Marks = {
	HeroStart = { Position = Vector3.new(0, 0, 10), Face = "BossStart" },  -- face another mark (or a Vector3)
	BossStart = { Position = Vector3.new(0, 0, -14), Yaw = 180 },          -- or an explicit yaw
	Fallen    = { Position = Vector3.new(0, 0, 4), Pitch = 88, Lift = 0.3 }, -- lying face-up
},
Actors = {
	Hero = { Mark = "HeroStart", Player = true },        -- Player: a trigger binds the triggering player here
	Boss = { Mark = "BossStart", Height = 11, Template = "Boss" }, -- Template: ReplicatedStorage.CutsceneActors.Boss
},
```

| Mark field | Meaning |
|---|---|
| `Position` | ground point (feet), scene space |
| `Yaw` | facing; 0 = scene -Z |
| `Face` | mark name or Vector3 to face (overrides `Yaw`); two marks may face each other |
| `Pitch`, `Roll` | tilt around the feet (falls, lying: ±85..95) |
| `Lift` | studs up before tilting (lying bodies ~0.3; upside down ≈ height) |

| Actor field | Meaning |
|---|---|
| `Mark` | start mark (name or inline mark) |
| `Height` | studs, feet to head (default 5.2; measured from the real model in game) |
| `Template` | model name in `ReplicatedStorage.CutsceneActors`, used when nobody is bound |
| `Player` | this actor is the triggering player (triggers and `PlayerActor`) |

## Shots

Common fields:

| Field | Meaning |
|---|---|
| `At` | start; a shot lasts until the next one (the last until `Length`, or `Duration` when `Length` is computed) |
| `Name` | shows in the previs |
| `Type` | `Frame` (default), `OverShoulder`, `TwoShot`, `POV`, `Path`, `Static` |
| `Lens` | mm (defaults: Frame 35, OverShoulder 50, TwoShot 35, POV 30, Path 28, Static 35) |
| `Roll` | Dutch angle, degrees |
| `ScreenX`, `ScreenY` | where the aim point sits in the visible frame (-1..1; ±1/3 = thirds) |
| `Offset` | Vector3 camera-space nudge after composing |
| `Move` + `Amount`, or `Moves = { { "ArcLeft", 20 }, { "PushIn" } }` | camera moves (cinematography.md §5) |
| `Ease`, `MoveTime` | move curve and duration (default the whole shot) |
| `Lock` | `"Pan"` camera stays where it started and turns to follow; `"Fixed"` fully static |
| `Style`, `StyleAmount` | operator style for this shot |
| `Blend`, `BlendEase` | seconds to blend from the previous shot instead of cutting |
| `Aperture`, `Focus`, `FocusTo`, `RackAt`, `RackTime` | depth of field and rack focus |
| `CrossLine`, `JumpCut`, `Flash`, `Whip`, `Establishing` | tell the coverage check it's deliberate |
| `Line` | a new 180° line from this shot on |

By type:

| Type | Fields |
|---|---|
| `Frame` | `Subject`, `Size` (EWS WS FS MLS MS MCU CU ECU) or `Distance`, `Yaw`, `Pitch` (number or Eye/High/Low/Overhead/Ground), `AimOffset` (subject space), `To = { Size, Yaw, Pitch, Lens, Distance, ScreenX, ScreenY, Roll, Subject }` to move between framings |
| `OverShoulder` | `Over` (foreground actor), `Subject`, `Side` (`"Left"`/`"Right"` shoulder), `Size` (subject aim, default MCU), `Back`, `Shoulder` (studs) |
| `TwoShot` | `Subjects = { a, b }`, `Side` (`"Left"`/`"Right"` of the line a→b), `Size` (default FS), `Yaw` (angle off square-on), `Pitch` |
| `POV` | `Actor` (whose eyes), `Subject` or `LookAt` (actor or Vector3) |
| `Path` | `Points` (Vector3 list, scene space, ≥ 2), `LookAt` (actor or Vector3; default along the path), `Size` (aim height on an actor) |
| `Static` | `Position` (Vector3), `LookAt` (actor or Vector3), `Size` |

## Tracks

| Track | Item fields |
|---|---|
| `Animations` | `Actor`, `Id` (`""` until you have one), `Looped`, `Speed`, `FadeTime`, `Weight`, `Layer` (a new clip on the same layer replaces the old), `Duration` (for seeking), `Hold` (default true: hold the last frame) |
| `Moves` | `Actor`, `To` (mark name or inline mark), `Duration` (0 = snap), `Ease`, `Face` (mark/Vector3 to face on arrival), `Path` (Vector3 waypoints) |
| `Sounds` | `Id`, `Actor` (3D from them; else 2D), `Volume`, `Pitch`, `Duration` (for seeking) |
| `Subtitles` | `Text`, `Duration`, `Speaker`, `Sound` (voice line id) |
| `Events` | `Name`, `Target` (actor), `Server` (documentation: server-side), `Essential` (runs on skip), plus fields per name (below) |
| `Qtes` | `Id`, `Qte` (spec, qte.md), `Player` (actor whose player responds), `Rule`, `SlowMo`, `OnSuccess`, `OnFail` (`{ Goto = label }`, `"End"`, `{ Final = true }`, nil = continue) |
| `Shakes` | `Trauma` 0..1 |
| `Fades` | `To` (0 clear .. 1 black), `Duration`, `From` |
| `SlowMo` | `Duration` (scene seconds), `Scale` (0 < s ≤ 1) |
| `Freezes` | `Hold` (wall seconds): the whole scene stops (hit freeze) |

Built-in event names:

| Name | Where | Does |
|---|---|---|
| `End` | both | ends the scene here (each branch ends with one) |
| `Goto` | server (clients hold) | jumps to `Label` (loop a retry, skip a section) |
| `Hit` | server | `Damage` to `Target` (bypasses the scene's ForceField); `Splash = { Radius, Damage, Knockback }` to other finishable models nearby |
| `Kill` | server | `Target` health to 0, `FinisherKilled` attribute |
| `Heal` | server | `Amount` to `Target` |
| `Ragdoll` | clients | `Target`'s stand-in goes limp (ragdoll kit), optional `Velocity` |
| `Hide` / `Show` | clients | hide or show `Target`'s stand-in |
| `Flash` | camera clients | white flash, `Duration` |
| anything else | both | your hooks: `CutsceneService.Event` / `OnEvent` (server), `CutsceneController.OnEvent(name, fn)` (client) |

## Finisher block

```lua
Finisher = {
	Prompt = "Suplex", Input = "Press" | "Hold", HoldTime = 0.3,
	Priority = 2, Weight = 1,
	Requires = { Posture = { "Kneel" }, Side = { "Back" }, MaxHealth = 0.25, Unaware = true,
	             Range = 6, MaxHeight = 3, Kinds = { "Grunt" }, NotKinds = { "Boss" } },
	Attacker = "Attacker", Victim = "Victim",   -- actor names
	Lethal = true, Clearance = 4,
	Grab = true,                                -- enemy-initiated (FinisherService:Grab), no prompt
}
```

## Playing from code (server)

```lua
local CutsceneService = require(ServerScriptService.Server.Services.CutsceneService)
local play = CutsceneService:Play("BossIntro", {
	Origin = workspace.Arena.Center.CFrame,
	Actors = { Hero = player.Character, Boss = workspace.Boss },
	Players = { player },          -- camera; default: players bound to actors, else everyone
	Observers = false,             -- true: everyone else sees the stand-ins too
	OnEvent = function(play, item) if item.Name == "StartBossFight" then startFight() end end,
})
CutsceneService.Ended:Connect(function(play, skipped) ... end)
```

Triggers without code: a part tagged `CutsceneTrigger` with attributes `Scene` (name), `Once` (`"Server"` or `"Player"`), `Shared` (bool), `PlayerActor` (actor name); an ObjectValue child named `Origin` (part or attachment) and `Actor_<Name>` ObjectValues for other actors.
