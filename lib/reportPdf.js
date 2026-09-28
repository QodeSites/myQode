// Copied from myqode-native/src/screens/reportPdf.js (same statement design on the web). Keep the two in step.
// PDF statements for the Reports page, in the myQode design (colours from src/ui.js → C): a dark-green header
// band with the gold wordmark, a cream account strip, gold-edged figure tiles, green-headed tables with cream
// zebra rows. The content follows the custodian's (Nuvama WealthSpectrum) statements clients already know.
// Each builder returns { html, landscape } for savePdf (src/screens/partner.js); iOS supplies the page margins.

const K = {
  ink: '#002017', green: '#02422B', gold: '#DABD38', cream: '#EFECD3', card: '#F7F5E9', muted: '#37584F',
  hair: '#DCD8C0', pos: '#15803D', neg: '#C62828', goldTint: '#F5EDC8',
};
const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
// Figures: Indian grouping, 2 decimals, "−" for negatives; sign on the rounded value (no "−0.00").
const nf = (v, dp = 2) => {
  if (v == null || isNaN(v)) return '';
  const r = +(+v).toFixed(dp);
  return (r < 0 ? '−' : '') + Math.abs(r).toLocaleString('en-IN', { minimumFractionDigits: dp, maximumFractionDigits: dp });
};
const inr = (v, dp = 2) => (v == null || isNaN(v) ? '—' : (+(+v).toFixed(dp) < 0 ? '−' : '') + '₹' + nf(Math.abs(v), dp));
const qty = v => (v == null ? '' : Number(v).toLocaleString('en-IN', { maximumFractionDigits: 4 }));
const pc = v => (v == null || isNaN(v) ? '—' : (+(+v).toFixed(2) < 0 ? '−' : '') + Math.abs(+v).toFixed(2) + '%');
const MS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const MON = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
// Dates: "25 Sep 2026" in headers, "25/09/26" in dense tables.
const dl = iso => (iso ? `${iso.slice(8, 10)} ${MS[+iso.slice(5, 7) - 1]} ${iso.slice(0, 4)}` : '—');
const ds = iso => (iso ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(2, 4)}` : '');
const today = () => { const t = new Date(); return `${String(t.getDate()).padStart(2, '0')} ${MS[t.getMonth()]} ${t.getFullYear()}`; };
const cls = v => (v == null || isNaN(v) ? '' : +(+v).toFixed(2) < 0 ? 'neg' : +(+v).toFixed(2) > 0 ? 'pos' : '');

const CSS = landscape => `
  @page { size: A4 ${landscape ? 'landscape' : 'portrait'}; margin: 10mm; }
  * { box-sizing: border-box; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  html, body { width: 100%; }
  body { font-family: -apple-system, 'Helvetica Neue', Roboto, Arial, sans-serif; color: ${K.ink}; font-size: ${landscape ? 7.3 : 7.8}pt; margin: 0; line-height: 1.35; }
  .band { background: linear-gradient(120deg, ${K.green} 0%, ${K.ink} 75%); color: ${K.cream}; border-radius: 6px; padding: 14px 18px 13px; display: table; width: 100%; }
  .band > div { display: table-cell; vertical-align: middle; }
  .wm { font-family: 'Playfair Display', Georgia, 'Times New Roman', serif; color: ${K.gold}; font-weight: 600; font-size: 26pt; line-height: 1; letter-spacing: .2px; }
  .wm small { font-size: 14pt; }
  .firm { font-size: 6.6pt; letter-spacing: 1.4px; color: rgba(239,236,211,.7); margin-top: 5px; }
  .rt { text-align: right; }
  .rtitle { font-family: 'Playfair Display', Georgia, serif; font-size: ${landscape ? 16 : 15}pt; font-weight: 600; color: ${K.cream}; }
  .accent { width: 38px; height: 2px; background: ${K.gold}; margin: 7px 0 0 auto; }
  .asof { font-size: 7.4pt; color: rgba(239,236,211,.75); margin-top: 6px; letter-spacing: .3px; }
  .strip { background: ${K.card}; border: 1px solid ${K.hair}; border-radius: 6px; margin-top: 8px; padding: 8px 12px; display: table; width: 100%; table-layout: fixed; }
  .strip > div { display: table-cell; vertical-align: top; padding-right: 10px; }
  .lbl { font-size: 6.2pt; font-weight: 700; letter-spacing: 1.1px; color: ${K.muted}; text-transform: uppercase; }
  .val { font-size: 8.4pt; font-weight: 600; margin-top: 2px; }
  .tiles { display: table; width: 100%; table-layout: fixed; border-spacing: 8px 0; margin: 10px -8px 2px; }
  .tile { display: table-cell; background: ${K.card}; border: 1px solid ${K.hair}; border-top: 2.5px solid ${K.gold}; border-radius: 5px; padding: 8px 10px; }
  .tile .v { font-size: 11.5pt; font-weight: 700; margin-top: 3px; font-variant-numeric: tabular-nums; }
  h3 { font-family: 'Playfair Display', Georgia, serif; font-size: 10.5pt; font-weight: 600; color: ${K.green}; margin: 14px 0 5px; }
  h3::after { content: ''; display: block; width: 26px; height: 1.6px; background: ${K.gold}; margin-top: 3px; }
  table { width: 100%; border-collapse: collapse; }
  table.fixed { table-layout: fixed; }
  thead { display: table-header-group; }
  tr { page-break-inside: avoid; }
  th { background: ${K.green}; color: ${K.cream}; font-weight: 700; font-size: .92em; letter-spacing: .2px; text-align: left; padding: 5px 5px; vertical-align: bottom; }
  thead tr.grp th { background: ${K.ink}; color: ${K.gold}; text-align: center; font-size: .85em; letter-spacing: 1px; text-transform: uppercase; padding: 3px 5px; }
  td { padding: 4px 5px; vertical-align: top; border-bottom: .5px solid ${K.hair}; }
  tbody tr.z:nth-child(even) td { background: ${K.card}; }
  .r { text-align: right; white-space: nowrap; font-variant-numeric: tabular-nums; }
  th.r { white-space: normal; }
  td.wrap { word-wrap: break-word; }
  .sec td { background: ${K.goldTint} !important; color: ${K.green}; font-weight: 700; letter-spacing: .2px; border-bottom: 1px solid ${K.gold}; }
  .tot td { font-weight: 700; border-top: 1.5px solid ${K.green}; border-bottom: none; background: none !important; color: ${K.green}; }
  .pos { color: ${K.pos}; } .neg { color: ${K.neg}; }
  .note { color: ${K.muted}; font-size: 6.8pt; margin-top: 4px; line-height: 1.45; }
  .two { display: table; width: 100%; table-layout: fixed; }
  .two > div { display: table-cell; vertical-align: top; }
  .two > div:first-child { padding-right: 16px; }
  .bar { height: 6px; background: ${K.hair}; border-radius: 3px; overflow: hidden; margin-top: 3px; }
  .bar > i { display: block; height: 6px; background: ${K.green}; border-radius: 3px; }
  .srow { padding: 4px 0 5px; border-bottom: .5px solid ${K.hair}; }
  .srow b { float: right; font-variant-numeric: tabular-nums; }
  .dot { display: inline-block; width: 7px; height: 7px; border-radius: 2px; margin-right: 5px; vertical-align: 0; }
  .ft { margin-top: 16px; border-top: 1.4px solid ${K.gold}; padding-top: 5px; display: table; width: 100%; font-size: 6.6pt; color: ${K.muted}; }
  .ft > div { display: table-cell; vertical-align: top; }
  .pb { page-break-before: always; }
`;
const page = (landscape, head, body) => `<!doctype html><html data-report="1"><head><meta charset="utf-8"><style>${CSS(landscape)}</style></head><body>${head}${body}
<div class="ft"><div><b style="color:${K.green}">Qode Advisors LLP</b> · SEBI Registered Portfolio Manager · Data: Nuvama WealthSpectrum (custodian)<br>This is a computer generated report and does not require a signature.</div><div class="rt">Generated ${today()}<br>from the myQode app</div></div></body></html>`;

// Header band + account strip. fields: [[label, value]]
const header = (title, asOf, fields) => `
  <div class="band"><div><div class="wm"><small>my</small>Qode</div><div class="firm">QODE ADVISORS LLP · SEBI REGISTERED PMS</div></div>
    <div class="rt"><div class="rtitle">${esc(title)}</div><div class="accent"></div>${asOf ? `<div class="asof">As of ${esc(dl(asOf))}</div>` : ''}</div></div>
  <div class="strip">${fields.filter(f => f && f[1]).map(([l, v]) => `<div><div class="lbl">${esc(l)}</div><div class="val">${esc(v)}</div></div>`).join('')}</div>`;
const tiles = list => `<div class="tiles">${list.map(([l, v, c]) => `<div class="tile"><div class="lbl">${esc(l)}</div><div class="v ${c || ''}">${v}</div></div>`).join('')}</div>`;
const strategyName = (holder, fallback) => String((holder && holder.strategy) || fallback || '').replace(/^QODE ADVISORS LLP - /, '');
const acctFields = (accountId, holder, fallbackStrategy) => [['Account', accountId], ['Account holder', holder && holder.name], ['Strategy', strategyName(holder, fallbackStrategy)]];

// ── Transaction statement ─────────────────────────────────────────────────────────────────────────────────
export function transactionsPdf(r, accountId, groupLabel) {
  const head = header('Transaction Statement', r.asOf, [...acctFields(accountId, r.holder), ['Showing', groupLabel || 'All']]);
  const flows = tiles([['Money in', inr(r.moneyIn), 'pos'], ['Money out', inr(r.moneyOut)], ...r.summary.filter(s => s.group !== 'money').slice(0, 2).map(s => [`${s.label} · ${s.count}`, inr(s.amount)])]);
  let last = '';
  const rows = r.items.map(t => {
    const m = (t.date || '').slice(0, 7), sec = m !== last ? `<tr class="sec"><td colspan="7">${m ? `${MON[+m.slice(5, 7) - 1]} ${m.slice(0, 4)}` : ''}</td></tr>` : '';
    last = m;
    const amt = (t.direction === 'out' ? -1 : 1) * (t.amount || 0);
    return sec + `<tr class="z"><td>${ds(t.date)}</td><td>${ds(t.settleDate)}</td><td>${esc(t.type)}</td><td class="wrap">${esc(t.security || t.notes || '')}</td>
      <td class="r">${qty(t.qty)}</td><td class="r">${t.rate != null ? nf(t.rate) : ''}</td><td class="r ${t.direction === 'in' ? 'pos' : ''}">${nf(amt)}</td></tr>`;
  }).join('');
  const body = flows + `<h3>Transactions${r.hasMore ? ' <span class="note">(latest 5,000)</span>' : ''}</h3>
    <table class="fixed"><colgroup><col style="width:9%"><col style="width:9%"><col style="width:17%"><col><col style="width:10%"><col style="width:10%"><col style="width:14%"></colgroup>
    <thead><tr><th>Date</th><th>Settled</th><th>Transaction</th><th>Security / details</th><th class="r">Quantity</th><th class="r">Rate</th><th class="r">Amount (₹)</th></tr></thead><tbody>${rows}</tbody></table>`;
  return { html: page(false, head, body), landscape: false };
}

// ── Capital gain / loss (landscape; per category, with the advance-tax quarter summary) ──────────────────
const QUARTERS = ['01/04–15/06', '16/06–15/09', '16/09–15/12', '16/12–15/03', '16/03–31/03'];
const quarterOf = iso => {
  const k = +iso.slice(5, 7) * 100 + +iso.slice(8, 10);
  if (k >= 401 && k <= 615) return 0;
  if (k >= 616 && k <= 915) return 1;
  if (k >= 916 && k <= 1215) return 2;
  if (k >= 1216 || k <= 315) return 3;
  return 4;
};
export function capitalGainsPdf(r, accountId) {
  const from = r.fy ? `${r.fy.slice(0, 4)}-04-01` : null, fyEnd = r.fy ? `${+r.fy.slice(0, 4) + 1}-03-31` : null;
  const to = r.asOf && fyEnd && r.asOf < fyEnd ? r.asOf : fyEnd;
  const head = header('Statement of Capital Gain / Loss', r.asOf, [...acctFields(accountId, r.holder), ['Period', from ? `${dl(from)} – ${dl(to)}` : '']]);
  const S = r.summary || { st: 0, lt: 0, ltTaxable: 0, total: 0 };
  const sum = tiles([[`FY ${r.fy || ''} · Short term`, inr(S.st), cls(S.st)], ['Long term', inr(S.lt), cls(S.lt)], ['Long term (effective)', inr(S.ltTaxable), cls(S.ltTaxable)], ['Total realised', inr(S.total), cls(S.total)]]);
  const cats = [];
  for (const l of r.items) { const c = l.category || 'Other'; let g = cats.find(x => x.c === c); if (!g) cats.push(g = { c, lots: [] }); g.lots.push(l); }
  const colg = '<colgroup>' + [19, 6, 7, 7, 8, 6, 7, 8, 8, 4, 8, 6, 6].map(w => `<col style="width:${w}%">`).join('') + '</colgroup>';
  const head2 = `${colg}<thead><tr class="grp"><th></th><th colspan="4">Sale</th><th colspan="4">Purchase</th><th></th><th colspan="3">Realised gain / loss</th></tr>
    <tr><th>Security</th><th>Date</th><th class="r">Quantity</th><th class="r">Rate (S)</th><th class="r">Amount</th><th>Date</th><th class="r">Rate (P)</th><th class="r">Amount</th>
    <th class="r">Effective cost</th><th class="r">Days</th><th class="r">Short term</th><th class="r">Long term</th><th class="r">Effective LT</th></tr></thead>`;
  const sections = cats.map((g, gi) => {
    const T = { sale: 0, pur: 0, cost: 0, st: 0, lt: 0, eff: 0 }, Q = { st: [0, 0, 0, 0, 0], lt: [0, 0, 0, 0, 0] };
    const rows = g.lots.map(l => {
      const st = l.term === 'ST' ? l.gain : 0, lt = l.term === 'LT' ? l.gain : 0, eff = l.term === 'LT' ? (l.ltTaxable != null ? l.ltTaxable : l.gain) : 0;
      T.sale += l.saleAmount || 0; T.pur += l.purchaseAmount || 0; T.cost += l.cost || 0; T.st += st; T.lt += lt; T.eff += eff;
      if (l.saleDate) { const q = quarterOf(l.saleDate); Q.st[q] += st; Q.lt[q] += eff; }
      return `<tr class="z"><td class="wrap">${esc(l.security)}</td><td>${ds(l.saleDate)}</td><td class="r">${qty(l.qty)}</td><td class="r">${l.saleRate != null ? nf(l.saleRate, 4) : ''}</td>
        <td class="r">${nf(l.saleAmount)}</td><td>${ds(l.purchaseDate)}</td><td class="r">${l.purchaseRate != null ? nf(l.purchaseRate, 4) : ''}</td><td class="r">${nf(l.purchaseAmount)}</td>
        <td class="r">${nf(l.cost)}</td><td class="r">${l.daysHeld != null ? l.daysHeld : ''}</td>
        <td class="r ${cls(st)}">${nf(st)}</td><td class="r ${cls(lt)}">${nf(lt)}</td><td class="r">${nf(eff)}</td></tr>`;
    }).join('');
    const quarters = `<h3>Quarter-wise summary · ${esc(g.c)}</h3>
      <table class="fixed"><colgroup><col style="width:13%">${QUARTERS.map(() => '<col style="width:10%">').join('')}<col style="width:10%"><col style="width:12%"><col style="width:15%"></colgroup>
      <thead><tr><th></th>${QUARTERS.map(q => `<th class="r">${q}</th>`).join('')}<th class="r">Total</th><th class="r">Sale value</th><th class="r">Effective cost</th></tr></thead><tbody>
      <tr class="z"><td><b>Short term</b></td>${Q.st.map(v => `<td class="r ${cls(v)}">${nf(v)}</td>`).join('')}<td class="r ${cls(T.st)}"><b>${nf(T.st)}</b></td><td class="r">${nf(T.sale)}</td><td class="r">${nf(T.cost)}</td></tr>
      <tr class="z"><td><b>Long term</b></td>${Q.lt.map(v => `<td class="r ${cls(v)}">${nf(v)}</td>`).join('')}<td class="r ${cls(T.eff)}"><b>${nf(T.eff)}</b></td><td></td><td></td></tr></tbody></table>
      <p class="note">Based on effective gain (after grandfathering / indexation). Quarters follow the advance-tax instalment dates.</p>`;
    return `${gi ? '<div class="pb"></div>' : ''}<h3>${esc(g.c)}</h3><table class="fixed">${head2}<tbody>${rows}
      <tr class="tot"><td>Total</td><td></td><td></td><td></td><td class="r">${nf(T.sale)}</td><td></td><td></td><td class="r">${nf(T.pur)}</td><td class="r">${nf(T.cost)}</td><td></td>
      <td class="r">${nf(T.st)}</td><td class="r">${nf(T.lt)}</td><td class="r">${nf(T.eff)}</td></tr></tbody></table>${quarters}`;
  }).join('');
  const body = sum + (cats.length ? sections : '<p class="note">No realised gains in this period.</p>') + (r.hasMore ? '<p class="note">Showing the latest 5,000 lots.</p>' : '');
  return { html: page(true, head, body), landscape: true };
}

// ── Statement of expenses ─────────────────────────────────────────────────────────────────────────────────
export function expensesPdf(r, accountId) {
  const head = header('Statement of Expenses', r.asOf, [...acctFields(accountId, r.holder, r.strategy), ['Period', r.period ? `${dl(r.period.from)} – ${dl(r.period.to)}` : '']]);
  const top = tiles([['Paid', inr(r.paid)], ['Payable (accrued)', inr(r.payable)], ['Total', inr((r.paid || 0) + (r.payable || 0))]]);
  const max = Math.max(1, ...r.byType.map(t => t.amount || 0));
  const byType = `<h3>By charge</h3>${r.byType.map(t => `<div class="srow">${esc(t.type)} <span class="note">· ${t.count} ${t.count === 1 ? 'entry' : 'entries'}</span><b>${inr(t.amount)}</b>
    <div class="bar"><i style="width:${Math.max(1, (t.amount || 0) / max * 100).toFixed(1)}%"></i></div></div>`).join('')}`;
  const block = (label, status) => {
    const items = r.items.filter(x => (x.status || 'paid') === status);
    if (!items.length) return '';
    const tot = items.reduce((s, x) => s + (x.amount || 0), 0);
    return `<tr class="sec"><td colspan="5">${label}</td></tr>` + items.map(x => `<tr class="z"><td>${ds(x.date)}</td><td>${ds(x.settleDate)}</td><td>${esc(x.type)}</td><td class="wrap">${esc(x.notes || '')}</td><td class="r">${nf(x.amount)}</td></tr>`).join('')
      + `<tr class="tot"><td colspan="4">Total ${label.toLowerCase()}</td><td class="r">${nf(tot)}</td></tr>`;
  };
  const body = top + byType + `<h3>Entries${r.type ? ' · ' + esc(r.type) : ''}${r.hasMore ? ' <span class="note">(latest 5,000)</span>' : ''}</h3>
    <table class="fixed"><colgroup><col style="width:10%"><col style="width:10%"><col style="width:24%"><col><col style="width:15%"></colgroup>
    <thead><tr><th>Date</th><th>Settled</th><th>Charge</th><th>Description</th><th class="r">Amount (₹)</th></tr></thead><tbody>
    ${block('Expenses paid', 'paid')}${block('Expenses payable', 'payable')}</tbody></table>`;
  return { html: page(false, head, body), landscape: false };
}

// ── Portfolio fact sheet ──────────────────────────────────────────────────────────────────────────────────
function barChart(periods, a, b) {
  const W = 300, H = 150, L = 34, B = 26, T = 8, vals = [...a, ...b].filter(v => v != null);
  if (!vals.length) return '';
  let lo = Math.min(0, ...vals), hi = Math.max(0, ...vals);
  const step = (() => { const raw = (hi - lo) / 4 || 1, p = Math.pow(10, Math.floor(Math.log10(raw))); return [1, 2, 2.5, 5, 10].map(m => m * p).find(s => s >= raw); })();
  lo = Math.floor(lo / step) * step; hi = Math.ceil(hi / step) * step; if (hi === lo) hi = lo + step;
  const y = v => T + (hi - v) / (hi - lo) * (H - T - B), gw = (W - L) / periods.length, bw = Math.min(20, gw / 3);
  let s = `<svg width="100%" viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMinYMin meet" xmlns="http://www.w3.org/2000/svg" font-family="Helvetica, Arial" font-size="8" style="display:block;max-width:100%">`;
  for (let v = lo; v <= hi + 1e-9; v += step) s += `<line x1="${L}" x2="${W}" y1="${y(v)}" y2="${y(v)}" stroke="${K.hair}" stroke-width=".8" ${Math.abs(v) < 1e-9 ? '' : 'stroke-dasharray="3 3"'}/><text x="${L - 4}" y="${y(v) + 3}" text-anchor="end" fill="${K.muted}">${(+v.toFixed(2)).toFixed(1)}%</text>`;
  s += `<line x1="${L}" x2="${W}" y1="${y(0)}" y2="${y(0)}" stroke="${K.muted}" stroke-width=".8"/>`;
  periods.forEach((p, i) => {
    const cx = L + gw * i + gw / 2;
    [[a[i], K.green, -bw - 1], [b[i], K.gold, 1]].forEach(([v, col, off]) => {
      if (v == null) return;
      const y0 = y(0), y1 = y(v);
      s += `<rect x="${cx + off}" y="${Math.min(y0, y1)}" width="${bw}" height="${Math.max(0.6, Math.abs(y1 - y0))}" rx="1.5" fill="${col}"/>`;
    });
    String(p).split(/\s+(?=\d)/).forEach((ln, k) => { s += `<text x="${cx}" y="${H - B + 11 + k * 9}" text-anchor="middle" fill="${K.ink}">${esc(ln)}</text>`; });
  });
  return s + '</svg>';
}
export function factsheetPdf(r, accountId) {
  const ret = r.returns || {}, periods = ret.periods || [];
  const head = header('Portfolio Fact Sheet', r.asOf, [...acctFields(accountId, r.holder, r.strategy), ['Inception', dl(r.inceptionDate)]]);
  const top = tiles([[`Portfolio value · ${dl(r.valueDate)}`, inr(r.portfolioValue, 0)], ['Profit / loss', inr(r.profitLoss, 0), cls(r.profitLoss)], ['Contribution', inr(r.contribution, 0)], ['Withdrawal', inr(r.withdrawal, 0)]]);
  const sectors = r.sectors.length ? `<h3>Sector allocation</h3>${r.sectors.slice().sort((x, y) => (y.pct || 0) - (x.pct || 0)).map(x => `<div class="srow">${esc(x.sector)}<b>${pc(x.pct)}</b>
    <div class="bar"><i style="width:${Math.max(0.5, Math.min(100, x.pct || 0))}%"></i></div></div>`).join('')}` : '';
  const perf = periods.length ? `<h3>Performance (TWRR)</h3>
    <table class="fixed"><colgroup><col style="width:34%">${periods.map(() => '<col>').join('')}</colgroup><thead><tr><th></th>${periods.map(p => `<th class="r">${esc(p)}</th>`).join('')}</tr></thead><tbody>
      <tr class="z"><td><span class="dot" style="background:${K.green}"></span><b>Portfolio</b></td>${(ret.portfolio || []).map(v => `<td class="r ${cls(v)}">${pc(v)}</td>`).join('')}</tr>
      ${ret.benchmark ? `<tr class="z"><td class="wrap"><span class="dot" style="background:${K.gold}"></span>${esc(ret.benchmark.name)}</td>${ret.benchmark.values.map(v => `<td class="r">${pc(v)}</td>`).join('')}</tr>` : ''}
    </tbody></table>
    <div style="margin-top:8px">${barChart(periods, ret.portfolio || [], (ret.benchmark && ret.benchmark.values) || [])}</div>
    <p class="note">Returns are time-weighted and after management fees and other expenses. Returns over one year are annualised.</p>` : '';
  const tot = r.holdings.reduce((a, x) => a + (x.value || 0), 0);
  const holdings = r.holdings.length ? `<h3>Portfolio holdings · ${r.holdings.length}</h3><table class="fixed"><colgroup><col style="width:5%"><col style="width:50%"><col style="width:19%"><col style="width:15%"><col style="width:11%"></colgroup>
    <thead><tr><th>#</th><th>Security</th><th>Sector</th><th class="r">Market value (₹)</th><th class="r">% of assets</th></tr></thead><tbody>
    ${r.holdings.map((x, i) => `<tr class="z"><td>${i + 1}</td><td class="wrap">${esc(x.security)}</td><td class="wrap">${esc(x.sector)}</td><td class="r">${nf(x.value, 0)}</td><td class="r">${pc(x.pct)}</td></tr>`).join('')}
    <tr class="tot"><td></td><td>Total</td><td></td><td class="r">${nf(tot, 0)}</td><td class="r">100.00%</td></tr></tbody></table>` : '';
  return { html: page(false, head, `${top}<div class="two"><div>${sectors}</div><div>${perf}</div></div>${holdings}`), landscape: false };
}
