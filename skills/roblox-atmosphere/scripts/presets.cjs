#!/usr/bin/env node
// Atmosphere presets CLI. Needs only Node.
//
//   node presets.cjs list                       names, labels, genres
//   node presets.cjs show <name>                one preset as a Luau table entry
//   node presets.cjs command <name>             Studio command-bar script that applies it
//   node presets.cjs command --file my.json     same, for a preset JSON file (one preset object)
//   node presets.cjs validate [file.json]       range-check presets (default: assets/presets.json)
//   node presets.cjs build                      regenerate AtmospherePresets.luau + the lab's embedded data
//   node presets.cjs check                      validate + fail if generated files are out of date
"use strict";

const fs = require("fs");
const path = require("path");
const gen = require("./luaugen.cjs");

const SKILL = path.resolve(__dirname, "..");
const PRESETS_JSON = path.join(SKILL, "assets/presets.json");
const PRESETS_LUAU = path.join(SKILL, "assets/kit/shared/Atmosphere/AtmospherePresets.luau");
const CONFIG_LUAU = path.join(SKILL, "assets/kit/shared/Atmosphere/AtmosphereConfig.luau");
const LAB = path.join(SKILL, "assets/atmosphere-lab.html");
const GEN_SRC = path.join(__dirname, "luaugen.cjs");

const RANGES = {
  Lighting: {
    ClockTime: [0, 24], Brightness: [0, 10], ExposureCompensation: [-3, 3],
    EnvironmentDiffuseScale: [0, 1], EnvironmentSpecularScale: [0, 1], ShadowSoftness: [0, 1],
    Ambient: "color", OutdoorAmbient: "color", ColorShift_Top: "color", ColorShift_Bottom: "color",
    GlobalShadows: "bool", GeographicLatitude: [-90, 90],
  },
  Atmosphere: { Density: [0, 1], Offset: [0, 1], Glare: [0, 10], Haze: [0, 10], Color: "color", Decay: "color" },
  Grade: { Brightness: [-1, 1], Contrast: [-1, 1], Saturation: [-1, 1], TintColor: "color" },
  Bloom: { Intensity: [0, 1], Size: [0, 56], Threshold: [0, 4] },
  SunRays: { Intensity: [0, 1], Spread: [0, 1] },
  Clouds: { Cover: [0, 1], Density: [0, 1], Color: "color" },
  Sky: { CelestialBodiesShown: "bool", StarCount: [0, 5000], SunAngularSize: [0, 60], MoonAngularSize: [0, 60] },
  DepthOfField: { FarIntensity: [0, 1], FocusDistance: [0, 200], InFocusRadius: [0, 50], NearIntensity: [0, 1] },
};
const TECHNOLOGY = ["Voxel", "ShadowMap", "Future", "Compatibility"];
const WEATHER = ["rain", "storm", "snow", "blizzard", "dust", "ash", "embers", "fireflies", "spores", "bubbles"];
const REVERB = [
  "NoReverb", "GenericReverb", "PaddedCell", "Room", "Bathroom", "LivingRoom", "StoneRoom", "Auditorium",
  "ConcertHall", "Cave", "Arena", "Hangar", "CarpetedHallway", "Hallway", "StoneCorridor", "Alley", "Forest",
  "City", "Mountains", "Quarry", "Plain", "ParkingLot", "SewerPipe", "UnderWater",
];

function ambienceKeys() {
  if (!fs.existsSync(CONFIG_LUAU)) return null;
  const src = fs.readFileSync(CONFIG_LUAU, "utf8");
  const after = src.split("Ambiences = {")[1];
  if (!after) return null;
  const block = after.split("\n\t}")[0];
  const keys = new Set();
  for (const m of block.matchAll(/^\t\t([a-z_]+) = \{/gm)) keys.add(m[1]);
  return keys;
}

function validatePreset(name, p, errors, ambiences) {
  const err = (m) => errors.push(`${name}: ${m}`);
  if (!/^[a-z][a-z0-9_]*$/.test(name)) err("name must be snake_case");
  if (typeof p.Label !== "string") err("Label missing");
  if (!p.Lighting) err("Lighting section missing");
  if (p.Technology && !TECHNOLOGY.includes(p.Technology)) err(`Technology ${p.Technology} not one of ${TECHNOLOGY}`);
  for (const [section, spec] of Object.entries(RANGES)) {
    const s = p[section];
    if (s == null) continue;
    for (const [k, v] of Object.entries(s)) {
      const rule = spec[k];
      if (!rule) { err(`${section}.${k} is not a known property`); continue; }
      if (rule === "color") {
        if (!Array.isArray(v) || v.length !== 3 || v.some((x) => !Number.isInteger(x) || x < 0 || x > 255)) err(`${section}.${k} must be [r,g,b] 0-255`);
      } else if (rule === "bool") {
        if (typeof v !== "boolean") err(`${section}.${k} must be true/false`);
      } else if (typeof v !== "number" || v < rule[0] || v > rule[1]) {
        err(`${section}.${k} = ${v} outside ${rule[0]}..${rule[1]}`);
      }
    }
  }
  if (p.Accent && (!Array.isArray(p.Accent) || p.Accent.length !== 3)) err("Accent must be [r,g,b]");
  if (p.Weather) {
    if (!WEATHER.includes(p.Weather.Type)) err(`Weather.Type ${p.Weather.Type} not one of ${WEATHER}`);
    if (typeof p.Weather.Intensity !== "number" || p.Weather.Intensity < 0 || p.Weather.Intensity > 2) err("Weather.Intensity must be 0..2");
  }
  if (p.Reverb && !REVERB.includes(p.Reverb)) err(`Reverb ${p.Reverb} is not an Enum.ReverbType`);
  if (p.Ambience && ambiences && !ambiences.has(p.Ambience)) err(`Ambience '${p.Ambience}' has no entry in AtmosphereConfig.Ambiences`);
  // Readability guard: a preset this dark needs lights placed by hand, flag it so it's a choice.
  const L = p.Lighting || {};
  const amb = Math.max(...(L.Ambient || [0, 0, 0]), ...(L.OutdoorAmbient || [0, 0, 0]));
  const night = L.ClockTime < 6 || L.ClockTime > 18.5;
  if ((night || L.Brightness === 0) && amb < 20 && (L.ExposureCompensation || 0) < 0.5) {
    return `${name}: very dark (ambient max ${amb}); relies on placed lights / flashlight for readability`;
  }
  return null;
}

function validate(presets) {
  const errors = [];
  const notes = [];
  const ambiences = ambienceKeys();
  for (const [name, p] of Object.entries(presets)) {
    const note = validatePreset(name, p, errors, ambiences);
    if (note) notes.push(note);
  }
  return { errors, notes };
}

function load(file) {
  return JSON.parse(fs.readFileSync(file || PRESETS_JSON, "utf8"));
}

function labWithPresets(html, presets) {
  const data = "/*PRESETS:BEGIN*/" + JSON.stringify(presets) + "/*PRESETS:END*/";
  const genSrc = "/*GEN:BEGIN*/\n" + fs.readFileSync(GEN_SRC, "utf8").trim() + "\n/*GEN:END*/";
  return html
    .replace(/\/\*PRESETS:BEGIN\*\/[\s\S]*?\/\*PRESETS:END\*\//, () => data)
    .replace(/\/\*GEN:BEGIN\*\/[\s\S]*?\/\*GEN:END\*\//, () => genSrc);
}

function outputs(presets) {
  const out = [[PRESETS_LUAU, gen.presetsModule(presets)]];
  if (fs.existsSync(LAB)) out.push([LAB, labWithPresets(fs.readFileSync(LAB, "utf8"), presets)]);
  return out;
}

function main(argv) {
  const [cmd, ...rest] = argv;
  const fileIdx = rest.indexOf("--file");
  const file = fileIdx >= 0 ? rest[fileIdx + 1] : null;

  if (cmd === "list") {
    const presets = load();
    for (const [name, p] of Object.entries(presets)) {
      console.log(`${name.padEnd(20)} ${p.Label.padEnd(32)} ${(p.Genres || []).join(", ")}`);
    }
    return 0;
  }
  if (cmd === "show" || cmd === "command") {
    let name = rest.find((a, i) => !a.startsWith("--") && rest[i - 1] !== "--file");
    let p;
    if (file) {
      p = JSON.parse(fs.readFileSync(file, "utf8"));
      name = name || path.basename(file, ".json");
    } else {
      const presets = load();
      p = presets[name];
      if (!p) {
        console.error(`Unknown preset '${name}'. Try: node presets.cjs list`);
        return 1;
      }
    }
    const { errors } = validate({ [name]: p });
    errors.forEach((e) => console.error("WARN " + e));
    console.log(cmd === "show" ? gen.presetEntry(name, p, "\t") : gen.commandBar(name, p));
    return 0;
  }
  if (cmd === "validate" || cmd === "check" || cmd === "build") {
    const presets = load(cmd === "validate" ? rest[0] : null);
    const { errors, notes } = validate(presets);
    notes.forEach((n) => console.log("note  " + n));
    errors.forEach((e) => console.error("ERROR " + e));
    if (errors.length) return 1;
    if (cmd === "validate") {
      console.log(`${Object.keys(presets).length} presets OK`);
      return 0;
    }
    let stale = 0;
    for (const [target, content] of outputs(presets)) {
      const current = fs.existsSync(target) ? fs.readFileSync(target, "utf8") : "";
      if (current === content) continue;
      if (cmd === "build") {
        fs.mkdirSync(path.dirname(target), { recursive: true });
        fs.writeFileSync(target, content);
        console.log("wrote " + path.relative(SKILL, target));
      } else {
        console.error("STALE " + path.relative(SKILL, target) + " (run: node scripts/presets.cjs build)");
        stale++;
      }
    }
    if (stale) return 1;
    console.log(`${Object.keys(presets).length} presets OK${cmd === "check" ? ", generated files up to date" : ""}`);
    return 0;
  }
  console.log(fs.readFileSync(__filename, "utf8").split("\n").slice(1, 11).map((l) => l.replace(/^\/\/ ?/, "")).join("\n"));
  return cmd ? 1 : 0;
}

module.exports = { validate, load, outputs, labWithPresets };
if (require.main === module) process.exitCode = main(process.argv.slice(2));
