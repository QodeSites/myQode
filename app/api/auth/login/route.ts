// app/api/auth/login/route.ts
import { NextRequest, NextResponse } from 'next/server'
import { query } from '@/lib/db'
import { cookies } from 'next/headers'

interface ClientData {
  clientid: string;
  clientcode: string;
}

export async function POST(request: NextRequest) {
  try {
    const { email, password } = await request.json()

    if (!email || !password) {
      return NextResponse.json(
        { error: 'Email and password are required' },
        { status: 400 }
      )
    }

    // Query database for user with matching email
    const result = await query(
      'SELECT clientid, clientcode, email FROM pms_clients_master WHERE email = $1 and password= $2',
      [email, password]
    )

    if (result.rows.length === 0) {
      return NextResponse.json(
        { error: 'Invalid credentials' },
        { status: 401 }
      )
    }

    // For demo purposes, any password works
    // In production, add password validation here:
    // const user = result.rows[0]
    // let isValidPassword = false;
    // if (user.password === password) {
    //   isValidPassword = true;
    // }
    // if (!isValidPassword) {
    //   return NextResponse.json({ error: 'Invalid credentials' }, { status: 401 })
    // }

    // Get all client records for this email (user can have multiple clients)
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