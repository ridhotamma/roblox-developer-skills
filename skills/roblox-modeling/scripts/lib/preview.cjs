'use strict';
// preview.html: loads the exported .glb files with three.js's own GLTFLoader (so the preview doubles as the
// three.js integration test), plays every clip, shows blueprint views, dimensions, test results and a reference overlay.
const THREE_VER = '0.160.0';
const esc = s => String(s).replace(/[<>&"]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' })[c]);

function previewHtml(entries) {   // entries: [{ name, title, description, glb: Buffer, clips: [{name, loop, duration, description}], checks: [...], dims: [x,y,z], tris, parts }]
  const data = entries.map(e => ({ name: e.name, title: e.title, description: e.description, glb: e.glb.toString('base64'), clips: e.clips, checks: e.checks, dims: e.dims, tris: e.tris, parts: e.parts, ground: e.ground, refs: e.refs || [] }));
  const title = entries.length === 1 ? entries[0].title : 'Low-poly models';
  return `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<style>
:root{--bg:#f4f5f7;--panel:#ffffff;--line:#dde1e7;--ink:#1d2129;--dim:#5f6b7a;--acc:#e8772e;--ok:#1f8a4c;--bad:#c9372c;--warn:#a86a00;--stage:#e9ecf0}
@media (prefers-color-scheme: dark){:root:not([data-theme="light"]){--bg:#14171d;--panel:#1c2028;--line:#2c323d;--ink:#e8ebf0;--dim:#98a2b3;--acc:#ff9a4a;--ok:#4cc38a;--bad:#ff6b5e;--warn:#ffc35a;--stage:#101317}}
:root[data-theme="dark"]{--bg:#14171d;--panel:#1c2028;--line:#2c323d;--ink:#e8ebf0;--dim:#98a2b3;--acc:#ff9a4a;--ok:#4cc38a;--bad:#ff6b5e;--warn:#ffc35a;--stage:#101317}
*{box-sizing:border-box}html,body{margin:0;background:var(--bg);color:var(--ink);font:14px/1.45 system-ui,-apple-system,"Segoe UI",sans-serif}
main{max-width:1280px;margin:0 auto;padding:16px}h1{font-size:20px;margin:0 0 2px}.sub{color:var(--dim);margin:0 0 12px;max-width:80ch}
.tabs,.row{display:flex;gap:6px;flex-wrap:wrap;align-items:center}.tabs{margin-bottom:12px}
button,select{font:inherit;color:var(--ink);background:var(--panel);border:1px solid var(--line);border-radius:6px;padding:6px 12px;cursor:pointer}
button:hover{border-color:var(--dim)}button.on{background:var(--acc);border-color:var(--acc);color:#1a1205;font-weight:600}
.grid{display:grid;grid-template-columns:minmax(0,1fr) 340px;gap:16px;align-items:start}@media(max-width:900px){.grid{grid-template-columns:1fr}}
.stage{position:relative;border:1px solid var(--line);border-radius:8px;overflow:hidden;background:var(--stage);aspect-ratio:4/3}
.stage canvas{display:block;width:100%;height:100%;touch-action:none}
.hud{position:absolute;left:10px;top:8px;font:12px ui-monospace,Menlo,monospace;color:var(--dim);pointer-events:none;white-space:pre}
.bar{margin-top:10px}.bar input[type=range]{flex:1;min-width:140px;accent-color:var(--acc)}.time{font-variant-numeric:tabular-nums;color:var(--dim);min-width:110px}
.side{background:var(--panel);border:1px solid var(--line);border-radius:8px;padding:12px}
.side h2{font-size:12px;letter-spacing:.06em;text-transform:uppercase;color:var(--dim);margin:14px 0 6px}.side h2:first-child{margin-top:0}
.ck{display:flex;gap:8px;padding:4px 0;border-top:1px solid var(--line);font-size:13px}.ck:first-child{border-top:0}.ck b{min-width:38px;font-size:11px;padding-top:2px}
.pass{color:var(--ok)}.fail{color:var(--bad)}.warn{color:var(--warn)}.hint{color:var(--dim);font-size:12px;margin-top:8px}
.ref{margin-top:10px;padding:10px;border:1px dashed var(--line);border-radius:8px;color:var(--dim);font-size:13px}
label{display:inline-flex;gap:6px;align-items:center;cursor:pointer}
</style>
<script type="importmap">{"imports":{"three":"https://cdn.jsdelivr.net/npm/three@${THREE_VER}/build/three.module.js","three/addons/":"https://cdn.jsdelivr.net/npm/three@${THREE_VER}/examples/jsm/"}}</script>
</head><body><main>
<h1 id="title"></h1><p class="sub" id="desc"></p>
<div class="tabs" id="tabs"></div>
<div class="grid">
  <div>
    <div class="stage" id="stage"><div class="hud" id="hud"></div></div>
    <div class="row bar"><span id="clips" class="row"></span></div>
    <div class="row bar"><button id="play">Pause</button><input type="range" id="scrub" min="0" max="1000" value="0"><span class="time" id="time">0.00 s</span>
      <select id="speed"><option value="0.25">0.25×</option><option value="0.5">0.5×</option><option value="1" selected>1×</option><option value="2">2×</option></select></div>
    <div class="row bar"><span>View</span><button data-view="persp" class="on">3D</button><button data-view="front">Front</button><button data-view="side">Side</button><button data-view="top">Top</button>
      <label><input type="checkbox" id="wire"> Wireframe</label><label><input type="checkbox" id="bbox" checked> Dimensions</label><label><input type="checkbox" id="grid" checked> Grid</label>
      <button id="dl">Download .glb</button></div>
    <div class="ref" id="refbox">Drop a reference image here (or <label style="text-decoration:underline"><input type="file" id="reffile" accept="image/*" hidden>choose one</label>) to trace over it in Front / Side / Top view.
      <span class="row" style="margin-top:6px"><span>Opacity</span><input type="range" id="refop" min="0" max="100" value="50"><span>Scale</span><input type="range" id="refsc" min="20" max="300" value="100"></span></div>
  </div>
  <aside class="side"><h2>Model</h2><div id="info"></div><h2>Tests</h2><div id="checks"></div>
    <p class="hint">Drag to orbit, scroll to zoom, right-drag to pan. This page loads the exported .glb with three.js's GLTFLoader, the same way your app will.</p></aside>
</div></main>
<script>window.RMODEL = ${JSON.stringify(data).replace(/</g, '\\u003c')};</script>
<script type="module">
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
const D = window.RMODEL, $ = id => document.getElementById(id);
const status = window.__rmodel = { loaded: 0, errors: [], models: {} };
const stage = $('stage'), renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
renderer.setPixelRatio(Math.min(2, devicePixelRatio)); renderer.shadowMap.enabled = true; renderer.outputColorSpace = THREE.SRGBColorSpace;
stage.appendChild(renderer.domElement);
const scene = new THREE.Scene();
scene.add(new THREE.HemisphereLight(0xffffff, 0x8a8f99, 1.4));
const sun = new THREE.DirectionalLight(0xffffff, 2.2); sun.position.set(3, 6, 4); sun.castShadow = true; sun.shadow.mapSize.set(2048, 2048); scene.add(sun);
const persp = new THREE.PerspectiveCamera(35, 4 / 3, 0.001, 1000), ortho = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.001, 1000);
let cam = persp; const controls = new OrbitControls(persp, renderer.domElement); controls.enableDamping = true;
const floor = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.ShadowMaterial({ opacity: 0.22 })); floor.rotation.x = -Math.PI / 2; floor.receiveShadow = true; scene.add(floor);
let grid = null, boxHelper = null, labels = null, refPlane = null, refTex = null;
const loader = new GLTFLoader(), cache = {};
let cur = null, curIdx = 0, mixer = null, action = null, clipIdx = 0, playing = true, viewName = 'persp';
function b64(s) { const bin = atob(s), u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i); return u.buffer; }
async function load(i) {
  if (cache[i]) return cache[i];
  const gltf = await loader.parseAsync(b64(D[i].glb), '');
  gltf.scene.traverse(o => { if (o.isMesh) { o.castShadow = o.receiveShadow = true; o.material.flatShading = true; o.material.needsUpdate = true; if (o.isSkinnedMesh) o.frustumCulled = false; } });
  status.loaded++; status.models[D[i].name] = { clips: gltf.animations.map(a => a.name), meshes: 0, skinned: 0 };
  gltf.scene.traverse(o => { if (o.isMesh) status.models[D[i].name].meshes++; if (o.isSkinnedMesh) status.models[D[i].name].skinned++; });
  return (cache[i] = gltf);
}
function fmt(v) { return v >= 1 ? v.toFixed(2) + ' m' : (v * 100).toFixed(1) + ' cm'; }
async function pick(i) {
  curIdx = i; [...$('tabs').children].forEach((b, k) => b.classList.toggle('on', k === i));
  const d = D[i]; $('title').textContent = d.title; $('desc').textContent = d.description || '';
  if (cur) scene.remove(cur.scene);
  let g; try { g = await load(i); } catch (e) { status.errors.push(String(e)); $('desc').textContent = 'three.js could not load this .glb: ' + e; return; }
  cur = g; scene.add(g.scene); mixer = new THREE.AnimationMixer(g.scene); action = null;
  const box = new THREE.Box3().setFromObject(g.scene), size = box.getSize(new THREE.Vector3()), c = box.getCenter(new THREE.Vector3()), r = size.length() / 2 || 1;
  cur.r = r; cur.c = c; cur.box = box;
  floor.scale.setScalar(r * 8); floor.position.set(c.x, 0, c.z); floor.visible = d.ground;
  if (grid) scene.remove(grid); const step = [0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10].find(s => r * 2 / s <= 14) || 10, n = Math.ceil(r * 3 / step) * 2;
  grid = new THREE.GridHelper(n * step, n, 0x8892a0, 0xb8c0cc); grid.material.transparent = true; grid.material.opacity = 0.55; grid.position.set(c.x, d.ground ? 0.0005 : box.min.y, c.z); scene.add(grid); grid.visible = $('grid').checked;
  sun.position.set(c.x + r * 3, r * 6, c.z + r * 4); sun.target.position.copy(c); scene.add(sun.target);
  const sc = sun.shadow.camera; sc.left = sc.bottom = -r * 2; sc.right = sc.top = r * 2; sc.near = 0.01; sc.far = r * 20; sc.updateProjectionMatrix();
  if (boxHelper) scene.remove(boxHelper); boxHelper = new THREE.Box3Helper(box, 0xe8772e); scene.add(boxHelper); boxHelper.visible = $('bbox').checked;
  persp.position.set(c.x + r * 1.9, c.y + r * 1.1, c.z + r * 2.7); controls.target.copy(c); persp.near = r / 100; persp.far = r * 100; persp.updateProjectionMatrix();
  $('info').innerHTML = '<div>' + d.tris + ' triangles · ' + d.parts + ' parts</div><div>W ' + fmt(d.dims[0]) + ' · H ' + fmt(d.dims[1]) + ' · D ' + fmt(d.dims[2]) + '</div>' +
    (d.refs.length ? '<div class="hint">Reference: ' + d.refs.map(s => s.url ? '<a href="' + encodeURI(s.url) + '" target="_blank" rel="noopener">' + (s.note || 'source').replace(/[<>&]/g, '') + '</a>' : (s.note || '')).join(' · ') + '</div>' : '');
  $('checks').innerHTML = d.checks.map(k => '<div class="ck"><b class="' + k.status + '">' + k.status.toUpperCase() + '</b><span>' + k.msg.replace(/[<>&]/g, '') + '</span></div>').join('');
  $('clips').innerHTML = '<span>Animation</span>' + (g.animations.length ? '' : ' <span class="hint">none (static model)</span>');
  g.animations.forEach((a, k) => { const b = document.createElement('button'); b.textContent = a.name; b.onclick = () => playClip(k); $('clips').appendChild(b); });
  setView(viewName); if (g.animations.length) playClip(0); else updateHud();
}
function playClip(k) {
  clipIdx = k; [...$('clips').querySelectorAll('button')].forEach((b, j) => b.classList.toggle('on', j === k));
  const clip = cur.animations[k], meta = (D[curIdx].clips || []).find(c => c.name === clip.name) || { loop: true };
  mixer.stopAllAction(); action = mixer.clipAction(clip); action.setLoop(meta.loop ? THREE.LoopRepeat : THREE.LoopOnce, Infinity); action.clampWhenFinished = true; action.reset().play(); playing = true; $('play').textContent = 'Pause';
  action.meta = meta;
}
function setView(v) {
  viewName = v; document.querySelectorAll('[data-view]').forEach(b => b.classList.toggle('on', b.dataset.view === v));
  if (!cur) return; const c = cur.c, r = cur.r;
  if (v === 'persp') { cam = persp; controls.object = persp; controls.enableRotate = true; }
  else {
    cam = ortho; controls.object = ortho; controls.enableRotate = false; const dir = { front: [0, 0, 1], side: [-1, 0, 0], top: [0, 1, 0] }[v];
    ortho.position.set(c.x + dir[0] * r * 6, c.y + dir[1] * r * 6, c.z + dir[2] * r * 6); ortho.up.set(0, v === 'top' ? 0 : 1, v === 'top' ? -1 : 0); controls.target.copy(c); ortho.lookAt(c);
    ortho.zoom = 1; ortho.near = 0.001; ortho.far = r * 20; resize();
  }
  placeRef(); controls.update(); updateHud();
}
function resize() {
  const w = stage.clientWidth, h = stage.clientHeight; renderer.setSize(w, h, false); persp.aspect = w / h; persp.updateProjectionMatrix();
  const r = cur ? cur.r * 1.25 : 1; ortho.left = -r * w / h; ortho.right = r * w / h; ortho.top = r; ortho.bottom = -r; ortho.updateProjectionMatrix();
}
function placeRef() {
  if (!refPlane || !cur) return; refPlane.visible = viewName !== 'persp'; if (!refPlane.visible) return;
  const c = cur.c, r = cur.r, k = $('refsc').value / 100, img = refTex.image, asp = img.width / img.height, h = r * 2 * k, w = h * asp;
  refPlane.scale.set(w, h, 1); refPlane.material.opacity = $('refop').value / 100;
  const dir = { front: [0, 0, 1], side: [-1, 0, 0], top: [0, 1, 0] }[viewName], back = r * 2.5;
  refPlane.position.set(c.x - dir[0] * back, c.y - dir[1] * back, c.z - dir[2] * back); refPlane.lookAt(c.x + dir[0] * 10, c.y + dir[1] * 10, c.z + dir[2] * 10);
  if (viewName === 'top') refPlane.rotation.z = 0;
}
function loadRef(file) {
  const url = URL.createObjectURL(file); new THREE.TextureLoader().load(url, t => {
    t.colorSpace = THREE.SRGBColorSpace; refTex = t; if (refPlane) scene.remove(refPlane);
    refPlane = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ map: t, transparent: true, depthWrite: false, side: THREE.DoubleSide })); refPlane.renderOrder = -1; scene.add(refPlane);
    if (viewName === 'persp') setView('side'); else placeRef();
  });
}
function updateHud() {
  const t = action ? action.time : 0, dur = action ? action.getClip().duration : 0;
  $('time').textContent = t.toFixed(2) + ' / ' + dur.toFixed(2) + ' s'; if (action && document.activeElement !== $('scrub')) $('scrub').value = dur ? Math.round(t / dur * 1000) : 0;
  $('hud').textContent = viewName === 'persp' ? '' : viewName.toUpperCase() + ' (orthographic)' + (viewName === 'side' ? '  front ->' : '');
}
D.forEach((d, i) => { const b = document.createElement('button'); b.textContent = d.title; b.onclick = () => pick(i); $('tabs').appendChild(b); });
if (D.length < 2) $('tabs').style.display = 'none';
$('play').onclick = () => { playing = !playing; $('play').textContent = playing ? 'Pause' : 'Play'; if (playing && action && !action.isRunning()) action.reset().play(); };
$('scrub').oninput = e => { if (!action) return; playing = false; $('play').textContent = 'Play'; action.paused = false; action.enabled = true; if (!action.isRunning()) action.play(); action.time = e.target.value / 1000 * action.getClip().duration; mixer.update(0); updateHud(); };
document.querySelectorAll('[data-view]').forEach(b => b.onclick = () => setView(b.dataset.view));
$('wire').onchange = e => cur && cur.scene.traverse(o => { if (o.isMesh) o.material.wireframe = e.target.checked; });
$('bbox').onchange = e => boxHelper && (boxHelper.visible = e.target.checked);
$('grid').onchange = e => grid && (grid.visible = e.target.checked);
$('reffile').onchange = e => e.target.files[0] && loadRef(e.target.files[0]);
$('refop').oninput = $('refsc').oninput = placeRef;
$('refbox').ondragover = e => e.preventDefault(); $('refbox').ondrop = e => { e.preventDefault(); const f = e.dataTransfer.files[0]; if (f) loadRef(f); };
$('dl').onclick = () => { const d = D[curIdx]; const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([b64(d.glb)], { type: 'model/gltf-binary' })); a.download = d.name + '.glb'; a.click(); };
new ResizeObserver(resize).observe(stage); resize();
const clock = new THREE.Clock();
renderer.setAnimationLoop(() => { const dt = clock.getDelta() * +$('speed').value; if (mixer && playing) mixer.update(dt); controls.update(); if (action) updateHud(); renderer.render(scene, cam); });
pick(0);
</script></body></html>
`;
}
module.exports = { previewHtml, THREE_VER };
