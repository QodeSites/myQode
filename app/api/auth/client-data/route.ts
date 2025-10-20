import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { query } from '@/lib/db';

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
    const userContextCookie = cookieStore.get('qode-user-context');
    const headOfFamilyCookie = cookieStore.get('qode-head-of-family');

    if (authCookie?.value !== '1') {
      return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
    }

    let userContext: UserContext | null = null;
    let isHeadOfFamily = false;
    let email: string | null = null;

    // Parse user context
    if (userContextCookie?.value) {
      try {
        userContext = JSON.parse(userContextCookie.value);
        isHeadOfFamily = userContext?.head_of_family || false;
        email = userContext?.email || null;
      } catch (error) {
        console.error('Error parsing user context cookie:', error);
      }
    }

    // Fallback to head of family cookie if context is not available
    if (!userContext && headOfFamilyCookie?.value) {
      isHeadOfFamily = headOfFamilyCookie.value === 'true';
    }

    if (!email) {
      return NextResponse.json({ error: 'No email found in session' }, { status: 400 });
    }

    // First, fetch all client codes based on the email
    const clientCodesResult = await query(
      `SELECT clientcode 
       FROM pms_clients_master 
       WHERE email = $1`,
      [email]
    );

    const clientCodes = clientCodesResult.rows.map(row => row.clientcode);

    if (!clientCodes.length) {
      return NextResponse.json({
        success: true,
        clients: [],
        family: [],
        message: 'No client data available',
        isHeadOfFamily: false,
      });
    }

    // Then, fetch full info of all clients using the client codes
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

    // Determine group ID and final head of family status from DB
    const groupId = allClientDetails[0].groupid;
    const finalIsHeadOfFamily = allClientDetails.some((c: any) => c.head_of_family === true) || isHeadOfFamily;

    let familyMembers: any[] = [];
    let responseData: any = {
      success: true,
      clients: allClientDetails,
      isHeadOfFamily: finalIsHeadOfFamily,
      family: [],
      familyCount: 0,
    };

    if (finalIsHeadOfFamily) {
      let headOfFamilyEmail: string = email;

      // First, fetch all client codes for the family group
      const familyClientCodesResult = await query(
        `SELECT clientcode 
         FROM pms_clients_master 
         WHERE groupid = $1 
         ORDER BY head_of_family DESC, firstname ASC`,
        [groupId]
      );

      const familyClientCodes = familyClientCodesResult.rows.map(row => row.clientcode);

      if (familyClientCodes.length > 0) {
        // Then, fetch full info of all family clients using the client codes
        const familyResult = await query(
          `SELECT id, clientid, clientname, clientcode, clienttype, accounttype, account_open_date, 
                  inceptiondate, mobile, email, address1, address2, city, pincode, state, pannumber, 
                  ownerid, ownername, groupid, groupname, schemeid, schemename, advisorname, username, 
                  salutation, firstname, middlename, lastname, first_holder_gender, created_at, 
                  updated_at, password, head_of_family 
           FROM pms_clients_master 
           WHERE clientcode = ANY($1::text[])`,
          [familyClientCodes]
        );

        // Preserve the order from the client codes query
        const familyMap = new Map(familyResult.rows.map(member => [member.clientcode, member]));
        const orderedFamilyRows = familyClientCodes.map(code => familyMap.get(code)).filter(Boolean);

        familyMembers = orderedFamilyRows.map((member) => {
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
      }

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