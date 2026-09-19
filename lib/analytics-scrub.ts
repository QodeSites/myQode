/**
 * Redaction shared by every analytics and error path.
 *
 * MyQode is a signed-in investor dashboard: it shows holdings, portfolio values
 * and the identifiers behind them. None of that may reach PostHog or Sentry —
 * self-hosting does not change it, because the DPDP obligations follow the
 * data, not the server.
 *
 * The approach is a denylist on key names rather than value sniffing: a regex
 * for "looks like a PAN" misses the field called `pan_no` holding something
 * malformed, while the key name is stable and reviewable.
 */

/** Matched case-insensitively against any key, as a substring. */
const SENSITIVE_KEY_PATTERNS = [
  "pan",
  "aadhaar",
  "aadhar",
  "account",
  "accno",
  "acc_no",
  "bank",
  "card",
  "cvv",
  "ifsc",
  "demat",
  "dpid",
  "bo_id",
  "folio",
  "phone",
  "mobile",
  "email",
  "password",
  "otp",
  "token",
  "secret",
  "authorization",
  "cookie",
  "session",
  "cust_id",
  "custid",
  // Money. A portfolio value is as identifying as a name in a small book.
  "amount",
  "balance",
  "value",
  "holding",
  "portfolio",
  "corpus",
  "nav",
  "cost",
  "pnl",
  "gain",
]

export const REDACTED = "[redacted]"

/** Keys that are safe to keep even though they match a pattern above. */
const ALLOWLIST = new Set([
  // `product` names a strategy, not a person's money.
  "product",
  // Our own opaque identity — the whole point of src/lib/analytics-id.ts.
  "analyticsid",
  "analytics_id",
  "distinct_id",
  "distinctid",
])

export function isSensitiveKey(key: string): boolean {
  const k = key.toLowerCase()
  if (ALLOWLIST.has(k)) return false
  return SENSITIVE_KEY_PATTERNS.some((p) => k.includes(p))
}

/**
 * Deep-redact an object in place of sending it. Returns a new value; the input
 * is never mutated, because callers pass live objects from the request path.
 *
 * Depth-limited and cycle-safe: an error payload is not worth an infinite loop.
 */
export function scrub<T>(value: T, depth = 0, seen = new WeakSet<object>()): T {
  if (depth > 6 || value === null || typeof value !== "object") return value

  if (seen.has(value as object)) return "[circular]" as unknown as T
  seen.add(value as object)

  if (Array.isArray(value)) {
    return value.map((v) => scrub(v, depth + 1, seen)) as unknown as T
  }

  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    out[k] = isSensitiveKey(k) ? REDACTED : scrub(v, depth + 1, seen)
  }
  return out as unknown as T
}

/**
 * Strip the query string from a URL, keeping the path.
 *
 * `/review/holdings?custId=9876543210@finvu` is exactly the shape of leak this
 * prevents — the path is useful for grouping, the query is not worth the risk.
 */
export function scrubUrl(url: string | undefined): string | undefined {
  if (!url) return url
  try {
    const u = new URL(url, "http://local")
    return u.origin === "http://local" ? u.pathname : `${u.origin}${u.pathname}`
  } catch {
    return url.split("?")[0]
  }
}
