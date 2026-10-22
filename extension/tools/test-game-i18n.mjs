/* QA Wrap — local-first QA toolkit in the ISTQB shape. */
/**
 * Bug Hunt strings (DESIGN-bug-hunt sections 2, 5; project CLAUDE.md rule 11): EN and AR change together, banned terms are
 * absent, no label has "&" or "+", a label starting "Stop" is exactly "Stop", and the Arabic captions name things the way
 * the Arabic UI does.
 *
 *   node tools/test-game-i18n.mjs        (from extension/, PYTHONUTF8=1)
 *
 * Plain node. Also checks that every data-i18n key used in index.html and every t('...') key used in game.js and the levels
 * exists in both files, and that every scoring key (scoring.js) has both texts.
 */
import fs from 'node:fs';
import path from 'node:path';
import { ok, nonEmpty, proveTeeth, skipNotEnforced, finish } from './lib-assert.mjs';
import { has, readJson, GAME, imp } from './lib-game-engine.mjs';

if (!has('strings/en.json', 'strings/ar.json', 'index.html')) {
  skipNotEnforced({ rule: 11, what: 'game string tables', why: 'extension/game/strings (lane A) has not landed' });
  finish('test-game-i18n', { skipped: 1 });
}
const en = readJson(GAME, 'strings', 'en.json');
const ar = readJson(GAME, 'strings', 'ar.json');
const keysEn = Object.keys(en).sort();
const keysAr = Object.keys(ar).sort();
nonEmpty(keysEn, 'English strings');

ok(JSON.stringify(keysEn) === JSON.stringify(keysAr), 'strings/en.json and ar.json have the same key set', `only EN: ${keysEn.filter((k) => !(k in ar)).slice(0, 6).join(',')}; only AR: ${keysAr.filter((k) => !(k in en)).slice(0, 6).join(',')}`);
const empty = (t) => keysEn.filter((k) => typeof t[k] !== 'string' || t[k].trim() === '');
ok(empty(en).length === 0 && empty(ar).length === 0, 'no empty value in either language', [...empty(en), ...empty(ar)].slice(0, 6).join(','));
const AR_SCRIPT = /[؀-ۿ]/;
const LATIN_OK = new Set(['app.brand', 'app.name']);
const STRAY = new Set(['shop.l3.footer']); // the planted stray text "undefined" is the same in both languages on purpose
const noArabic = keysAr.filter((k) => !STRAY.has(k) && !AR_SCRIPT.test(ar[k]) && !/^(?:lang\.|app\.brand|app\.titleTag)/.test(k) && /[A-Za-z]{3,}/.test(ar[k]));
ok(noArabic.length === 0, 'every Arabic value contains Arabic script (brand names aside)', noArabic.slice(0, 5).map((k) => `${k}=${ar[k]}`).join(' | '));
const slots = (s) => (String(s).match(/\{\w+\}/g) || []).sort().join();
const slotBad = keysEn.filter((k) => slots(en[k]) !== slots(ar[k]));
ok(slotBad.length === 0, 'EN and AR use the same {placeholders}', slotBad.slice(0, 5).join(','));
void LATIN_OK;

/* banned terms, in both languages */
const BANNED = [/photograph/i, /\bpicture\b/i, /harvest/i, /\barm(?:ed|ing)?\b/i, /crosshair/i, /Stop\s*&\s*review/i, /Cairo/i];
const AR_BANNED = [/التقاط صورة فوتوغرافية/, /حصاد/, /مسلّح|تسليح/];
for (const [lang, t, bans] of [['EN', en, BANNED], ['AR', ar, [...BANNED, ...AR_BANNED]]]) {
  const hits = keysEn.flatMap((k) => bans.filter((re) => re.test(t[k] || '')).map((re) => `${k}: ${re}`));
  ok(hits.length === 0, `${lang}: no banned term (photograph, picture as screenshot, harvest, arm/armed, crosshair, "Stop & review", Cairo)`, hits.slice(0, 4).join(' | '));
}
proveTeeth('the banned-term scan', (s) => BANNED.filter((re) => re.test(s)), 'Arm the crosshair and harvest a photograph');

/* labels: no "&", no "+", "Stop" exact */
const LABEL = /^(?:title\.start|title\.skipIntro|card\.go|card\.skip|rail\.skip|clear\.next|finale\.copyScore|finale\.again|set\.done|set\.close|pause\.resume|tool\.|score\.tool\.|set\.reset|rail\.hint|rail\.done|btn\.)/;
const labels = nonEmpty(keysEn.filter((k) => LABEL.test(k)), 'button and tool label keys');
for (const [lang, t] of [['EN', en], ['AR', ar]]) {
  const amp = labels.filter((k) => /[&+]/.test(t[k]));
  ok(amp.length === 0, `${lang}: no label contains "&" or "+"`, amp.map((k) => `${k}=${t[k]}`).join(' | '));
}
const stops = labels.filter((k) => /^Stop/i.test(en[k]));
ok(stops.every((k) => en[k] === 'Stop'), 'EN: every label starting "Stop" is exactly "Stop"', stops.map((k) => `${k}=${en[k]}`).join(' | '));
const arStop = labels.filter((k) => /^(?:أوقف|إيقاف|توقف)/.test(ar[k]));
ok(arStop.every((k) => ar[k] === (ar['tool.stop'] || ar[k])), 'AR: every label starting with the Stop word equals the Stop label');
proveTeeth('the Stop label rule', (s) => (s === 'Stop' ? [] : ['not exact']), 'Stop & review');

/* keys used by the page and the game exist */
{
  const used = new Set();
  const html = fs.readFileSync(path.join(GAME, 'index.html'), 'utf8');
  for (const m of html.matchAll(/data-i18n(?:-aria|-placeholder)?="([^"]+)"/g)) used.add(m[1]);
  for (const f of ['game.js', 'trial.js', 'trial-ui.js', ...fs.readdirSync(path.join(GAME, 'levels')).map((x) => `levels/${x}`), ...fs.readdirSync(path.join(GAME, 'trials')).map((x) => `trials/${x}`)]) {
    if (!has(f)) continue;
    const src = fs.readFileSync(path.join(GAME, f), 'utf8');
    for (const m of src.matchAll(/\bt\(\s*'([a-z][\w.-]*)'/g)) used.add(m[1]);
  }
  nonEmpty([...used], 'string keys used by index.html, game.js and levels');
  // a key ending in '.' is a prefix built at run time (t('qaw.' + state)): some key must carry it, in both languages
  const RUNTIME_PREFIX = new Set(['trial.attune.s']); // allow-list: trial-ui.js builds t('trial.attune.s' + step number); the s1..s4 keys are checked by the startsWith test below
  const gone = [...used].filter((k) => (k.endsWith('.') || RUNTIME_PREFIX.has(k) ? !keysEn.some((x) => x.startsWith(k)) || !keysAr.some((x) => x.startsWith(k)) : !(k in en) || !(k in ar)));
  ok(gone.length === 0, 'every string key the page and levels use exists in EN and AR', gone.slice(0, 8).join(', '));
}

/* scoring.js keys: the table's tool labels and teaching reasons need both texts */
if (has('scoring.js')) {
  const { scoringKeys } = await imp('scoring.js');
  const need = scoringKeys();
  const miss = need.filter((k) => !en[k] || !ar[k]);
  ok(miss.length === 0, `scoring.js: all ${need.length} tool labels and teaching reasons exist in EN and AR`, miss.slice(0, 6).join(', '));
}

/* Arabic captions: only QA Wrap and Enter stay Latin; they name things the way the AR UI does */
if (has('audio/narration-manifest.json')) {
  const m = readJson(GAME, 'audio', 'narration-manifest.json');
  for (const l of m.lines) {
    const latin = (l.caption_ar.match(/[A-Za-z][A-Za-z ]*/g) || []).map((x) => x.trim()).filter(Boolean);
    ok(latin.every((w) => /^(?:QA Wrap|Enter)$/.test(w)), `${l.id}: the Arabic caption keeps only "QA Wrap" and "Enter" in Latin`, latin.join(' | '));
  }
  const caps = m.lines.filter((l) => /QA Wrap/.test(l.text));
  ok(caps.every((l) => /QA Wrap/.test(l.caption_ar)), 'the brand "QA Wrap" is Latin in the Arabic captions too');
  ok(en['app.brand'] === 'QA Wrap' && ar['app.brand'] === 'QA Wrap', 'the brand is "QA Wrap" in both string tables');
}
/* ADHD rule (Nader, 15 Oct 2026): a game hint is one short line, at most 12 words, in both languages */
{
  const HINT = /^(?:hint\.\d+|needs\.\w+|nudge\.\w+|rail\.nudge\w*|rail\.stoppedNote|noise\.expected)$/;
  const words = (s) => String(s).trim().split(/\s+/).filter(Boolean).length;
  const hintKeys = keysEn.filter((k) => HINT.test(k));
  ok(hintKeys.length >= 10, `found the hint strings (${hintKeys.length})`, hintKeys.join(','));
  for (const [lang, t] of [['EN', en], ['AR', ar]]) {
    const long = hintKeys.filter((k) => words(t[k]) > 12);
    ok(long.length === 0, `${lang}: every game hint is at most 12 words`, long.map((k) => `${k}=${words(t[k])}`).join(' | '));
    const lines = hintKeys.filter((k) => /\n/.test(t[k]));
    ok(lines.length === 0, `${lang}: every game hint is one line`, lines.join(','));
  }
  ok(words(en['rail.stoppedNote']) <= 8 && words(ar['rail.stoppedNote']) <= 8, 'the "start a new recording" note is at most 8 words');
}
finish('test-game-i18n');
