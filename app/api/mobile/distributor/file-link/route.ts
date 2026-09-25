// POST /api/mobile/distributor/file-link   { kind: 'soa', email } | { kind: 'deck', slug }
// Returns a 5-minute signed URL the app opens in the phone's PDF viewer (see fileLink in lib/mobileDistributor).
// Same checks as the web routes: partner role, and for a statement, the investor must be in this partner's book
// (web: app/api/distributor/investor-soa). Unknown investors and "no statement" answer alike, as on the web.
import { NextRequest, NextResponse } from 'next/server'
import { requireMobileDistributor, fileLink, investorInBook } from '@/lib/mobileDistributor'
import { documentBySlug } from '@/lib/distributorDocuments'
import { findSoaForInvestor } from '@/lib/zohoInvestorSoa'

export async function POST(request: NextRequest) {
  const { distributor, error } = await requireMobileDistributor(request)
  if (error) return error
  let body: any
  try { body = await request.json() } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }
  try {
    if (body?.kind === 'deck') {
      const doc = documentBySlug(String(body.slug || ''))
      if (!doc) return NextResponse.json({ error: 'No such document' }, { status: 404 })
      return NextResponse.json({ url: fileLink(distributor!.email, 'deck', doc.slug), fileName: doc.downloadName })
    }
    if (body?.kind === 'soa') {
      const email = String(body.email || '').trim().toLowerCase()
      if (!email) return NextResponse.json({ error: 'Missing investor' }, { status: 400 })
      if (!(await investorInBook(distributor!, email))) return NextResponse.json({ error: 'No statement available' }, { status: 404 })
      const soa = await findSoaForInvestor(email)
      if (!soa) return NextResponse.json({ error: 'No statement available' }, { status: 404 })
      return NextResponse.json({ url: fileLink(distributor!.email, 'soa', email), fileName: soa.fileName })
    }
    return NextResponse.json({ error: 'kind must be soa or deck' }, { status: 400 })
  } catch (err) {
    console.error('[mobile/distributor/file-link]', err)
    return NextResponse.json({ error: 'Could not prepare that file' }, { status: 500 })
  }
}
