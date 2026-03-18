// GET /api/mobile/documents/list?accountId=QFH0008
// Returns document category metadata + per-category file counts from S3.
import { NextRequest, NextResponse } from 'next/server'
import { verifyMobileAuth } from '@/lib/mobileAuth'
import { s3 } from '@/lib/s3'
import { ListObjectsV2Command } from '@aws-sdk/client-s3'

const BUCKET = 'qode-static-assets'

const CATEGORIES = [
  {
    id: 'pms-agreement',
    label: 'PMS Agreement',
    description: 'Your official agreement with Qode.',
    s3Prefix: (accountId: string) => `documents/${accountId}/pms-agreement/`,
  },
  {
    id: 'account-opening',
    label: 'Account Opening Documents',
    description: 'Verification of linked bank and demat accounts.',
    s3Prefix: (accountId: string) => `documents/${accountId}/account-opening/`,
  },
  {
    id: 'cml',
    label: 'CML',
    description: 'Capital Market License and regulatory documents.',
    s3Prefix: (accountId: string) => `documents/${accountId}/cml/`,
  },
  {
    id: 'disclosures',
    label: 'Disclosures',
    description: 'Risk disclosures and regulatory filings.',
    s3Prefix: (accountId: string) => `documents/${accountId}/disclosures/`,
  },
]

export async function GET(request: NextRequest) {
  const { user, error } = await verifyMobileAuth(request)
  if (error) return error

  const { searchParams } = new URL(request.url)
  const accountId = searchParams.get('accountId') ?? user!.accountCodes?.[0]

  if (!accountId) {
    return NextResponse.json({ error: 'accountId is required', available: user!.accountCodes }, { status: 400 })
  }

  if (!user!.accountCodes?.includes(accountId)) {
    return NextResponse.json({ error: 'Forbidden', available: user!.accountCodes }, { status: 403 })
  }

  try {
    const categories = await Promise.all(
      CATEGORIES.map(async (cat) => {
        let fileCount = 0
        try {
          const res = await s3.send(
            new ListObjectsV2Command({ Bucket: BUCKET, Prefix: cat.s3Prefix(accountId) })
          )
          fileCount = (res.Contents || []).filter((o) => o.Key && !o.Key.endsWith('/')).length
        } catch {
          // S3 prefix may not exist yet
        }
        return { id: cat.id, label: cat.label, description: cat.description, fileCount }
      })
    )

    return NextResponse.json({ categories })
  } catch (err) {
    console.error('[mobile/documents/list]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
