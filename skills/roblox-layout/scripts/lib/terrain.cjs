// Terrain for layouts: a list of features (rolling ground, hills, mountains, mesas, dips, lakes,
// rivers, flat pads, plowed fields, rock outcrops, painted areas, material patches) turned into a
// height and material grid. The checker measures it, the preview draws it, and the Luau twin
// (assets/kit/shared/Layout/TerrainGen.luau) builds the same grid and writes it into Roblox
// Terrain with WriteVoxels. Keep the two in step: same passes, same order, same arithmetic.
"use strict";
const G = require("./geom.cjs");

const NONE = -1e9;
// Every material Terrain accepts (Air and Water are handled separately).
const MATERIALS = ["Asphalt", "Basalt", "Brick", "Cobblestone", "Concrete", "CrackedLava", "Glacier", "Grass", "Ground", "Ice", "LeafyGrass", "Limestone", "Mud", "Pavement", "Rock", "Salt", "Sand", "Sandstone", "Slate", "Snow", "WoodPlanks"];
// Studio's default terrain colours, for the preview only (Terrain:SetMaterialColor changes them in game).
const COLORS = {
  Asphalt: "#737B6B", Basalt: "#1E1E25", Brick: "#8A563E", Cobblestone: "#847B5A", Concrete: "#7F663F", CrackedLava: "#E89C4A", Glacier: "#65B0EA", Grass: "#6A7F3F",
  Ground: "#665C3B", Ice: "#81C2E0", LeafyGrass: "#73844A", Limestone: "#CEAD94", Mud: "#3A2E24", Pavement: "#94948C", Rock: "#666C6F", Salt: "#C6BDB5", Sand: "#8F7E5F",
  Sandstone: "#895A47", Slate: "#3F7F6B", Snow: "#C3C7DA", WoodPlanks: "#8B6D4F", Water: "#0C545C",
};
const SHAPES = { hill: { flat: 0, rough: 0 }, mountain: { flat: 0, rough: 0.35 }, mesa: { flat: 0.72, rough: 0.08 }, dip: { flat: 0.3, rough: 0 } };
const TYPES = ["hill", "mountain", "mesa", "dip", "lake", "river", "flatten", "field", "outcrop", "paint", "patches"];

const sstep = t => { t = t < 0 ? 0 : t > 1 ? 1 : t; return t * t * (3 - 2 * t); };
const r2 = v => Math.round(v * 100) / 100;
const hyp = (x, z) => Math.sqrt(x * x + z * z);
// distance from (x, z) to segment a-b, and how far along it (0..1) the nearest point is
function seg(x, z, a, b) {
  const dx = b[0] - a[0], dz = b[1] - a[1], l2 = dx * dx + dz * dz;
  let t = l2 > 0 ? ((x - a[0]) * dx + (z - a[1]) * dz) / l2 : 0;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  return [hyp(x - (a[0] + dx * t), z - (a[1] + dz * t)), t];
}

// Fill in defaults and catch mistakes early, with messages that say what to write instead.
function resolve(spec, layout = {}) {
  const s = Object.assign({ cell: 4, base: 0, relief: 0, scale: 200, ridges: 0, depth: 16, rock: 40, dirt: 30, ground: "Grass", paths: true }, spec);
  s.seed = spec.seed !== undefined ? spec.seed : (layout.seed || 1);
  if (!s.bounds) {
    const b = layout.bounds;
    if (!b) throw new Error("terrain needs bounds: give terrain.bounds [x0, z0, x1, z1] or layout.bounds");
    s.bounds = [b.min[0], b.min[1], b.max[0], b.max[1]];
  }
  if (s.edge === true) s.edge = {};
  if (s.edge) s.edge = Object.assign({ height: 40, width: 60 }, s.edge);
  s.features = (spec.features || []).map((f, i) => {
    if (!TYPES.includes(f.type)) throw new Error(`terrain feature ${i + 1}: unknown type "${f.type}". Types: ${TYPES.join(", ")}`);
    for (const k of ["material", "alt", "bed", "beach"]) if (f[k] && !MATERIALS.includes(f[k])) throw new Error(`terrain feature ${i + 1}: "${f[k]}" is not a terrain material. Use one of: ${MATERIALS.join(", ")}`);
    if (["hill", "mountain", "mesa", "dip", "lake", "outcrop"].includes(f.type) && !(f.at && f.radius)) throw new Error(`terrain feature ${i + 1} (${f.type}) needs at: [x, z] and radius`);
    if (f.type === "river" && !(f.points && f.points.length > 1)) throw new Error(`terrain feature ${i + 1} (river) needs points: [[x, z], ...] (two or more)`);
    return Object.assign({}, f);
  });
  if (!MATERIALS.includes(s.ground)) throw new Error(`terrain.ground: "${s.ground}" is not a terrain material`);
  return s;
}

// Build the grid. `paths` are the layout's paths: trails get a level bed and a painted surface.
function build(specIn, paths, layout) {
  const s = resolve(specIn, layout), N = G.noise2(s.seed), cell = s.cell;
  const [bx0, bz0, bx1, bz1] = s.bounds, x0 = bx0, z0 = bz0;
  const nx = Math.max(2, Math.ceil((bx1 - bx0) / cell) + 1), nz = Math.max(2, Math.ceil((bz1 - bz0) / cell) + 1), n = nx * nz;
  const H = new Float64Array(n), W = new Float64Array(n).fill(NONE), hard = new Array(n).fill(null), soft = new Array(n).fill(null), locked = new Uint8Array(n);
  const bodies = [];
  const X = i => x0 + i * cell, Z = j => z0 + j * cell;
  const height = (x, z) => {
    let fx = (x - x0) / cell, fz = (z - z0) / cell;
    fx = fx < 0 ? 0 : fx > nx - 1 ? nx - 1 : fx; fz = fz < 0 ? 0 : fz > nz - 1 ? nz - 1 : fz;
    let i = Math.floor(fx), j = Math.floor(fz); if (i > nx - 2) i = nx - 2; if (j > nz - 2) j = nz - 2;
    const tx = fx - i, tz = fz - j, k = j * nx + i;
    const a = H[k] + (H[k + 1] - H[k]) * tx, b = H[k + nx] + (H[k + nx + 1] - H[k + nx]) * tx;
    return a + (b - a) * tz;
  };
  const each = (ax0, az0, ax1, az1, fn) => {
    const i0 = Math.max(0, Math.ceil((ax0 - x0) / cell)), i1 = Math.min(nx - 1, Math.floor((ax1 - x0) / cell));
    const j0 = Math.max(0, Math.ceil((az0 - z0) / cell)), j1 = Math.min(nz - 1, Math.floor((az1 - z0) / cell));
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) fn(j * nx + i, X(i), Z(j));
  };

  // 1. the base: rolling ground, optional ridges, and a rim of hills that frames the map
  for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) {
    const x = X(i), z = Z(j);
    let h = s.base;
    if (s.relief) h += s.relief * (N(x, z, s.scale, 3) - 0.5) * 2;
    if (s.ridges) { const r = 1 - Math.abs(2 * N(x + 517, z - 233, s.scale * 0.8, 2) - 1); h += s.relief * s.ridges * r * r * 2; }
    if (s.edge) {
      const d = Math.min(x - bx0, bx1 - x, z - bz0, bz1 - z);
      if (d < s.edge.width) h += s.edge.height * sstep(1 - d / s.edge.width) * (0.7 + 0.6 * N(x - 811, z + 409, 70, 2));
    }
    H[j * nx + i] = h;
  }

  // 2. features, in the order given: later ones work on top of earlier ones
  const water = (k, h, level, f) => { H[k] = h; W[k] = level; hard[k] = level - h < 2.2 ? (f.beach || "Sand") : (f.bed || "Mud"); };
  const shoreBand = (k, s01, level, f) => {
    const target = level + 0.35 + 1.4 * s01;
    H[k] = Math.max(target + (H[k] - target) * sstep(s01), level + 0.35);
    if (s01 < 0.6) hard[k] = f.beach || "Sand";
  };
  s.features.forEach((f, fi) => {
    const t = f.type;
    if (SHAPES[t]) {
      const d0 = SHAPES[t], R = f.radius, ht = f.height !== undefined ? f.height : (t === "mountain" ? 60 : t === "mesa" ? 24 : t === "dip" ? -8 : 14);
      const flat = f.flat !== undefined ? f.flat : d0.flat, rough = f.rough !== undefined ? f.rough : d0.rough, ax = f.at[0], az = f.at[1];
      each(ax - R * 1.2, az - R * 1.2, ax + R * 1.2, az + R * 1.2, (k, x, z) => {
        const re = R * (0.85 + 0.3 * N(x + 37 * fi, z - 53 * fi, R * 0.7, 2)), tt = hyp(x - ax, z - az) / re;
        if (tt >= 1) return;
        const u = flat >= 1 ? 0 : G.clamp((tt - flat) / (1 - flat), 0, 1), prof = (Math.cos(Math.PI * u) + 1) / 2;
        let add = ht * prof;
        if (rough) add += Math.abs(ht) * rough * (N(x - 71 * fi, z + 29 * fi, 14, 2) - 0.5) * 2 * prof;
        H[k] += add;
      });
    } else if (t === "lake") {
      const R = f.radius, depth = f.depth || 8, shore = f.shore !== undefined ? f.shore : 8, ax = f.at[0], az = f.at[1];
      const level = f.level !== undefined ? f.level : r2(height(ax, az) - 1);
      f.level = level; bodies.push({ type: "lake", id: f.id, at: [ax, az], radius: R, level });
      const m = R * 1.15 + shore;
      each(ax - m, az - m, ax + m, az + m, (k, x, z) => {
        const re = R * (0.88 + 0.24 * N(x + 61 * fi, z + 17 * fi, R * 0.8, 2)), d = hyp(x - ax, z - az);
        if (d < re) { const tt = d / re; water(k, level - 0.6 - depth * (1 - tt * tt), level, f); }
        else if (shore > 0 && d < re + shore) shoreBand(k, (d - re) / shore, level, f);
      });
    } else if (t === "river") {
      const P = f.points, width = f.width || 12, depth = f.depth || 4, bank = f.bank !== undefined ? f.bank : 8;
      let level = f.level;
      if (level === undefined && f.joins) { const b = bodies.find(q => q.id === f.joins); if (b) level = b.level; }
      if (level === undefined) { level = Infinity; for (const p of P) level = Math.min(level, height(p[0], p[1])); level = r2(level - 1); }
      f.level = level; bodies.push({ type: "river", id: f.id, points: P, width, level });
      let ax0 = Infinity, az0 = Infinity, ax1 = -Infinity, az1 = -Infinity;
      for (const p of P) { ax0 = Math.min(ax0, p[0]); az0 = Math.min(az0, p[1]); ax1 = Math.max(ax1, p[0]); az1 = Math.max(az1, p[1]); }
      const m = width / 2 * 1.15 + bank;
      each(ax0 - m, az0 - m, ax1 + m, az1 + m, (k, x, z) => {
        let d = Infinity;
        for (let q = 1; q < P.length; q++) d = Math.min(d, seg(x, z, P[q - 1], P[q])[0]);
        const hw = width / 2 * (0.85 + 0.3 * N(x + 43 * fi, z - 11 * fi, 40, 2));
        if (d < hw) { const tt = d / hw; water(k, level - 0.6 - depth * (1 - tt * tt), level, f); }
        else if (bank > 0 && d < hw + bank) shoreBand(k, (d - hw) / bank, level, f);
      });
    } else if (t === "flatten" || t === "field") {
      // a level pad (circle or rotated rectangle) blended into its surroundings
      const blend = f.blend !== undefined ? f.blend : (t === "field" ? 10 : 12), rot = f.rot || 0;
      let cx, cz, hw = 0, hd = 0, R = 0;
      if (f.rect) { cx = (f.rect[0] + f.rect[2]) / 2; cz = (f.rect[1] + f.rect[3]) / 2; hw = Math.abs(f.rect[2] - f.rect[0]) / 2; hd = Math.abs(f.rect[3] - f.rect[1]) / 2; }
      else if (f.size) { cx = f.at[0]; cz = f.at[1]; hw = f.size[0] / 2; hd = f.size[1] / 2; }
      else if (f.at && f.radius) { cx = f.at[0]; cz = f.at[1]; R = f.radius; }
      else throw new Error(`terrain feature ${fi + 1} (${t}) needs rect: [x0, z0, x1, z1], at + size: [w, d], or at + radius`);
      const level = f.height !== undefined ? f.height : r2(height(cx, cz)), reach = (R || hyp(hw, hd)) + blend;
      f.height = level;
      const rows = f.rows || 4, flatten = f.flatten !== false, mat = f.material || (t === "field" ? "Mud" : null), alt = f.alt || (t === "field" ? "LeafyGrass" : null);
      each(cx - reach, cz - reach, cx + reach, cz + reach, (k, x, z) => {
        let out, lx = 0;
        if (R) out = hyp(x - cx, z - cz) - R;
        else {
          const l = G.w2l(cx, cz, rot, x, z), ex = Math.abs(l[0]) - hw, ez = Math.abs(l[1]) - hd; lx = l[0];
          out = ex > 0 || ez > 0 ? hyp(Math.max(ex, 0), Math.max(ez, 0)) : Math.max(ex, ez);
        }
        if (out >= blend) return;
        if (out <= 0) {
          if (flatten) { H[k] = level; locked[k] = 1; }
          if (mat) hard[k] = t === "field" && alt && Math.floor((lx + hw) / rows) % 2 === 1 ? alt : mat;
        } else if (flatten) H[k] = level + (H[k] - level) * sstep(out / blend);
      });
    } else if (t === "outcrop") {
      const R = f.radius, ht = f.height !== undefined ? f.height : 5, ax = f.at[0], az = f.at[1];
      each(ax - R * 1.2, az - R * 1.2, ax + R * 1.2, az + R * 1.2, (k, x, z) => {
        const re = R * (0.8 + 0.4 * N(x + 19 * fi, z + 83 * fi, R * 0.6, 2)), tt = hyp(x - ax, z - az) / re;
        if (tt >= 1) return;
        H[k] += ht * (1 - sstep(tt)) * (0.55 + 0.9 * N(x - 7 * fi, z + 3 * fi, 5, 2));
        if (tt < 0.9) hard[k] = f.material || "Rock";
      });
    } else if (t === "paint" || t === "patches") {
      const scale = f.scale || 120, oct = f.octaves || 2, above = f.above !== undefined ? f.above : (t === "patches" ? 0.55 : 0), below = f.below !== undefined ? f.below : 1;
      const off = f.offset || [0, 0], target = t === "patches" ? soft : hard;
      let box = [bx0, bz0, bx1, bz1], inside = () => true;
      if (f.at && f.radius) { const R = f.radius; box = [f.at[0] - R, f.at[1] - R, f.at[0] + R, f.at[1] + R]; inside = (x, z) => hyp(x - f.at[0], z - f.at[1]) < R; }
      else if (f.rect) { box = f.rect; inside = (x, z) => x >= f.rect[0] && x <= f.rect[2] && z >= f.rect[1] && z <= f.rect[3]; }
      each(box[0], box[1], box[2], box[3], (k, x, z) => {
        if (!inside(x, z)) return;
        if (above > 0 || below < 1) { const v = N(x + off[0], z + off[1], scale, oct); if (v < above || v > below) return; }
        target[k] = f.material || "LeafyGrass";
      });
    }
  });

  // 3. paths: a level bed along each trail, blended into the slope beside it, painted
  if (s.paths && paths) for (const pa of paths) {
    const P0 = pa.points; if (!P0 || P0.length < 2) continue;
    // resample every 8 studs so the bed follows the ground (and eases into pads) instead of
    // cutting straight lines between far-apart points
    const P = [P0[0]];
    for (let q = 1; q < P0.length; q++) {
      const a = P0[q - 1], b = P0[q], m = Math.max(1, Math.ceil(hyp(b[0] - a[0], b[1] - a[1]) / 8));
      for (let st = 1; st <= m; st++) P.push([a[0] + (b[0] - a[0]) * st / m, a[1] + (b[1] - a[1]) * st / m]);
    }
    const hw = (pa.width || 6) / 2, band = hw + (pa.blend !== undefined ? pa.blend : 6), mat = pa.material || (pa.kind === "trail" ? "Ground" : "Cobblestone");
    let tv = P.map(p => height(p[0], p[1]));
    for (let pass = 0; pass < 4; pass++) tv = tv.map((v, q) => (q === 0 || q === tv.length - 1) ? v : (tv[q - 1] + 2 * v + tv[q + 1]) / 4);
    const best = new Map();
    for (let q = 1; q < P.length; q++) {
      const a = P[q - 1], b = P[q];
      each(Math.min(a[0], b[0]) - band, Math.min(a[1], b[1]) - band, Math.max(a[0], b[0]) + band, Math.max(a[1], b[1]) + band, (k, x, z) => {
        const r = seg(x, z, a, b), e = best.get(k);
        if (r[0] < band && (!e || r[0] < e[0])) best.set(k, [r[0], tv[q - 1] + (tv[q] - tv[q - 1]) * r[1]]);
      });
    }
    for (const [k, e] of best) {
      if (W[k] !== NONE) continue;
      if (locked[k]) { if (e[0] <= hw && !hard[k]) hard[k] = mat; continue; } // pads stay level
      if (e[0] <= hw) { H[k] = e[1]; hard[k] = mat; }
      else H[k] = e[1] + (H[k] - e[1]) * sstep((e[0] - hw) / (band - hw));
    }
  }

  // 4. surface material: painted > too steep for grass > snow line > patches > ground
  const slope = new Float64Array(n), mat = new Array(n);
  let lo = Infinity, hi = -Infinity, wtop = NONE;
  for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) {
    const k = j * nx + i;
    const gx = (H[j * nx + Math.min(nx - 1, i + 1)] - H[j * nx + Math.max(0, i - 1)]) / (cell * (Math.min(nx - 1, i + 1) - Math.max(0, i - 1)));
    const gz = (H[Math.min(nz - 1, j + 1) * nx + i] - H[Math.max(0, j - 1) * nx + i]) / (cell * (Math.min(nz - 1, j + 1) - Math.max(0, j - 1)));
    const deg = Math.atan(Math.sqrt(gx * gx + gz * gz)) * 180 / Math.PI;
    slope[k] = deg;
    mat[k] = hard[k] || (deg >= s.rock ? "Rock" : s.snow !== undefined && s.snow !== null && H[k] >= s.snow ? "Snow" : deg >= s.dirt ? "Ground" : soft[k] || s.ground);
    lo = Math.min(lo, H[k]); hi = Math.max(hi, H[k]); if (W[k] > wtop) wtop = W[k];
  }
  return new Sampler(s, { nx, nz, x0, z0, cell, H, W, deg: slope, mat, bodies, lo, hi, wtop });
}

class Sampler {
  constructor(spec, g) { this.spec = spec; Object.assign(this, g); }
  node(x, z) {
    const i = G.clamp(Math.round((x - this.x0) / this.cell), 0, this.nx - 1), j = G.clamp(Math.round((z - this.z0) / this.cell), 0, this.nz - 1);
    return j * this.nx + i;
  }
  height(x, z) {
    const { nx, nz, x0, z0, cell, H } = this;
    let fx = (x - x0) / cell, fz = (z - z0) / cell;
    fx = fx < 0 ? 0 : fx > nx - 1 ? nx - 1 : fx; fz = fz < 0 ? 0 : fz > nz - 1 ? nz - 1 : fz;
    let i = Math.floor(fx), j = Math.floor(fz); if (i > nx - 2) i = nx - 2; if (j > nz - 2) j = nz - 2;
    const tx = fx - i, tz = fz - j, k = j * nx + i;
    const a = H[k] + (H[k + 1] - H[k]) * tx, b = H[k + nx] + (H[k + nx + 1] - H[k + nx]) * tx;
    return a + (b - a) * tz;
  }
  slope(x, z) { return this.deg[this.node(x, z)]; }
  water(x, z) { const w = this.W[this.node(x, z)]; return w === NONE ? null : w; }
  wet(x, z, depth = 0.5) { const w = this.water(x, z); return w !== null && w - this.height(x, z) > depth; }
  material(x, z) { return this.mat[this.node(x, z)]; }
  // Heights under the centre and the four corners of a footprint.
  samples(x, z, fw = 0, fd = 0, rot = 0) {
    const out = [this.height(x, z)];
    if (fw > 0.5 || fd > 0.5) for (const [lx, lz] of [[-fw / 2, -fd / 2], [fw / 2, -fd / 2], [fw / 2, fd / 2], [-fw / 2, fd / 2]]) { const w = G.l2w(x, z, rot, lx, lz); out.push(this.height(w[0], w[1])); }
    return out;
  }
  ground(x, z, fw, fd, rot) { return Math.min(...this.samples(x, z, fw, fd, rot)); }
  // How much the ground rises and falls within r studs: a quick "is this a good spot for a building".
  relief(x, z, r) { let lo = Infinity, hi = -Infinity; for (const [dx, dz] of [[0, 0], [r, 0], [-r, 0], [0, r], [0, -r], [r * 0.7, r * 0.7], [-r * 0.7, -r * 0.7], [r * 0.7, -r * 0.7], [-r * 0.7, r * 0.7]]) { const h = this.height(x + dx, z + dz); lo = Math.min(lo, h); hi = Math.max(hi, h); } return hi - lo; }
  // Compact grid for the preview: heights and water in decimetres, materials as indices.
  preview(maxSide = 200) {
    const step = Math.max(1, Math.ceil(Math.max(this.nx, this.nz) / maxSide)), w = Math.ceil(this.nx / step), h = Math.ceil(this.nz / step);
    const hs = new Int16Array(w * h), ws = new Int16Array(w * h), ms = new Uint8Array(w * h), names = [], idx = new Map();
    for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
      const k = Math.min(this.nz - 1, j * step) * this.nx + Math.min(this.nx - 1, i * step), o = j * w + i, m = this.mat[k];
      hs[o] = G.clamp(Math.round(this.H[k] * 10), -32000, 32000); ws[o] = this.W[k] === NONE ? -32768 : G.clamp(Math.round(this.W[k] * 10), -32000, 32000);
      if (!idx.has(m)) { idx.set(m, names.length); names.push(m); } ms[o] = idx.get(m);
    }
    const b64 = a => Buffer.from(a.buffer, a.byteOffset, a.byteLength).toString("base64");
    const colors = names.map(m => (this.spec.colors && this.spec.colors[m]) || COLORS[m] || "#6A7F3F");
    return { w, h, x0: this.x0, z0: this.z0, cell: this.cell * step, h16: b64(hs), w16: b64(ws), m8: b64(ms), mats: names, colors, water: (this.spec.water && this.spec.water.color) || "#3D8EA3" }; // brighter than Studio's default so the lake bed reads
  }
  stats() {
    const count = {}; for (const m of this.mat) count[m] = (count[m] || 0) + 1;
    return { min: G.round(this.lo, 10), max: G.round(this.hi, 10), water: this.bodies.length, materials: count };
  }
}

// Ground height under each resolved item. Structures sit on the lowest point of their footprint
// (no floating corner); nature sits on its centre; a group (a camp, a rock cluster) shares the
// lowest base of its members so it stays together; ground: "high" (bridges) takes the highest
// point instead, ground: "water" (docks) the water surface; items with abs: true keep their y.
function groundHeights(T, items) {
  const own = items.map(it => it.abs ? 0 : it.ground === "water" ? (T.water(it.x, it.z) !== null ? T.water(it.x, it.z) : T.height(it.x, it.z)) : it.ground === "high" ? Math.max(...T.samples(it.x, it.z, it.fw, it.fd, it.rot)) : it.role === "nature" ? T.height(it.x, it.z) : T.ground(it.x, it.z, it.fw, it.fd, it.rot));
  const group = new Map();
  items.forEach((it, i) => { if (it.group && !it.abs) group.set(it.group, Math.min(group.has(it.group) ? group.get(it.group) : Infinity, own[i])); });
  return items.map((it, i) => it.abs ? 0 : it.group ? group.get(it.group) : own[i]);
}

module.exports = { build, groundHeights, resolve, MATERIALS, COLORS, NONE, TYPES };
