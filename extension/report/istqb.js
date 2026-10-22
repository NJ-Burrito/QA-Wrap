/* QA Wrap — local-first QA toolkit in the ISTQB shape. */
/**
 * The "Jira" tab: an ISTQB test case and defect report, then Jira and chat.
 *
 * The shape of this screen is an argument. A recorder can see what the
 * application *did*; it cannot see what it *should* do, how bad that is for the
 * business, or how urgently anyone needs it fixed. Those are the three fields a
 * generated ticket usually invents — so here they are the three fields the
 * tester is asked for, above everything else, with the tool's guess pre-filled
 * and labelled as a guess.
 *
 * Everything below them is derived and shown read-only-ish: change it if you
 * like, but nothing here needed a judgement call.
 */

(() => {
  const $ = (id) => document.getElementById(id);

  /** The words for a key, from platform/i18n.js. */
  const t = (k, v) => QAWi18n.t(k, v);

  /**
   * Send, and retry once if the worker was still waking up.
   *
   * MV3 suspends the service worker aggressively, and the first message from a
   * page that has only just opened can arrive while it is still starting — the
   * callback then fires with `undefined` and a "port closed" lastError. It is
   * indistinguishable from a missing handler, which is exactly how this tab
   * came up empty with "Background worker is not responding" on a worker that
   * was perfectly healthy a second later.
   */
  function once(msg) {
    return new Promise((resolve) => {
      chrome.runtime.sendMessage(msg, (res) => {
        void chrome.runtime.lastError;
        resolve(res);
      });
    });
  }

  /**
   * Retry with a short backoff, but only while the worker is *silent*.
   *
   * A real answer — including a refusal — is returned immediately; only the
   * `undefined` that means "nobody replied" is retried. A page that has just
   * opened can spend a second or so in that state while MV3 restarts the
   * worker, and a single retry was not always enough.
   */
  async function send(msg, { attempts = 4 } = {}) {
    for (let i = 0; i < attempts; i++) {
      const res = await once(msg);
      if (res !== undefined) return res;
      if (i < attempts - 1) await new Promise((r) => setTimeout(r, 200 * 2 ** i));
    }
    return {
      ok: false,
      error: t('report.istqb.workerSilent'),
    };
  }

  const el = (tag, className, text) => {
    const n = document.createElement(tag);
    if (className) n.className = className;
    if (text != null) n.textContent = text;
    return n;
  };

  let vocab = null;
  let current = { kind: 'defect', artefact: null };
  let jiraReady = false;
  let projectStyle = null;
  let jiraTypes = [];
  let quickCfg = null;

  // What the tester will send: pre-filled from the recording, theirs once
  // edited. `dirty` is the line between the two — a rebuild replaces the text
  // until the first keystroke, and never after it.
  const draft = { summary: '', body: '', dirty: false };
  let attachTouched = false;

  const ISTQB_KINDS = new Set(['defect', 'testcase']);
  /*
   * `KIND_LABEL`, `KIND_HINT`, `ATTACH` and `FORMAT_LABEL` below stay as the
   * English source of record, and the four lookups underneath them resolve a
   * key instead. The tables are built when the file parses, which is before the
   * language file has loaded, so nothing in them can be translated in place;
   * every one of them keeps its ids, because the ids are what the code
   * branches on.
   */
  const KIND_LABEL = {
    defect: 'defect report', testcase: 'test case', story: 'user story', epic: 'epic',
    task: 'task', subtask: 'sub-task', plain: 'issue',
  };
  const KIND_HINT = {
    story: 'As a … I want … so that …, with acceptance criteria drawn from the steps you took.',
    epic: 'The scope this session walked: the areas, what passed, what did not, and the children to create.',
    task: 'A unit of work: the steps, the result, the evidence.',
    subtask: 'The same as a task, filed under a parent you choose in the fields below.',
    plain: 'A title and a description you write. The evidence block is kept so the ticket can be traced.',
  };
  const KIND_MATCH = {
    defect: /bug|defect|incident|fault/i, testcase: /test|scenario/i, story: /story/i,
    epic: /epic/i, task: /^task$/i, subtask: /sub-?task/i, plain: /./,
  };
  // The evidence each kind carries unless the tester changes the ticks.
  const ATTACH_DEFAULTS = {
    defect: ['screens', 'markdown', 'sbtm', 'har'],
    testcase: ['playwright', 'suite', 'csv'],
    story: ['screens', 'markdown', 'sbtm'],
    epic: ['sbtm', 'suite', 'html'],
    task: ['screens', 'markdown'],
    subtask: ['screens', 'markdown'],
    plain: ['screens'],
  };
  /** The word for a kind, in a sentence the tester reads before pressing. */
  function kindLabel(kind) {
    switch (kind) {
      case 'defect': return t('report.istqb.kindDefect');
      case 'testcase': return t('report.istqb.kindTestcase');
      case 'story': return t('report.istqb.kindStory');
      case 'epic': return t('report.istqb.kindEpic');
      case 'task': return t('report.istqb.kindTask');
      case 'subtask': return t('report.istqb.kindSubtask');
      case 'plain': return t('report.istqb.kindPlain');
      default: return KIND_LABEL[kind] || kind;
    }
  }

  /** The sentence under the banner, for the kinds that are not ISTQB shapes. */
  function kindHint(kind) {
    switch (kind) {
      case 'story': return t('report.istqb.hintStory');
      case 'epic': return t('report.istqb.hintEpic');
      case 'task': return t('report.istqb.hintTask');
      case 'subtask': return t('report.istqb.hintSubtask');
      case 'plain': return t('report.istqb.hintPlain');
      default: return KIND_HINT[kind] || '';
    }
  }

  /** The name and the note beside one attachment tick box. */
  function attachWords(id) {
    switch (id) {
      case 'screens': return { label: t('report.istqb.attachScreens'), note: t('report.istqb.attachScreensNote') };
      case 'markdown': return { label: t('report.istqb.attachMarkdown'), note: t('report.istqb.attachMarkdownNote') };
      case 'sbtm': return { label: t('report.istqb.attachSbtm'), note: t('report.istqb.attachSbtmNote') };
      case 'suite': return { label: t('report.istqb.attachSuite'), note: t('report.istqb.attachSuiteNote') };
      case 'playwright': return { label: t('report.istqb.attachPlaywright'), note: t('report.istqb.attachPlaywrightNote') };
      case 'har': return { label: t('report.istqb.attachHar'), note: t('report.istqb.attachHarNote') };
      case 'csv': return { label: t('report.istqb.attachCsv'), note: t('report.istqb.attachCsvNote') };
      case 'junit': return { label: t('report.istqb.attachJunit'), note: t('report.istqb.attachJunitNote') };
      case 'html': return { label: t('report.istqb.attachHtml'), note: t('report.istqb.attachHtmlNote') };
      case 'json': return { label: t('report.istqb.attachJson'), note: t('report.istqb.attachJsonNote') };
      default: return null;
    }
  }

  /** What one export is called in the auto-submit confirmation. */
  function formatLabel(id) {
    switch (id) {
      case 'markdown': return t('report.istqb.fmtMarkdown');
      case 'sbtm': return t('report.istqb.fmtSbtm');
      case 'har': return t('report.istqb.fmtHar');
      default: return FORMAT_LABEL[id] || id;
    }
  }

  const ATTACH = [
    { id: 'screens', label: 'Screenshots', note: 'every one taken in this session, as images' },
    { id: 'markdown', label: 'Defect report (.md)', note: '29119-3 shape; the steps, the cause, the evidence' },
    { id: 'sbtm', label: 'Session sheet (.md)', note: 'charter, areas covered, task breakdown, notes' },
    { id: 'suite', label: 'Test suite (.md)', note: 'one test case per flow that was walked' },
    { id: 'playwright', label: 'Playwright spec (.ts)', note: 'a runnable re-test of what you did' },
    { id: 'har', label: 'Network log (.har)', note: 'every request, in the format DevTools exports' },
    { id: 'csv', label: 'Timeline (.csv)', note: 'for TestRail, Xray, or a spreadsheet' },
    { id: 'junit', label: 'JUnit (.xml)', note: 'what a test manager or CI ingests' },
    { id: 'html', label: 'Illustrated report (.html)', note: 'opens in any browser' },
    { id: 'json', label: 'Raw session (.json)', note: 'everything, for a machine' },
  ];

  const say = (text, tone = '') => {
    const n = $('file-status');
    n.textContent = text;
    n.className = `muted ${tone}`.trim();
  };

  /* ── which artefact ────────────────────────────────────────────────────── */

  function wireKind() {
    document.querySelectorAll('[data-artefact]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        current.kind = btn.dataset.artefact;
        document.querySelectorAll('[data-artefact]').forEach((b) =>
          b.setAttribute('aria-selected', String(b === btn))
        );
        // A new kind is a new document: the draft is refilled, the issue type
        // re-picked from the project's own list, the evidence set reset.
        draft.dirty = false;
        if (!attachTouched) renderAttach();
        if (jiraReady) paintTypes();
        paintAutoSubmit();
        window.UQASound?.play('jira.draft');
        await rebuild();
      });
    });
  }

  /* ── the judgement calls ───────────────────────────────────────────────── */

  function renderJudgement(defect) {
    const host = $('judgement');
    host.replaceChildren();
    if (current.kind !== 'defect' || !defect || !vocab) { // vocab is null until UQA_ISTQB_VOCAB answers (or when it failed)
      host.hidden = true;
      return;
    }
    host.hidden = false;

    // Expected result. Empty on purpose, and said so, because only a person
    // knows it — a report whose "expected" was copied from the failing run is
    // worse than one with the field empty.
    //
    // The hint used to read "Left blank on purpose", directly under a box
    // carrying a suggested sentence as its placeholder. Both were true and
    // together they read as a contradiction: the box plainly is not blank. So
    // the hint says which of the two things on screen is the answer.
    const expected = el('label', 'judge-field');
    expected.append(el('span', 'judge-label', t('report.istqb.expectedLabel')));
    const input = document.createElement('textarea');
    input.id = 'defect-expected';
    input.rows = 2;
    input.placeholder = t('report.istqb.expectedPlaceholder');
    input.value = defect.expected || '';
    expected.append(input);
    expected.append(el('span', 'judge-hint', t('report.istqb.expectedHint')));
    host.append(expected);

    // Severity and priority, side by side and explicitly different questions.
    const pair = el('div', 'judge-pair');
    pair.append(
      picker('defect-severity', t('report.istqb.severity'), t('report.istqb.severityQ'), vocab.severity, defect.severity, defect.severityIsSuggestion),
      picker('defect-priority', t('report.istqb.priority'), t('report.istqb.priorityQ'), vocab.priority, defect.priority, defect.priorityIsSuggestion)
    );
    host.append(pair);

    host.append(el('p', 'judge-note', t('report.istqb.judgeNote')));
  }

  function picker(id, label, question, options, value, isSuggestion) {
    const wrap = el('label', 'judge-field');
    const head = el('span', 'judge-label');
    head.append(document.createTextNode(label));
    if (isSuggestion) head.append(el('em', 'judge-guess', t('report.istqb.suggested')));
    wrap.append(head, el('span', 'judge-hint', question));

    const select = document.createElement('select');
    select.id = id;
    for (const o of options) {
      const opt = document.createElement('option');
      opt.value = o.id;
      const w = QAWi18n.lang() === 'ar' && o.ar ? o.ar : o;
      opt.textContent = `${w.label}: ${w.hint}`;
      opt.selected = o.id === value;
      select.append(opt);
    }
    // Choosing one turns it from a guess into a decision.
    select.addEventListener('change', () => head.querySelector('.judge-guess')?.remove());
    wrap.append(select);
    return wrap;
  }

  /* ── the derived document ──────────────────────────────────────────────── */

  // The document itself is the editable text below; this is only the banner
  // above it, when there is something to say before filing.
  function renderPreview(_markdown, extra) {
    const host = $('artefact-preview');
    host.replaceChildren();
    if (extra) host.append(extra);
  }

  async function rebuild() {
    if (!window.UQAReport?.sessionId) return;
    const sessionId = window.UQAReport.sessionId;
    say(t('report.istqb.building'));

    // Nested, never spread: a test case has a field called `type`, and spreading
    // it into the message overwrote the message's own type with "Functional".
    const options = collectOptions();
    $('istqb-block').hidden = !ISTQB_KINDS.has(current.kind);
    $('defect-extra').hidden = current.kind !== 'defect'; // r10-04-1: build and repeatability belong to a defect only

    if (!ISTQB_KINDS.has(current.kind)) {
      // A story, an epic, a task: the same facts, arranged for that ticket.
      const d = await send({ type: 'UQA_JIRA_DRAFT', sessionId, kind: current.kind, options });
      if (!d.ok) return say(d.error, 'err');
      current.artefact = null;
      renderJudgement(null);
      // The first letter is raised for English and is a no-op in Arabic, which
      // has no case: `toUpperCase()` on an Arabic letter returns that letter.
      const named = kindLabel(current.kind);
      renderPreview(d.result.body, banner('info', `${named[0].toUpperCase()}${named.slice(1)}.`, kindHint(current.kind)));
      $('gherkin-copy').hidden = true;
      fillDraft(d.result.summary, d.result.body);
      return say('');
    }

    const res = await send({
      type: current.kind === 'testcase' ? 'UQA_TEST_CASE' : 'UQA_DEFECT',
      sessionId,
      options,
    });
    if (!res.ok) return say(res.error, 'err');

    if (current.kind === 'testcase') {
      current.artefact = res.result.testCase;
      // Hide the judgement block explicitly. It was only ever *drawn* by the
      // defect branch, so switching documents left a severity and a priority on
      // screen belonging to a document that has neither — and any tester who
      // then touched them would have been setting fields on nothing.
      renderJudgement(null);
      const warn = current.artefact.needsReview
        ? banner('warn', t('report.istqb.reviewTitle'), t('report.istqb.reviewNote'))
        : null;
      renderPreview(res.result.markdown, warn);
      $('gherkin-copy').hidden = false;
      $('gherkin-copy').dataset.text = res.result.gherkin;
      fillDraft(`${current.artefact.identifier}: ${current.artefact.objective}`, res.result.markdown);
    } else {
      current.artefact = res.result.defect;
      renderJudgement(current.artefact);
      renderPreview(res.result.markdown, null);
      $('gherkin-copy').hidden = true;
      fillDraft(current.artefact.summary, res.result.markdown);
    }
    say('');
  }

  /* ── the draft the tester edits ────────────────────────────────────────── */

  function fillDraft(summary, body) {
    draft.summary = summary || '';
    draft.body = body || '';
    if (draft.dirty) return; // their words stand
    $('jira-summary').value = draft.summary;
    $('jira-body').value = draft.body;
    $('jira-body-note').hidden = true;
  }

  function wireDraft() {
    const touched = () => {
      draft.dirty = true;
      $('jira-body-note').hidden = false;
    };
    $('jira-summary').addEventListener('input', touched);
    $('jira-body').addEventListener('input', touched);
    $('jira-body-reset').addEventListener('click', () => {
      draft.dirty = false;
      fillDraft(draft.summary, draft.body);
    });
  }

  /* ── the fields this issue type has, drawn from the site's own schema ──── */

  function renderFields(type) {
    const host = $('jira-fields');
    host.replaceChildren();
    const list = type?.fields || [];
    const required = list.filter((f) => f.required);
    $('jira-fields-count').textContent = list.length
      ? t('report.istqb.fieldsCount', { required: required.length, all: list.length })
      : t('report.istqb.fieldsNone');
    // Open by itself only when something must be filled in and Jira will not
    // fill it for you; otherwise it stays folded and out of the way.
    $('jira-fields-wrap').open = required.some((f) => !f.hasDefault);
    for (const f of list) host.append(fieldControl(f));
  }

  function fieldControl(f) {
    const wrap = el('label', 'field jira-field');
    wrap.dataset.key = f.key;
    const head = el('span', null, f.name);
    if (f.required) head.append(el('b', 'req', ' *'));
    wrap.append(head);

    let input;
    if (f.control === 'select' || f.control === 'multiselect') {
      input = document.createElement('select');
      if (f.control === 'multiselect') {
        input.multiple = true;
        input.size = Math.min(5, Math.max(2, f.allowedValues.length));
      } else {
        const none = document.createElement('option');
        none.value = '';
        none.textContent = f.required ? t('report.istqb.choose') : '—';
        input.append(none);
      }
      for (const v of f.allowedValues) {
        const o = document.createElement('option');
        o.value = v.id || v.value || v.name;
        o.textContent = v.name || v.value || v.id;
        input.append(o);
      }
    } else if (f.control === 'textarea') {
      input = document.createElement('textarea');
      input.rows = 3;
    } else {
      input = document.createElement('input');
      input.type = { date: 'date', datetime: 'datetime-local', number: 'number' }[f.control] || 'text';
      input.placeholder =
        f.control === 'tags' ? t('report.istqb.tagsPlaceholder')
          : f.control === 'user' ? t('report.istqb.userPlaceholder')
            // `PROJ-123` is a shape, not a sentence: it stays as it is written.
            : f.key === 'parent' || f.schema?.type === 'issuelink' ? 'PROJ-123'
              : '';
    }
    input.name = f.key;
    if (f.required) input.required = true;
    if (f.key === 'labels') input.value = ['qa-wrap', current.kind === 'testcase' ? 'test-case' : current.kind].join(', ');
    wrap.append(input);
    if (f.required && f.hasDefault) wrap.append(el('span', 'judge-hint', t('report.istqb.jiraDefaults')));
    return wrap;
  }

  function collectFields() {
    const out = {};
    for (const wrap of $('jira-fields').querySelectorAll('.jira-field')) {
      const input = wrap.querySelector('select, input, textarea');
      if (!input) continue;
      const v = input.multiple ? [...input.selectedOptions].map((o) => o.value) : input.value.trim();
      if (v && v.length) out[wrap.dataset.key] = v;
    }
    return out;
  }

  /* ── the evidence ──────────────────────────────────────────────────────── */

  function renderAttach() {
    const host = $('jira-attach-list');
    const chosen = new Set(attachTouched ? collectAttachIds() : ATTACH_DEFAULTS[current.kind] || []);
    host.replaceChildren();
    for (const a of ATTACH) {
      const words = attachWords(a.id) || a;
      const label = el('label', 'attach-item');
      const box = document.createElement('input');
      box.type = 'checkbox';
      box.value = a.id;
      box.checked = chosen.has(a.id);
      box.addEventListener('change', () => { attachTouched = true; });
      label.append(box, el('span', 'attach-name', words.label), el('span', 'attach-note', words.note));
      host.append(label);
    }
  }

  function collectAttachIds() {
    return [...$('jira-attach-list').querySelectorAll('input:checked')].map((i) => i.value);
  }

  function collectAttach() {
    const ids = collectAttachIds();
    return { screenshots: ids.includes('screens'), formats: ids.filter((i) => i !== 'screens') };
  }

  function banner(kind, strong, rest) {
    const n = el('div', `file-banner ${kind}`);
    n.append(el('b', null, strong), document.createTextNode(' ' + rest));
    return n;
  }

  /** D-1010-175: the comma-separated requirements, trimmed, deduplicated, empties dropped (an Arabic comma or a semicolon also separates). */
  const requirementList = () => [...new Set(String($('link-requirements')?.value || '').split(/[,\u060C;\n]+/).map((r) => r.trim()).filter(Boolean))];

  function collectOptions() {
    const o = {
      level: $('tc-level')?.value || undefined,
      type: $('tc-type')?.value || undefined,
      epic: $('link-epic')?.value || undefined,
      story: $('link-story')?.value || undefined,
      requirements: requirementList(),
    };
    if (current.kind === 'defect') {
      const expected = $('defect-expected')?.value?.trim();
      if (expected) o.expected = expected;
      // D-1010-131: optional build and reproducibility, read when report.html carries the two inputs (their labels are a round-7 item: this script cannot read core/doc-labels.js).
      const build = $('defect-build')?.value?.trim();
      if (build) o.build = build;
      if ($('defect-repro')?.value) o.reproducibility = $('defect-repro').value;
      // Only send these once the tester has actually touched them, so the
      // "suggested" label stays truthful.
      const sev = $('defect-severity');
      const pri = $('defect-priority');
      if (sev && !sev.closest('.judge-field').querySelector('.judge-guess')) o.severity = sev.value;
      if (pri && !pri.closest('.judge-field').querySelector('.judge-guess')) o.priority = pri.value;
    }
    return o;
  }

  /* ── Jira, discovered ──────────────────────────────────────────────────── */

  /**
   * Connect, and say so where the person pressing it is looking.
   *
   * ── the bug this closes ──────────────────────────────────────────────────
   *
   * "The Jira button in the report does nothing on Connect." Three separate
   * things made that true, and all three are fixed here and in `init()` below.
   *
   * **It could genuinely be dead.** `init()` returned early when
   * `UQA_ISTQB_VOCAB` did not answer, and it returned *before* wiring a single
   * listener, so on a worker that was slow to wake the Connect button was an
   * ordinary unclickable rectangle with nothing bound to it and no message
   * anywhere. The wiring now happens first; see `init()`.
   *
   * **It said nothing the presser could see.** Every outcome went to `say()`,
   * which writes into #file-status, a muted line in the filter bar at the top
   * of the panel. The Jira block is most of a screen below it. The answers now
   * go to #jira-who, the line directly under the button.
   *
   * **It gave no sign it was working.** Asking a Jira site for its projects,
   * its issue types and its field schema takes a few seconds on a real
   * instance, during which the button looked untouched, so people pressed it
   * again. It disables itself and says what it is doing.
   */
  function jiraSay(text, tone = '') {
    const n = $('jira-who');
    if (n) {
      n.textContent = text;
      n.className = tone === 'err' ? 'muted err' : 'muted';
    }
    // The status line as well, because it is where the rest of this tab
    // reports and a reader who has scrolled up should not see a stale line.
    say(text, tone);
  }

  async function connectJira() {
    const btn = $('jira-connect');
    if (btn) {
      btn.disabled = true;
      btn.textContent = t('report.istqb.connecting');
    }
    const done = () => {
      if (!btn) return;
      btn.disabled = false;
      btn.textContent = jiraReady ? t('report.istqb.connectAgain') : t('report.file.connect');
    };

    const asked = await askServiceAccess((await savedSettings()).jira?.baseUrl);
    if (!asked.ok) {
      done();
      return jiraSay(asked.error, 'err');
    }
    jiraSay(t('report.istqb.asking'));
    const test = await send({ type: 'UQA_JIRA_TEST' });
    if (!test.ok) {
      jiraReady = false;
      $('jira-panel').hidden = true;
      done();
      return jiraSay(test.error, 'err');
    }
    jiraReady = true;
    $('jira-panel').hidden = false;
    jiraSay(t('report.istqb.connectedAs', { name: test.result.account.name, note: test.result.note }));

    const projects = await send({ type: 'UQA_JIRA_PROJECTS' });
    done();
    if (!projects.ok) return jiraSay(projects.error, 'err');

    const select = $('jira-project');
    select.replaceChildren();
    for (const p of projects.result) {
      const opt = document.createElement('option');
      opt.value = p.key;
      opt.textContent = `${p.key}: ${p.name}`;
      opt.dataset.style = p.style;
      select.append(opt);
    }
    if (!projects.result.length) {
      // Connected, and nothing to file into. Silence here reads as a failure to
      // connect, which sends the reader back to their credentials for a
      // permissions problem.
      return jiraSay(t('report.istqb.noProjects'), 'err');
    }
    await onProject();
    say(t(projects.result.length === 1 ? 'report.istqb.projectsOne' : 'report.istqb.projectsMany', { n: projects.result.length }));
  }

  async function onProject() {
    const select = $('jira-project');
    const key = select.value;
    projectStyle = select.selectedOptions[0]?.dataset.style;
    if (!key) return;

    // Issue types are per project, so the list is rebuilt every time. A fixed
    // list produces "field 'issuetype' is required" and a hunt.
    const types = await send({ type: 'UQA_JIRA_TYPES', projectKey: key });
    const typeSelect = $('jira-type');
    typeSelect.replaceChildren();
    if (types.ok) {
      jiraTypes = types.result;
      paintTypes();
    } else {
      typeSelect.replaceChildren();
    }

    await loadTargets('');
  }

  /**
   * The project's issue types, narrowed to the kind: sub-task types for a
   * sub-task, everything else otherwise, with the best name match selected.
   * Repainted whenever the kind changes, because "Story" is the wrong default
   * for an epic and a sub-task type cannot be created without a parent.
   */
  function paintTypes() {
    const typeSelect = $('jira-type');
    typeSelect.replaceChildren();
    const wantSub = current.kind === 'subtask';
    const pool = jiraTypes.filter((t) => !!t.subtask === wantSub);
    const list = pool.length ? pool : jiraTypes;
    const match = list.find((t) => KIND_MATCH[current.kind].test(t.name)) || list[0];
    // Named `type` and not `t`: `t` is the translator in this file.
    for (const type of list) {
      const opt = document.createElement('option');
      opt.value = type.name;
      opt.textContent = type.name + (type.required.length ? t('report.istqb.typeNeeds', { fields: type.required.map((f) => f.name).join(', ') }) : '');
      opt.selected = type === match;
      typeSelect.append(opt);
    }
    // Required fields refuse the create call, so they are said — and drawn —
    // before the button is pressed, and again whenever the type changes.
    const onType = () => {
      paintRequired(jiraTypes);
      renderFields(jiraTypes.find((t) => t.name === typeSelect.value));
    };
    onType();
    typeSelect.onchange = onType;
  }

  function paintRequired(types) {
    const chosen = types.find((t) => t.name === $('jira-type').value);
    const must = (chosen?.required || []).filter((f) => !f.hasDefault);
    $('jira-required').textContent = must.length
      ? t('report.istqb.needsFields', { type: chosen.name, fields: must.map((f) => f.name).join(', ') })
      : '';
  }

  /**
   * Search Jira for something to link to.
   *
   * Two guards, both learned the hard way. The search ran on every keystroke,
   * so typing a six-letter project key sent six requests to somebody's Jira
   * site; and because they came back in whatever order the network chose, the
   * answer to "PAY" could land after the answer to "PAYMENT" and leave the
   * wrong list on screen. So: wait for the typing to stop, and ignore any
   * answer that has been overtaken.
   */
  let searchTimer = null;
  let searchSeq = 0;

  function searchTargets(query) {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => loadTargets(query), 300);
  }

  async function loadTargets(query) {
    const key = $('jira-project').value;
    if (!key) return;
    const seq = ++searchSeq;
    const res = await send({ type: 'UQA_JIRA_TARGETS', projectKey: key, query });
    if (seq !== searchSeq) return; // a newer search has already been asked
    if (!res.ok) return say(res.error, 'err');

    fill($('link-epic'), res.result.epics, t('report.istqb.noEpic'));
    fill($('link-story'), res.result.stories, t('report.istqb.noStory'));
  }

  function fill(select, issues, emptyLabel) {
    select.replaceChildren();
    const none = document.createElement('option');
    none.value = '';
    none.textContent = emptyLabel;
    select.append(none);
    for (const i of issues) {
      const opt = document.createElement('option');
      opt.value = i.key;
      opt.textContent = `${i.key}: ${i.summary}`.slice(0, 110);
      select.append(opt);
    }
  }

  /** r10-04-1 (D-238): the build and how often it happens, as two lines under a defect's description; nothing for the other kinds. */
  function withDefectNotes(body) {
    if (current.kind !== 'defect') return body;
    const build = ($('defect-build')?.value || '').trim();
    const repro = $('defect-repro')?.value || 'unknown';
    const lines = [];
    if (build) lines.push(`${t('report.file.defectBuild')}: ${build}`);
    const reproWord = { always: t('report.file.reproAlways'), sometimes: t('report.file.reproSometimes'), once: t('report.file.reproOnce') }[repro];
    if (reproWord) lines.push(`${t('report.file.defectRepro')}: ${reproWord}`);
    return lines.length ? `${body}\n\n${lines.join('\n')}` : body;
  }

  async function file() {
    if (!window.UQAReport?.sessionId) return;
    const project = $('jira-project').value;
    const type = $('jira-type').value;
    const epic = $('link-epic').value || null;
    const story = $('link-story').value || null;

    const summary = $('jira-summary').value.trim();
    if (!summary) {
      $('jira-summary').focus();
      return say(t('report.istqb.needSummary'), 'err');
    }
    const missing = [...$('jira-fields').querySelectorAll('[required]')].filter((i) =>
      i.multiple ? !i.selectedOptions.length : !i.value.trim()
    );
    if (missing.length) {
      $('jira-fields-wrap').open = true;
      missing[0].focus();
      return say(t(missing.length === 1 ? 'report.istqb.emptyRequiredOne' : 'report.istqb.emptyRequiredMany', { n: missing.length }), 'err');
    }

    const attach = collectAttach();
    const sets = attach.formats.length + (attach.screenshots ? 1 : 0);
    const ask =
      t('report.istqb.fileConfirm', { kind: kindLabel(current.kind), project, type }) +
      (sets ? t(sets === 1 ? 'report.istqb.fileConfirmAttachOne' : 'report.istqb.fileConfirmAttachMany', { n: sets }) : '') +
      t('report.istqb.fileConfirmTail');
    if (!confirm(ask)) return;

    say(t('report.istqb.filing'));
    $('jira-file').disabled = true;
    const res = await send({
      type: 'UQA_JIRA_FILE',
      sessionId: window.UQAReport.sessionId,
      kind: current.kind,
      options: collectOptions(),
      projectKey: project,
      issueTypeName: type,
      epicKey: epic,
      storyKey: story,
      summary,
      body: withDefectNotes($('jira-body').value),
      fields: collectFields(),
      attach,
    });
    $('jira-file').disabled = false;
    if (!res.ok) return say(res.error, 'err');
    reportFiled(res.result);
  }

  /**
   * One press, for whichever of the seven kinds is selected.
   *
   * `quick()` below is the same idea and predates this: it files a defect with
   * the saved settings. This is that, for every kind, which is what a tester
   * filing a story or a task actually wanted; the worker resolves the issue
   * type from the project the same way the form does, so there is no second
   * issue-type map here to disagree with the one in Settings.
   *
   * The confirmation is built from what the worker says it *will* send, not
   * from what this page guesses: the page has no credentials and must not
   * learn any.
   */
  async function autoSubmit() {
    if (!window.UQAReport?.sessionId) return;
    const btn = $('auto-submit');
    const plan = await send({ type: 'UQA_JIRA_QUICK_PLAN', kind: current.kind });
    if (!plan.ok) return say(plan.error, 'err');
    const p = plan.result;
    if (!p.configured) {
      return say(t('report.istqb.notConfigured'), 'err');
    }

    const carries = [
      p.screenshots ? t('report.istqb.theScreenshots') : null,
      ...(p.formats || []).map((f) => formatLabel(f)),
    ].filter(Boolean);
    const asType = p.issueType ? t('report.istqb.asType', { type: p.issueType }) : t('report.istqb.asWhatever');
    const lines = [
      t('report.istqb.autoAsk', { kind: kindLabel(current.kind), site: p.site }),
      '',
      t('report.istqb.autoProject', { project: p.project, as: asType }),
      carries.length ? t('report.istqb.autoAttaching', { list: carries.join(', ') }) : t('report.istqb.autoNoAttachments'),
      '',
      t('report.istqb.autoLeaves'),
    ];
    if (!(await UQAFiling.ask(lines.join('\n')))) return;

    say(t('report.istqb.filing'));
    if (await fileQuick({ type: 'UQA_JIRA_QUICK', sessionId: window.UQAReport.sessionId, kind: current.kind, options: collectOptions() }, btn)) paintAutoSubmit();
  }

  /** What each export is called in a sentence a person reads before pressing. */
  const FORMAT_LABEL = {
    markdown: 'the report', sbtm: 'the session sheet', har: 'the network log',
  };

  /**
   * What has already been filed for the kind on screen.
   *
   * Per kind, because filing a defect and then switching to Story and seeing
   * "Filed QAW-12" would be a lie about the story. Read from the session, which
   * is where every filing is recorded, so it survives a reload and a restart.
   */
  async function paintAutoSubmit() {
    const row = $('auto-submit-row');
    const state = $('auto-submit-state');
    if (!row || !state) return;
    // Round 3: with no Jira, tracker or chat set up there is nothing to auto-submit to.
    row.hidden = window.UQAReport?.hasFiling === false;
    $('auto-submit').textContent = t('report.istqb.autoSubmitKind', { kind: kindLabel(current.kind) });
    state.replaceChildren();
    if (!window.UQAReport?.sessionId) return;
    const res = await send({ type: 'UQA_FILED', sessionId: window.UQAReport.sessionId });
    if (!res.ok) return;
    const mine = (res.result.filed || []).filter((f) => f.kind === current.kind && f.tracker !== 'github');
    if (!mine.length) {
      state.textContent = t('report.istqb.notFiled');
      return;
    }
    const last = mine[mine.length - 1];
    state.append(document.createTextNode(t('report.istqb.filedAs')));
    // r2-02-2: a filed record's address is data; only http(s), mailto and tel become a link, anything else is plain text.
    const href = window.UQAFiling?.safeHref(last.url) || '';
    const a = document.createElement(href ? 'a' : 'span');
    if (href) { a.href = href; a.target = '_blank'; a.rel = 'noopener'; }
    a.textContent = last.key;
    state.append(a);
    if (mine.length > 1) state.append(document.createTextNode(t('report.istqb.filedCount', { n: mine.length })));
  }

  /** One press: the saved project and type, the ISTQB evidence set. */
  async function quick() {
    if (!window.UQAReport?.sessionId || !quickCfg) return;
    if (!(await UQAFiling.ask(t('report.istqb.quickConfirm', { project: quickCfg.project, type: quickCfg.issueType })))) return;
    say(t('report.istqb.filing'));
    await fileQuick({ type: 'UQA_JIRA_QUICK', sessionId: window.UQAReport.sessionId, options: collectOptions() }, $('jira-quick'));
  }

  /**
   * Send a one-press filing. A secret in the report is answered with the report dialog's own
   * warning and its Hide it button, which sends the same message again with `redact`.
   */
  async function fileQuick(msg, btn, redact) {
    btn.disabled = true;
    const res = await send(redact ? { ...msg, redact: true } : msg);
    btn.disabled = false;
    $('secret-note')?.remove();
    if (res.code === 'SECRET_FOUND') {
      say('');
      const n = UQAFiling.secretNote(res.data?.findings || [], () => fileQuick(msg, btn, true));
      n.id = 'secret-note';
      $('file-status').after(n);
      return false;
    }
    if (!res.ok) { say(res.error, 'err'); return false; }
    reportFiled(res.result);
    return true;
  }

  /**
   * Say what happened, part by part. The issue exists either way; a failed
   * link or a refused attachment must not read as a failed filing.
   */
  function reportFiled(result) {
    const links = result.relationships || [];
    const badLinks = links.filter((l) => !l.linked);
    const files = result.attachments || [];
    const badFiles = files.filter((f) => !f.ok);
    const parts = [t('report.istqb.created', { key: result.key })];
    if (links.length) {
      parts.push(
        badLinks.length
          ? t('report.istqb.linkFailed', { list: badLinks.map((l) => `${l.to} (${l.error})`).join('; ') })
          : t('report.istqb.linked', { list: links.map((l) => l.to).join(', ') })
      );
    }
    if (files.length) {
      parts.push(
        badFiles.length
          ? t('report.istqb.filesPartial', {
              ok: files.length - badFiles.length,
              total: files.length,
              why: badFiles.map((f) => `${f.name}: ${f.error}`).join('; '),
            })
          : t(files.length === 1 ? 'report.istqb.filesOne' : 'report.istqb.filesMany', { n: files.length })
      );
    }
    const trouble = badLinks.length || badFiles.length;
    say(parts.join(' · ') + '.', trouble ? 'err' : 'ok');
    window.UQASound?.play(trouble ? 'status.warn' : 'jira.filed');
    if (!trouble) window.UQAVfx?.play('sparks', $('jira-last'));

    $('jira-last').replaceChildren();
    const href = window.UQAFiling?.safeHref(result.url) || '';
    const a = el(href ? 'a' : 'span', 'file-link', result.key);
    if (href) { a.href = href; a.target = '_blank'; a.rel = 'noopener'; }
    $('jira-last').append(document.createTextNode(t('report.istqb.filedPrefix')), a);
    window.UQAReport.lastJira = { key: result.key, url: result.url };
  }

  /* ── chat ──────────────────────────────────────────────────────────────── */

  /**
   * Say what happened where the reader is standing.
   *
   * `say()` writes into #file-status, which is a muted line in the filter bar
   * at the very top of this panel. "Post to chat" is the last control on the
   * page. So every outcome of pressing it, including the perfectly good
   * sentence the worker throws when no destination is configured, was written a
   * screen and a half above the button, and read as nothing happening at all.
   * That is the whole of the "post to chat does nothing" complaint.
   */
  function chatSay(text, tone = '') {
    const n = $('chat-status');
    if (!n) return say(text, tone);
    n.textContent = text;
    n.className = `chat-out ${tone}`.trim();
  }

  /** One line per destination, under the button, with what became of each. */
  function chatResults(results) {
    const host = $('chat-results');
    if (!host) return;
    host.replaceChildren();
    host.hidden = !results.length;
    for (const r of results) {
      const state = r.sent ? 'sent' : r.skipped ? 'skipped' : 'failed';
      const item = el('li', state);
      item.textContent = r.sent
        ? t('report.istqb.chatPosted', { label: r.label })
        : r.skipped
          ? t('report.istqb.chatSkipped', { label: r.label, why: r.skipped })
          : t('report.istqb.chatFailed', { label: r.label, error: r.error });
      host.append(item);
    }
  }

  async function post() {
    if (!window.UQAReport?.sessionId) return;
    if (!confirm(t('report.istqb.chatConfirm'))) return;
    const btn = $('chat-post');
    btn.disabled = true;
    chatSay(t('report.istqb.chatPosting'));
    chatResults([]);

    // The report is the useful link and it was never sent: the message carried
    // only a Jira key, and only when one had been filed in this same visit.
    // English, deliberately: this is a label inside the chat message, which is
    // an export body rather than part of this page.
    const links = { 'Open the report': location.href };
    if (window.UQAReport.lastJira) links[window.UQAReport.lastJira.key] = window.UQAReport.lastJira.url;

    const res = await send({
      type: 'UQA_NOTIFY',
      sessionId: window.UQAReport.sessionId,
      defectOptions: current.kind === 'defect' ? collectOptions() : null,
      links,
    });
    btn.disabled = false;
    if (!res.ok) {
      // The commonest answer by far, and the one that used to vanish: nothing
      // is configured yet. That is not a fault in the product, so it is said as
      // an instruction rather than shouted as an error.
      const nothing = /no chat destination/i.test(res.error || '');
      chatSay(res.error || t('report.post.nothing'), nothing ? '' : 'err');
      window.UQASound?.play('status.warn');
      return;
    }

    const results = res.result.results || [];
    chatResults(results);
    const sent = results.filter((r) => r.sent).length;
    const failed = results.filter((r) => r.sent === false).length;
    window.UQASound?.play(failed ? 'status.error' : 'chat.sent');
    chatSay(
      failed
        ? t('report.istqb.chatPartial', { sent, total: results.length })
        : t('report.istqb.chatDone', { destinations: t(sent === 1 ? 'report.count.destinationOne' : 'report.count.destinationMany', { n: sent }) }),
      failed ? 'err' : 'ok'
    );
  }

  /* ── boot ──────────────────────────────────────────────────────────────── */

  /**
   * Wire every control on this tab, before anything that can fail.
   *
   * This is the order that matters, not a tidiness preference. `init()` used to
   * ask the worker for the ISTQB vocabulary first and `return` when the answer
   * did not come, and the whole of the wiring was below that return: so a
   * worker that was still waking up left Connect, File, Copy and Post to chat
   * as decorative rectangles with no listener on any of them, for the life of
   * the page, with nothing on screen to say so.
   *
   * MV3 suspends the worker aggressively and a report opened from a cold start
   * lands in exactly that window. The buttons are bound first and can only be
   * bound once; whatever else fails after this, pressing one does something and
   * says something.
   */
  function wireControls() {
    $('jira-quick').addEventListener('click', quick);
    $('auto-submit').addEventListener('click', autoSubmit);
    $('tc-level').addEventListener('change', rebuild);
    $('tc-type').addEventListener('change', rebuild);
    $('jira-connect').addEventListener('click', connectJira);
    $('jira-project').addEventListener('change', onProject);
    $('jira-file').addEventListener('click', file);
    $('chat-post').addEventListener('click', post);
    $('link-search').addEventListener('input', (e) => searchTargets(e.target.value.trim()));
    $('artefact-copy').addEventListener('click', async () => {
      const text = $('jira-body').value || '';
      await navigator.clipboard.writeText(text).then(() => say(t('report.istqb.copied')), () => say(t('report.status.clipboardFailed'), 'err'));
    });
    $('gherkin-copy').addEventListener('click', async () => {
      await navigator.clipboard
        .writeText($('gherkin-copy').dataset.text || '')
        .then(() => say(t('report.istqb.gherkinCopied')), () => say(t('report.status.clipboardFailed'), 'err'));
    });
    // Rebuilding on every keystroke of the expected result would be wasteful;
    // on blur is when the text is actually finished.
    $('judgement').addEventListener('change', rebuild);
    wireKind();
    wireDraft();
  }

  /**
   * The words on this tab, drawn again in the new language.
   *
   * Registered here rather than in `report.js` because this tab is built
   * lazily: a report whose Jira tab was never opened has nothing to repaint,
   * and a listener that fired before `init()` would run against half a page.
   * The document itself is not rebuilt from a language change: it is Markdown
   * the worker wrote, and it stays what it is.
   */
  function relabel() {
    if (!vocab) return;
    if (current.kind === 'defect' && current.artefact) renderJudgement(current.artefact);
    renderAttach();
    paintAutoSubmit();
    if (jiraReady) paintTypes();
  }

  async function init() {
    wireControls();
    QAWi18n.onChange(relabel);

    const v = await send({ type: 'UQA_ISTQB_VOCAB' });
    if (v.ok) vocab = v.result;
    if (!vocab) {
      // Said out loud, in both places a reader might be looking. A tab that
      // silently declines to build itself is the thing this whole change is
      // about.
      say(t('report.istqb.vocabFailed'), 'err');
      jiraSay(t('report.istqb.vocabFailedJira'), 'err');
      return;
    }

    for (const [id, list] of [['tc-level', vocab.levels], ['tc-type', vocab.types]]) {
      const select = $(id);
      select.replaceChildren();
      for (const value of list) {
        const opt = document.createElement('option');
        opt.value = value;
        opt.textContent = value;
        select.append(opt);
      }
    }
    $('tc-level').value = 'System';
    $('tc-type').value = 'Functional';

    renderAttach();
    paintAutoSubmit();

    await rebuild();

    // Saved credentials mean the site is asked straight away — the tester came
    // here to file, not to press Connect. Without them the button stays, and
    // the line under it says where the credentials go.
    const conf = await send({ type: 'UQA_JIRA_CONFIGURED' });
    if (conf.ok && conf.result.configured) {
      quickCfg = conf.result;
      $('jira-quick').hidden = !conf.result.project;
      await connectJira();
    } else {
      jiraSay(t('report.istqb.noSite'));
    }
  }

  window.UQAIstqb = { init, rebuild, relabel };
})();
