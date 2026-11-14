// Obby courses, tycoon lots, city blocks and procedural wilderness maps.
"use strict";
const G = require("./geom.cjs");
const C = require("./catalog.cjs");
const { B, W } = C.parts;
const norm = r => ((Math.round(r) % 360) + 360) % 360;

// ------------------------------------------------------------------ obby
// One knob per stage, a checkpoint between stages, gaps computed from the jump the avatar can
// actually make. difficulty 0 = a comfortable hop, 1 = the hardest fair jump.
const OBBY_PATTERNS = {
  hops:   (j, t, R) => ({ w: G.lerp(9, 5, t), d: G.lerp(9, 5, t), dy: 0, turn: R.range(-14, 14) }),
  stairs: (j, t) => ({ w: G.lerp(8, 5, t), d: G.lerp(7, 4.5, t), dy: G.lerp(2, 5, t), turn: 16 }),
  stones: (j, t, R) => ({ w: G.lerp(6.5, 3.6, t), d: G.lerp(6.5, 3.6, t), dy: R.pick([0, 0, 1, -1]), turn: (j % 2 ? 1 : -1) * 28, shape: "cylinder" }),
  beams:  (j, t) => ({ w: G.lerp(4, 2, t), d: 14, dy: 0, turn: (j % 2 ? 1 : -1) * 32 }),
  drops:  (j, t, R) => ({ w: 7, d: 7, dy: -G.lerp(2, 5, t), turn: R.range(-10, 10) }),
  lava:   (j, t) => ({ w: 10, d: 13, dy: 0, turn: 0, hazard: true }),
};
function obby(o = {}) {
  const R = G.rng(o.seed || 1), m = Object.assign({ walkSpeed: 16, jumpHeight: 7.2, gravity: 196.2 }, o.metrics);
  const stages = o.stages || 6, per = o.jumps || 7, d0 = o.easy === undefined ? 0.15 : o.easy, d1 = o.hard === undefined ? 0.85 : o.hard;
  const items = [], route = [], zones = [], placed = [];
  let x = 0, y = 24, z = 0, head = 0, n = 0, prev = null, turnSign = R.sign(), last = "";
  const fwd = h => [-Math.sin(G.rad(h)), -Math.cos(G.rad(h))];
  const poly = p => G.footprint({ x: p.x, z: p.z, rot: p.rot, fw: p.w, fd: p.d });
  const place = (spec, gap, color, zone, extra) => {
    // step forward until the edge-to-edge gap is what was asked for
    let best = null;
    for (const tryTurn of [spec.turn, -spec.turn, spec.turn * 2, -spec.turn * 2, 0]) {
      const h = head + tryTurn, f = fwd(h); let dist = prev ? prev.d / 2 + gap + spec.d / 2 : 0, p;
      for (let it = 0; it < 6; it++) {
        p = { x: x + f[0] * dist, z: z + f[1] * dist, rot: norm(h), w: spec.w, d: spec.d, y: y + spec.dy };
        if (!prev) break;
        const got = G.polyDist(poly(prev), poly(p)).dist; if (Math.abs(got - gap) < 0.05) break; dist += gap - got;
      }
      const clash = placed.slice(0, -2).some(q => Math.abs(q.y - p.y) < 16 && G.polyDist(poly(q), poly(p)).dist < 9);
      if (!clash || !best) best = { p, h };
      if (!clash) break;
    }
    const { p, h } = best; head = h; x = p.x; z = p.z; y = p.y;
    const id = `p${++n}`;
    items.push(Object.assign({ id, kind: "platform", role: "platform", shape: spec.shape, pos: [G.round(x), G.round(y - 1.6), G.round(z)], size: [G.round(spec.w), 1.6, G.round(spec.d)], rot: p.rot, color, material: "SmoothPlastic", zone }, extra));
    route.push(id); placed.push(p); prev = p; return p;
  };
  const gapFor = (dy, t, k = 1, land = 9) => { const b = G.jumpBand(dy, m), pen = land < 4 ? (4 - land) * 0.12 : 0; return G.clamp(G.lerp(b.lo, b.hi, G.clamp(t - pen, 0, 1)) * k, 2, b.reach - 1); };
  const start = place({ w: 18, d: 18, dy: 0, turn: 0 }, 0, "#F2F2F2", "Start", { tags: ["checkpoint"] });
  items.push({ kind: "spawn", pos: [start.x, y, start.z] });
  const names = Object.keys(OBBY_PATTERNS);
  for (let s = 0; s < stages; s++) {
    const t = stages > 1 ? G.lerp(d0, d1, s / (stages - 1)) : d0, zone = `S${s + 1}`;
    let name; do { name = s === 0 ? "hops" : R.pick(names); } while (name === last || (name === "drops" && y < 14) || (name === "stairs" && y > 70)); last = name;
    const color = G.hsl(205 + s * (300 / Math.max(1, stages)), 72, 62), dark = G.hsl(205 + s * (300 / Math.max(1, stages)), 60, 46);
    for (let j = 0; j < per; j++) {
      const sp = OBBY_PATTERNS[name](j, t, R); sp.w = G.round(sp.w, 2); sp.d = G.round(sp.d, 2); sp.dy = G.round(sp.dy, 2);
      const p = place(sp, gapFor(sp.dy, t, sp.k, Math.min(sp.w, sp.d)), j % 2 ? color : dark, zone);
      if (sp.hazard) { const f = fwd(p.rot); items.push({ kind: "hazard", role: "hazard", walkable: true, pos: [G.round(p.x), y, G.round(p.z)], size: [sp.w, G.round(G.lerp(1, 2.6, t), 10), G.round(G.lerp(1.5, 3.5, t), 10)], rot: p.rot, color: "hazard", material: "Neon", zone }); void f; }
    }
    // rest platform: a checkpoint, a turn, a breath
    turnSign = -turnSign;
    const fin = s === stages - 1, cp = place({ w: fin ? 20 : 14, d: fin ? 20 : 14, dy: 0, turn: turnSign * R.range(35, 70) }, gapFor(0, Math.min(t, 0.4)), fin ? "#FFE08A" : "#F2F2F2", fin ? "Finish" : `S${s + 2}`, { tags: ["checkpoint"] });
    items.push({ kind: fin ? "finish" : "checkpoint", pos: [G.round(cp.x), y, G.round(cp.z)], rot: cp.rot });
    zones.push({ id: zone, label: `Stage ${s + 1}: ${name}`, circle: [G.round(cp.x), G.round(cp.z), 8], y });
  }
  return { name: o.name || "Obby", type: "obby", seed: o.seed || 1, metrics: m, palette: "pastel", spawn: [start.x, start.y, start.z], focus: [items[2].pos[0], 24, items[2].pos[2]], zones, route, items };
}

// ------------------------------------------------------------------ tycoon
function tycoon(o = {}) {
  const n = Math.max(2, o.plots || 6), perSide = Math.ceil(n / 2), PW = o.plotWidth || 80, PD = o.plotDepth || 96, gap = 20, street = 36;
  const Lx = perSide * PW + (perSide - 1) * gap, items = [], zones = [];
  const X0 = -Lx / 2 - 30, X1 = -X0, Z1 = street / 2 + PD + 12;
  items.push({ kind: "ground", role: "floor", pos: [0, -1, 0], size: [X1 - X0, 1, 2 * Z1], color: "grass", material: "Grass" });
  items.push({ kind: "street", role: "decor", pos: [0, 0, 0], size: [X1 - X0, 0.2, street], color: "sidewalk", material: "Concrete" });
  // hub: the first thing a new player sees, between the rows
  items.push({ kind: "spawn", pos: [0, 0.2, 0] }, { kind: "board", pos: [-Lx / 2 - 14, 0.2, 0], rot: 270, label: "Leaderboard" }, { kind: "board", pos: [Lx / 2 + 14, 0.2, 0], rot: 90, label: "Top donors" });
  items.push({ kind: "stall", pos: [-22, 0.2, 0], rot: 90, label: "Shop" }, { kind: "stall", pos: [22, 0.2, 0], rot: 270, label: "Rebirth" });
  zones.push({ id: "hub", label: "Hub", rect: [-34, -street / 2, 34, street / 2], open: true, main: true });
  for (let i = 0; i < n; i++) {
    const side = i % 2 ? 1 : -1, col = Math.floor(i / 2), cx = -Lx / 2 + PW / 2 + col * (PW + gap), cz = side * (street / 2 + PD / 2), rot = side < 0 ? 0 : 180;
    const hue = (i * 360 / n + 10) % 360, team = G.hsl(hue, 70, 58), teamDark = G.hsl(hue, 55, 40), g = `plot${i + 1}`;
    // plot-local: +z is the street side (front), x across
    const P = (lx, lz) => G.l2w(cx, cz, rot, lx, lz).map(v => G.round(v)), put = (kind, lx, lz, r, extra) => { const p = P(lx, lz); items.push(Object.assign({ kind, pos: [p[0], 0.6, p[1]], rot: norm(r + rot), zone: g }, extra)); };
    items.push({ kind: "plot", role: "floor", pos: [cx, 0, cz], size: [PW, 0.6, PD], color: "#D9D6CE", material: "Concrete", zone: g });
    items.push({ kind: "trim", role: "decor", pos: [cx, 0.05, cz], size: [PW + 2, 0.6, PD + 2], color: team, material: "SmoothPlastic", zone: g });
    const fence = (ax, az, bx, bz, r) => { const len = Math.hypot(bx - ax, bz - az), k = Math.round(len / 8); for (let j = 0; j < k; j++) put("fence", G.lerp(ax, bx, (j + 0.5) / k), G.lerp(az, bz, (j + 0.5) / k), r, { group: g + "fence", size: [len / k, 3.6, 0.6] }); };
    const hw = PW / 2, hd = PD / 2, gate = 16;
    fence(-hw, -hd, hw, -hd, 0); fence(-hw, -hd, -hw, hd, 90); fence(hw, -hd, hw, hd, 90); fence(-hw, hd, -gate / 2, hd, 0); fence(gate / 2, hd, hw, hd, 0);
    put("claim_gate", 0, hd, 180, { size: [gate, 10, 2], label: `Plot ${i + 1}` });
    // production line down the left side, buttons lined up with what they buy
    const bx = -hw + 16, z0 = -hd + 14, segs = 5;
    for (let j = 0; j < segs; j++) put("conveyor", bx, z0 + j * 10, 0, { group: g + "line" });
    for (let j = 0; j < 4; j++) { put("dropper", bx - 5, z0 + j * 10, 270, { group: g + "line", color: teamDark }); put("button", bx + 8.5, z0 + j * 10, 0, { label: `Dropper ${j + 1}` }); }
    put("upgrader", bx, z0 + 35, 0, { group: g + "line" }); put("upgrader", bx, z0 + 44, 0, { group: g + "line" });
    put("collector", bx, z0 + segs * 10 - 5 + 3, 180, { group: g + "line" });
    put("cash_pad", 14, hd - 14, 0, { label: "Collect cash" });
    for (let j = 0; j < 4; j++) put("button", 16 + j * 10 - 5, -hd + 12, 0, { label: ["Walls", "Second floor", "Decor", "Pets"][j] });
    zones.push({ id: g, label: `Plot ${i + 1}`, rect: [cx - hw, cz - hd, cx + hw, cz + hd], main: i === 0 });
    const b0 = P(-8, -hd + 18), b1 = P(hw - 2, hd - 22);
    zones.push({ id: g + "_build", label: "Build area", rect: [Math.min(b0[0], b1[0]), Math.min(b0[1], b1[1]), Math.max(b0[0], b1[0]), Math.max(b0[1], b1[1])], open: true, access: false });
  }
  // street rhythm: lamps between plots, trees at the ends
  for (let c = 0; c <= perSide; c++) { const lx = -Lx / 2 - gap / 2 + c * (PW + gap); for (const s of [-1, 1]) items.push({ kind: "lamp_post", pos: [lx, 0.2, s * (street / 2 - 2)], rot: s < 0 ? 180 : 0 }); }
  for (const s of [-1, 1]) for (const e of [-1, 1]) for (let k = 0; k < 3; k++) items.push({ kind: k % 2 ? "pine" : "oak", pos: [e * (Lx / 2 + 16), 0, s * (street / 2 + 16 + k * 34)], rot: 40 * s + 70 * k + 20 * e, scale: G.round(1 + 0.12 * ((k + (e > 0 ? 1 : 0)) % 3 - 1)) });
  return { name: o.name || "Tycoon", type: "tycoon", seed: o.seed || 1, palette: o.palette || "modern", spawn: [0, 0.2, 0], focus: [-Lx / 2 + PW / 2, 4, -street / 2 - 20],
    bounds: { min: [X0, -Z1], max: [X1, Z1] }, zones, items };
}

// ------------------------------------------------------------------ city
const BODY = ["#E9DEC9", "#DDBD9E", "#C99270", "#AEBBC4", "#93A6B0", "#E5CCA3", "#BAC7A7", "#D69075", "#A0ACBB", "#F1E8D5", "#C7B8A6"];
const ROOF = ["#B5543C", "#7C5A46", "#56616B", "#8A4B3A"], AWN = ["#D9534F", "#2F9E8F", "#F2B441", "#4F7CC4", "#8C6BB1"];
function buildingParts(w, h, d, style, R, color) {
  const glass = "#5F7F96", trim = G.shade(color, 0.72), parts = [];
  const floors = Math.max(1, Math.round(h / 12));
  parts.push(B(0, h / 2, 0, w, h, d, color, style === "house" ? "WoodPlanks" : style === "tower" ? "Concrete" : "Brick"));
  if (style === "house") {
    const ridge = Math.min(7, w * 0.3);
    parts.push(W(0, h + ridge / 2, -d / 4 - 0.25, w + 1.4, ridge, d / 2 + 0.7, R.pick(ROOF), "Slate"), W(0, h + ridge / 2, d / 4 + 0.25, w + 1.4, ridge, d / 2 + 0.7, parts.length ? parts[parts.length - 1] && R.pick(ROOF) : ROOF[0], "Slate", 180));
    parts[2].c = parts[1].c;
    parts.push(B(0, 4, -d / 2 - 0.1, 4.5, 8, 0.3, trim, "Wood"), B(-w * 0.28, 5.5, -d / 2 - 0.1, 4, 4, 0.3, glass, "Glass"), B(w * 0.28, 5.5, -d / 2 - 0.1, 4, 4, 0.3, glass, "Glass"));
    if (floors > 1) parts.push(B(0, 17.5, -d / 2 - 0.1, w * 0.55, 4, 0.3, glass, "Glass"));
    return parts;
  }
  for (let f = 1; f < floors; f++) parts.push(style === "tower" ? B(0, f * 12 + 6, 0, w + 0.3, 5.5, d + 0.3, glass, "Glass") : B(0, f * 12 + 6, 0, w - 5, 5, d + 0.3, glass, "Glass"));
  parts.push(B(0, 4.6, -d / 2 - 0.1, w - 6, 7.2, 0.3, glass, "Glass"), B(0, 4, -d / 2 - 0.2, 5, 8, 0.3, trim, "Metal"));
  if (style === "shop") parts.push(B(0, 9.8, -d / 2 - 1.6, w - 3, 0.6, 3.4, R.pick(AWN), "Fabric"));
  parts.push(B(0, h + 0.5, 0, w + 0.6, 1, d + 0.6, trim, "Concrete"));
  if (style === "tower") parts.push(B(w * 0.18, h + 2.5, d * 0.12, Math.min(8, w * 0.3), 3, Math.min(8, d * 0.3), "#8F9399", "Metal"));
  return parts;
}
function city(o = {}) {
  const R = G.rng(o.seed || 1), nx = o.blocksX || 4, nz = o.blocksZ || 3, BW = o.blockWidth || 120, BD = o.blockDepth || 100, RD = o.road || 28, SW = 8;
  const X = nx * BW + (nx + 1) * RD, Z = nz * BD + (nz + 1) * RD, items = [], zones = [], pois = [], paths = [];
  items.push({ kind: "asphalt", role: "floor", pos: [X / 2, -1, Z / 2], size: [X, 1, Z], color: "road", material: "Asphalt" });
  const mid = [(nx - 1) / 2, (nz - 1) / 2], far = Math.hypot(mid[0], mid[1]) || 1;
  const order = []; for (let i = 0; i < nx; i++) for (let j = 0; j < nz; j++) order.push([i, j, Math.hypot(i - mid[0], j - mid[1]) / far + R.range(0, 0.08)]);
  order.sort((a, b) => a[2] - b[2]);
  const special = new Map([[order[0].slice(0, 2).join(), "plaza"], [order[Math.min(order.length - 1, 2 + R.int(0, 1))].slice(0, 2).join(), "park"]]);
  let spawn = [X / 2, 0.4, Z / 2], tallest = { h: 0 };
  for (const [i, j, dist] of order) {
    const x0 = RD + i * (BW + RD), z0 = RD + j * (BD + RD), x1 = x0 + BW, z1 = z0 + BD, cx = (x0 + x1) / 2, cz = (z0 + z1) / 2;
    const type = special.get([i, j].join()) || (dist < 0.5 ? "downtown" : dist < 0.86 ? "mid" : "homes"), zid = `b${i}_${j}`;
    items.push({ kind: "sidewalk", role: "decor", pos: [cx, 0, cz], size: [BW, 0.4, BD], color: "sidewalk", material: "Concrete", zone: zid });
    const ix0 = x0 + SW, iz0 = z0 + SW, ix1 = x1 - SW, iz1 = z1 - SW;
    // kerb furniture, the same rhythm on every block
    const lamps = Math.round(BW / 44);
    for (let k = 0; k < lamps; k++) { const lx = x0 + BW * (k + 0.5) / lamps; items.push({ kind: "lamp_post", pos: [G.round(lx), 0.4, z0 + 1.6], rot: 0 }, { kind: "lamp_post", pos: [G.round(lx), 0.4, z1 - 1.6], rot: 180 }); }
    if (type !== "downtown") { const tn = Math.round(BD / 30); for (let k = 0; k < tn; k++) { const tz = z0 + BD * (k + 0.5) / tn; for (const tx of [x0 + 2.4, x1 - 2.4]) items.push({ kind: "street_tree", pos: [tx, 0.4, G.round(tz)], rot: R.int(0, 359), scale: G.round(R.range(0.9, 1.15)) }); } }
    if (type === "park" || type === "plaza") {
      items.push({ kind: type, role: "decor", pos: [cx, 0.4, cz], size: [ix1 - ix0, 0.2, iz1 - iz0], color: type === "park" ? "grass" : "#D8CFC0", material: type === "park" ? "Grass" : "Cobblestone", zone: zid });
      zones.push({ id: zid, label: type === "park" ? "Park" : "Market plaza", rect: [x0, z0, x1, z1], open: true, main: true });
      pois.push({ id: zid, label: type === "park" ? "Park" : "Plaza", pos: [cx, cz] });
      if (type === "park") {
        items.push({ kind: "fountain", pos: [cx, 0.6, cz] });
        paths.push({ id: zid + "_a", width: 7, kind: "path", y: 0.62, points: [[ix0, cz], [cx - 13, cz]] }, { id: zid + "_b", width: 7, kind: "path", y: 0.62, points: [[cx + 13, cz], [ix1, cz]] }, { id: zid + "_c", width: 7, kind: "path", y: 0.62, points: [[cx, iz0], [cx, cz - 13]] }, { id: zid + "_d", width: 7, kind: "path", y: 0.62, points: [[cx, cz + 13], [cx, iz1]] });
        for (let a = 45; a < 360; a += 90) { const bx = cx + Math.cos(G.rad(a)) * 17, bz = cz + Math.sin(G.rad(a)) * 17; items.push({ kind: "bench", pos: [G.round(bx), 0.6, G.round(bz)], rot: norm(G.rad(0) + Math.atan2(bx - cx, bz - cz) * 180 / Math.PI) }); }
        const pts = G.poisson(R, ix0 + 5, iz0 + 5, ix1 - 5, iz1 - 5, (x, z) => (Math.hypot(x - cx, z - cz) < 26 || Math.abs(x - cx) < 8 || Math.abs(z - cz) < 8) ? 0 : 15, { rMin: 15 });
        for (const p of pts) items.push({ kind: R.chance(0.7) ? "oak" : "birch", pos: [G.round(p.x), 0.6, G.round(p.z)], rot: R.int(0, 359), scale: G.round(R.range(0.85, 1.2)) });
      } else {
        spawn = [cx, 0.6, cz + 6];
        items.push({ kind: "spawn", pos: [cx, 0.6, cz + 6] }, { kind: "pedestal", pos: [cx, 0.6, cz - 8], size: [5, 10, 5] });
        const cols = Math.floor((ix1 - ix0 - 16) / 15), sx = cx - (cols - 1) * 7.5;
        for (let k = 0; k < cols; k++) { if (Math.abs(sx + k * 15 - cx) < 12) continue; items.push({ kind: "stall", pos: [sx + k * 15, 0.6, cz - 20], rot: 180 }, { kind: "stall", pos: [sx + k * 15, 0.6, cz + 20], rot: 0 }); }
        for (const [ex, ez] of [[ix0 + 5, iz0 + 4], [ix1 - 5, iz0 + 4], [ix0 + 5, iz1 - 4], [ix1 - 5, iz1 - 4]]) items.push({ kind: "planter", pos: [ex, 0.6, ez] });
        items.push({ kind: "bench", pos: [cx - 14, 0.6, cz + 2], rot: 270 }, { kind: "bench", pos: [cx + 14, 0.6, cz + 2], rot: 90 });
      }
      continue;
    }
    // two rows of lots back to back; the leftover is an alley (walkable) or shared yards, never a sliver
    const frontage = ix1 - ix0, lots = type === "downtown" ? 3 : type === "mid" ? 4 : 3, lw = frontage / lots;
    const alley = type === "homes" ? 0 : 12, depth = type === "homes" ? 24 : (iz1 - iz0 - alley) / 2, setback = type === "homes" ? 7 : 0, sideGap = type === "homes" ? 10 : 0;
    if (type === "homes") items.push({ kind: "lawn", role: "decor", pos: [cx, 0.4, cz], size: [ix1 - ix0, 0.2, iz1 - iz0], color: "grass", material: "Grass", zone: zid });
    let prevF = 0;
    for (const row of [0, 1]) for (let k = 0; k < lots; k++) {
      let floors; do { floors = type === "downtown" ? R.int(4, 11) : type === "mid" ? R.int(2, 4) : R.int(1, 2); } while (floors === prevF && type !== "homes"); prevF = floors;
      const w = G.round(lw - sideGap, 2), h = floors * 12 + (type === "homes" ? 2 : 0), bx = ix0 + lw * (k + 0.5), bz = row === 0 ? iz0 + setback + depth / 2 : iz1 - setback - depth / 2;
      const style = type === "downtown" ? "tower" : type === "mid" ? "shop" : "house", color = R.pick(BODY), id = `${zid}_${row}${k}`;
      items.push({ id, kind: "building", role: "building", pos: [G.round(bx), 0.4, G.round(bz)], size: [w, h, depth], rot: row === 0 ? 0 : 180, parts: buildingParts(w, h, depth, style, R, color), color, zone: zid, clear: { f: 4 } });
      if (h > tallest.h) tallest = { h, id, pos: [G.round(bx), G.round(row === 0 ? bz - depth / 2 - 5 : bz + depth / 2 + 5)] };
      if (type === "homes" && R.chance(0.6)) items.push({ kind: R.chance(0.5) ? "oak" : "birch", pos: [G.round(bx + R.range(-6, 6)), 0.6, G.round(cz + (row ? 3 : -3) + R.range(-1.5, 1.5))], rot: R.int(0, 359), scale: G.round(R.range(0.8, 1.05)) });
    }
    if (alley) zones.push({ id: zid + "_alley", label: "Alley", rect: [ix0, cz - alley / 2, ix1, cz + alley / 2], open: true, access: false });
  }
  if (tallest.id) pois.push({ id: tallest.id, label: "Landmark tower", pos: tallest.pos });
  // road paint: centre dashes and zebra crossings
  for (let j = 0; j <= nz; j++) { const z = RD / 2 + j * (BD + RD); for (let i = 0; i < nx; i++) for (let k = 0; k < 6; k++) items.push({ kind: "dash", role: "decor", pos: [RD + i * (BW + RD) + BW * (k + 0.5) / 6, 0, z], size: [8, 0.06, 0.8], color: "line" }); }
  for (let i = 0; i <= nx; i++) { const x = RD / 2 + i * (BW + RD); for (let j = 0; j < nz; j++) for (let k = 0; k < 5; k++) items.push({ kind: "dash", role: "decor", pos: [x, 0, RD + j * (BD + RD) + BD * (k + 0.5) / 5], size: [0.8, 0.06, 8], color: "line" }); }
  for (let i = 0; i < nx; i++) for (let j = 0; j <= nz; j++) for (const e of [0, 1]) { const x = RD + i * (BW + RD) + (e ? BW - 6 : 6), z = RD / 2 + j * (BD + RD); for (let k = 0; k < 5; k++) items.push({ kind: "zebra", role: "decor", pos: [x, 0, z - 10 + k * 5], size: [8, 0.06, 2.2], color: "line" }); }
  return { name: o.name || "City", type: "city", seed: o.seed || 1, palette: "modern", spawn, focus: tallest.pos ? [tallest.pos[0], 30, tallest.pos[1]] : undefined, bounds: { min: [0, 0], max: [X, Z] }, zones, pois, paths, items };
}

// ------------------------------------------------------------------ wilderness (procedural survival map)
class Occupied {
  constructor(cell = 16) { this.c = cell; this.m = new Map(); }
  add(x, z, r = 0) { const k = Math.floor(x / this.c) * 4099 + Math.floor(z / this.c); if (!this.m.has(k)) this.m.set(k, []); this.m.get(k).push([x, z, r]); }
  any(x, z, d) { const n = Math.ceil((d + 12) / this.c), ci = Math.floor(x / this.c), cj = Math.floor(z / this.c); for (let i = ci - n; i <= ci + n; i++) for (let j = cj - n; j <= cj + n; j++) { const b = this.m.get(i * 4099 + j); if (b) for (const p of b) if (Math.hypot(p[0] - x, p[1] - z) < d + p[2]) return true; } return false; }
}
function wilderness(o = {}) {
  const seed = o.seed || 1, R = G.rng(seed), N = G.noise2(seed), S = o.size || 640, c = S / 2, items = [], zones = [], pois = [], paths = [];
  items.push({ kind: "ground", role: "floor", pos: [c, -1, c], size: [S, 1, S], color: "grass", material: "Grass" });
  // water first: everything else works around it
  const lakes = [];
  for (let k = 0, tries = 0; k < (o.lakes === undefined ? 2 : o.lakes) && tries < 60; tries++) {
    const r = R.range(42, 68), x = R.range(r + 30, S - r - 30), z = R.range(r + 30, S - r - 30);
    if (Math.hypot(x - c, z - c) < r + 90 || lakes.some(l => Math.hypot(l[0] - x, l[1] - z) < l[2] + r + 60)) continue;
    lakes.push([x, z, r]); k++;
    items.push({ kind: "shore", role: "decor", shape: "cylinder", pos: [G.round(x), 0, G.round(z)], size: [2 * r + 12, 0.15, 2 * r + 12], color: "sand", material: "Sand" }, { kind: "water", role: "decor", shape: "cylinder", pos: [G.round(x), 0, G.round(z)], size: [2 * r, 0.3, 2 * r], color: "water", material: "Glass" });
    zones.push({ id: `lake${k}`, label: "Lake", kind: "water", circle: [G.round(x), G.round(z), G.round(r)] });
  }
  const inLake = (x, z, m = 0) => lakes.some(l => Math.hypot(l[0] - x, l[1] - z) < l[2] + m);
  // points of interest: 6 to 15 seconds of walking apart
  const TYPES = [["Watchtower", 14], ["Ruins", 22], ["Cabin", 20], ["Quarry", 20], ["Shrine", 16], ["Old camp", 20]];
  const P = [{ id: "camp", label: "Spawn camp", x: c, z: c, r: 24, t: "camp" }];
  const want = o.pois || Math.max(4, Math.round(S * S / 60000));
  const cand = G.poisson(R, 70, 70, S - 70, S - 70, (x, z) => (inLake(x, z, 34) || Math.hypot(x - c, z - c) < 130) ? 0 : 150, { rMin: 150 });
  cand.slice(0, want).forEach((p, i) => { const t = TYPES[i % TYPES.length]; P.push({ id: `poi${i + 1}`, label: t[0], x: G.round(p.x), z: G.round(p.z), r: t[1] + 6, t: t[0] }); });
  lakes.forEach((l, i) => { const a = Math.atan2(c - l[1], c - l[0]), x = l[0] + Math.cos(a) * (l[2] - 6), z = l[1] + Math.sin(a) * (l[2] - 6); P.push({ id: `dock${i + 1}`, label: "Dock", x: G.round(x), z: G.round(z), r: 14, t: "Dock", a }); });
  const occ = new Occupied();
  for (const p of P) {
    pois.push({ id: p.id, label: p.label, pos: p.t === "Dock" ? [G.round(p.x + Math.cos(p.a) * 20), G.round(p.z + Math.sin(p.a) * 20)] : [p.x, p.z] });
    if (p.t !== "Dock") zones.push({ id: p.id, label: p.label, circle: [p.x, p.z, p.r], open: true, main: true });
    const rot = R.int(0, 3) * 90 + R.int(-20, 20), set = (name, extra) => items.push(...C.setItems(name, p.x, 0, p.z, rot, p.id).map(it => Object.assign(it, extra)));
    if (p.t === "camp") set("camp"); else if (p.t === "Ruins") set("ruins"); else if (p.t === "Old camp") set("camp");
    else if (p.t === "Watchtower") items.push({ kind: "watchtower", pos: [p.x, 0, p.z], rot: norm(rot), group: p.id });
    else if (p.t === "Cabin") { items.push({ kind: "cabin", pos: [p.x, 0, p.z], rot: norm(Math.atan2(p.x - c, p.z - c) * 180 / Math.PI), group: p.id }); }
    else if (p.t === "Quarry") { set("rocks"); items.push({ kind: "ore_node", pos: [p.x + 11, 0, p.z - 8], rot: 200, group: p.id }, { kind: "ore_node", pos: [p.x - 12, 0, p.z - 6], rot: 140, group: p.id }, { kind: "crate", pos: [p.x - 4, 0, p.z + 12], rot: 25, group: p.id }); }
    else if (p.t === "Shrine") { for (let a = 0; a < 360; a += 60) items.push({ kind: "pillar", pos: [G.round(p.x + Math.cos(G.rad(a)) * 11), 0, G.round(p.z + Math.sin(G.rad(a)) * 11)], group: p.id }); items.push({ kind: "pedestal", pos: [p.x, 0, p.z], group: p.id }); }
    else if (p.t === "Dock") items.push({ kind: "dock", pos: [p.x, 0, p.z], rot: norm(Math.atan2(Math.cos(p.a), Math.sin(p.a)) * 180 / Math.PI + 180), group: p.id });
    occ.add(p.x, p.z, p.r);
  }
  // trails: a spanning tree so everything is connected, plus a couple of loops so it isn't a dead-end maze
  const edges = [], inTree = new Set([0]);
  while (inTree.size < P.length) { let b = null; for (const i of inTree) for (let j = 0; j < P.length; j++) { if (inTree.has(j)) continue; const d = Math.hypot(P[i].x - P[j].x, P[i].z - P[j].z); if (!b || d < b[2]) b = [i, j, d]; } inTree.add(b[1]); edges.push(b); }
  for (let i = 1, extra = 0; i < P.length && extra < Math.ceil(P.length / 3); i++) { const near = P.map((q, j) => [j, Math.hypot(P[i].x - q.x, P[i].z - q.z)]).filter(q => q[0] !== i).sort((a, b) => a[1] - b[1])[1]; if (near && near[1] < 330 && !edges.some(e => (e[0] === i && e[1] === near[0]) || (e[1] === i && e[0] === near[0]))) { edges.push([i, near[0], near[1]]); extra++; } }
  const segs = [];
  edges.forEach(([i, j, d], k) => {
    const a = P[i], b = P[j], nxv = -(b.z - a.z) / d, nzv = (b.x - a.x) / d, pts = [], steps = Math.max(3, Math.round(d / 45));
    for (let s = 0; s <= steps; s++) {
      const t = s / steps; let x = G.lerp(a.x, b.x, t), z = G.lerp(a.z, b.z, t); const bend = Math.sin(t * Math.PI) * (N(x + k * 31, z, 90, 1) - 0.5) * d * 0.3; x += nxv * bend; z += nzv * bend;
      for (const l of lakes) { const dl = Math.hypot(x - l[0], z - l[1]); if (dl < l[2] + 14 && a.t !== "Dock" && b.t !== "Dock") { x = l[0] + (x - l[0]) / dl * (l[2] + 14); z = l[1] + (z - l[1]) / dl * (l[2] + 14); } }
      pts.push([G.round(x, 10), G.round(z, 10)]);
    }
    paths.push({ id: `trail${k + 1}`, kind: "trail", width: 7, points: pts });
    for (let s = 1; s < pts.length; s++) segs.push([pts[s - 1], pts[s]]);
  });
  const nearPath = (x, z, m) => segs.some(s => G.segPoint([x, z], s[0], s[1]).d < m);
  const free = (x, z, m) => x > 8 && z > 8 && x < S - 8 && z < S - 8 && !inLake(x, z, 7 + m) && !nearPath(x, z, 5.5 + m) && !occ.any(x, z, m);
  const forest = (x, z) => N(x, z, 170, 3), rocky = (x, z) => N(x + 913, z - 577, 130, 2);
  const drop = (kind, p, extra) => { items.push(Object.assign({ kind, pos: [G.round(p.x, 10), 0, G.round(p.z, 10)], rot: R.int(0, 359), scale: G.round(R.range(0.82, 1.24)) }, extra)); occ.add(p.x, p.z, (extra && extra.r) || 2.5); if (extra) delete extra.r; };
  // a fair start: wood, stone and food within a few seconds of spawn
  for (let k = 0; k < 4; k++) { const a = R.range(0, 6.28), d = 34 + k * 5; drop(k % 2 ? "pine" : "oak", { x: c + Math.cos(a) * d, z: c + Math.sin(a) * d }); }
  { const a = R.range(0, 6.28); items.push(...C.setItems("rocks", G.round(c + Math.cos(a) * 44), 0, G.round(c + Math.sin(a) * 44), R.int(0, 359), "start_rocks")); occ.add(c + Math.cos(a) * 44, c + Math.sin(a) * 44, 9); drop("berry_bush", { x: c + Math.cos(a + 2.2) * 38, z: c + Math.sin(a + 2.2) * 38 }, { scale: 1 }); }
  // resources before decoration, so they get the good spots
  for (const p of G.poisson(R, 20, 20, S - 20, S - 20, (x, z) => (rocky(x, z) > 0.55 && free(x, z, 5)) ? 64 : 0, { rMin: 64 })) drop("ore_node", p, { scale: 1, r: 7 });
  for (const p of G.poisson(R, 20, 20, S - 20, S - 20, (x, z) => { const f = forest(x, z); return f > 0.4 && f < 0.56 && free(x, z, 4) ? 56 : 0; }, { rMin: 56 })) drop("berry_bush", p, { scale: 1, r: 6 });
  for (const p of G.poisson(R, 20, 20, S - 20, S - 20, (x, z) => (rocky(x, z) > 0.6 && free(x, z, 9)) ? 36 : 0, { rMin: 36 })) { items.push(...C.setItems("rocks", G.round(p.x), 0, G.round(p.z), R.int(0, 359), `rocks${items.length}`)); occ.add(p.x, p.z, 12); }
  // trees: dense in forest, a few lone ones in meadows, thinning at the edge between
  const treeR = (x, z) => { if (!free(x, z, 2.5)) return 0; const f = forest(x, z); return f > 0.5 ? G.lerp(19, 10.5, G.clamp((f - 0.5) / 0.22, 0, 1)) : f > 0.43 ? 28 : 44; };
  for (const p of G.poisson(R, 10, 10, S - 10, S - 10, treeR, { rMin: 10.5, rMax: 44, tries: Math.ceil(S * S / 22) })) { const f = forest(p.x, p.z), sp = N(p.x - 300, p.z + 200, 240, 1); drop(f < 0.5 && R.chance(0.4) ? "birch" : sp > 0.52 ? "pine" : "oak", p); }
  for (const p of G.poisson(R, 10, 10, S - 10, S - 10, (x, z) => { const f = forest(x, z); return f > 0.4 && f < 0.54 && free(x, z, 3) ? 13 : 0; }, { rMin: 13 })) drop("bush", p);
  for (const p of G.poisson(R, 10, 10, S - 10, S - 10, (x, z) => (forest(x, z) < 0.44 && free(x, z, 0.5)) ? 11 : 0, { rMin: 11 })) items.push({ kind: "flowers", pos: [G.round(p.x, 10), 0, G.round(p.z, 10)], rot: R.int(0, 359) });
  return { name: o.name || "Wilderness", type: "wilderness", seed, palette: "rustic", spawn: [c, 0, c + 9], focus: [P[1] ? P[1].x : c, 10, P[1] ? P[1].z : c - 50], bounds: { min: [0, 0], max: [S, S] }, zones, pois, paths, items };
}

module.exports = { obby, tycoon, city, wilderness, OBBY_PATTERNS };
