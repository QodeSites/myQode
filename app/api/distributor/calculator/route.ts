import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { query } from '@/lib/db';
import { query as query1 } from '@/lib/db1';
import {
  getShareForDistributor,
  type DistributorShare,
} from '@/lib/zohoDistributorFees';
import {
  getInvestorFeeTerms,
  lookupInvestorTerms,
  type InvestorFeeTerms,
} from '@/lib/zohoInvestorFees';
import { calculateFees } from '@/lib/feeEngine';

interface UserContext {
  clientid: string;
  clientcode: string;
  email: string;
  groupid: string;
  head_of_family: boolean;
}

interface CalculatorRequest {
  startDate: string; // required: 'YYYY-MM-DD'
  endDate: string;   // required: 'YYYY-MM-DD'
  /** Period label, e.g. "Q3 FY2026" or "FY 2026" — pro-rates the annual rack
   *  rate. Optional; a missing value is treated as a quarter. */
  period?: string;
  /** Admin-only: include Qode's own share. Honoured only alongside a valid
   *  admin session, never on a distributor's own request. */
  includeQodeShare?: boolean;
}

const MONTH_NAMES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

// Date → "1-Apr-24"
function formatDateLabel(d: Date): string {
  return `${d.getDate()}-${MONTH_NAMES[d.getMonth()]}-${String(d.getFullYear()).slice(-2)}`;
}

/**
 * A DATE column's calendar day, as ISO `yyyy-mm-dd`, read in IST.
 *
 * Postgres DATE values arrive as JS Dates at local midnight, which serialise to
 * the previous day in UTC ("2026-04-09" becomes "2026-04-08T18:30:00Z"). Taking
 * the UTC parts would report every date one day early, so the +05:30 offset is
 * added back before the parts are read.
 *
 * Accepts a string too, since the same column read through a different driver
 * or a cached payload can arrive already formatted.
 */
function toIstIsoDate(value: Date | string): string | null {
  if (typeof value === 'string') return value.split('T')[0] || null;
  if (!(value instanceof Date) || Number.isNaN(value.getTime())) return null;
  const ist = new Date(value.getTime() + 5.5 * 60 * 60 * 1000);
  return ist.toISOString().slice(0, 10);
}

// Fiscal year runs Apr–Mar; FY2025 starts 1-Apr-24. Only completed quarters are
// listed — the in-progress quarter has no final data to bill against.
const FIRST_FY_START_YEAR = 2024;

function buildPeriodMapping(now: Date = new Date()) {
  const currentFyStartYear = now.getMonth() >= 3 ? now.getFullYear() : now.getFullYear() - 1;
  const quarters: { type: string; label: string; startDate: string; endDate: string }[] = [];
  const years: { type: string; label: string; startDate: string; endDate: string }[] = [];

  for (let y = FIRST_FY_START_YEAR; y <= currentFyStartYear; y++) {
    const fy = y + 1;
    const quarterDefs = [
      { label: `Q1 FY${fy}`, start: new Date(y, 3, 1), end: new Date(y, 5, 30) },
      { label: `Q2 FY${fy}`, start: new Date(y, 6, 1), end: new Date(y, 8, 30) },
      { label: `Q3 FY${fy}`, start: new Date(y, 9, 1), end: new Date(y, 11, 31) },
      { label: `Q4 FY${fy}`, start: new Date(y + 1, 0, 1), end: new Date(y + 1, 2, 31) },
    ];
    for (const q of quarterDefs) {
      if (q.end < now) {
        quarters.push({
          type: "Quarter",
          label: q.label,
          startDate: formatDateLabel(q.start),
          endDate: formatDateLabel(q.end),
        });
      }
    }
    years.push({
      type: "Year",
      label: `FY ${fy}`,
      startDate: formatDateLabel(new Date(y, 3, 1)),
      endDate: formatDateLabel(new Date(y + 1, 2, 31)),
    });
  }

  return [...quarters, ...years];
}

// Converts `1-Apr-24` → Date
function parseCustomDateLabel(dateStr: string): Date {
  const [d, m, y] = dateStr.split("-");
  const fullYear = Number(y) + (Number(y) < 50 ? 2000 : 1900);
  return new Date(`${d} ${m} ${fullYear}`);
}

export async function GET() {
  const cookieStore = await cookies();
  const userContextCookie = cookieStore.get("qode-user-context");

  if (!userContextCookie?.value) {
    return NextResponse.json({ error: "No user context" }, { status: 401 });
  }

  let userContext: UserContext;
  try {
    userContext = JSON.parse(userContextCookie.value);
  } catch {
    return NextResponse.json({ error: "Invalid user context" }, { status: 400 });
  }

  const email = userContext.email;

  // Get distributor
  const distributorResult = await query(
    `SELECT * FROM pms_clients_master WHERE email = $1`,
    [email]
  );

  if (!distributorResult.rows.length) {
    return NextResponse.json({ error: "Distributor not found" }, { status: 404 });
  }

  const intermediaryName = distributorResult.rows[0].clientname;

  // Get all clients
  const clientsResult = await query(
    `SELECT inceptiondate FROM pms_clients_master WHERE intermediaryname = $1`,
    [intermediaryName]
  );

  const inceptionDates = clientsResult.rows
    .map((r: any) => r.inceptiondate)
    .filter(Boolean)
    .map((d: any) => new Date(d));

  // ✅ EARLIEST inception date
  const firstInceptionDate =
    inceptionDates.length > 0
      ? new Date(Math.min(...inceptionDates.map(d => d.getTime())))
      : null;

  // ✅ FILTER PERIODS
  const allPeriods = buildPeriodMapping();
  let filteredPeriods = allPeriods;

  if (firstInceptionDate) {
    filteredPeriods = allPeriods.filter(period => {
      const end = parseCustomDateLabel(period.endDate);
      return end >= firstInceptionDate;
    });
  }

  // ✅ SUGGESTED PERIOD
  let suggestedPeriod = null;

  if (firstInceptionDate && filteredPeriods.length) {
    suggestedPeriod =
      filteredPeriods.find(period => {
        const start = parseCustomDateLabel(period.startDate);
        const end = parseCustomDateLabel(period.endDate);
        return (
          firstInceptionDate >= start &&
          firstInceptionDate <= end
        );
      }) || filteredPeriods[0];
  }

  // Since inception — every fee ever billed, in one option.
  //
  // Built here rather than added to `buildPeriodMapping()` because its start
  // date is per-distributor: the earliest inception across their own book, not
  // a fixed calendar boundary. Placed first in the list, since "what have I
  // earned in total" is the question a quarter-by-quarter list cannot answer
  // without adding twelve figures by hand.
  //
  // The end date is today rather than a period end: fees billed after the last
  // completed quarter would otherwise be excluded from a total that claims to
  // cover everything.
  // Dates use `formatDateLabel` ("1-Apr-24") to match every other period —
  // `parseCustomDateLabel` and the SQL both expect that shape, and an ISO date
  // here would parse as Invalid Date and silently return no rows.
  const sinceInception = firstInceptionDate
    ? {
        type: 'Since Inception',
        label: 'Since inception',
        startDate: formatDateLabel(firstInceptionDate),
        endDate: formatDateLabel(new Date()),
      }
    : null;

  return NextResponse.json(
    {
      firstInceptionDate: firstInceptionDate
        ? firstInceptionDate.toISOString().slice(0, 10)
        : null,
      periods: sinceInception ? [sinceInception, ...filteredPeriods] : filteredPeriods,
      suggestedPeriod,
    },
    { status: 200 }
  );
}


// Returns array of calc rows
export async function POST(req: Request) {
  try {
    const cookieStore = await cookies();
    const userContextCookie = cookieStore.get('qode-user-context');

    let userContext: UserContext | null = null;
    let email: string | null = null;

    if (userContextCookie?.value) {
      try {
        userContext = JSON.parse(userContextCookie.value);
        email = userContext?.email || null;
      } catch (error) {
        console.error('Error parsing user context cookie:', error);
        return NextResponse.json({ error: 'Invalid user context' }, { status: 400 });
      }
    } else {
      return NextResponse.json({ error: 'No user context' }, { status: 401 });
    }

    let body: CalculatorRequest;
    try {
      body = await req.json();
      if (!body.startDate || !body.endDate) {
        return NextResponse.json({ error: 'Missing date range' }, { status: 400 });
      }
    } catch (e) {
      return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
    }

    // Distributor info
    const distributorResult = await query(
      `SELECT * FROM pms_clients_master WHERE email = $1`,
      [email]
    );
    if (!distributorResult.rows.length) {
      return NextResponse.json({ error: 'Distributor not found' }, { status: 404 });
    }
    const distributor = distributorResult.rows[0];
    const intermediaryName = distributor.clientname;

    // Legacy rate from pms_clients_master. Retained only as a fallback: the
    // column is populated for 15 of 507 clients, so on its own it silently
    // produced a 0% share — and therefore ₹0 — for ~97% of the book.
    const legacyFeePercentage: number =
      parseFloat(distributor.intermediary_fee_percentage) || 0;

    // The authoritative rate is Distributor_Share_Category on the Zoho
    // Distributor module — the fraction of billed fees this distributor keeps.
    // One rate per distributor, applied to every client under them.
    //
    // Zoho being unreachable must not blank out the whole page, so a failure
    // degrades to the legacy column and is surfaced per row via rateSource.
    let zohoShare: DistributorShare | null = null;
    let zohoAvailable = true;
    try {
      zohoShare = await getShareForDistributor(email);
    } catch (err) {
      zohoAvailable = false;
      console.error('[distributor/calculator] Zoho share lookup failed:', err);
    }

    // Resolution order: Zoho category → legacy column → nothing configured.
    const sharePct: number =
      zohoShare?.sharePct != null ? zohoShare.sharePct : legacyFeePercentage;

    const rateSource: 'zoho' | 'legacy' | 'unmapped' =
      zohoShare?.sharePct != null
        ? 'zoho'
        : legacyFeePercentage > 0
          ? 'legacy'
          : 'unmapped';

    if (rateSource === 'unmapped') {
      console.warn(
        `[distributor/calculator] no share rate for ${email} ` +
        `(zoho ${zohoAvailable ? 'reachable, no category set' : 'unreachable'}) — share will be 0`,
      );
    }

    // Per-investor rack rates. Without these the engine cannot tell a rack
    // rate from a discounted one, so it falls back to treating the billed fee
    // as the rack fee — correct for the ~90% of accounts with no discount.
    let investorTerms = new Map<string, InvestorFeeTerms>();
    try {
      investorTerms = await getInvestorFeeTerms();
    } catch (err) {
      console.error('[distributor/calculator] Zoho investor terms lookup failed:', err);
    }

    // Qode's own share is admin-only (Part 4). Opt-in via an explicit flag on
    // an admin session — never inferred from the distributor's own request.
    const isAdminView =
      body.includeQodeShare === true && cookieStore.get('admin-session')?.value != null;

    // Related clients
    const clientsResult = await query(
      `SELECT * FROM pms_clients_master WHERE intermediaryname = $1`,
      [intermediaryName]
    );
    const clientRows = clientsResult.rows;
    console.log(intermediaryName, clientRows, "============================clientRows");

    if (!clientRows.length) {
      return NextResponse.json([], { status: 200 });
    }

    // Client codes
    // Also get billgroup for each client
    const wsClientCodes = clientRows.map((row: any) => row.clientcode);
    const billGroupMap = new Map<string, any>();
    clientRows.forEach((row: any) => {
      billGroupMap.set(row.clientcode, row.billgroup);
    });

    const aumResult = await query1(
      `SELECT accountcode, AVG(aum) as average_aum
             FROM pms_clients_tracker.pms_aum
             WHERE accountcode = ANY($1)
             AND valuedate BETWEEN $2 AND $3
             GROUP BY accountcode`,
      [wsClientCodes, body.startDate, body.endDate]
    );
    console.log(aumResult.rows, "===========================aumResult");

    // Inception dates
    const inceptionResult = await query1(
      `SELECT accountcode, MIN(valuedate) as inception_date
             FROM pms_clients_tracker.pms_aum
             WHERE accountcode = ANY($1)
             GROUP BY accountcode`,
      [wsClientCodes]
    );
    console.log(inceptionResult.rows, "===========================inceptionResult");

    // Fetch fees, split by Performance and Management
    const feesQuery = `
            SELECT
                ws_account_code as accountcode,
                client_name as clientname,
                SUM(CASE WHEN tran_desc = 'Performance Fees' THEN net_amount ELSE 0 END) as performance_fees,
                SUM(CASE WHEN tran_desc = 'Management Fees' THEN net_amount ELSE 0 END) as fixed_fees,
                SUM(net_amount) as total_fees_collected
            FROM pms_clients_tracker.pms_transactions
            WHERE ws_account_code = ANY($1)
              AND tran_desc IN ('Performance Fees','Management Fees')
              AND trandate BETWEEN $2 AND $3
            GROUP BY ws_account_code, client_name
        `;

    const feesResult = await query1(
      feesQuery,
      [wsClientCodes, body.startDate, body.endDate]
    );
    console.log(feesResult.rows, "===========================feesResult");

    const feesMap = new Map<string, any>();
    feesResult.rows.forEach((row: any) => feesMap.set(row.accountcode, row));

    const aumMap = new Map<string, any>();
    aumResult.rows.forEach((row: any) => aumMap.set(row.accountcode, row.average_aum));
    const inceptionMap = new Map<string, any>();
    inceptionResult.rows.forEach((row: any) => inceptionMap.set(row.accountcode, row.inception_date));

    const GST_RATE = 18;

    /** Indian-format currency, used for every money field in the response. */
    const fmt = (n: number) =>
      n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

    // Fraction of a year the period covers, so an annual rack rate can be
    // pro-rated. Quarters are 0.25; a full financial year is 1.
    //
    // "Since inception" spans multiple years, so it is measured from the dates
    // themselves rather than assumed — the 0.25 fallback would have understated
    // a two-year span eightfold. Falls back to a quarter only when the dates
    // cannot be parsed.
    const periodDays = (() => {
      const s = new Date(body.startDate);
      const e = new Date(body.endDate);
      if (Number.isNaN(s.getTime()) || Number.isNaN(e.getTime())) return null;
      return Math.max(1, (e.getTime() - s.getTime()) / 86_400_000 + 1);
    })();

    const periodFraction = /^Q[1-4]/i.test(String(body.period ?? '')) ? 0.25
      : String(body.period ?? '').toUpperCase().startsWith('FY') ? 1
      : periodDays != null ? periodDays / 365
      : 0.25;

    // Instead of mapping over feesResult, map over aumResult
    const response = aumResult.rows.map((aumRow: any, idx: number) => {
      const accountcode = aumRow.accountcode;
      // For the given accountcode, get all other details
      const clientRow = clientRows.find((c: any) => c.clientcode === accountcode) || {};
      const clientname = clientRow.clientname || '';
      const billgroup = billGroupMap.get(accountcode) || null;
      const inceptionDateRaw = inceptionMap.get(accountcode);

      // For the given accountcode, get the fee breakdown (may be missing)
      const feesRow = feesMap.get(accountcode) || {};

      const perfFeesRaw = parseFloat(feesRow.performance_fees) || 0;
      const fixedFeesRaw = parseFloat(feesRow.fixed_fees) || 0;
      const totalFeesRaw = parseFloat(feesRow.total_fees_collected) || 0;

      // GST calculations
      const gstOnPerf = (perfFeesRaw * GST_RATE) / 118;
      const gstOnFixed = (fixedFeesRaw * GST_RATE) / 118;
      const gstOnTotal = (totalFeesRaw * GST_RATE) / 118;

      const perfFeesBeforeGst = perfFeesRaw - gstOnPerf;
      const fixedFeesBeforeGst = fixedFeesRaw - gstOnFixed;
      const totalFeesBeforeGst = totalFeesRaw - gstOnTotal;

      // ── Fee engine (rack-rate-first) ───────────────────────────────────
      // Implements Part 4 of the fee revamp plan. The split is applied to the
      // RACK RATE from the signed agreement, never to a discounted fee — any
      // discount a distributor gives comes out of their share alone.
      //
      // The figures from pms_master_sheet are GST-INCLUSIVE (hence the ×18/118
      // extraction above), while the engine works in GST-exclusive terms and
      // adds GST itself. Feeding the inclusive figure in would compound GST.
      // Email first, then name. The two systems hold different addresses for a
      // couple of investors, and an email-only lookup silently returned no
      // terms for them — which reads as "no fee agreement", not as an error.
      const terms = lookupInvestorTerms(investorTerms, clientRow.email, clientname);

      const fee = calculateFees({
        averageAum: parseFloat(aumRow.average_aum) || 0,
        rackFixedFeePct: terms?.rackFixedFeePct ?? null,
        rackPerfFeePct: terms?.rackPerfFeePct ?? null,
        // `Discounted_Fixed_Fee` duplicates `Actual_Fee_Charged` where both are
        // set (verified: 2 of 2 agree), so it serves only as a fallback for the
        // handful of records that carry one but not the other.
        actualFeeChargedPct: terms?.actualFeeChargedPct ?? terms?.discountedFixedFeePct ?? null,
        discountedPerfFeePct: terms?.discountedPerfFeePct ?? null,
        discountApplied: terms?.discountApplied ?? false,
        billedFixedFee: fixedFeesBeforeGst,
        billedPerfFee: perfFeesBeforeGst,
        distributorSharePct: sharePct,
        periodFraction: periodFraction,
      });

      // ── Cross-check against Zoho's own net rate ────────────────────────
      // `Distributor_Net_Fee_Pct` holds a pre-computed net rate on AUM. Where
      // it disagrees with what the split and discount actually produce, one of
      // the two is stale — and it is worth surfacing rather than silently
      // preferring either.
      //
      // Measured against all 87 populated records: 10 disagree, all because
      // the CRM value predates a custom split (Funds India rows still read
      // 1.25 on a 60% agreement that gives 1.50). Trusting the CRM figure
      // would underpay those distributors ~₹49,900 a year, so the computed
      // value wins and the divergence becomes a warning.
      // The CRM's net-fee rates expressed as a share OF THE FEE rather than of
      // AUM — see the note where they are used below.
      //
      // The two legs are converted independently because their rates live in
      // different fields and are quoted against different bases: the
      // management rate against `Actual_Fee_Charged` (a % of assets), the
      // performance rate against `Rack_Rate_Performance_Fee` (a % of gains).
      //
      // Both fall back to the distributor's own split where the CRM has no net
      // rate — which is the norm on the performance leg, where only 1 of the
      // pure-performance investors has `Distributor_Net_Perf_Fee_Pct` set.
      const chargedPctForCommission =
        terms?.actualFeeChargedPct ?? terms?.rackFixedFeePct ?? 0;
      const commissionShareOfFee =
        terms?.zohoNetFeePct != null && chargedPctForCommission > 0
          ? (terms.zohoNetFeePct / chargedPctForCommission) * 100
          : sharePct;

      const perfPctForCommission = terms?.rackPerfFeePct ?? 0;
      const commissionShareOfPerfFee =
        terms?.zohoNetPerfFeePct != null && perfPctForCommission > 0
          ? (terms.zohoNetPerfFeePct / perfPctForCommission) * 100
          : sharePct;

      // ── The three columns, across BOTH fee types ───────────────────────
      // Performance fees are the larger line across the book (₹2.51 Cr vs
      // ₹2.29 Cr), and a pure-performance account has no management fee at
      // all — computing the share from the management leg alone reported ₹0
      // against ₹1,15,620 of performance fees actually earned.
      const shareOfMgmt = fixedFeesBeforeGst * (sharePct / 100);
      const shareOfPerf = perfFeesBeforeGst * (sharePct / 100);
      const commissionOnMgmt = fixedFeesBeforeGst * (commissionShareOfFee / 100);
      const commissionOnPerf = perfFeesBeforeGst * (commissionShareOfPerfFee / 100);

      const yourShareTotal = shareOfMgmt + shareOfPerf;
      const rawCommission = commissionOnMgmt + commissionOnPerf;

      // A commission above the share would make the discount negative, which
      // says the distributor was given MORE than their agreed percentage —
      // not a thing that happens, and not a thing a distributor can act on.
      //
      // It arises where the CRM's net-fee rate implies a higher percentage
      // than the share category: the ten records still holding rates computed
      // at 50% for distributors since moved to 55/60/65%. Rather than print a
      // negative, the two figures converge — commission is capped at the
      // share, so the discount reads zero and the row stays internally
      // consistent. The underlying staleness is logged below.
      const yourCommissionTotal = Math.min(rawCommission, yourShareTotal);

      if (rawCommission > yourShareTotal + 0.01) {
        console.warn(
          `[distributor/calculator] commission exceeds share for ${accountcode} ` +
          `(${clientname}): ${rawCommission.toFixed(2)} > ${yourShareTotal.toFixed(2)} — ` +
          `the CRM net-fee rate disagrees with the ${sharePct}% share category. ` +
          `Capping the commission at the share.`,
        );
      }

      const expectedNetRate =
        terms?.rackFixedFeePct != null
          ? Math.max(
              0,
              (terms.rackFixedFeePct * sharePct) / 100 -
                Math.max(0, terms.rackFixedFeePct - (terms.actualFeeChargedPct ?? terms.rackFixedFeePct)),
            )
          : null;
      const netRateMismatch =
        terms?.zohoNetFeePct != null &&
        expectedNetRate != null &&
        Math.abs(terms.zohoNetFeePct - expectedNetRate) > 0.011;

      if (netRateMismatch) {
        console.warn(
          `[distributor/calculator] Distributor_Net_Fee_Pct is stale for ${accountcode} ` +
          `(${clientname}): CRM ${terms!.zohoNetFeePct}% vs ${expectedNetRate!.toFixed(2)}% ` +
          `from rack ${terms!.rackFixedFeePct}% at a ${sharePct}% split — using the computed rate.`,
        );
      }

      // The same check on the performance leg. Stale on 6 of 86 populated
      // records, all for distributors whose split was raised above 50% after
      // the field was last written.
      const expectedNetPerfRate =
        terms?.rackPerfFeePct != null ? (terms.rackPerfFeePct * sharePct) / 100 : null;
      if (
        terms?.zohoNetPerfFeePct != null &&
        expectedNetPerfRate != null &&
        Math.abs(terms.zohoNetPerfFeePct - expectedNetPerfRate) > 0.011
      ) {
        console.warn(
          `[distributor/calculator] Distributor_Net_Perf_Fee_Pct is stale for ${accountcode} ` +
          `(${clientname}): CRM ${terms.zohoNetPerfFeePct}% vs ${expectedNetPerfRate.toFixed(2)}% ` +
          `from rack ${terms.rackPerfFeePct}% at a ${sharePct}% split — using the computed rate.`,
        );
      }

      // Retained under their existing names so the current UI keeps working
      // while the revised columns roll out.
      //
      // GST-INCLUSIVE, deliberately. `distributorShare` is what the page labels
      // "Your Share", and a distributor reads that as the money they will
      // receive — which includes their GST. The engine works GST-exclusive, so
      // `netInvoiceAmount` (payout + its GST) is the inclusive figure, not
      // `netDistributorPayout`. Sending the exclusive one understated every
      // share by 18% and left the page extracting GST from a figure that had
      // none. Callers wanting the exclusive number have `netDistributorPayout`.
      const withGst = (n: number) => n * (1 + GST_RATE / 100);
      const distributorShareFixed = withGst(fee.rackFixedFee * (sharePct / 100));
      const distributorSharePerf = withGst(fee.rackPerfFee * (sharePct / 100));
      const distributorShare = fee.netInvoiceAmount;

      return {
        id: idx + 1,
        clientName: clientname,
        strategy: accountcode,
        billGroup: billgroup,
        // ISO yyyy-mm-dd; the page formats it for display.
        //
        // `pms_aum.valuedate` is a DATE column, which node-postgres returns as
        // a JS Date — not the string this previously assumed. `d.split(...)`
        // threw on every row, and since that ran inside the response map it
        // failed the whole request rather than just blanking one field.
        //
        // Read in IST, not UTC. Postgres hands back midnight local as
        // "2026-04-08T18:30:00Z", so taking the UTC date parts would report
        // every inception one day early.
        inceptionDate: inceptionDateRaw ? toIstIsoDate(inceptionDateRaw) : null,
        averageAum: aumRow.average_aum
          ? Number(aumRow.average_aum).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
          : "0.00",

        // Performance Fees
        performanceFees: perfFeesBeforeGst.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
        performanceFeesGst: gstOnPerf.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }),

        // Fixed Fees
        fixedFees: fixedFeesBeforeGst.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
        fixedFeesGst: gstOnFixed.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }),

        // Totals
        totalFees: totalFeesBeforeGst.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
        totalFeesGst: gstOnTotal.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
        totalFeesCollected: totalFeesRaw.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }),

        // The revenue-share slab from Zoho's Distributor_Share_Category.
        distributorPercentage: sharePct.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
        distributorShare: distributorShare.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }),

        // Split by fee type so the UI can show how the share was made up.
        distributorShareFixed: distributorShareFixed.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
        distributorSharePerf: distributorSharePerf.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
        /** The raw Zoho picklist value, e.g. "65%". */
        distributorShareCategory: zohoShare?.shareCategory ?? null,
        /** 'zoho' | 'legacy' | 'unmapped' — where this row's rate came from. */
        rateSource,

        // ── Revised columns (Part 4 of the fee revamp plan) ───────────────
        /** Fee per the signed agreement, before any discount. */
        rackRateFixedFee: fmt(fee.rackFixedFee),
        rackRatePerfFee: fmt(fee.rackPerfFee),
        totalRackRateFee: fmt(fee.totalRackFee),
        /** What the investor was actually charged. */
        actualFeeBilled: fmt(fee.totalActualFee),
        /** Rack minus actual — absorbed entirely by the distributor. */
        discountAmount: fmt(fee.discountAmount),
        hasDiscount: fee.hasDiscount,
        /** Distributor's share of the rack rate, before absorbing a discount. */
        distributorGrossShare: fmt(fee.distributorGrossShare),
        /** The figure to invoice for, excluding the distributor's own GST. */
        netDistributorPayout: fmt(fee.netDistributorPayout),
        gstOnDistributorPayout: fmt(fee.gstOnDistributorPayout),
        /** Final amount for the distributor's invoice, including their GST. */
        netInvoiceAmount: fmt(fee.netInvoiceAmount),
        /** Rack rate terms, so a distributor can see the basis of the split. */
        rackFixedFeePct: terms?.rackFixedFeePct ?? null,
        rackPerfFeePct: terms?.rackPerfFeePct ?? null,
        actualFeeChargedPct: terms?.actualFeeChargedPct ?? null,
        /**
         * The distributor's own rate on client AUM, after their discount —
         * "you earn 0.35% a year on this account". Rates are what a
         * distributor's agreement is written in, so this is the figure that
         * makes a rupee column interpretable.
         */
        distributorNetFeePct: expectedNetRate,
        /** True when the CRM's stored net rate disagrees with the above. */
        netRateMismatch,

        // ── The three columns the page shows ──────────────────────────────
        //   Your Share      = Distributor_Share_Category × (mgmt + perf fees)
        //   Your Commission = the distributor's net entitlement on both legs
        //   Discount        = Your Share − Your Commission
        //
        // Both fee types are included. A pure-performance account has no
        // management fee, so a management-only calculation reported ₹0 against
        // ₹1,15,620 of performance fees actually earned.
        //
        // The net-fee rates are rates on client ASSETS — 0.75 means 0.75% a
        // year on AUM, not 0.75% of the fee — so they cannot be applied to a
        // fee directly. Dividing by the rate they are quoted against converts
        // them into the share of the fee they represent:
        //
        //   0.75% of AUM ÷ 1.5% of AUM = 50% of the fee
        //
        // Applied raw it produced ₹167.60 on a ₹22,346 fee, making every
        // account — including the 87 with no discount on record — appear to
        // carry a ~99% discount.
        yourShareOfFee: fmt(yourShareTotal),
        yourCommission: fmt(yourCommissionTotal),
        shareDiscount: fmt(yourShareTotal - yourCommissionTotal),
        /** The CRM rate behind each, for the bracketed sub-line on the page. */
        shareCategoryPct: sharePct,
        /** The commission as a % of the fee, after the unit conversion. */
        netFeePct:
          terms?.zohoNetFeePct != null
            ? Math.round(commissionShareOfFee * 100) / 100
            : null,
        /**
         * The raw CRM net-fee rate shown in brackets under the commission.
         *
         * Whichever leg this account actually earns on: a pure-performance
         * account has no management fee, so quoting `Distributor_Net_Fee_Pct`
         * there would put a management rate beside a performance amount.
         */
        netFeePctOfAum:
          perfFeesBeforeGst > 0 && fixedFeesBeforeGst === 0
            ? terms?.zohoNetPerfFeePct ?? null
            : terms?.zohoNetFeePct ?? null,
        /** Which leg the bracketed rate refers to, so the page can label it. */
        netFeePctBasis:
          perfFeesBeforeGst > 0 && fixedFeesBeforeGst === 0 ? 'performance' : 'management',

        /**
         * This account is on a no-fee arrangement.
         *
         * Three independent signals, any one of which is decisive:
         *   - Nuvama's `QODEZEROBILLGROUP` bill group (43 accounts)
         *   - Zoho's "Zero Fee Structure" label (3 investors)
         *   - both rack rates recorded as zero in the CRM
         *
         * Distinct from "no fee was billed this period", which is normal for a
         * performance-only account outside its annual billing month. Zero
         * columns on such a row look like a defect; naming the arrangement
         * says the row is complete and correct.
         */
        isZeroFee:
          /zerobillgroup/i.test(String(billgroup ?? '')) ||
          /zero fee/i.test(String(terms?.feesStructureLabel ?? '')) ||
          (terms != null &&
            (terms.rackFixedFeePct ?? 0) === 0 &&
            (terms.rackPerfFeePct ?? 0) === 0),
        feeOption: fee.feeOption,
        feesStructureLabel: terms?.feesStructureLabel ?? null,
        /**
         * A short label for the structure this account is on, derived from the
         * rack rates rather than the CRM's free-text `Fees_Structure` — that
         * field is unset on 8 of 95 investors and says "Discounted Fee
         * Structure" on 7 more, which names the discount rather than the
         * structure underneath it.
         */
        // `zero` is reported ONLY when the CRM actually says the rates are
        // zero. Where no CRM record was found at all, the rates default to 0
        // and would classify as "No fee" — which is a statement about the
        // agreement, not about our data, and reads as fact on a fee statement.
        // Baiju Shyam Shah showed "No fee" against a real 2.5% agreement for
        // exactly this reason.
        feeStructureLabel: !terms
          ? null
          : fee.feeOption === 'hybrid'
            ? `${terms.rackFixedFeePct ?? 0}% fixed + ${terms.rackPerfFeePct ?? 0}% performance`
            : fee.feeOption === 'pure_fixed'
              ? `${terms.rackFixedFeePct ?? 0}% fixed`
              : fee.feeOption === 'pure_performance'
                ? `${terms.rackPerfFeePct ?? 0}% performance`
                : fee.feeOption === 'zero'
                  ? 'No fee'
                  : null,
        /** False when no CRM record matched — the rates below are defaults. */
        hasCrmTerms: Boolean(terms),
        /** Hurdle the performance fee applies above, where one is set. */
        hurdlePct: terms?.hurdlePct ?? null,
        /** Anything needing a human before invoicing. Empty means safe. */
        feeWarnings: fee.warnings,

        // Qode's own share. Part 4 marks this admin-only, so it is omitted
        // entirely rather than sent and hidden — a field absent from the
        // payload cannot leak through devtools or a UI mistake.
        ...(isAdminView
          ? {
              qodeShare: fmt(fee.qodeShare),
              qodeSharePct: fee.qodeSharePct,
            }
          : {}),

        accountcode
      };
    });


    return NextResponse.json(response, { status: 200 });
  } catch (error) {
    console.error('Error in distributor calculator API:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}