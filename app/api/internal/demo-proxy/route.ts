import { NextResponse } from "next/server"
import { loadRawRequest } from "@/lib/postmanCollection"

/**
 * Server-side proxy for the internal API demo "Run" button.
 *
 * The browser must never hold the Nuvama service credentials, so the client
 * sends only an endpoint id. This route looks up the *unredacted* request from
 * the collection, calls upstream, and returns the live response.
 *
 * Internal-only: gated behind the same switch as the /internal pages.
 */

export const dynamic = "force-dynamic"

const TIMEOUT_MS = 30_000

/**
 * Live payloads run to 17 MB (PORTFOLIO_TRANSACTION returns 8k records × 110
 * fields). Sending that to the browser to render 50 rows is wasteful and can
 * hang the tab, so the array is trimmed server-side. `Export CSV` re-requests
 * with `full: true` to get everything.
 */
const PREVIEW_RECORDS = 200

function trimPayload(text: string, full: boolean): { body: string; totalRecords: number | null } {
  if (full) return { body: text, totalRecords: null }
  try {
    const parsed = JSON.parse(text) as unknown
    if (Array.isArray(parsed) && parsed.length > PREVIEW_RECORDS) {
      return {
        body: JSON.stringify(parsed.slice(0, PREVIEW_RECORDS)),
        totalRecords: parsed.length,
      }
    }
    if (Array.isArray(parsed)) return { body: text, totalRecords: parsed.length }
  } catch {
    // Non-JSON (XML token, error HTML) passes through untouched.
  }
  return { body: text, totalRecords: null }
}

function enabled(): boolean {
  return process.env.NODE_ENV !== "production" || process.env.ENABLE_INTERNAL_DEMO === "true"
}

/** Slug of the request that mints a session token. */
const TOKEN_ENDPOINT_ID = "service-token"

/**
 * The TokenId saved in the collection expired long ago, so replaying a request
 * verbatim just returns "Session Timeout or Invalid Token". Mint a fresh token
 * from the Service Token endpoint and substitute it before dispatching.
 */
async function mintToken(signal: AbortSignal): Promise<string | null> {
  const tokenRequest = await loadRawRequest(TOKEN_ENDPOINT_ID)
  if (!tokenRequest) return null

  try {
    const res = await fetch(tokenRequest.url, {
      method: tokenRequest.method,
      headers: tokenRequest.headers,
      body: tokenRequest.body ?? undefined,
      signal,
      cache: "no-store",
    })
    if (!res.ok) return null

    const text = await res.text()
    // Response is XML: <TOKEN_ID>…</TOKEN_ID>
    const xml = text.match(/<TOKEN_ID>\s*([^<\s]+)\s*<\/TOKEN_ID>/i)
    if (xml) return xml[1]

    // Tolerate a JSON shape if the upstream ever changes.
    try {
      const parsed = JSON.parse(text) as Record<string, unknown>
      const value = parsed.TOKEN_ID ?? parsed.TokenId ?? parsed.tokenId
      if (typeof value === "string" && value.trim()) return value.trim()
    } catch {
      // Not JSON — fall through.
    }
    return null
  } catch {
    return null
  }
}

export async function POST(request: Request) {
  if (!enabled()) {
    return NextResponse.json({ error: "Not available" }, { status: 404 })
  }

  let id: string
  let overrides: Record<string, string> | undefined
  let full = false
  try {
    const payload = (await request.json()) as {
      id?: unknown
      overrides?: unknown
      full?: unknown
    }
    if (typeof payload.id !== "string") {
      return NextResponse.json({ error: "Missing endpoint id" }, { status: 400 })
    }
    id = payload.id
    full = payload.full === true
    if (payload.overrides && typeof payload.overrides === "object") {
      overrides = Object.fromEntries(
        Object.entries(payload.overrides as Record<string, unknown>).map(([k, v]) => [
          k,
          String(v),
        ]),
      )
    }
  } catch {
    return NextResponse.json({ error: "Invalid JSON payload" }, { status: 400 })
  }

  const target = await loadRawRequest(id)
  if (!target) {
    return NextResponse.json({ error: `Unknown endpoint: ${id}` }, { status: 404 })
  }

  // Apply body overrides (dates, scheme group) supplied from the UI.
  let body = target.body
  if (body && overrides && Object.keys(overrides).length > 0) {
    try {
      const parsed = JSON.parse(body) as Record<string, unknown>
      for (const [k, v] of Object.entries(overrides)) {
        if (k in parsed) parsed[k] = v
      }
      body = JSON.stringify(parsed)
    } catch {
      // Non-JSON body: send as-is.
    }
  }

  const startedAt = Date.now()
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)

  try {
    // Every live run gets a freshly minted token — the one saved in the
    // collection is long expired. The token endpoint itself is exempt.
    const headers = { ...target.headers }
    let tokenUsed: string | null = null
    if (id !== TOKEN_ENDPOINT_ID) {
      tokenUsed = await mintToken(controller.signal)
      if (!tokenUsed) {
        return NextResponse.json({
          ok: false,
          code: 0,
          status: "Token request failed",
          durationMs: Date.now() - startedAt,
          headers: {},
          body: "",
          error: "Could not mint a session token from the Service Token endpoint.",
        })
      }
      // Replace the TokenId header case-insensitively, since the collection
      // spells it inconsistently across requests.
      for (const key of Object.keys(headers)) {
        if (key.toLowerCase() === "tokenid") delete headers[key]
      }
      headers.TokenId = tokenUsed
    }

    const upstream = await fetch(target.url, {
      method: target.method,
      headers,
      body: target.method === "GET" || target.method === "HEAD" ? undefined : (body ?? undefined),
      signal: controller.signal,
      cache: "no-store",
    })

    const text = await upstream.text()
    const responseHeaders: Record<string, string> = {}
    upstream.headers.forEach((value, key) => {
      responseHeaders[key] = value
    })

    const { body: outBody, totalRecords } = trimPayload(text, full)

    return NextResponse.json({
      ok: true,
      code: upstream.status,
      status: upstream.statusText,
      durationMs: Date.now() - startedAt,
      headers: responseHeaders,
      body: outBody,
      // Full wire size, so the UI can report what upstream actually returned.
      wireBytes: new TextEncoder().encode(text).length,
      totalRecords,
      previewLimit: full ? null : PREVIEW_RECORDS,
      // Shown in the UI so it's clear a fresh token was minted for this run.
      tokenUsed,
    })
  } catch (err) {
    const aborted = err instanceof Error && err.name === "AbortError"
    return NextResponse.json({
      ok: false,
      code: 0,
      status: aborted ? `Timed out after ${TIMEOUT_MS / 1000}s` : "Request failed",
      durationMs: Date.now() - startedAt,
      headers: {},
      body: "",
      error: err instanceof Error ? err.message : String(err),
    })
  } finally {
    clearTimeout(timer)
  }
}
