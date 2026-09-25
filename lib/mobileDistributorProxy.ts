// Calls a web partner route (/api/distributor/*) on behalf of a partner signed in to the app.
//
// Why a proxy and not a copy: the web's fee maths (calculator, ~550 lines inside the route handler) is the source of
// truth, and the app must show exactly the same figures. Calling the web route guarantees that and leaves one
// implementation to maintain.
//
// Identity: the web routes read the qode-user-context cookie. Here that cookie is built on the server from the
// partner the mobile JWT was verified for (requireMobileDistributor) — the app never supplies it, so it cannot
// be forged from the phone. Never forwards admin flags (includeQodeShare).
import { NextResponse } from 'next/server'

const base = () => (process.env.NEXT_PUBLIC_BASE_URL || process.env.NEXTAUTH_URL?.trim() || 'http://localhost:2069').replace(/\/$/, '')

export async function callWebDistributorRoute(email: string, path: string, init: { method?: string; body?: unknown } = {}) {
  const cookie = 'qode-auth=1; qode-user-context=' + encodeURIComponent(JSON.stringify({ email }))
  const res = await fetch(`${base()}/api/distributor/${path}`, {
    method: init.method || 'GET',
    headers: { Cookie: cookie, 'Content-Type': 'application/json' },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
    cache: 'no-store',
  })
  const data = await res.json().catch(() => null)
  return { status: res.status, data }
}

export const relay = (r: { status: number; data: any }) =>
  NextResponse.json(r.data ?? { error: 'Unexpected response' }, { status: r.status, headers: { 'Cache-Control': 'private, no-store' } })
