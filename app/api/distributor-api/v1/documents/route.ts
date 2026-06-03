import { NextRequest, NextResponse } from "next/server";
import { ListObjectsV2Command } from "@aws-sdk/client-s3";
import { s3 } from "@/lib/s3";
import {
  authenticateDistributor,
  getDistributorAccounts,
  parseAccountCodeParam,
  resolveAccountCodes,
  DISTRIBUTOR_NAME,
  DOC_CATEGORIES,
  DOC_BUCKET,
} from "@/lib/distributorApi";

export const dynamic = "force-dynamic";

/**
 * GET /api/distributor-api/v1/documents
 *
 * Lists document categories + per-category file counts for each of the
 * distributor's investor accounts. Optional ?account_code= narrows the result.
 * Files themselves (signed URLs) are fetched via /documents/files.
 *
 * Documents are scoped to the distributor's own investors: account codes come
 * from getDistributorAccounts(), and S3 folders are keyed by the account's
 * clientid — a caller can never reach another distributor's documents.
 */
export async function GET(request: NextRequest) {
  const authError = authenticateDistributor(request);
  if (authError) return authError;

  try {
    const accounts = await getDistributorAccounts();
    const requested = parseAccountCodeParam(request);
    const codes = new Set(resolveAccountCodes(accounts, requested));
    const scoped = accounts.filter((a) => codes.has(a.clientcode));

    const result = await Promise.all(
      scoped.map(async (acct) => {
        const categories = await Promise.all(
          DOC_CATEGORIES.map(async (cat) => {
            let fileCount = 0;
            if (acct.clientid) {
              try {
                const res = await s3.send(
                  new ListObjectsV2Command({
                    Bucket: DOC_BUCKET,
                    Prefix: `docs/client-documents/${acct.clientid}/${cat.folder}/`,
                  })
                );
                fileCount = (res.Contents || []).filter(
                  (o) => o.Key && !o.Key.endsWith("/")
                ).length;
              } catch {
                // prefix may not exist yet
              }
            }
            return {
              id: cat.id,
              label: cat.label,
              description: cat.description,
              fileCount,
            };
          })
        );

        return {
          account_code: acct.clientcode,
          client_name: acct.clientname,
          categories,
        };
      })
    );

    return NextResponse.json({ distributor: DISTRIBUTOR_NAME, accounts: result });
  } catch (error) {
    console.error("[distributor-api/documents] error:", error);
    return NextResponse.json(
      { error: "Internal server error", code: "INTERNAL_ERROR" },
      { status: 500 }
    );
  }
}
