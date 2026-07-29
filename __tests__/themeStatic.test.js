// Static guard against the one theming mistake that no runtime test can see.
//
// `StyleSheet.create({...})` runs ONCE, at module load, and freezes whatever
// COLORS held at that moment. A block written that way still renders perfectly —
// it just renders the LIGHT colour forever, so dark mode shows a white card and
// every screen test still passes. themed() exists precisely to avoid that.
//
// This is how the "some places still white in dark mode" bug got in: the sweep
// that replaced hex literals with tokens ran over two files whose stylesheets had
// never been converted, so they silently baked.
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const DIRS = ['screens', 'components', 'utils'];

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name === 'node_modules' || e.name === '__tests__') continue;
      walk(p, out);
    } else if (e.name.endsWith('.js')) out.push(p);
  }
  return out;
}

// Walk to the ')' matching the '(' at `open`, skipping strings and comments.
function matchParen(src, open) {
  let depth = 0;
  let i = open;
  while (i < src.length) {
    const c = src[i];
    const n = src[i + 1];
    if (c === '/' && n === '/') { while (i < src.length && src[i] !== '\n') i += 1; continue; }
    if (c === '/' && n === '*') { i = src.indexOf('*/', i + 2); if (i < 0) return -1; i += 2; continue; }
    if (c === "'" || c === '"' || c === '`') {
      const q = c;
      i += 1;
      while (i < src.length) {
        if (src[i] === '\\') { i += 2; continue; }
        if (src[i] === q) { i += 1; break; }
        i += 1;
      }
      continue;
    }
    if (c === '(') depth += 1;
    else if (c === ')') { depth -= 1; if (depth === 0) return i; }
    i += 1;
  }
  return -1;
}

function bakedBlocks() {
  const files = DIRS
    .map((d) => path.join(ROOT, d))
    .filter((d) => fs.existsSync(d))
    .flatMap((d) => walk(d));

  const offenders = [];
  for (const file of files) {
    const src = fs.readFileSync(file, 'utf8');
    let from = 0;
    for (;;) {
      const idx = src.indexOf('StyleSheet.create(', from);
      if (idx < 0) break;
      const open = idx + 'StyleSheet.create'.length;
      const close = matchParen(src, open);
      if (close < 0) { from = open + 1; continue; }
      const inner = src.slice(open + 1, close);
      if (/\bCOLORS\.|\bSHADOW\b|\bSCRIM\b/.test(inner)) {
        const line = src.slice(0, idx).split('\n').length;
        offenders.push(`${path.relative(ROOT, file).replace(/\\/g, '/')}:${line}`);
      }
      from = close + 1;
    }
  }
  return offenders;
}

describe('theme (static)', () => {
  it('no StyleSheet.create block reads a theme token', () => {
    // If this fails: change that block to `themed((C) => ({ ... }))` and swap its
    // COLORS.x for C.x. Inline styles in JSX are fine — they re-read every render.
    expect(bakedBlocks()).toEqual([]);
  });
});
