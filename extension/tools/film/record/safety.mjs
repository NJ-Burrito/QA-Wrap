/* QA Wrap — local-first QA toolkit in the ISTQB shape. */
/**
 * What must never reach a frame.
 *
 * The films are recorded on the machine that builds them, which means the only
 * thing standing between a marketing asset and somebody's user name, home
 * directory or hostname is a check that runs before the PNG is written. The
 * bible (5.4) lists what must never appear and how each line is asserted; this
 * file is that table, executable.
 *
 * Two ways in, on purpose:
 *
 *   as a library   `driver.mjs` calls `assertShot()` for every shot, before a
 *                  single frame of that shot is written. A breach stops the
 *                  recording rather than producing footage that has to be
 *                  thrown away later.
 *   as a command   `node tools/film/record/safety.mjs [id ...]` re-reads every
 *                  `shot.json` already on disk and sweeps the lot. Run it after
 *                  a capture, and again before delivery, because the second
 *                  run costs nothing and answers a question a person would
 *                  otherwise have to answer by looking at 1440 frames.
 *
 * The deny-list is built from the machine, not typed in. Anything derived from
 * `os.userInfo()`, the hostname, or the environment's own paths is forbidden in
 * a frame. The fixture's invented people are the one family of person-shaped
 * strings that is allowed, and they are allowed because `fixture.mjs` commits
 * the list: an allowance nobody can read is not an allowance, it is a hole.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ALLOWED_STRINGS } from './fixture.mjs';
import { REPO, FILM_CAPTURE } from '../../lib-paths.mjs';

/* ── the deny-list, read off this machine ───────────────────────────────── */

/**
 * Every string that would identify the machine or the person using it.
 *
 * Short fragments are dropped: a two-letter user name would match half the
 * English language and turn every run red for no reason. Three characters is
 * the shortest thing worth failing a build over.
 */
export function denyList() {
  const raw = new Set();
  const add = (v) => { if (typeof v === 'string' && v.trim().length >= 3) raw.add(v.trim()); };

  try { add(os.userInfo().username); } catch { /* no user info in this sandbox */ }
  add(os.hostname());
  for (const key of ['USERNAME', 'USER', 'LOGNAME', 'COMPUTERNAME', 'USERDOMAIN', 'HOSTNAME']) add(process.env[key]);

  /* Every segment of the home directory and the profile: "C:", "Users" and
     "Desktop" are noise, so only segments that are not ordinary path furniture
     are kept. */
  const furniture = new Set(['c:', 'd:', 'users', 'home', 'desktop', 'documents', 'appdata', 'local', 'roaming', 'temp', 'tmp', 'var', 'mnt', 'opt']);
  for (const dir of [os.homedir(), process.env.USERPROFILE, process.env.HOME]) {
    if (!dir) continue;
    for (const seg of dir.split(/[\\/]+/)) if (seg && !furniture.has(seg.toLowerCase())) add(seg);
  }
  return [...raw];
}

/** The shapes that are forbidden whoever they belong to. */
const PATTERNS = [
  { id: 'jwt', label: 'a JSON web token', re: /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g },
  { id: 'bearer', label: 'a bearer token', re: /\bBearer\s+[A-Za-z0-9._~+/=-]{16,}/gi },
  { id: 'apikey', label: 'an API key', re: /\b(?:sk_live|sk_test|ghp_|gho_|github_pat_|xox[baprs]-|AKIA[0-9A-Z]{16})[A-Za-z0-9_-]*/g },
  { id: 'secret', label: 'a named secret', re: /\b(?:api[_-]?key|access[_-]?token|client[_-]?secret|password)\s*[=:]\s*["']?[A-Za-z0-9._~+/=-]{8,}/gi },
  { id: 'privatekey', label: 'a private key block', re: /-----BEGIN [A-Z ]*PRIVATE KEY-----/g },
  { id: 'winpath', label: 'an absolute Windows path', re: /\b[A-Za-z]:[\\/](?:Users|Program Files|Windows)[\\/][^\s"'<>|]{2,}/g },
  { id: 'unixpath', label: 'an absolute POSIX home path', re: /(?:^|[\s"'(])\/(?:home|Users)\/[A-Za-z0-9._-]{2,}\/[^\s"'<>|]*/g },
  { id: 'cookie', label: 'a session cookie', re: /\b(?:sessionid|session_id|JSESSIONID|PHPSESSID|connect\.sid)\s*=\s*[A-Za-z0-9._-]{8,}/gi },
];

/** Origins a filmed page is allowed to be on. Bible 5.1 rule 3. */
export function allowedOrigin(origin, { port, extensionId }) {
  if (!origin) return false;
  if (origin === `http://127.0.0.1:${port}`) return true;
  if (extensionId && origin === `chrome-extension://${extensionId}`) return true;
  return false;
}

/**
 * Hosts the product itself ships as copy.
 *
 * These are not machine data and never were: the report footer carries the
 * publisher's own address, and an accessibility finding links to the rule it
 * failed. Filming the product means filming its copy. Everything outside this
 * list, in a place a hostname can appear, is reported.
 */
const PRODUCT_HOSTS = [
  'example.com',
  'dequeuniversity.com',
  'www.w3.org',
  'w3.org',
  'developer.chrome.com',
  'chromewebstore.google.com',
];

const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
const HOST = /\bhttps?:\/\/([A-Za-z0-9.-]+)/g;

/* ── the scan ───────────────────────────────────────────────────────────── */

/**
 * Everything wrong with one blob of text.
 *
 * Answers a list rather than throwing, so one shot can report all of its
 * problems at once instead of one per run.
 */
export function scanText(text, { deny = denyList(), allowed = ALLOWED_STRINGS } = {}) {
  const found = [];
  if (!text) return found;
  const haystack = String(text);
  const lower = haystack.toLowerCase();

  for (const needle of deny) {
    const at = lower.indexOf(needle.toLowerCase());
    if (at >= 0) found.push({ kind: 'machine', what: `this machine's "${needle}"`, sample: excerpt(haystack, at) });
  }

  for (const p of PATTERNS) {
    p.re.lastIndex = 0;
    let m;
    while ((m = p.re.exec(haystack))) found.push({ kind: p.id, what: p.label, sample: mask(m[0]) });
  }

  EMAIL.lastIndex = 0;
  let m;
  while ((m = EMAIL.exec(haystack))) {
    if (allowed.some((a) => m[0].toLowerCase().includes(a.toLowerCase()))) continue;
    found.push({ kind: 'email', what: 'an email address that is not the fixture’s', sample: mask(m[0]) });
  }

  HOST.lastIndex = 0;
  while ((m = HOST.exec(haystack))) {
    const host = m[1].toLowerCase();
    if (host === '127.0.0.1' || host.startsWith('127.0.0.1:')) continue;
    if (PRODUCT_HOSTS.includes(host)) continue;
    found.push({ kind: 'host', what: `the hostname ${host}`, sample: m[0] });
  }

  return found;
}

const excerpt = (s, at) => s.slice(Math.max(0, at - 24), at + 40).replace(/\s+/g, ' ');
/** Never print the thing that must not be printed; print enough to find it. */
const mask = (s) => `${s.slice(0, 6)}…${s.length} chars`;

/* ── what the driver reads off a page before it films it ────────────────── */

/**
 * A page's state, in the shape `assertShot` and the sweep both understand.
 *
 * Read in the page, once per shot per act, and stored beside the frames. It is
 * deliberately text and numbers only: a state file that carried a screenshot
 * would be the same privacy problem one directory along.
 */
export const READ_STATE = `(() => {
  const box = document.scrollingElement || document.documentElement;
  const masked = [...document.querySelectorAll('[data-uqa-masked]')].map((el) => {
    const cs = getComputedStyle(el);
    const after = getComputedStyle(el, '::after');
    return {
      color: cs.color,
      inset: [after.top, after.right, after.bottom, after.left].join(' '),
      background: after.background || after.backgroundColor,
      field: el.hasAttribute('data-uqa-masked-field'),
      security: cs.webkitTextSecurity || cs.getPropertyValue('-webkit-text-security') || '',
      text: (el.textContent || '').trim().slice(0, 80),
    };
  });
  return {
    origin: location.origin,
    href: location.href,
    title: document.title,
    cookie: document.cookie,
    theme: document.documentElement.getAttribute('data-theme'),
    scrollHeight: box.scrollHeight,
    clientHeight: box.clientHeight,
    scrollWidth: box.scrollWidth,
    clientWidth: box.clientWidth,
    status: (document.getElementById('status')?.textContent || '').trim(),
    helpOpen: [...document.querySelectorAll('.tool-help')].filter((h) => !h.hidden).length,
    heroWhere: (document.getElementById('hero-where')?.textContent || '').trim(),
    /* Where the first activity group sits in the frame. A number that moves is
       the only proof a scroll shot actually scrolled. */
    anchorTop: (() => {
      const el = document.querySelector('.activity') || document.querySelector('main') || document.body;
      return el ? Math.round(el.getBoundingClientRect().top) : null;
    })(),
    masked,
    text: (document.body?.innerText || '').slice(0, 200000),
    values: [...document.querySelectorAll('input, textarea')].map((i) => (i.value || '').slice(0, 200)).join('\\n'),
  };
})()`;

/**
 * What must not be in a single frame, checked on every frame.
 *
 * The closing state is the wrong place for anything that only appears for part
 * of a take. The wall shot passed its closing check while an amber "press
 * Alt+Shift+V" health note and a help bubble scrolled through the middle of it,
 * because both were gone by the time the shot ended. This runs after each
 * screenshot instead, and costs one small read per frame.
 */
export const READ_DURING = `(() => ({
  helpOpen: [...document.querySelectorAll('.tool-help')].filter((h) => !h.hidden).length,
  /*
   * The amber "press Alt+Shift+V" note, where the product actually puts it.
   *
   * This guard first watched \`.tool-health\`, which is the little dot, and
   * passed while the note itself scrolled through the middle of the wall shot.
   * The note is a \`p.tool-invoke\` the row renders when \`UQA_CAN_RECORD\`
   * answers false, and the row stamps \`data-needs-invoke\` at the same moment;
   * both are watched, because either is the same defect in the frame.
   */
  healthNote: [...document.querySelectorAll('.tool-invoke, [data-needs-invoke="true"]')].filter((el) => {
    /* In the picture, not merely in the document. A note below the fold of a
       420 px panel is not in the frame, and failing a shot for it would be
       failing it for something no viewer can see. */
    const r = el.getBoundingClientRect();
    return r.height > 0 && r.bottom > 0 && r.top < innerHeight && r.right > 0 && r.left < innerWidth;
  }).length,
  /*
   * The amber dot, by the colour it is actually painted.
   *
   * The critic's 14 found the record card's "asks" state painting the warn
   * amber, which reads as a fault the tester has to fix. The product now
   * reserves amber for a real refusal, so any dot or ring still drawing
   * --warn #8E5A10 in a frame is either a regression or a genuine warning, and
   * neither belongs in this film. Read from the computed colour rather than
   * from a class, because the class is what changed.
   */
  /*
   * No regex literal in here, deliberately.
   *
   * This whole object is a template literal, so a backslash inside it is a
   * string escape before it is ever a regex: an escaped bracket lost its
   * backslash and the pattern would not compile. The evaluate then threw on
   * every frame and the caller swallowed it, which left every during-guard
   * silently dead for a whole revision. Comparing three numbers needs no
   * escaping and cannot rot the same way.
   */
  amberDots: [...document.querySelectorAll('.tool-health, .tool-health *')].filter((el) => {
    const r = el.getBoundingClientRect();
    if (!(r.height > 0 && r.bottom > 0 && r.top < innerHeight && r.right > 0 && r.left < innerWidth)) return false;
    const cs = getComputedStyle(el);
    return [cs.color, cs.backgroundColor, cs.borderTopColor, cs.outlineColor].some((v) => {
      const n = String(v || '').match(/[0-9]+/g);
      return !!n && Number(n[0]) === 142 && Number(n[1]) === 90 && Number(n[2]) === 16;
    });
  }).length,
  status: (document.getElementById('status')?.textContent || '').trim(),
  /*
   * Is the fixture's receipt panel wholly inside the frame?
   *
   * Shot 2 turns on the page keeping its promise, and in the first cut the
   * panel only slid into the bottom edge for the last half second: four of the
   * five seconds were indistinguishable from shot 1. "Present" is not the
   * test, "wholly inside the capture rectangle, from this frame on" is, so it
   * is measured per frame rather than once at the end.
   */
  receiptFully: (() => {
    const el = document.getElementById('receipt');
    if (!el || el.hidden) return false;
    const r = el.getBoundingClientRect();
    return r.height > 0 && r.top >= 0 && r.bottom <= innerHeight && r.left >= 0 && r.right <= innerWidth;
  })(),
}))()`;

/** One frame's reading against the shot's during-rules. Answers a complaint or null. */
export function checkDuring(rules, reading, frameIndex) {
  for (const rule of rules || []) {
    if (rule.kind === 'noHelpOpen' && reading.helpOpen) {
      return `frame ${frameIndex}: ${reading.helpOpen} help panel(s) open in shot`;
    }
    if (rule.kind === 'noHealthNote' && reading.healthNote) {
      return `frame ${frameIndex}: the "press the shortcut" note is in shot (${reading.healthNote} marker(s))`;
    }
    if (rule.kind === 'noAmberHealthDot' && reading.amberDots) {
      return `frame ${frameIndex}: ${reading.amberDots} health marker(s) painted in the warn amber`;
    }
    if (rule.kind === 'receiptFullyInViewFrom' && frameIndex >= rule.fromFrame && !reading.receiptFully) {
      return `frame ${frameIndex}: the receipt is not wholly inside the frame, and from frame ${rule.fromFrame} it must be`;
    }
    if (rule.kind === 'statusEmpty' && reading.status) {
      return `frame ${frameIndex}: a toast is in shot ("${reading.status.slice(0, 60)}")`;
    }
  }
  return null;
}

/* ── the assertions the storyboard declares ─────────────────────────────── */

/**
 * Run one storyboard `assert` entry against a live page.
 *
 * The storyboard names these declaratively so a re-cut never has to touch a
 * step file: adding "this shot must show sixteen tiles" is a line of JSON.
 */
export async function runAssert(page, a, state, opening) {
  const q = (sel) => page.evaluate((s) => !!document.querySelector(s), sel);
  switch (a.kind) {
    case 'noScrollbar': {
      if (state.scrollHeight > state.clientHeight + 1) throw new Error(`the page scrolls: ${state.scrollHeight} > ${state.clientHeight}`);
      if (state.scrollWidth > state.clientWidth + 1) throw new Error(`the page scrolls sideways: ${state.scrollWidth} > ${state.clientWidth}`);
      return;
    }
    /*
     * Every one of them inside the frame, not merely on the page.
     *
     * `scrollHeight <= clientHeight` is the check bible 2.3 names, and it is
     * not enough: the popup scrolls an inner element, so the document reports
     * that it fits while eleven of the sixteen tool tiles sit below the bottom
     * edge. That is exactly the frame 8.6 asks a critic to count tiles on, so
     * the check counts them here instead.
     */
    case 'fits': {
      if (state.scrollHeight > state.clientHeight) throw new Error(`the page scrolls: ${state.scrollHeight} > ${state.clientHeight}`);
      return;
    }
    case 'allInView': {
      const out = await page.evaluate((sel) => {
        const all = [...document.querySelectorAll(sel)];
        const missed = all.filter((el) => {
          const r = el.getBoundingClientRect();
          return r.top < 0 || r.bottom > innerHeight || r.left < 0 || r.right > innerWidth;
        });
        return { total: all.length, missed: missed.length };
      }, a.selector);
      if (a.equals !== undefined && out.total !== a.equals) throw new Error(`${a.selector}: expected ${a.equals}, found ${out.total}`);
      if (out.missed) throw new Error(`${out.missed} of ${out.total} ${a.selector} are outside the frame`);
      return;
    }
    case 'statusEmpty':
      if (state.status) throw new Error(`a toast is still in shot: "${state.status}"`);
      return;
    case 'noHelpOpen':
      if (state.helpOpen) throw new Error(`${state.helpOpen} help panel(s) left open`);
      return;
    case 'cookieless':
      if (state.cookie) throw new Error(`the stage carries a cookie: ${mask(state.cookie)}`);
      return;
    /*
     * The thing the shot is about is inside the frame.
     *
     * This replaces a blanket "the page must not scroll": the report is a long
     * document and is meant to be, and `--hide-scrollbars` already guarantees
     * no scrollbar is drawn. What a frame can still get wrong is showing the
     * wrong part of a long page, and that is what this catches.
     */
    case 'inView': {
      const seen = await page.evaluate((sel) => {
        const el = document.querySelector(sel);
        if (!el) return null;
        const r = el.getBoundingClientRect();
        if (r.width === 0 || r.height === 0) return false;
        return r.bottom > 0 && r.top < innerHeight && r.right > 0 && r.left < innerWidth;
      }, a.selector);
      if (seen === null) throw new Error(`${a.selector} is not on the page`);
      if (!seen) throw new Error(`${a.selector} is on the page but outside the frame`);
      return;
    }
    /* A form control that actually carries a value, which `nonEmpty` cannot
       tell you: it reads textContent, and an input's text content is empty
       however full the field is. */
    case 'nonEmptyValue': {
      const v = await page.evaluate((sel) => document.querySelector(sel)?.value ?? null, a.selector);
      if (v === null) throw new Error(`${a.selector} is not on the page`);
      if (!String(v).trim()) throw new Error(`${a.selector} is empty`);
      return;
    }
    /*
     * Whole tiles and whole headers, not sliced ones.
     *
     * The wall shot is judged on what a critic can count on a paused frame, so
     * a row half in and half out of the frame is worse than a row that is not
     * there: it reads as a fragment. These count only what is entirely inside
     * the viewport.
     */
    case 'wholeTiles':
    case 'wholeHeaders': {
      const sel = a.kind === 'wholeTiles' ? '.tool-row[data-tool]' : '.activity-head';
      const n = await page.evaluate((s2) => {
        return [...document.querySelectorAll(s2)].filter((el) => {
          const r = el.getBoundingClientRect();
          return r.height > 0 && r.top >= 0 && r.bottom <= innerHeight;
        }).length;
      }, sel);
      if (n < a.min) throw new Error(`${n} whole ${a.kind === 'wholeTiles' ? 'tile' : 'header'}(s) in frame, expected at least ${a.min}`);
      return;
    }
    /* The element says something matching a pattern: used where the shot
       promises a number and must not cut away before one arrives. */
    case 'matches': {
      const text = await page.evaluate((sel) => (document.querySelector(sel)?.textContent || '').trim(), a.selector);
      if (!new RegExp(a.pattern).test(text)) {
        throw new Error(`${a.selector} reads "${text.slice(0, 60)}", which does not match /${a.pattern}/`);
      }
      return;
    }
    case 'checkedCount': {
      const n = await page.evaluate((sel) => document.querySelectorAll(sel + ':checked').length, a.selector);
      if (n < a.min) throw new Error(`${a.selector}: ${n} ticked, expected at least ${a.min}`);
      return;
    }
    case 'checked': {
      const on = await page.evaluate((sel) => document.querySelector(sel)?.checked ?? null, a.selector);
      if (on === null) throw new Error(`${a.selector} is not on the page`);
      if (!on) throw new Error(`${a.selector} was never ticked`);
      return;
    }
    case 'textAnywhere':
      if (!state.text.includes(a.contains)) throw new Error(`the page never shows "${a.contains}"`);
      return;
    /*
     * The picture moved, and by how much.
     *
     * Bible 2.3 wanted the whole tool wall in one 720 px frame; measured, the
     * four groups are 1133 px tall, so the shot films the product's own scroll
     * instead. "It scrolled" is then the thing worth asserting, and the only
     * honest way to assert it is against where the list started.
     */
    case 'scrolled': {
      if (!opening) throw new Error('no opening state to compare against');
      const now = state.anchorTop ?? null;
      const was = opening.anchorTop ?? null;
      if (now === null || was === null) throw new Error('the page has no anchor to measure a scroll against');
      const moved = Math.abs(was - now);
      if (moved < a.atLeastPx) throw new Error(`the list moved ${moved} px, expected at least ${a.atLeastPx}`);
      return;
    }
    case 'exists':
      if (!(await q(a.selector))) throw new Error(`${a.selector} is not on the page`);
      return;
    case 'visible': {
      const shown = await page.evaluate((s) => {
        const el = document.querySelector(s);
        if (!el) return null;
        if (el.hidden || el.closest('[hidden]')) return false;
        const r = el.getBoundingClientRect();
        return r.width > 0 && r.height > 0;
      }, a.selector);
      if (shown === null) throw new Error(`${a.selector} is not on the page`);
      if (!shown) throw new Error(`${a.selector} is on the page but not visible`);
      return;
    }
    case 'count': {
      const n = await page.evaluate((s) => document.querySelectorAll(s).length, a.selector);
      if (n !== a.equals) throw new Error(`${a.selector}: expected ${a.equals}, found ${n}`);
      return;
    }
    case 'minNodes': {
      const n = await page.evaluate((s) => document.querySelectorAll(s).length, a.selector);
      if (n < a.min) throw new Error(`${a.selector}: expected at least ${a.min}, found ${n}`);
      return;
    }
    case 'nonEmpty': {
      const v = await page.evaluate((s) => {
        const el = document.querySelector(s);
        return el ? (el.value ?? el.textContent ?? '').trim() : null;
      }, a.selector);
      if (v === null) throw new Error(`${a.selector} is not on the page`);
      if (!v) throw new Error(`${a.selector} is empty`);
      return;
    }
    case 'text': {
      const v = await page.evaluate((s) => {
        const el = document.querySelector(s);
        return el ? (el.textContent ?? '').trim() : null;
      }, a.selector);
      if (v === null) { if (a.optional) return; throw new Error(`${a.selector} is not on the page`); }
      if (a.equals !== undefined && v !== a.equals) throw new Error(`${a.selector}: expected "${a.equals}", read "${v}"`);
      if (a.contains !== undefined && !v.includes(a.contains)) throw new Error(`${a.selector} does not contain "${a.contains}": "${v.slice(0, 80)}"`);
      return;
    }
    case 'attr': {
      const v = await page.evaluate(({ s, at }) => {
        const el = s === 'html' ? document.documentElement : s === 'body' ? document.body : document.querySelector(s);
        return el ? el.getAttribute(at) : null;
      }, { s: a.selector, at: a.attr });
      if (v === null && a.optional) return;
      if (v !== a.equals) throw new Error(`${a.selector}[${a.attr}]: expected "${a.equals}", read "${v}"`);
      return;
    }
    case 'masked':
      if (state.masked.length < a.min) throw new Error(`expected at least ${a.min} masked value(s), found ${state.masked.length}`);
      return;
    case 'maskOpaque': {
      for (const m of state.masked) {
        if (m.color !== 'rgba(0, 0, 0, 0)') throw new Error(`a masked node still draws its text: color ${m.color}`);
        if (m.field) {
          if (m.security !== 'disc') throw new Error('a masked field is not disc-obscured');
          continue;
        }
        if (m.inset !== '0px 0px 0px 0px') throw new Error(`the cover is not at inset 0: ${m.inset}`);
        if (!/rgb\(29, 33, 37\)/.test(m.background)) throw new Error(`the cover is not the solid ink: ${m.background.slice(0, 80)}`);
      }
      return;
    }
    case 'svgViewBox': {
      const vb = await page.evaluate(() => document.querySelector('svg')?.getAttribute('viewBox') || null);
      if (vb !== a.equals) throw new Error(`viewBox is "${vb}", expected "${a.equals}"`);
      return;
    }
    /*
     * The report is looking at our fixture, or at no host at all.
     *
     * The check used to demand `127.0.0.1` in the hero line, which is right
     * for a report about a session and wrong for the empty state, where that
     * line carries instructions and names nothing. What must never appear is a
     * *different* host, so that is what is tested.
     */
    case 'noRealHost': {
      const where = state.heroWhere || '';
      const host = /(?:https?:\/\/)?((?:[a-z0-9-]+\.)+[a-z]{2,}|\d+\.\d+\.\d+\.\d+)(?::\d+)?/i.exec(where);
      if (host && !/^127\.0\.0\.1$/.test(host[1])) throw new Error(`the report names ${host[1]}`);
      return;
    }
    case 'noToken': {
      const bad = scanText(state.text).filter((f) => ['jwt', 'bearer', 'apikey', 'secret', 'privatekey', 'cookie'].includes(f.kind));
      if (bad.length) throw new Error(bad.map((b) => b.what).join(', '));
      return;
    }
    case 'noAbsolutePath': {
      const bad = scanText(state.text).filter((f) => f.kind === 'winpath' || f.kind === 'unixpath');
      if (bad.length) throw new Error(bad.map((b) => `${b.what}: ${b.sample}`).join(', '));
      return;
    }
    case 'syntheticOnly': {
      const bad = scanText(`${state.text}\n${state.values}`).filter((f) => f.kind === 'machine' || f.kind === 'email');
      if (bad.length) throw new Error(bad.map((b) => b.what).join(', '));
      return;
    }
    default:
      throw new Error(`unknown assertion "${a.kind}"`);
  }
}

/**
 * Everything that must hold for one shot, checked before its frames are kept.
 *
 * Throws on the first breach with the shot named, because a recording that
 * carried a machine's user name into a frame is not a warning.
 */
export async function assertShot({ page, shot, state, port, extensionId, deny = denyList(), opening = null }) {
  const where = `${shot.film} shot ${shot.n}`;

  if (!allowedOrigin(state.origin, { port, extensionId })) {
    throw new Error(`${where}: filmed ${state.origin}, which is neither http://127.0.0.1:${port} nor our own extension`);
  }

  const found = scanText(`${state.text}\n${state.values}\n${state.title}\n${state.href}`, { deny });
  if (found.length) {
    throw new Error(`${where}: ${found.map((f) => `${f.what} (${f.sample})`).join('; ')}`);
  }

  for (const a of shot.assert || []) {
    try {
      await runAssert(page, a, state, opening);
    } catch (err) {
      throw new Error(`${where}: ${a.kind} ${a.selector ? `on ${a.selector} ` : ''}failed. ${err.message}`);
    }
  }
}

/* ── the sweep ──────────────────────────────────────────────────────────── */

/** Every `shot.json` under `work/film/capture`, read back and scanned again. */
export function sweep(ids = []) {
  /* Was `path.join(FILM, 'capture')` — `extension/tools/film/capture`, which
     is the pre-migration location `tools/lib-paths.mjs` moved the film working
     tree out of on 6 September 2026. `record/driver.mjs` writes here now
     (`clipDir()`, same file); this reader had not been moved to match, so a
     sweep after a real recording silently found nothing rather than the
     frames that were actually written. */
  const root = FILM_CAPTURE;
  if (!fs.existsSync(root)) return { files: 0, shots: 0, problems: ['nothing has been captured yet'] };

  const deny = denyList();
  const problems = [];
  let files = 0;
  let shots = 0;
  let frames = 0;

  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) { walk(full); continue; }
      if (entry.name !== 'shot.json') continue;
      files++;
      const doc = JSON.parse(fs.readFileSync(full, 'utf8'));
      if (ids.length && !ids.includes(doc.film)) continue;
      shots++;
      frames += doc.fileList?.length || 0;
      for (const state of doc.states || []) {
        if (!allowedOrigin(state.origin, { port: doc.port, extensionId: doc.extensionId })) {
          problems.push(`${doc.film} shot ${doc.n}: origin ${state.origin}`);
        }
        for (const f of scanText(`${state.text}\n${state.values}\n${state.title}\n${state.href}`, { deny })) {
          problems.push(`${doc.film} shot ${doc.n}: ${f.what} (${f.sample})`);
        }
      }
      /* The frames the shot claims are the frames that are there. A missing
         PNG is not a privacy problem, but it is the other way a capture lies. */
      /* Clip paths are written relative to the film working tree, `work/` at
         the repository root (`tools/lib-paths.mjs`), the same base
         `record/driver.mjs` `clipDir()` and `compose/frames.mjs` both use. */
      for (const rel of doc.fileList || []) {
        if (!fs.existsSync(path.join(REPO, 'work', rel))) problems.push(`${doc.film} shot ${doc.n}: ${rel} is missing`);
      }
    }
  };
  walk(root);
  return { files, shots, frames, problems };
}

if (process.argv[1] && process.argv[1].endsWith('safety.mjs')) {
  const ids = process.argv.slice(2);
  const deny = denyList();
  console.log(`safety sweep — deny-list has ${deny.length} entr${deny.length === 1 ? 'y' : 'ies'} from this machine`);
  const out = sweep(ids);
  console.log(`  ${out.shots} shot(s) across ${out.files} shot.json file(s), ${out.frames} frame(s)`);
  if (out.problems.length) {
    console.log(`\n${out.problems.length} problem(s):`);
    for (const p of out.problems) console.log(`  ${p}`);
    process.exit(1);
  }
  console.log('  nothing of this machine reached a frame.');
}
