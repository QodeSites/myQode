import { NextRequest, NextResponse } from "next/server";
import { query } from "@/lib/db";
import {
  authenticateDistributor,
  getDistributorAccounts,
  DISTRIBUTOR_NAME,
  toISTDate,
  num,
} from "@/lib/distributorApi";

export const dynamic = "force-dynamic";

/**
 * GET /api/distributor-api/v1/investors
 *
 * Returns the distributor's full investor book as a family -> owner -> account
 * tree (the same grouping shown on the myQode portfolio "snapshot" tab),
 * enriched with the latest portfolio value and total invested amount.
 */
export async function GET(request: NextRequest) {
  const authError = authenticateDistributor(request);
  if (authError) return authError;

  try {
    const accounts = await getDistributorAccounts();

    if (!accounts.length) {
      return NextResponse.json({
        distributor: DISTRIBUTOR_NAME,
        summary: { total_accounts: 0, total_families: 0, total_owners: 0, total_aum: 0 },
        families: [],
      });
    }

    const codes = accounts.map((a) => a.clientcode);

    // Latest portfolio value per account (most recent report_date).
    const latestAum = await query(
      `SELECT DISTINCT ON (account_code)
              account_code, portfolio_value, report_date
         FROM public.pms_master_sheet
        WHERE account_code = ANY($1)
        ORDER BY account_code, report_date DESC, created_at DESC`,
      [codes]
    );

    // Invested amount (sum of capital flows) per account.
    const invested = await query(
      `SELECT account_code, SUM(cash_in_out) AS invested_amount
         FROM public.pms_master_sheet
        WHERE account_code = ANY($1)
        GROUP BY account_code`,
      [codes]
    );

    const aumMap = new Map<string, any>();
    latestAum.rows.forEach((r: any) => aumMap.set(r.account_code, r));
    const investedMap = new Map<string, number>();
    invested.rows.forEach((r: any) => investedMap.set(r.account_code, num(r.invested_amount)));

    // Build family -> owner -> account tree.
    const families = new Map<string, any>();
    let totalAum = 0;
    const ownerKeys = new Set<string>();

    for (const a of accounts) {
      const aumRow = aumMap.get(a.clientcode);
      const latest = num(aumRow?.portfolio_value);
      totalAum += latest;

      const groupId = a.groupid ?? "ungrouped";
      const ownerId = a.ownerid ?? a.clientcode;
      ownerKeys.add(`${groupId}::${ownerId}`);

      if (!families.has(groupId)) {
        families.set(groupId, {
          group_id: a.groupid,
          group_name: a.groupname,
          total_aum: 0,
          owners: new Map<string, any>(),
        });
      }
      const fam = families.get(groupId);
      fam.total_aum += latest;

      if (!fam.owners.has(ownerId)) {
        fam.owners.set(ownerId, {
          owner_id: a.ownerid,
          owner_name: a.ownername,
          is_head_of_family: false,
          total_aum: 0,
          accounts: [],
        });
      }
      const owner = fam.owners.get(ownerId);
      owner.total_aum += latest;
      if (a.head_of_family) owner.is_head_of_family = true;

      owner.accounts.push({
        client_id: a.clientid,
        account_code: a.clientcode,
        client_name: a.clientname,
        email: a.email,
        scheme: a.schemename,
        account_type: a.clienttype,
        head_of_family: a.head_of_family,
        inception_date: toISTDate(a.inceptiondate),
        latest_aum: latest,
        invested_amount: investedMap.get(a.clientcode) ?? 0,
        as_of: toISTDate(aumRow?.report_date),
      });
    }

    const familiesArr = Array.from(families.values()).map((f) => ({
      group_id: f.group_id,
      group_name: f.group_name,
      total_aum: f.total_aum,
      owners: Array.from(f.owners.values()),
    }));

    return NextResponse.json({
      distributor: DISTRIBUTOR_NAME,
      summary: {
        total_accounts: accounts.length,
        total_families: families.size,
        total_owners: ownerKeys.size,
        total_aum: totalAum,
      },
      families: familiesArr,
    });
  } catch (error) {
    console.error("[distributor-api/investors] error:", error);
    return NextResponse.json(
      { error: "Internal server error", code: "INTERNAL_ERROR" },
      { status: 500 }
    );
  }
}
