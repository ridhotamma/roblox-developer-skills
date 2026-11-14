#!/usr/bin/env node
'use strict';
// rmodel: low-poly model builder. Spec JSON -> tested, rendered, exported model (.glb for Blender / three.js / Roblox).
// Needs only Node 18+ (no packages). Run with no arguments for help.
const fs = require('fs'), path = require('path');
const MD = require('./lib/model.cjs'), CK = require('./lib/checks.cjs'), RN = require('./lib/render.cjs'), EX = require('./lib/export.cjs'), RF = require('./lib/reference.cjs'), PV = require('./lib/preview.cjs');
const G = require('./lib/geometry.cjs');

const HELP = `rmodel - low-poly model builder

  node rmodel.cjs build <spec.json> [more.json ...] [--out DIR] [--fast]
      compile, run every test, render review sheets, export .glb/.obj/.blender.py/.three.js and preview.html
      --fast skips the PNG sheets (tests and exports only). Exit code 1 when any test fails.
  node rmodel.cjs test <spec.json>
      run the tests only and print the report
  node rmodel.cjs trace <image> [--view side|front|top] [--crop x0,y0,x1,y1] [--flip] [--threshold 0.2]
                        [--stations 12] [--length L] [--height H] [--out mask.png]
      cut the object out of a reference image (PNG; JPG/WebP are converted), print its aspect ratio and
      height profile, and with --length/--height suggest loft stations in metres
  node rmodel.cjs compare <spec.json> <image> [--view side] [--crop ...] [--flip] [--out overlay.png]
      overlay the model's silhouette on a reference image and score the match
  node rmodel.cjs render <spec.json> [--clip Name] [--time s] [--yaw deg] [--pitch deg] [--view front|side|top] [--out file.png]
      one render, for close looks at a detail
`;
function args(argv) {
  const pos = [], o = {};
  for (let i = 0; i < argv.length; i++) { const a = argv[i]; if (a.startsWith('--')) { const k = a.slice(2), n = argv[i + 1]; if (n == null || n.startsWith('--')) o[k] = true; else { o[k] = n; i++; } } else pos.push(a); }
  return { pos, o };
}
const readSpec = f => { const s = JSON.parse(fs.readFileSync(f, 'utf8')); return [].concat(s).map(x => Object.assign(x, { __file: path.resolve(f) })); };
function compileSpec(s) { const file = s.__file; delete s.__file; const m = MD.compile(s); m.file = file; return m; }

function cmdBuild(files, o) {
  const out = path.resolve(o.out || 'out'); fs.mkdirSync(out, { recursive: true });
  const entries = []; let failed = 0;
  for (const f of files) for (const s of readSpec(f)) {
    const model = compileSpec(s), t0 = Date.now();
    console.log(`\n=== ${model.name} (${path.basename(model.file)}) ===`);
    const written = [];
    const results = CK.run(model, { baseDir: path.dirname(model.file), onOverlay: (name, buf) => { fs.writeFileSync(path.join(out, name), buf); written.push(name); } });
    const sum = CK.summary(results); console.log(sum.text); if (sum.fail) failed++;
    if (model.errors.length) { console.log('spec errors: nothing exported'); continue; }
    const glb = EX.toGlb(model), verr = EX.validateGlb(glb);
    if (verr.length) { console.log('GLB VALIDATION FAILED:\n  ' + verr.join('\n  ')); failed++; }
    fs.writeFileSync(path.join(out, model.name + '.glb'), glb); written.push(model.name + '.glb');
    const { obj, mtl } = EX.toObj(model); fs.writeFileSync(path.join(out, model.name + '.obj'), obj); fs.writeFileSync(path.join(out, model.name + '.mtl'), mtl); written.push(model.name + '.obj', model.name + '.mtl');
    fs.writeFileSync(path.join(out, model.name + '.blender.py'), EX.blenderScript(model)); written.push(model.name + '.blender.py');
    fs.writeFileSync(path.join(out, model.name + '.three.js'), EX.threeModule(model)); written.push(model.name + '.three.js');
    if (!o.fast) {
      fs.writeFileSync(path.join(out, `sheet-${model.name}.png`), RN.modelSheet(model)); written.push(`sheet-${model.name}.png`);
      for (const clip of model.clips) { const fn = `anim-${model.name}-${clip.name}.png`; fs.writeFileSync(path.join(out, fn), RN.clipSheet(model, clip)); written.push(fn); }
    }
    const rest = MD.posedMeshes(model, null, 0), all = []; rest.forEach(m => all.push(...m.pos)); const B = G.bounds(all);
    const report = { name: model.name, title: model.title, triangles: RN.triCount(model), parts: model.nodes.length - 1, size: B.size, results, clips: model.clips.map(c => ({ name: c.name, duration: c.duration, loop: c.loop })) };
    fs.writeFileSync(path.join(out, `report-${model.name}.json`), JSON.stringify(report, null, 1)); written.push(`report-${model.name}.json`);
    entries.push({ name: model.name, title: model.title, description: model.description, glb, clips: report.clips.map((c, i) => Object.assign(c, { description: model.clips[i].description })), checks: results, dims: B.size, tris: report.triangles, parts: report.parts, ground: model.ground, refs: (model.reference && model.reference.sources) || [] });
    console.log(`size W ${B.size[0].toFixed(3)} × H ${B.size[1].toFixed(3)} × D ${B.size[2].toFixed(3)} m · ${report.triangles} tris · ${(glb.length / 1024).toFixed(1)} KB glb · ${Date.now() - t0} ms`);
    console.log('wrote ' + written.join(', '));
  }
  if (entries.length) { fs.writeFileSync(path.join(out, 'preview.html'), PV.previewHtml(entries)); console.log(`\nwrote ${path.join(out, 'preview.html')} (${entries.length} model${entries.length > 1 ? 's' : ''})`); }
  console.log(failed ? `\n${failed} model(s) have failing tests` : '\nall tests passed');
  process.exit(failed ? 1 : 0);
}
function cmdTest(files) {
  let failed = 0;
  for (const f of files) for (const s of readSpec(f)) { const m = compileSpec(s); console.log(`=== ${m.name}`); const sum = CK.summary(CK.run(m, { baseDir: path.dirname(path.resolve(f)) })); console.log(sum.text + '\n'); if (sum.fail) failed++; }
  process.exit(failed ? 1 : 0);
}
const cropOpt = o => (o.crop ? o.crop.split(',').map(Number) : undefined);
function cmdTrace(file, o) {
  const sil = RF.extract(RF.loadImage(file), { crop: cropOpt(o), flip: !!o.flip, threshold: o.threshold != null ? +o.threshold : undefined, invert: !!o.invert });
  const n = +(o.stations || 12), prof = RF.profile(sil, n);
  console.log(`traced ${path.basename(file)}: ${sil.method}, object ${sil.w}×${sil.h} px, aspect (width/height) ${sil.aspect.toFixed(3)}, fills ${(sil.cover * 100).toFixed(0)}% of its box${sil.touchesEdge ? '\nWARNING: the object touches the image edge, so it is probably cropped and the numbers are off' : ''}`);
  console.log(`\nprofile along the width (u = 0 left .. 1 right; top/bottom/thick as a fraction of the height):`);
  console.log('   u     top   bottom  thick'); prof.forEach(p => console.log(p.top == null ? `  ${p.u.toFixed(2)}   (empty)` : `  ${p.u.toFixed(2)}  ${p.top.toFixed(3)}  ${p.bottom.toFixed(3)}  ${p.thick.toFixed(3)}`));
  if (o.length || o.height) {
    const L = +(o.length || (+o.height * sil.aspect)), H = +(o.height || (+o.length / sil.aspect));
    console.log(`\nloft stations for length ${L} m (along z, image right = front +z) and height ${H} m, bottom at y = ${o.base || 0}:`);
    console.log(JSON.stringify(RF.stationsFromTrace(sil, n, L, H, +(o.base || 0))));
    console.log('Add a "w" (width, from the front or top reference, or an estimate) to every station before using them.');
  }
  const outFile = o.out || path.join(path.dirname(file), path.basename(file).replace(/\.[^.]+$/, '') + '-mask.png');
  const img = new Uint8Array(sil.w * sil.h * 4); for (let i = 0; i < sil.w * sil.h; i++) { const v = sil.mask[i] ? 30 : 235; img[i * 4] = img[i * 4 + 1] = img[i * 4 + 2] = v; img[i * 4 + 3] = 255; }
  fs.writeFileSync(outFile, RN.png(sil.w, sil.h, img)); console.log(`\nwrote ${outFile} (black = what was detected as the object; check it before trusting the numbers)`);
}
function cmdCompare(specFile, image, o) {
  const m = compileSpec(readSpec(specFile)[0]); if (m.errors.length) { console.log(m.errors.join('\n')); process.exit(1); }
  const r = RF.compare(m, image, { view: o.view || 'side', crop: cropOpt(o), flip: !!o.flip, threshold: o.threshold != null ? +o.threshold : undefined });
  console.log(`${r.view} silhouette match ${(r.score * 100).toFixed(1)}% · aspect model ${r.modelAspect.toFixed(3)} vs reference ${r.refAspect.toFixed(3)} (${(r.aspectErr * 100).toFixed(1)}%)${r.flipped ? ' · reference faces the other way (auto-flipped)' : ''}`);
  console.log('\n   u    ref top/bottom   model top/bottom');
  r.refProfile.forEach((p, i) => { const q = r.modelProfile[i], f = x => (x == null ? '  -  ' : x.toFixed(2)); console.log(`  ${p.u.toFixed(2)}   ${f(p.top)} / ${f(p.bottom)}      ${f(q.top)} / ${f(q.bottom)}`); });
  const outFile = o.out || `compare-${m.name}-${r.view}.png`; fs.writeFileSync(outFile, r.overlay); console.log(`\nwrote ${outFile}`);
}
function cmdRender(specFile, o) {
  const m = compileSpec(readSpec(specFile)[0]); if (m.errors.length) { console.log(m.errors.join('\n')); process.exit(1); }
  const clip = o.clip ? m.clips.find(c => c.name === o.clip) : null; if (o.clip && !clip) { console.log('no clip ' + o.clip); process.exit(1); }
  const view = o.view ? { ortho: o.view, w: 800, h: 600 } : { yaw: o.yaw != null ? +o.yaw : 35, pitch: o.pitch != null ? +o.pitch : 22, dist: o.dist != null ? +o.dist : 1, w: 800, h: 600 };
  const r = RN.render(m, { clip, time: +(o.time || 0), view, highlight: o.highlight ? new Set(String(o.highlight).split(',')) : null });
  const img = new Uint8Array(800 * 600 * 4); RN.toRGBA(r.T, img, 0, 0, 800);
  const outFile = o.out || `render-${m.name}.png`; fs.writeFileSync(outFile, RN.png(800, 600, img)); console.log('wrote ' + outFile);
}

if (require.main === module) {
  const { pos, o } = args(process.argv.slice(2));
  let cmd = pos[0]; if (cmd && cmd.endsWith('.json')) { cmd = 'build'; pos.unshift('build'); }
  if (cmd === 'build' && pos.length > 1) cmdBuild(pos.slice(1), o);
  else if (cmd === 'test' && pos.length > 1) cmdTest(pos.slice(1));
  else if (cmd === 'trace' && pos[1]) cmdTrace(pos[1], o);
  else if (cmd === 'compare' && pos[2]) cmdCompare(pos[1], pos[2], o);
  else if (cmd === 'render' && pos[1]) cmdRender(pos[1], o);
  else { console.log(HELP); process.exit(cmd ? 2 : 0); }
}
module.exports = { MD, CK, RN, EX, RF, PV, G };
