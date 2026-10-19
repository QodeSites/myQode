// The partner's tax invoice as a PDF, built on the server when the invoice is raised (app/api/distributor/invoice-issue).
// It is what Accounts receives and what is saved with the record (19 Oct 2026: they were getting the portal's HTML file).
//
// Same layout and figures as the printable invoice the partner downloads (myqode-native invoiceHtml): green band,
// From / Bill to panels, particulars, total payable, payment details. Built from the saved invoice details
// (distributor_invoice_profile) and the amounts recorded with the invoice, so the PDF matches the record.
// pdf-lib is pure JS: no browser on the server. Inter and Playfair are embedded because both carry the ₹ sign (Lato,
// the portal's body font, does not). lib/invoiceFonts holds them already cut to Latin + ₹ with no layout features
// (fontTools subset --layout-features=''), and they are embedded whole: pdf-lib's own subsetting garbles these fonts,
// and their contextual features shift spacing ("FY/25-  26").
import fs from 'fs'
import path from 'path'
import { PDFDocument, PDFFont, PDFPage, rgb } from 'pdf-lib'
import fontkit from '@pdf-lib/fontkit'
import { QODE_ENTITY, qodeAddressLines } from '@/lib/qodeEntity'
import { computeTax } from '@/lib/invoiceTax'
import { amountInWords } from '@/lib/amountInWords'

export type InvoicePdfProfile = {
  legal_name?: string | null; gstin?: string | null; pan?: string | null
  address_line1?: string | null; address_line2?: string | null; city?: string | null; state?: string | null; state_code?: string | null; pincode?: string | null
  bank_account_name?: string | null; bank_account_number?: string | null; bank_ifsc?: string | null; bank_name?: string | null
  notes?: string | null
} | null

export type InvoicePdfInput = {
  invoiceNumber: string; invoiceDate: string; periodLabel: string
  periodStart?: string | null; periodEnd?: string | null           // as the portal labels them, e.g. "01 Apr 2026"
  amountBeforeTax: number; taxAmount: number; totalAmount: number
  ratePct?: string | null; clientCount?: number | null; discount?: number | null   // the description line, when sent
  partnerName?: string | null; partnerEmail: string
}

const C = {
  green: rgb(0x02 / 255, 0x42 / 255, 0x2b / 255), gold: rgb(0xda / 255, 0xbd / 255, 0x38 / 255), cream: rgb(0xef / 255, 0xec / 255, 0xd3 / 255),
  ink: rgb(0, 0x20 / 255, 0x17 / 255), muted: rgb(0x37 / 255, 0x58 / 255, 0x4f / 255), panel: rgb(0xf7 / 255, 0xf5 / 255, 0xe9 / 255),
  line: rgb(0xe4 / 255, 0xde / 255, 0xcb / 255), rule: rgb(0xd6 / 255, 0xd3 / 255, 0xc4 / 255), white: rgb(1, 1, 1),
}
const MM = 72 / 25.4
const PAGE = { w: 595.28, h: 841.89 }
const M = { x: 14 * MM, top: 14 * MM, bottom: 16 * MM }
const W = PAGE.w - 2 * M.x

const inr = (n: number) => '₹ ' + Number(n || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const MS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const displayDate = (iso: string) => (/^\d{4}-\d{2}-\d{2}/.test(iso) ? `${iso.slice(8, 10)} ${MS[+iso.slice(5, 7) - 1]} ${iso.slice(0, 4)}` : iso)
const s = (v: unknown) => String(v ?? '').trim()

let fontBytes: Record<string, Buffer> | null = null
function loadFonts() {
  const dir = path.join(process.cwd(), 'lib', 'invoiceFonts')
  fontBytes ||= {
    regular: fs.readFileSync(path.join(dir, 'Inter_400Regular.ttf')),
    italic: fs.readFileSync(path.join(dir, 'Inter_400Regular_Italic.ttf')),
    bold: fs.readFileSync(path.join(dir, 'Inter_700Bold.ttf')),
    serif: fs.readFileSync(path.join(dir, 'PlayfairDisplay_600SemiBold.ttf')),
  }
  return fontBytes
}

/** Splits text into lines no wider than `max` at `size`. Honours explicit newlines. */
function wrap(text: string, font: PDFFont, size: number, max: number): string[] {
  const out: string[] = []
  for (const para of text.split('\n')) {
    let line = ''
    for (const word of para.split(/\s+/).filter(Boolean)) {
      const next = line ? line + ' ' + word : word
      if (line && font.widthOfTextAtSize(next, size) > max) { out.push(line); line = word } else line = next
    }
    out.push(line)
  }
  return out
}

export async function buildInvoicePdf(inv: InvoicePdfInput, p: InvoicePdfProfile): Promise<Buffer> {
  const bytes = loadFonts()
  const doc = await PDFDocument.create()
  doc.registerFontkit(fontkit)
  const F = {
    regular: await doc.embedFont(bytes.regular, { subset: false }),
    italic: await doc.embedFont(bytes.italic, { subset: false }),
    bold: await doc.embedFont(bytes.bold, { subset: false }),
    serif: await doc.embedFont(bytes.serif, { subset: false }),
  }
  const supplier = s(p?.legal_name) || s(inv.partnerName) || inv.partnerEmail
  doc.setTitle(`Invoice ${inv.invoiceNumber} - ${supplier}`)
  doc.setAuthor(supplier)
  doc.setSubject(`Distribution fees · ${inv.periodLabel}`)
  doc.setCreator('myQode')

  let page: PDFPage = doc.addPage([PAGE.w, PAGE.h])
  let y = PAGE.h - M.top   // top of the next block, measured down the page
  const need = (h: number) => { if (y - h < M.bottom) { page = doc.addPage([PAGE.w, PAGE.h]); y = PAGE.h - M.top } }
  const text = (t: string, x: number, top: number, font: PDFFont, size: number, color = C.ink) =>
    page.drawText(t, { x, y: top - size * 0.8, font, size, color })   // `top` is the top of the line's cap height area
  const right = (t: string, xr: number, top: number, font: PDFFont, size: number, color = C.ink) =>
    text(t, xr - font.widthOfTextAtSize(t, size), top, font, size, color)
  const spaced = (t: string, x: number, top: number, font: PDFFont, size: number, color: ReturnType<typeof rgb>, track: number) => {
    let cx = x
    for (const ch of t) { text(ch, cx, top, font, size, color); cx += font.widthOfTextAtSize(ch, size) + track }
  }
  const label = (t: string, x: number, top: number) => spaced(t.toUpperCase(), x, top, F.bold, 6.5, C.muted, 1)

  // ── Green band: title on the left, number / date / period on the right ──
  const bandH = 62
  page.drawRectangle({ x: M.x, y: y - bandH, width: W, height: bandH, color: C.green })
  text('Tax Invoice', M.x + 16, y - 16, F.serif, 20, C.gold)
  spaced(`DISTRIBUTION FEES · ${inv.periodLabel.toUpperCase()}`, M.x + 16, y - 42, F.regular, 6.5, C.cream, 1.3)
  const meta: Array<[string, string]> = [['Invoice no.', inv.invoiceNumber || '–'], ['Date', displayDate(inv.invoiceDate)], ['Period', inv.periodLabel]]
  meta.forEach(([k, v], i) => {
    const top = y - 14 - i * 13
    const vw = F.bold.widthOfTextAtSize(v, 8)
    right(v, M.x + W - 16, top, F.bold, 8, C.white)
    right(k + ' ', M.x + W - 16 - vw, top, F.regular, 8, C.cream)
  })
  y -= bandH + 12

  // ── From / Bill to ──
  const gap = 9, colW = (W - gap) / 2, pad = 11, lineH = 12.5
  const fromLines = [s(p?.address_line1), s(p?.address_line2), [s(p?.city), s(p?.state), s(p?.pincode)].filter(Boolean).join(', ')].filter(Boolean)
  if (s(p?.gstin)) fromLines.push('GSTIN ' + s(p?.gstin))
  if (s(p?.pan)) fromLines.push('PAN ' + s(p?.pan))
  const toLines = [...qodeAddressLines(), ...(QODE_ENTITY.gstin ? ['GSTIN ' + QODE_ENTITY.gstin] : []), ...(QODE_ENTITY.pan ? ['PAN ' + QODE_ENTITY.pan] : []),
    'SEBI PMS ' + QODE_ENTITY.sebiRegistration, `Place of supply: ${QODE_ENTITY.state} (${QODE_ENTITY.stateCode})`]
  const panelBody = (name: string, lines: string[]) => {
    const nm = wrap(name, F.serif, 11, colW - 2 * pad)
    const ls = lines.flatMap((l) => wrap(l, F.regular, 8.5, colW - 2 * pad))
    return { nm, ls, h: pad + 12 + nm.length * 14 + 2 + ls.length * lineH + pad - 2 }
  }
  const from = panelBody(supplier, fromLines), to = panelBody(QODE_ENTITY.name, toLines)
  const panelH = Math.max(from.h, to.h)
  need(panelH)
  ;[['From', from, M.x], ['Bill to', to, M.x + colW + gap]].forEach(([lab, b, x]: any) => {
    page.drawRectangle({ x, y: y - panelH, width: colW, height: panelH, color: C.panel, borderColor: C.line, borderWidth: 0.75 })
    label(lab, x + pad, y - pad)
    let top = y - pad - 12
    b.nm.forEach((l: string) => { text(l, x + pad, top, F.serif, 11); top -= 14 })
    top -= 2
    b.ls.forEach((l: string) => { text(l, x + pad, top, F.regular, 8.5); top -= lineH })
  })
  y -= panelH + 18

  // ── Particulars ──
  need(80)
  text('Particulars', M.x, y, F.serif, 11, C.green)
  y -= 20
  label('Description', M.x, y)
  const amtLabelW = 'AMOUNT'.length * 1 + F.bold.widthOfTextAtSize('AMOUNT', 6.5)
  label('Amount', M.x + W - amtLabelW, y)
  y -= 10
  page.drawLine({ start: { x: M.x, y }, end: { x: M.x + W, y }, thickness: 0.75, color: C.rule })

  // The figures: the amounts recorded with the invoice; the GST split recomputed from the partner's state, the same way
  // the portal does. If the recomputation does not reproduce the recorded GST, the recorded GST is shown as one line.
  const tax = computeTax(inv.amountBeforeTax, s(p?.state_code), QODE_ENTITY.stateCode, Boolean(s(p?.gstin)))
  const agrees = Math.abs(tax.totalTax - inv.taxAmount) < 0.015 && Math.abs(tax.total - inv.totalAmount) < 0.015
  const n = Number(inv.clientCount) || 0, disc = Number(inv.discount) || 0
  const why = [
    inv.ratePct && n ? `${inv.ratePct} share of fees on ${n} ${n === 1 ? 'client' : 'clients'}${disc > 0 ? `, net of ${inr(disc)} in discounts given to investors` : ''}.` : '',
    inv.periodStart && inv.periodEnd ? `${inv.periodStart} to ${inv.periodEnd}.` : '',
  ].filter(Boolean).join(' ')
  const amtColW = 110
  const descLines = wrap(`Distribution fees: ${inv.periodLabel}`, F.bold, 9, W - amtColW)
  const whyLines = why ? wrap(why, F.regular, 8, W - amtColW) : []
  const descH = 8 + descLines.length * 12 + (whyLines.length ? 3 + whyLines.length * 10.5 : 0) + 6
  need(descH)
  let top = y - 8
  descLines.forEach((l) => { text(l, M.x, top, F.bold, 9); top -= 12 })
  if (whyLines.length) { top -= 3; whyLines.forEach((l) => { text(l, M.x, top, F.regular, 8, C.muted); top -= 10.5 }) }
  right(inr(inv.amountBeforeTax), M.x + W, y - 8, F.regular, 9)
  y -= descH
  page.drawLine({ start: { x: M.x, y }, end: { x: M.x + W, y }, thickness: 0.5, color: C.line })

  const rows: Array<[string, number]> = [['Taxable value', inv.amountBeforeTax]]
  if (!agrees) { if (inv.taxAmount) rows.push(['GST', inv.taxAmount]) }
  else if (tax.treatment === 'intra_state') rows.push([`CGST @ ${tax.cgstRate}%`, tax.cgst], [`SGST @ ${tax.sgstRate}%`, tax.sgst])
  else if (tax.treatment === 'inter_state') rows.push([`IGST @ ${tax.igstRate}%`, tax.igst])
  for (const [k, v] of rows) {
    need(24)
    right(k, M.x + W - amtColW - 4, y - 8, F.regular, 9, C.muted)
    right(inr(v), M.x + W, y - 8, F.regular, 9)
    y -= 24
    page.drawLine({ start: { x: M.x, y }, end: { x: M.x + W, y }, thickness: 0.5, color: C.line })
  }
  if (agrees && tax.treatment === 'unregistered') {
    need(24)
    right('No GST charged (not registered under GST)', M.x + W, y - 8, F.regular, 9, C.muted)
    y -= 24
    page.drawLine({ start: { x: M.x, y }, end: { x: M.x + W, y }, thickness: 0.5, color: C.line })
  }
  y -= 12

  // ── Total payable ──
  const big = inr(inv.totalAmount), bigW = F.serif.widthOfTextAtSize(big, 18)
  const words = wrap(amountInWords(inv.totalAmount), F.italic, 8.5, W - 28 - bigW - 16)
  const boxH = Math.max(46, 12 + 10 + 4 + words.length * 11.5 + 10)
  need(boxH)
  page.drawRectangle({ x: M.x, y: y - boxH, width: W, height: boxH, borderColor: C.green, borderWidth: 1.5 })
  label('Total payable', M.x + 14, y - 12)
  top = y - 26
  words.forEach((l) => { text(l, M.x + 14, top, F.italic, 8.5, C.muted); top -= 11.5 })
  right(big, M.x + W - 14, y - boxH / 2 + 9, F.serif, 18, C.green)
  y -= boxH

  // ── Payment details ──
  const pay = [s(p?.bank_account_name), s(p?.bank_name), s(p?.bank_account_number) && 'A/c ' + s(p?.bank_account_number), s(p?.bank_ifsc) && 'IFSC ' + s(p?.bank_ifsc)].filter(Boolean)
  if (pay.length) {
    const ls = pay.flatMap((l) => wrap(l, F.regular, 8.5, W - 2 * pad))
    const h = 2 * pad + ls.length * lineH - 2
    need(22 + h)
    y -= 18
    text('Payment details', M.x, y, F.serif, 11, C.green)
    y -= 18
    page.drawRectangle({ x: M.x, y: y - h, width: W, height: h, color: C.panel, borderColor: C.line, borderWidth: 0.75 })
    top = y - pad
    ls.forEach((l) => { text(l, M.x + pad, top, F.regular, 8.5); top -= lineH })
    y -= h
  }

  // ── Notes ──
  if (s(p?.notes)) {
    const ls = wrap(s(p?.notes), F.regular, 8, W)
    y -= 12
    for (const l of ls) { need(11); text(l, M.x, y, F.regular, 8, C.muted); y -= 11 }
  }

  // ── Footer ──
  need(30)
  y -= 22
  page.drawLine({ start: { x: M.x, y }, end: { x: M.x + W, y }, thickness: 0.5, color: C.line })
  text('This is a system generated invoice.', M.x, y - 8, F.bold, 8, C.green)

  return Buffer.from(await doc.save())
}
