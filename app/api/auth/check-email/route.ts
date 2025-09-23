// /api/auth/check-email/route.ts
import { NextRequest, NextResponse } from 'next/server'
import { query } from '@/lib/db'

export async function POST(request: NextRequest) {
  try {
    const { email } = await request.json()

    if (!email?.trim()) {
      return NextResponse.json(
        { exists: false, hasPassword: false, message: 'Email is required' },
        { status: 400 }
      )
    }

    const result = await query(
      'SELECT email, password FROM pms_clients_master WHERE email = $1 LIMIT 1',
      [email.trim().toLowerCase()]
    )

    if (result.rows.length === 0) {
      return NextResponse.json({
        exists: false,
        hasPassword: false,
        message: 'Email not found'
      })
    }

    const user = result.rows[0]
    const hasPassword = user.password && user.password.trim() !== ''

    return NextResponse.json({
      exists: true,
      hasPassword,
      message: hasPassword ? 'Password required' : 'Password setup required'
    })

  } catch (error) {
    console.error('Email check error:', error)
    return NextResponse.json(
      { exists: false, hasPassword: false, message: 'Internal server error' },
      { status: 500 }
    )
  }
}
