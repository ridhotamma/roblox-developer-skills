// DSP building blocks: band-limited oscillators, a TPT state-variable filter, Freeverb, a
// ping-pong delay, sidechain pump, and an ITU-R BS.1770 loudness meter (LUFS) with true-ish peak.
(function (M) {
  'use strict';
  const TAU = Math.PI * 2;

  // PolyBLEP: removes most aliasing from naive saw / square at negligible cost.
  function polyblep(t, dt) {
    if (t < dt) { t /= dt; return t + t - t * t - 1; }
    if (t > 1 - dt) { t = (t - 1) / dt; return t * t + t + t + 1; }
    return 0;
  }
  function saw(phase, dt) { return 2 * phase - 1 - polyblep(phase, dt); }
  function square(phase, dt, duty) {
    const d = duty || 0.5;
    let v = phase < d ? 1 : -1;
    v += polyblep(phase, dt);
    v -= polyblep((phase - d + 1) % 1, dt);
    return v;
  }
  function triangle(phase) { return 1 - 4 * Math.abs(phase - 0.5); }

  // Zavalishin TPT state-variable filter. Call setup() when cutoff changes (every ~16-32 samples).
  function SVF() {
    this.ic1 = 0; this.ic2 = 0; this.g = 0; this.k = 1; this.a1 = 0; this.a2 = 0; this.a3 = 0;
  }
  SVF.prototype.setup = function (cutoff, q, sr) {
    const fc = Math.min(Math.max(cutoff, 10), sr * 0.45);
    this.g = Math.tan(Math.PI * fc / sr);
    this.k = 1 / Math.max(q, 0.05);
    this.a1 = 1 / (1 + this.g * (this.g + this.k));
    this.a2 = this.g * this.a1;
    this.a3 = this.g * this.a2;
  };
  // returns [low, band, high] via fields to avoid allocation
  SVF.prototype.tick = function (x) {
    const v3 = x - this.ic2;
    const v1 = this.a1 * this.ic1 + this.a2 * v3;
    const v2 = this.ic2 + this.a2 * this.ic1 + this.a3 * v3;
    this.ic1 = 2 * v1 - this.ic1;
    this.ic2 = 2 * v2 - this.ic2;
    this.low = v2; this.band = v1; this.high = x - this.k * v1 - v2;
    return v2;
  };

  // ---------------------------------------------------------------- Freeverb (Jezar), stereo
  const COMBS = [1116, 1188, 1277, 1356, 1422, 1491, 1557, 1617];
  const ALLPASSES = [556, 441, 341, 225];
  function Reverb(sr, size, damp) {
    const s = sr / 44100;
    const mk = (lens) => lens.map((len) => new Float32Array(Math.max(1, Math.round(len * s))));
    this.combL = mk(COMBS); this.combR = mk(COMBS.map((c) => c + 23));
    this.apL = mk(ALLPASSES); this.apR = mk(ALLPASSES.map((c) => c + 23));
    this.feedback = 0.7 + 0.28 * Math.min(Math.max(size === undefined ? 0.75 : size, 0), 1);
    this.damp = 0.4 * (damp === undefined ? 0.5 : damp);
  }
  // Adds the wet signal into outL / outR. Tight typed-array loops: this is the hot path.
  Reverb.prototype.process = function (inL, inR, outL, outR, wet) {
    const fb = this.feedback, d1 = this.damp, d2 = 1 - this.damp;
    const g = 0.045 * wet;
    const n = inL.length;
    const x = new Float32Array(n);
    for (let i = 0; i < n; i++) x[i] = (inL[i] + inR[i]) * g;
    const side = (combs, aps, out) => {
      const acc = new Float32Array(n);
      for (const buf of combs) {
        const len = buf.length;
        let idx = 0, store = 0;
        for (let i = 0; i < n; i++) {
          const y = buf[idx];
          store = y * d2 + store * d1;
          buf[idx] = x[i] + store * fb;
          if (++idx === len) idx = 0;
          acc[i] += y;
        }
      }
      for (const buf of aps) {
        const len = buf.length;
        let idx = 0;
        for (let i = 0; i < n; i++) {
          const b = buf[idx];
          const v = acc[i];
          buf[idx] = v + b * 0.5;
          if (++idx === len) idx = 0;
          acc[i] = b - v;
        }
      }
      for (let i = 0; i < n; i++) out[i] += acc[i];
    };
    side(this.combL, this.apL, outL);
    side(this.combR, this.apR, outR);
  };

  // 2nd-order high-pass (rumble / DC removal), in place.
  function highpass(L, R, cutoff, sr) {
    for (const ch of [L, R]) {
      const f = new SVF(); f.setup(cutoff, 0.707, sr);
      for (let i = 0; i < ch.length; i++) { f.tick(ch[i]); ch[i] = f.high; }
    }
  }

  // Ping-pong delay with a lowpass in the feedback path (darker repeats, like tape).
  function processDelay(inL, inR, outL, outR, delaySamples, feedback, mix) {
    const n = inL.length;
    const bufL = new Float32Array(delaySamples), bufR = new Float32Array(delaySamples);
    let i = 0, lpL = 0, lpR = 0;
    for (let k = 0; k < n; k++) {
      const dl = bufL[i], dr = bufR[i];
      lpL += 0.35 * (dl - lpL); lpR += 0.35 * (dr - lpR);
      bufL[i] = (inL[k] + inR[k]) * 0.5 + lpR * feedback; // cross-feed -> ping-pong
      bufR[i] = lpL * feedback;
      outL[k] += dl * mix; outR[k] += dr * mix;
      if (++i >= delaySamples) i = 0;
    }
  }

  // ---------------------------------------------------------------- loudness (BS.1770-4)
  function biquad(b0, b1, b2, a1, a2) { return { b0, b1, b2, a1, a2, x1: 0, x2: 0, y1: 0, y2: 0 }; }
  function bqTick(f, x) {
    const y = f.b0 * x + f.b1 * f.x1 + f.b2 * f.x2 - f.a1 * f.y1 - f.a2 * f.y2;
    f.x2 = f.x1; f.x1 = x; f.y2 = f.y1; f.y1 = y;
    return y;
  }
  // K-weighting for any sample rate (the same parameters pyloudnorm uses).
  function kWeighting(sr) {
    const shelf = (() => {
      const G = 4.0, Q = 1 / Math.SQRT2, fc = 1500;
      const A = Math.pow(10, G / 40), w0 = TAU * fc / sr, alpha = Math.sin(w0) / (2 * Q), c = Math.cos(w0);
      const a0 = (A + 1) - (A - 1) * c + 2 * Math.sqrt(A) * alpha;
      return biquad(A * ((A + 1) + (A - 1) * c + 2 * Math.sqrt(A) * alpha) / a0, -2 * A * ((A - 1) + (A + 1) * c) / a0,
        A * ((A + 1) + (A - 1) * c - 2 * Math.sqrt(A) * alpha) / a0, 2 * ((A - 1) - (A + 1) * c) / a0,
        ((A + 1) - (A - 1) * c - 2 * Math.sqrt(A) * alpha) / a0);
    })();
    const hp = (() => {
      const Q = 0.5, fc = 38, w0 = TAU * fc / sr, alpha = Math.sin(w0) / (2 * Q), c = Math.cos(w0), a0 = 1 + alpha;
      return biquad((1 + c) / 2 / a0, -(1 + c) / a0, (1 + c) / 2 / a0, -2 * c / a0, (1 - alpha) / a0);
    })();
    return [shelf, hp];
  }

  // Integrated loudness in LUFS (gated). Returns -Infinity for silence.
  function loudness(L, R, sr) {
    const block = Math.round(0.4 * sr), hop = Math.round(0.1 * sr);
    const n = L.length;
    const fl = kWeighting(sr), fr = kWeighting(sr);
    const sq = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      const a = bqTick(fl[1], bqTick(fl[0], L[i]));
      const b = bqTick(fr[1], bqTick(fr[0], R ? R[i] : L[i]));
      sq[i] = a * a + b * b;
    }
    // prefix sums for fast block means
    const pre = new Float64Array(n + 1);
    for (let i = 0; i < n; i++) pre[i + 1] = pre[i] + sq[i];
    const blocks = [];
    if (n < block) { if (n > 0) blocks.push(pre[n] / n); }
    else for (let s = 0; s + block <= n; s += hop) blocks.push((pre[s + block] - pre[s]) / block);
    const lufs = (z) => -0.691 + 10 * Math.log10(z);
    const abs = blocks.filter((z) => z > 0 && lufs(z) > -70);
    if (!abs.length) return -Infinity;
    const mean1 = abs.reduce((a, z) => a + z, 0) / abs.length;
    const rel = lufs(mean1) - 10;
    const gated = abs.filter((z) => lufs(z) > rel);
    return lufs(gated.reduce((a, z) => a + z, 0) / gated.length);
  }

  // Sample peak plus midpoint inter-sample peaks: a close-enough true-peak proxy.
  function peak(L, R) {
    let p = 0;
    for (const ch of R ? [L, R] : [L]) {
      for (let i = 0; i < ch.length; i++) {
        const a = Math.abs(ch[i]);
        if (a > p) p = a;
        if (i + 1 < ch.length) {
          // inter-sample peak at the midpoint, cubic (4-point) interpolation
          const m = Math.abs((-(ch[i - 1] || 0) + 9 * ch[i] + 9 * ch[i + 1] - (ch[i + 2] || 0)) / 16);
          if (m > p) p = m;
        }
      }
    }
    return p;
  }

  const dbToGain = (db) => Math.pow(10, db / 20);
  const gainToDb = (g) => 20 * Math.log10(Math.max(g, 1e-12));

  Object.assign(M, { TAU, polyblep, saw, square, triangle, SVF, Reverb, highpass, processDelay, loudness, peak, dbToGain, gainToDb });
})(typeof MusicEngine !== 'undefined' ? MusicEngine : (globalThis.MusicEngine = globalThis.MusicEngine || {}));
