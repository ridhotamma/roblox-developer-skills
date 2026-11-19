// Composition: a mood preset + a seed -> a cue (notes per part, grouped into intensity stems),
// plus stingers, an intro pickup and an ending. Time is in beats; the renderer turns it into audio.
//
// A cue is built for adaptive playback:
//   * every stem is the same length (bars x beats) and starts on the downbeat, so stems can be
//     layered in any combination (vertical layering) and looped seamlessly;
//   * one key, one tempo, one progression across stems, so any subset sounds finished;
//   * stingers are written in the cue's key and the intro/ending land on bar lines, so they can be
//     scheduled on the next beat / bar (horizontal re-sequencing).
(function (M) {
  'use strict';

  const ROLE_TARGET = { // part loudness before the final mix normalization (LUFS, gated)
    drums: -18, perc: -26, bass: -20, pad: -24, stabs: -22, arp: -24, ostinato: -22, broken: -23,
    pulse: -27, drone: -25, cluster: -27, melody: -20, counter: -24, bells: -26, fx: -26, strum: -23,
  };
  const LIGHT_DRUMS = ['hat', 'openhat', 'shaker', 'tick', 'rim', 'ride'];

  function ctxFor(preset, opts) {
    const o = opts || {};
    const seed = o.seed === undefined ? 1 : o.seed;
    const key = o.key || preset.key;
    const mode = o.mode || preset.mode;
    const bpm = o.bpm || preset.bpm;
    const beatsPerBar = preset.beatsPerBar || 4;
    const bars = o.bars || preset.bars || 8;
    const steps = preset.steps || beatsPerBar * 4;
    const keyPc = M.keyPitchClass(key);
    const progression = M.parseProgression(o.progression || preset.progression, keyPc, mode, beatsPerBar, bars);
    return {
      preset, seed, key, keyPc, mode, bpm, beatsPerBar, bars, steps,
      stepBeats: beatsPerBar / steps,
      totalBeats: bars * beatsPerBar,
      scale: M.scaleOf(mode),
      melodyScale: M.scaleOf(preset.melodyScale || mode),
      progression,
    };
  }

  function note(t, d, p, v, extra) {
    const n = { t, d, p, v: Math.max(0.05, Math.min(1, v)) };
    if (extra) Object.assign(n, extra);
    return n;
  }

  // ---------------------------------------------------------------- drums
  function genDrums(part, ctx, r) {
    const pat = M.DRUMS[part.pattern];
    if (!pat) throw new Error(`unknown drum pattern '${part.pattern}'`);
    const voices = part.voices || Object.keys(pat).filter((k) => k !== 'steps');
    const stepBeats = ctx.beatsPerBar / pat.steps;
    const out = [];
    for (let bar = 0; bar < ctx.bars; bar++) {
      const lastBar = bar === ctx.bars - 1;
      const fillFrom = part.fill && lastBar ? pat.steps - pat.steps / ctx.beatsPerBar * (part.fillBeats || 1) : Infinity;
      for (const voice of voices) {
        const line = pat[voice];
        if (!line) continue;
        for (let s = 0; s < pat.steps; s++) {
          if (s >= fillFrom && ['snare', 'tom', 'kick', 'taiko', 'hat'].includes(voice)) continue;
          const vel = M.velocityOf(line[s]);
          if (!vel) continue;
          const t = bar * ctx.beatsPerBar + s * stepBeats;
          out.push(note(t, stepBeats, voice, vel * (0.94 + r() * 0.12), { pitch: voice === 'tom' ? (s % 3) : 0 }));
        }
      }
      if (part.fill && lastBar) {
        // Fill: a crescendo roll over the last beat(s) on toms if present, else snare.
        const fillVoice = voices.includes('tom') ? 'tom' : voices.includes('snare') ? 'snare' : voices.includes('taiko') ? 'taiko' : null;
        if (fillVoice) {
          const n = pat.steps - fillFrom;
          for (let i = 0; i < n; i++) {
            const t = bar * ctx.beatsPerBar + (fillFrom + i) * stepBeats;
            out.push(note(t, stepBeats, fillVoice, 0.55 + 0.45 * (i / Math.max(1, n - 1)), { pitch: fillVoice === 'tom' ? 2 - Math.floor((i / n) * 3) : 0 }));
          }
        }
      }
    }
    if (part.crash) out.push(note(0, 1, 'crash', 0.9));
    return out;
  }

  function rhythmHits(name, ctx) {
    const line = M.RHYTHMS[name] || name; // a preset may give the string itself
    const steps = line.length;
    const stepBeats = ctx.beatsPerBar / steps;
    const hits = [];
    for (let s = 0; s < steps; s++) {
      const vel = M.velocityOf(line[s]);
      if (!vel) continue;
      let len = 1;
      while (s + len < steps && line[s + len] === '.') len++;
      hits.push({ at: s * stepBeats, len: len * stepBeats, vel });
    }
    return hits;
  }

  // ---------------------------------------------------------------- bass
  function genBass(part, ctx, r) {
    const octave = part.octave === undefined ? 2 : part.octave;
    const center = 12 * (octave + 1) + 5;
    const out = [];
    const style = part.style || 'sustain';
    const gate = part.gate || (style === 'sustain' || style === 'drone' ? 1 : 0.8);
    if (style === 'sustain' || style === 'drone') {
      for (const seg of ctx.progression) {
        if (seg.chord.root === null) continue;
        const root = style === 'drone' ? M.nearestWithPc(ctx.keyPc, center) : M.rootNear(seg.chord, center);
        out.push(note(seg.start, seg.length * gate, root, 0.9));
      }
      return out;
    }
    if (style === 'walking') {
      for (let b = 0; b < ctx.totalBeats; b++) {
        const seg = M.chordAt(ctx.progression, b);
        if (seg.chord.root === null) continue;
        const pos = b - seg.start;
        const next = M.chordAt(ctx.progression, (b + 1) % ctx.totalBeats);
        const root = M.rootNear(seg.chord, center);
        let p;
        if (pos === 0) p = root;
        else if (b + 1 === next.start || (b + 1) % ctx.totalBeats === next.start % ctx.totalBeats) {
          const target = M.rootNear(next.chord, root);
          p = target + (r() < 0.5 ? -1 : 1); // chromatic approach
        } else {
          const tones = M.chordTonesBetween(seg.chord, root, root + 12);
          p = tones[1 + Math.floor(r() * (tones.length - 1))] || root + 7;
        }
        out.push(note(b, 0.9, p, b % 2 === 0 ? 0.9 : 0.75));
      }
      return out;
    }
    const rhythmName = { ostinato16: 'ostinato16', chug: 'chug16', gallop: 'gallop16', eighths: 'eighths', offbeat: 'offbeat', octaves: 'eighths', quarters: 'quarters', syncopated: 'syncopated', tresillo: 'tresillo', '808': 'trap808', halftime: 'halftime', heartbeat: 'heartbeat' }[style] || part.rhythm;
    if (!rhythmName) throw new Error(`unknown bass style '${style}'`);
    const hits = rhythmHits(part.rhythm || rhythmName, ctx);
    for (let bar = 0; bar < ctx.bars; bar++) {
      hits.forEach((h, i) => {
        const t = bar * ctx.beatsPerBar + h.at;
        const seg = M.chordAt(ctx.progression, t);
        if (seg.chord.root === null) return;
        let p = M.rootNear(seg.chord, center);
        if (style === 'octaves' && i % 2 === 1) p += 12;
        if ((style === 'ostinato16' || style === 'chug') && i % 8 === 7 && r() < 0.5) p += 7; // a fifth now and then
        const len = style === '808' ? Math.min(h.len, seg.start + seg.length - t) : Math.min(h.len, 0.5) * gate;
        out.push(note(t, Math.max(0.1, len), p, h.vel * (0.92 + r() * 0.1), style === '808' && r() < 0.25 ? { glide: 12 } : null));
      });
    }
    return out;
  }

  // ---------------------------------------------------------------- harmony
  function genPad(part, ctx) {
    const octave = part.octave === undefined ? 4 : part.octave;
    const center = 12 * (octave + 1) + 2;
    const out = [];
    let prev = null;
    for (const seg of ctx.progression) {
      if (seg.chord.root === null) continue;
      const v = M.voiceChord(seg.chord, center, prev, part.voices || 4);
      prev = v;
      for (const p of v) out.push(note(seg.start, seg.length + 0.02, p, 0.8));
    }
    if (part.hold) out.forEach((n) => (n.hold = true));
    return mergeTies(out, ctx);
  }

  // Join identical pitches across chord changes (smoother pads, no re-attacks on common tones).
  function mergeTies(notes, ctx) {
    const byPitch = {};
    notes.sort((a, b) => a.t - b.t);
    const out = [];
    for (const n of notes) {
      const last = byPitch[n.p];
      if (last && Math.abs(last.t + last.d - 0.02 - n.t) < 1e-6) { last.d += n.d - 0.02; continue; }
      byPitch[n.p] = n;
      out.push(n);
    }
    // A note that runs to the loop end and one that starts at 0 on the same pitch would re-attack
    // at the loop point; that's correct musically (the loop restarts the chord), so keep both.
    void ctx;
    return out;
  }

  function genStabs(part, ctx, r) {
    const octave = part.octave === undefined ? 4 : part.octave;
    const center = 12 * (octave + 1) + 2;
    const hits = rhythmHits(part.rhythm || 'pushes', ctx);
    const out = [];
    let prev = null;
    for (let bar = 0; bar < ctx.bars; bar++) {
      for (const h of hits) {
        const t = bar * ctx.beatsPerBar + h.at;
        const seg = M.chordAt(ctx.progression, t);
        if (seg.chord.root === null) continue;
        const v = M.voiceChord(seg.chord, center, prev, part.voices || 3);
        prev = v;
        const len = Math.min(h.len * 0.9, part.length || 0.5);
        for (const p of v) out.push(note(t, len, p, h.vel * (0.9 + r() * 0.1)));
        if (part.bassNote) out.push(note(t, len, M.rootNear(seg.chord, center - 12), h.vel));
      }
    }
    return out;
  }

  function genArp(part, ctx, r) {
    const octave = part.octave === undefined ? 4 : part.octave;
    const lo = 12 * (octave + 1);
    const span = part.span || 2;
    const rate = (part.rate || 1) * ctx.stepBeats; // in beats
    const pattern = part.pattern || 'up';
    const out = [];
    let i = 0;
    for (let t = 0; t < ctx.totalBeats - 1e-9; t += rate, i++) {
      const seg = M.chordAt(ctx.progression, t);
      if (seg.chord.root === null) continue;
      const tones = M.chordTonesBetween(seg.chord, lo, lo + 12 * span);
      if (!tones.length) continue;
      let idx;
      const n = tones.length;
      const local = Math.round((t - seg.start) / rate);
      if (pattern === 'up') idx = local % n;
      else if (pattern === 'down') idx = n - 1 - (local % n);
      else if (pattern === 'updown') { const cyc = Math.max(1, 2 * n - 2); const k = local % cyc; idx = k < n ? k : cyc - k; }
      else if (pattern === 'pinky') idx = local % 2 === 0 ? n - 1 : (local >> 1) % (n - 1);
      else idx = Math.floor(r() * n);
      const accent = Math.abs((t / ctx.beatsPerBar) % 1) < 1e-6 ? 1 : (Math.abs(t % 1) < 1e-6 ? 0.85 : 0.68);
      out.push(note(t, rate * (part.gate || 0.9), tones[idx], accent * (0.92 + r() * 0.08)));
    }
    void i;
    return out;
  }

  // Zimmer-style string ostinato: one rhythmic shape, pitches re-fitted to every chord.
  function genOstinato(part, ctx, r) {
    const octave = part.octave === undefined ? 3 : part.octave;
    const lo = 12 * (octave + 1) + 2;
    const shape = part.shape || [0, 0, 2, 0, 1, 0, 2, 0];
    const rate = (part.rate || 1) * ctx.stepBeats;
    const accents = part.accents || 'X-x-x-X-x-x-X-x-';
    const out = [];
    let k = 0;
    for (let t = 0; t < ctx.totalBeats - 1e-9; t += rate, k++) {
      const seg = M.chordAt(ctx.progression, t);
      if (seg.chord.root === null) continue;
      const tones = M.chordTonesBetween(seg.chord, lo, lo + 19);
      const p = tones[Math.min(shape[k % shape.length], tones.length - 1)];
      const vel = M.velocityOf(accents[k % accents.length]) || 0.55;
      out.push(note(t, rate * 0.7, p, vel * (0.93 + r() * 0.07)));
    }
    return out;
  }

  // Piano left hand: root, fifth, tenth, fifth (eighths).
  function genBroken(part, ctx, r) {
    const octave = part.octave === undefined ? 3 : part.octave;
    const center = 12 * (octave + 1) + 2;
    const out = [];
    const rate = part.rate ? part.rate * ctx.stepBeats : 0.5;
    let k = 0;
    for (let t = 0; t < ctx.totalBeats - 1e-9; t += rate, k++) {
      const seg = M.chordAt(ctx.progression, t);
      if (seg.chord.root === null) continue;
      const root = M.rootNear(seg.chord, center - 5);
      const third = seg.chord.intervals[1] || 4;
      const fifth = seg.chord.intervals[2] || 7;
      const cycle = [root, root + fifth, root + 12 + third, root + fifth];
      out.push(note(t, rate * 1.8, cycle[k % 4], (k % 4 === 0 ? 0.85 : 0.6) * (0.92 + r() * 0.08)));
    }
    return out;
  }

  // Strummed chords (guitar): notes 12-20 ms apart, down/up strokes.
  function genStrum(part, ctx, r) {
    const octave = part.octave === undefined ? 3 : part.octave;
    const center = 12 * (octave + 1) + 7;
    const hits = rhythmHits(part.rhythm || 'eighths', ctx);
    const out = [];
    let prev = null;
    const spread = 0.015 * ctx.bpm / 60; // seconds -> beats
    for (let bar = 0; bar < ctx.bars; bar++) {
      hits.forEach((h, i) => {
        const t = bar * ctx.beatsPerBar + h.at;
        const seg = M.chordAt(ctx.progression, t);
        if (seg.chord.root === null) return;
        const v = M.voiceChord(seg.chord, center, prev, 5);
        prev = v;
        const order = i % 2 === 0 ? v : v.slice().reverse();
        order.forEach((p, j) => out.push(note(t + j * spread, Math.min(h.len, 2), p, h.vel * (0.85 + r() * 0.15) * (1 - j * 0.04))));
      });
    }
    return out;
  }

  function genPulse(part, ctx, r) {
    const octave = part.octave === undefined ? 5 : part.octave;
    const center = 12 * (octave + 1);
    const hits = rhythmHits(part.rhythm || 'eighths', ctx);
    const pcs = (part.notes || [0]).map((deg) => (ctx.keyPc + ctx.scale[deg % ctx.scale.length]) % 12);
    const out = [];
    let k = 0;
    for (let bar = 0; bar < ctx.bars; bar++) {
      for (const h of hits) {
        const p = M.nearestWithPc(pcs[k++ % pcs.length], center);
        out.push(note(bar * ctx.beatsPerBar + h.at, Math.min(h.len, 0.5) * (part.gate || 0.6), p, h.vel * (0.9 + r() * 0.1)));
      }
    }
    return out;
  }

  // Held for the whole loop (rendered as a seamless crossfaded loop).
  function genDrone(part, ctx) {
    const octave = part.octave === undefined ? 2 : part.octave;
    const root = M.nearestWithPc(ctx.keyPc, 12 * (octave + 1) + 5);
    const ints = part.intervals || (part.fifth === false ? [0] : [0, 7]);
    return ints.map((i) => note(0, ctx.totalBeats, root + i, 0.85, { hold: true }));
  }

  function genCluster(part, ctx) {
    const octave = part.octave === undefined ? 4 : part.octave;
    const root = M.nearestWithPc(ctx.keyPc, 12 * (octave + 1) + 5);
    const ints = part.intervals || [0, 1, 6, 11];
    return ints.map((i) => note(0, ctx.totalBeats, root + i, 0.7, { hold: true }));
  }

  // ---------------------------------------------------------------- melody
  function barRhythm(density, ctx, r, isEnd) {
    // Onsets within one bar, in steps: [{at, len, rest}]
    const stepsPerBeat = ctx.steps / ctx.beatsPerBar;
    const out = [];
    if (density === 'hook' || density === 'fanfare') {
      const cell = r.pick(M.CELLS.bar);
      let s = 0;
      for (const c of cell) { const len = Math.round(Math.abs(c) * ctx.steps / 16); if (s >= ctx.steps) break; out.push({ at: s, len: Math.min(len, ctx.steps - s), rest: c < 0 }); s += len; }
      return out;
    }
    const bank = M.CELLS[density] || M.CELLS.medium;
    let s = 0;
    while (s < ctx.steps) {
      let cell = r.pick(bank);
      const cellLen = cell.reduce((a, c) => a + Math.abs(c), 0);
      const scale = stepsPerBeat / 4; // cells are written for 4 steps per beat
      if (cellLen > 4 && s + cellLen * scale > ctx.steps) cell = [4];
      for (const c of cell) {
        const len = Math.max(1, Math.round(Math.abs(c) * scale));
        if (s >= ctx.steps) break;
        out.push({ at: s, len: Math.min(len, ctx.steps - s), rest: c < 0 });
        s += len;
      }
    }
    if (isEnd) {
      // Phrase end: merge the last beat into one long note so the phrase breathes.
      const lastBeat = ctx.steps - stepsPerBeat * 2;
      const kept = out.filter((o) => o.at < lastBeat).map((o) => Object.assign({}, o, { len: Math.min(o.len, lastBeat - o.at) }));
      kept.push({ at: lastBeat, len: stepsPerBeat * 2, rest: false });
      return kept;
    }
    return out;
  }

  function pitchLine(onsets, ctx, r, opts) {
    const pitches = opts.pitches;
    const out = [];
    let idx = opts.startIdx;
    let dir = opts.dir || (r() < 0.5 ? 1 : -1);
    let lastStep = 0;
    onsets.forEach((o, i) => {
      if (o.rest) return;
      const seg = M.chordAt(ctx.progression, o.t);
      const strong = Math.abs(o.t % 1) < 1e-6;
      if (i > 0 || opts.moveFirst) {
        let step;
        if (Math.abs(lastStep) >= 3) step = -Math.sign(lastStep);
        else {
          const x = r();
          step = x < 0.1 ? 0 : x < 0.65 ? 1 : x < 0.9 ? 2 : r.int(3, 4);
          step *= dir;
        }
        idx += step;
        lastStep = step;
        if (r() < 0.22) dir = -dir;
      }
      if (idx < 0) { idx = -idx; dir = 1; }
      if (idx > pitches.length - 1) { idx = 2 * (pitches.length - 1) - idx; dir = -1; }
      idx = Math.max(0, Math.min(pitches.length - 1, idx));
      if ((strong || o.cadence) && seg.chord.root !== null) {
        // snap to the nearest chord tone (search outward)
        for (let d = 0; d <= 3; d++) {
          const a = pitches[idx + d], b = pitches[idx - d];
          if (a !== undefined && seg.chord.pcs.includes(a % 12)) { idx += d; break; }
          if (b !== undefined && seg.chord.pcs.includes(b % 12)) { idx -= d; break; }
        }
      }
      if (o.cadence !== undefined && o.cadence !== true) {
        const target = o.cadence; // pitch class to land on
        for (let d = 0; d <= 4; d++) {
          if (pitches[idx - d] !== undefined && pitches[idx - d] % 12 === target) { idx -= d; break; }
          if (pitches[idx + d] !== undefined && pitches[idx + d] % 12 === target) { idx += d; break; }
        }
      }
      out.push(note(o.t, o.d, pitches[idx], (strong ? 0.92 : 0.74) * (0.93 + r() * 0.07)));
    });
    return { notes: out, endIdx: idx };
  }

  function genMelody(part, ctx, r) {
    const style = part.style || 'motif';
    const octave = part.octave === undefined ? 5 : part.octave;
    const range = part.range || [12 * (octave + 1) - 3, 12 * (octave + 1) + 16];
    const pitches = M.scalePitches(ctx.keyPc, ctx.melodyScale, range[0], range[1]);
    const stepBeats = ctx.stepBeats;
    const out = [];
    if (style === 'bells') {
      for (let b = 0; b < ctx.totalBeats; b += 1) {
        if (r() > (part.chance || 0.3)) continue;
        const seg = M.chordAt(ctx.progression, b);
        const tones = seg.chord.root === null ? pitches : M.chordTonesBetween(seg.chord, range[0], range[1]);
        const off = r() < 0.3 ? 0.5 : 0;
        out.push(note(b + off, 1.5 + r() * 2, r.pick(tones.length ? tones : pitches), 0.5 + r() * 0.4));
      }
      return out;
    }
    if (style === 'counter') {
      let prev = pitches[Math.floor(pitches.length / 2)];
      const len = part.every || 2;
      for (let b = 0; b < ctx.totalBeats; b += len) {
        const seg = M.chordAt(ctx.progression, b);
        if (seg.chord.root === null) continue;
        const tones = M.chordTonesBetween(seg.chord, range[0], range[1]).filter((p) => p % 12 !== seg.chord.root);
        const cands = tones.length ? tones : pitches;
        cands.sort((a, b2) => Math.abs(a - prev) - Math.abs(b2 - prev));
        prev = cands[r() < 0.75 ? 0 : Math.min(1, cands.length - 1)];
        out.push(note(b, len * 0.98, prev, 0.75));
      }
      return out;
    }

    const phraseBars = Math.min(part.phrase || (style === 'hook' ? 1 : 2), ctx.bars);
    const phrases = Math.max(1, Math.floor(ctx.bars / phraseBars));
    const form = part.form || (phrases >= 4 ? ['A', 'A2', 'B', 'A3'] : phrases === 2 ? ['A', 'A3'] : ['A3']);
    const density = style === 'hook' ? 'hook' : style === 'fanfare' ? 'fanfare' : (part.density || 'medium');
    const rhythms = {};
    const makeRhythm = (label) => {
      const rr = M.rng(M.hashSeed(ctx.seed, 'melody-rhythm', label, part.inst));
      const bars = [];
      for (let b = 0; b < phraseBars; b++) {
        const isEnd = b === phraseBars - 1 && style !== 'hook' && phraseBars > 1;
        if (style === 'hook' && b > 0) { bars.push(bars[0]); continue; }
        bars.push(barRhythm(label === 'B' && density === 'sparse' ? 'medium' : density, ctx, rr, isEnd));
      }
      return bars;
    };
    rhythms.A = makeRhythm('A');
    rhythms.B = makeRhythm('B');
    const tonicPc = ctx.keyPc;
    const openPc = (ctx.keyPc + ctx.scale[part.ending === 'tonic' ? 0 : 4]) % 12; // land on the fifth: leads back into the loop
    let idx = Math.floor(pitches.length * 0.35);
    for (let ph = 0; ph < phrases; ph++) {
      const label = form[ph % form.length];
      const base = label === 'B' ? rhythms.B : rhythms.A;
      const onsets = [];
      base.forEach((bar, b) => bar.forEach((o) => {
        onsets.push({ t: (ph * phraseBars + b) * ctx.beatsPerBar + o.at * stepBeats, d: o.len * stepBeats * (part.legato || 0.92), rest: o.rest });
      }));
      const notes = onsets.filter((o) => !o.rest);
      if (notes.length && (label === 'A3' || label === 'A2')) notes[notes.length - 1].cadence = label === 'A3' ? (ph === phrases - 1 ? openPc : tonicPc) : true;
      // Same random stream for A, A2 and A3: the contour repeats, the chords re-fit it (a sequence).
      const contour = M.rng(M.hashSeed(ctx.seed, 'melody-contour', label === 'B' ? 'B' : 'A', part.inst));
      const seg = M.chordAt(ctx.progression, ph * phraseBars * ctx.beatsPerBar);
      if (label !== 'A' && seg.chord.root !== null) {
        // start on the chord tone nearest the previous phrase's end
        let best = idx, bestD = Infinity;
        pitches.forEach((p, i) => { if (seg.chord.pcs.includes(p % 12) && Math.abs(i - idx) < bestD) { bestD = Math.abs(i - idx); best = i; } });
        idx = best + (label === 'B' ? 2 : 0);
      }
      const res = pitchLine(onsets, ctx, contour, { pitches, startIdx: Math.min(idx, pitches.length - 1) });
      out.push(...res.notes);
      idx = res.endIdx;
    }
    return out;
  }

  // ---------------------------------------------------------------- fx
  function genFx(part, ctx) {
    const style = part.style;
    const bar = ctx.beatsPerBar;
    const L = ctx.totalBeats;
    const rootLow = M.nearestWithPc(ctx.keyPc, 12 * ((part.octave === undefined ? 1 : part.octave) + 1) + 5);
    const every = (part.every || ctx.bars) * bar;
    const out = [];
    if (style === 'riser') {
      const len = (part.bars || 2) * bar;
      for (let end = every; end <= L + 1e-9; end += every) out.push(note(end - len, len, 60, 0.9, { inst: 'riser' }));
    } else if (style === 'swell') {
      const len = (part.bars || 1) * bar;
      for (let end = every; end <= L + 1e-9; end += every) out.push(note(end - len, len, rootLow + 24, 0.8, { inst: 'swell' }));
    } else if (style === 'crash' || style === 'impact') {
      for (let t = 0; t < L - 1e-9; t += every) out.push(note(t, 2, style === 'impact' ? rootLow : 60, 0.95, { inst: style }));
    } else if (style === 'braam') {
      for (let t = 0; t < L - 1e-9; t += every) {
        const seg = M.chordAt(ctx.progression, t);
        const root = seg.chord.root === null ? rootLow : M.rootNear(seg.chord, rootLow + 12);
        out.push(note(t, (part.bars || 2) * bar * 0.9, root, 0.95, { inst: 'braam' }));
        out.push(note(t, (part.bars || 2) * bar * 0.9, root + 7, 0.7, { inst: 'braam' }));
      }
    } else if (style === 'shepard') {
      out.push(note(0, L, M.nearestWithPc(ctx.keyPc, 60), 0.8, { inst: 'shepard', hold: true, down: !!part.down }));
    } else if (style === 'wind') {
      out.push(note(0, L, 60, 0.8, { inst: 'wind', hold: true }));
    } else if (style === 'scrape') {
      const r = M.rng(M.hashSeed(ctx.seed, 'scrape'));
      const n = part.count || Math.max(1, Math.round(ctx.bars / 3));
      for (let i = 0; i < n; i++) out.push(note(r() * (L - 2), 1.5 + r() * 2, r.int(70, 90), 0.5 + r() * 0.4, { inst: 'scrape' }));
    } else throw new Error(`unknown fx style '${style}'`);
    return out;
  }

  const GENERATORS = {
    drums: genDrums, bass: genBass, pad: genPad, stabs: genStabs, arp: genArp, ostinato: genOstinato,
    broken: genBroken, strum: genStrum, pulse: genPulse, drone: genDrone, cluster: genCluster,
    melody: genMelody, counter: (p, c, r) => genMelody(Object.assign({}, p, { style: 'counter' }), c, r),
    bells: (p, c, r) => genMelody(Object.assign({}, p, { style: 'bells' }), c, r), fx: genFx,
  };

  function roleTarget(part) {
    if (part.role === 'drums') {
      const voices = part.voices || Object.keys(M.DRUMS[part.pattern] || {}).filter((k) => k !== 'steps');
      return voices.every((v) => LIGHT_DRUMS.includes(v)) ? ROLE_TARGET.perc : ROLE_TARGET.drums;
    }
    return ROLE_TARGET[part.role] === undefined ? -24 : ROLE_TARGET[part.role];
  }

  function defaultInst(part) {
    if (part.role === 'fx') return part.style;
    return part.inst || { drums: 'kit', bass: 'synthbass', pad: 'pad', stabs: 'brass', arp: 'pluck', ostinato: 'spiccato', broken: 'piano', strum: 'guitar', pulse: 'musicbox', drone: 'drone', cluster: 'tremolo', melody: 'lead', counter: 'strings', bells: 'bell', fx: 'fx' }[part.role];
  }

  // preset + {seed, key, mode, bpm, bars, progression} -> cue
  function compose(preset, opts) {
    const ctx = ctxFor(preset, opts);
    const stems = preset.stems.map((stem) => {
      const parts = stem.parts.map((part, pi) => {
        const gen = GENERATORS[part.role];
        if (!gen) throw new Error(`unknown part role '${part.role}' in stem '${stem.name}'`);
        const r = M.rng(M.hashSeed(ctx.seed, stem.name, pi, part.role));
        const notes = gen(part, ctx, r);
        if (part.detune) notes.forEach((n) => { n.detune = part.detune; });
        return { role: part.role, inst: defaultInst(part), notes, target: roleTarget(part) + (part.level || 0), pan: part.pan || 0, def: part };
      });
      return { name: stem.name, min: stem.min || 0, full: stem.full === undefined ? stem.min || 0 : stem.full, parts, fx: stem };
    });
    return {
      name: (opts && opts.name) || preset.id || 'cue',
      title: preset.title,
      seed: ctx.seed, key: ctx.key, mode: ctx.mode, bpm: ctx.bpm, beatsPerBar: ctx.beatsPerBar, bars: ctx.bars, steps: ctx.steps,
      swing: preset.swing || 0, swingGrid: preset.swingGrid || 8,
      room: preset.room, oneShotReverb: preset.oneShotReverb,
      chords: ctx.progression.map((s) => ({ symbol: s.chord.symbol, start: s.start, length: s.length, pcs: s.chord.pcs })),
      stems,
      oneShots: composeOneShots(preset, ctx),
      ctx,
    };
  }

  // ---------------------------------------------------------------- stingers, intro, ending
  // Each one-shot: { name, kind, beats (musical length), parts: [{inst, notes, target, pan}] }
  function composeOneShots(preset, ctx) {
    const out = [];
    const bar = ctx.beatsPerBar;
    const tonic = (oct) => M.nearestWithPc(ctx.keyPc, 12 * (oct + 1) + 5);
    const minor = ctx.scale[2] === 3;
    const triad = (rootMidi, isMinor) => [rootMidi, rootMidi + (isMinor ? 3 : 4), rootMidi + 7];
    const palette = Object.assign({ brass: 'brass', strings: 'strings', keys: 'piano', bell: 'bell', lead: 'lead', low: 'braam' }, preset.oneShotInst || {});
    const p = (inst, notes, target, pan) => ({ inst, notes, target, pan: pan || 0 });
    const n = (t, d, pitch, v, extra) => note(t, d, pitch, v, extra);
    const kinds = {
      hit: () => ({ beats: 2, parts: [
        p('impact', [n(0, 2, tonic(1), 1)], -18),
        p(palette.brass, triad(tonic(3), minor).map((m) => n(0, 0.6, m, 1)), -19),
        p('crash', [n(0, 2, 60, 0.9)], -24),
      ] }),
      alert: () => ({ beats: 4, parts: [
        p('riser', [n(0, 1, 60, 0.9)], -24),
        p('braam', [n(1, 2.5, tonic(1) + 12, 1), n(1, 2.5, tonic(1) + 19, 0.7)], -18),
        p('taiko', [n(1, 1, 'taiko', 1), n(1.5, 1, 'taiko', 0.7)], -20),
      ] }),
      victory: () => {
        const r0 = tonic(4); // parallel major, always
        const arp = [r0, r0 + 4, r0 + 7, r0 + 12];
        return { beats: 6, parts: [
          p(palette.brass, arp.map((m, i) => n(i * 0.33, i === 3 ? 3 : 0.3, m, 0.9)), -18),
          p(palette.strings, triad(r0 - 12, false).concat([r0]).map((m) => n(1, 4, m, 0.8)), -22),
          p('crash', [n(1, 3, 60, 0.9)], -24),
          p('taiko', [n(1, 1, 'taiko', 1)], -21),
        ] };
      },
      fail: () => {
        const r0 = tonic(4);
        const line = [r0 + 7, r0 + 3, r0 + 2, r0];
        return { beats: 6, parts: [
          p(palette.keys, line.map((m, i) => n(i * 0.75, i === 3 ? 3 : 0.7, m, 0.75)), -20),
          p('strings', triad(r0 - 12, true).map((m) => n(2.25, 3.5, m, 0.6)), -25),
          p('drone', [n(0, 5, tonic(2), 0.7)], -27),
        ] };
      },
      jumpscare: () => ({ beats: 3, parts: [
        p('tremolo', [0, 1, 6, 11, 13].map((i) => n(0, 1.5, tonic(5) + i, 1, { sfz: true })), -16),
        p('impact', [n(0, 2.5, tonic(1), 1)], -16),
        p('scrape', [n(0.05, 2, 80, 1)], -22),
      ] }),
      discover: () => {
        const r0 = tonic(5);
        const up = [r0, r0 + 7, r0 + 12, r0 + (minor ? 15 : 16), r0 + 19];
        return { beats: 4, parts: [
          p(palette.bell, up.map((m, i) => n(i * 0.25, 2.5, m, 0.75)), -21),
          p('pad', triad(r0 - 12, minor).map((m) => n(0, 3, m, 0.6)), -27),
        ] };
      },
      levelup: () => {
        const r0 = tonic(5);
        const up = [r0, r0 + 4, r0 + 7, r0 + 12, r0 + 16, r0 + 19, r0 + 24];
        return { beats: 2, parts: [p('sqlead', up.map((m, i) => n(i * 0.125, i === 6 ? 0.8 : 0.12, m, 0.8)), -20)] };
      },
      tension: () => ({ beats: 8, parts: [
        p('shepard', [n(0, 8, tonic(4), 0.8)], -24),
        p('tremolo', [0, 1].map((i) => n(0, 8, tonic(4) + i, 0.6)), -27),
      ] }),
      // Intro: one bar that ends exactly on the loop's downbeat.
      intro: () => {
        const parts = [p('riser', [n(0, bar, 60, 0.9)], -23)];
        const rollSteps = ctx.steps / bar; // one beat of 16ths
        const notes = [];
        for (let i = 0; i < rollSteps; i++) notes.push(n(bar - 1 + i / rollSteps, 1 / rollSteps, 'snare', 0.5 + 0.5 * (i / rollSteps)));
        parts.push(p('kit', notes, -21));
        return { beats: bar, parts };
      },
      // Ending: a final tonic chord with a hit, played on a bar line when the cue stops.
      ending: () => {
        const r0 = tonic(3);
        return { beats: 2 * bar, parts: [
          p(palette.brass, triad(r0, minor).map((m) => n(0, bar, m, 0.9)), -20),
          p(palette.strings, triad(r0 - 12, minor).concat([r0 + 12]).map((m) => n(0, 2 * bar, m, 0.75)), -23),
          p('impact', [n(0, 2, tonic(1), 0.9)], -21),
          p('crash', [n(0, 2, 60, 0.8)], -25),
        ] };
      },
    };
    const wanted = (preset.stingers || ['hit']).concat(preset.intro === false ? [] : ['intro']).concat(preset.ending === false ? [] : ['ending']);
    for (const name of wanted) {
      if (!kinds[name]) throw new Error(`unknown stinger '${name}'`);
      const shot = kinds[name]();
      out.push(Object.assign({ name, kind: name === 'intro' || name === 'ending' ? name : 'stinger' }, shot));
    }
    return out;
  }

  Object.assign(M, { compose, ROLE_TARGET, GENERATORS, STINGER_KINDS: ['hit', 'alert', 'victory', 'fail', 'jumpscare', 'discover', 'levelup', 'tension'] });
})(typeof MusicEngine !== 'undefined' ? MusicEngine : (globalThis.MusicEngine = globalThis.MusicEngine || {}));
