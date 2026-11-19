// Guitar parts that sound like a guitarist played them, not like a keyboard with a guitar patch:
//
//   * Voicings come from a fretboard in standard tuning (E A D G B E): open chords low on the
//     neck, barre shapes higher up, the root in the bass, at most four fingers, and each chord
//     the shape closest to the last one.
//   * Styles (role "guitar", option `style`):
//       strum       down/up strums with ghosted "chk" mutes, accents and anticipated changes
//       fingerpick  Travis picking: thumb alternates root and another bass string, fingers
//                   pick the treble strings between, pinches on the downbeat, hammer-ons
//       power       power chords (root, 5th, octave), palm-muted 8ths or open, pushes
//       boogie      the blues shuffle comp: root-5th / root-6th (/ root-b7th) pairs
//       funk        16th-note "chicken scratch" on the top strings: muted scratches and short
//                   9th-chord stabs
//   * Blues lead (role "melody", style "licks"): phrases from a vocabulary of pentatonic / blues
//     licks with bends, curls, slides and vibrato, laid out as call, answer and space (AAB on a
//     12-bar), with a turnaround into the loop.
(function (M) {
  'use strict';

  const TUNING = [40, 45, 50, 55, 59, 64]; // E2 A2 D3 G3 B3 E4

  // ---------------------------------------------------------------- fretboard voicing
  // -> { pitches (low to high), strings (indices into TUNING), frets } or null.
  function fretVoicing(chord, prev, opts) {
    if (chord.root === null) return null;
    const o = opts || {};
    const strings = o.strings || [0, 1, 2, 3, 4, 5];
    const pcs = chord.pcs.concat(o.extra || []);
    const third = chord.intervals.find((i) => i === 3 || i === 4);
    const seventh = chord.intervals.find((i) => i === 10 || i === 11);
    const required = [chord.root].concat([third, seventh].filter((i) => i !== undefined).map((i) => (chord.root + i) % 12)).concat(o.extra || []);
    const minSound = o.minSound || Math.min(4, strings.length);
    const prevP = prev ? prev.pitches : null;
    let best = null, bestScore = Infinity;
    const maxStart = o.maxFret === undefined ? 9 : o.maxFret;
    for (let s = 0; s <= maxStart; s++) {
      const options = strings.map((si, k) => {
        const opt = [];
        if (k < 2 || o.muteAny) opt.push(-1);
        if (s <= 4 && !o.noOpen && pcs.includes(TUNING[si] % 12)) opt.push(0);
        for (let f = Math.max(1, s); f <= s + 3; f++) if (pcs.includes((TUNING[si] + f) % 12)) opt.push(f);
        return opt.length ? opt : [-1];
      });
      const pick = new Array(strings.length);
      const walk = (k, sounding) => {
        if (k === strings.length) {
          const frets = pick.slice();
          const idx = frets.map((f, j) => (f >= 0 ? j : -1)).filter((j) => j >= 0);
          if (idx.length < minSound) return;
          // muted strings only below the sounding ones (a strummed chord can't skip a string)
          if (!o.muteAny && idx[idx.length - 1] - idx[0] + 1 !== idx.length) return;
          const pitches = idx.map((j) => TUNING[strings[j]] + frets[j]);
          if (pitches[0] % 12 !== chord.root && !o.anyBass) return;
          const have = new Set(pitches.map((p) => p % 12));
          if (!required.every((pc) => have.has(pc))) return;
          const fretted = idx.map((j) => frets[j]).filter((f) => f > 0);
          if (fretted.length) {
            const lo = Math.min(...fretted), hi = Math.max(...fretted);
            if (hi - lo > 3) return;
            const atLo = fretted.filter((f) => f === lo).length;
            const fingers = (atLo >= 2 ? 1 : atLo) + fretted.filter((f) => f > lo).length;
            if (fingers > 4) return;
          }
          let score = s * 0.45 - frets.filter((f) => f === 0).length * 0.35 + (strings.length - idx.length) * 0.5;
          const thirds = pitches.filter((p) => third !== undefined && p % 12 === (chord.root + third) % 12).length;
          if (thirds > 1) score += 0.5;
          if (prevP) {
            const top = Math.abs(pitches[pitches.length - 1] - prevP[prevP.length - 1]);
            const bass = Math.abs(pitches[0] - prevP[0]);
            score += top * 0.25 + bass * 0.08 + Math.abs(s - (prev.start || 0)) * 0.25;
          }
          if (o.center) score += Math.abs((pitches[0] + pitches[pitches.length - 1]) / 2 - o.center) * 0.15;
          if (score < bestScore) { bestScore = score; best = { pitches, strings: idx.map((j) => strings[j]), frets: idx.map((j) => frets[j]), start: s }; }
          return;
        }
        for (const f of options[k]) {
          if (f === -1 && sounding) continue; // can't mute above a sounding string
          pick[k] = f;
          walk(k + 1, sounding || f >= 0);
        }
      };
      walk(0, false);
    }
    return best;
  }

  // Root of a power chord / boogie shape on the low E or A string, near the previous one.
  function lowRoot(chord, prevRoot) {
    const cands = [];
    for (let m = 40; m < 52; m++) if (m % 12 === chord.root) cands.push(m);
    if (prevRoot === undefined || prevRoot === null) return cands[0];
    return cands.sort((a, b) => Math.abs(a - prevRoot) - Math.abs(b - prevRoot))[0];
  }

  const STRUMS = {
    folk: 'D.DU.UDU', pop: 'D.DUDUDU', ballad: 'D...D.DU', drive: 'DUDUDUDU', island: '.U.U.U.U',
    country: 'D.dU.UdU', reggae: '.x.x.x.x', shuffle: 'D.DUD.DU', whole: 'D.......',
    folk16: 'D...D.U.x.U.D.U.', strummy16: 'D.DUx.DUD.DUx.DU',
  };
  const POWER = {
    punk: 'mmmmmmmm', punk_open: 'OoooOooo', drive: 'OmmmOmmm', rock: 'O-mmO-mm', anthem: 'O-------',
    stop: 'O..mO..m', gallop: 'm.mmm.mmm.mmm.mm', chug16: 'mmmmmmmmmmmmmmmm', pushes: 'O-----mO',
  };
  const FUNK = ['X.xxX.x.x.xX.x.x', 'x.xX.xx.x.Xx.x.X', 'X..xx.X..x.xX.x.', '.xX.x.xX.x.Xx.x.'];

  function note(t, d, p, v, extra) {
    const n = { t, d, p, v: Math.max(0.05, Math.min(1, v)) };
    if (extra) Object.assign(n, extra);
    return n;
  }

  function stepGrid(pattern, ctx) {
    const steps = pattern.length;
    return { steps, stepBeats: ctx.beatsPerBar / steps };
  }

  // Chord for a strum at t; with `push`, an offbeat strum just before a change plays the next
  // chord early (the anticipation every rock and pop guitarist uses).
  function chordFor(ctx, t, push, stepBeats) {
    const seg = M.chordAt(ctx.progression, t);
    if (push && Math.abs(t % 1) > 1e-6) {
      const ahead = M.chordAt(ctx.progression, (t + stepBeats + 1e-6) % ctx.totalBeats);
      if (ahead !== seg && Math.abs(ahead.start - (t + stepBeats)) < 1e-6) return ahead;
    }
    return seg;
  }

  // ---------------------------------------------------------------- strum
  function genStrumGuitar(part, ctx, r) {
    const pat = STRUMS[part.pattern] || part.pattern || STRUMS.folk;
    const g = stepGrid(pat, ctx);
    const out = [];
    const spb = ctx.bpm / 60;
    let prev = null, seg = null, voicing = null;
    for (let bar = 0; bar < ctx.bars; bar++) {
      for (let s = 0; s < g.steps; s++) {
        const ch = pat[s];
        if (ch === '.' || ch === '-') continue;
        const t = bar * ctx.beatsPerBar + s * g.stepBeats;
        const sgm = chordFor(ctx, t, part.push !== false, g.stepBeats);
        if (sgm.chord.root === null) continue;
        if (sgm !== seg) { seg = sgm; voicing = fretVoicing(sgm.chord, prev, { center: part.center }); prev = voicing || prev; }
        if (!voicing) continue;
        // ring until the next strum
        let k = s + 1, gap = 1;
        while (k < g.steps * 2 && ['.', '-'].includes(pat[k % g.steps])) { k++; gap++; }
        const ring = Math.min(gap * g.stepBeats, 4);
        const up = ch === 'U' || ch === 'u';
        const dead = ch === 'x';
        const accent = ch === 'D' || ch === 'U' ? 1 : dead ? 0.55 : 0.72;
        const strs = up ? voicing.pitches.slice(-4).reverse() : voicing.pitches;
        const spread = (accent > 0.9 ? 0.009 : 0.013) * spb; // seconds -> beats
        strs.forEach((p, j) => out.push(note(t + j * spread, dead ? 0.08 : ring + 0.05, p, accent * (up ? 0.82 : 1) * (1 - j * 0.035) * (0.9 + r() * 0.1), dead ? { mute: true } : null)));
      }
    }
    return out;
  }

  // ---------------------------------------------------------------- fingerpick (Travis)
  const TRAVIS = {
    travis: [[0, 5], [null, 3], [1, null], [null, 4], [0, null], [null, 5], [1, 3], [null, 4]],
    roll: [[0, null], [null, 3], [1, 4], [null, 5], [0, null], [null, 4], [1, 3], [null, 5]],
    ballad: [[0, null], [null, 3], [null, 4], [null, 5], [1, null], [null, 4], [null, 3], [null, 4]],
    waltz: [[0, 5], [null, 3], [1, 4], [null, 3], [1, 5], [null, 4]],
  };
  function genFingerpick(part, ctx, r) {
    const pat = TRAVIS[part.pattern] || (ctx.beatsPerBar === 3 ? TRAVIS.waltz : TRAVIS.travis);
    const stepBeats = ctx.beatsPerBar / pat.length;
    const out = [];
    let prev = null, seg = null, v = null;
    const lastOn = {}; // string -> note, for let-ring lengths
    const place = (t, p, string, vel, extra) => {
      const prevNote = lastOn[string];
      if (prevNote) prevNote.d = Math.min(prevNote.d, Math.max(0.1, t - prevNote.t));
      const n = note(t, 3, p, vel, extra);
      lastOn[string] = n;
      out.push(n);
    };
    for (let bar = 0; bar < ctx.bars; bar++) {
      for (let s = 0; s < pat.length; s++) {
        const t = bar * ctx.beatsPerBar + s * stepBeats;
        const sgm = M.chordAt(ctx.progression, t);
        if (sgm.chord.root === null) continue;
        if (sgm !== seg) { seg = sgm; v = fretVoicing(sgm.chord, prev, { center: part.center || 55 }); prev = v || prev; }
        if (!v) continue;
        const [thumb, finger] = pat[s];
        const bassIdx = v.strings.map((st, i) => (st <= 2 ? i : -1)).filter((i) => i >= 0);
        if (thumb !== null && bassIdx.length) {
          // thumb: 0 = root (lowest string), 1 = alternate bass two strings over (or the next one)
          let i = bassIdx[0];
          if (thumb === 1) i = v.strings.indexOf(v.strings[bassIdx[0]] + 2) >= 0 ? v.strings.indexOf(v.strings[bassIdx[0]] + 2) : Math.min(bassIdx[0] + 1, v.pitches.length - 1);
          const strong = s === 0 ? 0.88 : 0.74;
          place(t, v.pitches[i], v.strings[i], strong * (0.93 + r() * 0.07), part.palmMute ? { pm: true } : null);
        }
        if (finger !== null) {
          const i = v.strings.indexOf(finger);
          if (i >= 0) {
            const fret = v.frets[i];
            const extra = fret >= 2 && r() < (part.hammers === undefined ? 0.12 : part.hammers) ? { hammer: r() < 0.5 ? 1 : 2 } : null;
            place(t + (thumb !== null ? 0.004 * ctx.bpm / 60 : 0), v.pitches[i], finger, (thumb !== null ? 0.7 : 0.6) * (0.9 + r() * 0.1), extra);
          }
        }
      }
    }
    for (const n of out) n.d = Math.min(n.d, ctx.totalBeats - n.t);
    return out;
  }

  // ---------------------------------------------------------------- power chords
  function genPower(part, ctx, r) {
    const pat = POWER[part.pattern] || part.pattern || POWER.punk;
    const g = stepGrid(pat, ctx);
    const out = [];
    const spb = ctx.bpm / 60;
    let root = null;
    for (let bar = 0; bar < ctx.bars; bar++) {
      for (let s = 0; s < g.steps; s++) {
        const ch = pat[s];
        if (ch === '.' || ch === '-') continue;
        const t = bar * ctx.beatsPerBar + s * g.stepBeats;
        const seg = chordFor(ctx, t, part.push !== false, g.stepBeats);
        if (seg.chord.root === null) continue;
        root = lowRoot(seg.chord, root) + (part.octave === 3 ? 12 : 0);
        const fifth = seg.chord.intervals[2] || 7;
        let k = s + 1, gap = 1;
        while (k < g.steps * 2 && pat[k % g.steps] === '-') { k++; gap++; }
        const muted = ch === 'm';
        const len = muted ? Math.min(g.stepBeats * 0.9, 0.3) : gap * g.stepBeats * 0.95;
        const vel = ch === 'O' ? 1 : ch === 'o' ? 0.8 : 0.82;
        [root, root + fifth, root + 12].forEach((p, j) => out.push(note(t + j * 0.004 * spb, len, p, vel * (0.92 + r() * 0.08) * (1 - j * 0.05), muted ? { pm: true } : null)));
      }
    }
    return out;
  }

  // ---------------------------------------------------------------- blues shuffle comp
  function genBoogie(part, ctx, r) {
    const late = ctx.steps % 3 === 0 ? 2 / 3 : 0.5; // second 8th of the beat: triplet or swung
    const out = [];
    let root = null;
    for (let b = 0; b < ctx.totalBeats; b++) {
      const seg = M.chordAt(ctx.progression, b);
      if (seg.chord.root === null) continue;
      root = lowRoot(seg.chord, root);
      const beatInBar = b % ctx.beatsPerBar;
      const barInChord = Math.floor((b - seg.start) / ctx.beatsPerBar);
      const seventhBar = barInChord % 2 === 1 && part.seventh !== false;
      const upper = beatInBar % 2 === 0 ? 7 : (seventhBar && beatInBar === 2 ? 10 : 9);
      const top = beatInBar === 2 && seventhBar ? 10 : upper;
      [0, late].forEach((off, k) => {
        const v = (k === 0 ? 0.9 : 0.66) * (beatInBar === 0 ? 1 : 0.92) * (0.93 + r() * 0.07);
        const len = (k === 0 ? late : 1 - late) * 0.92;
        out.push(note(b + off, len, root, v, part.palmMute ? { pm: true } : null));
        out.push(note(b + off + 0.004 * ctx.bpm / 60, len, root + top, v * 0.95, part.palmMute ? { pm: true } : null));
      });
    }
    return out;
  }

  // ---------------------------------------------------------------- funk scratch
  function genFunk(part, ctx, r) {
    const pr = M.rng(M.hashSeed(ctx.seed, 'funk-pattern', part.inst));
    const pat = part.pattern || pr.pick(FUNK);
    const g = stepGrid(pat, ctx);
    const out = [];
    let prev = null, seg = null, v = null;
    for (let bar = 0; bar < ctx.bars; bar++) {
      for (let s = 0; s < g.steps; s++) {
        let ch = pat[s];
        if (bar % 4 === 3 && s >= g.steps - 4 && ch === 'x') ch = 'X'; // a stab pickup into the next phrase
        if (ch === '.') continue;
        const t = bar * ctx.beatsPerBar + s * g.stepBeats;
        const sgm = M.chordAt(ctx.progression, t);
        if (sgm.chord.root === null) continue;
        if (sgm !== seg) {
          seg = sgm;
          const extra = M.chordExtensions(sgm.chord, ctx.keyPc, ctx.scale, 2);
          v = fretVoicing(sgm.chord, prev, { strings: [2, 3, 4, 5], extra: extra.slice(0, 1), minSound: 3, anyBass: true, noOpen: true, center: 62 }) ||
            fretVoicing(sgm.chord, prev, { strings: [2, 3, 4, 5], minSound: 3, anyBass: true, noOpen: true, center: 62 });
          prev = v || prev;
        }
        if (!v) continue;
        const dead = ch === 'x';
        const up = s % 2 === 1;
        const strs = up ? v.pitches.slice().reverse() : v.pitches;
        strs.forEach((p, j) => out.push(note(t + j * 0.003 * ctx.bpm / 60, dead ? 0.06 : 0.18, p, (dead ? 0.5 : 0.95) * (0.9 + r() * 0.1), dead ? { mute: true } : null)));
      }
    }
    return out;
  }

  function genGuitar(part, ctx, r) {
    const style = part.style || 'strum';
    if (style === 'strum') return genStrumGuitar(part, ctx, r);
    if (style === 'fingerpick') return genFingerpick(part, ctx, r);
    if (style === 'power') return genPower(part, ctx, r);
    if (style === 'boogie') return genBoogie(part, ctx, r);
    if (style === 'funk') return genFunk(part, ctx, r);
    throw new Error(`unknown guitar style '${style}'`);
  }

  // ---------------------------------------------------------------- blues licks
  // [eighth, length in eighths, semitones above the tonic, articulation]. Generic pentatonic and
  // blues vocabulary (bend = up a whole step into the note, curl = a quarter-tone nudge on the
  // minor 3rd, slide = slide in from below, vib = vibrato).
  const LICKS = {
    call: [
      [[0, 1, 7], [1, 1, 10], [2, 2, 12, 'bend'], [4, 1, 10], [5, 1, 7], [6, 2, 10, 'vib']],
      [[0, 3, 19, 'bend'], [3, 1, 15], [4, 1, 12], [5, 1, 10], [6, 2, 7, 'vib']],
      [[0, 1, 10], [1, 1, 12], [2, 1, 15, 'curl'], [3, 1, 12], [4, 1, 10], [5, 1, 7], [6, 2, 10, 'vib']],
      [[1, 1, 12], [2, 2, 15, 'curl'], [4, 1, 17], [5, 3, 19, 'vib']],
      [[0, 2, 22, 'bend'], [2, 2, 22, 'bend'], [4, 1, 19], [5, 1, 15], [6, 2, 17, 'vib']],
    ],
    answer: [
      [[0, 2, 15, 'curl'], [2, 1, 12], [3, 1, 10], [4, 4, 12, 'vib']],
      [[0, 2, 7, 'slide'], [2, 1, 10], [3, 1, 7], [4, 1, 5], [5, 1, 3, 'curl'], [6, 2, 0, 'vib']],
      [[0, 1, 3, 'slide'], [1, 1, 4], [2, 1, 7], [3, 1, 9], [4, 1, 7], [5, 1, 4], [6, 2, 0, 'vib']],
      [[0, 1, 15], [1, 1, 12], [2, 1, 10], [3, 1, 7], [4, 1, 6], [5, 1, 5], [6, 1, 3, 'curl'], [7, 1, 0]],
    ],
    short: [
      [[1, 1, 10], [2, 3, 12, 'vib']],
      [[0, 1, 15, 'curl'], [1, 3, 12, 'vib']],
      [[2, 3, 7, 'bend'], [5, 1, 5], [6, 2, 3, 'curl']],
    ],
    turn: [
      [[0, 1, 12], [1, 1, 11], [2, 1, 10], [3, 1, 9], [4, 4, 7, 'vib']],
      [[0, 1, 12], [1, 1, 9], [2, 1, 10], [3, 1, 7], [4, 4, 7, 'vib']],
    ],
  };

  function genLicks(part, ctx) {
    const r = M.rng(M.hashSeed(ctx.seed, 'licks', part.inst));
    const range = part.range || [52, 79];
    let base = M.nearestWithPc(ctx.keyPc, range[0] + 3);
    if (base < range[0]) base += 12;
    const late = ctx.steps % 3 === 0 ? 2 / 3 : 0.5;
    const pos = (k) => Math.floor(k / 2) + (k % 2 ? late : 0);
    const callA = r.pick(LICKS.call), answer = r.pick(LICKS.answer), resolve = r.pick(LICKS.answer.filter((l) => l !== answer)) || answer;
    const shorts = LICKS.short, turn = r.pick(LICKS.turn);
    // bar plan: which lick (or none) starts in each bar
    const plan = new Array(ctx.bars).fill(null);
    if (ctx.bars === 12) {
      plan[0] = callA; plan[1] = r.pick(shorts); plan[4] = callA; plan[5] = r.pick(shorts);
      plan[8] = r.pick(LICKS.call.filter((l) => l !== callA)); plan[9] = answer; plan[10] = resolve; plan[11] = turn;
    } else {
      for (let g = 0; g * 4 < ctx.bars; g++) {
        const b = g * 4;
        if (g % 2 === 0) { plan[b] = callA; if (b + 1 < ctx.bars) plan[b + 1] = r.pick(shorts); }
        else { plan[b] = answer; if (b + 2 < ctx.bars) plan[b + 2] = r() < 0.5 ? r.pick(shorts) : null; }
      }
      if (ctx.bars >= 4) plan[ctx.bars - 1] = turn;
    }
    const out = [];
    const ART = { bend: { bend: 2 }, curl: { bend: 0.5, bendTime: 0.08 }, slide: { slide: 2 }, vib: { vib: 30 } };
    plan.forEach((lick, bar) => {
      if (!lick) return;
      // a pickup: start an eighth early when the previous bar is silent
      const pickup = bar > 0 && !plan[bar - 1] && r() < 0.4 ? -late : 0;
      lick.forEach(([k, len, semi, art], i) => {
        let p = base + semi;
        while (p > range[1]) p -= 12;
        const t = bar * ctx.beatsPerBar + pos(k) + (i === 0 ? pickup : 0);
        const end = bar * ctx.beatsPerBar + pos(k + len);
        const d = Math.max(0.12, end - t - (art === 'vib' ? 0 : 0.04));
        const v = (i === 0 ? 0.88 : 0.76) + (art === 'bend' ? 0.08 : 0);
        out.push(Object.assign(note((t + ctx.totalBeats) % ctx.totalBeats, Math.min(d, ctx.totalBeats - ((t + ctx.totalBeats) % ctx.totalBeats)), p, v * (0.94 + r() * 0.06)), art ? ART[art] : null));
      });
    });
    out.sort((a, b) => a.t - b.t);
    // the first lick doubles as the cue's motif (stingers quote it)
    const steps8 = ctx.steps / 8;
    const rhythm = callA.map(([k, len]) => ({ at: Math.round(k * steps8), len: Math.max(1, Math.round(len * steps8)), rest: false }));
    const offsets = callA.map(([, , semi]) => Math.round((semi - callA[0][2]) * 7 / 12));
    out.motif = { rhythm, offsets, shape: 'licks', form: ['licks'], unitBeats: ctx.beatsPerBar, notes: [] };
    return out;
  }

  Object.assign(M, { TUNING, fretVoicing, lowRoot, genGuitar, genLicks, STRUMS, POWER, TRAVIS, FUNK_SCRATCH: FUNK, LICKS });
})(typeof MusicEngine !== 'undefined' ? MusicEngine : (globalThis.MusicEngine = globalThis.MusicEngine || {}));
