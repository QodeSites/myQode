import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/adminAuth";
import { query } from "@/lib/db";
import { getAllDistributorRecords } from "@/lib/zohoDistributorJourney";

/**
 * Per-distributor strategy summary and AUM split, for the internal view.
 *
 * Mirrors the Zoho "Distributor Strategy" dashboard and the team's tracking
 * sheet: one row per empanelled partner, with client counts, AUM in crore and
 * each strategy's share.
 *
 * WHY THE ROSTER COMES FROM ZOHO AND THE MONEY FROM POSTGRES
 * A partner with no clients has no rows in pms_clients_master — Torin Wealth,
 * Classic Finance, choice Wealth and Zebu are all empanelled and none of them
 * appear there. Building this from accounts alone showed 16 partners where the
 * team's sheet lists 21, silently dropping exactly the partners worth chasing.
 * So Zoho's Distributor module is the roster, and Postgres supplies live value.
 *
 * The AUM figures are live, not Zoho's stored AUM field, which goes stale: the
 * CRM dashboard read 17.16 Cr for One Battalion, a value their book last held
 * on 2 Aug. Where the CRM is current the two agree to the decimal — Nuarch
 * 10.23 Cr at 47.3/52.7, Enso 4.16 Cr at 35.6/64.4, First Quartile 2.49 Cr at
 * 60/40 — which is how this query was verified.
 *
 * Strategy comes from the account code prefix (QAW/QGF/QTF): each strategy is
 * its own account, so no apportionment is needed. Splitting an investor's value
 * evenly across their strategies instead gave 36.2/33.5/30.3 for One Battalion
 * where the true split is 37.1/35.0/27.8.
 */

const STRATEGIES = [
  { code: "QAW", name: "Qode All Weather" },
  { code: "QGF", name: "Qode Growth Fund" },
  { code: "QTF", name: "Qode Tactical Fund" },
] as const;

/** Qode's own book, not a distribution partner. Excluded from these tables. */
function isHouseAccount(name: string): boolean {
  return /qode\s+advisors/i.test(name);
}

/** Loose match between a Zoho partner name and an intermediaryname. */
function normalise(name: string): string {
  return name
    .toLowerCase()
    .replace(/\b(private|pvt|limited|ltd|llp|services|financial|technologies)\b/g, "")
    .replace(/[^a-z0-9]/g, "");
}

type StrategyCell = { accounts: number; aum: number; pct: number };

export async function GET(request: NextRequest) {
  const admin = await requireRole(request, "distributor");
  if (admin instanceof NextResponse) return admin;

  try {
    // Live value per account, latest valuation, grouped by partner + strategy.
    const valued = await query(
      `WITH latest AS (
         SELECT DISTINCT ON (ms.account_code)
                ms.account_code, ms.portfolio_value, ms.report_date
           FROM public.pms_master_sheet ms
          WHERE ms.portfolio_value IS NOT NULL
          ORDER BY ms.account_code, ms.report_date DESC
       )
       SELECT cm.intermediaryname AS distributor,
              SUBSTRING(l.account_code FROM 1 FOR 3) AS strategy,
              COUNT(*)::int AS accounts,
              SUM(l.portfolio_value)::float8 AS aum,
              MAX(l.report_date) AS valued_on
         FROM latest l
         JOIN pms_clients_master cm ON cm.clientcode = l.account_code
        WHERE cm.intermediaryname IS NOT NULL AND cm.intermediaryname <> ''
        GROUP BY 1, 2`,
      [],
    );

    // Unique investors per partner. Counted across the whole book, since one
    // investor holding three strategies is one client, not three.
    const clientCounts = await query(
      `SELECT intermediaryname AS distributor,
              COUNT(DISTINCT clientname)::int AS clients
         FROM pms_clients_master
        WHERE intermediaryname IS NOT NULL AND intermediaryname <> ''
          AND clientcode IS NOT NULL
        GROUP BY 1`,
      [],
    );

    // Index Postgres figures by normalised name so a partner whose CRM name
    // differs in punctuation or suffix still matches their accounts.
    type Agg = {
      clients: number;
      total: number;
      valuedOn: string | null;
      byStrategy: Record<string, StrategyCell>;
      sourceName: string;
    };
    const byKey = new Map<string, Agg>();
    const ensure = (name: string): Agg => {
      const k = normalise(name);
      let a = byKey.get(k);
      if (!a) {
        a = { clients: 0, total: 0, valuedOn: null, byStrategy: {}, sourceName: name };
        byKey.set(k, a);
      }
      return a;
    };

    for (const r of valued.rows ?? []) {
      const name = String(r.distributor);
      if (isHouseAccount(name)) continue;
      const a = ensure(name);
      const s = STRATEGIES.find((x) => x.code === String(r.strategy));
      if (s) {
        const cell = a.byStrategy[s.name] ?? { accounts: 0, aum: 0, pct: 0 };
        cell.accounts += Number(r.accounts) || 0;
        cell.aum += Number(r.aum) || 0;
        a.byStrategy[s.name] = cell;
      }
      a.total += Number(r.aum) || 0;
      const d =
        r.valued_on instanceof Date
          ? r.valued_on.toISOString().slice(0, 10)
          : r.valued_on
            ? String(r.valued_on).slice(0, 10)
            : null;
      if (d && (!a.valuedOn || d > a.valuedOn)) a.valuedOn = d;
    }
    for (const r of clientCounts.rows ?? []) {
      const name = String(r.distributor);
      if (isHouseAccount(name)) continue;
      ensure(name).clients += Number(r.clients) || 0;
    }

    // Zoho is the roster. A partner with no accounts still gets a row, showing
    // zero — that is the state the team most needs to see.
    let partners: { name: string; stage: string | null; type: string | null }[] = [];
    let crmAvailable = true;
    try {
      const records = await getAllDistributorRecords();
      partners = records
        .filter((r) => r.name && !isHouseAccount(r.name))
        .map((r) => ({ name: String(r.name), stage: r.stage, type: r.type }));
    } catch (err) {
      console.error("[distributor/strategy-summary] Zoho unavailable:", err);
      crmAvailable = false;
    }

    // Fall back to whoever has accounts, so a CRM outage still renders a table.
    if (!partners.length) {
      partners = [...byKey.values()].map((a) => ({
        name: a.sourceName,
        stage: null,
        type: null,
      }));
    }

    const seen = new Set<string>();
    const rows = partners
      .filter((p) => {
        const k = normalise(p.name);
        if (seen.has(k)) return false; // Zoho holds First Quartile twice.
        seen.add(k);
        return true;
      })
      .map((p) => {
        const a = byKey.get(normalise(p.name));
        const total = a?.total ?? 0;
        const byStrategy: Record<string, StrategyCell> = {};
        for (const s of STRATEGIES) {
          const cell = a?.byStrategy[s.name] ?? { accounts: 0, aum: 0, pct: 0 };
          byStrategy[s.name] = {
            ...cell,
            pct: total > 0 ? (cell.aum / total) * 100 : 0,
          };
        }
        return {
          distributor: p.name,
          stage: p.stage,
          type: p.type,
          clients: a?.clients ?? 0,
          aum: total,
          valuedOn: a?.valuedOn ?? null,
          byStrategy,
          /** True when the CRM lists them but no account could be matched. */
          unmatched: !a,
        };
      })
      .sort((x, y) => y.aum - x.aum || y.clients - x.clients);

    const summary = {
      partners: rows.length,
      withClients: rows.filter((r) => r.clients > 0).length,
      totalClients: rows.reduce((n, r) => n + r.clients, 0),
      totalAum: rows.reduce((n, r) => n + r.aum, 0),
    };

    return NextResponse.json(
      { strategies: STRATEGIES, rows, summary, crmAvailable },
      { headers: { "Cache-Control": "private, no-store" } },
    );
  } catch (err) {
    console.error("[distributor/strategy-summary] failed:", err);
    return NextResponse.json(
      { error: "Could not load the strategy summary" },
      { status: 500 },
    );
  }
}
