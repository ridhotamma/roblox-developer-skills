#!/usr/bin/env node
// Offline checks for the cutscene skill: the Luau spec passes, every shipped scene and finisher
// builds a previs with clean coverage, every kit file parses, the remotes the kit uses are the
// ones CutsceneConfig documents, and the references the SKILL.md names exist.
// Run: node scripts/selftest.cjs   (needs the luau CLI for the first two)
'use strict';
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const runner = require('../tests/run-luau.cjs');

const SKILL = path.resolve(__dirname, '..');
let failures = 0;
function ok(cond, msg) {
  console.log((cond ? 'ok   ' : 'FAIL ') + msg);
  if (!cond) failures++;
}

const kitFiles = runner.walk(path.join(SKILL, 'assets', 'kit'));
ok(kitFiles.length >= 20, `kit has ${kitFiles.length} Luau files`);

const haveLuau = runner.luauAvailable();
if (!haveLuau) {
  console.log('skip luau CLI not found: spec, previs and parse checks skipped (brew install luau)');
} else {
  // 1. spec
  const out = runner.run('Cutscene.spec.luau');
  const summary = (out.match(/(\d+) passed, (\d+) failed/) || []);
  ok(summary[2] === '0', `Luau spec: ${summary[0] || 'no summary'}`);
  if (summary[2] !== '0') process.stdout.write(out.split('\n').filter((l) => l.startsWith('FAIL')).join('\n') + '\n');

  // 2. every scene and finisher previs
  for (const folder of ['Scenes', 'Finishers']) {
    const dir = path.join(SKILL, 'assets', 'kit', 'shared', 'Cutscene', folder);
    for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.luau'))) {
      const target = `${folder}/${f.replace(/\.luau$/, '')}`;
      const data = runner.dump(target, { fps: 10 });
      ok(data.errors.length === 0 && data.frames.length > 0, `${target}: previs builds (${data.frames ? data.frames.length : 0} frames)`);
      ok((data.warnings || []).length === 0, `${target}: coverage clean`);
    }
  }

  // 3. every kit file parses (luau-analyze reports syntax errors as SyntaxError)
  let analyze = true;
  try { execFileSync('luau-analyze', ['--help'], { stdio: 'ignore' }); } catch (e) { analyze = e.code !== 'ENOENT'; }
  if (analyze) {
    for (const file of kitFiles) {
      let text = '';
      try { text = execFileSync('luau-analyze', [file], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }); } catch (e) { text = (e.stdout || '') + (e.stderr || ''); }
      ok(!/SyntaxError/.test(text), `parses: ${path.relative(SKILL, file)}`);
    }
  }
}

// 4. remotes used == remotes documented in CutsceneConfig
const configText = fs.readFileSync(path.join(SKILL, 'assets/kit/shared/Cutscene/CutsceneConfig.luau'), 'utf8');
const documented = new Set([...configText.matchAll(/^--\s+(\w+) = "Event"/gm)].map((m) => m[1]));
const used = new Set();
for (const file of kitFiles) {
  for (const m of fs.readFileSync(file, 'utf8').matchAll(/Net\.(?:Event|Handle)\("(\w+)"/g)) used.add(m[1]);
}
for (const name of used) ok(documented.has(name), `remote ${name} is documented in CutsceneConfig`);
for (const name of documented) ok(used.has(name), `documented remote ${name} is used`);

// 5. references and files named in SKILL.md exist
const skill = fs.readFileSync(path.join(SKILL, 'SKILL.md'), 'utf8');
for (const m of new Set([...skill.matchAll(/`(references\/[\w-]+\.md)`/g)].map((x) => x[1]))) {
  ok(fs.existsSync(path.join(SKILL, m)), `${m} exists`);
}
for (const m of new Set([...skill.matchAll(/`((?:shared|server|client)\/[\w/]+\.luau)`/g)].map((x) => x[1]))) {
  ok(fs.existsSync(path.join(SKILL, 'assets', 'kit', m)), `kit file ${m} exists`);
}
const name = (skill.match(/^name: (.+)$/m) || [])[1];
ok(name === 'roblox-cutscene', 'frontmatter name');
const description = (skill.match(/^description: (.+)$/m) || [])[1] || '';
ok(description.length > 200 && description.length < 1700, `description length ${description.length}`);

console.log(failures ? `\n${failures} failed` : '\nall checks passed');
process.exit(failures ? 1 : 0);
