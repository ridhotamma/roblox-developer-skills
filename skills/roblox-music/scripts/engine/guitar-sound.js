// Guitar sounds: a plucked-string model (Karplus-Strong with a pick-position comb, pitch bends,
// palm muting and a body or pickup), electric bass, a blues harmonica, and guitar amps.
//
// Amps are applied to a whole part after its notes are summed, the way six strings go into one
// amplifier: a power chord through distortion growls (intermodulation) instead of sounding like
// three separately fuzzed notes. renderLoopPart / renderOneShot call M.applyAmp for any part
// whose instrument has an entry in M.AMP_OF.
//
// Note flags (set by the guitar generators and perform.js): pm (palm mute), mute (dead "chk"
// strum), bend / slide / hammer / vib (see pitchMod in instruments.js).
(function (M) {
  'use strict';
  const TAU = Math.PI * 2;
  const { SVF } = M;
  const { writer, samplesFor, adsr, amp } = M.INST_KIT;
  const exp = Math.exp, sin = Math.sin, tanh = Math.tanh;

  function gstring(c, o) {
    const w = writer(c), sr = c.sr, note = c.note || {};
    const dead = !!note.mute, pmute = !!note.pm;
    const decay = dead ? 0.045 : pmute ? 0.16 : o.decay;
    const ring = dead ? 0 : pmute ? 0.01 : (o.ring === undefined ? 0.08 : o.ring);
    const n = samplesFor(c, Math.min(c.dur + ring + 0.25, decay * 1.6 + 0.3));
    const g = amp(c.vel) * (o.level || 1) * (dead ? 0.6 : 1);
    const pm = M.pitchMod(c);
    const size = Math.ceil(sr / (c.f * 0.78)) + 4;
    const buf = new Float32Array(size);
    // Excitation: filtered noise (brighter when picked harder), minus a delayed copy for the
    // pick position (plucking near the bridge = thin and bright, near the neck = round).
    const bright = Math.min(0.98, o.bright * (pmute ? 0.4 : 1) * (dead ? 0.5 : 1) * (0.55 + 0.45 * c.vel));
    const N0 = sr / c.f - 0.5;
    const ex = new Float32Array(size);
    let lp = 0;
    const b = 0.04 + 0.92 * bright;
    for (let i = 0; i < size; i++) { lp += b * ((c.rng() * 2 - 1) - lp); ex[i] = lp; }
    const pickD = Math.max(1, Math.round((o.pick || 0.15) * N0));
    for (let i = 0; i < size; i++) buf[i] = ex[i] - (i >= pickD ? ex[i - pickD] : 0) * 0.9;
    const loss = Math.pow(10, -3 / (c.f * decay));
    const smooth = pmute ? 0.35 : dead ? 0.3 : (o.smooth === undefined ? 0.5 : o.smooth); // loop low-pass (string damping)
    let wi = size - 1, last = 0, mult = 1;
    const tone = new SVF(); tone.setup(o.tone || 5000, 0.6, sr);
    const bodies = o.body ? o.body.map(([f, q]) => { const s = new SVF(); s.setup(f, q, sr); return s; }) : null;
    const hp = new SVF(); hp.setup(o.hp || 70, 0.7, sr);
    for (let i = 0; i < n; i++) {
      const t = i / sr;
      if (pm && (i & 15) === 0) mult = pm(t);
      const N = Math.min(size - 2, sr / (c.f * mult) - 0.5);
      const rp = wi - N;
      const i0 = Math.floor(rp), fr = rp - i0;
      const a = buf[((i0 % size) + size) % size], bb = buf[(((i0 + 1) % size) + size) % size];
      const y = a + (bb - a) * fr;
      const damp = t > c.dur + ring ? 0.93 : 1;
      buf[((wi % size) + size) % size] = ((1 - smooth) * y + smooth * last) * loss * damp;
      last = y;
      wi++;
      let out = tone.tick(y);
      if (bodies) { let s = 0; for (let k = 0; k < bodies.length; k++) { bodies[k].tick(y); s += bodies[k].band * o.body[k][2]; } out = out * 0.8 + s; }
      hp.tick(out);
      const fade = t > c.dur + ring ? Math.max(0, 1 - (t - c.dur - ring) / 0.25) : 1;
      w(i, hp.high * g * fade * Math.min(1, t / 0.0008));
    }
  }

  const T = M.INSTRUMENTS;
  // Steel-string acoustic: bright pick, three body resonances (air, top, wood).
  T.acoustic = (c) => gstring(c, { bright: 0.8, decay: 3.2, pick: 0.12, tone: 7000, ring: 0.15, body: [[105, 2.5, 0.5], [210, 2, 0.35], [420, 1.5, 0.2]], level: 1.1 });
  // Nylon string: softer, rounder, picked nearer the neck.
  T.nylon = (c) => gstring(c, { bright: 0.45, decay: 2.6, pick: 0.22, tone: 3800, ring: 0.2, smooth: 0.55, body: [[98, 2.5, 0.5], [200, 2, 0.3]], level: 1.2 });
  // Electric guitars: the string and pickup here; the amp (clean, blues, crunch, distortion,
  // lead) is applied to the whole part (AMP_OF below).
  const electric = (decay, bright) => (c) => gstring(c, { bright, decay, pick: 0.2, tone: 4200, ring: 0.06, hp: 90 });
  T.cleangtr = electric(3.5, 0.65);
  T.bluesgtr = electric(4.5, 0.6);
  T.crunchgtr = electric(4, 0.6);
  T.distgtr = electric(4.5, 0.55);
  T.leadgtr = electric(7, 0.6);
  // Picked electric bass: a string plus a sine for weight on small speakers' harmonics.
  T.ebass = function (c) {
    gstring(c, { bright: 0.55, decay: 2.2, pick: 0.18, tone: 2600, ring: 0.03, hp: 35, level: 1 });
    const w = writer(c), sr = c.sr, n = samplesFor(c, c.dur + 0.08), g = amp(c.vel) * 0.35;
    const pm = M.pitchMod(c);
    let ph = 0, mult = 1;
    for (let i = 0; i < n; i++) {
      const t = i / sr;
      if (pm && (i & 15) === 0) mult = pm(t);
      ph += c.f * mult / sr;
      w(i, tanh(1.5 * sin(TAU * ph)) * adsr(t, c.dur, 0.004, 0.3, 0.7, 0.06) * g);
    }
  };
  // Blues harp: a reedy pulse through two formants, breath, and bends.
  T.harmonica = function (c) {
    const w = writer(c), sr = c.sr, n = samplesFor(c, c.dur + 0.1), g = amp(c.vel);
    const pm = M.pitchMod(c);
    const f1 = new SVF(), f2 = new SVF(), br = new SVF(), lp = new SVF();
    f1.setup(1100, 2.5, sr); f2.setup(2600, 3, sr); br.setup(1800, 1.2, sr); lp.setup(4500, 0.7, sr);
    let ph = c.rng(), mult = 1;
    for (let i = 0; i < n; i++) {
      const t = i / sr;
      if ((i & 15) === 0) mult = (pm ? pm(t) : 1) * Math.pow(2, -30 / 1200 * exp(-t * 20));
      const d = c.f * mult / sr;
      ph += d; ph -= Math.floor(ph);
      const x = M.square(ph, d, 0.32) * 0.8 + M.saw(ph, d) * 0.3;
      br.tick(c.rng() * 2 - 1);
      f1.tick(x); f2.tick(x);
      const y = lp.tick(f1.band + f2.band * 0.6 + x * 0.25 + br.band * 0.12);
      const e = adsr(t, c.dur, 0.035, 0.15, 0.85, 0.08) * (1 + 0.08 * sin(TAU * 4.8 * t) * Math.min(1, t / 0.4));
      w(i, tanh(1.6 * y) * 0.7 * e * g);
    }
  };

  // ---------------------------------------------------------------- amps
  // pre: drive into the clipper; tight: high-pass before it (keeps palm mutes from farting out);
  // cab: speaker roll-off; mid: [freq, gain] presence peak; bias: asymmetry (even harmonics).
  const AMPS = {
    clean: { pre: 1.4, tight: 60, cab: 6000, mid: [1200, 0.15], bias: 0.05 },
    blues: { pre: 3.5, tight: 90, cab: 4800, mid: [900, 0.35], bias: 0.15 },
    crunch: { pre: 7, tight: 110, cab: 4500, mid: [1000, 0.3], bias: 0.12 },
    dist: { pre: 22, tight: 140, cab: 4200, mid: [1400, 0.25], bias: 0.08, scoop: [500, -0.3] },
    lead: { pre: 30, tight: 160, cab: 4600, mid: [1600, 0.4], bias: 0.1 },
  };
  const AMP_OF = { cleangtr: 'clean', bluesgtr: 'blues', crunchgtr: 'crunch', distgtr: 'dist', leadgtr: 'lead' };

  function ampPass(L, R, a, sr) {
    let peak = 0;
    for (let i = 0; i < L.length; i++) peak = Math.max(peak, Math.abs(L[i]), Math.abs(R[i]));
    if (!peak) return;
    const norm = 0.5 / peak;
    const chans = [L, R].map(() => ({ tight: new SVF(), cab1: new SVF(), cab2: new SVF(), mid: new SVF(), scoop: new SVF() }));
    chans.forEach((ch) => {
      ch.tight.setup(a.tight, 0.7, sr); ch.cab1.setup(a.cab, 0.7, sr); ch.cab2.setup(a.cab * 1.15, 0.9, sr);
      ch.mid.setup(a.mid[0], 1.2, sr); if (a.scoop) ch.scoop.setup(a.scoop[0], 1, sr);
    });
    const off = tanh(a.bias);
    [L, R].forEach((X, k) => {
      const ch = chans[k];
      for (let i = 0; i < X.length; i++) {
        ch.tight.tick(X[i] * norm);
        const x = ch.tight.high * a.pre;
        let y = (tanh(x + a.bias) - off) / Math.min(a.pre, 3);
        ch.mid.tick(y); y += ch.mid.band * a.mid[1];
        if (a.scoop) { ch.scoop.tick(y); y += ch.scoop.band * a.scoop[1]; }
        ch.cab1.tick(y); ch.cab2.tick(ch.cab1.low);
        X[i] = ch.cab2.low;
      }
    });
  }

  // Loops: run the amp over two passes and keep the second, so the filters are in steady state
  // and the loop point stays seamless. One-shots: one pass.
  function applyAmp(buf, inst, sr, loop) {
    const a = AMPS[AMP_OF[inst]];
    if (!a) return;
    const n = buf.L.length;
    if (!loop) { ampPass(buf.L, buf.R, a, sr); return; }
    const L = new Float32Array(2 * n), R = new Float32Array(2 * n);
    L.set(buf.L); L.set(buf.L, n); R.set(buf.R); R.set(buf.R, n);
    ampPass(L, R, a, sr);
    buf.L.set(L.subarray(n)); buf.R.set(R.subarray(n));
  }

  Object.assign(M, { AMPS, AMP_OF, applyAmp, GUITAR_INSTRUMENTS: ['acoustic', 'nylon', 'cleangtr', 'bluesgtr', 'crunchgtr', 'distgtr', 'leadgtr'] });
})(typeof MusicEngine !== 'undefined' ? MusicEngine : (globalThis.MusicEngine = globalThis.MusicEngine || {}));
