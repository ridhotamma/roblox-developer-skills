// The object catalog: every kind's size in studs, the free space it needs to be usable, and the
// blockout parts it is drawn and built from. Also ready-made sets (a table with its chairs),
// colour palettes, and the code that turns a layout spec into a flat list of resolved items.
"use strict";
const G = require("./geom.cjs");

// ---------- palettes: parts name a colour role, the palette picks the colour ----------
const BASE = {
  grass: "#79B861", leaf: "#58A552", leafDark: "#2F7A4C", leafAlt: "#9CC456", trunk: "#7D573A", rock: "#979AA0", rockDark: "#74787F",
  water: "#58B4E0", sand: "#E6D3A1", dirt: "#A88560", road: "#50545C", sidewalk: "#C3C6CC", line: "#F4F4F0", berry: "#DB4A70", ore: "#63D6EC",
  fire: "#FF9A3C", hazard: "#F0483E", check: "#45D07A", gold: "#F6C445", glass: "#BFE6F2", light: "#FFE7B0", white: "#F7F3EA", dark: "#2F2C2A", metal: "#8F9399", stone: "#A39E95",
};
const PALETTES = {
  cozy:       { wall: "#EFE4CF", floor: "#BF9163", trim: "#7C5536", wood: "#AD7643", woodDark: "#6E4829", fabric: "#C95D42", accent: "#E3A535", accent2: "#3F8270", pot: "#B8684C" },
  modern:     { wall: "#F1F1EE", floor: "#D9D4CB", trim: "#3B3F46", wood: "#C9A77C", woodDark: "#4A4E57", fabric: "#5C6B7A", accent: "#2F9E8F", accent2: "#F2B441", pot: "#E8E6E1" },
  pastel:     { wall: "#FFF1E3", floor: "#F6D9B8", trim: "#F29CB1", wood: "#F3C894", woodDark: "#D99A6A", fabric: "#8CCBEA", accent: "#FF8FA8", accent2: "#8FD9A8", pot: "#FFD27A" },
  industrial: { wall: "#B9B4AB", floor: "#7D7F83", trim: "#34363A", wood: "#8E6B4B", woodDark: "#3B3C40", fabric: "#4F5B52", accent: "#E0792B", accent2: "#D9B23C", pot: "#5B5E63" },
  neon:       { wall: "#2B2540", floor: "#1D1A2C", trim: "#12101C", wood: "#3F3760", woodDark: "#231F38", fabric: "#5B3FA6", accent: "#22E0D0", accent2: "#FF3FA0", pot: "#3A3458", light: "#9DF6FF" },
  rustic:     { wall: "#D8C3A0", floor: "#8E6844", trim: "#5A3D26", wood: "#9B6B3F", woodDark: "#553720", fabric: "#7E8F4E", accent: "#C44E33", accent2: "#D9A441", pot: "#A0583C" },
};
function palette(p) {
  const base = Object.assign({}, BASE, PALETTES.cozy);
  if (!p) return base;
  if (typeof p === "string") { if (!PALETTES[p]) throw new Error(`unknown palette "${p}" (have: ${Object.keys(PALETTES).join(", ")})`); return Object.assign(base, PALETTES[p]); }
  return Object.assign(base, p.base ? PALETTES[p.base] : {}, p);
}
const hex = (c, pal) => (c && c[0] === "#" ? c : pal[c] || "#B0B0B0");

// ---------- part helpers: p = centre relative to the item's base centre, z = size ----------
const B = (x, y, z, w, h, d, c, m, r) => ({ s: "block", p: [x, y, z], z: [w, h, d], c, m, r });
const C = (x, y, z, dia, h, c, m) => ({ s: "cylinder", p: [x, y, z], z: [dia, h, dia], c, m });
const S = (x, y, z, dia, c, m) => ({ s: "ball", p: [x, y, z], z: [dia, dia, dia], c, m });
const W = (x, y, z, w, h, d, c, m, r) => ({ s: "wedge", p: [x, y, z], z: [w, h, d], c, m, r });
const legs = (w, d, h, t, c) => [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(s => B(s[0] * (w / 2 - t / 2), h / 2, s[1] * (d / 2 - t / 2), t, h, t, c, "Wood"));

// ---------- kinds ----------
// size [w, h, d]; front is -Z. clear {f, b, l, r}: studs of free floor needed on that side.
// foot [w, d]: collision footprint when smaller than the visual size (a tree's trunk).
// anchor: "wall" (back to a wall), "free", "corner". space: wanted centre spacing when scattered.
const K = {};
// seating and tables
K.chair = { size: [2.2, 4.1, 2.2], role: "furniture", clear: { b: 1.5 }, parts: [B(0, 1.7, 0, 2.2, 0.4, 2.2, "fabric", "Fabric"), B(0, 3, 0.95, 2.2, 2.2, 0.3, "wood", "Wood"), ...legs(2, 2, 1.5, 0.3, "woodDark")] };
K.stool = { size: [1.8, 2.6, 1.8], role: "furniture", parts: [C(0, 2.4, 0, 1.8, 0.4, "fabric", "Fabric"), C(0, 1.1, 0, 0.4, 2.2, "metal", "Metal"), C(0, 0.1, 0, 1.4, 0.2, "metal", "Metal")] };
K.table_square = { size: [4.5, 3, 4.5], role: "furniture", parts: [B(0, 2.8, 0, 4.5, 0.4, 4.5, "wood", "WoodPlanks"), C(0, 1.4, 0, 0.8, 2.4, "woodDark", "Wood"), C(0, 0.1, 0, 2.4, 0.2, "woodDark", "Wood")] };
K.table_round = { size: [4, 3, 4], role: "furniture", parts: [C(0, 2.8, 0, 4, 0.4, "wood", "WoodPlanks"), C(0, 1.4, 0, 0.7, 2.4, "woodDark", "Wood"), C(0, 0.1, 0, 2.2, 0.2, "woodDark", "Wood")] };
K.table_long = { size: [9, 3, 4.5], role: "furniture", parts: [B(0, 2.8, 0, 9, 0.4, 4.5, "wood", "WoodPlanks"), B(-3.4, 1.3, 0, 0.6, 2.6, 3.4, "woodDark", "Wood"), B(3.4, 1.3, 0, 0.6, 2.6, 3.4, "woodDark", "Wood")] };
K.table_booth = { size: [3.6, 3, 5.5], role: "furniture", parts: [B(0, 2.8, 0, 3.6, 0.4, 5.5, "wood", "WoodPlanks"), B(0, 1.3, 1.6, 0.8, 2.6, 1.6, "woodDark", "Wood")] };
K.booth_bench = { size: [5.5, 4.6, 2.4], role: "furniture", parts: [B(0, 1, -0.2, 5.5, 2, 2, "fabric", "Fabric"), B(0, 2.3, 0.95, 5.5, 4.6, 0.5, "fabric", "Fabric"), B(0, 0.2, 0, 5.5, 0.4, 2.4, "woodDark", "Wood")] };
K.bench = { size: [6, 3.2, 2.2], role: "furniture", clear: { f: 2 }, parts: [B(0, 1.6, -0.1, 6, 0.4, 2, "wood", "WoodPlanks"), B(0, 2.6, 0.95, 6, 1.2, 0.3, "wood", "WoodPlanks"), B(-2.6, 0.7, 0, 0.4, 1.4, 2, "dark", "Metal"), B(2.6, 0.7, 0, 0.4, 1.4, 2, "dark", "Metal")] };
// service
K.counter = { size: [10, 3.8, 3], role: "furniture", clear: { f: 5, b: 4 }, parts: [B(0, 1.7, 0, 10, 3.4, 2.6, "woodDark", "Wood"), B(0, 3.6, 0, 10, 0.4, 3, "white", "Marble"), B(3.4, 4.5, 0.2, 1.8, 1.4, 1.6, "dark", "SmoothPlastic"), B(-2.6, 4.3, 0, 2.6, 1, 1.8, "glass", "Glass")] };
K.host_stand = { size: [3, 4.2, 2], role: "furniture", clear: { f: 4, b: 3 }, parts: [B(0, 1.9, 0, 3, 3.8, 2, "woodDark", "Wood"), B(0, 4, -0.1, 3.2, 0.4, 2.2, "wood", "WoodPlanks")] };
K.shelf = { size: [6, 7.5, 2], role: "furniture", anchor: "wall", clear: { f: 4 }, parts: [B(0, 3.75, 0.85, 6, 7.5, 0.3, "woodDark", "Wood"), ...[0.3, 2.2, 4.1, 6].map(y => B(0, y, 0, 6, 0.3, 2, "wood", "WoodPlanks")), B(-1.6, 1, 0, 1.6, 1.3, 1.3, "accent", "SmoothPlastic"), B(0.8, 2.9, 0, 2.2, 1.1, 1.2, "accent2", "SmoothPlastic"), B(-0.6, 4.8, 0, 1.4, 1.1, 1.2, "fabric", "SmoothPlastic"), B(1.9, 4.8, 0, 1.2, 1.1, 1.2, "accent", "SmoothPlastic")] };
K.gondola = { size: [8, 5.5, 3.2], role: "furniture", clear: { f: 4, b: 4 }, parts: [B(0, 2.75, 0, 8, 5.5, 0.4, "woodDark", "Wood"), ...[0.3, 2.1, 3.9].map(y => B(0, y, 0, 8, 0.3, 3.2, "wood", "WoodPlanks")), B(-2.4, 1, -0.9, 2, 1.2, 1, "accent", "SmoothPlastic"), B(1.6, 1, 0.9, 2.4, 1.2, 1, "accent2", "SmoothPlastic"), B(0.4, 2.8, -0.9, 2.2, 1.1, 1, "fabric", "SmoothPlastic"), B(-1.8, 2.8, 0.9, 1.8, 1.1, 1, "accent", "SmoothPlastic")] };
K.display_table = { size: [6, 3, 4], role: "furniture", clear: { f: 4, b: 4, l: 4, r: 4 }, parts: [B(0, 2.7, 0, 6, 0.5, 4, "wood", "WoodPlanks"), ...legs(5.6, 3.6, 2.5, 0.4, "woodDark"), B(-1.4, 3.6, 0, 1.6, 1.2, 1.6, "accent", "SmoothPlastic"), C(1.4, 3.7, 0, 1.4, 1.4, "accent2", "SmoothPlastic")] };
K.pedestal = { size: [3, 6, 3], role: "prop", clear: { f: 4, b: 4, l: 4, r: 4 }, parts: [C(0, 0.2, 0, 3, 0.4, "white", "Marble"), C(0, 1.9, 0, 2.2, 3, "white", "Marble"), S(0, 4.7, 0, 2.4, "gold", "Neon")] };
// kitchen and bath
K.fridge = { size: [4, 7.6, 3], role: "furniture", anchor: "wall", clear: { f: 4 }, parts: [B(0, 3.8, 0, 4, 7.6, 3, "metal", "Metal"), B(1.5, 4.4, -1.55, 0.25, 2.4, 0.2, "dark", "Metal")] };
K.stove = { size: [4, 3.8, 3], role: "furniture", anchor: "wall", clear: { f: 4 }, parts: [B(0, 1.8, 0, 4, 3.6, 3, "metal", "Metal"), B(0, 3.7, 0, 4, 0.2, 3, "dark", "SmoothPlastic"), B(0, 1.6, -1.52, 3, 1.8, 0.1, "dark", "Glass")] };
K.sink_counter = { size: [4, 3.8, 3], role: "furniture", anchor: "wall", clear: { f: 4 }, parts: [B(0, 1.7, 0, 4, 3.4, 2.8, "woodDark", "Wood"), B(0, 3.6, 0, 4, 0.4, 3, "white", "Marble"), B(0, 3.75, -0.2, 2.2, 0.15, 1.6, "metal", "Metal"), B(0, 4.4, 1, 0.3, 1.2, 0.3, "metal", "Metal")] };
K.counter_unit = { size: [4, 3.8, 3], role: "furniture", anchor: "wall", clear: { f: 4 }, parts: [B(0, 1.7, 0, 4, 3.4, 2.8, "woodDark", "Wood"), B(0, 3.6, 0, 4, 0.4, 3, "white", "Marble")] };
K.kitchen_island = { size: [8, 3.8, 4], role: "furniture", clear: { f: 4, b: 4 }, parts: [B(0, 1.7, 0, 7.6, 3.4, 3.6, "woodDark", "Wood"), B(0, 3.6, 0, 8, 0.4, 4, "white", "Marble")] };
K.toilet = { size: [2.4, 3.4, 3], role: "furniture", anchor: "wall", clear: { f: 3 }, parts: [B(0, 1, -0.3, 2, 2, 2.2, "white", "SmoothPlastic"), B(0, 2.4, 1, 2.4, 2, 1, "white", "SmoothPlastic")] };
K.bath_sink = { size: [3.4, 3.6, 2.2], role: "furniture", anchor: "wall", clear: { f: 3 }, parts: [B(0, 1.6, 0, 3.4, 3.2, 2, "woodDark", "Wood"), B(0, 3.4, 0, 3.4, 0.4, 2.2, "white", "Marble"), B(0, 6, 1, 2.6, 2.6, 0.2, "glass", "Glass")] };
K.bathtub = { size: [7.5, 2.6, 3.6], role: "furniture", anchor: "wall", clear: { f: 3 }, parts: [B(0, 1.3, 0, 7.5, 2.6, 3.6, "white", "SmoothPlastic"), B(0, 2.5, 0, 6.5, 0.25, 2.6, "water", "Glass")] };
// living, bedroom, office
K.sofa = { size: [8, 3.4, 3.4], role: "furniture", clear: { f: 1.5 }, parts: [B(0, 1, -0.3, 8, 2, 2.8, "fabric", "Fabric"), B(0, 2, 1.3, 8, 3.4, 0.8, "fabric", "Fabric"), B(-3.6, 1.5, -0.3, 0.8, 3, 2.8, "fabric", "Fabric"), B(3.6, 1.5, -0.3, 0.8, 3, 2.8, "fabric", "Fabric")] };
K.armchair = { size: [3.6, 3.4, 3.4], role: "furniture", clear: { f: 1.5 }, parts: [B(0, 1, -0.3, 3.6, 2, 2.8, "accent2", "Fabric"), B(0, 2, 1.3, 3.6, 3.4, 0.8, "accent2", "Fabric"), B(-1.5, 1.5, -0.3, 0.6, 3, 2.8, "accent2", "Fabric"), B(1.5, 1.5, -0.3, 0.6, 3, 2.8, "accent2", "Fabric")] };
K.coffee_table = { size: [5, 1.6, 3], role: "furniture", parts: [B(0, 1.4, 0, 5, 0.4, 3, "wood", "WoodPlanks"), ...legs(4.6, 2.6, 1.2, 0.3, "woodDark")] };
K.tv_stand = { size: [8, 6.4, 1.8], role: "furniture", anchor: "wall", clear: { f: 3 }, parts: [B(0, 1.1, 0, 8, 2.2, 1.8, "woodDark", "Wood"), B(0, 4.3, 0.5, 6.4, 3.8, 0.3, "dark", "SmoothPlastic")] };
K.bookshelf = { size: [5, 8, 1.8], role: "furniture", anchor: "wall", clear: { f: 3 }, parts: [B(0, 4, 0.75, 5, 8, 0.3, "woodDark", "Wood"), B(-2.35, 4, 0, 0.3, 8, 1.8, "woodDark", "Wood"), B(2.35, 4, 0, 0.3, 8, 1.8, "woodDark", "Wood"), ...[0.2, 2.1, 4, 5.9, 7.8].map(y => B(0, y, 0, 5, 0.3, 1.8, "wood", "WoodPlanks")), B(-0.8, 3, -0.1, 2.6, 1.5, 1.1, "accent", "SmoothPlastic"), B(0.6, 4.9, -0.1, 3, 1.5, 1.1, "accent2", "SmoothPlastic"), B(-1, 6.7, -0.1, 2, 1.3, 1.1, "fabric", "SmoothPlastic")] };
K.bed = { size: [6.5, 3.6, 9], role: "furniture", anchor: "wall", clear: { f: 3 }, parts: [B(0, 0.9, 0, 6.5, 1.8, 9, "woodDark", "Wood"), B(0, 2.1, -0.4, 6.1, 0.8, 7.8, "white", "Fabric"), B(0, 2.25, -1.6, 6.3, 0.9, 5.4, "fabric", "Fabric"), B(-1.5, 2.8, 3.1, 2.4, 0.6, 1.5, "white", "Fabric"), B(1.5, 2.8, 3.1, 2.4, 0.6, 1.5, "white", "Fabric"), B(0, 1.8, 4.3, 6.5, 3.6, 0.4, "wood", "Wood")] };
K.nightstand = { size: [2.2, 2.4, 2.2], role: "furniture", anchor: "wall", parts: [B(0, 1.2, 0, 2.2, 2.4, 2.2, "wood", "Wood"), C(0, 2.7, 0, 0.5, 0.6, "dark", "Metal"), C(0, 3.5, 0, 1.3, 1, "light", "Neon")] };
K.wardrobe = { size: [6, 8, 2.6], role: "furniture", anchor: "wall", clear: { f: 4 }, parts: [B(0, 4, 0, 6, 8, 2.6, "wood", "Wood"), B(0, 4, -1.32, 0.15, 7.4, 0.1, "woodDark", "Wood"), B(-0.5, 4, -1.4, 0.2, 1.2, 0.2, "metal", "Metal"), B(0.5, 4, -1.4, 0.2, 1.2, 0.2, "metal", "Metal")] };
K.desk = { size: [6, 3, 3], role: "furniture", parts: [B(0, 2.8, 0, 6, 0.4, 3, "wood", "WoodPlanks"), B(-2.7, 1.3, 0, 0.4, 2.6, 2.8, "woodDark", "Wood"), B(2.7, 1.3, 0, 0.4, 2.6, 2.8, "woodDark", "Wood"), B(0, 4, -0.7, 2.6, 1.6, 0.2, "dark", "SmoothPlastic"), B(0, 3.1, -0.7, 0.4, 0.3, 0.4, "dark", "SmoothPlastic")] };
K.office_chair = { size: [2.4, 4.2, 2.4], role: "furniture", clear: { b: 1.5 }, parts: [B(0, 1.8, 0, 2.4, 0.5, 2.4, "dark", "Fabric"), B(0, 3.1, 1.05, 2.2, 2.2, 0.3, "dark", "Fabric"), C(0, 0.9, 0, 0.4, 1.4, "metal", "Metal"), C(0, 0.1, 0, 2, 0.2, "metal", "Metal")] };
K.meeting_table = { size: [12, 3, 5], role: "furniture", parts: [B(0, 2.8, 0, 12, 0.4, 5, "wood", "WoodPlanks"), B(-4, 1.3, 0, 0.8, 2.6, 3, "woodDark", "Wood"), B(4, 1.3, 0, 0.8, 2.6, 3, "woodDark", "Wood")] };
// dressing
K.plant = { size: [2.6, 5.4, 2.6], role: "prop", anchor: "corner", parts: [C(0, 0.8, 0, 1.8, 1.6, "pot", "SmoothPlastic"), C(0, 2.1, 0, 0.3, 1.2, "trunk", "Wood"), S(0, 3.7, 0, 2.6, "leaf", "Grass"), S(0.5, 4.5, 0.3, 1.6, "leafAlt", "Grass")] };
K.plant_small = { size: [1.6, 2.6, 1.6], role: "prop", parts: [C(0, 0.5, 0, 1.2, 1, "pot", "SmoothPlastic"), S(0, 1.8, 0, 1.6, "leaf", "Grass")] };
K.floor_lamp = { size: [1.6, 6.8, 1.6], role: "light", parts: [C(0, 0.1, 0, 1.6, 0.2, "dark", "Metal"), C(0, 2.8, 0, 0.25, 5.2, "dark", "Metal"), C(0, 6, 0, 1.6, 1.4, "light", "Neon")] };
K.pendant = { size: [1.8, 1.4, 1.8], role: "light", walkable: true, parts: [C(0, 0.7, 0, 1.8, 1.2, "light", "Neon"), C(0, 2.6, 0, 0.12, 2.6, "dark", "Metal")] };
K.rug = { size: [12, 0.1, 9], role: "decor", walkable: true, parts: [B(0, 0.05, 0, 12, 0.1, 9, "accent2", "Fabric"), B(0, 0.07, 0, 10.6, 0.1, 7.6, "white", "Fabric")] };
K.mat = { size: [6, 0.1, 3], role: "decor", walkable: true, parts: [B(0, 0.05, 0, 6, 0.1, 3, "trim", "Fabric")] };
K.wall_art = { size: [4, 3, 0.25], role: "decor", walkable: true, anchor: "wall", parts: [B(0, 1.5, 0, 4, 3, 0.2, "trim", "Wood"), B(0, 1.5, -0.05, 3.4, 2.4, 0.2, "accent", "SmoothPlastic")] };
K.crate = { size: [3, 3, 3], role: "prop", parts: [B(0, 1.5, 0, 3, 3, 3, "wood", "WoodPlanks"), B(0, 1.5, 0, 3.1, 0.4, 3.1, "woodDark", "Wood")] };
K.barrel = { size: [2.6, 3.4, 2.6], role: "prop", parts: [C(0, 1.7, 0, 2.6, 3.4, "wood", "WoodPlanks"), C(0, 0.8, 0, 2.7, 0.3, "metal", "Metal"), C(0, 2.6, 0, 2.7, 0.3, "metal", "Metal")] };
// nature
K.oak = { size: [11, 17, 11], foot: [2.2, 2.2], space: 14, role: "nature", parts: [C(0, 3.6, 0, 1.9, 7.2, "trunk", "Wood"), S(0, 10.5, 0, 10, "leaf", "Grass"), S(2.6, 12.6, 1.4, 6.5, "leafAlt", "Grass"), S(-2.4, 11.4, -1.8, 6, "leafDark", "Grass")] };
K.pine = { size: [8, 21, 8], foot: [1.8, 1.8], space: 11, role: "nature", parts: [C(0, 3, 0, 1.5, 6, "trunk", "Wood"), C(0, 7, 0, 8, 3.4, "leafDark", "Grass"), C(0, 10.4, 0, 6.2, 3.4, "leafDark", "Grass"), C(0, 13.8, 0, 4.4, 3.4, "leaf", "Grass"), C(0, 17, 0, 2.6, 3, "leaf", "Grass"), C(0, 19.6, 0, 1.1, 2.4, "leaf", "Grass")] };
K.birch = { size: [7, 15, 7], foot: [1.4, 1.4], space: 10, role: "nature", parts: [C(0, 4.5, 0, 1.1, 9, "white", "Wood"), S(0, 10.5, 0, 6.4, "leafAlt", "Grass"), S(1.2, 12.6, -0.6, 4.2, "leaf", "Grass")] };
K.bush = { size: [4, 3, 4], foot: [3, 3], space: 8, role: "nature", parts: [S(0, 1.4, 0, 3.6, "leaf", "Grass"), S(1.1, 1.1, 0.7, 2.4, "leafDark", "Grass"), S(-1, 1, -0.6, 2.2, "leafAlt", "Grass")] };
K.berry_bush = { size: [4, 3, 4], foot: [3, 3], space: 50, role: "nature", clear: { f: 2 }, parts: [S(0, 1.4, 0, 3.6, "leafDark", "Grass"), S(1, 2.3, -0.8, 0.8, "berry", "Neon"), S(-0.9, 1.9, -1.2, 0.8, "berry", "Neon"), S(0.2, 1.3, -1.7, 0.8, "berry", "Neon"), S(-1.2, 2.6, 0.2, 0.8, "berry", "Neon")] };
K.rock = { size: [4, 2.6, 3.4], space: 16, role: "nature", parts: [B(0, 1.2, 0, 3.6, 2.4, 3, "rock", "Slate", 12), B(0.5, 0.8, -0.4, 3, 1.6, 3.2, "rockDark", "Slate", -24)] };
K.rock_big = { size: [9, 7, 8], space: 30, role: "nature", parts: [B(0, 3, 0, 7.5, 6, 6.5, "rock", "Slate", 14), B(1.6, 2, 1.2, 6, 4, 5.5, "rockDark", "Slate", -20), B(-1.4, 5.4, -0.6, 4, 3.2, 3.6, "rock", "Slate", 32)] };
K.ore_node = { size: [5, 4, 4.5], space: 60, role: "nature", clear: { f: 2 }, parts: [B(0, 1.5, 0, 4.6, 3, 4, "rockDark", "Slate", 10), B(-0.8, 3.2, -0.4, 1, 2.2, 1, "ore", "Neon", 20), B(0.9, 2.9, 0.3, 0.9, 1.8, 0.9, "ore", "Neon", -15), B(0.1, 2.6, -1.6, 0.8, 1.4, 0.8, "ore", "Neon", 40)] };
K.flowers = { size: [3, 0.9, 3], role: "decor", walkable: true, space: 7, parts: [S(-0.8, 0.5, 0.3, 0.8, "berry", "SmoothPlastic"), S(0.6, 0.6, -0.5, 0.8, "gold", "SmoothPlastic"), S(0.3, 0.45, 0.9, 0.7, "white", "SmoothPlastic"), S(-0.3, 0.5, -0.9, 0.7, "gold", "SmoothPlastic")] };
K.log = { size: [7, 1.6, 1.8], role: "prop", clear: { f: 1.5 }, parts: [B(0, 0.8, 0, 7, 1.6, 1.6, "trunk", "Wood")] };
K.campfire = { size: [4, 2.4, 4], role: "prop", parts: [C(0, 0.3, 0, 4, 0.6, "rockDark", "Slate"), B(0, 0.9, 0, 2.4, 0.6, 0.6, "trunk", "Wood", 30), B(0, 0.9, 0, 2.4, 0.6, 0.6, "trunk", "Wood", -40), S(0, 1.7, 0, 1.6, "fire", "Neon")] };
K.tent = { size: [8, 6, 9], role: "prop", clear: { f: 3 }, parts: [W(-2, 3, 0, 9, 6, 4, "fabric", "Fabric", 90), W(2, 3, 0, 9, 6, 4, "fabric", "Fabric", -90), B(0, 0.1, 0, 7.6, 0.2, 8.6, "woodDark", "Fabric")] };
K.ruin_wall = { size: [10, 8, 2], role: "prop", parts: [B(-2.5, 4, 0, 5, 8, 2, "stone", "Cobblestone"), B(2.5, 2.5, 0, 5, 5, 2, "stone", "Cobblestone"), B(4.4, 5.6, 0, 1.2, 1.2, 2, "stone", "Cobblestone")] };
K.pillar = { size: [3, 12, 3], role: "prop", parts: [B(0, 0.5, 0, 3, 1, 3, "stone", "Cobblestone"), C(0, 6, 0, 2.2, 10, "stone", "Marble"), B(0, 11.5, 0, 3, 1, 3, "stone", "Cobblestone")] };
K.watchtower = { size: [10, 34, 10], role: "building", clear: { f: 4 }, parts: [...legs(8.6, 8.6, 22, 1, "woodDark"), B(0, 22.5, 0, 10, 1, 10, "wood", "WoodPlanks"), B(0, 24.5, -4.75, 10, 3, 0.5, "wood", "WoodPlanks"), B(0, 24.5, 4.75, 10, 3, 0.5, "wood", "WoodPlanks"), B(-4.75, 24.5, 0, 0.5, 3, 10, "wood", "WoodPlanks"), B(4.75, 24.5, 0, 0.5, 3, 10, "wood", "WoodPlanks"), ...legs(9, 9, 6, 0.6, "woodDark").map(p => { p.p[1] += 26; return p; }), B(0, 32.5, 0, 12, 1, 12, "accent", "WoodPlanks"), B(0, 33.4, 0, 8, 1, 8, "accent", "WoodPlanks"), B(0, 11, -4.4, 1.6, 22, 0.5, "wood", "WoodPlanks")] };
K.cabin = { size: [18, 15, 14], role: "building", clear: { f: 5 }, parts: [B(0, 5, 0, 18, 10, 14, "wood", "WoodPlanks"), W(0, 12.5, -3.5, 19, 5, 7.5, "accent", "WoodPlanks"), W(0, 12.5, 3.5, 19, 5, 7.5, "accent", "WoodPlanks", 180), B(0, 3.75, -7.05, 4.5, 7.5, 0.3, "woodDark", "Wood"), B(-5.5, 5.5, -7.05, 3.4, 3.4, 0.3, "glass", "Glass"), B(5.5, 5.5, -7.05, 3.4, 3.4, 0.3, "glass", "Glass"), B(6, 14, 3, 2, 6, 2, "stone", "Cobblestone")] };
K.dock = { size: [8, 1.6, 24], role: "floor", walkable: true, parts: [B(0, 1.3, 0, 8, 0.5, 24, "wood", "WoodPlanks"), ...[-10, -3, 4, 11].flatMap(z => [C(-3.6, 0.4, z, 0.9, 2.4, "woodDark", "Wood"), C(3.6, 0.4, z, 0.9, 2.4, "woodDark", "Wood")])] };
// street
K.lamp_post = { size: [1.2, 14, 1.2], foot: [1, 1], role: "light", parts: [C(0, 0.4, 0, 1.2, 0.8, "dark", "Metal"), C(0, 6.5, 0, 0.45, 12, "dark", "Metal"), B(0, 12.6, -1.2, 0.4, 0.4, 3, "dark", "Metal"), B(0, 12.2, -2.4, 1.2, 0.5, 1.6, "light", "Neon")] };
K.street_tree = { size: [8, 14, 8], foot: [1.6, 1.6], role: "nature", parts: [B(0, 0.15, 0, 4, 0.3, 4, "dirt", "Ground"), C(0, 3.4, 0, 1.2, 6.2, "trunk", "Wood"), S(0, 9.4, 0, 7.6, "leaf", "Grass"), S(1.4, 11.2, 0.8, 4.6, "leafAlt", "Grass")] };
K.trash_can = { size: [1.8, 3, 1.8], role: "prop", parts: [C(0, 1.4, 0, 1.8, 2.8, "dark", "Metal"), C(0, 2.9, 0, 2, 0.3, "metal", "Metal")] };
K.planter = { size: [6, 2.6, 3], role: "prop", parts: [B(0, 0.8, 0, 6, 1.6, 3, "stone", "Concrete"), S(-1.6, 2, 0, 2.2, "leaf", "Grass"), S(0.2, 2.2, 0, 2.4, "leafAlt", "Grass"), S(1.8, 1.9, 0, 2, "leafDark", "Grass")] };
K.fountain = { size: [16, 7, 16], role: "prop", clear: { f: 5, b: 5, l: 5, r: 5 }, parts: [C(0, 0.8, 0, 16, 1.6, "stone", "Marble"), C(0, 1.5, 0, 14, 0.4, "water", "Glass"), C(0, 2.6, 0, 2.4, 3.6, "stone", "Marble"), C(0, 4.6, 0, 6, 0.6, "stone", "Marble"), C(0, 5, 0, 5, 0.3, "water", "Glass"), S(0, 6, 0, 1.6, "water", "Glass")] };
K.fence = { size: [8, 3.6, 0.6], role: "wall", parts: [B(-3.7, 1.8, 0, 0.6, 3.6, 0.6, "woodDark", "Wood"), B(3.7, 1.8, 0, 0.6, 3.6, 0.6, "woodDark", "Wood"), B(0, 2.7, 0, 8, 0.5, 0.3, "wood", "WoodPlanks"), B(0, 1.2, 0, 8, 0.5, 0.3, "wood", "WoodPlanks")] };
// obby
K.checkpoint = { size: [6, 0.4, 6], role: "marker", walkable: true, parts: [C(0, 0.2, 0, 6, 0.4, "check", "Neon"), C(0, 0.25, 0, 4, 0.4, "white", "SmoothPlastic")] };
K.finish = { size: [10, 12, 2], role: "marker", walkable: true, parts: [B(-4.5, 6, 0, 1, 12, 1, "gold", "Neon"), B(4.5, 6, 0, 1, 12, 1, "gold", "Neon"), B(0, 11.5, 0, 10, 1, 1, "gold", "Neon")] };
// tycoon
K.dropper = { size: [4, 9, 5], role: "structure", parts: [B(0, 4, 1.5, 3, 8, 2, "metal", "Metal"), B(0, 8, -0.2, 4, 2, 5, "accent", "SmoothPlastic"), B(0, 6.7, -1.6, 1.6, 0.6, 1.6, "dark", "Metal")] };
K.conveyor = { size: [5, 1.2, 10], role: "structure", parts: [B(0, 0.5, 0, 5, 1, 10, "dark", "DiamondPlate"), B(-2.35, 0.9, 0, 0.3, 0.6, 10, "accent2", "Metal"), B(2.35, 0.9, 0, 0.3, 0.6, 10, "accent2", "Metal")] };
K.upgrader = { size: [7, 7, 2], role: "structure", walkable: true, parts: [B(-3, 3.5, 0, 1, 7, 2, "metal", "Metal"), B(3, 3.5, 0, 1, 7, 2, "metal", "Metal"), B(0, 6.5, 0, 7, 1, 2, "metal", "Metal"), B(0, 3.4, 0, 5, 5, 0.3, "ore", "Neon")] };
K.collector = { size: [7, 5, 6], role: "structure", clear: { f: 4 }, parts: [B(0, 2, 0.5, 7, 4, 5, "metal", "Metal"), B(0, 4.5, 0.5, 7, 1, 5, "accent", "SmoothPlastic"), B(0, 2, -2.2, 5, 2.6, 0.5, "dark", "SmoothPlastic")] };
K.button = { size: [4, 0.5, 4], role: "marker", walkable: true, parts: [C(0, 0.15, 0, 4, 0.3, "dark", "Metal"), C(0, 0.35, 0, 3.2, 0.4, "check", "Neon")] };
K.claim_gate = { size: [12, 10, 2], role: "marker", walkable: true, parts: [B(-5.5, 5, 0, 1, 10, 2, "accent", "SmoothPlastic"), B(5.5, 5, 0, 1, 10, 2, "accent", "SmoothPlastic"), B(0, 9, 0, 12, 2, 2, "accent", "SmoothPlastic"), B(0, 9, -1.05, 8, 1.2, 0.1, "white", "Neon")] };
K.cash_pad = { size: [6, 4, 6], role: "structure", clear: { f: 3, b: 3, l: 3, r: 3 }, parts: [C(0, 0.3, 0, 6, 0.6, "metal", "Metal"), C(0, 2, 0, 1, 3, "metal", "Metal"), B(0, 3.6, 0, 3, 0.8, 3, "gold", "Neon")] };
K.board = { size: [10, 10, 1], role: "prop", clear: { f: 5 }, parts: [B(-4.2, 2, 0, 0.6, 4, 0.6, "dark", "Metal"), B(4.2, 2, 0, 0.6, 4, 0.6, "dark", "Metal"), B(0, 7, 0, 10, 6, 0.6, "dark", "SmoothPlastic"), B(0, 7, -0.32, 9, 5, 0.1, "accent", "Neon")] };
K.spawn = { size: [8, 0.6, 8], role: "marker", walkable: true, parts: [B(0, 0.3, 0, 8, 0.6, 8, "metal", "Metal"), C(0, 0.45, 0, 5, 0.4, "white", "Neon")] };
K.stall = { size: [9, 8, 6], role: "furniture", clear: { f: 5 }, parts: [B(0, 1.8, -1.6, 9, 3.6, 2.4, "wood", "WoodPlanks"), ...legs(8.6, 5.6, 7, 0.5, "woodDark"), B(0, 7.4, 0, 10, 0.6, 7, "accent", "Fabric"), B(-2, 4, -1.6, 1.6, 1, 1.6, "accent2", "SmoothPlastic"), B(1.8, 4, -1.6, 2, 0.9, 1.4, "gold", "SmoothPlastic")] };

// ---------- sets: a few kinds arranged so they work together. Local coords, front -Z ----------
const SETS = {
  dining4: (o = {}) => { const t = o.table || "table_square", r = K[t].size[0] / 2 + 0.7; return [{ kind: t }, { kind: "chair", lz: r, rot: 0 }, { kind: "chair", lz: -r, rot: 180 }, { kind: "chair", lx: r, rot: 90 }, { kind: "chair", lx: -r, rot: -90 }]; },
  dining2: (o = {}) => { const t = o.table || "table_round", r = K[t].size[2] / 2 + 0.7; return [{ kind: t }, { kind: "chair", lz: r, rot: 0 }, { kind: "chair", lz: -r, rot: 180 }]; },
  dining6: () => [{ kind: "table_long" }, ...[-3, 0, 3].flatMap(x => [{ kind: "chair", lx: x, lz: 2.95, rot: 0 }, { kind: "chair", lx: x, lz: -2.95, rot: 180 }])],
  // back of the set (+Z) goes against a wall; booths pack side by side with no gap
  booth: () => [{ kind: "table_booth" }, { kind: "booth_bench", lx: -2.7, rot: -90 }, { kind: "booth_bench", lx: 2.7, rot: 90 }],
  lounge: (o = {}) => [{ kind: "rug", lz: 1 }, { kind: "coffee_table" }, { kind: "sofa", lz: 4.7, rot: 0 }, { kind: "armchair", lx: -6.3, lz: 0.2, rot: -90 }, ...(o.single ? [] : [{ kind: "armchair", lx: 6.3, lz: 0.2, rot: 90 }])],
  desk_set: () => [{ kind: "desk" }, { kind: "office_chair", lz: 2.3, rot: 0 }],
  desk_pair: () => [{ kind: "desk", lz: 1.5 }, { kind: "office_chair", lz: 3.8, rot: 0 }, { kind: "desk", lz: -1.5, rot: 180 }, { kind: "office_chair", lz: -3.8, rot: 180 }],
  meeting: () => [{ kind: "meeting_table" }, ...[-4, 0, 4].flatMap(x => [{ kind: "office_chair", lx: x, lz: 3.3, rot: 0 }, { kind: "office_chair", lx: x, lz: -3.3, rot: 180 }])],
  bed_set: () => [{ kind: "bed" }, { kind: "nightstand", lx: -4.35, lz: 3.4 }, { kind: "nightstand", lx: 4.35, lz: 3.4 }, { kind: "rug", lz: -4, size: [9, 0.1, 6] }],
  bar_stools: (o = {}) => Array.from({ length: o.count || 4 }, (_, i) => ({ kind: "stool", lx: (i - ((o.count || 4) - 1) / 2) * 3 })),
  camp: () => [{ kind: "campfire" }, { kind: "log", lz: 5.5, rot: 0 }, { kind: "log", lx: 5.2, lz: -1.6, rot: 110 }, { kind: "log", lx: -5.2, lz: -1.6, rot: -110 }, { kind: "tent", lx: -1, lz: -13, rot: 180 }, { kind: "crate", lx: 8, lz: -9, rot: 20 }],
  rocks: () => [{ kind: "rock_big" }, { kind: "rock", lx: 6.5, lz: 2.5, rot: 40 }, { kind: "rock", lx: -3, lz: 6.5, rot: -70, scale: 0.8 }],
  ruins: () => [{ kind: "ruin_wall", lz: -9 }, { kind: "ruin_wall", lx: -10, lz: 0, rot: 90 }, { kind: "pillar", lx: 8, lz: -6 }, { kind: "pillar", lx: 8, lz: 7 }, { kind: "pillar", lx: -6, lz: 9, size: [3, 6, 3] }, { kind: "crate", lx: 0, lz: 0, rot: 15 }],
  park_bench: () => [{ kind: "bench" }, { kind: "planter", lx: -6.2, lz: 0.4 }, { kind: "planter", lx: 6.2, lz: 0.4 }],
};

// ---------- resolving ----------
function kindsOf(layout) { return Object.assign({}, K, layout.kinds || {}); }

function resolve(raw, kinds, pal, i) {
  const k = kinds[raw.kind] || {}, sc = raw.scale || 1;
  const base = k.size || [4, 4, 4];
  const size = raw.size ? raw.size.slice() : base.map(v => v * sc);
  const ratio = k.size ? [size[0] / base[0], size[1] / base[1], size[2] / base[2]] : [1, 1, 1];
  const foot = raw.foot || (k.foot ? [k.foot[0] * ratio[0], k.foot[1] * ratio[2]] : [size[0], size[2]]);
  const pos = raw.pos || [0, 0, 0];
  const parts = raw.parts || k.parts || [{ s: raw.shape || k.shape || "block", p: [0, base[1] / 2, 0], z: base.slice(), c: raw.color || k.color || "stone", m: raw.material || k.material }];
  const rp = [];
  for (const p of parts) {
    const own = !k.size || raw.parts; // inline parts are already at final size
    const f = own ? (raw.parts ? [1, 1, 1] : [size[0] / base[0], size[1] / base[1], size[2] / base[2]]) : ratio;
    let z = [p.z[0] * f[0], p.z[1] * f[1], p.z[2] * f[2]];
    if (p.s === "ball") { const u = Math.min(z[0], z[1], z[2]); z = [u, u, u]; }
    if (p.s === "cylinder") { const u = Math.min(z[0], z[2]); z = [u, z[1], u]; }
    rp.push({ s: p.s, p: [p.p[0] * f[0], p.p[1] * f[1], p.p[2] * f[2]], z, c: hex(raw.color && parts.length === 1 ? raw.color : p.c, pal), m: p.m || raw.material || "SmoothPlastic", r: p.r || 0 });
  }
  const role = raw.role || k.role || "prop";
  return {
    id: raw.id || `${raw.kind || "part"}_${i}`, kind: raw.kind || "part", label: raw.label, x: pos[0], y: pos[1], z: pos[2], rot: raw.rot || 0,
    w: size[0], h: size[1], d: size[2], fw: foot[0], fd: foot[1], scale: sc, role,
    walkable: raw.walkable !== undefined ? raw.walkable : (k.walkable !== undefined ? k.walkable : role === "floor" || role === "decor" || role === "marker"),
    clear: Object.assign({}, k.clear, raw.clear), group: raw.group, zone: raw.zone, tags: raw.tags || [], anchor: raw.anchor || k.anchor, space: k.space,
    color: rp.length ? rp.reduce((m, q) => (q.z[0] * q.z[1] * q.z[2] > m.z[0] * m.z[1] * m.z[2] ? q : m)).c : "#B0B0B0", parts: rp, custom: !!(raw.parts || raw.size || !kinds[raw.kind]),
  };
}

// Items of a set at (x, z) with yaw rot, sharing one group id.
function setItems(name, x, y, z, rot, group, opts) {
  if (!SETS[name]) throw new Error(`unknown set "${name}" (have: ${Object.keys(SETS).join(", ")})`);
  return SETS[name](opts || {}).map(s => {
    const [wx, wz] = G.l2w(x, z, rot, s.lx || 0, s.lz || 0);
    const it = { kind: s.kind, pos: [G.round(wx), y + (s.y || 0), G.round(wz)], rot: ((s.rot || 0) + rot + 360) % 360, group };
    if (s.size) it.size = s.size; if (s.scale) it.scale = s.scale;
    return it;
  });
}
// Solid extents of a set in its own frame: {x0, z0, x1, z1, w, d, cx, cz}.
function setBounds(name, opts) {
  let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
  for (const raw of setItems(name, 0, 0, 0, 0, "b", opts)) {
    const it = resolve(raw, K, palette(), 0); if (it.walkable) continue;
    for (const p of G.footprint(it)) { x0 = Math.min(x0, p[0]); x1 = Math.max(x1, p[0]); z0 = Math.min(z0, p[1]); z1 = Math.max(z1, p[1]); }
  }
  return { x0, z0, x1, z1, w: x1 - x0, d: z1 - z0, cx: (x0 + x1) / 2, cz: (z0 + z1) / 2 };
}

// Walls around a rectangle with door, arch and window openings. Returns raw items.
// openings: [{side: "north|south|east|west" (north = -Z), at: 0..1 or studs from the wall's start, width, kind}]
function wallItems(o) {
  const [x0, z0, x1, z1] = o.rect, H = o.height || 14, T = o.thickness || 1, out = [], sides = o.sides || ["north", "south", "east", "west"];
  const color = o.color || "wall", mat = o.material || "SmoothPlastic";
  if (o.floor !== false) out.push({ kind: "floor", role: "floor", pos: [(x0 + x1) / 2, -1, (z0 + z1) / 2], size: [x1 - x0 + 2 * T, 1, z1 - z0 + 2 * T], color: o.floorColor || "floor", material: o.floorMaterial || "WoodPlanks" });
  for (const side of sides) {
    const horiz = side === "north" || side === "south";
    const a = horiz && !o.flush ? x0 - T : horiz ? x0 : z0, b = horiz && !o.flush ? x1 + T : horiz ? x1 : z1, fixed = side === "north" ? z0 - T / 2 : side === "south" ? z1 + T / 2 : side === "west" ? x0 - T / 2 : x1 + T / 2;
    const ops = (o.openings || []).filter(p => p.side === side).map(p => {
      const L = (horiz ? x1 - x0 : z1 - z0), c = p.abs !== undefined ? p.abs : (horiz ? x0 : z0) + (p.at <= 1 ? p.at * L : p.at);
      const kind = p.kind || "door", w = p.width || (kind === "window" ? 6 : 6);
      return { c, w, kind, sill: kind === "window" ? (p.sill || 3.5) : 0, head: Math.min(H, p.head || (kind === "window" ? 9.5 : kind === "arch" ? 10 : 8.5)) };
    }).sort((p, q) => p.c - q.c);
    const piece = (c0, c1, y0, y1, extra) => {
      if (c1 - c0 < 0.05 || y1 - y0 < 0.05) return;
      const mid = (c0 + c1) / 2, len = c1 - c0;
      out.push(Object.assign({ kind: "wall", role: "wall", pos: horiz ? [mid, y0, fixed] : [fixed, y0, mid], size: horiz ? [len, y1 - y0, T] : [T, y1 - y0, len], color, material: mat }, extra));
    };
    let cur = a;
    for (const p of ops) {
      piece(cur, p.c - p.w / 2, 0, H);
      piece(p.c - p.w / 2, p.c + p.w / 2, p.head, H, { role: "lintel", walkable: true, tags: [p.kind] });
      if (p.kind === "window") {
        piece(p.c - p.w / 2, p.c + p.w / 2, 0, p.sill);
        const mid = p.c, g = { kind: "window", role: "window", color: "glass", material: "Glass" };
        out.push(Object.assign(g, { pos: horiz ? [mid, p.sill, fixed] : [fixed, p.sill, mid], size: horiz ? [p.w, p.head - p.sill, 0.3] : [0.3, p.head - p.sill, p.w] }));
      }
      cur = p.c + p.w / 2;
    }
    piece(cur, b, 0, H);
  }
  if (o.ceiling) out.push({ kind: "ceiling", role: "ceiling", walkable: true, pos: [(x0 + x1) / 2, H, (z0 + z1) / 2], size: [x1 - x0 + 2 * T, 1, z1 - z0 + 2 * T], color: "white" });
  return out;
}

// Expand the authoring macros (set, row, walls, scatter) into plain items.
function expand(layout) {
  const out = []; let g = 0;
  const R = G.rng((layout.seed || 1) * 7919);
  for (const raw of layout.items || []) {
    if (raw.set) {
      const p = raw.pos || [0, 0, 0];
      out.push(...setItems(raw.set, p[0], p[1], p[2], raw.rot || 0, raw.group || `set${++g}`, raw.opts).map(it => Object.assign(it, raw.zone ? { zone: raw.zone } : {})));
    } else if (raw.row) {
      const r = raw.row, [ax, az] = r.from, [bx, bz] = r.to, L = Math.hypot(bx - ax, bz - az);
      const y = r.y || 0, n = r.count || Math.max(1, Math.round(L / (r.spacing || 10)) + (r.ends === false ? 0 : 1));
      for (let i = 0; i < n; i++) {
        const t = r.ends === false ? (i + 0.5) / n : (n === 1 ? 0.5 : i / (n - 1)), x = G.round(G.lerp(ax, bx, t)), z = G.round(G.lerp(az, bz, t));
        if (r.set) out.push(...setItems(r.set, x, y, z, r.rot || 0, `row${++g}`, r.opts));
        else out.push(Object.assign({ kind: r.kind, pos: [x, y, z], rot: r.rot || 0 }, r.group ? { group: r.group } : {}, r.size ? { size: r.size } : {}));
      }
    } else if (raw.walls) {
      out.push(...wallItems(raw.walls));
    } else if (raw.scatter) {
      const s = raw.scatter, kinds = s.kinds || [s.kind], S2 = s.seed ? G.rng(s.seed) : R;
      const rc = s.circle ? [s.circle[0] - s.circle[2], s.circle[1] - s.circle[2], s.circle[0] + s.circle[2], s.circle[1] + s.circle[2]] : s.rect;
      const pts = G.poisson(S2, rc[0], rc[1], rc[2], rc[3], (x, z) => (s.circle && Math.hypot(x - s.circle[0], z - s.circle[1]) > s.circle[2]) ? 0 : (s.avoid || []).some(a => Math.hypot(x - a[0], z - a[1]) < a[2]) ? 0 : (s.spacing || 12), { rMin: s.spacing || 12, max: s.max });
      for (const p of pts) out.push({ kind: S2.pick(kinds), pos: [G.round(p.x), s.y || 0, G.round(p.z)], rot: Math.round(S2.range(0, 360)), scale: G.round(S2.range(0.85, 1.2)) });
    } else out.push(raw);
  }
  return out;
}

// Load a spec: expand macros, resolve every item, work out bounds.
function load(layout) {
  const kinds = kindsOf(layout), pal = palette(layout.palette);
  const raws = expand(layout);
  const seen = new Map();
  const items = raws.map((r, i) => resolve(r, kinds, pal, i));
  for (const it of items) { const n = (seen.get(it.id) || 0) + 1; seen.set(it.id, n); if (n > 1) it.id = `${it.id}_${n}`; }
  let b = layout.bounds && [layout.bounds.min[0], layout.bounds.min[1], layout.bounds.max[0], layout.bounds.max[1]];
  if (!b) {
    b = [Infinity, Infinity, -Infinity, -Infinity];
    for (const it of items) { const pb = G.polyBounds(G.footprint(it)); b[0] = Math.min(b[0], pb[0]); b[1] = Math.min(b[1], pb[1]); b[2] = Math.max(b[2], pb[2]); b[3] = Math.max(b[3], pb[3]); }
    for (const p of layout.paths || []) for (const q of p.points) { b[0] = Math.min(b[0], q[0] - 4); b[1] = Math.min(b[1], q[1] - 4); b[2] = Math.max(b[2], q[0] + 4); b[3] = Math.max(b[3], q[1] + 4); }
    if (!isFinite(b[0])) b = [0, 0, 10, 10];
    const pad = layout.type === "obby" ? 12 : 4; b = [b[0] - pad, b[1] - pad, b[2] + pad, b[3] + pad];
  }
  return { layout, items, raws, bounds: b, pal, kinds };
}

module.exports = { K, SETS, PALETTES, BASE, palette, hex, resolve, setItems, setBounds, wallItems, expand, load, kindsOf, parts: { B, C, S, W } };
