// Client Master Lists (CML) in Qode's format (Admin → CML, 17 Oct 2026).
//
// The depository participant (Nuvama Wealth, DP IN303719) issues each client's CML as a PDF; ops upload them to the
// Client Document Vault (docs/client-documents/<clientid>/CML/, lib: app/api/admin/bo/documents). This reads that PDF
// and lays the same details out again in Qode's document style: the same sections, rows and cells as the depository's
// page (labels and values as printed, joint holders, nominees and the POA/DDPI table included), under Qode's header,
// with a line naming the DP and the CML's business date as the source. Nothing is typed in or changed here.
//
// Reading: labels and values are in different fonts in the DP's PDF (labels bold), so every cell is found by
// position: a row of labels, each label's cell running to the next label on the row, its value the text under it
// down to the next row of labels. A label wrapped onto a second line (standing / instruction) is joined back.
import { getDocumentProxy } from 'unpdf'
import { ListObjectsV2Command, GetObjectCommand } from '@aws-sdk/client-s3'
import { s3 } from '@/lib/s3'

export type CmlCell = { label: string; value: string; x: number; vx: number | null }
export type CmlRow = { cells: CmlCell[] }
export type CmlTable = { header: string[]; rows: { label: string; cols: string[] }[] }
export type CmlSection = { title: string; rows: CmlRow[]; table?: CmlTable }
export type Cml = { businessDate: string | null; dp: string | null; clientId: string | null; name: string | null; sections: CmlSection[]; width: number }

type Item = { x: number; Y: number; s: string; label: boolean; used?: boolean }

const BUCKET = 'qode-static-assets'
const ROOT = 'docs/client-documents/'
const plain = (id: unknown) => String(id ?? '').trim().replace(/\.0+$/, '')
const near = (a: number, b: number, d: number) => Math.abs(a - b) <= d

/** Reads the DP's CML PDF into sections of rows of { label, value } cells, in page order. */
export async function parseCml(data: Uint8Array): Promise<Cml> {
  const pdf = await getDocumentProxy(data)
  const items: Item[] = []
  let businessDate: string | null = null, dp: string | null = null, width = 760, labelFont: string | null = null
  const raw: { x: number; Y: number; s: string; f: string }[] = []
  for (let p = 1; p <= pdf.numPages; p++) {
    const page = await pdf.getPage(p)
    const [, , w, h] = page.view
    width = w
    const tc: any = await page.getTextContent()
    const its = (tc.items as any[]).filter(i => typeof i.str === 'string' && i.str.trim()).map(i => ({ x: i.transform[4], y: i.transform[5], s: i.str.trim(), f: i.fontName as string }))
    // The DP's page header (logo box down to its phone/fax line) and footer (operator, page no.) repeat on every page.
    const phone = its.find(i => /^Phone:/i.test(i.s))
    const headBottom = phone ? phone.y - 2 : h - 100
    for (const i of its) {
      if (p === 1 && !businessDate) { const m = /business date:\s*(.+)$/i.exec(i.s); if (m) businessDate = m[1].trim() }
      if (p === 1 && !dp) { const m = /^DP:\s*(.+)$/i.exec(i.s); if (m) dp = m[1].trim() }
      if (i.y >= headBottom || i.y < 36 || /^\*+\s*End of Report/i.test(i.s) || i.s === '.') continue
      raw.push({ x: i.x, Y: p * 10000 + (h - i.y), s: i.s, f: i.f })
      if (!labelFont && /^(client id|personal details\s*:?)$/i.test(i.s)) labelFont = i.f
    }
  }
  for (const r of raw) items.push({ x: r.x, Y: r.Y, s: r.s, label: r.f === labelFont && !/^[\d/.:-]+$/.test(r.s) })
  items.sort((a, b) => a.Y - b.Y || a.x - b.x)

  // Lines of text (same baseline).
  const lines: Item[][] = []
  for (const it of items) {
    const l = lines.find(l => near(l[0].Y, it.Y, 3))
    if (l) l.push(it); else lines.push([it])
  }
  lines.sort((a, b) => a[0].Y - b[0].Y)

  // Section titles ("personal details :") stand alone on their line; "POA/DDPI Details:" starts the POA table.
  const breaks: { Y: number; title: string; table: boolean }[] = []
  for (const l of lines) {
    if (l.length === 1 && l[0].label && /:\s*$/.test(l[0].s) && l[0].x < 80) {
      l[0].used = true
      const title = l[0].s.replace(/\s*:\s*$/, '').trim()
      breaks.push({ Y: l[0].Y, title, table: /POA\s*\/?\s*DDPI/i.test(title) })
    }
  }

  // A label wrapped onto a second line: every label on that line sits under a label of the line just above.
  // A wrapped label's second line is ~10pt under the first; the next row of the table is 13pt or more below.
  const labelLines = lines.map(l => l.filter(i => i.label && !i.used)).filter(l => l.length)
  for (const cur of labelLines) {
    const above = labelLines.filter(l => l !== cur && cur[0].Y - l[0].Y >= 4 && cur[0].Y - l[0].Y <= 11).flat()
    const pairs = cur.map(c => above.find(a => !a.used && near(a.x, c.x, 3) && c.Y - a.Y >= 4 && c.Y - a.Y <= 11))
    if (above.length && pairs.every(Boolean)) cur.forEach((c, j) => { pairs[j]!.s += ' ' + c.s; c.used = true })
  }

  const sections: CmlSection[] = []
  const bounds = [{ Y: -Infinity, title: 'Account', table: false }, ...breaks]
  for (let b = 0; b < bounds.length; b++) {
    const from = bounds[b].Y, to = b + 1 < bounds.length ? bounds[b + 1].Y : Infinity
    const inSec = items.filter(i => !i.used && i.Y > from && i.Y < to)
    if (!inSec.length) continue
    const sec: CmlSection = { title: bounds[b].title, rows: [] }
    if (bounds[b].table) sec.table = readTable(inSec)
    else sec.rows = readRows(inSec)
    if (sec.rows.length || sec.table) sections.push(sec)
  }
  const nameCell = sections.flatMap(s => s.rows.flatMap(r => r.cells)).find(c => /^Sole\/First Holder Name$/i.test(c.label))
  const idCell = sections.flatMap(s => s.rows.flatMap(r => r.cells)).find(c => /^client id$/i.test(c.label))
  return { businessDate, dp, clientId: idCell?.value || null, name: nameCell?.value || null, sections, width }
}

function joinLines(its: Item[]): string {
  const ls: Item[][] = []
  for (const it of [...its].sort((a, b) => a.Y - b.Y || a.x - b.x)) {
    const l = ls.find(l => near(l[0].Y, it.Y, 3))
    if (l) l.push(it); else ls.push([it])
  }
  let out = ''
  for (const l of ls) {
    const t = l.sort((a, b) => a.x - b.x).map(i => i.s).join(' ')
    // a word cut at the cell edge ("MAHARASHTR" / "A") is joined without a space
    out = !out ? t : (t.length <= 2 && /^[A-Z]+$/.test(t) && /[A-Z]$/.test(out)) ? out + t : out + ' ' + t
  }
  return out.replace(/\s+/g, ' ').trim()
}

function readRows(its: Item[]): CmlRow[] {
  const labels = its.filter(i => i.label).sort((a, b) => a.Y - b.Y || a.x - b.x)
  const rows: Item[][] = []
  for (const l of labels) {
    const r = rows[rows.length - 1]
    if (r && l.Y - r[0].Y <= 6) r.push(l); else rows.push([l])
  }
  const values = its.filter(i => !i.label)
  const out: CmlRow[] = []
  rows.forEach((r, k) => {
    const top = r[0].Y - 5, bottom = k + 1 < rows.length ? rows[k + 1][0].Y - 5 : Infinity
    const mine = values.filter(v => v.Y >= top && v.Y < bottom)
    const ls = [...r].sort((a, b) => a.x - b.x)
    const cells = ls.map((l, j) => {
      const x0 = j === 0 ? -Infinity : l.x - 3, x1 = j + 1 < ls.length ? ls[j + 1].x - 3 : Infinity
      const v = mine.filter(m => m.x >= x0 && m.x < x1)
      return { label: l.s.replace(/\s+/g, ' ').trim(), value: joinLines(v), x: l.x, vx: v.length ? Math.min(...v.map(m => m.x)) : null }
    })
    out.push({ cells })
  })
  return out
}

function readTable(its: Item[]): CmlTable {
  const ls: Item[][] = []
  for (const it of its) { const l = ls.find(l => near(l[0].Y, it.Y, 3)); if (l) l.push(it); else ls.push([it]) }
  ls.sort((a, b) => a[0].Y - b[0].Y).forEach(l => l.sort((a, b) => a.x - b.x))
  const hi = ls.findIndex(l => l.filter(i => i.label).length >= 3)
  if (hi < 0) return { header: [], rows: ls.map(l => ({ label: '', cols: [l.map(i => i.s).join(' ')] })) }
  const head = ls[hi].filter(i => i.label)
  const rows: { label: string; cols: string[] }[] = []
  let lastLabel = ''
  for (const l of ls.slice(hi + 1)) {
    const cols = head.map(() => '')
    let label = ''
    for (const i of l) {
      if (i.x < head[0].x - 6) { label = (label + ' ' + i.s).trim(); continue }
      let c = 0
      for (let j = 0; j < head.length; j++) if (i.x >= head[j].x - 6) c = j
      cols[c] = (cols[c] + ' ' + i.s).trim()
    }
    if (label) lastLabel = label
    rows.push({ label: label || '', cols })
  }
  void lastLabel
  return { header: head.map(h => h.s), rows }
}

// ── Storage ─────────────────────────────────────────────────────────────────────────────────────────────────────
export type CmlFile = { key: string; clientId: string; lastModified: Date | null }

/** Every CML PDF in the vault, the newest per client folder. */
export async function listCmlFiles(): Promise<Map<string, CmlFile>> {
  const out = new Map<string, CmlFile>()
  let token: string | undefined
  do {
    const r = await s3.send(new ListObjectsV2Command({ Bucket: BUCKET, Prefix: ROOT, ContinuationToken: token }))
    for (const o of r.Contents || []) {
      const parts = (o.Key || '').slice(ROOT.length).split('/')
      if (parts.length < 3 || !/^cml$/i.test(parts[1]) || !/\.pdf$/i.test(o.Key || '')) continue
      const id = plain(parts[0]), prev = out.get(id)
      if (!prev || (o.LastModified && prev.lastModified && o.LastModified > prev.lastModified)) out.set(id, { key: o.Key!, clientId: id, lastModified: o.LastModified || null })
    }
    token = r.NextContinuationToken
  } while (token)
  return out
}

export async function readCml(key: string): Promise<Cml> {
  const r = await s3.send(new GetObjectCommand({ Bucket: BUCKET, Key: key }))
  return parseCml(new Uint8Array(await r.Body!.transformToByteArray()))
}

// ── Qode's format ───────────────────────────────────────────────────────────────────────────────────────────────
const esc = (s: unknown) => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' } as any)[c])
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)

function rowHtml(r: CmlRow, left: number, right: number): string {
  const span = right - left
  const tds = r.cells.map((c, j) => {
    const end = j + 1 < r.cells.length ? r.cells[j + 1].x : right
    const w = Math.max(4, ((end - (j === 0 ? left : c.x)) / span) * 100)
    // the label takes the room up to where its value starts in the DP's page (half the cell when it has none)
    const lw = c.vx != null && c.vx > c.x ? Math.min(0.8, Math.max(0.25, (c.vx - c.x) / Math.max(1, end - c.x))) : (c.value ? 0.5 : 1)
    return c.value || lw < 1
      ? `<td class="k" style="width:${(w * lw).toFixed(2)}%">${esc(c.label)}</td><td class="v" style="width:${(w * (1 - lw)).toFixed(2)}%">${esc(c.value)}</td>`
      : `<td class="k" style="width:${w.toFixed(2)}%" colspan="2">${esc(c.label)}</td>`
  }).join('')
  return `<table class="r"><tr>${tds}</tr></table>`
}

function oneHtml(c: Cml, meta: { clientId: string; accounts: string }): string {
  const left = Math.min(...c.sections.flatMap(s => s.rows.flatMap(r => r.cells.map(x => x.x))), 30)
  const right = c.width - 20
  const body = c.sections.map(s => {
    const head = s.title === 'Account' ? '' : `<h3>${esc(s.title === s.title.toLowerCase() ? cap(s.title) : s.title)}</h3>`
    if (s.table) {
      const t = s.table
      return `${head}<table class="t"><tr><th></th>${t.header.map(h => `<th>${esc(h)}</th>`).join('')}</tr>${t.rows.map(r => `<tr><td class="k">${esc(r.label)}</td>${r.cols.map(v => `<td>${esc(v)}</td>`).join('')}</tr>`).join('')}</table>`
    }
    return head + s.rows.map(r => rowHtml(r, left, right)).join('')
  }).join('')
  return `<section class="doc">
<div class="band"><div class="wm">Qode<small>QODE ADVISORS LLP</small></div><div class="title">Client Master List<small>${esc(c.name || '')}${c.clientId ? ' · Client ID ' + esc(c.clientId) : ''}</small></div></div>
<div class="src">Details as recorded by the depository participant${c.dp ? ' <b>' + esc(c.dp) + '</b>' : ''}${c.businessDate ? ', CML business date <b>' + esc(c.businessDate) + '</b>' : ''}. Accounts: ${esc(meta.accounts)}.</div>
${body}
<div class="ft"><div><b style="color:#02422B">Qode Advisors LLP</b> · SEBI Registered Portfolio Manager INP000008914<br>Prepared from the Client Master List issued by the depository participant. The depository participant's records prevail.</div><div style="text-align:right">Generated ${esc(new Date().toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'Asia/Kolkata' }))}</div></div>
</section>`
}

/** One printable HTML document (Save as PDF from the print dialog), a page per CML. */
export function cmlHtml(docs: { cml: Cml; clientId: string; accounts: string }[], title: string): string {
  return `<!doctype html><html><head><meta charset="utf-8"><title>${esc(title)}</title>
<link href="https://fonts.googleapis.com/css2?family=Playfair+Display:wght@600&display=swap" rel="stylesheet">
<style>
  @page { size: A4 landscape; margin: 10mm; }
  * { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  body { font-family: -apple-system, 'Helvetica Neue', Roboto, Arial, sans-serif; color: #002017; font-size: 8pt; margin: 0; line-height: 1.35; }
  .doc { page-break-after: always; } .doc:last-child { page-break-after: auto; }
  .band { background: #02422B; color: #EFECD3; padding: 12px 18px; border-radius: 6px; display: flex; justify-content: space-between; align-items: flex-end; }
  .wm { font-family: 'Playfair Display', Georgia, serif; color: #DABD38; font-weight: 600; font-size: 20pt; line-height: 1; }
  .wm small { font-size: 7.5pt; letter-spacing: 3px; display: block; color: #EFECD3; font-family: -apple-system, Arial, sans-serif; margin-top: 5px; }
  .title { font-family: 'Playfair Display', Georgia, serif; font-size: 14pt; text-align: right; }
  .title small { display: block; font-family: -apple-system, Arial, sans-serif; font-size: 8.5pt; opacity: .85; margin-top: 3px; }
  .src { background: #F7F5E9; border: 1px solid #E4DECB; border-radius: 6px; padding: 7px 12px; margin: 8px 0 4px; color: #37584F; }
  h3 { font-family: 'Playfair Display', Georgia, serif; color: #02422B; font-size: 10.5pt; margin: 10px 0 3px; }
  table.r { width: 100%; border-collapse: collapse; table-layout: fixed; margin-top: -1px; }
  table.r td { border: 1px solid #DCD8C0; padding: 4px 6px; vertical-align: top; word-wrap: break-word; }
  td.k { background: #EFECD3; color: #02422B; font-weight: 700; }
  td.v { background: #fff; }
  table.t { width: 100%; border-collapse: collapse; }
  table.t th { background: #02422B; color: #EFECD3; text-align: left; padding: 5px 6px; font-weight: 600; }
  table.t td { border: 1px solid #DCD8C0; padding: 4px 6px; }
  .ft { margin-top: 12px; padding-top: 8px; border-top: 1px solid #E4DECB; font-size: 7pt; color: #37584F; display: flex; justify-content: space-between; gap: 12px; }
  .hint { position: fixed; bottom: 10px; right: 10px; background: #02422B; color: #EFECD3; padding: 6px 10px; border-radius: 6px; font-size: 9pt; }
  @media print { .hint { display: none; } }
</style></head><body>
<div class="hint">Choose “Save as PDF” in the print dialog</div>
${docs.map(d => oneHtml(d.cml, d)).join('\n')}
<script>window.addEventListener('load', function () { setTimeout(function () { window.print() }, 400) })</script>
</body></html>`
}
