// The Roblox types the combat kit uses, in JS, with Roblox's semantics (and the same ones as
// skills/roblox-combat/tests/RobloxShim.luau): Vector3, CFrame (columns = Right, Up, -Look;
// fromEulerAnglesYXZ = Ry*Rx*Rz), a deterministic Random, math.noise (Luau's Perlin), and a
// world of axis-aligned boxes with Raycast / Spherecast that ignore boxes they start inside.
// Method names follow Luau (v.Unit, v.Magnitude, a.Dot(b), cf.LookVector) so kit.js reads like
// the .luau files line for line. Works in Node (require) and the browser (window.Rbx).
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Rbx = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  class Vector3 {
    constructor(x = 0, y = 0, z = 0) { this.X = x; this.Y = y; this.Z = z; }
    static new(x = 0, y = 0, z = 0) { return new Vector3(x, y, z); }
    get Magnitude() { return Math.sqrt(this.X * this.X + this.Y * this.Y + this.Z * this.Z); }
    get Unit() { const m = this.Magnitude; return m === 0 ? new Vector3(NaN, NaN, NaN) : new Vector3(this.X / m, this.Y / m, this.Z / m); }
    add(b) { return new Vector3(this.X + b.X, this.Y + b.Y, this.Z + b.Z); }
    sub(b) { return new Vector3(this.X - b.X, this.Y - b.Y, this.Z - b.Z); }
    mul(s) { return typeof s === 'number' ? new Vector3(this.X * s, this.Y * s, this.Z * s) : new Vector3(this.X * s.X, this.Y * s.Y, this.Z * s.Z); }
    div(s) { return new Vector3(this.X / s, this.Y / s, this.Z / s); }
    neg() { return new Vector3(-this.X, -this.Y, -this.Z); }
    Dot(b) { return this.X * b.X + this.Y * b.Y + this.Z * b.Z; }
    Cross(b) { return new Vector3(this.Y * b.Z - this.Z * b.Y, this.Z * b.X - this.X * b.Z, this.X * b.Y - this.Y * b.X); }
    Lerp(b, t) { return this.add(b.sub(this).mul(t)); }
    toArray() { return [this.X, this.Y, this.Z]; }
  }
  Vector3.zero = new Vector3(0, 0, 0);
  Vector3.one = new Vector3(1, 1, 1);
  Vector3.xAxis = new Vector3(1, 0, 0);
  Vector3.yAxis = new Vector3(0, 1, 0);
  Vector3.zAxis = new Vector3(0, 0, 1);

  const matMul = (a, b) => [0, 1, 2].map((i) => [0, 1, 2].map((j) => a[i][0] * b[0][j] + a[i][1] * b[1][j] + a[i][2] * b[2][j]));
  const matVec = (r, x, y, z) => [r[0][0] * x + r[0][1] * y + r[0][2] * z, r[1][0] * x + r[1][1] * y + r[1][2] * z, r[2][0] * x + r[2][1] * y + r[2][2] * z];
  const IDENTITY = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
  const rx = (a) => { const c = Math.cos(a), s = Math.sin(a); return [[1, 0, 0], [0, c, -s], [0, s, c]]; };
  const ry = (a) => { const c = Math.cos(a), s = Math.sin(a); return [[c, 0, s], [0, 1, 0], [-s, 0, c]]; };
  const rz = (a) => { const c = Math.cos(a), s = Math.sin(a); return [[c, -s, 0], [s, c, 0], [0, 0, 1]]; };

  class CFrame {
    constructor(x, y, z, r) { this.X = x; this.Y = y; this.Z = z; this.R = r; }
    static new(x = 0, y = 0, z = 0) { return x instanceof Vector3 ? new CFrame(x.X, x.Y, x.Z, IDENTITY) : new CFrame(x, y, z, IDENTITY); }
    static Angles(x, y, z) { return new CFrame(0, 0, 0, matMul(matMul(rx(x), ry(y)), rz(z))); }
    static fromEulerAnglesYXZ(x, y, z) { return new CFrame(0, 0, 0, matMul(matMul(ry(y), rx(x)), rz(z))); }
    static lookAt(at, target, up = Vector3.yAxis) {
      const look = target.sub(at).Unit; const right = look.Cross(up).Unit; const upv = right.Cross(look);
      return new CFrame(at.X, at.Y, at.Z, [[right.X, upv.X, -look.X], [right.Y, upv.Y, -look.Y], [right.Z, upv.Z, -look.Z]]);
    }
    get Position() { return new Vector3(this.X, this.Y, this.Z); }
    get LookVector() { const r = this.R; return new Vector3(-r[0][2], -r[1][2], -r[2][2]); }
    get RightVector() { const r = this.R; return new Vector3(r[0][0], r[1][0], r[2][0]); }
    get UpVector() { const r = this.R; return new Vector3(r[0][1], r[1][1], r[2][1]); }
    mul(b) {
      if (b instanceof Vector3) { const [x, y, z] = matVec(this.R, b.X, b.Y, b.Z); return new Vector3(this.X + x, this.Y + y, this.Z + z); }
      const [x, y, z] = matVec(this.R, b.X, b.Y, b.Z); return new CFrame(this.X + x, this.Y + y, this.Z + z, matMul(this.R, b.R));
    }
    add(v) { return new CFrame(this.X + v.X, this.Y + v.Y, this.Z + v.Z, this.R); }
    Inverse() { const r = this.R; const t = [[r[0][0], r[1][0], r[2][0]], [r[0][1], r[1][1], r[2][1]], [r[0][2], r[1][2], r[2][2]]]; const [x, y, z] = matVec(t, -this.X, -this.Y, -this.Z); return new CFrame(x, y, z, t); }
    PointToObjectSpace(p) { return this.Inverse().mul(p); }
    equals(b) { return this.X === b.X && this.Y === b.Y && this.Z === b.Z && this.R.every((row, i) => row.every((x, j) => x === b.R[i][j])); }
    // Three.js-friendly 4x4, column-major
    toMatrix4Array() { const r = this.R; return [r[0][0], r[1][0], r[2][0], 0, r[0][1], r[1][1], r[2][1], 0, r[0][2], r[1][2], r[2][2], 0, this.X, this.Y, this.Z, 1]; }
  }
  CFrame.identity = new CFrame(0, 0, 0, IDENTITY);

  // Park-Miller, identical to the shim's Random so traces draw the same numbers.
  class Random {
    constructor(seed = 1) { const s = Math.floor(Math.abs(seed)) % 2147483647; this.state = s === 0 ? 1 : s; }
    static new(seed) { return new Random(seed); }
    NextNumber(min = 0, max = 1) { this.state = (this.state * 48271) % 2147483647; const u = (this.state - 1) / 2147483646; return min + (max - min) * u; }
  }

  const clamp = (x, a, b) => Math.min(Math.max(x, a), b);
  // Luau's % is floored (a - floor(a/b)*b); JS's is truncated.
  const mod = (a, b) => a - Math.floor(a / b) * b;

  // Luau math.noise: Ken Perlin's improved noise, single precision.
  const PERM = [151, 160, 137, 91, 90, 15, 131, 13, 201, 95, 96, 53, 194, 233, 7, 225, 140, 36, 103, 30, 69, 142, 8, 99, 37, 240, 21, 10, 23, 190, 6, 148, 247, 120, 234, 75, 0, 26, 197, 62, 94, 252, 219, 203, 117, 35, 11, 32, 57, 177, 33, 88, 237, 149, 56, 87, 174, 20, 125, 136, 171, 168, 68, 175, 74, 165, 71, 134, 139, 48, 27, 166, 77, 146, 158, 231, 83, 111, 229, 122, 60, 211, 133, 230, 220, 105, 92, 41, 55, 46, 245, 40, 244, 102, 143, 54, 65, 25, 63, 161, 1, 216, 80, 73, 209, 76, 132, 187, 208, 89, 18, 169, 200, 196, 135, 130, 116, 188, 159, 86, 164, 100, 109, 198, 173, 186, 3, 64, 52, 217, 226, 250, 124, 123, 5, 202, 38, 147, 118, 126, 255, 82, 85, 212, 207, 206, 59, 227, 47, 16, 58, 17, 182, 189, 28, 42, 223, 183, 170, 213, 119, 248, 152, 2, 44, 154, 163, 70, 221, 153, 101, 155, 167, 43, 172, 9, 129, 22, 39, 253, 19, 98, 108, 110, 79, 113, 224, 232, 178, 185, 112, 104, 218, 246, 97, 228, 251, 34, 242, 193, 238, 210, 144, 12, 191, 179, 162, 241, 81, 51, 145, 235, 249, 14, 239, 107, 49, 192, 214, 31, 181, 199, 106, 157, 184, 84, 204, 176, 115, 121, 50, 45, 127, 4, 150, 254, 138, 236, 205, 93, 222, 114, 67, 29, 24, 72, 243, 141, 128, 195, 78, 66, 215, 61, 156, 180];
  const P = PERM.concat(PERM);
  const f32 = Math.fround;
  const fade = (t) => f32(t * t * t * f32(t * f32(t * 6 - 15) + 10));
  const lerp = (t, a, b) => f32(a + f32(t * f32(b - a)));
  const grad = (hash, x, y, z) => {
    const h = hash & 15; const u = h < 8 ? x : y; const v = h < 4 ? y : h === 12 || h === 14 ? x : z;
    return f32((h & 1 ? -u : u) + (h & 2 ? -v : v));
  };
  function noise(x, y = 0, z = 0) {
    x = f32(x); y = f32(y); z = f32(z);
    const xf0 = Math.floor(x), yf0 = Math.floor(y), zf0 = Math.floor(z);
    const xi = xf0 & 255, yi = yf0 & 255, zi = zf0 & 255;
    const xf = f32(x - xf0), yf = f32(y - yf0), zf = f32(z - zf0);
    const u = fade(xf), v = fade(yf), w = fade(zf);
    const a = (P[xi] + yi) & 255, aa = (P[a] + zi) & 255, ab = (P[a + 1] + zi) & 255;
    const b = (P[xi + 1] + yi) & 255, ba = (P[b] + zi) & 255, bb = (P[b + 1] + zi) & 255;
    const la = lerp(u, grad(P[aa], xf, yf, zf), grad(P[ba], f32(xf - 1), yf, zf));
    const lb = lerp(u, grad(P[ab], xf, f32(yf - 1), zf), grad(P[bb], f32(xf - 1), f32(yf - 1), zf));
    const la1 = lerp(u, grad(P[aa + 1], xf, yf, f32(zf - 1)), grad(P[ba + 1], f32(xf - 1), yf, f32(zf - 1)));
    const lb1 = lerp(u, grad(P[ab + 1], xf, f32(yf - 1), f32(zf - 1)), grad(P[bb + 1], f32(xf - 1), f32(yf - 1), f32(zf - 1)));
    return lerp(w, lerp(v, la, lb), lerp(v, la1, lb1));
  }

  // ------------------------------------------------------------------ world of boxes
  class World {
    constructor() { this.boxes = []; }
    Box(name, center, size, model = null, color = 0x4c566a) {
      const half = size.mul(0.5);
      const box = { Name: name, Model: model, Min: center.sub(half), Max: center.add(half), Size: size, Position: center, color };
      this.boxes.push(box);
      return box;
    }
    // Slab test against a box grown by `grow`; starting inside = no hit (Roblox behaviour).
    static sweep(origin, dir, minV, maxV, grow) {
      const o = [origin.X, origin.Y, origin.Z], d = [dir.X, dir.Y, dir.Z];
      const lo = [minV.X - grow, minV.Y - grow, minV.Z - grow], hi = [maxV.X + grow, maxV.Y + grow, maxV.Z + grow];
      let inside = true;
      for (let i = 0; i < 3; i++) if (o[i] <= lo[i] || o[i] >= hi[i]) inside = false;
      if (inside) return null;
      let tEnter = -Infinity, tExit = Infinity, axis = 0, sign = 1;
      for (let i = 0; i < 3; i++) {
        if (Math.abs(d[i]) < 1e-12) { if (o[i] < lo[i] || o[i] > hi[i]) return null; }
        else {
          let t1 = (lo[i] - o[i]) / d[i], t2 = (hi[i] - o[i]) / d[i], s = -1;
          if (t1 > t2) { [t1, t2] = [t2, t1]; s = 1; }
          if (t1 > tEnter) { tEnter = t1; axis = i; sign = s; }
          tExit = Math.min(tExit, t2);
        }
      }
      if (tEnter > tExit || tEnter < 0 || tEnter > 1) return null;
      const n = [0, 0, 0]; n[axis] = sign;
      return { t: tEnter, normal: new Vector3(n[0], n[1], n[2]) };
    }
    cast(origin, dir, exclude, radius) {
      let best = Infinity, bestBox = null, bestNormal = null;
      for (const box of this.boxes) {
        if (exclude && (exclude.includes(box) || (box.Model && exclude.includes(box.Model)))) continue;
        const hit = World.sweep(origin, dir, box.Min, box.Max, radius);
        if (hit && hit.t < best) { best = hit.t; bestBox = box; bestNormal = hit.normal; }
      }
      if (!bestBox) return null;
      return { Instance: bestBox, Position: origin.add(dir.mul(best)), Normal: bestNormal, Distance: dir.Magnitude * best };
    }
    Raycast(origin, direction, exclude) { return this.cast(origin, direction, exclude, 0); }
    Spherecast(origin, radius, direction, exclude) { return this.cast(origin, direction, exclude, radius); }
  }

  return { Vector3, CFrame, Random, World, noise, clamp, mod };
});
