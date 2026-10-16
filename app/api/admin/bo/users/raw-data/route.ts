// GET /api/admin/bo/users/raw-data?email= (staff): the investor's raw-data workbook (lib/rawDataWorkbook.ts) as an
// .xlsx download. Super admins may download any investor's; every other admin only the investors listed for them on
// the Admins page (admin_users.raw_data_emails). Every download is in the audit log.
import { NextRequest, NextResponse } from 'next/server'
import { requireAdmin, canDownloadRawData, audit, forbidden } from '@/lib/adminAuth'
import { normEmail } from '@/lib/adminUsers'
import { buildRawDataWorkbook } from '@/lib/rawDataWorkbook'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const { admin, error } = await requireAdmin(req, 'staff')
  if (error) return error
  const email = normEmail(req.nextUrl.searchParams.get('email'))
  if (!email) return NextResponse.json({ error: 'email is required' }, { status: 400 })
  if (!(await canDownloadRawData(admin, email))) return forbidden()
  try {
    const wb = await buildRawDataWorkbook(email)
    if (!wb) return NextResponse.json({ error: 'No investor accounts on this email' }, { status: 404 })
    await audit(req, admin!, 'user.raw_data_download', email, { file: wb.name })
    return new NextResponse(new Uint8Array(wb.file), {
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': `attachment; filename="${wb.name}"`,
        'Cache-Control': 'private, no-store',
      },
    })
  } catch (e) {
    console.error('[admin/bo/users/raw-data]', e)
    return NextResponse.json({ error: 'Could not build the raw-data workbook' }, { status: 500 })
  }
}
