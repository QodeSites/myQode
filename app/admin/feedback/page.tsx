"use client"

import { useCallback, useEffect, useState } from "react"
import Link from "next/link"
import { ChevronLeft, ChevronRight, MessageSquareHeart, RefreshCw, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Skeleton } from "@/components/ui/skeleton"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import {
  EmptyState,
  ErrorNote,
  KpiCard,
  PageHeader,
  Pill,
  boFetch,
  errorMessage,
  fmtDateTime,
  fmtNum,
  fmtRelative,
} from "@/components/admin-kit"

interface FeedbackItem {
  id: number
  at: string
  email: string | null
  clientCode: string | null
  accountCodes: string[]
  recommend: number
  satisfaction: number
  clarity: number
  ease: number
  comment: string | null
  platform: string | null
  appVersion: string | null
}

interface Summary {
  count: number
  avgRecommend: number | null
  avgSatisfaction: number | null
  avgClarity: number | null
  avgEase: number | null
  promoters: number
  passives: number
  detractors: number
  score: number | null
}

interface FeedbackResponse {
  items: FeedbackItem[]
  page: number
  limit: number
  total: number
  summary: Summary
}

const LIMIT = 50
const avg = (v: number | null) => (v == null ? "None" : `${v.toFixed(2)} / 5`)
const share = (n: number, of: number) => (of ? `${Math.round((n / of) * 100)}% of answers` : undefined)

function Rating({ v }: { v: number }) {
  const tone = v >= 5 ? "green" : v === 4 ? "gold" : v <= 2 ? "red" : "amber"
  return <Pill tone={tone}>{v}</Pill>
}

export default function AdminFeedbackPage() {
  const [data, setData] = useState<FeedbackResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [from, setFrom] = useState("")
  const [to, setTo] = useState("")
  const [page, setPage] = useState(1)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const qs = new URLSearchParams({ page: String(page), limit: String(LIMIT) })
      if (from) qs.set("from", from)
      if (to) qs.set("to", to)
      setData(await boFetch<FeedbackResponse>(`/api/admin/bo/feedback?${qs}`))
    } catch (e) {
      setError(errorMessage(e))
    } finally {
      setLoading(false)
    }
  }, [from, to, page])

  useEffect(() => {
    load()
  }, [load])

  // A new date range starts from the first page.
  useEffect(() => {
    setPage(1)
  }, [from, to])

  const s = data?.summary
  const items = data?.items
  const pages = data ? Math.max(1, Math.ceil(data.total / data.limit)) : 1
  const hasFilters = !!(from || to)

  return (
    <div className="space-y-5">
      <PageHeader
        title="Feedback"
        description="Answers to the app's Your Voice Matters form. Promoters rate 5 for recommending Qode, passives 4, detractors 3 or less."
        actions={
          <Button variant="outline" size="sm" onClick={load} disabled={loading}>
            <RefreshCw className={loading ? "h-4 w-4 animate-spin" : "h-4 w-4"} />
            Refresh
          </Button>
        }
      />

      <div className="flex flex-wrap items-center gap-3">
        <label className="flex items-center gap-2 text-sm text-muted-foreground">
          From
          <Input type="date" value={from} max={to || undefined} onChange={(e) => setFrom(e.target.value)} className="w-[170px] bg-white" />
        </label>
        <label className="flex items-center gap-2 text-sm text-muted-foreground">
          To
          <Input type="date" value={to} min={from || undefined} onChange={(e) => setTo(e.target.value)} className="w-[170px] bg-white" />
        </label>
        {hasFilters ? (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setFrom("")
              setTo("")
            }}
          >
            <X className="h-4 w-4" /> Clear dates
          </Button>
        ) : null}
      </div>

      {error ? <ErrorNote message={error} onRetry={load} /> : null}

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-8">
        {!s && loading ? (
          Array.from({ length: 8 }).map((_, i) => <Skeleton key={i} className="h-[92px] rounded-xl" />)
        ) : s ? (
          <>
            <KpiCard
              label="Recommend score"
              value={s.score == null ? "None" : s.score > 0 ? `+${s.score}` : String(s.score)}
              hint="Promoters minus detractors"
              icon={<MessageSquareHeart className="h-4 w-4" />}
              accent
            />
            <KpiCard label="Answers" value={fmtNum(s.count)} hint={hasFilters ? "In this date range" : "All time"} />
            <KpiCard label="Promoters" value={fmtNum(s.promoters)} hint={share(s.promoters, s.count)} />
            <KpiCard label="Passives" value={fmtNum(s.passives)} hint={share(s.passives, s.count)} />
            <KpiCard label="Detractors" value={fmtNum(s.detractors)} hint={share(s.detractors, s.count)} />
            <KpiCard label="Satisfaction" value={avg(s.avgSatisfaction)} hint="Average" />
            <KpiCard label="Clarity of updates" value={avg(s.avgClarity)} hint="Average" />
            <KpiCard label="Ease of processes" value={avg(s.avgEase)} hint="Average" />
          </>
        ) : null}
      </div>

      <div className="overflow-hidden rounded-xl border border-[#02422B]/10 bg-[#F9F7EC] shadow-sm">
        <Table>
          <TableHeader>
            <TableRow className="bg-[#EFECD3]/60 hover:bg-[#EFECD3]/60">
              <TableHead className="pl-5">When</TableHead>
              <TableHead>Investor</TableHead>
              <TableHead className="text-center">Recommend</TableHead>
              <TableHead className="text-center">Satisfaction</TableHead>
              <TableHead className="text-center">Clarity</TableHead>
              <TableHead className="text-center">Ease</TableHead>
              <TableHead>What could we do better?</TableHead>
              <TableHead className="pr-5">App</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading && !items
              ? Array.from({ length: 10 }).map((_, i) => (
                  <TableRow key={i}>
                    {Array.from({ length: 8 }).map((__, j) => (
                      <TableCell key={j} className={j === 0 ? "pl-5" : undefined}>
                        <Skeleton className="h-4 w-full max-w-[160px]" />
                      </TableCell>
                    ))}
                  </TableRow>
                ))
              : items?.map((f) => (
                  <TableRow key={f.id} className="align-top">
                    <TableCell className="whitespace-nowrap pl-5">
                      <p className="text-sm text-[#002017]">{fmtRelative(f.at)}</p>
                      <p className="text-xs text-muted-foreground">{fmtDateTime(f.at)}</p>
                    </TableCell>
                    <TableCell className="text-sm">
                      {f.email ? (
                        <Link href={`/admin/users/${encodeURIComponent(f.email)}`} className="text-[#02422B] hover:underline">
                          {f.email}
                        </Link>
                      ) : (
                        <span className="text-muted-foreground">Unknown</span>
                      )}
                      <p className="text-xs text-muted-foreground">
                        {[f.clientCode, f.accountCodes.filter((c) => c !== f.clientCode).join(", ")].filter(Boolean).join(" · ")}
                      </p>
                    </TableCell>
                    <TableCell className="text-center"><Rating v={f.recommend} /></TableCell>
                    <TableCell className="text-center"><Rating v={f.satisfaction} /></TableCell>
                    <TableCell className="text-center"><Rating v={f.clarity} /></TableCell>
                    <TableCell className="text-center"><Rating v={f.ease} /></TableCell>
                    <TableCell className="max-w-[420px] whitespace-pre-wrap text-sm text-[#002017]">
                      {f.comment || <span className="text-muted-foreground">No comment</span>}
                    </TableCell>
                    <TableCell className="whitespace-nowrap pr-5 text-xs text-muted-foreground">
                      {[f.platform, f.appVersion].filter(Boolean).join(" ") || "Unknown"}
                    </TableCell>
                  </TableRow>
                ))}
          </TableBody>
        </Table>
        {!loading && items && items.length === 0 ? (
          <EmptyState
            icon={<MessageSquareHeart className="h-5 w-5" />}
            title="No feedback yet"
            description={hasFilters ? "Nothing was submitted in this date range." : "Answers from the app will appear here."}
          />
        ) : null}
        {data && data.total > data.limit ? (
          <div className="flex items-center justify-between border-t border-[#02422B]/10 px-5 py-3 text-sm text-muted-foreground">
            <span>
              Page {data.page} of {pages} ({fmtNum(data.total)} answers)
            </span>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" disabled={loading || page <= 1} onClick={() => setPage((p) => p - 1)}>
                <ChevronLeft className="h-4 w-4" /> Newer
              </Button>
              <Button variant="outline" size="sm" disabled={loading || page >= pages} onClick={() => setPage((p) => p + 1)}>
                Older <ChevronRight className="h-4 w-4" />
              </Button>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  )
}
