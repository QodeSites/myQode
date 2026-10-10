// Admin → Documents: which clients' Client Document Vault has documents, and uploading the missing ones.
//
// Storage: bucket qode-static-assets, docs/client-documents/<clientid folder>/<section>/<file>. The folder is the
// client's pms_clients_master.clientid, usually without the ".0" the database stores (184 of 189 folders on
// 4 Oct 2026); the vault pages look in both. Uploads go into the folder that already exists for the client,
// else the plain id. "Remove" moves a file to docs/client-documents-removed/ (recoverable), never deletes it.
//
// One row per CLIENT (10 Oct 2026): a client's strategy accounts each have their own folder (the app reads the folder
// of the account being viewed), so the same documents go into every folder of the client. Accounts are grouped by PAN,
// else email, else the folder id; a joint or HUF account with its own PAN stays a client of its own.
//
// GET    (staff)                       → { sections, clients: [{ clientId (first folder), clientIds, name, email, codes,
//                                          folders: [{ clientId, codes, counts }], closed, counts, missingIn, status }] }
// GET    (staff)  ?clientId=…[&clientId=…] → { files: [{ key, clientId, section, filename, size, lastModified, url }] }
// POST   (super)  multipart: clientId (one or more), section, file, [overwrite=1]
//                                       → { keys, existed } — 409 only when the file is already in every folder
// DELETE (super)  ?key=docs/client-documents/…   → moves the file out of the vault
import { NextRequest, NextResponse } from 'next/server'
import {
  ListObjectsV2Command, PutObjectCommand, GetObjectCommand, CopyObjectCommand, DeleteObjectCommand, HeadObjectCommand,
  type _Object,
} from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'
import { s3 } from '@/lib/s3'
import { query } from '@/lib/db'
import { requireAdmin, audit } from '@/lib/adminAuth'

export const dynamic = 'force-dynamic'
export const maxDuration = 120

const BUCKET = 'qode-static-assets'
const ROOT = 'docs/client-documents/'
const REMOVED = 'docs/client-documents-removed/'
// The vault's sections (web: the first three; the app also shows Disclosures).
const SECTIONS = ['PMS Agreement', 'Account Opening Documents', 'CML', 'Disclosures']
const REQUIRED = ['PMS Agreement', 'Account Opening Documents', 'CML']
const MAX_BYTES = 25 * 1024 * 1024
const TYPES: Record<string, string> = { pdf: 'application/pdf', jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png' }

const plain = (id: unknown) => String(id ?? '').trim().replace(/\.0+$/, '')
const strategy = (s: unknown) => String(s || '').replace(/^QODE ADVISORS LLP\s*-\s*/i, '').toLowerCase().replace(/\b\w/g, c => c.toUpperCase()).trim()

async function listAll(prefix: string): Promise<_Object[]> {
  const out: _Object[] = []
  let token: string | undefined
  do {
    const r = await s3.send(new ListObjectsV2Command({ Bucket: BUCKET, Prefix: prefix, ContinuationToken: token }))
    out.push(...(r.Contents || []).filter(o => o.Key && !o.Key.endsWith('/')))
    token = r.NextContinuationToken
  } while (token)
  return out
}

/** The storage folder of a client: the existing one (plain or ".0"), else the plain id. */
async function folderFor(clientId: string): Promise<string> {
  for (const f of [plain(clientId), `${plain(clientId)}.0`]) {
    const r = await s3.send(new ListObjectsV2Command({ Bucket: BUCKET, Prefix: `${ROOT}${f}/`, MaxKeys: 1 }))
    if ((r.KeyCount ?? 0) > 0) return f
  }
  return plain(clientId)
}

async function clientExists(clientId: string) {
  const r = await query(`SELECT 1 FROM pms_clients_master WHERE regexp_replace(clientid, '\\.0+$', '') = $1 LIMIT 1`, [plain(clientId)])
  return r.rows.length > 0
}

export async function GET(req: NextRequest) {
  const { error } = await requireAdmin(req, 'staff')
  if (error) return error
  try {
    const ids = req.nextUrl.searchParams.getAll('clientId').map(plain).filter(Boolean)
    if (ids.length) {
      const files = (await Promise.all([...new Set(ids)].map(async id => {
        const folder = await folderFor(id)
        const objs = await listAll(`${ROOT}${folder}/`)
        return Promise.all(objs.map(async o => {
          const key = o.Key!
          const parts = key.slice(ROOT.length).split('/')
          return {
            key, clientId: id, section: parts.length > 2 ? parts[1] : '(no section)', filename: parts[parts.length - 1],
            size: o.Size ?? 0, lastModified: o.LastModified ?? null,
            url: await getSignedUrl(s3, new GetObjectCommand({ Bucket: BUCKET, Key: key }), { expiresIn: 900 }),
          }
        }))
      }))).flat()
      return NextResponse.json({ files: files.sort((a, b) => a.section.localeCompare(b.section) || a.filename.localeCompare(b.filename) || a.clientId.localeCompare(b.clientId)) })
    }

    // coverage: per client folder, files per section
    const counts = new Map<string, Record<string, number>>()
    for (const o of await listAll(ROOT)) {
      const parts = o.Key!.slice(ROOT.length).split('/')
      const id = plain(parts[0]); const section = parts.length > 2 ? parts[1] : '(no section)'
      const c = counts.get(id) || {}; c[section] = (c[section] || 0) + 1; counts.set(id, c)
    }
    const r = await query(
      `SELECT clientid, clientcode, trim(clientname) AS name, lower(trim(email)) AS email, upper(trim(pannumber)) AS pan, schemename,
              (maturity_date IS NOT NULL AND maturity_date <= NOW()) AS closed
         FROM pms_clients_master
        WHERE clientid IS NOT NULL AND clientcode IS NOT NULL AND clientcode ~* '^Q' AND clientcode !~* '^QLF'
        ORDER BY clientname, clientcode`)
    // folders first (one per client id), then folders grouped into clients
    const folders = new Map<string, any>()
    for (const x of r.rows as any[]) {
      const id = plain(x.clientid)
      const f = folders.get(id) || { clientId: id, name: x.name, email: x.email, pan: x.pan, codes: [] as { code: string; strategy: string; closed: boolean }[], closed: true }
      f.codes.push({ code: x.clientcode, strategy: strategy(x.schemename), closed: !!x.closed })
      f.closed = f.closed && !!x.closed
      folders.set(id, f)
    }
    const groups = new Map<string, any[]>()
    for (const f of folders.values()) {
      const k = /^[A-Z]{5}\d{4}[A-Z]$/.test(f.pan || '') ? 'pan:' + f.pan : f.email ? 'email:' + f.email : 'id:' + f.clientId
      groups.set(k, [...(groups.get(k) || []), f])
    }
    const hasAll = (cnt: Record<string, number>) => REQUIRED.every(s => (cnt[s] || 0) > 0)
    const clients = [...groups.values()].map(fs => {
      fs.sort((a, b) => a.codes[0].code.localeCompare(b.codes[0].code))
      const withCounts = fs.map(f => ({ clientId: f.clientId, codes: f.codes, closed: f.closed, counts: counts.get(f.clientId) || {} }))
      const open = withCounts.filter(f => !f.closed)
      const judged = open.length ? open : withCounts   // a closed account's folder doesn't hold an open client back
      const cnt: Record<string, number> = {}
      for (const f of withCounts) for (const [s, n] of Object.entries(f.counts)) cnt[s] = Math.max(cnt[s] || 0, n as number)
      const missingIn = judged.filter(f => !hasAll(f.counts)).flatMap(f => f.codes.filter((c: any) => !c.closed || !open.length).map((c: any) => c.code))
      const any = withCounts.some(f => Object.keys(f.counts).length)
      return {
        clientId: fs[0].clientId, clientIds: fs.map(f => f.clientId), name: fs[0].name, email: fs[0].email,
        codes: fs.flatMap(f => f.codes), folders: withCounts, closed: fs.every(f => f.closed),
        counts: cnt, total: Object.values(cnt).reduce((a, b) => a + b, 0), missingIn,
        status: judged.every(f => hasAll(f.counts)) ? 'complete' : any ? 'partial' : 'none',
      }
    }).sort((a, b) => String(a.name).localeCompare(String(b.name)))
    return NextResponse.json({ sections: SECTIONS, required: REQUIRED, clients })
  } catch (e: any) {
    console.error('[admin/bo/documents] GET', e)
    return NextResponse.json({ error: 'Could not read the document store: ' + (e?.message || 'unknown error') }, { status: 502 })
  }
}

export async function POST(req: NextRequest) {
  const { admin, error } = await requireAdmin(req, 'super')
  if (error) return error
  let form: FormData
  try { form = await req.formData() } catch { return NextResponse.json({ error: 'Send the file as multipart form data' }, { status: 400 }) }
  const clientIds = [...new Set(form.getAll('clientId').map(plain).filter(Boolean))]
  const section = String(form.get('section') || '')
  const file = form.get('file')
  const overwrite = form.get('overwrite') === '1'
  if (!clientIds.length) return NextResponse.json({ error: 'Unknown investor' }, { status: 400 })
  for (const id of clientIds) if (!(await clientExists(id))) return NextResponse.json({ error: 'Unknown investor' }, { status: 400 })
  if (!SECTIONS.includes(section)) return NextResponse.json({ error: 'Choose one of: ' + SECTIONS.join(', ') }, { status: 400 })
  if (!(file instanceof File)) return NextResponse.json({ error: 'No file' }, { status: 400 })
  const filename = file.name.replace(/[\\/]/g, '_').replace(/[^\w .()&,+-]/g, '_').trim()
  const ext = filename.split('.').pop()?.toLowerCase() || ''
  if (!TYPES[ext]) return NextResponse.json({ error: 'Only PDF, JPG and PNG files' }, { status: 400 })
  if (file.size > MAX_BYTES) return NextResponse.json({ error: `Larger than ${MAX_BYTES / 1024 / 1024} MB` }, { status: 400 })
  if (!file.size) return NextResponse.json({ error: 'Empty file' }, { status: 400 })

  // The same file into every folder of the client (each strategy account); a folder that already has it is left
  // alone unless overwrite.
  const body = Buffer.from(await file.arrayBuffer())
  const keys: string[] = [], existed: string[] = []
  try {
    for (const id of clientIds) {
      const key = `${ROOT}${await folderFor(id)}/${section}/${filename}`
      if (!overwrite && await s3.send(new HeadObjectCommand({ Bucket: BUCKET, Key: key })).then(() => true, () => false)) { existed.push(key); continue }
      await s3.send(new PutObjectCommand({ Bucket: BUCKET, Key: key, Body: body, ContentType: TYPES[ext] }))
      await audit(req, admin!, 'documents.upload', id, { key, size: file.size, overwrite })
      keys.push(key)
    }
    if (!keys.length) return NextResponse.json({ error: 'A file with this name is already there', code: 'EXISTS', existed }, { status: 409 })
    return NextResponse.json({ keys, existed })
  } catch (e: any) {
    console.error('[admin/bo/documents] POST', e)
    return NextResponse.json({ error: 'Upload failed: ' + (e?.message || 'unknown error'), keys }, { status: 502 })
  }
}

export async function DELETE(req: NextRequest) {
  const { admin, error } = await requireAdmin(req, 'super')
  if (error) return error
  const key = req.nextUrl.searchParams.get('key') || ''
  if (!key.startsWith(ROOT) || key.includes('..') || key.endsWith('/')) return NextResponse.json({ error: 'Not a vault file' }, { status: 400 })
  const dest = `${REMOVED}${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}/${key.slice(ROOT.length)}`
  try {
    await s3.send(new CopyObjectCommand({ Bucket: BUCKET, Key: dest, CopySource: encodeURI(`${BUCKET}/${key}`) }))
    await s3.send(new DeleteObjectCommand({ Bucket: BUCKET, Key: key }))
    await audit(req, admin!, 'documents.remove', key.slice(ROOT.length).split('/')[0], { key, movedTo: dest })
    return NextResponse.json({ movedTo: dest })
  } catch (e: any) {
    console.error('[admin/bo/documents] DELETE', e)
    return NextResponse.json({ error: 'Could not remove: ' + (e?.message || 'unknown error') }, { status: 502 })
  }
}
