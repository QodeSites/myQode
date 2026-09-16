// Distributor identity, resolved from the portal session.
//
// WHY `clientcode IS NULL` IDENTIFIES A DISTRIBUTOR
// pms_clients_master holds both investors and distributors. Verified against
// production on 2026-08-20: of 548 rows, exactly 16 have clientcode IS NULL,
// and all 16 sit under intermediaryname = 'QODE ADVISORS LLP INT'. No
// null-code row exists under any other intermediary, and every client row has
// a code. So a null clientcode is an exact discriminator, not a heuristic.
//
// A distributor's clients are the rows where intermediaryname = their
// clientname — the same mechanism app/api/distributor/clients uses.
import { query } from "@/lib/db";

export type DistributorIdentity = {
  /** Lowercased login email. */
  email: string;
  /**
   * The distributor's name as stored in the portal DB.
   *
   * This — NOT Zoho's `Name` — is the string the onboarding app expects in
   * its ?distributor= parameter. Verified: the DB holds "One Battalion
   * Ventures Private Limited", matching the live referral link, while Zoho's
   * Name is the truncated "One Battalion Ventures".
   */
  clientname: string;
  /**
   * Onboarding link slug — /{slug} and /ni/{slug}.
   *
   * Null when nobody has recorded one. Not derivable from the name or email:
   * two distributors share chhedarajmanish@gmail.com with different slugs, so
   * any computed rule would mis-attribute one partner's referrals to the
   * other. See migration 008.
   */
  referralSlug: string | null;
};

/**
 * Resolves a session email to a distributor, or null when the email belongs
 * to an investor (or nobody). Callers MUST treat null as "not a distributor"
 * and refuse access — this function is the authorization check.
 */
export async function resolveDistributorByEmail(
  email: string | null | undefined,
): Promise<DistributorIdentity | null> {
  const key = String(email ?? "").trim().toLowerCase();
  if (!key) return null;

  const result = await query(
    `SELECT clientname, email, referral_slug
       FROM pms_clients_master
      WHERE lower(email) = $1
        AND clientcode IS NULL
      LIMIT 1`,
    [key],
  );

  const row = result.rows?.[0];
  if (!row?.clientname) return null;

  return {
    email: key,
    clientname: String(row.clientname),
    referralSlug: row.referral_slug ?? null,
  };
}

/** How many client accounts sit under this distributor. */
export async function getDistributorClientCount(clientname: string): Promise<number> {
  const result = await query(
    `SELECT COUNT(*)::int AS n
       FROM pms_clients_master
      WHERE intermediaryname = $1`,
    [clientname],
  );
  return Number(result.rows?.[0]?.n ?? 0);
}
