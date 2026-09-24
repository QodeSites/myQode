// app/api/expiry-check/route.tsx
// ----------------------------------------------------------------------------
// Decides whether to show the "Unusual portfolio values on expiry days" notice.
//
// Detection (holdings-based, deterministic):
//   myQode data is one day lagged — the latest holdings we hold for an account
//   are for T-1 (the previous trading/data day). For any Option holding
//   (security_type_description = 'Options'), the expiry date is embedded in
//   security_name, e.g. "Nifty 50 - Put - 28/04/2026 - 23900".
//
//   When that expiry date EQUALS the account's latest holding_date, the option
//   expired on the data date and its price is updated wrongly by the feed
//   (mktprice shows the index level instead of the option premium). That day's
//   displayed value/gain-loss is therefore unreliable → show the notice.
//
// This is exact (no NAV %-spike thresholds) and works at any magnitude.
// ----------------------------------------------------------------------------
import pool from "@/lib/db1";
import { NextRequest, NextResponse } from "next/server";
import { isTodayNiftyExpiry } from "@/lib/expiry-day";

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const codesParam =
      searchParams.get("nuvama_codes") || searchParams.get("nuvama_code");

    // Still surfaced for context, but no longer gates the notice — the holdings
    // data tells us directly which day is affected.
    const { isExpiry, dateKey } = isTodayNiftyExpiry();

    if (!codesParam) {
      return NextResponse.json({
        success: true,
        shouldShow: false,
        isExpiryDay: isExpiry,
        dateKey,
        affectedAccounts: [],
      });
    }

    const codes = codesParam
      .split(",")
      .map((c) => c.trim())
      .filter(Boolean);

    if (codes.length === 0) {
      return NextResponse.json({
        success: true,
        shouldShow: false,
        isExpiryDay: isExpiry,
        dateKey,
        affectedAccounts: [],
      });
    }

    // For each account, look at its latest holding snapshot (= T-1 lagged data
    // day) and flag Option holdings whose index-level mispricing ACTUALLY
    // distorts the displayed value.
    //
    // The strike is embedded in security_name, e.g.
    // "Nifty 50 - Put - 28/04/2026 - 23900"  -> strike 23900. A real option
    // premium is a small fraction of its strike; the expiry-day feed glitch
    // stuffs the index level into mktprice, so mktprice lands at ~1.0x strike.
    //
    // We require BOTH:
    //   (1) corrupted price:  mktprice ≈ strike level (ratio > 0.5), AND
    //   (2) material impact:  |mktvalue| is non-trivial, so the wrong price
    //       actually inflates/distorts the portfolio total the investor sees.
    //
    // Condition (2) is essential: an expired contract that has settled to
    // mktvalue = 0 may still show a junk mktprice in the price column, but it
    // contributes nothing to the total — the dashboard is correct, so we do NOT
    // alarm on it. The notice fires only when the client's numbers are truly off.
    const MATERIAL_VALUE = 1000; // ₹ — minimum mktvalue impact to consider "visible"

    const query = `
      WITH latest AS (
        SELECT ws_account_code, MAX(holding_date) AS data_date
        FROM pms_clients_tracker.pms_holdings
        WHERE ws_account_code = ANY($1)
        GROUP BY ws_account_code
      ),
      affected AS (
        SELECT
          h.ws_account_code,
          h.holding_date,
          h.security_name,
          h.mktprice,
          h.mktvalue,
          to_date(
            substring(h.security_name from '(\\d{2}/\\d{2}/\\d{4})'),
            'DD/MM/YYYY'
          ) AS expiry,
          NULLIF(regexp_replace(h.security_name, '^.*[- ]', ''), '')::numeric AS strike
        FROM pms_clients_tracker.pms_holdings h
        JOIN latest l
          ON l.ws_account_code = h.ws_account_code
         AND h.holding_date = l.data_date
        WHERE h.security_type_description = 'Options'
          AND h.security_name ~ '\\d{2}/\\d{2}/\\d{4}'
      )
      SELECT ws_account_code, holding_date, security_name, mktprice, mktvalue, expiry
      FROM affected
      WHERE strike > 1000
        AND mktprice > 1000
        AND mktprice / strike > 0.5          -- (1) price corrupted to ~index level
        AND abs(mktvalue) >= $2              -- (2) and it materially distorts the total
      ORDER BY ws_account_code
    `;

    const result = await pool.query(query, [codes, MATERIAL_VALUE]);

    // Group affected option rows by account.
    const byAccount = new Map<string, any>();
    for (const row of result.rows) {
      const code = row.ws_account_code;
      if (!byAccount.has(code)) {
        byAccount.set(code, {
          account_code: code,
          data_date: row.holding_date,
          contracts: [] as Array<{
            security_name: string;
            expiry_date: string;
            mktprice: number | null;
            mktvalue: number | null;
          }>,
        });
      }
      byAccount.get(code).contracts.push({
        security_name: row.security_name,
        expiry_date: row.expiry,
        mktprice: row.mktprice != null ? Number(row.mktprice) : null,
        mktvalue: row.mktvalue != null ? Number(row.mktvalue) : null,
      });
    }

    const affectedAccounts = Array.from(byAccount.values());

    return NextResponse.json({
      success: true,
      shouldShow: affectedAccounts.length > 0,
      isExpiryDay: isExpiry,
      dateKey,
      affectedAccounts,
    });
  } catch (error) {
    console.error("Expiry-check API error:", error);
    return NextResponse.json(
      { success: false, error: "Internal server error", shouldShow: false },
      { status: 500 }
    );
  }
}
