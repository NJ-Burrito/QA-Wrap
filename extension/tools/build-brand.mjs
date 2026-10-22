/* QA Wrap — local-first QA toolkit in the ISTQB shape. */
/**
 * Writes brand/brand.json into every place that cannot import it.
 *
 *   node tools/build-brand.mjs --write   regenerate the marked regions
 *   node tools/build-brand.mjs --check   exit 1 if any region differs (default)
 *
 * brand/brand.json is the one file a person edits. See brand/README.md.
 * Pure text edits on marked regions; nothing outside a region is touched.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const EXT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ROOT = path.resolve(EXT, '..');
export const BRAND = JSON.parse(fs.readFileSync(path.join(EXT, 'brand/brand.json'), 'utf8'));

const q = (s) => `'${String(s).replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;
const madeBy = (lang) => BRAND.madeBy[lang].replace('{maker}', BRAND.publisher[lang]);
const lockup = `${BRAND.name} by ${BRAND.publisher.en}`;

/** The data block of core/product.js. */
export function productBlock() {
  const u = BRAND.urls;
  return [
    '// brand:begin (generated from brand/brand.json by tools/build-brand.mjs; edit that file, not this block)',
    'const URLS = Object.freeze({',
    ...['homepage', 'support', 'privacy', 'practice', 'trust', 'terms'].map((k) => `  ${k}: ${q(u[k] || '')},`),
    '});',
    '',
    'export const PRODUCT = Object.freeze({',
    `  name: ${q(BRAND.name)},`,
    `  maker: ${q(BRAND.maker.en)},`,
    `  publisher: ${q(BRAND.publisher.en)},`,
    `  lockup: ${q(lockup)},`,
    `  code: ${q(BRAND.code)},`,
    `  extensionId: ${q(BRAND.extensionId)},`,
    `  tagline: ${q(BRAND.tagline)},`,
    `  kind: ${q(BRAND.kind)},`,
    `  supportEmail: ${q(BRAND.emails.support || '')},`,
    `  listed: ${BRAND.listed ? 'true' : 'false'},`,
    `  reviewUrl: ${q(BRAND.reviewUrl || '')},`,
    '  urls: URLS,',
    '  homepage: URLS.homepage,',
    '  support: URLS.support,',
    '  privacy: URLS.privacy,',
    `  since: ${Number(BRAND.since)},`,
    '});',
    '// brand:end',
  ].join('\n');
}

const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const writes = new Map(); // rel (from repo root) -> new text

/** Replace the text between two markers (inclusive of the marker lines' content). */
function region(rel, re, block) {
  const src = writes.get(rel) ?? read(rel);
  if (!re.test(src)) throw new Error(`${rel}: marker region not found (${re})`);
  writes.set(rel, src.replace(re, () => block));
}

function setJsonKey(rel, key, value) {
  const src = writes.get(rel) ?? read(rel);
  const re = new RegExp(`^(\\s*"${key.replace(/\./g, '\\.')}": )"(?:[^"\\\\]|\\\\.)*"`, 'm');
  if (!re.test(src)) throw new Error(`${rel}: key ${key} not found`);
  writes.set(rel, src.replace(re, (_m, a) => `${a}${JSON.stringify(value)}`));
}

function build() {
  region('extension/core/product.js', /\/\/ brand:begin[\s\S]*?\/\/ brand:end/, productBlock());

  // manifest: textual so the file layout is kept.
  {
    const rel = 'extension/manifest.json';
    let t = read(rel);
    t = t.replace(/^(  "name": )"[^"]*"/m, `$1${JSON.stringify(BRAND.name)}`)
      .replace(/^(  "short_name": )"[^"]*"/m, `$1${JSON.stringify(BRAND.name)}`)
      .replace(/^(    "default_title": )"[^"]*"/m, `$1${JSON.stringify(BRAND.name)}`);
    t = t.replace(/,\n  "homepage_url": "[^"]*"(?=\n\})/, '');
    if (BRAND.urls.homepage) t = t.replace(/\n\}\n?$/, `,\n  "homepage_url": ${JSON.stringify(BRAND.urls.homepage)}\n}\n`);
    writes.set(rel, t);
  }

  // icons: one map (brand.icons) -> manifest blocks, the places that name a file, the sizes the tools draw
  {
    const I = BRAND.icons;
    const rel = 'extension/manifest.json';
    let t = writes.get(rel);
    const rows = (indent) => Object.entries(I.action).map(([k, v]) => `${indent}  ${JSON.stringify(k)}: ${JSON.stringify(v)}`).join(',\n');
    const block = (indent) => `{\n${rows(indent)}\n${indent}}`;
    t = t.replace(/(  "icons": )\{[^}]*\}/, (_m, a) => a + block('  ')).replace(/("default_icon": )\{[^}]*\}/, (_m, a) => a + block('    '));
    writes.set(rel, t);
    const file = (size) => I.action[String(size)];
    const subs = [
      ['extension/background/notify.js', /(iconUrl: chrome\.runtime\.getURL\(')[^']*('\))/, file(I.notification)],
      ['extension/ui/download.js', /(iconUrl: chrome\.runtime\.getURL\(')[^']*('\))/, file(I.notification)],
      ['extension/devtools/devtools.js', /(panels\.create\('[^']*', ')[^']*(')/, `../${file(I.devtools)}`],
      ['extension/sidepanel/sidepanel.html', /(<link rel="icon" href=")[^"]*(")/, `../${I.favicon}`],
    ];
    const ui = I.ui;
    region('extension/ui/scale.css', /\/\* brand:begin[\s\S]*?\/\* brand:end \*\//, `/* brand:begin (icon sizes, generated from brand/brand.json icons.ui) */
  --sz-icon-s: ${ui.s}px;
  --sz-icon-m: ${ui.m}px;
  --sz-icon-l: ${ui.l}px;
  /* brand:end */`);
    for (const [r, re, text] of subs) {
      const src = writes.get(r) ?? read(r);
      if (!re.test(src)) throw new Error(`${r}: icon reference not found (${re})`);
      writes.set(r, src.replace(re, (_m, open, close) => open + text + close));
    }
  }

  for (const lang of ['en', 'ar']) {
    const rel = `extension/platform/i18n/${lang}.json`;
    for (const key of ['common.madeBy', 'options.foot.madeBy', 'report.foot.madeBy']) setJsonKey(rel, key, madeBy(lang));
  }

  // HTML fallbacks (English text between the tags; the translation overrides it at run time).
  const html = [
    ['extension/report/report.html', /(<span class="made-by" data-i18n="report\.foot\.madeBy">)[^<]*(<\/span>)/, madeBy('en')],
    ['extension/options/options.html', /(<span class="made-by" data-i18n="options\.foot\.madeBy">)[^<]*(<\/span>)/, madeBy('en')],
    ['extension/options/options.html', /(<dd id="about-maker" data-i18n="options\.e1022\.maker">)[^<]*(<\/dd>)/, `${BRAND.publisher.en} (NJ-Burrito)`],
    ['extension/devtools/panel.html', /(<span data-i18n="common\.madeBy">)[^<]*(<\/span>)/, madeBy('en')],
    ['extension/devtools/panel.html', /(<span class="made-by" data-i18n="common\.madeBy">)[^<]*(<\/span>)/, madeBy('en')],
    ['extension/diagram/diagram.html', /(<span class="made-by" data-i18n="common\.madeBy">)[^<]*(<\/span>)/, madeBy('en')],
    ['extension/tutorials/tutorials.html', /(<span class="made-by" data-i18n="common\.madeBy">)[^<]*(<\/span>)/, madeBy('en')],
    ['extension/welcome/welcome.html', /(<span class="muted">)by [^<]*(<\/span>)/, `by ${BRAND.publisher.en}`],
    ['extension/welcome/welcome.html', /(<span class="made-by">)[^<]*(<\/span>)/, madeBy('en')],
  ];
  for (const [rel, re, text] of html) {
    const src = writes.get(rel) ?? read(rel);
    if (!re.test(src)) throw new Error(`${rel}: fallback span not found (${re})`);
    writes.set(rel, src.replace(re, (_m, open, close) => open + text + close));
  }

  // console banner (classic script)
  {
    const rel = 'extension/platform/console-brand.js';
    let t = writes.get(rel) ?? read(rel);
    t = t.replace(/(en: \{ tape: '[^']*', by: )'[^']*'/, `$1${q(madeBy('en'))}`).replace(/(ar: \{ tape: '[^']*', by: )'[^']*'/, `$1${q(madeBy('ar'))}`);
    writes.set(rel, t);
  }
}

/**
 * Prose that names the owner (legal texts, store listing, site, film cards) is not a generated region: it is
 * rewritten in place. brand/applied.json remembers the name last written, so a rebrand is one edit to
 * brand.json plus --write: every occurrence of the old name in `textTargets` becomes the new one.
 */
function expandTargets() {
  const out = [];
  const walk = (dir) => {
    for (const e of fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true })) {
      const rel = `${dir}/${e.name}`;
      if (e.isDirectory()) walk(rel);
      else if (/\.(html|md|txt|json|svg|xml|css|js)$/i.test(e.name) || !e.name.includes('.')) out.push(rel);
    }
  };
  for (const pat of BRAND.textTargets || []) {
    if (pat.endsWith('/**')) walk(pat.slice(0, -3));
    else if (pat.includes('*')) {
      const dir = path.posix.dirname(pat);
      const re = new RegExp(`^${path.posix.basename(pat).replace(/[.]/g, '\\.').replace(/\*/g, '.*')}$`);
      for (const e of fs.readdirSync(path.join(ROOT, dir))) if (re.test(e)) out.push(`${dir}/${e}`);
    } else out.push(pat);
  }
  return out;
}

const APPLIED = path.join(EXT, 'brand/applied.json');
function textPass() {
  const applied = JSON.parse(fs.readFileSync(APPLIED, 'utf8')).publisher;
  const now = BRAND.publisher;
  if (applied.en === now.en && applied.ar === now.ar) return false;
  // R-09: an empty name would be "replaced" between every character of every target file.
  if (!String(applied.en ?? '').trim() || !String(applied.ar ?? '').trim()) throw new Error('brand/applied.json has an empty publisher name; refusing to rewrite the prose targets (set the name that is written in them now).');
  for (const rel of expandTargets()) {
    const src = writes.get(rel) ?? read(rel);
    let t = src;
    for (const [from, to] of [[applied.en, now.en], [applied.en.toUpperCase(), now.en.toUpperCase()], [applied.ar, now.ar]]) t = t.split(from).join(to);
    if (t !== src) writes.set(rel, t);
  }
  return true;
}

const mode = process.argv.includes('--write') ? 'write' : 'check';
const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  build();
  const textMoved = textPass();
  let drift = 0;
  for (const [rel, text] of writes) {
    const cur = read(rel);
    if (cur === text) continue;
    drift++;
    if (mode === 'write') { fs.writeFileSync(path.join(ROOT, rel), text); console.log(`wrote ${rel}`); }
    else console.log(`DRIFT ${rel}`);
  }
  if (textMoved) {
    if (mode === 'write') { fs.writeFileSync(APPLIED, `${JSON.stringify({ publisher: BRAND.publisher }, null, 2)}
`); console.log('wrote extension/brand/applied.json'); }
    else { drift++; console.log('DRIFT brand/applied.json (the owner name changed; prose targets not rewritten)'); }
  }
  if (mode === 'check' && drift) { console.log(`${drift} file(s) differ from brand/brand.json; run: node tools/build-brand.mjs --write`); process.exit(1); }
  console.log(mode === 'write' ? `brand written (${drift} changed)` : 'brand in sync');
}
