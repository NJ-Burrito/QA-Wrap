/* QA Wrap — popup: the master switch, site access, recording state and rules (split from popup.js; classic script, same global scope). */
/**
 * The master switch.
 *
 * Everything else in this popup is disabled while it is off, rather than
 * failing when pressed: a control that looks available and then refuses is a
 * worse experience than one that plainly is not available yet. Arming is per
 * browser window, so the note says which — a tester with the app in one window
 * and their email in another has only armed the first.
 */
let awake = false;

/**
 * How many *other* windows were armed the last time the worker said.
 *
 * Remembered because the optimistic paint below has to write the note line
 * before the worker has answered, and "3 other windows too" going briefly blank
 * on the way to being repainted with the same number is a flicker carrying no
 * information at all.
 */
let otherArmedWindows = 0;

/**
 * Which question about the switch is the current one.
 *
 * Answers arrive out of order, and one of them repainted a window that had just
 * been put to sleep. Sleep does real work: `sleepWindow()` stops the clip and
 * the session on the way down, and each of those broadcasts
 * `UQA_STATE_CHANGED` **while the window is still armed**. The popup answers
 * every broadcast with `refresh()`, so a `UQA_POPUP_STATE` snapshot taken
 * mid-sleep — `armed: true`, quite correctly for the moment it was taken — is
 * already in flight when `UQA_DISARM` replies. If it lands last it repaints
 * `data-awake="true"` over a window that is asleep.
 *
 * So each asynchronous read takes a ticket before it asks, and a ticket that is
 * no longer the newest is an answer about a world that has since moved. It is
 * dropped rather than painted. `paintSwitchState` is the only writer of the
 * switch, so it is the only place that needs to know.
 */
let armedGen = 0;
const armedTicket = () => ++armedGen;

/**
 * Minutes, in a unit somebody can picture.
 *
 * The panel read "Room for roughly 41420 minutes of video", which is a number a
 * viewer has to do arithmetic on before it means anything. Same rule and same
 * thresholds as `options/options.js`, and local rather than imported: this is a
 * classic script sharing a global with `ui/*.js`, and the name is unique across
 * every script `popup.html` loads.
 */
function spanOf(minutes) {
  const m = Math.max(0, Math.round(minutes || 0));
  if (m < 90) return plural(m, 'popup.count.minuteOne', 'popup.count.minuteMany');
  const hours = m / 60;
  return hours < 48
    ? plural(Math.round(hours), 'popup.count.hourOne', 'popup.count.hourMany')
    : plural(Math.round(hours / 24), 'popup.count.dayOne', 'popup.count.dayMany');
}

/**
 * The switch, painted from a decision rather than from an answer.
 *
 * Split out of `paintSwitchNow()` so a press can draw Awake/Asleep — and enable
 * or disable every control under it — in the same tick as the click, before
 * `UQA_ARM` has been anywhere. Synchronous on purpose: an `await` here, even one
 * that resolves immediately, would put the paint a microtask after the gesture
 * and hand back exactly the lag this exists to remove.
 *
 * `gen` defaults to a ticket taken now, so a caller that already knows the
 * truth — the optimistic paint, the revert, the settle — is always the newest.
 */
function paintSwitchState(isAwake, others = otherArmedWindows, gen = armedTicket()) {
  if (gen !== armedGen) return;
  awake = !!isAwake;
  otherArmedWindows = others;

  $('switch-title').textContent = t(awake ? 'popup.switch.awake' : 'popup.switch.asleep');
  $('switch').setAttribute('aria-checked', String(awake));
  // The press plays the sound of the way it goes: the click sound is read from this attribute, before the handler flips the state.
  $('switch').dataset.sound = awake ? 'switch.sleep' : 'switch.wake';

  gateControls();
  document.body.dataset.awake = String(awake);
  paintPrimary();
}

/**
 * Every control the switch owns, locked or unlocked from the switch's answer.
 *
 * Disabled, not hidden: a tester needs to see what they would get, and the
 * explanations stay readable either way — reading about a tool is exactly what
 * someone does before deciding to wake it.
 *
 * Called from `renderTools()` as well as from the paint, because the tool rows
 * are stamped fresh on every render and a fresh button is an *enabled* button.
 * Switching Simple to Expert while the window was asleep used to hand back
 * nineteen live tools; `tools/clickthrough.mjs` asks the question in both modes
 * now, which is how that was found.
 */
function gateControls() {
  document.querySelectorAll('[data-action], .fav-run, #start, #break-arm, #note-text, #charter, #stop').forEach((control) => {
    // A control this browser cannot run stays disabled whatever the switch
    // says. Waking up does not add an API.
    const tile = control.matches('[data-action], .fav-run'); // 1011 B1: a tool is never disabled for sleeping; pressing it wakes this site, then runs
    if (tile) control.dataset.asleep = String(!awake); control.disabled = (!awake && control.id !== 'start' && !tile) || control.dataset.unavailable === 'true'; // #start asks, wakes and starts in one press
  }); paintStartLabel();
}

/**
 * Where QA Wrap is allowed, as the popup last heard it.
 *
 * Held in a module variable and refreshed by `paintSiteAccess()` because the
 * wake click handler may not await anything before it calls
 * `chrome.permissions.request` — Chrome refuses a request that is not made in
 * a live user gesture, and a single `await` before it spends the gesture. So
 * the answer the press needs has to be already on hand when the press arrives,
 * which means it is read at boot and after every grant rather than inside the
 * handler.
 *
 * `pattern: null` means a page no grant could cover: a `chrome://` tab, the
 * Web Store, the extension's own pages. Nothing is asked for there.
 */
let siteAccess = { pattern: null, granted: false, origins: [], policy: 'ask' };

async function paintSiteAccessNow(known) {
  const res = known ? { ok: true, result: known } : await send({ type: 'UQA_SITE_ACCESS' });
  if (res.ok) siteAccess = { ...siteAccess, ...res.result };
  // S7 §4.7: the same fact, promoted to the banner above the session card.
  paintBanner(); paintRemember(); globalThis.paintBuffer?.();
}

var paintSiteAccess = safe(paintSiteAccessNow, 'paintSiteAccess');

/**
 * Ask for a site, from inside the gesture that asked for it.
 *
 * Returns the promise `chrome.permissions.request` gave back, or `null` when
 * there is nothing to ask for. **Called synchronously by a click handler**:
 * everything else about the press can wait, and this cannot.
 *
 * `hostPermissionsPolicy` decides what one press means. `all` is a team whose
 * administrator would rather one prompt covered every internal application
 * than a tester answered a prompt per host; `none` removes the request, and the
 * card says so rather than showing a button that Chrome would refuse.
 */
function requestSite(wanted = siteAccess.pattern) {
  if (!wanted || siteAccess.policy === 'none') return null;
  const ask = siteAccess.policy === 'all' ? '<all_urls>' : wanted;
  try {
    return chrome.permissions.request({ origins: [ask] });
  } catch {
    return null;
  }
}

/** Tell the worker, so the page in front of the tester gets the scripts now. */
async function siteGranted() {
  await send({ type: 'UQA_SITE_GRANTED', ...(ctx.windowId != null ? { windowId: ctx.windowId } : {}) });
  await paintSiteAccess();
}

async function paintSwitchNow(known, gen = armedTicket()) {
  // Named, always. Asked with no window id at all, the worker answers about
  // whichever window the *sender* is in — which in the floating surface is the
  // float itself, never armed, so every wake was repainted as "Asleep" a beat
  // later. `ctx.windowId` is the window under test in all three surfaces.
  const res = known && known.armed != null // null: ask again
    ? { ok: true, result: known }
    : await send({ type: 'UQA_ARMED', ...(ctx.windowId != null ? { windowId: ctx.windowId } : {}) });
  const on = !!(res.ok && res.result.armed);
  const others = res.ok ? (res.result.windows || []).filter((w) => w !== res.result.windowId).length : 0;
  paintSwitchState(on, others, gen);
}

var paintSwitch = safe(paintSwitchNow, 'paintSwitch');

document.getElementById('switch').addEventListener('click', async () => {
  // Which way the press goes, decided once and read by all three phases, so the
  // paint, the message and the revert cannot disagree about it.
  const wanted = !awake;
  const card = $('switch-card');

  /*
   * The site is asked for here, on the first line of the handler, and nowhere
   * else.
   *
   * `chrome.permissions.request` is refused unless it is called while a user
   * gesture is live, and a gesture is spent by the first `await`. Everything
   * below this line awaits something — the optimistic paint's dispatch, the
   * context resolve, the message to the worker — so the request has to be
   * *issued* before any of it and *waited for* inside the dispatch.
   *
   * Which is why `siteAccess` is read at boot rather than here: the handler
   * cannot afford to ask the worker what to ask Chrome for.
   *
   * QA Wrap's popup is a float window or the side panel, never a browser-action
   * popup (`background/service-worker.js`, `action.onClicked`), so it survives
   * the permission bubble taking focus. A real popup would not, which is the
   * measured reason the microphone and screen grants live in Settings and are
   * written up over the Permissions section of `options/options.html`.
   */
  const asking = wanted && !siteAccess.granted ? requestSite() : null;
  // An administrator's "not this site" is said when the switch is pressed, since the card no longer carries a line about it.
  const blocked = wanted && !siteAccess.granted && !!siteAccess.pattern && siteAccess.policy === 'none';

  await optimistic(
    (pending) => {
      const before = awake;
      const others = otherArmedWindows;
      paintSwitchState(wanted);
      pending(card);
      return () => paintSwitchState(before, others);
    },
    async () => {
      // The answer to the bubble, awaited now that the gesture has done its
      // work. A refusal is a decision, not a fault: nothing is armed, the card
      // reverts, and the sentence names the press that would change it.
      if (blocked) return { ok: false, error: tf('popup.access.adminBlocked', 'An administrator has decided: not this site.') };
      if (asking) {
        const allowed = await asking.catch(() => false);
        if (!allowed) return { ok: false, error: notAllowed() };
        await siteGranted();
      }
      // Named for every surface, not only the float. Arming with the page's
      // window and then asking about the sender's is how the switch could flap:
      // the two messages were about two different windows. One resolved
      // context, one window id, both directions.
      //
      // Resolved *here*, after the paint, and that is the whole point.
      // `resolveCtx()` asks the worker which tab is under test — it is a round
      // trip of its own, and it used to sit between the click and the first
      // pixel. Waking a window against a worker Chrome had just killed left the
      // switch reading "Asleep" for as long as the worker took to start.
      await resolveCtx();
      return send({
        type: wanted ? 'UQA_ARM' : 'UQA_DISARM',
        ...(ctx.windowId != null ? { windowId: ctx.windowId } : {}),
      });
    },
    {
      settle: async (res) => {
        // The worker's own answer, not a second round trip: `UQA_ARM` and
        // `UQA_DISARM` both reply in exactly the shape `paintSwitch()` reads,
        // so the truth lands here even when it disagrees with the guess — a
        // window another surface had already armed, say.
        await paintSwitch(res.result);
        // The access line is repainted with the switch, because a wake is the
        // press that changes it: this is where "will ask to allow this site"
        // becomes "Allowed on this site".
        await paintSiteAccess();
        // Both English sentences stay beside their keys: tools/test-optimistic.mjs
        // reads them here, because a suite waits for them on #status after the
        // settle.
        // r1-09-3: sleep stops and saves a running session or clip (sleepWindow), and the reply names which.
        const slept = res.result?.stopped;
        say(
          awake
            ? tf('popup.switch.saidAwake', 'Awake in this window. Every tab here is covered. Other windows stay asleep.')
            : slept?.session
              ? tf('popup.switch.saidAsleepStopped', 'Back to sleep. The running session was stopped and saved.')
              : slept?.clip
                ? tf('popup.switch.saidAsleepClip', 'Back to sleep. The running recording was stopped and saved.')
                : tf('popup.switch.saidAsleep', 'Back to sleep. Nothing is being watched.'),
          'ok'
        );
        // Sleep is not a flag any more: the worker stops the running clip and
        // the running session on the way down. So the settled state can include
        // a session card that was live a moment ago and is the stopped one now,
        // and only `UQA_POPUP_STATE` knows that.
        refresh();
      },
    }
  ).then((res) => res?.ok === false && paintSwitch()); // show the worker's truth
});

/**
 * The recording button says what it will do, and the line under it says how much
 * room is left. A recording that dies at 100% disk with no warning is the worst
 * possible failure for something you cannot repeat, so the number is on screen
 * before it starts rather than in an error afterwards.
 */
let lastCapture = null;
let lastRoom = null;

async function paintRecordingNow(knownCapture, knownRoom) {
  const btn = document.getElementById('record-tool');
  if (!btn) {
    // No Record row drawn here, but the disk warning still belongs on screen.
    const dw0 = document.getElementById('disk-warn');
    if (dw0) dw0.hidden = !(await send({ type: 'UQA_RECORD_STATE' }).then((r) => r.ok && r.result?.recording && r.result?.diskWarn).catch(() => false));
    return;
  }
  // The row that owns the panel, asked once. In Simple mode the Record row is
  // drawn and so is its panel; in a surface or a mode that does not draw it,
  // `panel` is null and every read below is a no-op instead of a TypeError.
  const panel = panelFor('record');
  const [state, room] = knownCapture
    ? [{ ok: true, result: knownCapture }, { ok: !!knownRoom, result: knownRoom }]
    : await Promise.all([send({ type: 'UQA_RECORD_STATE' }), send({ type: 'UQA_STORAGE' })]);
  const recording = state.ok && state.result?.recording;
  if (recording) uqaSound()?.configure({ suspended: true }); // a popup opened mid-clip stays silent too
  // Remembered so the clip clock can repaint without asking again. See
  // clipTicker.
  lastCapture = state.ok ? state.result : null;
  lastRoom = room.ok ? room.result : null;
  const dw = document.getElementById('disk-warn');
  if (dw) dw.hidden = !(recording && state.result?.diskWarn);
  window.UQAVfx?.state('glow', btn, recording);

  // `.tool-name`, not the first span: the row now starts with the icon, so
  // querySelector('span') overwrote the icon with the label and drew the words
  // twice, one set on top of the other.
  btn.querySelector('.tool-name').textContent = recording
    ? t('popup.record.stop')
    : tf('tools.record.label', 'Record the screen');
  /*
   * Lock the whole panel, not one row of it.
   *
   * This used to lock `#capture-row`, which holds the mic/sound/webcam chips.
   * The scope radios - "This tab" against "Window or screen" - live in the
   * panel ABOVE that row, so the single control that most obviously cannot
   * change mid-clip was the only one left live. Flipping it did nothing to the
   * running recording and silently changed what the next press would do, while
   * the button underneath still read "Stop recording".
   *
   * Scoping to the panel means a control added later is covered by default,
   * which is the failure that happened here: the rule was right and the
   * selector was one element too narrow.
   */
  panel?.querySelectorAll('input').forEach((i) => (i.disabled = !!recording));

  // A device the browser has refused is not a choice, and a tick that cannot
  // do anything is worse than no tick: the clip comes out silent and the
  // recording panel said it would not be. Asked once per paint, and it never
  // fights the recording lock above.
  if (!recording) paintMediaPermissions(panel);
  if (!recording) paintGrantButton();

  /*
   * And show the scope actually being filmed.
   *
   * The offscreen document reports it in `sources`, so a popup reopened during
   * a clip can tell the truth instead of showing whatever the radio was left
   * on. Without this the panel could say "This tab" over a screen recording.
   */
  if (recording) {
    const filming = state.result?.sources?.screen ? 'screen' : 'tab';
    const radio = panel?.querySelector(`input[name="rec-scope"][value="${filming}"]`);
    if (radio) radio.checked = true;
    // Remembered too, so the next render stamps the panel showing the same
    // truth rather than resetting to "This tab" mid-clip.
    scopes['rec-scope'] = filming;
  }
  btn.setAttribute('aria-pressed', String(recording));
  btn.classList.toggle('is-recording', !!recording);

  const line = panel?.querySelector('#record-state');
  if (!line) return;
  const r = room.ok ? room.result : null;
  if (recording) {
    const since = state.result.startedAt ? Math.round((Date.now() - state.result.startedAt) / 1000) : 0;
    line.hidden = false;
    line.textContent = t('popup.record.since', { m: Math.floor(since / 60), s: since % 60 }) +
      (r?.minutesOfVideo != null ? t('popup.record.roomMore', { span: spanOf(r.minutesOfVideo) }) : '');
    line.className = 'fine armed';
  } else if (r?.low) {
    line.hidden = false;
    line.textContent = t('popup.record.lowRoom', { mb: Math.round(r.free / 1024 / 1024) });
    line.className = 'fine err';
  } else if (r?.minutesOfVideo != null) {
    line.hidden = false;
    line.textContent = t('popup.record.room', { span: spanOf(r.minutesOfVideo) });
    line.className = 'fine';
  } else {
    line.hidden = true;
  }
}

// `var`, not `const`: a top-level `function` declaration puts itself on the
// window, and tools/clickthrough.mjs drives `window.paintRecording()` directly
// to reach a mid-recording state no script can start. A `const` would be a
// lexical binding the harness cannot see; `var` keeps the property.
var paintRecording = safe(paintRecordingNow, 'paintRecording');

/**
 * Rules stack, so all of them are listed.
 *
 * The old version armed one rule under a fixed id and showed only the first, so
 * arming a second silently replaced the first and the tester had no way to tell.
 * Each rule now has its own countdown, its own row, and its own remove button —
 * and all of them belong to this session, so starting another clears the lot.
 */
async function refreshRuleStateNow(known) {
  const res = known ? { ok: true, result: known } : await send({ type: 'UQA_GET_RULES' });
  const rules = (res.ok ? res.result : []) || [];
  const live = rules.filter((r) => r.enabled !== false && (r.remaining == null || r.remaining > 0));
  const spent = rules.filter((r) => r.remaining != null && r.remaining <= 0);

  // `stateLine`, not `el`. Named `el` this shadowed the module-level `el()`
  // element helper for the whole function body, so the first person to build a
  // row in here would have called a paragraph.
  const stateLine = $('break-state');
  const host = $('rule-list');
  if (!stateLine || !host) return;

  if (!rules.length) {
    stateLine.textContent = t('popup.break.noRule');
    stateLine.className = 'rule-state';
  } else {
    stateLine.textContent =
      t('popup.break.armedCount', { n: live.length }) +
      (spent.length ? t('popup.break.spentCount', { n: spent.length }) : '') +
      t('popup.break.armedTail');
    stateLine.className = live.length ? 'rule-state armed' : 'rule-state';
  }

  host.replaceChildren();
  for (const r of rules) {
    const row = document.createElement('div');
    row.className = spent.includes(r) ? 'rule-row is-spent' : 'rule-row';

    const text = document.createElement('div');
    const scope = r.pattern ? t('popup.rule.onPattern', { pattern: r.pattern }) : t('popup.rule.everyRequest');
    const extra = r.redirectTo
      ? ` › ${r.redirectTo}`
      : r.headers
        ? ` (${Object.entries(r.headers).map(([k, v]) => (v === null ? t('popup.rule.headerRemoved', { name: k }) : `${k}: ${v}`)).join(', ')})`
        : '';
    const strong = document.createElement('strong');
    strong.textContent = `${r.label}${extra}`;
    const small = document.createElement('em');
    small.textContent = t('popup.rule.line', {
      scope,
      left: r.remaining == null
        ? t('popup.rule.untilOff')
        : r.remaining > 0
          ? t('popup.rule.left', { n: r.remaining })
          : t('popup.rule.spent'),
    });
    text.append(strong, small);

    const drop = document.createElement('button');
    drop.type = 'button';
    drop.className = 'rule-drop';
    drop.textContent = '×';
    drop.title = t('popup.rule.remove');
    drop.addEventListener('click', async () => {
      await send({ type: 'UQA_DROP_RULE', id: r.id });
      refreshRuleState();
    });

    row.append(text, drop);
    host.append(row);
  }
}

var refreshRuleState = safe(refreshRuleStateNow, 'refreshRuleState');

$('break-arm').addEventListener('click', async () => {
  const key = $('break-preset').value;
  const preset = PRESETS[key];
  const count = Number($('break-count').value);
  const delayMs = Number($('break-delay').value);

  // The preset's English is the source of record in PRESETS above; the label
  // stored on the rule is the one the tester read when they armed it, so the
  // rule list and the status line agree with the dropdown they pressed.
  const presetLabel = tf(`popup.break.preset${key.charAt(0).toUpperCase()}${key.slice(1)}`, preset.label);
  const rule = {
    label: preset.action === 'delay' ? t('popup.break.slowFor', { label: presetLabel, s: (delayMs / 1000).toFixed(1) }) : presetLabel,
    enabled: true,
    pattern: $('break-pattern').value.trim(),
    method: 'ANY',
    action: preset.action,
    status: preset.status,
    body: preset.body,
    delayMs: preset.action === 'delay' ? delayMs : undefined,
    contentType: 'application/json',
    remaining: count === 0 ? null : count,
  };

  if (key === 'redirect') {
    const to = $('break-redirect').value.trim();
    if (!to) return say(t('popup.break.needDestination'), 'err');
    rule.redirectTo = to;
    rule.label = t('popup.break.redirectedTo', { to });
  }

  if (key === 'header' || key === 'noauth') {
    const name = key === 'noauth' ? 'Authorization' : $('break-header-name').value.trim();
    if (!name) return say(t('popup.break.needHeader'), 'err');
    // An empty value means remove: the point of the preset is to find out what
    // the app does when a header it assumes is present simply is not.
    const value = key === 'noauth' ? null : $('break-header-value').value.trim() || null;
    rule.headers = { [name]: value };
    rule.label = value === null ? t('popup.break.removedHeader', { name }) : t('popup.break.setHeader', { name, value });
  }

  // Added, not set: arming a second rule must not silently drop the first.
  const res = await send({ type: 'UQA_ADD_RULE', rule });
  window.UQASound?.play(res.ok ? 'rule.armed' : 'status.error');
  if (!res.ok) return say(res.error, 'err');
  const live = (res.result || []).filter((r) => r.enabled !== false && (r.remaining == null || r.remaining > 0)).length;
  say(
    t('popup.break.armed', {
      label: rule.label,
      rules: plural(live, 'popup.count.ruleOne', 'popup.count.ruleMany'),
    }),
    'ok'
  );
  refreshRuleState();
});

/*
 * E13: stop the breaking, without reloading and without losing the evidence.
 *
 * Nader asked for "a button that clears the effect without reloading the page
 * and without clearing the data stored from the broken request". Both halves
 * were already true and neither was said, which is the same as neither being
 * true: the button read "Clear all", which in a tool full of sessions and
 * exports sounds like it might clear those too, so the safe move was to reload
 * the page instead and lose the state that had taken ten minutes to reach.
 *
 * Nothing here reloads anything. The rules come off the network layer, so the
 * next request the page makes goes through normally, and every failure the
 * armed rules already produced stays in the session exactly as it was: it is
 * evidence, and it is the reason the rule was armed in the first place.
 */
$('break-clear').addEventListener('click', async () => {
  const before = await send({ type: 'UQA_GET_RULES' });
  const armed = ((before.ok ? before.result : []) || []).length;
  const res = await send({ type: 'UQA_SET_RULES', rules: [] });
  if (!res.ok) return say(res.error, 'err');
  // The English stays beside the key: tools/test-tool-cards.mjs reads this
  // handler for the promise that the evidence is still there, which is E13.
  say(
    armed
      ? tf(
        'popup.break.cleared',
        `${plural(armed, 'popup.count.ruleOne', 'popup.count.ruleMany')} taken off. Evidence stays.`,
        { rules: plural(armed, 'popup.count.ruleOne', 'popup.count.ruleMany') }
      )
      : t('popup.break.clearedNone'),
    'ok'
  );
  refreshRuleState();
});
