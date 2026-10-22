/* QA Wrap — local-first QA toolkit in the ISTQB shape. */
/**
 * A real e-mail draft (RFC 5322 + MIME, RFC 2045/2047) the tester opens in their mail app.
 *
 * Nothing is sent from here: the file is downloaded and the mail app does the rest. Pure and
 * DOM-free so tools/test-eml.mjs can parse the result. Bodies and attachments travel as base64,
 * so any language survives and no line ever exceeds 76 characters.
 *
 *   UQAEml.build({ subject, text, attachments: [{ name, type, bytes: Uint8Array }] }) -> string (CRLF)
 */
(function () {
  const CRLF = '\r\n';
  const utf8 = (s) => new TextEncoder().encode(s);
  const b64 = (bytes) => {
    let bin = '';
    for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    return btoa(bin).replace(/.{1,76}/g, '$&' + CRLF).replace(/\r\n$/, '');
  };
  /**
   * RFC 2047 encoded-words for a header value that holds anything but plain ASCII: each word
   * carries whole characters only and stays under 75 characters, and the words are folded onto
   * continuation lines so no header line passes 78.
   */
  const word = (s) => {
    if (/^[ -~]*$/.test(s)) return s;
    const words = [];
    let chunk = '';
    for (const ch of s) {
      if (utf8(chunk + ch).length > 30) { words.push(chunk); chunk = ''; }
      chunk += ch;
    }
    if (chunk) words.push(chunk);
    return words.map((w) => `=?UTF-8?B?${btoa(String.fromCharCode(...utf8(w)))}?=`).join(CRLF + ' ');
  };
  const quote = (s) => `"${s.replace(/[\r\n]+/g, ' ').replace(/(["\\])/g, '\\$1')}"`;
  /** RFC 2231 filename* so an Arabic file name survives, with an ASCII fallback beside it. */
  const fname = (n) => {
    const ascii = n.replace(/[^\x20-\x7e]/g, '_');
    return ascii === n ? `filename=${quote(n)}` : `filename*=UTF-8''${encodeURIComponent(n)};${CRLF} filename=${quote(ascii)}`;
  };

  function build({ subject, text, attachments = [], date = new Date(), id = Math.random().toString(36).slice(2) + Date.now().toString(36) }) {
    const boundary = `=_qaw_${id}`;
    const lines = [
      // A draft: the mail app supplies the sender and the recipient.
      'X-Unsent: 1',
      'From: QA Wrap <draft@qa-wrap.invalid>',
      `Date: ${date.toUTCString().replace('GMT', '+0000')}`,
      `Message-ID: <${id}@qa-wrap.invalid>`,
      `Subject: ${word(String(subject || 'QA Wrap report').replace(/[\r\n]+/g, ' '))}`,
      'MIME-Version: 1.0',
      `Content-Type: multipart/mixed; boundary="${boundary}"`,
      '',
      'This is a multi-part message in MIME format.',
      `--${boundary}`,
      'Content-Type: text/plain; charset=utf-8',
      'Content-Transfer-Encoding: base64',
      '',
      b64(utf8(String(text || ''))),
    ];
    for (const a of attachments) {
      lines.push(
        `--${boundary}`,
        `Content-Type: ${a.type || 'application/octet-stream'}; name=${quote(a.name)}`,
        'Content-Transfer-Encoding: base64',
        `Content-Disposition: attachment;${CRLF} ${fname(a.name)}`,
        '',
        b64(a.bytes),
      );
    }
    lines.push(`--${boundary}--`, '');
    return lines.join(CRLF);
  }

  globalThis.UQAEml = { build };
})();
