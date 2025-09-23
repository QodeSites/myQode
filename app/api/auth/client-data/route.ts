import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { query } from '@/lib/db';

interface ClientData {
  clientid: string;
  clientcode: string;
}

interface UserContext {
  clientid: string;
  clientcode: string;
  email: string;
  groupid: string;
  head_of_family: boolean;
}

export async function GET() {
  try {
    const cookieStore = await cookies();
    const authCookie = cookieStore.get('qode-auth');
    const clientsCookie = cookieStore.get('qode-clients');
    const headOfFamilyCookie = cookieStore.get('qode-head-of-family');
    const userContextCookie = cookieStore.get('qode-user-context');

    if (authCookie?.value !== '1') {
      return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
    }

    let clients: ClientData[] = [];
    let userContext: UserContext | null = null;
    let isHeadOfFamily = false;

    // Parse session data
    if (clientsCookie?.value) {
      try {
        clients = JSON.parse(clientsCookie.value);
      } catch (error) {
        console.error('Error parsing clients cookie:', error);
        return NextResponse.json({ error: 'Invalid client data in session' }, { status: 400 });
      }
    }

    if (userContextCookie?.value) {
      try {
        userContext = JSON.parse(userContextCookie.value);
        isHeadOfFamily = userContext?.head_of_family || false;
      } catch (error) {
        console.error('Error parsing user context cookie:', error);
      }
    }

    // Fallback to head of family cookie if context is not available
    if (!userContext && headOfFamilyCookie?.value) {
      isHeadOfFamily = headOfFamilyCookie.value === 'true';
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
        isHeadOfFamily: false,
      });
    }

    let familyMembers: any[] = [];
    let responseData: any = {
      success: true,
      clients: allClientDetails,
      isHeadOfFamily: isHeadOfFamily,
      family: [],
      familyCount: 0,
    };

    if (isHeadOfFamily) {
      // If user is head of family, fetch all family members for their group(s)
      // Use the user context or find the head client from session data
      let groupId: string;
      let headOfFamilyEmail: string;

      if (userContext) {
        groupId = userContext.groupid;
        headOfFamilyEmail = userContext.email;
      } else {
        // Fallback: find head client from the fetched data
        const headClients = allClientDetails.filter((c) => c.head_of_family === true);
        if (headClients.length > 0) {
          const headClient = headClients[0];
          groupId = headClient.groupid;
          headOfFamilyEmail = headClient.email;
        } else {
          // If no head client found but marked as head of family, use first client's group
          groupId = allClientDetails[0].groupid;
          headOfFamilyEmail = allClientDetails[0].email;
        }
      }

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

      familyMembers = familyResult.rows.map((member) => {
        // Form holderName and fullName, handling null/undefined values
        const middleNamePart = member.middlename ? ` ${member.middlename}` : '';
        const salutationPart = member.salutation ? `${member.salutation} ` : '';
        return {
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
          head_of_family: member.head_of_family,
          holderName: `${member.firstname}${middleNamePart} ${member.lastname}`.trim(),
          fullName: `${salutationPart}${member.firstname}${middleNamePart} ${member.lastname}`.trim(),
          relation: member.head_of_family ? 'Primary' : 'Family Member',
          status: 'Active',
        };
      });

      // Find the actual head client for response
      const headClient = familyMembers.find(m => m.head_of_family) || familyMembers[0];

      responseData = {
        ...responseData,
        family: familyMembers,
        familyCount: familyMembers.length,
        headOfFamily: headClient,
        groupEmailId: headOfFamilyEmail,
      };
    } else {
      // If user is NOT head of family, return only their own account data
      familyMembers = allClientDetails.map((member) => {
        // Form holderName and fullName, handling null/undefined values
        const middleNamePart = member.middlename ? ` ${member.middlename}` : '';
        const salutationPart = member.salutation ? `${member.salutation} ` : '';
        return {
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
          groupemailid: member.email, // Use their own email as group email
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
          holderName: `${member.firstname}${middleNamePart} ${member.lastname}`.trim(),
          fullName: `${salutationPart}${member.firstname}${middleNamePart} ${member.lastname}`.trim(),
          relation: 'Individual Account',
          status: 'Active',
        };
      });

      responseData = {
        ...responseData,
        family: familyMembers,
        familyCount: familyMembers.length,
        headOfFamily: null,
        groupEmailId: familyMembers[0]?.email || null,
      };
    }

    return NextResponse.json(responseData);

  } catch (error) {
    console.error('Client data fetch error:', error);
    return NextResponse.json({ error: 'Failed to fetch client data' }, { status: 500 });
  }
}