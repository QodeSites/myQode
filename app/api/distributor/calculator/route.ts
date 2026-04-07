import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { query } from '@/lib/db';
import { query as query1 } from '@/lib/db1';

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
}

const PERIOD_DATE_MAPPING = [
  {
    type: "Quarter",
    label: "Q1 FY2025",
    startDate: "1-Apr-24",
    endDate: "30-Jun-24",
  },
  {
    type: "Quarter",
    label: "Q2 FY2025",
    startDate: "1-Jul-24",
    endDate: "30-Sep-24",
  },
  {
    type: "Quarter",
    label: "Q3 FY2025",
    startDate: "1-Oct-24",
    endDate: "31-Dec-24",
  },
  {
    type: "Quarter",
    label: "Q4 FY2025",
    startDate: "1-Jan-25",
    endDate: "31-Mar-25",
  },
  {
    type: "Quarter",
    label: "Q1 FY2026",
    startDate: "1-Apr-25",
    endDate: "30-Jun-25",
  },
  {
    type: "Quarter",
    label: "Q2 FY2026",
    startDate: "1-Jul-25",
    endDate: "30-Sep-25",
  },
  {
    type: "Quarter",
    label: "Q3 FY2026",
    startDate: "1-Oct-25",
    endDate: "31-Dec-25",
  },
  {
    type: "Quarter",
    label: "Q4 FY2026",
    startDate: "1-Jan-26",
    endDate: "31-Mar-26",
  },
  {
    type: "Year",
    label: "FY 2025",
    startDate: "1-Apr-24",
    endDate: "31-Mar-25",
  },
  {
    type: "Year",
    label: "FY 2026",
    startDate: "1-Apr-25",
    endDate: "31-Mar-26",
  }
];

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
  let filteredPeriods = PERIOD_DATE_MAPPING;

  if (firstInceptionDate) {
    filteredPeriods = PERIOD_DATE_MAPPING.filter(period => {
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

  return NextResponse.json(
    {
      firstInceptionDate: firstInceptionDate
        ? firstInceptionDate.toISOString().slice(0, 10)
        : null,
      periods: filteredPeriods,
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
    const fees_percentage: number = parseFloat(distributor.intermediary_fee_percentage) || 0;

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

      // Distributor share on GST-deducted total
      const distributorShare = totalFeesRaw * (fees_percentage / 100);

      return {
        id: idx + 1,
        clientName: clientname,
        strategy: accountcode,
        billGroup: billgroup,
        inceptionDate: inceptionDateRaw
          ? (() => {
            const d = inceptionDateRaw;
            // expects d in "yyyy-mm-dd" or "yyyy-mm-ddTHH:MM:SS" format
            const [yyyy, mm, dd] = d.split('T')[0].split('-');
            return `${dd}-${mm}-${yyyy}`;
          })()
          : null,
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

        distributorPercentage: fees_percentage.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
        distributorShare: distributorShare.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }),

        accountcode
      };
    });


    return NextResponse.json(response, { status: 200 });
  } catch (error) {
    console.error('Error in distributor calculator API:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}