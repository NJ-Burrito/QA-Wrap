/* QA Wrap — local-first QA toolkit in the ISTQB shape. */
/**
 * The diagram editor.
 *
 * The page is a model (`flow`) and a renderer (`flowToSvg`). Every edit —
 * a drag, a new box, a recoloured arrow — changes the model and redraws the
 * SVG whole, which at this size costs a millisecond and keeps one truth:
 * the file you save is exactly what you see, because it is the same call.
 *
 * What is fixed: the A4 landscape sheet, the left-to-right flow, the Arabic
 * inside the boxes, the legend built from what is on the page. What is free:
 * where every box sits, what it says, what shape and colour it has, which
 * arrows exist and of what kind.
 */
import { buildFlow, flowToSvg, layout, KINDS, EDGES, PALETTE, A4, MM } from '../core/flow.js';
import * as keys from './keys.js';

await QAWi18n.ready();

const $ = (id) => document.getElementById(id);
const t = (k, v) => QAWi18n.t(k, v);

QAWi18n.onChange(() => {
  QAWi18n.apply();
  if (flow) render();
});
const params = new URLSearchParams(location.search);
const sessionId = params.get('session');

let session = null;
let events = [];
let flow = null;
let lockup = '';
let selected = null; // { type: 'node'|'edge', id }
let connecting = null; // { from } while drawing an arrow
let history = [];

const say = (text, tone = '') => { const el = $('status'); el.textContent = text; el.className = `status ${tone}`; window.UQAVfx?.status(el, tone); };
const send = (msg) => new Promise((resolve) => chrome.runtime.sendMessage(msg, (res) => { void chrome.runtime.lastError; resolve(res); }));
const snap = keys.snap;
let rest = null; // the one stop in the Tab order (roving tabindex)

/* ── history ─────────────────────────────────────────────────────────── */
function remember() {
  history.push(JSON.stringify({ nodes: flow.nodes, edges: flow.edges }));
  if (history.length > 40) history.shift();
}
function undo() {
  const last = history.pop();
  if (!last) return say(t('diagram.status.nothingToUndo'));
  const { nodes, edges } = JSON.parse(last);
  flow.nodes = nodes; flow.edges = edges;
  selected = null;
  render();
  say(t('diagram.status.undone'));
}

/* ── rendering ───────────────────────────────────────────────────────── */
function render() {
  const sheet = $('sheet');
  const had = sheet.contains(document.activeElement) ? stopOf(document.activeElement) : null;
  sheet.innerHTML = flowToSvg(flow, { lockup, interactive: true });
  const svg = sheet.querySelector('svg');
  svg.removeAttribute('width'); svg.removeAttribute('height');
  if (selected) sheet.querySelector(`[data-${selected.type}="${selected.id}"]`)?.classList.add('selected');
  arrange(had);
  fit();
  paintInspector();
}

/* ── the keyboard: one roving group of boxes and arrows (D-1010-178) ──── */
const stopOf = (el) => { const g = el?.closest?.('[data-node],[data-edge]'); return g ? { type: g.dataset.node ? 'node' : 'edge', id: g.dataset.node || g.dataset.edge } : null; };
const stopEl = (s) => s && $('sheet').querySelector(`[data-${s.type}="${s.id}"]`);
const lang = () => (QAWi18n.lang() === 'ar' ? 'ar' : 'en');
const plain = (v) => String(v ?? '').replace(/\s+/g, ' ').trim();
const nodeName = (nd) => plain(lang() === 'ar' ? nd.ar || nd.en : nd.en || nd.ar) || nd.id;
const nameOf = (id) => { const nd = flow.nodes.find((x) => x.id === id); return nd ? nodeName(nd) : id; };
const stopName = (s) => {
  if (s.type === 'node') return nameOf(s.id);
  const e = flow.edges.find((x) => x.id === s.id);
  return e ? t('diagram.a11y.edge', { from: nameOf(e.from), to: nameOf(e.to) }) : s.id;
};

/** Roles, names and the one Tab stop; focus comes back to what had it before the redraw. */
function arrange(had) {
  const sheet = $('sheet');
  sheet.setAttribute('role', 'group');
  sheet.setAttribute('aria-label', t('diagram.a11y.sheet'));
  rest = keys.restStop(flow, rest);
  for (const g of sheet.querySelectorAll('[data-node],[data-edge]')) {
    const s = stopOf(g);
    const nd = s.type === 'node' && flow.nodes.find((x) => x.id === s.id);
    if (s.type === 'edge' && !g.querySelector('.edge-hit')) { // 1011 B2: a 2 px line is not pressable; a wide invisible stroke on the same path is, and stays over the grid
      const line = g.querySelector('path');
      const hit = line.cloneNode(false);
      hit.removeAttribute('marker-end'); hit.removeAttribute('stroke-dasharray');
      hit.setAttribute('class', 'edge-hit'); hit.setAttribute('stroke', 'transparent'); hit.setAttribute('stroke-width', '18'); hit.setAttribute('pointer-events', 'stroke');
      g.append(hit);
    }
    g.setAttribute('role', 'button');
    g.setAttribute('tabindex', keys.same(s, rest) ? '0' : '-1');
    g.setAttribute('aria-pressed', String(keys.same(s, selected)));
    g.setAttribute('aria-label', nd ? t('diagram.a11y.node', { kind: lang() === 'ar' ? KINDS[nd.kind]?.ar : KINDS[nd.kind]?.en, label: nodeName(nd) }) : stopName(s));
  }
  if (had) (stopEl(had) || stopEl(rest))?.focus({ preventScroll: true });
}

function fit() {
  const wrap = $('sheet-wrap');
  const scale = Math.min(1, (wrap.clientWidth - 32) / A4.w);
  $('sheet').style.transform = `scale(${scale})`;
  wrap.style.height = `${A4.h * scale + 32}px`;
}
addEventListener('resize', fit);

/* ── selection and the inspector ─────────────────────────────────────── */
function select(type, id) {
  selected = type ? { type, id } : null;
  render();
}

function paintInspector() {
  const box = $('inspector');
  if (!selected) return (box.hidden = true);
  box.hidden = false;
  if (selected.type === 'node') {
    const nd = flow.nodes.find((x) => x.id === selected.id);
    if (!nd) return (box.hidden = true);
    $('inspector-title').textContent = t('diagram.inspector.boxTitle', { kind: KINDS[nd.kind]?.en || nd.kind });
    $('sel-ar').value = nd.ar || '';
    $('sel-en').value = nd.en || '';
    $('sel-kind').value = nd.kind;
    $('sel-kind-field').hidden = false;
    $('sel-edge-field').hidden = true;
    $('sel-label-field').hidden = true;
    $('sel-en').parentElement.hidden = false;
    paintSwatches(nd.fill || KINDS[nd.kind]?.fill);
  } else {
    const e = flow.edges.find((x) => x.id === selected.id);
    if (!e) return (box.hidden = true);
    $('inspector-title').textContent = t('diagram.inspector.arrowTitle', { kind: EDGES[e.kind]?.en || e.kind });
    $('sel-ar').value = '';
    $('sel-ar').parentElement.hidden = true;
    $('sel-en').parentElement.hidden = true;
    $('sel-kind-field').hidden = true;
    $('sel-edge-field').hidden = false;
    $('sel-edge-kind').value = e.kind;
    $('sel-label-field').hidden = false;
    $('sel-label').value = e.label || '';
    paintSwatches(null);
  }
  if (selected.type === 'node') $('sel-ar').parentElement.hidden = false;
}

function paintSwatches(current) {
  const host = $('sel-colours');
  host.replaceChildren();
  if (selected?.type !== 'node') { host.parentElement.hidden = true; return; }
  host.parentElement.hidden = false;
  for (const [name, hex] of Object.entries(PALETTE)) {
    if (['line', 'band'].includes(name)) continue;
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'swatch';
    b.style.background = hex;
    b.title = name;
    b.setAttribute('aria-label', `${name} ${hex}`);
    b.setAttribute('aria-pressed', String(current === hex));
    b.addEventListener('click', () => {
      const nd = flow.nodes.find((x) => x.id === selected.id);
      remember();
      nd.fill = hex;
      nd.ink = ['petra', 'basalt', 'guac', 'wadirum', 'slate'].includes(name) ? '#FFFFFF' : PALETTE.basalt;
      nd.stroke = ['paper', 'limestone'].includes(name) ? PALETTE.slate : hex;
      render();
      window.UQASound?.play('ui.choose');
    });
    host.append(b);
  }
}

function wireInspector() {
  const nodeOf = () => flow.nodes.find((x) => x.id === selected?.id);
  const edgeOf = () => flow.edges.find((x) => x.id === selected?.id);
  $('sel-ar').addEventListener('input', () => { const nd = nodeOf(); if (nd) { nd.ar = $('sel-ar').value; softRender(); } });
  $('sel-en').addEventListener('input', () => { const nd = nodeOf(); if (nd) { nd.en = $('sel-en').value; softRender(); } });
  $('sel-ar').addEventListener('change', remember);
  $('sel-en').addEventListener('change', remember);
  $('sel-kind').addEventListener('change', () => { const nd = nodeOf(); if (!nd) return; remember(); nd.kind = $('sel-kind').value; delete nd.fill; delete nd.ink; delete nd.stroke; render(); window.UQASound?.play('ui.choose'); });
  $('sel-edge-kind').addEventListener('change', () => { const e = edgeOf(); if (!e) return; remember(); e.kind = $('sel-edge-kind').value; if (!e.label && e.kind === 'yes') e.label = 'نعم'; if (!e.label && e.kind === 'no') e.label = 'لا'; render(); });
  $('sel-label').addEventListener('input', () => { const e = edgeOf(); if (e) { e.label = $('sel-label').value; softRender(); } });
  $('sel-label').addEventListener('change', remember);
  $('sel-delete').addEventListener('click', () => {
    remember();
    if (selected.type === 'node') {
      flow.nodes = flow.nodes.filter((x) => x.id !== selected.id);
      flow.edges = flow.edges.filter((e) => e.from !== selected.id && e.to !== selected.id);
    } else flow.edges = flow.edges.filter((e) => e.id !== selected.id);
    selected = null;
    render();
    window.UQASound?.play('ui.remove');
  });
  $('sel-done').addEventListener('click', () => select(null));
}

// Re-render without losing focus in the inspector's text fields.
let softTimer = null;
function softRender() {
  clearTimeout(softTimer);
  softTimer = setTimeout(() => {
    const active = document.activeElement;
    const pos = active?.selectionStart;
    render();
    if (active && document.contains(active)) { active.focus(); try { active.setSelectionRange(pos, pos); } catch { /* not a text control */ } }
  }, 60);
}

/* ── the sheet: drag, select, connect ────────────────────────────────── */
function wireSheet() {
  const sheet = $('sheet');
  let drag = null;

  const toSvg = (e) => {
    const svg = sheet.querySelector('svg');
    const pt = svg.createSVGPoint();
    pt.x = e.clientX; pt.y = e.clientY;
    const p = pt.matrixTransform(svg.getScreenCTM().inverse());
    return { x: p.x, y: p.y };
  };

  // The second click of an arrow, or Enter on a second box. Pointer and keyboard share it.
  function connectTo(id) {
    if (!connecting.from) { connecting.from = id; say(t('diagram.status.clickSecondBox')); return; }
    if (connecting.from === id) return say(t('diagram.a11y.connectSame'));
    remember();
    const kind = $('edge-kind').value;
    const edge = { id: `e${Date.now().toString(36)}`, from: connecting.from, to: id, kind, label: kind === 'yes' ? 'نعم' : kind === 'no' ? 'لا' : kind === 'loop' ? 'إعادة محاولة' : '' };
    flow.edges.push(edge);
    window.UQASound?.play('diagram.line');
    connecting = null;
    $('connect').setAttribute('aria-pressed', 'false');
    sheet.classList.remove('connecting');
    select('edge', edge.id);
    say(t('diagram.a11y.connected', { from: nameOf(edge.from), to: nameOf(edge.to) }), 'ok');
  }

  sheet.addEventListener('pointerdown', (e) => {
    const g = e.target.closest('[data-node]');
    if (g) {
      const id = g.dataset.node;
      if (connecting) return connectTo(id);
      const nd = flow.nodes.find((x) => x.id === id);
      const p = toSvg(e);
      drag = { id, dx: p.x - nd.x, dy: p.y - nd.y, moved: false, before: JSON.stringify({ nodes: flow.nodes, edges: flow.edges }) };
      sheet.classList.add('dragging');
      sheet.setPointerCapture?.(e.pointerId);
      e.preventDefault();
      return;
    }
    const eg = e.target.closest('[data-edge]');
    if (eg) return select('edge', eg.dataset.edge);
    if (!connecting) select(null);
  });

  sheet.addEventListener('pointermove', (e) => {
    if (!drag) return;
    const nd = flow.nodes.find((x) => x.id === drag.id);
    const p = toSvg(e);
    const x = snap(p.x - drag.dx);
    const y = snap(p.y - drag.dy);
    if (x !== nd.x || y !== nd.y) {
      nd.x = Math.max(0, Math.min(A4.w - nd.w, x));
      nd.y = Math.max(0, Math.min(A4.h - nd.h, y));
      drag.moved = true;
      render();
    }
  });

  const endDrag = () => {
    if (!drag) return;
    sheet.classList.remove('dragging');
    if (drag.moved) { history.push(drag.before); window.UQASound?.play('diagram.node'); say(t('diagram.status.moved')); }
    else select('node', drag.id);
    drag = null;
  };
  sheet.addEventListener('pointerup', endDrag);
  sheet.addEventListener('pointercancel', endDrag);

  sheet.addEventListener('focusin', (e) => {
    const s = stopOf(e.target);
    if (!s || keys.same(s, rest)) return;
    rest = s;
    for (const g of sheet.querySelectorAll('[data-node],[data-edge]')) g.setAttribute('tabindex', keys.same(stopOf(g), rest) ? '0' : '-1');
  });

  let lastMove = null; // arrow-key repeats on one box are one undo step
  sheet.addEventListener('keydown', (e) => {
    const s = stopOf(e.target);
    if (!s || e.target.closest('[data-node],[data-edge]') !== e.target) return;
    const it = keys.intent(e, { type: s.type, connecting: !!connecting });
    if (!it) return;
    if (it.do !== 'cancel') { e.preventDefault(); e.stopPropagation(); } // Escape also reaches the page-level handler below
    const nd = s.type === 'node' && flow.nodes.find((x) => x.id === s.id);
    if (it.do === 'walk') return stopEl(keys.walk(flow, s, it.how))?.focus();
    if (it.do === 'select') {
      if (connecting && nd) return connectTo(s.id);
      select(s.type, s.id);
      return say(t('diagram.a11y.selected', { label: stopName(s) }));
    }
    if (it.do === 'move') {
      const now = Date.now();
      if (!(lastMove && lastMove.id === s.id && now - lastMove.at < 800)) remember();
      lastMove = { id: s.id, at: now };
      if (!keys.nudge(nd, it.dx, it.dy)) return say(t('diagram.a11y.edgeOfSheet', { label: nodeName(nd) }));
      render();
      window.UQASound?.play('diagram.node');
      return say(t('diagram.a11y.moved', { label: nodeName(nd), x: keys.mm(nd.x), y: keys.mm(nd.y) }));
    }
    if (it.do === 'connect') {
      connecting = { from: s.id };
      $('connect').setAttribute('aria-pressed', 'true');
      sheet.classList.add('connecting');
      return say(t('diagram.a11y.connectFrom', { label: nodeName(nd) }));
    }
    if (it.do === 'delete') {
      const name = stopName(s);
      const next = keys.walk(flow, s, 'next');
      const prev = keys.walk(flow, s, 'prev');
      selected = s;
      rest = keys.same(next, s) ? prev : next;
      $('sel-delete').click();
      stopEl(keys.restStop(flow, rest))?.focus();
      return say(t('diagram.a11y.removed', { label: name }));
    }
    if (it.do === 'cancel' && connecting) say(t('diagram.a11y.cancelled'));
  });

  addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z' && !/input|textarea/i.test(document.activeElement?.tagName || '')) { e.preventDefault(); undo(); }
    if (e.key === 'Escape') { connecting = null; $('connect').setAttribute('aria-pressed', 'false'); sheet.classList.remove('connecting'); select(null); }
    if (e.key === 'Delete' && selected && !/input|textarea/i.test(document.activeElement?.tagName || '')) $('sel-delete').click();
  });
}

/* ── the tool palette ────────────────────────────────────────────────── */
function miniShape(kind) {
  const s = KINDS[kind];
  const c = { x: 1, y: 1, w: 32, h: 20, fill: s.fill, stroke: s.stroke };
  const d = s.shape === 'diamond' ? `<path d="M17 1L33 11 17 21 1 11Z" fill="${s.fill}" stroke="${s.stroke}" stroke-width="1.5"/>`
    : s.shape === 'terminator' ? `<rect x="1" y="1" width="32" height="20" rx="10" fill="${s.fill}" stroke="${s.stroke}" stroke-width="1.5"/>`
      : s.shape === 'parallelogram' ? `<path d="M8 1H33L26 21H1Z" fill="${s.fill}" stroke="${s.stroke}" stroke-width="1.5"/>`
        : s.shape === 'note' ? `<path d="M1 1H26L33 8V21H1Z" fill="${s.fill}" stroke="${s.stroke}" stroke-width="1.2" stroke-dasharray="3 2"/>`
          : `<rect x="${c.x}" y="${c.y}" width="${c.w}" height="${c.h}" rx="4" fill="${s.fill}" stroke="${s.stroke}" stroke-width="1.5"/>`;
  return `<svg viewBox="0 0 34 22" aria-hidden="true">${d}</svg>`;
}

function wireTools() {
  const host = $('add-kinds');
  for (const [kind, spec] of Object.entries(KINDS)) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'kind-btn';
    b.innerHTML = `${miniShape(kind)}<span>${spec.en}<br><bdi>${spec.ar}</bdi></span>`;
    b.addEventListener('click', () => {
      remember();
      const r = flow.nodes.filter((n) => !n.floating);
      const last = r[r.length - 1];
      const node = { id: `n${Date.now().toString(36)}`, kind, ar: spec.ar, en: spec.en, w: 150, h: kind === 'decision' ? 72 : 60, x: snap((last?.x ?? 60) + 40), y: snap((last?.y ?? 120) + 40) };
      node.x = Math.min(node.x, A4.w - 400); node.y = Math.min(node.y, A4.h - 260);
      flow.nodes.push(node);
      window.UQASound?.play('diagram.node');
      select('node', node.id);
      say(t('diagram.status.added'));
    });
    host.append(b);
  }
  const fill = (sel) => { sel.replaceChildren(); for (const [k, s] of Object.entries(EDGES)) { const o = document.createElement('option'); o.value = k; o.textContent = `${s.en} · ${s.ar}`; sel.append(o); } };
  fill($('edge-kind')); fill($('sel-edge-kind'));
  const kindSel = $('sel-kind'); kindSel.replaceChildren();
  for (const [k, s] of Object.entries(KINDS)) { const o = document.createElement('option'); o.value = k; o.textContent = `${s.en} · ${s.ar}`; kindSel.append(o); }

  $('connect').addEventListener('click', () => {
    const on = $('connect').getAttribute('aria-pressed') !== 'true';
    connecting = on ? { from: null } : null;
    $('connect').setAttribute('aria-pressed', String(on));
    $('sheet').classList.toggle('connecting', on);
    say(on ? t('diagram.status.connectPrompt') : '');
  });
  $('undo').addEventListener('click', undo);
  $('regen').addEventListener('click', () => {
    if (!confirm(t('diagram.confirm.regen'))) return;
    remember();
    flow = buildFlow(session, events);
    selected = null;
    render();
    say(t('diagram.status.regenerated'), 'ok');
  });
  $('save-session').addEventListener('click', async () => {
    const res = await send({ type: 'UQA_DIAGRAM_SAVE', sessionId, flow });
    if (!res?.ok) return say(res?.error || t('diagram.status.couldNotKeep'), 'err');
    window.UQASound?.play('file.saved');
    say(t('diagram.status.kept'), 'ok');
  });
  $('export-svg').addEventListener('click', () => exportFile('svg'));
  $('export-png').addEventListener('click', () => exportFile('png'));
}

async function exportFile(kind) {
  const svg = flowToSvg(flow, { lockup });
  const { filePath, FORMATS, withFolder } = await import('../core/filing.js');
  const settings = await send({ type: 'UQA_GET_SETTINGS' });
  const clock = settings?.result?.clock || '24';
  // This page built its path with `filePath()` alone, which knows the tree but
  // not the tester's folder, so a diagram exported here went to a different
  // place than the same diagram exported from the report's Save sheet.
  const into = (p) => withFolder(p, settings?.result?.downloadFolder || '');
  const base = { title: 'Workflow diagram', session, kind: 'docs', when: session.startedAt, clock, audience: 'human' };
  if (kind === 'svg') {
    const res = await window.UQADownload.saveFiled(svg, into(filePath({ ...base, ext: 'svg' })), 'image/svg+xml');
    await send({ type: 'UQA_EXPORT_SAVED', sessionId, format: 'flow-svg', label: FORMATS['flow-svg']?.label || 'Workflow diagram (SVG)', path: res.path, bytes: svg.length, how: res.how });
    return say(res.ok ? t('diagram.status.saved', { path: res.path || t('diagram.export.svgFallbackName') }) : t('diagram.status.couldNotSave', { error: res.error }), res.ok ? 'ok' : 'err');
  }
  // PNG: rasterise the same SVG at 2× A4 so print stays crisp.
  say(t('diagram.status.drawingPng'));
  const img = new Image();
  const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }));
  await new Promise((resolve, reject) => { img.onload = resolve; img.onerror = reject; img.src = url; });
  const canvas = document.createElement('canvas');
  canvas.width = A4.w * 2; canvas.height = A4.h * 2;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  URL.revokeObjectURL(url);
  const blob = await new Promise((r) => canvas.toBlob(r, 'image/png'));
  const res = await window.UQADownload.saveFiled(blob, into(filePath({ ...base, ext: 'png' })));
  await send({ type: 'UQA_EXPORT_SAVED', sessionId, format: 'flow-png', label: 'Workflow diagram (PNG)', path: res.path, bytes: blob.size, how: res.how });
  say(res.ok ? t('diagram.status.saved', { path: res.path || t('diagram.export.pngFallbackName') }) : t('diagram.status.couldNotSave', { error: res.error }), res.ok ? 'ok' : 'err');
}

/**
 * Nothing to draw.
 *
 * The page used to render its whole toolbar, an empty palette and a blank
 * sheet when it was opened without a session — an interface that looks
 * broken rather than one that explains itself.
 */
function noSession(why) {
  document.body.classList.add('is-empty');
  document.getElementById('no-session').hidden = false;
  document.getElementById('sheet-wrap').hidden = true;
  document.querySelector('.tools').hidden = true;
  for (const id of ['regen', 'undo', 'save-session', 'export-svg', 'export-png']) {
    const b = document.getElementById(id);
    if (b) b.disabled = true;
  }
  document.getElementById('open-report')?.addEventListener('click', () => {
    chrome.runtime.sendMessage({ type: 'UQA_GET_STATE' }, (st) => {
      const id = st?.result?.session?.id || st?.result?.lastSession?.id;
      chrome.tabs.create({ url: chrome.runtime.getURL(`report/report.html${id ? `?session=${id}` : ''}`) });
    });
  });
  say(why || '');
}

/* ── boot ────────────────────────────────────────────────────────────── */
(async () => {
  if (!sessionId) return noSession();
  try { lockup = (await (await fetch('../brand/lockup.svg')).text()).replace(/<!--[\s\S]*?-->/g, ''); } catch { lockup = ''; }
  const res = await send({ type: 'UQA_GET_TIMELINE', sessionId });
  if (!res?.ok) return noSession(res?.error);
  session = res.result.session;
  events = res.result.events || [];
  $('subtitle').textContent = session.charter;
  document.title = t('diagram.docTitle', { charter: session.charter });
  const saved = [...events].reverse().find((e) => e.kind === 'diagram');
  flow = saved?.flow ? saved.flow : buildFlow(session, events);
  if (saved?.flow && !saved.flow.nodes?.length) flow = buildFlow(session, events);
  const s = await send({ type: 'UQA_GET_SETTINGS' });
  if (s?.ok) { window.UQASound?.configure({ on: !!s.result.soundEnabled, level: (s.result.soundVolume ?? 70) / 100, scope: s.result.soundScope }); window.UQAVfx?.configure({ enabled: s.result.vfxEnabled !== false }); }
  window.UQAVfx?.wire();
  wireTools();
  wireInspector();
  wireSheet();
  render();
  say(saved ? t('diagram.status.editedDiagram') : t('diagram.status.builtFromRecording', { n: flow.nodes.length }));
  window.UQAFlow = { get flow() { return flow; }, render, buildFlow };
})();
