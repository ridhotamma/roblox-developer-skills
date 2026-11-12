// Turns an atmosphere preset (the JSON shape in assets/presets.json) into Luau.
// Shared by presets.cjs (Node) and atmosphere-lab.html (the build copies this file into the
// page between the GEN markers), so the lab's "Copy" buttons and the CLI always agree.
(function (root) {
  "use strict";

  // Section -> the instance it drives. Names match the kit's Atmosphere.luau.
  var SECTIONS = {
    Lighting: { path: "Lighting" },
    Atmosphere: { cls: "Atmosphere", name: "Atmosphere", parent: "Lighting" },
    Grade: { cls: "ColorCorrectionEffect", name: "AtmosphereGrade", parent: "Lighting" },
    Bloom: { cls: "BloomEffect", name: "AtmosphereBloom", parent: "Lighting" },
    SunRays: { cls: "SunRaysEffect", name: "AtmosphereSunRays", parent: "Lighting" },
    DepthOfField: { cls: "DepthOfFieldEffect", name: "AtmosphereDepthOfField", parent: "Lighting" },
    Clouds: { cls: "Clouds", name: "Clouds", parent: "workspace.Terrain" },
    Sky: { cls: "Sky", name: "Sky", parent: "Lighting" },
  };
  var SECTION_ORDER = ["Lighting", "Atmosphere", "Grade", "Bloom", "SunRays", "Clouds", "Sky", "DepthOfField"];
  // What a missing (null) section tweens to: the effect fades out instead of popping.
  var NEUTRAL = {
    Grade: { Brightness: 0, Contrast: 0, Saturation: 0, TintColor: [255, 255, 255] },
    Bloom: { Intensity: 0 },
    SunRays: { Intensity: 0 },
    Clouds: { Cover: 0, Density: 0 },
    DepthOfField: { FarIntensity: 0, NearIntensity: 0 },
  };

  function num(n) {
    var s = String(Math.round(n * 1000) / 1000);
    return s === "-0" ? "0" : s;
  }

  function value(v) {
    if (Array.isArray(v) && v.length === 3 && v.every(function (x) { return typeof x === "number"; })) {
      return "Color3.fromRGB(" + v.map(function (x) { return Math.round(x); }).join(", ") + ")";
    }
    if (Array.isArray(v)) return "{ " + v.map(value).join(", ") + " }";
    if (typeof v === "number") return num(v);
    if (typeof v === "boolean") return v ? "true" : "false";
    if (typeof v === "string") return JSON.stringify(v);
    if (v && typeof v === "object") {
      return "{ " + Object.keys(v).map(function (k) { return k + " = " + value(v[k]); }).join(", ") + " }";
    }
    return "nil";
  }

  // One preset as a Luau table constructor. `indent` is the indent of the closing brace.
  function presetTable(p, indent) {
    indent = indent || "";
    var inner = indent + "\t";
    var lines = ["{"];
    ["Label", "Mood", "Genres", "Technology"].forEach(function (k) {
      if (p[k] != null) lines.push(inner + k + " = " + value(p[k]) + ",");
    });
    SECTION_ORDER.forEach(function (k) {
      if (p[k]) lines.push(inner + k + " = " + value(p[k]) + ",");
    });
    ["Accent", "Weather", "Ambience", "Reverb"].forEach(function (k) {
      if (p[k] != null) lines.push(inner + k + " = " + value(p[k]) + ",");
    });
    lines.push(indent + "}");
    return lines.join("\n");
  }

  function presetEntry(name, p, indent) {
    indent = indent || "\t";
    return indent + name + " = " + presetTable(p, indent) + ",";
  }

  function presetsModule(presets) {
    var out = [
      "--!strict",
      "-- GENERATED from assets/presets.json by scripts/presets.cjs. Edit the JSON (or tune in",
      "-- atmosphere-lab.html and paste the entry here) - every key maps 1:1 to a Roblox property:",
      "--   Lighting     -> Lighting                  Atmosphere   -> Lighting.Atmosphere",
      "--   Grade        -> ColorCorrectionEffect     Bloom/SunRays/DepthOfField -> the effect",
      "--   Clouds       -> Terrain.Clouds            Sky          -> Lighting.Sky (no skybox ids)",
      "-- A missing effect section fades that effect out. Technology is advice only: it can't be",
      "-- changed by scripts at runtime, so set it in Studio (the command-bar script does).",
      "-- Weather/Ambience/Reverb are read by the kit's Weather and Ambience modules.",
      "",
      "export type Preset = {",
      "\tLabel: string,",
      "\tMood: string?,",
      "\tGenres: { string }?,",
      "\tTechnology: string?,",
      "\tLighting: { [string]: any },",
      "\tAtmosphere: { [string]: any }?,",
      "\tGrade: { [string]: any }?,",
      "\tBloom: { [string]: any }?,",
      "\tSunRays: { [string]: any }?,",
      "\tClouds: { [string]: any }?,",
      "\tSky: { [string]: any }?,",
      "\tDepthOfField: { [string]: any }?,",
      "\tAccent: Color3?,",
      "\tWeather: { Type: string, Intensity: number }?,",
      "\tAmbience: string?,",
      "\tReverb: string?,",
      "}",
      "",
      "local Presets: { [string]: Preset } = {",
    ];
    Object.keys(presets).forEach(function (name) {
      out.push(presetEntry(name, presets[name], "\t"));
    });
    out.push("}", "", "return Presets", "");
    return out.join("\n");
  }

  // A Studio command-bar script that applies a preset to the open place in edit mode, using
  // the same instance names as the kit, with one undo waypoint.
  function commandBar(name, p) {
    var L = [];
    L.push("-- Atmosphere preset '" + name + "' (" + (p.Label || name) + "). Paste into Studio's command bar.");
    L.push("local Lighting, CH = game:GetService(\"Lighting\"), game:GetService(\"ChangeHistoryService\")");
    L.push("CH:SetWaypoint(\"Before atmosphere " + name + "\")");
    L.push("local function get(parent, cls, name)");
    L.push("\tlocal i = parent:FindFirstChild(name)");
    L.push("\tif not (i and i:IsA(cls)) then i = parent:FindFirstChildOfClass(cls) end");
    L.push("\tif cls ~= \"Atmosphere\" and cls ~= \"Sky\" and cls ~= \"Clouds\" and i and i.Name ~= name then i = nil end");
    L.push("\tif not i then i = Instance.new(cls); i.Name = name; i.Parent = parent end");
    L.push("\treturn i");
    L.push("end");
    L.push("local function set(i, props) for k, v in props do i[k] = v end end");
    if (p.Technology) {
      L.push("if not pcall(function() Lighting.Technology = Enum.Technology." + p.Technology + " end) then");
      L.push("\twarn(\"Set Lighting.Technology to " + p.Technology + " in the Properties window\")");
      L.push("end");
    }
    SECTION_ORDER.forEach(function (k) {
      var s = SECTIONS[k];
      var props = p[k] || NEUTRAL[k];
      if (!props) return;
      if (k === "Lighting") {
        L.push("set(Lighting, " + value(props) + ")");
      } else {
        L.push("set(get(" + s.parent + ", \"" + s.cls + "\", \"" + s.name + "\"), " + value(props) + ")");
      }
    });
    if (p.Reverb) L.push("game:GetService(\"SoundService\").AmbientReverb = Enum.ReverbType." + p.Reverb);
    L.push("CH:SetWaypoint(\"Atmosphere " + name + "\")");
    L.push("print(\"Applied atmosphere '" + name + "'\")");
    return L.join("\n");
  }

  var api = {
    SECTIONS: SECTIONS,
    SECTION_ORDER: SECTION_ORDER,
    NEUTRAL: NEUTRAL,
    value: value,
    presetTable: presetTable,
    presetEntry: presetEntry,
    presetsModule: presetsModule,
    commandBar: commandBar,
  };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.LuauGen = api;
})(this);
