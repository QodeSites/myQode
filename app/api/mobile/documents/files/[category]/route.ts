// GET /api/mobile/documents/files/[category]?accountId=QAW0009
// Returns signed S3 URLs for all files in the given document category.
import { NextRequest, NextResponse } from 'next/server'
import { verifyMobileAuth } from '@/lib/mobileAuth'
import { s3 } from '@/lib/s3'
import { query } from '@/lib/db'
import { ListObjectsV2Command, GetObjectCommand } from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'

const BUCKET = 'qode-static-assets'
const SIGNED_URL_TTL = 300 // seconds

// Valid category slugs → maps to the actual S3 folder name used in the browser vault
const CATEGORY_TO_FOLDER: Record<string, string> = {
  'pms-agreement': 'PMS Agreement',
  'account-opening': 'Account Opening Documents',
  'cml': 'CML',
  'disclosures': 'Disclosures',
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ category: string }> }
) {
  const { user, error } = await verifyMobileAuth(request)
  if (error) return error

  const { searchParams } = new URL(request.url)
  const accountId = searchParams.get('accountId') ?? user!.accountCodes?.[0]
  const { category } = await params

  const folderName = CATEGORY_TO_FOLDER[category]
  if (!folderName) {
    return NextResponse.json({ error: 'Invalid category' }, { status: 400 })
  }

  if (!accountId) {
    return NextResponse.json({ error: 'accountId is required', available: user!.accountCodes }, { status: 400 })
  }

  if (!user!.accountCodes?.includes(accountId)) {
    return NextResponse.json({ error: 'Forbidden', available: user!.accountCodes }, { status: 403 })
  }

  // clientcode (e.g. QAW0009) ≠ clientid; S3 folders are keyed by clientid
  const clientRes = await query(
    'SELECT clientid FROM pms_clients_master WHERE clientcode = $1 LIMIT 1',
    [accountId]
  )
  if (!clientRes.rows.length) {
    return NextResponse.json({ error: 'Account not found' }, { status: 404 })
  }
  const clientId = clientRes.rows[0].clientid

  const prefix = `docs/client-documents/${clientId}/${folderName}/`

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
