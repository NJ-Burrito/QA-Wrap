/* QA Wrap — local-first QA toolkit in the ISTQB shape. */
/**
 * A real .xlsx, with no library.
 *
 * An Excel workbook is a zip of XML files with fixed names. Zip entries may be
 * stored uncompressed, and Excel, LibreOffice and Google Sheets all read them
 * that way — so the whole writer is: a CRC-32, a zip container with STORED
 * entries, and five small XML documents. Strings go in as inline strings
 * (no shared-string table to maintain), numbers as numbers, dates as ISO
 * text, which sorts and filters correctly and never shifts by a time zone.
 *
 * What the reader gets: a bold, frozen header row, an autofilter over the
 * table, sensible column widths, and the product named as the creator in the
 * document properties — the same provenance every other artefact carries.
 *
 * The face is named, not carried: `styles.xml` points at Thmanyah Sans
 * (research/56:194, the round-2 decision that supersedes decision 135 for
 * every other export). A `.xlsx`'s styles reference a font by name only —
 * there is no slot in the OOXML style part for embedded bytes the way a
 * `@font-face` rule carries them — so a reader with the family installed sees
 * it and Excel substitutes its own default for anyone else, which is exactly
 * how naming any other font in a spreadsheet already behaves.
 */

import { MAKER, stripControl } from './provenance.js';
import { escHtml } from './docshell.js';

/* ── CRC-32 ────────────────────────────────────────────────────────────── */

const TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

export function crc32(bytes) {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/* ── zip, stored entries only ──────────────────────────────────────────── */

const enc = new TextEncoder();

function dosTime(d) {
  const time = (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1);
  const date = ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
  return { time, date };
}

/** `files`: `[{ name, data: Uint8Array | string }]` → the zip bytes. */
export function zipStored(files, when = new Date()) {
  const { time, date } = dosTime(when);
  const parts = [];
  const central = [];
  let offset = 0;

  const u16 = (v) => [v & 0xff, (v >>> 8) & 0xff];
  const u32 = (v) => [v & 0xff, (v >>> 8) & 0xff, (v >>> 16) & 0xff, (v >>> 24) & 0xff];

  for (const f of files) {
    const data = typeof f.data === 'string' ? enc.encode(f.data) : f.data;
    const name = enc.encode(f.name);
    const crc = crc32(data);
    const local = new Uint8Array([
      ...u32(0x04034b50), ...u16(20), ...u16(0x0800), ...u16(0), ...u16(time), ...u16(date),
      ...u32(crc), ...u32(data.length), ...u32(data.length), ...u16(name.length), ...u16(0),
    ]);
    parts.push(local, name, data);
    central.push(new Uint8Array([
      ...u32(0x02014b50), ...u16(20), ...u16(20), ...u16(0x0800), ...u16(0), ...u16(time), ...u16(date),
      ...u32(crc), ...u32(data.length), ...u32(data.length), ...u16(name.length), ...u16(0), ...u16(0),
      ...u16(0), ...u16(0), ...u32(0), ...u32(offset),
    ]), name);
    offset += local.length + name.length + data.length;
  }

  const cdStart = offset;
  let cdSize = 0;
  for (const c of central) cdSize += c.length;
  const end = new Uint8Array([
    ...u32(0x06054b50), ...u16(0), ...u16(0), ...u16(files.length), ...u16(files.length),
    ...u32(cdSize), ...u32(cdStart), ...u16(0),
  ]);

  const total = offset + cdSize + end.length;
  const out = new Uint8Array(total);
  let p = 0;
  for (const chunk of [...parts, ...central, end]) { out.set(chunk, p); p += chunk.length; }
  return out;
}

/* ── the workbook ──────────────────────────────────────────────────────── */

// Control characters, U+FFFE/F and lone surrogates are not allowed in XML 1.0 at all; they come from console text (r9-11-5: the one cut, stripControl).
const esc = (s) => escHtml(stripControl(s));

export function colRef(i) {
  let s = '';
  let n = i;
  do { s = String.fromCharCode(65 + (n % 26)) + s; n = Math.floor(n / 26) - 1; } while (n >= 0);
  return s;
}

const sheetName = (s, i) => (String(s || `Sheet${i + 1}`).replace(/[\\/?*[\]:]/g, ' ').trim().slice(0, 31) || `Sheet${i + 1}`);

function cell(ref, v, style) {
  const s = style ? ` s="${style}"` : '';
  if (v == null || v === '') return '';
  if (typeof v === 'number' && Number.isFinite(v)) return `<c r="${ref}"${s}><v>${v}</v></c>`;
  if (typeof v === 'boolean') return `<c r="${ref}" t="b"${s}><v>${v ? 1 : 0}</v></c>`;
  const text = v instanceof Date ? v.toISOString() : String(v);
  return `<c r="${ref}" t="inlineStr"${s}><is><t xml:space="preserve">${esc(text.slice(0, 32000))}</t></is></c>`;
}

function sheetXml({ rows, widths }, rtl = false) {
  const width = Math.max(1, ...rows.map((r) => r.length));
  const cols = Array.from({ length: width }, (_, i) => {
    const w = widths?.[i] ?? Math.min(60, Math.max(8, ...rows.slice(0, 200).map((r) => String(r[i] ?? '').length + 2)));
    return `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`;
  }).join('');
  const body = rows
    .map((r, ri) => {
      const cells = r.map((v, ci) => cell(`${colRef(ci)}${ri + 1}`, v, ri === 0 ? 1 : 0)).join('');
      return `<row r="${ri + 1}">${cells}</row>`;
    })
    .join('');
  const ref = `A1:${colRef(width - 1)}${Math.max(rows.length, 1)}`;
  return (
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">` +
    `<sheetViews><sheetView${rtl ? ' rightToLeft="1"' : ''} workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>` +
    `<cols>${cols}</cols><sheetData>${body}</sheetData>` +
    (rows.length > 1 ? `<autoFilter ref="${ref}"/>` : '') +
    `</worksheet>`
  );
}

const STYLES =
  `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
  `<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">` +
  `<fonts count="2"><font><sz val="11"/><name val="Thmanyah Sans"/></font><font><b/><sz val="11"/><name val="Thmanyah Sans"/></font></fonts>` +
  `<fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills>` +
  `<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>` +
  `<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>` +
  `<cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf>` +
  `<xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/></cellXfs>` +
  `<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>` +
  `</styleSheet>`;

/**
 * `sheets`: `[{ name, rows: any[][], widths?: number[] }]`. The first row of
 * each sheet is its header. `rtl` sets right-to-left sheet view (Arabic documents, T-053); left out, a mostly Arabic sheet is rtl. Returns the workbook bytes.
 * @param {any[]} sheets
 * @param {{ title?: string, when?: Date, rtl?: boolean }} [opts]
 */
/** Mostly Arabic letters across the cells: the sheet reads right to left unless the caller says otherwise. */
const mostlyArabic = (sheets) => {
  let ar = 0, la = 0;
  for (const s of sheets) for (const r of s.rows || []) for (const c of r) {
    const t = String(c ?? '');
    ar += (t.match(/[\u0600-\u06FF]/g) || []).length; la += (t.match(/[A-Za-z]/g) || []).length;
  }
  return ar > 0 && ar >= la;
};

export function buildXlsx(sheets, opts = {}) {
  const { title = '', when = new Date() } = opts;
  const rtl = opts.rtl ?? mostlyArabic(sheets);
  const names = sheets.map((s, i) => sheetName(s.name, i));
  const files = [
    {
      name: '[Content_Types].xml',
      data:
        `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
        `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
        `<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
        `<Default Extension="xml" ContentType="application/xml"/>` +
        `<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>` +
        `<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>` +
        sheets.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('') +
        `<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>` +
        `<Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/>` +
        `</Types>`,
    },
    {
      name: '_rels/.rels',
      data:
        `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
        `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
        `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>` +
        `<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>` +
        `<Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/>` +
        `</Relationships>`,
    },
    {
      name: 'xl/workbook.xml',
      data:
        `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
        `<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">` +
        `<sheets>${names.map((n, i) => `<sheet name="${esc(n)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('')}</sheets>` +
        `</workbook>`,
    },
    {
      name: 'xl/_rels/workbook.xml.rels',
      data:
        `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
        `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
        sheets.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('') +
        `<Relationship Id="rId${sheets.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>` +
        `</Relationships>`,
    },
    { name: 'xl/styles.xml', data: STYLES },
    ...sheets.map((s, i) => ({ name: `xl/worksheets/sheet${i + 1}.xml`, data: sheetXml(s, rtl) })),
    {
      name: 'docProps/core.xml',
      data:
        `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
        `<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">` +
        `<dc:title>${esc(title)}</dc:title><dc:creator>${esc(MAKER.full)}</dc:creator><cp:lastModifiedBy>${esc(MAKER.full)}</cp:lastModifiedBy>` +
        `<dcterms:created xsi:type="dcterms:W3CDTF">${when.toISOString()}</dcterms:created>` +
        `</cp:coreProperties>`,
    },
    {
      name: 'docProps/app.xml',
      data:
        `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
        `<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties"><Application>${esc(MAKER.full)}</Application></Properties>`,
    },
  ];
  return zipStored(files, when);
}

/** Bytes → base64, for a message channel that only carries JSON. */
export function toBase64(bytes) {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

export function fromBase64(b64) {
  const s = atob(b64);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

export const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
