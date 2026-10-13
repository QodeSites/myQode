// GET /api/admin/bo/families (staff): every family (pms_clients_master.groupid) with two or more people, who its
// head is (head_of_family), and how each member gets to their account: their own login, through the head's login
// (a head sees every account in the family), or not at all yet.
// A person is one email (several accounts count once); an account with no email is its own person, who cannot have a login.
import { NextRequest, NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/adminAuth'
import { query } from '@/lib/db'

export const dynamic = 'force-dynamic'

type Access = 'own_login' | 'through_head' | 'none'
type Member = { name: string; email: string | null; accounts: string[]; isHead: boolean; hasLogin: boolean; lastSignedIn: string | null; access: Access }

export async function GET(req: NextRequest) {
  const { error } = await requireAdmin(req, 'staff')
  if (error) return error
  try {
    const rows = (await query(
      `SELECT groupid::text AS gid, max(trim(groupname)) AS gname,
              coalesce(nullif(lower(trim(email)), ''), 'code:' || min(clientcode)) AS person, nullif(lower(trim(max(email))), '') AS email,
              (array_agg(trim(regexp_replace(clientname, '\\s+', ' ', 'g')) ORDER BY head_of_family DESC NULLS LAST, clientcode))[1] AS name,
              array_agg(DISTINCT clientcode ORDER BY clientcode) AS accounts,
              coalesce(bool_or(head_of_family), false) AS is_head,
              bool_or(coalesce(trim(email), '') <> '' AND (password_set_at IS NOT NULL OR coalesce(password, '') NOT IN ('', 'Qode@123') OR first_login_at IS NOT NULL
                      OR last_login_at IS NOT NULL OR first_app_login_at IS NOT NULL OR first_web_login_at IS NOT NULL)) AS has_login,
              max(greatest(last_login_at::timestamptz, last_web_login_at, last_app_login_at)) AS last_seen
         FROM pms_clients_master
        WHERE clientcode ~* '^Q' AND groupid IS NOT NULL AND (maturity_date IS NULL OR maturity_date > NOW())
        GROUP BY groupid, nullif(lower(trim(email)), ''), CASE WHEN coalesce(trim(email), '') = '' THEN clientcode END`)).rows
    const byFamily = new Map<string, { name: string; people: any[] }>()
    for (const r of rows) { const f = byFamily.get(r.gid) ?? { name: r.gname || '', people: [] as any[] }; f.people.push(r); byFamily.set(r.gid, f) }
    const title = (s: string) => s.replace(/\s+/g, ' ').trim().toLowerCase().replace(/\b\w/g, c => c.toUpperCase())
    const families = [...byFamily.entries()].filter(([, f]) => f.people.length > 1).map(([id, f]) => {
      const heads = f.people.filter(p => p.is_head), head = heads[0] ?? null
      const headLogin = !!head?.has_login
      const members: Member[] = f.people.map(p => ({
        name: p.name, email: p.email, accounts: p.accounts, isHead: !!p.is_head, hasLogin: !!p.has_login,
        lastSignedIn: p.last_seen ? new Date(p.last_seen).toISOString() : null,
        access: (p.has_login ? 'own_login' : headLogin && !p.is_head ? 'through_head' : 'none') as Access,
      })).sort((a, b) => Number(b.isHead) - Number(a.isHead) || a.name.localeCompare(b.name))
      return { id, name: title(f.name || head?.name || members[0].name).replace(/\s+family$/i, ''), head: head ? { name: head.name, email: head.email, hasLogin: headLogin } : null,
        people: members.length, accounts: members.reduce((n, m) => n + m.accounts.length, 0), members }
    }).sort((a, b) => a.name.localeCompare(b.name))
    const others = families.flatMap(f => f.members.filter(m => !m.isHead))
    return NextResponse.json({
      generatedAt: new Date().toISOString(), families,
      summary: {
        families: families.length, people: families.reduce((n, f) => n + f.people, 0), members: others.length,
        ownLogin: others.filter(m => m.access === 'own_login').length, throughHead: others.filter(m => m.access === 'through_head').length,
        noAccess: others.filter(m => m.access === 'none').length,
        headNoLogin: families.filter(f => f.head && !f.head.hasLogin).length, noHead: families.filter(f => !f.head).length,
      },
    })
  } catch (e) {
    console.error('[bo/families]', e)
    return NextResponse.json({ error: 'Could not load the families' }, { status: 500 })
  }
}
