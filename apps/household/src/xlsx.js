// xlsx.js — a small writer for the one spreadsheet this app downloads.
//
// SheetJS would do this, and it would also add a few hundred kilobytes to
// every visit for a button most sittings never press. An .xlsx file is a zip
// of XML, and Excel opens one whose parts are stored rather than deflated,
// so the writer is a CRC, a zip envelope, and the sheets.

const encoder = new TextEncoder();

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(bytes) {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

class Bin {
  constructor() { this.parts = []; this.len = 0; }
  u16(n) { this.raw([(n) & 255, (n >>> 8) & 255]); }
  u32(n) {
    const v = n >>> 0;
    this.raw([v & 255, (v >>> 8) & 255, (v >>> 16) & 255, (v >>> 24) & 255]);
  }
  raw(bytes) {
    const chunk = bytes instanceof Uint8Array ? bytes : Uint8Array.from(bytes);
    this.parts.push(chunk);
    this.len += chunk.length;
  }
  bytes() {
    const out = new Uint8Array(this.len);
    let offset = 0;
    for (const part of this.parts) { out.set(part, offset); offset += part.length; }
    return out;
  }
}

function dosStamp(date) {
  const d = date || new Date();
  const time = (d.getHours() << 11) | (d.getMinutes() << 5) | Math.floor(d.getSeconds() / 2);
  let year = d.getFullYear();
  if (year < 1980) year = 1980;
  const day = ((year - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
  return { time, day };
}

// A zip Excel will open. Method 0 (store) keeps the writer synchronous, so the
// download still counts as part of the click that asked for it.
function zipStore(files, date) {
  const stamp = dosStamp(date);
  const locals = [];
  const centrals = [];
  let offset = 0;
  for (const file of files) {
    const name = encoder.encode(file.name);
    const data = file.data instanceof Uint8Array ? file.data : encoder.encode(file.data);
    const crc = crc32(data);
    const local = new Bin();
    local.u32(0x04034b50);
    local.u16(20);
    local.u16(0x0800);
    local.u16(0);
    local.u16(stamp.time);
    local.u16(stamp.day);
    local.u32(crc);
    local.u32(data.length);
    local.u32(data.length);
    local.u16(name.length);
    local.u16(0);
    local.raw(name);
    local.raw(data);
    const localBytes = local.bytes();
    locals.push(localBytes);

    const central = new Bin();
    central.u32(0x02014b50);
    central.u16(20);
    central.u16(20);
    central.u16(0x0800);
    central.u16(0);
    central.u16(stamp.time);
    central.u16(stamp.day);
    central.u32(crc);
    central.u32(data.length);
    central.u32(data.length);
    central.u16(name.length);
    central.u16(0);
    central.u16(0);
    central.u16(0);
    central.u16(0);
    central.u32(0);
    central.u32(offset);
    central.raw(name);
    centrals.push(central.bytes());
    offset += localBytes.length;
  }
  const centralSize = centrals.reduce((n, part) => n + part.length, 0);
  const end = new Bin();
  end.u32(0x06054b50);
  end.u16(0);
  end.u16(0);
  end.u16(files.length);
  end.u16(files.length);
  end.u32(centralSize);
  end.u32(offset);
  end.u16(0);
  const all = new Bin();
  for (const part of locals) all.raw(part);
  for (const part of centrals) all.raw(part);
  all.raw(end.bytes());
  return all.bytes();
}

function esc(value) {
  return String(value)
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function colName(index) {
  let n = index + 1;
  let name = "";
  while (n > 0) {
    const rem = (n - 1) % 26;
    name = String.fromCharCode(65 + rem) + name;
    n = Math.floor((n - 1) / 26);
  }
  return name;
}

// Excel's 1900 date system, including the fake leap day, is "days since
// 1899-12-30". Built from the calendar parts so a date-only string cannot
// slip a day in a timezone west of UTC.
export function excelSerial(iso) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso || ""));
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const utc = Date.UTC(year, month - 1, day);
  if (Number.isNaN(utc)) return null;
  const back = new Date(utc);
  if (back.getUTCFullYear() !== year || back.getUTCMonth() !== month - 1 || back.getUTCDate() !== day) return null;
  return Math.round((utc - Date.UTC(1899, 11, 30)) / 86400000);
}

function moneyText(value) {
  const cents = Math.round((Number(value) || 0) * 100);
  const sign = cents < 0 ? "-" : "";
  const abs = Math.abs(cents);
  return `${sign}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, "0")}`;
}

function sheetName(name, index) {
  const clean = String(name || "").replace(/[\\/*?:\[\]]/g, " ").trim().slice(0, 31);
  return clean || `Sheet${index + 1}`;
}

// Cell styles: 0 general, 1 bold header, 2 date, 3 currency.
function normalize(value) {
  if (value == null || value === "") return null;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) return null;
    return { kind: "n", text: String(value), style: 0 };
  }
  if (typeof value === "string") return { kind: "s", text: value, style: 0 };
  if (typeof value !== "object") return { kind: "s", text: String(value), style: 0 };
  if (value.t === "header") {
    if (value.v == null || value.v === "") return null;
    return { kind: "s", text: String(value.v), style: 1 };
  }
  if (value.t === "date") {
    const serial = excelSerial(value.v);
    if (serial == null) {
      if (value.v == null || value.v === "") return null;
      return { kind: "s", text: String(value.v), style: 0 };
    }
    return { kind: "n", text: String(serial), style: 2 };
  }
  if (value.t === "money") {
    return { kind: "n", text: moneyText(value.v), style: 3 };
  }
  if (value.v == null || value.v === "") return null;
  return { kind: "s", text: String(value.v), style: 0 };
}

function cellXml(ref, cell) {
  const style = cell.style ? ` s="${cell.style}"` : "";
  if (cell.kind === "n") return `<c r="${ref}"${style}><v>${cell.text}</v></c>`;
  const preserve = /^[\s]|[\s]$|\n/.test(cell.text) ? ` xml:space="preserve"` : "";
  return `<c r="${ref}" t="inlineStr"${style}><is><t${preserve}>${esc(cell.text)}</t></is></c>`;
}

function worksheetXml(sheet, { selected }) {
  const rows = sheet.rows || [];
  let width = 1;
  for (const row of rows) width = Math.max(width, (row || []).length);
  const lastRow = Math.max(rows.length, 1);
  const dim = `A1:${colName(width - 1)}${lastRow}`;
  const cols = (sheet.widths || []).map((w, i) => (
    `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`
  )).join("");
  const body = rows.map((row, index) => {
    const cells = (row || []).map((value, column) => {
      const cell = normalize(value);
      return cell ? cellXml(`${colName(column)}${index + 1}`, cell) : "";
    }).join("");
    return `<row r="${index + 1}">${cells}</row>`;
  }).join("");
  const view = sheet.freezeHeader
    ? `<sheetViews><sheetView workbookViewId="0"${selected ? ` tabSelected="1"` : ""}><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>`
    : (selected ? `<sheetViews><sheetView workbookViewId="0" tabSelected="1"/></sheetViews>` : "");
  const filter = sheet.autoFilter ? `<autoFilter ref="${dim}"/>` : "";
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">` +
    `<dimension ref="${dim}"/>` +
    view +
    (cols ? `<cols>${cols}</cols>` : "") +
    `<sheetData>${body}</sheetData>` +
    filter +
    `</worksheet>`;
}

const STYLES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
  `<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">` +
  `<numFmts count="2">` +
  `<numFmt numFmtId="164" formatCode="yyyy-mm-dd"/>` +
  `<numFmt numFmtId="165" formatCode="$#,##0.00"/>` +
  `</numFmts>` +
  `<fonts count="2">` +
  `<font><sz val="11"/><name val="Calibri"/><family val="2"/></font>` +
  `<font><b/><sz val="11"/><name val="Calibri"/><family val="2"/></font>` +
  `</fonts>` +
  `<fills count="2">` +
  `<fill><patternFill patternType="none"/></fill>` +
  `<fill><patternFill patternType="gray125"/></fill>` +
  `</fills>` +
  `<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>` +
  `<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>` +
  `<cellXfs count="4">` +
  `<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>` +
  `<xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/>` +
  `<xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>` +
  `<xf numFmtId="165" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>` +
  `</cellXfs>` +
  `<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>` +
  `</styleSheet>`;

function workbookXml(names) {
  const sheets = names.map((name, i) => (
    `<sheet name="${esc(name)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`
  )).join("");
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">` +
    `<workbookPr date1904="0"/>` +
    `<bookViews><workbookView activeTab="0"/></bookViews>` +
    `<sheets>${sheets}</sheets>` +
    `</workbook>`;
}

function workbookRels(count) {
  const sheets = [];
  for (let i = 0; i < count; i++) {
    sheets.push(`<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`);
  }
  const styleId = count + 1;
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
    sheets.join("") +
    `<Relationship Id="rId${styleId}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>` +
    `</Relationships>`;
}

function contentTypes(count) {
  const sheets = [];
  for (let i = 0; i < count; i++) {
    sheets.push(`<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`);
  }
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
    `<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
    `<Default Extension="xml" ContentType="application/xml"/>` +
    `<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>` +
    sheets.join("") +
    `<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>` +
    `</Types>`;
}

export function toXlsx(sheets, opts = {}) {
  const list = (sheets || []).map((sheet, index) => ({ ...sheet, name: sheetName(sheet.name, index) }));
  const files = [
    { name: "[Content_Types].xml", data: contentTypes(list.length) },
    { name: "_rels/.rels", data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>` },
    { name: "xl/workbook.xml", data: workbookXml(list.map((sheet) => sheet.name)) },
    { name: "xl/_rels/workbook.xml.rels", data: workbookRels(list.length) },
    { name: "xl/styles.xml", data: STYLES },
    ...list.map((sheet, index) => ({
      name: `xl/worksheets/sheet${index + 1}.xml`,
      data: worksheetXml(sheet, { selected: index === 0 }),
    })),
  ];
  return zipStore(files, opts.date);
}

const XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

export function downloadXlsx(filename, sheets) {
  const blob = new Blob([toXlsx(sheets)], { type: XLSX_MIME });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}
