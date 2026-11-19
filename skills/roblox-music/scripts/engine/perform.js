// Performance: the difference between notes and music. After composition, every part is
// "played" once:
//
//   * Timing feel (preset `feel.groove`): laidback (snare and bass a touch late, the pocket of
//     blues, soul, lo-fi and funk), push (everything a hair early: punk, chases), straight or
//     tight. Plus small human variation (`feel.humanize`, 0-1; synths and sequencers get a
//     quarter of it, so they stay machine-tight).
//   * Dynamics: accents on strong beats for rhythm parts, small random velocity variation, and a
//     swell across each 4-bar phrase.
//   * Articulation on melodies and counterlines: vibrato on held notes, slides into notes after
//     a leap, and (guitars, harmonica) bends up into notes reached from below.
//
// Timing goes into `off` (beats), which the renderer applies and wraps around the loop point;
// note times stay on the grid, so MIDI stays editable and loops stay exactly the loop length.
(function (M) {
  'use strict';

  const SYNTH = ['arp', 'sqlead', 'synthbass', 'fmbass', 'bass808', 'reese', 'pluck', 'subbass'];
  const GROOVES = {
    straight: {},
    tight: {},
    laidback: { snare: 14, clap: 12, rim: 8, bass: 9, melody: 12, guitar: 5, hat: -2 },
    push: { snare: -3, kick: -2, bass: -4, guitar: -6, melody: -5, hat: -3, ride: -3 },
  };
  // Vibrato (cents) for instruments that don't already have their own.
  const VIB = { brass: 10, horn: 10, strings: 12, leadgtr: 28, bluesgtr: 28, cleangtr: 18, crunchgtr: 22, distgtr: 22, harmonica: 25, nylon: 12, acoustic: 10 };
  const SLIDERS = ['lead', 'sqlead', 'brass', 'horn', 'strings', 'whistle', 'flute', 'leadgtr', 'bluesgtr', 'cleangtr', 'crunchgtr', 'distgtr', 'harmonica', 'nylon', 'acoustic'];
  const BENDERS = ['leadgtr', 'bluesgtr', 'cleangtr', 'crunchgtr', 'distgtr', 'harmonica'];
  const ACCENTED = ['bass', 'arp', 'ostinato', 'guitar', 'strum', 'pulse', 'broken', 'stabs'];

  function perform(stems, ctx, preset) {
    const feel = Object.assign({ groove: 'straight', humanize: 0.5 }, preset.feel || {});
    const groove = GROOVES[feel.groove] || {};
    if (feel.groove === 'tight') feel.humanize = Math.min(feel.humanize, 0.15);
    const msToBeats = ctx.bpm / 60000;
    const bar = ctx.beatsPerBar;
    stems.forEach((stem) => stem.parts.forEach((part, pi) => {
      const r = M.rng(M.hashSeed(ctx.seed, 'perform', stem.name, pi));
      const def = part.def || {};
      const human = feel.humanize * (SYNTH.includes(part.inst) ? 0.25 : 1) * (def.humanize === undefined ? 1 : def.humanize);
      const roleKey = part.role === 'melody' || part.role === 'counter' ? 'melody' : part.role === 'bass' ? 'bass' : part.role === 'guitar' || part.role === 'strum' ? 'guitar' : null;
      for (const n of part.notes) {
        if (n.hold) continue;
        const drum = typeof n.p === 'string';
        const pos = ((n.t % bar) + bar) % bar;
        const onBar = pos < 1e-6;
        const onBeat = Math.abs(pos - Math.round(pos)) < 1e-6;
        // timing
        let ms = drum ? groove[n.p] || 0 : roleKey ? groove[roleKey] || 0 : 0;
        const sigma = drum ? (n.p === 'kick' ? 2.5 : 4) : roleKey === 'melody' ? 9 : 6;
        ms += Math.max(-2.5, Math.min(2.5, r.gauss())) * sigma * human * (onBar ? 0.5 : 1);
        if (part.role === 'fx' || part.role === 'pad' || part.role === 'drone' || part.role === 'cluster') ms = 0;
        if (ms) n.off = (n.off || 0) + Math.max(-25, Math.min(25, ms)) * msToBeats;
        // dynamics
        if (!drum && ACCENTED.includes(part.role)) {
          const acc = onBar ? 1 : onBeat ? (bar === 4 && Math.abs(pos - 2) < 1e-6 ? 0.95 : 0.9) : 0.84;
          n.v *= 1 - 0.5 * (1 - acc);
        }
        n.v *= 1 + (r() - 0.5) * 0.12 * human;
        if (part.role !== 'drums' && part.role !== 'fx' && ctx.bars >= 4) {
          const ph = (n.t % (4 * bar)) / (4 * bar);
          n.v *= 0.95 + 0.07 * Math.sin(Math.PI * ph);
        }
        n.v = Math.max(0.05, Math.min(1, n.v));
      }
      if ((part.role === 'melody' || part.role === 'counter') && !['licks', 'bells'].includes(def.style)) articulate(part, ctx, r, feel);
    }));
  }

  function articulate(part, ctx, r, feel) {
    const inst = part.inst;
    const notes = part.notes.filter((n) => typeof n.p === 'number').sort((a, b) => a.t - b.t);
    const slideOdds = feel.slides === undefined ? 0.3 : feel.slides;
    const bendOdds = feel.bends === undefined ? 0.3 : feel.bends;
    const scale = M.scalePitches(ctx.keyPc, ctx.melodyScale, 20, 110);
    notes.forEach((n, i) => {
      const prev = notes[i - 1];
      if (n.d >= 0.9 && VIB[inst]) n.vib = VIB[inst];
      if (!prev || prev.t + prev.d < n.t - 0.3) return; // after a rest: a clean attack
      const leap = n.p - prev.p;
      if (BENDERS.includes(inst) && leap > 0 && n.d >= 0.5 && r() < bendOdds) {
        const below = scale.filter((p) => p < n.p).pop();
        if (below !== undefined && n.p - below <= 2 && below > prev.p - 1) { n.bend = n.p - below; return; }
      }
      if (SLIDERS.includes(inst) && Math.abs(leap) >= 3 && r() < slideOdds) n.slide = Math.sign(leap) * Math.min(2, Math.abs(leap) - 1);
    });
  }

  Object.assign(M, { perform, GROOVES });
})(typeof MusicEngine !== 'undefined' ? MusicEngine : (globalThis.MusicEngine = globalThis.MusicEngine || {}));
