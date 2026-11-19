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
  ok(current === content, `${path.relative(SKILL, file)} up to date (node scripts/compose.cjs build)`);
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
    const ns = mel.notes;
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
    for (const c of (parts.find((x) => x.role === 'counter') || { notes: [] }).notes) {
      const m = ns.filter((n) => n.t <= c.t + 1e-9 && n.t + n.d > c.t).pop();
      if (m) { checkedUnder++; if (c.p < m.p) under++; }
    }
  }
  const pct = (a, b) => (100 * a / Math.max(1, b)).toFixed(1);
  ok(tonicFifth / notes < 0.32, `melodies don't lean on the tonic and fifth (${pct(tonicFifth, notes)}% of ${notes} notes)`);
  ok(repeats / notes < 0.2, `few repeated notes (${pct(repeats, notes)}%)`);
  ok(clash / strong < 0.05 && unresolved <= Math.ceil(strong * 0.005), `strong-beat dissonances are rare and resolve by step (${clash} of ${strong}, ${unresolved} unresolved)`);
  ok(under / Math.max(1, checkedUnder) > 0.97, `counterlines stay under the melody (${pct(under, checkedUnder)}%)`);
  ok(forms.size >= 3, `melodies use several phrase forms (${forms.size})`);
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
