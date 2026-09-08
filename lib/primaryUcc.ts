// ----------------------------------------------------------------------------
// Primary UCC resolution
// ----------------------------------------------------------------------------
// Nuvama's updated portal expects investors to log in with a single "primary"
// UCC code, even though a family group holds several. Neither of our two
// sources answers this alone, so we resolve down a ladder (measured over the
// full book, 256 groups):
//
//   1. head_of_family flag        — 12 groups. Human-verified, so it wins.
//   2. groupid -> fa_account_id   — 163 groups. pms_clients_master.groupid
//                                   holds the primary account's fa_account_id
//                                   in the signoff feed.
//   3. lowest fa_account_id       —  76 groups. Among the group's OWN codes
//                                   present in the feed.
//   -> unresolved                 —   5 groups (incl. test data).
//
// Ordering is load-bearing: where both step 1 and step 3 apply they disagree
// on 9 of 15 groups, so the flag must be checked first.
//
// Every candidate is validated against the group's own clientcodes before it
// is returned. A raw groupid->fa lookup alone resolves to a code the family
// does not own in 59 cases; returning one of those would tell an investor to
// log in with a stranger's account. When nothing validates we return null and
// the caller shows nothing — a wrong code is worse than no code.
// ----------------------------------------------------------------------------

const SIGNOFF_URL = "https://qode360.qodeinvest.com/api/signoff-clients?flat=1";

// The feed is ~1400 rows and changes only when ops sign off a new account, so
// a short in-process cache keeps this off the request path for most loads.
const CACHE_TTL_MS = 10 * 60 * 1000;

export interface SignoffRow {
  ucc_code: string;
  fa_account_id: string;
  client_name: string;
  dp_client_id: string;
  strategy: string;
}

export interface ClientRow {
  clientcode: string | null;
  groupid: string | null;
  head_of_family?: boolean | null;
}

export interface PrimaryUcc {
  uccCode: string;
  strategy: string | null;
  /** Which rung resolved it — surfaced for support/debugging, not for users. */
  source: "head_of_family" | "groupid_match" | "lowest_account";
  groupid: string;
}

declare global {
  // eslint-disable-next-line no-var
  var _signoffCache: { at: number; rows: SignoffRow[] } | undefined;
}

const norm = (v: unknown): string => (v == null ? "" : String(v).trim());

export async function fetchSignoffRows(): Promise<SignoffRow[]> {
  const cached = globalThis._signoffCache;
  if (cached && Date.now() - cached.at < CACHE_TTL_MS) return cached.rows;

  const res = await fetch(SIGNOFF_URL, {
    headers: { accept: "application/json" },
    cache: "no-store",
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new Error(`signoff-clients responded ${res.status}`);

  const body = await res.json();
  const rows: SignoffRow[] = Array.isArray(body) ? body : [];
  globalThis._signoffCache = { at: Date.now(), rows };
  return rows;
}

/**
 * Resolve the primary UCC for one family group.
 *
 * `members` must be every pms_clients_master row sharing this groupid — the
 * ladder validates candidates against the full set of codes the family owns.
 * Returns null when no candidate can be verified.
 */
export function resolvePrimaryUcc(
  members: ClientRow[],
  signoff: SignoffRow[]
): PrimaryUcc | null {
  const withCode = members.filter((m) => norm(m.clientcode));
  if (withCode.length === 0) return null;

  const groupid = norm(withCode[0].groupid);
  const ownedCodes = new Set(withCode.map((m) => norm(m.clientcode)));

  const byUcc = new Map<string, SignoffRow>();
  for (const r of signoff) {
    const k = norm(r.ucc_code);
    // 26 ucc_codes appear more than once; first occurrence wins, consistently.
    if (k && !byUcc.has(k)) byUcc.set(k, r);
  }

  const build = (code: string, source: PrimaryUcc["source"]): PrimaryUcc => ({
    uccCode: code,
    strategy: byUcc.get(code)?.strategy ?? null,
    source,
    groupid,
  });

  // 1. Human-verified flag, but only if the investor can actually use the code.
  const flagged = withCode.filter((m) => m.head_of_family === true);
  if (flagged.length === 1) {
    const code = norm(flagged[0].clientcode);
    if (byUcc.has(code)) return build(code, "head_of_family");
  }

  // 2. groupid is the primary account's fa_account_id in the feed.
  if (groupid) {
    const hit = signoff.find((r) => norm(r.fa_account_id) === groupid);
    const code = norm(hit?.ucc_code);
    // Guard: only trust it when the family actually owns the resolved code.
    if (code && ownedCodes.has(code)) return build(code, "groupid_match");
  }

  // 3. Oldest account the family owns, by fa_account_id.
  const owned = withCode
    .map((m) => byUcc.get(norm(m.clientcode)))
    .filter((r): r is SignoffRow => !!r)
    .sort((a, b) => Number(a.fa_account_id) - Number(b.fa_account_id));
  if (owned.length > 0) return build(norm(owned[0].ucc_code), "lowest_account");

  return null;
}

/**
 * Resolve primary UCCs for a set of client rows that may span several groups.
 * A handful of investors' emails cover more than one family, so this returns
 * one entry per group rather than a single code.
 */
export function resolvePrimaryUccsByGroup(
  rows: ClientRow[],
  signoff: SignoffRow[]
): PrimaryUcc[] {
  const groups = new Map<string, ClientRow[]>();
  for (const r of rows) {
    const g = norm(r.groupid);
    if (!g) continue;
    const list = groups.get(g);
    if (list) list.push(r);
    else groups.set(g, [r]);
  }

  const out: PrimaryUcc[] = [];
  for (const members of groups.values()) {
    const resolved = resolvePrimaryUcc(members, signoff);
    if (resolved) out.push(resolved);
  }
  return out;
}
