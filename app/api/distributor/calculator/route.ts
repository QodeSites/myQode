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

// Master list of period mappings based on the provided image
const PERIOD_DATE_MAPPING = [
    {
        type: "Quarter",
        label: "Q1 FY2025",
        startDate: "1-Apr-24",
        endDate: "30-Jun-24"
    },
    {
        type: "Quarter",
        label: "Q2 FY2025",
        startDate: "1-Jul-24",
        endDate: "30-Sep-24"
    },
    {
        type: "Quarter",
        label: "Q3 FY2025",
        startDate: "1-Oct-24",
        endDate: "31-Dec-24"
    },
    {
        type: "Quarter",
        label: "Q4 FY2025",
        startDate: "1-Jan-25",
        endDate: "31-Mar-25"
    },
    {
        type: "Quarter",
        label: "Q1 FY2026",
        startDate: "1-Apr-25",
        endDate: "30-Jun-25"
    },
    {
        type: "Quarter",
        label: "Q2 FY2026",
        startDate: "1-Jul-25",
        endDate: "30-Sep-25"
    },
    {
        type: "Quarter",
        label: "Q3 FY2026",
        startDate: "1-Oct-25",
        endDate: "31-Dec-25"
    },
    {
        type: "Quarter",
        label: "Q4 FY2026",
        startDate: "1-Jan-26",
        endDate: "31-Mar-26"
    },
    {
        type: "Year",
        label: "FY 2025",
        startDate: "1-Apr-24",
        endDate: "31-Mar-25"
    },
    {
        type: "Year",
        label: "FY 2026",
        startDate: "1-Apr-25",
        endDate: "31-Mar-26"
    }
];

// Helper: Converts '1-Apr-24' to Date object
function parseCustomDateLabel(dateStr: string): Date {
    const [d, m, y] = dateStr.split("-");
    // Convert "24" -> "2024" (assume all in this century)
    const fullYear = Number(y) + (Number(y) < 50 ? 2000 : 1900);
    return new Date(`${d} ${m} ${fullYear}`);
}

export async function GET() {
    const cookieStore = await cookies();
    const userContextCookie = cookieStore.get('qode-user-context');

    let userContext: UserContext | null = null;
    let email: string | null = null;

    // Parse user context
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

    // Get distributor info
    const distributorResult = await query(
        `SELECT * FROM pms_clients_master WHERE email = $1`,
        [email]
    );
    if (!distributorResult.rows.length) {
        return NextResponse.json({ error: 'Distributor not found' }, { status: 404 });
    }
    const distributor = distributorResult.rows[0];
    const intermediaryName = distributor.clientname;

    // Find clients for whom this user is an intermediary
    const clientsResult = await query(
        `SELECT * FROM pms_clients_master WHERE intermediaryname = $1`,
        [intermediaryName]
    );
    const clientRows = clientsResult.rows;

    // Get all valid inception dates as numbers (yyyy-mm-dd)
    const clientInceptionDates = clientRows
        .map((row: any) => row.inceptiondate)
        .filter(Boolean)
        .map((date: any) => new Date(date));
    console.log(clientInceptionDates,"======================clientInceptionDates")
    // Get maximum inception date (the latest one)
    let maxInceptionDateObj: Date | null = null;
    if (clientInceptionDates.length) {
        maxInceptionDateObj = new Date(Math.max.apply(null, clientInceptionDates));
    }
    console.log(maxInceptionDateObj);

    // ========== FILTER THE PERIOD_DATE_MAPPING BASED ON THE MAX INCEPTION DATE ==========

    let filteredPeriods = [...PERIOD_DATE_MAPPING];

    if (maxInceptionDateObj) {
        // Only include periods such that period.startDate >= maxInceptionDateObj (as per original logic)
        // OR, if between two startDates, take the most recent period whose startDate <= maxInceptionDateObj
        // Also, keep all periods after that
        let foundIndex: number | null = null;
        for (let i = 0; i < PERIOD_DATE_MAPPING.length; i++) {
            const start = parseCustomDateLabel(PERIOD_DATE_MAPPING[i].startDate);

            if (start > maxInceptionDateObj) {
                foundIndex = i - 1 >= 0 ? i - 1 : 0;
                break;
            } else if (i === PERIOD_DATE_MAPPING.length - 1) {
                // If not found and at last, select last
                foundIndex = i;
            }
        }
        if (foundIndex !== null) {
            filteredPeriods = PERIOD_DATE_MAPPING.slice(foundIndex);
        } else {
            filteredPeriods = PERIOD_DATE_MAPPING.filter(period => parseCustomDateLabel(period.startDate) >= maxInceptionDateObj!);
        }
    }

    // Determine suggested period (latest whose startDate <= maxInceptionDateObj or just the first remaining)
    let suggestedPeriod: typeof PERIOD_DATE_MAPPING[0] | null = null;
    if (filteredPeriods.length > 0 && maxInceptionDateObj) {
        for (let i = 0; i < filteredPeriods.length; i++) {
            const start = parseCustomDateLabel(filteredPeriods[i].startDate);
            if (start <= maxInceptionDateObj) {
                suggestedPeriod = filteredPeriods[i];
            }
        }
        if (!suggestedPeriod) suggestedPeriod = filteredPeriods[0];
    } else if (filteredPeriods.length > 0) {
        suggestedPeriod = filteredPeriods[0];
    }

    // The frontend can present 'filteredPeriods' as label, startDate, endDate for user selection.
    // Return this mapping for selection
    return NextResponse.json(
        {
            periods: filteredPeriods.map(p => ({
                type: p.type,
                label: p.label,
                startDate: p.startDate,
                endDate: p.endDate
            })),
            suggestedPeriod: suggestedPeriod
                ? {
                    type: suggestedPeriod.type,
                    label: suggestedPeriod.label,
                    startDate: suggestedPeriod.startDate,
                    endDate: suggestedPeriod.endDate
                }
                : null,
            maxInceptionDate: maxInceptionDateObj ? maxInceptionDateObj.toISOString().slice(0, 10) : null,
        },
        { status: 200 }
    );
}

// Returns array of calc rows
export async function POST(req: Request) {
    try {
        // Await the cookies() call, as per Next.js guidance for async dynamic route handlers
        const cookieStore = await cookies();
        const userContextCookie = cookieStore.get('qode-user-context');

        let userContext: UserContext | null = null;
        let email: string | null = null;

        // Parse user context
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

        // Parse POST body for date range
        let body: CalculatorRequest;
        try {
            body = await req.json();
            if (!body.startDate || !body.endDate) {
                return NextResponse.json({ error: 'Missing date range' }, { status: 400 });
            }
        } catch (e) {
            return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
        }

        // Get distributor (the user)
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

        // Find clients for whom this user is an intermediary
        const clientsResult = await query(
            `SELECT * FROM pms_clients_master WHERE intermediaryname = $1`,
            [intermediaryName]
        );
        const clientRows = clientsResult.rows;
        console.log(intermediaryName,clientRows,"============================clientRows");

        if (!clientRows.length) {
            return NextResponse.json([], { status: 200 });
        }

        // List of client codes for the query
        const wsClientCodes = clientRows.map((row: any) => row.clientcode);

        const aumResult = await query1(
            `SELECT accountcode, AVG(aum) as average_aum
             FROM pms_clients_tracker.pms_aum
             WHERE accountcode = ANY($1)
             AND valuedate BETWEEN $2 AND $3
             GROUP BY accountcode`,
            [wsClientCodes, body.startDate, body.endDate]
        );
        console.log(aumResult.rows,"===========================aumResult");

        // Fetch each account's inception date (the earliest valuedate)
        const inceptionResult = await query1(
            `SELECT accountcode, MIN(valuedate) as inception_date
             FROM pms_clients_tracker.pms_aum
             WHERE accountcode = ANY($1)
             GROUP BY accountcode`,
            [wsClientCodes]
        );
        console.log(inceptionResult.rows,"===========================inceptionResult");

        // Fetch transactions (fees)
        const feesResult = await query1(
            `SELECT ws_account_code as accountcode, client_name as clientname, SUM(net_amount) as total_fees_collected
            FROM pms_clients_tracker.pms_transactions
            WHERE ws_account_code = ANY($1)
              AND tran_desc IN ('Performance Fees','Management Fees')
              AND trandate BETWEEN $2 AND $3
            GROUP BY ws_account_code, client_name
            `,
            [wsClientCodes, body.startDate, body.endDate]
        );
        console.log(feesResult.rows,"===========================feesResult");

        // Helper to map client code to data
        const aumMap = new Map<string, any>();
        aumResult.rows.forEach((row: any) => aumMap.set(row.accountcode, row.average_aum));
        const inceptionMap = new Map<string, any>();
        inceptionResult.rows.forEach((row: any) => inceptionMap.set(row.accountcode, row.inception_date));

        // Prepare response
        const response = feesResult.rows.map((row: any, idx: number) => {
            const accountcode = row.accountcode;
            const clientname = row.clientname;
            const totalFees = parseFloat(row.total_fees_collected) || 0;
            const distributorShare = totalFees * (fees_percentage / 100);
            return {
                id: idx + 1,
                clientName: clientname,
                strategy: accountcode, // Strategy might not be available from current tables
                inceptionDate: inceptionMap.get(accountcode)
                    ? (() => {
                        const d = inceptionMap.get(accountcode);
                        // expects d in "yyyy-mm-dd" or "yyyy-mm-ddTHH:MM:SS" format
                        const [yyyy, mm, dd] = d.split('T')[0].split('-');
                        return `${dd}-${mm}-${yyyy}`;
                    })()
                    : null,
                averageAum: aumMap.get(accountcode) 
                    ? Number(aumMap.get(accountcode)).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
                    : "0.00",
                totalFeesCollected: totalFees.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
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