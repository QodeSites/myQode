import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { query } from '@/lib/db';

interface ClientData {
  clientid: string;
  clientcode: string;
}

export async function GET() {
  try {
    const cookieStore = cookies();
    const authCookie = cookieStore.get('qode-auth');
    const clientsCookie = cookieStore.get('qode-clients');

    if (authCookie?.value !== '1') {
      return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
    }

    let clients: ClientData[] = [];
    if (clientsCookie?.value) {
      try {
        clients = JSON.parse(clientsCookie.value);
      } catch (error) {
        console.error('Error parsing clients cookie:', error);
        return NextResponse.json({ error: 'Invalid client data in session' }, { status: 400 });
      }
    }

    if (!clients.length) {
      return NextResponse.json({ error: 'No client data found' }, { status: 404 });
    }

    // Get full info of all clients stored in cookie
    const clientCodes = clients.map((c) => c.clientcode);
    const result = await query(
      `SELECT id, clientid, clientname, clientcode, clienttype, accounttype, account_open_date, 
              inceptiondate, mobile, email, address1, address2, city, pincode, state, pannumber, 
              ownerid, ownername, groupid, groupname, schemeid, schemename, advisorname, username, 
              salutation, firstname, middlename, lastname, first_holder_gender, created_at, 
              updated_at, password, head_of_family 
       FROM pms_clients_master 
       WHERE clientcode = ANY($1::text[])`,
      [clientCodes]
    );

    const allClientDetails = result.rows;

    if (!allClientDetails.length) {
      return NextResponse.json({
        success: true,
        clients: [],
        family: [],
        message: 'No client data available',
      });
    }

    // Find head of family or designate the first client as head
    let headClient = allClientDetails.find((c) => c.head_of_family === true) || allClientDetails[0];

    const groupId = headClient.groupid;
    const headOfFamilyEmail = headClient.email;

    // Fetch all family members by group ID with complete data
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
    );

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
      groupemailid: headOfFamilyEmail,
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
      head_of_family: member.id === headClient.id,
      holderName: `${member.firstname} ${member.middlename ?? ''} ${member.lastname}`.trim(),
      fullName: `${member.salutation || ''} ${member.firstname} ${member.middlename ?? ''} ${member.lastname}`.trim(),
      relation: member.id === headClient.id ? 'Primary' : 'Family Member',
      status: 'Active',
    }));

    return NextResponse.json({
      success: true,
      clients: allClientDetails,
      family: familyMembers,
      familyCount: familyMembers.length,
      headOfFamily: headClient,
      groupEmailId: headOfFamilyEmail,
    });

  } catch (error) {
    console.error('Client data fetch error:', error);
    return NextResponse.json({ error: 'Failed to fetch client data' }, { status: 500 });
  }
}