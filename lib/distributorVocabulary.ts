// Partner-facing language for the distributor portal.
//
// WHY THIS EXISTS
// Every label here is Zoho's own field value, verbatim. A partner reading a
// number on this dashboard can open the matching Zoho view and see the same
// figure against the same name — apple to apple. Nothing is renamed, and no
// page may invent its own wording: if a label is wrong, it is wrong here.
//
// Zoho's names describe the firm's pipeline, not the investor's situation, and
// two of them read backwards to anyone outside the firm:
//
//   "Account Live"          an OPEN account holding nothing
//   "First Fund Initiated"  where the money has actually arrived
//
// Verified on the live book: all 11 investors at Account Live carry no value,
// no invested amount and no strategies, while all 33 at First Fund Initiated
// carry all three. So each label ships with a one-line `detail` saying what it
// means. The name matches the CRM; the line underneath stops it being misread.

export type StatusKey =
  | "invested"
  | "opened"
  | "onboarding"
  | "inactive"
  | "declined"
  | "closed";

export type StatusInfo = {
  key: StatusKey;
  /** Zoho's field value, verbatim. Never a paraphrase. */
  label: string;
  /** What that name actually means, shown beneath it. */
  detail: string;
  tone: "good" | "normal" | "warn";
};

const INVESTED: StatusInfo = {
  // The key is an internal identifier — it appears in ?status= links and in
  // filter state, never on screen — so it stays stable while labels track Zoho.
  key: "invested",
  label: "First Fund Initiated",
  detail: "Money is in the market",
  tone: "good",
};
const OPENED: StatusInfo = {
  key: "opened",
  label: "Account Live",
  detail: "Account open — nothing invested yet",
  tone: "normal",
};
const ONBOARDING: StatusInfo = {
  key: "onboarding",
  label: "Onboarding",
  detail: "Account opening in progress",
  tone: "normal",
};
const INACTIVE: StatusInfo = {
  key: "inactive",
  label: "Dormant Investor",
  detail: "Account open, nothing moving",
  tone: "warn",
};
const DECLINED: StatusInfo = {
  key: "declined",
  label: "Dropped before account opening",
  detail: "Never opened an account",
  tone: "warn",
};
const CLOSED: StatusInfo = {
  key: "closed",
  label: "Dropped after account opening",
  detail: "Opened, then exited",
  tone: "warn",
};

/** Display order: furthest along first, stalled last. */
export const STATUS_ORDER: readonly StatusInfo[] = [
  INVESTED,
  OPENED,
  ONBOARDING,
  INACTIVE,
  DECLINED,
  CLOSED,
];

/**
 * Sub-stage values that mean the money has arrived.
 *
 * "Funded less than 50L" is funded: the amount is below the usual ticket, but
 * it is invested either way, and a partner counting funded clients should see
 * it there rather than in an opened-but-empty bucket.
 */
const FUNDED_SUBSTAGES = new Set<string>([
  "First Fund Initiated",
  "Funded less than 50L",
  "Regular Investor",
]);

/**
 * Maps a record to the language above.
 *
 * THE SUB-STAGE DECIDES.
 * Investor_Onboarding.Onboarding_Stage is the field the team actually keeps
 * current; Investors.Investor_Stage goes stale behind it. On the live book the
 * two disagree for 24 of 64 records — four investors read "Account Live" on the
 * main stage while the sub-stage already says they are funded. Counting the
 * main stage put 11 investors under Account Live where the Zoho view showed 7.
 *
 * Reading the sub-stage first makes every figure here reconcile against the
 * same Zoho view. Investor_Stage is the fallback for a record with no sub-stage
 * (none on the current book, but the field is not mandatory).
 */
export function statusFor(
  stage: string | null,
  onboardingStage?: string | null,
): StatusInfo {
  if (onboardingStage) {
    if (isStalledStage(onboardingStage)) {
      return /lost/i.test(onboardingStage) ? CLOSED : DECLINED;
    }
    if (FUNDED_SUBSTAGES.has(onboardingStage)) return INVESTED;
    if (onboardingStage === "Account Live") return OPENED;
    if (onboardingStage === "Dormant Investor") return INACTIVE;
    // Any other sub-stage is a step along the way to opening an account.
    if (ONBOARDING_SEQUENCE.includes(onboardingStage)) return ONBOARDING;
  }

  switch (stage) {
    case "First Fund Initiated":
    case "Regular Investor":
      return INVESTED;
    case "Account Live":
      return OPENED;
    case "Onboarding":
      return ONBOARDING;
    case "Dormant Investor":
      return INACTIVE;
    case "Dropped before account opening":
      return DECLINED;
    case "Dropped after account opening":
      return CLOSED;
    default:
      // An unrecognised stage falls through to Onboarding rather than showing
      // a raw value: "in progress" is true of anything not yet invested.
      return ONBOARDING;
  }
}

/** Strategy identity colours, per the design system. */
export const STRATEGY_COLOR: Record<string, string> = {
  "Qode All Weather": "#008455",
  "Qode Growth Fund": "#0A3452",
  "Qode Tactical Fund": "#550E0E",
};

/** Neutral, for anything outside the three named strategies. */
export const NEUTRAL_COLOR = "#9CA3AF";

/** "Qode Growth Fund" -> "Growth". Keeps chart labels readable. */
export function shortStrategy(name: string): string {
  return name.replace(/^Qode\s+/, "").replace(/\s+Fund$/, "");
}

/**
 * The onboarding sub-stages, in the order an account actually progresses.
 *
 * Values are Investor_Onboarding.Onboarding_Stage, verbatim. Listing them in
 * sequence lets a summary show how far along a group is, rather than sorting by
 * count and putting a nearly-finished client above one that just started.
 *
 * The terminal values ("Account Live", "First Fund Initiated", "Funded less
 * than 50L") are excluded: an investor who has reached them is no longer in
 * onboarding, so they never appear in this section.
 */
export const ONBOARDING_SEQUENCE: readonly string[] = [
  "Investor added",
  "Onboarding Email Sent",
  "Documents Received",
  "Forms Filled",
  "Consent Received",
  "Form Sent to Investor for Signature",
  "Forms Received from Investor",
  "Esign Received",
  "Forms Sent to Nuvama",
  "CML Pending",
  "Observations",
];

/**
 * Position in the sequence, for ordering. Unknown values sort last rather than
 * first, so a new CRM value never claims to be the earliest step.
 */
export function onboardingRank(stage: string): number {
  const i = ONBOARDING_SEQUENCE.indexOf(stage);
  return i === -1 ? ONBOARDING_SEQUENCE.length : i;
}

/**
 * True for sub-stages that mean the client stopped, not progressed.
 * These read in destructive colour so a partner sees them as needing action.
 */
export function isStalledStage(stage: string): boolean {
  return /dropped|lost/i.test(stage);
}
