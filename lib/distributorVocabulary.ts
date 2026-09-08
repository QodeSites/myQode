// Partner-facing language for the distributor portal.
//
// WHY THIS EXISTS
// Zoho's stage names describe the firm's own pipeline, not the investor's
// situation. "First Fund Initiated" tells a distributor nothing about their
// client — it is our word for our process. A partner reading it has to guess,
// and guessing wrong about a client's money is the worst kind of confusion.
//
// Every label here answers "what happened to this investor?" in words a
// partner would use speaking to that client. No page may invent its own
// wording: if a label is wrong, it is wrong in one place.

export type StatusKey =
  | "invested"
  | "opened"
  | "onboarding"
  | "inactive"
  | "declined"
  | "closed";

export type StatusInfo = {
  key: StatusKey;
  /** Shown on the row. Two words at most. */
  label: string;
  /** One line under a group heading, explaining the label. */
  detail: string;
  tone: "good" | "normal" | "warn";
};

const INVESTED: StatusInfo = {
  // The key stays "invested": it is the identifier in ?status= links and in
  // filter state, not something a partner reads. Only the label changed.
  key: "invested",
  label: "Funded",
  detail: "Money is in the market and earning",
  tone: "good",
};
const OPENED: StatusInfo = {
  key: "opened",
  label: "Account opened",
  detail: "Ready to receive funds — nothing invested yet",
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
  label: "Inactive",
  detail: "Account open, nothing moving",
  tone: "warn",
};
const DECLINED: StatusInfo = {
  key: "declined",
  label: "Did not proceed",
  detail: "Never opened an account",
  tone: "warn",
};
const CLOSED: StatusInfo = {
  key: "closed",
  label: "Closed",
  detail: "Opened, then exited",
  tone: "warn",
};

/** Display order: furthest along first, inactive last. */
export const STATUS_ORDER: readonly StatusInfo[] = [
  INVESTED,
  OPENED,
  ONBOARDING,
  INACTIVE,
  DECLINED,
  CLOSED,
];

/**
 * Maps a Zoho stage to partner-facing language.
 *
 * An unrecognised stage falls through to "Onboarding" rather than
 * showing the raw value: a new CRM stage should never leak internal wording
 * into a partner's screen. It is the least alarming honest default — it says
 * "in progress", which is true of anything not yet invested.
 */
export function statusFor(
  stage: string | null,
  onboardingStage?: string | null,
): StatusInfo {
  // The two Zoho modules can disagree: 3 investors read "Dropped Before
  // Account Opening" in Investor_Onboarding while Investors still says
  // "Onboarding". The sub-stage is the more specific record of what actually
  // happened, so it wins — otherwise a partner sees someone in Onboarding who
  // has in fact walked away.
  if (onboardingStage && isStalledStage(onboardingStage)) {
    return /lost/i.test(onboardingStage) ? CLOSED : DECLINED;
  }

  switch (stage) {
    // "First Fund Initiated" is the stage where money is actually invested.
    // Verified against a live book on 2026-09-01: all 33 investors at this
    // stage carry an invested amount, a current value and their strategies,
    // while all 9 at "Account Live" carry none of the three.
    //
    // The names read the other way round, which is why this mapping is
    // written out rather than inferred — an earlier version had them swapped
    // and showed "Invested" over investors holding nothing.
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
 * Values come from Investor_Onboarding.Onboarding_Stage. Listing them in
 * sequence lets a summary show how far along a group is, rather than sorting
 * by count and putting a nearly-finished client above one that just started.
 *
 * The three terminal values ("Account Live", "First Fund Initiated",
 * "Funded less than 50L") are excluded: an investor who has reached them is no
 * longer in paperwork, so they never appear in this section.
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
 * Position in the sequence, for ordering. Unknown values sort last rather
 * than first, so a new CRM value never claims to be the earliest step.
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
