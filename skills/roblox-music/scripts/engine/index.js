// Node entry: loads every engine file (they share one MusicEngine object) and exports it.
// The browser lab inlines the same files in the same order (see FILES).
'use strict';
const FILES = ['theory.js', 'patterns.js', 'melody.js', 'compose.js', 'dsp.js', 'instruments.js', 'render.js', 'formats.js', 'adaptive.js'];
for (const f of FILES) {
  try { require('./' + f); } catch (e) { if (!(e.code === 'MODULE_NOT_FOUND' && e.message.includes(f))) throw e; }
}
module.exports = globalThis.MusicEngine;
module.exports.FILES = FILES;
