import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import axios, { AxiosError } from 'axios'

interface TokenResponse {
  access_token: string
  refresh_token: string
  token_type: string
  expires_in?: number
}

export async function POST() {
  try {
    const cookieStore = await cookies()
    const refreshToken = cookieStore.get('qode-refresh-token')?.value

    if (!refreshToken) {
      return NextResponse.json(
        { error: 'No refresh token' },
        { status: 401 }
      )
    }

    const baseUrl = process.env.API_AUTH_URL
    if (!baseUrl) {
      return NextResponse.json(
        { error: 'Auth service not configured' },
        { status: 500 }
      )
    }

    const res = await axios.post<TokenResponse>(
      `${baseUrl}/auth/refresh-token/`,
      { refresh_token: refreshToken },
      { headers: { 'Content-Type': 'application/json' } }
    )

    const data = res.data
    const maxAge = data.expires_in && Number.isFinite(data.expires_in)
      ? data.expires_in
      : 60 * 60

    cookieStore.set('qode-access-token', data.access_token, {
      httpOnly: true,
      sameSite: 'lax',
      path: '/',
      secure: process.env.NODE_ENV === 'production',
      maxAge,
    })

    cookieStore.set('qode-refresh-token', data.refresh_token, {
      httpOnly: true,
      sameSite: 'lax',
      path: '/',
      secure: process.env.NODE_ENV === 'production',
      maxAge: 60 * 60 * 24 * 7,
    })

    return NextResponse.json({
      success: true,
      access_token: data.access_token,
      token_type: data.token_type,
      expires_in: data.expires_in,
    })
  } catch (err) {
    const axiosErr = err as AxiosError<{ detail?: string }>
    const status = axiosErr.response?.status
    const detail = axiosErr.response?.data?.detail

    if (status === 401) {
      const cookieStore = await cookies()
      cookieStore.set('qode-access-token', '', { path: '/', maxAge: 0 })
      cookieStore.set('qode-refresh-token', '', { path: '/', maxAge: 0 })
      return NextResponse.json(
        { error: detail || 'Invalid or expired refresh token' },
        { status: 401 }
      )
    }

    console.error('Refresh token error:', axiosErr.message)
    return NextResponse.json(
      { error: 'Failed to refresh token' },
      { status: 502 }
    )
  }
}
