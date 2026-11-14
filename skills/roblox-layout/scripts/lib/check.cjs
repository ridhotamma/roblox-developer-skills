// The spacing checker. Measures a resolved layout the way a player experiences it: can I get
// there, do I fit, is anything jammed together, is anything stranded in empty floor.
"use strict";
const G = require("./geom.cjs");

// Per layout type: nav cell (studs), narrowest passable gap, wanted main-route width, the widest
// empty circle that still reads as intentional, and the floor-coverage band.
const PROFILES = {
  interior:   { cell: 0.5, pass: 3.5, main: 6,  empty: 17,  coverage: [0.14, 0.5],  deadGap: true },
  building:   { cell: 0.5, pass: 3.5, main: 5,  empty: 17,  coverage: [0.12, 0.5],  deadGap: true },
  tycoon:     { cell: 1,   pass: 4,   main: 8,  empty: 48,  coverage: [0.02, 0.5],  deadGap: true },
  city:       { cell: 2,   pass: 4,   main: 8,  empty: 84,  coverage: [0.15, 0.7],  deadGap: true },
  wilderness: { cell: 2,   pass: 4,   main: 6,  empty: 110, coverage: [0.002, 0.3], deadGap: false },
  obby:       { cell: 1,   pass: 3,   main: 4,  empty: 1e9, coverage: [0, 1],       deadGap: false },
  custom:     { cell: 1,   pass: 3.5, main: 6,  empty: 40,  coverage: [0.03, 0.55], deadGap: true },
};
const SOLID_SKIP = new Set(["floor", "decor", "marker", "ceiling", "lintel"]);
const isSolid = it => !it.walkable && !SOLID_SKIP.has(it.role) && it.y < 6.5 && it.y + it.h > 0.6;
const isWallish = it => it.role === "wall" || it.role === "window" || it.role === "building";
const f1 = v => (Math.round(v * 10) / 10).toString();

class Heap {
  constructor() { this.k = []; this.v = []; }
  get size() { return this.k.length; }
  push(k, v) { const K = this.k, V = this.v; let i = K.length; K.push(k); V.push(v); while (i > 0) { const p = (i - 1) >> 1; if (K[p] <= K[i]) break; [K[p], K[i]] = [K[i], K[p]]; [V[p], V[i]] = [V[i], V[p]]; i = p; } }
  pop() { const K = this.k, V = this.v, k = K[0], v = V[0], lk = K.pop(), lv = V.pop(); if (K.length) { K[0] = lk; V[0] = lv; let i = 0; for (;;) { let m = i; const l = 2 * i + 1, r = l + 1; if (l < K.length && K[l] < K[m]) m = l; if (r < K.length && K[r] < K[m]) m = r; if (m === i) break; [K[m], K[i]] = [K[i], K[m]]; [V[m], V[i]] = [V[i], V[m]]; i = m; } } return [k, v]; }
}

// Exact squared Euclidean distance transform (Felzenszwalb), in cells.
function edt(blocked, w, h) {
  const INF = 1e20, f = new Float64Array(Math.max(w, h)), d = new Float64Array(w * h), v = new Int32Array(Math.max(w, h)), z = new Float64Array(Math.max(w, h) + 1);
  const pass = (n, get, set) => {
    let k = 0; v[0] = 0; z[0] = -INF; z[1] = INF;
    for (let q = 0; q < n; q++) f[q] = get(q);
    for (let q = 1; q < n; q++) {
      let s;
      do { const p = v[k]; s = ((f[q] + q * q) - (f[p] + p * p)) / (2 * q - 2 * p); } while (s <= z[k] && --k >= 0);
      k++; v[k] = q; z[k] = s; z[k + 1] = INF;
    }
    k = 0;
    for (let q = 0; q < n; q++) { while (z[k + 1] < q) k++; const p = v[k]; set(q, (q - p) * (q - p) + f[p]); }
  };
  for (let i = 0; i < w * h; i++) d[i] = blocked[i] ? 0 : INF;
  for (let x = 0; x < w; x++) pass(h, q => d[q * w + x], (q, val) => { d[q * w + x] = val; });
  for (let y = 0; y < h; y++) pass(w, q => d[y * w + q], (q, val) => { d[y * w + q] = val; });
  return d;
}

function check(L, opts = {}) {
  const { layout, items, bounds } = L, type = PROFILES[layout.type] ? layout.type : "custom";
  const P = Object.assign({}, PROFILES[type], layout.rules || {}, opts.rules || {});
  const issues = [], stats = { items: items.length, type };
  const add = (sev, code, msg, at, ids, fix, lean) => issues.push({ sev, code, msg, at: at && [G.round(at[0], 10), G.round(at[1], 10)], ids: ids || [], fix, lean });
  const byId = new Map(items.map(it => [it.id, it]));
  const zones = layout.zones || [];
  const inZone = (z, x, y) => z.circle ? Math.hypot(x - z.circle[0], y - z.circle[1]) <= z.circle[2] : (x >= z.rect[0] && x <= z.rect[2] && y >= z.rect[1] && y <= z.rect[3]);
  const openZones = zones.filter(z => z.open || z.kind === "water"), waterZones = zones.filter(z => z.kind === "water");

  if (type === "obby") { checkRoute(L, P, add, stats); return finish(L, issues, stats, P, null, {}); }

  // ---- 1. pairwise: overlaps, dead gaps, blocked clearances ----
  const solids = items.filter(isSolid);
  solids.forEach(it => { it._poly = G.footprint(it); it._b = G.polyBounds(it._poly); it._clr = G.clearZones(it); });
  const hc = 12, hash = new Map();
  const hk = (i, j) => i * 73856093 ^ j * 19349663;
  solids.forEach((it, idx) => {
    const m = 6 + Math.max(it.clear.f || 0, it.clear.b || 0, it.clear.l || 0, it.clear.r || 0);
    for (let i = Math.floor((it._b[0] - m) / hc); i <= Math.floor((it._b[2] + m) / hc); i++) for (let j = Math.floor((it._b[1] - m) / hc); j <= Math.floor((it._b[3] + m) / hc); j++) {
      const k = hk(i, j); if (!hash.has(k)) hash.set(k, []); hash.get(k).push(idx);
    }
  });
  const near = new Map(), seenPair = new Set(), gaps = [];
  const noteNear = (a, b, r) => { for (const [p, q, pa, pb] of [[a, b, r.pa, r.pb], [b, a, r.pb, r.pa]]) { if (!near.has(p.id)) near.set(p.id, []); near.get(p.id).push({ id: q.id, gap: G.round(r.dist, 10), a: pa.map(v => G.round(v, 10)), b: pb.map(v => G.round(v, 10)) }); } };
  const sideCovers = (it, pt, gap) => { // is the gap on a side where the item reserves space anyway?
    const [lx, lz] = G.w2l(it.x, it.z, it.rot, pt[0], pt[1]), c = it.clear || {}, ex = Math.abs(lx) - it.fw / 2, ez = Math.abs(lz) - it.fd / 2;
    const side = ez >= ex ? (lz < 0 ? c.f : c.b) : (lx < 0 ? c.l : c.r);
    return (side || 0) >= gap - 0.5;
  };
  for (const bucket of hash.values()) for (let u = 0; u < bucket.length; u++) for (let v = u + 1; v < bucket.length; v++) {
    const ia = Math.min(bucket[u], bucket[v]), ib = Math.max(bucket[u], bucket[v]), pk = ia * 1000003 + ib;
    if (ia === ib || seenPair.has(pk)) continue; seenPair.add(pk);
    const a = solids[ia], b = solids[ib];
    const sameGroup = a.group && a.group === b.group, bothWall = isWallish(a) && isWallish(b) && !(a.role === "building" && b.role === "building");
    if (a.y >= b.y + b.h - 0.05 || b.y >= a.y + a.h - 0.05) continue; // stacked, not side by side
    // clearances first: they reach further than the gap test
    if (!sameGroup) for (const [p, q] of [[a, b], [b, a]]) for (const cz of p._clr) {
      if (isWallish(p) && isWallish(q)) continue;
      const r = G.polyDist(cz.poly, q._poly);
      if (r.depth > 0.25) add("warn", "blocked", `${p.id} needs ${f1(p.clear[cz.side[0]])} studs free at its ${cz.side}, but ${q.id} is in it`, G.centroid(cz.poly), [p.id, q.id], `move ${q.id} ${f1(r.depth + 0.2)}+ studs away, or turn ${p.id} to face open floor`, "tight");
    }
    if (a._b[0] - b._b[2] > 6 || b._b[0] - a._b[2] > 6 || a._b[1] - b._b[3] > 6 || b._b[1] - a._b[3] > 6) continue;
    const r = G.polyDist(a._poly, b._poly);
    if (r.dist < 6) noteNear(a, b, r);
    if (sameGroup || bothWall) continue;
    const mid = [(r.pa[0] + r.pb[0]) / 2, (r.pa[1] + r.pb[1]) / 2];
    if (r.depth > 0.15) { add("error", "overlap", `${a.id} and ${b.id} overlap by ${f1(r.depth)} studs`, mid, [a.id, b.id], `separate them: touching (0) or ${P.pass}+ studs apart`, "tight"); continue; }
    if (r.dist > 0 && !isWallish(a) && !isWallish(b)) gaps.push(r.dist);
    if (r.dist > 0.6 && (a.group || b.group) && solids.some(m => m !== a && m !== b && m.group && (m.group === a.group || m.group === b.group) && G.pointInPoly(mid, m._poly))) continue; // a group-mate fills the gap
    const nature = a.role === "nature" || b.role === "nature";
    if (nature && !P.deadGap) { if (a.role === b.role && r.dist < 1 && a.fw > 1.2) add("info", "clumped", `${a.id} and ${b.id} are jammed together (${f1(r.dist)} studs)`, mid, [a.id, b.id], "nudge one a few studs or delete it", "tight"); continue; }
    if (P.deadGap && r.dist > 0.6 && r.dist < P.pass && !sideCovers(a, r.pa, r.dist) && !sideCovers(b, r.pb, r.dist) && !(isWallish(a) && G.pastWallEnd(a, r.pa, r.pb)) && !(isWallish(b) && G.pastWallEnd(b, r.pa, r.pb))) {
      const wall = isWallish(a) || isWallish(b), small = Math.min(a.fw * a.fd, b.fw * b.fd) < 5 || a.role === "nature" || b.role === "nature";
      add(small ? "info" : "warn", wall ? "off-wall" : "dead-gap",
        wall ? `${isWallish(a) ? b.id : a.id} floats ${f1(r.dist)} studs off ${isWallish(a) ? a.id : b.id}: too narrow to use, too wide to look attached`
             : `${f1(r.dist)} stud gap between ${a.id} and ${b.id}: too narrow to walk through, too wide to read as one group`,
        mid, [a.id, b.id], wall ? `push it flush to the wall or pull it out to ${P.pass}+ studs` : `close the gap (touching) or open it to ${P.pass}+ studs`, "tight");
    }
  }
  if (gaps.length) { gaps.sort((x, y) => x - y); stats.medianGap = G.round(gaps[gaps.length >> 1], 10); }

  // ---- 2. nav grid: where an avatar can stand and how wide the way there is ----
  let cell = P.cell; const [bx0, bz0, bx1, bz1] = bounds;
  while (((bx1 - bx0) / cell) * ((bz1 - bz0) / cell) > 420000) cell *= 2;
  const gw = Math.max(2, Math.ceil((bx1 - bx0) / cell)), gh = Math.max(2, Math.ceil((bz1 - bz0) / cell));
  const blocked = new Uint8Array(gw * gh), floor = new Uint8Array(gw * gh), furn = new Uint8Array(gw * gh);
  const raster = (it, arr, val) => {
    const poly = G.footprint(it), b = G.polyBounds(poly), c = Math.cos(G.rad(it.rot)), s = Math.sin(G.rad(it.rot)), thin = arr === floor ? 0 : cell * 0.71, hw = Math.max(it.fw / 2, thin) + 1e-6, hd = Math.max(it.fd / 2, thin) + 1e-6; b[0] -= cell; b[1] -= cell; b[2] += cell; b[3] += cell;
    for (let j = Math.max(0, Math.floor((b[1] - bz0) / cell)); j <= Math.min(gh - 1, Math.floor((b[3] - bz0) / cell)); j++)
      for (let i = Math.max(0, Math.floor((b[0] - bx0) / cell)); i <= Math.min(gw - 1, Math.floor((b[2] - bx0) / cell)); i++) {
        const dx = bx0 + (i + 0.5) * cell - it.x, dz = bz0 + (j + 0.5) * cell - it.z;
        if (Math.abs(dx * c - dz * s) <= hw && Math.abs(dx * s + dz * c) <= hd) arr[j * gw + i] = val;
      }
  };
  const floors = items.filter(it => it.role === "floor");
  const hasFloor = floors.length > 0 && (type === "interior" || type === "building" || type === "tycoon");
  if (hasFloor) floors.forEach(it => raster(it, floor, 1)); else floor.fill(1);
  for (const it of solids) { raster(it, blocked, 1); if (it.role !== "wall" && it.role !== "window") raster(it, furn, 1); }
  for (let j = 0; j < gh; j++) for (let i = 0; i < gw; i++) {
    const k = j * gw + i, x = bx0 + (i + 0.5) * cell, z = bz0 + (j + 0.5) * cell;
    if (!floor[k]) blocked[k] = 1;
    else if (waterZones.some(zn => inZone(zn, x, z))) { blocked[k] = 1; floor[k] = 0; }
  }
  const d2 = edt(blocked, gw, gh), width = new Float64Array(gw * gh);
  for (let i = 0; i < gw * gh; i++) width[i] = blocked[i] ? 0 : Math.max(0, 2 * Math.sqrt(d2[i]) * cell - cell);
  const cellOf = (x, z) => { const i = G.clamp(Math.floor((x - bx0) / cell), 0, gw - 1), j = G.clamp(Math.floor((z - bz0) / cell), 0, gh - 1); return j * gw + i; };
  const freeNear = (x, z, r = 3) => { // widest free cell within r studs
    let best = -1, bw = 0; const n = Math.ceil(r / cell), ci = Math.floor((x - bx0) / cell), cj = Math.floor((z - bz0) / cell);
    for (let j = cj - n; j <= cj + n; j++) for (let i = ci - n; i <= ci + n; i++) { if (i < 0 || j < 0 || i >= gw || j >= gh) continue; const k = j * gw + i; if (width[k] > bw) { bw = width[k]; best = k; } }
    return best;
  };
  let spawn = layout.spawn ? [layout.spawn[0], layout.spawn[2] !== undefined ? layout.spawn[2] : layout.spawn[1]] : null;
  if (!spawn) { let bk = 0; for (let i = 1; i < gw * gh; i++) if (width[i] > width[bk]) bk = i; spawn = [bx0 + (bk % gw + 0.5) * cell, bz0 + (Math.floor(bk / gw) + 0.5) * cell]; }
  const start = freeNear(spawn[0], spawn[1], 6);
  // widest path: bottleneck[k] = the narrowest point on the best route from spawn to k
  const neck = new Float64Array(gw * gh), walk = new Float64Array(gw * gh).fill(Infinity);
  if (start >= 0) {
    const h = new Heap(); neck[start] = width[start]; h.push(-neck[start], start);
    const NB = [[1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1], [1, 1, 1.4142], [1, -1, 1.4142], [-1, 1, 1.4142], [-1, -1, 1.4142]];
    while (h.size) {
      const [nk, k] = h.pop(); if (-nk < neck[k] - 1e-6) continue;
      const i = k % gw, j = (k - i) / gw;
      for (const [di, dj] of NB) { const x = i + di, y = j + dj; if (x < 0 || y < 0 || x >= gw || y >= gh) continue; const q = y * gw + x; if (blocked[q]) continue; if (di && dj && (blocked[j * gw + x] || blocked[y * gw + i])) continue; const v = Math.min(neck[k], width[q]); if (v > neck[q] + 1e-6) { neck[q] = v; h.push(-v, q); } }
    }
    const minW = Math.min(P.pass, 3) - cell * 0.51; walk[start] = 0; const h2 = new Heap(); h2.push(0, start);
    while (h2.size) {
      const [dk, k] = h2.pop(); if (dk > walk[k] + 1e-6) continue;
      const i = k % gw, j = (k - i) / gw;
      for (const [di, dj, c] of NB) { const x = i + di, y = j + dj; if (x < 0 || y < 0 || x >= gw || y >= gh) continue; const q = y * gw + x; if (blocked[q] || width[q] < minW) continue; if (di && dj && (blocked[j * gw + x] || blocked[y * gw + i])) continue; const v = dk + c * cell; if (v < walk[q] - 1e-6) { walk[q] = v; h2.push(v, q); } }
    }
  }
  // targets a player must be able to reach
  const targets = [];
  for (const it of items) {
    if (it.role === "floor" || it.role === "wall" || it.role === "window" || it.role === "ceiling" || it.role === "lintel" || it.role === "nature" && !(it.clear.f > 0)) continue;
    if (it.clear.f >= 2.5 || it.role === "marker") { const p = it.role === "marker" && !(it.clear.f >= 2.5) ? [it.x, it.z] : G.usePoint(it); targets.push({ id: it.id, label: it.label || it.id, at: p, kind: "item" }); }
  }
  for (const z of zones) if (z.kind !== "water" && z.access !== false) targets.push({ id: z.id, label: z.label || z.id, at: z.circle ? [z.circle[0], z.circle[1]] : [(z.rect[0] + z.rect[2]) / 2, (z.rect[1] + z.rect[3]) / 2], kind: "zone", r: G.clamp((z.circle ? z.circle[2] : Math.min(z.rect[2] - z.rect[0], z.rect[3] - z.rect[1]) / 2) * 0.8, 6, 24), main: !!z.main });
  for (const p of layout.pois || []) targets.push({ id: p.id, label: p.label || p.id, at: [p.pos[0], p.pos[p.pos.length - 1]], kind: "poi", r: 16, main: true });
  const speed = (layout.metrics && layout.metrics.walkSpeed) || 16;
  let minRoute = Infinity, longest = 0; const routes = [];
  const slack = cell * 0.75;
  for (const t of targets) {
    let k = freeNear(t.at[0], t.at[1], t.r || 2.5);
    if (k >= 0 && !isFinite(walk[k])) { // pick a reachable cell nearby if there is one
      const n = Math.ceil((t.r || 2.5) / cell), ci = k % gw, cj = (k - ci) / gw; let bw = -1;
      for (let j = cj - n; j <= cj + n; j++) for (let i = ci - n; i <= ci + n; i++) { if (i < 0 || j < 0 || i >= gw || j >= gh) continue; const q = j * gw + i; if (isFinite(walk[q]) && neck[q] > bw) { bw = neck[q]; k = q; } }
    }
    if (k < 0 || !isFinite(walk[k])) { add("error", "unreachable", `${t.label} can't be reached from spawn`, t.at, [t.id], `open a route ${P.pass}+ studs wide to it, or turn it to face open floor`, "tight"); continue; }
    const w = neck[k] + slack; routes.push({ id: t.id, width: G.round(w, 10), walk: G.round(walk[k], 1), kind: t.kind });
    minRoute = Math.min(minRoute, w); if (t.kind !== "item" || type !== "wilderness") longest = Math.max(longest, walk[k]);
    if (t.kind !== "item" && w < (t.main ? P.main : P.pass) - 0.01) add("warn", "narrow-route", `the way to ${t.label} narrows to ${f1(w)} studs (want ${t.main ? P.main : P.pass}+)`, t.at, [t.id], `widen the tightest point on the route to ${t.main ? P.main : P.pass}+ studs`, "tight");
  }
  if (isFinite(minRoute)) stats.narrowestRoute = G.round(minRoute, 10);
  stats.longestWalkSeconds = G.round(longest / speed, 10);
  if ((type === "interior" || type === "building") && longest / speed > 12) add("info", "long-walk", `farthest point is a ${f1(longest / speed)} s walk from the entrance`, null, [], "bring the most-used things closer to the door, or shrink the room", "loose");

  // ---- 3. looseness: coverage and empty floor ----
  let floorCells = 0, furnCells = 0;
  for (let i = 0; i < gw * gh; i++) { if (!floor[i]) continue; const k = i; if (blocked[k] && !furn[k]) continue; floorCells++; if (furn[k]) furnCells++; }
  const coverage = floorCells ? furnCells / floorCells : 0; stats.coverage = G.round(coverage, 1000);
  stats.floorArea = Math.round(floorCells * cell * cell);
  if (floorCells && solids.some(s => !isWallish(s))) {
    if (coverage > P.coverage[1]) add("warn", "crowded", `${Math.round(coverage * 100)}% of the floor is covered (aim for ${Math.round(P.coverage[0] * 100)}-${Math.round(P.coverage[1] * 100)}%)`, null, [], "remove a few pieces or enlarge the space", "tight");
    if (coverage < P.coverage[0]) add("warn", "sparse", `only ${Math.round(coverage * 100)}% of the floor is covered (aim for ${Math.round(P.coverage[0] * 100)}-${Math.round(P.coverage[1] * 100)}%)`, null, [], "shrink the space to fit its contents, or add groups (not single scattered props)", "loose");
  }
  const empties = [], taken = [];
  const edge = (i, j) => Math.min(i, j, gw - 1 - i, gh - 1 - j) * cell;
  for (let pass = 0; pass < 4; pass++) {
    let bk = -1, bw = 0;
    for (let j = 0; j < gh; j++) for (let i = 0; i < gw; i++) {
      const k = j * gw + i; if (blocked[k] || !isFinite(walk[k])) continue;
      const w = Math.min(width[k], 2 * edge(i, j) + cell); if (w <= bw) continue;
      const x = bx0 + (i + 0.5) * cell, z = bz0 + (j + 0.5) * cell;
      if (taken.some(t => Math.hypot(x - t[0], z - t[1]) < t[2]) || openZones.some(zn => inZone(zn, x, z))) continue;
      bw = w; bk = k;
    }
    if (bk < 0) break;
    const x = bx0 + (bk % gw + 0.5) * cell, z = bz0 + (Math.floor(bk / gw) + 0.5) * cell;
    if (pass === 0) stats.widestEmpty = G.round(bw, 10);
    if (bw <= P.empty) break;
    empties.push({ at: [G.round(x, 10), G.round(z, 10)], dia: G.round(bw, 10) }); taken.push([x, z, bw]);
    add("warn", "empty", `${f1(bw)} studs of empty floor around (${Math.round(x)}, ${Math.round(z)})`, [x, z], [], type === "wilderness" ? "scatter a cluster here, or mark it as a clearing with a reason to visit" : "give the space a job: a grouped set, a rug with seating, a feature piece; or shrink the room", "loose");
  }

  // ---- 4. order: rhythm, near-misses, copy-paste ----
  const ordered = items.filter(it => !["floor", "wall", "window", "ceiling", "lintel", "nature", "building"].includes(it.role) && it.kind !== "part" && Math.abs(((it.rot % 90) + 90) % 90) < 0.01);
  const byKind = new Map();
  for (const it of ordered) { const k = it.kind + "|" + (((it.rot % 180) + 180) % 180) + "|" + Math.round(it.y); if (!byKind.has(k)) byKind.set(k, []); byKind.get(k).push(it); }
  for (const list of byKind.values()) {
    if (list.length < 3) continue;
    for (const [ax, bxs] of [["x", "z"], ["z", "x"]]) {
      const lines = new Map();
      for (const it of list) { const k = Math.round(it[ax] * 4); if (!lines.has(k)) lines.set(k, []); lines.get(k).push(it); }
      for (const line of lines.values()) {
        const ext = it => (((it.rot % 180) + 180) % 180 === 0) === (bxs === "x") ? it.fw : it.fd;
        const units = new Map(); // one unit per group so a set's own spacing isn't compared with the aisle
        for (const it of line) { const k = it.group || it.id, lo = it[bxs] - ext(it) / 2, hi = it[bxs] + ext(it) / 2, u = units.get(k); if (u) { u.lo = Math.min(u.lo, lo); u.hi = Math.max(u.hi, hi); } else units.set(k, { lo, hi, it }); }
        const us = [...units.values()].sort((p, q) => p.lo - q.lo); if (us.length < 3) continue;
        const gs = []; for (let i = 1; i < us.length; i++) gs.push(us[i].lo - us[i - 1].hi);
        const lo = Math.min(...gs), hi = Math.max(...gs);
        if (lo > 0.6 && hi - lo > 0.6 && hi / lo < 1.25) { const w = us[gs.indexOf(hi) + 1].it; add("info", "uneven", `row of ${us.length} ${line[0].kind} has uneven gaps (${f1(lo)} to ${f1(hi)} studs)`, [w.x, w.z], us.map(u => u.it.id), `use one gap (${f1(gs.reduce((p, q) => p + q, 0) / gs.length)}), or make the break obvious (1.25x or more)`, null); }
      }
      const sorted = list.slice().sort((p, q) => p[ax] - q[ax]);
      for (let i = 1; i < sorted.length; i++) { const dd = sorted[i][ax] - sorted[i - 1][ax], far = Math.abs(sorted[i][bxs] - sorted[i - 1][bxs]); if (dd > 0.12 && dd < 0.7 && far < 30 && far > 1 && !sorted[i].group && !sorted[i - 1].group && !sorted[i].walkable) add("info", "near-aligned", `${sorted[i - 1].id} and ${sorted[i].id} are ${f1(dd)} studs off the same line`, [sorted[i].x, sorted[i].z], [sorted[i - 1].id, sorted[i].id], "snap them to one line", null); }
    }
  }
  const natKinds = new Map();
  for (const it of items) if (it.role === "nature" && !it.group) { if (!natKinds.has(it.kind)) natKinds.set(it.kind, []); natKinds.get(it.kind).push(it); }
  for (const [k, list] of natKinds) if (list.length >= 8 && (new Set(list.map(i => Math.round(i.rot / 10))).size <= 2 || (list[0].h >= 8 && new Set(list.map(i => i.scale)).size === 1)) && type !== "city")
    add("info", "copy-paste", `${list.length} ${k} share the same rotation or scale`, null, [], "vary rotation freely and scale by about 15% so repeats don't read as copies", null);

  // ---- 5. scale: doors, ceilings, POI spacing ----
  if (type === "interior" || type === "building") {
    const walls = items.filter(it => it.role === "wall" && it.y < 1);
    const H = walls.length ? Math.max(...walls.map(w => w.h)) : 0; stats.wallHeight = H;
    if (H && H < 12) add("warn", "low-ceiling", `walls are ${f1(H)} studs high: the third-person camera will clip (use 12-16)`, null, [], "raise the walls to 12+ studs", "tight");
    for (const l of items.filter(it => it.role === "lintel" && !it.tags.includes("window"))) { const w = Math.max(l.w, l.d); if (l.y < 7.5 || w < 5) add("warn", "small-door", `opening at (${Math.round(l.x)}, ${Math.round(l.z)}) is ${f1(w)} wide and ${f1(l.y)} high (want 5+ wide, 7.5+ high)`, [l.x, l.z], [l.id], "make doorways 6 wide and 8+ high", "tight"); }
  }
  const pois = layout.pois || [];
  if (pois.length > 1) {
    const nn = pois.map(p => Math.min(...pois.filter(q => q !== p).map(q => Math.hypot(p.pos[0] - q.pos[0], p.pos[p.pos.length - 1] - q.pos[q.pos.length - 1]))));
    stats.poiSpacing = [Math.round(Math.min(...nn)), Math.round(Math.max(...nn))];
    pois.forEach((p, i) => {
      const at = [p.pos[0], p.pos[p.pos.length - 1]];
      if (nn[i] > 16.5 * speed) add("warn", "isolated", `${p.label || p.id} is ${Math.round(nn[i])} studs (${f1(nn[i] / speed)} s) from the nearest other point of interest`, at, [p.id], "add something worth walking to in between (keep 6-15 s between points of interest)", "loose");
      else if (nn[i] < 4 * speed) add("info", "crowded-poi", `${p.label || p.id} is only ${Math.round(nn[i])} studs from another point of interest`, at, [p.id], "merge them into one place or move them 6+ s apart", "tight");
    });
  }
  if (layout.route) checkRoute(L, P, add, stats);

  // viewer data, one byte per cell: 0 blocked, 1 can't be reached, 2 too narrow to walk,
  // 3 narrow for a main route, 4 fine. "Narrow" means no circle of that width fits over the cell.
  const grid = opts.grid === false ? null : (() => {
    const fitsDisc = t => { const seed = new Uint8Array(gw * gh); for (let i = 0; i < gw * gh; i++) seed[i] = !blocked[i] && width[i] >= t - cell * 0.6 ? 1 : 0; const d = edt(seed, gw, gh), r = (t / 2 / cell) ** 2; return i => d[i] <= r; };
    const pass = fitsDisc(P.pass), main = fitsDisc(P.main), walked = new Uint8Array(gw * gh);
    for (let i = 0; i < gw * gh; i++) walked[i] = isFinite(walk[i]) ? 1 : 0;
    const dw = edt(walked, gw, gh), rr = (P.pass / cell) ** 2, out = Buffer.alloc(gw * gh);
    for (let i = 0; i < gw * gh; i++) out[i] = blocked[i] ? 0 : !pass(i) ? 2 : dw[i] > rr ? 1 : !main(i) ? 3 : 4;
    return { w: gw, h: gh, cell, x0: bx0, z0: bz0, data: out.toString("base64") };
  })();
  const nearOut = {}; for (const [id, list] of near) nearOut[id] = list.sort((p, q) => p.gap - q.gap).slice(0, 4);
  return finish(L, issues, stats, P, grid, { near: nearOut, empties, routes, spawn });
}

// Jump-by-jump check of an ordered obby route.
function checkRoute(L, P, add, stats) {
  const { layout, items } = L, m = layout.metrics || {}, byId = new Map(items.map(it => [it.id, it]));
  const route = (layout.route || []).map(id => byId.get(id)).filter(Boolean);
  if (route.length < 2) { add("error", "no-route", "an obby needs a route: the ordered list of platform ids", null, [], "add \"route\": [ids...] to the layout"); return; }
  const H = m.jumpHeight || 7.2, hops = []; let sinceCp = 0, maxSince = 0;
  const isCp = it => it.tags.includes("checkpoint");
  for (let i = 1; i < route.length; i++) {
    const a = route[i - 1], b = route[i], dy = (b.y + b.h) - (a.y + a.h);
    const r = G.polyDist(G.footprint(a), G.footprint(b)), gap = r.dist, reach = G.jumpReach(Math.max(dy, -40), m);
    const mid = [(r.pa[0] + r.pb[0]) / 2, (r.pa[1] + r.pb[1]) / 2];
    const max = reach + 1, comfy = Math.max(1, reach - 2.5);
    const ratio = G.jumpDifficulty(gap, dy, Math.min(b.fw, b.fd), m);
    hops.push({ from: a.id, to: b.id, gap: G.round(gap, 10), dy: G.round(dy, 10), reach: G.round(reach, 10), ratio: G.round(ratio, 100), stage: b.zone || a.zone });
    if (dy > H - 0.3) add("error", "too-high", `${a.id} to ${b.id} rises ${f1(dy)} studs: over the ${f1(H)} stud jump height`, mid, [a.id, b.id], `keep rises to ${f1(H - 1.5)} or less, or add a step`, "loose");
    else if (gap > max) add("error", "too-far", `${a.id} to ${b.id} is a ${f1(gap)} stud gap: the longest possible jump here is ${f1(max)}`, mid, [a.id, b.id], `close the gap to ${f1(reach - 1)} or less`, "loose");
    else if (gap > reach - 0.4) add("warn", "pixel-jump", `${a.id} to ${b.id} (${f1(gap)} studs) needs a frame-perfect jump`, mid, [a.id, b.id], `use ${f1(reach - 1.2)} for the hardest fair jump, ${f1(comfy)} for a comfortable one`, "loose");
    else if (dy > H - 1.2) add("warn", "pixel-jump", `${a.id} to ${b.id} rises ${f1(dy)} studs: barely reachable`, mid, [a.id, b.id], `keep hard rises to ${f1(H - 1.5)} or less`, "loose");
    if (isCp(b)) { maxSince = Math.max(maxSince, sinceCp); sinceCp = 0; } else if (gap > 0.3) sinceCp++;
    if (sinceCp === 13) add("warn", "no-checkpoint", `12+ jumps without a checkpoint before ${b.id}`, [b.x, b.z], [b.id], "place a checkpoint every 6-10 jumps (fewer on hard stages)", "loose");
  }
  const stages = []; let cur = null;
  for (const h of hops) { if (!cur || cur.stage !== h.stage) { cur = { stage: h.stage, n: 0, sum: 0, max: 0 }; stages.push(cur); } if (h.gap > 0.3 || h.dy > 1) { cur.n++; cur.sum += h.ratio; cur.max = Math.max(cur.max, h.ratio); } }
  const curve = stages.filter(s => s.n).map(s => ({ stage: s.stage, jumps: s.n, difficulty: G.round(s.sum / s.n, 100), hardest: s.max }));
  for (let i = 1; i < curve.length; i++) if (curve[i].difficulty - curve[i - 1].difficulty > 0.3) add("warn", "spike", `difficulty jumps from ${curve[i - 1].difficulty} to ${curve[i].difficulty} at stage ${curve[i].stage}`, null, [], "ramp one knob at a time: keep stage-to-stage steps under 0.2", "loose");
  if (curve.length && curve[0].difficulty > 0.55) add("warn", "hard-start", `the first stage is already at difficulty ${curve[0].difficulty}`, null, [], "open with 3-5 easy jumps (difficulty under 0.35) so new players get a win", "loose");
  stats.jumps = hops.filter(h => h.gap > 0.3).length; stats.hops = hops; stats.curve = curve; stats.maxJumpsBetweenCheckpoints = Math.max(maxSince, sinceCp);
}

function finish(L, issues, stats, P, grid, extra) {
  const order = { error: 0, warn: 1, info: 2 };
  // collapse repeats so one systematic mistake doesn't bury everything else
  issues.sort((a, b) => order[a.sev] - order[b.sev]);
  const counts = { error: 0, warn: 0, info: 0 }; let tight = 0, loose = 0;
  for (const i of issues) { counts[i.sev]++; const w = i.sev === "error" ? 3 : i.sev === "warn" ? 2 : 1; if (i.lean === "tight") tight += w; if (i.lean === "loose") loose += w; }
  const score = Math.max(0, Math.round(100 - Math.min(60, counts.error * 12) - Math.min(30, counts.warn * 4) - Math.min(10, counts.info)));
  const verdict = !tight && !loose ? "balanced" : tight >= 2 * loose + 2 ? "too tight" : loose >= 2 * tight + 2 ? "too loose" : tight + loose <= 3 ? "nearly balanced" : "mixed: tight in places, loose in others";
  return Object.assign({ name: L.layout.name, type: L.layout.type || "custom", score, verdict, counts, tight, loose, issues, stats, profile: P, grid }, extra);
}

function text(rep, max = 40) {
  const s = rep.stats, out = [];
  out.push(`${rep.name || "layout"} (${rep.type}): score ${rep.score}/100, spacing ${rep.verdict}`);
  out.push(`  ${s.items} items, ${rep.counts.error} errors, ${rep.counts.warn} warnings, ${rep.counts.info} notes`);
  const bits = [];
  if (s.coverage !== undefined) bits.push(`floor covered ${Math.round(s.coverage * 100)}%`);
  if (s.narrowestRoute !== undefined) bits.push(`narrowest route ${s.narrowestRoute}`);
  if (s.medianGap !== undefined) bits.push(`median gap ${s.medianGap}`);
  if (s.widestEmpty !== undefined) bits.push(`widest empty ${s.widestEmpty}`);
  if (s.longestWalkSeconds) bits.push(`longest walk ${s.longestWalkSeconds} s`);
  if (s.poiSpacing) bits.push(`POI spacing ${s.poiSpacing[0]}-${s.poiSpacing[1]}`);
  if (s.jumps !== undefined) bits.push(`${s.jumps} jumps, max ${s.maxJumpsBetweenCheckpoints} between checkpoints`);
  if (bits.length) out.push("  " + bits.join(" | ") + (s.jumps === undefined ? " (studs)" : ""));
  if (s.curve) out.push("  difficulty by stage: " + s.curve.map(c => `${c.stage}:${c.difficulty}`).join("  "));
  const groups = new Map();
  for (const i of rep.issues) { if (!groups.has(i.code)) groups.set(i.code, []); groups.get(i.code).push(i); }
  let shown = 0;
  for (const [code, list] of groups) {
    for (const i of list.slice(0, 6)) { if (shown++ >= max) break; out.push(`  ${i.sev.toUpperCase().padEnd(5)} ${code}: ${i.msg}${i.fix ? `\n          fix: ${i.fix}` : ""}`); }
    if (list.length > 6) out.push(`        ... and ${list.length - 6} more "${code}"`);
  }
  if (!rep.issues.length) out.push("  no spacing problems found");
  return out.join("\n");
}

module.exports = { check, text, PROFILES, isSolid };
