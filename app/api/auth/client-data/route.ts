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
      `SELECT *
       FROM pms_clients_master 
       WHERE email = $1`,
      [email]
    );

    // Fix: Ensure rows returned, check properly for distributor, and avoid errors
    const rows = clientCodesResult.rows || clientCodesResult;
    if (Array.isArray(rows) && rows.length > 0 && rows[0].clienttype === 'DISTRIBUTORS') {
      console.log(email,"==================email1")
      return NextResponse.json({
        success: true,
        clients: clientCodesResult.rows,
        family: [],
        message: '',
        isHeadOfFamily: false,
      });
    }
    

    const clientCodes = clientCodesResult.rows.map(row => row.clientcode);
    console.log(clientCodes,"==================clientCodes")

    if (!clientCodes.length) {
      console.log(email,"==================email2")
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

    // Fetch Orbis data for clients that have matching nuvama_code
    const clientNuvamaCodes = clientCodes; // clientcode is the same as nuvama_code for matching
    const orbisResult = await query(
      `SELECT id, person_name, orbis_code, date, capital_amount, unit_balance,
              market_value, nav, opening_unit_balance, units_allotted, units_redeemed,
              closing_unit_balance, capital_investment, capital_redemption, management_fees,
              other_fees, net_capital_flow, created_at, updated_at, nuvama_code
       FROM orbis_master_sheet
       WHERE nuvama_code = ANY($1::text[])
       ORDER BY date ASC`,
      [clientNuvamaCodes]
    );

    // Create a map of nuvama_code to orbis data for easy lookup
    const orbisDataMap = new Map();
    orbisResult.rows.forEach((row) => {
      if (!orbisDataMap.has(row.nuvama_code)) {
        orbisDataMap.set(row.nuvama_code, []);
      }
      orbisDataMap.get(row.nuvama_code).push(row);
    });

    // Attach orbis data to each client and calculate metrics
    allClientDetails.forEach((client: any) => {
      const clientOrbisData = orbisDataMap.get(client.clientcode) || [];
      client.orbisData = clientOrbisData;

      // Calculate Orbis metrics from latest non-zero record
      if (clientOrbisData.length > 0) {
        // Sort by date to get records in descending order
        const sortedOrbisData = [...clientOrbisData].sort(
          (a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()
        );

        // Find latest non-zero capital_amount
        const latestCapitalRecord = sortedOrbisData.find(
          record => Number(record.capital_amount) > 0
        );

        // Find latest non-zero market_value
        const latestMarketRecord = sortedOrbisData.find(
          record => Number(record.market_value) > 0
        );

        // Use the most recent date among the non-zero records
        const latestDate = latestMarketRecord?.date || latestCapitalRecord?.date || sortedOrbisData[0].date;

        client.orbisMetrics = {
          latestCapitalAmount: latestCapitalRecord ? Number(latestCapitalRecord.capital_amount) : 0,
          latestMarketValue: latestMarketRecord ? Number(latestMarketRecord.market_value) : 0,
          latestDate: latestDate,
          latestNav: latestMarketRecord ? Number(latestMarketRecord.nav) : (latestCapitalRecord ? Number(latestCapitalRecord.nav) : 0),
          totalRecords: clientOrbisData.length
        };
      } else {
        client.orbisMetrics = null;
      }
    });

    // Determine final head of family status from DB (overall; used as a fallback)
    const finalIsHeadOfFamily =
      allClientDetails.some((c: any) => c.head_of_family === true) || isHeadOfFamily;

    // Group-aware behavior:
    // Same email can appear in multiple groups; we want to return all relevant groups.
    const groupIds = Array.from(
      new Set((allClientDetails || []).map((c: any) => c.groupid).filter(Boolean))
    );

    const familyMemberRows: any[] = [];
    for (const gid of groupIds) {
      const emailRowsForGroup = allClientDetails.filter((c: any) => c.groupid === gid);
      const canSeeFullGroup =
        isHeadOfFamily || emailRowsForGroup.some((c: any) => c.head_of_family === true);

      if (!canSeeFullGroup) {
        // Not head-of-family for this group: only include accounts that match the session email
        familyMemberRows.push(...emailRowsForGroup);
        continue;
      }

      const familyClientCodesResult = await query(
        `SELECT clientcode 
         FROM pms_clients_master 
         WHERE groupid = $1 
         ORDER BY head_of_family DESC, firstname ASC`,
        [gid]
      );

      const familyClientCodes = familyClientCodesResult.rows.map((row: any) => row.clientcode);
      if (!familyClientCodes.length) continue;

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

      const familyMap = new Map(familyResult.rows.map((member: any) => [member.clientcode, member]));
      const orderedFamilyRows = familyClientCodes.map((code: string) => familyMap.get(code)).filter(Boolean);
      familyMemberRows.push(...orderedFamilyRows);
    }

    // Fetch Orbis data for all relevant members (dedup by clientcode)
    const uniqueMemberCodes = Array.from(new Set(familyMemberRows.map((m: any) => m.clientcode).filter(Boolean)));
    const familyOrbisResult = uniqueMemberCodes.length
      ? await query(
          `SELECT id, person_name, orbis_code, date, capital_amount, unit_balance,
                  market_value, nav, opening_unit_balance, units_allotted, units_redeemed,
                  closing_unit_balance, capital_investment, capital_redemption, management_fees,
                  other_fees, net_capital_flow, created_at, updated_at, nuvama_code
           FROM orbis_master_sheet
           WHERE nuvama_code = ANY($1::text[])
           ORDER BY date ASC`,
          [uniqueMemberCodes]
        )
      : { rows: [] as any[] };

    const familyOrbisDataMap = new Map<string, any[]>();
    (familyOrbisResult.rows || []).forEach((row: any) => {
      if (!familyOrbisDataMap.has(row.nuvama_code)) familyOrbisDataMap.set(row.nuvama_code, []);
      familyOrbisDataMap.get(row.nuvama_code)!.push(row);
    });

    // Fetch latest portfolio_value for each account_code (clientcode)
    const portfolioMap = new Map<string, number>();
    if (uniqueMemberCodes.length > 0) {
      const pmsResult = await query(
        `SELECT DISTINCT ON (account_code)
                account_code,
                portfolio_value
         FROM public.pms_master_sheet
         WHERE account_code = ANY($1::text[])
         ORDER BY account_code, id DESC`,
        [uniqueMemberCodes]
      );

      (pmsResult.rows || []).forEach((row: any) => {
        portfolioMap.set(row.account_code, Number(row.portfolio_value) || 0);
      });
    }

    const familyMembers = familyMemberRows.map((member: any) => {
      const nameParts = [member.firstname, member.middlename, member.lastname]
        .filter((part) => typeof part === 'string' && part.trim().length > 0)
        .map((part) => part.trim());
      const holderName = nameParts.join(' ').trim() || member.clientname || member.clientcode;
      const salutation = typeof member.salutation === 'string' ? member.salutation.trim() : '';
      const fullName = [salutation, holderName].filter(Boolean).join(' ').trim();

      const memberOrbisData = familyOrbisDataMap.get(member.clientcode) || [];

      let orbisMetrics = null;
      if (memberOrbisData.length > 0) {
        const sortedOrbisData = [...memberOrbisData].sort(
          (a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()
        );
        const latestCapitalRecord = sortedOrbisData.find((record) => Number(record.capital_amount) > 0);
        const latestMarketRecord = sortedOrbisData.find((record) => Number(record.market_value) > 0);
        const latestDate = latestMarketRecord?.date || latestCapitalRecord?.date || sortedOrbisData[0].date;
        orbisMetrics = {
          latestCapitalAmount: latestCapitalRecord ? Number(latestCapitalRecord.capital_amount) : 0,
          latestMarketValue: latestMarketRecord ? Number(latestMarketRecord.market_value) : 0,
          latestDate: latestDate,
          latestNav: latestMarketRecord
            ? Number(latestMarketRecord.nav)
            : latestCapitalRecord
              ? Number(latestCapitalRecord.nav)
              : 0,
          totalRecords: memberOrbisData.length,
        };
      }

      const portfolioValue = portfolioMap.get(member.clientcode) ?? 0;
      const status = portfolioValue === 0 ? 'Closed' : 'Active';

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
        groupemailid: email,
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
        holderName,
        fullName,
        relation: member.head_of_family ? 'Primary' : (finalIsHeadOfFamily ? 'Family Member' : 'Individual Account'),
        status,
        portfolioValue,
        orbisData: memberOrbisData,
        orbisMetrics: orbisMetrics,
      };
    });

    // Head client (best-effort across groups)
    const headClient = familyMembers.find((m: any) => m.head_of_family) || familyMembers[0] || null;

    return NextResponse.json({
      success: true,
      clients: allClientDetails,
      isHeadOfFamily: finalIsHeadOfFamily,
      family: familyMembers,
      familyCount: familyMembers.length,
      headOfFamily: headClient,
      groupEmailId: email,
    });

  } catch (error) {
    console.error('Client data fetch error:', error);
    return NextResponse.json({ error: 'Failed to fetch client data' }, { status: 500 });
  }
}