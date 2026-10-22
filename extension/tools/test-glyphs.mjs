/* QA Wrap — local-first QA toolkit in the ISTQB shape. */
// Gate: Thmanyah is the only typeface. Any character a user can see that is not
// in the cmap of the faces ui/fonts.css ships would fall back to another font.
// Scans every i18n string and the string/markup/CSS literals of shipped files.
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const EXT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PY = `
import re,base64,io,json
from fontTools.ttLib import TTFont
cm=set()
for b in re.findall(r"base64,([A-Za-z0-9+/=]+)",open('ui/fonts.css',encoding='utf8').read()):
    cm|=set(TTFont(io.BytesIO(base64.b64decode(b))).getBestCmap())
print(json.dumps(sorted(cm)))`;
const r = spawnSync('uv', ['run', '--quiet', '--with', 'fonttools', '--with', 'brotli', 'python', '-c', PY],
  { cwd: EXT, encoding: 'utf8', env: { ...process.env, PYTHONUTF8: '1' } });
if (r.status !== 0) { console.error('FAIL cmap extraction:', r.stderr || r.error); process.exit(1); }
const cmap = new Set(JSON.parse(r.stdout));

// Invisible format characters draw no glyph, so no fallback font is involved.
const isFormat = (c) => (c >= 0x200B && c <= 0x200F) || (c >= 0x202A && c <= 0x202E) ||
  (c >= 0x2060 && c <= 0x2064) || (c >= 0x2066 && c <= 0x2069) || c === 0xFEFF || (c >= 0xFE00 && c <= 0xFE0F);
const SKIP_DIR = new Set(['node_modules', 'dist', 'tools', 'vendor', '.git']);
const SKIP_FILE = new Set(['fonts.css']);
// Files whose non-cmap characters never render in the extension's own UI: they are
// text written INTO exports, files and other apps' messages, in-page test payloads,
// or regex detectors. A single line can opt out with a glyph-ok comment. Fallback there is the receiving app's font, not ours.
const EXEMPT = {
  'background/action-icon.js': 'toolbar badge text, drawn by Chrome in its own font',
  'content/rtl-stress.js': 'deliberate stress text injected into the page under test',
  'content/selector-engine.js': 'Arabic regex ranges',
  'core/artifact-docs.js': 'markdown export', 'core/docs.js': 'SRS export', 'core/docshell.js': 'exported HTML document',
  'core/exporters.js': 'export text', 'core/formats.js': 'export text', 'core/harvest.js': 'generated test code and its regex',
  'core/istqb-render.js': 'ISTQB export', 'core/suite.js': 'suite export', 'core/locatorplan.js': 'export text',
  'core/agent.js': 'agent prompt text', 'core/blackbox.js': 'map key, not shown', 'core/provenance.js': 'stamp written into exports',
  'core/flow.js': 'Arabic regex ranges and test text', 'core/artifact.js': 'Arabic regex ranges',
};
const BS = String.fromCharCode(92);
const NL = String.fromCharCode(10);

const missing = [];
function check(where, text) {
  text.split(NL).forEach((line, i) => {
    for (const ch of line) {
      const c = ch.codePointAt(0);
      if (c < 128 || cmap.has(c) || isFormat(c)) continue;
      missing.push(`${where}:${i + 1}  U+${c.toString(16).toUpperCase().padStart(4, '0')} ${JSON.stringify(ch)}  ${line.trim().slice(0, 90)}`);
    }
  });
}
// Escapes and entities are decoded first: a u-escape or an HTML numeric entity shows the same glyph.
const decode = (s, ext) => {
  // Arabic-block escapes are regex ranges (detectors), never a symbol a user sees: left alone.
  const code = (m, h) => { const c = parseInt(h, 16); return (c >= 0x600 && c <= 0x6FF) || (c >= 0x750 && c <= 0x77F) || (c >= 0xFB50 && c <= 0xFEFF) ? m : String.fromCodePoint(c); };
  s = s.replace(new RegExp(BS + BS + 'u\\{([0-9a-fA-F]+)\\}', 'g'), code)
    .replace(new RegExp(BS + BS + 'u([0-9a-fA-F]{4})', 'g'), code)
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(+d))
    .replace(/&nbsp;/g, String.fromCharCode(0xA0)).replace(/&rarr;/g, String.fromCharCode(0x2192)).replace(/&larr;/g, String.fromCharCode(0x2190));
  // CSS content: backslash-hex is a code point (stylesheets only).
  return ext === '.css' ? s.replace(new RegExp(BS + BS + '([0-9a-fA-F]{4,6}) ?', 'g'), (_, h) => String.fromCodePoint(parseInt(h, 16))) : s;
};
const blank = (m) => m.split(NL).map(() => '').join(NL); // keep line numbers
const stripComments = (s, ext) => ext === '.html' ? s.replace(/<!--[\s\S]*?-->/g, blank)
  : ext === '.css' ? s.replace(/\/\*[\s\S]*?\*\//g, blank)
  : s.replace(/\/\*[\s\S]*?\*\//g, blank).replace(new RegExp('(^|[^:"\'`' + BS + BS + '])//[^\\n]*', 'g'), '$1');

function walkJson(v, p, file) {
  if (typeof v === 'string') check(`${file} ${p}`, v);
  else if (v && typeof v === 'object') for (const k of Object.keys(v)) walkJson(v[k], `${p}.${k}`, file);
}
for (const f of ['en.json', 'ar.json']) {
  walkJson(JSON.parse(fs.readFileSync(path.join(EXT, 'platform', 'i18n', f), 'utf8')), '', `platform/i18n/${f}`);
}
function walk(d) {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, e.name);
    if (e.isDirectory()) { if (!SKIP_DIR.has(e.name)) walk(p); continue; }
    const ext = path.extname(e.name);
    if (!['.html', '.js', '.mjs', '.css'].includes(ext) || SKIP_FILE.has(e.name)) continue;
    const rel = path.relative(EXT, p).replace(/\\/g, '/');
    if (EXEMPT[rel]) continue;
    const raw = fs.readFileSync(p, 'utf8').split(NL).map((l) => (l.includes('glyph-ok') ? '' : l)).join(NL);
    check(rel, stripComments(decode(raw, ext), ext));
  }
}
walk(EXT);

const uniq = [...new Set(missing)];
if (uniq.length) { console.error(uniq.join('\n')); console.error(`FAIL glyphs: ${uniq.length} missing from the Thmanyah cmap`); process.exit(1); }
console.log(`glyphs: 0 missing (${cmap.size} in cmap)`);
