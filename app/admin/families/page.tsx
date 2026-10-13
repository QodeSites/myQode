"use client"

// Families: who is mapped to whom. Each family (two or more people under one family record), its head, and how
// every member reaches their account: their own login, through the head's login, or not at all yet.
// Data: GET /api/admin/bo/families.
import { useCallback, useEffect, useMemo, useState } from "react"
import Link from "next/link"
import { Crown, Download, RefreshCw, Search, Users } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Skeleton } from "@/components/ui/skeleton"
import { EmptyState, ErrorNote, PageHeader, Panel, Pill, boFetch, errorMessage, fmtNum, fmtRelative } from "@/components/admin-kit"
import { cn } from "@/lib/utils"
import { downloadXlsx } from "@/lib/xlsxWriter"

type Access = "own_login" | "through_head" | "none"
type Member = { name: string; email: string | null; accounts: string[]; isHead: boolean; hasLogin: boolean; lastSignedIn: string | null; access: Access }
type Family = { id: string; name: string; head: { name: string; email: string | null; hasLogin: boolean } | null; people: number; accounts: number; members: Member[] }
type Data = { generatedAt: string; families: Family[]; summary: Record<string, number> }

const ACCESS: Record<Access, { label: string; tone: "green" | "blue" | "red"; meaning: string }> = {
  own_login: { label: "Has their own login", tone: "green", meaning: "They set up a password and sign in themselves." },
  through_head: { label: "Seen through the family head", tone: "blue", meaning: "No login of their own. The family head's login shows their account." },
  none: { label: "No access yet", tone: "red", meaning: "No login of their own, and the family head has not set one up either." },
}
type Filter = "all" | Access | "head_no_login"
const FILTERS: { key: Filter; label: string; test: (f: Family) => boolean }[] = [
  { key: "all", label: "All families", test: () => true },
  { key: "through_head", label: "Has a member seen through the head", test: (f) => f.members.some((m) => m.access === "through_head") },
  { key: "own_login", label: "Has a member with their own login", test: (f) => f.members.some((m) => !m.isHead && m.access === "own_login") },
  { key: "none", label: "Someone has no access yet", test: (f) => f.members.some((m) => m.access === "none") },
  { key: "head_no_login", label: "Family head has no login", test: (f) => !!f.head && !f.head.hasLogin },
]

export default function FamiliesPage() {
  const [d, setD] = useState<Data | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [filter, setFilter] = useState<Filter>("all")
  const [q, setQ] = useState("")
  const load = useCallback(async () => {
    setLoading(true); setError(null)
    try { setD(await boFetch<Data>("/api/admin/bo/families")) } catch (e) { setError(errorMessage(e)) } finally { setLoading(false) }
  }, [])
  useEffect(() => { load() }, [load])

  const list = useMemo(() => {
    if (!d) return []
    const f = FILTERS.find((x) => x.key === filter)!, s = q.trim().toLowerCase()
    return d.families.filter((x) => f.test(x) && (!s || x.name.toLowerCase().includes(s) || x.members.some((m) => m.name.toLowerCase().includes(s) || (m.email || "").includes(s) || m.accounts.some((a) => a.toLowerCase().includes(s)))))
  }, [d, filter, q])
  const exportAll = () => d && downloadXlsx("myQode-families.xlsx", [{
    name: "Families",
    columns: [{ label: "Family", width: 28 }, { label: "Family head", width: 28 }, { label: "Person", width: 30 }, { label: "Role", width: 14 }, { label: "Email", width: 32 }, { label: "Accounts", width: 26 },
      { label: "Own login", width: 10 }, { label: "How they see their account", width: 30 }, { label: "Last signed in", width: 14, type: "date" }],
    rows: d.families.flatMap((f) => f.members.map((m) => [f.name, f.head?.name ?? "No head marked", m.name, m.isHead ? "Family head" : "Member", m.email ?? "No email on file", m.accounts.join(", "),
      m.hasLogin ? "Yes" : "No", ACCESS[m.access].label, m.lastSignedIn ?? ""])),
  }])
  const S = d?.summary

  return (
    <div className="space-y-6">
      <PageHeader title="Families" description="Who is mapped to whom: each family, its head, and how every member sees their account. A family head's login shows every account in the family."
        actions={<>
          <Button variant="outline" className="bg-white" onClick={load} disabled={loading}><RefreshCw className={cn("h-4 w-4", loading && "animate-spin")} />Refresh</Button>
          <Button className="bg-[#02422B] text-white hover:bg-[#02422B]/90" onClick={exportAll} disabled={!d}><Download className="h-4 w-4" />Download</Button>
        </>} />
      {error ? <ErrorNote message={error} onRetry={load} /> : null}
      {!d && loading ? <div className="space-y-4"><Skeleton className="h-28 w-full" /><Skeleton className="h-96 w-full" /></div> : null}

      {d && S ? <>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {[
            { label: "Families", value: S.families, hint: `${fmtNum(S.people)} people in all: ${fmtNum(S.families)} heads and ${fmtNum(S.members)} members`, f: "all" as Filter },
            { label: "Members seen through the head", value: S.throughHead, hint: "No login of their own; the head's login shows their account", f: "through_head" as Filter },
            { label: "Members with their own login", value: S.ownLogin, hint: "Mapped to a family, and also sign in themselves", f: "own_login" as Filter },
            { label: "Members with no access yet", value: S.noAccess, hint: `${fmtNum(S.headNoLogin)} family ${S.headNoLogin === 1 ? "head has" : "heads have"} no login, so nobody in those families can see anything`, f: "none" as Filter },
          ].map((k) => (
            <button key={k.label} type="button" onClick={() => setFilter(k.f)} className={cn("rounded-xl border bg-[#F9F7EC] p-4 text-left shadow-sm transition hover:border-[#02422B]/40", filter === k.f ? "border-[#02422B]" : "border-[#02422B]/10")}>
              <p className="text-xs font-medium text-muted-foreground">{k.label}</p>
              <p className="mt-2 text-2xl font-bold tabular-nums text-[#002017]">{fmtNum(k.value)}</p>
              <p className="mt-1 text-xs text-muted-foreground">{k.hint}</p>
            </button>
          ))}
        </div>

        <Panel title="Every family" description="Only families with two or more people are listed. Click a name to open that person's admin page." bodyClassName="p-0">
          <div className="space-y-3 border-b border-[#02422B]/10 p-4">
            <div className="relative max-w-sm"><Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search family, person, email or account" className="bg-white pl-9" /></div>
            <div className="flex flex-wrap gap-1.5">
              {FILTERS.map((f) => { const n = d.families.filter(f.test).length
                return <button key={f.key} type="button" onClick={() => setFilter(f.key)} className={cn("rounded-full border px-3 py-1 text-xs font-medium", filter === f.key ? "border-[#02422B] bg-[#02422B] text-white" : "border-[#02422B]/15 bg-white text-[#002017] hover:border-[#02422B]/40")}>
                  {f.label} <span className={filter === f.key ? "text-[#DABD38]" : "text-muted-foreground"}>{fmtNum(n)}</span></button> })}
            </div>
          </div>
          {list.length ? <div className="grid gap-4 p-4 lg:grid-cols-2">
            {list.map((f) => (
              <div key={f.id} className="rounded-xl border border-[#02422B]/10 bg-white">
                <div className="flex items-center justify-between gap-3 border-b border-[#02422B]/10 px-4 py-3">
                  <div className="flex min-w-0 items-center gap-2"><Users className="h-4 w-4 shrink-0 text-[#02422B]" /><h3 className="truncate text-sm font-semibold text-[#002017]">{f.name} family</h3></div>
                  <span className="shrink-0 text-xs text-muted-foreground">{f.people} people · {f.accounts} accounts</span>
                </div>
                <ul>
                  {f.members.map((m) => (
                    <li key={(m.email || "") + m.accounts[0]} className="flex items-start justify-between gap-3 border-b border-[#02422B]/5 px-4 py-3 last:border-b-0">
                      <div className="min-w-0">
                        <p className="flex items-center gap-1.5 text-sm font-medium text-[#002017]">
                          {m.isHead ? <Crown className="h-3.5 w-3.5 shrink-0 text-[#DABD38]" /> : <span className="ml-1 mr-0.5 text-muted-foreground">↳</span>}
                          {m.email ? <Link href={`/admin/users/${encodeURIComponent(m.email)}`} className="truncate underline-offset-2 hover:underline">{m.name}</Link> : <span className="truncate">{m.name}</span>}
                        </p>
                        <p className="mt-0.5 truncate text-xs text-muted-foreground">{m.isHead ? "Family head" : `Mapped to ${f.head?.name ?? "no head"}`} · {m.accounts.join(" · ")}</p>
                        <p className="truncate text-xs text-muted-foreground">{m.email ?? "No email on file"}{m.lastSignedIn ? ` · signed in ${fmtRelative(m.lastSignedIn)}` : ""}</p>
                      </div>
                      <span title={ACCESS[m.access].meaning} className="shrink-0"><Pill tone={ACCESS[m.access].tone}>{m.isHead && m.access === "none" ? "No login yet" : ACCESS[m.access].label}</Pill></span>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div> : <EmptyState title="No families match" description="Try another filter or search." />}
        </Panel>
        <p className="text-xs text-muted-foreground">A family is the family record in the client master (the same grouping the app uses). Someone with several accounts under one email counts once. Clients who are the only person in their family record are not listed.</p>
      </> : null}
    </div>
  )
}
