// What makes a notification (lib/appNotify.ts delivers them). Each scanner reads the data as it stands and derives
// events with a stable dedupe key, so running it again, after a restart or twice in parallel, sends nothing new.
// On its first run a scanner records a watermark and sends nothing for older data (no backlog flood at launch).
//
//   money      app/Cashfree payments (received, failed, SIP live), SIP instalments, and every investment or
//              withdrawal Nuvama books on an account (pms_master_sheet.cash_in_out), including bank transfers
//   portfolio  monthly update (1st–7th, once the month-end NAV is in), new high, crossing ₹25 L … ₹25 Cr,
//              account anniversary
//   reading    a new newsletter or perspective in S3
import { ListObjectsV2Command } from '@aws-sdk/client-s3'
import { s3 } from '@/lib/s3'
import { query } from '@/lib/db'
import { notifyAccounts, notifyEmails, appAudience, getState, setState } from '@/lib/appNotify'
import { investTimeline, shortDate } from '@/lib/investTimeline'

const inr = (n: number) => {
  const a = Math.abs(n)
  if (a >= 1e7) return `₹${(a / 1e7).toFixed(a >= 1e8 ? 1 : 2).replace(/\.?0+$/, '')} Cr`
  if (a >= 1e5) return `₹${(a / 1e5).toFixed(2).replace(/\.?0+$/, '')} L`
  return '₹' + Math.round(a).toLocaleString('en-IN')
}
const pct = (x: number) => `${x >= 0 ? '+' : '−'}${Math.abs(x).toFixed(1)}%`
const strategy = (s: unknown) => String(s || '').replace(/^QODE ADVISORS LLP\s*-\s*/i, '').toLowerCase().replace(/\b\w/g, c => c.toUpperCase()).trim() || 'your'
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
const dayMon = (iso: string) => { const [, m, d] = iso.split('-'); return `${+d} ${MONTHS[+m - 1].slice(0, 3)}` }
const istToday = () => new Date(Date.now() + 330 * 60000).toISOString().slice(0, 10)

/** First run: remember "now" and report nothing older. */
async function since(key: string): Promise<string> {
  const v = await getState(key)
  if (v) return v
  const now = new Date().toISOString()
  await setState(key, now)
  return now
}

// ── money ─────────────────────────────────────────────────────────────────────────────────────────────────────
export async function scanMoney(): Promise<number> {
  let n = 0
  const from = await since('money.since')

  // Payments made in the app or on the web.
  const pays = (await query(
    `SELECT p.order_id, p.nuvama_code, p.amount, p.payment_type, p.investment_status, p.payment_status, p.frequency, m.schemename, p.payment_time, p.created_at
       FROM payment_transactions p LEFT JOIN pms_clients_master m ON m.clientcode = p.nuvama_code
      WHERE p.updated_at >= $1 AND p.updated_at > NOW() - interval '3 days' AND p.nuvama_code IS NOT NULL`, [from])).rows
  for (const p of pays) {
    const amt = inr(Number(p.amount) || 0), strat = strategy(p.schemename)
    const st = String(p.investment_status || '').toUpperCase()
    if (['PAYMENT_SUCCESS', 'SETTLED', 'DEPLOYED'].includes(st)) {
      const t = await investTimeline(p.payment_time || p.created_at).catch(() => null)
      n += await notifyAccounts([p.nuvama_code], { category: 'money', dedupeKey: `pay:${p.order_id}:received`, link: 'tab:home',
        title: 'Payment received', body: t
          ? `We have received your ${amt} for ${strat}. It will be invested on ${shortDate(t.deployOn)} and show in your portfolio on ${shortDate(t.visibleOn)}.`
          : `We have received your ${amt} for ${strat}. It will be invested on the next working day.` })
    }
    // "Invested" comes from Nuvama's data (the cash_in_out scan below), for app payments and bank transfers alike.
    if (st === 'PAYMENT_FAILED') {
      n += await notifyAccounts([p.nuvama_code], { category: 'money', dedupeKey: `pay:${p.order_id}:failed`, link: 'sheet:add',
        title: 'Payment didn’t go through', body: `Your payment of ${amt} for ${strat} failed. No money was taken; any debit is reversed by your bank. You can try again.` })
    }
    if (st === 'SIP_ACTIVE') {
      n += await notifyAccounts([p.nuvama_code], { category: 'money', dedupeKey: `pay:${p.order_id}:sip-active`, link: 'page:sip',
        title: 'Your SIP is active', body: `Your ${String(p.frequency || '').toLowerCase() || ''} SIP of ${amt} in ${strat} is set up.`.replace('  ', ' ') })
    }
  }

  // SIP instalments.
  const charges = (await query(
    `SELECT c.id, c.nuvama_code, c.charge_amount, c.charge_status, m.schemename
       FROM sip_charges c LEFT JOIN pms_clients_master m ON m.clientcode = c.nuvama_code
      WHERE c.updated_at >= $1 AND c.updated_at > NOW() - interval '3 days' AND c.nuvama_code IS NOT NULL`, [from])).rows
  for (const c of charges) {
    const amt = inr(Number(c.charge_amount) || 0), strat = strategy(c.schemename), s = String(c.charge_status || '').toUpperCase()
    if (s === 'SUCCESS' || s === 'CAPTURED' || s === 'PAID') {
      n += await notifyAccounts([c.nuvama_code], { category: 'money', dedupeKey: `sip:${c.id}:ok`, link: 'page:sip',
        title: 'SIP instalment received', body: `Your SIP instalment of ${amt} for ${strat} was debited.` })
    } else if (s === 'FAILED') {
      n += await notifyAccounts([c.nuvama_code], { category: 'money', dedupeKey: `sip:${c.id}:failed`, link: 'page:sip',
        title: 'SIP instalment failed', body: `This month’s SIP instalment of ${amt} for ${strat} could not be debited. Please check your bank balance.` })
    }
  }

  // Money Nuvama booked on a strategy account (covers bank transfers and cheques as well as app payments).
  const flows = (await query(
    `SELECT s.account_code, to_char(s.report_date, 'YYYY-MM-DD') AS d, s.cash_in_out, m.schemename
       FROM pms_master_sheet s JOIN pms_clients_master m ON m.clientcode = s.account_code
      WHERE s.created_at >= $1 AND s.report_date > NOW() - interval '10 days'
        AND abs(s.cash_in_out) >= 1000 AND s.account_code !~* '^QLF'`, [from])).rows
  for (const f of flows) {
    const v = Number(f.cash_in_out), strat = strategy(f.schemename)
    n += await notifyAccounts([f.account_code], v > 0
      ? { category: 'money', dedupeKey: `cf:${f.account_code}:${f.d}`, link: 'page:transactions',
          title: 'Your money is invested', body: `${inr(v)} is now invested in your ${strat} account and shows in your portfolio.` }
      : { category: 'money', dedupeKey: `cf:${f.account_code}:${f.d}`, link: 'page:transactions',
          title: 'Withdrawal processed', body: `${inr(v)} was withdrawn from your ${strat} account on ${dayMon(f.d)}.` })
  }
  return n
}

// ── portfolio ─────────────────────────────────────────────────────────────────────────────────────────────────
const MILESTONES = [2.5e6, 5e6, 1e7, 2e7, 5e7, 1e8, 2.5e8]

export async function scanPortfolio(): Promise<number> {
  let n = 0
  await since('portfolio.since')
  const today = istToday()

  // Each person's aggregate (the NAV sheet writes ownerid "70313.0" as account_code "70313"), last ~13 months.
  const owners = (await query(
    `WITH o AS (SELECT DISTINCT regexp_replace(ownerid, '\\.0$', '') AS code FROM pms_clients_master
                 WHERE ownerid IS NOT NULL AND (maturity_date IS NULL OR maturity_date > NOW()))
     SELECT s.account_code AS code, to_char(s.report_date, 'YYYY-MM-DD') AS d, s.nav::float AS nav, s.portfolio_value::float AS v
       FROM pms_master_sheet s JOIN o ON o.code = s.account_code
      WHERE s.report_date > NOW() - interval '400 days' ORDER BY s.account_code, s.report_date`)).rows
  const series = new Map<string, { d: string; nav: number; v: number }[]>()
  for (const r of owners) { if (!series.has(r.code)) series.set(r.code, []); series.get(r.code)!.push(r) }

  const [ty, tm, td] = today.split('-').map(Number)
  const prevMonth = tm === 1 ? `${ty - 1}-12` : `${ty}-${String(tm - 1).padStart(2, '0')}`
  const monthStart = `${ty}-${String(tm).padStart(2, '0')}-01`

  for (const [code, rows] of series) {
    if (rows.length < 2) continue
    const last = rows[rows.length - 1]
    if (!(last.v > 0)) continue
    const fresh = (Date.now() - new Date(last.d).getTime()) < 5 * 86400000

    // Monthly update, 1st–7th, once a row after month-end exists.
    if (td <= 7 && last.d >= monthStart) {
      const end = [...rows].reverse().find(r => r.d < monthStart)
      const start = [...rows].reverse().find(r => r.d < `${prevMonth}-01`)
      if (end && start && start.nav > 0 && end.v > 0) {
        const ret = (end.nav / start.nav - 1) * 100
        const mName = MONTHS[+prevMonth.slice(5) - 1]
        n += await notifyAccounts([code], { category: 'portfolio', dedupeKey: `month:${code}:${prevMonth}`, link: 'tab:portfolio',
          title: `Your ${mName} update`, body: `Your portfolio returned ${pct(ret)} in ${mName} and was worth ${inr(end.v)} at month end.` })
      }
    }
    if (!fresh) continue
    const prev = rows[rows.length - 2]

    // New high: the latest NAV beats every earlier one, and the previous high is at least 30 days old.
    const before = rows.slice(0, -1)
    const peak = before.reduce((a, r) => (r.nav > a.nav ? r : a), before[0])
    if (last.nav > peak.nav && (new Date(last.d).getTime() - new Date(peak.d).getTime()) > 30 * 86400000) {
      n += await notifyAccounts([code], { category: 'portfolio', dedupeKey: `ath:${code}:${last.d.slice(0, 7)}`, link: 'tab:portfolio',
        title: 'Your portfolio reached a new high', body: `On ${dayMon(last.d)} your portfolio’s NAV was the highest it has been in the past year.` })
    }

    // Value milestones, each once in a lifetime.
    for (const m of MILESTONES) {
      if (prev.v < m && last.v >= m) {
        n += await notifyAccounts([code], { category: 'portfolio', dedupeKey: `mile:${code}:${m}`, link: 'tab:portfolio',
          title: `Your portfolio crossed ${inr(m)}`, body: `Your portfolio was worth ${inr(last.v)} on ${dayMon(last.d)}. Thank you for growing with Qode.` })
      }
    }
  }

  // Anniversaries of each strategy account.
  const anniv = (await query(
    `SELECT m.clientcode, m.schemename, to_char(m.inceptiondate, 'YYYY-MM-DD') AS d,
            (SELECT s.cumulative_return_percent::float FROM pms_master_sheet s WHERE s.account_code = m.clientcode ORDER BY s.report_date DESC LIMIT 1) AS ret
       FROM pms_clients_master m
      WHERE m.inceptiondate IS NOT NULL AND (m.maturity_date IS NULL OR m.maturity_date > NOW()) AND m.clientcode !~* '^QLF'
        AND to_char(m.inceptiondate, 'MM-DD') = $1 AND to_char(m.inceptiondate, 'YYYY') < $2`, [today.slice(5), today.slice(0, 4)])).rows
  for (const a of anniv) {
    const years = ty - Number(a.d.slice(0, 4)), strat = strategy(a.schemename)
    const tail = a.ret != null && a.ret > 0 ? ` Since you invested, it has returned ${pct(a.ret)}.` : ''
    n += await notifyAccounts([a.clientcode], { category: 'portfolio', dedupeKey: `anniv:${a.clientcode}:${ty}`, link: 'tab:portfolio',
      title: `${years} ${years === 1 ? 'year' : 'years'} with ${strat}`, body: `Your ${strat} account turns ${years} today.${tail}` })
  }
  return n
}

// ── reading ───────────────────────────────────────────────────────────────────────────────────────────────────
const SOURCES = [
  { kind: 'newsletter', prefix: 'docs/newsletters', link: 'page:newsletters', title: 'New newsletter' },
  { kind: 'perspective', prefix: 'docs/prespectives', link: 'page:perspectives', title: 'New perspective' },
]

export async function scanReading(): Promise<number> {
  let n = 0
  for (const src of SOURCES) {
    const objs: { Key?: string; LastModified?: Date }[] = []
    let token: string | undefined
    do {
      const r: any = await s3.send(new ListObjectsV2Command({ Bucket: 'qode-static-assets', Prefix: src.prefix, ContinuationToken: token }))
      objs.push(...(r.Contents || []).filter((o: any) => o.Key && !o.Key.endsWith('/')))
      token = r.IsTruncated ? r.NextContinuationToken : undefined
    } while (token)
    if (!objs.length) continue
    const newest = objs.reduce((a, o) => ((o.LastModified?.getTime() || 0) > (a.LastModified?.getTime() || 0) ? o : a))
    const key = `reading.${src.kind}`
    const seen = await getState(key)
    const newestAt = newest.LastModified?.toISOString() || ''
    if (!seen) { await setState(key, newestAt); continue }   // first run: remember, send nothing
    if (newestAt <= seen) continue
    await setState(key, newestAt)
    // Only the newest one, even if several were uploaded together.
    const parts = String(newest.Key).split('/')
    const label = (parts.length > 2 ? parts[parts.length - 2] : parts[parts.length - 1].replace(/\.[^.]+$/, '')).replace(/[-_]+/g, ' ').trim()
    n += await notifyEmails(await appAudience(), { category: 'reading', dedupeKey: `read:${newest.Key}`, link: src.link,
      title: src.title, body: `${label ? label + ': ' : ''}our latest ${src.kind} is ready to read in the app.` })
  }
  return n
}
