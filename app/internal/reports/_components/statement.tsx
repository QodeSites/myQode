"use client"

import type {
  AnyReport,
  CapitalGainsReport,
  DividendsReport,
  ExpensesReport,
  FactsheetReport,
  HoldingReport,
  TransactionsReport,
} from "@/lib/reports/types"
import { REPORT_LABELS, strategyColor } from "@/lib/reports/types"

const inr = new Intl.NumberFormat("en-IN", { maximumFractionDigits: 2 })
const inr0 = new Intl.NumberFormat("en-IN", { maximumFractionDigits: 0 })

function money(n: number | null | undefined, dp = 2): string {
  if (n === null || n === undefined) return "—"
  return (dp === 0 ? inr0 : inr).format(n)
}

function pct(n: number | null | undefined): string {
  if (n === null || n === undefined) return "—"
  return `${n >= 0 ? "" : ""}${n.toFixed(2)}%`
}

function date(s: string | null | undefined): string {
  if (!s) return "—"
  const d = new Date(s)
  if (Number.isNaN(d.getTime())) return s
  return d.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" })
}

/** Red for losses, green for gains — the only place colour carries meaning. */
function Signed({ value, suffix }: { value: number | null; suffix?: string }) {
  if (value === null) return <>—</>
  const negative = value < 0
  return (
    <span className={negative ? "text-[#550E0E]" : "text-[#02422B]"}>
      {suffix === "%" ? pct(value) : money(value)}
      {suffix === "%" ? "" : ""}
    </span>
  )
}

function Th({ children, align = "left" }: { children: React.ReactNode; align?: "left" | "right" }) {
  return (
    <th
      scope="col"
      className={`border-b border-[#37584F]/25 px-2 py-1.5 text-[10px] font-semibold tracking-wide uppercase ${align === "right" ? "text-right" : "text-left"}`}
    >
      {children}
    </th>
  )
}

function Td({
  children,
  align = "left",
  mono,
}: {
  children: React.ReactNode
  align?: "left" | "right"
  mono?: boolean
}) {
  return (
    <td
      className={`border-b border-[#37584F]/10 px-2 py-1 align-top ${align === "right" ? "text-right" : "text-left"} ${mono ? "font-mono" : ""}`}
    >
      {children}
    </td>
  )
}

function EmptyNotice({ text }: { text: string }) {
  return (
    <p className="rounded border border-dashed border-[#37584F]/35 px-4 py-8 text-center text-sm text-[#37584F]">
      {text}
    </p>
  )
}

function SummaryGrid({ items }: { items: { label: string; value: React.ReactNode }[] }) {
  return (
    <dl className="mb-5 grid grid-cols-2 gap-x-6 gap-y-2 sm:grid-cols-4">
      {items.map((it) => (
        <div key={it.label}>
          <dt className="text-[10px] font-semibold tracking-wider text-[#37584F] uppercase">
            {it.label}
          </dt>
          <dd className="font-mono text-sm text-[#002017]">{it.value}</dd>
        </div>
      ))}
    </dl>
  )
}

function HoldingBody({ report }: { report: HoldingReport }) {
  if (report.rows.length === 0) {
    return <EmptyNotice text={report.coverage.note ?? "No holdings for this period."} />
  }
  const t = report.totals
  return (
    <>
      <SummaryGrid
        items={[
          { label: "Market value", value: money(t.marketValue, 0) },
          { label: "Total cost", value: money(t.totalCost, 0) },
          { label: "Unrealised P&L", value: <Signed value={t.gainLoss} /> },
          { label: "Return", value: <Signed value={t.gainLossPercent} suffix="%" /> },
        ]}
      />
      <table className="w-full table-fixed border-collapse text-[11px]">
        <colgroup>
          <col style={{ width: "26%" }} />
          <col style={{ width: "13%" }} />
          <col style={{ width: "9%" }} />
          <col style={{ width: "11%" }} />
          <col style={{ width: "11%" }} />
          <col style={{ width: "12%" }} />
          <col style={{ width: "11%" }} />
          <col style={{ width: "7%" }} />
        </colgroup>
        <thead>
          <tr>
            <Th>Security</Th>
            <Th>Class</Th>
            <Th align="right">Qty</Th>
            <Th align="right">Avg cost</Th>
            <Th align="right">Price</Th>
            <Th align="right">Market value</Th>
            <Th align="right">P&L</Th>
            <Th align="right">Wt %</Th>
          </tr>
        </thead>
        <tbody>
          {report.rows.map((r, i) => (
            <tr key={`${r.isin ?? r.name}-${i}`}>
              <Td>
                <span className="break-words">{r.name}</span>
              </Td>
              <Td>{r.sector ?? r.assetClass ?? "—"}</Td>
              <Td align="right" mono>
                {money(r.quantity, 0)}
              </Td>
              <Td align="right" mono>
                {money(r.unitCost)}
              </Td>
              <Td align="right" mono>
                {money(r.unitPrice)}
              </Td>
              <Td align="right" mono>
                {money(r.marketValue, 0)}
              </Td>
              <Td align="right" mono>
                <Signed value={r.gainLoss} />
              </Td>
              <Td align="right" mono>
                {r.weightPercent.toFixed(1)}
              </Td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr className="font-semibold">
            <Td>Total</Td>
            <Td>—</Td>
            <Td align="right">—</Td>
            <Td align="right">—</Td>
            <Td align="right">—</Td>
            <Td align="right" mono>
              {money(t.marketValue, 0)}
            </Td>
            <Td align="right" mono>
              <Signed value={t.gainLoss} />
            </Td>
            <Td align="right" mono>
              100.0
            </Td>
          </tr>
        </tfoot>
      </table>
    </>
  )
}

function FactsheetBody({ report }: { report: FactsheetReport }) {
  const r = report.returns
  const v = report.valuation
  const hasAnything = report.allocation.length > 0 || report.navHistory.length > 0
  if (!hasAnything) {
    return <EmptyNotice text={report.coverage.note ?? "No factsheet data for this period."} />
  }
  return (
    <>
      <SummaryGrid
        items={[
          { label: "Portfolio value", value: money(v.endMarketValue, 0) },
          { label: "NAV", value: v.nav === null ? "—" : v.nav.toFixed(4) },
          { label: "Period return", value: <Signed value={r.simple} suffix="%" /> },
          { label: "Realised gain", value: <Signed value={r.realisedGain} /> },
        ]}
      />

      {report.sectorAllocation.length > 0 && (
        <section className="mb-5">
          <h3 className="mb-2 text-[11px] font-semibold tracking-wider text-[#37584F] uppercase">
            Asset allocation
          </h3>
          <table className="w-full table-fixed border-collapse text-[11px]">
            <colgroup>
              <col style={{ width: "50%" }} />
              <col style={{ width: "28%" }} />
              <col style={{ width: "22%" }} />
            </colgroup>
            <thead>
              <tr>
                <Th>Class</Th>
                <Th align="right">Value</Th>
                <Th align="right">Weight</Th>
              </tr>
            </thead>
            <tbody>
              {report.sectorAllocation.map((a) => (
                <tr key={a.label}>
                  <Td>{a.label}</Td>
                  <Td align="right" mono>
                    {money(a.value, 0)}
                  </Td>
                  <Td align="right" mono>
                    {a.weightPercent.toFixed(1)}%
                  </Td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      {report.allocation.length > 0 && (
        <section>
          <h3 className="mb-2 text-[11px] font-semibold tracking-wider text-[#37584F] uppercase">
            Top holdings by weight
          </h3>
          <table className="w-full table-fixed border-collapse text-[11px]">
            <colgroup>
              <col style={{ width: "50%" }} />
              <col style={{ width: "28%" }} />
              <col style={{ width: "22%" }} />
            </colgroup>
            <thead>
              <tr>
                <Th>Security</Th>
                <Th align="right">Value</Th>
                <Th align="right">Weight</Th>
              </tr>
            </thead>
            <tbody>
              {report.allocation.map((a) => (
                <tr key={a.label}>
                  <Td>
                    <span className="break-words">{a.label}</span>
                  </Td>
                  <Td align="right" mono>
                    {money(a.value, 0)}
                  </Td>
                  <Td align="right" mono>
                    {a.weightPercent.toFixed(1)}%
                  </Td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}
    </>
  )
}

function TransactionsBody({ report }: { report: TransactionsReport }) {
  if (report.rows.length === 0) {
    return <EmptyNotice text={report.coverage.note ?? "No transactions in this period."} />
  }
  const t = report.totals
  return (
    <>
      <SummaryGrid
        items={[
          { label: "Purchases", value: money(t.purchases, 0) },
          { label: "Sales", value: money(t.sales, 0) },
          { label: "Charges", value: money(t.charges) },
          { label: "Transactions", value: String(report.rows.length) },
        ]}
      />
      <table className="w-full table-fixed border-collapse text-[11px]">
        <colgroup>
          <col style={{ width: "11%" }} />
          <col style={{ width: "19%" }} />
          <col style={{ width: "26%" }} />
          <col style={{ width: "11%" }} />
          <col style={{ width: "11%" }} />
          <col style={{ width: "12%" }} />
          <col style={{ width: "10%" }} />
        </colgroup>
        <thead>
          <tr>
            <Th>Date</Th>
            <Th>Type</Th>
            <Th>Security</Th>
            <Th align="right">Qty</Th>
            <Th align="right">Rate</Th>
            <Th align="right">Amount</Th>
            <Th align="right">Charges</Th>
          </tr>
        </thead>
        <tbody>
          {report.rows.map((r, i) => (
            <tr key={i}>
              <Td mono>{date(r.date)}</Td>
              <Td>{r.typeDetail}</Td>
              <Td>
                <span className="break-words">{r.symbolName || "—"}</span>
              </Td>
              <Td align="right" mono>
                {r.quantity ? money(r.quantity, 0) : "—"}
              </Td>
              <Td align="right" mono>
                {r.rate ? money(r.rate) : "—"}
              </Td>
              <Td align="right" mono>
                {money(r.amount)}
              </Td>
              <Td align="right" mono>
                {r.charges ? money(r.charges) : "—"}
              </Td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  )
}

function CapitalGainsBody({ report }: { report: CapitalGainsReport }) {
  const s = report.summary
  return (
    <>
      <SummaryGrid
        items={[
          { label: "Short-term gain", value: <Signed value={s.shortTermGain} /> },
          { label: "Long-term gain", value: <Signed value={s.longTermGain} /> },
          ...(s.unmatchedGain
            ? [{ label: "Unmatched (term n/a)", value: <Signed value={s.unmatchedGain} /> }]
            : []),
          { label: "Total realised", value: <Signed value={s.realisedGain} /> },
          { label: "Parcels", value: String(report.rows.length) },
        ]}
      />
      {report.rows.length === 0 ? (
        <EmptyNotice text={report.coverage.note ?? "No disposals in this period."} />
      ) : (
        <table className="w-full table-fixed border-collapse text-[11px]">
          <colgroup>
            <col style={{ width: "24%" }} />
            <col style={{ width: "10%" }} />
            <col style={{ width: "12%" }} />
            <col style={{ width: "12%" }} />
            <col style={{ width: "13%" }} />
            <col style={{ width: "13%" }} />
            <col style={{ width: "8%" }} />
            <col style={{ width: "8%" }} />
          </colgroup>
          <thead>
            <tr>
              <Th>Security</Th>
              <Th align="right">Qty</Th>
              <Th>Acquired</Th>
              <Th>Sold</Th>
              <Th align="right">Cost</Th>
              <Th align="right">Proceeds</Th>
              <Th align="right">Gain</Th>
              <Th>Term</Th>
            </tr>
          </thead>
          <tbody>
            {report.rows.map((r, i) => (
              <tr key={i}>
                <Td>
                  <span className="break-words">{r.symbol}</span>
                </Td>
                <Td align="right" mono>
                  {money(r.quantity, 0)}
                </Td>
                <Td mono>{date(r.acquiredOn)}</Td>
                <Td mono>{date(r.soldOn)}</Td>
                <Td align="right" mono>
                  {money(r.cost)}
                </Td>
                <Td align="right" mono>
                  {money(r.proceeds)}
                </Td>
                <Td align="right" mono>
                  <Signed value={r.gain} />
                </Td>
                <Td>
                  {r.term === "unknown" ? (
                    <span title="No matching acquisition found">n/a</span>
                  ) : (
                    r.term.toUpperCase()
                  )}
                </Td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </>
  )
}

function ExpensesBody({ report }: { report: ExpensesReport }) {
  const t = report.totals
  return (
    <>
      <SummaryGrid
        items={[
          { label: "Management & performance", value: money(t.managementFees) },
          { label: "Other charges", value: money(t.otherFees) },
          { label: "Total", value: money(t.total) },
          { label: "Entries", value: String(report.rows.length) },
        ]}
      />
      {report.rows.length === 0 ? (
        <EmptyNotice text={report.coverage.note ?? "No fees in this period."} />
      ) : (
        <table className="w-full table-fixed border-collapse text-[11px]">
          <colgroup>
            <col style={{ width: "20%" }} />
            <col style={{ width: "58%" }} />
            <col style={{ width: "22%" }} />
          </colgroup>
          <thead>
            <tr>
              <Th>Date</Th>
              <Th>Description</Th>
              <Th align="right">Amount</Th>
            </tr>
          </thead>
          <tbody>
            {report.rows.map((r, i) => (
              <tr key={i}>
                <Td mono>{date(r.date)}</Td>
                <Td>{r.description}</Td>
                <Td align="right" mono>
                  {money(r.amount)}
                </Td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="font-semibold">
              <Td>Total</Td>
              <Td>—</Td>
              <Td align="right" mono>
                {money(t.total)}
              </Td>
            </tr>
          </tfoot>
        </table>
      )}
    </>
  )
}

function DividendsBody({ report }: { report: DividendsReport }) {
  const t = report.totals
  return (
    <>
      <SummaryGrid
        items={[
          { label: "Dividends", value: money(t.dividend) },
          { label: "Interest", value: money(t.interest) },
          { label: "Total income", value: money(t.total) },
          { label: "Entries", value: String(report.rows.length) },
        ]}
      />
      {report.rows.length === 0 ? (
        <EmptyNotice text={report.coverage.note ?? "No income in this period."} />
      ) : (
        <table className="w-full table-fixed border-collapse text-[11px]">
          <colgroup>
            <col style={{ width: "18%" }} />
            <col style={{ width: "42%" }} />
            <col style={{ width: "16%" }} />
            <col style={{ width: "24%" }} />
          </colgroup>
          <thead>
            <tr>
              <Th>Date</Th>
              <Th>Security</Th>
              <Th align="right">Units</Th>
              <Th align="right">Amount</Th>
            </tr>
          </thead>
          <tbody>
            {report.rows.map((r, i) => (
              <tr key={i}>
                <Td mono>{date(r.date)}</Td>
                <Td>
                  <span className="break-words">{r.symbolName}</span>
                </Td>
                <Td align="right" mono>
                  {r.quantity === null ? "—" : money(r.quantity, 4)}
                </Td>
                <Td align="right" mono>
                  {money(r.amount)}
                </Td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="font-semibold">
              <Td>Total</Td>
              <Td>—</Td>
              <Td align="right">—</Td>
              <Td align="right" mono>
                {money(t.total)}
              </Td>
            </tr>
          </tfoot>
        </table>
      )}
    </>
  )
}

/**
 * A single printable statement. Rendered on a white sheet regardless of theme
 * so the on-screen preview matches the printed page.
 */
export function Statement({ report }: { report: AnyReport }) {
  const accent = strategyColor(report.client.clientCode)

  return (
    <article className="statement-sheet mx-auto w-full max-w-[210mm] bg-white p-8 text-[#002017] shadow-sm print:max-w-none print:p-0 print:shadow-none">
      <header className="mb-6 border-b-2 pb-4" style={{ borderColor: accent }}>
        <div className="flex items-start justify-between gap-6">
          <div>
            <p
              className="text-[10px] font-bold tracking-[0.25em] uppercase"
              style={{ color: accent }}
            >
              Qode Advisors LLP
            </p>
            <h1 className="mt-1 font-[family-name:var(--font-playfair)] text-2xl leading-tight">
              {REPORT_LABELS[report.kind]}
            </h1>
          </div>
          <div className="text-right text-[11px] leading-relaxed">
            <p className="font-semibold">{report.client.name}</p>
            <p className="font-mono">{report.client.clientCode}</p>
            {report.client.pan && <p className="font-mono">PAN {report.client.pan}</p>}
          </div>
        </div>
        <div className="mt-3 flex flex-wrap gap-x-8 gap-y-1 text-[11px] text-[#37584F]">
          <span>{report.client.schemeName}</span>
          <span>
            Period {date(report.period.from)} — {date(report.period.to)}
          </span>
        </div>
      </header>

      {report.kind === "holding" && <HoldingBody report={report} />}
      {report.kind === "factsheet" && <FactsheetBody report={report} />}
      {report.kind === "transactions" && <TransactionsBody report={report} />}
      {report.kind === "capital-gains" && <CapitalGainsBody report={report} />}
      {report.kind === "expenses" && <ExpensesBody report={report} />}
      {report.kind === "dividends" && <DividendsBody report={report} />}

      <footer className="mt-8 border-t border-[#37584F]/25 pt-3 text-[9px] leading-relaxed text-[#37584F]">
        {report.coverage.note && <p className="mb-1">{report.coverage.note}</p>}
        <p>
          Generated {date(new Date().toISOString())} from custodian records. This statement is for
          information only and is not a tax document. Capital gains are computed on a FIFO basis;
          holdings sold more than 12 months after acquisition are classified long-term. Verify
          against your contract notes before filing.
        </p>
      </footer>
    </article>
  )
}
