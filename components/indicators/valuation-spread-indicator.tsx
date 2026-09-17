"use client";

import * as React from "react";
import { useEffect, useMemo, useState } from "react";
import Highcharts from "highcharts";
import HighchartsReact from "highcharts-react-official";
import { format, parseISO } from "date-fns";
import { ArrowDownRight, ArrowUpRight, Minus } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { INDICATOR_API_BASE } from "@/lib/indicatorsApi";

/**
 * Valuation Spread Indicator — the distributor-facing view.
 *
 * WHAT IT MEASURES
 * For every stock, today's price-to-book is compared with that stock's own
 * historical median. The indicator is the share of stocks in a segment
 * trading ABOVE their own median — "% rich". 50% is neutral. It is a breadth
 * measure, so it is comparable across 25 years in a way an index level is not.
 *
 * HOW QODE READS IT (same rule as the research dashboard in qode360)
 *   above 70%  Risk OFF — most of the segment is expensive; underweight it
 *   below 30%  Risk ON  — most of the segment is cheap; overweight it
 *   in between Neutral
 * 80% and 20% are drawn as the "extreme" marks inside each zone.
 *
 * DATA
 * /indicator/get_ratio_df on the qode360 backend, through the
 * /api/distributor/indicators proxy. One request returns every segment's
 * full daily history; switching segment is instant and costs nothing.
 *
 * DESIGN
 * One series at a time, so there is no legend to decode and colour never has
 * to carry identity. The five segments sit in a strip that doubles as the
 * selector and shows every reading at a glance. The selected segment gets a
 * headline number, a stance badge (icon + words, never colour alone), a
 * 0–100 gauge that shows where the reading sits against the zones, and the
 * history chart with the same zones shaded.
 */

// ─── Data ───────────────────────────────────────────────────────────────────

type Row = { Date: string } & Record<string, number | string | null>;

type SegmentKey = "All" | "Largecaps" | "Midcaps" | "Smallcaps" | "Microcaps";

const SEGMENTS: { key: SegmentKey; label: string; hint: string; column: string }[] = [
  { key: "All", label: "All companies", hint: "Whole listed universe", column: "All Companies" },
  { key: "Largecaps", label: "Largecaps", hint: "Top 100 by market cap", column: "0 to 100" },
  { key: "Midcaps", label: "Midcaps", hint: "Rank 101 – 250", column: "100 to 250" },
  { key: "Smallcaps", label: "Smallcaps", hint: "Rank 251 – 500", column: "250 to 500" },
  { key: "Microcaps", label: "Microcaps", hint: "Rank 500 and beyond", column: "500+" },
];

const RISK_OFF = 70;
const RISK_ON = 30;
const EXTREME_HIGH = 80;
const EXTREME_LOW = 20;

type Stance = "off" | "on" | "neutral";

function stanceOf(v: number): Stance {
  if (v >= RISK_OFF) return "off";
  if (v <= RISK_ON) return "on";
  return "neutral";
}

// Reserved status styling: brand maroon / brand green / neutral ink. Always
// shipped with an icon and words.
const STANCE: Record<
  Stance,
  {
    title: string;
    action: string;
    text: string;
    bg: string;
    Icon: React.ComponentType<{ className?: string }>;
  }
> = {
  off: { title: "Risk OFF", action: "Underweight", text: "text-[#550E0E]", bg: "bg-[#550E0E]/10", Icon: ArrowUpRight },
  on: { title: "Risk ON", action: "Overweight", text: "text-[#02422B]", bg: "bg-[#02422B]/10", Icon: ArrowDownRight },
  neutral: { title: "Neutral", action: "No tilt", text: "text-muted-foreground", bg: "bg-muted", Icon: Minus },
};

const INK = "#37584F";
const LINE = "#02422B";
const MAROON = "85,14,14";
const GREEN = "2,66,43";

type RangeKey = "1Y" | "3Y" | "5Y" | "10Y" | "All";
const RANGES: RangeKey[] = ["1Y", "3Y", "5Y", "10Y", "All"];
const RANGE_YEARS: Record<RangeKey, number | null> = { "1Y": 1, "3Y": 3, "5Y": 5, "10Y": 10, All: null };

// ─── Helpers ────────────────────────────────────────────────────────────────

function num(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

function fmtDate(iso: string | null | undefined, pattern = "d MMM yyyy"): string {
  if (!iso) return "";
  try {
    return format(parseISO(iso), pattern);
  } catch {
    return iso;
  }
}

function fmtDelta(v: number | null): string {
  if (v === null) return "–";
  const r = Math.round(v * 10) / 10;
  return `${r > 0 ? "+" : ""}${r.toFixed(1)} pts`;
}

type SegmentStats = {
  latest: number;
  asOf: string;
  firstYear: string;
  percentile: number; // share of history at or below today's reading
  d1m: number | null;
  d1y: number | null;
  high: number;
  low: number;
  points: [number, number][];
};

function buildStats(rows: Row[], column: string): SegmentStats | null {
  const pts: { t: number; d: string; v: number }[] = [];
  for (const r of rows) {
    const v = num(r[column]);
    if (v !== null) pts.push({ t: Date.parse(r.Date), d: r.Date, v });
  }
  if (!pts.length) return null;

  const last = pts[pts.length - 1];
  const at = (daysBack: number) => {
    const target = last.t - daysBack * 86400000;
    for (let i = pts.length - 1; i >= 0; i--) if (pts[i].t <= target) return pts[i].v;
    return null;
  };
  let high = pts[0].v;
  let low = pts[0].v;
  let atOrBelow = 0;
  for (const p of pts) {
    if (p.v > high) high = p.v;
    if (p.v < low) low = p.v;
    if (p.v <= last.v) atOrBelow++;
  }
  const m1 = at(30);
  const y1 = at(365);
  return {
    latest: last.v,
    asOf: last.d,
    firstYear: pts[0].d.slice(0, 4),
    percentile: atOrBelow / pts.length,
    d1m: m1 === null ? null : last.v - m1,
    d1y: y1 === null ? null : last.v - y1,
    high,
    low,
    points: pts.map((p) => [p.t, p.v]),
  };
}

// ─── Gauge ──────────────────────────────────────────────────────────────────

/** 0–100 track with the three zones and a marker at the current reading. */
function ZoneGauge({ value }: { value: number }) {
  const pos = Math.max(0, Math.min(100, value));
  return (
    <div
      className="w-full"
      role="img"
      aria-label={`Reading ${value.toFixed(0)} percent on a 0 to 100 scale. Risk ON below ${RISK_ON}, Risk OFF above ${RISK_OFF}.`}
    >
      <div className="relative h-7">
        {/* marker */}
        <div className="absolute top-0 -translate-x-1/2" style={{ left: `${pos}%` }}>
          <div className="mx-auto h-0 w-0 border-x-[5px] border-t-[7px] border-x-transparent border-t-primary" />
        </div>
        {/* track: 2px surface gaps between the zones */}
        <div className="absolute inset-x-0 bottom-0 flex h-3 gap-[2px] overflow-hidden rounded-full">
          <div className="h-full" style={{ width: `${RISK_ON}%`, background: `rgba(${GREEN},0.28)` }} />
          <div className="h-full flex-1 bg-border/15" />
          <div className="h-full" style={{ width: `${100 - RISK_OFF}%`, background: `rgba(${MAROON},0.28)` }} />
        </div>
      </div>
      <div className="relative mt-1.5 h-4 text-[10px] font-semibold text-muted-foreground">
        <span className="absolute left-0">0</span>
        <span className="absolute -translate-x-1/2" style={{ left: `${RISK_ON}%` }}>
          {RISK_ON}
        </span>
        <span className="absolute -translate-x-1/2" style={{ left: "50%" }}>
          50
        </span>
        <span className="absolute -translate-x-1/2" style={{ left: `${RISK_OFF}%` }}>
          {RISK_OFF}
        </span>
        <span className="absolute right-0">100</span>
      </div>
      <div className="mt-1 flex justify-between text-[10px] font-semibold uppercase tracking-[0.1em]">
        <span className="text-[#02422B]">Risk ON</span>
        <span className="text-muted-foreground">Neutral</span>
        <span className="text-[#550E0E]">Risk OFF</span>
      </div>
    </div>
  );
}

// ─── Component ──────────────────────────────────────────────────────────────

export function ValuationSpreadIndicator({
  className,
  apiBase = INDICATOR_API_BASE,
}: {
  className?: string;
  /** Override the API base (previews). Defaults to the authenticated proxy. */
  apiBase?: string;
}) {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [segment, setSegment] = useState<SegmentKey>("All");
  const [range, setRange] = useState<RangeKey>("All");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch(`${apiBase}/indicator/get_ratio_df/?factor_col=${encodeURIComponent("p/b")}`, {
          headers: { accept: "application/json" },
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const json = await res.json();
        const data = (json?.data ?? []) as Row[];
        if (!cancelled) {
          if (!Array.isArray(data) || !data.length) setError("No indicator data is available right now.");
          setRows(Array.isArray(data) ? data : []);
        }
      } catch {
        if (!cancelled) {
          setRows(null);
          setError("We couldn't load the indicator. Please refresh.");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [apiBase]);

  const statsBySegment = useMemo(() => {
    const m = new Map<SegmentKey, SegmentStats | null>();
    if (rows) for (const s of SEGMENTS) m.set(s.key, buildStats(rows, s.column));
    return m;
  }, [rows]);

  const meta = SEGMENTS.find((s) => s.key === segment)!;
  const stats = statsBySegment.get(segment) ?? null;
  const stance = stats ? STANCE[stanceOf(stats.latest)] : null;

  const chartOptions = useMemo<Highcharts.Options | null>(() => {
    if (!stats) return null;
    const lastX = stats.points[stats.points.length - 1][0];
    const years = RANGE_YEARS[range];
    const min = years ? lastX - years * 365.25 * 86400000 : undefined;
    const zoneLabel = (text: string, color: string, bottom: boolean): Highcharts.YAxisPlotBandsLabelOptions => ({
      text,
      align: "left",
      x: 8,
      y: bottom ? -6 : 14,
      verticalAlign: bottom ? "bottom" : "top",
      style: { color, fontSize: "10px", fontWeight: "700", letterSpacing: "0.04em" },
    });

    return {
      chart: {
        type: "line",
        backgroundColor: "transparent",
        height: 360,
        spacing: [6, 8, 6, 2],
        style: { fontFamily: "inherit" },
        animation: false,
        zooming: { type: "x" },
      },
      title: { text: undefined },
      credits: { enabled: false },
      accessibility: { enabled: false },
      legend: { enabled: false },
      xAxis: {
        type: "datetime",
        min,
        max: lastX,
        lineColor: "rgba(55,88,79,0.25)",
        tickColor: "transparent",
        crosshair: { color: "rgba(55,88,79,0.35)", width: 1 },
        labels: { style: { color: INK, fontSize: "11px" } },
      },
      yAxis: {
        title: { text: undefined },
        min: 0,
        max: 100,
        tickPositions: [0, RISK_ON, 50, RISK_OFF, 100],
        gridLineColor: "rgba(55,88,79,0.10)",
        labels: { format: "{value}%", style: { color: INK, fontSize: "11px" } },
        plotBands: [
          {
            from: RISK_OFF,
            to: 100,
            color: `rgba(${MAROON},0.07)`,
            label: zoneLabel(`RISK OFF · UNDERWEIGHT ${meta.label.toUpperCase()}`, "#550E0E", false),
          },
          {
            from: 0,
            to: RISK_ON,
            color: `rgba(${GREEN},0.08)`,
            label: zoneLabel(`RISK ON · OVERWEIGHT ${meta.label.toUpperCase()}`, "#02422B", true),
          },
        ],
        plotLines: [
          { value: 50, color: "rgba(55,88,79,0.45)", dashStyle: "ShortDash", width: 1, zIndex: 2 },
          { value: EXTREME_HIGH, color: `rgba(${MAROON},0.35)`, dashStyle: "Dot", width: 1, zIndex: 2 },
          { value: EXTREME_LOW, color: `rgba(${GREEN},0.4)`, dashStyle: "Dot", width: 1, zIndex: 2 },
        ],
      },
      tooltip: {
        useHTML: true,
        backgroundColor: "#F7F5E9",
        borderColor: "rgba(55,88,79,0.3)",
        borderRadius: 8,
        shadow: false,
        style: { color: INK, fontSize: "12px" },
        formatter: function (this: Highcharts.Point) {
          const v = this.y ?? 0;
          const st = STANCE[stanceOf(v)];
          return (
            `<div style="font-weight:600;margin-bottom:2px">${Highcharts.dateFormat("%e %b %Y", this.x as number)}</div>` +
            `<div><b style="font-size:14px">${v.toFixed(1)}%</b> of ${meta.label.toLowerCase()} rich</div>` +
            `<div style="opacity:.8">${st.title}${st.action !== "No tilt" ? ` · ${st.action}` : ""}</div>`
          );
        },
      },
      plotOptions: {
        series: { turboThreshold: 0, animation: false },
      },
      series: [
        {
          type: "line",
          name: meta.label,
          color: LINE,
          lineWidth: 2,
          data: stats.points,
          marker: { enabled: false, symbol: "circle", radius: 4 },
          states: { hover: { lineWidthPlus: 0 } },
        },
      ],
    };
  }, [stats, range, meta.label]);

  // ── Render ───────────────────────────────────────────────────────────────

  return (
    <section className={cn("w-full min-w-0 rounded-xl border border-border/20 bg-card shadow-sm", className)}>
      {/* Header */}
      <div className="border-b border-border/15 px-5 pb-4 pt-5">
        <div className="min-w-0">
          <h2 className="font-serif text-xl text-primary">Valuation Spread Indicator</h2>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
            The share of stocks trading above their own historical median price-to-book. High
            readings mean most of the market is expensive; low readings mean most of it is cheap.
          </p>
        </div>
      </div>

      {/* Segment strip — every reading at a glance, and the selector */}
      <div
        className="grid grid-cols-2 gap-2 px-5 pt-4 sm:grid-cols-3 lg:grid-cols-5"
        role="tablist"
        aria-label="Market-cap segment"
      >
        {SEGMENTS.map((s) => {
          const st = statsBySegment.get(s.key) ?? null;
          const sc = st ? STANCE[stanceOf(st.latest)] : null;
          const active = s.key === segment;
          return (
            <button
              key={s.key}
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => setSegment(s.key)}
              className={cn(
                "rounded-lg border px-3 py-2.5 text-left transition-colors",
                // "All" spans the row on phones so the four cap segments sit in a tidy 2x2.
                s.key === "All" && "col-span-2 sm:col-span-1",
                active
                  ? "border-primary/40 bg-background shadow-sm"
                  : "border-transparent bg-background/40 hover:bg-background/70",
              )}
            >
              <span className={cn("block text-xs font-semibold", active ? "text-primary" : "text-foreground")}>
                {s.label}
              </span>
              {st && sc ? (
                <span className="mt-1 flex items-baseline gap-2">
                  <span className="font-serif text-xl leading-none text-primary tabular-nums">
                    {st.latest.toFixed(0)}%
                  </span>
                  <span className={cn("inline-flex items-center gap-0.5 text-[11px] font-semibold", sc.text)}>
                    <sc.Icon className="h-3 w-3" />
                    {sc.title}
                  </span>
                </span>
              ) : loading ? (
                <Skeleton className="mt-1.5 h-5 w-20" />
              ) : (
                <span className="mt-1 block text-[11px] text-muted-foreground">No data</span>
              )}
            </button>
          );
        })}
      </div>

      {error && !stats ? (
        <div className="px-5 py-10 text-center">
          <p className="text-sm text-muted-foreground">{error}</p>
        </div>
      ) : (
        <>
          {/* Headline: number, stance, gauge, context */}
          <div className="grid min-w-0 gap-5 px-5 py-5 lg:grid-cols-[minmax(240px,300px)_1fr] lg:gap-8">
            <div>
              {stats && stance ? (
                <>
                  <div className="text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                    {meta.label} · {meta.hint}
                  </div>
                  <div className="mt-1.5 flex flex-wrap items-end gap-x-3 gap-y-2">
                    <span className="font-serif text-6xl leading-none text-primary tabular-nums">
                      {stats.latest.toFixed(1)}
                      <span className="text-3xl">%</span>
                    </span>
                    <span
                      className={cn(
                        "mb-1.5 inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-bold",
                        stance.bg,
                        stance.text,
                      )}
                    >
                      <stance.Icon className="h-3.5 w-3.5" />
                      {stance.title}
                      {stance.action !== "No tilt" ? <span className="font-semibold"> · {stance.action}</span> : null}
                    </span>
                  </div>
                  <p className="mt-2 text-xs text-muted-foreground">
                    of {meta.label.toLowerCase()} trade rich to their own history · as of {fmtDate(stats.asOf)}
                  </p>
                </>
              ) : (
                <div className="space-y-3">
                  <Skeleton className="h-3 w-32" />
                  <Skeleton className="h-14 w-40" />
                  <Skeleton className="h-3 w-48" />
                </div>
              )}
            </div>

            <div className="min-w-0">
              {stats ? (
                <>
                  <ZoneGauge value={stats.latest} />
                  <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-3 border-t border-border/15 pt-3 text-xs sm:grid-cols-4">
                    <div>
                      <dt className="text-muted-foreground">1 month change</dt>
                      <dd className="mt-0.5 font-semibold text-foreground tabular-nums">{fmtDelta(stats.d1m)}</dd>
                    </div>
                    <div>
                      <dt className="text-muted-foreground">1 year change</dt>
                      <dd className="mt-0.5 font-semibold text-foreground tabular-nums">{fmtDelta(stats.d1y)}</dd>
                    </div>
                    <div>
                      <dt className="text-muted-foreground">Higher than</dt>
                      <dd className="mt-0.5 font-semibold text-foreground tabular-nums">
                        {Math.round(stats.percentile * 100)}% of history
                      </dd>
                    </div>
                    <div>
                      <dt className="text-muted-foreground">Range since {stats.firstYear}</dt>
                      <dd className="mt-0.5 font-semibold text-foreground tabular-nums">
                        {stats.low.toFixed(0)}% – {stats.high.toFixed(0)}%
                      </dd>
                    </div>
                  </dl>
                </>
              ) : (
                <Skeleton className="h-24 w-full" />
              )}
            </div>
          </div>

          {/* History */}
          <div className="min-w-0 px-3 pb-4 sm:px-5">
            <div className="mb-1 flex flex-wrap items-center justify-between gap-2 px-2">
              <span className="text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                History · % of {meta.label.toLowerCase()} rich
              </span>
              <div className="flex items-center gap-1" role="group" aria-label="Chart range">
                {RANGES.map((r) => (
                  <button
                    key={r}
                    type="button"
                    onClick={() => setRange(r)}
                    aria-pressed={range === r}
                    className={cn(
                      "rounded-md px-2 py-1 text-[11px] font-semibold transition-colors",
                      range === r
                        ? "bg-primary text-primary-foreground"
                        : "text-muted-foreground hover:bg-background hover:text-foreground",
                    )}
                  >
                    {r}
                  </button>
                ))}
              </div>
            </div>

            {chartOptions ? (
              <div className="min-w-0 overflow-hidden rounded-lg">
                <HighchartsReact highcharts={Highcharts} options={chartOptions} />
              </div>
            ) : (
              <Skeleton className="h-[360px] w-full rounded-lg" />
            )}

            <div className="mt-3 grid gap-3 border-t border-border/15 px-2 pt-3 text-[11px] leading-relaxed text-muted-foreground sm:grid-cols-[1fr_auto] sm:items-end">
              <p>
                <span className="font-semibold text-foreground">How to read it.</span> Above {RISK_OFF}% most of the
                segment is expensive versus its own past, so Qode leans away from it (Risk OFF). Below {RISK_ON}% most
                of it is cheap, so Qode leans in (Risk ON). The dotted lines at {EXTREME_HIGH}% and {EXTREME_LOW}% mark
                extremes. Drag on the chart to zoom.
              </p>
              <p className="italic">Source: Ace Equity, Qode Advisors LLP</p>
            </div>
          </div>
        </>
      )}
    </section>
  );
}

export default ValuationSpreadIndicator;
