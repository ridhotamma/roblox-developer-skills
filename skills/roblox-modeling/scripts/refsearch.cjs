#!/usr/bin/env node
'use strict';
// refsearch: find openly licensed reference images (Wikimedia Commons + Openverse), download thumbnails into a
// folder and record where each came from, so the model is built from what the thing really looks like.
//   node refsearch.cjs "treasure chest" [--out refs] [--n 8] [--source commons|openverse|both] [--width 800]
// Then open the downloaded images with an image viewer (Claude: the Read tool) and pick the clearest
// side / front / top views. sources.json keeps title, page, licence and author for each file.
const fs = require('fs'), path = require('path');
const UA = 'rmodel-skill/1.0 (low-poly reference lookup)';

const sleep = ms => new Promise(res => setTimeout(res, ms));
async function getJson(url) { const r = await fetch(url, { headers: { 'User-Agent': UA } }); if (!r.ok) throw new Error(`${r.status} ${url}`); return r.json(); }
async function commons(q, n, width) {
  const u = `https://commons.wikimedia.org/w/api.php?action=query&format=json&generator=search&gsrnamespace=6&gsrlimit=${n}` +
    `&gsrsearch=${encodeURIComponent('filetype:bitmap ' + q)}&prop=imageinfo&iiprop=url|size|mime|extmetadata&iiurlwidth=${width}`;
  const d = await getJson(u), pages = Object.values((d.query && d.query.pages) || {}).sort((a, b) => a.index - b.index);
  return pages.map(p => { const i = p.imageinfo[0], md = i.extmetadata || {}, v = k => (md[k] && String(md[k].value).replace(/<[^>]+>/g, '').trim()) || '';
    return { source: 'commons', title: p.title.replace(/^File:/, ''), page: i.descriptionurl, image: i.thumburl || i.url, original: i.url, width: i.width, height: i.height, license: v('LicenseShortName'), author: v('Artist') }; });
}
async function openverse(q, n) {
  const d = await getJson(`https://api.openverse.org/v1/images/?q=${encodeURIComponent(q)}&page_size=${n}`);
  return (d.results || []).map(r => ({ source: 'openverse', title: r.title, page: r.foreign_landing_url, image: r.url, width: r.width, height: r.height, license: `${r.license} ${r.license_version || ''}`.trim(), author: r.creator || '' }));
}
async function main() {
  const argv = process.argv.slice(2), o = {}, pos = [];
  for (let i = 0; i < argv.length; i++) { if (argv[i].startsWith('--')) o[argv[i].slice(2)] = argv[++i]; else pos.push(argv[i]); }
  const q = pos.join(' ');
  if (!q) { console.log('usage: node refsearch.cjs "<what to search>" [--out refs] [--n 8] [--source commons|openverse|both] [--width 800]'); process.exit(2); }
  const out = path.resolve(o.out || 'refs'), n = +(o.n || 8), src = o.source || 'both', width = +(o.width || 800);
  fs.mkdirSync(out, { recursive: true });
  let found = [];
  if (src !== 'openverse') try { found.push(...await commons(q, n, width)); } catch (e) { console.log('commons: ' + e.message); }
  if (src !== 'commons') try { found.push(...await openverse(q, n)); } catch (e) { console.log('openverse: ' + e.message); }
  const listFile = path.join(out, 'sources.json'), list = fs.existsSync(listFile) ? JSON.parse(fs.readFileSync(listFile, 'utf8')) : [];
  let k = list.length;
  for (const f of found) {
    if (list.some(x => x.image === f.image)) continue;
    try {
      let r;
      const urls = [f.image].concat(f.original && f.original !== f.image ? [f.original] : []);
      outer: for (const url of urls) for (let attempt = 0; attempt < 3; attempt++) {   // be polite: hosts rate-limit bursts (HTTP 429)
        await sleep(attempt ? Math.min(10000, 1000 * (+(r && r.headers.get('retry-after')) || 2 * attempt)) : 700);
        r = await fetch(url, { headers: { 'User-Agent': UA } });
        if (r.ok) break outer; if (r.status !== 429) break;
      }
      if (!r.ok) throw new Error(r.status);
      const type = r.headers.get('content-type') || '', ext = /png/.test(type) ? 'png' : /webp/.test(type) ? 'webp' : /gif/.test(type) ? 'gif' : 'jpg';
      if (!/^image\//.test(type)) throw new Error('not an image: ' + type);
      const buf = Buffer.from(await r.arrayBuffer()); if (buf.length > 15e6) throw new Error('too large');
      const file = `ref${String(++k).padStart(2, '0')}.${ext}`; fs.writeFileSync(path.join(out, file), buf);
      list.push(Object.assign({ file, query: q }, f));
      console.log(`${file}  ${f.width}x${f.height}  [${f.license || '?'}] ${f.title.slice(0, 70)}\n        ${f.page}`);
    } catch (e) { console.log(`skip ${f.title.slice(0, 60)}: ${e.message}`); }
  }
  fs.writeFileSync(listFile, JSON.stringify(list, null, 1));
  contactSheet(out, list);
  console.log(`\n${list.length} references in ${out} (sources.json has page, licence and author). Look at them, keep the clearest orthographic-ish views.`);
}
// One PNG with every reference as a numbered thumbnail, so they can be reviewed in a single look.
function contactSheet(out, list) {
  const RF = require('./lib/reference.cjs'), RN = require('./lib/render.cjs'), T = 220, cols = 4, rows = Math.ceil(list.length / cols) || 1, gap = 6;
  const W = cols * (T + gap) + gap, H = rows * (T + gap + 16) + gap, img = new Uint8Array(W * H * 4);
  for (let i = 0; i < W * H; i++) { img[i * 4] = 38; img[i * 4 + 1] = 42; img[i * 4 + 2] = 50; img[i * 4 + 3] = 255; }
  list.forEach((f, k) => {
    const ox = gap + (k % cols) * (T + gap), oy = gap + Math.floor(k / cols) * (T + gap + 16);
    RN.text(img, W, ox, oy, f.file.replace(/\.[a-z]+$/, ''), 2);
    try {
      const im = RF.loadImage(path.join(out, f.file)), s = T / Math.max(im.w, im.h), w = Math.max(1, Math.round(im.w * s)), h = Math.max(1, Math.round(im.h * s));
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
        const sx = Math.min(im.w - 1, Math.floor(x / s)), sy = Math.min(im.h - 1, Math.floor(y / s)), so = (sy * im.w + sx) * 4, o = ((oy + 14 + y) * W + ox + x) * 4, a = im.rgba[so + 3] / 255;
        for (let c = 0; c < 3; c++) img[o + c] = im.rgba[so + c] * a + 255 * (1 - a);
      }
    } catch (e) { RN.text(img, W, ox, oy + 40, 'UNREADABLE', 2, [255, 120, 100]); }
  });
  fs.writeFileSync(path.join(out, 'contact-sheet.png'), RN.png(W, H, img));
  console.log('wrote ' + path.join(out, 'contact-sheet.png') + ' (all references numbered, one look)');
}
main().catch(e => { console.error(e.message); process.exit(1); });
