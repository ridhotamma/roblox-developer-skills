#!/usr/bin/env node
// rart: 2D game art for Roblox. Node 22+, no packages; renders with the local Chrome / Edge / Chromium.
//   node rart.mjs build <spec.mjs|.json|.svg> [--out dir] [--kind item] [--only name,name] [--no-review] [--verbose]
//   node rart.mjs post <image> --kind item [--key] [--outline 14] [--shadow] [--fit] [--name X] [--out dir]
//   node rart.mjs refs "<query>" [--kind icons|photos|both] [--out refs] [--n 12] [--sets fluent-emoji-flat,noto,...]
//   node rart.mjs palette <image> [--n 6] [--out swatches.png]
//   node rart.mjs trace <image> [--out traced] [--box 512] [--pad 0.06] [--crop x0,y0,x1,y1] [--threshold 0.12] [--holes] [--colors 0] [--detail 1.5] [--invert]
//   node rart.mjs sheet <png...|dir> [--out sheet.png] [--cols n] [--cell 128] [--pad 2] [--flipbook 4] [--fps 24] [--name Coins]
//   node rart.mjs check <png> --kind badge          (checks an existing image)
//   node rart.mjs fonts [list | get "<family>"]
//   node rart.mjs serve <dir> [--port 8765]          (http URLs for the Roblox Studio MCP upload_image tool)
//   node rart.mjs selftest
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { fileURLToPath } from 'node:url';
import { closeBrowser, browser } from './lib/chrome.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
function args(argv) { const o = { _: [] }; for (let i = 0; i < argv.length; i++) { const a = argv[i]; if (a.startsWith('--')) { const k = a.slice(2), nx = argv[i + 1]; if (k.startsWith('no-')) o[k.slice(3)] = false; else if (nx === undefined || nx.startsWith('--')) o[k] = true; else { o[k] = nx; i++; } } else o._.push(a); } return o; }

async function main() {
  const [cmd, ...rest] = process.argv.slice(2), o = args(rest);
  switch (cmd) {
    case 'build': { if (!o._[0]) throw new Error('usage: build <spec.mjs|.json|.svg> [--out dir]'); const { buildFile } = await import('./lib/build.mjs'); await buildFile(o._[0], o); break; }
    case 'post': { const { post } = await import('./lib/post.mjs'); await post(o._[0], o); break; }
    case 'check': { const { checkFile } = await import('./lib/post.mjs'); await checkFile(o._[0], o); break; }
    case 'refs': { const { refs } = await import('./lib/refs.mjs'); await refs(o._.join(' '), o); break; }
    case 'palette': { const { palette } = await import('./lib/trace.mjs'); await palette(o._[0], o); break; }
    case 'trace': { const { trace } = await import('./lib/trace.mjs'); await trace(o._[0], o); break; }
    case 'sheet': { const { sheetCmd } = await import('./lib/post.mjs'); await sheetCmd(o._, o); break; }
    case 'fonts': {
      const F = await import('./lib/fonts.mjs');
      if (o._[0] === 'get') { const r = await F.fontCssFor([o._.slice(1).join(' ')]); console.log(r.notes.join('\n') || 'already available'); }
      else { const l = F.localFonts(); console.log(`local fonts (${l.length}):\n` + [...new Set(l.map(e => e.family))].sort().join(', ') + `\n\ndownloadable on first use: ${Object.keys(F.REGISTRY).join(', ')}\nsystem fonts (Arial Black, Impact, ...) also work by name.`); }
      break;
    }
    case 'serve': serve(o._[0] || '.', +(o.port || 8765)); return;
    case 'selftest': { const { selftest } = await import('./selftest.mjs'); await selftest(); break; }
    default:
      console.log(fs.readFileSync(fileURLToPath(import.meta.url), 'utf8').split('\n').filter(l => l.startsWith('//')).map(l => l.slice(3)).join('\n'));
      if (cmd) process.exitCode = 2;
  }
}
// Static file server so the Roblox Studio MCP `upload_image` tool (which takes http URLs) can read local PNGs.
function serve(dir, port) {
  const root = path.resolve(dir);
  http.createServer((req, res) => {
    const p = path.join(root, decodeURIComponent(req.url.split('?')[0])); if (!p.startsWith(root) || !fs.existsSync(p) || fs.statSync(p).isDirectory()) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { 'Content-Type': { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg' }[path.extname(p).toLowerCase()] || 'application/octet-stream' }); fs.createReadStream(p).pipe(res);
  }).listen(port, '127.0.0.1', () => {
    console.log(`serving ${root} on http://localhost:${port}/ (Ctrl+C to stop)`);
    for (const f of fs.readdirSync(root).filter(f => /\.(png|jpe?g)$/i.test(f) && !/^review-/.test(f))) console.log(`  http://localhost:${port}/${encodeURIComponent(f)}`);
  });
}
main().then(() => closeBrowser()).catch(async e => { console.error('error: ' + (process.env.RART_DEBUG ? e.stack : e.message)); await closeBrowser(); process.exit(1); });
