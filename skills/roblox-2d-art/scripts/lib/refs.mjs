// Reference search. Two kinds of openly licensed material:
//  - icons: vector icons and emoji from the Iconify API (Fluent Emoji, Noto, Twemoji, OpenMoji, game-icons.net,
//    ...). They show how designers already simplified the object: silhouette, key features, colour blocking.
//  - photos: Wikimedia Commons and Openverse (commercially reusable licences). They show the real thing:
//    proportions, materials, colours, details.
// Files land in --out (default refs/) with sources.json (title, page, licence, author) and contact-sheet.png.
import fs from 'node:fs';
import path from 'node:path';
import { browser } from './chrome.mjs';

const UA = 'roblox-2d-art-skill/1.0 (reference lookup)';
const ICON_SETS = {
  color: ['fluent-emoji-flat', 'fluent-emoji', 'noto', 'twemoji', 'openmoji', 'emojione', 'fxemoji', 'streamline-emojis'],
  shape: ['game-icons'],
  ui: ['ph', 'tabler', 'lucide', 'mdi', 'material-symbols', 'icon-park'],
  pixel: ['pixelarticons'],
};
const OK_LICENCE = /^(MIT|ISC|Apache-2\.0|CC0-1\.0|CC-BY-[0-9.]+|CC-BY-SA-[0-9.]+|OFL-1\.1|BSD-[23]-Clause|Unlicense)$/i;
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function get(url, json = true) { for (let i = 0; i < 3; i++) { const r = await fetch(url, { headers: { 'User-Agent': UA } }); if (r.ok) return json ? r.json() : r; if (r.status !== 429) throw new Error(`${r.status} ${url}`); await sleep(1500 * (i + 1)); } throw new Error('rate limited: ' + url); }

async function iconify(q, n, sets) {
  const d = await get(`https://api.iconify.design/search?query=${encodeURIComponent(q)}&limit=${Math.max(32, n * 3)}&prefixes=${sets.join(',')}`);
  const cols = d.collections || {}, out = [];
  for (const full of d.icons || []) {
    const [prefix, name] = full.split(':'), c = cols[prefix]; if (!c || !OK_LICENCE.test(c.license?.spdx || '')) continue;
    out.push({ source: 'iconify', kind: 'icon', set: prefix, title: `${c.name}: ${name}`, image: `https://api.iconify.design/${prefix}/${name}.svg?height=512`, page: `https://icon-sets.iconify.design/${prefix}/?icon-filter=${name}`, license: c.license.spdx, licenseUrl: c.license.url, author: c.author?.name || '', ext: 'svg' });
  }
  // keep a mix of sets rather than 20 variants from one
  const by = {}; for (const r of out) (by[r.set] ||= []).push(r);
  const mixed = []; for (let i = 0; mixed.length < n && Object.values(by).some(l => l[i]); i++) for (const l of Object.values(by)) if (l[i] && mixed.length < n) mixed.push(l[i]);
  return mixed;
}
async function commons(q, n) {
  const d = await get(`https://commons.wikimedia.org/w/api.php?action=query&format=json&generator=search&gsrnamespace=6&gsrlimit=${n}&gsrsearch=${encodeURIComponent('filetype:bitmap ' + q)}&prop=imageinfo&iiprop=url|size|mime|extmetadata&iiurlwidth=800`);
  return Object.values(d.query?.pages || {}).sort((a, b) => a.index - b.index).map(p => { const i = p.imageinfo[0], md = i.extmetadata || {}, v = k => (md[k] && String(md[k].value).replace(/<[^>]+>/g, '').trim()) || ''; return { source: 'commons', kind: 'photo', title: p.title.replace(/^File:/, ''), page: i.descriptionurl, image: i.thumburl || i.url, license: v('LicenseShortName'), author: v('Artist') }; });
}
async function openverse(q, n) {
  const d = await get(`https://api.openverse.org/v1/images/?q=${encodeURIComponent(q)}&page_size=${n}&license_type=commercial,modification`);
  return (d.results || []).map(r => ({ source: 'openverse', kind: 'photo', title: r.title || 'untitled', page: r.foreign_landing_url, image: r.url, license: `${r.license} ${r.license_version || ''}`.trim(), author: r.creator || '' }));
}

export async function refs(q, o = {}) {
  if (!q) throw new Error('usage: refs "<object>" [--kind icons|photos|both] [--sets color|shape|ui|pixel|<prefix,...>] [--n 12] [--out refs]');
  const out = path.resolve(o.out || 'refs'), n = +(o.n || 12), kind = o.kind || 'both';
  fs.mkdirSync(out, { recursive: true });
  const setsArg = String(o.sets || 'color,shape'), sets = setsArg.split(',').flatMap(s => ICON_SETS[s] || [s]);
  const found = [];
  if (kind !== 'photos') try { found.push(...await iconify(q, n, sets)); } catch (e) { console.log('iconify: ' + e.message); }
  if (kind !== 'icons') {
    try { found.push(...await commons(q, Math.ceil(n / 2))); } catch (e) { console.log('commons: ' + e.message); }
    try { found.push(...await openverse(q, Math.ceil(n / 2))); } catch (e) { console.log('openverse: ' + e.message); }
  }
  const listFile = path.join(out, 'sources.json'), list = fs.existsSync(listFile) ? JSON.parse(fs.readFileSync(listFile, 'utf8')) : [];
  let k = list.length;
  for (const f of found) {
    if (list.some(x => x.image === f.image)) continue;
    try {
      await sleep(f.source === 'iconify' ? 80 : 600);
      const r = await get(f.image, false), type = r.headers.get('content-type') || '';
      if (!/^image\//.test(type)) throw new Error('not an image: ' + type);
      const ext = f.ext || (/png/.test(type) ? 'png' : /webp/.test(type) ? 'webp' : /gif/.test(type) ? 'gif' : /svg/.test(type) ? 'svg' : 'jpg');
      const buf = Buffer.from(await r.arrayBuffer()); if (buf.length > 15e6) throw new Error('too large');
      const file = `ref${String(++k).padStart(2, '0')}${f.set ? '-' + f.set : ''}.${ext}`; fs.writeFileSync(path.join(out, file), buf);
      list.push(Object.assign({ file, query: q }, f));
      console.log(`${file.padEnd(34)} [${f.license || '?'}] ${f.title.slice(0, 70)}`);
    } catch (e) { console.log(`skip ${f.title.slice(0, 50)}: ${e.message}`); }
  }
  fs.writeFileSync(listFile, JSON.stringify(list, null, 1));
  if (!list.length) { console.log('nothing found: try a simpler noun, a synonym, or --kind photos'); return; }
  const sheet = path.join(out, 'contact-sheet.png'); fs.writeFileSync(sheet, await contactSheet(out, list));
  console.log(`\n${list.length} references in ${out}\nlook at ${sheet} (numbered), then open the best few at full size.`);
}

async function contactSheet(dir, list) {
  const b = await browser(), mime = { svg: 'svg+xml', jpg: 'jpeg' };
  const cells = list.map(f => { const ext = path.extname(f.file).slice(1).toLowerCase(); let src = ''; try { src = `data:image/${mime[ext] || ext};base64,${fs.readFileSync(path.join(dir, f.file)).toString('base64')}`; } catch { } return `<div class="c"><div class="i"><img src="${src}"></div><b>${f.file}</b><span>${(f.license || '?')} · ${(f.set || f.source)}</span></div>`; }).join('');
  const html = `<style>body{margin:0;background:#26292e;font:12px 'Segoe UI',sans-serif;color:#ddd}.g{display:grid;grid-template-columns:repeat(5,220px);gap:8px;padding:10px}.c{background:#33373d;border-radius:6px;padding:6px}.i{height:180px;display:flex;align-items:center;justify-content:center;background:#f4f4f4;border-radius:4px}.i img{max-width:200px;max-height:170px}b{display:block;margin-top:4px;color:#fff}span{color:#aab}</style><div class="g">${cells}</div>`;
  return b.renderPage(html, 1180);
}
