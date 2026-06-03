import { NextRequest, NextResponse } from "next/server";
import { createHash, timingSafeEqual } from "crypto";
import { query } from "@/lib/db";

/**
 * External, machine-to-machine API for the distributor
 * "One Battalion Ventures Private Limited" (advisory@onebattalion.in).
 *
 * Investor accounts are tied to a distributor via
 * pms_clients_master.intermediaryname (text match) — the same mechanism the
 * internal /api/distributor/clients route uses. This API is HARD-SCOPED to a
 * single distributor so One Battalion can only ever read their own book.
 */
export const DISTRIBUTOR_NAME = "One Battalion Ventures Private Limited";
export const DISTRIBUTOR_EMAIL = "advisory@onebattalion.in";

/** Stable SHA-256 compare that is resistant to timing attacks. */
function safeEqual(a: string, b: string): boolean {
  const ah = createHash("sha256").update(a).digest();
  const bh = createHash("sha256").update(b).digest();
  return timingSafeEqual(ah, bh);
}

/**
 * Validate the distributor API key. Accepts either
 *   Authorization: Bearer <key>
 * or
 *   x-api-key: <key>
 *
 * Returns null on success, or a ready-to-return NextResponse on failure.
 */
export function authenticateDistributor(request: NextRequest): NextResponse | null {
  const expected = process.env.ONE_BATTALION_API_KEY;
  if (!expected) {
    console.error("[distributorApi] ONE_BATTALION_API_KEY is not set");
    return NextResponse.json(
      { error: "Server misconfigured", code: "NO_API_KEY_CONFIGURED" },
      { status: 500 }
    );
  }

  const authHeader = request.headers.get("authorization");
  const headerKey = request.headers.get("x-api-key");
  const presented =
    authHeader && authHeader.toLowerCase().startsWith("bearer ")
      ? authHeader.slice(7).trim()
      : headerKey?.trim() ?? "";

  if (!presented) {
    return NextResponse.json(
      { error: "Missing API key", code: "NO_API_KEY" },
      { status: 401 }
    );
  }

  if (!safeEqual(presented, expected)) {
    return NextResponse.json(
      { error: "Invalid API key", code: "INVALID_API_KEY" },
      { status: 401 }
    );
  }

  return null;
}

export interface DistributorAccount {
  clientid: string | null;
  clientcode: string;
  clientname: string | null;
  email: string | null;
  clienttype: string | null;
  groupid: string | null;
  groupname: string | null;
  ownerid: string | null;
  ownername: string | null;
  head_of_family: boolean;
  schemename: string | null;
  inceptiondate: string | null;
}

/**
 * All investor accounts that belong to this distributor. This is the ONLY
 * source of account codes the rest of the API is allowed to touch — every
 * downstream query is filtered by the codes returned here, so a caller can
 * never read another distributor's data even by passing arbitrary codes.
 */
export async function getDistributorAccounts(): Promise<DistributorAccount[]> {
  const result = await query<DistributorAccount>(
    `SELECT clientid, clientcode, clientname, email, clienttype,
            groupid, groupname, ownerid, ownername,
            COALESCE(head_of_family, false) AS head_of_family,
            schemename, inceptiondate
       FROM pms_clients_master
      WHERE intermediaryname = $1
        AND clientcode IS NOT NULL
      ORDER BY groupid, ownerid, clientcode`,
    [DISTRIBUTOR_NAME]
  );
  return result.rows;
}

/**
 * Resolve the set of account codes a request is allowed to see.
 *
 * `requested` is an optional, caller-supplied filter (e.g. ?account_code=...).
 * We INTERSECT it with the distributor's owned codes — anything not owned is
 * silently dropped, so the filter can only ever narrow, never widen, scope.
 */
export function resolveAccountCodes(
  accounts: DistributorAccount[],
  requested?: string[] | null
): string[] {
  const owned = accounts.map((a) => a.clientcode);
  if (!requested || requested.length === 0) return owned;
  const ownedSet = new Set(owned);
  return requested.filter((c) => ownedSet.has(c));
}

/** Parse a repeatable / comma-separated ?account_code= query param. */
export function parseAccountCodeParam(request: NextRequest): string[] | null {
  const url = new URL(request.url);
  const all = url.searchParams.getAll("account_code");
  const flat = all.flatMap((v) => v.split(",")).map((v) => v.trim()).filter(Boolean);
  return flat.length ? flat : null;
}

/** Convert a stored UTC timestamp/date to its IST calendar date (YYYY-MM-DD). */
export function toISTDate(value: any): string | null {
  if (!value) return null;
  const s = String(value);
  // Plain date strings are already calendar dates.
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const d = new Date(s);
  if (isNaN(d.getTime())) return s.split("T")[0] ?? null;
  const ist = new Date(d.getTime() + 5.5 * 60 * 60 * 1000);
  return ist.toISOString().slice(0, 10);
}

export function num(value: any): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

/**
 * Document categories — mirrors the myQode "Client Document Vault" and the
 * mobile documents API. Files live in S3 under
 *   docs/client-documents/{clientid}/{folder}/
 */
export const DOC_CATEGORIES = [
  { id: "pms-agreement", label: "PMS Agreement", folder: "PMS Agreement", description: "Your official agreement with Qode." },
  { id: "account-opening", label: "Account Opening Documents", folder: "Account Opening Documents", description: "Verification of linked bank and demat accounts." },
  { id: "cml", label: "CML", folder: "CML", description: "Capital Market License and regulatory documents." },
  { id: "disclosures", label: "Disclosures", folder: "Disclosures", description: "Risk disclosures and regulatory filings." },
] as const;

export const DOC_BUCKET = "qode-static-assets";
export const DOC_SIGNED_URL_TTL = 300; // seconds

export function docCategoryByIdOrFolder(slug: string) {
  return DOC_CATEGORIES.find((c) => c.id === slug);
}

/** Find one of the distributor's accounts by code, or undefined if not owned. */
export function findOwnedAccount(
  accounts: DistributorAccount[],
  code: string
): DistributorAccount | undefined {
  return accounts.find((a) => a.clientcode === code);
}

export function extToMime(filename: string): string {
  const ext = filename.split(".").pop()?.toLowerCase() ?? "";
  const map: Record<string, string> = {
    pdf: "application/pdf",
    png: "image/png",
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    gif: "image/gif",
    webp: "image/webp",
    doc: "application/msword",
    docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    xls: "application/vnd.ms-excel",
    xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  };
  return map[ext] ?? "application/octet-stream";
}
