// GET /api/mobile/distributor/decks → { decks: [{ slug, title, asOf, strategy?, kind? }] }
// The decks a partner can download right now: the newest month of each in the object store (lib/distributorDecks.ts).
// The apps list these and fetch a file with POST /api/mobile/distributor/file-link { kind: 'deck', slug }.
import { NextRequest, NextResponse } from 'next/server'
import { requireMobileDistributor } from '@/lib/mobileDistributor'
import { currentDecks } from '@/lib/distributorDecks'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  const { error } = await requireMobileDistributor(request)
  if (error) return error
  const decks = await currentDecks()
  return NextResponse.json({ decks: decks.map(({ slug, title, asOf, strategy, kind }) => ({ slug, title, asOf, strategy: strategy ?? null, kind: kind ?? 'deck' })) })
}
