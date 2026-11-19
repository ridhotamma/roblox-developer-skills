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
    // A one-bar riff in chord degrees (R root, 8 octave, 5 fifth, 3 third, 7 seventh), the same
    // every bar so the groove is recognisable, re-fitted to each chord.
    const rr = M.rng(M.hashSeed(ctx.seed, 'bass-riff', style, part.inst));
    const riff = hits.map((h, i) => {
      if (i === 0 || ['808', 'heartbeat', 'halftime', 'gallop'].includes(style)) return 'R';
      if (style === 'octaves') return i % 2 === 1 ? (i % 4 === 3 && rr() < 0.35 ? '5' : '8') : 'R';
      if (style === 'ostinato16' || style === 'chug') return i % 8 === 7 && rr() < 0.6 ? rr.pick(['5', '8', '7']) : 'R';
      if (style === 'offbeat') return i === hits.length - 1 && rr() < 0.5 ? '8' : 'R';
      const odds = style === 'quarters' ? 0.6 : 0.35;
      return rr() < odds ? rr.pick(['5', '8', '5', '7', '3']) : 'R';
    });
    const degreeOf = (chord, token, root) => {
      if (token === '8') return root + 12;
      if (token === '5') return root + (chord.intervals[2] || 7);
      if (token === '3') return root + (chord.intervals[1] || 4);
      if (token === '7') {
        for (const i of [10, 11]) if (ctx.scale.includes((chord.root + i - ctx.keyPc + 24) % 12)) return root + i - 12; // the 7th below
        return root + (chord.intervals[2] || 7);
      }
      return root;
    };
    const times = [];
    for (let bar = 0; bar < ctx.bars; bar++) hits.forEach((h, i) => times.push({ t: bar * ctx.beatsPerBar + h.at, h, i }));
    times.forEach((x, j) => {
      const { t, h, i } = x;
      const seg = M.chordAt(ctx.progression, t);
      if (seg.chord.root === null) return;
      const root = M.rootNear(seg.chord, center);
      let p = degreeOf(seg.chord, riff[i], root);
      // Approach: the last hit before a chord change steps into the next root by a scale step.
      const nextT = times[(j + 1) % times.length].t;
      const next = M.chordAt(ctx.progression, nextT);
      if (style !== 'heartbeat' && style !== '808' && next !== seg && next.chord.root !== null && next.chord.root !== seg.chord.root && t > seg.start + 1e-9) {
        const target = M.rootNear(next.chord, root);
        const cands = [target - 2, target - 1, target + 1, target + 2].filter((m) => ctx.scale.includes((m - ctx.keyPc + 120) % 12));
        if (cands.length) p = cands.sort((a, b) => Math.abs(a - root) - Math.abs(b - root))[0];
      }
      const len = style === '808' ? Math.min(h.len, seg.start + seg.length - t) : Math.min(h.len, 0.5) * gate;
      out.push(note(t, Math.max(0.1, len), p, h.vel * (0.92 + r() * 0.1), style === '808' && r() < 0.25 ? { glide: 12 } : null));
    });
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

  // Arpeggios. Each chord enters on the inversion nearest the last one (voice leading, not
  // "root position, up, repeat"), the figure can climb in thirds, pedal, cascade or cut across
  // the beat (see ARPS in patterns.js), `colors` adds the diatonic 9th (1) and 7th (2), and the
  // last bar of every four mirrors the figure as a turnaround.
  function genArp(part, ctx, r) {
    const octave = part.octave === undefined ? 4 : part.octave;
    const lo = 12 * (octave + 1);
    const span = part.span || 2;
    const rate = (part.rate || 1) * ctx.stepBeats; // in beats
    let pattern = part.pattern || 'auto';
    const pr = M.rng(M.hashSeed(ctx.seed, 'arp-pattern', part.inst));
    if (pattern === 'auto') pattern = pr.pick(['broken', 'alberti', 'groups3', 'pedal', 'wave', 'motif']);
    let figure = M.ARPS[pattern];
    if (pattern === 'motif') { // a seeded riff along the chord tones, mostly stepwise
      figure = [0];
      while (figure.length < 8) figure.push(Math.max(0, Math.min(5, figure[figure.length - 1] + pr.pick([-2, -1, 1, 1, 2, 3]))));
    }
    const colors = part.colors === undefined ? 1 : part.colors;
    const out = [];
    let seg = null, ladder = [], base = 0, anchor = lo + 4;
    for (let t = 0; t < ctx.totalBeats - 1e-9; t += rate) {
      const s = M.chordAt(ctx.progression, t);
      if (s.chord.root === null) continue;
      if (s !== seg) {
        seg = s;
        const pcs = s.chord.pcs.concat(M.chordExtensions(s.chord, ctx.keyPc, ctx.scale, colors));
        ladder = [];
        for (let m = lo - 12; m <= lo + 12 * (span + 1); m++) if (pcs.includes(m % 12)) ladder.push(m);
        let bestD = Infinity;
        ladder.forEach((m, i) => { if (m >= lo - 2 && m <= lo + 9 && Math.abs(m - anchor) < bestD) { bestD = Math.abs(m - anchor); base = i; } });
        anchor = ladder[base];
      }
      const n = Math.max(2, ladder.filter((m) => m >= ladder[base] && m < ladder[base] + 12 * span).length);
      const local = Math.round((t - seg.start) / rate);
      const inBar = Math.round((t % ctx.beatsPerBar) / rate);
      let off;
      if (figure) {
        off = figure[inBar % figure.length];
        if (ctx.bars >= 4 && Math.floor(t / ctx.beatsPerBar) % 4 === 3) off = Math.max(...figure) - off;
      } else if (pattern === 'up') off = local % n;
      else if (pattern === 'down') off = n - 1 - (local % n);
      else if (pattern === 'updown') { const cyc = Math.max(1, 2 * n - 2); const k = local % cyc; off = k < n ? k : cyc - k; }
      else if (pattern === 'pinky') off = local % 2 === 0 ? n - 1 : (local >> 1) % (n - 1);
      else off = Math.floor(r() * n);
      const idx = Math.max(0, Math.min(ladder.length - 1, base + off));
      const accent = Math.abs((t / ctx.beatsPerBar) % 1) < 1e-6 ? 1 : (Math.abs(t % 1) < 1e-6 ? 0.85 : 0.68);
      out.push(note(t, rate * (part.gate || 0.9), ladder[idx], accent * (0.92 + r() * 0.08)));
    }
    return out;
  }

  // Zimmer-style string ostinato: one rhythmic shape, pitches re-fitted to every chord. Without a
  // `shape`, the seed picks one; every fourth bar shifts it up a chord tone (the figure "turns").
  const OSTINATO_SHAPES = [[0, 0, 2, 0, 1, 0, 2, 0], [0, 1, 2, 1, 0, 1, 2, 3], [0, 2, 1, 2, 0, 2, 1, 3], [2, 0, 1, 0, 2, 0, 1, 3], [0, 0, 1, 0, 2, 0, 3, 2]];
  function genOstinato(part, ctx, r) {
    const octave = part.octave === undefined ? 3 : part.octave;
    const lo = 12 * (octave + 1) + 2;
    const shape = part.shape || M.rng(M.hashSeed(ctx.seed, 'ostinato-shape', part.inst)).pick(OSTINATO_SHAPES);
    const rate = (part.rate || 1) * ctx.stepBeats;
    const accents = part.accents || 'X-x-x-X-x-x-X-x-';
    const out = [];
    let k = 0;
    for (let t = 0; t < ctx.totalBeats - 1e-9; t += rate, k++) {
      const seg = M.chordAt(ctx.progression, t);
      if (seg.chord.root === null) continue;
      const tones = M.chordTonesBetween(seg.chord, lo, lo + 19);
      const turn = ctx.bars >= 4 && Math.floor(t / ctx.beatsPerBar) % 4 === 3 ? 1 : 0;
      const p = tones[Math.min(shape[k % shape.length] + turn, tones.length - 1)];
      const vel = M.velocityOf(accents[k % accents.length]) || 0.55;
      out.push(note(t, rate * 0.7, p, vel * (0.93 + r() * 0.07)));
    }
    return out;
  }

  // Piano left hand. `pattern`: classic (root 5th 10th 5th), rising (root 5th octave 10th),
  // nine (root 5th 9th 10th: open, wistful), waltz (root 5th 10th 5th 10th 5th: 3/4 in 8ths).
  const BROKEN = { classic: ['R', '5', '10', '5'], rising: ['R', '5', '8', '10'], nine: ['R', '5', '9', '10'], waltz: ['R', '5', '10', '5', '10', '5'] };
  function genBroken(part, ctx, r) {
    const octave = part.octave === undefined ? 3 : part.octave;
    const center = 12 * (octave + 1) + 2;
    const out = [];
    const rate = part.rate ? part.rate * ctx.stepBeats : 0.5;
    const cycle = BROKEN[part.pattern] || (ctx.beatsPerBar === 3 ? BROKEN.waltz : BROKEN.classic);
    let k = 0;
    for (let t = 0; t < ctx.totalBeats - 1e-9; t += rate, k++) {
      const seg = M.chordAt(ctx.progression, t);
      if (seg.chord.root === null) continue;
      if (Math.abs(t - seg.start) < 1e-9) k = 0; // each chord starts the figure from its root
      const root = M.rootNear(seg.chord, center - 5);
      const third = seg.chord.intervals[1] || 4;
      const fifth = seg.chord.intervals[2] || 7;
      const nine = M.chordColors(seg.chord, ctx.keyPc, ctx.scale).tensions.includes((seg.chord.root + 2) % 12) ? 14 : 12;
      const off = { R: 0, '5': fifth, '8': 12, '9': nine, '10': 12 + third }[cycle[k % cycle.length]];
      out.push(note(t, rate * 1.8, root + off, (k % cycle.length === 0 ? 0.85 : 0.6) * (0.92 + r() * 0.08)));
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
    melody: (p, c, r) => (p.style === 'bells' ? M.genBells(p, c, r) : p.style === 'counter' ? M.genCounter(p, c, r) : M.genMelody(p, c, r)),
    counter: (p, c, r) => M.genCounter(p, c, r), bells: (p, c, r) => M.genBells(p, c, r), fx: genFx,
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
    // The lead melody is written first: counterlines answer it and stingers quote its motif.
    let leadKey = null;
    preset.stems.forEach((stem, si) => stem.parts.forEach((part, pi) => {
      if (leadKey === null && part.role === 'melody' && !['bells', 'counter'].includes(part.style)) {
        leadKey = si + ':' + pi;
        ctx.lead = M.genMelody(part, ctx, M.rng(M.hashSeed(ctx.seed, stem.name, pi, part.role)));
        ctx.motif = ctx.lead.motif;
      }
    }));
    if (!ctx.motif) ctx.motif = M.fallbackMotif(ctx);
    const stems = preset.stems.map((stem, si) => {
      const parts = stem.parts.map((part, pi) => {
        const gen = GENERATORS[part.role];
        if (!gen) throw new Error(`unknown part role '${part.role}' in stem '${stem.name}'`);
        const r = M.rng(M.hashSeed(ctx.seed, stem.name, pi, part.role));
        const notes = leadKey === si + ':' + pi ? ctx.lead.map((x) => Object.assign({}, x)) : gen(part, ctx, r);
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
    const motif = ctx.motif;
    const ladder = (scaleName, center) => M.scalePitches(ctx.keyPc, M.scaleOf(scaleName), center - 24, center + 36);
    const nearestIdx = (arr, pitch) => arr.reduce((b, m, i) => (Math.abs(m - pitch) < Math.abs(arr[b] - pitch) ? i : b), 0);
    const up = (scaleName, pitch, steps) => { const a = ladder(scaleName, pitch); return a[Math.max(0, Math.min(a.length - 1, nearestIdx(a, pitch) + steps))]; };
    const below = (scaleName, pitch, steps) => up(scaleName, pitch, -steps);
    // The first `count` notes of the motif in another scale, from `start`, fitted into `beats`
    // (stretched too when `stretch`); `invert` turns the contour upside down.
    const quote = (scaleName, start, count, beats, invert, stretch) => {
      const on = motif.rhythm.filter((x) => !x.rest).slice(0, count);
      if (!on.length) return [];
      const a = ladder(scaleName, start), i0 = nearestIdx(a, start);
      const t0 = on[0].at, last = on[on.length - 1];
      const span = (last.at + last.len - t0) * ctx.stepBeats;
      const k = stretch ? beats / span : Math.min(1, beats / span);
      return on.map((x, j) => ({
        t: (x.at - t0) * ctx.stepBeats * k,
        d: Math.max(0.08, x.len * ctx.stepBeats * k * 0.95),
        p: a[Math.max(0, Math.min(a.length - 1, i0 + (invert ? -1 : 1) * (motif.offsets[j] || 0)))],
      }));
    };
    const arrival = (line) => (line.length ? Math.round((line[line.length - 1].t + line[line.length - 1].d / 0.95) * 8) / 8 : 0);
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
      // Victory, fail, discover and level-up quote the cue's own motif (a leitmotif), so each
      // cue's stingers belong to it instead of being the same arpeggio everywhere.
      victory: () => {
        const r0 = tonic(4); // parallel major, always
        const line = quote('ionian', r0 + 7, 4, 1.5);
        const at = arrival(line);
        const goal = [r0 + 16, r0 + 12, r0 + 19].sort((a, b) => Math.abs(a - line[line.length - 1].p - 2) - Math.abs(b - line[line.length - 1].p - 2))[0];
        const lineNotes = line.map((x) => n(x.t, x.d, x.p, 0.9)).concat([n(at, 3, goal, 1)]);
        const thirds = line.map((x) => n(x.t, x.d, below('ionian', x.p, 2), 0.7)).concat([n(at, 3, below('ionian', goal, 2), 0.8)]);
        return { beats: at + 4, parts: [
          p(palette.brass, lineNotes.concat(thirds), -18),
          p(palette.strings, triad(r0 - 12, false).concat([r0]).map((m) => n(at, 4, m, 0.8)), -22),
          p('crash', [n(at, 3, 60, 0.9)], -24),
          p('taiko', [n(at, 1, 'taiko', 1)], -21),
        ] };
      },
      fail: () => {
        const r0 = tonic(4);
        const line = quote('aeolian', r0 + 7, 4, 2.25, true, true);
        const at = arrival(line);
        return { beats: at + 4, parts: [
          p(palette.keys, line.map((x) => n(x.t, x.d, x.p, 0.75)).concat([n(at, 3, r0, 0.7)]), -20),
          p('strings', triad(r0 - 12, true).map((m) => n(at, 3.5, m, 0.6)), -25),
          p('drone', [n(0, at + 3, tonic(2), 0.7)], -27),
        ] };
      },
      jumpscare: () => ({ beats: 3, parts: [
        p('tremolo', [0, 1, 6, 11, 13].map((i) => n(0, 1.5, tonic(5) + i, 1, { sfz: true })), -16),
        p('impact', [n(0, 2.5, tonic(1), 1)], -16),
        p('scrape', [n(0.05, 2, 80, 1)], -22),
      ] }),
      discover: () => {
        const r0 = tonic(5);
        const line = quote(ctx.mode, r0, 4, 1);
        const at = arrival(line);
        const ninth = r0 + 12 + ctx.scale[1];
        return { beats: at + 3, parts: [
          p(palette.bell, line.map((x) => n(x.t, 2.5, x.p, 0.75)).concat([n(at, 2.5, ninth, 0.8)]), -21),
          p('pad', triad(r0 - 12, minor).concat([r0 - 12 + 14]).map((m) => n(0, at + 2.5, m, 0.6)), -27),
        ] };
      },
      levelup: () => {
        const r0 = tonic(5);
        const cell = quote('ionian', r0, 3, 0.375);
        const step = cell.length ? arrival(cell) : 0.375;
        const notes = [];
        for (let k = 0; k < 3; k++) for (const x of cell) notes.push(n(x.t + k * step, Math.min(x.d, 0.12), up('ionian', x.p, 2 * k), 0.8));
        const last = notes.length ? notes[notes.length - 1].p : r0 + 12;
        notes.push(n(3 * step, 0.8, up('ionian', last, 2), 0.9));
        return { beats: 3 * step + 1, parts: [p('sqlead', notes, -20)] };
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
