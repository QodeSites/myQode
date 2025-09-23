// app/api/auth/microsoft/debug/route.ts
import { NextResponse } from 'next/server'
import { validateMicrosoftConfig } from '@/lib/auth-config'

export async function GET() {
  if (process.env.NODE_ENV !== 'development') {
    return NextResponse.json({ error: 'Debug endpoint only available in development' }, { status: 403 })
  }

  const validation = validateMicrosoftConfig()
  
  return NextResponse.json({
    environment: process.env.NODE_ENV,
    validation,
    timestamp: new Date().toISOString()
  })
}