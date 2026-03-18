// GET /api/mobile/engagement/perspectives
// Returns list of perspective PDFs from S3 with signed URLs, sorted newest first.
// Note: S3 prefix uses the original typo "prespectives" to match existing uploads.
import { NextRequest, NextResponse } from 'next/server'
import { verifyMobileAuth } from '@/lib/mobileAuth'
import { s3 } from '@/lib/s3'
import { ListObjectsV2Command, GetObjectCommand } from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'

const BUCKET = 'qode-static-assets'
const PREFIX = 'docs/prespectives' // matches existing S3 folder (original typo)
const SIGNED_URL_TTL = 300

function sectionToDate(section: string): Date {
  const parts = section.split('-')
  if (parts.length === 2) {
    const parsed = new Date(`${parts[0]} 1, ${parts[1]}`)
    if (!isNaN(parsed.getTime())) return parsed
  }
  return new Date(0)
}

export async function GET(request: NextRequest) {
  const { error } = await verifyMobileAuth(request)
  if (error) return error

  try {
    const listRes = await s3.send(
      new ListObjectsV2Command({ Bucket: BUCKET, Prefix: PREFIX })
    )

    const objects = (listRes.Contents || []).filter(
      (o) => o.Key && !o.Key.endsWith('/')
    )

    const items = await Promise.all(
      objects.map(async (obj) => {
        const key = obj.Key as string
        const url = await getSignedUrl(
          s3,
          new GetObjectCommand({ Bucket: BUCKET, Key: key }),
          { expiresIn: SIGNED_URL_TTL }
        )
        const filename = key.split('/').pop() ?? key
        const section = key.split('/').slice(-2, -1)[0] ?? ''
        return {
          key,
          title: section || filename.replace(/\.[^.]+$/, ''),
          filename,
          section,
          url,
          type: 'pdf' as const,
          size: obj.Size ?? 0,
          lastModified: obj.LastModified?.toISOString() ?? null,
        }
      })
    )

    items.sort((a, b) => sectionToDate(b.section).getTime() - sectionToDate(a.section).getTime())

    return NextResponse.json({ items, count: items.length })
  } catch (err) {
    console.error('[mobile/engagement/perspectives]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
