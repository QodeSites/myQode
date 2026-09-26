// POST /api/mobile/distributor/view-account
// The partner app's "View account": opens one of the distributor's own investors in the investor app, as the web's
// investors page does ("View account" / "View their portfolio" → /api/admin/dashboard action=impersonate).
//
// Same account set as the web's impersonate action (head of family → the whole group, otherwise the owner's
// accounts), with two additions the web route does not have:
//   - the investor must be in THIS partner's book: a pms_clients_master row with this clientcode, intermediaryname =
//     the partner's clientname, and an email Zoho attributes to the partner — the same rule that decides whether
//     the web shows the button at all (journey route: codeByEmail scoped by intermediaryname);
//   - the token is read-only (viewOnly): lib/mobileAuth rejects every non-GET request made with it, so a partner
//     can look at the portfolio but never place an order, a request or a payment on the investor's behalf.
//
// Body: { clientCode: string }
// Returns: { token, expiresIn, user } — same shape as /api/mobile/admin/impersonate
import { NextRequest, NextResponse } from 'next/server'
import jwt from 'jsonwebtoken'
import type { MobileAuthUser } from '@/lib/mobileAuth'
import { requireMobileDistributor } from '@/lib/mobileDistributor'
import { getJourneyForDistributor } from '@/lib/zohoDistributorJourney'
import { query } from '@/lib/db'

const TTL_SECONDS = 60 * 60 * 2

export async function POST(request: NextRequest) {
  const { distributor, error } = await requireMobileDistributor(request)
  if (error) return error

  let body: any
  try { body = await request.json() } catch { return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 }) }
  const clientCode = String(body?.clientCode ?? '').trim()
  if (!clientCode) return NextResponse.json({ error: 'clientCode is required' }, { status: 400 })

  try {
    let journey: Awaited<ReturnType<typeof getJourneyForDistributor>> = null
    try { journey = await getJourneyForDistributor(distributor!.email) } catch (err) {
      console.error('[mobile/distributor/view-account] Zoho lookup failed:', err)
      return NextResponse.json({ error: 'We couldn’t confirm this investor just now. Please try again in a few minutes.' }, { status: 503 })
    }
    const ownEmails = [...new Set((journey?.clients ?? []).map((c) => String(c.email ?? '').trim().toLowerCase()).filter(Boolean))]
    if (!ownEmails.length) return NextResponse.json({ error: 'This investor is not in your book.' }, { status: 403 })

    const clientResult = await query(
      `SELECT clientid, clientcode, email, groupid, head_of_family, ownerid,
              salutation, firstname, middlename, lastname, onboarding_status
         FROM pms_clients_master
        WHERE clientcode = $1
          AND intermediaryname = $2
          AND lower(btrim(email)) = ANY($3)
        LIMIT 1`,
      [clientCode, distributor!.clientname, ownEmails],
    )
    if (clientResult.rows.length === 0) return NextResponse.json({ error: 'This investor is not in your book.' }, { status: 403 })
    const target = clientResult.rows[0]

    // Same account set as the web's impersonate action and the mobile admin impersonation.
    const accountsResult = target.head_of_family
      ? await query(
          `SELECT clientid, clientcode, ownerid FROM pms_clients_master
            WHERE groupid = $1 AND (maturity_date IS NULL OR maturity_date > NOW())`,
          [target.groupid],
        )
      : await query(
          `SELECT clientid, clientcode, ownerid FROM pms_clients_master
            WHERE ownerid = $1 AND (maturity_date IS NULL OR maturity_date > NOW())`,
          [target.ownerid],
        )
    const accounts = accountsResult.rows
    const individualCodes: string[] = accounts.map((r: any) => r.clientcode).filter(Boolean)
    const uniqueOwnerIds: string[] = [...new Set(accounts.map((r: any) => r.ownerid).filter(Boolean))] as string[]
    const groupCode: string[] = target.head_of_family && target.groupid ? [target.groupid] : []
    const accountCodes: string[] = [...individualCodes, ...uniqueOwnerIds, ...groupCode]

    const clientName = [target.salutation, target.firstname, target.middlename, target.lastname]
      .filter(Boolean).join(' ').replace(/\s+/g, ' ').trim()

    const payload: MobileAuthUser = {
      userId: target.clientid,
      email: target.email,
      clientCode: target.clientcode,
      clientId: target.clientid,
      accountCodes,
      ownerIds: [target.ownerid || target.clientid],
      groupId: target.groupid,
      isHeadOfFamily: target.head_of_family,
      isImpersonated: true,          // no refresh, no admin or partner routes with this token
      impersonatedBy: distributor!.email,
      viewOnly: true,
      viewedByDistributor: true,
    }
    const token = jwt.sign(payload, process.env.JWT_SECRET!, { expiresIn: TTL_SECONDS })

    return NextResponse.json({
      token,
      expiresIn: TTL_SECONDS,
      user: {
        clientId: target.clientid,
        clientCode: target.clientcode,
        name: clientName,
        email: target.email,
        accountCodes,
        isHeadOfFamily: target.head_of_family,
        isImpersonated: true,
        impersonatedBy: distributor!.email,
        viewOnly: true,
        viewedByDistributor: true,
        onboardingStatus: target.onboarding_status,
      },
    }, { headers: { 'Cache-Control': 'private, no-store' } })
  } catch (err) {
    console.error('[mobile/distributor/view-account]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
