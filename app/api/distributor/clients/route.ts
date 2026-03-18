import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { query } from "@/lib/db";

interface UserContext {
  email: string;
}

interface ClientSummary {
  id: number;
  name: string;
  accountcode: string;
  scheme: string | null;
  latestAum: string;
  investedAmount: string;
  sinceInception: string | null;
}

function formatCurrency(value: any): string {
  const num = Number(value) || 0;
  return num.toLocaleString("en-IN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function formatDate(value: any): string | null {
  if (!value) return null;
  const d = typeof value === "string" ? value.split("T")[0] : value;
  const [yyyy, mm, dd] = (d as string).split("-");
  if (!yyyy || !mm || !dd) return null;
  return `${dd}-${mm}-${yyyy}`;
}

export async function GET() {
  try {
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

    // Distributor info
    const distributorResult = await query(
      `SELECT * FROM pms_clients_master WHERE email = $1`,
      [email]
    );

    if (!distributorResult.rows.length) {
      return NextResponse.json({ error: "Distributor not found" }, { status: 404 });
    }

    const distributor = distributorResult.rows[0];
    const intermediaryName = distributor.clientname;

    // All related clients for this distributor
    const clientsResult = await query(
      `SELECT * FROM pms_clients_master WHERE intermediaryname = $1`,
      [intermediaryName]
    );

    const clientRows = clientsResult.rows;
    if (!clientRows.length) {
      return NextResponse.json<ClientSummary[]>([], { status: 200 });
    }

    const accountCodes = clientRows.map((row: any) => row.clientcode);

    // Use public.pms_master_sheet for all metrics
    // Latest AUM (portfolio_value) per account_code
    const latestAumResult = await query(
      `
        SELECT DISTINCT ON (account_code)
          account_code,
          portfolio_value,
          report_date
        FROM public.pms_master_sheet
        WHERE account_code = ANY($1)
        ORDER BY account_code, report_date DESC
      `,
      [accountCodes]
    );

    // Since inception (first report_date) and invested amount (sum of cash_in_out)
    const inceptionAndInvestedResult = await query(
      `
        SELECT
          account_code,
          MIN(report_date) AS inception_date,
          SUM(cash_in_out) AS invested_amount
        FROM public.pms_master_sheet
        WHERE account_code = ANY($1)
        GROUP BY account_code
      `,
      [accountCodes]
    );

    const latestAumMap = new Map<string, any>();
    latestAumResult.rows.forEach((row: any) =>
      latestAumMap.set(row.account_code, row)
    );

    const inceptionMap = new Map<string, any>();
    const investedMap = new Map<string, any>();
    inceptionAndInvestedResult.rows.forEach((row: any) => {
      inceptionMap.set(row.account_code, row.inception_date);
      investedMap.set(row.account_code, row.invested_amount);
    });

    const response: ClientSummary[] = clientRows.map((client: any, idx: number) => {
      const accountcode = client.clientcode;
      const latestAumRow = latestAumMap.get(accountcode);
      const latestAum = latestAumRow ? latestAumRow.portfolio_value : 0;
      const invested = investedMap.get(accountcode) ?? 0;
      const inceptionRaw = inceptionMap.get(accountcode);

      return {
        id: idx + 1,
        name: client.clientname,
        accountcode,
        // scheme code: first three letters of account_code
        scheme: accountcode ? accountcode.substring(0, 3) : null,
        latestAum: formatCurrency(latestAum),
        investedAmount: formatCurrency(invested),
        sinceInception: formatDate(inceptionRaw),
      };
    });

    return NextResponse.json<ClientSummary[]>(response, { status: 200 });
  } catch (error) {
    console.error("Error in distributor clients API:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

