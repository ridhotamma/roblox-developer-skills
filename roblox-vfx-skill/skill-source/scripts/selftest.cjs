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
console.log(fails ? `\n${fails} FAILED` : '\nall passed');
process.exit(fails ? 1 : 0);
