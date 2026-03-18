// GET /api/mobile/documents/files/[category]?accountId=QFH0008
// Returns signed S3 URLs for all files in the given document category.
import { NextRequest, NextResponse } from 'next/server'
import { verifyMobileAuth } from '@/lib/mobileAuth'
import { s3 } from '@/lib/s3'
import { ListObjectsV2Command, GetObjectCommand } from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'

const BUCKET = 'qode-static-assets'
const SIGNED_URL_TTL = 300 // seconds

// Valid category slugs – prevents path traversal
const VALID_CATEGORIES = new Set(['pms-agreement', 'account-opening', 'cml', 'disclosures'])

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ category: string }> }
) {
  const { user, error } = await verifyMobileAuth(request)
  if (error) return error

  const { searchParams } = new URL(request.url)
  const accountId = searchParams.get('accountId') ?? user!.accountCodes?.[0]
  const { category } = await params

  if (!VALID_CATEGORIES.has(category)) {
    return NextResponse.json({ error: 'Invalid category' }, { status: 400 })
  }

  if (!accountId) {
    return NextResponse.json({ error: 'accountId is required', available: user!.accountCodes }, { status: 400 })
  }

  if (!user!.accountCodes?.includes(accountId)) {
    return NextResponse.json({ error: 'Forbidden', available: user!.accountCodes }, { status: 403 })
  }

  const prefix = `documents/${accountId}/${category}/`

  try {
    const listRes = await s3.send(
      new ListObjectsV2Command({ Bucket: BUCKET, Prefix: prefix })
    )

    const objects = (listRes.Contents || []).filter(
      (o) => o.Key && !o.Key.endsWith('/')
    )

    const files = await Promise.all(
      objects.map(async (obj) => {
        const key = obj.Key as string
        const url = await getSignedUrl(
          s3,
          new GetObjectCommand({ Bucket: BUCKET, Key: key }),
          { expiresIn: SIGNED_URL_TTL }
        )
        const filename = key.split('/').pop() ?? key
        const ext = filename.split('.').pop()?.toLowerCase() ?? ''
        return {
          key,
          filename,
          size: obj.Size ?? 0,
          lastModified: obj.LastModified?.toISOString() ?? null,
          url,
          mimeType: extToMime(ext),
        }
      })
    )

    return NextResponse.json({ category, accountId, files })
  } catch (err) {
    console.error('[mobile/documents/files]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

function extToMime(ext: string): string {
  const map: Record<string, string> = {
    pdf: 'application/pdf',
    png: 'image/png',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    gif: 'image/gif',
    webp: 'image/webp',
    doc: 'application/msword',
    docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    xls: 'application/vnd.ms-excel',
    xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  }
  return map[ext] ?? 'application/octet-stream'
}
