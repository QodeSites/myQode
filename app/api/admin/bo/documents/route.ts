// Admin → Documents: which clients' Client Document Vault has documents, and uploading the missing ones.
//
// Storage: bucket qode-static-assets, docs/client-documents/<clientid folder>/<section>/<file>. The folder is the
// client's pms_clients_master.clientid, usually without the ".0" the database stores (184 of 189 folders on
// 4 Oct 2026); the vault pages look in both. Uploads go into the folder that already exists for the client,
// else the plain id. "Remove" moves a file to docs/client-documents-removed/ (recoverable), never deletes it.
//
// GET    (staff)                       → { sections, clients: [{ clientId, folder, name, email, codes, closed, counts }] }
// GET    (staff)  ?clientId=…          → { folder, files: [{ key, section, filename, size, lastModified, url }] }
// POST   (super)  multipart: clientId, section, file, [overwrite=1]
//                                       → { key } — 409 when a file with that name is already there
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
  const clientId = req.nextUrl.searchParams.get('clientId')
  try {
    if (clientId) {
      const folder = await folderFor(clientId)
      const objs = await listAll(`${ROOT}${folder}/`)
      const files = await Promise.all(objs.map(async o => {
        const key = o.Key!
        const parts = key.slice(ROOT.length).split('/')
        return {
          key, section: parts.length > 2 ? parts[1] : '(no section)', filename: parts[parts.length - 1],
          size: o.Size ?? 0, lastModified: o.LastModified ?? null,
          url: await getSignedUrl(s3, new GetObjectCommand({ Bucket: BUCKET, Key: key }), { expiresIn: 900 }),
        }
      }))
      return NextResponse.json({ folder, files: files.sort((a, b) => a.section.localeCompare(b.section) || a.filename.localeCompare(b.filename)) })
    }

    // coverage: per client folder, files per section
    const counts = new Map<string, Record<string, number>>()
    for (const o of await listAll(ROOT)) {
      const parts = o.Key!.slice(ROOT.length).split('/')
      const id = plain(parts[0]); const section = parts.length > 2 ? parts[1] : '(no section)'
      const c = counts.get(id) || {}; c[section] = (c[section] || 0) + 1; counts.set(id, c)
    }
    const r = await query(
      `SELECT clientid, clientcode, trim(clientname) AS name, lower(trim(email)) AS email, schemename,
              (maturity_date IS NOT NULL AND maturity_date <= NOW()) AS closed
         FROM pms_clients_master
        WHERE clientid IS NOT NULL AND clientcode IS NOT NULL AND clientcode ~* '^Q' AND clientcode !~* '^QLF'
        ORDER BY clientname, clientcode`)
    const byId = new Map<string, any>()
    for (const x of r.rows as any[]) {
      const id = plain(x.clientid)
      const c = byId.get(id) || { clientId: id, name: x.name, email: x.email, codes: [] as { code: string; strategy: string; closed: boolean }[], closed: true }
      c.codes.push({ code: x.clientcode, strategy: strategy(x.schemename), closed: !!x.closed })
      c.closed = c.closed && !!x.closed
      byId.set(id, c)
    }
    const clients = [...byId.values()].map(c => {
      const cnt = counts.get(c.clientId) || {}
      const have = REQUIRED.filter(s => (cnt[s] || 0) > 0).length
      return { ...c, counts: cnt, total: Object.values(cnt).reduce((a: number, b) => a + (b as number), 0),
               status: have === REQUIRED.length ? 'complete' : Object.keys(cnt).length ? 'partial' : 'none' }
    })
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
  const clientId = plain(form.get('clientId'))
  const section = String(form.get('section') || '')
  const file = form.get('file')
  const overwrite = form.get('overwrite') === '1'
  if (!clientId || !(await clientExists(clientId))) return NextResponse.json({ error: 'Unknown investor' }, { status: 400 })
  if (!SECTIONS.includes(section)) return NextResponse.json({ error: 'Choose one of: ' + SECTIONS.join(', ') }, { status: 400 })
  if (!(file instanceof File)) return NextResponse.json({ error: 'No file' }, { status: 400 })
  const filename = file.name.replace(/[\\/]/g, '_').replace(/[^\w .()&,+-]/g, '_').trim()
  const ext = filename.split('.').pop()?.toLowerCase() || ''
  if (!TYPES[ext]) return NextResponse.json({ error: 'Only PDF, JPG and PNG files' }, { status: 400 })
  if (file.size > MAX_BYTES) return NextResponse.json({ error: `Larger than ${MAX_BYTES / 1024 / 1024} MB` }, { status: 400 })
  if (!file.size) return NextResponse.json({ error: 'Empty file' }, { status: 400 })

  const folder = await folderFor(clientId)
  const key = `${ROOT}${folder}/${section}/${filename}`
  try {
    if (!overwrite) {
      const exists = await s3.send(new HeadObjectCommand({ Bucket: BUCKET, Key: key })).then(() => true, () => false)
      if (exists) return NextResponse.json({ error: 'A file with this name is already there', code: 'EXISTS', key }, { status: 409 })
    }
    await s3.send(new PutObjectCommand({ Bucket: BUCKET, Key: key, Body: Buffer.from(await file.arrayBuffer()), ContentType: TYPES[ext] }))
    await audit(req, admin!, 'documents.upload', clientId, { key, size: file.size, overwrite })
    return NextResponse.json({ key })
  } catch (e: any) {
    console.error('[admin/bo/documents] POST', e)
    return NextResponse.json({ error: 'Upload failed: ' + (e?.message || 'unknown error') }, { status: 502 })
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
