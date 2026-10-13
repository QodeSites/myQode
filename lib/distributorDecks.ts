// The decks partners download and share, read from the E2E object store the way newsletters and perspectives are:
// each kind has one folder per month, and the newest month wins.
//   docs/pitchdecks/<Mon-YYYY>/…        the corporate overview
//   docs/strategy-decks/<Mon-YYYY>/…    one deck per strategy  ("Qode All Weather.pdf")
//   docs/factsheets/<Mon-YYYY>/…        one factsheet per strategy
// Uploading next month's folder is all it takes: no code change, no deploy. A strategy missing from the newest
// month keeps its last file. The slugs are the ones the apps already use ('qode-all-weather', '…-factsheet',
// 'corporate-overview'), so an installed app downloads the new file without an update. If the store cannot be
// read, the list and files bundled with the server (lib/distributorDocuments.ts, assets/documents) are used.
import { ListObjectsV2Command, GetObjectCommand } from '@aws-sdk/client-s3'
import { s3 } from '@/lib/s3'
import { DISTRIBUTOR_DOCUMENTS, type DistributorDocument } from '@/lib/distributorDocuments'

const BUCKET = 'qode-static-assets'
export type Deck = DistributorDocument & { /** Object key in the store; absent for a bundled fallback file. */ key?: string }

const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december']
// "Sep-2026", "Sept-2025" → { t: sortable, label: "September 2026" }
function month(folder: string): { t: number; label: string } | null {
  const m = folder.match(/^([A-Za-z]{3,9})[-_ ](\d{4})$/)
  const i = m ? MONTHS.findIndex(x => x.startsWith(m[1].toLowerCase().slice(0, 3))) : -1
  return m && i >= 0 ? { t: Number(m[2]) * 12 + i, label: `${MONTHS[i][0].toUpperCase()}${MONTHS[i].slice(1)} ${m[2]}` } : null
}
// "Qode Growth fund_.pdf", "Qode All Weather Overview.pdf" → "Qode Growth Fund", "Qode All Weather"
const strategyName = (file: string) => file.replace(/\.pdf$/i, '').replace(/[_]+/g, ' ').replace(/\b(overview|factsheet|deck)\b/gi, '').replace(/\s+/g, ' ').trim()
  .replace(/\b\w+/g, w => w[0].toUpperCase() + w.slice(1).toLowerCase())
const slugOf = (name: string) => name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
const HIDDEN = /future horizons/i   // not offered to new investors (QFH)

async function newest(prefix: string) {
  const out = new Map<string, { key: string; t: number; label: string; file: string }>()
  let token: string | undefined
  do {
    const r = await s3.send(new ListObjectsV2Command({ Bucket: BUCKET, Prefix: prefix + '/', ContinuationToken: token }))
    for (const o of r.Contents || []) {
      const key = String(o.Key || ''), parts = key.split('/'), file = parts.pop() || '', mo = month(parts.pop() || '')
      if (!mo || !/\.pdf$/i.test(file) || HIDDEN.test(file)) continue
      const name = prefix.endsWith('pitchdecks') ? 'corporate' : strategyName(file)
      const had = out.get(name.toLowerCase())
      if (!had || mo.t > had.t) out.set(name.toLowerCase(), { key, t: mo.t, label: mo.label, file: name })
    }
    token = r.IsTruncated ? r.NextContinuationToken : undefined
  } while (token)
  return out
}

let cache: { at: number; decks: Deck[] } | null = null
/** The current decks, corporate overview first, then each strategy's deck and factsheet. Cached for 5 minutes. */
export async function currentDecks(): Promise<Deck[]> {
  if (cache && Date.now() - cache.at < 5 * 60000) return cache.decks
  try {
    const [pitch, decks, sheets] = await Promise.all([newest('docs/pitchdecks'), newest('docs/strategy-decks'), newest('docs/factsheets')])
    const list: Deck[] = []
    const corp = pitch.get('corporate')
    if (corp) list.push({ slug: 'corporate-overview', title: 'Corporate overview', asOf: corp.label, downloadName: 'Qode Corporate Overview.pdf', key: corp.key })
    for (const name of [...new Set([...decks.keys(), ...sheets.keys()])].sort()) {
      const d = decks.get(name), f = sheets.get(name), strategy = (d || f)!.file
      if (d) list.push({ slug: slugOf(strategy), title: strategy, asOf: d.label, strategy, downloadName: `${strategy}.pdf`, key: d.key })
      if (f) list.push({ slug: `${slugOf(strategy)}-factsheet`, title: `${strategy} Factsheet`, asOf: f.label, strategy, kind: 'factsheet', downloadName: `${strategy} Factsheet.pdf`, key: f.key })
    }
    if (!list.length) throw new Error('no decks in the store')
    cache = { at: Date.now(), decks: list }
    return list
  } catch (e) {
    console.error('[distributorDecks] store unavailable, using the bundled decks:', (e as Error).message)
    return [...DISTRIBUTOR_DOCUMENTS]
  }
}
export const deckBySlug = async (slug: string) => (await currentDecks()).find(d => d.slug === slug) ?? null

/** The PDF itself, from the store; null when it cannot be read (the caller falls back to the bundled file). */
export async function deckFile(deck: Deck): Promise<Buffer | null> {
  if (!deck.key) return null
  try {
    const r = await s3.send(new GetObjectCommand({ Bucket: BUCKET, Key: deck.key }))
    return Buffer.from(await r.Body!.transformToByteArray())
  } catch (e) {
    console.error('[distributorDecks] could not read', deck.key, (e as Error).message)
    return null
  }
}
