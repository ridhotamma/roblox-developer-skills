// Review sheets: one PNG per asset showing it the way Roblox players will see it (dark and light app themes, real
// display sizes, circle crop for badges / passes, safe zones for thumbnails, stretched 9-slices, tiled textures,
// pixel art at 1x) plus the silhouette, value (greyscale) and squint (blur) tests, the references and the checks.
import fs from 'node:fs';
import path from 'node:path';
import * as PNG from './png.mjs';
import * as R from './raster.mjs';
import { SURFACES } from './presets.mjs';

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
// How a thumbnail reads as a small card in a list.
const cardMock = src => `<div class="dark pad" style="width:236px"><img src="${src}" width="216" height="122" style="border-radius:8px"><div style="margin-top:6px;font-weight:600;color:#fff">Your Game Title</div><div class="cap" style="text-align:left">92% · 1.2K playing</div></div>`;

export async function reviewSet(results, b) {
  const items = results.map(r => ({ name: r.name, w: r.w, h: r.h, src: uri(R.bleed({ w: r.w, h: r.h, rgba: new Uint8Array(r.img8.rgba) })), px: !!r.pixel, bad: r.checks.filter(c => c.level !== 'PASS').length, circle: r.a.K.circle, opaque: !!r.a.K.opaque }));
  const fit = (it, m) => { const s = Math.min(m / it.w, m / it.h); return [Math.round(it.w * s), Math.round(it.h * s)]; };
  const row = (theme, m) => `<div class="${theme} pad" style="display:flex;flex-wrap:wrap;gap:12px;align-items:flex-end">${items.map(it => cell(im(it.src, ...fit(it, m), `${it.px ? 'class="px"' : ''} style="${it.circle ? 'border-radius:50%' : ''}"`), m >= 100 ? `${it.name}${it.bad ? ` <span class="WARN">(${it.bad})</span>` : ''}` : '')).join('')}</div>`;
  const html = `<div class="sheet"><h1>Set review<span>${items.length} assets · same light, outline weight, size in the frame and saturation?</span></h1><div class="sec">128 px</div>${row('dark', 128)}${row('light', 128)}<div class="sec">48 px (how they read in a hotbar or shop list)</div>${row('dark', 48)}${row('light', 48)}${items.some(it => !it.opaque) ? `<div class="sec">silhouettes</div><div class="light pad" style="display:flex;flex-wrap:wrap;gap:12px">${items.filter(it => !it.opaque).map(it => im(it.src, ...fit(it, 72), 'style="filter:brightness(0)"')).join('')}</div>` : ''}</div>`;
  return b.renderPage(`<style>${CSS}</style>${html}`, 1276);
}
