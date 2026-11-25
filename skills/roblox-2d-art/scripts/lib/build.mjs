// The build pipeline: art spec -> SVG layers rendered by the browser -> per-layer effects -> stages composited ->
// asset effects -> (pixel art) -> exports with alpha bleeding -> checks -> review sheet.
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import * as R from './raster.mjs';
import * as FX from './fx.mjs';
import * as C from './color.mjs';
import * as PNG from './png.mjs';
import { makeKit } from './kit.mjs';
import { browser } from './chrome.mjs';
import { kind as kindOf } from './presets.mjs';
import { fontCssFor, familiesIn } from './fonts.mjs';
import { runChecks, setChecks } from './checks.mjs';
import * as DS from './design.mjs';
import { reviewAsset, reviewSet } from './review.mjs';
import { pack } from './sheet.mjs';

// ---------------------------------------------------------------------------------------------------------
// Loading specs: .mjs/.js (default export: asset | asset[] | { set, assets } | (k) => any of those), .json, .svg
export async function loadSpec(file) {
  const abs = path.resolve(file), dir = path.dirname(abs), ext = path.extname(abs).toLowerCase(), k = makeKit({ dir });
  let spec;
  if (ext === '.json') spec = JSON.parse(fs.readFileSync(abs, 'utf8'));
  else if (ext === '.svg') spec = { name: path.basename(abs, ext).replace(/\W+/g, '_'), layers: [{ name: 'art', svg: kk => kk.svgFile(abs, 0, 0, kk.W, kk.H) }] };   // scaled into the kind's canvas
  else { const mod = await import(pathToFileURL(abs).href + '?t=' + Date.now()); spec = mod.default; if (typeof spec === 'function') spec = await spec(k); }
  let set = {}, assets;
  if (Array.isArray(spec)) assets = spec; else if (spec && spec.assets) { set = spec.set || {}; assets = spec.assets; } else assets = [spec];
  return { assets: assets.flat().filter(Boolean), set, dir, k, file: abs };
}

const asObj = (v, key = 'width') => v == null || v === false ? null : typeof v === 'number' ? { [key]: v } : typeof v === 'string' ? { style: v } : v === true ? {} : v;
const sizeOf = s => typeof s === 'number' ? [s, s] : s;

export function normalize(a, set) {
  const K = kindOf(a.kind || set.kind), pick = (f, d) => a[f] !== undefined ? a[f] : set[f] !== undefined ? set[f] : d;
  const [W, H] = sizeOf(a.size || set.size || K.size);
  const layers = (a.layers || (a.svg ? [{ name: 'art', svg: a.svg }] : [])).map((L, i) => Object.assign({ name: L.name || `layer${i + 1}`, stage: 'main' }, L));
  const fit = pick('fit', K.fit);
  return Object.assign({}, a, {
    name: (a.name || 'asset').replace(/[^\w.-]+/g, '_'), K, W, H, layers, light: pick('light', 'tl'), shadeDefaults: pick('shade', {}),
    // one outline, or several stacked outward (e.g. dark ink then a white rim for dark UIs)
    outline: [].concat(pick('outline', K.outline) ?? []).map(o => asObj(o)).filter(Boolean),
    shadow: asObj(pick('shadow', K.shadow), 'dy'), glow: asObj(pick('glow', null), 'blur'),
    fit: fit === true ? { pad: 0.06 } : fit || null, pixel: pick('pixel', null), exports: (a.export && a.export.sizes) || pick('exports', K.exports) || [],
    white: (a.export && a.export.white) || pick('white', false), ss: pick('ss', null), refs: a.refs || set.refs || [], credits: a.credits || set.credits || [],
  });
}

// ---------------------------------------------------------------------------------------------------------
export async function buildFile(file, opts = {}) { const spec = await loadSpec(file); if (typeof opts.kind === 'string') spec.set.kind = spec.set.kind || opts.kind; return buildSpec(spec, opts); }
// Build assets given as objects (used by `post`): assets [{...}], dir for relative paths.
export async function buildObjects(assets, dir, opts = {}) { return buildSpec({ assets, set: {}, dir, k: makeKit({ dir }), file: path.join(dir, '(generated)') }, opts); }

async function buildSpec(spec, opts) {
  const out = path.resolve(opts.out || path.join(path.dirname(spec.file), 'out'));
  fs.mkdirSync(out, { recursive: true });
  let assets = spec.assets.map(a => normalize(a, spec.set));
  if (opts.only) { const want = opts.only.split(','); assets = assets.filter(a => want.some(w => a.name.includes(w))); }
  if (!assets.length) throw new Error('no assets to build (check --only)');
  const b = await browser(), results = [];
  for (const a of assets) {
    const t0 = Date.now(), res = await buildAsset(a, spec, out, b, opts);
    results.push(res);
    const bad = res.checks.filter(c => c.level !== 'PASS');
    console.log(`\n${a.name} (${a.K.name}, ${a.W}x${a.H}) ${((Date.now() - t0) / 1000).toFixed(1)}s`);
    for (const f of res.files) console.log(`  wrote ${path.relative(process.cwd(), f)}`);
    for (const c of res.checks) if (c.level !== 'PASS' || opts.verbose) console.log(`  ${c.level.padEnd(4)} ${c.name}: ${c.msg}`);
    if (!bad.length) console.log(`  all ${res.checks.length} checks pass`);
    for (const n of res.notes) console.log('  note: ' + n);
  }
  if (results.length > 1) {
    const sc = setChecks(results); results.setChecks = sc;
    if (sc.length) { console.log('\nset consistency:'); for (const c of sc) console.log(`  ${c.level.padEnd(4)} ${c.name}: ${c.msg}`); }
    if (opts.review !== false) { const f = path.join(out, 'review-set.png'); fs.writeFileSync(f, await reviewSet(results, b)); console.log(`\nwrote ${path.relative(process.cwd(), f)} (whole set side by side: compare size, weight, colour)`); }
  }
  writeManifest(out, results, spec);
  return results;
}

async function buildAsset(a, spec, out, b, opts) {
  const { k } = spec, notes = [], files = [];
  // supersample small canvases so effects stay smooth; pixel art renders large then snaps to the grid
  const grid = a.pixel ? sizeOf(a.pixel.size || 32) : null;
  const ss = a.ss || (grid ? Math.max(1, Math.round(Math.max(grid[0] * 12, 384) / a.W)) : a.W * a.H < 400 * 400 ? Math.min(4, Math.ceil(512 / Math.max(a.W, a.H))) : 1);
  const IW = a.W * ss, IH = a.H * ss, px = v => v * ss;

  if (a.pixels) return finishPixelGrid(a, spec, out, b, opts, notes);

  const frameCount = a.frames ? (a.frames.count || 1) : 1, frameImgs = [];
  let first = null;
  for (let fi = 0; fi < frameCount; fi++) {
    const ctx = { w: a.W, h: a.H, t: frameCount > 1 ? fi / frameCount : 0, frame: fi, frames: frameCount, asset: a };
    k.W = a.W; k.H = a.H; k.ctx = ctx;
    const markupOf = L => typeof L.svg === 'function' ? L.svg(k, ctx) : L.svg || '';
    const layers = a.layers.filter(L => !L.hidden).map(L => Object.assign({}, L, { markup: markupOf(L) }));
    // fonts used anywhere in this asset
    const fams = familiesIn(layers.map(L => L.markup).join('') + k.defsMarkup());
    if (fams.length) { const { css, notes: fn } = await fontCssFor(fams); if (css !== b.getFontCss()) b.setFontCss(css); for (const n of fn) if (!notes.includes(n)) notes.push(n); }
    const doc = (markup, tf) => `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${IW}" height="${IH}" viewBox="0 0 ${a.W} ${a.H}"><defs>${k.defsMarkup()}</defs>${tf ? `<g transform="${tf}">${markup}</g>` : markup}</svg>`;
    const renderF = async (markup, tf) => R.fromRGBA8(await b.render(doc(markup, tf), IW, IH));

    // fit: scale + centre the main stage so a set of icons fills the canvas the same way
    let tf = null, fitScale = 1;
    if (a.fit && layers.some(L => L.stage === 'main')) {
      const all = await renderF(layers.filter(L => L.stage === 'main' || (L.stage === 'front' && L.fit !== false)).map(L => L.markup).join(''));
      const bb = R.bbox(R.alpha(all), IW, IH);
      if (bb) {
        const fxm = a.outline.reduce((t, o) => t + (o.width ?? 12), 0) + Math.max(a.shadow ? (a.shadow.blur ?? 0) * 2 + Math.abs(a.shadow.dy ?? 0) : 0, a.glow ? (a.glow.blur ?? 12) * 2 + (a.glow.spread || 0) : 0);
        // (pixel art also needs room for its 1 px outline)
        const pad = (a.fit.pad ?? 0.06) * Math.min(a.W, a.H) + fxm + (grid ? 1.6 * a.W / grid[0] : 0), bw = bb.w / ss, bh = bb.h / ss, s = Math.min((a.W - 2 * pad) / bw, (a.H - 2 * pad) / bh, a.fit.maxScale ?? 4);
        let tx = a.W / 2 - s * bb.cx / ss, ty = a.H / 2 - s * bb.cy / ss;
        if (a.fit.anchor === 'bottom') ty = a.H - pad - s * bb.y1 / ss;
        if (a.shadow && !a.fit.anchor) ty -= (a.shadow.dy ?? 0) / 2;      // optical centre: leave room for the drop shadow
        tf = `translate(${tx.toFixed(2)} ${ty.toFixed(2)}) scale(${s.toFixed(4)})`; fitScale = s;
      }
    }

    const stage = { back: R.create(IW, IH), main: R.create(IW, IH), front: R.create(IW, IH) }, raw = {}, lastRaw = {}, post = [];
    // composed images (thumbnails, banners, icons, badges, logos) keep a small mask per layer for the design analysis
    const studied = fi === 0 && !grid && DS.TEXTUAL.has(a.K.name), [aw, ah] = DS.analysisSize(a.W, a.H), layerInfo = [];
    for (const L of layers) {
      // post layers are canvas-wide overlays (colour grade, grain, light rays) blended over the finished picture
      if (L.stage === 'post') { post.push({ img: await renderF(L.markup, null), blend: L.blend || 'normal', opacity: L.opacity ?? 1 }); continue; }
      const st = stage[L.stage] ? L.stage : 'main';
      let img = await renderF(L.markup, st !== 'back' && L.fit !== false ? tf : null);   // front layers follow the fit unless fit: false
      const rawA = R.alpha(img);
      if (L.clip) { const m = L.clip === true || L.clip === 'prev' ? lastRaw[st] : raw[L.clip]; if (m) R.multiplyAlpha(img, m); else notes.push(`layer ${L.name}: clip target "${L.clip}" not found`); }
      raw[L.name] = rawA; if (!L.clip) lastRaw[st] = rawA;
      const sh = L.shade === true ? Object.assign({}, a.shadeDefaults) : typeof L.shade === 'string' ? Object.assign({}, a.shadeDefaults, { style: L.shade }) : L.shade ? Object.assign({}, a.shadeDefaults, L.shade) : null;
      if (sh) img = FX.shade(img, Object.assign({ light: a.light }, sh, sh.depth ? { depth: px(sh.depth) } : {}, sh.rimWidth ? { rimWidth: px(sh.rimWidth) } : {}, sh.soft != null ? { soft: sh.soft } : {}));
      const il = asObj(L.innerLine); if (il) img = FX.outline(img, Object.assign({}, il, { position: 'inside', width: px(il.width ?? 3) }));
      const ol = asObj(L.outline); if (ol) img = FX.outline(img, Object.assign({}, ol, { width: px(ol.width ?? 4) }));
      const T = stage[st];
      if (studied) {
        const mask = DS.maskOf(img, aw, ah), bb = R.bbox(R.alpha(img), IW, IH, 0.5);
        layerInfo.push({ name: L.name, stage: st, role: L.role || null, text: /<text\b/.test(L.markup), mask, area: mask.reduce((p, q) => p + q, 0) / mask.length,
          bbox: bb && { x0: bb.x0 / ss, y0: bb.y0 / ss, x1: bb.x1 / ss, y1: bb.y1 / ss }, texts: /<text\b/.test(L.markup) ? DS.textsIn(L.markup, k.defsMarkup()) : [], scale: st !== 'back' && L.fit !== false && tf ? fitScale : 1 });
      }
      const cast = asObj(L.cast, 'dy'); if (cast) R.composite(T, FX.shadowOf(img, scaleFx(cast, px, { dy: 6, blur: 4, opacity: 0.3, color: '#1b1028' })), 'normal', 1, R.alpha(T));
      const lsh = asObj(L.shadow, 'dy'); if (lsh) R.composite(T, FX.shadowOf(img, scaleFx(lsh, px, { dy: 6, blur: 6, opacity: 0.3 })));
      const lg = asObj(L.glow, 'blur'); if (lg) R.composite(T, FX.glowOf(img, scaleFx(lg, px, { blur: 10 })));
      R.composite(T, img, L.blend || 'normal', L.opacity ?? 1);
    }
    let main = stage.main;
    for (const ol of a.outline) if (!(a.pixel && ol.vector !== true)) main = FX.outline(main, Object.assign({}, ol, { width: px(ol.width ?? 12) }));
    const silhouette = main;
    if (a.glow) main = R.under(main, FX.glowOf(main, scaleFx(a.glow, px, { blur: 14 })));
    if (a.shadow) main = R.under(main, FX.shadowOf(main, scaleFx(a.shadow, px, { dy: 8, blur: 6, opacity: 0.3 })));
    const fin = R.clone(stage.back); R.composite(fin, main); R.composite(fin, stage.front);
    if (post.length) { const cover = R.alpha(fin); for (const P of post) R.composite(fin, P.img, P.blend, P.opacity, cover); }
    const down = F => ss > 1 && !grid ? R.resize(F, a.W, a.H) : F, design = down(fin);
    if (fi === 0) first = { design, mainA: R.alpha(down(stage.main)), silA: R.alpha(down(silhouette)), frontA: R.alpha(down(stage.front)), backA: R.alpha(down(stage.back)),
      analysis: studied ? DS.analyze(design, { a, layers: layerInfo, outlineWidth: a.outline.reduce((t, o) => t + (o.width ?? 12), 0) }) : null };
    frameImgs.push(design);
  }

  // ---- export ----
  const write = (file, img8, bleed = true) => { const f = path.join(out, file); const im = { w: img8.w, h: img8.h, rgba: new Uint8Array(img8.rgba) }; fs.writeFileSync(f, PNG.encode(bleed ? R.bleed(im) : im)); files.push(f); return f; };
  let main8, palette = null, pixelScale = null;
  if (grid) {
    const p = FX.pixelate(first.design, Object.assign({}, a.pixel, { width: grid[0], height: grid[1] }));
    main8 = { w: p.w, h: p.h, rgba: p.rgba }; palette = p.palette;
    pixelScale = a.pixel.scale || Math.max(1, Math.round(512 / Math.max(grid[0], grid[1])));
    write(`${a.name}.png`, main8);
    write(`${a.name}@${pixelScale}x.png`, R.nearestUp(main8, pixelScale));
    notes.push(`pixel art: ${grid[0]}x${grid[1]}, ${palette.length} colours. In Roblox set ImageLabel.ResampleMode = Enum.ResamplerMode.Pixelated (upload either file).`);
  } else {
    main8 = R.toRGBA8(first.design); write(`${a.name}.png`, main8);
    for (const s of a.exports) { const [ew, eh] = Array.isArray(s) ? s : [s, Math.round(s * a.H / a.W)]; if (ew >= a.W) continue; write(`${a.name}_${ew}.png`, R.toRGBA8(R.resize(first.design, ew, eh))); }
    if (a.white) write(`${a.name}_white.png`, FX.whiteOf(main8, a.white === 'value'));
  }
  let sheetInfo = null;
  if (frameImgs.length > 1) {
    const fr = frameImgs.map((F, i) => ({ name: `${a.name}_${i + 1}`, img: grid ? (() => { const p = FX.pixelate(F, Object.assign({}, a.pixel, { width: grid[0], height: grid[1], palette: palette })); return { w: p.w, h: p.h, rgba: p.rgba }; })() : R.toRGBA8(F) }));
    const fo = a.frames, flip = fo.layout === 'flipbook' || a.K.name === 'particle' ? (fo.grid || (fr.length <= 4 ? 2 : fr.length <= 16 ? 4 : 8)) : null;
    const pk = pack(fr, { name: a.name, cols: fo.cols, pad: fo.pad ?? (grid ? 1 : 2), flipbook: flip, size: fo.sheetSize, fps: fo.fps, mode: fo.mode });
    write(`${a.name}_sheet.png`, pk.img, false);
    const lf = path.join(out, `${a.name}_sheet.luau`); fs.writeFileSync(lf, pk.luau); files.push(lf);
    const sk = grid ? Math.max(1, Math.min(pixelScale, Math.floor(1024 / Math.max(pk.img.w, pk.img.h)))) : 1;
    if (grid && sk > 1) write(`${a.name}_sheet@${sk}x.png`, R.nearestUp(pk.img, sk), false);
    sheetInfo = { frames: fr.length, w: pk.img.w, h: pk.img.h, rects: pk.rects, flipbook: flip };
  }
  let slice = null;
  if (a.slice) { const [l, t, r, bt] = a.slice.length === 4 ? a.slice : [a.slice[0], a.slice[0], a.slice[0], a.slice[0]]; slice = { insets: [l, t, r, bt], rect: [l, t, a.W - r, a.H - bt], luau: `label.ScaleType = Enum.ScaleType.Slice\nlabel.SliceCenter = Rect.new(${l}, ${t}, ${a.W - r}, ${a.H - bt})\nlabel.SliceScale = 1 -- shrink (e.g. 0.5) to make the corners smaller on screen` }; notes.push('9-slice: ' + slice.luau.replace(/\n/g, '; ')); }

  const bytes = fs.statSync(files[0]).size;
  const checks = runChecks({ a, img8: main8, design: grid ? null : first.design, mainA: grid ? null : first.mainA, silA: grid ? null : first.silA, frontA: grid ? null : first.frontA, backA: grid ? null : first.backA, bytes, palette, slice, sheet: sheetInfo });
  if (first.analysis) checks.push(...DS.designChecks(first.analysis, a));
  const res = { name: a.name, kind: a.K.name, w: a.W, h: a.H, files, checks, notes, slice, sheet: sheetInfo, palette, pixel: grid ? { grid, scale: pixelScale } : null, refs: a.refs, credits: a.credits, main: files[0], img8: main8, design: grid ? null : first.design, mainA: grid ? null : first.mainA, analysis: first.analysis, a };
  if (opts.review !== false) { const f = path.join(out, `review-${a.name}.png`); fs.writeFileSync(f, await reviewAsset(res, b, spec.dir)); files.push(f); res.review = f; }
  return res;
}

function scaleFx(o, px, defaults) {
  const r = Object.assign({}, defaults, o);
  for (const key of ['dx', 'dy', 'blur', 'spread', 'width']) if (r[key] != null) r[key] = px(r[key]);
  return r;
}

// Hand-placed pixel art: { pixels: { palette: { '.': null, k: '#222034', ... }, rows: ['..kk..', ...] } }
async function finishPixelGrid(a, spec, out, b, opts, notes) {
  const { palette, rows } = a.pixels, h = rows.length, w = Math.max(...rows.map(r => r.length)), rgba = new Uint8Array(w * h * 4), files = [];
  const pal = {}; for (const [ch, col] of Object.entries(palette)) pal[ch] = col ? C.parse(col).map(v => Math.round(v * 255)) : null;
  rows.forEach((row, y) => [...row].forEach((ch, x) => { const c = pal[ch]; if (c === undefined && ch !== ' ' && ch !== '.') notes.push(`pixel char "${ch}" not in palette (left transparent)`); if (!c) return; const o = (y * w + x) * 4; rgba[o] = c[0]; rgba[o + 1] = c[1]; rgba[o + 2] = c[2]; rgba[o + 3] = 255; }));
  const img8 = { w, h, rgba }, scale = a.pixels.scale || Math.max(1, Math.round(512 / Math.max(w, h)));
  for (const [f, im] of [[`${a.name}.png`, img8], [`${a.name}@${scale}x.png`, R.nearestUp(img8, scale)]]) { const p = path.join(out, f); fs.writeFileSync(p, PNG.encode(R.bleed({ w: im.w, h: im.h, rgba: new Uint8Array(im.rgba) }))); files.push(p); }
  notes.push(`pixel art: ${w}x${h}. In Roblox set ImageLabel.ResampleMode = Enum.ResamplerMode.Pixelated.`);
  const used = [...new Set(rows.join('').split(''))].filter(ch => pal[ch]).map(ch => C.hex(pal[ch].map(v => v / 255)));
  const checks = runChecks({ a: Object.assign({}, a, { W: w, H: h }), img8, bytes: fs.statSync(files[0]).size, palette: used });
  const res = { name: a.name, kind: a.K.name, w, h, files, checks, notes, palette: used, pixel: { grid: [w, h], scale }, refs: a.refs, credits: a.credits, main: files[0], img8, a };
  if (opts.review !== false) { const f = path.join(out, `review-${a.name}.png`); fs.writeFileSync(f, await reviewAsset(res, b, spec.dir)); files.push(f); res.review = f; }
  return res;
}

function writeManifest(out, results, spec) {
  const m = { generated: new Date().toISOString(), spec: path.relative(out, spec.file).split(path.sep).join('/'), assets: results.map(r => ({ name: r.name, kind: r.kind, size: [r.w, r.h], files: r.files.map(f => path.relative(out, f).replace(/\\/g, '/')), checks: r.checks.map(c => `${c.level} ${c.name}: ${c.msg}`), slice: r.slice ? { SliceCenter: r.slice.rect } : undefined, sheet: r.sheet ? { frames: r.sheet.frames, size: [r.sheet.w, r.sheet.h], flipbook: r.sheet.flipbook } : undefined, palette: r.palette || undefined, refs: r.refs.length ? r.refs : undefined, credits: r.credits.length ? r.credits : undefined })) };
  fs.writeFileSync(path.join(out, 'manifest.json'), JSON.stringify(m, null, 1));
  const cred = results.flatMap(r => r.credits.map(c => typeof c === 'string' ? `- ${r.name}: ${c}` : `- ${r.name}: ${c.title || c.file || ''} by ${c.author || '?'} (${c.license || '?'}) ${c.url || c.page || ''}${c.changes ? ' - ' + c.changes : ''}`));
  if (cred.length) fs.writeFileSync(path.join(out, 'CREDITS.md'), `# Credits\n\nArt in this folder adapts the following openly licensed works:\n\n${cred.join('\n')}\n`);
}
