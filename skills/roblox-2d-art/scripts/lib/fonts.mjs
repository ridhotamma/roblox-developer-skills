// Fonts for text in art. Lookup order: the skill's font cache -> Roblox Studio's own font folder (the exact fonts
// players see in-game: Fredoka One, Luckiest Guy, Builder Sans, Bangers...) -> download an open-licence font from
// the google/fonts repository into the cache -> let the browser use a system font of that name.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const CACHE = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'fonts');
const GF = 'https://raw.githubusercontent.com/google/fonts/main/';
// family -> path in google/fonts (licences: ofl = SIL Open Font License, apache = Apache 2.0). All free to use in games.
export const REGISTRY = {
  'Luckiest Guy': 'apache/luckiestguy/LuckiestGuy-Regular.ttf', 'Fredoka': 'ofl/fredoka/Fredoka%5Bwdth,wght%5D.ttf', 'Bangers': 'ofl/bangers/Bangers-Regular.ttf',
  'Lilita One': 'ofl/lilitaone/LilitaOne-Regular.ttf', 'Titan One': 'ofl/titanone/TitanOne-Regular.ttf', 'Creepster': 'ofl/creepster/Creepster-Regular.ttf',
  'Permanent Marker': 'apache/permanentmarker/PermanentMarker-Regular.ttf', 'Press Start 2P': 'ofl/pressstart2p/PressStart2P-Regular.ttf', 'Oswald': 'ofl/oswald/Oswald%5Bwght%5D.ttf',
  'Michroma': 'ofl/michroma/Michroma-Regular.ttf', 'Bungee': 'ofl/bungee/Bungee-Regular.ttf', 'Denk One': 'ofl/denkone/DenkOne-Regular.ttf', 'Sarpanch': 'ofl/sarpanch/Sarpanch-Black.ttf',
  'Nunito': 'ofl/nunito/Nunito%5Bwght%5D.ttf', 'Special Elite': 'apache/specialelite/SpecialElite-Regular.ttf', 'Rubik Mono One': 'ofl/rubikmonoone/RubikMonoOne-Regular.ttf',
  'Chewy': 'apache/chewy/Chewy-Regular.ttf', 'Silkscreen': 'ofl/silkscreen/Silkscreen-Regular.ttf', 'Pixelify Sans': 'ofl/pixelifysans/PixelifySans%5Bwght%5D.ttf', 'VT323': 'ofl/vt323/VT323-Regular.ttf',
  'Grenze Gotisch': 'ofl/grenzegotisch/GrenzeGotisch%5Bwght%5D.ttf', 'Fondamento': 'ofl/fondamento/Fondamento-Regular.ttf', 'Jura': 'ofl/jura/Jura%5Bwght%5D.ttf',
  'Russo One': 'ofl/russoone/RussoOne-Regular.ttf', 'Black Ops One': 'ofl/blackopsone/BlackOpsOne-Regular.ttf',
};
const WEIGHTS = { thin: 100, extralight: 200, light: 300, regular: 400, medium: 500, semibold: 600, bold: 700, extrabold: 800, black: 900, heavy: 900 };
const key = s => s.toLowerCase().replace(/[^a-z0-9]/g, '');

function studioFontDirs() {
  const dirs = [];
  const L = process.env.LOCALAPPDATA;
  if (L) { const v = path.join(L, 'Roblox', 'Versions'); try { for (const d of fs.readdirSync(v).map(n => path.join(v, n, 'content', 'fonts')).filter(p => fs.existsSync(p)).sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs)) { dirs.push(d); break; } } catch { /* none */ } }
  for (const p of ['/Applications/RobloxStudio.app/Contents/Resources/content/fonts', path.join(os.homedir(), 'Applications/RobloxStudio.app/Contents/Resources/content/fonts')]) if (fs.existsSync(p)) dirs.push(p);
  return dirs;
}
// One entry per font file: { family, weight, style, file }. Family comes from the file name ("FredokaOne-Regular.ttf" -> "Fredoka One").
export function localFonts() {
  const out = [];
  for (const dir of [CACHE, ...studioFontDirs()]) {
    let files = []; try { files = fs.readdirSync(dir); } catch { continue; }
    for (const f of files) {
      if (!/\.(ttf|otf|woff2?)$/i.test(f) || /emoji|Noto.*UI|Twemoji/i.test(f)) continue;
      const base = f.replace(/\.[^.]+$/, '').replace(/%5B.*$|\[.*$/, ''), [fam, style = 'Regular'] = base.split('-');
      const family = fam.replace(/([a-z])([A-Z0-9])/g, '$1 $2').replace(/([A-Z])([A-Z][a-z])/g, '$1 $2');
      const sk = key(style), weight = Object.entries(WEIGHTS).find(([w]) => sk.startsWith(w))?.[1] || 400, italic = /it(alic)?$/i.test(style);
      if (!out.some(e => key(e.family) === key(family) && e.weight === weight && e.italic === italic)) out.push({ family, weight, italic, file: path.join(dir, f), variable: /%5B|\[/.test(f) });
    }
  }
  const fr = out.find(e => key(e.family) === 'fredoka');   // Google's variable Fredoka stands in for Fredoka One (weight 600)
  if (fr && !out.some(e => key(e.family) === 'fredokaone')) out.push(Object.assign({}, fr, { family: 'Fredoka One', weight: 400, fixedWeight: 600 }));
  return out;
}
// Make sure every family used in the markup has a font file; returns @font-face CSS and notes about fallbacks.
export async function fontCssFor(families) {
  let local = localFonts(); const notes = [];
  for (const fam of families) {
    if (local.some(e => key(e.family) === key(fam))) continue;
    const reg = Object.keys(REGISTRY).find(n => key(n) === key(fam)) || (key(fam) === 'fredokaone' ? 'Fredoka' : null);
    if (reg) {
      try {
        fs.mkdirSync(CACHE, { recursive: true }); const url = GF + REGISTRY[reg], r = await fetch(url); if (!r.ok) throw new Error(r.status);
        const file = path.join(CACHE, decodeURIComponent(path.basename(REGISTRY[reg]))); fs.writeFileSync(file, Buffer.from(await r.arrayBuffer())); notes.push(`downloaded font ${reg} (${REGISTRY[reg].split('/')[0]} licence)`);
        local = localFonts();
      } catch (e) { notes.push(`could not download ${reg}: ${e.message}`); }
    } else if (!/^(arial|arial black|impact|verdana|georgia|times new roman|courier new|comic sans ms|segoe ui|helvetica|sans-serif|serif|monospace|system-ui|trebuchet ms|tahoma)$/i.test(fam)) notes.push(`font "${fam}" not found locally or in the registry: the browser will substitute a system font (check the render)`);
  }
  const css = local.map(e => `@font-face{font-family:'${e.family}';src:url('${pathToFileURL(e.file).href}');font-weight:${e.variable ? '100 900' : e.weight};font-style:${e.italic ? 'italic' : 'normal'}${e.fixedWeight ? `;font-variation-settings:'wght' ${e.fixedWeight}` : ''}}`).join('\n');
  return { css, notes };
}
export function familiesIn(markup) {
  const set = new Set();
  for (const m of markup.replace(/&quot;/g, "'").matchAll(/font-family\s*=\s*"([^"]+)"|font-family\s*=\s*'([^']+)'|font-family\s*:\s*([^;"}]+)/g))
    for (const f of (m[1] || m[2] || m[3]).split(',')) { const n = f.trim().replace(/^['"]+|['"]+$/g, ''); if (n && !/^(inherit|sans-serif|serif|monospace|system-ui|cursive|fantasy)$/i.test(n)) set.add(n); }
  return [...set];
}
