import { describe, expect, it } from "vitest";

import {
  columnName,
  crc32,
  escapeXml,
  recordsToXlsx,
  sheetXml,
  zipStore
} from "../../ui/src/report/xlsx.js";
import { RECORD_FIELDS } from "../../ui/src/measurement/record.js";

const encoder = new TextEncoder();

/*
  The export is the handover artefact: what the partner opens is this file, so a
  fault here is a fault in the deliverable itself. What is pinned below is the
  container being a real ZIP, the columns landing where they say they do, and the
  cell typing that is the entire reason this exists alongside the CSV.
*/

describe("crc32", () => {
  /* The check value every CRC-32 implementation is tested against. If this is
     wrong, Excel rejects the archive outright. */
  it("matches the standard check value", () => {
    expect(crc32(encoder.encode("123456789"))).toBe(0xcbf43926);
  });

  it("is 0 for no bytes", () => {
    expect(crc32(new Uint8Array(0))).toBe(0);
  });
});

describe("columnName", () => {
  /*
    The record has more than 26 columns, so the wrap runs on every single
    export. An off-by-one here shifts every value one column sideways in a file
    that still opens perfectly.
  */
  it("wraps past Z the way a spreadsheet does", () => {
    expect(columnName(0)).toBe("A");
    expect(columnName(25)).toBe("Z");
    expect(columnName(26)).toBe("AA");
    expect(columnName(27)).toBe("AB");
    expect(columnName(51)).toBe("AZ");
    expect(columnName(52)).toBe("BA");
  });

  it("gives every record column a distinct reference", () => {
    const names = RECORD_FIELDS.map((_, i) => columnName(i));
    expect(new Set(names).size).toBe(RECORD_FIELDS.length);
  });
});

describe("escapeXml", () => {
  it("escapes the characters that would break the document", () => {
    expect(escapeXml('a & b < c > d')).toBe("a &amp; b &lt; c &gt; d");
  });

  /* A control character makes the whole file unopenable, and server and ISP
     names come off the network. */
  it("drops control characters but keeps tab and newline", () => {
    expect(escapeXml("a\u0000b\u0007c")).toBe("abc");
    expect(escapeXml("a\tb\nc\rd")).toBe("a\tb\nc\rd");
  });
});

describe("cell typing", () => {
  const xml = (records) => sheetXml(["ISDN", "SPEED_DOWNLOAD_AVG", "MEASUREMENT_VALID"], records);

  /*
    The reason this format exists. As CSV, Excel reads 02012345678 as a number
    and hands back 2012345678 - and the subscriber number is how operations ties
    a result to a line.
  */
  it("writes a numeric-looking string as text, preserving a leading zero", () => {
    const out = xml([{ ISDN: "02012345678" }]);
    expect(out).toContain('t="inlineStr"');
    expect(out).toContain("02012345678");
  });

  it("writes a number as a number", () => {
    const out = xml([{ SPEED_DOWNLOAD_AVG: 23400 }]);
    expect(out).toContain('<c r="B2"><v>23400</v></c>');
  });

  it("writes a boolean as a boolean", () => {
    expect(xml([{ MEASUREMENT_VALID: true }])).toContain('<c r="C2" t="b"><v>1</v></c>');
    expect(xml([{ MEASUREMENT_VALID: false }])).toContain('<c r="C2" t="b"><v>0</v></c>');
  });

  /*
    Absent is not zero, carried into the spreadsheet: a null writes no cell at
    all, which is genuinely empty - not a 0, and not the word "null".
  */
  it("writes no cell for a null, and a zero for a measured zero", () => {
    const absent = xml([{ ISDN: null, SPEED_DOWNLOAD_AVG: null }]);
    expect(absent).toContain('<row r="2"></row>');

    const measured = xml([{ SPEED_DOWNLOAD_AVG: 0 }]);
    expect(measured).toContain('<c r="B2"><v>0</v></c>');
  });

  it("puts the field names in row 1, in order", () => {
    const out = xml([]);
    expect(out).toContain('<c r="A1" t="inlineStr"><is><t xml:space="preserve">ISDN</t></is></c>');
    expect(out).toContain("SPEED_DOWNLOAD_AVG");
  });
});

describe("zip container", () => {
  it("starts with the local file header signature", () => {
    const zip = zipStore([{ name: "a.txt", data: encoder.encode("hello") }]);
    expect(Array.from(zip.slice(0, 4))).toEqual([0x50, 0x4b, 0x03, 0x04]);
  });

  it("ends with an end-of-central-directory record counting the entries", () => {
    const zip = zipStore([
      { name: "a.txt", data: encoder.encode("hello") },
      { name: "b.txt", data: encoder.encode("world") }
    ]);
    const end = zip.length - 22;
    const view = new DataView(zip.buffer, zip.byteOffset);
    expect(view.getUint32(end, true)).toBe(0x06054b50);
    expect(view.getUint16(end + 8, true)).toBe(2);
  });

  /* Stored, not deflated - so the payload is in the archive verbatim. */
  it("stores the payload uncompressed", () => {
    const zip = zipStore([{ name: "a.txt", data: encoder.encode("hello") }]);
    expect(new TextDecoder().decode(zip)).toContain("hello");
  });
});

describe("workbook", () => {
  const record = () => ({
    TEST_ID: "abc123",
    ISDN: "02012345678",
    SPEED_DOWNLOAD_AVG: 23400,
    MEASUREMENT_VALID: true,
    LOCATION_LAT: null
  });

  it("contains the five parts a reader needs to open it", () => {
    const text = new TextDecoder().decode(recordsToXlsx([record()]));
    for (const part of [
      "[Content_Types].xml",
      "_rels/.rels",
      "xl/workbook.xml",
      "xl/_rels/workbook.xml.rels",
      "xl/worksheets/sheet1.xml"
    ]) {
      expect(text, part).toContain(part);
    }
  });

  /* The same columns and the same order as the CSV: one export, two formats. */
  it("uses the record field order", () => {
    const text = new TextDecoder().decode(recordsToXlsx([]));
    const first = columnName(0) + "1";
    expect(text).toContain('<c r="' + first + '" t="inlineStr"><is><t xml:space="preserve">' + RECORD_FIELDS[0]);
  });

  it("is byte-identical for the same records", () => {
    const a = recordsToXlsx([record()]);
    const b = recordsToXlsx([record()]);
    expect(Array.from(a)).toEqual(Array.from(b));
  });
});
