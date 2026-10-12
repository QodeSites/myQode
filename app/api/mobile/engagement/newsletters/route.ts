// GET /api/mobile/engagement/newsletters
// Returns list of newsletter PDFs from S3 with signed URLs, sorted newest first.
import { NextRequest, NextResponse } from 'next/server'
import { verifyMobileAuth } from '@/lib/mobileAuth'
import { s3 } from '@/lib/s3'
import { ListObjectsV2Command, GetObjectCommand } from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'

const BUCKET = 'qode-static-assets'
const PREFIX = 'docs/newsletters'
const SIGNED_URL_TTL = 300

// Parse section label like "Jan-2026" or "Sept-2025" into a sortable date
function sectionToDate(section: string): Date {
  const parts = section.split('-')
  if (parts.length === 2) {
    const parsed = new Date(`${parts[0]} 1, ${parts[1]}`)
    if (!isNaN(parsed.getTime())) return parsed
  }
  return new Date(0)
}

// April and May share one newsletter (12 Oct 2026: the April 2026 issue covers both months), so an April issue is
// titled "April & May <year>" — but only in a year without its own May issue (2025 had Apr-2025 and May-2025).
// Other issues keep their folder name ("Sep-2026"), which the apps format.
function issueTitle(section: string, sections: Set<string>): string {
  const m = String(section || '').match(/^apr(?:il)?[-\s_]?(\d{4})$/i)
  if (!m) return section
  const hasMay = [...sections].some((x) => new RegExp(`^may[-\\s_]?${m[1]}$`, 'i').test(x))
  return hasMay ? section : `April & May ${m[1]}`
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

    const sections = new Set(objects.map((o) => String(o.Key).split('/').slice(-2, -1)[0] ?? ''))
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
          title: issueTitle(section, sections) || filename.replace(/\.[^.]+$/, ''),
          filename,
          section,
          url,
          type: 'pdf' as const,
          size: obj.Size ?? 0,
          lastModified: obj.LastModified?.toISOString() ?? null,
        }
      })
    )

    // Sort newest first using the section label
    items.sort((a, b) => sectionToDate(b.section).getTime() - sectionToDate(a.section).getTime())

    return NextResponse.json({ items, count: items.length })
  } catch (err) {
    console.error('[mobile/engagement/newsletters]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
