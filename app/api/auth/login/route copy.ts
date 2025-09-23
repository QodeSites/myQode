import { NextRequest, NextResponse } from 'next/server'
import { query } from '@/lib/db'
import { cookies } from 'next/headers'

interface ClientData {
  clientid: string;
  clientcode: string;
}

export async function POST(request: NextRequest) {
  try {
    const { username, password } = await request.json()

    if (!username || !password) {
      return NextResponse.json(
        { error: 'Username and password are required' },
        { status: 400 }
      )
    }

    // Step 1: Find the initial matching record(s) to get the email or groupid
    const initialResult = await query(
      'SELECT clientid, clientcode, email, groupid FROM pms_clients_master WHERE email = $1 OR clientcode = $1 AND password = $2',
      [username, password]
    )

    if (initialResult.rows.length === 0) {
      return NextResponse.json(
        { error: 'Invalid credentials' },
        { status: 401 }
      )
    }

    // Step 2: Get the groupid or email from the first matching record
    const { groupid, email } = initialResult.rows[0]

    // Step 3: Fetch all client records associated with the same groupid or email
    const result = await query(
      'SELECT clientid, clientcode FROM pms_clients_master WHERE groupid = $1 OR email = $2',
      [groupid, email]
    )

    if (result.rows.length === 0) {
      return NextResponse.json(
        { error: 'No client data found' },
        { status: 404 }
      )
    }

    // Map client data for the cookie
    const clientData: ClientData[] = result.rows.map(row => ({
      clientid: row.clientid,
      clientcode: row.clientcode
    }))

    console.log('Client Data:', clientData)

    const cookieStore = await cookies()
    
    // Set authentication cookie
    cookieStore.set('qode-auth', '1', {
      httpOnly: true,
      sameSite: 'lax',
      path: '/',
      maxAge: 60 * 60 * 24 // 24 hours
    })
    
    // Store client data in cookie
    cookieStore.set('qode-clients', JSON.stringify(clientData), {
      httpOnly: true,
      sameSite: 'lax',
      path: '/',
      maxAge: 60 * 60 * 24 // 24 hours
    })

    return NextResponse.json({
      success: true,
      message: 'Login successful',
      clients: clientData
    })

  } catch (error) {
    console.error('Login error:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}