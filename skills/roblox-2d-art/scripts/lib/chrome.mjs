// Headless Chrome / Edge / Chromium over the DevTools protocol (Node 22+ built-in WebSocket; no packages).
// The browser is the SVG renderer (full SVG: paths, gradients, filters, text with web fonts, embedded images)
// and the universal image decoder (JPEG, WebP, GIF, SVG -> RGBA).
import { spawn, execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import * as PNG from './png.mjs';

function findBrowser() {
  const env = process.env.CHROME_PATH || process.env.BROWSER_PATH;
  const L = process.env.LOCALAPPDATA || '', PF = process.env.PROGRAMFILES || 'C:/Program Files', PF86 = process.env['PROGRAMFILES(X86)'] || 'C:/Program Files (x86)';
  const list = [env,
    `${PF}/Google/Chrome/Application/chrome.exe`, `${PF86}/Google/Chrome/Application/chrome.exe`, `${L}/Google/Chrome/Application/chrome.exe`,
    `${PF86}/Microsoft/Edge/Application/msedge.exe`, `${PF}/Microsoft/Edge/Application/msedge.exe`,
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge', '/Applications/Chromium.app/Contents/MacOS/Chromium',
    '/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium', '/usr/bin/chromium-browser', '/usr/bin/microsoft-edge', '/snap/bin/chromium'].filter(Boolean);
  for (const p of list) if (fs.existsSync(p)) return p;
  for (const name of ['google-chrome', 'chromium', 'chromium-browser', 'microsoft-edge', 'chrome']) {
    try { const p = execFileSync(process.platform === 'win32' ? 'where' : 'which', [name], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).split(/\r?\n/)[0].trim(); if (p && fs.existsSync(p)) return p; } catch { /* next */ }
  }
  throw new Error('No Chrome, Edge or Chromium found. Install one or set CHROME_PATH to its executable.');
}

let shared = null;
export async function browser(opts = {}) { if (!shared) shared = await launch(opts); return shared; }
export async function closeBrowser() { if (shared) { const b = shared; shared = null; await b.close(); } }

async function launch({ fontCss = '' } = {}) {
  const exe = findBrowser(), profile = fs.mkdtempSync(path.join(os.tmpdir(), 'rart-chrome-')), work = fs.mkdtempSync(path.join(os.tmpdir(), 'rart-page-'));
  const proc = spawn(exe, ['--headless=new', '--remote-debugging-port=0', `--user-data-dir=${profile}`, '--no-first-run', '--no-default-browser-check',
    '--hide-scrollbars', '--force-color-profile=srgb', '--allow-file-access-from-files', '--disable-gpu', '--disable-extensions', '--mute-audio', 'about:blank'], { stdio: 'ignore' });
  const portFile = path.join(profile, 'DevToolsActivePort'), t0 = Date.now();
  let ws = null;
  while (!ws) {
    if (Date.now() - t0 > 30000) { proc.kill(); throw new Error(`${path.basename(exe)} did not start (no DevToolsActivePort)`); }
    await new Promise(r => setTimeout(r, 60));
    try { const [port, p] = fs.readFileSync(portFile, 'utf8').split(/\r?\n/); if (port && p) ws = `ws://127.0.0.1:${port}${p}`; } catch { /* not yet */ }
  }
  const sock = new WebSocket(ws);
  await new Promise((res, rej) => { sock.addEventListener('open', res, { once: true }); sock.addEventListener('error', rej, { once: true }); });
  let nextId = 1; const pending = new Map(), listeners = new Set();
  sock.addEventListener('message', ev => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) { const { res, rej } = pending.get(m.id); pending.delete(m.id); m.error ? rej(new Error(m.error.message)) : res(m.result); }
    else if (m.method) for (const l of listeners) l(m);
  });
  const send = (method, params = {}, sessionId) => new Promise((res, rej) => { const id = nextId++; pending.set(id, { res, rej }); sock.send(JSON.stringify({ id, method, params, sessionId })); });
  const { targetId } = await send('Target.createTarget', { url: 'about:blank' });
  const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true });
  const s = (m, p) => send(m, p, sessionId);
  await s('Page.enable'); await s('Runtime.enable');
  await s('Emulation.setDefaultBackgroundColorOverride', { color: { r: 0, g: 0, b: 0, a: 0 } });
  const evaluate = async (expression) => { const r = await s('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }); if (r.exceptionDetails) throw new Error('page: ' + (r.exceptionDetails.exception && r.exceptionDetails.exception.description || r.exceptionDetails.text)); return r.result.value; };

  let css = fontCss, loadedCss = null;
  async function ensurePage() {          // one file:// page (so local fonts and images load); bodies are swapped in place
    if (loadedCss === css) return;
    const html = `<!doctype html><html><head><meta charset="utf-8"><style>${css}
html,body{margin:0;padding:0;background:transparent;overflow:hidden}svg{display:block}</style></head><body></body></html>`;
    const file = path.join(work, 'page.html'); fs.writeFileSync(file, html);
    const loaded = new Promise(r => { const l = m => { if (m.method === 'Page.loadEventFired' && m.sessionId === sessionId) { listeners.delete(l); r(); } }; listeners.add(l); });
    await s('Page.navigate', { url: pathToFileURL(file).href + '?v=' + Date.now() }); await loaded; loadedCss = css;
  }
  const settle = `(async()=>{const imgs=[...document.querySelectorAll('img,image')];await Promise.all(imgs.map(el=>{const src=el.getAttribute('src')||el.getAttribute('href')||el.getAttribute('xlink:href');if(!src)return 0;const i=new Image();i.src=src;return i.decode().catch(()=>0)}));
    const fams=new Set();for(const f of document.fonts)fams.add(f.family);await Promise.all([...fams].map(f=>document.fonts.load('40px '+f).catch(()=>0)));await document.fonts.ready;
    await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));return 1})()`;

  // Render markup (an <svg> or any HTML) into a w x h RGBA image with a transparent background.
  async function render(markup, w, h) {
    await ensurePage();
    await s('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile: false });
    await evaluate(`document.body.innerHTML=${JSON.stringify(markup)};1`);
    await evaluate(settle);
    const { data } = await s('Page.captureScreenshot', { format: 'png', clip: { x: 0, y: 0, width: w, height: h, scale: 1 }, captureBeyondViewport: true, fromSurface: true });
    return PNG.decode(Buffer.from(data, 'base64'));
  }
  // Render HTML at a fixed width and whatever height its content needs (review sheets). Returns a PNG buffer.
  async function renderPage(markup, w) {
    await ensurePage();
    await s('Emulation.setDeviceMetricsOverride', { width: w, height: 200, deviceScaleFactor: 1, mobile: false });
    await evaluate(`document.body.innerHTML=${JSON.stringify(markup)};1`); await evaluate(settle);
    const h = Math.min(16000, Math.ceil(await evaluate('Math.max(document.body.scrollHeight,document.documentElement.scrollHeight)')));
    await s('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile: false }); await evaluate(settle);
    const { data } = await s('Page.captureScreenshot', { format: 'png', clip: { x: 0, y: 0, width: w, height: h, scale: 1 }, captureBeyondViewport: true });
    return Buffer.from(data, 'base64');
  }
  // Decode any image file the browser understands into RGBA (optionally capped to maxSide pixels).
  async function decodeFile(file, maxSide = 0) {
    const buf = fs.readFileSync(file);
    if (buf.length > 8 && buf.readUInt32BE(0) === 0x89504e47 && !maxSide) { try { return PNG.decode(buf); } catch { /* interlaced etc: let the browser do it */ } }
    await ensurePage();
    const ext = path.extname(file).slice(1).toLowerCase(), mime = { jpg: 'jpeg', jpeg: 'jpeg', png: 'png', webp: 'webp', gif: 'gif', svg: 'svg+xml', bmp: 'bmp', avif: 'avif' }[ext] || 'png';
    const url = `data:image/${mime};base64,${buf.toString('base64')}`;
    const b64 = await evaluate(`(async()=>{const i=new Image();i.src=${JSON.stringify(url)};await i.decode();let w=i.naturalWidth||512,h=i.naturalHeight||512;const k=${maxSide}>0?Math.min(1,${maxSide}/Math.max(w,h)):1;w=Math.max(1,Math.round(w*k));h=Math.max(1,Math.round(h*k));
      const c=document.createElement('canvas');c.width=w;c.height=h;const g=c.getContext('2d');g.drawImage(i,0,0,w,h);return c.toDataURL('image/png').split(',')[1]})()`);
    return PNG.decode(Buffer.from(b64, 'base64'));
  }
  async function close() { try { await send('Browser.close'); } catch { /* gone */ } try { sock.close(); } catch { } try { proc.kill(); } catch { } for (const d of [profile, work]) try { fs.rmSync(d, { recursive: true, force: true }); } catch { } }
  return { render, renderPage, decodeFile, close, setFontCss: c => { css = c; }, getFontCss: () => css, exe };
}
