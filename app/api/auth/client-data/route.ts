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
      `SELECT id, clientid, clientname, clientcode, clienttype, accounttype, account_open_date, 
              inceptiondate, mobile, email, address1, address2, city, pincode, state, pannumber, 
              ownerid, ownername, groupid, groupname, schemeid, schemename, advisorname, username, 
              salutation, firstname, middlename, lastname, first_holder_gender, created_at, 
              updated_at, password, head_of_family 
       FROM pms_clients_master 
       WHERE clientcode = ANY($1::text[])`,
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
    const headOfFamilyEmail = headClient.email // Get head of family email

    // Now fetch all family members by group ID with complete data
    const familyResult = await query(
      `SELECT id, clientid, clientname, clientcode, clienttype, accounttype, account_open_date, 
              inceptiondate, mobile, email, address1, address2, city, pincode, state, pannumber, 
              ownerid, ownername, groupid, groupname, schemeid, schemename, advisorname, username, 
              salutation, firstname, middlename, lastname, first_holder_gender, created_at, 
              updated_at, password, head_of_family 
       FROM pms_clients_master 
       WHERE groupid = $1 
       ORDER BY head_of_family DESC, firstname ASC`,
      [groupId]
    )

    const familyMembers = familyResult.rows.map((member) => ({
      id: member.id,
      clientid: member.clientid,
      clientname: member.clientname,
      clientcode: member.clientcode,
      clienttype: member.clienttype,
      accounttype: member.accounttype,
      account_open_date: member.account_open_date,
      inceptiondate: member.inceptiondate,
      mobile: member.mobile,
      email: member.email,
      address1: member.address1,
      address2: member.address2,
      city: member.city,
      pincode: member.pincode,
      state: member.state,
      pannumber: member.pannumber,
      ownerid: member.ownerid,
      ownername: member.ownername,
      groupid: member.groupid,
      groupname: member.groupname,
      groupemailid: headOfFamilyEmail, // Use head of family email for all members
      schemeid: member.schemeid,
      schemename: member.schemename,
      advisorname: member.advisorname,
      username: member.username,
      salutation: member.salutation,
      firstname: member.firstname,
      middlename: member.middlename,
      lastname: member.lastname,
      first_holder_gender: member.first_holder_gender,
      created_at: member.created_at,
      updated_at: member.updated_at,
      head_of_family: member.head_of_family,
      // Computed fields for convenience
      holderName: `${member.firstname} ${member.middlename ?? ''} ${member.lastname}`.trim(),
      fullName: `${member.salutation || ''} ${member.firstname} ${member.middlename ?? ''} ${member.lastname}`.trim(),
      relation: member.head_of_family ? 'Primary' : 'Family Member',
      status: 'Active' // You can enhance this based on your business logic
    }))

    return NextResponse.json({
      success: true,
      clients: allClientDetails,
      family: familyMembers,
      familyCount: familyMembers.length,
      headOfFamily: headClient,
      groupEmailId: headOfFamilyEmail // Also return it separately for easy access
    })

  } catch (error) {
    console.error('Client data fetch error:', error)
    return NextResponse.json({ error: 'Failed to fetch client data' }, { status: 500 })
  }
}