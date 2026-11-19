// Instruments: small synthesis recipes (subtractive, FM, additive, Karplus-Strong, noise) that
// render one note into stereo buffers. Every instrument has the same signature:
//
//   inst(c)  c = { L, R, start, sr, f, dur, vel, pan, rng, note }
//
// `start` is the first sample, `f` the frequency (Hz), `dur` the held time in seconds (release
// rings past it), `note` the raw note (for flags like hold, sfz, detune, glide).
// They aim for "convincing placeholder": synthwave, chiptune, horror and hybrid-cinematic sound
// right; orchestral and acoustic ones are sketches to be replaced by real samples in a DAW
// (the MIDI export carries the same notes).
(function (M) {
  'use strict';
  const TAU = Math.PI * 2;
  const { saw, square, triangle, SVF } = M;
  const exp = Math.exp, sin = Math.sin, tanh = Math.tanh;

  function writer(c) {
    const a = ((c.pan || 0) + 1) * Math.PI / 4;
    const gl = Math.cos(a) * Math.SQRT2, gr = Math.sin(a) * Math.SQRT2;
    const L = c.L, R = c.R, s0 = c.start;
    return function (i, l, r) { const k = s0 + i; L[k] += l * gl; R[k] += (r === undefined ? l : r) * gr; };
  }
  function samplesFor(c, seconds) { return Math.max(0, Math.min(c.L.length - c.start, Math.round(seconds * c.sr))); }

  // ADSR with an exponential-ish release after `dur`.
  function adsr(t, dur, a, d, s, r) {
    let v;
    if (t < a) v = t / a;
    else if (t < a + d) v = 1 - (1 - s) * (t - a) / d;
    else v = s;
    if (t > dur) {
      const at = dur < a ? dur / a : dur < a + d ? 1 - (1 - s) * (dur - a) / d : s;
      v = at * exp(-(t - dur) * 5 / r);
    }
    return v;
  }
  const amp = (vel) => Math.pow(vel, 1.3);
  const cents = (c) => Math.pow(2, c / 1200);
  const VIB14 = cents(14) - 1, VIB18 = cents(18) - 1, VIB25 = cents(25) - 1;
  const UP7 = cents(7), DOWN6 = cents(-6), UP4 = cents(4), DOWN4 = cents(-4);

  // Performance articulations carried on a note (set by perform.js): slide (scoop in from
  // `slide` semitones away; positive = from below), bend (start `bend` semitones flat and bend
  // up to pitch, guitar/harmonica style), hammer (start `hammer` semitones lower, then snap to
  // pitch: a hammer-on), vib (extra delayed vibrato, cents). Returns t -> frequency multiplier,
  // or null when the note has none.
  function pitchMod(c) {
    const n = c.note || {};
    const slide = n.slide || 0, bend = n.bend || 0, hammer = n.hammer || 0, vib = n.vib || 0;
    if (!slide && !bend && !hammer && !vib) return null;
    const bendAt = n.bendAt === undefined ? 0.04 : n.bendAt, bendTime = n.bendTime || 0.11;
    const vibDelay = Math.min(0.3, c.dur * 0.35), vibDepth = cents(vib) - 1, rate = 5.3;
    return function (t) {
      let semis = 0;
      if (slide) semis -= slide * Math.max(0, 1 - t / 0.07);
      if (bend) { const k = Math.min(1, Math.max(0, (t - bendAt) / bendTime)); semis -= bend * (1 - k * k * (3 - 2 * k)); }
      if (hammer && t < 0.07) semis -= hammer;
      let m = Math.pow(2, semis / 12);
      if (vib && t > vibDelay) m *= 1 + vibDepth * Math.min(1, (t - vibDelay) / 0.25) * sin(TAU * rate * (t - vibDelay));
      return m;
    };
  }

  // ---------------------------------------------------------------- drums
  const HAT_FREQS = [205.3, 304.4, 369.6, 522.7, 540, 800];
  function metallic(c, mult, decay, hpCut, seconds, level) {
    const w = writer(c), n = samplesFor(c, seconds), sr = c.sr;
    const ph = HAT_FREQS.map(() => c.rng());
    const hp = new SVF(); hp.setup(hpCut, 0.7, sr);
    const hp2 = new SVF(); hp2.setup(hpCut, 0.7, sr);
    const g = amp(c.vel) * level;
    for (let i = 0; i < n; i++) {
      let x = 0;
      for (let k = 0; k < 6; k++) { ph[k] += HAT_FREQS[k] * mult / sr; ph[k] -= Math.floor(ph[k]); x += ph[k] < 0.5 ? 1 : -1; }
      x = x / 6 * 0.6 + (c.rng() * 2 - 1) * 0.4;
      hp.tick(x); hp2.tick(hp.high);
      w(i, hp2.high * exp(-i / sr * decay) * g);
    }
  }
  function noiseHit(c, filterType, cutoff, q, decay, seconds, level, attack) {
    const w = writer(c), n = samplesFor(c, seconds), sr = c.sr;
    const f = new SVF(); f.setup(cutoff, q, sr);
    const g = amp(c.vel) * level;
    for (let i = 0; i < n; i++) {
      const t = i / sr;
      f.tick(c.rng() * 2 - 1);
      const env = (attack ? Math.min(1, t / attack) : 1) * exp(-t * decay);
      w(i, f[filterType] * env * g);
    }
  }

  const drums = {
    kick(c) {
      const w = writer(c), n = samplesFor(c, 0.7), sr = c.sr, g = amp(c.vel);
      let ph = 0;
      for (let i = 0; i < n; i++) {
        const t = i / sr;
        ph += (46 + 130 * exp(-t * 32)) / sr;
        const body = sin(TAU * ph) * exp(-t * 6.5);
        const click = (c.rng() * 2 - 1) * exp(-t * 420) * 0.35;
        w(i, tanh(1.6 * (body + click)) * 0.95 * g);
      }
    },
    snare(c) {
      const w = writer(c), n = samplesFor(c, 0.45), sr = c.sr, g = amp(c.vel);
      const hp = new SVF(); hp.setup(1400, 0.6, sr);
      const bp = new SVF(); bp.setup(4200, 0.9, sr);
      for (let i = 0; i < n; i++) {
        const t = i / sr;
        const tone = (sin(TAU * 185 * t) * 0.6 + sin(TAU * 330 * t) * 0.3) * exp(-t * 24);
        const x = c.rng() * 2 - 1;
        hp.tick(x); bp.tick(x);
        const noise = (hp.high * 0.7 + bp.band * 0.6) * exp(-t * 14);
        w(i, (tone * 0.55 + noise * 0.8) * g, (tone * 0.55 + noise * 0.75) * g);
      }
    },
    clap(c) {
      const w = writer(c), n = samplesFor(c, 0.4), sr = c.sr, g = amp(c.vel);
      const bp = new SVF(); bp.setup(1150, 1.4, sr);
      for (let i = 0; i < n; i++) {
        const t = i / sr;
        let env = 0;
        for (const b of [0, 0.011, 0.022]) if (t >= b) env = Math.max(env, exp(-(t - b) * 170));
        if (t >= 0.03) env = Math.max(env, 0.7 * exp(-(t - 0.03) * 15));
        bp.tick(c.rng() * 2 - 1);
        w(i, bp.band * env * 2.2 * g);
      }
    },
    rim(c) {
      const w = writer(c), n = samplesFor(c, 0.1), sr = c.sr, g = amp(c.vel);
      for (let i = 0; i < n; i++) { const t = i / sr; w(i, (sin(TAU * 1700 * t) * exp(-t * 90) * 0.6 + (c.rng() * 2 - 1) * exp(-t * 160) * 0.3) * g); }
    },
    tick(c) { // a clock tick: suspense, heists, horror
      const w = writer(c), n = samplesFor(c, 0.06), sr = c.sr, g = amp(c.vel);
      for (let i = 0; i < n; i++) { const t = i / sr; w(i, (sin(TAU * 2600 * t) * exp(-t * 220) + sin(TAU * 4300 * t) * 0.5 * exp(-t * 320) + (c.rng() * 2 - 1) * 0.2 * exp(-t * 500)) * 0.6 * g); }
    },
    hat(c) { metallic(c, 1.7, 65, 7000, 0.12, 1.0); },
    openhat(c) { metallic(c, 1.7, 7, 6500, 0.7, 0.8); },
    ride(c) { metallic(c, 2.4, 3.2, 5000, 1.3, 0.5); },
    shaker(c) { noiseHit(c, 'band', 7000, 0.9, 32, 0.15, 1.2, 0.008); },
    tom(c) {
      const w = writer(c), n = samplesFor(c, 0.8), sr = c.sr, g = amp(c.vel);
      const base = [82, 118, 160][c.note.pitch || 0] || 110;
      const lp = new SVF(); lp.setup(1500, 0.7, sr);
      let ph = 0;
      for (let i = 0; i < n; i++) {
        const t = i / sr;
        ph += base * (1 + 0.6 * exp(-t * 18)) / sr;
        lp.tick(c.rng() * 2 - 1);
        w(i, tanh(1.3 * (sin(TAU * ph) * exp(-t * 7) + lp.low * exp(-t * 30) * 0.3)) * g);
      }
    },
    taiko(c) {
      const w = writer(c), n = samplesFor(c, 1.5), sr = c.sr, g = amp(c.vel);
      const lp = new SVF(); lp.setup(700, 0.8, sr);
      let ph = 0;
      for (let i = 0; i < n; i++) {
        const t = i / sr;
        ph += 60 * (1 + 0.45 * exp(-t * 12)) / sr;
        lp.tick(c.rng() * 2 - 1);
        w(i, tanh(2 * (sin(TAU * ph) * exp(-t * 3.2) + lp.low * exp(-t * 11) * 0.6)) * 0.85 * g);
      }
    },
  };
  drums.kit = null; // marker: notes carry their own voice

  // ---------------------------------------------------------------- bass
  const tonal = {};
  tonal.subbass = function (c) {
    const w = writer(c), n = samplesFor(c, c.dur + 0.1), sr = c.sr, g = amp(c.vel);
    let ph = 0;
    for (let i = 0; i < n; i++) {
      const t = i / sr; ph += c.f / sr;
      const x = sin(TAU * ph) + 0.18 * sin(2 * TAU * ph);
      w(i, tanh(1.3 * x) * adsr(t, c.dur, 0.006, 0.1, 0.9, 0.08) * g);
    }
  };
  tonal.synthbass = function (c) {
    const w = writer(c), n = samplesFor(c, c.dur + 0.08), sr = c.sr, g = amp(c.vel);
    const lp = new SVF();
    let p1 = c.rng(), p2 = c.rng();
    const dt1 = c.f / sr, dt2 = c.f / 2 / sr;
    for (let i = 0; i < n; i++) {
      const t = i / sr;
      if ((i & 15) === 0) lp.setup(110 + (700 + 2400 * c.vel) * exp(-t * 9), 1.1, sr);
      p1 += dt1; p1 -= Math.floor(p1); p2 += dt2; p2 -= Math.floor(p2);
      const x = saw(p1, dt1) * 0.75 + square(p2, dt2) * 0.3;
      w(i, tanh(1.2 * lp.tick(x)) * adsr(t, c.dur, 0.003, 0.2, 0.7, 0.06) * g);
    }
  };
  tonal.reese = function (c) {
    const w = writer(c), n = samplesFor(c, c.dur + 0.12), sr = c.sr, g = amp(c.vel);
    const lp = new SVF();
    let a = c.rng(), b = c.rng(), s = 0;
    const da = c.f * cents(-9) / sr, db = c.f * cents(9) / sr;
    for (let i = 0; i < n; i++) {
      const t = i / sr;
      if ((i & 31) === 0) lp.setup(420 + 260 * sin(TAU * 0.35 * t), 1.3, sr);
      a += da; a -= Math.floor(a); b += db; b -= Math.floor(b); s += c.f / sr;
      const x = (saw(a, da) + saw(b, db)) * 0.5 + sin(TAU * s) * 0.6;
      w(i, tanh(1.4 * lp.tick(x)) * adsr(t, c.dur, 0.01, 0.1, 0.9, 0.12) * g);
    }
  };
  tonal.fmbass = function (c) {
    const w = writer(c), n = samplesFor(c, c.dur + 0.08), sr = c.sr, g = amp(c.vel);
    for (let i = 0; i < n; i++) {
      const t = i / sr;
      const idx = 2.6 * exp(-t * 8) * c.vel + 0.35;
      w(i, sin(TAU * c.f * t + idx * sin(TAU * c.f * t)) * adsr(t, c.dur, 0.002, 0.25, 0.6, 0.06) * g);
    }
  };
  tonal.bass808 = function (c) {
    const w = writer(c), n = samplesFor(c, c.dur + 0.25), sr = c.sr, g = amp(c.vel);
    const glide = c.note.glide || 0;
    let ph = 0;
    for (let i = 0; i < n; i++) {
      const t = i / sr;
      const bend = glide ? Math.pow(2, glide / 12 * Math.min(1, Math.max(0, (t - c.dur * 0.6) / 0.12))) : 1;
      ph += c.f * bend * (1 + 0.9 * exp(-t * 30)) / sr;
      w(i, tanh(2.2 * sin(TAU * ph)) * 0.8 * adsr(t, c.dur, 0.002, 0.4, 0.7, 0.2) * g);
    }
  };
  tonal.pluckbass = function (c) { karplus(c, 0.45, 1.4, 0.35); tonal.subbass(Object.assign({}, c, { vel: c.vel * 0.55, dur: Math.min(c.dur, 0.4) })); };

  // ---------------------------------------------------------------- Karplus-Strong family
  function karplus(c, bright, decaySec, level, opts) {
    const o = opts || {};
    const w = writer(c), sr = c.sr, g = amp(c.vel) * level;
    const ring = o.ring === undefined ? 0.6 : o.ring; // seconds after note-off before damping
    const n = samplesFor(c, Math.min(c.dur + ring + 0.3, decaySec * 1.6 + 0.2));
    const N = sr / c.f - 0.5;
    const size = Math.ceil(N) + 3;
    const buf = new Float32Array(size);
    let lpn = 0;
    const b = 0.08 + 0.9 * bright * (0.6 + 0.4 * c.vel);
    for (let i = 0; i < size; i++) { lpn += b * ((c.rng() * 2 - 1) - lpn); buf[i] = lpn; }
    let wi = size - 1, last = 0;
    const loss = Math.pow(10, -3 / (c.f * decaySec));
    const body = o.body ? new SVF() : null; if (body) body.setup(o.body, 1.2, sr);
    const trem = o.tremolo || 0;
    for (let i = 0; i < n; i++) {
      const t = i / sr;
      const rp = wi - N;
      const i0 = Math.floor(rp), fr = rp - i0;
      const a = buf[((i0 % size) + size) % size], bb = buf[(((i0 + 1) % size) + size) % size];
      const y = a + (bb - a) * fr;
      const damp = t > c.dur + ring ? 0.94 : 1;
      buf[((wi % size) + size) % size] = 0.5 * (y + last) * loss * damp;
      last = y;
      wi++;
      let out = y;
      if (body) out = out * 0.75 + body.tick(y) * 1.2;
      if (trem) out *= 1 - trem * (0.5 + 0.5 * sin(TAU * 6.5 * t));
      const fade = t > c.dur + ring ? Math.max(0, 1 - (t - c.dur - ring) / 0.3) : 1;
      w(i, out * g * fade * Math.min(1, t / 0.0015));
    }
  }
  tonal.pluck = function (c) { karplus(c, 0.75, 2.4, 1, { ring: 1.2 }); };
  tonal.harp = function (c) { karplus(c, 0.55, 3.2, 1, { ring: 2.5 }); };
  tonal.guitar = function (c) { karplus(c, 0.5, 2.2, 1, { ring: 0.05, body: 210 }); };
  tonal.tremguitar = function (c) { karplus(c, 0.55, 3.5, 1, { ring: 1.5, body: 240, tremolo: 0.55 }); };
  tonal.pizz = function (c) { karplus(c, 0.4, 0.7, 1, { ring: 0.2, body: 300 }); };

  // ---------------------------------------------------------------- keys and mallets
  tonal.epiano = function (c) {
    const w = writer(c), sr = c.sr, n = samplesFor(c, Math.min(c.dur, 5) + 0.35), g = amp(c.vel);
    const ph0 = c.rng() * TAU;
    for (let i = 0; i < n; i++) {
      const t = i / sr;
      const idx = 1.6 * exp(-t * 2.4) * c.vel + 0.25;
      const x = sin(TAU * c.f * t + idx * sin(TAU * c.f * t)) + 0.09 * sin(TAU * c.f * 14 * t) * exp(-t * 14);
      const e = exp(-t * 0.9) * (t > c.dur ? exp(-(t - c.dur) * 14) : 1) * Math.min(1, t / 0.002);
      const pan = 0.18 * sin(TAU * 4.2 * t + ph0);
      w(i, x * e * g * (1 - pan), x * e * g * (1 + pan));
    }
  };
  tonal.piano = function (c) {
    const w = writer(c), sr = c.sr, held = Math.min(c.dur, 6), n = samplesFor(c, held + 0.45), g = amp(c.vel);
    const P = 9, B = 0.0004, pitchK = Math.pow(c.f / 262, 0.45);
    const freqs = [], amps = [], decays = [];
    for (let k = 1; k <= P; k++) {
      freqs.push(k * c.f * Math.sqrt(1 + B * k * k));
      amps.push(Math.pow(k, -1.15) * Math.pow(c.vel, (k - 1) / 5));
      decays.push((0.45 + 0.28 * k) * pitchK);
    }
    const lp = new SVF(); lp.setup(2500, 0.7, sr);
    const det = cents(1.6);
    for (let i = 0; i < n; i++) {
      const t = i / sr;
      if (freqs[0] * 2 > sr) break;
      let l = 0, r = 0;
      for (let k = 0; k < P; k++) {
        if (freqs[k] > sr * 0.45) break;
        const e = amps[k] * exp(-t * decays[k]);
        l += sin(TAU * freqs[k] * t) * e;
        r += sin(TAU * freqs[k] * det * t) * e;
      }
      lp.tick(c.rng() * 2 - 1);
      const hammer = lp.low * exp(-t * 90) * 0.25;
      const rel = t > held ? exp(-(t - held) * 11) : 1;
      const att = Math.min(1, t / 0.0015);
      w(i, (l + hammer) * 0.55 * g * rel * att, (r + hammer) * 0.55 * g * rel * att);
    }
  };
  function mallet(c, partials, seconds) {
    const w = writer(c), sr = c.sr, n = samplesFor(c, seconds), g = amp(c.vel);
    const det = cents(c.note.detune || 0);
    for (let i = 0; i < n; i++) {
      const t = i / sr;
      let x = 0;
      for (const [ratio, a, d] of partials) { const fr = c.f * det * ratio; if (fr < sr * 0.45) x += sin(TAU * fr * t) * a * exp(-t * d); }
      w(i, x * g * Math.min(1, t / 0.0015));
    }
  }
  tonal.musicbox = function (c) { mallet(c, [[1, 1, 2.2], [4.2, 0.22, 6], [10.6, 0.05, 12]], Math.min(c.dur + 1.6, 3.2)); };
  tonal.marimba = function (c) { mallet(c, [[1, 1, 5], [3.93, 0.35, 14], [9.2, 0.07, 30]], 0.9); };
  tonal.celesta = function (c) { mallet(c, [[1, 1, 3], [2, 0.3, 4], [4, 0.1, 7], [6.1, 0.04, 12]], Math.min(c.dur + 1.4, 2.4)); };
  tonal.bell = function (c) {
    const w = writer(c), sr = c.sr, n = samplesFor(c, 4.5), g = amp(c.vel);
    for (let i = 0; i < n; i++) {
      const t = i / sr;
      const idx = 3.2 * exp(-t * 1.3);
      const x = sin(TAU * c.f * t + idx * sin(TAU * c.f * 3.5 * t)) * exp(-t * 0.8) + 0.25 * sin(TAU * c.f * 2.76 * t) * exp(-t * 1.4);
      w(i, x * 0.7 * g * Math.min(1, t / 0.002));
    }
  };
  tonal.organ = function (c) {
    const w = writer(c), sr = c.sr, n = samplesFor(c, c.dur + 0.1), g = amp(c.vel);
    const bars = [[0.5, 0.5], [1, 1], [1.5, 0.55], [2, 0.5], [4, 0.22]];
    for (let i = 0; i < n; i++) {
      const t = i / sr;
      let x = 0;
      for (const [r, a] of bars) x += sin(TAU * c.f * r * t) * a;
      const les = 0.12 * sin(TAU * 5.8 * t);
      const e = adsr(t, c.dur, 0.012, 0.01, 1, 0.08) * 0.4 * g;
      w(i, x * e * (1 - les), x * e * (1 + les));
    }
  };

  // ---------------------------------------------------------------- strings, choir, pads
  function sawStack(c, opts) {
    const o = opts;
    const w = writer(c), sr = c.sr, n = samplesFor(c, c.dur + o.r + 0.05), g = amp(c.vel) * (o.level || 1);
    const detL = o.detune.map((d) => c.f * cents(d) / sr), detR = o.detune.map((d, k) => c.f * cents(-d + (k % 2 ? 3 : -3)) / sr);
    const pl = detL.map(() => c.rng()), pr = detR.map(() => c.rng());
    const fl = new SVF(), fr = new SVF();
    const attack = Math.min(o.a, Math.max(0.005, c.dur * 0.4));
    const vibPh = c.rng() * TAU;
    const tremPh = c.rng() * TAU;
    const vibDepth = o.vib ? cents(o.vib) - 1 : 0;
    for (let i = 0; i < n; i++) {
      const t = i / sr;
      if ((i & 31) === 0) {
        let cut = o.cutoff(t);
        if (o.lfo) cut *= 1 + o.lfo * sin(TAU * 0.11 * t + vibPh);
        fl.setup(cut, o.q || 0.7, sr); fr.setup(cut * 1.03, o.q || 0.7, sr);
      }
      const vib = o.vib ? 1 + vibDepth * sin(TAU * 5.2 * t + vibPh) * Math.min(1, Math.max(0, (t - 0.2) / 0.4)) : 1;
      let l = 0, r = 0;
      for (let k = 0; k < pl.length; k++) {
        const dl = detL[k] * vib, dr = detR[k] * vib;
        pl[k] += dl; pl[k] -= Math.floor(pl[k]); pr[k] += dr; pr[k] -= Math.floor(pr[k]);
        l += o.wave === 'tri' ? triangle(pl[k]) : saw(pl[k], dl);
        r += o.wave === 'tri' ? triangle(pr[k]) : saw(pr[k], dr);
      }
      l = fl.tick(l / pl.length); r = fr.tick(r / pr.length);
      let e = adsr(t, c.dur, attack, o.d || 0.3, o.s === undefined ? 0.85 : o.s, o.r);
      if (o.trem) e *= 1 - o.trem * (0.5 + 0.5 * sin(TAU * 13 * t + tremPh));
      if (c.note.sfz) e *= 1 + 1.4 * exp(-t * 7);
      w(i, l * e * g * 1.6, r * e * g * 1.6);
    }
  }
  tonal.strings = function (c) { sawStack(c, { detune: [-8, 0, 8], a: 0.28, r: 0.5, vib: 9, cutoff: () => 1300 + 2000 * c.vel }); };
  tonal.tremolo = function (c) { sawStack(c, { detune: [-12, -3, 5, 13], a: 0.06, r: 0.4, vib: 6, trem: 0.55, cutoff: () => 1800 + 2400 * c.vel }); };
  tonal.spiccato = function (c) {
    sawStack(Object.assign({}, c, { dur: Math.min(c.dur, 0.12) }), { detune: [-6, 6], a: 0.004, d: 0.08, s: 0.35, r: 0.09, cutoff: (t) => 700 + 3800 * c.vel * exp(-t * 18), q: 0.9, level: 1.2 });
  };
  tonal.pad = function (c) { sawStack(c, { detune: [-18, -11, -5, 0, 5, 11, 18], a: 0.7, r: 1.4, cutoff: () => 1900 + 900 * c.vel, lfo: 0.25 }); };
  tonal.warmpad = function (c) { sawStack(c, { detune: [-7, 0, 7], wave: 'tri', a: 0.9, r: 1.6, cutoff: () => 1100, lfo: 0.2, level: 1.3 }); };
  tonal.darkpad = function (c) { sawStack(c, { detune: [-14, -4, 6, 15], a: 1.2, r: 2.0, cutoff: () => 650, lfo: 0.35 }); };
  tonal.drone = function (c) {
    const w = writer(c), sr = c.sr, n = samplesFor(c, c.dur + 2), g = amp(c.vel);
    const ratios = [1, cents(6), cents(-7), 2];
    const ph = ratios.map(() => c.rng());
    const fl = new SVF(), fr = new SVF(), nf = new SVF();
    nf.setup(380, 0.8, sr);
    const lfoPh = c.rng() * TAU;
    for (let i = 0; i < n; i++) {
      const t = i / sr;
      if ((i & 63) === 0) { const cut = 230 + 420 * (0.5 + 0.5 * sin(TAU * 0.07 * t + lfoPh)); fl.setup(cut, 1.6, sr); fr.setup(cut * 1.1, 1.6, sr); }
      let x = 0;
      for (let k = 0; k < 4; k++) { const d = c.f * ratios[k] / sr; ph[k] += d; ph[k] -= Math.floor(ph[k]); x += k === 3 ? saw(ph[k], d) * 0.35 : saw(ph[k], d); }
      nf.tick(c.rng() * 2 - 1);
      const e = adsr(t, c.dur, 2.0, 0.1, 1, 2.0) * g;
      w(i, (fl.tick(x) + nf.low * 0.15) * e * 0.7, (fr.tick(x) + nf.low * 0.15) * e * 0.7);
    }
  };
  tonal.choir = function (c) {
    const w = writer(c), sr = c.sr, n = samplesFor(c, c.dur + 0.7), g = amp(c.vel);
    const forms = [[730, 7, 1], [1090, 9, 0.5], [2440, 11, 0.22]];
    const fl = forms.map(([f, q]) => { const s = new SVF(); s.setup(f, q, sr); return s; });
    const fr = forms.map(([f, q]) => { const s = new SVF(); s.setup(f * 1.02, q, sr); return s; });
    let a = c.rng(), b = c.rng(), d2 = c.rng();
    const vph = c.rng() * TAU;
    for (let i = 0; i < n; i++) {
      const t = i / sr;
      const vib = 1 + VIB14 * sin(TAU * 5.4 * t + vph);
      const da = c.f * vib / sr, db = c.f * UP7 * vib / sr, dc = c.f * DOWN6 * vib / sr;
      a += da; a -= Math.floor(a); b += db; b -= Math.floor(b); d2 += dc; d2 -= Math.floor(d2);
      const src = saw(a, da) + saw(b, db) + saw(d2, dc) + (c.rng() * 2 - 1) * 0.15;
      let l = 0, r = 0;
      for (let k = 0; k < 3; k++) { fl[k].tick(src); fr[k].tick(src); l += fl[k].band * forms[k][2]; r += fr[k].band * forms[k][2]; }
      const e = adsr(t, c.dur, 0.35, 0.2, 0.9, 0.6) * g * 1.4;
      w(i, l * e, r * e);
    }
  };

  // ---------------------------------------------------------------- brass
  function brassVoice(c, o) {
    const w = writer(c), sr = c.sr, n = samplesFor(c, c.dur + o.r), g = amp(c.vel);
    const lp = new SVF();
    const det = [cents(-5), cents(5), 0.5];
    const ph = det.map(() => c.rng());
    const pm = pitchMod(c); let pmv = 1;
    for (let i = 0; i < n; i++) {
      const t = i / sr;
      if ((i & 15) === 0) {
        const open = (1 - exp(-t * o.open)) * (0.72 + 0.28 * exp(-t * 3));
        lp.setup(o.base + (o.range * c.vel) * open * (t > c.dur ? exp(-(t - c.dur) * 6) : 1), 0.8, sr);
      }
      if ((i & 15) === 0 && pm) pmv = pm(t);
      const scoop = Math.pow(2, -o.scoop / 1200 * exp(-t * 25)) * pmv;
      let x = 0;
      for (let k = 0; k < 3; k++) { const d = c.f * det[k] * scoop / sr; ph[k] += d; ph[k] -= Math.floor(ph[k]); x += k === 2 ? square(ph[k], d) * o.sub : saw(ph[k], d) * 0.6; }
      const y = tanh(o.drive * lp.tick(x)) / Math.min(o.drive, 1.6);
      w(i, y * adsr(t, c.dur, o.a, 0.3, 0.8, o.r) * g);
    }
  }
  tonal.brass = function (c) { brassVoice(c, { base: 280, range: 3600, open: 22, scoop: 35, a: 0.03, r: 0.25, drive: 1.4, sub: 0.3 }); };
  tonal.horn = function (c) { brassVoice(c, { base: 250, range: 1500, open: 9, scoop: 20, a: 0.08, r: 0.35, drive: 1.1, sub: 0.2 }); };
  tonal.braam = function (c) { brassVoice(c, { base: 140, range: 1700, open: 3.5, scoop: 60, a: 0.04, r: 1.3, drive: 3.2, sub: 0.7 }); };

  // ---------------------------------------------------------------- synth leads and plucks
  tonal.arp = function (c) {
    const w = writer(c), sr = c.sr, held = Math.min(c.dur, 0.4), n = samplesFor(c, held + 0.15), g = amp(c.vel);
    const lp = new SVF();
    let a = c.rng(), b = c.rng();
    const da = c.f / sr, db = c.f * cents(7) / sr;
    for (let i = 0; i < n; i++) {
      const t = i / sr;
      if ((i & 15) === 0) lp.setup(280 + 4200 * c.vel * exp(-t * 16), 2.2, sr);
      a += da; a -= Math.floor(a); b += db; b -= Math.floor(b);
      const x = saw(a, da) * 0.6 + square(b, db) * 0.4;
      w(i, lp.tick(x) * exp(-t * 6) * adsr(t, held, 0.002, 0.05, 1, 0.08) * g);
    }
  };
  tonal.lead = function (c) {
    const w = writer(c), sr = c.sr, n = samplesFor(c, c.dur + 0.15), g = amp(c.vel);
    const pm = pitchMod(c); let pmv = 1;
    const lp = new SVF();
    let a = c.rng(), b = c.rng();
    for (let i = 0; i < n; i++) {
      const t = i / sr;
      if ((i & 15) === 0) lp.setup(2400 + 1600 * c.vel, 0.8, sr);
      if ((i & 15) === 0 && pm) pmv = pm(t);
      const vib = (1 + VIB18 * sin(TAU * 5.5 * t) * Math.min(1, Math.max(0, (t - 0.25) / 0.3))) * pmv;
      const da = c.f * vib * DOWN4 / sr, db = c.f * vib * UP4 / sr;
      a += da; a -= Math.floor(a); b += db; b -= Math.floor(b);
      const x = saw(a, da) * 0.6 + square(b, db) * 0.35;
      w(i, tanh(1.3 * lp.tick(x)) * adsr(t, c.dur, 0.012, 0.2, 0.85, 0.12) * g);
    }
  };
  tonal.sqlead = function (c) { // chiptune pulse
    const w = writer(c), sr = c.sr, n = samplesFor(c, c.dur + 0.04), g = amp(c.vel);
    const pm = pitchMod(c); let pmv = 1;
    let a = c.rng();
    for (let i = 0; i < n; i++) {
      const t = i / sr;
      if ((i & 15) === 0 && pm) pmv = pm(t);
      const vib = (1 + VIB25 * sin(TAU * 6 * t) * Math.min(1, Math.max(0, (t - 0.18) / 0.2))) * pmv;
      const d = c.f * vib / sr;
      a += d; a -= Math.floor(a);
      w(i, square(a, d, 0.25) * 0.5 * adsr(t, c.dur, 0.002, 0.08, 0.8, 0.03) * g);
    }
  };
  function breathy(c, o) {
    const w = writer(c), sr = c.sr, n = samplesFor(c, c.dur + o.r), g = amp(c.vel);
    const bp = new SVF(); bp.setup(c.f * 2, 12, sr);
    const vibDepth = cents(o.vib) - 1;
    const pm = pitchMod(c); let pmv = 1;
    let ph = 0;
    for (let i = 0; i < n; i++) {
      const t = i / sr;
      const vib = 1 + vibDepth * sin(TAU * 6 * t) * Math.min(1, Math.max(0, (t - 0.15) / 0.25));
      const scoop = Math.pow(2, -50 / 1200 * exp(-t * 30));
      if ((i & 15) === 0 && pm) pmv = pm(t);
      ph += c.f * vib * scoop * pmv / sr;
      bp.tick(c.rng() * 2 - 1);
      const x = sin(TAU * ph) + o.h2 * sin(2 * TAU * ph) + o.h3 * sin(3 * TAU * ph) + bp.band * o.breath;
      w(i, x * adsr(t, c.dur, o.a, 0.1, 0.9, o.r) * 0.6 * g);
    }
  }
  tonal.whistle = function (c) { breathy(c, { vib: 22, h2: 0.06, h3: 0, breath: 0.6, a: 0.05, r: 0.12 }); };
  tonal.flute = function (c) { breathy(c, { vib: 12, h2: 0.18, h3: 0.08, breath: 1.4, a: 0.09, r: 0.18 }); };
  tonal.glass = function (c) {
    const w = writer(c), sr = c.sr, n = samplesFor(c, c.dur + 1.8), g = amp(c.vel);
    for (let i = 0; i < n; i++) {
      const t = i / sr;
      const x = sin(TAU * c.f * t + 0.6 * sin(TAU * c.f * 4 * t)) + 0.3 * sin(TAU * c.f * 2 * t);
      const pan = 0.3 * sin(TAU * 0.3 * t);
      const e = adsr(t, c.dur, 1.0, 0.2, 0.9, 1.8) * 0.5 * g;
      w(i, x * e * (1 - pan), x * e * (1 + pan));
    }
  };

  // ---------------------------------------------------------------- fx
  tonal.impact = function (c) {
    const w = writer(c), sr = c.sr, n = samplesFor(c, 3), g = amp(c.vel);
    const lp = new SVF();
    let ph = 0;
    for (let i = 0; i < n; i++) {
      const t = i / sr;
      if ((i & 15) === 0) lp.setup(120 + 500 * exp(-t * 10), 0.8, sr); // a dark thud, no hiss
      ph += c.f * (1 + 1.5 * exp(-t * 9)) / sr;
      lp.tick(c.rng() * 2 - 1);
      const x = sin(TAU * ph) * exp(-t * 1.6) + lp.low * exp(-t * 8) * 0.6;
      w(i, tanh(2.2 * x) * 0.85 * g);
    }
  };

  // Drum voices are also playable as instruments (fx parts, one-shots).
  const INSTRUMENTS = Object.assign({}, tonal);
  for (const k of Object.keys(drums)) if (drums[k]) INSTRUMENTS[k] = drums[k];
  INSTRUMENTS.fx = null;

  const DRUM_VOICES = Object.keys(drums).filter((k) => drums[k]);

  Object.assign(M, { INSTRUMENTS, DRUM_VOICES, drums, pitchMod });
  M.INST_KIT = { writer, samplesFor, adsr, amp, cents, tonal, INSTRUMENTS };
})(typeof MusicEngine !== 'undefined' ? MusicEngine : (globalThis.MusicEngine = globalThis.MusicEngine || {}));
