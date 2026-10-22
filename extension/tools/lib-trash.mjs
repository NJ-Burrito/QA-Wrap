/* QA Wrap — local-first QA toolkit in the ISTQB shape. */
/**
 * r8-12-5: the one way a test sends its scratch folder away. It goes to the recycle bin through the safe-delete helper
 * (any helper named by the QAW_TRASH env var: `python <helper> <path>`); when QAW_TRASH is unset it falls back to
 * fs.rmSync, and it says which path ran. test-ci-hardening fails on an fs.rmSync in a suite outside this file.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

// QAW_TRASH: the sandboxed runner redirects HOME, so lib-sandbox hands the real helper path down.
export const TRASH = process.env.QAW_TRASH || '';

/** Recycle `p`. Returns { path: 'trash.py' | 'rmSync' | 'absent', ok }. */
export function recycle(p, label = path.basename(String(p || ''))) {
  if (!p || !fs.existsSync(p)) return { path: 'absent', ok: true };
  if (fs.existsSync(TRASH)) {
    const r = spawnSync('python', [TRASH, p], { encoding: 'utf8', env: { ...process.env, PYTHONUTF8: '1' } });
    const ok = r.status === 0;
    console.log(`  recycle ${label}: trash.py ${ok ? 'ok' : `FAILED (${(r.stderr || r.stdout || '').trim().slice(0, 160)})`}`);
    return { path: 'trash.py', ok };
  }
  fs.rmSync(p, { recursive: true, force: true });
  console.log(`  recycle ${label}: trash.py is absent, fell back to fs.rmSync`);
  return { path: 'rmSync', ok: true };
}
