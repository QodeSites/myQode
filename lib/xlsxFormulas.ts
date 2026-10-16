// Minimal .xlsx writer for server-side downloads (no dependency): several sheets, typed cells, live formulas, a few
// fixed styles, column widths and a frozen header row. Excel recalculates every formula when the file opens
// (fullCalcOnLoad), so formula cells need no cached value. Mirrors the app's one-sheet writer
// (myqode-native/src/web/xlsx.js) and lib/xlsxWriter.ts (browser, no formulas), with deflate from node:zlib.
//
//   const wb = new Workbook(); const ws = wb.sheet('Daily', [12, 10]); ws.set(1, 1, 'Date', 'header'); wb.toBuffer()
import { deflateRawSync } from 'node:zlib'

/** Fixed styles (indexes into cellXfs below). */
export const S = {
  plain: 0, header: 1, date: 2, nav: 3, money: 4, signed: 5, pct: 6, bold: 7, resultPct: 8, boldMoney: 9,
  title: 10, note: 11, boldDate: 12, resultMoney: 13, resultText: 14,
} as const
export type Style = keyof typeof S

type Cell = { v: string | number | Date | null; f?: string; s: number }

const esc = (s: string) => s.replace(/[<>&"]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[c]!))
  .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '')
export const col = (n: number) => { let s = ''; for (; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s; return s }
const serial = (d: Date) => (Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) - Date.UTC(1899, 11, 30)) / 86400000

export class Sheet {
  rows = new Map<number, Map<number, Cell>>()
  constructor(public name: string, public widths: number[] = [], public freezeHeader = true) {}
  /** Row and column are 1-based. A string starting with "=" is a formula. */
  set(r: number, c: number, v: string | number | Date | null | undefined, style: Style = 'plain') {
    if (!this.rows.has(r)) this.rows.set(r, new Map())
    const isF = typeof v === 'string' && v.startsWith('=')
    this.rows.get(r)!.set(c, { v: isF ? null : (v ?? null), f: isF ? (v as string).slice(1) : undefined, s: S[style] })
  }
  xml() {
    const cols = this.widths.length
      ? `<cols>${this.widths.map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`).join('')}</cols>` : ''
    const pane = this.freezeHeader
      ? '<sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>'
      : '<sheetViews><sheetView workbookViewId="0"/></sheetViews>'
    const body = [...this.rows.keys()].sort((a, b) => a - b).map(r => {
      const cells = [...this.rows.get(r)!.entries()].sort((a, b) => a[0] - b[0]).map(([c, x]) => {
        const ref = col(c) + r
        if (x.f != null) return `<c r="${ref}" s="${x.s}"><f>${esc(x.f)}</f></c>`
        if (x.v == null) return `<c r="${ref}" s="${x.s}"/>`
        if (x.v instanceof Date) return `<c r="${ref}" s="${x.s}"><v>${serial(x.v)}</v></c>`
        if (typeof x.v === 'number') return Number.isFinite(x.v) ? `<c r="${ref}" s="${x.s}"><v>${x.v}</v></c>` : `<c r="${ref}" s="${x.s}"/>`
        return `<c r="${ref}" s="${x.s}" t="inlineStr"><is><t xml:space="preserve">${esc(x.v)}</t></is></c>`
      }).join('')
      return `<row r="${r}">${cells}</row>`
    }).join('')
    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">${pane}${cols}<sheetData>${body}</sheetData></worksheet>`
  }
}

const STYLES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<numFmts count="5"><numFmt numFmtId="164" formatCode="yyyy-mm-dd"/><numFmt numFmtId="165" formatCode="0.0000"/><numFmt numFmtId="166" formatCode="#,##0.00"/><numFmt numFmtId="167" formatCode="#,##0.00;[Red]-#,##0.00"/><numFmt numFmtId="168" formatCode="0.00%"/></numFmts>
<fonts count="6">
<font><sz val="10"/><name val="Arial"/></font>
<font><b/><sz val="10"/><color rgb="FFEFECD3"/><name val="Arial"/></font>
<font><b/><sz val="10"/><name val="Arial"/></font>
<font><b/><sz val="10"/><color rgb="FF02422B"/><name val="Arial"/></font>
<font><b/><sz val="14"/><color rgb="FF02422B"/><name val="Arial"/></font>
<font><i/><sz val="10"/><color rgb="FF666666"/><name val="Arial"/></font>
</fonts>
<fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FF02422B"/><bgColor indexed="64"/></patternFill></fill></fills>
<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>
<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
<cellXfs count="15">
<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
<xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1" applyAlignment="1"><alignment wrapText="1" vertical="center"/></xf>
<xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
<xf numFmtId="165" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
<xf numFmtId="166" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
<xf numFmtId="167" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
<xf numFmtId="168" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
<xf numFmtId="0" fontId="2" fillId="0" borderId="0" xfId="0" applyFont="1"/>
<xf numFmtId="168" fontId="3" fillId="0" borderId="0" xfId="0" applyNumberFormat="1" applyFont="1"/>
<xf numFmtId="166" fontId="2" fillId="0" borderId="0" xfId="0" applyNumberFormat="1" applyFont="1"/>
<xf numFmtId="0" fontId="4" fillId="0" borderId="0" xfId="0" applyFont="1"/>
<xf numFmtId="0" fontId="5" fillId="0" borderId="0" xfId="0" applyFont="1"/>
<xf numFmtId="164" fontId="2" fillId="0" borderId="0" xfId="0" applyNumberFormat="1" applyFont="1"/>
<xf numFmtId="166" fontId="3" fillId="0" borderId="0" xfId="0" applyNumberFormat="1" applyFont="1"/>
<xf numFmtId="0" fontId="3" fillId="0" borderId="0" xfId="0" applyFont="1"/>
</cellXfs>
<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
</styleSheet>`

const CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0 } return t })()
const crc32 = (b: Buffer) => { let c = 0xffffffff; for (let i = 0; i < b.length; i++) c = CRC[(c ^ b[i]) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0 }

function zip(files: { name: string; data: Buffer }[]): Buffer {
  const parts: Buffer[] = [], central: Buffer[] = []
  let offset = 0
  for (const f of files) {
    const name = Buffer.from(f.name), crc = crc32(f.data), packed = deflateRawSync(f.data)
    const local = Buffer.alloc(30)
    local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt16LE(8, 8)
    local.writeUInt32LE(crc, 14); local.writeUInt32LE(packed.length, 18); local.writeUInt32LE(f.data.length, 22); local.writeUInt16LE(name.length, 26)
    parts.push(local, name, packed)
    const cen = Buffer.alloc(46)
    cen.writeUInt32LE(0x02014b50, 0); cen.writeUInt16LE(20, 4); cen.writeUInt16LE(20, 6); cen.writeUInt16LE(8, 10)
    cen.writeUInt32LE(crc, 16); cen.writeUInt32LE(packed.length, 20); cen.writeUInt32LE(f.data.length, 24); cen.writeUInt16LE(name.length, 28); cen.writeUInt32LE(offset, 42)
    central.push(cen, name)
    offset += 30 + name.length + packed.length
  }
  const cenSize = central.reduce((t, p) => t + p.length, 0)
  const end = Buffer.alloc(22)
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(files.length, 8); end.writeUInt16LE(files.length, 10)
  end.writeUInt32LE(cenSize, 12); end.writeUInt32LE(offset, 16)
  return Buffer.concat([...parts, ...central, end])
}

export class Workbook {
  sheets: Sheet[] = []
  /** Sheet names: at most 31 characters, none of []:*?/\ (Excel's rules). */
  sheet(name: string, widths: number[] = [], freezeHeader = true) {
    const s = new Sheet(name.replace(/[\[\]:*?/\\]/g, ' ').slice(0, 31), widths, freezeHeader)
    this.sheets.push(s)
    return s
  }
  toBuffer(): Buffer {
    const n = this.sheets.length
    const b = (s: string) => Buffer.from(s, 'utf8')
    return zip([
      { name: '[Content_Types].xml', data: b(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>${this.sheets.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('')}</Types>`) },
      { name: '_rels/.rels', data: b(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`) },
      { name: 'xl/workbook.xml', data: b(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${this.sheets.map((s, i) => `<sheet name="${esc(s.name)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('')}</sheets><calcPr calcId="191029" fullCalcOnLoad="1"/></workbook>`) },
      { name: 'xl/_rels/workbook.xml.rels', data: b(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${this.sheets.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('')}<Relationship Id="rId${n + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`) },
      { name: 'xl/styles.xml', data: b(STYLES) },
      ...this.sheets.map((s, i) => ({ name: `xl/worksheets/sheet${i + 1}.xml`, data: b(s.xml()) })),
    ])
  }
}
