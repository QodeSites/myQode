import fs from "node:fs/promises"
import path from "node:path"

import {
  COLLECTION_FILE,
  type DemoCollection,
  type DemoRequest,
  normalizeResponse,
  parseBodyFields,
  redactHeaders,
  slugify,
} from "./postmanCollectionShared"

/**
 * Server-side loader for the Nuvama PMS Postman collection.
 *
 * The raw export carries live service credentials and, in the CLIENT-MASTER
 * example, real investor PII. Everything rendered goes through the redaction
 * helpers in `postmanCollectionShared`; only `loadRawRequest` sees secrets, and
 * it is used exclusively for server-side dispatch.
 */

export * from "./postmanCollectionShared"

function normalizeRequest(raw: Record<string, unknown>): DemoRequest | null {
  const request = raw.request
  if (!request || typeof request !== "object") return null
  const req = request as Record<string, unknown>

  const urlRaw =
    typeof req.url === "string"
      ? req.url
      : String(((req.url ?? {}) as Record<string, unknown>).raw ?? "")

  let host = ""
  let pathname = urlRaw
  try {
    const parsedUrl = new URL(urlRaw)
    host = parsedUrl.host
    pathname = parsedUrl.pathname
  } catch {
    // Leave the raw string as-is when it isn't a parseable absolute URL.
  }

  const bodyRaw =
    req.body && typeof req.body === "object"
      ? ((req.body as Record<string, unknown>).raw as string | undefined)
      : undefined
  const body = typeof bodyRaw === "string" && bodyRaw.trim() ? bodyRaw.trim() : null

  const name = String(raw.name ?? "Untitled")
  const responses = Array.isArray(raw.response)
    ? raw.response
        .filter((r): r is Record<string, unknown> => !!r && typeof r === "object")
        .map(normalizeResponse)
    : []

  return {
    id: slugify(name),
    name,
    method: String(req.method ?? "GET").toUpperCase(),
    url: urlRaw,
    host,
    pathname,
    headers: redactHeaders(req.header),
    body,
    bodyFields: parseBodyFields(body),
    responses,
  }
}

/** Flattens Postman's nested folder structure into a single request list. */
function flatten(items: unknown[]): DemoRequest[] {
  const out: DemoRequest[] = []
  for (const item of items) {
    if (!item || typeof item !== "object") continue
    const node = item as Record<string, unknown>
    if (Array.isArray(node.item)) {
      out.push(...flatten(node.item))
    } else {
      const req = normalizeRequest(node)
      if (req) out.push(req)
    }
  }
  return out
}

let cached: DemoCollection | null = null

export async function loadCollection(): Promise<DemoCollection> {
  if (cached) return cached

  const file = path.join(process.cwd(), COLLECTION_FILE)
  const parsed = JSON.parse(await fs.readFile(file, "utf8")) as Record<string, unknown>

  const info = (parsed.info ?? {}) as Record<string, unknown>
  const requests = flatten(Array.isArray(parsed.item) ? parsed.item : [])

  // De-duplicate slugs so routing stays stable when two requests share a name.
  const seen = new Map<string, number>()
  for (const req of requests) {
    const count = seen.get(req.id) ?? 0
    seen.set(req.id, count + 1)
    if (count > 0) req.id = `${req.id}-${count + 1}`
  }

  const notices: string[] = []
  const failing = requests.filter((r) => r.responses.some((res) => res.error))
  if (failing.length > 0) {
    notices.push(
      `${failing.length} of ${requests.length} endpoints have saved examples that failed upstream.`,
    )
  }
  const noExample = requests.filter((r) => r.responses.length === 0)
  if (noExample.length > 0) {
    notices.push(`${noExample.length} endpoints have no saved response in the collection.`)
  }

  cached = { name: String(info.name ?? "Postman Collection"), requests, notices }
  return cached
}

export async function loadRequest(id: string): Promise<DemoRequest | null> {
  const collection = await loadCollection()
  return collection.requests.find((r) => r.id === id) ?? null
}

export type RawRequest = {
  method: string
  url: string
  headers: Record<string, string>
  body: string | null
}

/**
 * Returns the request with credentials INTACT, for server-side dispatch only.
 * Never return this to the browser — use `loadRequest` for anything rendered.
 */
export async function loadRawRequest(id: string): Promise<RawRequest | null> {
  const file = path.join(process.cwd(), COLLECTION_FILE)
  const parsed = JSON.parse(await fs.readFile(file, "utf8")) as Record<string, unknown>

  const seen = new Map<string, number>()
  const walk = (items: unknown[]): RawRequest | null => {
    for (const item of items) {
      if (!item || typeof item !== "object") continue
      const node = item as Record<string, unknown>

      if (Array.isArray(node.item)) {
        const found = walk(node.item)
        if (found) return found
        continue
      }

      const req = node.request as Record<string, unknown> | undefined
      if (!req) continue

      // Mirror loadCollection's slug de-duplication so ids line up.
      const base = slugify(String(node.name ?? "Untitled"))
      const count = seen.get(base) ?? 0
      seen.set(base, count + 1)
      const slug = count === 0 ? base : `${base}-${count + 1}`
      if (slug !== id) continue

      const headers: Record<string, string> = {}
      if (Array.isArray(req.header)) {
        for (const h of req.header) {
          if (!h || typeof h !== "object") continue
          const entry = h as Record<string, unknown>
          if (entry.disabled === true) continue
          headers[String(entry.key)] = String(entry.value ?? "")
        }
      }

      const rawBody =
        req.body && typeof req.body === "object"
          ? ((req.body as Record<string, unknown>).raw as string | undefined)
          : undefined

      return {
        method: String(req.method ?? "GET").toUpperCase(),
        url:
          typeof req.url === "string"
            ? req.url
            : String(((req.url ?? {}) as Record<string, unknown>).raw ?? ""),
        headers,
        body: typeof rawBody === "string" && rawBody.trim() ? rawBody.trim() : null,
      }
    }
    return null
  }

  return walk(Array.isArray(parsed.item) ? parsed.item : [])
}
