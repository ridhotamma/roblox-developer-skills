#!/usr/bin/env node
// UI scanner for Roblox Luau source: responsive-layout, input, accessibility and react-lua
// mistakes that make a UI break on phones, consoles or under load.
//
//   node uiscan.cjs <path> [--json] [--min info|low|medium|high] [--fail-on <severity>]
//
// <path> is a folder (e.g. a Rojo src/) or a .lua/.luau file. Packages/ folders are skipped.
// It is a pattern scan: a finding says where to look, not that it is certainly wrong.
// Suppress a reviewed finding with `-- ui:ignore <rule-id>` on the same line or the line above.
'use strict';

const fs = require('fs');
const path = require('path');

const SEVERITIES = ['info', 'low', 'medium', 'high'];
const SKIP_DIRS = new Set(['.git', 'node_modules', 'Packages', 'ServerPackages', 'DevPackages', '_Index']);

// id -> { severity, title, fix }. Every id is documented in references/audit-checklist.md.
const RULES = {
  'textscaled': {
    severity: 'medium',
    title: 'TextScaled: labels end up different sizes and ignore the player\'s Text Size setting',
    fix: 'TextSize from the type scale times ui.px (the Text primitive); AutomaticSize or TextWrapped for long strings. If TextScaled must stay, add a UITextSizeConstraint.',
  },
  'mouse-click-event': {
    severity: 'medium',
    title: 'Mouse-only button event: gamepad never fires it, and it is not the cross-input event',
    fix: 'Use Activated, which fires for mouse, touch, gamepad A and keyboard navigation.',
  },
  'ismobile-check': {
    severity: 'medium',
    title: 'TouchEnabled used to decide the UI ("isMobile"): touch laptops, tablets with keyboards and phones with controllers get the wrong one',
    fix: 'Input affordances from UserInputService.PreferredInput (ui.input); layout from the safe-area size class (ui.sizeClass).',
  },
  'render-side-effect': {
    severity: 'high',
    title: 'Side effect in a component body: runs (and leaks) on every render',
    fix: 'Move connections, Instance creation, task.* and remote calls into React.useEffect and return a cleanup.',
  },
  'effect-no-cleanup': {
    severity: 'medium',
    title: 'Effect connects or schedules work but returns no cleanup: it leaks every time it re-runs or the component unmounts',
    fix: 'Return a function that disconnects / cancels / destroys what the effect created.',
  },
  'effect-no-deps': {
    severity: 'low',
    title: 'Effect without a dependency list re-runs after every render',
    fix: 'Pass the values it reads as the second argument ({} to run once on mount). Never put nil in the list; use `x or false`.',
  },
  'state-per-frame': {
    severity: 'high',
    title: 'React state set every frame: re-renders the tree 60 times a second',
    fix: 'Animate with a binding (React.useBinding or Motion.useSpring) and map it onto properties; bindings update Instances without re-rendering.',
  },
  'small-touch-target': {
    severity: 'medium',
    title: 'Button smaller than 44 points: hard to tap on phones',
    fix: 'At least 44x44 design units on touch (the Button primitive enforces ui.hitTarget); grow the hit area, not just the art.',
  },
  'resetonspawn': {
    severity: 'medium',
    title: 'ScreenGui created in code without ResetOnSpawn = false: destroyed on every respawn, losing state (and any React root inside it)',
    fix: 'Set ResetOnSpawn = false on ScreenGuis you create from scripts (the Layer primitive does).',
  },
  'viewport-breakpoint': {
    severity: 'low',
    title: 'Breakpoint on raw pixels: phones report points, desktops pixels and consoles 1080p, so the same number means different room',
    fix: 'Classify the safe area in design units (Responsive.classify / ui.sizeClass).',
  },
  'fixed-design-resolution': {
    severity: 'low',
    title: 'Proportional scaling from a fixed design resolution: phones end up at 35-45% size, with unreadable text and untappable buttons',
    fix: 'Scale per input with clamps (Tokens.Scale / ui.px) and change layout by size class instead of shrinking it.',
  },
  'gui-inset-math': {
    severity: 'low',
    title: 'Manual top-bar inset maths: breaks with the current top bar, notches and console',
    fix: 'Put content in a ScreenGui with ScreenInsets = CoreUISafeInsets (Layer insets = "Safe").',
  },
  'ignore-gui-inset': {
    severity: 'low',
    title: 'IgnoreGuiInset = true: content can sit under the Roblox top bar and phone notches',
    fix: 'Use ScreenInsets explicitly: CoreUISafeInsets for content, DeviceSafeInsets / None for backgrounds only.',
  },
  'zindex-global': {
    severity: 'low',
    title: 'ZIndexBehavior.Global: one ZIndex space for the whole ScreenGui, so components fight over numbers',
    fix: 'ZIndexBehavior.Sibling and order with layers (DisplayOrder) and sibling ZIndex.',
  },
  'hardcoded-style': {
    severity: 'low',
    title: 'Style hard-coded in a UI component: theme changes (palette, corners, fonts) never reach it',
    fix: 'Use theme references: color = "Accent" or ui.color(ref), radius = "M" or ui.corner(ref), Text variants for fonts. For a new knob, add a components.<Name> entry to your theme and read ui.theme.components.<Name>.',
  },
  'hover-only': {
    severity: 'low',
    title: 'Hover-only interaction: touch and gamepad players can never trigger it',
    fix: 'Give every hover affordance a tap / selection path (Activated, SelectionGained), e.g. tap to show a tooltip.',
  },
  'missing-sort-order': {
    severity: 'info',
    title: 'Layout without an explicit SortOrder',
    fix: 'Set SortOrder = Enum.SortOrder.LayoutOrder and give children layoutOrder; keyed React children are named by key, so name order is alphabetical by key.',
  },
  'screen-insets-none': {
    severity: 'info',
    title: 'ScreenInsets.None: full-screen layer',
    fix: 'Fine for backdrops, scrims and art; keep text and buttons in a safe-inset layer.',
  },
  'canvasgroup': {
    severity: 'info',
    title: 'CanvasGroup renders its contents to a texture (memory, and a redraw when anything inside changes)',
    fix: 'Fine for small fades; for big panels on mobile animate position / transparency of a few elements instead.',
  },
  'legacy-font': {
    severity: 'info',
    title: 'Gotham / Arial font enum: deprecated by Roblox',
    fix: 'FontFace = Font.new("rbxasset://fonts/families/BuilderSans.json", weight) (Tokens.FontFamily).',
  },
  'legacy-roact': {
    severity: 'info',
    title: 'Legacy Roact: unmaintained',
    fix: 'react-lua (jsdotlua/react + react-roblox) is the maintained successor; roact-compat helps migrate screen by screen.',
  },
  'waitforchild-chain': {
    severity: 'info',
    title: 'Long WaitForChild chain into Studio-authored UI: breaks silently when an artist renames a frame',
    fix: 'Build UI in code (React) or wrap the authored UI in one module that resolves and type-checks its parts once.',
  },
};

// ---- lexing ---------------------------------------------------------------------------

// Blanks string and comment contents with spaces, keeping newlines and offsets, so the result
// can be searched for code while positions still map to the original text.
function strip(src) {
  const out = src.split('');
  const n = src.length;
  let i = 0;
  const blank = (from, to) => {
    for (let k = from; k < to && k < n; k++) if (out[k] !== '\n') out[k] = ' ';
  };
  const longBracket = (at) => {
    const m = /^\[(=*)\[/.exec(src.slice(at, at + 64));
    return m ? m[1].length : -1;
  };
  while (i < n) {
    const c = src[i];
    if (c === '-' && src[i + 1] === '-') {
      const level = src[i + 2] === '[' ? longBracket(i + 2) : -1;
      if (level >= 0) {
        const close = ']' + '='.repeat(level) + ']';
        const end = src.indexOf(close, i + 4 + level);
        const stop = end < 0 ? n : end + close.length;
        blank(i, stop);
        i = stop;
      } else {
        let end = src.indexOf('\n', i);
        if (end < 0) end = n;
        blank(i, end);
        i = end;
      }
    } else if (c === '[' && longBracket(i) >= 0) {
      const level = longBracket(i);
      const close = ']' + '='.repeat(level) + ']';
      const end = src.indexOf(close, i + 2 + level);
      const stop = end < 0 ? n : end + close.length;
      blank(i + 2 + level, stop - close.length);
      i = stop;
    } else if (c === '"' || c === "'" || c === '`') {
      let j = i + 1;
      while (j < n && src[j] !== c) {
        if (src[j] === '\\') j++;
        else if (src[j] === '\n' && c !== '`') break;
        j++;
      }
      blank(i + 1, j);
      i = j + 1;
    } else {
      i++;
    }
  }
  return out.join('');
}

// String literals (already blanked by strip) are tokens too, so `x = "a"` followed by `if` on
// the next line is seen as a new statement, not an if-expression.
const TOKEN = /"[^"\n]*"|'[^'\n]*'|`[^`]*`|[A-Za-z_][A-Za-z0-9_]*|\d[\dA-Za-z_.]*|::|\.\.\.|\.\.|==|~=|<=|>=|[-+*/%^#=<>(){}[\];:,.]/g;

function tokenize(code) {
  const tokens = [];
  let m;
  TOKEN.lastIndex = 0;
  while ((m = TOKEN.exec(code))) tokens.push({ t: m[0], i: m.index });
  return tokens;
}

// Tokens after which `if` starts an expression (Luau if-then-else expression, no `end`).
const EXPRESSION_BEFORE = new Set(['=', '(', ',', '{', '[', 'return', '..', '+', '-', '*', '/', '%', '^',
  'and', 'or', 'not', '==', '~=', '<', '>', '<=', '>=', 'in', '::', '#']);
const FRAME_EVENTS = /^(Heartbeat|RenderStepped|PreRender|PreAnimation|PreSimulation|PostSimulation|Stepped)$/;

// Finds every function with its name, role and extent. Returns { functions, balanced }.
function parseFunctions(code) {
  const tokens = tokenize(code);
  const functions = [];
  const stack = [];
  let balanced = true;
  const prev = (k, back = 1) => (tokens[k - back] ? tokens[k - back].t : '');

  for (let k = 0; k < tokens.length; k++) {
    const tok = tokens[k].t;
    if (tok === 'function') {
      // Name: `function A.B:c(` or `local function a(`, or `local a = function(`.
      let name = null;
      let method = false;
      let j = k + 1;
      const parts = [];
      while (j < tokens.length && tokens[j].t !== '(') {
        if (tokens[j].t === ':') method = true;
        parts.push(tokens[j].t);
        j++;
      }
      if (parts.length) name = parts.join('');
      else if (prev(k) === '=' && /^[A-Za-z_]/.test(prev(k, 2))) name = prev(k, 2);
      // Role from what the function is passed to.
      let role = null;
      if (prev(k) === '(') {
        const callee = prev(k, 2);
        if (callee === 'useEffect' || callee === 'useLayoutEffect') role = 'effect';
        else if (callee === 'forwardRef' || callee === 'memo') role = 'component';
        else if (callee === 'Connect' && FRAME_EVENTS.test(prev(k, 4))) role = 'frame';
      }
      if (!role) {
        for (let b = 1; b <= 12 && k - b >= 0; b++) {
          if (prev(k, b) === 'BindToRenderStep') { role = 'frame'; break; }
          if (prev(k, b) === 'function' || prev(k, b) === 'end') break;
        }
      }
      // Body starts after the parameter list.
      let depth = 0;
      let bodyStart = tokens[k].i;
      for (let p = j; p < tokens.length; p++) {
        if (tokens[p].t === '(') depth++;
        else if (tokens[p].t === ')') {
          depth--;
          if (depth === 0) { bodyStart = tokens[p].i + 1; break; }
        }
      }
      const fn = { name, method, role, start: tokens[k].i, bodyStart, end: code.length, after: '' };
      functions.push(fn);
      stack.push({ type: 'function', fn });
    } else if (tok === 'do' || tok === 'repeat') {
      stack.push({ type: tok });
    } else if (tok === 'if') {
      if (!EXPRESSION_BEFORE.has(prev(k))) stack.push({ type: 'if' });
    } else if (tok === 'end' || tok === 'until') {
      const block = stack.pop();
      if (!block) { balanced = false; continue; }
      if (block.type === 'function') {
        block.fn.end = tokens[k].i;
        block.fn.after = tokens[k + 1] ? tokens[k + 1].t : '';
      }
    }
  }
  if (stack.length) balanced = false;
  return { functions, balanced };
}

function isComponent(fn, usesReact) {
  if (!usesReact) return false;
  if (fn.role === 'component') return true;
  if (!fn.name || fn.method) return false;
  const last = fn.name.split('.').pop();
  return /^[A-Z]/.test(last);
}

function innermost(functions, pos) {
  let best = null;
  for (const fn of functions) {
    if (fn.bodyStart <= pos && pos < fn.end && (!best || fn.start > best.start)) best = fn;
  }
  return best;
}

// Index of the bracket matching the one at `open` (in stripped code), or -1.
function matchBracket(code, open) {
  const pairs = { '(': ')', '{': '}', '[': ']' };
  const want = [];
  for (let i = open; i < code.length; i++) {
    const c = code[i];
    if (pairs[c]) want.push(pairs[c]);
    else if (c === ')' || c === '}' || c === ']') {
      if (want.pop() !== c) return -1;
      if (!want.length) return i;
    }
  }
  return -1;
}

// Props table of each `createElement("Class", {` / `e("Class", {` call for the given classes.
function hostElements(src, code, classes) {
  const out = [];
  const re = new RegExp(`\\b(?:createElement|e)\\(\\s*"(${classes.join('|')})"\\s*,\\s*\\{`, 'g');
  let m;
  while ((m = re.exec(src))) {
    const open = m.index + m[0].length - 1;
    const close = matchBracket(code, open);
    out.push({ className: m[1], at: m.index, props: close > 0 ? code.slice(open, close + 1) : '' });
  }
  return out;
}

// `local name = Instance.new("Class"...)` for the given classes.
function instanceVars(src, classes) {
  const out = [];
  const re = new RegExp(`local\\s+([A-Za-z_]\\w*)\\s*(?::\\s*\\w+)?\\s*=\\s*Instance\\.new\\(\\s*"(${classes.join('|')})"`, 'g');
  let m;
  while ((m = re.exec(src))) out.push({ name: m[1], className: m[2], at: m.index });
  return out;
}

const SMALL_SIZE = /Size\s*=\s*UDim2\.(?:fromOffset\(\s*(\d+)\s*,\s*(\d+)\s*\)|new\(\s*0\s*,\s*(\d+)\s*,\s*0\s*,\s*(\d+)\s*\))/;
function smallSize(text) {
  const m = SMALL_SIZE.exec(text);
  if (!m) return false;
  const w = Number(m[1] ?? m[3]);
  const h = Number(m[2] ?? m[4]);
  return Math.min(w, h) < 44;
}

// ---- scanning -------------------------------------------------------------------------

function scanSource(src, file = '<source>') {
  const code = strip(src);
  const lines = src.split('\n');
  const lineStarts = [0];
  for (let i = 0; i < src.length; i++) if (src[i] === '\n') lineStarts.push(i + 1);
  const lineOf = (pos) => {
    let lo = 0;
    let hi = lineStarts.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (lineStarts[mid] <= pos) lo = mid;
      else hi = mid - 1;
    }
    return lo + 1;
  };

  const findings = [];
  const seen = new Set();
  const add = (rule, pos, detail) => {
    const line = lineOf(pos);
    const key = `${rule}:${line}`;
    if (seen.has(key)) return;
    const here = lines[line - 1] || '';
    const above = lines[line - 2] || '';
    const ignored = (text) => new RegExp(`ui:ignore\\s+[\\w,\\s-]*\\b${rule}\\b`).test(text);
    if (ignored(here) || ignored(above)) return;
    seen.add(key);
    findings.push({ rule, severity: RULES[rule].severity, file, line, title: RULES[rule].title, fix: RULES[rule].fix, detail });
  };
  const each = (re, rule, text = code) => {
    const g = new RegExp(re.source, re.flags.includes('g') ? re.flags : re.flags + 'g');
    let m;
    while ((m = g.exec(text))) add(rule, m.index);
  };

  const usesReact = /\b(?:React\.)?createElement\b|\bReact\.useState\b/.test(code);
  const { functions } = parseFunctions(code);

  // Simple patterns.
  each(/\bTextScaled\s*=\s*true\b/, 'textscaled');
  each(/\b(?:MouseButton1Click|MouseButton1Down|MouseButton1Up|MouseButton2Click)\b/, 'mouse-click-event');
  each(/\bTouchEnabled\b/, 'ismobile-check');
  each(/\b(?:ViewportSize|AbsoluteSize)\.[XY]\s*(?:<=|>=|<|>)\s*\d{3,}|\b\d{3,}\s*(?:<=|>=|<|>)\s*[\w.]*(?:ViewportSize|AbsoluteSize)\.[XY]/, 'viewport-breakpoint');
  each(/\b(?:ViewportSize|AbsoluteSize)(?:\.[XY])?\s*\/\s*(?:1920|1080|1280|720|1366|768|2560|1440)\b|\/\s*Vector2\.new\(\s*(?:1920|1280|1366)\s*,\s*(?:1080|720|768)\s*\)/, 'fixed-design-resolution');
  each(/\bGetGuiInset\s*\(/, 'gui-inset-math');
  each(/\bIgnoreGuiInset\s*=\s*true\b/, 'ignore-gui-inset');
  each(/\bZIndexBehavior\.Global\b/, 'zindex-global');
  each(/\bScreenInsets\.None\b/, 'screen-insets-none');
  each(/\bEnum\.Font\.(?:Gotham|Arial)\w*/, 'legacy-font');
  each(/\bRoact\.createElement\b|require\([^)\n]*\bRoact\b\s*\)/, 'legacy-roact');
  each(/"CanvasGroup"/, 'canvasgroup', src);
  each(/PlayerGui[^\n]*?(?::WaitForChild\([^)\n]*\)){3,}/, 'waitforchild-chain', src);

  // Hard-coded colours, fonts and corner sizes in components (theme and story files are exempt;
  // pure black / white are allowed for tint maths).
  const themeOrStory = /(^|[\/\\])(Theme|Tokens|GameTheme|Presets)\.luau?$|\.story\.luau?$|(^|[\/\\])Stories[\/\\]/.test(file);
  if (usesReact && !themeOrStory) {
    each(/\bColor3\.(?:fromRGB|fromHex|fromHSV)\s*\(|\bColor3\.new\(\s*(?!\)|0\s*,\s*0\s*,\s*0\s*\)|1\s*,\s*1\s*,\s*1\s*\))/, 'hardcoded-style');
    each(/\bFont\.(?:new|fromEnum|fromName|fromId)\s*\(/, 'hardcoded-style');
    each(/\bCornerRadius\s*=\s*UDim\.new\(\s*0\s*,\s*\d/, 'hardcoded-style');
  }

  if (/\bMouseEnter\b/.test(code) && !/\b(?:Activated|SelectionGained|TouchTap|InputBegan)\b/.test(code)) {
    add('hover-only', code.search(/\bMouseEnter\b/));
  }

  // Side effects directly in a component body (not in a nested callback or an effect).
  if (usesReact) {
    const re = /(?::Connect|\bInstance\.new|\btask\.(?:spawn|delay|defer)|:FireServer|:InvokeServer|\bcoroutine\.wrap)\s*\(/g;
    let m;
    while ((m = re.exec(code))) {
      const fn = innermost(functions, m.index);
      if (fn && isComponent(fn, usesReact)) add('render-side-effect', m.index, `in ${fn.name || 'component'}`);
    }
  }

  // Effects.
  for (const fn of functions) {
    if (fn.role !== 'effect') continue;
    const body = code.slice(fn.bodyStart, fn.end);
    if (/:Connect\s*\(|BindAction\w*\s*\(|\btask\.(?:delay|spawn|defer)\s*\(|\bInstance\.new\s*\(/.test(body)
      && !/\breturn\b(?!\s*nil\b)\s*\S/.test(body)) {
      add('effect-no-cleanup', fn.start);
    }
    if (fn.after === ')') add('effect-no-deps', fn.start);
  }

  // State setters called per frame.
  const setters = new Set();
  const setterRe = /local\s+\w+\s*(?::[^,=]+)?,\s*(\w+)\s*=\s*(?:React\.)?useState\b/g;
  let sm;
  while ((sm = setterRe.exec(code))) setters.add(sm[1]);
  if (setters.size) {
    for (const fn of functions) {
      if (fn.role !== 'frame') continue;
      const body = code.slice(fn.bodyStart, fn.end);
      for (const setter of setters) {
        const at = body.search(new RegExp(`\\b${setter}\\s*\\(`));
        if (at >= 0) add('state-per-frame', fn.bodyStart + at);
      }
    }
  }

  // Buttons, ScreenGuis, layouts.
  for (const el of hostElements(src, code, ['TextButton', 'ImageButton'])) {
    if (smallSize(el.props)) add('small-touch-target', el.at);
  }
  for (const v of instanceVars(src, ['TextButton', 'ImageButton'])) {
    const m = new RegExp(`\\b${v.name}\\.Size\\s*=\\s*([^\\n]+)`).exec(code);
    if (m && smallSize(`Size = ${m[1]}`)) add('small-touch-target', m.index);
  }
  for (const el of hostElements(src, code, ['ScreenGui'])) {
    if (!/\bResetOnSpawn\b/.test(el.props)) add('resetonspawn', el.at);
  }
  for (const v of instanceVars(src, ['ScreenGui'])) {
    if (!new RegExp(`\\b${v.name}\\.ResetOnSpawn\\b`).test(code)) add('resetonspawn', v.at);
  }
  for (const el of hostElements(src, code, ['UIListLayout', 'UIGridLayout'])) {
    if (!/\bSortOrder\b/.test(el.props)) add('missing-sort-order', el.at);
  }
  for (const v of instanceVars(src, ['UIListLayout', 'UIGridLayout'])) {
    if (!new RegExp(`\\b${v.name}\\.SortOrder\\b`).test(code)) add('missing-sort-order', v.at);
  }

  return findings;
}

function listFiles(target) {
  const stat = fs.statSync(target);
  if (stat.isFile()) return [target];
  const out = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        if (!SKIP_DIRS.has(entry.name)) walk(path.join(dir, entry.name));
      } else if (/\.luau?$/.test(entry.name)) {
        out.push(path.join(dir, entry.name));
      }
    }
  };
  walk(target);
  return out.sort();
}

function scanPath(target) {
  const files = listFiles(target);
  const root = fs.statSync(target).isFile() ? path.dirname(target) : target;
  let findings = [];
  let reactFiles = 0;
  for (const file of files) {
    const src = fs.readFileSync(file, 'utf8');
    if (/\bcreateElement\b/.test(src)) reactFiles++;
    findings = findings.concat(scanSource(src, path.relative(root, file) || path.basename(file)));
  }
  const rank = (s) => SEVERITIES.indexOf(s);
  findings.sort((a, b) => rank(b.severity) - rank(a.severity) || a.file.localeCompare(b.file) || a.line - b.line);
  return { files: files.length, reactFiles, findings };
}

function main(argv) {
  const args = argv.slice(2);
  const opt = { json: false, min: 'info', failOn: null, target: null };
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--json') opt.json = true;
    else if (a === '--min') opt.min = args[++i];
    else if (a === '--fail-on') opt.failOn = args[++i];
    else if (a === '-h' || a === '--help') opt.target = null;
    else opt.target = a;
  }
  if (!opt.target || !SEVERITIES.includes(opt.min) || (opt.failOn && !SEVERITIES.includes(opt.failOn))) {
    console.log('usage: node uiscan.cjs <path> [--json] [--min info|low|medium|high] [--fail-on <severity>]');
    return 2;
  }
  if (!fs.existsSync(opt.target)) {
    console.error(`not found: ${opt.target}`);
    return 2;
  }
  const result = scanPath(opt.target);
  const shown = result.findings.filter((f) => SEVERITIES.indexOf(f.severity) >= SEVERITIES.indexOf(opt.min));
  if (opt.json) {
    console.log(JSON.stringify({ ...result, findings: shown }, null, 2));
  } else {
    const counts = {};
    for (const f of shown) counts[f.severity] = (counts[f.severity] || 0) + 1;
    for (const f of shown) {
      console.log(`[${f.severity}] ${f.rule}  ${f.file}:${f.line}${f.detail ? `  (${f.detail})` : ''}`);
      console.log(`    ${f.title}`);
      console.log(`    fix: ${f.fix}`);
    }
    const summary = SEVERITIES.slice().reverse().map((s) => `${counts[s] || 0} ${s}`).join(', ');
    console.log(`\n${result.files} Luau files (${result.reactFiles} using React): ${summary}`);
  }
  if (opt.failOn) {
    const worst = result.findings.some((f) => SEVERITIES.indexOf(f.severity) >= SEVERITIES.indexOf(opt.failOn));
    if (worst) return 1;
  }
  return 0;
}

module.exports = { RULES, scanSource, scanPath, strip, parseFunctions };

if (require.main === module) process.exit(main(process.argv));
