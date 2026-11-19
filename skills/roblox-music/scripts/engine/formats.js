// File formats: WAV (16-bit PCM), Standard MIDI File (type 1), a store-only ZIP, the cue
// manifest (JSON) and the Luau entry for MusicCues.luau.
(function (M) {
  'use strict';

  // ---------------------------------------------------------------- WAV
  function wav(L, R, sr) {
    const n = L.length, ch = R ? 2 : 1;
    const bytes = new Uint8Array(44 + n * ch * 2);
    const dv = new DataView(bytes.buffer);
    const str = (o, s) => { for (let i = 0; i < s.length; i++) bytes[o + i] = s.charCodeAt(i); };
    str(0, 'RIFF'); dv.setUint32(4, 36 + n * ch * 2, true); str(8, 'WAVE');
    str(12, 'fmt '); dv.setUint32(16, 16, true); dv.setUint16(20, 1, true); dv.setUint16(22, ch, true);
    dv.setUint32(24, sr, true); dv.setUint32(28, sr * ch * 2, true); dv.setUint16(32, ch * 2, true); dv.setUint16(34, 16, true);
    str(36, 'data'); dv.setUint32(40, n * ch * 2, true);
    // TPDF dither to 16 bits (seeded so output is reproducible)
    const r = M.rng(n);
    let o = 44;
    for (let i = 0; i < n; i++) {
      for (let c = 0; c < ch; c++) {
        const x = (c === 0 ? L[i] : R[i]) * 32767 + (r() - r());
        dv.setInt16(o, Math.max(-32768, Math.min(32767, Math.round(x))), true);
        o += 2;
      }
    }
    return bytes;
  }

  function readWav(bytes) {
    const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const tag = (o) => String.fromCharCode(bytes[o], bytes[o + 1], bytes[o + 2], bytes[o + 3]);
    if (tag(0) !== 'RIFF' || tag(8) !== 'WAVE') throw new Error('not a WAV file');
    let o = 12, ch = 0, sr = 0, bits = 0, data = null;
    while (o + 8 <= bytes.length) {
      const id = tag(o), size = dv.getUint32(o + 4, true);
      if (id === 'fmt ') { ch = dv.getUint16(o + 10, true); sr = dv.getUint32(o + 12, true); bits = dv.getUint16(o + 22, true); }
      if (id === 'data') data = { off: o + 8, size };
      o += 8 + size + (size & 1);
    }
    if (!data || bits !== 16) throw new Error('expected 16-bit PCM');
    const n = data.size / (2 * ch);
    const L = new Float32Array(n), R = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      L[i] = dv.getInt16(data.off + i * ch * 2, true) / 32768;
      R[i] = ch > 1 ? dv.getInt16(data.off + i * ch * 2 + 2, true) / 32768 : L[i];
    }
    return { sr, channels: ch, L, R };
  }

  // ---------------------------------------------------------------- MIDI
  // General MIDI programs, so the file opens with sensible sounds in any DAW.
  const GM = {
    subbass: 38, synthbass: 38, reese: 39, fmbass: 38, bass808: 38, pluckbass: 33,
    pluck: 46, harp: 46, guitar: 24, tremguitar: 27, pizz: 45,
    epiano: 4, piano: 0, musicbox: 10, marimba: 12, celesta: 8, bell: 14, organ: 19,
    strings: 48, tremolo: 44, spiccato: 48, pad: 90, warmpad: 89, darkpad: 94, drone: 95, choir: 52, glass: 92,
    brass: 61, horn: 60, braam: 57, arp: 81, lead: 81, sqlead: 80, whistle: 78, flute: 73,
    impact: 116,
    acoustic: 25, nylon: 24, cleangtr: 27, bluesgtr: 27, crunchgtr: 29, distgtr: 30, leadgtr: 30, ebass: 34, harmonica: 22,
  };
  const GM_DRUMS = { kick: 36, snare: 38, clap: 39, rim: 37, tick: 76, hat: 42, openhat: 46, ride: 51, shaker: 70, taiko: 35, kick808: 36 };
  const TOMS = [41, 45, 48];

  function vlq(n) {
    const out = [n & 0x7f];
    while ((n >>= 7)) out.unshift((n & 0x7f) | 0x80);
    return out;
  }

  function midi(cue) {
    const PPQ = 480;
    const tracks = [];
    const meta = [];
    const usPerBeat = Math.round(60000000 / cue.bpm);
    const text = (type, s) => { const b = Array.from(unescape(encodeURIComponent(s))).map((c) => c.charCodeAt(0)); return [0xff, type, ...vlq(b.length), ...b]; };
    meta.push({ t: 0, d: text(0x03, `${cue.title || cue.name} (${cue.key} ${cue.mode}, ${cue.bpm} bpm)`) });
    meta.push({ t: 0, d: [0xff, 0x51, 0x03, (usPerBeat >> 16) & 255, (usPerBeat >> 8) & 255, usPerBeat & 255] });
    meta.push({ t: 0, d: [0xff, 0x58, 0x04, cue.beatsPerBar, 2, 24, 8] });
    meta.push({ t: 0, d: text(0x06, 'Loop start') });
    meta.push({ t: cue.bars * cue.beatsPerBar * PPQ, d: text(0x06, 'Loop end') });
    tracks.push(meta);
    let channel = 0;
    const nextChannel = () => { const c = channel; channel = (channel + 1) % 16; if (channel === 9) channel = 10; return c; };
    for (const stem of cue.stems) {
      stem.parts.forEach((part, pi) => {
        const isDrum = part.notes.some((n) => typeof n.p === 'string');
        const ch = isDrum ? 9 : nextChannel();
        const ev = [{ t: 0, d: text(0x03, `${stem.name}: ${part.role} (${part.inst})`) }];
        if (!isDrum) ev.push({ t: 0, d: [0xc0 | ch, GM[part.inst] === undefined ? 0 : GM[part.inst]] });
        for (const n of part.notes) {
          let key;
          if (typeof n.p === 'string') key = n.p === 'tom' ? TOMS[n.pitch || 0] : GM_DRUMS[n.p] || 39;
          else key = n.p;
          key = Math.max(0, Math.min(127, key));
          const on = Math.round(n.t * PPQ), off = Math.max(on + 1, Math.round((n.t + n.d) * PPQ));
          const vel = Math.max(1, Math.min(127, Math.round(n.v * 127)));
          ev.push({ t: on, d: [0x90 | ch, key, vel], o: 1 });
          ev.push({ t: off, d: [0x80 | ch, key, 0], o: 0 });
        }
        void pi;
        tracks.push(ev);
      });
    }
    const chunks = [];
    const head = [0x4d, 0x54, 0x68, 0x64, 0, 0, 0, 6, 0, 1, (tracks.length >> 8) & 255, tracks.length & 255, (PPQ >> 8) & 255, PPQ & 255];
    chunks.push(...head);
    for (const tr of tracks) {
      tr.sort((a, b) => a.t - b.t || (a.o === undefined ? -1 : a.o) - (b.o === undefined ? -1 : b.o));
      const data = [];
      let last = 0;
      for (const e of tr) { data.push(...vlq(e.t - last), ...e.d); last = e.t; }
      data.push(0, 0xff, 0x2f, 0);
      const len = data.length;
      chunks.push(0x4d, 0x54, 0x72, 0x6b, (len >>> 24) & 255, (len >>> 16) & 255, (len >>> 8) & 255, len & 255, ...data);
    }
    return new Uint8Array(chunks);
  }

  // ---------------------------------------------------------------- ZIP (store, no compression)
  const CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
  function crc32(b) { let c = 0xffffffff; for (let i = 0; i < b.length; i++) c = CRC[(c ^ b[i]) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; }
  function zip(files) { // files: [{name, data: Uint8Array}]
    const enc = (s) => Uint8Array.from(unescape(encodeURIComponent(s)), (c) => c.charCodeAt(0));
    const parts = [], central = [];
    let offset = 0;
    for (const f of files) {
      const name = enc(f.name), crc = crc32(f.data), size = f.data.length;
      const local = new Uint8Array(30 + name.length);
      const dv = new DataView(local.buffer);
      dv.setUint32(0, 0x04034b50, true); dv.setUint16(4, 20, true); dv.setUint16(8, 0, true);
      dv.setUint32(14, crc, true); dv.setUint32(18, size, true); dv.setUint32(22, size, true); dv.setUint16(26, name.length, true);
      local.set(name, 30);
      parts.push(local, f.data);
      const cen = new Uint8Array(46 + name.length);
      const cv = new DataView(cen.buffer);
      cv.setUint32(0, 0x02014b50, true); cv.setUint16(4, 20, true); cv.setUint16(6, 20, true);
      cv.setUint32(16, crc, true); cv.setUint32(20, size, true); cv.setUint32(24, size, true); cv.setUint16(28, name.length, true);
      cv.setUint32(42, offset, true);
      cen.set(name, 46);
      central.push(cen);
      offset += local.length + size;
    }
    const cenSize = central.reduce((a, c) => a + c.length, 0);
    const end = new Uint8Array(22);
    const ev = new DataView(end.buffer);
    ev.setUint32(0, 0x06054b50, true); ev.setUint16(8, files.length, true); ev.setUint16(10, files.length, true);
    ev.setUint32(12, cenSize, true); ev.setUint32(16, offset, true);
    const all = parts.concat(central, [end]);
    const out = new Uint8Array(all.reduce((a, p) => a + p.length, 0));
    let o = 0;
    for (const p of all) { out.set(p, o); o += p.length; }
    return out;
  }

  // ---------------------------------------------------------------- manifest + Luau
  const round = (x, d) => Math.round(x * Math.pow(10, d)) / Math.pow(10, d);

  function manifest(cue, rendered) {
    return {
      name: cue.name, title: cue.title, seed: cue.seed,
      bpm: cue.bpm, beatsPerBar: cue.beatsPerBar, bars: cue.bars, key: cue.key, mode: cue.mode,
      sampleRate: rendered.sr, loopSamples: rendered.loopSamples, loopSeconds: round(rendered.loopSeconds, 4),
      chords: cue.chords.map((c) => `${c.symbol}${c.length !== cue.beatsPerBar ? ':' + round(c.length / cue.beatsPerBar, 3) : ''}`).join(' '),
      mix: { lufs: round(rendered.mix.lufs, 1), peakDb: round(M.gainToDb(rendered.mix.peak), 1) },
      stems: rendered.stems.map((s) => ({ name: s.name, file: `${cue.name}_${s.name}.wav`, min: s.min, full: s.full, lufs: round(s.lufs, 1), peakDb: round(M.gainToDb(s.peak), 1) })),
      oneShots: rendered.oneShots.map((o) => ({ name: o.name, kind: o.kind, file: `${cue.name}_${o.name}.wav`, beats: o.beats, seconds: round(o.L.length / rendered.sr, 3), lufs: round(o.lufs, 1) })),
    };
  }

  // Manifest without audio (bars, stems, one-shot lengths): enough for MusicCues.luau.
  function cueManifest(cue) {
    return {
      name: cue.name, title: cue.title, seed: cue.seed, bpm: cue.bpm, beatsPerBar: cue.beatsPerBar, bars: cue.bars, key: cue.key, mode: cue.mode,
      loopSeconds: round(cue.bars * cue.beatsPerBar * 60 / cue.bpm, 3),
      chords: cue.chords.map((c) => `${c.symbol}${c.length !== cue.beatsPerBar ? ':' + round(c.length / cue.beatsPerBar, 3) : ''}`).join(' '),
      stems: cue.stems.map((s) => ({ name: s.name, file: `${cue.name}_${s.name}.wav`, min: s.min, full: s.full })),
      oneShots: cue.oneShots.map((o) => ({ name: o.name, kind: o.kind, file: `${cue.name}_${o.name}.wav`, beats: o.beats })),
    };
  }

  function luauString(s) { return '"' + String(s).replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '"'; }
  function luauKey(k) { return /^[A-Za-z_][A-Za-z0-9_]*$/.test(k) ? k : `[${luauString(k)}]`; }

  // A MusicCues.luau entry. Asset ids are empty: upload the WAVs, paste the ids.
  function luauEntry(man, indent) {
    const t = indent || '\t';
    const L = [];
    L.push(`${t}${luauKey(man.name)} = {`);
    const loop = man.loopSeconds === undefined ? '' : ` Loop ${man.loopSeconds} s${man.mix ? `, full mix ${man.mix.lufs} LUFS` : ''}.`;
    L.push(`${t}\t-- ${man.title || man.name}: ${man.key} ${man.mode}, ${man.chords}. Seed ${man.seed}.${loop}`);
    L.push(`${t}\tBpm = ${man.bpm},`);
    L.push(`${t}\tBeatsPerBar = ${man.beatsPerBar},`);
    L.push(`${t}\tBars = ${man.bars},`);
    L.push(`${t}\tStems = {`);
    for (const s of man.stems) L.push(`${t}\t\t{ Name = ${luauString(s.name)}, Asset = "", Min = ${s.min}, Full = ${s.full} }, -- ${s.file}`);
    L.push(`${t}\t},`);
    const shots = man.oneShots;
    const intro = shots.find((o) => o.kind === 'intro'), ending = shots.find((o) => o.kind === 'ending');
    if (intro) L.push(`${t}\tIntro = { Asset = "", Beats = ${intro.beats} }, -- ${intro.file}`);
    if (ending) L.push(`${t}\tEnding = { Asset = "", Beats = ${ending.beats} }, -- ${ending.file}`);
    const stingers = shots.filter((o) => o.kind === 'stinger');
    if (stingers.length) {
      L.push(`${t}\tStingers = {`);
      for (const s of stingers) L.push(`${t}\t\t${luauKey(s.name)} = { Asset = "", Beats = ${s.beats} }, -- ${s.file}`);
      L.push(`${t}\t},`);
    }
    L.push(`${t}},`);
    return L.join('\n');
  }

  Object.assign(M, { wav, readWav, midi, zip, crc32, manifest, cueManifest, luauEntry, luauString, GM, GM_DRUMS });
})(typeof MusicEngine !== 'undefined' ? MusicEngine : (globalThis.MusicEngine = globalThis.MusicEngine || {}));
