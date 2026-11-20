// Review sheets: one PNG per asset showing it the way Roblox players will see it (dark and light app themes, real
// display sizes, circle crop for badges / passes, safe zones for thumbnails, stretched 9-slices, tiled textures,
// pixel art at 1x) plus the silhouette, value (greyscale) and squint (blur) tests, the references and the checks.
import fs from 'node:fs';
import path from 'node:path';
import * as PNG from './png.mjs';
import * as R from './raster.mjs';
import { SURFACES } from './presets.mjs';
import * as C from './color.mjs';
import * as DS from './design.mjs';

const uri = img8 => 'data:image/png;base64,' + PNG.encode(img8).toString('base64');
const fileUri = f => { const ext = path.extname(f).slice(1).toLowerCase(); return `data:image/${{ jpg: 'jpeg', svg: 'svg+xml' }[ext] || ext};base64,${fs.readFileSync(f).toString('base64')}`; };
const CSS = `*{box-sizing:border-box}body{margin:0;font:13px/1.35 'Segoe UI',system-ui,sans-serif;color:#e8eaed;background:#121314}
.sheet{padding:18px;width:1240px}h1{font-size:20px;margin:0 0 4px}h1 span{font-weight:400;color:#9aa0a6;font-size:14px;margin-left:8px}
.row{display:flex;gap:14px;align-items:flex-end;flex-wrap:wrap;margin:12px 0}.cell{display:flex;flex-direction:column;gap:4px;align-items:center}
.cap{color:#9aa0a6;font-size:11px;text-align:center}.chk{background-image:repeating-conic-gradient(#3a3d41 0 25%,#2a2c2f 0 50%);background-size:16px 16px}
.dark{background:${SURFACES.dark}}.light{background:${SURFACES.light}}.card{background:${SURFACES.card}}.pad{padding:10px;border-radius:8px}
img{display:block}.px{image-rendering:pixelated}.checks{margin-top:10px;column-count:2;column-gap:24px}.checks div{break-inside:avoid;margin:2px 0}
.PASS{color:#7bd88f}.WARN{color:#ffcb6b}.FAIL{color:#ff6b6b}.sec{color:#c3c7cb;font-weight:600;margin-top:14px}.notes{color:#9aa0a6;margin-top:6px}`;
const cell = (inner, cap, cls = '') => `<div class="cell"><div class="${cls}">${inner}</div><div class="cap">${cap}</div></div>`;
const im = (src, w, h, extra = '') => `<img src="${src}" width="${w}" height="${h}" ${extra}>`;

export async function reviewAsset(res, b, specDir) {
  const { img8, w, h } = res, K = res.a.K, src = uri(R.bleed({ w, h, rgba: new Uint8Array(img8.rgba) })), isPx = !!res.pixel, pxc = isPx ? 'class="px"' : '';
  const fitBox = (mw, mh) => { const s = Math.min(mw / w, mh / h); return [Math.round(w * s), Math.round(h * s)]; };
  let html = `<div class="sheet"><h1>${res.name}<span>${res.kind} · ${w}x${h}${res.pixel ? ` · pixel art ${res.pixel.grid.join('x')}` : ''} · ${K.desc}</span></h1>`;
  const wide = w / h > 1.4;
  // row 1: the asset large, on both themes, and the three readability tests
  const [bw, bh] = fitBox(wide ? 760 : 360, wide ? 430 : 360), [sw, sh] = fitBox(wide ? 300 : 170, wide ? 170 : 170);
  let big = im(src, bw, bh, pxc);
  if (K.safe) { const yb = Math.round(bh * (1 - K.safe.bottom)), m = Math.round(Math.min(bw, bh) * K.safe.edge); big = `<div style="position:relative;width:${bw}px;height:${bh}px">${big}<div style="position:absolute;left:0;right:0;top:${yb}px;bottom:0;background:repeating-linear-gradient(45deg,rgba(255,80,80,.35) 0 8px,transparent 8px 16px);border-top:2px dashed #ff6b6b"></div><div style="position:absolute;left:${m}px;top:${m}px;right:${m}px;bottom:${bh - yb}px;border:1px dashed rgba(255,255,255,.5)"></div><div style="position:absolute;left:6px;bottom:4px;color:#fff;font-size:11px;text-shadow:0 1px 2px #000">bottom band: player count bar can cover this</div></div>`; }
  if (K.circle) big = `<div style="position:relative;width:${bw}px;height:${bh}px">${big}<div style="position:absolute;inset:0;border-radius:50%;box-shadow:0 0 0 999px rgba(0,0,0,.55);outline:2px dashed #ffcb6b;outline-offset:-2px"></div></div>`;
  html += `<div class="row">${cell(big, K.circle ? 'the circle Roblox keeps (outside is cropped)' : K.safe ? 'safe zones' : 'full size, transparent shown as checks', K.transparent || isPx ? 'chk' : '')}`;
  html += `<div style="display:grid;grid-template-columns:repeat(2,auto);gap:10px">${cell(im(src, sw, sh, pxc), 'dark theme', 'dark pad')}${cell(im(src, sw, sh, pxc), 'light theme', 'light pad')}`;
  html += `${cell(im(src, sw, sh, (isPx ? 'class="px" ' : '') + `style="filter:${K.opaque ? 'grayscale(1) contrast(1.1)' : 'brightness(0)'}"`), K.opaque ? 'values only (greyscale)' : 'silhouette test', 'light pad')}`;
  html += `${cell(im(src, sw, sh, `style="filter:blur(${Math.max(2, Math.round(sw / 45))}px)"`), 'squint test (blurred)', (K.opaque ? '' : 'dark ') + 'pad')}</div></div>`;
  // row 2: real display sizes
  const sizes = isPx ? [1, 2, 4].map(k => [w * k, h * k]) : (K.preview || []).map(p => Array.isArray(p) ? p : [p, Math.round(p * h / w)]);
  if (sizes.length) {
    const rad = K.circle ? 'border-radius:50%;' : K.name === 'game-icon' ? 'border-radius:12%;' : '';
    html += `<div class="sec">${isPx ? 'pixel art at 1x / 2x / 4x' : 'at the sizes players see it'}</div><div class="row">`;
    for (const theme of ['dark', 'light']) html += `<div class="${theme} pad" style="display:flex;gap:14px;align-items:flex-end">${sizes.map(([a, c]) => cell(im(src, a, c, `${pxc} style="${rad}"`), isPx ? `${a}x${c}` : `${a}px`)).join('')}</div>`;
    if (K.name === 'thumbnail') html += cardMock(src);
    html += `</div>`;
  }
  if (res.analysis && DS.COMPOSED.has(K.name)) html += compositionRow(res, src);
  // kind-specific rows
  if (res.slice) {
    const [l, t, r, bt] = res.slice.insets, z = Math.max(1, Math.floor(240 / Math.max(w, h)));
    const guide = `<div style="position:relative;width:${w * z}px;height:${h * z}px">${im(src, w * z, h * z, 'class="px"')}<div style="position:absolute;left:${l * z}px;top:0;bottom:0;border-left:1px dashed #0ff"></div><div style="position:absolute;left:${(w - r) * z}px;top:0;bottom:0;border-left:1px dashed #0ff"></div><div style="position:absolute;top:${t * z}px;left:0;right:0;border-top:1px dashed #0ff"></div><div style="position:absolute;top:${(h - bt) * z}px;left:0;right:0;border-top:1px dashed #0ff"></div></div>`;
    const stretched = ([sw2, sh2]) => `<div style="width:${sw2}px;height:${sh2}px;border-style:solid;border-width:${t}px ${r}px ${bt}px ${l}px;border-image:url(${src}) ${t} ${r} ${bt} ${l} fill stretch"></div>`;
    html += `<div class="sec">9-slice: SliceCenter ${res.slice.rect.join(', ')} (cyan) and stretched like ScaleType.Slice</div><div class="row">${cell(guide, `source x${z}`, 'chk')}${[[360, 90], [180, 180], [520, 150]].map(sz => cell(stretched(sz), sz.join('x'), 'dark pad')).join('')}</div>`;
  }
  if (res.a.tile) html += `<div class="sec">tiled 3x3 (look for seams and repeating blotches)</div><div class="row"><div style="width:${Math.min(3 * w, 720)}px;height:${Math.min(3 * h, 405)}px;background:url(${src});background-size:${Math.min(w, 240)}px"></div></div>`;
  if (res.sheet) { const sf = res.files.find(f => /_sheet\.png$/.test(f)); if (sf) { const s = Math.min(1, 900 / Math.max(res.sheet.w, res.sheet.h)); html += `<div class="sec">${res.sheet.flipbook ? `flipbook Grid${res.sheet.flipbook}x${res.sheet.flipbook}` : 'sprite sheet'}: ${res.sheet.frames} frames, ${res.sheet.w}x${res.sheet.h}</div><div class="row">${cell(im(fileUri(sf), Math.round(res.sheet.w * s), Math.round(res.sheet.h * s), isPx ? 'class="px"' : ''), 'frames in order, left to right', 'chk')}</div>`; } }
  // references next to the result
  const refs = (res.refs || []).map(r => typeof r === 'string' ? { file: r } : r).filter(r => r.file && fs.existsSync(path.resolve(specDir, r.file)));
  if (refs.length) html += `<div class="sec">references</div><div class="row">${refs.slice(0, 5).map(r => cell(`<img src="${fileUri(path.resolve(specDir, r.file))}" style="max-width:220px;max-height:180px">`, (r.note || path.basename(r.file)).slice(0, 60), 'light pad')).join('')}${cell(im(src, ...fitBox(180, 180), pxc), 'result', 'light pad')}</div>`;
  html += `<div class="sec">checks</div><div class="checks">${res.checks.map(c => `<div><b class="${c.level}">${c.level}</b> ${c.name}: ${esc(c.msg)}</div>`).join('')}</div>`;
  if (res.notes.length) html += `<div class="notes">${res.notes.map(esc).join('<br>')}</div>`;
  html += `</div>`;
  return b.renderPage(`<style>${CSS}</style>${html}`, 1276);
}
const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;');

// Composition row: grid overlay with the predicted reading order and the centre of visual weight, the attention map,
// the 3-value plan, colour proportions and the hue wheel (references/graphic-design.md explains each).
function compositionRow(res, src) {
  const D = res.analysis, { w, h } = res, wide = w / h > 1.3, cw = wide ? 400 : 230, ch = Math.round(cw * h / w), sw = wide ? 250 : 170, sh = Math.round(sw * h / w);
  const X = f => (f * cw).toFixed(1), Y = f => (f * ch).toFixed(1), ln = (x1, y1, x2, y2, st) => `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" ${st}/>`;
  let g = '';
  for (const f of [1 / 3, 2 / 3]) g += ln(X(f), 0, X(f), ch, 'stroke="#fff" stroke-opacity=".6"') + ln(0, Y(f), cw, Y(f), 'stroke="#fff" stroke-opacity=".6"');
  for (const f of [0.382, 0.618]) g += ln(X(f), 0, X(f), ch, 'stroke="#ffcb6b" stroke-dasharray="4 4"') + ln(0, Y(f), cw, Y(f), 'stroke="#ffcb6b" stroke-dasharray="4 4"');
  const m = 0.05 * Math.min(w, h), band = res.a.K.safe && res.a.K.safe.bottom ? res.a.K.safe.bottom * h : 0;
  g += `<rect x="${X(m / w)}" y="${Y(m / h)}" width="${(cw - 2 * m / w * cw).toFixed(1)}" height="${(ch - (m + Math.max(m, band)) / h * ch).toFixed(1)}" fill="none" stroke="#5ee0ff" stroke-dasharray="2 3"/>`;
  D.peaks.slice(0, 3).forEach((p, i) => { g += `<circle cx="${X(p.x)}" cy="${Y(p.y)}" r="11" fill="#ff5470" stroke="#fff" stroke-width="2"/><text x="${X(p.x)}" y="${(+Y(p.y) + 4.5).toFixed(1)}" text-anchor="middle" font-size="13" font-weight="700" fill="#fff" font-family="Segoe UI,sans-serif">${i + 1}</text>`; });
  const bx = +X(D.balance.x), by = +Y(D.balance.y); g += `<path d="M${bx} ${by - 9}L${bx + 9} ${by}L${bx} ${by + 9}L${bx - 9} ${by}Z" fill="#5ee0ff" stroke="#000" stroke-width="1.5"/>`;
  const grid = `<div style="position:relative;width:${cw}px;height:${ch}px"><img src="${src}" width="${cw}" height="${ch}" style="display:block;filter:saturate(.7) brightness(.85)"><svg width="${cw}" height="${ch}" style="position:absolute;left:0;top:0">${g}</svg></div>`;
  const heat = im(uri(DS.heatImage(D)), sw, sh), notan = im(uri(DS.notanImage(D)), sw, sh), v = D.values;
  // colour proportions (families) and the hue wheel
  const fams = D.families.filter(f => f.share >= 0.01);
  const bar = `<div style="display:flex;width:${wide ? 360 : 300}px;height:26px;border-radius:5px;overflow:hidden;outline:1px solid #444">${fams.map(f => `<div title="${f.name}" style="width:${(f.share * 100).toFixed(1)}%;background:${f.hex}"></div>`).join('')}</div><div class="cap" style="text-align:left;width:${wide ? 360 : 300}px">${fams.slice(0, 5).map(f => `${f.name} ${Math.round(f.share * 100)}%`).join(' · ')}</div>`;
  const stops = Array.from({ length: 13 }, (_, i) => C.hex(C.fromOklch([0.74, 0.13, i * 30]))).join(',');
  const R0 = 52, dots = D.families.filter(f => !f.neutral && f.share >= 0.01).map(f => { const t = f.h * Math.PI / 180, rr = R0 * (0.35 + 0.65 * Math.min(1, f.C / 0.2)), s = 5 + 18 * Math.sqrt(f.share); return `<div style="position:absolute;left:${(60 + rr * Math.sin(t) - s / 2).toFixed(1)}px;top:${(60 - rr * Math.cos(t) - s / 2).toFixed(1)}px;width:${s.toFixed(1)}px;height:${s.toFixed(1)}px;border-radius:50%;background:${f.hex};border:2px solid #fff"></div>`; }).join('');
  const wheel = `<div style="position:relative;width:120px;height:120px"><div style="position:absolute;inset:6px;border-radius:50%;background:conic-gradient(${stops});opacity:.55"></div><div style="position:absolute;inset:44px;border-radius:50%;background:#121314"></div>${dots}</div>`;
  return `<div class="sec">composition: 1-2-3 = where the eye goes, in order · ◆ = centre of visual weight · white = thirds, yellow = golden section, cyan = 5% margin</div><div class="row">` +
    cell(grid, 'grid, reading order and balance') + cell(heat, 'attention (brighter = pulls the eye)') + cell(notan, `value plan: dark ${Math.round(v.dark * 100)}% · mid ${Math.round(v.mid * 100)}% · light ${Math.round(v.light * 100)}%`) +
    `<div class="cell" style="align-items:flex-start;gap:6px">${bar}<div style="display:flex;gap:10px;align-items:center">${wheel}<div class="cap" style="text-align:left;max-width:170px">${esc(D.harmony)}<br>warm ${Math.round(D.warm * 100)}% · cool ${Math.round(D.cool * 100)}%<br>dot size = area, distance from centre = saturation</div></div></div></div>`;
}
// How a thumbnail reads as a small card in a list.
const cardMock = src => `<div class="dark pad" style="width:236px"><img src="${src}" width="216" height="122" style="border-radius:8px"><div style="margin-top:6px;font-weight:600;color:#fff">Your Game Title</div><div class="cap" style="text-align:left">92% · 1.2K playing</div></div>`;

export async function reviewSet(results, b) {
  const items = results.map(r => ({ name: r.name, w: r.w, h: r.h, src: uri(R.bleed({ w: r.w, h: r.h, rgba: new Uint8Array(r.img8.rgba) })), px: !!r.pixel, bad: r.checks.filter(c => c.level !== 'PASS').length, circle: r.a.K.circle, opaque: !!r.a.K.opaque }));
  const fit = (it, m) => { const s = Math.min(m / it.w, m / it.h); return [Math.round(it.w * s), Math.round(it.h * s)]; };
  const row = (theme, m) => `<div class="${theme} pad" style="display:flex;flex-wrap:wrap;gap:12px;align-items:flex-end">${items.map(it => cell(im(it.src, ...fit(it, m), `${it.px ? 'class="px"' : ''} style="${it.circle ? 'border-radius:50%' : ''}"`), m >= 100 ? `${it.name}${it.bad ? ` <span class="WARN">(${it.bad})</span>` : ''}` : '')).join('')}</div>`;
  const html = `<div class="sheet"><h1>Set review<span>${items.length} assets · same light, outline weight, size in the frame and saturation?</span></h1><div class="sec">128 px</div>${row('dark', 128)}${row('light', 128)}<div class="sec">48 px (how they read in a hotbar or shop list)</div>${row('dark', 48)}${row('light', 48)}${items.some(it => !it.opaque) ? `<div class="sec">silhouettes</div><div class="light pad" style="display:flex;flex-wrap:wrap;gap:12px">${items.filter(it => !it.opaque).map(it => im(it.src, ...fit(it, 72), 'style="filter:brightness(0)"')).join('')}</div>` : ''}</div>`;
  return b.renderPage(`<style>${CSS}</style>${html}`, 1276);
}
