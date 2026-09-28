// GET /api/mobile/notifications/prefs → { money: true, portfolio, reading, updates }
// PUT { portfolio?, reading?, updates? } → saves and returns the same shape. Money notifications cannot be turned off.
import { NextRequest, NextResponse } from 'next/server'
import { verifyMobileAuth } from '@/lib/mobileAuth'
import { query } from '@/lib/db'
import { tablesReady } from '@/lib/appNotify'

export const dynamic = 'force-dynamic'
const ALL_ON = { money: true, portfolio: true, reading: true, updates: true }

async function read(email: string) {
  const r = await query(`SELECT portfolio, reading, updates FROM app_notification_prefs WHERE email = $1`, [email])
  return r.rows[0] ? { money: true, portfolio: r.rows[0].portfolio, reading: r.rows[0].reading, updates: r.rows[0].updates } : ALL_ON
}

export async function GET(request: NextRequest) {
  const { user, error } = await verifyMobileAuth(request)
  if (error) return error
  if (user!.isReviewer || !(await tablesReady())) return NextResponse.json(ALL_ON)
  try { return NextResponse.json(await read(String(user!.email).trim().toLowerCase())) }
  catch (err) { console.error('[mobile/notifications/prefs]', err); return NextResponse.json({ error: 'Could not load' }, { status: 500 }) }
}

export async function PUT(request: NextRequest) {
  const { user, error } = await verifyMobileAuth(request)
  if (error) return error
  if (user!.isReviewer || user!.isImpersonated) return NextResponse.json({ error: 'Not available in this view' }, { status: 403 })
  if (!(await tablesReady())) return NextResponse.json({ error: 'Notifications are not set up yet' }, { status: 503 })
  let b: any = {}
  try { b = await request.json() } catch {}
  const email = String(user!.email).trim().toLowerCase()
  const cur = await read(email)
  const v = (k: 'portfolio' | 'reading' | 'updates') => (typeof b?.[k] === 'boolean' ? b[k] : cur[k])
  try {
    await query(
      `INSERT INTO app_notification_prefs (email, portfolio, reading, updates, updated_at) VALUES ($1, $2, $3, $4, NOW())
       ON CONFLICT (email) DO UPDATE SET portfolio = EXCLUDED.portfolio, reading = EXCLUDED.reading, updates = EXCLUDED.updates, updated_at = NOW()`,
      [email, v('portfolio'), v('reading'), v('updates')])
    return NextResponse.json(await read(email))
  } catch (err) { console.error('[mobile/notifications/prefs]', err); return NextResponse.json({ error: 'Could not save' }, { status: 500 }) }
}
