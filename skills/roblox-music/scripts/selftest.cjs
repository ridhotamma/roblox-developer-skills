#!/usr/bin/env node
// Offline checks for the music skill: moods valid, generated files current, notes in key,
// seamless loops, levels, determinism, WAV / MIDI / Luau output, then the Luau tests.
//   node scripts/selftest.cjs           (add --quick to skip rendering every mood)
'use strict';

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const M = require('./engine');
const cli = require('./compose.cjs');

const SKILL = path.resolve(__dirname, '..');
const quick = process.argv.includes('--quick');
let failures = 0;
function ok(cond, msg) {
  console.log((cond ? 'ok   ' : 'FAIL ') + msg);
  if (!cond) failures++;
}

// 1. moods and generated files
const moods = cli.loadMoods();
const errors = cli.validate(moods);
ok(errors.length === 0, `moods.json valid (${Object.keys(moods).length} moods)${errors.length ? ': ' + errors.slice(0, 5).join('; ') : ''}`);
ok(Object.keys(moods).length >= 15, 'at least 15 moods');
for (const [file, content] of cli.outputs()) {
  const current = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
  ok(current.replace(/\r\n/g, '\n') === content.replace(/\r\n/g, '\n'), `${path.relative(SKILL, file)} up to date (node scripts/compose.cjs build)`); // ignore CRLF checkouts
}

// 2. theory: notes belong where they should
{
  let bad = 0, checked = 0;
  for (const [id, p] of Object.entries(moods)) {
    const cue = M.compose(Object.assign({ id }, p), { seed: 3 });
    const keyPc = M.keyPitchClass(cue.key);
    const melodyScale = M.scaleOf(p.melodyScale || p.mode);
    for (const stem of cue.stems) for (const part of stem.parts) {
      for (const n of part.notes) {
        if (typeof n.p !== 'number') continue;
        const pc = ((n.p % 12) + 12) % 12;
        if (part.role === 'melody' && part.def.style === 'licks') continue; // blues licks are chromatic on purpose
        if (part.role === 'melody') {
          checked++;
          if (!melodyScale.includes((pc - keyPc + 12) % 12)) { bad++; if (bad < 4) console.log(`     ${id}/${stem.name} melody ${M.noteName(n.p)} not in ${p.melodyScale || p.mode}`); }
        } else if (['pad', 'arp', 'ostinato', 'stabs', 'strum'].includes(part.role) || (part.role === 'guitar' && part.def.style !== 'boogie')) {
          checked++;
          const seg = cue.chords.find((c) => n.t >= c.start - 1e-6 && n.t < c.start + c.length - 1e-6) || cue.chords[cue.chords.length - 1];
          // arpeggios may add the chord's diatonic 9th / 7th (colours, never avoid notes)
          const pseg = M.chordAt(cue.ctx.progression, n.t);
          const extra = part.role === 'arp' ? M.chordExtensions(pseg.chord, keyPc, cue.ctx.scale, part.def.colors === undefined ? 1 : part.def.colors) : part.role === 'guitar' ? M.chordExtensions(pseg.chord, keyPc, cue.ctx.scale, 2) : [];
          // guitars anticipate a change by an 8th (a "push"): the next chord is fine there
          const ahead = part.role === 'guitar' ? M.chordAt(cue.ctx.progression, (n.t + 0.55) % (cue.bars * cue.beatsPerBar)).chord.pcs : [];
          if (!seg.pcs.includes(pc) && !extra.includes(pc) && !ahead.includes(pc)) { bad++; if (bad < 4) console.log(`     ${id}/${stem.name} ${part.role} ${M.noteName(n.p)} not in ${seg.symbol}`); }
        }
        if (n.t < 0 || n.t >= cue.bars * cue.beatsPerBar) { bad++; console.log(`     ${id} note outside the loop at beat ${n.t}`); }
      }
    }
  }
  ok(bad === 0, `melodies in scale, harmony parts on chord tones or colour tones (${checked} notes)`);
}

// 2b. melody craft: not a generic 1-and-5 line (references/music-theory.md section 5)
{
  let notes = 0, tonicFifth = 0, repeats = 0, strong = 0, clash = 0, unresolved = 0, under = 0, checkedUnder = 0, forms = new Set();
  for (const [id, p] of Object.entries(moods)) for (const seed of [1, 2, 3]) {
    const cue = M.compose(Object.assign({ id }, p), { seed });
    const ctx = cue.ctx;
    const parts = cue.stems.flatMap((s) => s.parts);
    const mel = parts.find((x) => x.role === 'melody' && !['bells', 'counter'].includes(x.def.style));
    if (!mel || mel.def.style === 'licks') continue;
    forms.add(ctx.motif.form.join(' '));
    const ns = ctx.lead || mel.notes; // the melody as written (before tremolo picking or octave doubling)
    ns.forEach((n, i) => {
      notes++;
      const deg = (n.p - ctx.keyPc + 120) % 12;
      if (deg === 0 || deg === 7) tonicFifth++;
      if (i && n.p === ns[i - 1].p) repeats++;
      const col = M.chordColors(M.chordAt(ctx.progression, n.t).chord, ctx.keyPc, ctx.scale);
      if (Math.abs(n.t % 1) < 1e-6 && n.d >= 0.45 && col.root !== null) {
        strong++;
        if (!col.tones.includes(n.p % 12) && !col.tensions.includes(n.p % 12)) {
          clash++;
          const nx = ns[i + 1];
          const nc = nx && M.chordColors(M.chordAt(ctx.progression, nx.t).chord, ctx.keyPc, ctx.scale);
          if (!nx || Math.abs(nx.p - n.p) > 2 || !nc.tones.includes(nx.p % 12)) unresolved++;
        }
      }
    });
    const counter = parts.find((x) => x.role === 'counter');
    if (counter) {
      let below = 0, total = 0;
      for (const c of counter.notes) {
        const m = ns.filter((n) => n.t <= c.t + 1e-9 && n.t + n.d > c.t).pop();
        if (m) { total++; if (c.p < m.p) below++; }
      }
      checkedUnder += total; under += Math.max(below, total - below); // stays on one side (under, or above as a descant)
    }
  }
  const pct = (a, b) => (100 * a / Math.max(1, b)).toFixed(1);
  ok(tonicFifth / notes < 0.32, `melodies don't lean on the tonic and fifth (${pct(tonicFifth, notes)}% of ${notes} notes)`);
  ok(repeats / notes < 0.2, `few repeated notes (${pct(repeats, notes)}%)`);
  ok(clash / strong < 0.05 && unresolved <= Math.ceil(strong * 0.005), `strong-beat dissonances are rare and resolve by step (${clash} of ${strong}, ${unresolved} unresolved)`);
  ok(under / Math.max(1, checkedUnder) > 0.97, `counterlines stay on one side of the melody (${pct(under, checkedUnder)}%)`);
  ok(forms.size >= 3, `melodies use several phrase forms (${forms.size})`);
}

// 2c. no synthetic whooshes, sweeps or cymbal washes (they read as cheap sound effects, not music)
{
  const banned = ['riser', 'swell', 'shepard', 'scrape', 'wind', 'crash'];
  const present = banned.filter((k) => M.INSTRUMENTS[k] || Object.values(M.DRUMS).some((pat) => pat[k]));
  const used = [];
  for (const [id, p] of Object.entries(moods)) for (const st of p.stems) for (const part of st.parts) {
    if (banned.includes(part.style) || banned.includes(part.inst) || (Array.isArray(part.voices) ? part.voices : []).some((v) => banned.includes(v)) || part.crash) used.push(`${id}/${st.name}`);
  }
  let inShots = 0;
  for (const [id, p] of Object.entries(moods)) {
    const cue = M.compose(Object.assign({ id }, p), { seed: 1 });
    for (const shot of cue.oneShots) for (const part of shot.parts) if (banned.includes(part.inst) || part.notes.some((n) => banned.includes(n.p) || banned.includes(n.inst))) inShots++;
  }
  ok(!present.length && !used.length && !inShots, `no whoosh / sweep / cymbal-wash sounds${present.length ? ' (instruments: ' + present.join(', ') + ')' : ''}${used.length ? ' (moods: ' + used.join(', ') + ')' : ''}${inShots ? ` (${inShots} one-shot parts)` : ''}`);
}

// 3. chords
{
  const c = M.parseChord('VI', M.keyPitchClass('A'), 'aeolian');
  ok(c.pcs.join() === [5, 9, 0].join(), 'A aeolian VI = F major');
  const n = M.parseChord('N', M.keyPitchClass('C'), 'aeolian');
  ok(n.pcs.join() === [1, 5, 8].join(), 'Neapolitan in C = Db major');
  const v7 = M.parseChord('V7', M.keyPitchClass('C'), 'harmonic_minor');
  ok(v7.pcs.join() === [7, 11, 2, 5].join(), 'C harmonic minor V7 = G7');
  const prog = M.parseProgression('i:2 VI VII', 0, 'aeolian', 4, 8);
  ok(prog.length === 6 && prog[5].start === 28, 'progression repeats to fill the bars');
}

// 4. determinism
{
  const p = Object.assign({ id: 'action_combat' }, moods.action_combat);
  const a = JSON.stringify(M.compose(p, { seed: 7 }).stems.map((s) => s.parts.map((x) => x.notes)));
  const b = JSON.stringify(M.compose(p, { seed: 7 }).stems.map((s) => s.parts.map((x) => x.notes)));
  const c = JSON.stringify(M.compose(p, { seed: 8 }).stems.map((s) => s.parts.map((x) => x.notes)));
  ok(a === b, 'same seed, same notes');
  ok(a !== c, 'different seed, different notes');
}

// 5. render: lengths, seams, levels
function seamOk(L) {
  const steps = [];
  for (let i = 1; i < L.length; i++) steps.push(Math.abs(L[i] - L[i - 1]));
  steps.sort((x, y) => x - y);
  const p999 = steps[Math.floor(steps.length * 0.999)] || 1e-9;
  return Math.abs(L[0] - L[L.length - 1]) / p999;
}
const toRender = quick ? ['exploration', 'horror_dread'] : Object.keys(moods);
const renders = {};
for (const id of toRender) {
  const cue = M.compose(Object.assign({ id }, moods[id]), { seed: 1, name: id, bars: quick ? 4 : undefined });
  const r = M.render(cue, { sr: 22050 });
  renders[id] = { cue, r };
  const expect = Math.round(cue.bars * cue.beatsPerBar * 60 / cue.bpm * 22050);
  const lengths = r.stems.every((s) => s.L.length === expect && s.R.length === expect);
  const levelOk = Math.abs(r.mix.lufs + 16) < 0.6 || M.gainToDb(r.mix.peak) > -1.2;
  const peakOk = M.gainToDb(r.mix.peak) <= -0.95;
  const finite = r.stems.every((s) => s.L.every(Number.isFinite));
  // A stem that doesn't start with a hit must flow across the loop point like any other sample.
  const sustained = r.stems.filter((s, i) => !cue.stems[i].parts.some((p) => p.notes.some((n) => n.t === 0 && (typeof n.p === 'string' || ['stabs', 'arp', 'ostinato', 'broken', 'strum', 'guitar', 'pulse', 'melody', 'bass', 'counter', 'bells', 'fx'].includes(p.role)))));
  const seams = sustained.map((s) => seamOk(s.L));
  ok(lengths && finite && levelOk && peakOk && seams.every((x) => x < 1.5),
    `${id}: ${r.stems.length} stems x ${expect} samples, mix ${r.mix.lufs.toFixed(1)} LUFS, peak ${M.gainToDb(r.mix.peak).toFixed(1)} dB, seams ${seams.map((x) => x.toFixed(2)).join('/') || '-'}`);
  ok(r.oneShots.length >= 3 && r.oneShots.every((o) => o.L.length > 0 && M.gainToDb(o.peak) <= -0.95), `${id}: ${r.oneShots.length} one-shots, peaks under -1 dB`);
}

// 6. seamless fold: a pad held across the whole loop must not dip or click at the loop point
{
  const preset = { id: 'seamtest', title: 'Seam test', bpm: 120, key: 'C', mode: 'ionian', progression: 'I', bars: 2, stingers: [], intro: false, ending: false,
    stems: [{ name: 'pad', min: 0, full: 0, reverb: 0.5, parts: [{ role: 'drone', inst: 'drone', octave: 3 }] }] };
  const r = M.render(M.compose(preset, { seed: 1 }), { sr: 22050 });
  const L = r.stems[0].L;
  const rms = (a, b) => { let s = 0; for (let i = a; i < b; i++) s += L[i] * L[i]; return Math.sqrt(s / (b - a)); };
  const n = L.length, w = Math.round(0.05 * 22050);
  const edge = (rms(0, w) + rms(n - w, n)) / 2, mid = rms(Math.round(n / 2) - w, Math.round(n / 2) + w);
  ok(seamOk(L) < 1.5 && edge / mid > 0.7 && edge / mid < 1.4, `held drone loops seamlessly (seam ${seamOk(L).toFixed(2)}, level at the loop point ${(edge / mid).toFixed(2)}x the middle)`);
}

// 7. formats
{
  const { cue, r } = renders[toRender[0]];
  const bytes = M.wav(r.stems[0].L, r.stems[0].R, r.sr);
  const back = M.readWav(bytes);
  let maxErr = 0;
  for (let i = 0; i < back.L.length; i++) maxErr = Math.max(maxErr, Math.abs(back.L[i] - r.stems[0].L[i]));
  ok(back.sr === r.sr && back.L.length === r.stems[0].L.length && maxErr < 3 / 32768, `WAV round trip (max error ${(maxErr * 32768).toFixed(2)} LSB)`);

  const mid = M.midi(cue);
  const tag = (o) => String.fromCharCode(...mid.slice(o, o + 4));
  let o = 14, tracks = 0, valid = tag(0) === 'MThd';
  while (o < mid.length) { valid = valid && tag(o) === 'MTrk'; const len = (mid[o + 4] << 24) | (mid[o + 5] << 16) | (mid[o + 6] << 8) | mid[o + 7]; o += 8 + len; tracks++; }
  const parts = cue.stems.reduce((a, s) => a + s.parts.length, 0);
  ok(valid && o === mid.length && tracks === parts + 1, `MIDI: ${tracks} tracks (tempo + ${parts} parts), chunk sizes consistent`);

  const entry = M.luauEntry(M.manifest(cue, r), '\t');
  const opens = (entry.match(/\{/g) || []).length, closes = (entry.match(/\}/g) || []).length;
  ok(opens === closes && /Bpm = \d+/.test(entry) && /Stems = \{/.test(entry), 'Luau cue entry well formed');

  const z = M.zip([{ name: 'a.txt', data: new TextEncoder().encode('hello') }]);
  ok(z[0] === 0x50 && z[1] === 0x4b && M.crc32(new TextEncoder().encode('hello')) === 0x3610a686, 'zip + crc32');
}

// 8. analyzer agrees with the renderer
{
  const dir = fs.mkdtempSync(path.join(require('os').tmpdir(), 'music-selftest-'));
  const { cue, r } = renders[toRender[0]];
  const files = r.stems.map((s) => { const f = path.join(dir, `${s.name}.wav`); fs.writeFileSync(f, M.wav(s.L, s.R, r.sr)); return f; });
  const log = console.log; let out = '';
  console.log = (s) => { out += s + '\n'; };
  const good = cli.analyze(files, { bpm: cue.bpm, bars: cue.bars, beats: cue.beatsPerBar });
  console.log = log;
  ok(good && !/expected|!=/.test(out), 'analyze accepts rendered stems (lengths match the grid)');
}

// 9. files the docs mention exist
{
  const skill = fs.readFileSync(path.join(SKILL, 'SKILL.md'), 'utf8');
  const mentioned = [...skill.matchAll(/`((?:assets|references|scripts|tests)\/[A-Za-z0-9_./-]+)`/g)].map((m) => m[1]);
  const kitFiles = [...skill.matchAll(/`((?:shared|client|server)\/[A-Za-z/]+\.luau)`/g)].map((m) => 'assets/kit/' + m[1]);
  const missing = mentioned.concat(kitFiles).filter((f) => !fs.existsSync(path.join(SKILL, f)));
  ok(missing.length === 0, `files named in SKILL.md exist (${mentioned.length + kitFiles.length})${missing.length ? ': ' + missing.join(', ') : ''}`);
}

// 9b. AI generation helpers (generate.cjs): prompts, loop fitting, one-shots, MCP client
{
  const G = require('./generate.cjs');
  const insts = new Set(), pats = new Set();
  for (const p of Object.values(moods)) for (const s of p.stems) for (const part of s.parts) {
    if (part.role === 'drums') { if (part.pattern) pats.add(part.pattern); } else if (part.inst) insts.add(part.inst);
  }
  const noWord = [...insts].filter((i) => !G.INSTRUMENT_WORDS[i]).concat([...pats].filter((d) => !G.DRUM_WORDS[d] && !/^(wave|groups3|tick8|chug16|alberti|spread|pedal|broken|drive)$/.test(d)));
  ok(noWord.length === 0, `every instrument has words for AI prompts${noWord.length ? ': missing ' + noWord.join(', ') : ''}`);
  let badPrompt = 0;
  for (const [id, p] of Object.entries(moods)) for (const t of ['ace-step', 'stable-audio', 'prose']) {
    const pr = G.musicPrompt(Object.assign({ id }, p), t);
    if (!pr.prompt.includes(String(p.bpm)) || !/no vocals/.test(pr.prompt) || pr.duration < pr.loopSeconds * 2) badPrompt++;
  }
  ok(badPrompt === 0, `AI prompts name the BPM, ask for no vocals and two passes (${Object.keys(moods).length * 3} prompts)`);

  // fit: a rendered cue played 2.5 times after 1 s of silence must come back as exactly one loop,
  // starting on a bar line, seamless, levelled; two stems must be cut at the same sample
  const dir = fs.mkdtempSync(path.join(require('os').tmpdir(), 'music-fit-'));
  const { cue, r } = renders[toRender[0]];
  const pad = r.sr, total = pad + Math.round(r.loopSamples * 2.5);
  const stemFiles = r.stems.slice(0, 2).map((s, si) => {
    const L = new Float32Array(total), R = new Float32Array(total);
    for (let i = pad; i < total; i++) { const k = (i - pad) % r.loopSamples; L[i] = s.L[k] * 0.3; R[i] = s.R[k] * 0.3; }
    const f = path.join(dir, `ai_${si ? 'top' : 'bed'}.wav`);
    fs.writeFileSync(f, M.wav(L, R, r.sr));
    return f;
  });
  const log = console.log; console.log = () => {};
  let res, res2, one;
  try {
    res = G.fitLoop([stemFiles[0]], { bpm: cue.bpm, bars: cue.bars, beats: cue.beatsPerBar, name: 'fit_one', out: dir });
    res2 = G.fitLoop(stemFiles, { bpm: cue.bpm, bars: cue.bars, beats: cue.beatsPerBar, name: 'fit_two', out: dir });
  } finally { console.log = log; }
  const w = M.readWav(fs.readFileSync(res.files[0]));
  const barSamples = cue.beatsPerBar * 60 / cue.bpm * r.sr;
  ok(w.L.length === r.loopSamples, `fit cuts exactly one loop (${w.L.length} = ${r.loopSamples} samples)`);
  // the fitted loop must be the rendered loop rotated by whole bars (gain aside): correlation at a bar offset
  const ref = r.stems[0].L;
  const corrAt = (rot) => { let a = 0, b2 = 0, c = 0; for (let i = Math.round(r.sr * 0.2); i < w.L.length; i += 13) { const x = ref[(i + rot) % r.loopSamples], y = w.L[i]; a += x * y; b2 += x * x; c += y * y; } return a / Math.sqrt(b2 * c + 1e-12); };
  // onsets are found on a 5 ms grid, so allow +-10 ms around each bar line
  let bestCorr = -1, bestLag = 0;
  const tol = Math.round(r.sr * 0.01);
  for (let b = 0; b < cue.bars; b++) for (let lag = -tol; lag <= tol; lag += 2) {
    const c = corrAt((Math.round(b * barSamples) + lag + r.loopSamples) % r.loopSamples);
    if (c > bestCorr) { bestCorr = c; bestLag = lag; }
  }
  ok(bestCorr > 0.98, `fit starts the loop on a bar line (within ${(Math.abs(bestLag) / r.sr * 1000).toFixed(1)} ms, correlation ${bestCorr.toFixed(4)})`);
  const steps = []; for (let i = 1; i < w.L.length; i += 7) steps.push(Math.abs(w.L[i] - w.L[i - 1])); steps.sort((a, b) => a - b);
  const seam = Math.abs(w.L[0] - w.L[w.L.length - 1]) / (steps[Math.floor(steps.length * 0.999)] || 1e-9);
  ok(seam < 1.5, `fitted loop is seamless (seam ${seam.toFixed(2)})`);
  const lu = M.loudness(w.L, w.R, w.sr), pk = M.gainToDb(M.peak(w.L, w.R));
  ok((Math.abs(lu + 16) < 0.6 || Math.abs(pk + 1) < 0.1) && pk <= -0.95, `fitted loop levelled (${lu.toFixed(1)} LUFS, peak ${pk.toFixed(1)} dBFS)`);
  const s1 = M.readWav(fs.readFileSync(res2.files[0])), s2 = M.readWav(fs.readFileSync(res2.files[1]));
  ok(s1.L.length === s2.L.length && res2.files.length === 2 && fs.existsSync(path.join(dir, 'fit_two.luau')) && /Name = "bed"[^\n]*Min = 0, Full = 0[\s\S]*Name = "top"/.test(fs.readFileSync(path.join(dir, 'fit_two.luau'), 'utf8')), 'fit cuts stems identically and writes a MusicCues entry (bed first)');

  // one-shot: silence trimmed, faded, peak at -1 dBFS
  const sr = 44100, hit = new Float32Array(sr * 2);
  for (let i = 0; i < sr * 0.4; i++) hit[sr * 0.5 + i] = Math.sin(i / sr * 2 * Math.PI * 220) * Math.exp(-i / (sr * 0.08)) * 0.2;
  const hf = path.join(dir, 'hit.wav');
  fs.writeFileSync(hf, M.wav(hit, hit, sr));
  console.log = () => {};
  try { one = G.fitOneShot(hf, { name: 'hit_clean', out: dir }); } finally { console.log = log; }
  const h = M.readWav(fs.readFileSync(one.files[0]));
  ok(h.L.length < sr * 0.45 && Math.abs(M.gainToDb(M.peak(h.L, h.R)) + 1) < 0.05 && Math.abs(h.L[h.L.length - 1]) < 1e-3, `one-shot trimmed to ${(h.L.length / sr).toFixed(2)} s, peak -1 dBFS, faded`);

  // the MCP result parser takes files on disk, never the app's /files/ URLs
  const fake = [{ id: 'a', path: path.resolve(hf), url: '/files/a.wav' }, { id: 'b', path: 'C:\\nope\\b.wav', url: '/files/b.wav' }];
  const found = G.audioPaths(fake);
  ok(found.length === 1 && found[0] === path.resolve(hf), 'MCP result parser keeps only audio files that exist on disk');

  // live: the MCP client against a running Mirli app (skipped when it isn't running)
  try {
    const out = execFileSync(process.execPath, [path.join(__dirname, 'generate.cjs'), 'status'], { encoding: 'utf8', timeout: 20000 });
    if (/ok {3}mirli/.test(out)) ok(/\+ audiocpp|\+ |installed|loaded/.test(out), 'Mirli MCP reachable: list_models answered');
    else console.log('skip Mirli MCP (app not running)');
  } catch (e) { ok(false, `generate.cjs status crashed: ${(e.stderr || e.message).slice(0, 300)}`); }
}

// 10. Luau
{
  const runner = path.join(SKILL, 'tests', 'run-luau.cjs');
  try {
    const out = execFileSync(process.execPath, [runner], { encoding: 'utf8' });
    const last = out.trim().split('\n').slice(-2).join(' | ');
    ok(/0 failed/.test(out) && /0 differences/.test(out) || /skipped/.test(out), `Luau tests: ${last}`);
  } catch (e) {
    ok(false, `Luau tests failed:\n${(e.stdout || '') + (e.stderr || '')}`);
  }
}

console.log(failures ? `\n${failures} check(s) failed` : '\nall checks passed');
process.exit(failures ? 1 : 0);
