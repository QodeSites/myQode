// app/api/auth/client-data/route.ts
import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'

export async function GET() {
  try {
    const cookieStore = await cookies()
    const authCookie = cookieStore.get('qode-auth')
    const clientsCookie = cookieStore.get('qode-clients')
    
    // Check if user is authenticated
    if (authCookie?.value !== '1') {
      return NextResponse.json(
        { error: 'Not authenticated' },
        { status: 401 }
      )
    }
    
    // Parse client data from cookie
    let clients = []
    if (clientsCookie?.value) {
      try {
        clients = JSON.parse(clientsCookie.value)
      } catch (error) {
        console.error('Error parsing clients cookie:', error)
      }
    }
    
    return NextResponse.json({
      success: true,
      clients: clients
    })
    
  } catch (error) {
    console.error('Client data fetch error:', error)
    return NextResponse.json(
      { error: 'Failed to fetch client data' },
      { status: 500 }
    )
  }
}