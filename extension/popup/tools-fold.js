/* QA Wrap — local-first QA toolkit in the ISTQB shape. */
/**
 * The tool list behind one disclosure (REQ-P1-2) and the way back from a tool (REQ-P1-12).
 */
let toolsOpen = false;
let toolsOpenTouched = false;
let toolsFoldForced = false;
let toolsObserver = null;
let toolsChosen = null; // null until storage answers; then whether the tester ever opened or closed the fold themselves
chrome.storage.local.get('toolsOpen').then((r) => {
  toolsOpen = r?.toolsOpen === true;
  toolsChosen = r?.toolsOpen !== undefined;
  const fold = document.getElementById('tools-fold');
  if (fold && !toolsOpenTouched) fold.open = toolsOpen;
  fillToolsRoom();
}).catch(() => {});

/**
 * The room the sheet has beneath the list goes to the list (1015, owner: "the Tools list must grow to fill down to Stop & review").
 * Closed, the fold leaves the favourites and one "All tools" line, and a taller window, or an Asleep card that has shrunk, left a blank band
 * above the strip. A tester who never chose gets the fold opened while at least a row of that band is free: the list then fills to the
 * strip and scrolls inside itself. It only ever opens (a later shrink just scrolls), never writes the choice to storage (`toolsFoldForced`),
 * and never fights a tester who opened or closed it (`toolsChosen`). Nothing above the fold moves, so Autopilot rule 7 holds.
 */
function fillToolsRoom() {
  const fold = document.getElementById('tools-fold');
  const sheet = document.getElementById('tool-sheet');
  if (!fold || !sheet || fold.open || toolsChosen !== false || toolsOpenTouched) return;
  if (sheet.getBoundingClientRect().bottom - fold.getBoundingClientRect().bottom < 32) return;
  toolsFoldForced = true;
  fold.open = true;
}

/** The "Back to session" row of one open tool row; created once per row, text refreshed on every language paint. */
function ensureBackRow(row) {
  const help = row.querySelector('.tool-help');
  if (!help) return;
  let back = help.querySelector(':scope > .back-to-session');
  if (!back) {
    back = document.createElement('button');
    back.type = 'button';
    back.className = 'back-to-session';
    const label = document.createElement('span');
    label.className = 'back-label';
    const timer = document.createElement('span');
    timer.className = 'timer back-timer';
    timer.dataset.live = '';
    back.append(label, timer);
    back.addEventListener('click', () => {
      closeToolPanels();
      document.getElementById('session')?.scrollIntoView({ block: 'start' });
      (document.getElementById('stop')?.offsetParent ? document.getElementById('stop') : document.getElementById('start'))?.focus();
    });
    help.prepend(back);
  }
  back.querySelector('.back-label').replaceChildren(icon('back'), ` ${t('popup.tools.backToSession')}`); // the project's mirrored arrow, not a text glyph
  paintBackTimer();
}

/** The session clock inside every Back row; hidden when nothing is recording. */
function paintBackTimer(startedAt = state?.session?.startedAt) {
  const live = !!state?.recording && !!startedAt;
  for (const timer of document.querySelectorAll('.back-to-session .back-timer')) {
    timer.hidden = !live;
    if (live) timer.textContent = fmtElapsed(startedAt);
  }
}

function foldTools(host) {
  if (!host || host.querySelector('#tools-fold')) return;
  const groups = [...host.querySelectorAll(':scope > .activity')];
  if (!groups.length) return;
  const fold = document.createElement('details');
  fold.id = 'tools-fold';
  fold.className = 'tools-fold';
  const summary = document.createElement('summary');
  summary.textContent = t('popup.tools.allTools');
  fold.append(summary, ...groups);
  fold.open = toolsOpen;
  fold.addEventListener('toggle', () => {
    if (toolsFoldForced) { toolsFoldForced = false; return; }
    toolsOpenTouched = true;
    toolsOpen = fold.open;
    chrome.storage.local.set({ toolsOpen }).catch(() => {});
  });
  host.append(fold);
  new ResizeObserver(fillToolsRoom).observe(document.getElementById('tool-sheet') || host);
  fillToolsRoom();
  if (!toolsObserver) {
    toolsObserver = new MutationObserver(() => {
      for (const row of host.querySelectorAll('.tool-row.is-open')) {
        const f = document.getElementById('tools-fold');
        if (f && !f.open && f.contains(row)) { toolsFoldForced = true; f.open = true; }
        ensureBackRow(row);
      }
    });
    toolsObserver.observe(host, { subtree: true, attributes: true, attributeFilter: ['class'] });
  }
}
