// Statement-of-account PDFs, from the Zoho Investors module.
//
// SOA_Reports is a `fileupload` field. It does NOT come back through COQL —
// only a v2 record read or search returns it — which is why this module uses
// the REST API rather than the COQL helper the other Zoho modules share.
//
// Verified 2026-09-01: 102 of 418 investors carry a PDF; 316 do not. An
// investor without one is the ordinary case, so every function here returns
// null rather than throwing when nothing is attached.
import { zohoApiDomain, zohoFetch } from "@/lib/zoho";

export type SoaFile = {
  fileName: string;
  attachmentId: string;
  recordId: string;
  /** Zoho's own human-readable size, e.g. "115.42 KB". */
  sizeLabel: string;
};

/**
 * The most recent SOA for an investor, or null when they have none.
 *
 * SECURITY: this function performs NO ownership check. The caller must first
 * confirm the investor belongs to the requesting distributor — see
 * app/api/distributor/investor-soa/route.ts. Called with an arbitrary email,
 * it will happily return any investor's statement.
 */
export async function findSoaForInvestor(email: string): Promise<SoaFile | null> {
  const key = String(email ?? "").trim().toLowerCase();
  if (!key) return null;

  const res = await zohoFetch(
    `${zohoApiDomain()}/crm/v2/Investors/search?email=${encodeURIComponent(key)}&fields=Name,Email,SOA_Reports`,
  );

  // 204 means no matching investor — a normal answer, not a failure.
  if (res.status === 204) return null;
  if (!res.ok) {
    throw new Error(`Zoho SOA lookup failed: ${res.status}`);
  }

  const body = (await res.json()) as { data?: any[] };
  const record = body.data?.[0];
  if (!record?.id) return null;

  const files = Array.isArray(record.SOA_Reports) ? record.SOA_Reports : [];
  if (!files.length) return null;

  // Zoho returns these oldest-first; the newest statement is the useful one.
  const file = files[files.length - 1];
  if (!file?.attachment_Id) return null;

  return {
    fileName: String(file.file_Name ?? "statement.pdf"),
    attachmentId: String(file.attachment_Id),
    recordId: String(record.id),
    sizeLabel: String(file.file_Size ?? ""),
  };
}

/**
 * Fetches the PDF bytes.
 *
 * The endpoint takes the RECORD id and the ATTACHMENT id. Verified
 * 2026-09-01 against a live record: this combination returns a 115KB PDF,
 * while `entity_Id` gives INVALID_DATA and `file_Id` gives
 * UNABLE_TO_PARSE_DATA_TYPE. Both alternatives were tried; neither works.
 */
export async function downloadSoa(
  recordId: string,
  attachmentId: string,
): Promise<{ body: ArrayBuffer; fileName: string } | null> {
  const res = await zohoFetch(
    `${zohoApiDomain()}/crm/v2/Investors/${encodeURIComponent(recordId)}/actions/download_fields_attachment?fields_attachment_id=${encodeURIComponent(attachmentId)}`,
  );

  if (!res.ok) return null;

  // Zoho reports some failures as JSON with HTTP 200, so check the type
  // rather than trusting the status alone.
  const contentType = res.headers.get("content-type") ?? "";
  if (contentType.includes("application/json")) return null;

  const disposition = res.headers.get("content-disposition") ?? "";
  const match = disposition.match(/filename="?([^";]+)"?/i);

  return {
    body: await res.arrayBuffer(),
    fileName: match?.[1] ?? "statement.pdf",
  };
}
