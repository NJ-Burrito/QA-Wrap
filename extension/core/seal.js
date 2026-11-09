/* QA Wrap — local-first QA toolkit in the ISTQB shape. */
// @ts-check
/**
 * The seal: tamper-evidence for an exported Markdown file. Not secrecy, and not proof of identity.
 *
 * What it is. A sealed file is its readable text followed by a seal block holding the signer's name, the date, the tool
 * version, the SHA-256 of the text above, and an ECDSA P-256 signature over those fields made with a key that this
 * install generated once and cannot export (a non-extractable WebCrypto key, platform/seal-key.js). The block also
 * carries the public key and its fingerprint, so anyone can check the file; "Verify file" in QA Wrap does.
 *
 * What it proves. That the text and the seal fields are exactly what the holder of that key signed. Change one byte of
 * the text, or the signer's name, and the verdict is "altered".
 *
 * What it does not prove, said plainly because the docs must say it. The seal is not secret: the text is readable by
 * design. It does not prove who the signer is: the name is whatever the person typed in their profile. And it cannot stop
 * a determined person from editing the file and sealing it again with their own key; that yields a file that verifies
 * as intact but carries a different key fingerprint, which is why Verify file also reports the fingerprint and whether the
 * key is this install's. Treat the fingerprint, not the name, as the identity, and compare it with one you already trust.
 *
 * Line endings are normalised to LF before hashing (an editor that rewrites CRLF must not flag a file as altered);
 * nothing else is forgiven. Pure: WebCrypto only, no chrome.*, no storage.
 */

export const SEAL_VERSION = 1;
const HEAD = 'QA-WRAP-SEAL v1';
const MARK = '<!-- qaw-seal -->';
const TITLE = '## Seal · الختم';
const NOTE = '> Tamper-evidence, not secrecy: this seal shows the text above is unchanged since the key below signed it. · يكشف هذا الختم أي تعديل في النص أعلاه منذ توقيعه بالمفتاح أدناه، ولا يخفي المحتوى.';

const enc = new TextEncoder();
const hex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
const b64 = (buf) => { const a = new Uint8Array(buf); let s = ''; for (let i = 0; i < a.length; i += 8192) s += String.fromCharCode(...a.subarray(i, i + 8192)); return btoa(s); };
const unb64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
const sha256Hex = async (text) => hex(await crypto.subtle.digest('SHA-256', enc.encode(text)));
const ECDSA = { name: 'ECDSA', namedCurve: 'P-256' };
const SIGN = { name: 'ECDSA', hash: 'SHA-256' };

/** The text that gets hashed: LF endings, no BOM, ends with exactly one newline. */
export const normaliseBody = (text) => `${String(text ?? '').replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n').replace(/\s+$/, '')}\n`;

/** One line, no control characters: what a seal field may hold. */
const field = (s) => String(s ?? '').replace(/[\x00-\x1F\x7F-\x9F\u2028\u2029]/g, ' ').replace(/\s+/g, ' ').trim();

/** A fresh key pair: the private key cannot be exported; the public key can. */
export async function generateSealKey() {
  const pair = await crypto.subtle.generateKey(ECDSA, false, ['sign', 'verify']);
  return { privateKey: pair.privateKey, publicJwk: await publicJwkOf(pair.publicKey) };
}

/** The public half as the three JWK members a fingerprint and a verification need. */
export async function publicJwkOf(publicKey) {
  const { kty, crv, x, y } = await crypto.subtle.exportKey('jwk', publicKey);
  return { kty, crv, x, y };
}

/** SHA-256 of the canonical public key (sorted members, no whitespace), lower-case hex. */
export const fingerprintOf = (jwk) => sha256Hex(JSON.stringify({ crv: jwk.crv, kty: jwk.kty, x: jwk.x, y: jwk.y }));

/** Sixteen hex characters in groups of four, for a person to read aloud or compare. */
export const shortFingerprint = (fp) => String(fp || '').slice(0, 16).replace(/(.{4})(?=.)/g, '$1 ');

/** The exact string that is signed. */
const payloadOf = ({ sha, name, date, tool, fp }) => `${HEAD}\nsha256:${sha}\nname:${name}\ndate:${date}\ntool:${tool}\nfp:${fp}`;

const renderSeal = ({ name, date, tool, sha, fp, pub, sig }) => [
  MARK, TITLE, '', NOTE, '', '```text', HEAD,
  `Signed by: ${name}`, `Date: ${date}`, `Tool: ${tool}`, `Body SHA-256: ${sha}`,
  `Key fingerprint: ${fp}`, `Public key: ${pub}`, `Signature: ${sig}`, '```', '',
].join('\n');

/**
 * Seal a Markdown text.
 * @param {string} text  the readable document
 * @param {{ key: { privateKey: CryptoKey, publicJwk: any }, name?: string, version?: string, when?: any }} o
 * @returns {Promise<string>} the document with the seal block appended
 */
export async function sealMarkdown(text, { key, name = '', version = '', when } = {}) {
  if (!key?.privateKey || !key?.publicJwk) throw new Error('A seal needs a signing key.');
  const body = normaliseBody(text);
  const fields = {
    name: field(name), date: new Date(when ?? Date.now()).toISOString(), tool: `QA Wrap${version ? ` ${field(version)}` : ''}`,
    sha: await sha256Hex(body), fp: await fingerprintOf(key.publicJwk),
  };
  const sig = b64(await crypto.subtle.sign(SIGN, key.privateKey, enc.encode(payloadOf(fields))));
  return `${body}${renderSeal({ ...fields, pub: `${key.publicJwk.x}.${key.publicJwk.y}`, sig })}`;
}

/**
 * @typedef {{ status: 'intact'|'altered'|'unsealed'|'unreadable', reasons: string[], signer: string, date: string, tool: string,
 *   fingerprint: string, sameInstall: boolean|null }} Verdict
 * reasons (empty when intact): 'text-changed' (the text no longer hashes to the sealed value), 'seal-edited' (the seal
 * block itself differs from what was written), 'signature' (the signature does not verify), 'fingerprint' (the stated
 * fingerprint is not that of the stated key), 'after-seal' (something follows the seal block).
 */

const EMPTY = { signer: '', date: '', tool: '', fingerprint: '', sameInstall: null };

/**
 * Check a sealed Markdown text.
 * @param {string} raw
 * @param {{ ownFingerprint?: string }} [o]  this install's key fingerprint, to say whether the key is its own
 * @returns {Promise<Verdict>}
 */
export async function verifyMarkdown(raw, { ownFingerprint = '' } = {}) {
  const text = String(raw ?? '').replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
  const at = text.lastIndexOf(`\n${MARK}\n`);
  if (at < 0) return { status: 'unsealed', reasons: ['no-seal'], ...EMPTY };
  const body = `${text.slice(0, at).replace(/\s+$/, '')}\n`;
  const tail = text.slice(at + 1);
  const fence = /```text\n([\s\S]*?)\n```/.exec(tail);
  const kv = {};
  for (const line of (fence?.[1] || '').split('\n')) { const m = /^([^:]+): (.*)$/.exec(line); if (m) kv[m[1]] = m[2]; }
  const need = ['Signed by', 'Date', 'Tool', 'Body SHA-256', 'Key fingerprint', 'Public key', 'Signature'];
  if (!fence || !fence[1].startsWith(`${HEAD}\n`) || need.some((k) => !(k in kv))) return { status: 'unreadable', reasons: ['seal-edited'], ...EMPTY };
  const [x, y] = kv['Public key'].split('.');
  const jwk = { kty: 'EC', crv: 'P-256', x, y };
  const info = { signer: kv['Signed by'], date: kv.Date, tool: kv.Tool, fingerprint: kv['Key fingerprint'] };
  const reasons = [];
  if (kv['Body SHA-256'] !== await sha256Hex(body)) reasons.push('text-changed');
  let keyOk = false;
  try {
    const pub = await crypto.subtle.importKey('jwk', jwk, ECDSA, false, ['verify']);
    if (kv['Key fingerprint'] !== await fingerprintOf(jwk)) reasons.push('fingerprint');
    const payload = payloadOf({ sha: kv['Body SHA-256'], name: kv['Signed by'], date: kv.Date, tool: kv.Tool, fp: kv['Key fingerprint'] });
    keyOk = await crypto.subtle.verify(SIGN, pub, unb64(kv.Signature), enc.encode(payload));
  } catch { /* a malformed key or signature is not a valid seal */ }
  if (!keyOk) reasons.push('signature');
  const rebuilt = renderSeal({ name: kv['Signed by'], date: kv.Date, tool: kv.Tool, sha: kv['Body SHA-256'], fp: kv['Key fingerprint'], pub: kv['Public key'], sig: kv.Signature });
  if (tail.replace(/\s+$/, '') !== rebuilt.replace(/\s+$/, '')) reasons.push(tail.slice(fence.index + fence[0].length).trim() ? 'after-seal' : 'seal-edited');
  const intact = reasons.length === 0;
  return {
    status: intact ? 'intact' : 'altered', reasons, ...info,
    sameInstall: ownFingerprint ? info.fingerprint === ownFingerprint : null,
  };
}
