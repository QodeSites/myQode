// GET /api/mobile/experience/relationship-manager
// The signed-in investor's Relationship Manager: the owner of their record in the Zoho CRM Investors module, looked
// up by the investor's email (lib/zohoInvestorDetails.ts getInvestorRm). { name, phone, email } (each may be null). Shown on the
// profile (web /app/account, phone More). Nuvama's advisor name (pms_clients_master.advisorname) is not used: it is
// the firm ("Qode Advisors Llp Adv") on every account, not a person.
import { NextRequest, NextResponse } from 'next/server'
import { verifyMobileAuth } from '@/lib/mobileAuth'
import { getInvestorRm } from '@/lib/zohoInvestorDetails'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  const { user, error } = await verifyMobileAuth(request)
  if (error) return error
  if (user!.isReviewer || user!.isDistributor || !user!.email) return NextResponse.json({ name: null, phone: null, email: null })
  try {
    return NextResponse.json(await getInvestorRm(user!.email))
  } catch (e) {
    console.error('[mobile/experience/relationship-manager]', e)
    return NextResponse.json({ name: null, phone: null, email: null })
  }
}
