#!/usr/bin/env node
// Self-test for rvfx.cjs. Run: node selftest.cjs   (exits non-zero on failure)
'use strict';
const fs = require('fs'), path = require('path'), zlib = require('zlib');
const R = require('./rvfx.cjs');
let fails = 0;
const ok = (cond, msg) => { console.log((cond ? 'ok   ' : 'FAIL ') + msg); if (!cond) fails++; };
const near = (a, b, eps) => Math.abs(a - b) <= (eps || 1e-3);

// 1. Closed-form motion matches step-by-step integration of Roblox's rule: speed halves every 1/Drag s, plus acceleration.
{
  const L = { drag: 2.5, accel: [1, -30, 0.5] }, p = { p0: [0, 1, 0], v0: [12, 20, -6] };
  let x = p.p0.slice(), v = p.v0.slice(); const dt = 1e-4, T = 0.8, k = L.drag * Math.LN2;
  for (let t = 0; t < T - dt / 2; t += dt) for (let i = 0; i < 3; i++) { v[i] += (L.accel[i] - k * v[i]) * dt; x[i] += v[i] * dt; }
  const m = R.motion(L, p, T);
  ok([0, 1, 2].every(i => near(m.p[i], x[i], 5e-3) && near(m.v[i], v[i], 5e-3)), 'motion with drag + acceleration matches numeric integration');
  const h = R.motion({ drag: 1, accel: [0, 0, 0] }, { p0: [0, 0, 0], v0: [10, 0, 0] }, 1);
  ok(near(h.v[0], 5), 'drag 1 halves the speed in 1 second');
  const g = R.motion({ drag: 0, accel: [0, -10, 0] }, { p0: [0, 0, 0], v0: [0, 10, 0] }, 2);
  ok(near(g.p[1], 0) && near(g.v[1], -10), 'no drag: plain ballistic motion');
}
// 2. Sequences and tracks
{
  ok(near(R.seqAt([[0, 0, 0], [0.5, 4, 0], [1, 0, 0]], 0.25), 2), 'number sequence interpolates');
  ok(near(R.seqAt([[0, 1, 0.5], [1, 1, 0.5]], 0.3, -1), 0.5), 'envelope offsets by the particle random');
  ok(near(R.colAt([[0, [1, 0, 0]], [1, [0, 0, 1]]], 0.5)[2], 0.5), 'colour sequence interpolates');
  ok(near(R.trackAt([[0.2, 10], [0.4, 0]], 0.1), 10) && near(R.trackAt([[0.2, 10], [0.4, 0]], 0.3), 5) && near(R.trackAt([[0.2, 10], [0.4, 0]], 9), 0), 'tracks clamp and interpolate');
}
// 3. Validation catches mistakes
{
  const bad = R.compile({ name: 'X', duration: 1, layers: [{ name: 'A', texture: 'nope', burst: 1, colour: '#fff' }, { name: 'A', burst: 1 }, { name: 'B' }] });
  ok(bad.errors.some(e => /texture/.test(e)) && bad.errors.some(e => /duplicate/.test(e)) && bad.errors.some(e => /burst/.test(e)), 'bad texture, duplicate name and missing emission are errors');
  ok(bad.warnings.some(w => /colour/.test(w)), 'unknown fields are flagged');
  const pop = R.compile({ name: 'P', duration: 1, layers: [{ name: 'A', burst: 1, transparency: 0, size: 2 }] });
  ok(pop.warnings.some(w => /pop/.test(w)), 'a particle that dies opaque at full size warns');
}
// 4. Determinism, scale, loop bookkeeping
{
  const spec = { name: 'D', duration: 1, layers: [{ name: 'A', burst: 20, speed: [5, 10], spread: [180, 180], lifetime: [0.5, 1], size: [1, 0] }] };
  const a = R.compile(spec), b = R.compile(spec), s2 = R.compile(Object.assign({}, spec, { scale: 2 }));
  ok(JSON.stringify(a.layers[0].P) === JSON.stringify(b.layers[0].P), 'same spec gives the same particles');
  ok(near(s2.layers[0].P[3].v0[0], a.layers[0].P[3].v0[0] * 2) && near(s2.layers[0].size[0][1], 2), 'scale multiplies speed and size');
  ok(a.total >= 1 && a.total <= 2 && a.peak === 20, 'tail and peak count are right for a burst');
  const loop = R.compile({ name: 'L', duration: 1, loop: true, layers: [{ name: 'A', rate: 10, lifetime: 2.5, size: [1, 0] }] });
  ok(R.liveCount(loop, loop.layers[0], 0.5) === 25 && R.liveCount(loop, loop.layers[0], 7.3) === 25, 'a loop is in steady state at every time (rate x lifetime alive)');
}
// 5. Examples compile clean and export well-formed output
{
  const dir = path.join(__dirname, '..', 'examples');
  for (const f of fs.readdirSync(dir).filter(f => f.endsWith('.json'))) {
    const c = R.compile(JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')));
    ok(!c.errors.length && !c.warnings.length, `${f}: no errors or warnings` + (c.errors.concat(c.warnings).length ? ' -> ' + c.errors.concat(c.warnings).join(' | ') : ''));
    const x = R.toRbxmx(c), open = (x.match(/<Item /g) || []).length, close = (x.match(/<\/Item>/g) || []).length;
    const refs = [...x.matchAll(/<Ref name="\w+">(RBX\d+)<\/Ref>/g)].map(m => m[1]);
    ok(open === close && open > 3 && refs.every(r => x.includes(`referent="${r}"`)) && !/NaN|undefined|Infinity/.test(x), `${f}: rbxmx is balanced, refs resolve, no NaN`);
    const l = R.toLuau(c), made = (l.match(/^I\[\d+\] = make\(/gm) || []).length;
    ok(made === open && l.includes('I[1].Source = SOURCE') && !/NaN|undefined|Infinity/.test(l.replace(/math\.huge/g, '')), `${f}: Luau builds the same ${open} instances`);
    const n = { emit: 0 }; for (const L of c.layers) if (L.kind === 'particles') n.emit += L.bursts.length;
    ok(((R.tree(c).props.Source.v.split('local WINDOWS')[0]).match(/^\t\{"\w+", [\d.]+, \d+\},$/gm) || []).length === n.emit, `${f}: every burst is scheduled in the module`);
  }
}
// 6. Rendering and PNG
{
  const c = R.compile({ name: 'Rn', duration: 1, dummy: 'none', layers: [{ name: 'A', burst: 1, lifetime: 1, size: 6, transparency: 0.2, color: '#ff0000', at: [0, 3, 0] }] });
  const T = R.makeTarget(80, 60), live = R.render(c, 0.1, Object.assign({ bg: 'dark' }, c.view), T);
  let red = 0; for (let i = 0; i < T.buf.length; i += 3) if (T.buf[i] > 0.5 && T.buf[i + 1] < 0.3) red++;
  ok(live === 1 && red > 20, 'a red particle renders red pixels');
  const buf = R.texturePng('ring', 32);
  ok(buf.slice(1, 4).toString() === 'PNG' && buf.readUInt32BE(16) === 32, 'texture PNG has a valid header');
  const idat = buf.indexOf('IDAT'), len = buf.readUInt32BE(idat - 4), raw = zlib.inflateSync(buf.slice(idat + 4, idat + 4 + len));
  ok(raw.length === (32 * 4 + 1) * 32 && raw[(16 * (32 * 4 + 1)) + 1 + 16 * 4 + 3] < 30 && raw[(16 * (32 * 4 + 1)) + 1 + 28 * 4 + 3] > 120, 'ring texture is hollow in the middle and solid on the rim');
  const sb = R.storyboard(c); ok(sb.length > 1000 && sb.slice(1, 4).toString() === 'PNG', 'storyboard PNG is produced');
}
// 7. Periodic noise: textures tile and animations loop
{
  let worst = 0;
  for (let i = 0; i < 40; i++) { const x = i * 0.137, y = i * 0.291, z = i * 0.071;
    worst = Math.max(worst, Math.abs(R.gnoise(x, y, z, 3, 5, 2) - R.gnoise(x + 3, y + 5, z + 2, 3, 5, 2)), Math.abs(R.fbm(x, y, z, 4, 2, 4, 1) - R.fbm(x + 2, y + 4, z + 1, 4, 2, 4, 1))); }
  ok(worst < 1e-9, 'gradient noise and fbm wrap exactly at their periods');
  const a = R.worley(0.3, 0.7, 4, 4, 0, 1), b = R.worley(4.3, 8.7, 4, 4, 0, 1), c2 = R.worley(0.3, 0.7, 4, 4, 1, 1);
  ok(near(a[0], b[0], 1e-9) && near(a[1], b[1], 1e-9) && near(a[0], c2[0], 1e-9), 'worley cells wrap in space and loop in time');
  for (const [n, T] of Object.entries(R.TILE)) { let seam = 0, inner = 0, m = 0;     // a jump across the wrap must be no bigger than across any other line
    for (let i = 0; i < 128; i++) { const q = (i + 0.5) / 128; seam += Math.abs(T.f(0.0005, q) - T.f(0.9995, q)) + Math.abs(T.f(q, 0.0005) - T.f(q, 0.9995));
      for (const c0 of [0.13, 0.29, 0.41, 0.58, 0.77]) inner += (Math.abs(T.f(c0 - 0.0005, q) - T.f(c0 + 0.0005, q)) + Math.abs(T.f(q, c0 - 0.0005) - T.f(q, c0 + 0.0005))) / 5;
      for (let j = 0; j < 16; j++) m += T.f(q, (j + 0.5) / 16); }
    ok(seam / 256 < 2 * inner / 256 + 0.004 && m / 2048 > 0.03, `tiling texture ${n} is seamless (wrap ${(seam / 256).toFixed(4)} vs inside ${(inner / 256).toFixed(4)}) and not empty`); }
}
// 8. Flipbooks: loops close, one-shots end empty, nothing touches the frame edge
{
  for (const [n, A] of Object.entries(R.ANIM)) {
    let edge = 0, last = 0, mid = 0, loopGap = 0;
    for (let i = 0; i < 48; i++) { const s = (i + 0.5) / 48 * 2 - 1;
      for (const t of [0, 0.3, 0.6, 0.9]) edge = Math.max(edge, A.f(0.995, s, t), A.f(-0.995, s, t), A.f(s, 0.995, t), A.base === 'bottom' ? 0 : A.f(s, -0.995, t));
      for (let j = 0; j < 48; j++) { const u = s, v = (j + 0.5) / 48 * 2 - 1; mid = Math.max(mid, A.f(u, v, 0.5));
        if (A.mode === 'OneShot') last = Math.max(last, A.f(u, v, 1)); else loopGap = Math.max(loopGap, Math.abs(A.f(u, v, 1) - A.f(u, v, 0))); } }
    ok(mid > 0.3, `flipbook ${n} has visible content mid-animation`);
    ok(edge < 0.06, `flipbook ${n} fades out before the frame edge${A.base ? ' (its base sits on the bottom edge)' : ''} (max ${edge.toFixed(3)})`);
    ok(A.mode === 'OneShot' ? last < 0.02 : loopGap < 1e-6, A.mode === 'OneShot' ? `one-shot flipbook ${n} ends empty (max ${last.toFixed(3)})` : `looping flipbook ${n}: frame after the last equals the first`);
  }
  const L1 = { flip: { mode: 'OneShot', fps: [20, 20], startRandom: false, blend: false } }, p = { fr: 0, f0: 0, id: 1 };
  ok(R.frameOf(L1, p, 0, 0, 16)[0] === 0 && R.frameOf(L1, p, 0, 0.5, 16)[0] === 8 && R.frameOf(L1, p, 0, 0.999, 16)[0] === 15, 'OneShot spreads 16 frames over the lifetime');
  const L2 = { flip: { mode: 'Loop', fps: [10, 10], startRandom: false, blend: true } }, f2 = R.frameOf(L2, p, 1.65, 0, 16);
  ok(f2[0] === 0 && f2[1] === 1 && near(f2[2], 0.5), 'Loop advances at FlipbookFramerate, wraps, and blends toward the next frame');
  const L3 = { flip: { mode: 'PingPong', fps: [10, 10], startRandom: false, blend: false } };
  ok(R.frameOf(L3, p, 1.5, 0, 16)[0] === 15 && R.frameOf(L3, p, 1.7, 0, 16)[0] === 13, 'PingPong plays back down after the last frame');
  const buf = R.flipbookPng('ripple'), idat = buf.indexOf('IDAT'), raw = zlib.inflateSync(buf.slice(idat + 4, idat + 4 + buf.readUInt32BE(idat - 4))), row = 1024 * 4 + 1;
  let border = 0; for (let k = 0; k < 1024; k++) border = Math.max(border, raw[255 * row + 1 + k * 4 + 3], raw[k * row + 1 + 256 * 4 + 3]);
  ok(buf.readUInt32BE(16) === 1024 && buf.readUInt32BE(20) === 1024 && border === 0, 'flipbook sheet is 1024x1024 with empty spacing between the 4x4 frames');
}
// 9. Water features export to Studio
{
  const c = R.compile({ name: 'Wt', duration: 1, loop: true, layers: [
    { name: 'Fb', texture: 'foam', rate: 2, lifetime: 1, flipbook: { fps: 12, blend: true } },
    { name: 'Bm', type: 'beam', from: [0, 5, 0], to: [0, 0, 0], texture: 'waterflow', textureLength: 4, textureSpeed: 2, faceCamera: false, widthAxis: [1, 0, 0] },
    { name: 'Sf', type: 'surface', at: [0, 0.1, 0], size: [10, 6], texture: 'caustics', tile: 5, scroll: [1, -0.5], transparency: [[0, 0.2], [0.5, 0.6], [1, 0.2]] } ] });
  ok(!c.errors.length && !c.warnings.length, 'flipbook, scrolling beam and surface layers compile clean' + (c.errors.concat(c.warnings).length ? ' -> ' + c.errors.concat(c.warnings).join(' | ') : ''));
  const x = R.toRbxmx(c), src = R.tree(c).props.Source.v, l = R.toLuau(c);
  ok(/<token name="FlipbookLayout">2<\/token>/.test(x) && /<token name="FlipbookMode">0<\/token>/.test(x) && /<NumberRange name="FlipbookFramerate">12 12 <\/NumberRange>/.test(x) && /<bool name="FlipbookBlendFrames">true/.test(x), 'flipbook properties are exported (Grid4x4, Loop, 12 fps, blended)');
  ok(/<token name="TextureMode">1<\/token>/.test(x) && /<float name="TextureLength">4<\/float>/.test(x) && /<float name="TextureSpeed">2<\/float>/.test(x) && /<bool name="FaceCamera">false/.test(x), 'beam exports Wrap mode, length, speed and FaceCamera off');
  const bm = c.layers[1], a0 = R.tree(c).kids[0].kids[0].kids.find(k => k.name === 'Bm_A0').props.CFrame.m;
  ok(near(a0[1], 1) && near(a0[4], 0) && near(a0[7], 0) && near(a0[3], -1), 'flat beam attachments: +X along the beam, +Y along widthAxis');
  ok(/<Item class="Texture"/.test(x) && /<token name="Face">1<\/token>/.test(x) && /<float name="StudsPerTileU">5<\/float>/.test(x), 'surface exports a Texture on the Top face with its tile size');
  ok(/\{"Sf", 1, 0\.5, 5, 5\}/.test(src) && /OffsetStudsU/.test(src) && /\{"Sf", "Transparency", \{/.test(src), 'module scrolls the surface texture and animates its transparency');
  ok(/pcall\(function\(\) o\[k\] = v end\)/.test(l), 'command-bar builder skips properties an older Studio lacks instead of failing');
  const bad = R.compile({ name: 'B', duration: 1, layers: [{ name: 'A', texture: 'waterflow', burst: 1 }, { name: 'C', type: 'beam', from: [0, 1, 0], to: [0, 0, 0], texture: 'splash' }, { name: 'D', type: 'surface', texture: 'glow' }] });
  ok(bad.errors.length === 3, 'tiling textures on particles, flipbooks on beams and non-tiling surfaces are errors');
  const T = R.makeTarget(80, 60), view = Object.assign({ bg: 'dark' }, c.view); R.render(c, 0.4, view, T);
  let lit = 0; for (let i = 0; i < T.buf.length; i += 3) if (T.buf[i] > 0.3) lit++;
  ok(lit > 30, 'flipbook particles, scrolling beams and surfaces all render');
}
// 9. preview.html embeds the browser runtime, never the Node CLI (fs, require, process.exit)
{
  const src = fs.readFileSync(path.join(__dirname, 'rvfx.cjs'), 'utf8');
  const runtime = src.replace(/\n?\/\/ PREVIEW-STRIP-START[\s\S]*?\/\/ PREVIEW-STRIP-END\r?\n?/, '\n');
  ok(!/process\.exit|require\.main|module\.exports/.test(runtime) && /G\.RVfx = Object\.assign\(API, \{ mount \}\)/.test(runtime), 'preview runtime strips the Node CLI and keeps the browser mount');
}
console.log(fails ? `\n${fails} FAILED` : '\nall passed');
process.exit(fails ? 1 : 0);
