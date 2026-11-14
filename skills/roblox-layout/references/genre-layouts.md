# Layouts by genre

The pattern each genre's layout follows, the numbers that matter most, and what the generator does so it can be adapted by hand. For pacing, loops and onboarding see the `roblox-game-design` skill; this file is about where things go.

## Contents
1. Obby
2. Tycoon
3. Restaurant, cafe and shop
4. House and other interiors
5. City and town
6. Simulator hub and lobbies
7. Survival and open maps
8. Horror and tight spaces

---

## 1. Obby

`rlayout.cjs build obby --stages 6 --jumps 7 --easy 0.15 --hard 0.85 --seed n`

- **A course is a chain of stages; a stage turns one knob.** Plain hops, stairs, stepping stones (small round pads, zigzag), beams (narrow and long), drops, kill bricks to jump over. Mixing knobs inside a stage makes difficulty unreadable; combine them only in late stages.
- **Gaps come from the jump, not from taste.** Difficulty 0 is a comfortable gap, 1 is the hardest fair one (`references/spacing-metrics.md` section 13). The checker rates every jump from its gap, its rise and the landing size, and reports the average per stage.
- **The curve rises gently.** First stage under 0.35 so new players get a win; steps between stages under about 0.2; last stage 0.8 to 1. A spike is reported when a stage is 0.3 harder than the one before.
- **Checkpoints every 6 to 10 jumps**, on a platform of 14+ studs where a player can stop, turn the camera and see the next stage. Fewer jumps between checkpoints as stages get harder.
- **Turn at checkpoints.** A course that turns 35 to 70 degrees at each rest platform coils into a compact, good-looking shape and shows players both where they came from and where they are going. Keep later stretches 9+ studs clear of earlier ones unless they are well above or below.
- **Platform size is a knob too:** 8 to 9 easy, 5 to 6 normal, 3.5 to 4 hard, 2 for beams.
- **Colour by stage** (one hue per stage, alternating two shades per platform) so progress is visible from a distance.
- Not covered by the generator: moving platforms, conveyors, trusses, wall hops. Add them to the spec by hand; the checker only rates plain jumps between consecutive `route` platforms.

## 2. Tycoon

`rlayout.cjs build tycoon --plots 6`

- **Identical plots facing a shared street**, the hub (spawn, shop, leaderboards) in the middle of the street. Every player sees other players' progress on the way to their own plot, which is the genre's advertising.
- **Plot anatomy**, from the gate inward: gate and claim sign on the street side; cash collection a few steps inside; the production line (droppers above a conveyor, upgraders, collector) along one side wall; a row of purchase buttons beside the line; an open build area filling the rest.
- **Buttons line up with what they buy.** A button 10 studs from its dropper, in the same row order, needs no label to understand. Buttons for the building itself sit along the edge of the build area.
- **Keep the build area open** and mark it as a zone: the tycoon's whole progression is filling that rectangle. Decorating it at the start makes the plot look finished on minute one.
- **Money walk short, tour long.** Collector to gate 15 to 30 studs. The route past every purchasable thing can be longer: walking past the next upgrade is the upsell.
- Plots 20+ apart with a lamp or tree line between them; fences at 3.6 high mark ownership without hiding the neighbours.

## 3. Restaurant, cafe and shop

`rlayout.cjs build restaurant | cafe | shop [--width n --depth n]`

Front to back, the same three bands:

1. **Entry** (7 deep): nothing but a mat and a host stand off to one side. Players stop here to look.
2. **Floor**: tables or shelving in even rows either side of a centre aisle that runs from the door to the counter.
3. **Service** at the back: counter facing the door, 5 clear in front for the queue, 4.5 behind for staff, equipment against the back wall.

Restaurant specifics:
- Booths along the side walls (they pack with no gaps and use the wall), free tables in the middle, a mix of 4-seat and 2-seat sets.
- Stools along the counter turn the queue space into seating.
- A pendant light over every table set fixes the "nothing above waist height" problem and marks each group.
- Widths that work: 44 (booths one side, one column of tables each side), 68 (booths both sides, two columns each side). See the formula in spacing-metrics section 6.
- If players are the staff (most restaurant games), the staff route (kitchen to every table) is the main route: keep it 4.5+ everywhere.

Shop specifics:
- Shelves edge to edge on the side walls, gondolas in the middle with their long side pointing at the counter, so every aisle shows the counter at its end.
- A feature display on the centre line 10 studs inside the door, and display tables in the front corners.
- Aisles 5, centre aisle 7.

Cafe: smaller round tables, plus one lounge corner (sofa, armchair, rug, lamp) for contrast.

## 4. House and other interiors

`rlayout.cjs build house | living | bedroom | office | kitchen | bath`

- **Each room has an anchor wall**, usually the one facing the door: TV wall, headboard wall, kitchen run. Place the anchor group centred on that wall first; everything else arranges around it.
- **Living room**: TV on the anchor wall; sofa facing it 8 to 10 studs away with the coffee table between; armchairs at right angles; rug under all of it. A second group (dining set, desk) takes the far end if the room is over about 28 deep. Bookshelves against a side wall.
- **Bedroom**: bed centred on the anchor wall with nightstands touching, wardrobe on one side wall, desk on the other, rug at the foot.
- **Kitchen**: all units in one touching run; an island 4.5 in front of it if the room allows.
- **Office**: desks in face-to-face pairs in rows, 5 between; meeting table as its own zone on a rug; shelving on the back wall.
- **Floor plan**: public rooms at the front (living, kitchen), private behind (bedroom, bath); a wide arch between living and kitchen, 6 stud doors elsewhere; doors near corners so walls stay usable; windows on outside walls roughly every 16 studs. Don't make corridors unless the building is large: in Roblox a corridor is a camera problem.
- Smallest sizes that furnish cleanly are listed in spacing-metrics section 8. A house around 56 x 46 holds living, kitchen, bedroom and bath.

For another building type (school, hospital, police station, hotel), write one `walls` macro per room and furnish each with sets and rows: pick each room's anchor wall, centre its main group there, keep door zones clear.

## 5. City and town

`rlayout.cjs build city --blocks-x 4 --blocks-z 3`

- **Grid of blocks** 100 to 140 studs on a side, two-lane roads (28), 8 stud pavements. A walk across the default city is under half a minute.
- **Districts by distance from the centre**: towers downtown (4 to 11 storeys, never two neighbours the same height), shops with awnings around them (2 to 4 storeys), detached houses with lawns at the edge. The skyline peaks in the middle and the tallest building doubles as the landmark.
- **One plaza and one park** near the centre: the spawn goes in the plaza (stalls in two rows, benches, a centrepiece); the park has a fountain, cross paths, benches facing the fountain and scattered trees.
- **Lots**: each block has two rows of lots back to back. Downtown and shop buildings touch their neighbours (party walls) and leave a 12 stud alley behind; houses stand 10 apart with a 7 stud front lawn and shared back gardens.
- **Kerb rhythm**: lamps every 40 or so along the long sides, street trees every 30 along the short sides, the same on every block. This regularity is what makes a generated city read as a city.
- Road paint (lane dashes, zebra crossings at every corner) is cheap and does more for the look than any building detail.
- For a driving game, widen roads (48+ for four lanes) and round or cut the block corners; see the `roblox-vehicles` skill.

## 6. Simulator hub and lobbies

Start from `examples/simulator_hub.json`.

- **Spawn in the open, facing the main attraction** (the portal to the first world, the biggest egg), with a wide path leading straight to it.
- **A ring of destinations** around a central plaza 50 to 60 across: sell pad on one side, shop or egg stand on the other, portal ahead, a row of stalls behind it. Each is 3 to 5 seconds from spawn; none is hidden behind another.
- **Benches and planters at the diagonals**, lamps along the entry path, trees filling the outside so the map edge is hidden.
- The plaza is an open zone on purpose (30+ players stand there); say so in the spec with `"open": true` so the checker doesn't call it empty.

Round-based game lobby: the same ring, with the queue or teleporter as the focal point and things to do while waiting (leaderboards, shop, a small obby) around it.

## 7. Survival and open maps

`rlayout.cjs build wilderness --size 640 --seed n`, and `WorldGen` in the kit at runtime. See `references/procedural.md` for how it works.

- **Spawn camp at the centre** in a clearing, with wood, stone and food within 3 seconds in every game.
- **Points of interest 6 to 15 seconds apart** (100 to 240 studs): tower, ruins, cabin, quarry, shrine, dock. Each has its own clearing and a reason to visit.
- **Trails join them in loops**, not a tree: a player should rarely have to walk back the way they came.
- **Biomes by noise**: forest, thinning edge, meadow; rocky ground with ore; lakes with a beach and a dock on the side facing spawn.
- **Resources evenly spread** (Poisson with 55 to 65 stud spacing), placed before decoration.
- Map size by player count: 400 to 500 for up to 8 players, 640 for 12 to 20, 1000+ only with vehicles or streaming.

## 8. Horror and tight spaces

Horror wants spaces that feel tight without being tight to play:

- Keep corridors 6+ wide and ceilings 12+ for the camera; get the pressure from low light, fog, clutter along the walls and short sight lines (bends every 30 to 40 studs), not from 3 stud gaps.
- Dead gaps are still wrong here. A narrow squeeze should be an intentional 3.5 to 4 stud passage with a clear way through.
- Rooms off a corridor: door, one anchor object, one hiding place, one thing out of place. Half the usual furniture density reads as abandoned; knocked-over pieces at odd angles are a deliberate break of the 90 degree rule.
- Chase routes need a constant width (8) and no furniture corners to catch on; mark them as main routes so the checker measures them.
- Mood (lighting, fog, sound) is the `roblox-atmosphere` skill.
