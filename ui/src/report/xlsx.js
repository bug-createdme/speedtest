import { RECORD_FIELDS } from "../measurement/record.js";

/*
  The records as a real .xlsx, written by hand.

  ── WHY, WHEN THERE IS ALREADY A CSV ────────────────────────────────────────

  Because Excel does not read a CSV, it re-interprets one, and every
  re-interpretation here is a silent corruption of the handover file:

  - ISDN "02012345678" is parsed as a number and comes back 2012345678. The
    subscriber number is how operations ties a result to a line; losing the
    leading zero breaks exactly that.
  - A long TEST_ID turns into 1.23457E+14, which is not reversible.
  - An ISO timestamp is re-parsed against whatever the machine's locale thinks
    day and month are - so 2026-08-27 can silently become another date.
  - In a locale whose Excel list separator is ";" - which includes the ones this
    file is opened in - a comma CSV lands entirely in column A.

  None of those announce themselves. A cell in an .xlsx carries its own type, so
  text stays text and a number stays a number no matter where the file is opened.

  ── WHY NO LIBRARY ──────────────────────────────────────────────────────────

  SheetJS and exceljs both solve this, and both cost more than the whole
  application: the bundle was cut from 441 KB to 120 KB by removing one debug
  tool (CHANGE-001), and a full spreadsheet library is itself several hundred
  kilobytes - undoing that saving for a feature used once a day. What is below
  adds single-digit kilobytes.

  An .xlsx is a ZIP of five small XML files. Written with the STORE method - no
  compression - the container needs a CRC-32 and some little-endian headers, and
  nothing else. The records are small; the size lost to not compressing is far
  less than the size lost to bundling a library that compresses.
*/

/* ── ZIP ──────────────────────────────────────────────────────────────────── */

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[i] = c >>> 0;
  }
  return table;
})();

/** Standard CRC-32, the checksum every ZIP entry carries. */
export function crc32(bytes) {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) {
    c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

const encoder = new TextEncoder();

/*
  Every entry is stamped 1980-01-01, the zero of the DOS timestamp a ZIP uses.

  Deliberately not the current time: nothing reads this date - the file's own
  timestamp on disk is what a person sees - and a constant makes the same
  records produce byte-identical output, which is what lets a test assert on the
  container at all.
*/
const DOS_TIME = 0;
const DOS_DATE = 33; // ((1980-1980) << 9) | (1 << 5) | 1

/**
 * Pack entries into a ZIP with the STORE method.
 *
 * @param {Array<{name: string, data: Uint8Array}>} entries
 * @returns {Uint8Array}
 */
export function zipStore(entries) {
  const parts = [];
  const central = [];
  let offset = 0;

  for (const entry of entries) {
    const name = encoder.encode(entry.name);
    const data = entry.data;
    const sum = crc32(data);

    const local = new Uint8Array(30 + name.length);
    const lv = new DataView(local.buffer);
    lv.setUint32(0, 0x04034b50, true); // local file header
    lv.setUint16(4, 20, true); // version needed
    lv.setUint16(6, 0x0800, true); // flag bit 11: the name is UTF-8
    lv.setUint16(8, 0, true); // method 0 = stored
    lv.setUint16(10, DOS_TIME, true);
    lv.setUint16(12, DOS_DATE, true);
    lv.setUint32(14, sum, true);
    lv.setUint32(18, data.length, true); // compressed size
    lv.setUint32(22, data.length, true); // uncompressed size
    lv.setUint16(26, name.length, true);
    lv.setUint16(28, 0, true); // no extra field
    local.set(name, 30);

    const dir = new Uint8Array(46 + name.length);
    const dv = new DataView(dir.buffer);
    dv.setUint32(0, 0x02014b50, true); // central directory header
    dv.setUint16(4, 20, true); // version made by
    dv.setUint16(6, 20, true); // version needed
    dv.setUint16(8, 0x0800, true);
    dv.setUint16(10, 0, true);
    dv.setUint16(12, DOS_TIME, true);
    dv.setUint16(14, DOS_DATE, true);
    dv.setUint32(16, sum, true);
    dv.setUint32(20, data.length, true);
    dv.setUint32(24, data.length, true);
    dv.setUint16(28, name.length, true);
    dv.setUint32(42, offset, true); // where the local header sits
    dir.set(name, 46);

    parts.push(local, data);
    central.push(dir);
    offset += local.length + data.length;
  }

  const centralSize = central.reduce((n, d) => n + d.length, 0);
  const end = new Uint8Array(22);
  const ev = new DataView(end.buffer);
  ev.setUint32(0, 0x06054b50, true); // end of central directory
  ev.setUint16(8, entries.length, true);
  ev.setUint16(10, entries.length, true);
  ev.setUint32(12, centralSize, true);
  ev.setUint32(16, offset, true);

  const all = [...parts, ...central, end];
  const total = all.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(total);
  let at = 0;
  for (const part of all) {
    out.set(part, at);
    at += part.length;
  }
  return out;
}

/* ── SHEET ────────────────────────────────────────────────────────────────── */

/**
 * Column letters for a zero-based index: 0 -> A, 25 -> Z, 26 -> AA.
 *
 * Worth its own function and its own test: the record has more than 26 columns,
 * so the wrap is exercised by every export, and an off-by-one there shifts every
 * value into the wrong column while still opening cleanly.
 */
export function columnName(index) {
  let n = index;
  let name = "";
  do {
    name = String.fromCharCode(65 + (n % 26)) + name;
    n = Math.floor(n / 26) - 1;
  } while (n >= 0);
  return name;
}

/*
  XML 1.0 forbids most control characters outright - a file containing one does
  not open at all. An ISP or server name arrives from the network, so it is not
  ours to trust.
*/
export function escapeXml(value) {
  return String(value)
    /* Tab, newline and carriage return are the only control characters XML 1.0
       permits; everything below 0x20 apart from those is dropped - a file that
       contains one does not open at all. */
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/*
  One cell, typed.

  null writes NO cell at all. An omitted cell is genuinely empty in the file
  format, which is the same absent-is-not-zero rule the records and the CSV
  follow - an empty cell, never a 0 and never the word "null".

  Everything that is not a number or a boolean is written as an inline string,
  including things that look numeric. That is the entire point: ISDN and TEST_ID
  are strings in the record, and forcing them through as text is what stops
  Excel from rewriting them.
*/
function cell(ref, value) {
  if (value === null || value === undefined) return "";
  if (typeof value === "number") {
    if (!Number.isFinite(value)) return "";
    return '<c r="' + ref + '"><v>' + value + "</v></c>";
  }
  if (typeof value === "boolean") {
    return '<c r="' + ref + '" t="b"><v>' + (value ? 1 : 0) + "</v></c>";
  }
  const text = escapeXml(value);
  if (text === "") return "";
  /* xml:space="preserve" so a value that is meaningfully padded survives. */
  return (
    '<c r="' + ref + '" t="inlineStr"><is><t xml:space="preserve">' + text + "</t></is></c>"
  );
}

/**
 * The worksheet XML for a header row plus one row per record.
 *
 * @param {string[]} fields column order
 * @param {object[]} records
 * @returns {string}
 */
export function sheetXml(fields, records) {
  const rows = [];

  const header = fields
    .map((field, i) => cell(columnName(i) + "1", field))
    .join("");
  rows.push('<row r="1">' + header + "</row>");

  let r = 2;
  for (const record of records || []) {
    const cells = fields
      .map((field, i) => cell(columnName(i) + r, record ? record[field] : null))
      .join("");
    rows.push('<row r="' + r + '">' + cells + "</row>");
    r++;
  }

  return (
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
    "<sheetData>" +
    rows.join("") +
    "</sheetData></worksheet>"
  );
}

/* ── WORKBOOK ─────────────────────────────────────────────────────────────── */

const CONTENT_TYPES =
  '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
  '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
  '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
  '<Default Extension="xml" ContentType="application/xml"/>' +
  '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
  '<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>' +
  "</Types>";

const ROOT_RELS =
  '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
  '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
  '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>' +
  "</Relationships>";

const WORKBOOK =
  '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
  '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" ' +
  'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
  '<sheets><sheet name="Measurements" sheetId="1" r:id="rId1"/></sheets>' +
  "</workbook>";

const WORKBOOK_RELS =
  '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
  '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
  '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>' +
  "</Relationships>";

/**
 * The records as .xlsx bytes, in RECORD_FIELDS order - the same columns and the
 * same order as the CSV, so the two files are the same export in two formats.
 *
 * @param {object[]} records
 * @returns {Uint8Array}
 */
export function recordsToXlsx(records) {
  return zipStore([
    { name: "[Content_Types].xml", data: encoder.encode(CONTENT_TYPES) },
    { name: "_rels/.rels", data: encoder.encode(ROOT_RELS) },
    { name: "xl/workbook.xml", data: encoder.encode(WORKBOOK) },
    { name: "xl/_rels/workbook.xml.rels", data: encoder.encode(WORKBOOK_RELS) },
    {
      name: "xl/worksheets/sheet1.xml",
      data: encoder.encode(sheetXml(RECORD_FIELDS, records))
    }
  ]);
}

export const XLSX_MIME =
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
