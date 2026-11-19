#!/usr/bin/env node
// Previs and coverage check for a scene or finisher, computed by the kit's real Luau Timeline.
//
//   node scripts/previs.cjs BossIntro                       -> BossIntro.previs.html (here)
//   node scripts/previs.cjs Finishers/Suplex --out dir/      -> dir/Suplex.previs.html
//   node scripts/previs.cjs path/to/MyScene.luau             -> a scene file from a game project
//   node scripts/previs.cjs BossIntro --check                -> print errors and coverage warnings
//                                                               (exit 1 if any), no HTML
//   node scripts/previs.cjs --all --out dir/                 -> every shipped scene and finisher + index.html
//   options: --fps 30 (samples per second), --aspect 1.7778 (viewport the camera is framed for)
//
// Needs the luau CLI (brew install luau, or rokit add luau-lang/luau).
'use strict';
const fs = require('fs');
const path = require('path');
const runner = require('../tests/run-luau.cjs');

const TEMPLATE = path.join(__dirname, '..', 'assets', 'previs.template.html');

function parse(argv) {
  const opts = { targets: [], out: null, check: false, all: false, fps: 30, aspect: 16 / 9 };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--out') opts.out = argv[++i];
    else if (a === '--check') opts.check = true;
    else if (a === '--all') opts.all = true;
    else if (a === '--fps') opts.fps = Number(argv[++i]);
    else if (a === '--aspect') opts.aspect = Number(argv[++i]);
    else if (a === '-h' || a === '--help') opts.help = true;
    else opts.targets.push(a);
  }
  return opts;
}

function shippedTargets() {
  const out = [];
  for (const folder of ['Scenes', 'Finishers']) {
    const dir = path.join(runner.SHARED, 'Cutscene', folder);
    for (const f of fs.readdirSync(dir).sort()) if (f.endsWith('.luau')) out.push(`${folder}/${f.replace(/\.luau$/, '')}`);
  }
  return out;
}

function html(data) {
  const template = fs.readFileSync(TEMPLATE, 'utf8');
  const json = JSON.stringify(data).replace(/</g, '\\u003c');
  return template.replace('/*__PREVIS_DATA__*/null', json);
}

function report(target, data) {
  const lines = [];
  if (data.errors.length) {
    lines.push(`${target}: ${data.errors.length} error(s)`);
    for (const e of data.errors) lines.push(`  error  ${e}`);
    return { ok: false, lines };
  }
  const p = data.pacing;
  lines.push(`${target}: ${p.Shots} shots, ${data.length.toFixed(2)}s (plays in ${data.wallLength.toFixed(2)}s), average shot ${p.AverageShot.toFixed(2)}s`);
  for (const w of data.warnings) lines.push(`  ${w.kind.padEnd(9)} ${w.time.toFixed(2)}s  ${w.message}`);
  if (!data.warnings.length) lines.push('  coverage clean');
  return { ok: data.warnings.length === 0, lines };
}

function main() {
  const opts = parse(process.argv.slice(2));
  if (opts.help || (!opts.all && opts.targets.length === 0)) {
    console.log(fs.readFileSync(__filename, 'utf8').split('\n').slice(1, 14).map((l) => l.replace(/^\/\/ ?/, '')).join('\n'));
    process.exit(opts.help ? 0 : 1);
  }
  if (!runner.luauAvailable()) {
    console.error('luau CLI not found: brew install luau (or rokit add luau-lang/luau)');
    process.exit(2);
  }
  const targets = opts.all ? shippedTargets() : opts.targets;
  let ok = true;
  const written = [];
  for (const target of targets) {
    const data = runner.dump(target, { fps: opts.fps, aspect: opts.aspect });
    const r = report(target, data);
    ok = ok && r.ok;
    console.log(r.lines.join('\n'));
    if (opts.check || data.errors.length) continue;
    const name = path.basename(target).replace(/\.luau$/, '');
    let file;
    if (opts.out && (opts.all || opts.out.endsWith('/') || (fs.existsSync(opts.out) && fs.statSync(opts.out).isDirectory()))) {
      fs.mkdirSync(opts.out, { recursive: true });
      file = path.join(opts.out, `${name}.previs.html`);
    } else {
      file = opts.out || `${name}.previs.html`;
    }
    fs.writeFileSync(file, html(data));
    written.push({ file, data, target });
    console.log(`  wrote ${file}`);
  }
  if (opts.all && opts.out && written.length) {
    const rows = written.map(({ file, data, target }) => `<li><a href="${path.basename(file)}">${data.name}</a> <span>${target.split('/')[0] === 'Finishers' ? 'finisher' : 'scene'} · ${data.shots.length} shots · ${data.wallLength.toFixed(1)}s${data.qtes.length ? ' · ' + data.qtes.length + ' QTE' : ''}</span></li>`).join('\n');
    fs.writeFileSync(path.join(opts.out, 'index.html'), `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Cutscene Previs</title>
<style>:root{--bg:#0e0f12;--text:#e7e9ee;--muted:#9aa1ad;--accent:#ffd65c}body{margin:0;background:var(--bg);color:var(--text);font:15px/1.5 ui-sans-serif,system-ui,sans-serif;padding:24px 16px;max-width:760px;margin:0 auto}a{color:var(--accent)}li{margin:8px 0}span{color:var(--muted);font-size:13px;margin-left:6px}</style></head>
<body><h1>Cutscene previs</h1><p>Scenes and finishers from the roblox-cutscene kit, sampled through its Luau Timeline.</p><ul>${rows}</ul></body></html>\n`);
    console.log(`  wrote ${path.join(opts.out, 'index.html')}`);
  }
  process.exit(ok ? 0 : 1);
}

main();
