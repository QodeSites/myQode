// One investor's full CRM picture, for the back office.
//
// Distinct from lib/zohoInvestorDetails.ts, which returns a deliberately
// narrow slice safe to show a DISTRIBUTOR. This is the internal view: the
// team may see the relationship notes, fee arrangement and review history a
// distributor may not. Never call this from a distributor-facing route.
//
// Distinct from lib/zohoInvestorJourney.ts too, which answers "where am I"
// for the investor themselves and hides dropped and dormant stages. Nothing
// is hidden here — an admin needs to see a dropped account as dropped.
import { getZohoAccessToken, zohoApiDomain } from "@/lib/zoho";

export type InvestorProfile = {
  zohoId: string;
  name: string | null;
  email: string | null;
  secondaryEmail: string | null;
  mobile: string | null;

  // Where they are
  stage: string | null;
  investorSource: string | null;
  activationDate: string | null;
  accountLiveDate: string | null;
  firstTopUpDate: string | null;
  droppedBefore: string | null;
  droppedAfter: string | null;

  // Money
  investedAmount: number | null;
  currentValue: number | null;
  expectedAum: number | null;
  strategies: string[];
  feesStructure: string[];

  // Who they are
  occupation: string | null;
  city: string | null;
  country: string | null;
  riskAppetite: string | null;

  // Relationship
  relationshipManager: string | null;
  lastConversation: string | null;
  lastContactedOn: string | null;
  nextContactDate: string | null;
  annualReviewStatus: string | null;
  annualReviewDate: string | null;
  hadWalkthrough: boolean;
  walkthroughDate: string | null;
  distributorId: string | null;
  referredBy: string | null;
};

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

/** Zoho multiselects arrive as an array, but a single value can come through
 *  as a bare string. Normalised so callers never have to check. */
function toList(v: unknown): string[] {
  if (Array.isArray(v)) return v.filter(Boolean).map(String);
  return v ? [String(v)] : [];
}

/**
 * The CRM profile for one investor, matched on email.
 *
 * Returns null when Zoho has no record — a normal case, not an error: an
 * investor can exist in pms_clients_master without a CRM record.
 *
 * WHY BOTH EMAIL FIELDS ARE CHECKED
 * The same reason the distributor lookup does: a person's portal login is not
 * always the address the CRM holds as primary.
 *
 * WHY THE FIRST MATCH WINS
 * Zoho holds duplicate investor records for some people — families and HUFs
 * commonly share one contact address. Ordering by Activation_Date so the
 * earliest funded record leads makes the choice stable across refreshes
 * rather than dependent on Zoho's internal ordering.
 */
export async function getInvestorProfile(
  email: string | null | undefined,
): Promise<InvestorProfile | null> {
  const key = String(email ?? "").trim().toLowerCase();
  if (!key) return null;
  const lit = coqlLiteral(key);

  const rows = await coql(
    `select id, Name, Email, Secondary_Email, Mobile_No,
            Investor_Stage, Investor_Source, Activation_Date,
            Date_Of_1st_Investment, First_Top_Up_Date,
            Dropped_before_account_opening, Dropped_after_account_opening,
            Invested_Amount, Current_Portfolio_Value, Expected_AUM,
            Strategy_Invested, Fees_Structure,
            Occupation, City, Country, Riisk_Appetite,
            Owner.first_name, Owner.last_name,
            Last_Conversation, Last_contacted_on, Next_Contact_Date,
            Annual_Review_Status, Date_for_Annual_Review,
            myQode_Walkthrough, Date_for_myQode_Walkthrough,
            Primary_distributo, Existing_Investor_referral_Name
       from Investors
      where Email = '${lit}' or Secondary_Email = '${lit}'
      order by Activation_Date
      limit 0, 5`,
  );

  const r = rows[0];
  if (!r?.id) return null;

  const rm = [r["Owner.first_name"], r["Owner.last_name"]]
    .filter(Boolean)
    .join(" ")
    .trim();

  return {
    zohoId: String(r.id),
    name: r.Name ?? null,
    email: r.Email ?? null,
    secondaryEmail: r.Secondary_Email ?? null,
    mobile: r.Mobile_No ?? null,

    stage: r.Investor_Stage ?? null,
    investorSource: r.Investor_Source ?? null,
    activationDate: r.Activation_Date ?? null,
    accountLiveDate: r.Date_Of_1st_Investment ?? null,
    firstTopUpDate: r.First_Top_Up_Date ?? null,
    droppedBefore: r.Dropped_before_account_opening ?? null,
    droppedAfter: r.Dropped_after_account_opening ?? null,

    investedAmount: r.Invested_Amount != null ? Number(r.Invested_Amount) : null,
    currentValue:
      r.Current_Portfolio_Value != null ? Number(r.Current_Portfolio_Value) : null,
    expectedAum: r.Expected_AUM != null ? Number(r.Expected_AUM) : null,
    strategies: toList(r.Strategy_Invested),
    feesStructure: toList(r.Fees_Structure),

    occupation: r.Occupation ?? null,
    city: r.City ?? null,
    country: r.Country ?? null,
    riskAppetite: r.Riisk_Appetite ?? null,

    relationshipManager: rm || null,
    lastConversation: r.Last_Conversation ?? null,
    lastContactedOn: r.Last_contacted_on ?? null,
    nextContactDate: r.Next_Contact_Date ?? null,
    annualReviewStatus: r.Annual_Review_Status ?? null,
    annualReviewDate: r.Date_for_Annual_Review ?? null,
    hadWalkthrough: r.myQode_Walkthrough === true,
    walkthroughDate: r.Date_for_myQode_Walkthrough ?? null,
    distributorId: r.Primary_distributo?.id ? String(r.Primary_distributo.id) : null,
    referredBy: r.Existing_Investor_referral_Name ?? null,
  };
}
