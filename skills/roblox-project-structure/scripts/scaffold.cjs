#!/usr/bin/env node
// Generates a Roblox project from ../assets/template.
//
//   node scaffold.cjs --name "My Game" [--out ./my-game] [--scope studio] [--no-ci] [--force]
//
// Placeholders {{NAME}}, {{SLUG}} and {{SCOPE}} are replaced in every text file.
// Template paths starting with "_" become dotfiles ("_gitignore" -> ".gitignore"), which keeps
// them intact through skill packaging. Needs only Node.
'use strict';

const fs = require('fs');
const path = require('path');

const TEMPLATE = path.join(__dirname, '..', 'assets', 'template');

function parseArgs(argv) {
  const args = { ci: true, force: false, scope: 'studio' };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => {
      if (i + 1 >= argv.length) fail(`${a} needs a value`);
      return argv[++i];
    };
    if (a === '--name') args.name = next();
    else if (a === '--out') args.out = next();
    else if (a === '--scope') args.scope = next();
    else if (a === '--no-ci') args.ci = false;
    else if (a === '--force') args.force = true;
    else if (a === '-h' || a === '--help') {
      console.log('usage: node scaffold.cjs --name "My Game" [--out dir] [--scope wally-scope] [--no-ci] [--force]');
      process.exit(0);
    } else fail(`unknown option ${a}`);
  }
  if (!args.name) fail('--name is required');
  return args;
}

function fail(msg) {
  console.error(`scaffold: ${msg}`);
  process.exit(1);
}

// Wally names: lowercase letters, digits and hyphens.
function slugify(s) {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'game';
}

function walk(dir, rel = '') {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === '.DS_Store') continue;
    const r = rel ? `${rel}/${entry.name}` : entry.name;
    if (entry.isDirectory()) out.push(...walk(path.join(dir, entry.name), r));
    else out.push(r);
  }
  return out;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const slug = slugify(args.name);
  const scope = slugify(args.scope);
  const out = path.resolve(args.out || slug);

  if (fs.existsSync(out) && fs.readdirSync(out).length > 0 && !args.force) {
    fail(`${out} is not empty (pass --force to write into it anyway)`);
  }

  const vars = { NAME: args.name, SLUG: slug, SCOPE: scope };
  const written = [];
  for (const rel of walk(TEMPLATE)) {
    if (!args.ci && rel.startsWith('_github/')) continue;
    const target = rel.split('/').map((p) => (p.startsWith('_') ? `.${p.slice(1)}` : p)).join('/');
    const text = fs.readFileSync(path.join(TEMPLATE, rel), 'utf8');
    const filled = text.replace(/\{\{(NAME|SLUG|SCOPE)\}\}/g, (_, k) => vars[k]);
    const dest = path.join(out, target);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.writeFileSync(dest, filled);
    if (target.endsWith('.sh')) fs.chmodSync(dest, 0o755);
    written.push(target);
  }

  written.sort();
  console.log(`Created ${args.name} in ${out} (${written.length} files)`);
  for (const f of written) console.log(`  ${f}`);
  console.log(`
Next:
  cd ${path.relative(process.cwd(), out) || '.'}
  rokit install
  sh scripts/install-packages.sh
  rojo serve`);
}

main();
