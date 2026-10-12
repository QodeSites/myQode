// Payment receipt for a partner (distributor) invoice that Qode has paid, in Qode's report style (lib/reportPdf.js:
// green band, gold wordmark, cream panels). Built from the invoice record each time it is opened (Admin → Distributor
// invoices → Receipt), so it always matches what is saved; save it as PDF from the browser. Never emailed by itself.
import { QODE_ENTITY } from '@/lib/qodeEntity'

export type ReceiptInvoice = {
  id: number; partnerEmail: string; partnerName: string | null; legalName: string | null; gstin: string | null; pan: string | null; bank: string | null
  invoiceNumber: string; invoiceDate: string | null; periodLabel: string | null
  amountBeforeTax: number; taxAmount: number; totalAmount: number
  paidOn: string | null; paidAmount: number | null; paymentRef: string | null; paymentNote: string | null
}

const esc = (s: unknown) => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' } as any)[c])
const MS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const dl = (iso?: string | null) => (iso ? `${iso.slice(8, 10)} ${MS[+iso.slice(5, 7) - 1]} ${iso.slice(0, 4)}` : '—')
const inr = (v?: number | null) => (v == null || isNaN(v) ? '—' : '₹' + Number(v).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }))
/** Receipt number: QPR/<financial year of payment>/<invoice id>, e.g. QPR/2026-27/14 — stable for the same invoice. */
export const receiptNumber = (inv: ReceiptInvoice) => {
  const d = inv.paidOn ? new Date(inv.paidOn + 'T00:00:00') : new Date()
  const fy = d.getMonth() >= 3 ? d.getFullYear() : d.getFullYear() - 1
  return `QPR/${fy}-${String((fy + 1) % 100).padStart(2, '0')}/${inv.id}`
}

export function receiptHtml(inv: ReceiptInvoice): string {
  const E = QODE_ENTITY
  const payee = inv.legalName || inv.partnerName || inv.partnerEmail
  // Account numbers masked to the last 4, as the bank's own advice prints them.
  const bank = inv.bank ? inv.bank.replace(/A\/c\s*(\S+)/, (_, n: string) => 'A/c ' + 'X'.repeat(Math.max(0, n.length - 4)) + n.slice(-4)) : null
  const diff = inv.paidAmount != null ? Math.round((inv.totalAmount - inv.paidAmount) * 100) / 100 : 0
  const row = (k: string, v: string) => `<tr><td class="k">${k}</td><td class="v">${v}</td></tr>`
  return `<!doctype html><html><head><meta charset="utf-8"><title>Payment receipt ${esc(receiptNumber(inv))}</title>
<link href="https://fonts.googleapis.com/css2?family=Playfair+Display:wght@600&display=swap" rel="stylesheet">
<style>
  @page { size: A4; margin: 14mm 14mm 16mm; }
  body { font-family: -apple-system, 'Helvetica Neue', Roboto, Arial, sans-serif; color: #002017; font-size: 10pt; margin: 0; line-height: 1.45; }
  .band { background: #02422B; color: #EFECD3; padding: 18px 22px; border-radius: 6px; display: flex; justify-content: space-between; align-items: flex-end; }
  .wm { font-family: 'Playfair Display', Georgia, serif; color: #DABD38; font-weight: 600; font-size: 24pt; line-height: 1; }
  .wm small { font-size: 9pt; letter-spacing: 3px; display: block; color: #EFECD3; font-family: inherit; margin-top: 6px; }
  .title { font-family: 'Playfair Display', Georgia, serif; font-size: 16pt; text-align: right; }
  .title small { display: block; font-family: inherit; font-size: 9pt; opacity: .8; margin-top: 4px; }
  .cols { display: flex; gap: 14px; margin-top: 16px; }
  .panel { flex: 1; background: #F7F5E9; border: 1px solid #E4DECB; border-radius: 6px; padding: 12px 14px; }
  .lab { font-size: 7.5pt; letter-spacing: 1.5px; text-transform: uppercase; color: #37584F; font-weight: 700; margin-bottom: 6px; }
  .nm { font-weight: 700; font-size: 11pt; }
  .amt { margin-top: 16px; border: 2px solid #02422B; border-radius: 6px; padding: 14px 18px; display: flex; justify-content: space-between; align-items: center; }
  .amt .big { font-family: 'Playfair Display', Georgia, serif; font-size: 22pt; color: #02422B; }
  table { width: 100%; border-collapse: collapse; margin-top: 14px; }
  td { padding: 7px 4px; border-bottom: 1px solid #E4DECB; vertical-align: top; }
  td.k { color: #37584F; width: 42%; } td.v { text-align: right; font-variant-numeric: tabular-nums; }
  h3 { font-family: 'Playfair Display', Georgia, serif; color: #02422B; font-size: 12pt; margin: 20px 0 2px; }
  .note { margin-top: 12px; color: #37584F; font-size: 9pt; }
  .ft { margin-top: 28px; padding-top: 10px; border-top: 1px solid #E4DECB; font-size: 8pt; color: #37584F; display: flex; justify-content: space-between; gap: 12px; }
</style></head><body>
<div class="band"><div class="wm">Qode<small>QODE ADVISORS LLP</small></div><div class="title">Payment Receipt<small>${esc(receiptNumber(inv))} · ${dl(inv.paidOn)}</small></div></div>
<div class="cols">
  <div class="panel"><div class="lab">Paid by</div><div class="nm">${esc(E.name)}</div>
    ${esc(E.addressLine1)}<br>${esc(E.addressLine2)}<br>${esc(E.city)}, ${esc(E.state)} ${esc(E.pincode)}<br>
    GSTIN ${esc(E.gstin)} · PAN ${esc(E.pan)}<br>SEBI PMS ${esc(E.sebiRegistration)}</div>
  <div class="panel"><div class="lab">Paid to</div><div class="nm">${esc(payee)}</div>
    ${inv.gstin ? `GSTIN ${esc(inv.gstin)}<br>` : ''}${inv.pan ? `PAN ${esc(inv.pan)}<br>` : ''}${esc(inv.partnerEmail)}${bank ? `<br>${esc(bank)}` : ''}</div>
</div>
<div class="amt"><div><div class="lab" style="margin:0">Amount paid</div>${inv.paymentRef ? `Reference / UTR: <b>${esc(inv.paymentRef)}</b>` : ''}</div><div class="big">${inr(inv.paidAmount)}</div></div>
<h3>Against invoice</h3>
<table>
  ${row('Invoice number', esc(inv.invoiceNumber))}
  ${row('Invoice date', dl(inv.invoiceDate))}
  ${row('Period', esc(inv.periodLabel || '—'))}
  ${row('Amount before GST', inr(inv.amountBeforeTax))}
  ${row('GST', inr(inv.taxAmount))}
  ${row('<b>Invoice total</b>', `<b>${inr(inv.totalAmount)}</b>`)}
  ${row('Paid on', dl(inv.paidOn))}
  ${row('<b>Amount paid</b>', `<b>${inr(inv.paidAmount)}</b>`)}
  ${Math.abs(diff) >= 0.01 ? row(diff > 0 ? 'Difference (e.g. TDS deducted)' : 'Paid above the invoice', inr(Math.abs(diff))) : ''}
</table>
${inv.paymentNote ? `<div class="note">Note: ${esc(inv.paymentNote)}</div>` : ''}
<div class="ft"><div><b style="color:#02422B">Qode Advisors LLP</b> · SEBI Registered Portfolio Manager<br>This is a computer generated receipt and does not require a signature.</div><div style="text-align:right">Questions: partnerships@qodeinvest.com</div></div>
</body></html>`
}
