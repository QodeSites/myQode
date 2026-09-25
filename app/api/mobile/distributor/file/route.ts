// GET /api/mobile/distributor/file?d&kind&key&exp&t — serves a statement or deck PDF for a signed link from
// /api/mobile/distributor/file-link. No Authorization header (the phone's viewer opens it); the signature binds the
// partner, the file and a 5-minute expiry. The partner role is re-checked here too.
import { NextRequest, NextResponse } from 'next/server'
import path from 'path'
import { readFile } from 'fs/promises'
import { verifyFileLink } from '@/lib/mobileDistributor'
import { resolveDistributorByEmail } from '@/lib/distributorIdentity'
import { documentBySlug } from '@/lib/distributorDocuments'
import { findSoaForInvestor, downloadSoa } from '@/lib/zohoInvestorSoa'

const pdf = (body: ArrayBuffer | Buffer, name: string) =>
  new NextResponse(body as any, {
    headers: {
      'Content-Type': 'application/pdf',
      // inline: open in the viewer, which offers save/share itself
      'Content-Disposition': `inline; filename="${name.replace(/"/g, '')}"`,
      'Cache-Control': 'private, no-store',
    },
  })

export async function GET(request: NextRequest) {
  const q = new URL(request.url).searchParams
  const d = q.get('d') || '', kind = q.get('kind') || '', key = q.get('key') || ''
  if (!verifyFileLink(d, kind, key, Number(q.get('exp')), q.get('t') || '')) {
    return NextResponse.json({ error: 'This link has expired. Please tap Download again in the app.' }, { status: 403 })
  }
  try {
    if (!(await resolveDistributorByEmail(d))) return NextResponse.json({ error: 'Not a distributor' }, { status: 403 })
    if (kind === 'deck') {
      const doc = documentBySlug(key)
      if (!doc) return NextResponse.json({ error: 'No such document' }, { status: 404 })
      const buf = await readFile(path.join(process.cwd(), 'assets', 'documents', `${doc.slug}.pdf`)).catch(() => null)
      if (!buf) return NextResponse.json({ error: 'That document is unavailable just now' }, { status: 404 })
      return pdf(buf, doc.downloadName)
    }
    const soa = await findSoaForInvestor(key)
    const file = soa ? await downloadSoa(soa.recordId, soa.attachmentId) : null
    if (!file) return NextResponse.json({ error: 'No statement available' }, { status: 404 })
    return pdf(file.body, file.fileName)
  } catch (err) {
    console.error('[mobile/distributor/file]', err)
    return NextResponse.json({ error: 'Could not fetch that file' }, { status: 500 })
  }
}
