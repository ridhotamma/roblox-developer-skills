#!/usr/bin/env node
// Offline checks for the atmosphere skill: presets valid, generated files current, Luau output
// well-formed, kit files and references present. Run: node scripts/selftest.cjs
"use strict";

const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");
const gen = require("./luaugen.cjs");
const presets = require("./presets.cjs");

const SKILL = path.resolve(__dirname, "..");
let failures = 0;
function ok(cond, msg) {
  console.log((cond ? "ok   " : "FAIL ") + msg);
  if (!cond) failures++;
}

function balanced(src) {
  // Strip strings and comments, then check (), {} and [] balance.
  const s = src.replace(/--\[\[[\s\S]*?\]\]/g, "").replace(/--[^\n]*/g, "").replace(/"(\\.|[^"\\])*"/g, '""').replace(/`(\\.|[^`\\])*`/g, "``");
  const pairs = { ")": "(", "}": "{", "]": "[" };
  const stack = [];
  for (const ch of s) {
    if ("({[".includes(ch)) stack.push(ch);
    else if (pairs[ch]) { if (stack.pop() !== pairs[ch]) return false; }
  }
  return stack.length === 0;
}

function blocksBalanced(src) {
  // Rough Luau block check: catches a stray `end` (if-expressions make it unable to catch a missing one).
  const s = src.replace(/--\[\[[\s\S]*?\]\]/g, "").replace(/--[^\n]*/g, "").replace(/"(\\.|[^"\\])*"/g, '""').replace(/`(\\.|[^`\\])*`/g, "``");
  const words = s.match(/\b[A-Za-z_]+\b/g) || [];
  let depth = 0;
  for (let i = 0; i < words.length; i++) {
    const w = words[i];
    if (w === "function" || w === "do" || w === "repeat") depth++;
    else if (w === "then") {
      // `if a then b else c` expressions have no `end`; only statement ifs open a block.
      depth++;
    } else if (w === "end" || w === "until") depth--;
    if (depth < 0) return false;
  }
  return depth >= 0;
}

// 1. presets
const data = presets.load();
const { errors } = presets.validate(data);
ok(errors.length === 0, `presets.json valid (${Object.keys(data).length} presets)${errors.length ? ": " + errors.join("; ") : ""}`);
ok(Object.keys(data).length >= 20, "at least 20 genre presets");

// 2. generated files are current
for (const [target, content] of presets.outputs(data)) {
  const current = fs.existsSync(target) ? fs.readFileSync(target, "utf8") : "";
  ok(current === content, `${path.relative(SKILL, target)} up to date`);
}

// 3. Luau generation
const mod = gen.presetsModule(data);
ok(balanced(mod), "AtmospherePresets.luau brackets balanced");
ok(!/\bnull\b|undefined|NaN/.test(mod), "AtmospherePresets.luau has no null/undefined/NaN");
for (const name of Object.keys(data)) {
  const cmd = gen.commandBar(name, data[name]);
  if (!balanced(cmd) || /\bnull\b|undefined|NaN/.test(cmd)) { ok(false, `command-bar script for ${name}`); }
}
ok(true, "command-bar scripts generated for every preset");
const custom = { Label: "Custom", Lighting: { ClockTime: 23.5, Brightness: 1, Ambient: [1, 2, 3], OutdoorAmbient: [4, 5, 6] } };
const cb = gen.commandBar("custom", custom);
ok(/AtmosphereGrade"\), \{ Brightness = 0, Contrast = 0/.test(cb), "missing sections fade to neutral in the command-bar script");
ok(gen.value([255, 128, 0]) === "Color3.fromRGB(255, 128, 0)", "colour arrays become Color3.fromRGB");
ok(gen.value(["a", "b", "c"]) === '{ "a", "b", "c" }', "string arrays stay arrays");

// 4. CLI
const out = execFileSync(process.execPath, [path.join(__dirname, "presets.cjs"), "command", "horror_woods"], { encoding: "utf8" });
ok(out.includes("Enum.ReverbType.Forest") && out.includes("SetWaypoint"), "CLI command prints a command-bar script");
const list = execFileSync(process.execPath, [path.join(__dirname, "presets.cjs"), "list"], { encoding: "utf8" });
ok(list.split("\n").filter(Boolean).length === Object.keys(data).length, "CLI list shows every preset");

// 5. kit files
const kit = [
  "shared/Atmosphere/Atmosphere.luau", "shared/Atmosphere/AtmosphereConfig.luau", "shared/Atmosphere/AtmospherePresets.luau",
  "server/Services/AtmosphereService.luau", "client/Controllers/AtmosphereController.luau",
  "client/Atmosphere/Weather.luau", "client/Atmosphere/Ambience.luau", "client/Atmosphere/Tension.luau",
  "client/Components/LightFlicker.luau",
];
for (const f of kit) {
  const p = path.join(SKILL, "assets/kit", f);
  const exists = fs.existsSync(p);
  const src = exists ? fs.readFileSync(p, "utf8") : "";
  ok(exists && src.startsWith("--!strict") && balanced(src) && blocksBalanced(src), `kit ${f}`);
}

// 6. lab and references
const lab = fs.readFileSync(path.join(SKILL, "assets/atmosphere-lab.html"), "utf8");
ok(/\/\*PRESETS:BEGIN\*\/\{"/.test(lab), "lab has embedded presets");
ok(lab.includes("presetEntry: presetEntry"), "lab has the embedded Luau generator");
const skill = fs.readFileSync(path.join(SKILL, "SKILL.md"), "utf8");
for (const ref of new Set(skill.match(/references\/[a-z-]+\.md/g) || [])) {
  ok(fs.existsSync(path.join(SKILL, ref)), `${ref} exists`);
}

console.log(failures ? `\n${failures} check(s) failed` : "\nall checks passed");
process.exitCode = failures ? 1 : 0;
