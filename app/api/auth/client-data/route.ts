import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { query } from '@/lib/db'

export async function GET() {
  try {
    const cookieStore = cookies()
    const authCookie = cookieStore.get('qode-auth')
    const clientsCookie = cookieStore.get('qode-clients')

    if (authCookie?.value !== '1') {
      return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })
    }

    let clients = []
    if (clientsCookie?.value) {
      try {
        clients = JSON.parse(clientsCookie.value)
      } catch (error) {
        console.error('Error parsing clients cookie:', error)
      }
    }

    if (!clients.length) {
      return NextResponse.json({ error: 'No client data found' }, { status: 404 })
    }

    // Get full info of all clients stored in cookie
    const clientCodes = clients.map((c: any) => c.clientcode)
    const result = await query(
      `SELECT * FROM pms_clients_master WHERE clientcode = ANY($1::text[])`,
      [clientCodes]
    )

    const allClientDetails = result.rows

    // Find head of family
    const headClient = allClientDetails.find((c) => c.head_of_family === true)

    if (!headClient) {
      return NextResponse.json({ 
        success: true,
        clients: allClientDetails,
        family: [], 
        message: 'No head of family found' 
      })
    }

    const groupId = headClient.groupid

    // Now fetch all family members by group ID
    const familyResult = await query(
      `SELECT clientid, clientcode, firstname, middlename, lastname, head_of_family FROM pms_clients_master WHERE groupid = $1`,
      [groupId]
    )

    const familyMembers = familyResult.rows.map((member) => ({
      clientid: member.clientid,
      clientcode: member.clientcode,
      holderName: `${member.firstname} ${member.middlename ?? ''} ${member.lastname}`.trim(),
      relation: member.head_of_family ? 'Primary' : 'Family Member',
      status: 'Active' // You can enhance this later
    }))

    return NextResponse.json({
      success: true,
      clients: allClientDetails,
      family: familyMembers,
    })

  } catch (error) {
    console.error('Client data fetch error:', error)
    return NextResponse.json({ error: 'Failed to fetch client data' }, { status: 500 })
  }
}
