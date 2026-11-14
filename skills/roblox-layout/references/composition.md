# Composition: making a layout look good

Correct spacing makes a layout usable. These habits make it look designed. They apply at every scale: a bedroom, a plaza, a 600 stud map.

## Contents
1. Start from the first view
2. One focal point
3. Hierarchy: hero, support, filler
4. Group, then arrange the groups
5. Rhythm and variation
6. Alignment and the grid
7. Symmetry and balance
8. Height and silhouette
9. Edges, corners and negative space
10. Colour: 60-30-10
11. Dressing: the last tenth
12. Common mistakes and the fix

---

## 1. Start from the first view

The spawn point, or the doorway of a room, is the composition's camera. Before placing anything decide what the player sees in the first second: the goal straight ahead, framed, with a clear way to it. Check it with the preview's **Player view** button. If the first view is a wall, the back of a sofa or an empty lawn, rotate the spawn or move the focal point before touching anything else.

## 2. One focal point

Each space has one thing that matters most: the counter in a restaurant, the fountain in a plaza, the TV wall in a living room, the first platform of an obby, the tallest tower in a city. Put it where the main route ends, give it clear floor (4 to 5 studs all round for free-standing pieces), light it, and make it the tallest, brightest or most colourful thing in view. Two equal focal points compete; make one clearly secondary.

## 3. Hierarchy: hero, support, filler

Roughly one hero piece, a few supporting groups, and many small fillers. In size terms aim for clear steps, not a smooth range: large (a counter run, a building), medium (table sets, trees), small (plants, lamps, crates). A scene made only of medium things looks flat and repetitive; a scene of only small things looks like clutter.

## 4. Group, then arrange the groups

- A group shares a purpose and nearly touches: table and chairs; sofa, coffee table, rug and lamp; bench between two planters; a big rock with two small ones.
- A rug, a platform or a change of floor material under a group ties it together and makes the surrounding floor read as an aisle instead of leftover space.
- Odd counts (3, 5) look natural for loose groups of props and rocks. Pairs suit formal, symmetric spots (lamps either side of a door).
- Then space the groups by the aisle rules. The eye reads "five groups", not "thirty objects".

## 5. Rhythm and variation

Repeated built elements (lamps, columns, windows, shelves, stalls, table sets) want one spacing and one alignment: the regularity is what makes them look intended. Then break the pattern once, on purpose: a different table set every third position, a taller building mid-row, a gap where the path crosses. Repetition without a break is monotonous; variation without repetition is noise.

For natural elements invert it: no two trees share a rotation or exact size, spacing is irregular but never clumped, and density drifts (thick forest, thinning edge, open meadow). Use Poisson scatter with a density field, never a grid and never raw random positions.

## 6. Alignment and the grid

- Built objects snap to a grid (1 stud, or 0.5 for fine work) and rotate in 90 degree steps; 45 for the occasional deliberate accent (an armchair angled toward the sofa, a corner stall).
- Line things up with something: the wall, the centre line of the room, the edge of a rug, the neighbour. An object 0.3 studs off its neighbours' line is the most visible small error there is; the checker reports it as near-aligned.
- Centre a group on the feature it belongs to (the lounge on the TV, the bed on its wall, the counter on the door axis), not on the room's arithmetic centre when those differ.
- Equal margins: the space left at both ends of a row should match.

## 7. Symmetry and balance

Symmetry about the entrance axis suits formal and commercial spaces (restaurant, shop, lobby, tycoon street): it is easy to read and makes the centre line the main aisle. Homes, camps and natural places want balance without mirroring: a heavy group on one side answered by two lighter ones on the other. In a symmetric plan one asymmetric element (a lounge corner, a host stand) keeps it from feeling sterile.

## 8. Height and silhouette

- Vary heights on purpose: low seating, mid counters and shelves, tall plants and lamps, something at the ceiling. A room where everything stops at 3 studs looks unfinished above the waist: use wall art at 6 to 9, pendant lights, tall shelving.
- Tall things go to the walls and corners, low things to the middle, so sight lines across the space stay open.
- Outdoors, shape the skyline: tallest toward the centre or the landmark, stepping down outward; never two neighbours the same height. A building, tower or great tree 30+ studs tall is a navigation aid.
- Layer depth: something close (a tree, a column), the subject, something behind it.

## 9. Edges, corners and negative space

- Corners are where rooms look empty first. A plant, a lamp or a shelf run that ends in the corner fixes it for almost no floor.
- Walls carry things: shelves, counters, booths, art. A bare wall longer than about 16 studs needs a window, a piece of art or a piece of furniture.
- Empty floor is a tool, not a failure: the main aisle, the entry zone, a plaza. It works when it has a shape and a purpose and is bounded by things. It fails when it is just what was left over, which is what the checker's "empty floor" finding points at.

## 10. Colour: 60-30-10

About 60% a quiet dominant (walls, floor, ground), 30% a secondary (wood, main furniture, building bodies), 10% an accent (cushions, awnings, signs, the thing you want noticed). Keep the accent for what matters: the focal point, interactables, the route. The tool's palettes (`rlayout.cjs palettes`: cozy, modern, pastel, industrial, neon, rustic) are built this way; a custom palette is a table of the same role names (`wall`, `floor`, `wood`, `fabric`, `accent`, `accent2`...).

Materials follow the same logic: one or two dominant materials per space, and a change of floor material to mark a zone.

## 11. Dressing: the last tenth

After the layout checks clean, add the things that make it feel lived in, without touching the aisles: wall art, a mat at the door, pendant lights over tables, a rug under the seating, plants in corners, a crate beside the counter, a planter either side of a bench. Dressing belongs to a group or a wall. If a prop sits alone in open floor, attach it to something or remove it.

## 12. Common mistakes and the fix

| It looks... | Usually because | Fix |
|---|---|---|
| Cramped | dead gaps, furniture in each other's working space, aisles under 4 | remove one item per row, or widen the room by one module |
| Empty | room sized before its contents; everything pushed to the walls | shrink the room, or add a grouped set on a rug in the middle |
| Cluttered | many single props evenly spread | merge into groups, clear the aisles |
| Messy | off-grid positions, odd angles, near-misses in alignment, uneven gaps | snap, align to one line, equalise the gaps |
| Flat | everything the same height and size | add a hero piece, tall things at the walls, something overhead |
| Fake (outdoors) | trees on a grid or in random clumps, identical rotation and size | Poisson scatter, random rotation, scale 0.8 to 1.25, density that drifts |
| Confusing | no focal point, or it isn't visible from the entrance | choose one, put it on the entrance axis, clear the way to it |
| Unfinished | bare corners and long bare walls, nothing above 4 studs | corner plants, wall art, lighting |
