// Engine self-test: maths and image operations without a browser, then (if a browser exists) one small build.
//   node rart.mjs selftest
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as PNG from './lib/png.mjs';
import * as C from './lib/color.mjs';
import * as R from './lib/raster.mjs';
import * as FX from './lib/fx.mjs';
import { contours, simplifyLoop } from './lib/trace.mjs';
import { pack } from './lib/sheet.mjs';
import { makeKit } from './lib/kit.mjs';
import * as DS from './lib/design.mjs';

let fails = 0, passes = 0;
const ok = (cond, name) => { if (cond) passes++; else { fails++; console.log('FAIL ' + name); } };
const near = (a, b, e) => Math.abs(a - b) <= e;
function disc(w, h, cx, cy, r) { const F = R.create(w, h); for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { let cov = 0; for (let sy = 0; sy < 4; sy++) for (let sx = 0; sx < 4; sx++) if (Math.hypot(x + (sx + 0.5) / 4 - cx, y + (sy + 0.5) / 4 - cy) <= r) cov++; cov /= 16; const i = (y * w + x) * 4; F.d[i] = 0.9 * cov; F.d[i + 1] = 0.2 * cov; F.d[i + 2] = 0.2 * cov; F.d[i + 3] = cov; } return F; }

export async function selftest() {
  // PNG round trip (RGBA and opaque RGB)
  const img = { w: 7, h: 5, rgba: new Uint8Array(7 * 5 * 4).map((_, i) => (i * 37) % 256) };
  const back = PNG.decode(PNG.encode(img)); ok(back.w === 7 && back.h === 5 && back.rgba.every((v, i) => v === img.rgba[i]), 'png round trip');
  const op = { w: 3, h: 2, rgba: new Uint8Array(24).map((_, i) => i % 4 === 3 ? 255 : i * 9) }; ok(PNG.decode(PNG.encode(op)).rgba.every((v, i) => v === op.rgba[i]), 'png opaque round trip');
  // colour
  ok(C.hex(C.parse('#3a7bd5')) === '#3a7bd5', 'hex parse/format'); ok(C.hex(C.fromOklab(C.oklab('#c04020'))) === '#c04020', 'oklab round trip');
  const rp = C.ramp('#e8433a', 5); ok(rp.length === 5 && C.oklch(rp[0])[0] < C.oklch(rp[2])[0] && C.oklch(rp[4])[0] > C.oklch(rp[2])[0], 'ramp ordered dark to light');
  ok(C.oklch(C.shade('#3aa0e8', -1))[2] > C.oklch('#3aa0e8')[2], 'blue shadow shifts toward violet');
  ok(C.oklch(C.shade('#3ae860', 0.8))[2] < C.oklch('#3ae860')[2], 'green highlight shifts toward yellow');
  ok(C.contrast('#000', '#fff') > 20, 'contrast'); ok(C.kmeans([{ lab: [0.2, 0, 0], w: 1 }, { lab: [0.21, 0, 0], w: 1 }, { lab: [0.9, 0, 0], w: 1 }], 2).length === 2, 'kmeans');
  // graphic-design helpers: a role palette, atmospheric depth, scheme naming, text parsing
  const sc = C.scheme('#5ee05a', 'split', { mood: 'bright' });
  ok(sc.hero && sc.bg && sc.secondary && sc.accent && sc.ink, 'scheme returns every role');
  ok(Math.abs(C.oklch(sc.bg)[0] - C.oklch(sc.hero)[0]) >= 0.19, 'scheme sets the background a value step off the hero');
  ok(C.oklch(C.atmos('#e8433a', 1, '#bcdcff'))[1] < C.oklch('#e8433a')[1], 'atmos loses chroma with depth');
  ok(DS.harmonyOf([10, 190]) === 'complementary' && DS.harmonyOf([10, 130, 250]) === 'triadic', 'harmony names');
  const tx = DS.textsIn('<text x="1" y="2" font-family="Luckiest Guy" font-size="80" fill="#ffffff" stroke="#000000" stroke-width="12">HI</text>');
  ok(tx.length === 1 && tx[0].str === 'HI' && tx[0].size === 80 && tx[0].sw === 12, 'textsIn reads size, fill and outline');
  // distance transform against brute force
  const w = 24, h = 17, sites = new Uint8Array(w * h); [[3, 4], [20, 2], [11, 14]].forEach(([x, y]) => sites[y * w + x] = 1);
  const { d, idx } = R.edt(sites, w, h); let edtOk = true;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const bf = Math.min(...[[3, 4], [20, 2], [11, 14]].map(([sx, sy]) => Math.hypot(x - sx, y - sy))); if (!near(d[y * w + x], bf, 1e-4)) edtOk = false; const s = idx[y * w + x]; if (!near(Math.hypot(x - s % w, y - Math.floor(s / w)), bf, 1e-4)) edtOk = false; }
  ok(edtOk, 'EDT distance and nearest site exact');
  // outline: an outside outline of width 6 grows a disc of r 20 to about r 26
  const D = disc(80, 80, 40, 40, 20), O = FX.outline(D, { width: 6, color: '#000000' }), bb = R.bbox(R.alpha(O), 80, 80, 0.5);
  ok(bb && near(bb.w, 52, 1.5), `outline width (box ${bb && bb.w}, want ~52)`);
  ok(O.d[(40 * 80 + 40) * 4] > 0.85, 'outline keeps the shape colour inside');
  // shading: lit side lighter than the shadow side, alpha untouched
  const S = FX.shade(D, { style: 'toon' }), L = i => S.d[i * 4] / S.d[i * 4 + 3];
  ok(L(30 * 80 + 30) > L(52 * 80 + 52), 'toon: top-left lighter than bottom-right');
  ok(near(S.d[(40 * 80 + 40) * 4 + 3], D.d[(40 * 80 + 40) * 4 + 3], 1e-6), 'shade keeps alpha');
  // blur conserves mass, resize conserves mean colour
  const a1 = new Float32Array(400); a1[210] = 1; const bl = R.blur(a1, 20, 20, 2); ok(near(bl.reduce((p, q) => p + q, 0), 1, 0.02), 'blur conserves mass');
  const half = R.resize(D, 40, 40); let s0 = 0, s1 = 0; for (let i = 0; i < 6400; i++) s0 += D.d[i * 4 + 3]; for (let i = 0; i < 1600; i++) s1 += half.d[i * 4 + 3]; ok(near(s0 / 4, s1, s0 * 0.01), 'area resize conserves coverage');
  // alpha bleed: transparent pixels take the nearest colour, alpha unchanged
  const b8 = R.toRGBA8(D); R.bleed(b8); ok(b8.rgba[3] === 0 && b8.rgba[0] > 200, 'alpha bleed fills transparent RGB');
  // contours: a disc traces to one loop of the right size
  const m = R.alpha(disc(60, 60, 30, 30, 18)), loops = contours(R.blur(m, 60, 60, 0.8), 60, 60);
  ok(loops.length === 1, `one contour loop (got ${loops.length})`);
  const sl = simplifyLoop(loops[0], 0.5), xs = sl.map(p => p[0]); ok(near(Math.max(...xs) - Math.min(...xs), 36, 2), 'contour diameter');
  // pixel art: grid size, palette snapping, outline added
  const P = FX.pixelate(D, { size: 16, palette: 'pico8', outline: '#000000' }); ok(P.w === 16 && P.h === 16, 'pixelate size');
  const cols = new Set(); for (let i = 0; i < 256; i++) if (P.rgba[i * 4 + 3]) cols.add(C.hex([P.rgba[i * 4], P.rgba[i * 4 + 1], P.rgba[i * 4 + 2]].map(v => v / 255)).slice(1)); ok([...cols].every(c => C.PALETTES.pico8.includes(c) || c === '000000'), 'pixel colours come from the palette');
  // sheets
  const fr = [1, 2, 3, 4, 5].map(i => ({ name: 'f' + i, img: { w: 10, h: 8, rgba: new Uint8Array(320).fill(i * 40) } }));
  const pk = pack(fr, { cols: 3, pad: 2 }); ok(pk.img.w === 3 * 14 && pk.img.h === 2 * 12 && pk.rects[4].x === 14 + 2 && /ImageRectOffset/.test(pk.luau), 'grid sheet layout + luau');
  const fb = pack(fr, { flipbook: 4, size: 256 }); ok(fb.img.w === 256 && /Grid4x4/.test(fb.luau) && /warning: 256x256/.test(fb.luau), 'flipbook (an explicit non-1024 size is kept but warned about)');
  const fb2 = pack(fr.slice(0, 4), { flipbook: 2 }); ok(fb2.img.w === 1024 && fb2.img.h === 1024 && !/warning/.test(fb2.luau), 'flipbook sheets default to 1024 x 1024 even for small frames');
  // kit produces well-formed markup
  const k = makeKit({ w: 512, h: 512 }); const mk = k.path(k.smooth([[0, 0], [10, 0], [10, 10]]), '#f00') + k.text('HI', 100, 100) + k.bg.rarity('epic') + k.gem(100, 100, 50, 60) + k.coin(200, 200, 40);
  ok(!/NaN|undefined/.test(mk) && k.defs.length > 0, 'kit markup');
  const sk = makeKit({ w: 1920, h: 1080 });
  ok(near(sk.safe(0.05, 1920, 1080).y1, 1080 - 54, 1e-9) && near(sk.safe(0.05, 1920, 1080, 0.12).y1, 1080 - 129.6, 1e-9), 'safe box: margin and explicit bottom band');
  ok(near(sk.at('tl', 1920, 1080)[0], 640, 1e-9) && near(sk.at('phi-right', 1920, 1080)[0], (1 - 0.382) * 1920, 1e-9), 'layout anchors');
  console.log(`maths and image ops: ${passes} passed, ${fails} failed`);

  // end to end with the browser
  try {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rart-self-'));
    fs.writeFileSync(path.join(dir, 't.art.mjs'), `export default (k) => [{ name: 'T', kind: 'item', size: 256, layers: [{ name: 'b', svg: k.circle(128, 128, 90, '#3aa0e8'), shade: 'toon' }] },
      { name: 'P', kind: 'sprite', pixel: { size: 16, palette: 'sweetie16' }, layers: [{ svg: k.path(k.heart(256, 256, 400), '#e83a5a'), shade: 'toon' }] },
      { name: 'I', kind: 'game-icon', layers: [{ name: 'bg', stage: 'back', svg: k.bg.solid('#1a2350') }, { name: 'orb', role: 'hero', svg: k.circle(256, 270, 150, '#ffd12e'), shade: 'toon' }] }]`);
    const { buildFile } = await import('./lib/build.mjs'), res = await buildFile(path.join(dir, 't.art.mjs'), { out: path.join(dir, 'out'), review: false });
    const t = res[0], p = res[1], ic = res[2];
    ok(fs.existsSync(t.main) && t.checks.every(c => c.level !== 'FAIL'), 'build: item icon with no FAIL');
    ok(p.img8.w === 16 && p.palette.length <= 16, 'build: pixel sprite');
    ok(ic.analysis && ic.analysis.peaks[0].layer === 'orb', 'build: composed analysis names the hero layer as the focal point');
    ok(ic.checks.some(c => c.name === 'focal point' && c.level === 'PASS') && ic.checks.every(c => c.level !== 'FAIL'), 'build: composed design checks run');
    console.log(`end to end: ${fails ? 'see failures above' : 'ok'} (${dir})`);
  } catch (e) { fails++; console.log('FAIL end to end: ' + e.message); }
  console.log(fails ? `\n${fails} FAILED` : '\nall passed');
  if (fails) process.exitCode = 1;
}
if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) selftest().then(async () => (await import('./lib/chrome.mjs')).closeBrowser());
