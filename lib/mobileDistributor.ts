// Distributor (partner) support for the mobile API — /api/mobile/distributor/*.
//
// Web logic first: this is a port of what the web's distributor routes do, not a new rule.
//   - Role check  = lib/distributorIdentity.resolveDistributorByEmail (clientcode IS NULL), re-run on
//                   every request. The isDistributor flag in the JWT only decides which shell the app
//                   shows; it never grants data on its own.
//   - Book        = app/api/distributor/journey (Zoho journey + portal codes scoped by intermediaryname)
//   - Split       = app/api/distributor/strategy-aum (latest pms_master_sheet value, intersected with the
//                   Zoho investor emails AND intermediaryname)
// The web routes read the unsigned qode-user-context cookie; here the identity comes from the signed
// mobile JWT instead. Nothing the client sends selects a distributor or an account.
import { NextRequest, NextResponse } from 'next/server'
import { verifyMobileAuth, type MobileAuthUser } from '@/lib/mobileAuth'
import {
  resolveDistributorByEmail,
  getDistributorClientCount,
  type DistributorIdentity,
} from '@/lib/distributorIdentity'
import { getJourneyForDistributor, getOnboardingStages } from '@/lib/zohoDistributorJourney'
import { query } from '@/lib/db'

export async function requireMobileDistributor(request: NextRequest): Promise<{
  user: MobileAuthUser | null
  distributor: DistributorIdentity | null
  error: NextResponse | null
}> {
  const { user, error } = await verifyMobileAuth(request)
  if (error) return { user: null, distributor: null, error }
  if (user!.isReviewer || user!.isImpersonated) {
    return { user, distributor: null, error: NextResponse.json({ error: 'Not a distributor' }, { status: 403 }) }
  }
  const distributor = await resolveDistributorByEmail(user!.email)
  if (!distributor) {
    return { user, distributor: null, error: NextResponse.json({ error: 'Not a distributor', code: 'NOT_DISTRIBUTOR' }, { status: 403 }) }
  }
  return { user, distributor, error: null }
}

const ONBOARDING_BASE = 'https://onboarding.qodeinvest.com'

// Same as the web: the slug is stored, never derived (two partners share one email with different slugs).
export function referralLinks(slug: string | null) {
  if (!slug) return null
  const s = encodeURIComponent(slug)
  return { individual: `${ONBOARDING_BASE}/${s}`, nonIndividual: `${ONBOARDING_BASE}/ni/${s}` }
}

// Port of GET /api/distributor/journey (same payload shape).
export async function distributorJourney(distributor: DistributorIdentity) {
  const portalClientCount = await getDistributorClientCount(distributor.clientname)

  // Zoho is enrichment: if it is unreachable the referral links and portal counts still render.
  let journey: Awaited<ReturnType<typeof getJourneyForDistributor>> = null
  let zohoAvailable = true
  let crmLinked = true
  try {
    journey = await getJourneyForDistributor(distributor.email)
    crmLinked = journey !== null
  } catch (err) {
    console.error('[mobile/distributor/journey] Zoho lookup failed:', err)
    zohoAvailable = false
  }

  let onboardingStages = new Map<string, string>()
  try { onboardingStages = await getOnboardingStages() } catch (err) {
    console.error('[mobile/distributor/journey] onboarding stage lookup failed:', err)
  }

  // Portal client code per investor email, scoped to THIS distributor's own book (intermediaryname).
  const codeByEmail = new Map<string, string>()
  try {
    const codes = await query(
      `SELECT lower(email) AS email, clientcode
         FROM pms_clients_master
        WHERE intermediaryname = $1
          AND clientcode IS NOT NULL
          AND email IS NOT NULL`,
      [distributor.clientname],
    )
    for (const row of codes.rows ?? []) {
      if (row.email && !codeByEmail.has(String(row.email))) codeByEmail.set(String(row.email), String(row.clientcode))
    }
  } catch (err) {
    console.error('[mobile/distributor/journey] client code lookup failed:', err)
  }

  if (journey) {
    // lastConversation is an internal CRM note: the web hides it on screen but still sends it; the app never
    // receives it at all.
    journey.clients = journey.clients.map(({ lastConversation, ...c }: any) => ({
      ...c,
      clientCode: codeByEmail.get(String(c.email ?? '').trim().toLowerCase()) ?? null,
      onboardingStage: onboardingStages.get(String(c.email ?? '').trim().toLowerCase()) ?? null,
    })) as typeof journey.clients
  }

  // Nulls are skipped rather than counted as zero (unfilled CRM amounts show no total, not a false zero).
  const clients = journey?.clients ?? []
  const priced = clients.filter((c) => c.investedAmount != null).length
  const invested = clients.reduce((sum, c) => sum + (c.investedAmount ?? 0), 0)
  const currentValue = clients.reduce((sum, c) => sum + (c.currentValue ?? 0), 0)

  return {
    distributor: { name: distributor.clientname, email: distributor.email },
    referralLinks: referralLinks(distributor.referralSlug),
    journey: journey ? { clients: journey.clients, stageCounts: journey.stageCounts } : null,
    totals: {
      investors: clients.length,
      invested: priced ? invested : null,
      currentValue: priced ? currentValue : null,
      pricedCount: priced,
    },
    zohoAvailable,
    crmLinked,
    portalClientCount,
  }
}

const STRATEGY_BY_PREFIX: Record<string, string> = {
  QAW: 'Qode All Weather',
  QGF: 'Qode Growth Fund',
  QTF: 'Qode Tactical Fund',
}

// Port of GET /api/distributor/strategy-aum (same payload shape).
export async function distributorStrategyAum(distributor: DistributorIdentity) {
  // Investors Zoho attributes to this partner, matched by EMAIL (names differ between the systems).
  const journey = await getJourneyForDistributor(distributor.email)
  const ownEmails = [...new Set((journey?.clients ?? []).map((c) => String(c.email ?? '').trim().toLowerCase()).filter(Boolean))]
  if (!ownEmails.length) return { strategies: [], total: 0, valuedOn: null as string | null }

  const result = await query(
    `WITH latest AS (
       SELECT DISTINCT ON (ms.account_code)
              ms.account_code, ms.portfolio_value, ms.report_date
         FROM public.pms_master_sheet ms
        WHERE ms.portfolio_value IS NOT NULL
        ORDER BY ms.account_code, ms.report_date DESC
     )
     SELECT SUBSTRING(l.account_code FROM 1 FOR 3) AS prefix,
            COUNT(*)::int AS accounts,
            COUNT(DISTINCT cm.clientname)::int AS investors,
            SUM(l.portfolio_value)::float8 AS value,
            MAX(l.report_date) AS valued_on
       FROM latest l
       JOIN pms_clients_master cm ON cm.clientcode = l.account_code
      WHERE cm.intermediaryname = $1
        AND lower(btrim(cm.email)) = ANY($2)
      GROUP BY 1`,
    [distributor.clientname, ownEmails],
  )

  let total = 0
  let valuedOn: string | null = null
  const rows = (result.rows ?? [])
    .map((r: Record<string, unknown>) => {
      const value = Number(r.value) || 0
      total += value
      const d = r.valued_on instanceof Date ? r.valued_on.toISOString().slice(0, 10) : r.valued_on ? String(r.valued_on).slice(0, 10) : null
      if (d && (!valuedOn || d > valuedOn)) valuedOn = d
      return {
        name: STRATEGY_BY_PREFIX[String(r.prefix)] ?? String(r.prefix),
        value,
        investors: Number(r.investors) || 0,
        accounts: Number(r.accounts) || 0,
        pct: 0,
      }
    })
    .filter((r) => r.value > 0)
  for (const r of rows) r.pct = total > 0 ? (r.value / total) * 100 : 0
  rows.sort((a, b) => b.value - a.value)
  return { strategies: rows, total, valuedOn }
}

// ── Signed download links (statements, decks) ────────────────────────────────
// The app opens PDFs in the phone's browser/viewer, which cannot send the app's Authorization header. So the
// app asks for a link (authenticated, ownership checked there), and gets a URL that is valid for 5 minutes, bound
// to this partner and this one file, signed with JWT_SECRET.
import crypto from 'crypto'

export type FileKind = 'soa' | 'deck'
const sign = (distributorEmail: string, kind: FileKind, key: string, exp: number) =>
  crypto.createHmac('sha256', process.env.JWT_SECRET!).update(`distfile|${distributorEmail}|${kind}|${key}|${exp}`).digest('hex')

export function fileLink(distributorEmail: string, kind: FileKind, key: string) {
  const exp = Date.now() + 5 * 60 * 1000
  const q = new URLSearchParams({ d: distributorEmail, kind, key, exp: String(exp), t: sign(distributorEmail, kind, key, exp) })
  return '/api/mobile/distributor/file?' + q.toString()
}

export function verifyFileLink(distributorEmail: string, kind: string, key: string, exp: number, token: string) {
  if (kind !== 'soa' && kind !== 'deck') return false
  if (!exp || exp < Date.now()) return false
  const want = Buffer.from(sign(distributorEmail, kind, key, exp))
  const got = Buffer.from(String(token || ''))
  return want.length === got.length && crypto.timingSafeEqual(want, got)
}

// Is this investor email in the partner's own book? (web: investor-soa ownership check)
export async function investorInBook(distributor: DistributorIdentity, investorEmail: string) {
  const target = String(investorEmail || '').trim().toLowerCase()
  if (!target) return false
  const journey = await getJourneyForDistributor(distributor.email)
  return (journey?.clients ?? []).some((c) => String(c.email ?? '').trim().toLowerCase() === target)
}
