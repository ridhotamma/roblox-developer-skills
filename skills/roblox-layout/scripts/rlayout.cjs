#!/usr/bin/env node
// rlayout: generate, check, preview and export Roblox room / building / map layouts.
//   node rlayout.cjs new <type> [--theme t] [--seed n] [--width n] ... [-o layout.json]
//   node rlayout.cjs check <layout.json> [--json]
//   node rlayout.cjs preview <layout.json> [-o preview.html]
//   node rlayout.cjs export <layout.json> [--out dir] [--format rbxmx,script,module]
//   node rlayout.cjs build <type> [options] --out dir     (new + check + preview + export in one go)
//   node rlayout.cjs kinds [name] | sets | palettes | jump [dy]
"use strict";
const fs = require("fs");
const path = require("path");
const G = require("./lib/geom.cjs");
const C = require("./lib/catalog.cjs");
const K = require("./lib/check.cjs");
const I = require("./lib/interior.cjs");
const O = require("./lib/outdoor.cjs");
const X = require("./lib/export.cjs");

const ROOMS = Object.keys(I.SIZES);
const GENERATORS = {
  room: o => I.room(o), house: o => I.house(o), obby: o => O.obby(o), tycoon: o => O.tycoon(o), city: o => O.city(o), wilderness: o => O.wilderness(o),
};
for (const r of ROOMS) GENERATORS[r] = o => I.room(Object.assign({ theme: r }, o));

function args(argv) {
  const o = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "-o") o.out = argv[++i];
    else if (a.startsWith("--")) { const k = a.slice(2).replace(/-([a-z])/g, (_, c) => c.toUpperCase()), v = argv[i + 1]; if (v === undefined || v.startsWith("--")) o[k] = true; else { o[k] = /^-?\d+(\.\d+)?$/.test(v) ? Number(v) : v; i++; } }
    else o._.push(a);
  }
  return o;
}
function generate(type, o) {
  if (!GENERATORS[type]) throw new Error(`unknown layout type "${type}". Types: ${Object.keys(GENERATORS).join(", ")}`);
  return GENERATORS[type](o);
}
function read(file) {
  if (!file) throw new Error("give a layout .json file");
  const L = C.load(JSON.parse(fs.readFileSync(file, "utf8")));
  return L;
}
const slug = s => (s || "layout").replace(/[^A-Za-z0-9]+/g, "");
function write(file, text) { fs.mkdirSync(path.dirname(path.resolve(file)), { recursive: true }); fs.writeFileSync(file, text); console.log(`wrote ${file} (${(Buffer.byteLength(text) / 1024).toFixed(0)} KB)`); }
function exportAll(L, dir, formats) {
  const name = slug(L.layout.name);
  if (formats.includes("rbxmx")) write(path.join(dir, name + ".rbxmx"), X.toRbxmx(L));
  if (formats.includes("script")) write(path.join(dir, name + ".lua"), X.toScript(L));
  if (formats.includes("module")) write(path.join(dir, name + ".module.luau"), X.toModule(L));
}

function main() {
  const [cmd, ...rest] = process.argv.slice(2), o = args(rest);
  switch (cmd) {
    case "new": {
      const lay = generate(o._[0], o), text = JSON.stringify(lay, null, 1).replace(/\[\n\s+(-?[\d.]+),\n\s+(-?[\d.]+)(?:,\n\s+(-?[\d.]+))?\n\s+\]/g, (m, a, b, c) => `[${a}, ${b}${c !== undefined ? ", " + c : ""}]`);
      if (o.out) { write(o.out, text); console.log(K.text(K.check(C.load(lay), { grid: false }), 12)); } else console.log(text);
      break;
    }
    case "check": {
      const rep = K.check(read(o._[0]), { grid: false });
      if (o.json) console.log(JSON.stringify(rep, null, 1)); else console.log(K.text(rep, o.all ? 1000 : 40));
      process.exitCode = rep.counts.error ? 1 : 0;
      break;
    }
    case "preview": {
      const L = read(o._[0]), rep = K.check(L);
      write(o.out || o._[0].replace(/\.json$/, "") + ".preview.html", X.previewHtml(L, rep)); console.log(K.text(rep, 12));
      break;
    }
    case "export": {
      const L = read(o._[0]);
      exportAll(L, o.out || path.dirname(o._[0]), String(o.format || "rbxmx,script,module").split(","));
      break;
    }
    case "build": {
      const lay = generate(o._[0], o), dir = o.out || ".", name = slug(lay.name), L = C.load(lay), rep = K.check(L);
      write(path.join(dir, name + ".layout.json"), JSON.stringify(lay));
      write(path.join(dir, name + ".preview.html"), X.previewHtml(L, rep));
      exportAll(L, dir, String(o.format || "rbxmx,script,module").split(","));
      console.log(K.text(rep, 12));
      break;
    }
    case "kinds": {
      if (o._[0]) { const k = C.K[o._[0]]; if (!k) throw new Error(`no kind "${o._[0]}"`); console.log(JSON.stringify({ size: k.size, foot: k.foot, role: k.role, anchor: k.anchor, clear: k.clear, space: k.space, parts: k.parts.length }, null, 1)); break; }
      const by = {}; for (const [name, k] of Object.entries(C.K)) (by[k.role] = by[k.role] || []).push(`${name} ${k.size.join("x")}${k.clear ? " clear " + Object.entries(k.clear).map(e => e.join(":")).join(",") : ""}`);
      for (const r of Object.keys(by)) console.log(`${r}\n  ${by[r].join("\n  ")}`);
      console.log("\nsize is width x height x depth in studs; front is -Z; clear is the free floor needed (f front, b back, l left, r right).");
      break;
    }
    case "sets": for (const s of Object.keys(C.SETS)) { const b = C.setBounds(s); console.log(`${s.padEnd(12)} ${G.round(b.w, 10)} x ${G.round(b.d, 10)} studs  ${C.SETS[s]().map(i => i.kind).join(", ")}`); } break;
    case "palettes": for (const [k, v] of Object.entries(C.PALETTES)) console.log(`${k.padEnd(11)} ${Object.entries(v).map(e => e.join(" ")).join("  ")}`); break;
    case "jump": {
      const m = { walkSpeed: o.speed || 16, jumpHeight: o.height || 7.2, gravity: o.gravity || 196.2 };
      console.log(`WalkSpeed ${m.walkSpeed}, JumpHeight ${m.jumpHeight}, Gravity ${m.gravity}\nrise  reach  comfortable gap  hard gap  max gap`);
      for (const dy of o._.length ? o._.map(Number) : [-8, -4, 0, 2, 4, 6]) { const r = G.jumpReach(dy, m); console.log(`${String(dy).padStart(4)}  ${r.toFixed(1).padStart(5)}  ${Math.max(1, r - 2.5).toFixed(1).padStart(15)}  ${(r - 1.2).toFixed(1).padStart(8)}  ${(r + 1).toFixed(1).padStart(7)}`); }
      break;
    }
    case "build-kit": write(path.join(__dirname, "..", "assets", "kit", "shared", "Layout", "LayoutCatalog.luau"), X.catalogModule(C)); break;
    default:
      console.log(`rlayout: Roblox layout design tool

  new <type> [options] [-o layout.json]   generate a layout spec
  check <layout.json> [--json] [--all]    spacing report: tight, loose, blocked, unreachable
  preview <layout.json> [-o file.html]    3D + plan preview with the report built in
  export <layout.json> [--out dir] [--format rbxmx,script,module]
  build <type> [options] --out dir        all of the above in one go
  kinds [name] | sets | palettes          the object catalog
  jump [rise ...] [--speed n --height n]  jump reach table for obbies

types: ${Object.keys(GENERATORS).join(", ")}
options: --seed n  --name s  --palette p  --width n --depth n --height n  (rooms)
         --stages n --jumps n --easy 0..1 --hard 0..1  (obby)   --plots n  (tycoon)
         --blocks-x n --blocks-z n  (city)   --size n --pois n --lakes n  (wilderness)`);
  }
}
if (require.main === module) { try { main(); } catch (e) { console.error("error: " + e.message); process.exit(2); } }
module.exports = { generate, GENERATORS, args };
