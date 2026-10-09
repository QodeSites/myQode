// Recent Activity / Transactions list: the custodian's own money-movement entries, read straight from
// pms_clients_tracker.pms_transactions (the same table the Transactions report reads), and only the kinds the
// investor did on purpose (decided 8 Oct 2026):
//
//   positive  Corpus Deposits (CS+), Security in (OPI), Full Switch In (SII)
//   negative  Corpus Withdrawal (CS-), Security out (OPO), Full Switch Out (SOO)
//
// Nothing else: no TDS on payout, partial switches, fees, charges, interest, trades — and nothing within these six left out either.
// Amounts are as the custodian booked them.
//
// own: whether the investor made it himself (Recent Activity shows only these; totals and the Transactions page keep
// everything). Decided 8 Oct 2026: only money in and out of the investor's bank —
//   own      Corpus Deposit (CS+), its first per account labelled First Investment and "Top Up" memos Top-up;
//            Corpus Withdrawal (CS-)
//   not own  Security In / Out (OPI / OPO: shares moved in, corporate actions, MF→share changes), Full Switch In / Out,
//            a dividend booked as corpus in, and a CS± that the custodian paired with a same-day OPI / OPO of the
//            same amount (e.g. 7 Aug 2026, City Union Bank shares "switched in" against a ₹215.96 "Corpus Out").
//   The investor's same-day, same-account deposits (or withdrawals) are one line (the custodian splits some, e.g.
//   ₹100 + ₹3,74,900 for a ₹3,75,000 withdrawal), and one still under ₹1,000 after that is not shown as his (OWN_MIN).
// (Until 8 Oct this list was built from pms_master_sheet's daily net cash_in_out, labelled by matching it to these
// rows; a re-valued or unmatched day then went unexplained or missing.)
import { query as q1 } from '@/lib/db1'
import { query } from '@/lib/db'
import { getStrategyName } from '@/lib/strategyConfig'

const KINDS: Record<string, { label: string; sign: 1 | -1 }> = {
  'CS+': { label: 'Corpus Deposit', sign: 1 },
  OPI: { label: 'Security In', sign: 1 },
  SII: { label: 'Switch In', sign: 1 },
  PSI: { label: 'Switch In', sign: 1 },
  'CS-': { label: 'Corpus Withdrawal', sign: -1 },
  OPO: { label: 'Security Out', sign: -1 },
  SOO: { label: 'Switch Out', sign: -1 },
  PSO: { label: 'Switch Out', sign: -1 },
}
// Strategy switches and share transfers are the investor's too (8 Oct 2026, QTF00085 was funded only by switches and
// showed "No transactions recorded yet"): partial / full switches (PSI PSO SII SOO), shares moved by a switch (OPI / OPO
// "Switch In / Out", "Stock Swich …") and shares he transferred in or out (OPI / OPO "Stock In / Out") are shown, one
// line per account, day and direction, naming the other strategy where the custodian booked it. Not shown: the
// MF→share re-typing pairs ("Change in Asset type") and a security booked against a same-day cash entry of the same
// amount (a corporate action). A switch whose receiving side the custodian did not book (18 Aug 2026: QAW00089 sent
// 53 stocks, ₹20,05,014.63, to QTF00085, which has no "in" entry) is taken from the receiver's daily cash that day.
const OWN_MIN = 1000   // ₹: smaller investor entries are left out of Recent Activity (totals keep them)
// Only what the client did himself, never the custodian's internal bookkeeping (Sanket, 9 Oct 2026: "200% sure"):
const SWITCH_MIN = 10000      // ₹: a switch / share move under this is Nuvama sweeping leftover cash between accounts,
                              // and a CORPUS OUT under it is the custodian settling something (21 Apr 2026: ₹1,837–₹6,126
                              // out of nine related accounts; 2 Jul 2025: ₹2,674.51 "Redemption" from two accounts at once).
                              // Small deposits stay: their memo names the client as payer ("Top Up Received from …").
const INFERRED_MIN = 100000   // ₹: a line inferred from the daily cash (no custodian entry of its own) must be at least this
const strat = (code: string) => { const n = getStrategyName(code); return n === 'Unknown Strategy' ? code : n }

export type LedgerFlow = {
  date: string              // YYYY-MM-DD
  amount: number            // signed: in positive, out negative
  type: 'inflow' | 'outflow'
  label: string             // the kind, as above
  detail: string            // the strategy
  code: string              // strategy account
  kind: string              // tran_type
  memo: string              // custodian's note
  own: boolean              // made by the investor (see above)
  formattedAmount: string
}

export const formatINR = (amount: number): string =>
  `${amount >= 0 ? '+' : '–'}₹${Math.abs(amount).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

/** Strategy accounts behind an id: a strategy code itself, or every account of an owner / group id. */
export async function accountsBehind(id: string): Promise<string[]> {
  if (/^Q[A-Z]{2}\d/i.test(id)) return [id.toUpperCase()]
  const plain = id.replace(/\.0+$/, '')
  const r = await query(
    `SELECT DISTINCT clientcode FROM pms_clients_master
      WHERE clientcode IS NOT NULL AND (ownerid IN ($1, $2) OR groupid IN ($1, $2))`, [plain, plain + '.0'])
  return r.rows.map((x: any) => x.clientcode)
}

/** The intentional money movements of these accounts, oldest first; `upTo` (YYYY-MM-DD) caps a closed account. */
export async function ledgerFlows(codes: string[], upTo?: string | null): Promise<LedgerFlow[]> {
  if (!codes.length) return []
  const kinds = Object.keys(KINDS)
  // the owners' other accounts too: to name where a switch came from / went to, and to find an unbooked receiving side
  const sib = await query(
    `SELECT DISTINCT b.clientcode FROM pms_clients_master a JOIN pms_clients_master b ON b.ownerid = a.ownerid
      WHERE a.clientcode = ANY($1) AND b.clientcode IS NOT NULL`, [codes])
  const family = [...new Set([...codes, ...sib.rows.map((x: any) => x.clientcode as string)])]
  const r = await q1(
    `SELECT ws_account_code AS code, tran_type AS kind, trandate::text AS date, net_amount::float8 AS amt, COALESCE(descmemo, '') AS memo
       FROM pms_clients_tracker.pms_transactions
      WHERE ws_account_code = ANY($1) AND tran_type = ANY($2) ${upTo ? 'AND trandate <= $3' : ''}
      ORDER BY trandate, id`, upTo ? [family, kinds, upTo] : [family, kinds])
  const all = r.rows.map((x: any) => ({ ...x, abs: Math.round(Math.abs(Number(x.amt) || 0) * 100) }))
  const mine = new Set(codes)
  const rows = all.filter((x: any) => mine.has(x.code))
  // a corpus entry the custodian booked against a security moving in / out on the same day, for the same amount
  const sec = new Set(rows.filter((x: any) => x.kind === 'OPI' || x.kind === 'OPO').map((x: any) => `${x.code}|${x.date}|${x.abs}`))
  const cashKey = new Set(rows.filter((x: any) => x.kind === 'CS+' || x.kind === 'CS-').map((x: any) => `${x.code}|${x.date}|${x.abs}`))
  const firstIn = new Map<string, string>()   // account → date of its first corpus deposit
  for (const x of rows) if (x.kind === 'CS+' && !/dividend/i.test(x.memo) && !firstIn.has(x.code)) firstIn.set(x.code, x.date)
  const seenFirst = new Set<string>()
  // a switch line: in or out, shares or cash; the other side = the family's accounts moving the other way that day
  const switchDir = (x: any): 'in' | 'out' | null => {
    if (x.kind === 'PSI' || x.kind === 'SII') return 'in'
    if (x.kind === 'PSO' || x.kind === 'SOO') return 'out'
    if ((x.kind === 'OPI' || x.kind === 'OPO') && /swi?t?ch/i.test(x.memo)) return x.kind === 'OPI' ? 'in' : 'out'
    return null
  }
  const otherSide = (code: string, date: string, dir: 'in' | 'out') => {
    // Qode Future Horizons is never named (hidden everywhere, its constituents counted): its switches read plain "Switch In"
    const names = [...new Set(all.filter((y: any) => y.code !== code && y.date === date && !/^QFH/i.test(y.code) && switchDir(y) === (dir === 'in' ? 'out' : 'in')).map((y: any) => strat(y.code)))].sort()
    return names.length ? names.join(' & ') : null
  }
  // the accounts' daily cash in / out (pms_master_sheet): a switch or share line is the investor's only when that day's
  // cash counted money moving that way — otherwise it is bookkeeping the account's figures never counted (QTF00085:
  // share "Switch In"s from Feb–Jun 2026, before its first daily row on 27 Apr, ~₹30 L, while it was part of QFH)
  const dayCash = new Map<string, number>()
  for (const c of (await query(
    `SELECT account_code AS code, report_date::text AS date, cash_in_out::float8 AS cf FROM public.pms_master_sheet
      WHERE account_code = ANY($1) AND cash_in_out <> 0`, [family])).rows) dayCash.set(`${c.code}|${String(c.date).slice(0, 10)}`, Number(c.cf) || 0)
  // counted that day — or, for money / shares going OUT, within 10 days around it for at least half the amount: the daily
  // cash and the custodian's entry can be days apart (QTF00047: −₹25.92 L in the daily cash on 23 Dec 2025, its
  // "Stock Out" of ₹24.98 L to QAW00049 booked on 30 Dec)
  const counted = (code: string, date: string, sign: number, amount = 0) => {
    if ((dayCash.get(`${code}|${date}`) || 0) * sign > 0) return true
    if (sign > 0 || !amount) return false
    const t = Date.parse(date)
    for (const [k, cf] of dayCash) {
      const [c, d] = k.split('|')
      if (c === code && cf < 0 && Math.abs(Date.parse(d) - t) <= 10 * 86400000 && -cf >= Math.abs(amount) * 0.5) return true
    }
    return false
  }
  const flows: LedgerFlow[] = rows.map((x: any) => {
    const k = KINDS[x.kind], amount = k.sign * Math.abs(Number(x.amt) || 0)
    const cash = x.kind === 'CS+' || x.kind === 'CS-'
    const security = x.kind === 'OPI' || x.kind === 'OPO'
    const paired = cash && sec.has(`${x.code}|${x.date}|${x.abs}`)
    const dividend = x.kind === 'CS+' && /dividend/i.test(x.memo)
    const sw = switchDir(x)
    const retype = security && /change in asset type/i.test(x.memo)
    const corpAction = security && cashKey.has(`${x.code}|${x.date}|${x.abs}`)
    const transfer = security && !sw && /stock (in|out)/i.test(x.memo)
    const moved = counted(x.code, x.date, k.sign, Number(x.amt) || 0)
    const own = (cash && !paired && !dividend) || (!!sw && !corpAction && moved) || (transfer && !retype && !corpAction && moved)
    let label = k.label, group = x.kind
    if (own && x.kind === 'CS+') {
      if (firstIn.get(x.code) === x.date && !seenFirst.has(x.code)) { label = 'First Investment'; seenFirst.add(x.code) }
      else if (/top\s*-?\s*up/i.test(x.memo)) label = 'Top-up'
    }
    if (dividend) label = 'Dividend'
    if (sw && own) {
      const other = otherSide(x.code, x.date, sw)
      label = sw === 'in' ? 'Switch In' + (other ? ' from ' + other : '') : 'Switch Out' + (other ? ' to ' + other : '')
      group = 'SW-' + sw   // shares and cash of one switch on one day: one line
    }
    if (transfer && own) { label = x.kind === 'OPI' ? 'Shares Transferred In' : 'Shares Transferred Out'; group = 'TR-' + x.kind }
    return { date: x.date, amount, type: amount >= 0 ? 'inflow' : 'outflow', label, detail: strat(x.code),
      code: x.code, kind: group, memo: x.memo, own, formattedAmount: formatINR(amount) } as LedgerFlow
  })
  // Reconcile with the daily cash (8 Oct 2026): on any day the account's cash counted more money in (or out) than the
  // lines above explain, the rest gets a line of its own, named by what happened that day — so Recent Activity adds up
  // to the account's money in and out. Smaller gaps (a same-day TDS, a dividend) are left alone.
  //   first day with money               → Portfolio Transferred In  (QGF0006: ₹47.4 L of shares beside a ₹5 L deposit)
  //   a family account moved the other way → Switch In from / Out to … (QAW00049 ← QTF00047 "Stock Out" ₹24.98 L)
  //   shares booked in / out that day     → Shares Transferred In / Out (QGF00021: booked by the custodian at ₹0)
  //   nothing that identifies it         → NOT shown (it may be the custodian's own bookkeeping); money out is
  //                                         filled in only for a switch (withdrawals come from the custodian's entries)
  // the family accounts that moved the other way that day, for about the same amount (within ₹1,000 or 5%: shares are
  // priced differently on the two sides, e.g. ₹19,90,933 out vs ₹20,12,959 in on 14 Aug 2025): a same-day
  // coincidence is not a switch (Yogita 10 Jul 2026: QAW00057's ₹1,015.07 TDS on interest is not her ₹82,42,800
  // Growth Fund → Liquid Fund switch)
  const sibMoved = (code: string, date: string, dir: 'in' | 'out', amount?: number) => {
    const near = (a: number) => amount == null || Math.abs(Math.abs(a) - Math.abs(amount)) <= Math.max(1000, Math.abs(amount) * 0.05)
    const names = new Set<string>()
    for (const [k, cf] of dayCash) {
      const [c, d] = k.split('|')
      if (c !== code && d === date && (dir === 'in' ? cf < 0 : cf > 0) && !/^QFH/i.test(c) && near(cf)) names.add(strat(c))
    }
    const moves = new Map<string, number>()   // ledger moves summed per account that day
    for (const y of all) if (y.code !== code && y.date === date && !/^QFH/i.test(y.code) && (switchDir(y) === (dir === 'in' ? 'out' : 'in')
      || (y.kind === (dir === 'in' ? 'OPO' : 'OPI') && !/change in asset type/i.test(y.memo)))) moves.set(y.code, (moves.get(y.code) || 0) + Math.abs(Number(y.amt) || 0))
    for (const [c, a] of moves) if (near(a)) names.add(strat(c))
    return [...names].sort()
  }
  for (const code of codes) {
    const days = [...dayCash.entries()].filter(([k]) => k.startsWith(code + '|')).map(([k, cf]) => ({ date: k.split('|')[1], cf }))
      .filter(x => !upTo || x.date <= upTo).sort((a, b) => a.date.localeCompare(b.date))
    const firstIn = days.find(x => x.cf > 0)
    for (const { date, cf } of days) {
      const shown = flows.filter(f => f.code === code && f.date === date && f.own).reduce((t, f) => t + f.amount, 0)
      const rest = cf - shown
      if (Math.abs(rest) < INFERRED_MIN || Math.sign(rest) !== Math.sign(cf)) continue
      const dir: 'in' | 'out' = rest > 0 ? 'in' : 'out'
      const others = sibMoved(code, date, dir, rest)
      // money out: the custodian's withdrawal entries are the record (the daily cash often has a withdrawal days before
      // the CORPUS OUT entry — QAW00025: 15 Aug vs 22 Aug 2025 — and its small debits are TDS); only a switch to a
      // family account is filled in from the daily cash
      if (dir === 'out' && !others.length) continue
      const shares = rows.some((x: any) => x.code === code && x.date === date && x.kind === (dir === 'in' ? 'OPI' : 'OPO') && !/change in asset type/i.test(x.memo))
      let label: string, kind: string
      if (dir === 'in' && firstIn && firstIn.date === date && !others.length) { label = 'Portfolio Transferred In'; kind = 'OPEN' }
      else if (others.length) { label = dir === 'in' ? 'Switch In from ' + others.join(' & ') : 'Switch Out to ' + others.join(' & '); kind = 'SW-' + dir }
      else if (shares) { label = dir === 'in' ? 'Shares Transferred In' : 'Shares Transferred Out'; kind = 'TR-' + (dir === 'in' ? 'OPI' : 'OPO') }
      // shares the custodian booked in earlier ("Stock In") that the daily figures had not counted yet: this is them
      // arriving (QAW00353: 23 Stock In entries, 18 Mar – 19 Aug 2026, counted on 5 Oct at ₹7,80,12,310.59)
      else if (dir === 'in' && rows.some((x: any) => x.code === code && x.kind === 'OPI' && x.date < date && /stock in/i.test(x.memo)
        && !flows.some(f => f.code === code && f.date === x.date && f.own))) { label = 'Shares Transferred In'; kind = 'TR-OPI' }
      else continue   // nothing identifies it as the client's own doing: not shown (QAW00057's ₹1,015.07 TDS was one)
      flows.push({ date, amount: rest, type: rest > 0 ? 'inflow' : 'outflow', label, detail: strat(code), code, kind,
        memo: 'From the daily cash in / out (no matching custodian entry)', own: true, formattedAmount: formatINR(rest) })
    }
  }
  flows.sort((a, b) => a.date.localeCompare(b.date))
  const merged = flows
    .filter(f => Math.abs(f.amount) >= 0.005)
    .reduce((out: LedgerFlow[], f) => {   // merge the investor's same-day entries of one kind on one account
      const prev = out.find(o => o.own && f.own && o.code === f.code && o.date === f.date && o.kind === f.kind)
      if (prev) {
        prev.amount += f.amount; prev.formattedAmount = formatINR(prev.amount)
        if (f.label === 'First Investment') prev.label = f.label
      } else out.push({ ...f })
      return out
    }, [])
    .map(f => (f.own && (Math.abs(f.amount) < OWN_MIN || ((/^(SW-|TR-)/.test(f.kind) || f.kind === 'CS-') && Math.abs(f.amount) < SWITCH_MIN)) ? { ...f, own: false } : f))
  // a day's share transfer that a family account received / sent for about the same amount is a switch: name it so
  // (on the merged day total — 15 "Stock Out" lines of QTF00047 on 30 Dec 2025 = the ₹24,98,337.77 QAW00049 received)
  for (const f of merged) if (f.own && /^Shares Transferred (In|Out)$/.test(f.label)) {
    const dir: 'in' | 'out' = f.amount > 0 ? 'in' : 'out'
    const others = sibMoved(f.code, f.date, dir, f.amount)
    if (others.length) { f.label = dir === 'in' ? 'Switch In from ' + others.join(' & ') : 'Switch Out to ' + others.join(' & '); f.kind = 'SW-' + dir }
  }
  return merged
}
