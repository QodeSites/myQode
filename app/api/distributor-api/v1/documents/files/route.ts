import { NextRequest, NextResponse } from "next/server";
import { ListObjectsV2Command, GetObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { s3 } from "@/lib/s3";
import {
  authenticateDistributor,
  getDistributorAccounts,
  findOwnedAccount,
  docCategoryByIdOrFolder,
  extToMime,
  DISTRIBUTOR_NAME,
  DOC_CATEGORIES,
  DOC_BUCKET,
  DOC_SIGNED_URL_TTL,
} from "@/lib/distributorApi";

export const dynamic = "force-dynamic";

/**
 * GET /api/distributor-api/v1/documents/files?account_code=QAW00098&category=pms-agreement
 *
 * Returns short-lived (5 min) signed S3 URLs for every file in the given
 * document category of one of the distributor's accounts. The account_code
 * must belong to the distributor, and category must be one of DOC_CATEGORIES.
 */
export async function GET(request: NextRequest) {
  const authError = authenticateDistributor(request);
  if (authError) return authError;

  try {
    const url = new URL(request.url);
    const accountCode = url.searchParams.get("account_code")?.trim();
    const category = url.searchParams.get("category")?.trim() ?? "";

    if (!accountCode) {
      return NextResponse.json(
        { error: "account_code is required", code: "MISSING_ACCOUNT_CODE" },
        { status: 400 }
      );
    }

    const cat = docCategoryByIdOrFolder(category);
    if (!cat) {
      return NextResponse.json(
        {
          error: "Invalid category",
          code: "INVALID_CATEGORY",
          valid_categories: DOC_CATEGORIES.map((c) => c.id),
        },
        { status: 400 }
      );
    }

    const accounts = await getDistributorAccounts();
    const account = findOwnedAccount(accounts, accountCode);
    if (!account) {
      // Not owned by this distributor — treat as not found, never leak existence.
      return NextResponse.json(
        { error: "Account not found", code: "ACCOUNT_NOT_FOUND" },
        { status: 404 }
      );
    }
    if (!account.clientid) {
      return NextResponse.json({
        distributor: DISTRIBUTOR_NAME,
        account_code: accountCode,
        category: cat.id,
        files: [],
      });
    }

    const prefix = `docs/client-documents/${account.clientid}/${cat.folder}/`;
    const listRes = await s3.send(
      new ListObjectsV2Command({ Bucket: DOC_BUCKET, Prefix: prefix })
    );
    const objects = (listRes.Contents || []).filter(
      (o) => o.Key && !o.Key.endsWith("/")
    );

    const files = await Promise.all(
      objects.map(async (obj) => {
        const key = obj.Key as string;
        const signedUrl = await getSignedUrl(
          s3,
          new GetObjectCommand({ Bucket: DOC_BUCKET, Key: key }),
          { expiresIn: DOC_SIGNED_URL_TTL }
        );
        const filename = key.split("/").pop() ?? key;
        return {
          filename,
          size: obj.Size ?? 0,
          lastModified: obj.LastModified?.toISOString() ?? null,
          url: signedUrl,
          url_expires_in: DOC_SIGNED_URL_TTL,
          mimeType: extToMime(filename),
        };
      })
    );

    return NextResponse.json({
      distributor: DISTRIBUTOR_NAME,
      account_code: accountCode,
      category: cat.id,
      files,
    });
  } catch (error) {
    console.error("[distributor-api/documents/files] error:", error);
    return NextResponse.json(
      { error: "Internal server error", code: "INTERNAL_ERROR" },
      { status: 500 }
    );
  }
}
