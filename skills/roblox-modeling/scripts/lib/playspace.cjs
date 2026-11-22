'use strict';
// Playspace: how a model that players walk around in (a room, house, shop, cabin, ruin, dungeon, ship deck, cave)
// plays for a Roblox avatar at the size it is exported (roblox.cjs studsPerMetre). It runs when the spec has a
// "playspace" block. It rebuilds what Roblox collides with (every MeshPart that collides, per its collision class,
// with moving parts in the poses the spec names, e.g. doors open), stands an R15-sized avatar on every surface,
// and reports:
//   scale     - the size in studs and how much floor the avatar can walk on from the start
//   start     - the avatar fits where players arrive
//   reach     - every named spot can be walked to, and the narrowest gap on the way (widest-path bottleneck)
//   steps     - a spot that is only reachable with a jump (a riser over the ~2 stud auto-climb)
//   headroom  - doorways clear tall avatars and hats; ceilings leave the third-person camera room
//   traps     - places a player can drop or jump into and never get out of (a stuck player: the hard fail)
//   drops     - unguarded edges higher than the avatar (balconies, lofts, stairwells, a model with no ground)
// Sizes are in studs; positions in messages are model metres (x, y, z), so they map straight back to the spec.
const G = require('./geometry.cjs');
const MD = require('./model.cjs');
const RB = require('./roblox.cjs');

// Defaults in studs: the same numbers as the roblox-layout skill's spacing metrics (references/playspace.md).
const AVATAR = { width: 2, height: 5, step: 2, jump: 7.2 };       // R15 body width, height, auto-climb, jump height
const MINIMUM = { passage: 3.5, headroom: 7.5, ceiling: 12, drop: 5 };
const KEYS = new Set(['start', 'spots', 'poses', 'avatar', 'minimum', 'area', 'cell']);

const num = v => typeof v === 'number' && Number.isFinite(v);
const vec3 = v => Array.isArray(v) && v.length === 3 && v.every(num);

// Spec validation (called from model.compile).
function validate(spec, E, W) {
  const ps = spec.playspace;
  if (ps == null) return;
  if (typeof ps !== 'object' || Array.isArray(ps)) { E.push('playspace must be an object: { "start": [x, y, z], "spots": [...] }'); return; }
  for (const k of Object.keys(ps)) if (!KEYS.has(k)) W.push(`playspace: unknown field "${k}" (${[...KEYS].join(', ')})`);
  if (!vec3(ps.start)) E.push('playspace.start must be [x, y, z] in model metres: a point on the floor where players arrive (inside the front door, the spawn)');
  for (const [i, s] of (ps.spots || []).entries()) if (!s || !vec3(s.at)) E.push(`playspace.spots[${i}] needs "at": [x, y, z] (and a "name")`);
  for (const [i, p] of (ps.poses || []).entries()) if (!p || typeof p.clip !== 'string') E.push(`playspace.poses[${i}] needs "clip" (and optionally "at": seconds, "start", "mid" or "end")`);
  for (const g of ['avatar', 'minimum']) for (const [k, v] of Object.entries(ps[g] || {})) {
    const known = g === 'avatar' ? AVATAR : MINIMUM;
    if (!(k in known)) W.push(`playspace.${g}: unknown field "${k}" (${Object.keys(known).join(', ')})`);
    else if (!num(v) || v <= 0) E.push(`playspace.${g}.${k} must be a positive number of studs`);
  }
  if (ps.area != null && !(Array.isArray(ps.area) && ps.area.length === 4 && ps.area.every(num))) E.push('playspace.area must be [x0, z0, x1, z1] in model metres');
  if (ps.cell != null && !(num(ps.cell) && ps.cell > 0)) E.push('playspace.cell must be a positive number of studs');
}

const timeOf = (clip, at) => (at === 'end' || at == null ? clip.duration : at === 'start' ? 0 : at === 'mid' ? clip.duration / 2 : +at);

// What Roblox collides with: the meshPlan's collidable MeshParts, each member posed (rest, or the first listed pose
// whose clip moves it or one of its parents). Merged groups collide by their geometry ("default" fidelity).
function colliders(model, ps) {
  const rest = new Map(MD.posedMeshes(model, null, 0).map(m => [m.node, m]));
  const poses = (ps.poses || []).map(p => {
    const clip = model.clips.find(c => c.name === p.clip);
    if (!clip) throw new Error(`playspace.poses: no animation "${p.clip}"`);
    return { clip, meshes: new Map(MD.posedMeshes(model, clip, timeOf(clip, p.at)).map(m => [m.node, m])) };
  });
  const posedOf = n => { for (const p of poses) for (let a = n; a; a = a.parent) if (p.clip.animated.has(a)) return p.meshes.get(n); return rest.get(n); };
  const out = [];
  for (const entry of RB.meshPlan(model)) {
    if (entry.collision === 'none') continue;
    for (const n of entry.members) {
      const m = posedOf(n);
      if (m) out.push({ name: n.name, cls: entry.members.length > 1 ? 'default' : entry.collision, pos: m.pos, tris: m.tris });
    }
  }
  return out;
}

// Solid vertical intervals per grid cell. Each part is sampled with a vertical line through the cell (sample points
// sit slightly off the cell centre so they never land on an axis-aligned edge): down-facing triangles enter the
// solid, up-facing ones leave it. Watertight parts (the geometry test) make this exact; Box collision uses the
// part's bounding box, Hull its convex hull.
function rasterize(cols, grid) {
  const { x0, z0, c, nx, nz } = grid, cells = Array.from({ length: nx * nz }, () => []);
  const sx = i => x0 + (i + 0.5 + 1.2345e-3) * c, sz = j => z0 + (j + 0.5 + 2.3456e-3) * c;
  const range = (lo, hi, o, n) => [Math.max(0, Math.ceil((lo - o) / c - 0.5 - 2e-3)), Math.min(n - 1, Math.floor((hi - o) / c - 0.5 - 2e-3))];
  for (const col of cols) {
    const b = G.bounds(col.pos);
    if (col.cls === 'box') {
      const [i0, i1] = range(b.lo[0], b.hi[0], x0, nx), [j0, j1] = range(b.lo[2], b.hi[2], z0, nz);
      for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) cells[j * nx + i].push([b.lo[1], b.hi[1]]);
      continue;
    }
    const mesh = col.cls === 'hull' ? G.hull(col.pos) : col, hits = new Map();
    for (const t of mesh.tris) {
      const A = mesh.pos[t[0]], B = mesh.pos[t[1]], D = mesh.pos[t[2]];
      const e = (P, Q, x, z) => (Q[2] - P[2]) * (x - P[0]) - (Q[0] - P[0]) * (z - P[2]);   // cross(Q - P, X - P).y
      const ny = e(A, B, D[0], D[2]);
      if (Math.abs(ny) < 1e-12) continue;                                                     // vertical face
      const [i0, i1] = range(Math.min(A[0], B[0], D[0]), Math.max(A[0], B[0], D[0]), x0, nx);
      const [j0, j1] = range(Math.min(A[2], B[2], D[2]), Math.max(A[2], B[2], D[2]), z0, nz);
      for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
        const x = sx(i), z = sz(j), wd = e(A, B, x, z) / ny, wa = e(B, D, x, z) / ny, wb = e(D, A, x, z) / ny;
        if (wa < 0 || wb < 0 || wd < 0) continue;
        const k = j * nx + i; if (!hits.has(k)) hits.set(k, []);
        hits.get(k).push([wa * A[1] + wb * B[1] + wd * D[1], ny > 0 ? -1 : 1]);               // +1 enters (bottom face)
      }
    }
    for (const [k, hs] of hits) {
      hs.sort((p, q) => p[0] - q[0] || q[1] - p[1]);
      let depth = 0, start = 0;
      for (const [y, s] of hs) {
        if (s > 0) { if (depth === 0) start = y; depth++; }
        else if (depth > 0) { depth--; if (depth === 0) cells[k].push([start, y]); }
      }
    }
  }
  return cells;
}

function mergeIntervals(ivs, ground) {
  if (ground) ivs.push([-Infinity, 0]);
  ivs.sort((a, b) => a[0] - b[0]);
  const out = [];
  for (const iv of ivs) { const last = out[out.length - 1]; if (last && iv[0] <= last[1] + 1e-4) last[1] = Math.max(last[1], iv[1]); else out.push(iv.slice()); }
  return out;
}

// Exact squared Euclidean distance transform (Felzenszwalb & Huttenlocher) of a w x h grid, in place: 0 at seed
// cells, BIG elsewhere on input; squared distance in cells to the nearest seed on output (>= BIG / 2: none).
const BIG = 1e20;
function edt(f, w, h) {
  const n0 = Math.max(w, h), v = new Int32Array(n0), z = new Float64Array(n0 + 1), g = new Float64Array(n0);
  const one = (n, get, set) => {
    for (let q = 0; q < n; q++) g[q] = get(q);
    let k = 0; v[0] = 0; z[0] = -Infinity; z[1] = Infinity;
    const cut = (q, p) => ((g[q] + q * q) - (g[p] + p * p)) / (2 * q - 2 * p);
    for (let q = 1; q < n; q++) {
      let s = cut(q, v[k]);
      while (s <= z[k]) { k--; s = cut(q, v[k]); }
      k++; v[k] = q; z[k] = s; z[k + 1] = Infinity;
    }
    k = 0;
    for (let q = 0; q < n; q++) { while (z[k + 1] < q) k++; set(q, (q - v[k]) * (q - v[k]) + g[v[k]]); }
  };
  for (let y = 0; y < h; y++) one(w, x => f[y * w + x], (x, val) => { f[y * w + x] = val; });
  for (let x = 0; x < w; x++) one(h, y => f[y * w + x], (y, val) => { f[y * w + x] = val; });
  return f;
}

// Widest path (max over paths of the min clearance) from one node; parent pointers for the route.
function widest(n, start, val, edgesOf) {
  const best = new Float64Array(n).fill(-1), parent = new Int32Array(n).fill(-1), heap = [];
  const push = (v, k) => { heap.push([v, k]); let i = heap.length - 1; while (i > 0) { const p = (i - 1) >> 1; if (heap[p][0] >= heap[i][0]) break; [heap[p], heap[i]] = [heap[i], heap[p]]; i = p; } };
  const pop = () => { const top = heap[0], last = heap.pop(); if (heap.length) { heap[0] = last; let i = 0; for (;;) { const l = 2 * i + 1, r = l + 1; let m = i; if (l < heap.length && heap[l][0] > heap[m][0]) m = l; if (r < heap.length && heap[r][0] > heap[m][0]) m = r; if (m === i) break; [heap[m], heap[i]] = [heap[i], heap[m]]; i = m; } } return top; };
  best[start] = val[start]; push(best[start], start);
  while (heap.length) {
    const [v, a] = pop();
    if (v < best[a]) continue;
    edgesOf(a, b => { const nv = Math.min(v, val[b]); if (nv > best[b]) { best[b] = nv; parent[b] = a; push(nv, b); } });
  }
  return { best, parent };
}

// Run the analysis; add(id, status, msg) like checks.cjs.
function check(model, add) {
  const ps = model.spec.playspace;
  if (!ps) return;
  const id = 'playspace', S = RB.studsPerMetre(model);
  const av = Object.assign({}, AVATAR, ps.avatar), min = Object.assign({}, MINIMUM, ps.minimum);
  const Hm = av.height / S, stepM = av.step / S, jumpM = av.jump / S, R = av.width / 2 / S;
  const st = m => +(m * S).toFixed(1), at = (x, y, z) => `(${x.toFixed(2)}, ${y.toFixed(2)}, ${z.toFixed(2)})`;

  const cols = colliders(model, ps);
  const all = []; MD.posedMeshes(model, null, 0).forEach(m => all.push(...m.pos));
  const B = G.bounds(all), margin = 3 * av.width / S;
  const area = ps.area || [B.lo[0] - margin, B.lo[2] - margin, B.hi[0] + margin, B.hi[2] + margin];
  let cellStuds = ps.cell || 0.25;
  const extent = Math.max(area[2] - area[0], area[3] - area[1]) * S;
  if ((extent / cellStuds) ** 2 > 400000) cellStuds = extent / Math.sqrt(400000);           // keep big maps fast
  const c = cellStuds / S, nx = Math.max(1, Math.ceil((area[2] - area[0]) / c)), nz = Math.max(1, Math.ceil((area[3] - area[1]) / c));
  const grid = { x0: area[0], z0: area[1], c, nx, nz };
  const cells = rasterize(cols, grid).map(ivs => mergeIntervals(ivs, model.ground));
  const cx = i => grid.x0 + (i + 0.5) * c, cz = j => grid.z0 + (j + 0.5) * c;

  // nodes: every surface top with room above it for the avatar
  const nCell = [], nY = [], nHead = [], cellNodes = Array.from({ length: nx * nz }, () => []);
  cells.forEach((ivs, k) => ivs.forEach((iv, i) => {
    if (!Number.isFinite(iv[1])) return;
    const head = (i + 1 < ivs.length ? ivs[i + 1][0] : Infinity) - iv[1];
    if (head >= Hm - 1e-6) { cellNodes[k].push(nY.length); nCell.push(k); nY.push(iv[1]); nHead.push(head); }
  }));
  const N = nY.length;
  const blockedAt = (k, y) => cells[k].some(iv => iv[1] > y + stepM + 1e-4 && iv[0] < y + Hm - 1e-4);

  // clearance of each node: distance to the nearest cell that blocks the avatar at that node's height, per level
  const clear = new Float64Array(N), capCells = Math.ceil((Math.max(min.passage, 6) / 2 + 1) / cellStuds);
  const levels = new Map();
  for (let n = 0; n < N; n++) { const key = Math.round(nY[n] * 100); if (!levels.has(key)) levels.set(key, []); levels.get(key).push(n); }
  for (const nodes of levels.values()) {
    let i0 = Infinity, i1 = -1, j0 = Infinity, j1 = -1;
    for (const n of nodes) { const i = nCell[n] % nx, j = (nCell[n] / nx) | 0; i0 = Math.min(i0, i); i1 = Math.max(i1, i); j0 = Math.min(j0, j); j1 = Math.max(j1, j); }
    i0 = Math.max(0, i0 - capCells); i1 = Math.min(nx - 1, i1 + capCells); j0 = Math.max(0, j0 - capCells); j1 = Math.min(nz - 1, j1 + capCells);
    const w = i1 - i0 + 1, h = j1 - j0 + 1, f = new Float64Array(w * h), y = nY[nodes[0]];
    for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) f[j * w + i] = blockedAt((j + j0) * nx + i + i0, y) ? 0 : BIG;
    edt(f, w, h);
    for (const n of nodes) { const i = nCell[n] % nx - i0, j = ((nCell[n] / nx) | 0) - j0, d2 = f[j * w + i]; clear[n] = d2 >= BIG / 2 ? Infinity : Math.max(0, (Math.sqrt(d2) - 0.5) * c); }
  }
  const fits = n => clear[n] >= R - 1e-6;

  // Moves: walk to a neighbouring cell (rise or fall within the auto-climb), or climb / drop across a ledge. Next to a
  // ledge the avatar has no room to stand (the ledge is within its radius), so a jump up or a drop down spans the
  // cells in between: allowed when every one of them is clear at the higher of the two levels (it flies over them).
  // Level moves never skip cells, so a gap narrower than the avatar stays closed.
  const NB = [[1, 0], [-1, 0], [0, 1], [0, -1]], reachCells = Math.ceil(2 * R / c) + 2;
  const neighbours = (a, fn) => {
    const i = nCell[a] % nx, j = (nCell[a] / nx) | 0;
    for (const [di, dj] of NB) for (let k = 1; k <= reachCells; k++) {
      const ii = i + di * k, jj = j + dj * k; if (ii < 0 || jj < 0 || ii >= nx || jj >= nz) break;
      for (const b of cellNodes[jj * nx + ii]) {
        if (!fits(b)) continue;
        if (k === 1) { fn(b); continue; }
        if (Math.abs(nY[b] - nY[a]) <= stepM + 1e-6) continue;
        const top = Math.max(nY[a], nY[b]); let clearWay = true;
        for (let m = 1; m < k && clearWay; m++) if (blockedAt((j + dj * m) * nx + i + di * m, top)) clearWay = false;
        if (clearWay) fn(b);
      }
    }
  };
  const move = (a, b, jumps) => { const dy = nY[b] - nY[a]; return dy <= stepM + 1e-6 || (jumps && dy <= jumpM); };
  const edges = jumps => (a, fn) => neighbours(a, b => { if (move(a, b, jumps)) fn(b); });
  const nodeAt = (p, radius) => {
    // the standable node nearest p (within radius metres), at about p's height
    let best = -1, bd = Infinity; const ri = Math.ceil(radius / c), i = Math.floor((p[0] - grid.x0) / c), j = Math.floor((p[2] - grid.z0) / c);
    for (let jj = j - ri; jj <= j + ri; jj++) for (let ii = i - ri; ii <= i + ri; ii++) {
      if (ii < 0 || jj < 0 || ii >= nx || jj >= nz) continue;
      for (const n of cellNodes[jj * nx + ii]) {
        if (!fits(n) || Math.abs(nY[n] - p[1]) > stepM + 1e-6) continue;
        const d = Math.hypot(cx(ii) - p[0], cz(jj) - p[2]); if (d <= radius && d < bd) { bd = d; best = n; }
      }
    }
    return best;
  };
  const xyz = n => at(cx(nCell[n] % nx), nY[n], cz((nCell[n] / nx) | 0));
  const width = r => (r === Infinity || r * S > 20 ? '20+' : (2 * r * S).toFixed(1));

  // start
  const start = nodeAt(ps.start, 2 / S);
  const sz = B.size.map(v => (v * S).toFixed(1)).join(' × ');
  if (start < 0) {
    const raw = nodeAt(ps.start, 0.5 / S) >= 0;
    add(id, 'fail', `start ${at(...ps.start)}: the avatar (${av.width} × ${av.height} studs) does not fit there${raw ? '' : ' (no floor with room above it within 2 studs at that height)'} — move "start" onto open floor or make the space larger`);
    return;
  }
  const walk = widest(N, start, clear, edges(false)), jump = widest(N, start, clear, edges(true));
  let walkable = 0; for (let n = 0; n < N; n++) if (walk.best[n] >= R - 1e-6) walkable++;
  const cellArea = cellStuds * cellStuds;
  add(id, 'pass', `${S.toFixed(2)} studs per metre: ${sz} studs (W × H × D); avatar ${av.width} × ${av.height} studs; ${Math.round(walkable * cellArea)} sq studs of floor walkable from the start${model.spec.roblox && model.spec.roblox.studsPerMetre ? '' : ' (no roblox.studsPerMetre: Roblox\'s own 3.57 assumed)'}`);
  if (clear[start] < min.passage / 2 / S) add(id, 'warn', `start ${xyz(start)}: only ${width(clear[start])} studs of room (want ${min.passage}+): players arrive brushing a wall or furniture`);

  // reach
  const route = (res, n) => { const p = []; for (let k = n; k >= 0; k = res.parent[k]) p.push(k); return p.reverse(); };
  for (const spot of ps.spots || []) {
    const name = spot.name || at(...spot.at);
    let target = -1, tb = -1, tj = -1, jb = -1, floor = false;
    const ri = Math.ceil(2 / S / c), i = Math.floor((spot.at[0] - grid.x0) / c), j = Math.floor((spot.at[2] - grid.z0) / c);
    for (let jj = j - ri; jj <= j + ri; jj++) for (let ii = i - ri; ii <= i + ri; ii++) {
      if (ii < 0 || jj < 0 || ii >= nx || jj >= nz || Math.hypot(cx(ii) - spot.at[0], cz(jj) - spot.at[2]) > 2 / S) continue;
      for (const n of cellNodes[jj * nx + ii]) {
        if (Math.abs(nY[n] - spot.at[1]) > stepM + 1e-6) continue;
        if (fits(n)) floor = true;
        if (walk.best[n] > tb) { tb = walk.best[n]; target = n; }
        if (jump.best[n] > jb) { jb = jump.best[n]; tj = n; }
      }
    }
    if (tb >= R - 1e-6) {
      const path = route(walk, target); let pinch = path[0]; for (const k of path) if (clear[k] < clear[pinch]) pinch = k;
      const wmsg = `narrowest gap on the way ${width(tb)} studs`;
      if (tb < min.passage / 2 / S) add(id, 'warn', `reach ${name}: ${wmsg} at ${xyz(pinch)} — under ${min.passage}: avatars brush past and arms clip; widen to ${min.passage}+ or close it to 0 (no dead gaps)`);
      else add(id, 'pass', `reach ${name}: ${wmsg}`);
    } else if (jb >= R - 1e-6) {
      const path = route(jump, tj); let rise = 0, where = path[0];
      for (let k = 1; k < path.length; k++) { const dy = nY[path[k]] - nY[path[k - 1]]; if (dy > rise) { rise = dy; where = path[k - 1]; } }
      add(id, 'warn', `reach ${name}: only with a jump — a ${st(rise)} stud rise at ${xyz(where)} (avatars climb about ${av.step} without jumping): add a step (rise 1, run 1.5-2 studs) or a ramp`);
    } else {
      add(id, 'fail', `reach ${name} ${at(...spot.at)}: cannot be reached from the start, even jumping — ${!floor ? 'no floor with room for the avatar there (it is inside or under something)' : 'blocked: look for a doorway, gap or passage under ' + av.width + ' studs, a closed door (add its open pose to "poses") or a rise over ' + av.jump + ' studs'}`);
    }
  }

  // headroom over the floor walkable from the start, where something is overhead
  let lowest = -1, covered = 0, under = 0;
  for (let n = 0; n < N; n++) {
    if (walk.best[n] < R - 1e-6 || !Number.isFinite(nHead[n])) continue;
    covered++; if (nHead[n] < min.ceiling / S) under++;
    if (lowest < 0 || nHead[n] < nHead[lowest]) lowest = n;
  }
  if (covered) {
    const frac = under / covered, low = nHead[lowest], roofed = covered * cellArea >= 64;   // a bridge or awning is not a room
    if (low < min.headroom / S) add(id, 'warn', `headroom: ${st(low)} studs at ${xyz(lowest)} (want ${min.headroom}+ for tall avatars and hats): raise the doorway head, beam or loft there`);
    if (roofed && frac > 0.25) add(id, 'warn', `ceilings: ${(frac * 100).toFixed(0)}% of the covered floor (${Math.round(under * cellArea)} sq studs) is under ${min.ceiling} studs (lowest ${st(low)}): the third-person camera pushes into the ceiling — raise it, or scale up (roblox.studsPerMetre)`);
    if (low >= min.headroom / S && (frac <= 0.25 || !roofed)) add(id, 'pass', `headroom: lowest ${st(low)} studs, ${(100 - frac * 100).toFixed(0)}% of the covered floor has ${min.ceiling}+ studs for the camera`);
  }

  // traps: reachable (walking, dropping or jumping) but no way back to the start
  const fwd = new Uint8Array(N), back = new Uint8Array(N), q = [start];
  fwd[start] = 1;
  while (q.length) { const a = q.pop(); edges(true)(a, b => { if (!fwd[b]) { fwd[b] = 1; q.push(b); } }); }
  back[start] = 1; q.push(start);
  while (q.length) { const b = q.pop(); neighbours(b, a => { if (!back[a] && move(a, b, true)) { back[a] = 1; q.push(a); } }); }
  const seen = new Uint8Array(N), pockets = [];
  for (let n = 0; n < N; n++) {
    if (!fwd[n] || back[n] || seen[n]) continue;
    const members = [n]; seen[n] = 1;
    for (let k = 0; k < members.length; k++) neighbours(members[k], b => { if (fwd[b] && !back[b] && !seen[b]) { seen[b] = 1; members.push(b); } });
    let exitRise = Infinity;
    for (const a of members) neighbours(a, b => { if (back[b]) exitRise = Math.min(exitRise, nY[b] - nY[a]); });
    pockets.push({ members, exitRise });
  }
  pockets.sort((a, b) => b.members.length - a.members.length);
  const tiny = 2 * 2 / cellArea;                                         // under 4 sq studs: sampling noise
  const real = pockets.filter(p => p.members.length >= tiny);
  for (const p of real.slice(0, 5)) {
    const m = p.members[0], how = p.exitRise === Infinity ? 'walled in' : `the way out is a climb of ${st(p.exitRise)} studs; a jump reaches ${av.jump}`;
    add(id, 'fail', `trap: ${Math.round(p.members.length * cellArea)} sq studs at ${xyz(m)} that players can drop or jump into but not get out of (${how}) — close it off (flush to 0 gap or a solid filler), add a step out, or make it wide enough to walk out`);
  }
  if (real.length > 5) add(id, 'fail', `trap: ${real.length - 5} more pockets players can get stuck in`);
  if (!real.length) add(id, 'pass', 'traps: everywhere the avatar can drop or jump to, it can get back from');

  // unguarded drops along the floor walkable from the start
  const ledges = [];
  for (let a = 0; a < N; a++) {
    if (walk.best[a] < R - 1e-6) continue;
    const i = nCell[a] % nx, j = (nCell[a] / nx) | 0;
    for (const [di, dj] of NB) {
      const ii = i + di, jj = j + dj; if (ii < 0 || jj < 0 || ii >= nx || jj >= nz) continue;
      const k = jj * nx + ii;
      if (blockedAt(k, nY[a])) continue;                                   // a wall or railing: no step off here
      const ivs = cells[k];
      if (ivs.some(iv => iv[1] >= nY[a] - stepM - 1e-6 && iv[1] <= nY[a] + stepM + 1e-6)) continue;   // floor continues
      let land = -Infinity; for (const iv of ivs) if (iv[1] < nY[a] - stepM && iv[1] > land) land = iv[1];
      const drop = nY[a] - land;
      if (drop > min.drop / S) ledges.push({ a, drop });
    }
  }
  if (ledges.length) {
    ledges.sort((p, q2) => q2.drop - p.drop);
    const worst = ledges[0], len = new Set(ledges.map(l => l.a)).size * cellStuds;
    add(id, 'warn', `drops: about ${len.toFixed(0)} studs of edge with a drop over ${min.drop} studs and no barrier — worst ${worst.drop === Infinity ? 'into the void (no ground below)' : st(worst.drop) + ' studs'} at ${xyz(worst.a)}: add a railing (3.5+ studs high) or wall, or mean it (a deliberate jump-down)`);
  } else add(id, 'pass', `drops: no unguarded edge over ${min.drop} studs on the walkable floor`);
}

module.exports = { AVATAR, MINIMUM, validate, check, colliders, rasterize, edt };
