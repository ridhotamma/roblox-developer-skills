// Music theory helpers: seeded randomness, keys and modes, roman-numeral chords, voicing.
// Shared by the Node CLI and the browser lab (every engine file adds to one MusicEngine object).
(function (M) {
  'use strict';

  // ---------------------------------------------------------------- seeded randomness
  // mulberry32: fast, good enough for music, identical in every JS engine.
  function rng(seed) {
    let a = (seed >>> 0) || 0x9e3779b9;
    const f = function () {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    f.range = (lo, hi) => lo + (hi - lo) * f();
    f.int = (lo, hi) => lo + Math.floor(f() * (hi - lo + 1));
    f.pick = (arr) => arr[Math.floor(f() * arr.length)];
    f.chance = (p) => f() < p;
    f.gauss = () => { let u = 0, v = 0; while (u === 0) u = f(); v = f(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); };
    return f;
  }

  // FNV-1a over the parts, so each stem / part gets its own stream: changing one part never
  // reshuffles the others.
  function hashSeed() {
    let h = 0x811c9dc5;
    for (const part of arguments) {
      const s = String(part);
      for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
      h ^= 0x2f; h = Math.imul(h, 0x01000193) >>> 0;
    }
    return h >>> 0;
  }

  // ---------------------------------------------------------------- keys and modes
  const PITCH_CLASS = { C: 0, 'C#': 1, Db: 1, D: 2, 'D#': 3, Eb: 3, E: 4, F: 5, 'F#': 6, Gb: 6, G: 7, 'G#': 8, Ab: 8, A: 9, 'A#': 10, Bb: 10, B: 11 };
  const NOTE_NAMES = ['C', 'C#', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B'];

  // Seven-note modes build the chords; the others are melody colours (`melodyScale`).
  const SCALES = {
    ionian: [0, 2, 4, 5, 7, 9, 11],
    major: [0, 2, 4, 5, 7, 9, 11],
    dorian: [0, 2, 3, 5, 7, 9, 10],
    phrygian: [0, 1, 3, 5, 7, 8, 10],
    lydian: [0, 2, 4, 6, 7, 9, 11],
    mixolydian: [0, 2, 4, 5, 7, 9, 10],
    aeolian: [0, 2, 3, 5, 7, 8, 10],
    minor: [0, 2, 3, 5, 7, 8, 10],
    locrian: [0, 1, 3, 5, 6, 8, 10],
    harmonic_minor: [0, 2, 3, 5, 7, 8, 11],
    melodic_minor: [0, 2, 3, 5, 7, 9, 11],
    phrygian_dominant: [0, 1, 4, 5, 7, 8, 10],
    hungarian_minor: [0, 2, 3, 6, 7, 8, 11],
    pentatonic_major: [0, 2, 4, 7, 9],
    pentatonic_minor: [0, 3, 5, 7, 10],
    blues: [0, 3, 5, 6, 7, 10],
    whole_tone: [0, 2, 4, 6, 8, 10],
    chromatic: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11],
  };

  function keyPitchClass(key) {
    const pc = PITCH_CLASS[key];
    if (pc === undefined) throw new Error(`unknown key '${key}'`);
    return pc;
  }

  function scaleOf(name) {
    const s = SCALES[name];
    if (!s) throw new Error(`unknown scale/mode '${name}'`);
    return s;
  }

  const midiToFreq = (m) => 440 * Math.pow(2, (m - 69) / 12);
  const noteName = (m) => NOTE_NAMES[((m % 12) + 12) % 12] + (Math.floor(m / 12) - 1);

  // All MIDI pitches of a scale between lo and hi (inclusive).
  function scalePitches(keyPc, scale, lo, hi) {
    const out = [];
    for (let m = lo; m <= hi; m++) if (scale.includes((((m - keyPc) % 12) + 12) % 12)) out.push(m);
    return out;
  }

  function nearestWithPc(pc, center) {
    let best = center, bestD = Infinity;
    for (let m = center - 6; m <= center + 6; m++) {
      if (((m % 12) + 12) % 12 === pc) { const d = Math.abs(m - center); if (d < bestD) { bestD = d; best = m; } }
    }
    return best;
  }

  // ---------------------------------------------------------------- chords
  const ROMAN = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII'];

  // Roman numerals are degrees of the cue's own mode: in A aeolian, VI = F major, VII = G major.
  // Case gives the quality (upper = major, lower = minor); b / # alter the root (bII, #iv°).
  // Suffixes: ° or dim, + or aug, sus2, sus4, 5 (power chord), 7, maj7, ø (half-diminished),
  // add9. "N" is shorthand for the Neapolitan bII. "-" means no chord (silence for harmony).
  function parseChord(sym, keyPc, mode) {
    if (sym === '-' || sym === 'N.C.') return { symbol: sym, root: null, pcs: [], intervals: [] };
    if (sym === 'N') sym = 'bII';
    const m = /^([b#]?)(VII|VI|IV|V|III|II|I|vii|vi|iv|v|iii|ii|i)(.*)$/.exec(sym);
    if (!m) throw new Error(`can't read chord '${sym}'`);
    const scale = scaleOf(mode);
    if (scale.length !== 7) throw new Error(`mode '${mode}' has ${scale.length} notes; chords need a 7-note mode`);
    const degree = ROMAN.indexOf(m[2].toUpperCase());
    const acc = m[1] === 'b' ? -1 : m[1] === '#' ? 1 : 0;
    const root = (keyPc + scale[degree] + acc + 12) % 12;
    const upper = m[2] === m[2].toUpperCase();
    const suffix = m[3];
    let intervals;
    if (/^(°|dim|o)/.test(suffix)) intervals = /7/.test(suffix) ? [0, 3, 6, 9] : [0, 3, 6];
    else if (/^ø/.test(suffix)) intervals = [0, 3, 6, 10];
    else if (/^(\+|aug)/.test(suffix)) intervals = [0, 4, 8];
    else if (/sus2/.test(suffix)) intervals = [0, 2, 7];
    else if (/sus4|sus/.test(suffix)) intervals = [0, 5, 7];
    else if (/^5/.test(suffix)) intervals = [0, 7];
    else intervals = upper ? [0, 4, 7] : [0, 3, 7];
    if (/maj7/.test(suffix)) intervals = intervals.concat([11]);
    else if (/7/.test(suffix) && intervals.length === 3) intervals = intervals.concat([10]);
    if (/add9|9/.test(suffix)) intervals = intervals.concat([14]);
    return { symbol: sym, root, intervals, pcs: intervals.map((i) => (root + i) % 12) };
  }

  // "i:2 VI VII" -> [{chord, start, length}] in beats, repeated to fill `bars`.
  // A chord without :n lasts one bar; :0.5 is half a bar.
  function parseProgression(text, keyPc, mode, beatsPerBar, bars) {
    const tokens = String(text).trim().split(/\s+/);
    const one = tokens.map((tok) => {
      const [sym, len] = tok.split(':');
      return { chord: parseChord(sym, keyPc, mode), bars: len ? Number(len) : 1 };
    });
    const total = bars * beatsPerBar;
    const out = [];
    let t = 0;
    for (let guard = 0; t < total - 1e-9 && guard < 4096; guard++) {
      const item = one[guard % one.length];
      const length = Math.min(item.bars * beatsPerBar, total - t);
      out.push({ chord: item.chord, start: t, length });
      t += length;
    }
    return out;
  }

  function chordAt(progression, beat) {
    for (const seg of progression) if (beat >= seg.start - 1e-9 && beat < seg.start + seg.length - 1e-9) return seg;
    return progression[progression.length - 1];
  }

  // Voice a chord near `center`, moving each voice as little as possible from `previous`.
  function voiceChord(chord, center, previous, voices) {
    if (!chord.root && chord.root !== 0) return [];
    const pcs = chord.pcs.slice();
    const want = voices || pcs.length;
    while (pcs.length < want) pcs.push(pcs[pcs.length % chord.pcs.length]);
    const out = [];
    const prev = previous && previous.length ? previous.slice().sort((a, b) => a - b) : null;
    pcs.slice(0, want).forEach((pc, i) => {
      const target = prev ? prev[Math.min(i, prev.length - 1)] : center - 5 + i * 4;
      let m = nearestWithPc(pc, target);
      while (out.includes(m)) m += 12;
      out.push(m);
    });
    out.sort((a, b) => a - b);
    // Keep the voicing inside about an octave and a half of the centre.
    while (out[out.length - 1] > center + 12) { out[out.length - 1] -= 12; out.sort((a, b) => a - b); }
    while (out[0] < center - 12) { out[0] += 12; out.sort((a, b) => a - b); }
    return out;
  }

  // Root (in the bass register) of a chord, near `center`.
  function rootNear(chord, center) {
    return nearestWithPc(chord.root, center);
  }

  // Chord tones from lo..hi ascending (for arpeggios and ostinatos).
  function chordTonesBetween(chord, lo, hi) {
    const out = [];
    for (let m = lo; m <= hi; m++) if (chord.pcs.includes(((m % 12) + 12) % 12)) out.push(m);
    return out;
  }

  Object.assign(M, {
    rng, hashSeed, PITCH_CLASS, NOTE_NAMES, SCALES, keyPitchClass, scaleOf, midiToFreq, noteName,
    scalePitches, nearestWithPc, parseChord, parseProgression, chordAt, voiceChord, rootNear, chordTonesBetween,
  });
})(typeof MusicEngine !== 'undefined' ? MusicEngine : (globalThis.MusicEngine = globalThis.MusicEngine || {}));
