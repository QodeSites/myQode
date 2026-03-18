// GET /api/mobile/services/bank-details
// Returns the static Qode Advisors LLP bank details for fund transfers.
// Auth required so the endpoint is not publicly accessible.
import { NextRequest, NextResponse } from 'next/server'
import { verifyMobileAuth } from '@/lib/mobileAuth'

export async function GET(request: NextRequest) {
  const { error } = await verifyMobileAuth(request)
  if (error) return error

  const details = {
    payableTo: 'Qode Advisors LLP',
    accountNumber: '43377275922',
    bank: 'SBI Bank – Corporate Account Group Branch',
    ifsc: 'SBIN0009995',
    micr: '40000213',
    copyText:
      'Payable to: Qode Advisors LLP\nAccount Number: 43377275922\nBank: SBI Bank\nIFSC: SBIN0009995',
  }

  return NextResponse.json(details)
}
