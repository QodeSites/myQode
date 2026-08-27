// Who sees what in the back office.
//
// Roles are keyed on the email address because that is what the Microsoft SSO
// session already carries (app/api/auth/microsoft/callback writes user.email)
// and what ADMIN_AUTHORIZED_EMAILS already gates on. No schema change, no new
// auth concept.
//
// NOTE: karan.salecha@, kruti.dave@ and accounts@ are NOT on
// ADMIN_AUTHORIZED_EMAILS as of 2026-08-27, so they are rejected at login
// before any of this runs. Their entries here are deliberate and dormant:
// the moment an operator adds them to the environment, they get the right
// view with no code change.

export type Role = "super" | "distributor" | "invoices" | "default";

export type Section =
  | "console"
  | "analytics"
  | "clients"
  | "families"
  | "distributor"
  | "invoices"
  | "queries";

/**
 * Explicit role assignments. Anyone authorised but unlisted falls through to
 * "default" — the least-privileged role. Never default to "super": a new
 * staff member should have to be granted reach, not accidentally inherit it.
 *
 * rishabh.nahar@ is spelled as it appears on the allowlist. A transposed
 * "rishabnh" would silently drop him to the default role.
 */
const ROLE_MAP: Record<string, Role> = {
  "sanket.shinde@qodeinvest.com": "super",
  "gaurav.didwania@qodeinvest.com": "super",
  "karan.salecha@qodeinvest.com": "super",
  "rishabh.nahar@qodeinvest.com": "super",
  "krutika.urankar@qodeinvest.com": "distributor",
  "kruti.dave@qodeinvest.com": "invoices",
  "accounts@qodeinvest.com": "invoices",
};

/** Which sections each role may reach. The API enforces this; the UI mirrors it. */
const ACCESS: Record<Role, Section[]> = {
  // Business decisions need the whole picture.
  super: [
    "console",
    "analytics",
    "clients",
    "families",
    "distributor",
    "invoices",
    "queries",
  ],
  // Distributors and their clients — the distributor view already scopes to
  // the partner's own book, so the general Clients page is not needed here.
  distributor: ["distributor"],
  // Finance reviews invoices. Investor records are not part of that job.
  invoices: ["invoices"],
  // Everyone else works with individual investors.
  default: ["clients", "families", "queries"],
};

/** Where each role starts. */
const LANDING: Record<Role, string> = {
  super: "/admin/analytics",
  distributor: "/distributors/internal",
  invoices: "/admin/invoices",
  default: "/admin/clients",
};

/** The role for a session email. Unknown or missing resolves to "default". */
export function resolveRole(email: string | null | undefined): Role {
  const key = String(email ?? "").trim().toLowerCase();
  if (!key) return "default";
  return ROLE_MAP[key] ?? "default";
}

/** Whether a role may reach a section. */
export function canAccess(role: Role, section: Section): boolean {
  return ACCESS[role].includes(section);
}

/** Every section a role may reach, in navigation order. */
export function sectionsFor(role: Role): Section[] {
  return ACCESS[role];
}

/** The route a role should land on after signing in. */
export function landingFor(role: Role): string {
  return LANDING[role];
}
