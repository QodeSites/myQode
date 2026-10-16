// GET /api/request-types — the request types a client can choose on the support form (16 Oct 2026), from the Zoho
// Desk custom module cm_request_types: active and not staff-only, each { id, code, name, category }. Cached for 10
// minutes in lib/zohoDesk.ts, so the form's loads cost Zoho at most one listing in that time. Public: it is the
// form's menu, nothing about any client.
import { NextResponse } from 'next/server'
import { listRequestTypes, deskConfigured } from '@/lib/zohoDesk'

export async function GET() {
  if (!deskConfigured()) return NextResponse.json({ types: [] })
  try {
    const types = await listRequestTypes()
    return NextResponse.json({ types }, { headers: { 'Cache-Control': 'private, max-age=600' } })
  } catch (err: any) {
    console.error('[api/request-types]', err?.message)
    return NextResponse.json({ error: 'Could not load the request types just now.' }, { status: 502 })
  }
}
