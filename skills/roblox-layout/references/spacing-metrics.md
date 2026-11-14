# Spacing metrics

Every number here is in studs and assumes default avatars and movement (WalkSpeed 16, JumpHeight 7.2, Gravity 196.2). If the game changes those, walking times and jump gaps scale with them: `node scripts/rlayout.cjs jump --speed 20 --height 10` recomputes the jump table.

## Contents
1. The avatar and the camera
2. Gaps: the closed-or-open rule
3. Doors, ceilings, corridors, stairs
4. Aisles and routes
5. Clearances per object
6. Seating and tables
7. Shops and counters
8. Kitchens, bedrooms, baths, offices
9. Streets, lots and outdoor furniture
10. Tycoon plots
11. Nature and scatter
12. Walking time and points of interest
13. Jumps
14. Density: how full is full

---

## 1. The avatar and the camera

| Thing | Studs | Consequence |
|---|---|---|
| Avatar height | about 5 (R15 default; up to 6 with scaling and hats) | Furniture is sized against a 5 stud person: seat at 1.7, table top at 3, counter at 3.8. |
| Avatar width | 2 body, 4 with arms | A gap must be 3.5+ to walk through without clipping arms; 4 is comfortable. |
| Collision root | 2 x 2 x 1 | Platforms narrower than 2 are precision platforms. |
| Camera | 12.5 behind, slightly above | Rooms need height (14) and depth, or the camera pushes in and the player sees their own back. |
| Walk speed | 16 per second | 100 studs is 6 seconds. Distances are best thought of in seconds. |
| Jump | 7.2 high, 8.7 forward on the flat | See section 13. |

Roblox scale runs large compared with real life (a stud is roughly 28 cm, but avatars are wide and the camera is far), so real-world dimensions converted directly feel cramped. Use the numbers below, not conversions.

## 2. Gaps: the closed-or-open rule

| Gap between two solid things | Reads as | Verdict |
|---|---|---|
| 0 to 0.5 | touching, one group | good |
| 0.6 to 3.4 | a mistake: can't walk through it, doesn't look attached | **dead gap: avoid** |
| 3.5 to 4 | a tight but usable passage | fine for working gaps |
| 4 to 6 | a normal aisle | good |
| 6 to 10 | a main route | good |
| over about 16 indoors with nothing in it | empty floor | loose: give it a job |

The same against walls: furniture sits flush to a wall or 3.5+ away from it. The one exception is space an object reserves for its own use (the 1.5 studs behind a chair): a gap inside that reserve is not dead.

When things don't divide evenly, don't leave the remainder as a sliver at one end. Options, in order: spread it across all the gaps; centre the row with equal margins of 4+ at both ends; push the row flush into a corner and leave one walkable gap; remove one item.

## 3. Doors, ceilings, corridors, stairs

| Element | Minimum | Comfortable | Notes |
|---|---|---|---|
| Door opening, width | 5 | 6 (single), 8 to 10 (double, shops, busy routes) | |
| Door opening, height | 7.5 | 8 to 9 | Hats and tall avatars. |
| Ceiling | 12 | 14 (homes), 16 to 20 (shops, restaurants, halls) | Under 12 the camera clips into the ceiling. |
| Corridor width | 6 | 8; 10 to 12 where players pass each other | |
| Wall thickness | 1 | 1 (interior), 1 to 2 (exterior) | |
| Window sill / head | 3.5 / 9.5 | | A 6 wide window every 14 to 18 studs of wall. |
| Stair step | rise 1, run 1.5 to 2 | | Avatars climb steps up to about 2 high without jumping; ramps under 45 degrees also work. |
| Stair width | 5 | 6 to 8 | |
| Keep clear inside a door | 5 deep, door width + 1 | | Nothing in the swing: the first step into a room must be free. |

## 4. Aisles and routes

| Route | Width |
|---|---|
| Main route (entrance to the focal point, spawn to hub) | 6 to 8 |
| Secondary aisles (between table groups, between shelves) | 4.5 to 5 |
| Working gap (behind a counter, between bed and wall) | 3.5 to 4.5 |
| Outdoor footpath | 6 to 8 |
| Plaza or lobby with many players | keep an open area of 30+ across at spawn |

Make different classes visibly different. A 6 stud main aisle next to 5 stud side aisles looks like inconsistent spacing; 7 next to 4.5 looks like a plan.

## 5. Clearances per object

The free floor an object needs to be usable (the catalog's `clear`; `rlayout.cjs kinds` lists all of them).

| Object | In front | Other |
|---|---|---|
| Service counter, bar | 5 (queue) | 4 behind (staff) |
| Host stand, kiosk, stall | 4 to 5 | 3 behind |
| Shelf, fridge, stove, sink, wardrobe | 4 | |
| Bookshelf, TV, bed (foot or one side) | 3 | |
| Toilet, basin, bathtub | 3 | |
| Display table, pedestal, statue, fountain | 4 to 5 all round | |
| Chair, office chair | | 1.5 behind (pull-out) |
| Sofa, armchair, bench | 1.5 to 2 (legroom) | |
| Interaction pad, button, proximity prompt | stand point within 2 to 6 of it | Put the prompt where the player can stand, not behind the object. |
| Leaderboard, sign that must be read | 5 | Readable from 20 to 40 away: text 1.5+ studs tall. |

## 6. Seating and tables

| Set | Footprint | Notes |
|---|---|---|
| Table for 4 (4.5 square table, 4 chairs) | 8.1 x 8.1 | Chair seats tuck 0.4 under the table edge. |
| Table for 2 (4 round table, 2 chairs) | 4 x 7.6 | |
| Table for 6 (9 x 4.5 table) | 9 x 8.1 | |
| Booth (two benches, table) | 7.8 along the wall x 5.5 deep | Booths pack back to back with no gap. |
| Lounge (sofa, coffee table, 2 armchairs, rug) | 16 x 8 | Sofa front 2 studs from the coffee table; sofa 8 to 10 from the TV. |

Spacing between table sets: 4.5 from chair back to chair back (5 to 6 on the main aisle side). Centre-to-centre pitch for 4-seat sets is therefore about 12.6. Chair backs can sit 1.5 to 2 from a wall (pull-out space only) or leave a 4+ aisle; nothing in between.

Room width for a restaurant with booths on both walls, c columns of 4-seat tables per side and a 6 stud centre aisle: `2 x (5.5 + 4.5 + c x 8.1 + (c - 1) x 4.5 + 3)`. That gives 42 for one column a side and 68 for two. Widths in between leave a strip that fits nothing.

## 7. Shops and counters

| Element | Studs |
|---|---|
| Wall shelf | 6 wide, 2 deep, 7.5 high; packed edge to edge along a wall |
| Free-standing gondola | 8 x 3.2; aisles 5 between, 7 on the centre line |
| Checkout counter | 10 long units; 5 in front, 4.5 behind |
| Entry zone (no stock, no queue) | 7 deep inside the door |
| Feature display | on the centre line 10 to 12 inside the door, 4 clear all round |
| Counter height / shelf reach | 3.8 / up to 7.5 |

Customers should see the counter or the feature from the door, and the longest aisle should point at it.

## 8. Kitchens, bedrooms, baths, offices

| Element | Studs |
|---|---|
| Kitchen units (fridge, stove, sink, worktop) | 4 wide, 3 deep, in one touching run |
| Kitchen run to island or counter | 4 to 4.5 |
| Bed | 6.5 x 9, head to the wall, nightstands touching both sides, 3+ clear at the foot or one side |
| Wardrobe | 6 x 2.6, 4 in front |
| Desk and chair | 6 x 5 including the chair; desk flush to a wall or paired face to face (6 x 10) |
| Desk rows in an office | 5 between pairs; 5 from walls |
| Meeting table for 6 | 12 x 9 with chairs; 4 clear all round |
| Bathroom | tub along one wall, toilet and basin on the others, 3 clear in front of each; a 12 x 14 room is enough |

Smallest rooms that furnish without dead gaps: bedroom 24 x 22, living room 30 x 26, kitchen 20 x 18, bath 12 x 14, cafe 42 x 40, restaurant 44 x 44, shop 44 x 46.

## 9. Streets, lots and outdoor furniture

| Element | Studs |
|---|---|
| Road, two lanes | 24 to 28 (lane 12 to 14; typical car is 8 wide, 16 long) |
| Road, four lanes | 48 to 56 |
| Pavement | 8 (6 minimum) |
| City block | 100 to 140 on a side (6 to 9 seconds to walk) |
| Shop or town-house lot width | 24 to 36, party walls touching |
| Detached house | 22 to 28 wide, 24 deep, 8 to 10 between houses, 6 to 8 front setback |
| Service alley | 10 to 12 (or no gap at all: touching) |
| Storey height | 12 (ground floor of shops 12 to 14) |
| Street lamp spacing | 40 to 50, 1.5 in from the kerb, arm over the road |
| Street tree spacing | 28 to 34, between the lamps |
| Bench | 6 wide, back to a wall or planter, 2 clear in front, facing something worth looking at |
| Zebra stripes | 2.2 wide, 5 pitch; lane dashes 8 long, 12 gap |
| Fence panel | 8 long, 3.6 high |

Buildings on a street either touch (a terrace) or leave a walkable passage. A 2 stud slot between two buildings is the outdoor version of the dead gap.

## 10. Tycoon plots

| Element | Studs |
|---|---|
| Plot | 80 x 96 to 120 x 140; all plots identical |
| Gap between plots | 20+ (reads as separate; room for a lamp or tree line) |
| Shared street or hub between facing rows | 36 wide |
| Gate / claim door | 12 to 16 wide, centred on the street side |
| Conveyor | 5 wide; droppers every 10 along it, on the wall side |
| Purchase button | 4 across; 10 apart; 8.5 from the conveyor centre (a 4 stud walkway beside the belt) |
| Button row | lined up with the thing each button buys |
| Collector to gate | 15 to 30: the money walk should be short |
| Build area | keep one open rectangle (at least 40 x 50) for the building that grows |

## 11. Nature and scatter

Spacing is centre to centre.

| Thing | Spacing | Notes |
|---|---|---|
| Trees, dense forest | 10 to 12 | Trunks 2 across leave 8+ to walk between. |
| Trees, open woodland | 16 to 20 | |
| Trees at a forest edge | 26 to 30 | Density should thin out, not stop at a line. |
| Lone trees in a meadow | 40 to 50 | |
| Bushes | 12 to 14, mostly along forest edges | |
| Rock clusters | 30 to 40; one large rock with two small ones | Odd numbers, different sizes, touching or nearly. |
| Flowers, grass tufts (no collision) | 9 to 12 | |
| Resource nodes | 50 to 70 | Even spread is fairness, not decoration. |
| Clearing around a point of interest | radius 20 to 28 | |
| Trail | 7 wide, 5+ clear either side | |
| Lake | radius 40 to 70, 6 of beach | |

Rotate every natural object randomly and vary scale between about 0.8 and 1.25. Two trunks under 1 stud apart read as a glitch.

## 12. Walking time and points of interest

| Distance | Time | Use |
|---|---|---|
| 16 | 1 s | |
| 50 to 80 | 3 to 5 s | spawn to the first thing to do; shop from spawn |
| 100 to 240 | 6 to 15 s | between points of interest on an open map |
| over 260 | 16 s+ | too far with nothing to see: add a landmark, a resource or a shortcut |
| Interior, door to the farthest point | under 12 s | |

A landmark tall enough to see over the trees (30+ studs) near the centre lets players navigate without a minimap.

## 13. Jumps

Edge-to-edge gaps for default movement (the avatar can take off and land with its feet partly over an edge, so the true maximum is about reach + 1):

| Landing is... | Reach | Comfortable gap | Hardest fair gap | Impossible beyond |
|---|---|---|---|---|
| 8 lower | 10.6 | 8.1 | 9.4 | 11.6 |
| 4 lower | 9.7 | 7.2 | 8.5 | 10.7 |
| level | 8.7 | 6.2 | 7.5 | 9.7 |
| 2 higher | 8.0 | 5.5 | 6.8 | 9.0 |
| 4 higher | 7.2 | 4.7 | 6.0 | 8.2 |
| 6 higher | 6.1 | 3.6 | 4.9 | 7.1 |

Rises over about 5.7 are barely reachable; 7.2 is the ceiling. Phones and lag eat about a stud, so "hardest fair" is for late stages only.

| Platform | Size |
|---|---|
| Easy landing | 8 to 9 |
| Normal | 5 to 6 |
| Hard | 3.5 to 4 |
| Precision (beam, pole) | 2 |
| Checkpoint / rest | 14+ |

## 14. Density: how full is full

Share of the floor covered by solid things (walls excluded):

| Space | Loose under | Good | Crowded over |
|---|---|---|---|
| Home rooms | 12% | 15 to 30% | 45% |
| Restaurant, cafe | 14% | 18 to 35% | 50% |
| Shop | 14% | 18 to 40% | 50% |
| Office | 12% | 15 to 30% | 45% |
| Tycoon plot (start) | 2% | 4 to 15% | 50% |
| City (buildings over land) | 15% | 20 to 45% | 70% |
| Forest map (trunks and rocks) | under 1% | 2 to 5% | 30% |

Coverage alone doesn't decide it: also look at the widest empty circle (over about 16 studs indoors, 45 on a tycoon plot, 110 on a wilderness map means a bald patch) and the narrowest route.
