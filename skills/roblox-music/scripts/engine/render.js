// Rendering: cue -> stereo stems that loop seamlessly, plus one-shots (stingers, intro, ending).
//
// Seamless loops: every part is rendered with its full release tail and then folded back onto
// the loop start (periodic summation), held notes (drones, clusters) are crossfaded
// into themselves, and reverb / delay run on the loop repeated until they reach steady state, so
// the last sample of each stem flows into the first exactly as it will when the game loops it.
//
// Mixing: each part is measured (BS.1770 LUFS) and set to its role's level, so presets don't
// depend on how loud an instrument recipe happens to be; then all stems get the same gain so the
// full mix (every stem on) hits the target loudness with peaks under -1 dBFS.
(function (M) {
  'use strict';

  const DEFAULTS = { sr: 44100, target: -16, ceiling: -1, tail: 4, holdFade: 0.75, stingerOffset: -1 };

  function timing(cue, sr) {
    const secPerBeat = 60 / cue.bpm;
    const loopSamples = Math.round(cue.bars * cue.beatsPerBar * secPerBeat * sr);
    // Swing: delay the off-beat 8ths (grid 8) or 16ths (grid 16) by `swing` of their slot.
    const a = cue.swing || 0;
    const unit = cue.swingGrid === 16 ? 0.5 : 1;
    const warp = (beat) => {
      if (!a) return beat;
      const base = Math.floor(beat / unit) * unit;
      const f = (beat - base) / unit; // 0..1 within the swing unit
      const g = f < 0.5 ? f * (1 + a) : (0.5 + a * 0.5) + (f - 0.5) * (1 - a);
      return base + g * unit;
    };
    return { secPerBeat, loopSamples, warp };
  }

  // `off` (beats) is a performance offset (perform.js: laid-back snare, rushed pickup...). In a
  // loop a note pushed before 0 wraps to the end (`wrap` = loop length in samples).
  function renderNotes(notes, part, buf, cue, tm, sr, seedKey, lengthOverride, wrap) {
    const instName = part.inst;
    notes.forEach((n, ni) => {
      const name = typeof n.p === 'string' ? n.p : (n.inst || instName);
      const inst = M.INSTRUMENTS[name];
      if (!inst) throw new Error(`unknown instrument '${name}'`);
      let start = Math.round((tm.warp(n.t) + (n.off || 0)) * tm.secPerBeat * sr);
      if (start < 0) start = wrap ? start + wrap : 0;
      if (start >= buf.L.length) return;
      inst({
        L: buf.L, R: buf.R, start, sr,
        f: typeof n.p === 'number' ? M.midiToFreq(n.p) : 0,
        dur: lengthOverride || n.d * tm.secPerBeat,
        vel: n.v, pan: part.pan || 0,
        rng: M.rng(M.hashSeed(cue.seed, seedKey, ni)),
        note: n,
      });
    });
  }

  function stereo(n) { return { L: new Float32Array(n), R: new Float32Array(n) }; }

  function scale(buf, g) { for (let i = 0; i < buf.L.length; i++) { buf.L[i] *= g; buf.R[i] *= g; } }

  function normalizePart(buf, target, sr) {
    const lu = M.loudness(buf.L, buf.R, sr);
    if (!isFinite(lu)) return -Infinity;
    scale(buf, M.dbToGain(target - lu));
    return lu;
  }

  // One looping part -> folded, level-set buffer of exactly loopSamples.
  function renderLoopPart(cue, part, stemName, pi, opt, tm) {
    const sr = opt.sr, Ls = tm.loopSamples;
    const out = stereo(Ls);
    const regular = part.notes.filter((n) => !n.hold), held = part.notes.filter((n) => n.hold);
    if (regular.length) {
      const buf = stereo(Ls + Math.round(opt.tail * sr));
      renderNotes(regular, part, buf, cue, tm, sr, `${stemName}/${pi}`, undefined, Ls);
      for (let i = 0; i < buf.L.length; i++) { const k = i % Ls; out.L[k] += buf.L[i]; out.R[k] += buf.R[i]; }
    }
    if (held.length) {
      const F = Math.min(Math.round(opt.holdFade * sr), Math.floor(Ls / 4));
      const buf = stereo(Ls + F);
      renderNotes(held, part, buf, cue, tm, sr, `${stemName}/${pi}/hold`, (Ls + F) / sr + 0.05);
      for (let i = 0; i < Ls; i++) {
        if (i < F) {
          const a = Math.sin((Math.PI / 2) * (i / F)), b = Math.cos((Math.PI / 2) * (i / F));
          out.L[i] += buf.L[i] * a + buf.L[Ls + i] * b;
          out.R[i] += buf.R[i] * a + buf.R[Ls + i] * b;
        } else { out.L[i] += buf.L[i]; out.R[i] += buf.R[i]; }
      }
    }
    if (M.applyAmp) M.applyAmp(out, part.inst, sr, true);
    const measured = normalizePart(out, part.target, sr);
    return { buf: out, measured };
  }

  // Sidechain-style pump on every beat (synthwave / EDM breathing).
  function pump(buf, depth, tm, sr) {
    const spb = tm.secPerBeat;
    for (let i = 0; i < buf.L.length; i++) {
      const ph = ((i / sr) / spb) % 1;
      const g = 1 - depth * Math.pow(Math.max(0, 1 - ph / 0.5), 2);
      buf.L[i] *= g; buf.R[i] *= g;
    }
  }

  // Effects on a loop: feed the last `warm` seconds of the loop in first (so reverb and delay
  // tails from the previous pass are already ringing), then process the loop and keep it.
  // Ends in a 30 Hz high-pass: nothing below it is audible on phones or laptops, it only eats
  // headroom.
  function loopEffects(buf, fx, cue, tm, opt) {
    const wet = fx.reverb || 0, delay = fx.delay;
    const sr = opt.sr, Ls = buf.L.length;
    const warm = Math.round((opt.tail + (delay ? 3 : 0)) * sr);
    const n = warm + Ls;
    const inL = new Float32Array(n), inR = new Float32Array(n);
    for (let i = 0; i < n; i++) { const k = (((i - warm) % Ls) + Ls) % Ls; inL[i] = buf.L[k]; inR[i] = buf.R[k]; }
    const outL = new Float32Array(n), outR = new Float32Array(n);
    if (delay) {
      const ds = Math.round((delay.beats || 0.75) * tm.secPerBeat * sr);
      M.processDelay(inL, inR, outL, outR, ds, delay.feedback === undefined ? 0.35 : delay.feedback, delay.mix === undefined ? 0.25 : delay.mix);
    }
    if (wet) {
      const room = Object.assign({ size: 0.78, damp: 0.45 }, cue.room || {});
      const rv = new M.Reverb(sr, room.size, room.damp);
      let srcL = inL, srcR = inR;
      if (delay) { srcL = new Float32Array(n); srcR = new Float32Array(n); for (let i = 0; i < n; i++) { srcL[i] = inL[i] + outL[i]; srcR[i] = inR[i] + outR[i]; } }
      rv.process(srcL, srcR, outL, outR, wet);
    }
    for (let i = 0; i < n; i++) { outL[i] += inL[i]; outR[i] += inR[i]; }
    M.highpass(outL, outR, 30, sr);
    buf.L.set(outL.subarray(warm));
    buf.R.set(outR.subarray(warm));
  }

  function renderStem(cue, si, options) {
    const opt = Object.assign({}, DEFAULTS, options);
    const tm = timing(cue, opt.sr);
    const stem = cue.stems[si];
    const out = stereo(tm.loopSamples);
    const parts = [];
    stem.parts.forEach((part, pi) => {
      const r = renderLoopPart(cue, part, stem.name, pi, opt, tm);
      for (let i = 0; i < tm.loopSamples; i++) { out.L[i] += r.buf.L[i]; out.R[i] += r.buf.R[i]; }
      parts.push({ role: part.role, inst: part.inst, rawLufs: r.measured });
    });
    if (stem.fx.pump) pump(out, stem.fx.pump, tm, opt.sr);
    loopEffects(out, stem.fx, cue, tm, opt);
    return { name: stem.name, min: stem.min, full: stem.full, L: out.L, R: out.R, parts };
  }

  function renderOneShot(cue, oi, options) {
    const opt = Object.assign({}, DEFAULTS, options);
    const tm = timing(cue, opt.sr);
    const shot = cue.oneShots[oi];
    const sr = opt.sr;
    const n = Math.round(shot.beats * tm.secPerBeat * sr + opt.tail * sr);
    const out = stereo(n);
    const noSwing = Object.assign({}, tm, { warp: (b) => b });
    shot.parts.forEach((part, pi) => {
      const buf = stereo(n);
      renderNotes(part.notes, part, buf, cue, noSwing, sr, `${shot.name}/${pi}`);
      if (M.applyAmp) M.applyAmp(buf, part.inst, sr, false);
      normalizePart(buf, part.target, sr);
      for (let i = 0; i < n; i++) { out.L[i] += buf.L[i]; out.R[i] += buf.R[i]; }
    });
    const wet = shot.reverb === undefined ? (cue.oneShotReverb === undefined ? 0.3 : cue.oneShotReverb) : shot.reverb;
    if (wet) {
      const room = Object.assign({ size: 0.82, damp: 0.4 }, cue.room || {});
      const rv = new M.Reverb(sr, room.size, room.damp);
      const wl = new Float32Array(n), wr = new Float32Array(n);
      rv.process(out.L, out.R, wl, wr, wet);
      for (let i = 0; i < n; i++) { out.L[i] += wl[i]; out.R[i] += wr[i]; }
    }
    M.highpass(out.L, out.R, 30, sr);
    // Trim trailing silence (below -70 dBFS), keep a 50 ms fade.
    let end = n;
    const floor = M.dbToGain(-70);
    while (end > 1 && Math.abs(out.L[end - 1]) < floor && Math.abs(out.R[end - 1]) < floor) end--;
    const keep = Math.min(n, end + Math.round(0.05 * sr));
    const fadeN = Math.round(0.05 * sr);
    for (let i = 0; i < fadeN && keep - 1 - i >= 0; i++) { const g = i / fadeN; out.L[keep - 1 - i] *= g; out.R[keep - 1 - i] *= g; }
    return { name: shot.name, kind: shot.kind, beats: shot.beats, L: out.L.slice(0, keep), R: out.R.slice(0, keep) };
  }

  // Same gain on every stem: full mix -> target LUFS, peak <= ceiling. One-shots are levelled on
  // their own (stingers a touch under the music, so they cut through without jumping out).
  function finalize(cue, stems, oneShots, options) {
    const opt = Object.assign({}, DEFAULTS, options);
    const sr = opt.sr;
    const n = stems[0].L.length;
    const mixL = new Float32Array(n), mixR = new Float32Array(n);
    for (const s of stems) for (let i = 0; i < n; i++) { mixL[i] += s.L[i]; mixR[i] += s.R[i]; }
    const lu = M.loudness(mixL, mixR, sr);
    let g = M.dbToGain(opt.target - lu);
    const pk = M.peak(mixL, mixR) * g;
    const ceil = M.dbToGain(opt.ceiling);
    if (pk > ceil) g *= ceil / pk;
    for (const s of stems) {
      scale(s, g);
      s.lufs = M.loudness(s.L, s.R, sr);
      s.peak = M.peak(s.L, s.R);
    }
    for (let i = 0; i < n; i++) { mixL[i] *= g; mixR[i] *= g; }
    const mix = { lufs: M.loudness(mixL, mixR, sr), peak: M.peak(mixL, mixR) };
    for (const o of oneShots) {
      const target = opt.target + opt.stingerOffset + (o.kind === 'stinger' ? 0 : -2);
      const l = M.loudness(o.L, o.R, sr);
      let og = isFinite(l) ? M.dbToGain(target - l) : 1;
      const opk = M.peak(o.L, o.R) * og;
      if (opk > ceil) og *= ceil / opk;
      scale(o, og);
      o.lufs = M.loudness(o.L, o.R, sr);
      o.peak = M.peak(o.L, o.R);
    }
    return { sr, loopSamples: n, loopSeconds: n / sr, stems, oneShots, mix, gainDb: M.gainToDb(g) };
  }

  function render(cue, options) {
    const stems = cue.stems.map((_, i) => renderStem(cue, i, options));
    const oneShots = cue.oneShots.map((_, i) => renderOneShot(cue, i, options));
    return finalize(cue, stems, oneShots, options);
  }

  // How audible the loop point is: the jump across the seam compared to typical sample-to-sample
  // steps. ~1 means the seam is like any other sample; a click shows up as 10+.
  function seamRatio(L) {
    const n = L.length;
    let sum = 0;
    for (let i = 1; i < n; i++) sum += Math.abs(L[i] - L[i - 1]);
    const mean = sum / (n - 1) || 1e-9;
    return Math.abs(L[0] - L[n - 1]) / mean;
  }

  Object.assign(M, { RENDER_DEFAULTS: DEFAULTS, timing, render, renderStem, renderOneShot, finalize, seamRatio });
})(typeof MusicEngine !== 'undefined' ? MusicEngine : (globalThis.MusicEngine = globalThis.MusicEngine || {}));
