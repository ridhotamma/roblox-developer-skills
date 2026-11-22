#!/usr/bin/env node
// AI music and sound effects, made fit for Roblox: generate with a free local model or a paid API,
// then cut the result onto the music grid (seamless loop, exact length, mix level) or clean it up
// as a one-shot (trimmed, faded, levelled), with a MusicCues entry for music.
//
//   node generate.cjs status                      which providers are ready (Mirli running? API keys? ffmpeg?)
//   node generate.cjs prompt <mood> [--for ace-step|stable-audio|elevenlabs|suno]
//                                                 a text prompt and duration built from a mood preset
//   node generate.cjs music <mood> --provider mirli|elevenlabs [--takes 2] [--seed N] [--prompt "..."]
//                                                 generate a cue on the mood's tempo, then fit it as a loop
//   node generate.cjs sfx "<what it sounds like>" --provider mirli|elevenlabs [--duration 3] [--takes 3]
//                       [--loop] [--name door_creak]  generate sound effects, then clean them up as one-shots
//   node generate.cjs fit <a.wav> [b.wav ...] --bpm 120 --bars 8 [--start 2.5] [--name cue]
//                                                 cut any music (AI, library, DAW) into a seamless loop on the grid;
//                                                 several files = stems of one track, cut identically
//   node generate.cjs fit <sfx.wav> --oneshot [--target -18] [--mono]     trim, fade and level a one-shot
//   node generate.cjs fit <ambience.wav> --loop-sfx [--xfade 0.5]           an ambience loop with no tempo
//
// Common options: --out DIR  --ogg (also write .ogg, needs ffmpeg)  --dry-run (print the request only)
// Providers: mirli (free, local, MCP at MIRLI_URL, default http://127.0.0.1:17494/mcp),
//            elevenlabs (paid, ELEVENLABS_API_KEY). MCP-only services (ElevenCreative, Suno, ForgeGUI) are
//            called by the agent directly; download their files and run `fit` on them.
'use strict';

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const M = require('./engine');
const cli = require('./compose.cjs');

const MIRLI_URL = process.env.MIRLI_URL || 'http://127.0.0.1:17494/mcp';
const MIRLI_SFX = process.env.MIRLI_SFX_MODEL || 'audiocpp-stable-audio-3-sfx';
const MIRLI_MUSIC = process.env.MIRLI_MUSIC_MODEL || 'audiocpp-ace-step';

// ---------------------------------------------------------------- arguments

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

const slug = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 40) || 'sound';

// ---------------------------------------------------------------- prompts from a mood

// Engine instrument ids -> words a text-to-music model understands.
const INSTRUMENT_WORDS = {
  warmpad: 'warm synth pad', darkpad: 'dark ambient pad', pad: 'soft pad', drone: 'low drone', glass: 'glassy pad',
  subbass: 'sub bass', synthbass: 'synth bass', pluckbass: 'plucked bass', fmbass: 'FM bass', reese: 'reese bass', ebass: 'electric bass',
  harp: 'harp', flute: 'flute', whistle: 'tin whistle', strings: 'string section', spiccato: 'spiccato strings', pizz: 'pizzicato strings',
  tremolo: 'tremolo strings', cello: 'solo cello', violin: 'solo violin', choir: 'choir pad', brass: 'brass section', horn: 'french horn',
  arp: 'synth arpeggio', lead: 'synth lead', sqlead: 'square-wave chiptune lead', pluck: 'synth pluck', musicbox: 'music box',
  piano: 'piano', epiano: 'electric piano', celesta: 'celesta', marimba: 'marimba', pipeorgan: 'pipe organ', organ: 'Hammond organ',
  distgtr: 'distorted electric guitar', crunchgtr: 'crunchy rhythm guitar', cleangtr: 'clean electric guitar', guitar: 'electric guitar',
  tremguitar: 'tremolo electric guitar', acoustic: 'acoustic guitar', bluesgtr: 'blues guitar', leadgtr: 'lead guitar', harmonica: 'harmonica',
};
const DRUM_WORDS = {
  heartbeat: 'slow heartbeat pulse', heartbeat_fast: 'fast heartbeat pulse', taiko: 'taiko drums', epic: 'epic cinematic percussion',
  industrial: 'industrial metallic percussion', rust: 'scraping metal percussion', triphop: 'trip-hop drums', lofi: 'dusty lo-fi drums',
  breakbeat: 'breakbeat', four_floor: 'four-on-the-floor kick', synthwave: 'gated synthwave drums', chiptune: 'chiptune drums',
  shuffle: 'shuffle drums', punk: 'fast punk drums', punk_open: 'punk drums', skate: 'skate punk drums', rock: 'rock drums',
  anthem: 'arena rock drums', funk: 'funk drums', folk: 'folk percussion', march: 'snare march', clock: 'ticking clock',
  waltz: 'waltz percussion', chase: 'driving chase drums', action: 'driving action drums', action_light: 'light action percussion',
  halftime: 'half-time drums', pound: 'pounding drums', gallop: 'galloping drums', shaker16: 'shaker', hats16: 'hi-hats',
};

function moodFacts(preset) {
  const inst = [], drums = [];
  for (const s of preset.stems) for (const p of s.parts) {
    if (p.role === 'drums') { if (p.pattern && DRUM_WORDS[p.pattern] && !drums.includes(DRUM_WORDS[p.pattern])) drums.push(DRUM_WORDS[p.pattern]); }
    else if (p.inst && INSTRUMENT_WORDS[p.inst] && !inst.includes(INSTRUMENT_WORDS[p.inst])) inst.push(INSTRUMENT_WORDS[p.inst]);
  }
  const bars = preset.bars || 8, beats = preset.beatsPerBar || 4;
  const loopSeconds = bars * beats * 60 / preset.bpm;
  const mode = String(preset.mode || 'minor').replace(/_/g, ' ');
  const minorish = /minor|dorian|phrygian|locrian|aeolian/.test(mode);
  return { inst, drums, bars, beats, loopSeconds, mode, key: preset.key, keyWords: `${preset.key} ${minorish ? 'minor' : 'major'}`, vibe: preset.vibe, genres: preset.genres || [] };
}

// How long to ask for: two passes of the loop and one extra bar. `fit` keeps a pass from the
// steady middle (after any intro) and crossfades the bar after it back onto its start.
function musicDuration(f, maxS) {
  const bar = f.beats * 60 / (f.bpm || 1);
  let d = f.loopSeconds * 2 + bar;
  if (maxS && d > maxS) d = Math.min(maxS, f.loopSeconds + 2 * bar);
  return Math.round(d * 10) / 10;
}

function musicPrompt(preset, target) {
  const f = moodFacts(preset);
  f.bpm = preset.bpm;
  const t = target || 'generic';
  const mood = f.vibe.replace(/\.$/, '');
  const title = String(preset.title || preset.id || '').replace(/\s*\(.*?\)/g, '').toLowerCase();
  const genre = [title, ...f.genres.slice(0, 2)].filter(Boolean).filter((g, i, a) => a.indexOf(g) === i).join(', ');
  const parts = [...f.inst.slice(0, 6), ...f.drums.slice(0, 2)];
  let prompt;
  if (t === 'ace-step') {
    // ACE-Step responds to comma-separated tags
    prompt = [`${genre} game soundtrack`, 'instrumental', ...parts, `${preset.bpm} bpm`, f.keyWords, 'steady tempo', 'loopable', 'no vocals', 'no intro, no fade out'].join(', ');
  } else if (t === 'stable-audio') {
    // Stable Audio emphasises BPM and instrumentation at the front
    prompt = `${preset.bpm} BPM, ${f.keyWords}, instrumental ${genre} game music loop: ${parts.join(', ')}. ${mood}. Constant tempo, no vocals, no fade.`;
  } else {
    // prose for ElevenLabs Music, Suno and other chat-style generators
    prompt = `Instrumental ${genre} video game background music. ${mood}. ${preset.bpm} BPM in ${f.keyWords}, ${f.beats}/4, constant tempo from the first bar. Instruments: ${parts.join(', ')}. Starts straight in on the groove and keeps the same density all the way through so it can loop; no vocals, no intro build, no fade out, no ending.`;
  }
  return { prompt, bpm: preset.bpm, bars: f.bars, beatsPerBar: f.beats, loopSeconds: f.loopSeconds, duration: musicDuration(f), negative: 'vocals, singing, speech, fade out, tempo change, silence' };
}

// ---------------------------------------------------------------- audio in and out

function haveFfmpeg() {
  try { execFileSync('ffmpeg', ['-version'], { stdio: 'ignore' }); return true; } catch { return false; }
}

// Any audio file -> { L, R, sr }. WAV natively; anything else through ffmpeg.
function readAudio(file) {
  const bytes = fs.readFileSync(file);
  if (bytes.slice(0, 4).toString('ascii') === 'RIFF') {
    try { return M.readWav(bytes); } catch (e) { if (!haveFfmpeg()) throw e; }
  }
  if (!haveFfmpeg()) throw new Error(`${path.basename(file)} is not a plain WAV; install ffmpeg (winget install ffmpeg / brew install ffmpeg) to read it`);
  const tmp = path.join(require('os').tmpdir(), `rbxmusic_${process.pid}_${Date.now()}.wav`);
  execFileSync('ffmpeg', ['-v', 'error', '-y', '-i', file, '-ac', '2', '-c:a', 'pcm_s16le', tmp]);
  const w = M.readWav(fs.readFileSync(tmp));
  fs.unlinkSync(tmp);
  return w;
}

function writeAudio(file, L, R, sr, opts) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, M.wav(L, R, sr));
  const out = [file];
  if (opts.ogg) {
    if (!haveFfmpeg()) console.log('     (no ffmpeg: skipped the .ogg)');
    else {
      const ogg = file.replace(/\.wav$/i, '.ogg');
      execFileSync('ffmpeg', ['-v', 'error', '-y', '-i', file, '-c:a', 'libvorbis', '-q:a', '6', ogg]);
      out.push(ogg);
    }
  }
  return out;
}

function mixOf(ws) {
  const n = Math.min(...ws.map((w) => w.L.length));
  const L = new Float32Array(n), R = new Float32Array(n);
  for (const w of ws) for (let i = 0; i < n; i++) { L[i] += w.L[i]; R[i] += w.R[i]; }
  return { L, R, sr: ws[0].sr };
}

// ---------------------------------------------------------------- analysis

// Onset strength per hop: positive change in log energy (a cheap spectral-flux stand-in that
// still finds drum hits and note attacks).
function onsets(L, R, sr, hop) {
  const n = Math.floor(L.length / hop);
  const e = new Float32Array(n);
  for (let k = 0; k < n; k++) {
    let s = 0;
    for (let i = k * hop, j = 0; j < hop; i++, j++) { const x = L[i] + R[i]; s += x * x; }
    e[k] = Math.log10(1e-9 + s / hop);
  }
  const o = new Float32Array(n);
  for (let k = 1; k < n; k++) o[k] = Math.max(0, e[k] - e[k - 1]);
  return o;
}

// Tempo from the onset envelope's autocorrelation, 60-200 BPM, preferring the octave nearest `hint`.
function estimateBpm(L, R, sr, hint) {
  const hop = Math.round(sr * 0.01);
  const o = onsets(L, R, sr, hop);
  const fps = sr / hop;
  // remove the envelope's mean so the autocorrelation measures periodicity, not loudness
  let mean = 0;
  for (let k = 0; k < o.length; k++) mean += o[k];
  mean /= Math.max(1, o.length);
  for (let k = 0; k < o.length; k++) o[k] -= mean;
  const ac = (lag) => {
    const l0 = Math.floor(lag), fr = lag - l0;
    let s = 0;
    for (let k = 0; k + l0 + 1 < o.length; k++) s += o[k] * (o[k + l0] * (1 - fr) + o[k + l0 + 1] * fr);
    return s / Math.max(1, o.length - l0);
  };
  // comb: a true beat period also repeats at 2, 4 and 8 beats (a bar, two bars); a 2/3 or 3/2
  // mistake does not. Weighted by a broad prior around 120 BPM, as beat trackers do.
  const score = (bpm) => {
    const lag = fps * 60 / bpm;
    let s = 0;
    for (const [m, w] of [[1, 1], [2, 0.7], [4, 0.5], [8, 0.35]]) if (lag * m < o.length / 2) s += w * ac(lag * m);
    const oct = Math.log2(bpm / 120);
    return s * Math.exp(-0.5 * (oct / 0.9) ** 2);
  };
  let best = 0, bestScore = -Infinity;
  for (let bpm = 60; bpm <= 200; bpm += 0.5) {
    const s = score(bpm);
    if (s > bestScore) { bestScore = s; best = bpm; }
  }
  // refine to 0.1 BPM
  for (let bpm = best - 0.5; bpm <= best + 0.5; bpm += 0.1) {
    const s = score(bpm);
    if (s > bestScore) { bestScore = s; best = bpm; }
  }
  if (hint) {
    // the autocorrelation can't tell 70 from 140; pick the octave closest to what was asked for
    let cand = best;
    for (const m of [0.5, 2, 1 / 3, 3, 2 / 3, 1.5]) {
      const b = best * m;
      if (Math.abs(Math.log(b / hint)) < Math.abs(Math.log(cand / hint)) && score(b) > bestScore * 0.5) cand = b;
    }
    best = cand;
  }
  return Math.round(best * 10) / 10;
}

// Where to start the loop: the bar phase whose beats carry the most onset energy (bar lines count
// double), at or after `skip` seconds, leaving room for the loop and its crossfade.
function findStart(L, R, sr, bpm, beats, loopLen, xf, skip) {
  const hop = Math.round(sr * 0.005);
  const o = onsets(L, R, sr, hop);
  const beatH = sr * 60 / bpm / hop, barH = beatH * beats;
  const lastStart = (L.length - loopLen - xf) / hop;
  if (lastStart < 0) return null;
  const at = (h) => { const k = Math.round(h); return k >= 0 && k < o.length ? Math.max(o[k], o[k - 1] || 0, o[k + 1] || 0) : 0; };
  let bestPhase = 0, best = -1;
  for (let ph = 0; ph < barH; ph += 1) {
    let s = 0;
    for (let h = ph; h < o.length; h += beatH) s += at(h) * (Math.abs(((h - ph) / beatH) % beats) < 0.5 ? 2 : 1);
    if (s > best) { best = s; bestPhase = ph; }
  }
  const skipH = skip * sr / hop;
  let h = bestPhase;
  while (h < skipH) h += barH;
  while (h > lastStart && h - barH >= 0) h -= barH;
  return Math.round(h * hop);
}

// The first sample louder than `db` (dBFS) on either channel.
function firstAbove(L, R, db) {
  const g = M.dbToGain(db);
  for (let i = 0; i < L.length; i++) if (Math.abs(L[i]) > g || Math.abs(R[i]) > g) return i;
  return L.length;
}
function lastAbove(L, R, db) {
  const g = M.dbToGain(db);
  for (let i = L.length - 1; i >= 0; i--) if (Math.abs(L[i]) > g || Math.abs(R[i]) > g) return i;
  return -1;
}

// ---------------------------------------------------------------- fitting

// Cut [start, start + loopLen) and crossfade the audio that follows the loop end (the music's own
// continuation, including reverb tails) into the first `xf` samples, equal power. The last sample
// then flows into the first exactly as the original played on.
function loopCut(w, start, loopLen, xf) {
  const L = new Float32Array(loopLen), R = new Float32Array(loopLen);
  const avail = w.L.length - (start + loopLen);
  const x = Math.max(0, Math.min(xf, avail, loopLen >> 1));
  for (let i = 0; i < loopLen; i++) { L[i] = w.L[start + i] || 0; R[i] = w.R[start + i] || 0; }
  for (let i = 0; i < x; i++) {
    const t = (i + 0.5) / x;
    const a = Math.sin(t * Math.PI / 2), b = Math.cos(t * Math.PI / 2);
    L[i] = L[i] * a + w.L[start + loopLen + i] * b;
    R[i] = R[i] * a + w.R[start + loopLen + i] * b;
  }
  return { L, R, sr: w.sr, xf: x };
}

// One gain for a set of files so their mix lands on `target` LUFS with peaks under `ceiling` dBFS.
function levelGain(ws, target, ceiling) {
  const mix = ws.length > 1 ? mixOf(ws) : ws[0];
  const lufs = M.loudness(mix.L, mix.R, mix.sr);
  let g = isFinite(lufs) ? M.dbToGain(target - lufs) : 1;
  const pk = Math.max(...ws.map((w) => M.peak(w.L, w.R)), M.peak(mix.L, mix.R));
  if (pk * g > M.dbToGain(ceiling)) g = M.dbToGain(ceiling) / pk;
  return g;
}
function scale(w, g) {
  for (let i = 0; i < w.L.length; i++) { w.L[i] *= g; w.R[i] *= g; }
  return w;
}

function stemDefaults(n) {
  // bottom-up: the first file is the bed (always on), the rest fade in evenly
  return Array.from({ length: n }, (_, i) => i === 0 ? { min: 0, full: 0 } : {
    min: Math.round(Math.max(0, (i - 0.5) / n) * 100) / 100,
    full: Math.round(Math.min(1, (i + 0.5) / n) * 100) / 100,
  });
}

function fitLoop(files, opts) {
  const ws = files.map(readAudio);
  const sr = ws[0].sr;
  if (ws.some((w) => w.sr !== sr)) throw new Error('all stems must share one sample rate');
  if (sr > 48000) throw new Error(`sample rate ${sr} Hz is above Roblox's 48 kHz; resample first (ffmpeg -i in.wav -ar 48000 out.wav)`);
  const n = Math.min(...ws.map((w) => w.L.length));
  ws.forEach((w) => { w.L = w.L.subarray(0, n); w.R = w.R.subarray(0, n); });
  const mix = mixOf(ws);
  const beats = Number(opts.beats || 4);
  const asked = opts.bpm && opts.bpm !== 'auto' ? Number(opts.bpm) : null;
  const heard = estimateBpm(mix.L, mix.R, sr, asked || undefined);
  const bpm = asked || heard;
  const notes = [];
  if (asked && Math.abs(heard - asked) / asked > 0.02) notes.push(`the beat may be ~${heard} BPM, not ${asked} (sparse or rubato music can fool this). If the loop drifts when you listen, regenerate, or fit with --bpm ${heard} and use that tempo in the cue`);
  let bars = Number(opts.bars || 8);
  const xf = Math.round(Number(opts.xfade === undefined ? 0.12 : opts.xfade) * sr);
  let loopLen = Math.round(bars * beats * 60 / bpm * sr);
  // shorten the loop by halves until it fits in what was generated
  while (loopLen + xf > n && bars > 1) { bars = Math.floor(bars / 2); loopLen = Math.round(bars * beats * 60 / bpm * sr); notes.push(`only ${(n / sr).toFixed(1)} s of audio: loop cut to ${bars} bars`); }
  if (loopLen > n) throw new Error(`${(n / sr).toFixed(1)} s of audio is shorter than one bar at ${bpm} BPM`);
  const lead = firstAbove(mix.L, mix.R, -45) / sr;
  const skip = opts.start !== undefined ? null : (opts.skip !== undefined ? Number(opts.skip) : lead + beats * 60 / bpm);
  let start = opts.start !== undefined ? Math.round(Number(opts.start) * sr) : findStart(mix.L, mix.R, sr, bpm, beats, loopLen, xf, skip);
  if (start === null || start + loopLen > n) start = Math.max(0, n - loopLen - xf);
  const cut = ws.map((w) => loopCut(w, start, loopLen, xf));
  if (cut[0].xf < xf) notes.push(`only ${(cut[0].xf / sr * 1000).toFixed(0)} ms after the loop end to crossfade; generate a longer take for a smoother seam`);
  const target = opts.target === undefined ? -16 : Number(opts.target);
  const g = levelGain(cut, target, -1);
  cut.forEach((c) => scale(c, g));

  let name = slug(opts.name || path.basename(files[0]).replace(/\.[^.]+$/, '').replace(/_(full|mix|stem)$/i, ''));
  const dir = path.resolve(opts.out || path.dirname(files[0]));
  // never write over an input file
  const inputs = new Set(files.map((f) => path.resolve(f).toLowerCase()));
  if ([...inputs].some((f) => path.dirname(f) === dir.toLowerCase() && path.basename(f).startsWith(name + '_'))) name += '_loop';
  // stems are named by what differs between the file names: boss_drums.wav, boss_bass.wav -> drums, bass
  const bases = files.map((f) => slug(path.basename(f).replace(/\.[^.]+$/, '')));
  let pre = 0;
  if (files.length > 1) {
    while (bases.every((b) => b.length > pre && b[pre] === bases[0][pre])) pre++;
    pre = bases[0].lastIndexOf('_', pre - 1) + 1; // cut on a word boundary
  }
  const stemNames = files.length === 1 ? ['full'] : bases.map((b, i) => b.slice(pre) || `stem${i + 1}`);
  if (new Set(stemNames).size !== stemNames.length) throw new Error(`two stems would share a name (${stemNames.join(', ')}); rename the files`);
  const ranges = files.length === 1 ? [{ min: 0, full: 0 }] : stemDefaults(files.length);
  const written = [];
  cut.forEach((c, i) => written.push(...writeAudio(path.join(dir, `${name}_${stemNames[i]}.wav`), c.L, c.R, sr, opts)));

  const fm = mixOf(cut);
  const man = {
    name, title: opts.title || name, seed: opts.seed || 'n/a', bpm, beatsPerBar: beats, bars, key: opts.key || 'key', mode: opts.mode || 'unknown',
    loopSeconds: Math.round(loopLen / sr * 1e4) / 1e4, chords: opts.source || 'fitted audio',
    mix: { lufs: Math.round(M.loudness(fm.L, fm.R, sr) * 10) / 10, peakDb: Math.round(M.gainToDb(M.peak(fm.L, fm.R)) * 10) / 10 },
    stems: stemNames.map((s, i) => ({ name: s, file: `${name}_${s}.wav`, min: ranges[i].min, full: ranges[i].full })),
    oneShots: [],
  };
  const entry = M.luauEntry(man, '\t');
  fs.writeFileSync(path.join(dir, `${name}.luau`), `-- Paste into MusicCues.luau, then fill in the asset ids after uploading.\n${entry}\n`);
  console.log(`${name}: ${bpm} BPM${asked ? '' : ' (detected)'}, ${bars} bars of ${beats} = ${(loopLen / sr).toFixed(3)} s (${loopLen} samples at ${sr} Hz), from ${(start / sr).toFixed(2)} s, seam crossfade ${(cut[0].xf / sr * 1000).toFixed(0)} ms`);
  console.log(`level: ${man.mix.lufs} LUFS, peak ${man.mix.peakDb} dBFS (target ${target} LUFS, ceiling -1 dBFS)`);
  for (const f of written) console.log(`  -> ${f}`);
  for (const m of notes) console.log(`  !  ${m}`);
  console.log(`\n${entry}`);
  return { dir, name, files: written, bpm, bars, notes, man };
}

function fitOneShot(file, opts) {
  const w = readAudio(file);
  const sr = w.sr;
  const floor = Number(opts.floor || -50);
  const pre = Math.round(sr * 0.003);
  const a = Math.max(0, firstAbove(w.L, w.R, floor) - pre);
  const b = lastAbove(w.L, w.R, floor);
  if (b <= a) throw new Error(`${path.basename(file)} is silent (nothing above ${floor} dBFS)`);
  const fade = Math.min(Math.round(sr * Number(opts.fade || 0.03)), (b - a) >> 2);
  const len = b - a + 1;
  let L = w.L.slice(a, b + 1), R = w.R.slice(a, b + 1);
  for (let i = 0; i < pre && i < len; i++) { const g = i / pre; L[i] *= g; R[i] *= g; }
  for (let i = 0; i < fade; i++) { const g = Math.cos((i + 1) / fade * Math.PI / 2); L[len - fade + i] *= g; R[len - fade + i] *= g; }
  if (opts.mono) { for (let i = 0; i < len; i++) { const m = (L[i] + R[i]) / 2; L[i] = m; R[i] = m; } }
  const out = { L, R, sr };
  const lufs0 = M.loudness(L, R, sr);
  const g = opts.target !== undefined ? levelGain([out], Number(opts.target), -1) : M.dbToGain(-1) / Math.max(1e-9, M.peak(L, R));
  scale(out, g);
  const dir = path.resolve(opts.out || path.dirname(file));
  let name = slug(opts.name || path.basename(file).replace(/\.[^.]+$/, ''));
  if (path.join(dir, `${name}.wav`).toLowerCase() === path.resolve(file).toLowerCase()) name += '_clean'; // never write over the input
  const files = writeAudio(path.join(dir, `${name}.wav`), out.L, out.R, sr, opts);
  const lufs = M.loudness(out.L, out.R, sr);
  console.log(`${name}: ${(len / sr).toFixed(2)} s (trimmed ${(a / sr).toFixed(2)} s before, ${((w.L.length - 1 - b) / sr).toFixed(2)} s after), ${isFinite(lufs) ? lufs.toFixed(1) : '-inf'} LUFS, peak ${M.gainToDb(M.peak(out.L, out.R)).toFixed(1)} dBFS${opts.mono ? ', mono' : ''}${opts.target === undefined ? ' (peak-normalised; set loudness per sound with Sound.Volume or AudioPlayer.Volume)' : ''}`);
  for (const f of files) console.log(`  -> ${f}`);
  return { files, lufsBefore: lufs0, lufs, seconds: len / sr };
}

// An ambience bed with no tempo: crossfade its own end into its start.
function fitAmbienceLoop(file, opts) {
  const w = readAudio(file);
  const sr = w.sr;
  const xf = Math.round(Number(opts.xfade || 0.5) * sr);
  const a = firstAbove(w.L, w.R, -55);
  const loopLen = w.L.length - a - xf;
  if (loopLen < xf * 2) throw new Error('too short to loop with that crossfade; lower --xfade');
  const c = loopCut(w, a, loopLen, xf);
  scale(c, levelGain([c], opts.target === undefined ? -20 : Number(opts.target), -1));
  const dir = path.resolve(opts.out || path.dirname(file));
  const name = slug(opts.name || path.basename(file).replace(/\.[^.]+$/, '') + '_loop');
  const files = writeAudio(path.join(dir, `${name}.wav`), c.L, c.R, sr, opts);
  console.log(`${name}: ${(loopLen / sr).toFixed(2)} s seamless loop (crossfade ${(c.xf / sr).toFixed(2)} s), ${M.loudness(c.L, c.R, sr).toFixed(1)} LUFS`);
  for (const f of files) console.log(`  -> ${f}`);
  return { files };
}

// ---------------------------------------------------------------- providers

// Minimal MCP client over Streamable HTTP (JSON-RPC; replies as JSON or server-sent events).
async function mcpSession(url) {
  let sid = null, id = 0;
  async function post(body) {
    const headers = { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' };
    if (sid) headers['Mcp-Session-Id'] = sid;
    const res = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body) });
    if (res.headers.get('mcp-session-id')) sid = res.headers.get('mcp-session-id');
    if (!res.ok) throw new Error(`MCP ${body.method}: HTTP ${res.status} ${await res.text()}`);
    if (body.id === undefined) return null;
    const text = await res.text();
    let msg = null;
    if ((res.headers.get('content-type') || '').includes('text/event-stream')) {
      for (const block of text.split(/\r?\n\r?\n/)) {
        const data = block.split(/\r?\n/).filter((l) => l.startsWith('data:')).map((l) => l.slice(5).trimStart()).join('\n');
        if (!data) continue;
        const j = JSON.parse(data);
        if (j.id === body.id) msg = j;
      }
    } else msg = JSON.parse(text);
    if (!msg) throw new Error(`MCP ${body.method}: no reply`);
    if (msg.error) throw new Error(`MCP ${body.method}: ${msg.error.message || JSON.stringify(msg.error)}`);
    return msg.result;
  }
  const info = await post({ jsonrpc: '2.0', id: ++id, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'roblox-music', version: '1' } } });
  await post({ jsonrpc: '2.0', method: 'notifications/initialized' });
  return {
    info,
    async call(name, args) {
      const r = await post({ jsonrpc: '2.0', id: ++id, method: 'tools/call', params: { name, arguments: args } });
      const text = (r.content || []).filter((c) => c.type === 'text').map((c) => c.text).join('\n');
      if (r.isError) throw new Error(`${name}: ${text}`);
      try { return JSON.parse(text); } catch { return r.structuredContent || { text }; }
    },
  };
}

// Every audio file on this disk named anywhere in a tool result (Mirli gives each sound a `path`
// on disk and a `url` served by the app; only the first is a file).
function audioPaths(result, exists = fs.existsSync) {
  const out = [];
  (function walk(v, key) {
    if (typeof v === 'string') { if (key !== 'url' && /\.(wav|flac|mp3|ogg)$/i.test(v) && path.isAbsolute(v) && exists(v)) out.push(v); }
    else if (Array.isArray(v)) v.forEach((x) => walk(x, key));
    else if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) walk(x, k);
  })(result, '');
  return [...new Set(out)];
}

async function mirliGenerate({ prompt, negative, duration, takes, model, seed, tags }) {
  const s = await mcpSession(MIRLI_URL);
  const args = { prompt, duration_s: duration, variations: Math.min(4, takes || 1), model };
  if (negative) args.negative_prompt = negative;
  if (seed !== undefined) args.seed = Number(seed);
  if (tags) args.tags = tags;
  const r = await s.call('soundbox.generate', args);
  const files = audioPaths(r);
  if (!files.length) throw new Error(`Mirli returned no audio path: ${JSON.stringify(r).slice(0, 400)}`);
  return files;
}

async function elevenlabs(endpoint, body, outBase, takes) {
  const key = process.env.ELEVENLABS_API_KEY;
  if (!key) throw new Error('set ELEVENLABS_API_KEY (elevenlabs.io -> Developers -> API keys); commercial use needs a paid plan');
  const files = [];
  for (let i = 0; i < takes; i++) {
    const res = await fetch(`https://api.elevenlabs.io${endpoint}?output_format=mp3_44100_192`, {
      method: 'POST', headers: { 'xi-api-key': key, 'Content-Type': 'application/json', Accept: 'audio/mpeg' }, body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`ElevenLabs ${endpoint}: HTTP ${res.status} ${(await res.text()).slice(0, 400)}`);
    const f = `${outBase}_take${i + 1}.mp3`;
    fs.mkdirSync(path.dirname(f), { recursive: true });
    fs.writeFileSync(f, Buffer.from(await res.arrayBuffer()));
    files.push(f);
  }
  return files;
}

async function status() {
  const rows = [];
  try {
    const s = await mcpSession(MIRLI_URL);
    const models = await s.call('soundbox.list_models', {});
    const list = Array.isArray(models) ? models : models.models || [];
    rows.push(`ok   mirli (free, local) at ${MIRLI_URL}: ${s.info.serverInfo.name} ${s.info.serverInfo.version}`);
    for (const m of list) rows.push(`       ${m.status === 'not_installed' ? '-' : '+'} ${m.id.padEnd(38)} ${String(m.task).padEnd(4)} ${String(m.status).padEnd(14)} ${m.license} (commercial: ${m.commercial_use})`);
    if (!list.some((m) => m.task === 'sep' && m.status !== 'not_installed')) rows.push('       no stem separator installed (soundbox.separate needs one; install it in the Mirli app to split music into stems)');
  } catch (e) {
    rows.push(`--   mirli: not reachable at ${MIRLI_URL} (start the Mirli app, or install it: see references/ai-audio-tools.md §2)`);
  }
  rows.push(process.env.ELEVENLABS_API_KEY ? 'ok   elevenlabs (paid): ELEVENLABS_API_KEY is set' : '--   elevenlabs (paid): ELEVENLABS_API_KEY not set');
  rows.push(haveFfmpeg() ? 'ok   ffmpeg: found (reads MP3/OGG/FLAC, writes --ogg)' : '--   ffmpeg: not found (only WAV input; winget install ffmpeg / brew install ffmpeg)');
  rows.push('     MCP-only services the agent can call itself: ElevenCreative (https://api.elevenlabs.io/v1/mcp-creative), Suno (https://api.suno.com/mcp), ForgeGUI (generation_music / generation_sound_effect). Download their files, then `fit`.');
  console.log(rows.join('\n'));
}

// ---------------------------------------------------------------- commands

async function music(name, opts) {
  const preset = opts.file || name ? presetForSafe(name, opts) : null;
  const provider = opts.provider || 'mirli';
  const target = provider === 'mirli' ? (/stable/.test(opts.model || '') ? 'stable-audio' : 'ace-step') : 'prose';
  const p = preset ? musicPrompt(preset, target) : null;
  if (!p && !opts.prompt) throw new Error('usage: music <mood> --provider mirli|elevenlabs, or music --prompt "..." --bpm N --bars N');
  const bpm = Number(opts.bpm || (p && p.bpm));
  const bars = Number(opts.bars || (p && p.bars) || 8);
  const beats = Number(opts.beats || (p && p.beatsPerBar) || 4);
  if (!bpm) throw new Error('give --bpm (the loop is cut on that grid)');
  const loopSeconds = bars * beats * 60 / bpm;
  const prompt = opts.prompt || p.prompt;
  const cueName = slug(opts.name || (preset ? preset.id : 'ai_cue'));
  const dir = path.resolve(opts.out || path.join(process.cwd(), 'music'), cueName);
  const takes = Number(opts.takes || 1);
  let duration = Number(opts.duration || Math.round((loopSeconds * 2 + beats * 60 / bpm) * 10) / 10);
  if (provider === 'mirli' && /ace-step/.test(opts.model || MIRLI_MUSIC) && duration > 60) duration = Math.max(Math.min(60, loopSeconds + 2 * beats * 60 / bpm), loopSeconds + 0.5);
  console.log(`prompt (${provider}): ${prompt}\nduration ${duration} s for a ${bars}-bar loop at ${bpm} BPM (${loopSeconds.toFixed(2)} s), ${takes} take(s)`);
  if (opts['dry-run']) return;
  const t0 = Date.now();
  let raw;
  if (provider === 'mirli') raw = await mirliGenerate({ prompt, negative: p ? p.negative : undefined, duration, takes, model: opts.model || MIRLI_MUSIC, seed: opts.seed, tags: ['roblox-music', cueName] });
  else if (provider === 'elevenlabs') raw = await elevenlabs('/v1/music', { prompt, music_length_ms: Math.round(Math.min(600, Math.max(3, duration)) * 1000), force_instrumental: true }, path.join(dir, 'raw', cueName), takes);
  else throw new Error(`unknown provider '${provider}' (mirli, elevenlabs; for MCP-only services download the file and run fit)`);
  console.log(`generated ${raw.length} take(s) in ${((Date.now() - t0) / 1000).toFixed(0)} s`);
  raw.forEach((f, i) => {
    console.log(`\n== take ${i + 1}: ${f}`);
    fitLoop([f], Object.assign({}, opts, { bpm, bars, beats, name: raw.length > 1 ? `${cueName}_take${i + 1}` : cueName, out: dir, key: preset && preset.key, mode: preset && preset.mode, title: preset && preset.title, source: `${provider} ${provider === 'mirli' ? (opts.model || MIRLI_MUSIC) : 'music'}`, seed: opts.seed }));
  });
  writeSource(dir, cueName, { kind: 'music loop', provider, model: provider === 'mirli' ? (opts.model || MIRLI_MUSIC) : 'eleven music', mood: preset && preset.id, prompt, negative: p && provider === 'mirli' ? p.negative : undefined, duration, bpm, bars, beatsPerBar: beats, seed: opts.seed, raw });
  await pendingSource;
  console.log(`\nListen to each take, keep the best, then check it: node compose.cjs analyze ${path.join(dir, (raw.length > 1 ? cueName + '_take1' : cueName) + '_full.wav')} --bpm ${bpm} --bars ${bars} --beats ${beats}`);
}

async function sfx(text, opts) {
  if (!text) throw new Error('usage: sfx "<material, action, space>" --provider mirli|elevenlabs [--duration 3 --takes 3 --loop]');
  const provider = opts.provider || 'mirli';
  const takes = Number(opts.takes || 3);
  const duration = Number(opts.duration || 3);
  const name = slug(opts.name || text.split(/[,.]/)[0]);
  const dir = path.resolve(opts.out || path.join(process.cwd(), 'sfx'));
  console.log(`sfx (${provider}): "${text}", ${duration} s, ${takes} take(s)${opts.loop ? ', loop' : ''}`);
  if (opts['dry-run']) return;
  const t0 = Date.now();
  let raw;
  if (provider === 'mirli') raw = await mirliGenerate({ prompt: text, negative: opts.negative, duration, takes, model: opts.model || MIRLI_SFX, seed: opts.seed, tags: ['roblox-sfx', name] });
  else if (provider === 'elevenlabs') {
    const body = { text, duration_seconds: Math.min(30, Math.max(0.5, duration)), prompt_influence: Number(opts.influence || 0.4), model_id: 'eleven_text_to_sound_v2' };
    if (opts.loop) body.loop = true;
    raw = await elevenlabs('/v1/sound-generation', body, path.join(dir, 'raw', name), takes);
  } else throw new Error(`unknown provider '${provider}'`);
  console.log(`generated ${raw.length} take(s) in ${((Date.now() - t0) / 1000).toFixed(0)} s`);
  raw.forEach((f, i) => {
    const o = Object.assign({}, opts, { name: `${name}_${String(i + 1).padStart(2, '0')}`, out: dir });
    if (opts.loop) fitAmbienceLoop(f, o); else fitOneShot(f, o);
  });
  writeSource(dir, name, { kind: opts.loop ? 'ambience loop' : 'sound effect', provider, model: provider === 'mirli' ? (opts.model || MIRLI_SFX) : 'eleven_text_to_sound_v2', prompt: text, negative: opts.negative, duration, seed: opts.seed, raw });
  if (!opts.loop) console.log('\nUse several takes as variations: pick one at random per play and vary PlaybackSpeed by +-5% so repeats never sound identical.');
}

// Licence terms of the model behind a generation, as the provider states them.
const LICENCES = {
  elevenlabs: 'ElevenLabs terms: commercial use needs a paid plan; free-plan output is non-commercial with attribution (check the current terms)',
};
async function licenceOf(provider, model) {
  if (provider !== 'mirli') return LICENCES[provider] || 'see the provider terms';
  try {
    const s = await mcpSession(MIRLI_URL);
    const list = await s.call('soundbox.list_models', {});
    const m = (Array.isArray(list) ? list : list.models || []).find((x) => x.id === model);
    return m ? `${m.license} (commercial use: ${m.commercial_use})` : 'unknown model';
  } catch { return 'unknown (Mirli not reachable)'; }
}

// <name>.source.json: what made these files, so licences and takedown disputes can be answered later.
async function writeSourceAsync(dir, name, info) {
  const rec = Object.assign({ date: new Date().toISOString(), licence: await licenceOf(info.provider, info.model) }, info);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, `${name}.source.json`), JSON.stringify(rec, null, 2) + '\n');
  console.log(`  provenance -> ${path.join(dir, name + '.source.json')} (${rec.licence})`);
}
let pendingSource = Promise.resolve();
function writeSource(dir, name, info) { pendingSource = pendingSource.then(() => writeSourceAsync(dir, name, info)); }

function presetForSafe(name, opts) {
  const moods = cli.loadMoods();
  if (opts.file) {
    const data = JSON.parse(fs.readFileSync(opts.file, 'utf8'));
    if (data.stems) return Object.assign({ id: name || path.basename(opts.file, '.json') }, data);
    const k = name || Object.keys(data)[0];
    return Object.assign({ id: k }, data[k]);
  }
  if (!moods[name]) throw new Error(`unknown mood '${name}'. Run: node compose.cjs list`);
  return Object.assign({ id: name }, moods[name]);
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const [cmd, arg] = opts._;
  switch (cmd) {
    case 'status': await status(); break;
    case 'prompt': {
      const preset = presetForSafe(arg, opts);
      const targets = opts.for ? [opts.for] : ['ace-step', 'stable-audio', 'elevenlabs'];
      for (const t of targets) {
        const p = musicPrompt(preset, t === 'elevenlabs' || t === 'suno' ? 'prose' : t);
        console.log(`[${t}]\n${p.prompt}\n`);
      }
      const p = musicPrompt(preset, 'prose');
      console.log(`grid: ${p.bpm} BPM, ${p.beatsPerBar}/4, ${p.bars} bars = ${p.loopSeconds.toFixed(3)} s. Ask for ${p.duration} s (two passes and a bar), then:\n  node generate.cjs fit <downloaded file> --bpm ${p.bpm} --bars ${p.bars} --beats ${p.beatsPerBar} --name ${preset.id}`);
      console.log(`avoid (negative prompt, where supported): ${p.negative}`);
      break;
    }
    case 'music': await music(arg, opts); break;
    case 'sfx': await sfx(arg, opts); await pendingSource; break;
    case 'fit': {
      const files = opts._.slice(1);
      if (!files.length) throw new Error('usage: fit <file> [more] --bpm N --bars N | --oneshot | --loop-sfx');
      if (opts.oneshot) files.forEach((f) => fitOneShot(f, files.length > 1 ? Object.assign({}, opts, { name: undefined }) : opts));
      else if (opts['loop-sfx']) files.forEach((f) => fitAmbienceLoop(f, files.length > 1 ? Object.assign({}, opts, { name: undefined }) : opts));
      else fitLoop(files, opts);
      break;
    }
    default:
      console.log(fs.readFileSync(__filename, 'utf8').split('\n').slice(1).filter((l, i, a) => a.slice(0, i + 1).every((x) => x.startsWith('//'))).map((l) => l.replace(/^\/\/ ?/, '')).join('\n'));
      if (cmd) process.exitCode = 1;
  }
}

module.exports = { musicPrompt, moodFacts, estimateBpm, findStart, loopCut, fitLoop, fitOneShot, fitAmbienceLoop, audioPaths, readAudio, INSTRUMENT_WORDS, DRUM_WORDS };
if (require.main === module) main().catch((e) => { console.error('error: ' + e.message); process.exitCode = 1; });
