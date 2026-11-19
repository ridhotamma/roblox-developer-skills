// Melody writing: a motif, developed through a phrase form, realized note by note against the
// chords with the rules composers use (references/music-theory.md, section 5):
//
//   * Motif first: a rhythm plus a contour in scale steps (leap-and-fill, arch, zigzag, ...).
//   * Development, not repetition: the motif returns transposed (sequence), with a new ending
//     (answer), inverted, or broken into fragments that climb to the phrase's one climax.
//   * Forms: sentence (idea, idea again, fragments, cadence), period (question, answer),
//     AABA, and call-and-response hooks.
//   * Harmony: strong beats prefer guide tones (3rds, 7ths) and colour tones (9ths) over the root;
//     dissonances on strong beats are appoggiaturas that resolve by step; weak beats pass or
//     neighbour by step.
//   * Shape: after a leap, step back the other way (gap-fill); no runs of leaps; the highest note
//     arrives once, late in the loop; the tonic and fifth of the key are saved for cadences.
//   * Colour: each mode's characteristic note (lydian #4, dorian 6, phrygian b2...) is sought out.
//
// A melody is a list of notes like any other part; its motif rides along (notes.motif) so
// counterlines can answer it and stingers can quote it.
(function (M) {
  'use strict';

  // Semitones above the key that give each scale its colour.
  const CHARACTER = {
    ionian: [11], major: [11], lydian: [6], mixolydian: [10], dorian: [9], aeolian: [8], minor: [8],
    phrygian: [1], locrian: [6, 1], harmonic_minor: [11, 8], melodic_minor: [9, 11],
    phrygian_dominant: [1, 4], hungarian_minor: [6, 11], pentatonic_major: [9, 2],
    pentatonic_minor: [10, 3], blues: [6, 10], whole_tone: [6, 8], chromatic: [],
  };

  // ---------------------------------------------------------------- harmony colours
  // For a chord in a mode: chord tones, guide tones (3rd, 7th), available tensions (scale notes
  // that don't clash) and avoid notes (a semitone above a chord tone, or a minor 3rd over a major
  // chord): fine in passing, not held on a strong beat.
  function chordColors(chord, keyPc, scale) {
    if (chord.root === null) return { tones: [], guide: [], tensions: [], avoid: [], root: null };
    const tones = chord.pcs.slice();
    const third = chord.intervals.find((i) => i === 3 || i === 4);
    const seventh = chord.intervals.find((i) => i === 10 || i === 11);
    const guide = [third, seventh].filter((i) => i !== undefined).map((i) => (chord.root + i) % 12);
    const tensions = [], avoid = [];
    for (const s of scale) {
      const pc = (keyPc + s) % 12;
      if (tones.includes(pc)) continue;
      const minor9 = tones.some((t) => (pc - t + 12) % 12 === 1);
      const sharp9 = third === 4 && (pc - chord.root + 12) % 12 === 3;
      (minor9 || sharp9 ? avoid : tensions).push(pc);
    }
    return { tones, guide, tensions, avoid, root: chord.root };
  }

  // Extra arpeggio/voicing colours: the diatonic 9th (and 7th) when they don't clash.
  function chordExtensions(chord, keyPc, scale, level) {
    if (chord.root === null || !level) return [];
    const col = chordColors(chord, keyPc, scale);
    const out = [];
    const ninth = (chord.root + 2) % 12;
    if (col.tensions.includes(ninth) && chord.intervals.length >= 3) out.push(ninth);
    if (level >= 2) {
      for (const i of [10, 11]) { const pc = (chord.root + i) % 12; if (col.tensions.includes(pc)) out.push(pc); }
    }
    return out;
  }

  // ---------------------------------------------------------------- rhythm
  const SOFTER = { dense: 'medium', medium: 'sparse', sparse: 'sparse', hook: 'medium', fanfare: 'medium' };

  // Onsets of one bar in steps: [{at, len, rest}]
  function barOnsets(density, ctx, r) {
    const out = [];
    if (density === 'hook' || density === 'fanfare') {
      const cell = r.pick(density === 'hook' ? M.CELLS.hook : M.CELLS.bar);
      let s = 0;
      for (const c of cell) {
        const len = Math.max(1, Math.round(Math.abs(c) * ctx.steps / 16));
        if (s >= ctx.steps) break;
        out.push({ at: s, len: Math.min(len, ctx.steps - s), rest: c < 0 });
        s += len;
      }
      return out;
    }
    const stepsPerBeat = ctx.steps / ctx.beatsPerBar;
    const bank = M.CELLS[density] || M.CELLS.medium;
    let s = 0;
    while (s < ctx.steps) {
      let cell = r.pick(bank);
      const scale = stepsPerBeat / 4; // cells are written for 4 steps per beat
      const cellLen = cell.reduce((a, c) => a + Math.abs(c), 0);
      if (cellLen > 4 && s + cellLen * scale > ctx.steps) cell = [4];
      for (const c of cell) {
        const len = Math.max(1, Math.round(Math.abs(c) * scale));
        if (s >= ctx.steps) break;
        out.push({ at: s, len: Math.min(len, ctx.steps - s), rest: c < 0 });
        s += len;
      }
    }
    return out;
  }

  // A unit (1-2 bars) of rhythm. `longEnd` holds the last two beats (a phrase that breathes);
  // `syncopation` moves a strong-beat note an 8th early (an anticipation).
  function unitRhythm(unitBars, density, ctx, r, opts) {
    const o = opts || {};
    const stepsPerBeat = ctx.steps / ctx.beatsPerBar;
    let out = [];
    for (let b = 0; b < unitBars; b++) {
      const d = b === unitBars - 1 && unitBars > 1 ? SOFTER[density] || density : density;
      for (const x of barOnsets(d, ctx, r)) out.push({ at: b * ctx.steps + x.at, len: x.len, rest: x.rest });
    }
    const total = unitBars * ctx.steps;
    if (o.longEnd) {
      const hold = Math.min(stepsPerBeat * 2, total / 2);
      const from = total - hold;
      out = out.filter((x) => x.at < from).map((x) => Object.assign({}, x, { len: Math.min(x.len, from - x.at) }));
      out.push({ at: from, len: hold, rest: false });
    }
    if (o.syncopation && stepsPerBeat === 4 && r() < o.syncopation) {
      const cands = [];
      for (let i = 1; i < out.length; i++) {
        const prev = out[i - 1], cur = out[i];
        if (!cur.rest && !prev.rest && cur.at % (stepsPerBeat * 2) === 0 && prev.len >= 4 && prev.at + prev.len === cur.at) cands.push(i);
      }
      if (cands.length) {
        const i = r.pick(cands);
        out[i - 1].len -= 2;
        out[i].at -= 2;
        out[i].len += 2;
      }
    }
    // the first note of a unit should exist (a rest-only unit would orphan its contour)
    if (!out.some((x) => !x.rest)) out = [{ at: 0, len: total, rest: false }];
    return out;
  }

  // ---------------------------------------------------------------- contour
  // Cumulative offsets in scale steps for n notes, first = 0.
  const CONTOURS = {
    leap: (n, r) => { const s = [r.pick([3, 4, 4, 5])]; while (s.length < n - 1) s.push(r() < 0.2 ? 1 : -1); return s; },
    arch: (n, r) => { const up = Math.ceil((n - 1) / 2); const s = []; for (let i = 0; i < n - 1; i++) s.push(i < up ? (r() < 0.3 ? 2 : 1) : (r() < 0.25 ? -2 : -1)); return s; },
    valley: (n, r) => { const dn = Math.ceil((n - 1) / 2); const s = []; for (let i = 0; i < n - 1; i++) s.push(i < dn ? -1 : (r() < 0.35 ? 2 : 1)); return s; },
    rise: (n, r) => { const s = []; for (let i = 0; i < n - 1; i++) s.push(i % 3 === 2 ? -1 : (r() < 0.25 ? 2 : 1)); return s; },
    fall: (n, r) => { const s = [r.pick([1, 2, 3])]; while (s.length < n - 1) s.push(s.length % 3 === 2 && r() < 0.5 ? 1 : -1); return s; },
    zigzag: (n, r) => { const s = []; const up = r() < 0.6 ? 1 : -1; for (let i = 0; i < n - 1; i++) s.push(i % 2 === 0 ? 2 * up : -up); return s; },
    neighbor: (n, r) => { const cyc = r.pick([[1, -1, -1, 1], [-1, 1, 1, -1], [1, -1, 0, 2]]); const s = []; for (let i = 0; i < n - 1; i++) s.push(cyc[i % cyc.length]); return s; },
    turn: (n, r) => { const s = [1, -1, -1]; while (s.length < n - 1) s.push(r() < 0.5 ? 3 : 2, -1); return s.slice(0, Math.max(0, n - 1)); },
  };
  // Which contours suit which mode (brighter modes rise, darker ones circle and fall).
  const CONTOUR_BY_MODE = {
    lydian: ['arch', 'rise', 'leap', 'zigzag'], ionian: ['arch', 'leap', 'rise', 'turn'], major: ['arch', 'leap', 'rise', 'turn'],
    mixolydian: ['leap', 'arch', 'zigzag', 'turn'], dorian: ['zigzag', 'turn', 'arch', 'neighbor'],
    aeolian: ['leap', 'fall', 'arch', 'turn'], minor: ['leap', 'fall', 'arch', 'turn'],
    phrygian: ['neighbor', 'fall', 'turn'], phrygian_dominant: ['turn', 'neighbor', 'leap'],
    harmonic_minor: ['fall', 'turn', 'neighbor', 'valley'], hungarian_minor: ['turn', 'neighbor', 'fall'],
    locrian: ['neighbor', 'fall'], melodic_minor: ['arch', 'rise', 'turn'],
  };

  function contourOffsets(n, shape, r) {
    if (n <= 0) return [];
    const steps = (CONTOURS[shape] || CONTOURS.arch)(n, r);
    // an occasional repeated note gives the rhythm a voice (not too often)
    for (let i = 1; i < steps.length; i++) if (Math.abs(steps[i]) === 1 && r() < 0.12) steps[i] = 0;
    const out = [0];
    for (const s of steps.slice(0, n - 1)) out.push(out[out.length - 1] + s);
    // keep the idea within about an octave
    const lo = Math.min(...out), hi = Math.max(...out);
    if (hi - lo > 7) for (let i = 0; i < out.length; i++) out[i] = Math.max(lo, Math.min(lo + 7, out[i]));
    return out;
  }

  // ---------------------------------------------------------------- forms
  const FORMS = {
    sentence: ['BI', 'SEQ', 'CONT', 'CAD'],
    period: ['BI', 'CI', 'SEQ', 'CAD'],
    aaba: ['BI', 'VARY', 'CI', 'CAD'],
    call: ['BI', 'INV', 'SEQ', 'CAD'],
    hook: ['BI', 'VARY', 'BI', 'CI', 'BI', 'VARY', 'CONT', 'CAD'],
  };
  const OLD_LABELS = { A: 'BI', A2: 'SEQ', B: 'CI', A3: 'CAD' }; // forms written for the first version

  function motifPlan(part, ctx, r) {
    const style = part.style || 'motif';
    const unitBars = Math.max(1, Math.min(part.phrase || (style === 'hook' || style === 'fanfare' || ctx.bars < 8 ? 1 : 2), ctx.bars));
    const units = Math.max(1, Math.floor(ctx.bars / unitBars));
    let form;
    if (Array.isArray(part.form)) form = part.form.map((l) => OLD_LABELS[l] || l);
    else if (FORMS[part.form]) form = FORMS[part.form];
    else if (style === 'hook') form = FORMS.hook;
    else if (style === 'fanfare') form = FORMS.sentence;
    else form = FORMS[r.pick(['sentence', 'sentence', 'period', 'aaba', 'call'])];
    const labels = [];
    for (let u = 0; u < units; u++) labels.push(form[u % form.length]);
    if (units === 1) labels[0] = 'BI';
    else labels[units - 1] = 'CAD';
    const shape = part.contour || r.pick(CONTOUR_BY_MODE[ctx.preset.melodyScale] || CONTOUR_BY_MODE[ctx.mode] || ['arch', 'leap', 'turn']);
    return { style, unitBars, units, labels, shape };
  }

  // ---------------------------------------------------------------- the chooser
  // events: [{t, d, target (index into pitches), strong (0 weak, 1 beat, 2 downbeat), cadence
  // (pitch classes, best first) | null, climax, ceiling}]
  function realize(events, pitches, ctx, r, st) {
    const out = [];
    const charPcs = (CHARACTER[ctx.preset.melodyScale] || CHARACTER[ctx.mode] || []).map((s) => (ctx.keyPc + s) % 12);
    const tonic = ctx.keyPc, dominant = (ctx.keyPc + 7) % 12;
    for (const ev of events) {
      const seg = M.chordAt(ctx.progression, ev.t);
      const col = chordColors(seg.chord, ctx.keyPc, ctx.scale);
      const prevP = st.prev === null ? null : pitches[st.prev];
      let best = -1, bestCost = Infinity;
      const lo = Math.max(0, ev.target - 4), hi = Math.min(pitches.length - 1, ev.target + 4);
      for (let i = lo; i <= hi; i++) {
        const p = pitches[i], pc = p % 12;
        const iv = prevP === null ? 0 : p - prevP, a = Math.abs(iv);
        const isCT = col.root === null || col.tones.includes(pc);
        const isTension = col.tensions.includes(pc);
        let c = 0.9 * Math.abs(i - ev.target);
        if (st.resolve && prevP !== null) c += isCT && a >= 1 && a <= 2 ? -1.5 : 4;
        if (ev.strong > 0 && col.root !== null) {
          if (isCT) c += col.guide.includes(pc) ? -0.5 : pc === col.root ? 0.6 : 0.15;
          else if (isTension) c += ev.strong === 2 || ev.cadence ? 1.2 : 0.35;
          else c += canResolve(i, pitches, col) && !ev.cadence ? 1.4 : 6;
        } else if (!isCT) {
          c += a >= 1 && a <= 2 ? 0.1 : isTension ? 0.8 : 2;
        }
        if (ev.cadence) {
          const k = ev.cadence.indexOf(pc);
          c += k === -1 ? 5 : k * 0.6;
        } else {
          if (pc === tonic) c += 0.7;
          if (pc === dominant) c += 0.5;
        }
        if (prevP !== null && a === 0) c += ev.repeat ? 0 : 0.8;
        if (a === 6) c += 1.5;
        if (a > 7 && a !== 12) c += 1.2;
        if (a > 12) c += 4;
        if (Math.abs(st.lastIv) >= 5) c += Math.sign(iv) === Math.sign(st.lastIv) || a === 0 ? 1.6 : a > 4 ? 0.6 : -0.3;
        if (i > ev.ceiling) c += 3 * (i - ev.ceiling);
        if (ev.climax && p > st.highest) c -= 0.8;
        if (charPcs.includes(pc) && (isCT || isTension || ev.strong === 0)) c -= st.charUsed ? 0.15 : 0.6;
        c += 0.18 * st.recent.filter((x) => x === pc).length;
        c += r() * 0.35;
        if (c < bestCost) { bestCost = c; best = i; }
      }
      const p = pitches[best], pc = p % 12;
      const isCT = col.root === null || col.tones.includes(pc);
      st.resolve = ev.strong > 0 && !isCT && !col.tensions.includes(pc);
      st.lastIv = prevP === null ? 0 : p - prevP;
      st.prev = best;
      st.highest = Math.max(st.highest, p);
      if (charPcs.includes(pc)) st.charUsed = true;
      st.recent.push(pc);
      if (st.recent.length > 6) st.recent.shift();
      const height = (best / Math.max(1, pitches.length - 1)) * 0.12;
      const vel = (ev.strong === 2 ? 0.9 : ev.strong === 1 ? 0.82 : 0.72) + height + (ev.climax ? 0.05 : 0);
      out.push({ t: ev.t, d: ev.d, p, v: Math.max(0.05, Math.min(1, vel * (0.95 + r() * 0.05))) });
    }
    return out;
  }

  function canResolve(i, pitches, col) {
    for (const j of [i - 1, i + 1, i - 2, i + 2]) {
      const q = pitches[j];
      if (q !== undefined && Math.abs(q - pitches[i]) <= 2 && col.tones.includes(q % 12)) return true;
    }
    return false;
  }

  // Where a phrase may end. Open (the loop goes on): 2nd, 3rd, 5th or 7th of the key that the
  // chord holds, never the tonic. Half: the chord's 3rd or 5th. Closed: the tonic.
  function cadenceTargets(kind, t, ctx) {
    const seg = M.chordAt(ctx.progression, t);
    const col = chordColors(seg.chord, ctx.keyPc, ctx.scale);
    if (kind === 'tonic') return [ctx.keyPc];
    if (col.root === null) return null;
    const third = seg.chord.intervals[1] === undefined ? null : (seg.chord.root + seg.chord.intervals[1]) % 12;
    const fifth = seg.chord.intervals[2] === undefined ? null : (seg.chord.root + seg.chord.intervals[2]) % 12;
    let order;
    if (kind === 'half') order = [third, fifth, seg.chord.root];
    else order = [1, 2, 4, 6].map((d) => (ctx.keyPc + ctx.scale[d]) % 12).filter((pc) => col.tones.includes(pc)).concat([third, fifth]);
    const out = [];
    for (const pc of order) if (pc !== null && pc !== undefined && !out.includes(pc) && (kind === 'half' || pc !== ctx.keyPc)) out.push(pc);
    return out.length ? out : null;
  }

  // ---------------------------------------------------------------- melody
  function genMelody(part, ctx, r) {
    const octave = part.octave === undefined ? 5 : part.octave;
    const range = part.range || [12 * (octave + 1) - 3, 12 * (octave + 1) + 16];
    const pitches = M.scalePitches(ctx.keyPc, ctx.melodyScale, range[0], range[1]);
    const plan = motifPlan(part, ctx, M.rng(M.hashSeed(ctx.seed, 'melody-plan', part.inst)));
    const unitSteps = plan.unitBars * ctx.steps;
    const density = plan.style === 'hook' ? 'hook' : plan.style === 'fanfare' ? 'fanfare' : (part.density || 'medium');
    const sync = part.syncopation === undefined ? (plan.style === 'hook' ? 0.6 : density === 'sparse' ? 0.2 : 0.35) : part.syncopation;
    const rr = M.rng(M.hashSeed(ctx.seed, 'melody-rhythm', part.inst));
    const cr = M.rng(M.hashSeed(ctx.seed, 'melody-contour', part.inst));
    const longEnd = plan.style !== 'hook' && plan.unitBars > 1;

    // The basic idea (BI) and a contrasting idea (CI) for periods, AABA and hooks.
    const biR = unitRhythm(plan.unitBars, density, ctx, rr, { longEnd, syncopation: sync });
    const biN = biR.filter((x) => !x.rest).length;
    const biS = contourOffsets(biN, plan.shape, cr);
    const ciR = unitRhythm(plan.unitBars, density === 'sparse' ? 'medium' : density, ctx, rr, { longEnd: true, syncopation: sync });
    const opposite = { leap: 'valley', arch: 'valley', valley: 'arch', rise: 'fall', fall: 'rise', zigzag: 'turn', neighbor: 'arch', turn: 'zigzag' };
    const ciS = contourOffsets(ciR.filter((x) => !x.rest).length, opposite[plan.shape] || 'arch', cr);

    // Register: start low-middle so sequences and the climax have room above.
    const top = pitches.length - 1;
    const s0 = Math.max(0, Math.round(top * 0.35));
    const ceiling = Math.max(s0 + 3, top - 2);
    const dev = M.rng(M.hashSeed(ctx.seed, 'melody-develop', part.inst));
    const climaxUnit = plan.labels.indexOf('CONT') >= 0 ? plan.labels.indexOf('CONT') : plan.labels.indexOf('CI') >= 0 ? plan.labels.indexOf('CI') : Math.floor(plan.units * 0.6);

    const events = [];
    plan.labels.forEach((label, u) => {
      const base = u * unitSteps;
      let rhythm = biR, offs = biS, start = s0, cad = null, climax = u === climaxUnit, repeat = false;
      if (label === 'SEQ') start = s0 + dev.pick([1, 2, 2, -1, 3]);
      else if (label === 'VARY') {
        offs = biS.slice();
        const k = offs.length - 1;
        if (k > 0) offs[k] += dev.pick([-2, -1, 1, 2]);
        if (k > 1 && dev() < 0.5) offs[k - 1] += dev.pick([-1, 1]);
      } else if (label === 'INV') { offs = biS.map((x) => -x); start = s0 + 3; }
      else if (label === 'CI') { rhythm = ciR; offs = ciS; start = s0 + 2; cad = 'half'; }
      else if (label === 'CONT') {
        // Fragmentation: the head of the idea, three times, climbing; then a held arrival.
        const fragLen = unitSteps / 4;
        let frag = biR.filter((x) => x.at < fragLen).map((x) => Object.assign({}, x, { len: Math.min(x.len, fragLen - x.at) }));
        if (frag.filter((x) => !x.rest).length < 2) frag = barOnsets('medium', ctx, dev).filter((x) => x.at < fragLen).map((x) => Object.assign({}, x, { len: Math.min(x.len, fragLen - x.at) }));
        const fragOffs = biS.slice(0, frag.filter((x) => !x.rest).length);
        const rise = dev.pick([1, 1, 2]);
        rhythm = []; offs = [];
        for (let k = 0; k < 3; k++) {
          frag.forEach((x) => rhythm.push({ at: x.at + k * fragLen, len: x.len, rest: x.rest }));
          fragOffs.forEach((o) => offs.push(o + k * rise));
        }
        rhythm.push({ at: 3 * fragLen, len: fragLen, rest: false });
        offs.push(offs[offs.length - 1] + 1);
        repeat = true;
      } else if (label === 'CAD') {
        // The head of the idea, then a long note on a cadence tone.
        const half = unitSteps / 2;
        const head = biR.filter((x) => x.at < half).map((x) => Object.assign({}, x, { len: Math.min(x.len, half - x.at) }));
        rhythm = head.concat([{ at: half, len: half, rest: false }]);
        offs = biS.slice(0, head.filter((x) => !x.rest).length);
        offs.push((offs.length ? offs[offs.length - 1] : 0) - 1);
        start = s0 + (dev() < 0.5 ? 1 : 0);
        cad = part.ending === 'tonic' ? 'tonic' : 'open';
      }
      const notes = rhythm.filter((x) => !x.rest);
      notes.forEach((x, k) => {
        const t = (base + x.at) * ctx.stepBeats;
        const last = k === notes.length - 1;
        const onBar = Math.abs((t / ctx.beatsPerBar) % 1) < 1e-6;
        const onBeat = Math.abs(t % 1) < 1e-6;
        events.push({
          t, d: x.len * ctx.stepBeats * (part.legato || 0.92),
          target: Math.max(0, Math.min(top, start + (offs[k] === undefined ? offs[offs.length - 1] || 0 : offs[k]))),
          strong: onBar ? 2 : onBeat && x.len * ctx.stepBeats >= 0.5 ? 1 : 0,
          cadence: last && cad ? cadenceTargets(cad, t, ctx) : null,
          climax: climax && last,
          ceiling: climax ? top : ceiling,
          repeat: repeat || (k > 0 && offs[k] === offs[k - 1]),
        });
      });
    });

    const st = { prev: null, lastIv: 0, resolve: false, highest: -Infinity, charUsed: false, recent: [] };
    const out = realize(events, pitches, ctx, M.rng(M.hashSeed(ctx.seed, 'melody-choose', part.inst)), st);
    // Never ring past the loop end.
    for (const n of out) n.d = Math.max(0.05, Math.min(n.d, ctx.totalBeats - n.t));
    const firstUnit = out.filter((n) => n.t < unitSteps * ctx.stepBeats - 1e-9);
    out.motif = {
      rhythm: biR, offsets: biS, shape: plan.shape, form: plan.labels, unitBeats: unitSteps * ctx.stepBeats,
      notes: firstUnit.map((n) => ({ t: n.t, d: n.d, p: n.p })),
    };
    return out;
  }

  // A motif for cues without a melody (stingers still quote something of their own).
  function fallbackMotif(ctx) {
    const r = M.rng(M.hashSeed(ctx.seed, 'fallback-motif'));
    const rhythm = barOnsets('hook', ctx, r);
    const n = rhythm.filter((x) => !x.rest).length;
    const shape = r.pick(CONTOUR_BY_MODE[ctx.mode] || ['arch', 'leap']);
    return { rhythm, offsets: contourOffsets(n, shape, r), shape, form: ['BI'], unitBeats: ctx.beatsPerBar, notes: [] };
  }

  // ---------------------------------------------------------------- counterline
  // A second voice that answers the melody: guide tones (3rds and 7ths) moving by step, contrary
  // to the melody, below it, no parallel 5ths/octaves, and passing notes where the melody holds.
  function genCounter(part, ctx, r) {
    const range = part.range || [55, 74];
    const pitches = M.scalePitches(ctx.keyPc, ctx.scale, range[0], range[1]);
    const lead = (ctx.lead || []).slice().sort((a, b) => a.t - b.t);
    const melAt = (t) => { let m = null; for (const n of lead) { if (n.t <= t + 1e-9) m = n; else break; } return m && m.t + m.d + 0.5 > t ? m : null; };
    const melOnsets = (a, b) => lead.filter((n) => n.t >= a - 1e-9 && n.t < b - 1e-9).length;
    const every = part.every || 2;
    const line = [];
    let prev = pitches[Math.floor(pitches.length / 2)];
    let prevMel = null;
    for (let b = 0; b < ctx.totalBeats - 1e-9; b += every) {
      const seg = M.chordAt(ctx.progression, b);
      if (seg.chord.root === null) continue;
      const col = chordColors(seg.chord, ctx.keyPc, ctx.scale);
      const ninth = (seg.chord.root + 2) % 12;
      const m0 = melAt(b), m1 = melAt(b + every - 0.01);
      const melDir = m0 && m1 ? Math.sign(m1.p - m0.p) : 0;
      let best = prev, bestC = Infinity;
      for (const p of pitches) {
        const pc = p % 12;
        const ok = col.tones.includes(pc) || (pc === ninth && col.tensions.includes(pc));
        if (!ok) continue;
        const move = p - prev;
        let c = Math.abs(move) * 0.3;
        if (move === 0) c += 0.5;
        if (Math.abs(move) > 7) c += 2;
        if (col.guide.includes(pc)) c -= 0.7;
        else if (pc === seg.chord.root) c += 0.7;
        else if (pc === ninth) c += 0.2;
        if (melDir !== 0 && move !== 0) c += Math.sign(move) === -melDir ? -0.6 : 0.4;
        if (m0) {
          const gap = m0.p - p;
          if (gap < 2) c += 2.5;          // stay under the tune
          else if (gap % 12 === 0) c += 1.5; // octaves with the melody add nothing
          if (prevMel && (gap % 12 === 7 || gap % 12 === 0) && ((prevMel.p - prev) % 12 === gap % 12) && move !== 0) c += 2; // parallels
        }
        c += r() * 0.25;
        if (c < bestC) { bestC = c; best = p; }
      }
      line.push({ t: b, p: best });
      prev = best;
      prevMel = m0;
    }
    // Passing and neighbour notes where the melody is quiet (it moves when the tune holds).
    const out = [];
    for (let i = 0; i < line.length; i++) {
      const cur = line[i], next = line[(i + 1) % line.length];
      const end = i + 1 < line.length ? next.t : ctx.totalBeats;
      const mid = cur.t + (end - cur.t) / 2;
      const quiet = melOnsets(mid, end) === 0 || (ctx.lead && ctx.lead.length === 0);
      const gap = next.p - cur.p;
      const ia = pitches.indexOf(cur.p), ib = pitches.indexOf(next.p);
      let passing = null;
      if (end - cur.t >= 1 && quiet && ia >= 0 && ib >= 0) {
        if (Math.abs(ib - ia) === 2) passing = pitches[(ia + ib) / 2];
        else if (gap === 0 && r() < 0.5) passing = pitches[ia + (r() < 0.5 ? 1 : -1)] || null;
        else if (Math.abs(ib - ia) >= 3 && r() < 0.6) passing = pitches[ib + (ib > ia ? -1 : 1)];
      }
      if (passing !== null && passing !== undefined) {
        out.push({ t: cur.t, d: (mid - cur.t) * 0.98, p: cur.p, v: 0.75 });
        out.push({ t: mid, d: (end - mid) * 0.98, p: passing, v: 0.62 });
      } else out.push({ t: cur.t, d: (end - cur.t) * 0.98, p: cur.p, v: 0.75 });
    }
    return out;
  }

  // ---------------------------------------------------------------- bells
  // Sparkle: colour tones (3rd, 5th, 7th, 9th; rarely the root), now and then a grace-note pair.
  function genBells(part, ctx, r) {
    const range = part.range || [72, 91];
    const out = [];
    let last = null;
    for (let b = 0; b < ctx.totalBeats; b += 1) {
      if (r() > (part.chance || 0.3)) continue;
      const seg = M.chordAt(ctx.progression, b);
      const col = chordColors(seg.chord, ctx.keyPc, ctx.scale);
      const pcs = seg.chord.root === null ? ctx.scale.map((s) => (ctx.keyPc + s) % 12) : col.tones.filter((pc) => pc !== col.root).concat(M.chordExtensions(seg.chord, ctx.keyPc, ctx.scale, 1));
      if (seg.chord.root !== null && r() < 0.12) pcs.push(col.root);
      const cands = [];
      for (let m = range[0]; m <= range[1]; m++) if (pcs.includes(m % 12) && m !== last) cands.push(m);
      if (!cands.length) continue;
      const off = r() < 0.3 ? 0.5 : 0;
      const p = r.pick(cands);
      const t = b + off;
      if (r() < 0.25 && t + 0.25 < ctx.totalBeats) {
        const grace = M.scalePitches(ctx.keyPc, ctx.scale, p + 1, p + 2)[0];
        if (grace !== undefined && t + 0.25 < ctx.totalBeats) { out.push({ t, d: 0.25, p: grace, v: 0.4 + r() * 0.2 }); out.push({ t: t + 0.25, d: 1.5 + r() * 2, p, v: 0.5 + r() * 0.35 }); last = p; continue; }
      }
      out.push({ t, d: 1.5 + r() * 2, p, v: 0.5 + r() * 0.4 });
      last = p;
    }
    return out;
  }

  Object.assign(M, { CHARACTER, chordColors, chordExtensions, genMelody, genCounter, genBells, fallbackMotif, contourOffsets, MELODY_FORMS: FORMS, CONTOURS });
})(typeof MusicEngine !== 'undefined' ? MusicEngine : (globalThis.MusicEngine = globalThis.MusicEngine || {}));
