// Partner app invoices — the web's /api/distributor/invoice-issue (records the number; 409 on a duplicate).
import { NextRequest, NextResponse } from 'next/server'
import { requireMobileDistributor } from '@/lib/mobileDistributor'
import { callWebDistributorRoute, relay } from '@/lib/mobileDistributorProxy'

export async function GET(request: NextRequest) {
  const { distributor, error } = await requireMobileDistributor(request)
  if (error) return error
  try { return relay(await callWebDistributorRoute(distributor!.email, 'invoice-issue')) }
  catch (err) { console.error('[mobile/distributor/invoice-issue GET]', err); return NextResponse.json({ error: 'Could not load your invoice history' }, { status: 502 }) }
}

export async function POST(request: NextRequest) {
  const { distributor, error } = await requireMobileDistributor(request)
  if (error) return error
  let body: any
  try { body = await request.json() } catch { return NextResponse.json({ error: 'Invalid request' }, { status: 400 }) }
  try { return relay(await callWebDistributorRoute(distributor!.email, 'invoice-issue', { method: 'POST', body })) }
  catch (err) { console.error('[mobile/distributor/invoice-issue POST]', err); return NextResponse.json({ error: 'Could not record the invoice' }, { status: 502 }) }
}
