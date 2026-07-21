import { NextRequest, NextResponse } from 'next/server'
import { findZohoRecordUrlByEmail } from '@/lib/zoho'

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url)
  const email = searchParams.get('email')
  const accountType = searchParams.get('accountType') === 'distributor' ? 'distributor' : 'investor'

  if (!email) {
    return NextResponse.json({ error: 'email is required' }, { status: 400 })
  }

  const moduleApiName = accountType === 'distributor' ? 'Distributor' : 'Investors'

  try {
    const url = await findZohoRecordUrlByEmail(moduleApiName, email)
    if (!url) return NextResponse.json({ found: false })
    return NextResponse.json({ found: true, url })
  } catch (err: any) {
    console.error('[admin/zoho-lookup]', err)
    return NextResponse.json({ error: err?.message ?? 'Internal server error' }, { status: 500 })
  }
}
