#!/usr/bin/env node
// Offline checks for the layout skill: every generator produces a clean layout, the checker
// catches the mistakes it claims to, exports are well-formed, and (when the `luau` CLI is
// installed) the Luau kit generates exactly what the JavaScript preview shows.
// Run: node scripts/selftest.cjs
"use strict";
const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");
const C = require("./lib/catalog.cjs");
const K = require("./lib/check.cjs");
const X = require("./lib/export.cjs");
const G = require("./lib/geom.cjs");
const { generate, GENERATORS } = require("./rlayout.cjs");

const SKILL = path.resolve(__dirname, "..");
let failures = 0;
const ok = (cond, msg) => { console.log((cond ? "ok   " : "FAIL ") + msg); if (!cond) failures++; };
const check = lay => K.check(C.load(lay), { grid: false });
const codes = rep => new Set(rep.issues.map(i => i.code));

// 1. generators: clean, balanced, deterministic
for (const type of Object.keys(GENERATORS)) {
  if (type === "room") continue;
  const seeds = ["city", "wilderness", "tycoon"].includes(type) ? [1, 2] : [1, 2, 3];
  let worst = 100, errors = 0;
  for (const seed of seeds) { const rep = check(generate(type, { seed })); worst = Math.min(worst, rep.score); errors += rep.counts.error; }
  ok(errors === 0 && worst >= 90, `${type}: no errors, score ${worst}+ over seeds ${seeds.join(", ")}`);
}
ok(JSON.stringify(generate("wilderness", { seed: 9 })) === JSON.stringify(generate("wilderness", { seed: 9 })), "same seed gives the same wilderness");
ok(JSON.stringify(generate("obby", { seed: 4 })) !== JSON.stringify(generate("obby", { seed: 5 })), "different seeds give different obbies");
ok(check(generate("obby", { seed: 3, stages: 10, jumps: 9, hard: 1 })).counts.error === 0, "a long, hard obby is still beatable");
ok(check(generate("restaurant", { width: 46, depth: 44 })).counts.error === 0 && check(generate("restaurant", { width: 90, depth: 60 })).counts.error === 0, "restaurant adapts to small and large rooms");

// 2. the checker catches what it should
const room = extra => ({ type: "interior", spawn: [15, 0, 27], items: [{ walls: { rect: [0, 0, 30, 30], openings: [{ side: "south", at: 0.5, width: 6 }] } }, ...extra] });
ok(codes(check(room([{ kind: "sofa", pos: [10, 0, 10] }, { kind: "bookshelf", pos: [12, 0, 10] }]))).has("overlap"), "overlap is an error");
ok(codes(check(room([{ kind: "crate", pos: [10, 0, 10] }, { kind: "crate", pos: [15, 0, 10] }]))).has("dead-gap"), "a 2 stud gap between crates is a dead gap");
ok(!codes(check(room([{ kind: "crate", pos: [10, 0, 10] }, { kind: "crate", pos: [13, 0, 10] }, { kind: "crate", pos: [20, 0, 10] }]))).has("dead-gap"), "touching or 4 studs apart is fine");
ok(codes(check(room([{ kind: "wardrobe", pos: [15, 0, 3.5], rot: 180 }]))).has("off-wall"), "furniture floating 2 studs off a wall is flagged");
ok(codes(check(room([{ kind: "counter", pos: [15, 0, 10], rot: 180 }, { kind: "crate", pos: [15, 0, 14] }]))).has("blocked"), "a crate in front of a counter blocks it");
ok(codes(check(room([{ kind: "shelf", pos: [15, 0, 1], rot: 180 }, { row: { kind: "crate", from: [1.5, 8], to: [28.5, 8], count: 10 } }]))).has("unreachable"), "a walled-off shelf is unreachable");
ok(codes(check(room([{ kind: "plant", pos: [2, 0, 2] }]))).has("empty") || codes(check(room([{ kind: "plant", pos: [2, 0, 2] }]))).has("sparse"), "an almost empty room is too loose");
ok(codes(check({ type: "interior", spawn: [10, 0, 18], items: [{ walls: { rect: [0, 0, 20, 20], height: 9, openings: [{ side: "south", at: 0.5, width: 4, head: 6 }] } }, { set: "lounge", pos: [10, 0, 8] }] })).has("low-ceiling"), "a 9 stud ceiling is flagged for the camera");
const plat = (id, x, y, extra) => Object.assign({ id, kind: "platform", role: "platform", pos: [x, y, 0], size: [6, 1, 6] }, extra);
const jump = (gap, dy) => check({ type: "obby", items: [plat("a", 0, 10, { tags: ["checkpoint"] }), plat("b", 6 + gap, 10 + dy)], route: ["a", "b"] });
ok(codes(jump(14, 0)).has("too-far") && codes(jump(4, 8)).has("too-high") && jump(5, 0).counts.error === 0, "jump checks: 14 stud gap and 8 stud rise fail, 5 stud gap passes");
ok(Math.abs(G.jumpReach(0) - 8.67) < 0.02 && Math.abs(G.jumpReach(4) - 7.23) < 0.05, "jump reach matches the level-design table (8.7 flat, 7.2 at +4)");
ok(G.distribute(34, [6, 6, 6], 4, "even").join() === "7,17,27" && G.distribute(30, [6, 6, 6], 4, "even").join() === "9,15,21" && G.distribute(18.4, [6, 6, 6], 4, "even").map(v => Math.round(v * 10)).join() === "32,92,152" && G.distribute(20, [6, 6, 6], 4) === null, "distribute: even gaps, else touching and centred, never a dead gap");

// 3. authoring macros and the example spec
const hub = JSON.parse(fs.readFileSync(path.join(SKILL, "examples", "simulator_hub.json"), "utf8")), hubL = C.load(hub), hubRep = K.check(hubL);
ok(hubL.items.length > 100 && hubRep.counts.error === 0 && hubRep.score >= 90, `example simulator_hub.json expands to ${hubL.items.length} objects and scores ${hubRep.score}`);
ok(C.setBounds("dining4").w > 8 && C.load({ items: [{ set: "dining4", pos: [0, 0, 0] }] }).items.length === 5, "sets expand (dining4 = table + 4 chairs)");

// 4. exports
const L = C.load(generate("cafe", { seed: 1 })), rep = K.check(L);
const balanced = (src, o, c) => (src.split(o).length === src.split(c).length);
const html = X.previewHtml(L, rep);
ok(html.includes('"report"') && !html.includes("/*__DATA__*/null") && html.length > 50000, "preview embeds the layout and the report");
ok(rep.grid && Buffer.from(rep.grid.data, "base64").length === rep.grid.w * rep.grid.h, "walk-width grid has one byte per cell");
const rb = X.toRbxmx(L);
ok((rb.match(/<Item /g) || []).length === (rb.match(/<\/Item>/g) || []).length && !/NaN|undefined|Infinity/.test(rb) && (rb.match(/class="Part"/g) || []).length > 150, "rbxmx is balanced, has no NaN, and holds the parts");
const sc = X.toScript(L), mo = X.toModule(L);
ok(balanced(sc, "{", "}") && balanced(sc, "(", ")") && sc.includes("LayoutBuilder.Build") && !/NaN|undefined/.test(mo) && mo.startsWith("--!nocheck"), "command-bar script and module are well-formed Luau tables");
ok(Object.values(C.K).every(k => k.size.length === 3 && k.role && k.parts.every(p => X.MATERIAL[p.m || "SmoothPlastic"])), `catalog: ${Object.keys(C.K).length} kinds, all with sizes, roles and real materials`);

// 5. kit
const KIT = path.join(SKILL, "assets", "kit", "shared", "Layout");
for (const f of ["LayoutBuilder", "LayoutCatalog", "Rng", "Scatter", "Spacing", "WorldGen", "ObbyGen"]) ok(fs.existsSync(path.join(KIT, f + ".luau")), `kit has ${f}.luau`);
ok(fs.readFileSync(path.join(KIT, "LayoutCatalog.luau"), "utf8") === X.catalogModule(C), "LayoutCatalog.luau is current (else run: node scripts/rlayout.cjs build-kit)");
let luau = true; try { execFileSync("luau", [path.join(__dirname, "kitdump.luau"), "-a", "rng", "1"], { stdio: "pipe" }); } catch (e) { luau = false; }
if (!luau) console.log("skip luau CLI not found: kit parity checks skipped (brew install luau)");
else {
  const run = (...a) => JSON.parse(execFileSync("luau", [path.join(__dirname, "kitdump.luau"), "-a", ...a.map(String)], { maxBuffer: 1 << 26 }).toString());
  const r = G.rng(7), nz = G.noise2(7), lu = run("rng", 7), js = [];
  for (let i = 0; i < 8; i++) js.push(r.next()); for (let i = 1; i <= 4; i++) js.push(nz(i * 37.5, -i * 11.25, 90, 2));
  ok(js.every((v, i) => Math.abs(v - lu[i]) < 1e-8), "Luau Rng and Noise match the JavaScript ones");
  ok(lu[15] === 0 && lu[16] === "dead-gap" && lu[17] === 1 && lu[18] === 1 && lu[19] === 100, "Luau Spacing.CanPlace rejects a dead gap; JitterCell is deterministic");
  for (const [type, seed] of [["wilderness", 3], ["obby", 3], ["obby", 11]]) {
    const a = run(type, seed), b = generate(type, { seed });
    const same = a.items.length === b.items.length && a.items.every((it, i) => it.kind === b.items[i].kind && Math.abs(it.pos[0] - b.items[i].pos[0]) < 0.02 && Math.abs(it.pos[2] - b.items[i].pos[2]) < 0.02 && (it.rot || 0) === (b.items[i].rot || 0));
    ok(same, `Luau ${type === "obby" ? "ObbyGen" : "WorldGen"} seed ${seed} builds the same ${a.items.length} objects as the preview`);
  }
}

// 6. docs
const skill = fs.readFileSync(path.join(SKILL, "SKILL.md"), "utf8");
for (const f of ["spacing-metrics.md", "composition.md", "genre-layouts.md", "procedural.md", "layout-spec.md"]) ok(fs.existsSync(path.join(SKILL, "references", f)) && skill.includes(f), `references/${f} exists and SKILL.md points to it`);

console.log(failures ? `\n${failures} check(s) failed` : "\nall checks passed");
process.exit(failures ? 1 : 0);
