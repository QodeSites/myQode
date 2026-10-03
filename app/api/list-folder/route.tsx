import { NextRequest, NextResponse } from 'next/server';
import {
  ListObjectsV2Command,
  GetObjectCommand,
  ListObjectsV2CommandOutput,
  _Object,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { s3 } from "@/lib/s3";
import { guardAccounts, requireWebUser } from "@/lib/webGuard";

const BUCKET = "qode-static-assets";

export interface S3FileItem {
  key: string;
  filename: string | undefined;
  section: string | undefined;
  size?: number;
  lastModified?: Date;
  url: string;
}

// Handles the GET API route for listing an S3 folder's files
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const path = searchParams.get('path');

    // Validate path param
    if (!path) {
      return NextResponse.json(
        {
          success: false,
          error: "Missing 'path' parameter.",
          error_code: "MISSING_PATH",
          timestamp: new Date().toISOString(),
        },
        { status: 400 }
      );
    }

    // Only the portal's own folders; a client's document folder only for that client (or an admin).
    const PUBLIC_PREFIXES = ['videos/reports-tutorial/', 'images/reports-snapshot/', 'docs/newsletters', 'docs/prespectives']
    const clientDoc = path.match(/^docs\/client-documents\/([^/]+)\/$/)
    if (path.includes('..') || (!clientDoc && !PUBLIC_PREFIXES.some(p => path.startsWith(p)))) {
      return NextResponse.json({ success: false, error: 'Folder not available.', error_code: 'FORBIDDEN_PATH' }, { status: 403 })
    }
    if (clientDoc) {
      const denied = await guardAccounts(request, [clientDoc[1]])
      if (denied) return denied
    } else {
      const { error } = await requireWebUser(request)
      if (error) return error
    }

    // List objects in the specified folder (S3 prefix)
    const command = new ListObjectsV2Command({
      Bucket: BUCKET,
      Prefix: path,
    });

    const response: ListObjectsV2CommandOutput = await s3.send(command);

    const files: S3FileItem[] = await Promise.all(
      (response.Contents || [])
        .filter((obj: _Object) => obj.Key && !obj.Key.endsWith("/"))
        .map(async (obj: _Object): Promise<S3FileItem> => {
          const signedUrl = await getSignedUrl(
            s3,
            new GetObjectCommand({
              Bucket: BUCKET,
              Key: obj.Key as string,
            }),
            { expiresIn: 300 }
          );
          return {
            key: obj.Key as string,
            filename: obj.Key ? obj.Key.split("/").pop() : undefined,
            section: obj.Key ? obj.Key.split("/").slice(-2, -1)[0] : undefined,
            size: obj.Size,
            lastModified: obj.LastModified,
            url: signedUrl,
          };
        })
    );

    return NextResponse.json({
      success: true,
      data: files,
      count: files.length,
      timestamp: new Date().toISOString(),
    });
  } catch (error: any) {
    console.error("[list-folder] Error:", error);
    return NextResponse.json(
      {
        success: false,
        error: error?.message || "Unknown server error",
        error_code: error?.Code || "INTERNAL_ERROR",
        timestamp: new Date().toISOString(),
      },
      { status: 500 }
    );
  }
}
