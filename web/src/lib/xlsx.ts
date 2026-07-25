// Minimal, dependency-free .xlsx writer.
//
// `web/` has exactly one runtime dependency (astro) and this keeps it that way:
// SheetJS's npm package is stale with known CVEs and ExcelJS is ~1 MB for a single
// button. An .xlsx is a ZIP of XML parts, and this repo already treats it that way
// (see CLAUDE.md's workbook-reading recipe) — so we write one directly.
//
// Deliberately narrow: it supports exactly what the test-plan workbook needs —
// inline strings, formulas, a shared style table, merged cells, frozen panes,
// autofilter, list data validation, and conditional formatting. It is NOT a general
// spreadsheet library; do not grow it into one.
//
// Compression uses the browser's CompressionStream('deflate-raw'), falling back to
// STORED (no compression) where that is unavailable — both are valid ZIP.

// --- ZIP ------------------------------------------------------------------

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[i] = c >>> 0;
  }
  return t;
})();

function crc32(buf: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

async function deflateRaw(data: Uint8Array): Promise<{ body: Uint8Array; method: number }> {
  if (typeof CompressionStream === 'undefined') return { body: data, method: 0 };
  try {
    const cs = new CompressionStream('deflate-raw');
    const stream = new Blob([data as BlobPart]).stream().pipeThrough(cs);
    const body = new Uint8Array(await new Response(stream).arrayBuffer());
    return { body, method: 8 };
  } catch {
    return { body: data, method: 0 };
  }
}

interface ZipEntry {
  name: string;
  data: Uint8Array;
}

/** Build a ZIP archive from name → content pairs. */
async function zip(files: { name: string; content: string }[]): Promise<Blob> {
  const enc = new TextEncoder();
  const entries: ZipEntry[] = files.map((f) => ({ name: f.name, data: enc.encode(f.content) }));

  const localParts: BlobPart[] = [];
  const centralParts: BlobPart[] = [];
  let offset = 0;

  for (const e of entries) {
    const { body, method } = await deflateRaw(e.data);
    const crc = crc32(e.data);
    const nameBytes = enc.encode(e.name);

    const lfh = new DataView(new ArrayBuffer(30));
    lfh.setUint32(0, 0x04034b50, true);
    lfh.setUint16(4, 20, true); // version needed
    lfh.setUint16(6, 0, true); // flags
    lfh.setUint16(8, method, true);
    lfh.setUint16(10, 0, true); // mod time
    lfh.setUint16(12, 0x21, true); // mod date — fixed, so output is byte-identical run to run
    lfh.setUint32(14, crc, true);
    lfh.setUint32(18, body.length, true);
    lfh.setUint32(22, e.data.length, true);
    lfh.setUint16(26, nameBytes.length, true);
    lfh.setUint16(28, 0, true);
    localParts.push(lfh.buffer, nameBytes, body);

    const cdh = new DataView(new ArrayBuffer(46));
    cdh.setUint32(0, 0x02014b50, true);
    cdh.setUint16(4, 20, true); // version made by
    cdh.setUint16(6, 20, true); // version needed
    cdh.setUint16(8, 0, true);
    cdh.setUint16(10, method, true);
    cdh.setUint16(12, 0, true);
    cdh.setUint16(14, 0x21, true);
    cdh.setUint32(16, crc, true);
    cdh.setUint32(20, body.length, true);
    cdh.setUint32(24, e.data.length, true);
    cdh.setUint16(28, nameBytes.length, true);
    cdh.setUint32(42, offset, true);
    centralParts.push(cdh.buffer, nameBytes);

    offset += 30 + nameBytes.length + body.length;
  }

  const centralSize = centralParts.reduce(
    (n, p) => n + (p instanceof ArrayBuffer ? p.byteLength : (p as Uint8Array).length),
    0,
  );
  const eocd = new DataView(new ArrayBuffer(22));
  eocd.setUint32(0, 0x06054b50, true);
  eocd.setUint16(8, entries.length, true);
  eocd.setUint16(10, entries.length, true);
  eocd.setUint32(12, centralSize, true);
  eocd.setUint32(16, offset, true);

  return new Blob([...localParts, ...centralParts, eocd.buffer], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
}

// --- Cells ----------------------------------------------------------------

export function xmlEscape(s: string): string {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    // Excel rejects most control characters outright.
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, '');
}

/** 0 → A, 25 → Z, 26 → AA. */
export function colName(i: number): string {
  let s = '';
  let n = i;
  do {
    s = String.fromCharCode(65 + (n % 26)) + s;
    n = Math.floor(n / 26) - 1;
  } while (n >= 0);
  return s;
}

export interface Cell {
  /** Text value. Newlines are preserved when the style wraps. */
  v?: string | number;
  /** Formula without the leading '='. Takes precedence over `v`. */
  f?: string;
  /** Index into the style table. */
  s?: number;
  /** Force a numeric cell (default: inline string). */
  num?: boolean;
}

export type Row = (Cell | string | null)[];

export interface SheetSpec {
  name: string;
  rows: Row[];
  /** Column widths, in Excel's character units. */
  cols?: number[];
  /** Rows above this are frozen (1-based; 15 freezes rows 1–14). */
  freezeAtRow?: number;
  /** e.g. "A14:H120" */
  autoFilter?: string;
  merges?: string[];
  validations?: { sqref: string; values: string[] }[];
  /** Conditional formats keyed by dxf index (see DXF_* below). */
  conditionalFormats?: { sqref: string; equals: string; dxf: number }[];
  /** Explicit row heights, keyed by 1-based row number. */
  rowHeights?: Record<number, number>;
}

function cellXml(rowNum: number, colIdx: number, cell: Cell | string | null): string {
  if (cell === null || cell === undefined) return '';
  const c: Cell = typeof cell === 'string' ? { v: cell } : cell;
  const ref = `${colName(colIdx)}${rowNum}`;
  const style = c.s !== undefined ? ` s="${c.s}"` : '';

  if (c.f !== undefined) return `<c r="${ref}"${style}><f>${xmlEscape(c.f)}</f></c>`;
  if (c.v === undefined || c.v === '') return style ? `<c r="${ref}"${style}/>` : '';
  if (c.num || typeof c.v === 'number') return `<c r="${ref}"${style}><v>${c.v}</v></c>`;

  return `<c r="${ref}"${style} t="inlineStr"><is><t xml:space="preserve">${xmlEscape(
    String(c.v),
  )}</t></is></c>`;
}

function sheetXml(s: SheetSpec): string {
  const cols = s.cols?.length
    ? `<cols>${s.cols
        .map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`)
        .join('')}</cols>`
    : '';

  const pane = s.freezeAtRow
    ? `<pane ySplit="${s.freezeAtRow - 1}" topLeftCell="A${s.freezeAtRow}" activePane="bottomLeft" state="frozen"/>` +
      `<selection pane="bottomLeft" activeCell="A${s.freezeAtRow}" sqref="A${s.freezeAtRow}"/>`
    : '';

  const data = s.rows
    .map((row, i) => {
      const n = i + 1;
      // Callers build header blocks by index, which leaves holes; spreading such an
      // array materialises them as undefined. Treat both as an empty row.
      if (!row) return '';
      const cells = row.map((c, j) => cellXml(n, j, c)).join('');
      if (!cells) return '';
      const h = s.rowHeights?.[n];
      const attrs = h ? ` ht="${h}" customHeight="1"` : '';
      return `<row r="${n}"${attrs}>${cells}</row>`;
    })
    .join('');

  const merges = s.merges?.length
    ? `<mergeCells count="${s.merges.length}">${s.merges
        .map((r) => `<mergeCell ref="${r}"/>`)
        .join('')}</mergeCells>`
    : '';

  const cf = (s.conditionalFormats ?? [])
    .map(
      (c, i) =>
        `<conditionalFormatting sqref="${c.sqref}">` +
        `<cfRule type="cellIs" dxfId="${c.dxf}" priority="${i + 1}" operator="equal">` +
        `<formula>"${xmlEscape(c.equals)}"</formula></cfRule></conditionalFormatting>`,
    )
    .join('');

  const dv = s.validations?.length
    ? `<dataValidations count="${s.validations.length}">${s.validations
        .map(
          (v) =>
            `<dataValidation type="list" allowBlank="1" showInputMessage="1" showErrorMessage="1" sqref="${v.sqref}">` +
            `<formula1>"${v.values.join(',')}"</formula1></dataValidation>`,
        )
        .join('')}</dataValidations>`
    : '';

  // Element order matters to Excel: cols → sheetData → mergeCells → conditionalFormatting
  // → dataValidations → autoFilter is NOT the schema order. autoFilter comes before merges.
  return (
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">` +
    `<sheetViews><sheetView workbookViewId="0" showGridLines="0">${pane}</sheetView></sheetViews>` +
    `<sheetFormatPr defaultRowHeight="15"/>` +
    cols +
    `<sheetData>${data}</sheetData>` +
    (s.autoFilter ? `<autoFilter ref="${s.autoFilter}"/>` : '') +
    merges +
    cf +
    dv +
    `<pageMargins left="0.4" right="0.4" top="0.5" bottom="0.5" header="0.3" footer="0.3"/>` +
    `</worksheet>`
  );
}

// --- Styles ---------------------------------------------------------------
//
// Style indices are positional and referenced by name below. If you insert an
// entry, every downstream index shifts — add at the end instead.

export const STYLE = {
  DEFAULT: 0,
  TITLE: 1, // white bold on ITQ royal blue
  LABEL: 2, // bold right-aligned label
  VALUE: 3, // plain value
  HEADER: 4, // column header band
  SECTION: 5, // section band row
  BODY: 6, // wrapped body text, top aligned
  BODY_CENTER: 7, // centred (status / date)
  PERCENT: 8, // 0%
  MONO: 9, // case id
  SUBTITLE: 10, // grey italic
  COUNT: 11, // bold number
} as const;

export const DXF = { PASS: 0, FAIL_CRITICAL: 1, FAIL_MINOR: 2, NA: 3 } as const;

const STYLES_XML =
  `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
  `<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">` +
  `<numFmts count="1"><numFmt numFmtId="164" formatCode="0%"/></numFmts>` +
  `<fonts count="7">` +
  `<font><sz val="11"/><name val="Calibri"/></font>` + // 0 default
  `<font><b/><sz val="14"/><color rgb="FFFFFFFF"/><name val="Calibri"/></font>` + // 1 title
  `<font><b/><sz val="11"/><name val="Calibri"/></font>` + // 2 bold
  `<font><b/><sz val="11"/><color rgb="FF10069F"/><name val="Calibri"/></font>` + // 3 bold blue
  `<font><i/><sz val="10"/><color rgb="FF6B7280"/><name val="Calibri"/></font>` + // 4 grey italic
  `<font><sz val="10"/><color rgb="FF374151"/><name val="Consolas"/></font>` + // 5 mono
  `<font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Calibri"/></font>` + // 6 bold white
  `</fonts>` +
  `<fills count="6">` +
  `<fill><patternFill patternType="none"/></fill>` + // 0
  `<fill><patternFill patternType="gray125"/></fill>` + // 1 (required by the schema)
  `<fill><patternFill patternType="solid"><fgColor rgb="FF10069F"/><bgColor indexed="64"/></patternFill></fill>` + // 2 ITQ royal blue
  `<fill><patternFill patternType="solid"><fgColor rgb="FFE5E7EB"/><bgColor indexed="64"/></patternFill></fill>` + // 3 light grey
  `<fill><patternFill patternType="solid"><fgColor rgb="FF374151"/><bgColor indexed="64"/></patternFill></fill>` + // 4 header dark
  `<fill><patternFill patternType="solid"><fgColor rgb="FFF3F4F6"/><bgColor indexed="64"/></patternFill></fill>` + // 5 very light
  `</fills>` +
  `<borders count="2">` +
  `<border><left/><right/><top/><bottom/><diagonal/></border>` +
  `<border><left style="thin"><color rgb="FFD1D5DB"/></left><right style="thin"><color rgb="FFD1D5DB"/></right>` +
  `<top style="thin"><color rgb="FFD1D5DB"/></top><bottom style="thin"><color rgb="FFD1D5DB"/></bottom><diagonal/></border>` +
  `</borders>` +
  `<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>` +
  `<cellXfs count="12">` +
  `<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>` + // 0 DEFAULT
  `<xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1" applyAlignment="1"><alignment vertical="center" indent="1"/></xf>` + // 1 TITLE
  `<xf numFmtId="0" fontId="2" fillId="0" borderId="0" xfId="0" applyFont="1" applyAlignment="1"><alignment horizontal="right" vertical="center"/></xf>` + // 2 LABEL
  `<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0" applyAlignment="1"><alignment vertical="center"/></xf>` + // 3 VALUE
  `<xf numFmtId="0" fontId="6" fillId="4" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf>` + // 4 HEADER
  `<xf numFmtId="0" fontId="3" fillId="3" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment vertical="center" indent="1"/></xf>` + // 5 SECTION
  `<xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyBorder="1" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf>` + // 6 BODY
  `<xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="top"/></xf>` + // 7 BODY_CENTER
  `<xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1" applyAlignment="1"><alignment horizontal="left"/></xf>` + // 8 PERCENT
  `<xf numFmtId="0" fontId="5" fillId="0" borderId="1" xfId="0" applyFont="1" applyBorder="1" applyAlignment="1"><alignment vertical="top"/></xf>` + // 9 MONO
  `<xf numFmtId="0" fontId="4" fillId="0" borderId="0" xfId="0" applyFont="1" applyAlignment="1"><alignment vertical="center" wrapText="1"/></xf>` + // 10 SUBTITLE
  `<xf numFmtId="0" fontId="2" fillId="0" borderId="0" xfId="0" applyFont="1" applyAlignment="1"><alignment horizontal="left"/></xf>` + // 11 COUNT
  `</cellXfs>` +
  `<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>` +
  // Conditional-format differentials, referenced by DXF above.
  `<dxfs count="4">` +
  `<dxf><font><color rgb="FF166534"/></font><fill><patternFill><bgColor rgb="FFDCFCE7"/></patternFill></fill></dxf>` + // PASS
  `<dxf><font><b/><color rgb="FF991B1B"/></font><fill><patternFill><bgColor rgb="FFFEE2E2"/></patternFill></fill></dxf>` + // FAIL_CRITICAL
  `<dxf><font><color rgb="FF9A3412"/></font><fill><patternFill><bgColor rgb="FFFFEDD5"/></patternFill></fill></dxf>` + // FAIL_MINOR
  `<dxf><font><color rgb="FF6B7280"/></font><fill><patternFill><bgColor rgb="FFF3F4F6"/></patternFill></fill></dxf>` + // NA
  `</dxfs>` +
  `</styleSheet>`;

// --- Workbook -------------------------------------------------------------

/** Excel forbids : \ / ? * [ ] in sheet names and caps them at 31 characters. */
export function safeSheetName(name: string, taken: Set<string>): string {
  let base = name.replace(/[:\\/?*[\]]/g, '-').slice(0, 31) || 'Sheet';
  let out = base;
  let n = 2;
  while (taken.has(out.toLowerCase())) {
    const suffix = ` (${n++})`;
    out = base.slice(0, 31 - suffix.length) + suffix;
  }
  taken.add(out.toLowerCase());
  return out;
}

export async function buildXlsx(sheets: SheetSpec[]): Promise<Blob> {
  const files: { name: string; content: string }[] = [
    {
      name: '[Content_Types].xml',
      content:
        `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
        `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
        `<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
        `<Default Extension="xml" ContentType="application/xml"/>` +
        `<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>` +
        `<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>` +
        sheets
          .map(
            (_, i) =>
              `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`,
          )
          .join('') +
        `</Types>`,
    },
    {
      name: '_rels/.rels',
      content:
        `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
        `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
        `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>` +
        `</Relationships>`,
    },
    {
      name: 'xl/workbook.xml',
      content:
        `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
        `<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">` +
        `<sheets>` +
        sheets
          .map((s, i) => `<sheet name="${xmlEscape(s.name)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`)
          .join('') +
        `</sheets></workbook>`,
    },
    {
      name: 'xl/_rels/workbook.xml.rels',
      content:
        `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
        `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
        sheets
          .map(
            (_, i) =>
              `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`,
          )
          .join('') +
        `<Relationship Id="rIdStyles" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>` +
        `</Relationships>`,
    },
    { name: 'xl/styles.xml', content: STYLES_XML },
    ...sheets.map((s, i) => ({ name: `xl/worksheets/sheet${i + 1}.xml`, content: sheetXml(s) })),
  ];

  return zip(files);
}
