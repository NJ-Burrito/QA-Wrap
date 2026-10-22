/* QA Wrap — local-first QA toolkit in the ISTQB shape. */
/**
 * Read a zip's central directory, with no dependency and no unpacking.
 *
 * The build and the release gate both have to answer "what is actually in this
 * file", and for the same reason: `Compress-Archive` has been observed writing
 * a zip that is missing an entry and exiting 0 about it — `brave.zip` once came
 * out at 151 of 152 files with `vendor/axe.min.js` gone, and nothing said so.
 * Trusting the packer's exit code is what let that ship.
 *
 * The central directory is the honest place to ask: it is the index the zip
 * format is read by, so an entry that is not in it does not exist to any
 * consumer, Chrome included.
 *
 * Deliberately not ZIP64-aware. Every package here is a few thousand entries at
 * most and well under 4 GB; a build that outgrew that would read a nonsense
 * entry count here rather than silently mis-report one, which is the failure we
 * want.
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import zlib from 'node:zlib';
import { setTimeout as sleep } from 'node:timers/promises';

const EOCD = Buffer.from([0x50, 0x4b, 0x05, 0x06]);

/**
 * Every entry in a zip, by name.
 *
 * @returns {{ entries: Map<string, {method: number, usize: number, data: () => Buffer}>, bytes: number }}
 */
export function readZip(file) {
  return readZipBuffer(fs.readFileSync(file), file);
}

/** The same reader over bytes already in memory (T-067: contract tests read bundles without a temp file). */
export function readZipBuffer(bytes, file = 'zip') {
  const buf = Buffer.from(bytes);
  const eocd = buf.lastIndexOf(EOCD);
  if (eocd < 0) throw new Error(`${file} has no zip end-of-directory record — it is not a zip`);
  const count = buf.readUInt16LE(eocd + 10);
  const cdOffset = buf.readUInt32LE(eocd + 16);
  const entries = new Map();
  let p = cdOffset;
  for (let i = 0; i < count; i++) {
    const method = buf.readUInt16LE(p + 10);
    const csize = buf.readUInt32LE(p + 20);
    const usize = buf.readUInt32LE(p + 24);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const local = buf.readUInt32LE(p + 42);
    // Entries written on Windows may carry backslashes; the store and Chrome read them as folders either way.
    const name = buf.toString('utf8', p + 46, p + 46 + nameLen).split('\\').join('/');
    const lNameLen = buf.readUInt16LE(local + 26);
    const lExtraLen = buf.readUInt16LE(local + 28);
    const start = local + 30 + lNameLen + lExtraLen;
    const raw = buf.subarray(start, start + csize);
    entries.set(name, { method, usize, data: () => (method === 8 ? zlib.inflateRawSync(raw) : raw) });
    p += 46 + nameLen + extraLen + commentLen;
  }
  return { entries, bytes: buf.length };
}

/**
 * The entry names exactly as the packer wrote them, backslashes included. `readZip` folds `\` to `/` on purpose
 * (Chrome reads either), so it cannot answer "did the packer write Windows separators"; this can.
 */
export function rawNames(file) {
  const buf = fs.readFileSync(file);
  const eocd = buf.lastIndexOf(EOCD);
  if (eocd < 0) throw new Error(`${file} is not a zip`);
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  const names = [];
  for (let i = 0; i < count; i++) {
    const nameLen = buf.readUInt16LE(p + 28);
    names.push(buf.toString('utf8', p + 46, p + 46 + nameLen));
    p += 46 + nameLen + buf.readUInt16LE(p + 30) + buf.readUInt16LE(p + 32);
  }
  return names;
}

/** Just the names, for the checks that only need to count or compare. */
export function entryNames(file) {
  return [...readZip(file).entries.keys()];
}

/**
 * The files in a zip, ignoring the folder markers some packers write.
 *
 * A directory entry is a name ending in `/` with no content. Counting them
 * would make "the zip holds what we copied" true or false depending on which
 * packer wrote it, which is not a property of the package.
 */
export function fileEntries(file) {
  return entryNames(file).filter((n) => !n.endsWith('/'));
}

/* ── writing one, and refusing to lie about the result ─────────────────────
 *
 * `tools/build-browsers.mjs` learned this the hard way and carried it alone;
 * `tools/package.mjs` — the one that writes the Chrome Web Store zip — did
 * not, and on 5 September 2026 `npm run release` died on exactly the failure
 * build-browsers.mjs had already been taught to survive:
 *
 *     Compress-Archive : The process cannot access the file
 *     'dist/.staged/popup/popup.js' because it is being used by another process.
 *
 * Windows Defender holds a freshly-written file open while it scans it. The
 * staging copy writes a few megabytes and hands them to `Compress-Archive`
 * immediately, so the scan and the read collide. The second run passed. A
 * build that fails one time in three is a build nobody trusts, and the failure
 * lands on the last step of `npm run release`, after everything else was fine.
 *
 * So the whole of that lesson lives here now, in one place both callers use:
 *
 *   **1. Retry the compress, not the job.** The lock lasts as long as the
 *   scan. Rebuilding the staged tree re-writes the files and starts the scan
 *   over, which turns a two-second wait into a loop that never converges. Only
 *   the zip step is retried, with a widening gap.
 *
 *   **2. Count the entries.** A `Compress-Archive` that exits 0 has still
 *   written a short zip: `brave.zip` once held 151 of 152 files, missing
 *   `vendor/axe.min.js`, and nothing said so. The caller counted what it
 *   copied; this compares that count against the zip's own central directory.
 *   A short zip is a failure, and a failure is retried like any other.
 *
 *   **3. Write beside the old zip, never over it.** Compressing to
 *   `.building.zip` and renaming means the artefact on disk is always one that
 *   was verified, and a failed build leaves the last good package intact
 *   rather than deleting it and then not replacing it.
 *
 * `.building.zip` and not `.tmp`: Compress-Archive refuses any destination
 * whose extension is not `.zip` — "`.tmp` is not a supported archive file
 * format" — and it refuses it the same quiet way it refuses a locked file, so
 * the retry loop would have burned every attempt on a filename.
 */

/**
 * Write `zip` by running `pack(tmp)`, verify it, retry it while it is locked.
 *
 * @param {object} o
 * @param {string} o.zip            where the finished archive goes
 * @param {number} o.expectedFiles  how many files the caller put in
 * @param {(tmp: string) => void} o.pack  compresses into `tmp`; throws on failure
 * @param {(note: string) => void} [o.onRetry]  told about each failed attempt
 * @returns {Promise<{ok: boolean, attempts: number, entries?: number, error?: string}>}
 */
export async function packVerified({ zip, expectedFiles, pack, onRetry }) {
  const tmp = zip.replace(/\.zip$/, '.building.zip');
  const delays = [1000, 2000, 4000, 8000];
  let last = null;

  for (let attempt = 0; attempt <= delays.length; attempt++) {
    fs.rmSync(tmp, { force: true });
    try {
      pack(tmp);

      const inZip = fileEntries(tmp).length;
      if (inZip !== expectedFiles) {
        throw new Error(`the zip holds ${inZip} files, ${expectedFiles} were copied`);
      }

      // Over the top, in one operation. Never a delete-then-write.
      fs.renameSync(tmp, zip);
      return { ok: true, attempts: attempt + 1, entries: inZip };
    } catch (err) {
      last = String(err.stderr || err.message || err).trim().split('\n')[0];
      fs.rmSync(tmp, { force: true });
      if (attempt < delays.length) {
        onRetry?.(`attempt ${attempt + 1} failed (${last}) — retrying in ${delays[attempt] / 1000}s`);
        await sleep(delays[attempt]);
      }
    }
  }
  return { ok: false, attempts: delays.length + 1, error: last };
}

/* ── build, extract, hash: what the test pipeline does with the real package ──
 *
 * `test-boot-zip.mjs` boots the zip a tester would install, not the folder a developer loads. These three are its
 * whole toolbox and they are plain node on purpose: no `Compress-Archive`, no `Expand-Archive` (7.5 s of the 22 s the
 * R5 rehearsal measured), no `tar` (Git Bash reads `C:` as a host name).
 */

/** First 12 hex digits of the file's SHA-256, the same short form the release record prints. */
export function sha256File(file, digits = 12) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex').slice(0, digits);
}

/**
 * Run the real packager (`tools/package.mjs`) with `QAW_DIST=<dist>`, so the zip lands in `dist` and the delivered
 * `<repo>/dist/` is never touched. `dist` must be a folder the caller made (a temp dir).
 *
 * @param {object} o
 * @param {string} o.ext   the extension folder to run from (`package.mjs` lives in its `tools/`)
 * @param {string} o.dist  where the zip goes
 * @returns {{ok: boolean, zip?: string, bytes?: number, sha?: string, ms: number, exit: number|null, log: string}}
 */
export function buildPackage({ ext, dist }) {
  if (!dist || path.resolve(dist) === path.resolve(ext, '..', 'dist')) {
    throw new Error('buildPackage: refusing to write the delivered repo dist/ — pass a temp folder');
  }
  fs.mkdirSync(dist, { recursive: true });
  const t0 = Date.now();
  const r = spawnSync(process.execPath, [path.join('tools', 'package.mjs')], {
    cwd: ext,
    encoding: 'utf8',
    env: { ...process.env, PYTHONUTF8: '1', QAW_DIST: dist },
    maxBuffer: 1 << 26,
  });
  const log = `${r.stdout || ''}${r.stderr || ''}`;
  const zips = fs.existsSync(dist) ? fs.readdirSync(dist).filter((n) => n.endsWith('.zip') && !n.endsWith('.building.zip')) : [];
  const ms = Date.now() - t0;
  if (r.status !== 0 || zips.length !== 1) return { ok: false, ms, exit: r.status, log };
  const zip = path.join(dist, zips[0]);
  return { ok: true, zip, bytes: fs.statSync(zip).size, sha: sha256File(zip), ms, exit: r.status, log };
}

/**
 * Unpack `zip` into the empty folder `out` with the zip reader above. A name that would land outside `out`
 * (`..`, an absolute path, a drive letter) throws: a package is data, never a path.
 *
 * @returns {{files: number, bytes: number}}
 */
export function extractZip(zip, out) {
  const root = path.resolve(out);
  fs.mkdirSync(root, { recursive: true });
  if (fs.readdirSync(root).length) throw new Error(`extractZip: ${out} is not empty`);
  let files = 0;
  let bytes = 0;
  for (const [name, entry] of readZip(zip).entries) {
    if (name.endsWith('/')) continue;
    const dest = path.resolve(root, name);
    if (!dest.startsWith(root + path.sep) || /^[a-zA-Z]:|^\//.test(name) || name.split('/').includes('..')) {
      throw new Error(`extractZip: unsafe entry name ${JSON.stringify(name)}`);
    }
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    const data = entry.data();
    fs.writeFileSync(dest, data);
    files++;
    bytes += data.length;
  }
  return { files, bytes };
}

/** `name -> "size:mtimeMs"` for every file directly in a folder; two snapshots equal means nothing was written. */
export function folderFingerprint(dir) {
  if (!fs.existsSync(dir)) return 'absent';
  const rows = [];
  const walk = (d, rel) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      const r = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) walk(p, r);
      else { const st = fs.statSync(p); rows.push(`${r}|${st.size}|${st.mtimeMs}`); }
    }
  };
  walk(dir, '');
  return rows.sort().join('\n');
}
