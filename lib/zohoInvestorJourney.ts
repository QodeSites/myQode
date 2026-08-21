// An investor's own onboarding journey, for display to that investor.
//
// AUDIENCE
// This is the investor-facing counterpart to lib/zohoDistributorJourney.ts.
// The distributor module answers "how are MY referred clients progressing";
// this answers "where am I in onboarding" for the signed-in investor.
//
// WHAT IS DELIBERATELY NOT SHOWN
// Zoho's Investor_Stage vocabulary is written for internal staff and includes
// "Dropped before account opening", "Dropped after account opening" and
// "Dormant Investor". Telling someone in their own portal that they were
// dropped reads as cold, gives them nothing to act on, and invites confused
// support calls. Those investors get no journey section at all — see
// isDisplayableStage below. The rest of their portal is unaffected.
import { getZohoAccessToken, zohoApiDomain } from "@/lib/zoho";

/**
 * The progression an investor may see, earliest first. Order matters: it
 * drives both the rendered stepper and the conflict resolution below.
 */
export const INVESTOR_VISIBLE_STAGES = [
  "Onboarding",
  "First Fund Initiated",
  "Account Live",
  "Regular Investor",
] as const;

export type InvestorVisibleStage = (typeof INVESTOR_VISIBLE_STAGES)[number];

/**
 * Stages that exist in Zoho but are never surfaced to the investor.
 * Kept explicit rather than inferred, so a new CRM stage does not silently
 * start appearing in the portal.
 */
const HIDDEN_STAGES = new Set<string>([
  "Dormant Investor",
  "Dropped before account opening",
  "Dropped after account opening",
]);

export type InvestorJourney = {
  /** The stage to display. Always one of INVESTOR_VISIBLE_STAGES. */
  stage: InvestorVisibleStage;
  /** Zero-based index into INVESTOR_VISIBLE_STAGES, for the stepper. */
  stageIndex: number;
  activationDate: string | null;
  /** Zoho's Date_Of_1st_Investment, labelled "Account live date" in the CRM. */
  accountLiveDate: string | null;
  firstTopUpDate: string | null;
};

function isDisplayableStage(stage: string | null | undefined): stage is InvestorVisibleStage {
  if (!stage) return false;
  if (HIDDEN_STAGES.has(stage)) return false;
  return (INVESTOR_VISIBLE_STAGES as readonly string[]).includes(stage);
}

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

/** Picks the later of two dates; null only when both are null. */
function laterDate(a: string | null, b: string | null): string | null {
  if (!a) return b;
  if (!b) return a;
  return a > b ? a : b;
}

/**
 * The signed-in investor's own journey, or null when there is nothing to show.
 *
 * Returns null when: Zoho has no record for the email; every record is in a
 * hidden stage (dropped/dormant); or the stage is unrecognised. Callers should
 * treat null as "render no journey section" — never as an error.
 *
 * WHY THE FURTHEST-PROGRESSED RECORD WINS
 * One email can own several Investor records — families and HUFs share a
 * contact address, exactly as app/api/distributor/clients documents. Four of
 * 386 emails currently hold records that disagree on stage, including
 * nisheshdalal@gmail.com, whose records read both "Dropped before account
 * opening" and "Regular Investor". Showing the earliest or the first-seen
 * stage would tell an active investor they had been dropped. Taking the
 * furthest-progressed visible stage is the only reading that is never alarming
 * and never wrong: if any of their accounts is live, they are a live investor.
 */
export async function getJourneyForInvestor(
  email: string | null | undefined,
): Promise<InvestorJourney | null> {
  const key = String(email ?? "").trim().toLowerCase();
  if (!key) return null;
  const lit = coqlLiteral(key);

  const rows = await coql(
    `select Email, Investor_Stage, Activation_Date,
            Date_Of_1st_Investment, First_Top_Up_Date
       from Investors
      where Email = '${lit}'
      limit 0, 200`,
  );
  if (!rows.length) return null;

  let best: InvestorJourney | null = null;

  for (const r of rows) {
    const stage = r.Investor_Stage;
    if (!isDisplayableStage(stage)) continue;

    const stageIndex = INVESTOR_VISIBLE_STAGES.indexOf(stage);
    const candidate: InvestorJourney = {
      stage,
      stageIndex,
      activationDate: r.Activation_Date ?? null,
      accountLiveDate: r.Date_Of_1st_Investment ?? null,
      firstTopUpDate: r.First_Top_Up_Date ?? null,
    };

    if (!best) {
      best = candidate;
      continue;
    }

    // The further-progressed record decides the displayed stage; a same or
    // earlier one cannot. Either way the milestone dates are merged, so a
    // date recorded on one of the investor's accounts is not lost because a
    // different account won the stage comparison.
    const winner: InvestorJourney = stageIndex > best.stageIndex ? candidate : best;

    best = {
      stage: winner.stage,
      stageIndex: winner.stageIndex,
      activationDate: best.activationDate ?? candidate.activationDate,
      accountLiveDate: best.accountLiveDate ?? candidate.accountLiveDate,
      firstTopUpDate: laterDate(best.firstTopUpDate, candidate.firstTopUpDate),
    };
  }

  return best;
}
