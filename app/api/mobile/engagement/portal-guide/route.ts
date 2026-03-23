// GET /api/mobile/engagement/portal-guide
// Returns video tutorials and report snapshot images from S3 for the investor portal guide.
import { NextRequest, NextResponse } from 'next/server'
import { verifyMobileAuth } from '@/lib/mobileAuth'
import { s3 } from '@/lib/s3'
import { ListObjectsV2Command, GetObjectCommand } from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'

const BUCKET = 'qode-static-assets'
const SIGNED_URL_TTL = 300

const IMAGE_EXTS = new Set(['png', 'jpg', 'jpeg', 'webp', 'gif'])
const VIDEO_EXTS = new Set(['mp4', 'mov', 'avi', 'webm'])

async function listSigned(prefix: string) {
  const res = await s3.send(new ListObjectsV2Command({ Bucket: BUCKET, Prefix: prefix }))
  const objects = (res.Contents || []).filter((o) => o.Key && !o.Key.endsWith('/'))

  return Promise.all(
    objects.map(async (obj) => {
      const key = obj.Key as string
      const url = await getSignedUrl(
        s3,
        new GetObjectCommand({ Bucket: BUCKET, Key: key }),
        { expiresIn: SIGNED_URL_TTL }
      )
      const filename = key.split('/').pop() ?? key
      const ext = filename.split('.').pop()?.toLowerCase() ?? ''
      const section = key.split('/').slice(-2, -1)[0] ?? ''
      return { key, filename, section, url, ext, size: obj.Size ?? 0 }
    })
  )
}

export async function GET(request: NextRequest) {
  const { error } = await verifyMobileAuth(request)
  if (error) return error

  try {
    const [videoFiles, imageFiles] = await Promise.all([
      listSigned('videos/reports-tutorial/'),
      listSigned('images/reports-snapshot/'),
    ])

    const videos = videoFiles
      .filter((f) => VIDEO_EXTS.has(f.ext))
      .map((f) => ({ key: f.key, filename: f.filename, reportName: f.section, url: f.url, size: f.size }))

    const snapshots = imageFiles
      .filter((f) => IMAGE_EXTS.has(f.ext))
      .map((f) => ({ key: f.key, filename: f.filename, reportName: f.section, url: f.url, size: f.size }))

    // Group snapshots by reportName for easy lookup
    const snapshotsByReport: Record<string, typeof snapshots> = {}
    snapshots.forEach((s) => {
      if (!snapshotsByReport[s.reportName]) snapshotsByReport[s.reportName] = []
      snapshotsByReport[s.reportName].push(s)
    })

    const videosByReport: Record<string, typeof videos> = {}
    videos.forEach((v) => {
      if (!videosByReport[v.reportName]) videosByReport[v.reportName] = []
      videosByReport[v.reportName].push(v)
    })

    return NextResponse.json({
      videos,
      snapshots,
      byReport: {
        snapshots: snapshotsByReport,
        videos: videosByReport,
      },
      counts: { videos: videos.length, snapshots: snapshots.length },
    })
  } catch (err) {
    console.error('[mobile/engagement/portal-guide]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
