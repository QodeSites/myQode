// ============================================================================
// Nifty options expiry-day detection
// ============================================================================
// Used to drive the "Unusual portfolio values on expiry days" investor notice.
//
// Background: on weekly options-expiry days, the WealthSpectrum/Nuvama pricing
// feed can temporarily report the *index level* (e.g. ~24000) as a contract's
// market price instead of the small option premium, inflating displayed
// portfolio value, unrealised gains and performance. This resolves once
// post-expiry settlement prices are reconciled (usually within a few hours).
//
// NSE moved Nifty weekly options expiry to TUESDAY (effective 1 Sep 2025).
// When an expiry day falls on an exchange holiday, expiry shifts to the
// PREVIOUS trading day.
// ============================================================================

// Nifty weekly options expire on Tuesday. JS getDay(): Sun=0 ... Tue=2.
const NIFTY_EXPIRY_WEEKDAY = 2; // Tuesday

// NSE trading holidays. Keep this list current each calendar year.
// Format: 'YYYY-MM-DD' (IST). Source: NSE holiday calendar.
// 2025/2026 full-day trading holidays.
const NSE_HOLIDAYS = new Set<string>([
  // 2025
  "2025-02-26", // Mahashivratri
  "2025-03-14", // Holi
  "2025-03-31", // Id-Ul-Fitr (Ramzan Id)
  "2025-04-10", // Mahavir Jayanti
  "2025-04-14", // Dr. Baba Saheb Ambedkar Jayanti
  "2025-04-18", // Good Friday
  "2025-05-01", // Maharashtra Day
  "2025-08-15", // Independence Day
  "2025-08-27", // Ganesh Chaturthi
  "2025-10-02", // Mahatma Gandhi Jayanti / Dussehra
  "2025-10-21", // Diwali Laxmi Pujan (special session)
  "2025-10-22", // Diwali Balipratipada
  "2025-11-05", // Prakash Gurpurb Sri Guru Nanak Dev
  "2025-12-25", // Christmas
  // 2026 (update when NSE publishes the official 2026 calendar)
  "2026-01-26", // Republic Day
  "2026-03-04", // Holi
  "2026-03-21", // Id-Ul-Fitr
  "2026-03-31", // Mahavir Jayanti
  "2026-04-03", // Good Friday
  "2026-04-14", // Dr. Baba Saheb Ambedkar Jayanti
  "2026-05-01", // Maharashtra Day
  "2026-08-15", // Independence Day (Saturday)
  "2026-10-02", // Mahatma Gandhi Jayanti
  "2026-11-09", // Diwali Balipratipada (approx — verify)
  "2026-12-25", // Christmas
]);

/** Format a Date as 'YYYY-MM-DD' in IST (Asia/Kolkata, UTC+5:30). */
export function toISTDateKey(date: Date): string {
  // Shift to IST then read the UTC date parts so we get the IST calendar day.
  const istMs = date.getTime() + 5.5 * 60 * 60 * 1000;
  const ist = new Date(istMs);
  const y = ist.getUTCFullYear();
  const m = String(ist.getUTCMonth() + 1).padStart(2, "0");
  const d = String(ist.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function isWeekend(dayOfWeek: number): boolean {
  return dayOfWeek === 0 || dayOfWeek === 6; // Sun or Sat
}

/** True if the given IST date key is an NSE trading day (not weekend/holiday). */
export function isTradingDay(dateKey: string): boolean {
  const d = new Date(`${dateKey}T00:00:00Z`);
  const dow = d.getUTCDay();
  if (isWeekend(dow)) return false;
  if (NSE_HOLIDAYS.has(dateKey)) return false;
  return true;
}

/**
 * Determine the actual Nifty expiry trading day for the week containing
 * `dateKey`. Normally Tuesday; if Tuesday is a holiday it rolls back to the
 * previous trading day (Mon, then Fri, etc.).
 * Returns the 'YYYY-MM-DD' of the effective expiry day, or null if it can't
 * be resolved within the same week.
 */
export function getNiftyExpiryDayForWeek(dateKey: string): string | null {
  const d = new Date(`${dateKey}T00:00:00Z`);
  const dow = d.getUTCDay();
  // Move to this week's Tuesday.
  const diff = NIFTY_EXPIRY_WEEKDAY - dow;
  const tuesday = new Date(d.getTime() + diff * 24 * 60 * 60 * 1000);

  // Roll back over holidays/weekends (max 5 steps to stay within the week).
  for (let i = 0; i < 6; i++) {
    const candidate = new Date(tuesday.getTime() - i * 24 * 60 * 60 * 1000);
    const ck = `${candidate.getUTCFullYear()}-${String(
      candidate.getUTCMonth() + 1
    ).padStart(2, "0")}-${String(candidate.getUTCDate()).padStart(2, "0")}`;
    if (isTradingDay(ck)) return ck;
  }
  return null;
}

/** True if `dateKey` (IST 'YYYY-MM-DD') is the effective Nifty expiry day. */
export function isNiftyExpiryDay(dateKey: string): boolean {
  if (!isTradingDay(dateKey)) return false;
  return getNiftyExpiryDayForWeek(dateKey) === dateKey;
}

/** Convenience: is *now* (server clock) a Nifty expiry day, in IST. */
export function isTodayNiftyExpiry(now: Date = new Date()): {
  isExpiry: boolean;
  dateKey: string;
} {
  const dateKey = toISTDateKey(now);
  return { isExpiry: isNiftyExpiryDay(dateKey), dateKey };
}

// ----------------------------------------------------------------------------
// Spike detection
// ----------------------------------------------------------------------------
// The microsite only stores NAV / portfolio_value level data, not individual
// option                                                                                                                                                                                                                                                                    . So we detect the *symptom*: an abnormal day-over-day
// move                                                                                                                                                                                                                                                                     (or                                                                                                                                  )                                                                                                                                                                                                                                                                     with an                                                                                                                                   day. Tuned
// conservatively so normal market moves never trigger it.
//
// The index-level mispricing can inflate value in EITHER direction depending on
// whether the affected contract is a long or short position — so we treat an
// abnormal move up OR down as the symptom.

export const SPIKE_PNL_PERCENT_THRESHOLD = 0; // |%| single-day move
export const SPIKE_NAV_RATIO_THRESHOLD = 2; // nav / prev_nav (upward)
export const SPIKE_NAV_RATIO_THRESHOLD_DOWN = 0.85; // nav / prev_nav (downward)

export function isSpikeAnomaly(params: {
  nav?: number | null;
  prev_nav?: number | null;
  pnl_percent?: number | null;
}): boolean {
  const { nav, prev_nav, pnl_percent } = params;

  // Abnormal single-day pnl move in either direction.
  if (
    typeof pnl_percent === "number" &&
    isFinite(pnl_percent) &&
    Math.abs(pnl_percent) >= SPIKE_PNL_PERCENT_THRESHOLD
  ) {
    return true;
  }

  // Abnormal NAV ratio vs prior day — spike up or crash down.
  if (
    typeof nav === "number" &&
    typeof prev_nav === "number" &&
    isFinite(nav) &&
    isFinite(prev_nav) &&
    prev_nav > 0
  ) {
    const ratio = nav / prev_nav;
    if (ratio >= SPIKE_NAV_RATIO_THRESHOLD || ratio <= SPIKE_NAV_RATIO_THRESHOLD_DOWN) {
      return true;
    }
  }

  return false;
}
