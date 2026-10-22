/* QA Wrap — local-first QA toolkit in the ISTQB shape. */
// T-070: "What left this machine" in Settings. Reads the ledger core/egress.js writes; rows hold no content.
import { LEDGER_KEY, copyRecorded } from '../core/egress.js';

const when = (ts) => new Date(ts).toISOString().replace('T', ' ').slice(0, 19);

/** One plain line per row, newest first: the same text the list shows and the copy button copies. */
export function ledgerLines(rows, t) {
  return [...(rows || [])].reverse().map((r) =>
    `${when(r.ts)}  ${t(r.scanned === null ? 'options.egress.rowNoScan' : 'options.egress.row', { kind: r.kind, host: r.host || '-', bytes: r.bytes, found: r.findingsCount })}${r.scanned !== false ? '' : ` ${t('options.egress.unscanned')}`}`);
}

async function read() {
  try { return (await chrome.storage.local.get(LEDGER_KEY))[LEDGER_KEY] || []; } catch { return []; }
}

export async function paintEgress(doc, t) {
  const list = doc.getElementById('egress-list');
  if (!list) return;
  const lines = ledgerLines(await read(), t);
  list.replaceChildren(...lines.map((l) => Object.assign(doc.createElement('li'), { textContent: l })));
  const empty = doc.getElementById('egress-empty');
  if (empty) { empty.textContent = lines.length ? '' : t('options.egress.empty'); }
  const btn = doc.getElementById('egress-copy');
  if (btn) btn.disabled = !lines.length;
  return lines;
}

export function wireEgress(doc, t) {
  const btn = doc.getElementById('egress-copy');
  btn?.addEventListener('click', async () => {
    try {
      await copyRecorded((await paintEgress(doc, t)).join('\n'));
      btn.textContent = t('options.egress.copied');
    } catch { /* clipboard refused: the list is on screen to select */ }
  });
  chrome.storage?.onChanged?.addListener((_c, area) => { if (area === 'local') paintEgress(doc, t); });
  return paintEgress(doc, t);
}
