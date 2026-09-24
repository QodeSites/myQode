/**
 * Pure parsing/redaction helpers for the internal API demo.
 *
 * No filesystem access, so this module is safe to import from client
 * components (the live-response viewer reuses the same normalization as the
 * saved examples, including PII scrubbing).
 */

export const COLLECTION_FILE = "QODE-PMS-LIVE-APIS Modernization.postman_collection.json"

/** Header names whose values must never reach the client. */
const SECRET_HEADERS = new Set(["userpassword", "tokenid", "authorization", "apikey", "x-api-key"])

/** Response fields carrying investor PII, masked unless explicitly revealed. */
const PII_FIELDS = new Set([
  "MOBILE",
  "EMAIL",
  "ADDRESS1",
  "ADDRESS2",
  "PANNO",
  "PAN",
  "BIRTHDATE",
  "BANKACNO",
  "BANKACCOUNTNO",
  "DPID",
  "CLIENTDPID",
  "AADHAR",
  "AADHAARNO",
])

export type DemoHeader = {
  key: string
  value: string
  secret: boolean
}

export type DemoResponse = {
  name: string
  code: number
  status: string
  /** Detected from the body, not from Postman's (unreliable) previewlanguage. */
  language: "json" | "xml" | "text"
  headers: DemoHeader[]
  body: string
  /** Parsed rows when the body is a JSON array of flat objects. */
  table: DemoTable | null
  /** Bytes of the original body, before any truncation for transport. */
  byteLength: number
  truncated: boolean
  /** Set when the payload looks like a server error rather than data. */
  error: DemoError | null
}

export type DemoError = {
  message: string
  detail: string
}

export type DemoTable = {
  columns: string[]
  rows: Record<string, string | null>[]
  totalRows: number
  /** Columns masked because they hold PII. */
  maskedColumns: string[]
  /** Columns where every value in the sample was null — a strong API smell. */
  allNullColumns: string[]
}

export type DemoRequest = {
  id: string
  name: string
  method: string
  url: string
  host: string
  pathname: string
  headers: DemoHeader[]
  body: string | null
  bodyFields: { key: string; value: string }[]
  responses: DemoResponse[]
}

export type DemoCollection = {
  name: string
  requests: DemoRequest[]
  /** Warnings surfaced in the UI so the demo is honest about its inputs. */
  notices: string[]
}

/** Max rows sent to the browser per table. CLIENT-MASTER has hundreds. */
const MAX_ROWS = 50
/** Max characters of a raw body sent to the browser. */
const MAX_BODY_CHARS = 40_000

export function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
}

export function redactHeaders(headers: unknown): DemoHeader[] {
  if (!Array.isArray(headers)) return []
  return headers
    .filter((h): h is Record<string, unknown> => !!h && typeof h === "object")
    .filter((h) => h.disabled !== true)
    .map((h) => {
      const key = String(h.key ?? "")
      const raw = String(h.value ?? "")
      const secret = SECRET_HEADERS.has(key.toLowerCase())
      return { key, value: secret ? maskSecret(raw) : raw, secret }
    })
}

/** Keeps enough of a token to correlate logs without exposing it. */
function maskSecret(value: string): string {
  if (!value) return ""
  if (value.length <= 8) return "•".repeat(value.length)
  return `${value.slice(0, 4)}${"•".repeat(12)}${value.slice(-4)}`
}

function maskPii(value: string): string {
  if (!value) return value
  if (value.length <= 4) return "••••"
  return `${value.slice(0, 2)}${"•".repeat(Math.min(8, value.length - 3))}${value.slice(-1)}`
}

function detectLanguage(body: string): "json" | "xml" | "text" {
  const trimmed = body.trimStart()
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) return "json"
  if (trimmed.startsWith("<")) return "xml"
  return "text"
}

/**
 * The upstream returns HTTP 200 with `{"Msg": "Please enter a valid token ID"}`
 * and HTTP 500 with an Oracle stack trace. Both are failures worth flagging.
 */
function detectError(code: number, parsed: unknown, body: string): DemoError | null {
  if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
    const obj = parsed as Record<string, unknown>
    if (typeof obj.Message === "string") {
      return { message: obj.Message, detail: typeof obj.Detailed === "string" ? obj.Detailed : "" }
    }
  }

  if (Array.isArray(parsed) && parsed.length > 0) {
    const first = parsed[0]
    if (first && typeof first === "object") {
      const msg = (first as Record<string, unknown>).Msg
      if (typeof msg === "string" && msg.trim()) {
        return { message: msg, detail: "" }
      }
    }
  }

  if (code >= 400) {
    return { message: `HTTP ${code}`, detail: body.slice(0, 2000) }
  }

  return null
}

function toCell(value: unknown): string | null {
  if (value === null || value === undefined) return null
  if (typeof value === "object") return JSON.stringify(value)
  return String(value)
}

/** Builds a table view from a JSON array of flat objects, masking PII. */
function buildTable(parsed: unknown): DemoTable | null {
  if (!Array.isArray(parsed) || parsed.length === 0) return null

  const objects = parsed.filter(
    (r): r is Record<string, unknown> => !!r && typeof r === "object" && !Array.isArray(r),
  )
  if (objects.length !== parsed.length) return null

  // Union of keys, preserving first-seen order.
  const columns: string[] = []
  for (const row of objects) {
    for (const key of Object.keys(row)) {
      if (!columns.includes(key)) columns.push(key)
    }
  }
  if (columns.length === 0) return null

  const maskedColumns = columns.filter((c) => PII_FIELDS.has(c.toUpperCase()))

  const rows = objects.slice(0, MAX_ROWS).map((row) => {
    const out: Record<string, string | null> = {}
    for (const col of columns) {
      const cell = toCell(row[col])
      out[col] = cell !== null && PII_FIELDS.has(col.toUpperCase()) ? maskPii(cell) : cell
    }
    return out
  })

  // Detect columns that are null across every record — the shape of an API
  // that answered but returned no data.
  const allNullColumns = columns.filter((col) => objects.every((row) => toCell(row[col]) === null))

  return { columns, rows, totalRows: objects.length, maskedColumns, allNullColumns }
}

/**
 * Recursively masks PII values in a parsed payload. Applied before the body is
 * re-serialized for the client so the raw and formatted views inherit the same
 * redaction the table view applies — the raw string is never shipped as-is.
 */
function scrubValue(value: unknown, key?: string): unknown {
  if (Array.isArray(value)) return value.map((v) => scrubValue(v))
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = scrubValue(v, k)
    }
    return out
  }
  if (key && PII_FIELDS.has(key.toUpperCase()) && value !== null && value !== undefined) {
    return maskPii(String(value))
  }
  return value
}

export function parseBodyFields(raw: string | null): { key: string; value: string }[] {
  if (!raw) return []
  try {
    const parsed = JSON.parse(raw)
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return []
    return Object.entries(parsed as Record<string, unknown>).map(([key, value]) => ({
      key,
      value: value === null ? "null" : String(value),
    }))
  } catch {
    return []
  }
}

export function normalizeResponse(raw: Record<string, unknown>): DemoResponse {
  const original = typeof raw.body === "string" ? raw.body : ""
  const language = detectLanguage(original)

  let parsed: unknown = null
  if (language === "json") {
    try {
      parsed = scrubValue(JSON.parse(original))
    } catch {
      parsed = null
    }
  }

  // Ship the scrubbed re-serialization, never the original string. Non-JSON
  // bodies (the XML token, Oracle stack traces) carry no investor PII.
  const body = parsed !== null ? JSON.stringify(parsed, null, 2) : original

  const code = typeof raw.code === "number" ? raw.code : 0
  const truncated = body.length > MAX_BODY_CHARS

  return {
    name: String(raw.name ?? "Example"),
    code,
    status: String(raw.status ?? ""),
    language,
    headers: redactHeaders(raw.header),
    body: truncated ? `${body.slice(0, MAX_BODY_CHARS)}\n\n… truncated` : body,
    table: buildTable(parsed),
    // Reported against the original payload — the real wire size. TextEncoder
    // rather than Buffer so this module stays browser-safe.
    byteLength: new TextEncoder().encode(original).length,
    truncated,
    error: detectError(code, parsed, original),
  }
}

/**
 * Normalizes a live upstream response into the same shape as a saved example,
 * so the viewer renders both identically (including PII scrubbing).
 */
export function normalizeLiveResponse(input: {
  code: number
  status: string
  headers: Record<string, string>
  body: string
}): DemoResponse {
  return normalizeResponse({
    name: "Live response",
    code: input.code,
    status: input.status,
    header: Object.entries(input.headers).map(([key, value]) => ({ key, value })),
    body: input.body,
  })
}

/** RFC 4180 escaping: quote when the value contains a comma, quote, or newline. */
function csvCell(value: string | null): string {
  if (value === null) return ""
  return /[",\n\r]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value
}

/**
 * Serializes a table to CSV. Exports the masked values that are on screen —
 * the export must not become a way to extract unredacted PII.
 */
export function tableToCsv(table: DemoTable): string {
  const header = table.columns.map(csvCell).join(",")
  const rows = table.rows.map((row) => table.columns.map((c) => csvCell(row[c])).join(","))
  return [header, ...rows].join("\r\n")
}

/**
 * Builds CSV from a raw JSON array with NO row cap — `buildTable` limits rows
 * to keep the browser responsive, which would silently truncate an export.
 * PII is still masked, so the export can't be used to extract raw investor data.
 */
export function jsonArrayToCsv(text: string): string | null {
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    return null
  }
  if (!Array.isArray(parsed) || parsed.length === 0) return null

  const objects = parsed.filter(
    (r): r is Record<string, unknown> => !!r && typeof r === "object" && !Array.isArray(r),
  )
  if (objects.length !== parsed.length) return null

  const columns: string[] = []
  for (const row of objects) {
    for (const key of Object.keys(row)) {
      if (!columns.includes(key)) columns.push(key)
    }
  }
  if (columns.length === 0) return null

  const lines = [columns.map(csvCell).join(",")]
  for (const row of objects) {
    lines.push(
      columns
        .map((col) => {
          const cell = toCell(row[col])
          return csvCell(
            cell !== null && PII_FIELDS.has(col.toUpperCase()) ? maskPii(cell) : cell,
          )
        })
        .join(","),
    )
  }
  return lines.join("\r\n")
}
