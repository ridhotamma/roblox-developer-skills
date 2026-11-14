// Interiors: a small furnishing engine (walls first, then wall runs, then evenly spread groups,
// then dressing) and the room recipes built on it. Everything placed goes through Scene.fits, so
// nothing lands in a doorway, inside another piece's working space or in a dead gap.
"use strict";
const G = require("./geom.cjs");
const C = require("./catalog.cjs");
const { isSolid } = require("./check.cjs");

const WALLISH = new Set(["wall", "window"]);
const SIDES = ["south", "east", "north", "west"], LOCAL = ["front", "right", "back", "left"];

class Scene {
  constructor(pal) { this.pal = C.palette(pal); this.raws = []; this.res = []; this.keep = []; this.g = 0; this.zones = []; }
  group(p = "g") { return `${p}${++this.g}`; }
  resolve(raw) { const it = C.resolve(raw, C.K, this.pal, 0); it._poly = G.footprint(it); it._clr = G.clearZones(it); return it; }
  covers(it, pt, gap) {
    const [lx, lz] = G.w2l(it.x, it.z, it.rot, pt[0], pt[1]), c = it.clear || {}, ex = Math.abs(lx) - it.fw / 2, ez = Math.abs(lz) - it.fd / 2;
    return ((ez >= ex ? (lz < 0 ? c.f : c.b) : (lx < 0 ? c.l : c.r)) || 0) >= gap - 0.5;
  }
  fits(list, o = {}) {
    const gap = (o.gap === undefined ? 3.6 : o.gap) - 0.02;
    for (const n of list) {
      if (o.inside) for (const p of n._poly) if (p[0] < o.inside[0] - 0.01 || p[0] > o.inside[2] + 0.01 || p[1] < o.inside[1] - 0.01 || p[1] > o.inside[3] + 0.01) return false;
      if (!isSolid(n)) continue;
      if (!o.ignoreKeep) for (const k of this.keep) if (G.polyDist(n._poly, k).depth > 0.05) return false;
      for (const e of this.res) {
        if (!isSolid(e) || (n.group && n.group === e.group)) continue;
        const r = G.polyDist(n._poly, e._poly);
        if (r.depth > 0.05) return false;
        if (r.dist > 0.5 && r.dist < gap && !this.covers(n, r.pa, r.dist) && !this.covers(e, r.pb, r.dist) && !(WALLISH.has(e.role) && G.pastWallEnd(e, r.pa, r.pb))) {
          const mid = [(r.pa[0] + r.pb[0]) / 2, (r.pa[1] + r.pb[1]) / 2]; // something of the same group already fills the gap
          if (!list.some(m => m !== n && isSolid(m) && G.pointInPoly(mid, m._poly))) return false;
        }
        if (r.dist <= 0.5 && !o.touch && !WALLISH.has(e.role)) return false;
        if (WALLISH.has(e.role) && WALLISH.has(n.role)) continue;
        for (const cz of n._clr) if (G.polyDist(cz.poly, e._poly).depth > 0.2) return false;
        for (const cz of e._clr) if (G.polyDist(cz.poly, n._poly).depth > 0.2) return false;
      }
    }
    return true;
  }
  add(raws) { for (const r of raws) { this.raws.push(r); this.res.push(this.resolve(r)); } }
  tryAdd(raws, o) { const res = raws.map(r => this.resolve(r)); if (!this.fits(res, o)) return false; raws.forEach((r, i) => { this.raws.push(r); this.res.push(res[i]); }); return true; }
}

class Room {
  // rect: world [x0, z0, x1, z1]; front: the world side the room is entered from
  constructor(scene, rect, front = "south", name = "room") {
    this.s = scene; this.rect = rect; this.q = SIDES.indexOf(front); this.name = name;
    const wx = rect[2] - rect[0], wz = rect[3] - rect[1];
    this.W = this.q % 2 ? wz : wx; this.D = this.q % 2 ? wx : wz;
    this.cx = (rect[0] + rect[2]) / 2; this.cz = (rect[1] + rect[3]) / 2; this.open = [];
  }
  w(lx, lz) { return G.l2w(this.cx, this.cz, this.q * 90, lx - this.W / 2, lz - this.D / 2).map(v => G.round(v)); }
  rot(r) { return ((r + this.q * 90) % 360 + 360) % 360; }
  rectW(x0, z0, x1, z1) { const a = this.w(x0, z0), b = this.w(x1, z1); return [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[0], b[0]), Math.max(a[1], b[1])]; }
  keep(x0, z0, x1, z1) { const r = this.rectW(x0, z0, x1, z1); this.s.keep.push(G.rectPoly(r[0], r[1], r[2], r[3])); }
  zone(id, label, x0, z0, x1, z1, extra) { this.s.zones.push(Object.assign({ id: `${this.name}_${id}`, label, rect: this.rectW(x0, z0, x1, z1) }, extra)); }
  // an opening given in world terms: side + absolute coordinate along that wall
  opening(side, abs, width, depth = 5) {
    const ls = LOCAL[(SIDES.indexOf(side) - this.q + 4) % 4];
    const wp = side === "south" ? [abs, this.rect[3]] : side === "north" ? [abs, this.rect[1]] : side === "east" ? [this.rect[2], abs] : [this.rect[0], abs];
    const [u, v] = G.w2l(this.cx, this.cz, this.q * 90, wp[0], wp[1]), lx = u + this.W / 2, lz = v + this.D / 2;
    const c = ls === "front" || ls === "back" ? lx : lz, h = width / 2 + 0.5;
    this.open.push({ side: ls, c, w: width });
    if (ls === "front") this.keep(c - h, this.D - depth, c + h, this.D); else if (ls === "back") this.keep(c - h, 0, c + h, depth);
    else if (ls === "left") this.keep(0, c - h, depth, c + h); else this.keep(this.W - depth, c - h, this.W, c + h);
    return c;
  }
  raw(kind, lx, lz, lrot = 0, extra) { const p = this.w(lx, lz); return Object.assign({ kind, pos: [p[0], (extra && extra.y) || 0, p[1]], rot: this.rot(lrot) }, extra, { y: undefined }); }
  put(kind, lx, lz, lrot, o = {}) { return this.s.tryAdd([this.raw(kind, lx, lz, lrot, Object.assign({ group: o.group, zone: this.name }, o.extra))], Object.assign({ inside: this.rect }, o)); }
  setRaws(name, lx, lz, lrot, group, opts) { const p = this.w(lx, lz); return C.setItems(name, p[0], 0, p[1], this.rot(lrot), group || this.s.group(name), opts).map(r => Object.assign(r, { zone: this.name })); }
  putSet(name, lx, lz, lrot = 0, o = {}) { return this.s.tryAdd(this.setRaws(name, lx, lz, lrot, o.group, o.opts), Object.assign({ inside: this.rect }, o)); }

  // Things with their backs to a wall. things: kind names or {set, opts, flip}. Returns local centres.
  wallRun(side, things, o = {}) {
    const L = side === "back" || side === "front" ? this.W : this.D;
    let a = (o.from || 0) * L + (o.pad || 0), b = (o.to === undefined ? 1 : o.to) * L - (o.pad || 0);
    const segs = []; let cur = a;
    for (const op of this.open.filter(p => p.side === side).sort((p, q) => p.c - q.c)) { const lo = op.c - op.w / 2 - 1, hi = op.c + op.w / 2 + 1; if (lo > cur) segs.push([cur, Math.min(lo, b)]); cur = Math.max(cur, hi); }
    if (b > cur) segs.push([cur, b]);
    if (!segs.length) return [];
    const seg = segs.sort((p, q) => (q[1] - q[0]) - (p[1] - p[0]))[o.seg || 0]; if (!seg) return [];
    const dim = t => {
      if (typeof t === "string") { const k = C.K[t]; return { w: k.size[0], back: k.size[2] / 2, kind: t }; }
      const sb = C.setBounds(t.set, t.opts); return { w: sb.w, back: t.flip ? -sb.z0 : sb.z1, set: t.set, opts: t.opts, flip: t.flip, off: t.flip ? -sb.cx : sb.cx };
    };
    let list = things.map(dim);
    const len = seg[1] - seg[0], gap = o.gap || 0;
    if (o.fill) { const n = Math.min(o.max || 99, Math.floor((len + gap) / (list[0].w + gap))); list = Array.from({ length: n }, (_, i) => list[i % list.length]); }
    // a run must end flush in a corner or leave a walkable gap to it, never a sliver
    const dead = v => v > 0.5 && v < 3.9;
    let centres = null;
    while (list.length) {
      centres = G.distribute(len, list.map(t => t.w), o.minGap || 4, o.mode || "center");
      if (centres) {
        const lo = seg[0] + centres[0] - list[0].w / 2, hi = seg[0] + centres[list.length - 1] + list[list.length - 1].w / 2;
        if (!dead(lo) && !dead(L - hi)) break;
        const block = hi - lo, starts = [seg[0], seg[1] - block, 4, L - 4 - block].filter(s0 => s0 >= seg[0] - 1e-6 && s0 + block <= seg[1] + 1e-6 && !dead(s0) && !dead(L - s0 - block));
        if (starts.length && (o.mode || "center") !== "even") { const want = lo, s0 = starts.sort((p, q) => Math.abs(p - want) - Math.abs(q - want))[0]; centres = centres.map(c => c + (s0 - lo)); break; }
        centres = null;
      }
      list.pop();
    }
    if (!centres) return [];
    const group = o.group || this.s.group("run"), placed = [], inset = o.inset || 0;
    list.forEach((t, i) => {
      const c = seg[0] + centres[i], off = t.back + inset;
      const [lx, lz, r] = side === "back" ? [c, off, 180] : side === "front" ? [c, this.D - off, 0] : side === "left" ? [off, c, 270] : [this.W - off, c, 90];
      const rr = r + (t.flip ? 180 : 0);
      const raws = t.set ? this.setRaws(t.set, lx, lz, rr, group, t.opts) : [this.raw(t.kind, lx, lz, rr, Object.assign({ group, zone: this.name }, o.extra))];
      if (this.s.tryAdd(raws, { touch: true, gap: o.clearGap === undefined ? 4 : o.clearGap, inside: o.loose ? undefined : this.rect, ignoreKeep: o.ignoreKeep })) placed.push({ lx, lz, c });
    });
    return placed;
  }

  // Spread a set over a rectangle in even rows and columns. edges: wanted gap to the rectangle's
  // [left, right, back, front] edge (0 when that edge is already an aisle).
  grid(x0, z0, x1, z1, setName, o = {}) {
    const turned = (o.rot || 0) % 180 !== 0, sb = C.setBounds(setName, o.opts), sw = turned ? sb.d : sb.w, sd = turned ? sb.w : sb.d;
    const aisle = o.aisle || 4.5, e = o.edges || [aisle, aisle, aisle, aisle], cap = aisle * (o.cap || 1.7);
    const axis = (len, s, e0, e1, maxN) => {
      let n = Math.max(0, Math.floor((len - e0 - e1 + aisle) / (s + aisle))); if (maxN) n = Math.min(n, maxN);
      if (!n) return [];
      const free = len - n * s - (n - 1) * aisle - e0 - e1, slots = (n - 1) + (e0 > 0 ? 1 : 0) + (e1 > 0 ? 1 : 0);
      const add = slots ? free / slots : 0, g = Math.min(aisle + add, cap), block = n * s + (n - 1) * g, left = len - block;
      const lead = e0 > 0 && e1 > 0 ? left / 2 : e0 > 0 ? Math.max(e0, left - e1) : e1 > 0 ? Math.min(left - e1, 0) : left / 2;
      return Array.from({ length: n }, (_, i) => Math.max(0, lead) + s / 2 + i * (s + g));
    };
    const xs = axis(x1 - x0, sw, e[0], e[1], o.maxX), zs = axis(z1 - z0, sd, e[2], e[3], o.maxZ), placed = [];
    const off = G.l2w(0, 0, o.rot || 0, sb.cx, sb.cz);
    xs.forEach((x, i) => zs.forEach((z, j) => {
      const name = o.pattern ? o.pattern(i, j, xs.length, zs.length) : setName; if (!name) return;
      const lx = x0 + x - off[0], lz = z0 + z - off[1];
      if (this.putSet(name, lx, lz, o.rot || 0, { opts: o.opts, gap: o.gap })) placed.push({ lx: x0 + x, lz: z0 + z });
    }));
    return placed;
  }
  corners(kind, which = ["bl", "br", "fl", "fr"], o = {}) {
    const k = C.K[kind], hw = k.size[0] / 2 + 0.3, hd = k.size[2] / 2 + 0.3; let n = 0;
    for (const c of which) { const lx = c[1] === "l" ? hw : this.W - hw, lz = c[0] === "b" ? hd : this.D - hd; if (this.put(kind, lx, lz, 0, Object.assign({ touch: true, gap: 3.5 }, o))) n++; }
    return n;
  }
  // flat things on a wall (art), evenly spaced; never blocks anything
  wallDecor(side, kind, count, y = 6.5) {
    const L = side === "back" || side === "front" ? this.W : this.D;
    for (let i = 0; i < count; i++) { const c = L * (i + 1) / (count + 1); if (this.open.some(p => p.side === side && Math.abs(p.c - c) < p.w / 2 + 3)) continue;
      const [lx, lz, r] = side === "back" ? [c, 0.15, 180] : side === "front" ? [c, this.D - 0.15, 0] : side === "left" ? [0.15, c, 270] : [this.W - 0.15, c, 90];
      this.s.add([this.raw(kind, lx, lz, r, { y, zone: this.name })]); }
  }
  lights(points, y) { for (const p of points) this.s.add([this.raw("pendant", p.lx, p.lz, 0, { y, zone: this.name })]); }
}

// ---------------- recipes: each furnishes a Room whose openings are already registered ----------------
const RECIPES = {
  restaurant(rm, o) {
    const { W, D } = rm, mid = W / 2, cafe = o.variant === "cafe";
    rm.wallRun("back", ["fridge", "counter_unit", "stove", "counter_unit", "sink_counter", "counter_unit"], { fill: true, from: 0.1, to: 0.9 });
    const n = Math.max(1, Math.min(4, Math.floor((W - 26) / 10))), cz = 9;
    for (let i = 0; i < n; i++) rm.put("counter", mid + (i - (n - 1) / 2) * 10, cz, 180, { group: "counter", touch: true });
    rm.s.add(C.setItems("bar_stools", ...((p => [p[0], 0, p[1]])(rm.w(mid, cz + 3.2))), rm.rot(0), "counter", { count: n * 3 }).map(r => Object.assign(r, { zone: rm.name })));
    const top = cz + 1.5 + 5.5, bot = D - 7;
    rm.keep(mid - 3, top - 1, mid + 3, D); // the main aisle: door to counter
    rm.zone("kitchen", "Kitchen", 0, 0, W, cz - 1.5); rm.zone("dining", "Dining", 0, top, W, bot, { main: true }); rm.zone("entry", "Entry", mid - 8, bot, mid + 8, D, { open: true });
    let left = 0, right = W; const lights = [];
    if (cafe) {
      if (rm.putSet("lounge", 6.5, D - 12, 270, { opts: { single: true }, touch: true })) { const p = G.l2w(6.5, D - 12, 270, 4.9, 5.6); rm.put("floor_lamp", p[0], p[1], 0, { touch: true, gap: 0 }); }
      if (rm.putSet("dining2", 16.5, D - 11, 0, {})) lights.push({ lx: 16.5, lz: D - 11 });
      lights.push(...rm.grid(0, top, mid, D - 22, "dining4", { edges: [2, 3, 0, 0], maxZ: 1 }), ...rm.grid(mid, top, W, bot, "dining2", { edges: [3, 2, 0, 0] }));
    } else {
      if (W >= 44) { rm.wallRun("left", [{ set: "booth" }], { fill: true, from: top / D, to: bot / D }); left = 5.5; }
      if (W >= 56) { rm.wallRun("right", [{ set: "booth" }], { fill: true, from: top / D, to: bot / D }); right = W - 5.5; }
      const pat = (i, j) => ((i + j) % 3 === 2 ? "dining2" : "dining4");
      lights.push(...rm.grid(left, top, mid, bot, "dining4", { edges: [left ? 4.5 : 2, 3, 0, 0], pattern: pat }), ...rm.grid(mid, top, right, bot, "dining4", { edges: [3, right < W ? 4.5 : 2, 0, 0], pattern: pat }));
    }
    rm.put("host_stand", mid + 7.5, D - 4.5, 180, {});
    rm.corners("plant", ["fl", "fr", "bl", "br"]);
    rm.wallDecor("left", "wall_art", 3, 8.6); rm.wallDecor("right", "wall_art", 3, 8.6);
    rm.lights(lights, o.height - 4.2);
    rm.s.add([rm.raw("mat", mid, D - 1.8, 0)]);
  },
  shop(rm, o) {
    const { W, D } = rm, mid = W / 2;
    rm.wallRun("back", ["shelf"], { fill: true });
    rm.put("counter", mid, 8, 180, { group: "counter" });
    rm.wallRun("left", ["shelf"], { fill: true, from: 13 / D, to: (D - 5) / D });
    rm.wallRun("right", ["shelf"], { fill: true, from: 13 / D, to: (D - 5) / D });
    const top = 15, bot = D - 15;
    rm.keep(mid - 3.5, top, mid + 3.5, bot + 1);
    rm.zone("checkout", "Checkout", mid - 12, 0, mid + 12, 13); rm.zone("floor", "Shop floor", 0, top, W, bot); rm.zone("entry", "Entry", mid - 9, D - 7, mid + 9, D, { open: true });
    const lights = [];
    lights.push(...rm.grid(6, top, mid, bot, "gondola1", { rot: 90, aisle: 5, edges: [5, 3.5, 0, 0] }));
    lights.push(...rm.grid(mid, top, W - 6, bot, "gondola1", { rot: 90, aisle: 5, edges: [3.5, 5, 0, 0] }));
    rm.put("pedestal", mid, D - 10.5, 0, {});
    rm.put("display_table", W * 0.22, D - 8, 0, {}); rm.put("display_table", W * 0.78, D - 8, 0, {});
    rm.corners("plant", ["fl", "fr", "bl", "br"]);
    rm.lights(lights, o.height - 4.2);
    rm.s.add([rm.raw("mat", mid, D - 1.8, 0)]);
  },
  living(rm, o) {
    const { W, D } = rm;
    const tv = rm.wallRun("back", ["tv_stand"], { mode: "center" }), cx = tv.length ? tv[0].c : W / 2, single = W < 30;
    rm.zone("lounge", "Lounge", cx - 9, 0, cx + 9, 15, { main: true });
    if (!single && rm.putSet("lounge", cx, 7.6, 0, {})) { /* full set */ } else if (rm.putSet("lounge", cx, 7.6, 0, { opts: { single: true } }) || rm.putSet("lounge", cx, 8.6, 0, { opts: { single: true } })) rm.put("floor_lamp", cx + 4.9, 13.2, 0, { touch: true, gap: 0 });
    const side = cx > W / 2 ? "left" : "right", other = side === "left" ? "right" : "left";
    rm.wallRun(side, ["bookshelf", "bookshelf"], { from: 0.08, to: 0.55, mode: "center" });
    if (D >= 28 && W >= 30) { const x = side === "left" ? W * 0.72 : W * 0.28; if (rm.putSet("dining4", x, D - 8.6, 0, {})) rm.lights([{ lx: x, lz: D - 8.6 }], o.height - 4.2); }
    if (D >= 26) rm.wallRun(side, [{ set: "desk_set", flip: true }], { from: 0.62, to: 0.97, mode: "center" });
    else if (W >= 30) { const x = side === "left" ? W * 0.76 : W * 0.24; if (rm.putSet("dining2", x, D - 6.5, 90, {})) rm.lights([{ lx: x, lz: D - 6.5 }], o.height - 4.2); }
    rm.corners("plant", ["bl", "br", "fl", "fr"]);
    rm.wallDecor(other, "wall_art", 2, 6.5);
  },
  bedroom(rm) {
    const { W, D } = rm;
    rm.wallRun("back", [{ set: "bed_set" }], { mode: "center" });
    rm.zone("sleep", "Bed", W / 2 - 7, 0, W / 2 + 7, 13, { main: true });
    rm.wallRun("left", ["wardrobe"], { from: 0.45, to: 0.95, mode: "center" });
    rm.wallRun("right", [{ set: "desk_set", flip: true }], { from: 0.45, to: 0.95, mode: "center" });
    rm.corners("plant", ["bl", "br", "fr"]);
    rm.wallDecor("back", "wall_art", 1, 8);
  },
  office(rm, o) {
    const { W, D } = rm, split = W >= 46 ? W * 0.64 : W;
    rm.wallRun("back", ["bookshelf", "bookshelf", "bookshelf"], { from: 0.04, to: split / W - 0.04, mode: "even" });
    rm.zone("desks", "Desks", 0, 6, split, D - 6, { main: true });
    const lights = rm.grid(0, 6.5, split, D - 6, "desk_pair", { aisle: 5, edges: [5, 5, 0, 0] });
    if (split < W) { const x = (split + W) / 2; rm.zone("meeting", "Meeting", split, 4, W, D - 4); if (rm.putSet("meeting", x, D / 2, 90, {})) { lights.push({ lx: x, lz: D / 2 }); rm.s.add([rm.raw("rug", x, D / 2, 90, { size: [16, 0.1, 12] })]); } }
    rm.corners("plant", ["bl", "br", "fl", "fr"]);
    rm.lights(lights, o.height - 4.2);
  },
  kitchen(rm, o) {
    const { W, D } = rm;
    const all = ["fridge", "counter_unit", "stove", "counter_unit", "sink_counter", "counter_unit"];
    rm.wallRun("back", all.slice(0, Math.max(3, Math.min(all.length, Math.floor((W - 1) / 4)))), { mode: "center" });
    rm.zone("cook", "Kitchen", 0, 0, W, D, { main: true });
    if (W >= 16 && D >= 17) rm.put("kitchen_island", W / 2, 9.5, 0, {});
    if (D >= 26) { if (rm.putSet("dining2", W / 2, D - 7, 90, {})) rm.lights([{ lx: W / 2, lz: D - 7 }], o.height - 4.2); }
    rm.corners("plant", ["fl", "fr"]);
  },
  bath(rm) {
    const { W, D } = rm;
    rm.zone("bath", "Bath", 0, 0, W, D, { main: true });
    rm.wallRun("back", ["bathtub"], { mode: "center" });
    rm.wallRun("left", ["toilet"], { from: 0.45, to: 0.95, mode: "center" });
    rm.wallRun("right", ["bath_sink"], { from: 0.45, to: 0.95, mode: "center" });
  },
};
// a one-sided gondola set so the grid can size and place it like any other set
C.SETS.gondola1 = () => [{ kind: "gondola" }];

const SIZES = { restaurant: [68, 50], cafe: [46, 48], shop: [52, 56], living: [34, 30], bedroom: [28, 24], office: [60, 40], kitchen: [22, 20], bath: [14, 16] };
const PAL = { restaurant: "cozy", cafe: "pastel", shop: "modern", living: "cozy", bedroom: "pastel", office: "modern", kitchen: "modern", bath: "modern", house: "cozy" };

function windowsFor(W, D, door) {
  const out = [];
  for (const side of ["east", "west"]) { const n = Math.max(1, Math.round(D / 16)); for (let i = 0; i < n; i++) out.push({ side, at: (i + 1) / (n + 1), width: 6, kind: "window" }); }
  for (const t of [0.2, 0.8]) if (Math.abs(t * W - door) > 8) out.push({ side: "south", at: t, width: 7, kind: "window" });
  return out;
}

function room(o = {}) {
  const theme = o.theme || "restaurant", recipe = theme === "cafe" ? "restaurant" : theme;
  if (!RECIPES[recipe]) throw new Error(`unknown room theme "${theme}" (have: ${Object.keys(SIZES).join(", ")})`);
  const [dw, dd] = SIZES[theme], W = o.width || dw, D = o.depth || dd, H = o.height || 14, pal = o.palette || PAL[theme];
  const s = new Scene(pal), door = W / 2;
  const openings = [{ side: "south", at: 0.5, width: 7, kind: "door" }, ...windowsFor(W, D, door)];
  s.add(C.wallItems({ rect: [0, 0, W, D], height: H, openings, ceiling: !!o.ceiling }));
  const rm = new Room(s, [0, 0, W, D], "south", theme);
  rm.opening("south", door, 7, 5.5);
  RECIPES[recipe](rm, { height: H, variant: theme === "cafe" ? "cafe" : undefined });
  return { name: o.name || theme[0].toUpperCase() + theme.slice(1), type: "interior", seed: o.seed || 1, palette: pal, spawn: [door, 0, D - 3], focus: [door, 4, 6],
    bounds: { min: [-2, -2], max: [W + 2, D + 2] }, zones: s.zones, items: s.raws.map(clean) };
}

// A small house: living room and kitchen at the front, bedroom and bath behind.
function house(o = {}) {
  const W = o.width || 56, D = o.depth || 46, H = o.height || 14, pal = o.palette || PAL.house, s = new Scene(pal);
  const zs = Math.round(D * 0.54), xs = Math.round(W * 0.62), xb = Math.round(W * 0.68);
  const doorX = Math.round(xs * 0.5), bedDoor = 6, bathDoor = Math.round((xb + W) / 2), archZ = Math.round((zs + D) / 2);
  const win = (side, abs, width = 6) => ({ side, abs, width, kind: "window" });
  s.add(C.wallItems({ rect: [0, 0, W, D], height: H, ceiling: !!o.ceiling, openings: [{ side: "south", abs: doorX, width: 7, kind: "door" }, win("south", (xs + W) / 2, 8), win("west", zs / 2), win("west", (zs + D) / 2 + 3), win("east", zs / 2, 4), win("east", (zs + D) / 2), win("north", xb / 2 - 9), win("north", xb / 2 + 9)] }));
  s.add(C.wallItems({ rect: [0, 0, W, zs - 0.5], sides: ["south"], flush: true, floor: false, height: H, openings: [{ side: "south", abs: bedDoor, width: 6 }, { side: "south", abs: bathDoor, width: 6 }] }));
  s.add(C.wallItems({ rect: [0, zs + 0.5, xs - 0.5, D], sides: ["east"], flush: true, floor: false, height: H, openings: [{ side: "east", abs: archZ, width: 9, kind: "arch" }] }));
  s.add(C.wallItems({ rect: [0, 0, xb - 0.5, zs - 0.5], sides: ["east"], flush: true, floor: false, height: H }));
  const living = new Room(s, [0, zs + 0.5, xs - 0.5, D], "south", "living");
  living.opening("south", doorX, 7, 5.5); living.opening("north", bedDoor, 6); living.opening("east", archZ, 9);
  const kitchen = new Room(s, [xs + 0.5, zs + 0.5, W, D], "west", "kitchen");
  kitchen.opening("west", archZ, 9); kitchen.opening("north", bathDoor, 6);
  const bed = new Room(s, [0, 0, xb - 0.5, zs - 0.5], "south", "bedroom"); bed.opening("south", bedDoor, 6);
  const bath = new Room(s, [xb + 0.5, 0, W, zs - 0.5], "south", "bath"); bath.opening("south", bathDoor, 6);
  RECIPES.living(living, { height: H }); RECIPES.kitchen(kitchen, { height: H }); RECIPES.bedroom(bed, { height: H }); RECIPES.bath(bath, { height: H });
  s.add([{ kind: "mat", pos: [doorX, 0, D - 1.8] }]);
  return { name: o.name || "House", type: "building", seed: o.seed || 1, palette: pal, spawn: [doorX, 0, D - 3], focus: [doorX, 4, zs + 6],
    bounds: { min: [-2, -2], max: [W + 2, D + 2] }, zones: s.zones, items: s.raws.map(clean) };
}
function clean(r) { const o = {}; for (const k in r) if (r[k] !== undefined && !(k === "rot" && !r[k])) o[k] = r[k]; return o; }

module.exports = { room, house, Scene, Room, RECIPES, SIZES, clean };
