/* QA Wrap — local-first QA toolkit in the ISTQB shape. */
/**
 * The films: one commercial and five feature explainers, recorded from the
 * product driving itself.
 *
 *   node tools/tutorials.mjs [id…]              all of them, headed
 *   node tools/tutorials.mjs qa-wrap --from=mix only the audio, seconds
 *   node tools/tutorials.mjs qa-wrap --redo=voice   re-speak, keep the picture
 *
 * ── the stages, and what each one leaves behind ────────────────────────────
 *
 * Every stage writes an artefact and the next one reads it, so a change late
 * in the chain costs only the stages after it. Before this, editing one number
 * in the mix meant four minutes of driving a browser first.
 *
 *   voice   .tutorials/voice/*.mp3           the narration, spoken and measured
 *   sfx     .tutorials/{bed,click,…}.wav     the bed and the effects
 *   record  .tutorials/<id>-body.mp4         the screen, panel composited on
 *           .tutorials/<id>-marks.json       when each beat and click landed
 *   edit    .tutorials/<id>-cut.mp4          camera, cards, cross-fades
 *   mix     tutorials/media/<id>-en.mp4      the film
 *
 * `--from=<stage>` joins at that stage; `--redo=<stage>[,<stage>]` forces one
 * even if its artefact exists. A stage whose input is missing runs regardless:
 * asking for a mix of a film that was never recorded should produce the film.
 *
 * ── how they are built, and why in this order ──────────────────────────────
 *
 * 1. **The narration is written and spoken first**, and each line is measured
 *    before anything is recorded, so the picture never runs ahead of the
 *    voice. Every beat carries a delivery — `hook`, `problem`, `reveal`,
 *    `feature`, `ask` — which sets its rate and pitch. A read at one rate and
 *    one pitch is what makes a film feel flat, and the fix is direction, not
 *    editing.
 *
 *    English only at present. The Arabic line stays on every beat: it is the
 *    harder half to write and the films are meant to be recorded in both
 *    again.
 *
 * 2. **The picture is recorded once**, at a human pace, with the page under
 *    test as the stage and the extension as a panel over it — because that is
 *    how the product is actually used, and a film of the popup alone has
 *    nothing to test.
 *
 * 3. **The edit** adds what a screen recording cannot: a camera that eases
 *    toward whatever the line is about, a ring where the cursor clicks, a chip
 *    naming the feature, a title card, an end card, and cross-fades where a
 *    hard join would jar.
 *
 * 4. **The mix is the voice and five sounds.** There is no music and no bed
 *    of any kind: three were built, and every one of them read as an engine
 *    idling under the read. What is left is a decaying mark over the title
 *    card, one ring per click, two gear changes, a riser into the ask and a
 *    chime at the end. Every one is generated here from oscillators and noise
 *    — nothing is licensed, so there is no rights question to answer.
 *
 *    The voice carries its own warmth instead: de-breathed, gated, de-essed,
 *    low-passed at 9 kHz and given a small room, so a line decays into the
 *    pause rather than cutting to digital black.
 */
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { fileURLToPath } from 'node:url';
import { BRAND } from './lib-brand.mjs';
import { execFileSync, spawnSync } from 'node:child_process';
import { chromium } from 'playwright';
import { launchOptions } from './lib-launch.mjs';
import { keepOnTop } from './lib-test-window.mjs';
import { freshWorker, purgeWorkerCache } from './lib-fresh.mjs';
import { profile, TUTORIAL_WORK } from './lib-paths.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const EXT = path.resolve(HERE, '..');
/** Hosted with the site, never packaged (T-048): the one tracked copy of each film. */
const MEDIA = path.resolve(EXT, '..', 'site', 'tutorials');
/** Full-quality copies, untracked: `work/film-masters/`. */
const MASTERS = path.resolve(EXT, '..', 'work', 'film-masters');
/* Out of the extension folder: 29 MB of intermediates that Chrome was counting
   on the card. See tools/lib-paths.mjs. */
const WORK = TUTORIAL_WORK;
const VOICE_DIR = path.join(WORK, 'voice');
const PROFILE = profile('.tutorial-profile');
const SIZE = { width: 1280, height: 800 };
// Twenty seconds for a feature film, cards included.
//
// Nader's instruction: "a dedicated 15 sec or 20 at max for each feature". The
// cap is enforced at the end of the run rather than reported, and a film more
// than two seconds over is refused rather than trimmed — so the scripts are
// written to length instead of cut to it. The arithmetic a script has to hit:
// a film is the sum of its beats plus 4.4 s of cards and fades, and the beats
// are shaved to `CAP.feature - 7` before recording, so 13 s of narration and
// breath lands at 17.4 s. Under about 11 s of beats and the film is under the
// fifteen-second floor.
const CAP = { feature: 20, trailer: 50 };
// English only, per the brief. The Arabic script is kept on each beat: it is
// the harder half to write, the films are meant to be recorded in both again,
// and deleting it would mean writing it twice.
//
// Andrew over Ava for the commercial. Microsoft's own tags are the argument:
// Ava is "Expressive, Caring, Pleasant, Friendly" — a support voice — and
// Andrew is "Warm, Confident, Authentic, Honest", which is the standing brief
// for a product spot. A commercial has to sound like someone who has used the
// thing and believes you should too.
const VOICES = { en: 'en-US-AndrewMultilingualNeural' };

/**
 * How each beat is spoken.
 *
 * A read at one rate and one pitch is the thing that made the film feel, in
 * Nader's words, like "one straight rhythmic static". Delivery is variety:
 * pitch, pace and weight moving with the meaning. These are the directions a
 * voice director would give, written where the script can see them.
 */
const DELIVERY = {
  // Slow, low, certain. The hook has to land before anyone decides to scroll.
  hook: { rate: '-6%', pitch: '-3Hz' },
  // Quick and flat: this is the part the listener already knows, said briskly
  // so it does not become the subject.
  problem: { rate: '+12%', pitch: '-1Hz' },
  // The turn. Slower again, warmer, opening up.
  reveal: { rate: '-2%', pitch: '+2Hz' },
  // Fast and bright. Six of these in a row is what makes the list feel long.
  feature: { rate: '+18%', pitch: '+4Hz' },
  // Slow, low, and sure. The ask is never rushed.
  ask: { rate: '-8%', pitch: '-2Hz' },
  // The feature films are explanation, not persuasion.
  teach: { rate: '+4%', pitch: '+0Hz' },
};

for (const d of [MEDIA, WORK, VOICE_DIR]) fs.mkdirSync(d, { recursive: true });
const ff = (args) => execFileSync('ffmpeg', ['-y', '-hide_banner', '-loglevel', 'error', ...args], { stdio: 'inherit' });
/**
 * What a mix actually measures, read back out of ffmpeg's own report.
 *
 * `loudnorm` prints its measurement to stderr as JSON, which is why this is a
 * `spawnSync` rather than the `ff` helper above: `ff` inherits stderr and there
 * is nothing left to parse. Answers `null` rather than throwing, so a film is
 * still made if the format ever changes.
 */
function measureLoudness(args) {
  const run = spawnSync('ffmpeg', ['-y', '-hide_banner', '-nostats', ...args], { encoding: 'utf8', maxBuffer: 1 << 26 });
  const text = `${run.stdout || ''}${run.stderr || ''}`;
  const open = text.lastIndexOf('{');
  const close = text.lastIndexOf('}');
  if (open < 0 || close < open) return null;
  try {
    const heard = JSON.parse(text.slice(open, close + 1));
    return Number.isFinite(Number(heard.input_i)) ? heard : null;
  } catch {
    return null;
  }
}
const probe = (f) => Number(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', f]).toString().trim());

/* ── the page under test ─────────────────────────────────────────────────── */
const FIXTURE = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Permits portal</title>
<style>
 body{font:16px/1.55 system-ui,sans-serif;margin:0;color:#1f2328;background:#fff}
 header{background:#0f2436;color:#fff;padding:15px 34px;font-weight:700;display:flex;gap:22px;align-items:center}
 header nav a{color:#fff;opacity:.75;text-decoration:none;font-weight:500;font-size:14px;margin-inline-start:14px}
 main{max-width:600px;margin:40px auto;padding:0 24px}
 h1{font-size:27px;margin:0 0 6px} p.sub{color:#666;margin:0 0 24px}
 label{display:block;font-weight:600;margin:15px 0 4px;font-size:14px}
 input,select{width:100%;padding:11px 12px;border:1px solid #c9ced6;border-radius:8px;font:inherit}
 button{margin-top:22px;background:#0f2436;color:#fff;border:0;border-radius:8px;padding:13px 22px;font:inherit;font-weight:700;cursor:pointer}
 .note{margin-top:14px;color:#a11;font-weight:600;min-height:22px}
</style></head><body>
<header><b>Permits portal</b><nav><a href="/help">Help</a><a href="/status">Status</a></nav></header>
<main>
  <h1>Apply for a food import permit</h1>
  <p class="sub">All fields are required. You will receive a reference number.</p>
  <form onsubmit="return false">
    <label for="applicant">Applicant name</label><input id="applicant" required maxlength="40">
    <label for="email">Email</label><input id="email" type="email" required>
    <label for="quantity">Quantity (kg)</label><input id="quantity" type="number" min="1" max="500" required>
    <label for="country">Country of origin</label><select id="country" required><option value="">Choose…</option><option>Jordan</option><option>Egypt</option></select>
    <button id="submit" type="button">Submit application</button>
    <div class="note" id="note"></div>
  </form>
</main>
<script>
document.getElementById('submit').onclick = async () => {
  document.getElementById('note').textContent = 'Submitting…';
  const r = await fetch('/api/applications', { method: 'POST', body: '{}' });
  if (!r.ok) { console.error('Submit failed: ' + r.status); document.getElementById('note').textContent = 'Something went wrong. Please try again.'; }
};
</script></body></html>`;

const server = http.createServer((req, res) => {
  if (req.url.startsWith('/api/')) { res.writeHead(500, { 'content-type': 'application/json' }); res.end('{"error":"NullPointerException at PermitService.submit"}'); return; }
  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
  res.end(FIXTURE);
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const ORIGIN = `http://127.0.0.1:${server.address().port}`;

/* ── what is drawn over the recording ────────────────────────────────────── */
const OVERLAY = String.raw`(() => {
  const ID = 'qaw-film';
  let root = document.getElementById(ID);
  if (!root) {
    root = document.createElement('div');
    root.id = ID;
    root.style.cssText = 'position:fixed;inset:0;z-index:2147483647;pointer-events:none;font-family:Thmanyah Sans,system-ui,sans-serif';
    root.innerHTML =
      // The plate under the caption reaches all the way over the words.
      //
      // It used to be solid for the bottom 30% and transparent above, which is
      // fine under one line and wrong under three: the top line of a long
      // caption sat in the clear part, white on a white form, and could not be
      // read. The dark is now held to the top of the text box and only the
      // last sliver fades, so a caption is legible whatever its length.
      '<div id="qaw-cap" style="position:absolute;left:0;right:0;bottom:0;padding:34px 40px 24px;background:linear-gradient(to top,rgba(18,21,24,.98) 0%,rgba(18,21,24,.95) 70%,rgba(18,21,24,.74) 88%,rgba(18,21,24,0) 100%);color:#F5F3EE;text-align:center"></div>' +
      '<div id="qaw-chip" style="position:absolute;left:34px;top:30px;display:flex;align-items:center;gap:9px;padding:11px 20px 11px 15px;border-radius:999px;background:#B5432B;color:#fff;font-size:19px;font-weight:800;letter-spacing:-.2px;box-shadow:0 12px 34px rgba(0,0,0,.34);opacity:0;transform:translateX(-26px)"></div>' +
      '<div id="qaw-note" style="position:absolute;opacity:0;transition:opacity .25s ease;padding:7px 13px;border-radius:999px;background:#1D2024;color:#fff;font-size:14px;font-weight:700;box-shadow:0 8px 24px rgba(0,0,0,.28)"></div>';
    document.documentElement.appendChild(root);
    const style = document.createElement('style');
    style.textContent =
      '@keyframes qaw-ring{from{transform:translate(-50%,-50%) scale(.35);opacity:.95}to{transform:translate(-50%,-50%) scale(2.6);opacity:0}}' +
      '@keyframes qaw-chip-in{from{opacity:0;transform:translateX(-26px) scale(.94)}to{opacity:1;transform:translateX(0) scale(1)}}' +
      '@keyframes qaw-cap-in{from{opacity:0;transform:translateY(9px)}to{opacity:1;transform:none}}';
    root.appendChild(style);
  }
  const cap = document.getElementById('qaw-cap');
  const chip = document.getElementById('qaw-chip');
  const note = document.getElementById('qaw-note');
  if (KIND === 'caption') {
    // Big enough to read on a phone, in a feed, muted — which is how most of
    // this will actually be watched.
    cap.innerHTML = EN
      ? '<div style="font-size:29px;font-weight:800;line-height:1.24;letter-spacing:-.4px;max-width:26ch;margin:0 auto;text-shadow:0 2px 10px rgba(0,0,0,.85);animation:qaw-cap-in .3s cubic-bezier(.2,.8,.2,1)">' + EN + '</div>'
      : '';
  } else if (KIND === 'feature') {
    if (!EN) { chip.style.opacity = '0'; chip.style.animation = 'none'; return; }
    chip.innerHTML = '<span style="font-size:15px;opacity:.9">●</span><span>' + EN + '</span>';
    chip.style.animation = 'none';
    void chip.offsetWidth;              // restart the animation on a re-entry
    chip.style.animation = 'qaw-chip-in .34s cubic-bezier(.2,.9,.2,1) forwards';
  } else if (KIND === 'ring') {
    const r = document.createElement('div');
    r.style.cssText = 'position:absolute;left:' + X + 'px;top:' + Y + 'px;width:56px;height:56px;margin:-28px 0 0 -28px;border:3px solid #B5432B;border-radius:50%;animation:qaw-ring .62s cubic-bezier(.2,.8,.2,1) forwards';
    root.appendChild(r);
    setTimeout(function () { r.remove(); }, 700);
  } else if (KIND === 'note') {
    if (!AR) { note.style.opacity = '0'; return; }
    note.textContent = AR;
    note.style.left = Math.max(16, Math.min(X, innerWidth - 330)) + 'px';
    note.style.top = Math.max(16, Y) + 'px';
    note.style.opacity = '1';
  }
})()`;

/* ── the scripts ─────────────────────────────────────────────────────────── */
const LESSONS = [
  {
    id: 'qa-wrap',
    kind: 'trailer',
    ar: 'كيو إيه راب',
    en: 'QA Wrap',
    blurb: 'The whole product in under a minute: what it records, what it proves, and what you hand over.',
    /*
     * Eleven beats: hook, problem, reveal, six features, two lines of ask.
     *
     * Six chips and no more, because a chip is a promise the picture has to
     * keep and there is room for six of them in fifty seconds. What was left
     * out is not left out because it is weak — it is folded into a line whose
     * picture already shows it:
     *
     *   the master switch  the reveal opens on the Asleep card and says
     *                      "nothing runs until you wake it", which is the
     *                      whole meaning of the switch. Spending a chip on it
     *                      would buy a second showing of the same frame.
     *   screenshots and    covered by "every click, every request, every
     *   the tab recorder   error" over the live session, and pressing Record
     *                      on camera would put a browser permission dialog in
     *                      the middle of the commercial.
     *   the health dot     visible on every tool row during the checks beat;
     *                      it is a detail you notice, not a headline.
     *   eight browsers     said in the ask, where a claim with no picture
     *                      belongs.
     */
    beats: [
      /* ── hook: the sentence every tester has had thrown back at them ── */
      {
        ar: 'وجدتَ الخطأ. الآن أثبته.',
        en: 'You found the bug. Now prove it.',
        say: 'hook',
        look: 'page',
        act: async (t) => { await t.page(ORIGIN); await t.fillFast(); await t.click('#submit', 'HTTP 500'); },
      },
      /* ── problem ─────────────────────────────────────────────────────── */
      {
        ar: 'لقطة شاشة. سطر في وحدة التحكّم. ثم يعود إليك: «لم أستطع إعادة إنتاجه».',
        en: 'A screenshot. A console line. And back it comes: cannot reproduce.',
        say: 'problem',
        look: 'page',
        act: async (t) => t.wait(400),
      },
      /* ── the product, and the master switch it starts behind ─────────── */
      {
        ar: 'كيو إيه راب. لا شيء يعمل حتى توقظه. سمِّ الاختبار، ثم اضغط «ابدأ».',
        en: 'QA Wrap. Nothing runs until you wake it. Name the test, press start.',
        say: 'reveal',
        look: 'panel',
        act: async (t) => { await t.popup(); await t.click('#switch'); await t.type('#charter', 'Submit a permit', 26); await t.click('#start'); await t.recording(); },
      },
      /* ── features, fast ──────────────────────────────────────────────── */
      // Masking comes before the typing, and that order is the whole point.
      //
      // The line promises the name never reaches the report, and the product
      // keeps that promise from the moment the mask exists: a masked field is
      // treated as a secret, so what is typed into it afterwards is recorded
      // as held-back rather than as a name. Filmed the other way round — fill
      // first, mask second — the story panel three beats later still quoted
      // "Layla Haddad" in its acceptance criteria, one caption after telling
      // the viewer it could not.
      //
      // The picker is put away at the end because it stays armed until it is:
      // its "click what should never leave this machine" tip sat across the
      // top of the next two beats, and the click on Submit in the beat below
      // would have masked the button instead of pressing it.
      //
      // Put away by pressing the tool again rather than with Escape. Escape
      // works, but the session records the keypress, and the report's own
      // acceptance criteria then opened with "when I press Escape on" followed
      // by the entire text of the page — which is what a document-level key
      // event has for an accessible name. Pressing the tool leaves the panel
      // saying "1 thing masked — covered in every picture and left out of the
      // report", which is the caption, in the product's words.
      {
        ar: 'انقر على اسم حقيقي، فيختفي من كل صورة، وكل فيديو، وكل تقرير.',
        en: 'Click a real name, and it is gone from every shot, every video, every report.',
        say: 'feature',
        feature: 'Mask real data',
        look: 'panel',
        // Armed in the panel, used on the page, confirmed back in the panel:
        // two surfaces, one gesture, which is how a tester meets it.
        act: async (t) => { await t.popup(); await t.click('[data-action="mask"]'); await t.page(); await t.click('#applicant'); await t.popup(); await t.click('[data-action="mask"]'); },
      },
      // The submit is pressed again here, inside the session this time. The
      // failure in the hook happened before Start, so nothing had recorded it
      // — and the report beat four lines down needs a real failure to name.
      {
        ar: 'كل نقرة، وكل طلب، وكل خطأ — ولا شيء من ذلك يغادر جهازك.',
        en: 'Every click, every request, every error — and none of it leaves your machine.',
        say: 'feature',
        feature: 'Records everything · nothing uploaded',
        look: 'page',
        act: async (t) => { await t.page(); await t.fillFast(); await t.click('#submit', 'HTTP 500'); },
      },
      {
        ar: 'الوصولية، وسرعة الصفحة، ومحدِّد متحقَّق منه لكل عنصر. بضغطة واحدة لكلٍّ منها.',
        en: 'Accessibility, page speed, a verified locator for every element. One press each.',
        say: 'feature',
        feature: 'Accessibility · speed · page map',
        look: 'panel',
        act: async (t) => { await t.popup(); await t.click('[data-action="a11y"]', 'axe-core'); await t.wait(250); await t.click('[data-action="perf"]', 'LCP · CLS'); await t.click('[data-action="harvest"]', 'page object'); },
      },
      {
        ar: 'أوقف الجلسة، فيسمّي التقرير النقرة التي سبّبت الفشل.',
        en: 'Stop, and the report names the click that caused the failure.',
        say: 'feature',
        feature: 'Cause, not just symptom',
        look: 'report',
        // Straight to "What broke" by hash rather than by clicking the tab:
        // the beat is already paying for a navigation, and a second click
        // inside it would push the line off the picture it belongs to.
        act: async (t) => { await t.popup(); await t.click('#stop'); await t.report('#broke'); },
      },
      {
        ar: 'سبعة أنواع من التذاكر — Jira وGitHub وLinear — والأدلة مرفقة.',
        en: 'Seven kinds of ticket — Jira, GitHub, Linear — evidence attached.',
        say: 'feature',
        feature: 'Seven ticket formats',
        look: 'report',
        act: async (t) => { await t.click('[data-tab="file"]'); await t.click('[data-artefact="story"]', 'user story'); },
      },
      {
        ar: 'والجلسة كاملة مرسومة كمخطط سير عمل، على صفحة واحدة مقاس A4.',
        en: 'And the whole session drawn as a workflow, on one A4 page.',
        say: 'feature',
        feature: 'Workflow diagram · one A4 page',
        look: 'diagram',
        act: async (t) => t.diagram(),
      },
      /* ── the ask ─────────────────────────────────────────────────────── */
      {
        ar: 'ثمانية متصفحات. بلا حساب، وبلا رفع، وبلا تكلفة.',
        en: 'Eight browsers. No account, no upload, no cost.',
        say: 'ask',
        look: 'wide',
        // A slow scroll down the sheet, so the last held shot is moving. A
        // still frame under five seconds of ask reads as the film ending
        // early.
        act: async (t) => t.scroll(240),
      },
      {
        ar: 'كيو إيه راب. كل خطأ، وأثره.',
        en: 'QA Wrap. Every failure, traced.',
        say: 'ask',
        look: 'wide',
        act: async (t) => t.wait(400),
      },
    ],
  },
  /*
   * ── the five feature films ────────────────────────────────────────────────
   *
   * One feature each, fifteen to twenty seconds including the cards, three to
   * five beats, and every beat is one thing. They are explanation rather than
   * persuasion, so the read is `teach` throughout except for the single line
   * that carries the capability (`feature`) and the line the film ends on
   * (`ask`) — a whole film at one rate and one pitch is the flatness the
   * commercial was rewritten to remove, and five flat films would put it back.
   *
   * The `setup:` hook is what makes twenty seconds possible for the last three.
   * A report, a save dialog and a diagram all need a finished session behind
   * them, and driving one costs about six seconds — a third of the film, spent
   * on something `record-a-session` already shows in full. Setup runs before
   * the clock starts and is cut off the front of the picture, so these films
   * open on the thing they are about. Nothing is faked: the session under the
   * report is a real one, recorded on the fixture moments earlier.
   *
   * The chips are one per film, on the beat that names the capability. A chip
   * on every beat is a chip on nothing.
   */
  {
    id: 'record-a-session',
    kind: 'feature',
    ar: 'سجّل جلسة',
    en: 'Record a session',
    blurb: 'Wake it, name the test, press Start, then read what it caught.',
    beats: [
      {
        ar: 'أيقظه، وسمِّ الاختبار، ثم اضغط «ابدأ».',
        en: 'Wake it, name the test, press Start.',
        say: 'teach',
        look: 'panel',
        act: async (t) => { await t.popup(); await t.click('#switch'); await t.type('#charter', 'Submit a permit', 26); await t.click('#start'); await t.recording(); },
      },
      {
        ar: 'ثم اختبر الصفحة كما تفعل دائماً.',
        en: 'Then test the page the way you always do.',
        say: 'teach',
        look: 'page',
        act: async (t) => { await t.page(); await t.fillFast(); },
      },
      {
        ar: 'الإرسال يفشل، وكل خطوة مُسجَّلة.',
        en: 'The submit fails, and every step is recorded.',
        say: 'feature',
        feature: 'Every click, every request',
        look: 'page',
        act: async (t) => { await t.click('#submit', 'HTTP 500'); await t.wait(900); },
      },
      {
        ar: 'أوقف الجلسة: التقرير يسمّي النقرة التي سبّبت الفشل.',
        en: 'Stop: the report names the click that broke it.',
        say: 'ask',
        look: 'report',
        act: async (t) => { await t.popup(); await t.click('#stop'); await t.report('#broke'); },
      },
    ],
  },
  {
    id: 'the-tools',
    kind: 'feature',
    ar: 'الأدوات',
    en: 'The tools',
    blurb: 'Accessibility, page speed and the page map, on the page you are standing on.',
    // The session is started off camera: this film is about the tools, and the
    // fifteen seconds it has are not enough to also teach the switch.
    setup: (t) => t.startShort(),
    beats: [
      {
        ar: 'وضع «الخبير» يفتح كل الأدوات.',
        en: 'Expert mode opens every tool.',
        say: 'teach',
        look: 'panel',
        act: async (t) => { await t.popup(); },
      },
      {
        ar: 'الوصولية، على الصفحة كما هي الآن.',
        en: 'Accessibility, on the live page.',
        say: 'teach',
        look: 'panel',
        act: async (t) => { await t.click('[data-action="a11y"]', 'axe-core'); await t.wait(700); },
      },
      {
        ar: 'سرعة الصفحة، مقيسة في هذه الجولة.',
        en: 'Page speed, measured on this run.',
        say: 'teach',
        look: 'panel',
        act: async (t) => { await t.click('[data-action="perf"]', 'LCP · CLS'); await t.wait(600); },
      },
      {
        ar: 'ومحدِّد متحقَّق منه لكل عنصر.',
        en: 'And a verified locator for every element.',
        say: 'feature',
        feature: 'Accessibility · speed · page map',
        look: 'panel',
        act: async (t) => { await t.click('[data-action="harvest"]', 'page object'); await t.wait(900); },
      },
      {
        ar: 'تتحول كل نقطة إلى اللون الأخضر عند اكتمال فحصها.',
        en: 'Every dot goes green when its check lands.',
        say: 'ask',
        look: 'panel',
        act: async (t) => t.wait(900),
      },
    ],
  },
  {
    id: 'file-it',
    kind: 'feature',
    ar: 'ارفع التقرير',
    en: 'File the report',
    blurb: 'Seven kinds of ticket, acceptance criteria written from the recording, evidence attached.',
    setup: (t) => t.recordShort(),
    beats: [
      {
        ar: 'من جلسة واحدة: سبعة أنواع من التذاكر.',
        en: 'From one session, seven kinds of ticket.',
        say: 'teach',
        look: 'report',
        act: async (t) => t.report('#file'),
      },
      {
        ar: 'اختر الشكل الذي يطلبه متتبِّع مشروعك.',
        en: 'Pick whichever shape your tracker asks for.',
        say: 'feature',
        feature: 'Seven ticket formats',
        look: 'report',
        act: async (t) => { await t.click('[data-artefact="story"]', 'user story'); await t.wait(600); },
      },
      {
        ar: 'قصة مستخدم، بمعايير قبول مستخلَصة من التسجيل نفسه.',
        en: 'A story, with acceptance criteria from the recording.',
        say: 'teach',
        look: 'report',
        act: async (t) => t.reveal('#jira-body'),
      },
      {
        ar: 'وتُرفق الأدلة مع التذكرة.',
        en: 'And the evidence is attached to the ticket.',
        say: 'ask',
        look: 'report',
        // Inside the text box, not down the page: the evidence block is the
        // tail of the document, and the document is a textarea.
        act: async (t) => t.scrollIn('#jira-body', 300),
      },
    ],
  },
  {
    id: 'save-and-diagram',
    kind: 'feature',
    ar: 'الحفظ والمخطط',
    en: 'Saving and the diagram',
    blurb: 'Every output in its own folder, named and dated, and the session as an A4 workflow.',
    setup: (t) => t.recordShort(),
    beats: [
      {
        ar: 'احفظ، فيحصل كل مخرَج على مجلده الخاص.',
        en: 'Save, and every output gets its own folder.',
        say: 'teach',
        look: 'report',
        act: async (t) => { await t.report(); await t.click('#save-all', 'QA Wrap / …'); await t.wait(500); },
      },
      {
        ar: 'اسم واضح وتاريخ ووقت على كل ملف.',
        en: 'A clear name, a date and a time on each file.',
        say: 'teach',
        look: 'report',
        act: async (t) => t.scrollIn('#save-parts', 240),
      },
      {
        ar: 'والجلسة مرسومة كمخطط سير عمل على صفحة واحدة مقاس A4.',
        en: 'And the session drawn as a workflow, on one A4 page.',
        say: 'feature',
        feature: 'Workflow diagram · one A4 page',
        look: 'diagram',
        act: async (t) => { await t.click('#save-close'); await t.diagram(); },
      },
      {
        ar: 'حرّك صندوقاً، وأعد صياغته، ثم صدّره.',
        en: 'Move a box, reword it, then export it.',
        say: 'ask',
        look: 'diagram',
        act: async (t) => t.wait(1000),
      },
    ],
  },
  {
    id: 'protect-the-data',
    kind: 'feature',
    ar: 'احمِ البيانات',
    en: 'Protect the data',
    blurb: 'Cover a real name before it is ever recorded, then put the whole extension back to sleep.',
    // Awake and recording before the clock starts, for the same reason as the
    // three films above: the fifteen seconds belong to the mask and the switch.
    setup: (t) => t.startShort(),
    beats: [
      {
        ar: 'فعِّل أداة الإخفاء، ثم انقر على اسم حقيقي.',
        en: 'Arm the mask, then click a real name.',
        say: 'teach',
        look: 'page',
        // Armed in the panel, used on the page: two surfaces, one gesture,
        // which is how a tester meets it.
        act: async (t) => { await t.popup(); await t.click('[data-action="mask"]'); await t.page(); await t.click('#applicant'); },
      },
      {
        ar: 'كتلة واحدة، في كل صورة وكل تقرير.',
        en: 'One block, in every picture and every report.',
        say: 'feature',
        feature: 'Mask real data',
        look: 'panel',
        // The picker is put away by pressing the tool again, not with Escape.
        // Escape works, but the session *records* the keypress, and a
        // document-level key event takes the whole page as its accessible
        // name — so the report's own steps then open with "when I press
        // Escape on Permits portalHelpStatus Apply for a food import permit…".
        // Pressing the tool also leaves the panel saying "1 thing masked",
        // which is the caption in the product's own words.
        //
        // The filling comes after the mask, and that order is the claim: a
        // masked field is treated as a secret, so what is typed into it
        // afterwards is held back rather than recorded as a name.
        act: async (t) => { await t.popup(); await t.click('[data-action="mask"]'); await t.page(); await t.fillFast(); await t.click('#submit', 'HTTP 500'); },
      },
      {
        ar: 'اضغط «نَم»، فيتوقف كل شيء دفعةً واحدة.',
        en: 'Press Sleep, and everything stops at once.',
        say: 'teach',
        look: 'panel',
        // Sleep is not a flag: `sleepWindow()` stops the clip, stops the
        // session so its report exists, clears the mask picker and drops the
        // recording grants. So this beat is also what finishes the session —
        // there is no Stop press in this film, and there does not need to be.
        act: async (t) => { await t.popup(); await t.click('#switch'); await t.wait(900); },
      },
      {
        ar: 'التقرير ما زال هنا، والاسم ليس فيه.',
        en: 'The report is still here, and the name is not.',
        say: 'ask',
        look: 'report',
        // Straight to the story, because that is where the claim is provable:
        // its acceptance criteria are written from the recording, and the
        // masked field is written into them as dots. The overview would have
        // shown a report that exists but not a report with the name missing
        // from it, which is only half the line.
        act: async (t) => { await t.report('#file'); await t.click('[data-artefact="story"]'); await t.wait(300); await t.reveal('#jira-body'); },
      },
    ],
  },
];

/* ── 1. the narration, spoken and measured before anything is recorded ───── */
console.log('— narration —');
for (const lesson of LESSONS) {
  for (const [i, beat] of lesson.beats.entries()) {
    beat.audio = {};
    beat.dur = {};
    for (const [lang, voice] of Object.entries(VOICES)) {
      // Keyed by position, not by what the line says — so rewriting a beat, or
      // moving one past another, leaves a cached recording of the old words
      // sitting under the new number. Delete `.tutorials/voice/<id>-*.mp3`
      // after editing a script; `--redo=voice` does not reach this loop.
      const raw = path.join(VOICE_DIR, `${lesson.id}-${i}-${lang}.raw.mp3`);
      const file = path.join(VOICE_DIR, `${lesson.id}-${i}-${lang}.mp3`);
      const say = DELIVERY[beat.say || (lesson.kind === 'trailer' ? 'reveal' : 'teach')] || DELIVERY.teach;
      if (!fs.existsSync(file)) {
        // `--rate=-6%` and not `--rate -6%`: argparse reads a value beginning
        // with a minus as the next flag, so a negative rate — the whole point
        // of directing a slower line — fails as "expected one argument".
        execFileSync('python', ['-m', 'edge_tts', '--voice', voice,
          `--rate=${say.rate}`, `--pitch=${say.pitch}`,
          '--text', beat[lang], '--write-media', raw], { stdio: 'pipe' });
        // The intake before a sentence, and the tail after it.
        //
        //   silenceremove  cuts the lead-in and the trailing air, so a beat
        //                  starts on the word rather than on the breath before
        //                  it — which is also what was making the gaps long.
        //   highpass       breath energy is mostly low; speech is not.
        //   agate          opens on speech and stays shut on what is left.
        //                  Tuned gently: a hard gate chops word endings, and a
        //                  clipped consonant is worse than a soft breath.
        //   deesser        the same voice at +14% gets sibilant.
        ff(['-i', raw, '-af',
            'silenceremove=start_periods=1:start_silence=0.05:start_threshold=-45dB:'
            + 'stop_periods=-1:stop_silence=0.12:stop_threshold=-45dB,'
            + 'highpass=f=95,'
            + 'agate=threshold=-34dB:ratio=4:attack=6:release=140:knee=4,'
            + 'deesser=i=0.35,'
            // Warmth, on the voice and on nothing else. A neural read carries
            // energy above 9 kHz that no microphone in a room would have
            // produced, and it is what makes the voice sit in front of the
            // picture rather than in it. This is not a build — there is no bed
            // to build over — it is a fixed corner, set once and left alone.
            + 'lowpass=f=9000,'
            + 'dynaudnorm=f=180:g=9:p=0.62,'
            // A small hard room, so a line decays instead of ending at a
            // cliff. This is what stops the gaps reading as dropouts, and it
            // does the job without putting any layer behind the voice.
            + 'aecho=0.86:0.9:42:0.16',
            '-ar', '48000', file]);
      }
      beat.audio[lang] = file;
      beat.dur[lang] = probe(file);
    }
    // A beat lasts as long as its narration plus a breath — and a commercial's
    // breath is shorter than a tutorial's, because the next line is the point.
    const gap = lesson.kind === 'trailer' ? 0.16 : 0.5;
    beat.ms = Math.round((beat.dur.en + gap) * 1000);
  }
  const total = lesson.beats.reduce((n, b) => n + b.ms, 0) / 1000;
  const cap = CAP[lesson.kind] - (lesson.kind === 'trailer' ? 5.5 : 7); // the cards and the fades
  if (total > cap) {
    // Trim the breath, never the words: a film that runs long is a film
    // nobody finishes, and the cap is the brief.
    const shave = ((total - cap) / lesson.beats.length) * 1000;
    for (const b of lesson.beats) b.ms = Math.max(1400, Math.round(b.ms - shave));
  }
  console.log(`  ${lesson.id.padEnd(18)} ${lesson.beats.length} beats · ${(lesson.beats.reduce((n, b) => n + b.ms, 0) / 1000).toFixed(1)}s + cards (cap ${CAP[lesson.kind]}s)`);
}

/* ── 2. the sound effects, made once ─────────────────────────────────────── */
const SFX = {
  click: path.join(WORK, 'sfx-click.wav'),
  whoosh: path.join(WORK, 'sfx-whoosh.wav'),
  chime: path.join(WORK, 'sfx-chime.wav'),
  riser: path.join(WORK, 'sfx-riser.wav'),
  open: path.join(WORK, 'sfx-open.wav'),
};

/*
 * There is no bed, and there is no room tone either.
 *
 * Three layers were built and all three were wrong. A 62 Hz sine on the eighth
 * is an idling engine; filtered noise on the eighth is a quieter idling
 * engine; unpitched pink noise 40 dB down is still a hiss you can hear on
 * headphones in a quiet room. The problem was never the timbre — it is that
 * anything continuous under a forty-second read competes with the read, and
 * the read is the argument.
 *
 * The generator that made the last of them is gone rather than merely unused,
 * because a bed sitting in the work directory is an invitation to put it back.
 * The gaps are handled where they are made: every line is de-breathed and
 * carries a small room, so it decays into the pause instead of cutting to
 * digital black.
 */

if (!fs.existsSync(SFX.chime)) {
  ff(['-f', 'lavfi', '-i', 'sine=frequency=1900:duration=0.06', '-af', 'afade=t=out:st=0.012:d=0.048,volume=0.5', SFX.click]);
  ff(['-f', 'lavfi', '-i', 'anoisesrc=d=0.55:c=pink:a=0.35', '-af', 'highpass=f=700,lowpass=f=5200,afade=t=in:st=0:d=0.18,afade=t=out:st=0.2:d=0.35,volume=0.5', SFX.whoosh]);
  // The end mark, allowed to ring.
  //
  // It was 0.9 seconds long and the end card is on screen for two and a half,
  // so the film used to finish on a second and a half of digital silence —
  // the same dead opening the title card's mark exists to prevent, at the
  // other end. Same two tones, same fade shape: this is the chime ringing
  // out, not a new sound.
  ff(['-f', 'lavfi', '-i', 'sine=frequency=880:duration=2.4', '-f', 'lavfi', '-i', 'sine=frequency=1320:duration=2.4',
      '-filter_complex', '[0][1]amix=inputs=2,afade=t=out:st=0.1:d=2.3,volume=0.42[a]', '-map', '[a]', SFX.chime]);
  console.log('  sound effects generated');
}

// A riser under the last seconds: the standard signal that a call to action is
// coming, and the reason a viewer who was about to scroll stays for it.
// The title card's mark. Two seconds of decay, because the card is on screen
// for two and a half and a short chime leaves a second and a half of digital
// silence behind it — which is the dead opening this exists to remove.
if (!fs.existsSync(SFX.open)) {
  ff(['-f', 'lavfi', '-i', 'sine=frequency=440:duration=2.4',
      '-f', 'lavfi', '-i', 'sine=frequency=660:duration=2.4',
      '-f', 'lavfi', '-i', 'sine=frequency=880:duration=2.4',
      '-filter_complex',
      '[0][1][2]amix=inputs=3:normalize=1,afade=t=out:st=0.15:d=2.2,lowpass=f=2600,volume=0.5[a]',
      '-map', '[a]', SFX.open]);
  console.log('  opening mark generated');
}

if (!fs.existsSync(SFX.riser)) {
  ff(['-f', 'lavfi', '-i', 'anoisesrc=d=2.2:c=pink:a=0.5', '-af',
      'highpass=f=300,lowpass=f=6000,afade=t=in:st=0:d=2.0,volume=0.5', SFX.riser]);
  console.log('  riser generated');
}

/* ── 3. the cards ────────────────────────────────────────────────────────── */
const brandFonts = fs.readFileSync(path.join(EXT, 'ui/fonts.css'), 'utf8').replace(/url\((['"]?)fonts\//g, `url($1file:///${EXT.replace(/\\/g, '/')}/ui/fonts/`);
const markSvg = fs.readFileSync(path.join(EXT, 'brand/mark.svg'), 'utf8').replace(/<!--[\s\S]*?-->/g, '');
const madeBy = BRAND.publisher.en;

async function card(inner, file, extraCss = '') {
  const b = await chromium.launch();
  const p = await b.newPage({ viewport: SIZE });
  await p.setContent(`<style>${brandFonts}
    *{box-sizing:border-box}
    body{margin:0;width:1280px;height:800px;background:#F1EFE9;color:#1D2024;font-family:Thmanyah Sans,system-ui,sans-serif;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;padding:96px 90px 132px}
    body::before{content:"";position:absolute;top:0;left:0;right:0;height:9px;background:repeating-linear-gradient(90deg,#B5432B 0 22px,#F1EFE9 22px 30px,#1D2024 30px 52px,#F1EFE9 52px 60px)}
    .mark{width:88px;height:88px;margin:0 0 24px}
    .kind{font-size:13px;letter-spacing:.28em;font-weight:700;color:#8B9097;margin:0 0 12px}
    h1{font-size:54px;margin:0;font-weight:800;letter-spacing:-1px;line-height:1.05}
    h2{font-size:28px;margin:12px 0 0;font-weight:700;direction:rtl;color:#5D646B}
    p.lede{margin:22px 0 0;font-size:19px;color:#5D646B;max-width:740px;line-height:1.5}
    /* The ask. Bigger than the tagline it follows, because it is the one thing
       the whole film exists to get someone to do. */
    p.cta{margin:24px 0 0;padding:13px 30px;border-radius:999px;background:#B5432B;color:#fff;font-size:25px;font-weight:800;letter-spacing:-.3px}
    .by{position:absolute;left:0;right:0;bottom:44px;display:flex;flex-direction:column;align-items:center;gap:9px}
    .by span{font-size:12px;letter-spacing:.22em;color:#8B9097;font-weight:700}
    .by img{height:36px}
    ${extraCss}
  </style>${inner}`, { waitUntil: 'load' });
  await p.waitForTimeout(450);
  await p.screenshot({ path: file });
  await b.close();
}

/* ── 4. record, edit, mix ────────────────────────────────────────────────── */
const argv = process.argv.slice(2);
const wanted = argv.filter((a) => !a.startsWith('-'));
const todo = wanted.length ? LESSONS.filter((l) => wanted.includes(l.id)) : LESSONS;
const made = [];

/**
 * The stages, in order, and where a run is allowed to join them.
 *
 * `--from=mix` re-runs only the audio; `--redo=record` forces the browser even
 * though a body already exists. Anything a later stage needs and cannot find is
 * still made — asking for a mix of a film that was never recorded should
 * produce the film, not silence.
 */
const STAGES = ['voice', 'sfx', 'record', 'edit', 'mix'];
const arg = (name) => argv.find((a) => a.startsWith(`--${name}=`))?.split('=')[1] || '';
const from = STAGES.indexOf(arg('from'));
const redo = new Set(arg('redo').split(',').filter(Boolean));
/** Does this stage have to run? Yes if forced, if joined at or before it, or if its artefact is missing. */
const needs = (stage, artefact) =>
  redo.has(stage) || from < 0 || STAGES.indexOf(stage) >= from || !artefact || !fs.existsSync(artefact);

/**
 * Where the frame looks during a beat.
 *
 * A push toward the thing being talked about, eased in and held. The numbers
 * are the centre of the target as a fraction of the frame, and how far in to go
 * — the panel sits right of centre and gets the closest look because it is the
 * smallest thing on screen.
 */
const LOOK = {
  wide: { z: 1.0, cx: 0.5, cy: 0.5 },
  page: { z: 1.05, cx: 0.36, cy: 0.52 },
  panel: { z: 1.11, cx: 0.80, cy: 0.44 },
  report: { z: 1.06, cx: 0.46, cy: 0.38 },
  diagram: { z: 1.07, cx: 0.44, cy: 0.46 },
};

/**
 * A camera move that eases between one look and the next.
 *
 * `crop` was the obvious filter and cannot do this: its output width and height
 * are evaluated once, when the graph is configured, so a size that depends on
 * `t` is rejected outright. Only `x` and `y` may vary per frame.
 *
 * `zoompan` is the one that varies scale over time. Its weakness is that it
 * positions on integer pixels, so a slow move can stair-step; feeding it a
 * frame scaled up twofold puts those steps below what the eye resolves, and the
 * result is a genuinely smooth push. The cost is one extra scale pass, which is
 * seconds.
 *
 * Each beat eases from the previous look to its own over the first 70% of its
 * length, then holds. Arriving early and resting is what makes a camera move
 * read as deliberate rather than as drift.
 */
function cameraExpr(beats, bodyDur) {
  const key = (b) => LOOK[b.look || 'wide'] || LOOK.wide;
  // zoompan counts output frames; at 30fps the clock is `on/30`.
  const T = '(on/30)';
  const pick = (field) => {
    let expr = String(key(beats[beats.length - 1] || {})[field]);
    for (let i = beats.length - 1; i >= 0; i -= 1) {
      const from = i === 0 ? LOOK.wide : key(beats[i - 1]);
      const to = key(beats[i]);
      const s0 = beats[i].startedAt;
      const span = Math.max(0.3, Math.min(s0 + (beats[i].ms / 1000) * 0.7, bodyDur) - s0);
      const p = `min(1,max(0,(${T}-${s0.toFixed(2)})/${span.toFixed(2)}))`;
      const ease = `(${p})*(${p})*(3-2*(${p}))`;
      expr = `if(lt(${T},${s0.toFixed(2)}),${expr},${from[field]}+(${(to[field] - from[field]).toFixed(4)})*${ease})`;
    }
    return expr;
  };
  const z = `(${pick('z')})`;
  const cx = `(${pick('cx')})`;
  const cy = `(${pick('cy')})`;
  const total = Math.ceil(bodyDur * 30) + 2;
  return (
    `scale=${SIZE.width * 2}:${SIZE.height * 2}:flags=bicubic,` +
    `zoompan=z='${z}':x='(iw-iw/zoom)*${cx}':y='(ih-ih/zoom)*${cy}'` +
    `:d=1:s=${SIZE.width}x${SIZE.height}:fps=30`
  );
}

for (const lesson of todo) {
  console.log(`\n— ${lesson.en} (${lesson.kind}) —`);

  const bodyMp4 = path.join(WORK, `${lesson.id}-body.mp4`);
  const marksFile = path.join(WORK, `${lesson.id}-marks.json`);
  let marks = { clicks: [], beats: [] };
  let panelBox = null;

  if (!needs('record', bodyMp4) && fs.existsSync(marksFile)) {
    // The picture is already on disk and so is its timing. This is the whole
    // point of the stages: changing a number in the mix should not cost four
    // minutes of driving a browser.
    const saved = JSON.parse(fs.readFileSync(marksFile, 'utf8'));
    marks = saved.marks;
    for (const [i, b] of lesson.beats.entries()) {
      if (saved.beats[i]) { b.startedAt = saved.beats[i].startedAt; b.ms = saved.beats[i].ms; }
    }
    console.log(`  reusing the recording (${probe(bodyMp4).toFixed(1)}s) — pass --redo=record to shoot it again`);
  } else {
  purgeWorkerCache(PROFILE);
  const videoDir = path.join(WORK, lesson.id);
  fs.rmSync(videoDir, { recursive: true, force: true });
  const context = await chromium.launchPersistentContext(PROFILE, { ...launchOptions(EXT), viewport: SIZE, recordVideo: { dir: videoDir, size: SIZE } });
  await keepOnTop(context); // test window stays above others; released on close
  let stage;
  let panel;
  /**
   * The clock every mark in this film is measured against, and the two
   * readings that say where the picture's clock started relative to it.
   *
   * Playwright begins a page's video somewhere between `newPage()` and the
   * first paint, and nothing reports when. That head of video is real footage
   * — the panel being dressed, the fixture loading — and it used to be left on
   * the front of the film, which pushed the picture later than every timing in
   * `marks.json` and put the narration 0.8s ahead of its own captions. Since
   * the recording stops when the page closes, the reading that closes the gap
   * is the one taken there: video length minus the time on the clock at that
   * moment is exactly how much was recorded before the clock started.
   */
  let t0 = 0;
  let stageClosedAt = 0;
  let panelClosedAt = 0;
  /** Seconds of picture recorded before the clock was zeroed by `setup:`. */
  let prelude = 0;

  try {
    const worker = await freshWorker(context);
    const id = new URL(worker.url()).host;
    stage = await context.newPage();
    panel = await context.newPage();
    await panel.goto(`chrome-extension://${id}/popup/popup.html`);
    await panel.waitForFunction(() => document.body.dataset.ready === 'true', { timeout: 15000 }).catch(() => {});
    const dress = async () => {
      await panel.evaluate(() => {
        try { localStorage.setItem('qaw-tutorial-seen', '1'); } catch { /* no storage */ }
        document.getElementById('pointer')?.setAttribute('hidden', '');
        // White behind it, so the crop lands on the page without a seam; the
        // rounded edge and hairline make it read as a floating panel.
        document.documentElement.style.background = '#FFFFFF';
        document.body.style.margin = '0 auto';
        document.body.style.border = '1px solid rgba(29,32,36,.16)';
        document.body.style.borderRadius = '14px';
        document.body.style.overflow = 'hidden';
      });
      panelBox = await panel.evaluate(() => {
        const r = document.body.getBoundingClientRect();
        return { x: Math.max(0, Math.round(r.x) - 1), y: Math.max(0, Math.round(r.y) - 1), w: Math.round(r.width) + 2, h: Math.round(Math.min(r.height, innerHeight - r.y)) };
      });
    };
    await dress();
    // One mode since UI round 2 (S6): nothing to set before the popup renders.
    await dress();

    let active = stage;
    let caption = { ar: '', en: '' };
    let chip = '';
    t0 = Date.now();
    const at = () => (Date.now() - t0) / 1000;
    const draw = (page, kind, data = {}) =>
      page
        .evaluate(({ KIND, AR, EN, X, Y, src }) => new Function('KIND', 'AR', 'EN', 'X', 'Y', src)(KIND, AR, EN, X, Y), { KIND: kind, AR: data.ar || '', EN: data.en || '', X: data.x || 0, Y: data.y || 0, src: OVERLAY })
        .catch(() => {});

    const t = {
      async caption(ar, en) { caption = { ar, en }; await draw(stage, 'caption', caption); },
      // The chip that carries the feature name. Stored like the caption, so a
      // navigation repaints it instead of losing it mid-beat.
      async feature(name) { chip = name || ''; await draw(stage, 'feature', { en: chip }); },
      async wait(ms) { await stage.waitForTimeout(ms); },
      async page(url) { active = stage; await stage.bringToFront(); if (url) { await stage.goto(url, { waitUntil: 'domcontentloaded' }); await stage.waitForTimeout(600); } await draw(stage, 'caption', caption); await draw(stage, 'feature', { en: chip }); },
      async popup() { active = panel; await panel.bringToFront(); await dress(); },
      async report(hash = '') {
        const sid = await t.sessionId();
        if (!sid) throw new Error('no session to report on');
        active = stage;
        await stage.bringToFront();
        await stage.goto(`chrome-extension://${id}/report/report.html?session=${sid}${hash}`);
        await stage.waitForFunction(() => !!document.getElementById('hero-title')?.textContent?.trim(), { timeout: 10000 }).catch(() => {});
        await stage.waitForTimeout(800);
        await draw(stage, 'caption', caption);
        // The chip too. A navigation destroys the overlay, and redrawing only
        // the caption is why the feature chips on the report and diagram beats
        // were named in the script and never appeared in the film.
        await draw(stage, 'feature', { en: chip });
      },
      async diagram() {
        const sid = await t.sessionId();
        active = stage;
        await stage.bringToFront();
        await stage.goto(`chrome-extension://${id}/diagram/diagram.html?session=${sid}`);
        await stage.waitForFunction(() => document.querySelectorAll('#sheet [data-node]').length > 0, { timeout: 12000 }).catch(() => {});
        await stage.waitForTimeout(800);
        await draw(stage, 'caption', caption);
        await draw(stage, 'feature', { en: chip });
      },
      sessionId: () => panel.evaluate(() => new Promise((r) => chrome.storage.session.get('lastSessionId', (v) => r(v.lastSessionId || null)))).catch(() => null),
      /** A click: the pointer travels, a ring marks the spot, a note names it. */
      async click(sel, note) {
        const box = await active.evaluate(async (q) => {
          const el = document.querySelector(q);
          if (!el) return null;
        el.scrollIntoView({ block: 'center', behavior: 'instant' });
          const r = el.getBoundingClientRect();
          return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
        }, sel);
        if (!box) throw new Error(`the film wanted ${sel}; the product has no such control`);
        await active.mouse.move(box.x, box.y, { steps: 16 });
        await active.waitForTimeout(200);
        await draw(active, 'ring', { x: box.x, y: box.y });
        marks.clicks.push(at());
        await active.mouse.click(box.x, box.y);
        if (note) {
          const onStage = active === stage;
          // A note about a panel press goes to the left of the panel, not under
          // it. The panel is composited at `W-w-28` — x=884 in a 1280 frame —
          // and this used to place the note at W-420, which is 860: every note
          // naming a tool press was covered by the panel that had just been
          // pressed, with two letters of it showing past the edge. 520 leaves
          // room for the widest note the clamp below allows.
          const nx = onStage ? box.x + 30 : SIZE.width - 760;
          const ny = onStage ? Math.max(24, box.y - 52) : 120;
          await draw(stage, 'note', { ar: note, x: nx, y: ny });
          setTimeout(() => draw(stage, 'note', {}), 2300);
        }
        await active.waitForTimeout(480);
      },
      async type(sel, text, delay = 55) { await t.click(sel); await active.keyboard.type(text, { delay }); await active.waitForTimeout(280); },
      /** A key, on whichever surface is in front. Escape is what closes a picker. */
      async press(key) { await active.keyboard.press(key); await active.waitForTimeout(220); },
      async scroll(px) { await stage.mouse.wheel(0, px); await stage.waitForTimeout(650); },
      async scrollIn(sel, px) { await active.evaluate(({ q, by }) => document.querySelector(q)?.scrollBy?.(0, by), { q: sel, by: px }); await active.waitForTimeout(650); },
      /**
       * Put a named control in the middle of the frame.
       *
       * `scroll(px)` lands wherever the page happens to be long that day, and a
       * shot that missed by a hundred pixels costs a whole take to fix. This
       * asks for the element by name, so the frame is the same every run.
       */
      async reveal(sel, block = 'center') {
        await active.evaluate(({ q, b }) => document.querySelector(q)?.scrollIntoView({ block: b, behavior: 'instant' }), { q: sel, b: block });
        await active.waitForTimeout(600);
      },
      async recording() {
        const ok = await panel.waitForFunction(() => !document.getElementById('step-live')?.hidden, { timeout: 8000 }).catch(() => null);
        if (!ok) throw new Error('Start did not begin a session');
      },
      /** The form, filled quickly — the film is not about typing. */
      async fillFast() {
        await stage.fill('#applicant', 'Layla Haddad');
        await stage.fill('#email', 'layla@example.com');
        await stage.fill('#quantity', '250');
        await stage.selectOption('#country', 'Jordan').catch(() => {});
        await stage.waitForTimeout(220);
      },
      async startShort() {
        await t.page(ORIGIN);
        await t.popup();
        await panel.click('#switch').catch(() => {});
        await panel.fill('#charter', 'Check the permit form').catch(() => {});
        await panel.click('#start').catch(() => {});
        await t.recording();
      },
      async recordShort() {
        await t.startShort();
        await t.page();
        await t.fillFast();
        await stage.click('#submit').catch(() => {});
        await stage.waitForTimeout(1000);
        await panel.click('#stop').catch(() => {});
        await stage.waitForTimeout(800);
      },
    };

    await t.page(ORIGIN);
    /*
     * What the film needs to exist but does not need to show.
     *
     * A report, a save dialog and a diagram all need a finished session behind
     * them, and driving one costs about six seconds — a third of a
     * twenty-second film, spent on the one thing `record-a-session` already
     * shows in full. `setup:` runs before the clock is zeroed and its footage
     * is cut off the front with the rest of the preroll, so those films open
     * on the thing they are about.
     *
     * Nothing here is a stand-in: the session under the report is a real one,
     * recorded on the same fixture moments earlier by the same code the first
     * film demonstrates. What is hidden is the *repetition*, not the work.
     */
    if (lesson.setup) {
      await lesson.setup(t);
      // The clock is *not* restarted here. `preroll()` below works by
      // subtracting the clock reading at the moment the page closed from the
      // length of the video, so restarting the clock would make that reading
      // mean something else. The prelude is simply remembered, added to the
      // head cut, and subtracted from every beat time once the beats are done.
      prelude = at();
      await t.caption('', '');
    }
    for (const beat of lesson.beats) {
      beat.startedAt = at();
      marks.beats.push(beat.startedAt);
      await t.caption(beat.ar, beat.en);
      await t.feature(beat.feature || '');
      const acted = beat.act(t);
      await Promise.all([acted, stage.waitForTimeout(Math.max(500, beat.ms - 500))]);
      const spent = (at() - beat.startedAt) * 1000;
      if (spent < beat.ms) await stage.waitForTimeout(Math.round(beat.ms - spent));
    }
    await t.caption('', '');
    await t.feature('');
    await stage.waitForTimeout(350);
  } finally {
    const stageVideo = stage?.video();
    const panelVideo = panel?.video();
    // Each recording stops when its page closes, so the clock is read there
    // and nowhere else. A reading taken after `context.close()` would carry
    // the teardown with it.
    await stage?.close().catch(() => {});
    stageClosedAt = (Date.now() - t0) / 1000;
    await panel?.close().catch(() => {});
    panelClosedAt = (Date.now() - t0) / 1000;
    await context.close();
    const base = stageVideo ? await stageVideo.path() : null;
    const side = panelVideo ? await panelVideo.path() : null;
    if (!base || !fs.existsSync(base)) { console.log('  nothing was recorded'); continue; }

    /**
     * How much of a recording happened before the clock started.
     *
     * Clamped into a range that cannot damage the film: never negative, and
     * never so large that it would cut into the first beat. If the reading is
     * wrong the worst case is the old behaviour — a little dead picture at the
     * front — rather than a film that opens halfway through its own hook.
     */
    const preroll = (file, closedAt) => {
      const raw = probe(file) - closedAt;
      return Math.min(Math.max(raw, 0), Math.max(0, lesson.beats[0].startedAt - 0.15));
    };
    /*
     * The off-camera setup, moved off the front of the film.
     *
     * Two separate heads: what Playwright recorded before the clock started
     * (`preroll`, unchanged and still clamped against the first beat) and the
     * seconds a `setup:` spent driving a session nobody watches. The beats are
     * pulled back by the same amount, so the narration still lands on the
     * picture it was written for.
     *
     * Both prerolls are read *before* the beats are shifted: `preroll()` clamps
     * itself against `beats[0].startedAt`, and shifting first would hand it a
     * ceiling of zero and leave the whole recorded head on the film.
     */
    const stageHead = preroll(base, stageClosedAt);
    const panelHead = side && fs.existsSync(side) ? preroll(side, panelClosedAt) : 0;
    if (prelude) {
      for (const b of lesson.beats) b.startedAt -= prelude;
      marks.beats = marks.beats.map((v) => v - prelude);
      // A click that happened off camera gets no ring and no sound.
      marks.clicks = marks.clicks.map((v) => v - prelude).filter((v) => v >= 0);
    }
    const headCut = stageHead + prelude;
    // Where the picture stops: the last beat, plus a held moment. Everything
    // after it is the browser being torn down.
    const last = lesson.beats[lesson.beats.length - 1];
    const tailAt = headCut + last.startedAt + last.ms / 1000 + 0.4;
    console.log(`  picture starts ${headCut.toFixed(2)}s into the recording, ends at ${(tailAt - headCut).toFixed(1)}s`);

    /* the panel: cropped to itself, corners rounded, set on the page */
    const PANEL_W = 368;
    if (side && fs.existsSync(side) && panelBox) {
      const ph = Math.min(panelBox.h, SIZE.height - panelBox.y);
      const scaledH = Math.round((ph / panelBox.w) * PANEL_W / 2) * 2;
      const mask = path.join(WORK, `mask-${PANEL_W}x${scaledH}.png`);
      if (!fs.existsSync(mask)) {
        await card(
          `<div style="position:absolute;left:0;top:0;width:${PANEL_W}px;height:${scaledH}px;background:#fff;border-radius:16px"></div>`,
          mask,
          'body{background:#000 !important;display:block !important;padding:0 !important}body::before{display:none}'
        );
        // ffmpeg cannot read and write the same file; crop to a temp, then move.
        const cropped = `${mask}.gray.png`;
        ff(['-i', mask, '-vf', `crop=${PANEL_W}:${scaledH}:0:0,format=gray`, cropped]);
        fs.renameSync(cropped, mask);
      }
      // Both streams are cut to their own head, so the panel and the page are
      // on one clock — the panel page is created after the stage page and its
      // recording therefore starts later, which used to leave the panel
      // running a third of a second ahead of the page it sits on.
      ff([
        '-i', base, '-i', side, '-i', mask,
        '-filter_complex',
        `[1:v]trim=start=${(panelHead + prelude).toFixed(3)},setpts=PTS-STARTPTS,` +
          `crop=${panelBox.w}:${ph}:${panelBox.x}:${panelBox.y},scale=${PANEL_W}:${scaledH}[p];` +
          `[2:v]format=gray,scale=${PANEL_W}:${scaledH}[m];[p][m]alphamerge[pa];` +
          `[0:v]trim=start=${headCut.toFixed(3)}:end=${tailAt.toFixed(3)},setpts=PTS-STARTPTS[s];` +
          `[s][pa]overlay=W-w-28:66:shortest=1,fps=30,format=yuv420p[v]`,
        '-map', '[v]', '-c:v', 'libx264', '-crf', '22', '-preset', 'medium', bodyMp4,
      ]);
    } else {
      ff(['-i', base, '-vf', `trim=start=${headCut.toFixed(3)}:end=${tailAt.toFixed(3)},setpts=PTS-STARTPTS,fps=30,format=yuv420p`,
          '-c:v', 'libx264', '-crf', '22', '-preset', 'medium', bodyMp4]);
    }

    // The timing, written beside the picture. Without it a later stage would
    // have to guess when each line was spoken, and a guess is how narration
    // ends up under the wrong shot.
    fs.writeFileSync(
      marksFile,
      JSON.stringify({ marks, beats: lesson.beats.map((b) => ({ startedAt: b.startedAt, ms: b.ms })) }, null, 1)
    );
  }
  }

  if (!fs.existsSync(bodyMp4)) { console.log('  nothing was recorded'); continue; }

  {
    /* the cards */
    // The eyebrow said "QA WRAP" above a title that also said "QA Wrap". It
    // now names the film's place in the set, which is what the tutorials page
    // shows on the same card.
    const featureNo = LESSONS.filter((l) => l.kind !== 'trailer').findIndex((l) => l.id === lesson.id) + 1;
    const titlePng = path.join(WORK, `${lesson.id}-title.png`);
    const endPng = path.join(WORK, `${lesson.id}-end.png`);
    await card(`<div class="mark">${markSvg}</div>
      <p class="kind">${lesson.kind === 'trailer' ? 'THE PRODUCT' : `FEATURE ${featureNo}`}</p>
      <h1>${lesson.en}</h1><h2>${lesson.ar}</h2>
      <p class="lede">${lesson.blurb}</p>`, titlePng);
    const ask = lesson.kind === 'trailer'
      ? '<p class="cta">Add it to your browser &mdash; free</p>'
        + '<p class="lede" style="margin-top:2px">and never write &ldquo;cannot reproduce&rdquo; again</p>'
      : '<p class="lede">Every failure, traced.</p>';
    await card(`<div class="mark">${markSvg}</div>
      <h1>QA Wrap</h1><h2>كل خطأ، وأثره</h2>
      ${ask}
      <div class="by"><span>MADE BY</span><b>${madeBy}</b></div>`, endPng);

    const titleMp4 = path.join(WORK, `${lesson.id}-title.mp4`);
    const endMp4 = path.join(WORK, `${lesson.id}-end.mp4`);
    ff(['-loop', '1', '-t', '2.4', '-i', titlePng, '-vf', 'fps=30,format=yuv420p', '-c:v', 'libx264', '-crf', '20', '-preset', 'medium', titleMp4]);
    ff(['-loop', '1', '-t', '2.5', '-i', endPng, '-vf', 'fps=30,format=yuv420p', '-c:v', 'libx264', '-crf', '20', '-preset', 'medium', endMp4]);

    /* the camera, then one cut, cross-faded */
    const cutMp4 = path.join(WORK, `${lesson.id}-cut.mp4`);
    const bodyDur = probe(bodyMp4);
    const lead = 2.0;

    // No camera move. It was built, it worked, and Nader did not want it: a
    // push on a screen recording draws attention to the frame rather than to
    // what is in it. `cameraExpr` and the `look:` directions are kept — the
    // move is one flag away if it is ever wanted — but nothing calls it.
    const shotMp4 = bodyMp4;
    ff([
      '-i', titleMp4, '-i', shotMp4, '-i', endMp4,
      '-filter_complex',
      `[0:v][1:v]xfade=transition=fade:duration=0.4:offset=${lead}[a];` +
        `[a][2:v]xfade=transition=fadeblack:duration=0.5:offset=${(lead + bodyDur - 0.5).toFixed(2)}[v]`,
      '-map', '[v]', '-c:v', 'libx264', '-crf', '22', '-preset', 'medium', cutMp4,
    ]);

    /* the mix, per language: narration on top, effects under it */
    const outputs = {};
    for (const lang of Object.keys(VOICES)) {
      const inputs = ['-i', cutMp4];
      const parts = [];
      const labels = [];
      let n = 1;
      for (const [i, beat] of lesson.beats.entries()) {
        const start = Math.max(0, Math.round((lead + beat.startedAt) * 1000)) || 0;
        inputs.push('-i', beat.audio[lang]);
        parts.push(`[${n}:a]adelay=${start}|${start},volume=1.0[v${i}]`);
        labels.push(`[v${i}]`);
        n++;
      }
      for (const [i, c] of marks.clicks.filter(Number.isFinite).slice(0, 16).entries()) {
        const start = Math.max(0, Math.round((lead + c) * 1000)) || 0;
        inputs.push('-i', SFX.click);
        parts.push(`[${n}:a]adelay=${start}|${start},volume=0.28[c${i}]`);
        labels.push(`[c${i}]`);
        n++;
      }
      // A transition sound between every phrase stops meaning "we are moving"
      // and becomes a tic — which is what Nader heard. Two only, at the two
      // places the film changes gear: into the features, and into the ask.
      //
      // Read off the script's own deliveries rather than off beat numbers. The
      // old version pointed at beats 4 and 11 by hand, and the first rewrite
      // that moved a line moved the gear change onto the middle of a sentence.
      const firstBeatSaying = (say) => {
        const i = lesson.beats.findIndex((b) => b.say === say);
        return i < 0 ? null : marks.beats[i];
      };
      const gearChanges = lesson.kind === 'trailer'
        ? [firstBeatSaying('feature'), firstBeatSaying('ask')].filter(Number.isFinite)
        : [];
      for (const [i, b] of gearChanges.entries()) {
        const start = Math.max(0, Math.round((lead + b - 0.28) * 1000));
        inputs.push('-i', SFX.whoosh);
        parts.push(`[${n}:a]adelay=${start}|${start},volume=0.13[w${i}]`);
        labels.push(`[w${i}]`);
        n++;
      }
      // Just before the cut to the end card, so the mark leads the picture
      // rather than trailing it — and close enough behind the last word that
      // the gap between them is a breath, not a hole.
      const endAt = Math.max(0, Math.round((lead + bodyDur - 0.3) * 1000)) || 0;
      inputs.push('-i', SFX.chime);
      parts.push(`[${n}:a]adelay=${endAt}|${endAt},volume=0.34[chime]`);
      labels.push('[chime]');
      n++;

      // The one place the film is genuinely dead: the title card, before the
      // first line. Measured at 2.7 seconds of digital silence, and it is the
      // worst possible place for it — the opening. One mark over the logo,
      // which is what a title card has always had. Every other gap in the film
      // is between 0.28 and 0.49 seconds: that is a breath, and filling it
      // would be worse than leaving it.
      inputs.push('-i', SFX.open);
      parts.push(`[${n}:a]adelay=180|180,volume=0.30[open]`);
      labels.push('[open]');
      n++;

      // A riser into the last line, on the commercial only. It is the standard
      // signal that a call to action is coming, and the reason a viewer who was
      // about to scroll stays for it.
      if (lesson.kind === 'trailer') {
        // It has to *arrive* on the ask, so it starts its two seconds before
        // it — measured from where the ask actually begins, not from the end
        // of the film, which is a different place whenever the ask is more
        // than one line.
        const askAt = firstBeatSaying('ask');
        const ctaAt = Math.max(0, Math.round((lead + Math.max(0, (Number.isFinite(askAt) ? askAt : bodyDur - 0.6) - 2.0)) * 1000)) || 0;
        inputs.push('-i', SFX.riser);
        parts.push(`[${n}:a]adelay=${ctaAt}|${ctaAt},volume=0.30[riser]`);
        labels.push('[riser]');
        n++;
      }

      // Voice and effects first, as one programme.
      parts.push(`${labels.join('')}amix=inputs=${labels.length}:normalize=0:dropout_transition=0[front]`);

      // Nothing under the voice. No music, no pulse, no noise floor —
      // every version of a background layer read as an engine idling, which
      // is what Nader heard and objected to twice. The gaps are handled where
      // they are made: the narration carries a small room (see the voice
      // stage), so a line decays into the pause instead of cutting to digital
      // black.
      const total = (lead + bodyDur + 2).toFixed(2);
      /*
       * Loudness, measured and then applied — two passes, not one.
       *
       * `loudnorm` in one pass is a dynamic normaliser working blind: it reads
       * the programme as it goes and can only guess at what is coming, so it
       * lands short, and it lands shorter the more silence a film has. The
       * commercial measured −15.7 LUFS against a −14 target; the shortest
       * feature film, which is a third of the length and proportionally more
       * breath, measured −16.1 and fell out of the −13…−16 band entirely.
       *
       * The first pass writes the real numbers, the second applies a single
       * linear gain from them, and the result lands within a few tenths of the
       * target on every length. If the measurement cannot be read — a future
       * ffmpeg changing its print format, say — the single pass is used and the
       * film is still made. It is a quality regression, not a broken build.
       */
      const norm = 'loudnorm=I=-14:TP=-1:LRA=11';
      const graph = (tail) => [...parts.slice(0, -1), `[front]alimiter=limit=0.95,${tail}[a]`].join(';');
      parts.push('');                                   // the slot `graph()` replaces
      const heard = measureLoudness([...inputs, '-filter_complex', graph(`${norm}:print_format=json`), '-map', '[a]', '-f', 'null', '-']);
      const applied = heard
        ? `${norm}:measured_I=${heard.input_i}:measured_LRA=${heard.input_lra}:measured_TP=${heard.input_tp}:measured_thresh=${heard.input_thresh}:offset=${heard.target_offset}:linear=true`
        : norm;
      if (!heard) console.log('  the loudness measurement could not be read — normalising in one pass');
      const out = path.join(MEDIA, `${lesson.id}-${lang}.mp4`);
      ff([...inputs, '-filter_complex', graph(`${applied},aresample=48000`), '-map', '0:v', '-map', '[a]', '-c:v', 'copy', '-c:a', 'aac', '-b:a', '160k', out]);
      outputs[lang] = path.basename(out);
    }

    /* the cap, enforced rather than reported */
    const cap = CAP[lesson.kind];
    let trimmed = 0;
    for (const lang of Object.keys(VOICES)) {
      const file = path.join(MEDIA, outputs[lang]);
      const over = probe(file) - cap;
      if (over <= 0.05) continue;
      if (over > 2) {                       // not a rounding error: say so, cut nothing
        console.log(`  ${lesson.id}-${lang} is ${over.toFixed(1)}s over — shorten a beat, do not trim`);
        continue;
      }
      // ffmpeg cannot read and write the same file, so it goes via a temp.
      const tmp = path.join(MEDIA, `_trim-${lesson.id}-${lang}.mp4`);
      ff(['-i', file, '-t', String((cap - 0.2).toFixed(2)), '-c', 'copy', tmp]);
      fs.renameSync(tmp, file);
      trimmed += 1;
    }

    const poster = `${lesson.id}.png`;
    ff(['-ss', '3.2', '-i', path.join(MEDIA, outputs.en), '-vframes', '1', path.join(MEDIA, poster)]);

    /* the master, then the copy that ships */
    //
    // A film at recording quality is about 1.6 MB; five of them in two
    // languages would be most of the package. The master is kept whole for
    // anything that will be projected or cut into something else, and the
    // shipped copy is re-encoded at a size that still reads at full screen.
    fs.mkdirSync(MASTERS, { recursive: true });
    fs.copyFileSync(path.join(MEDIA, poster), path.join(MASTERS, poster));
    for (const lang of Object.keys(VOICES)) {
      const shipped = path.join(MEDIA, outputs[lang]);
      fs.copyFileSync(shipped, path.join(MASTERS, outputs[lang]));
      const small = path.join(MEDIA, `_small-${outputs[lang]}`);
      ff(['-i', path.join(MASTERS, outputs[lang]),
          '-c:v', 'libx264', '-crf', '30', '-preset', 'slow',
          '-c:a', 'aac', '-b:a', '96k', '-movflags', '+faststart', small]);
      fs.renameSync(small, shipped);
    }

    const secs = probe(path.join(MEDIA, outputs.en));
    const kb = Math.round(fs.statSync(path.join(MEDIA, outputs.en)).size / 1024);
    const masterKb = Math.round(fs.statSync(path.join(MASTERS, outputs.en)).size / 1024);
    made.push({ id: lesson.id, kind: lesson.kind, ar: lesson.ar, en: lesson.en, blurb: lesson.blurb, files: outputs, poster, secs: Math.round(secs) });
    const note = trimmed ? ` · tail trimmed to the cap in ${trimmed} cut${trimmed > 1 ? 's' : ''}` : '';
    console.log(`  ${lesson.id} · ${secs.toFixed(1)}s ${secs <= cap ? '✓' : `✗ over the ${cap}s cap`} · ships ${kb} KB, master ${masterKb} KB · ${Object.keys(VOICES).join(' + ')}${note}`);
  }
}

/* ── 5. what the tutorials page reads ────────────────────────────────────── */
/**
 * The manifest is updated, not replaced.
 *
 * This file records the round-1 set. Round 3 is recorded by
 * `tools/film/record/` and its own manifest writer, and `lessons.json` now
 * carries fields this pipeline knows nothing about: `chapters`, the seek
 * points under a category film, and `pending`, which is how the films page
 * renders a film that has not been encoded yet without pointing a `<video>` at
 * a file that is not there. Overwriting an entry wholesale dropped both,
 * silently, and a chapter rail that vanishes when somebody re-mixes one film
 * is a fault nobody would connect to the command they ran.
 *
 * The order is treated the same way. `LESSONS` here is one set of ids and the
 * manifest holds another, so `indexOf` answers -1 for every id this file has
 * never heard of, which sorted the four category films in front of the trailer
 * and the page gives the first card the full width. An id this file does not
 * know keeps the place it already had.
 */
if (made.length) {
  const file = path.join(EXT, 'tutorials', 'lessons.json');
  const existing = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : [];
  const was = new Map(existing.map((e, i) => [e.id, { at: i, entry: e }]));
  const merged = [
    ...made.map((m) => ({ ...(was.get(m.id)?.entry || {}), ...m })),
    ...existing.filter((e) => !made.some((m) => m.id === e.id)),
  ];
  /* The manifest's own order wins, because the round-3 writer sets it and the
     films page reads the array in order. `LESSONS` only decides where a film
     that is not in the manifest yet is appended. */
  const order = LESSONS.map((l) => l.id);
  const rank = (l) => (was.has(l.id) ? was.get(l.id).at : existing.length + order.indexOf(l.id));
  merged.sort((a, b) => rank(a) - rank(b));
  fs.writeFileSync(file, JSON.stringify(merged, null, 2));
  console.log(`\nwrote tutorials/lessons.json — ${merged.length} film(s), ${merged.reduce((n, m) => n + m.secs, 0)}s in all`);
}
server.close();
