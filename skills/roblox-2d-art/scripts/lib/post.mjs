// Commands that work on existing images: `post` (clean up / finish a render, screenshot, AI image or drawing as a
// Roblox asset), `check` (run the checks + review sheet on any PNG), `sheet` (pack frames into a sprite sheet).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import * as PNG from './png.mjs';
import * as R from './raster.mjs';
import * as FX from './fx.mjs';
import { browser } from './chrome.mjs';
import { buildObjects, normalize } from './build.mjs';
import { runChecks } from './checks.mjs';
import { reviewAsset } from './review.mjs';
import { pack } from './sheet.mjs';
import { kind as kindOf } from './presets.mjs';

const num = (v, d) => v === undefined || v === true ? d : +v;
export async function post(file, o = {}) {
  if (!file) throw new Error('usage: post <image> --kind item [--key [tolerance]] [--outline 14|false] [--shadow|--no-shadow] [--fit|--no-fit] [--size 512] [--shade toon|soft|gloss] [--pixel 32] [--name X] [--out dir]');
  const b = await browser(), K = kindOf(o.kind || 'item'); let img = await b.decodeFile(path.resolve(file), 2048);
  if (o.key) img = FX.keyOut(img, { tolerance: num(o.key, 0.08), color: o['key-color'] });
  const tmp = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'rart-post-')), 'src.png'); fs.writeFileSync(tmp, PNG.encode(img));
  const size = o.size ? String(o.size).split(/[x,]/).map(Number) : K.name === 'banner' || K.name === 'logo' ? [img.w, img.h] : K.size, [W, H] = [size[0], size[1] || size[0]];
  const asset = {
    name: o.name || path.basename(file).replace(/\.[^.]+$/, '').replace(/\W+/g, '_'), kind: K.name, size: [W, H],
    layers: [{ name: 'image', svg: k => k.image(tmp, 0, 0, W, H, { fit: o.cover ? 'cover' : 'contain' }), stage: K.opaque && !o.key ? 'back' : 'main', shade: o.shade || null }],
  };
  if (o.outline !== undefined) asset.outline = o.outline === false ? null : { width: num(o.outline, 14), color: o['outline-color'] || 'auto' };
  if (o.shadow !== undefined) asset.shadow = o.shadow === false ? null : { dy: num(o.shadow, 8), blur: 6, opacity: 0.3 };
  if (o.fit !== undefined) asset.fit = o.fit === false ? null : { pad: num(o.fit, 0.06) };
  if (o.pixel) asset.pixel = { size: num(o.pixel, 32), palette: o.palette || 'auto', colors: num(o.colors, 16) };
  return buildObjects([asset], path.dirname(path.resolve(file)), { out: o.out || path.join(path.dirname(path.resolve(file)), 'out'), review: o.review });
}

export async function checkFile(file, o = {}) {
  if (!file) throw new Error('usage: check <image.png> --kind item|ui-icon|game-icon|thumbnail|badge|pass|product|...');
  const b = await browser(), img8 = await b.decodeFile(path.resolve(file)), a = normalize({ name: path.basename(file).replace(/\.[^.]+$/, ''), kind: o.kind || 'item', size: [img8.w, img8.h], fit: o.kind === 'thumbnail' ? null : undefined }, {});
  const checks = runChecks({ a, img8, design: R.fromRGBA8(img8), bytes: fs.statSync(file).size });
  console.log(`${path.basename(file)} as ${a.K.name} (${img8.w}x${img8.h})`); for (const c of checks) console.log(`  ${c.level.padEnd(4)} ${c.name}: ${c.msg}`);
  if (o.review !== false) { const out = path.resolve(o.out || path.dirname(path.resolve(file)), `review-${a.name}.png`); fs.mkdirSync(path.dirname(out), { recursive: true }); fs.writeFileSync(out, await reviewAsset({ name: a.name, kind: a.K.name, w: img8.w, h: img8.h, img8, checks, notes: [], files: [], refs: [], a }, b, path.dirname(path.resolve(file)))); console.log(`wrote ${out}`); }
  return checks;
}

const natural = (p, q) => p.localeCompare(q, undefined, { numeric: true });
export async function sheetCmd(inputs, o = {}) {
  let files = []; for (const i of inputs) { const p = path.resolve(i); if (fs.statSync(p).isDirectory()) files.push(...fs.readdirSync(p).filter(f => /\.(png|jpe?g|webp)$/i.test(f) && !/sheet|review/i.test(f)).sort(natural).map(f => path.join(p, f))); else files.push(p); }
  if (!files.length) throw new Error('usage: sheet <frame.png ...|dir> [--out sheet.png] [--cols n] [--cell 128] [--pad 2] [--flipbook 2|4|8] [--fps 24] [--name Sheet]');
  const b = await browser(), frames = []; for (const f of files) frames.push({ name: path.basename(f).replace(/\.[^.]+$/, ''), img: await b.decodeFile(f) });
  const out = path.resolve(o.out || 'sheet.png'), name = o.name || path.basename(out, '.png');
  const cell = o.cell ? String(o.cell).split(/[x,]/).map(Number) : null;
  const pk = pack(frames, { name, cell: cell ? [cell[0], cell[1] || cell[0]] : undefined, cols: o.cols ? +o.cols : undefined, pad: o.pad != null ? +o.pad : 2, flipbook: o.flipbook ? +o.flipbook : null, size: o.size ? +o.size : undefined, fps: o.fps ? +o.fps : undefined, mode: o.mode });
  fs.mkdirSync(path.dirname(out), { recursive: true }); fs.writeFileSync(out, PNG.encode(pk.img)); fs.writeFileSync(out.replace(/\.png$/i, '.luau'), pk.luau);
  console.log(`packed ${frames.length} frames into ${out} (${pk.img.w}x${pk.img.h}${pk.img.w > 1024 || pk.img.h > 1024 ? ' - over 1024 px, Roblox will downscale it: use --cell to shrink frames or split the set' : ''})\nwrote ${out.replace(/\.png$/i, '.luau')}`);
}
