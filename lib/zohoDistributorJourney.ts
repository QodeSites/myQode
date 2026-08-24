// Distributor client-journey data, sourced from Zoho CRM.
//
// DELIBERATELY SELF-CONTAINED
// This module does its own Distributor lookup rather than importing from
// lib/zohoDistributorFees.ts. The fees module drives real payouts and is
// explicitly out of scope for this work, so nothing here may change its
// behaviour. The duplicated email-indexing is the accepted cost.
//
// WHY THE EMAIL LOOKUP CHECKS TWO FIELDS
// A distributor's portal login is usually NOT their Zoho primary Email.
// Verified 2026-08-20: advisory@onebattalion.in, altassets.ops@fundsindia.com,
// info@ensofinserv.com and rahulshetty42@gmail.com are all Secondary_Email.
// An Email-only lookup would fail for most distributors.
//
// Matching is EXACT and never fuzzy: rahulshetty42@gmail.com and
// rahulshetty432@gmail.com are two different real addresses. A near-miss match
// would show one distributor another's clients.
//
// WHY JOURNEY DATA COMES FROM Investors, NOT Leads
// Lead_Stage is effectively binary in production (105 of 112 distributor leads
// read "Onboarding Investor", 7 read "Lost Lead"). Investor_Stage carries the
// real funnel. Leads convert to Investors already, so nothing is lost.
import { getZohoAccessToken, zohoApiDomain } from "@/lib/zoho";

/**
 * The seven values present in production, funnel order first, inactive last.
 *
 * Counts across all 401 investor records on 2026-08-21: First Fund Initiated
 * 155, Regular Investor 95, Onboarding 51, Dropped before account opening 45,
 * Account Live 25, Dropped after account opening 17, Dormant Investor 13.
 */
export const STAGE_ORDER = [
  "Onboarding",
  "First Fund Initiated",
  "Account Live",
  "Regular Investor",
  "Dormant Investor",
  "Dropped before account opening",
  "Dropped after account opening",
] as const;

export type InvestorJourneyStage = (typeof STAGE_ORDER)[number];

export type JourneyClient = {
  name: string | null;
  email: string | null;
  stage: string | null;
  stageEntryDate: string | null;
  activationDate: string | null;
  /** Zoho's Date_Of_1st_Investment, labelled "Account live date" in the CRM. */
  accountLiveDate: string | null;
  firstTopUpDate: string | null;
};

export type DistributorJourney = {
  zohoId: string;
  zohoName: string | null;
  clients: JourneyClient[];
  stageCounts: Record<string, number>;
};

const CACHE_TTL_MS = 5 * 60 * 1000;
let journeyCache: { data: Map<string, DistributorJourney>; expiresAt: number } | null = null;

async function coql(selectQuery: string): Promise<any[]> {
  const token = await getZohoAccessToken();
  const res = await fetch(`${zohoApiDomain()}/crm/v3/coql`, {
    method: "POST",
    headers: {
      Authorization: `Zoho-oauthtoken ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ select_query: selectQuery }),
    cache: "no-store",
  });

  if (res.status === 204) return [];
  if (!res.ok) {
    throw new Error(`Zoho COQL failed: ${res.status} ${(await res.text()).slice(0, 300)}`);
  }
  const body = (await res.json()) as { data?: any[] };
  return body.data ?? [];
}

/** Escapes a value for safe interpolation into a COQL string literal. */
function coqlLiteral(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
}

function tallyStages(clients: JourneyClient[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const stage of STAGE_ORDER) counts[stage] = 0;
  for (const c of clients) {
    const key = c.stage ?? "Unknown";
    counts[key] = (counts[key] ?? 0) + 1;
  }
  return counts;
}

function mapClient(r: any): JourneyClient {
  return {
    name: r.Name ?? null,
    email: r.Email ?? null,
    stage: r.Investor_Stage ?? null,
    stageEntryDate: r.Stage_Entry_Date ?? null,
    activationDate: r.Activation_Date ?? null,
    accountLiveDate: r.Date_Of_1st_Investment ?? null,
    firstTopUpDate: r.First_Top_Up_Date ?? null,
  };
}

/**
 * Finds a distributor's Zoho record by exact match on Email or Secondary_Email.
 * Returns null when Zoho has no record for that address.
 */
export async function findDistributorZohoId(
  email: string,
): Promise<{ id: string; name: string | null } | null> {
  const key = String(email ?? "").trim().toLowerCase();
  if (!key) return null;
  const lit = coqlLiteral(key);

  const rows = await coql(
    `select id, Name, Email, Secondary_Email
       from Distributor
      where Email = '${lit}' or Secondary_Email = '${lit}'
      limit 0, 2`,
  );

  const row = rows[0];
  if (!row?.id) return null;
  return { id: String(row.id), name: row.Name ?? null };
}

/**
 * The journey for ONE distributor, scoped by their Zoho record ID.
 *
 * The Zoho ID is resolved from the caller's own session email and the WHERE
 * clause is applied server-side, so the query can only ever return that
 * distributor's investors. Never widen this filter for a distributor-facing
 * caller.
 *
 * Note: `Primary_distributo` is spelled exactly as Zoho defines it — the typo
 * is in the CRM's API name, not here.
 */
export async function getJourneyForDistributor(
  email: string,
): Promise<DistributorJourney | null> {
  const record = await findDistributorZohoId(email);
  if (!record) return null;

  const clients: JourneyClient[] = [];
  let offset = 0;

  for (let page = 0; page < 40; page++) {
    const rows = await coql(
      `select Name, Email, Investor_Stage, Stage_Entry_Date,
              Activation_Date, Date_Of_1st_Investment, First_Top_Up_Date
         from Investors
        where Primary_distributo = ${record.id}
        limit ${offset}, 200`,
    );
    if (!rows.length) break;
    clients.push(...rows.map(mapClient));
    if (rows.length < 200) break;
    offset += 200;
  }

  return {
    zohoId: record.id,
    zohoName: record.name,
    clients,
    stageCounts: tallyStages(clients),
  };
}

/**
 * Every distributor's journey, keyed by Zoho record ID. INTERNAL USE ONLY —
 * callers MUST have verified an admin session first. Never reachable from a
 * distributor-facing route.
 */
export async function getAllDistributorJourneys(): Promise<Map<string, DistributorJourney>> {
  if (journeyCache && journeyCache.expiresAt > Date.now()) return journeyCache.data;

  const names = new Map<string, string | null>();
  const emails = new Map<string, { primary: string | null; secondary: string | null }>();
  let nameOffset = 0;
  for (let page = 0; page < 40; page++) {
    const rows = await coql(
      `select id, Name, Email, Secondary_Email from Distributor
        where id is not null limit ${nameOffset}, 200`,
    );
    if (!rows.length) break;
    for (const r of rows) {
      names.set(String(r.id), r.Name ?? null);
      emails.set(String(r.id), {
        primary: r.Email ?? null,
        secondary: r.Secondary_Email ?? null,
      });
    }
    if (rows.length < 200) break;
    nameOffset += 200;
  }

  const byDistributor = new Map<string, JourneyClient[]>();
  let offset = 0;
  for (let page = 0; page < 40; page++) {
    const rows = await coql(
      `select Name, Email, Investor_Stage, Stage_Entry_Date, Activation_Date,
              Date_Of_1st_Investment, First_Top_Up_Date, Primary_distributo
         from Investors
        where Primary_distributo is not null
        limit ${offset}, 200`,
    );
    if (!rows.length) break;
    for (const r of rows) {
      const id = r.Primary_distributo?.id ? String(r.Primary_distributo.id) : null;
      if (!id) continue;
      if (!byDistributor.has(id)) byDistributor.set(id, []);
      byDistributor.get(id)!.push(mapClient(r));
    }
    if (rows.length < 200) break;
    offset += 200;
  }

  const out = new Map<string, DistributorJourney>();
  for (const [id, clients] of byDistributor) {
    out.set(id, {
      zohoId: id,
      zohoName: names.get(id) ?? null,
      clients,
      stageCounts: tallyStages(clients),
    });
  }

  journeyCache = { data: out, expiresAt: Date.now() + CACHE_TTL_MS };
  return out;
}

/**
 * Zoho contact addresses per distributor record, lowercased. Used by the
 * internal view to match a CRM distributor to a portal login. INTERNAL USE
 * ONLY — never call this from a distributor-facing route.
 */
export async function getDistributorEmailsById(): Promise<Map<string, string[]>> {
  const out = new Map<string, string[]>();
  let offset = 0;
  for (let page = 0; page < 40; page++) {
    const rows = await coql(
      `select id, Email, Secondary_Email from Distributor
        where id is not null limit ${offset}, 200`,
    );
    if (!rows.length) break;
    for (const r of rows) {
      const list = [r.Email, r.Secondary_Email]
        .map((v) => String(v ?? "").trim().toLowerCase())
        .filter(Boolean);
      out.set(String(r.id), list);
    }
    if (rows.length < 200) break;
    offset += 200;
  }
  return out;
}

/**
 * A distributor's own CRM record — the relationship, not their clients.
 *
 * Distinct from DistributorJourney, which describes the investors they
 * referred. This is the partner themselves: which stage the relationship is
 * in, who they are, and when they were last spoken to.
 */
export type DistributorRecord = {
  zohoId: string;
  name: string | null;
  email: string | null;
  secondaryEmail: string | null;
  /** The distributor relationship pipeline — NOT an investor's stage. */
  stage: string | null;
  type: string | null;
  aum: number | null;
  lastContactDate: string | null;
  nextContactDate: string | null;
  sharePct: number | null;
  revenueSharingModel: string | null;
};

/**
 * Every distributor record in the CRM — 140 as of 2026-08-21, of which only
 * 16 have a portal login and ~19 have referred an investor. The internal view
 * needs all of them: a partner with no referrals yet is precisely the one the
 * team may need to chase.
 *
 * INTERNAL USE ONLY — callers must have verified an admin session first.
 */
export async function getAllDistributorRecords(): Promise<DistributorRecord[]> {
  const out: DistributorRecord[] = [];
  let offset = 0;

  for (let page = 0; page < 40; page++) {
    const rows = await coql(
      `select id, Name, Email, Secondary_Email, Investor_Stage,
              Type_of_Distributor, AUM, Last_Contact_Date, Next_Contact_Date,
              Base_Distributor_Share, Revenue_Sharing_Model
         from Distributor
        where id is not null
        limit ${offset}, 200`,
    );
    if (!rows.length) break;

    for (const r of rows) {
      out.push({
        zohoId: String(r.id),
        name: r.Name ?? null,
        email: r.Email ?? null,
        secondaryEmail: r.Secondary_Email ?? null,
        stage: r.Investor_Stage ?? null,
        type: r.Type_of_Distributor ?? null,
        aum: r.AUM ?? null,
        lastContactDate: r.Last_Contact_Date ?? null,
        nextContactDate: r.Next_Contact_Date ?? null,
        sharePct: r.Base_Distributor_Share ?? null,
        revenueSharingModel: r.Revenue_Sharing_Model ?? null,
      });
    }

    if (rows.length < 200) break;
    offset += 200;
  }

  return out;
}

/** Clears the cache — for a manual refresh after editing Zoho. */
export function clearJourneyCache(): void {
  journeyCache = null;
}
