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

/* ── STYLES & CATEGORIZATION ──────────────────────────────────────────────── */

/**
 * Maps each record field to a distinct functional category color group.
 * Group 1: Identity & Timestamps (#1E293B - Slate Navy)
 * Group 2: Device & System       (#0F766E - Deep Teal)
 * Group 3: Operator & Network    (#1D4ED8 - Telecom Blue)
 * Group 4: Location & Address    (#047857 - Emerald Green)
 * Group 5: Cellular Radio RF     (#B45309 - Bronze Amber)
 * Group 6: Speed & Latency       (#B91C1C - Unitel Red)
 * Group 7: Web & Video KPIs      (#C2410C - Warm Coral)
 * Group 8: QoE Scores & Extended (#0E7490 - Deep Cyan)
 *
 * @param {string} field
 * @returns {number} style index 1..8
 */
export function fieldHeaderStyle(field) {
  if (["TEST_ID", "DATETIME_UTC", "START_DATETIME_UTC", "TEST_TYPE"].includes(field)) {
    return 1;
  }
  if (["APP_PLATFORM", "APP_VERSION", "DEVICE_HWBRAND", "DEVICE_HWMODEL", "OS_NAME", "OS_VERSION", "ISDN"].includes(field)) {
    return 2;
  }
  if (field.startsWith("ISP") || field.startsWith("MOBILE_ISP") || field.startsWith("MOBILE_OPERATOR") ||
      field.startsWith("IPV") || field.startsWith("NET_") || field.startsWith("MEASUREMENT_")) {
    return 3;
  }
  if (field.startsWith("LOCATION_")) {
    return 4;
  }
  if (field.startsWith("MOBILE_CELL_") || field.startsWith("MOBILE_TAC") || field.startsWith("MOBILE_PCI") ||
      field.startsWith("MOBILE_RSSI_") || field.startsWith("MOBILE_RSRP_") || field.startsWith("MOBILE_RSRQ_") ||
      field.startsWith("MOBILE_RSSNR_")) {
    return 5;
  }
  if (field.startsWith("SPEED_") || field.startsWith("BYTES_") || field.startsWith("PROBE_")) {
    return 6;
  }
  if (field.startsWith("BROWSE_") || field.startsWith("STREAM_") || field.startsWith("SETUP_")) {
    return 7;
  }
  if (field.startsWith("QOE_") || field.startsWith("BROWSING_") || field.startsWith("STREAMING_")) {
    return 8;
  }
  return 1;
}

/**
 * Natural alignment for data values.
 *
 * @param {string} field
 * @returns {"left"|"center"|"right"}
 */
export function fieldAlignment(field) {
  if (
    field.startsWith("SPEED_DOWNLOAD_") ||
    field.startsWith("SPEED_UPLOAD_") ||
    field.startsWith("SPEED_LATENCY_") ||
    field.startsWith("BYTES_") ||
    field.startsWith("PROBE_") ||
    field === "BROWSE_TIME" ||
    field === "BROWSE_BYTES" ||
    field.startsWith("STREAM_PRELOADING_") ||
    field.startsWith("STREAM_REBUFFERING_") ||
    field.startsWith("STREAM_REBUFFER_") ||
    field.startsWith("STREAM_QUALITY_") ||
    field.startsWith("SETUP_") ||
    field === "LOCATION_LAT" ||
    field === "LOCATION_LNG" ||
    field === "LOCATION_ACCURACY" ||
    field.endsWith("_SCORE") ||
    field.endsWith("_COUNT") ||
    field.endsWith("_DURATION") ||
    field.endsWith("_RATIO") ||
    field.endsWith("_MBPS")
  ) {
    return "right";
  }

  if (
    field.startsWith("TEST_") ||
    field.includes("DATETIME") ||
    field.startsWith("APP_") ||
    field.startsWith("OS_") ||
    field === "ISDN" ||
    field.startsWith("IPV") ||
    field.startsWith("NET_TYPE") ||
    field.startsWith("NET_CELL_GEN") ||
    field.startsWith("NET_NAME") ||
    field.startsWith("NET_SOURCE") ||
    field === "MEASUREMENT_VALID" ||
    field.endsWith("_STATUS") ||
    field.endsWith("_GRADE") ||
    field === "STREAM_QUALITY" ||
    field === "STREAMING_HIGHEST_QUALITY"
  ) {
    return "center";
  }

  return "left";
}

/**
 * Assigns cell style index:
 * Even row (white): left=9, center=10, right=11
 * Odd row (zebra):  left=12, center=13, right=14
 *
 * @param {string} field
 * @param {number} rowIndex 1-indexed Excel row
 * @returns {number}
 */
export function dataCellStyle(field, rowIndex) {
  const isZebra = rowIndex % 2 === 1; // row 2 even (white), row 3 odd (zebra)
  const align = fieldAlignment(field);
  if (!isZebra) {
    if (align === "left") return 9;
    if (align === "center") return 10;
    return 11;
  } else {
    if (align === "left") return 12;
    if (align === "center") return 13;
    return 14;
  }
}

export const STYLES_XML =
  '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
  '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
  '<fonts count="2">' +
    '<font>' +
      '<sz val="10"/>' +
      '<color rgb="FF1E293B"/>' +
      '<name val="Calibri"/>' +
      '<family val="2"/>' +
    '</font>' +
    '<font>' +
      '<b/>' +
      '<sz val="10"/>' +
      '<color rgb="FFFFFFFF"/>' +
      '<name val="Calibri"/>' +
      '<family val="2"/>' +
    '</font>' +
  '</fonts>' +
  '<fills count="11">' +
    '<fill><patternFill patternType="none"/></fill>' +
    '<fill><patternFill patternType="gray125"/></fill>' +
    '<fill><patternFill patternType="solid"><fgColor rgb="FFF8FAFC"/><bgColor indexed="64"/></patternFill></fill>' +
    '<fill><patternFill patternType="solid"><fgColor rgb="FF1E293B"/><bgColor indexed="64"/></patternFill></fill>' +
    '<fill><patternFill patternType="solid"><fgColor rgb="FF0F766E"/><bgColor indexed="64"/></patternFill></fill>' +
    '<fill><patternFill patternType="solid"><fgColor rgb="FF1D4ED8"/><bgColor indexed="64"/></patternFill></fill>' +
    '<fill><patternFill patternType="solid"><fgColor rgb="FF047857"/><bgColor indexed="64"/></patternFill></fill>' +
    '<fill><patternFill patternType="solid"><fgColor rgb="FFB45309"/><bgColor indexed="64"/></patternFill></fill>' +
    '<fill><patternFill patternType="solid"><fgColor rgb="FFB91C1C"/><bgColor indexed="64"/></patternFill></fill>' +
    '<fill><patternFill patternType="solid"><fgColor rgb="FFC2410C"/><bgColor indexed="64"/></patternFill></fill>' +
    '<fill><patternFill patternType="solid"><fgColor rgb="FF0E7490"/><bgColor indexed="64"/></patternFill></fill>' +
  '</fills>' +
  '<borders count="3">' +
    '<border><left/><right/><top/><bottom/><diagonal/></border>' +
    '<border>' +
      '<left style="thin"><color rgb="FF475569"/></left>' +
      '<right style="thin"><color rgb="FF475569"/></right>' +
      '<top style="thin"><color rgb="FF475569"/></top>' +
      '<bottom style="medium"><color rgb="FF0F172A"/></bottom>' +
      '<diagonal/>' +
    '</border>' +
    '<border>' +
      '<left style="thin"><color rgb="FFE2E8F0"/></left>' +
      '<right style="thin"><color rgb="FFE2E8F0"/></right>' +
      '<top style="thin"><color rgb="FFE2E8F0"/></top>' +
      '<bottom style="thin"><color rgb="FFE2E8F0"/></bottom>' +
      '<diagonal/>' +
    '</border>' +
  '</borders>' +
  '<cellStyleXfs count="1">' +
    '<xf numFmtId="0" fontId="0" fillId="0" borderId="0"/>' +
  '</cellStyleXfs>' +
  '<cellXfs count="15">' +
    '<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>' +
    '<xf numFmtId="0" fontId="1" fillId="3" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf>' +
    '<xf numFmtId="0" fontId="1" fillId="4" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf>' +
    '<xf numFmtId="0" fontId="1" fillId="5" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf>' +
    '<xf numFmtId="0" fontId="1" fillId="6" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf>' +
    '<xf numFmtId="0" fontId="1" fillId="7" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf>' +
    '<xf numFmtId="0" fontId="1" fillId="8" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf>' +
    '<xf numFmtId="0" fontId="1" fillId="9" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf>' +
    '<xf numFmtId="0" fontId="1" fillId="10" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf>' +
    '<xf numFmtId="0" fontId="0" fillId="0" borderId="2" xfId="0" applyFont="1" applyBorder="1" applyAlignment="1"><alignment horizontal="left" vertical="center"/></xf>' +
    '<xf numFmtId="0" fontId="0" fillId="0" borderId="2" xfId="0" applyFont="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>' +
    '<xf numFmtId="0" fontId="0" fillId="0" borderId="2" xfId="0" applyFont="1" applyBorder="1" applyAlignment="1"><alignment horizontal="right" vertical="center"/></xf>' +
    '<xf numFmtId="0" fontId="0" fillId="2" borderId="2" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="left" vertical="center"/></xf>' +
    '<xf numFmtId="0" fontId="0" fillId="2" borderId="2" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>' +
    '<xf numFmtId="0" fontId="0" fillId="2" borderId="2" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="right" vertical="center"/></xf>' +
  '</cellXfs>' +
  '<cellStyles count="1">' +
    '<cellStyle name="Normal" xfId="0" builtinId="0"/>' +
  '</cellStyles>' +
  '</styleSheet>';

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

/**
 * Computes custom column widths dynamically based on header text length
 * and sampled record contents to ensure no text is squeezed or truncated.
 *
 * @param {string[]} fields
 * @param {object[]} [records]
 * @returns {number[]}
 */
export function computeColWidths(fields, records) {
  return fields.map((field) => {
    let maxLen = field.length;
    if (records && records.length > 0) {
      const sample = records.slice(0, 100);
      for (const rec of sample) {
        if (!rec) continue;
        const v = rec[field];
        if (v !== null && v !== undefined) {
          const s = String(v);
          if (s.length > maxLen) maxLen = s.length;
        }
      }
    }
    let w = Math.min(Math.max(maxLen + 4, 13), 50);
    if (field === "LOCATION_FULL_ADDRESS") w = Math.max(w, 45);
    if (field === "TEST_ID") w = Math.max(w, 28);
    if (field.includes("DATETIME")) w = Math.max(w, 25);
    if (field === "SPEED_SERVER_POOL_NAME") w = Math.max(w, 28);
    return w;
  });
}

/*
  One cell, typed and styled.

  null writes NO cell at all. An omitted cell is genuinely empty in the file
  format, which is the same absent-is-not-zero rule the records and the CSV
  follow - an empty cell, never a 0 and never the word "null".

  Everything that is not a number or a boolean is written as an inline string,
  including things that look numeric. That is the entire point: ISDN and TEST_ID
  are strings in the record, and forcing them through as text is what stops
  Excel from rewriting them.
*/
function cell(ref, value, styleId) {
  if (value === null || value === undefined) return "";
  const sAttr = styleId !== undefined && styleId !== null ? ' s="' + styleId + '"' : "";
  if (typeof value === "number") {
    if (!Number.isFinite(value)) return "";
    return '<c r="' + ref + '"' + sAttr + '><v>' + value + "</v></c>";
  }
  if (typeof value === "boolean") {
    return '<c r="' + ref + '"' + sAttr + ' t="b"><v>' + (value ? 1 : 0) + "</v></c>";
  }
  const text = escapeXml(value);
  if (text === "") return "";
  /* xml:space="preserve" so a value that is meaningfully padded survives. */
  return (
    '<c r="' + ref + '"' + sAttr + ' t="inlineStr"><is><t xml:space="preserve">' + text + "</t></is></c>"
  );
}

/**
 * The worksheet XML for a header row plus one row per record,
 * complete with frozen panes, custom column widths, category colors, and autofilter.
 *
 * @param {string[]} fields column order
 * @param {object[]} records
 * @returns {string}
 */
export function sheetXml(fields, records) {
  const colWidths = computeColWidths(fields, records);
  const cols = colWidths
    .map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`)
    .join("");

  const rows = [];

  const header = fields
    .map((field, i) => cell(columnName(i) + "1", field, fieldHeaderStyle(field)))
    .join("");
  rows.push('<row r="1" ht="28" customHeight="1">' + header + "</row>");

  let r = 2;
  for (const record of records || []) {
    const cells = fields
      .map((field, i) => cell(columnName(i) + r, record ? record[field] : null, dataCellStyle(field, r)))
      .join("");
    rows.push('<row r="' + r + '" ht="20" customHeight="1">' + cells + "</row>");
    r++;
  }

  const lastCol = columnName(fields.length - 1);
  const lastRow = Math.max(1, (records ? records.length : 0) + 1);
  const autoFilter = `<autoFilter ref="A1:${lastCol}${lastRow}"/>`;

  return (
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
    '<sheetViews>' +
      '<sheetView tabSelected="1" workbookViewId="0">' +
        '<pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/>' +
      '</sheetView>' +
    '</sheetViews>' +
    '<sheetFormatPr defaultRowHeight="20" baseColWidth="12"/>' +
    '<cols>' + cols + '</cols>' +
    '<sheetData>' +
    rows.join("") +
    '</sheetData>' +
    autoFilter +
    '</worksheet>'
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
  '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>' +
  '</Types>';

const ROOT_RELS =
  '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
  '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
  '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>' +
  '</Relationships>';

const WORKBOOK =
  '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
  '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" ' +
  'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
  '<sheets><sheet name="Measurements" sheetId="1" r:id="rId1"/></sheets>' +
  '</workbook>';

const WORKBOOK_RELS =
  '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
  '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
  '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>' +
  '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>' +
  '</Relationships>';

/**
 * The records as .xlsx bytes, in RECORD_FIELDS order - with professional
 * category color headers, column widths, freeze panes, borders, and zebra rows.
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
    { name: "xl/styles.xml", data: encoder.encode(STYLES_XML) },
    {
      name: "xl/worksheets/sheet1.xml",
      data: encoder.encode(sheetXml(RECORD_FIELDS, records))
    }
  ]);
}

export const XLSX_MIME =
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

