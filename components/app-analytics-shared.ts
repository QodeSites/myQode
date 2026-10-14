// What App analytics (/admin/analytics) and the summary of it on other admin pages share: the groups a client can be
// in, their wording, and percentages that add up. One copy, so two pages can never describe a group differently.
export type Status = "no_password" | "never_signed_in" | "website_only" | "old_app" | "app_not_used" | "using_app" | "family_covered"

// The places a client can be, in the order to chase them
export const STATUS: Record<Status, { label: string; tone: "red" | "amber" | "gold" | "green" | "grey"; color: string; meaning: string; action: string }> = {
  no_password: { label: "No password yet", tone: "red", color: "#b42318", meaning: "They have never set a password, so they cannot sign in anywhere.", action: "Send them the password setup link." },
  never_signed_in: { label: "Password set, never signed in", tone: "amber", color: "#d97706", meaning: "They set a password but never signed in.", action: "Remind them to sign in." },
  website_only: { label: "Website only, no app", tone: "amber", color: "#DABD38", meaning: "They sign in on the website but have never used the phone app.", action: "Ask them to install the app." },
  old_app: { label: "On the old app", tone: "gold", color: "#8a9a94", meaning: "They have the old myQode app on their phone, not the new version.", action: "Ask them to update to the new version from the store." },
  app_not_used: { label: "On the new app, not opened in 30 days", tone: "gold", color: "#6b7f78", meaning: "They have the new version of the app but have not opened it in the last 30 days.", action: "Remind them to open it." },
  using_app: { label: "On the new app", tone: "green", color: "#02422B", meaning: "They have the new version of the app and opened it in the last 30 days.", action: "Nothing to do." },
  family_covered: { label: "Family member, seen by the family head", tone: "grey", color: "#c7c2a6", meaning: "They have no password of their own, but the head of their family has a login and sees their account in it.", action: "Nothing to do." },
}
/** From the Admin Dashboard's "Total Owners" to the clients App analytics counts, in one line that adds up. */
export const ownersBridge = (S: Record<string, number>) =>
  `${S.ownersOnRecord} owners on record = ${S.clients} current clients${S.ownersClosed ? ` + ${S.ownersClosed} who closed every account` : ""}${S.ownersTest ? ` + ${S.ownersTest} Qode test accounts` : ""}.`
export const ORDER: Status[] = ["no_password", "never_signed_in", "website_only", "old_app", "app_not_used", "using_app", "family_covered"]

// Whole percentages that add up to exactly 100 (plain rounding of each one can give 99 or 101)
export const shares = (ns: number[]) => {
  const total = ns.reduce((a, b) => a + b, 0); if (!total) return ns.map(() => 0)
  const raw = ns.map((n) => (n / total) * 100), out = raw.map(Math.floor)
  let left = 100 - out.reduce((a, b) => a + b, 0)
  for (const i of raw.map((r, i) => [r - out[i], i]).sort((a, b) => b[0] - a[0]).map((x) => x[1])) { if (left-- <= 0) break; out[i]++ }
  return out
}
