// POST   /api/admin/bo/distributors { name, email, password, salutation?, firstName?, lastName?, feePercentage? } (super)
// DELETE /api/admin/bo/distributors?email= (super)
// A distributor is a pms_clients_master row with clientcode NULL (lib/distributorIdentity.ts).
import { NextRequest, NextResponse } from 'next/server'
import bcrypt from 'bcryptjs'
import { requireAdmin, audit } from '@/lib/adminAuth'
import { normEmail, passwordError, readJson } from '@/lib/adminUsers'
import { query } from '@/lib/db'

export async function POST(req: NextRequest) {
  const { admin, error } = await requireAdmin(req, 'super')
  if (error) return error
  const { body, error: bodyError } = await readJson(req)
  if (bodyError) return bodyError

  const name = String(body.name || '').trim()
  const email = normEmail(body.email)
  if (!name || !email) return NextResponse.json({ error: 'name and email are required' }, { status: 400 })
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return NextResponse.json({ error: 'Enter a valid email' }, { status: 400 })
  const bad = passwordError(body.password)
  if (bad) return NextResponse.json({ error: bad, code: 'WEAK_PASSWORD' }, { status: 400 })
  const fee = body.feePercentage === undefined || body.feePercentage === null || body.feePercentage === '' ? 50 : Number(body.feePercentage)
  if (!Number.isFinite(fee) || fee < 0 || fee > 100) return NextResponse.json({ error: 'feePercentage must be between 0 and 100' }, { status: 400 })

  try {
    const exists = await query(`SELECT 1 FROM pms_clients_master WHERE lower(trim(email)) = $1 LIMIT 1`, [email])
    if (exists.rows.length) return NextResponse.json({ error: 'A user with this email already exists', code: 'EMAIL_EXISTS' }, { status: 409 })

    const hash = await bcrypt.hash(body.password, 12)
    const r = await query(
      `INSERT INTO public.pms_clients_master (
          clientname, clienttype, email, username, salutation, firstname, lastname,
          created_at, password, password_set_at, head_of_family,
          onboarding_status, login_attempts, login_count,
          intermediaryname, intermediary_fee_percentage
       ) VALUES (
          $1, 'DISTRIBUTORS', $2, $1, $3, $4, $5,
          NOW(), $6, NOW(), FALSE,
          'completed', 0, 0,
          'QODE ADVISORS LLP INT', $7
       ) RETURNING id, clientname, email`,
      [name, email, String(body.salutation || 'Mr'), String(body.firstName || name), body.lastName ? String(body.lastName) : null, hash, fee],
    )
    await audit(req, admin!, 'distributor.create', email, { name, feePercentage: fee })
    return NextResponse.json({ ok: true, distributor: { id: r.rows[0].id, name: r.rows[0].clientname, email: r.rows[0].email } })
  } catch (e) {
    console.error('[admin/bo/distributors POST]', e)
    return NextResponse.json({ error: 'Could not create the partner' }, { status: 500 })
  }
}

export async function DELETE(req: NextRequest) {
  const { admin, error } = await requireAdmin(req, 'super')
  if (error) return error
  const email = normEmail(req.nextUrl.searchParams.get('email'))
  if (!email) return NextResponse.json({ error: 'email is required' }, { status: 400 })
  try {
    const r = await query(
      `DELETE FROM public.pms_clients_master WHERE lower(trim(email)) = $1 AND clientcode IS NULL RETURNING id, clientname`,
      [email],
    )
    if (!r.rowCount) return NextResponse.json({ error: 'Partner not found' }, { status: 404 })
    await audit(req, admin!, 'distributor.delete', email, { name: r.rows[0].clientname, rows: r.rowCount })
    return NextResponse.json({ ok: true })
  } catch (e) {
    console.error('[admin/bo/distributors DELETE]', e)
    return NextResponse.json({ error: 'Could not delete the partner' }, { status: 500 })
  }
}
