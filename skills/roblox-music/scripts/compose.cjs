#!/usr/bin/env node
// Adaptive game music from a mood: stems, stingers, MIDI and the Luau cue entry.
//
//   node compose.cjs list                         the moods, with tempo, key and vibe
//   node compose.cjs show <mood>                  chords, stems and the intensity map
//   node compose.cjs render <mood> [options]      WAV stems + one-shots + MIDI + cue.json + .luau
//   node compose.cjs demo <mood> [--loops 3]      one WAV: the loop with intensity rising 0 -> 1, then the ending
//   node compose.cjs midi <mood> [options]        just the MIDI (for a DAW or a composer)
//   node compose.cjs brief <mood> [options]       a music brief / delivery spec (Markdown)
//   node compose.cjs analyze <a.wav> [b.wav ...] [--bpm N --bars N --beats N]
//                                                 check your own stems: loudness, peaks, lengths, loop seam
//   node compose.cjs check                        validate assets/moods.json
//   node compose.cjs build                        regenerate MusicCues.luau and the music lab
//
// Options: --seed N  --key D  --mode dorian  --bpm 120  --bars 8  --progression "i VI III VII"
//          --name my_cue  --file custom-mood.json  --out DIR  --sr 44100|48000  --target -16
'use strict';

const fs = require('fs');
const path = require('path');
const M = require('./engine');

const SKILL = path.resolve(__dirname, '..');
const MOODS_FILE = path.join(SKILL, 'assets', 'moods.json');
const CUES_LUAU = path.join(SKILL, 'assets', 'kit', 'shared', 'Music', 'MusicCues.luau');
const LAB_TEMPLATE = path.join(__dirname, 'lab.template.html');
const LAB_OUT = path.join(SKILL, 'assets', 'music-lab.html');

function loadMoods() {
  return JSON.parse(fs.readFileSync(MOODS_FILE, 'utf8'));
}

function parseArgs(argv) {
  const opts = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (next === undefined || next.startsWith('--')) opts[key] = true;
      else { opts[key] = next; i++; }
    } else opts._.push(a);
  }
  return opts;
}

function presetFor(name, opts) {
  if (opts.file) {
    const data = JSON.parse(fs.readFileSync(opts.file, 'utf8'));
    // a file can hold one mood or a map of moods
    if (data.stems) return Object.assign({ id: name || path.basename(opts.file, '.json') }, data);
    const key = name || Object.keys(data)[0];
    if (!data[key]) throw new Error(`no mood '${key}' in ${opts.file}`);
    return Object.assign({ id: key }, data[key]);
  }
  const moods = loadMoods();
  if (!moods[name]) {
    const close = Object.keys(moods).filter((k) => k.includes(name || '') || (name || '').includes(k.split('_')[0]));
    throw new Error(`unknown mood '${name}'. ${close.length ? 'Did you mean: ' + close.join(', ') + '? ' : ''}Run: node compose.cjs list`);
  }
  return Object.assign({ id: name }, moods[name]);
}

function composeOpts(opts, preset) {
  const o = { seed: opts.seed === undefined ? 1 : Number(opts.seed), name: opts.name || preset.id };
  if (opts.key) o.key = opts.key;
  if (opts.mode) o.mode = opts.mode;
  if (opts.bpm) o.bpm = Number(opts.bpm);
  if (opts.bars) o.bars = Number(opts.bars);
  if (opts.progression) o.progression = opts.progression;
  return o;
}

// ------------------------------------------------------------------ validation
function validate(moods) {
  const errors = [];
  const instruments = Object.keys(M.INSTRUMENTS).filter((k) => M.INSTRUMENTS[k]);
  for (const [id, p] of Object.entries(moods)) {
    const where = (s) => `${id}: ${s}`;
    for (const key of ['title', 'vibe', 'bpm', 'key', 'mode', 'progression', 'stems']) if (p[key] === undefined) errors.push(where(`missing '${key}'`));
    if (!/^[a-z][a-z0-9_]*$/.test(id)) errors.push(where('mood ids are lower_snake_case'));
    if (p.bpm < 40 || p.bpm > 200) errors.push(where(`bpm ${p.bpm} outside 40-200`));
    try { M.keyPitchClass(p.key); } catch (e) { errors.push(where(e.message)); }
    try { M.parseProgression(p.progression, M.keyPitchClass(p.key), p.mode, p.beatsPerBar || 4, p.bars || 8); } catch (e) { errors.push(where(e.message)); }
    if (p.melodyScale && !M.SCALES[p.melodyScale]) errors.push(where(`unknown melodyScale '${p.melodyScale}'`));
    const steps = p.steps || (p.beatsPerBar || 4) * 4;
    if (steps % (p.beatsPerBar || 4) !== 0) errors.push(where(`steps ${steps} not a multiple of beatsPerBar`));
    if (!p.stems || !p.stems.length) continue;
    if ((p.stems[0].min || 0) !== 0) errors.push(where(`first stem '${p.stems[0].name}' should have min 0 (it is the bed that always plays)`));
    let prevMin = -1;
    const names = new Set();
    for (const s of p.stems) {
      if (names.has(s.name)) errors.push(where(`duplicate stem '${s.name}'`));
      names.add(s.name);
      const min = s.min || 0, full = s.full === undefined ? min : s.full;
      if (min < 0 || full > 1 || full < min) errors.push(where(`stem '${s.name}' needs 0 <= min <= full <= 1`));
      if (min < prevMin) errors.push(where(`stems should be ordered by min intensity ('${s.name}')`));
      prevMin = min;
      if (s.reverb !== undefined && (s.reverb < 0 || s.reverb > 1)) errors.push(where(`stem '${s.name}' reverb 0-1`));
      for (const part of s.parts) {
        if (!M.GENERATORS[part.role]) { errors.push(where(`stem '${s.name}': unknown role '${part.role}'`)); continue; }
        if (part.inst && !instruments.includes(part.inst)) errors.push(where(`stem '${s.name}': unknown instrument '${part.inst}'`));
        if (part.role === 'drums') {
          const pat = M.DRUMS[part.pattern];
          if (!pat) errors.push(where(`stem '${s.name}': unknown drum pattern '${part.pattern}'`));
          else {
            for (const v of part.voices || []) if (!pat[v]) errors.push(where(`stem '${s.name}': pattern '${part.pattern}' has no '${v}'`));
            for (const [v, line] of Object.entries(pat)) if (v !== 'steps' && line.length !== pat.steps) errors.push(`pattern ${part.pattern}.${v} has ${line.length} steps, expected ${pat.steps}`);
          }
        }
        if (part.rhythm && !M.RHYTHMS[part.rhythm] && !/^[Xx.\-]+$/.test(part.rhythm)) errors.push(where(`stem '${s.name}': unknown rhythm '${part.rhythm}'`));
        if (part.role === 'fx' && !['roll', 'fill', 'impact', 'braam'].includes(part.style)) errors.push(where(`stem '${s.name}': unknown fx style '${part.style}'`));
      }
    }
    for (const st of p.stingers || []) if (!M.STINGER_KINDS.includes(st)) errors.push(where(`unknown stinger '${st}'`));
    try { M.compose(Object.assign({ id }, p), { seed: 1 }); } catch (e) { errors.push(where(`compose failed: ${e.message}`)); }
  }
  return errors;
}

// ------------------------------------------------------------------ outputs
function cuesLuau(moods) {
  const lines = [
    '--!strict',
    '-- GENERATED by `node scripts/compose.cjs build` from assets/moods.json (seed 1 for every mood).',
    '-- One entry per cue: tempo and length (the beat grid), stems with the intensity range where each',
    '-- fades in (Min) and is fully up (Full), and the one-shots. Paste your uploaded asset ids into',
    '-- Asset ("rbxassetid://123" or just "123"); empty ids are skipped, so a cue plays silently until then.',
    '--',
    '-- `compose.cjs render <mood> --seed N` prints the entry for the exact files it rendered: replace',
    '-- the matching entry below with it (a different seed or key means different stems).',
    '',
    'return {',
  ];
  for (const [id, p] of Object.entries(moods)) {
    const cue = M.compose(Object.assign({ id }, p), { seed: 1, name: id });
    lines.push(M.luauEntry(M.cueManifest(cue), '\t'));
  }
  lines.push('}', '');
  return lines.join('\n');
}

// The template is page content only (the shape a published artifact wants); the asset file gets
// a full document around it so it opens straight from disk.
function labHtml(moods, bare) {
  const template = fs.readFileSync(LAB_TEMPLATE, 'utf8');
  const filled = labFill(template, moods).replace('/*@@BARE@@*/false', bare ? 'true' : 'false');
  if (bare) return filled;
  const cut = filled.indexOf('</style>') + '</style>'.length;
  return '<!doctype html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">\n' +
    filled.slice(0, cut) + '\n</head>\n<body>\n' + filled.slice(cut).replace(/^\s+/, '') + '</body>\n</html>\n';
}

function labFill(template, moods) {
  const engine = M.FILES.map((f) => `// ---- ${f}\n` + fs.readFileSync(path.join(__dirname, 'engine', f), 'utf8')).join('\n');
  const config = luauConfigAsJson();
  return template
    .replace('/*@@ENGINE@@*/', () => engine.replace(/<\/script/gi, '<\\/script'))
    .replace('/*@@MOODS@@*/null', () => JSON.stringify(moods))
    .replace('/*@@CONFIG@@*/null', () => JSON.stringify(config));
}

// The lab mirrors the kit's Director and Transition settings: read them out of MusicConfig.luau.
function luauConfigAsJson() {
  const src = fs.readFileSync(path.join(SKILL, 'assets', 'kit', 'shared', 'Music', 'MusicConfig.luau'), 'utf8');
  const num = (block, key) => { const m = new RegExp(`${block} = \\{[\\s\\S]*?\\b${key} = ([0-9.]+)`).exec(src); return m ? Number(m[1]) : undefined; };
  const str = (block, key) => { const m = new RegExp(`${block} = \\{[\\s\\S]*?\\b${key} = "([A-Za-z]+)"`).exec(src); return m ? m[1] : undefined; };
  return {
    Director: { Attack: num('Director', 'Attack'), Release: num('Director', 'Release'), IntensityHold: num('Director', 'IntensityHold'), StateHold: num('Director', 'StateHold') },
    Transition: { Sync: str('Transition', 'Sync'), Fade: num('Transition', 'Fade'), Lead: num('Transition', 'Lead') },
    LayerFade: Number((/LayerFade = ([0-9.]+)/.exec(src) || [])[1]),
    Stinger: { Sync: str('Stinger', 'Sync'), Duck: num('Stinger', 'Duck'), Release: num('Stinger', 'Release') },
  };
}

function outputs() {
  const moods = loadMoods();
  const out = [[CUES_LUAU, cuesLuau(moods)]];
  if (fs.existsSync(LAB_TEMPLATE)) out.push([LAB_OUT, labHtml(moods)]);
  return out;
}

function brief(preset, cue) {
  const spb = 60 / cue.bpm;
  const loop = cue.bars * cue.beatsPerBar * spb;
  const L = [];
  L.push(`# Music brief: ${preset.title} (\`${cue.name}\`)`, '');
  L.push(`**Vibe:** ${preset.vibe}.`, '');
  L.push(`**Use for:** ${(preset.genres || []).join(', ')}.`, '');
  L.push('## Grid', '');
  L.push(`- Tempo **${cue.bpm} BPM**, **${cue.beatsPerBar}/4**${cue.steps % 3 === 0 && cue.beatsPerBar === 4 ? ' with a triplet (12/8) feel' : ''}, key **${cue.key} ${cue.mode.replace(/_/g, ' ')}**${cue.swing ? `, swing ${Math.round(cue.swing * 100)}%` : ''}.`);
  L.push(`- Loop: **${cue.bars} bars = ${loop.toFixed(3)} s** (${Math.round(loop * 48000)} samples at 48 kHz). Every stem exactly this long.`);
  L.push(`- Progression: \`${cue.chords.map((c) => c.symbol + (c.length !== cue.beatsPerBar ? ':' + c.length / cue.beatsPerBar : '')).join(' ')}\` (one chord per bar unless marked).`);
  L.push('');
  L.push('## Stems (vertical layers, bottom to top)', '');
  L.push('| Stem | Fades in at | Full at | Contents |', '|---|---|---|---|');
  for (const s of cue.stems) L.push(`| ${s.name} | ${s.min} | ${s.full} | ${s.parts.map((p) => `${p.role}${p.def.style ? ' (' + p.def.style + ')' : p.def.pattern ? ' (' + p.def.pattern + ')' : ''} on ${p.inst}`).join('; ')} |`);
  L.push('', 'Any combination of stems from the bottom up must sound finished: the bed alone is the calm version, all stems together the climax.', '');
  L.push('## One-shots', '');
  for (const o of cue.oneShots) L.push(`- **${o.name}** (${o.kind}): ${o.beats} beats (${(o.beats * spb).toFixed(2)} s) + natural tail${o.kind === 'intro' ? '; its last beat leads into bar 1 of the loop' : o.kind === 'ending' ? '; starts on a bar line, ends the cue' : ', in key, lands on a beat'}.`);
  L.push('', '## Delivery spec', '');
  L.push('- WAV or FLAC, 48 kHz (or 44.1 kHz), 16 or 24-bit, stereo. No MP3 for loops (encoder padding breaks the seam).');
  L.push('- Every stem starts on the downbeat of bar 1 and is exactly the loop length; render the reverb/delay tail of the last bar onto the start (print the loop twice and keep the second pass, or wrap the tail).');
  L.push('- Mix level: all stems together around **-16 LUFS integrated**, true peak under **-1 dBTP**; stems keep their relative levels (don\'t normalize each one).');
  L.push('- One-shots: start at sample 0 (intro: its downbeat hit is at the end), trailing silence trimmed.');
  L.push(`- File names: \`${cue.name}_<stem>.wav\`, \`${cue.name}_<one-shot>.wav\`.`);
  L.push(`- Roblox limits: 7 minutes, 20 MB, 48 kHz max per file; upload with the Asset Manager's bulk import.`);
  return L.join('\n');
}

function analyze(files, opts) {
  const rows = [];
  let len0 = null;
  let ok = true;
  for (const f of files) {
    const w = M.readWav(fs.readFileSync(f));
    const lufs = M.loudness(w.L, w.R, w.sr);
    const pk = M.gainToDb(M.peak(w.L, w.R));
    // seam: jump across the loop point vs the 99.9th percentile of sample steps
    const steps = [];
    for (let i = 1; i < w.L.length; i += 7) steps.push(Math.abs(w.L[i] - w.L[i - 1]));
    steps.sort((a, b) => a - b);
    const p999 = steps[Math.floor(steps.length * 0.999)] || 1e-9;
    const seam = Math.abs(w.L[0] - w.L[w.L.length - 1]) / p999;
    const notes = [];
    if (len0 === null) len0 = w.L.length; else if (w.L.length !== len0) { notes.push(`length ${w.L.length} != ${len0} samples (stems must match exactly)`); ok = false; }
    if (pk > -1) notes.push('peak above -1 dBFS');
    if (seam > 1.5) notes.push('possible click at the loop point');
    if (opts.bpm) {
      const beats = Number(opts.beats || 4) * Number(opts.bars || 8);
      const expect = Math.round(beats * 60 / Number(opts.bpm) * w.sr);
      if (Math.abs(expect - w.L.length) > 2) { notes.push(`expected ${expect} samples for ${opts.bars || 8} bars at ${opts.bpm} BPM`); ok = false; }
    }
    if (w.sr > 48000) { notes.push('sample rate above 48 kHz (Roblox max)'); ok = false; }
    rows.push(`${path.basename(f).padEnd(34)} ${(w.L.length / w.sr).toFixed(3).padStart(8)} s  ${w.sr} Hz  ${isFinite(lufs) ? lufs.toFixed(1).padStart(6) : '  -inf'} LUFS  peak ${pk.toFixed(1).padStart(5)} dB  seam ${seam.toFixed(2)}${notes.length ? '  <- ' + notes.join('; ') : ''}`);
  }
  console.log(rows.join('\n'));
  if (files.length > 1) {
    // full mix of all files
    const ws = files.map((f) => M.readWav(fs.readFileSync(f)));
    const n = Math.min(...ws.map((w) => w.L.length));
    const L = new Float32Array(n), R = new Float32Array(n);
    for (const w of ws) for (let i = 0; i < n; i++) { L[i] += w.L[i]; R[i] += w.R[i]; }
    console.log(`all together: ${M.loudness(L, R, ws[0].sr).toFixed(1)} LUFS, peak ${M.gainToDb(M.peak(L, R)).toFixed(1)} dB (aim: about -16 LUFS, under -1 dB)`);
  }
  return ok;
}

function writeRender(preset, opts) {
  const cue = M.compose(preset, composeOpts(opts, preset));
  const sr = Number(opts.sr || 44100);
  const target = opts.target === undefined ? -16 : Number(opts.target);
  const t0 = Date.now();
  const r = M.render(cue, { sr, target });
  const dir = path.resolve(opts.out || path.join(process.cwd(), 'music'), cue.name);
  fs.mkdirSync(dir, { recursive: true });
  const man = M.manifest(cue, r);
  r.stems.forEach((s, i) => fs.writeFileSync(path.join(dir, man.stems[i].file), M.wav(s.L, s.R, r.sr)));
  r.oneShots.forEach((o, i) => fs.writeFileSync(path.join(dir, man.oneShots[i].file), M.wav(o.L, o.R, r.sr)));
  fs.writeFileSync(path.join(dir, `${cue.name}.mid`), M.midi(cue));
  fs.writeFileSync(path.join(dir, `${cue.name}.cue.json`), JSON.stringify(man, null, 2) + '\n');
  const entry = M.luauEntry(man, '\t');
  fs.writeFileSync(path.join(dir, `${cue.name}.luau`), `-- Paste into MusicCues.luau (replace the entry with the same name), then fill in the asset ids.\n${entry}\n`);
  fs.writeFileSync(path.join(dir, 'BRIEF.md'), brief(preset, cue) + '\n');
  console.log(`${preset.title || cue.name}: ${cue.key} ${cue.mode}, ${cue.bpm} BPM, ${cue.bars} bars = ${r.loopSeconds.toFixed(3)} s loop, seed ${cue.seed} (${((Date.now() - t0) / 1000).toFixed(1)} s)`);
  console.log(`full mix ${r.mix.lufs.toFixed(1)} LUFS, peak ${M.gainToDb(r.mix.peak).toFixed(1)} dBFS`);
  for (const s of man.stems) console.log(`  stem  ${s.file.padEnd(36)} intensity ${String(s.min).padEnd(4)} -> ${String(s.full).padEnd(4)} ${String(s.lufs).padStart(6)} LUFS`);
  for (const o of man.oneShots) console.log(`  shot  ${o.file.padEnd(36)} ${o.kind.padEnd(8)} ${o.seconds}s`);
  console.log(`  midi  ${cue.name}.mid   cue ${cue.name}.cue.json   luau ${cue.name}.luau   brief BRIEF.md`);
  console.log(`-> ${dir}\n\n${entry}`);
}

// A listenable preview: the loop played `loops` times while intensity ramps 0 -> 1 (each stem
// fades in exactly as MusicPlayer would fade it), then the ending one-shot on the next bar.
function demo(preset, opts) {
  const cue = M.compose(preset, composeOpts(opts, preset));
  const sr = Number(opts.sr || 44100);
  const r = M.render(cue, { sr });
  const loops = Number(opts.loops || 3);
  const n = r.loopSamples * loops;
  const ending = r.oneShots.find((o) => o.kind === 'ending');
  const total = n + (ending ? ending.L.length : 0);
  const L = new Float32Array(total), R = new Float32Array(total);
  const gains = r.stems.map(() => 0);
  const step = 1 / (0.8 * sr);
  for (let i = 0; i < n; i++) {
    const intensity = Math.min(1, i / (n * 0.85));
    const k = i % r.loopSamples;
    r.stems.forEach((s, si) => {
      const target = M.Timeline.LayerGain(s.min, s.full, intensity);
      gains[si] += Math.max(-step, Math.min(step, target - gains[si]));
      L[i] += s.L[k] * gains[si]; R[i] += s.R[k] * gains[si];
    });
  }
  if (ending) for (let i = 0; i < ending.L.length; i++) { L[n + i] += ending.L[i]; R[n + i] += ending.R[i]; }
  const file = path.resolve(opts.out || `${cue.name}_demo.wav`);
  fs.writeFileSync(file, M.wav(L, R, sr));
  console.log(`${preset.title}: ${loops} loops, intensity 0 -> 1, then the ending (${(total / sr).toFixed(1)} s) -> ${file}`);
}

function main() {
  const opts = parseArgs(process.argv.slice(2));
  const [cmd, name] = opts._;
  switch (cmd) {
    case 'list': {
      const moods = loadMoods();
      for (const [id, p] of Object.entries(moods)) console.log(`${id.padEnd(24)} ${String(p.bpm).padStart(3)} BPM  ${(p.key + ' ' + p.mode).padEnd(22)} ${p.vibe}`);
      break;
    }
    case 'show': {
      const preset = presetFor(name, opts);
      const cue = M.compose(preset, composeOpts(opts, preset));
      console.log(`${preset.title}: ${preset.vibe}`);
      console.log(`${cue.bpm} BPM, ${cue.beatsPerBar}/4, ${cue.key} ${cue.mode}, ${cue.bars} bars (${(cue.bars * cue.beatsPerBar * 60 / cue.bpm).toFixed(2)} s)`);
      console.log(`chords: ${cue.chords.map((c) => `${c.symbol}(${c.pcs.map((pc) => M.NOTE_NAMES[pc]).join('')})`).join(' ')}`);
      console.log('intensity  0    .25   .5   .75   1');
      for (const s of cue.stems) {
        let bar = '';
        for (let x = 0; x <= 1.0001; x += 0.05) { const g = M.Timeline.LayerGain(s.min, s.full, x); bar += g >= 0.99 ? '█' : g > 0.5 ? '▓' : g > 0.01 ? '░' : '·'; }
        console.log(`${s.name.padEnd(10)} ${bar}  ${s.parts.map((p) => `${p.role}:${p.inst}`).join(' ')}`);
      }
      console.log(`one-shots: ${cue.oneShots.map((o) => o.name).join(', ')}`);
      break;
    }
    case 'render':
      writeRender(presetFor(name, opts), opts);
      break;
    case 'demo':
      demo(presetFor(name, opts), opts);
      break;
    case 'midi': {
      const preset = presetFor(name, opts);
      const cue = M.compose(preset, composeOpts(opts, preset));
      const file = path.resolve(opts.out || '.', `${cue.name}.mid`);
      fs.writeFileSync(file, M.midi(cue));
      console.log(`-> ${file}`);
      break;
    }
    case 'brief': {
      const preset = presetFor(name, opts);
      console.log(brief(preset, M.compose(preset, composeOpts(opts, preset))));
      break;
    }
    case 'analyze': {
      const files = opts._.slice(1);
      if (!files.length) throw new Error('usage: analyze <stem.wav> [more.wav ...] [--bpm N --bars N --beats N]');
      process.exitCode = analyze(files, opts) ? 0 : 1;
      break;
    }
    case 'check': {
      const errors = validate(loadMoods());
      if (errors.length) { console.log(errors.map((e) => 'FAIL ' + e).join('\n')); process.exitCode = 1; }
      else console.log(`ok   ${Object.keys(loadMoods()).length} moods valid`);
      break;
    }
    case 'lab': {
      // node compose.cjs lab --out page.html [--bare]   (bare = no <html>/<head> wrapper, for publishing)
      const file = path.resolve(opts.out || 'music-lab.html');
      fs.writeFileSync(file, labHtml(loadMoods(), !!opts.bare));
      console.log(`-> ${file}`);
      break;
    }
    case 'build':
      for (const [file, content] of outputs()) { fs.writeFileSync(file, content); console.log(`wrote ${path.relative(SKILL, file)}`); }
      break;
    default:
      console.log(fs.readFileSync(__filename, 'utf8').split('\n').slice(1).filter((l, i, a) => a.slice(0, i + 1).every((x) => x.startsWith('//'))).map((l) => l.replace(/^\/\/ ?/, '')).join('\n'));
      if (cmd) process.exitCode = 1;
  }
}

module.exports = { loadMoods, validate, outputs, cuesLuau, brief, analyze, luauConfigAsJson };
if (require.main === module) {
  try { main(); } catch (e) { console.error(e.message); process.exit(1); }
}
