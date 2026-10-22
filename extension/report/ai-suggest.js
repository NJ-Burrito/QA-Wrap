/* QA Wrap — local-first QA toolkit in the ISTQB shape. */
// @ts-check
/**
 * «Suggest title and steps» on the report (features-1010, S2). The button exists only while «AI writing» is on in Settings.
 * One click shows what would be sent and a rough token count; a second click («Send») asks the browser for the provider's host
 * (in that click's gesture), makes ONE request, and shows the answer labelled «suggested» beside the raw data.
 * Accept copies the (possibly edited) wording to the clipboard; Edit makes it editable; Dismiss throws it away.
 * Nothing here writes to the session, the events, the raw steps or the expected result.
 */

import { buildAiBlock } from '../core/ai-brief.js';
import { readKey } from '../platform/ai-key.js';
import { AI_SETTINGS_KEY, PROVIDERS, loadConfig, modelOf, estimateTokens, outboundText, suggest } from '../core/ai-write.js';

const ERR_KEYS = ['nokey', 'badKey', 'rate', 'credit', 'model', 'request', 'server', 'offline', 'unreadable', 'denied'];

/** The text Accept copies. */
export const suggestionText = ({ title, steps }) => [title, '', ...steps.map((s, i) => `${i + 1}. ${s}`)].join('\n').trim();

/**
 * @param {{ el: Function, t: Function, say: Function, session: any, events: () => any[] }} ctx
 * @returns {HTMLElement} a wrapper, hidden until AI writing is on
 */
export function suggestControl({ el, t, say, session, events }) {
  const wrap = el('div', 'stack ai-suggest');
  wrap.hidden = true;
  const store = () => globalThis.chrome?.storage?.local;
  const btn = el('button', 'btn btn-secondary', t('aiwrite.button'));
  btn.type = 'button';
  btn.id = 'btn-ai-suggest';
  const panel = el('div', 'stack ai-panel');
  panel.hidden = true;
  panel.setAttribute('role', 'region');
  panel.setAttribute('aria-live', 'polite');
  const top = el('div', 'hrow');
  top.append(btn);
  wrap.append(top, panel);

  const close = () => { panel.hidden = true; panel.textContent = ''; btn.disabled = false; };
  const showError = (code) => {
    panel.textContent = '';
    const key = ERR_KEYS.includes(code) ? code : 'request';
    const p = el('p', 'err', t(`aiwrite.err.${key}`));
    p.setAttribute('role', 'alert');
    const ok = el('button', 'btn btn-ghost', t('aiwrite.close'));
    ok.type = 'button';
    ok.addEventListener('click', close);
    panel.append(p, ok);
    panel.hidden = false;
    btn.disabled = false;
  };

  function showResult(res) {
    panel.textContent = '';
    const tag = el('span', 'badge badge-warn', t('aiwrite.suggested'));
    const head = el('div', 'hrow', '');
    head.append(tag, el('span', 'muted', t('aiwrite.rawKept')));
    const title = document.createElement('input');
    title.className = 'input';
    title.value = res.title;
    title.readOnly = true;
    title.setAttribute('aria-label', t('aiwrite.titleLabel'));
    const steps = document.createElement('textarea');
    steps.className = 'input';
    steps.rows = Math.min(10, Math.max(3, res.steps.length));
    steps.value = res.steps.join('\n');
    steps.readOnly = true;
    steps.setAttribute('aria-label', t('aiwrite.stepsLabel'));
    const row = el('div', 'hrow');
    const accept = el('button', 'btn btn-primary', t('aiwrite.accept'));
    const edit = el('button', 'btn btn-ghost', t('aiwrite.edit'));
    const dismiss = el('button', 'btn btn-ghost', t('aiwrite.dismiss'));
    for (const b of [accept, edit, dismiss]) b.type = 'button';
    edit.addEventListener('click', () => { title.readOnly = false; steps.readOnly = false; title.focus(); edit.disabled = true; });
    dismiss.addEventListener('click', close);
    accept.addEventListener('click', async () => {
      const text = suggestionText({ title: title.value.trim(), steps: steps.value.split('\n').map((s) => s.trim()).filter(Boolean) });
      try { await navigator.clipboard.writeText(text); say(t('aiwrite.copied'), 'ok'); close(); } catch { say(t('report.raw.copyFallback'), 'err'); }
    });
    row.append(accept, edit, dismiss);
    panel.append(head, title, steps, row);
    panel.hidden = false;
    btn.disabled = false;
  }

  btn.addEventListener('click', async () => {
    btn.disabled = true;
    const cfg = await loadConfig(store());
    const text = outboundText(buildAiBlock(session, events()));
    const p = PROVIDERS[cfg.provider];
    panel.textContent = '';
    const info = el('p', null, t('aiwrite.preview', { n: estimateTokens(text), provider: p.host, model: modelOf(cfg) }));
    const det = document.createElement('details');
    const sum = document.createElement('summary');
    sum.textContent = t('aiwrite.showText');
    const pre = el('pre', 'mono', text);
    pre.dir = 'ltr';
    det.append(sum, pre);
    const row = el('div', 'hrow');
    const send = el('button', 'btn btn-primary', t('aiwrite.send'));
    const cancel = el('button', 'btn btn-ghost', t('aiwrite.cancel'));
    send.type = 'button'; cancel.type = 'button';
    cancel.addEventListener('click', close);
    send.addEventListener('click', () => {
      send.disabled = true;
      // The permission request must be the first thing in the click: no await before it, or the gesture is gone.
      const asked = globalThis.chrome?.permissions?.request({ origins: [p.origin] });
      (async () => {
        try {
          if (!(await asked)) return showError('denied');
          panel.textContent = '';
          panel.append(el('p', 'muted', t('aiwrite.working')));
          showResult(await suggest({ provider: cfg.provider, model: cfg.model, key: await readKey(store()), block: text }));
        } catch (e) { showError(e?.code); }
      })();
    });
    row.append(send, cancel);
    panel.append(info, det, row);
    panel.hidden = false;
  });

  const paint = () => loadConfig(store()).then((c) => { wrap.hidden = !c.on; if (!c.on) close(); }, () => { wrap.hidden = true; });
  paint();
  try { globalThis.chrome?.storage?.onChanged?.addListener((ch, area) => { if (area === 'local' && ch[AI_SETTINGS_KEY]) paint(); }); } catch { /* no storage events: the button state is read once */ }
  return wrap;
}
