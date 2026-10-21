// Partner app invoice details — the web's /api/distributor/invoice-profile (same validation, same table).
import { NextRequest, NextResponse } from 'next/server'
import { requireMobileDistributor } from '@/lib/mobileDistributor'
import { callWebDistributorRoute, relay } from '@/lib/mobileDistributorProxy'

export async function GET(request: NextRequest) {
  const { distributor, error } = await requireMobileDistributor(request)
  if (error) return error
  try { return relay(await callWebDistributorRoute(distributor!.email, 'invoice-profile')) }
  catch (err) { console.error('[mobile/distributor/invoice-profile GET]', err); return NextResponse.json({ error: 'Could not load your invoice details' }, { status: 502 }) }
}

export async function PUT(request: NextRequest) {
  const { distributor, error, adminBy } = await requireMobileDistributor(request)
  if (error) return error
  let body: any
  try { body = await request.json() } catch { return NextResponse.json({ error: 'Invalid request' }, { status: 400 }) }
  // An admin viewing the partner (a test run of Generate Invoice): answered as saved, but the partner's details are
  // not changed. The test invoice is built from the details the partner saved.
  if (adminBy) return NextResponse.json({ ok: true, test: true }, { headers: { 'Cache-Control': 'private, no-store' } })
  try { return relay(await callWebDistributorRoute(distributor!.email, 'invoice-profile', { method: 'PUT', body })) }
  catch (err) { console.error('[mobile/distributor/invoice-profile PUT]', err); return NextResponse.json({ error: 'Could not save your invoice details' }, { status: 502 }) }
}
