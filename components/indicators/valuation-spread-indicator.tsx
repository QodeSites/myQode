"use client";

import * as React from "react";
import { useEffect, useMemo, useState } from "react";
import Highcharts from "highcharts";
import HighchartsReact from "highcharts-react-official";
import { format, parseISO } from "date-fns";
import { Info } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { INDICATOR_API_BASE } from "@/lib/indicatorsApi";

/**
 * Valuation Spread Indicator — new pipeline data, in the classic card format.
 *
 * DATA
 * The precomputed `vsi_v2_*` tables on the qode360 backend (indicator/vsi/*),
 * through the /api/distributor/indicators proxy. Fixed to the research
 * defaults: Combined exchange, factor pb_ratio_lag (point-in-time P/B from
 * published balance sheets), 10-year ranking lookback, 2 buckets, target
 * bucket 2, daily. The reading is the % of a segment's stocks sitting in the
 * expensive half of their own P/B history.
 *
 * SEGMENTS (backend name -> what partners see)
 *   Top 750  -> Overall VSI   (the headline; replaces "All Companies")
 *   Top 100  -> Largecaps
 *   101-250  -> Midcaps
 *   251-500  -> Smallcaps
 *   500-750  -> Microcaps
 *
 * History is shown from 2006 onward (HISTORY_START).
 *
 * FORMAT
 * Same as the research dashboard's classic card: a full-width tab bar, the
 * latest reading and its date, and one series over shaded Risk OFF / Risk ON
 * bands (70 / 30, with 80 / 20 dotted extremes and a dashed 50 line).
 */

// ─── Data ───────────────────────────────────────────────────────────────────

type Point = { date: string; value: number | null };
type SeriesEntry = { segment: string; points: Point[] };
type BreadthResponse = { series: SeriesEntry[]; dates: string[] };

type SegmentDef = { key: string; label: string; backend: string };

const SEGMENTS: SegmentDef[] = [
  { key: "overall", label: "Overall VSI", backend: "Top 750" },
  { key: "large", label: "Largecaps", backend: "Top 100" },
  { key: "mid", label: "Midcaps", backend: "101-250" },
  { key: "small", label: "Smallcaps", backend: "251-500" },
  { key: "micro", label: "Microcaps", backend: "500-750" },
];

const PARAMS = {
  exchange: "Combined",
  factor: "pb_ratio_lag",
  lookback: "10 Years",
  divisions: "2",
  frequency: "Daily",
  target_bucket: "2",
};

// History shown to partners starts here; earlier readings are dropped
// before charting so the "Latest" value and the axis both stay consistent.
const HISTORY_START = Date.UTC(2006, 0, 1);

const RISK_OFF = 70;
const RISK_ON = 30;
const EXTREME_HIGH = 80;
const EXTREME_LOW = 20;

const INK = "#37584F";
const LINE = "#02422B";
// Band colours taken verbatim from the research dashboard's classic card.
const RED_OUTER = "#f5bfc9";
const RED_INNER = "#fee5e9";
const GREEN_INNER = "#e5f3ef";
const GREEN_OUTER = "#bdead2";
const RED_LABEL = "#c00";
const GREEN_LABEL = "#028a3d";
const GOLD = "#DABD38";
const DARK_GREEN = "#002017";

function fmtDate(iso: string | null | undefined, pattern = "dd-MM-yyyy"): string {
  if (!iso) return "";
  try {
    return format(parseISO(iso), pattern);
  } catch {
    return iso;
  }
}

type Series = { points: [number, number][]; latest: number; asOf: string };

function toSeries(entry: SeriesEntry | undefined): Series | null {
  if (!entry) return null;
  const pts: [number, number][] = [];
  let latest: number | null = null;
  let asOf = "";
  for (const p of entry.points) {
    if (p.value === null || p.value === undefined || Number.isNaN(p.value)) continue;
    const t = Date.parse(p.date);
    if (t < HISTORY_START) continue;
    pts.push([t, p.value]);
    latest = p.value;
    asOf = p.date;
  }
  if (!pts.length || latest === null) return null;
  return { points: pts, latest, asOf };
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
  const [breadth, setBreadth] = useState<BreadthResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [segment, setSegment] = useState<string>(SEGMENTS[0].key);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const qs = new URLSearchParams({
          ...PARAMS,
          segments: SEGMENTS.map((s) => s.backend).join(","),
        });
        const res = await fetch(`${apiBase}/indicator/vsi/breadth/?${qs}`, {
          headers: { accept: "application/json" },
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const json = await res.json();
        const data = (json?.data ?? json) as BreadthResponse;
        if (!cancelled) {
          if (!data?.series?.length) {
            setBreadth(null);
            setError("No indicator data is available right now.");
          } else {
            setBreadth(data);
          }
        }
      } catch (e: any) {
        if (!cancelled) {
          setBreadth(null);
          setError(
            e?.message === "HTTP 503"
              ? "The indicator is being rebuilt. Check back shortly."
              : "We couldn't load the indicator. Please refresh.",
          );
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [apiBase]);

  const seriesByKey = useMemo(() => {
    const m = new Map<string, Series | null>();
    for (const s of SEGMENTS) {
      m.set(s.key, toSeries(breadth?.series.find((e) => e.segment === s.backend)));
    }
    return m;
  }, [breadth]);

  const meta = SEGMENTS.find((s) => s.key === segment) ?? SEGMENTS[0];
  const series = seriesByKey.get(segment) ?? null;

  const chartOptions = useMemo<Highcharts.Options | null>(() => {
    if (!series) return null;
    const bandLabel = (
      text: string,
      color: string,
      bottom: boolean,
    ): Highcharts.YAxisPlotBandsLabelOptions => ({
      text,
      align: "left",
      x: 6,
      y: bottom ? -6 : 12,
      verticalAlign: bottom ? "bottom" : "top",
      style: { color, fontSize: "10px", fontWeight: "600" },
    });

    return {
      chart: {
        type: "line",
        backgroundColor: "transparent",
        height: 420,
        spacing: [10, 10, 6, 4],
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
        title: { text: "Date", style: { color: INK, fontSize: "11px" } },
        lineColor: "rgba(55,88,79,0.3)",
        tickColor: "transparent",
        gridLineWidth: 0,
        crosshair: { color: "rgba(55,88,79,0.35)", width: 1 },
        labels: { style: { color: INK, fontSize: "11px" } },
      },
      yAxis: {
        title: { text: "Value (%)", style: { color: INK, fontSize: "11px" } },
        min: 0,
        max: 100,
        tickInterval: 20,
        gridLineWidth: 0,
        labels: { style: { color: INK, fontSize: "11px" } },
        plotBands: [
          // Risk OFF above 70 (strong), 50-70 (light); Risk ON mirrors it.
          {
            from: RISK_OFF,
            to: 100,
            color: RED_OUTER,
            label: bandLabel(`Risk OFF: Underweight ${meta.label}`, RED_LABEL, false),
          },
          { from: 50, to: RISK_OFF, color: RED_INNER },
          { from: RISK_ON, to: 50, color: GREEN_INNER },
          {
            from: 0,
            to: RISK_ON,
            color: GREEN_OUTER,
            label: bandLabel(`Risk ON: Overweight ${meta.label}`, GREEN_LABEL, true),
          },
        ],
        plotLines: [
          { value: 50, color: DARK_GREEN, dashStyle: "Dash", width: 2, zIndex: 3 },
          { value: EXTREME_HIGH, color: GOLD, dashStyle: "Dot", width: 1.5, zIndex: 3 },
          { value: EXTREME_LOW, color: GOLD, dashStyle: "Dot", width: 1.5, zIndex: 3 },
        ],
      },
      tooltip: {
        useHTML: true,
        backgroundColor: "#1F2A27",
        borderColor: "#1F2A27",
        borderRadius: 6,
        shadow: false,
        style: { color: "#EFECD3", fontSize: "12px" },
        formatter: function (this: Highcharts.Point) {
          return (
            `<div style="font-weight:600">${Highcharts.dateFormat("%d-%m-%Y", this.x as number)}</div>` +
            `<div>% rich: <b>${(this.y ?? 0).toFixed(2)}</b></div>`
          );
        },
      },
      plotOptions: { series: { turboThreshold: 0, animation: false } },
      series: [
        {
          type: "line",
          name: meta.label,
          color: LINE,
          lineWidth: 2,
          data: series.points,
          marker: { enabled: false, symbol: "circle", radius: 4 },
          states: { hover: { lineWidthPlus: 0 } },
        },
      ],
    };
  }, [series, meta.label]);

  // ── Render ───────────────────────────────────────────────────────────────

  return (
    <section className={cn("w-full min-w-0 rounded-xl border border-border/20 bg-card px-5 py-5 shadow-sm", className)}>
      {/* Title row */}
      <div className="flex items-start justify-between gap-3">
        <h2 className="text-lg font-bold text-foreground">Valuation Spread Indicator</h2>
        <span
          className="text-muted-foreground"
          title={`Each stock's price-to-book is ranked against its own 10-year history. The indicator is the share of the segment trading in the expensive half. Above ${RISK_OFF}% Qode underweights the segment (Risk OFF); below ${RISK_ON}% it overweights (Risk ON).`}
        >
          <Info className="h-4 w-4" aria-hidden />
          <span className="sr-only">How the indicator is calculated</span>
        </span>
      </div>

      {/* Segment tabs */}
      <div
        className="mt-4 grid grid-cols-2 gap-1 rounded-lg bg-background/70 p-1 sm:grid-cols-5"
        role="tablist"
        aria-label="Market-cap segment"
      >
        {SEGMENTS.map((s) => {
          const active = s.key === segment;
          return (
            <button
              key={s.key}
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => setSegment(s.key)}
              className={cn(
                "rounded-md px-3 py-1.5 text-xs font-semibold transition-colors",
                active
                  ? "border border-primary/40 bg-card text-primary shadow-sm"
                  : "text-foreground/80 hover:bg-card/70",
                s.key === "overall" && "col-span-2 sm:col-span-1",
              )}
            >
              {s.label}
            </button>
          );
        })}
      </div>

      {/* Latest reading */}
      <div className="mt-4">
        {series ? (
          <>
            <p className="text-sm font-bold text-foreground">
              Latest: <span className="tabular-nums">{series.latest.toFixed(2)}%</span>
            </p>
            <p className="text-xs text-muted-foreground">{fmtDate(series.asOf)}</p>
          </>
        ) : loading ? (
          <div className="space-y-1.5">
            <Skeleton className="h-4 w-32" />
            <Skeleton className="h-3 w-20" />
          </div>
        ) : null}
      </div>

      {/* Chart */}
      <div className="mt-2 min-w-0">
        {error && !series ? (
          <div className="flex h-[420px] items-center justify-center rounded-lg bg-background/60 px-6 text-center">
            <p className="max-w-sm text-sm text-muted-foreground">{error}</p>
          </div>
        ) : chartOptions ? (
          <div className="min-w-0 overflow-hidden">
            <HighchartsReact highcharts={Highcharts} options={chartOptions} />
          </div>
        ) : (
          <Skeleton className="h-[420px] w-full rounded-lg" />
        )}
        <p className="mt-1 text-[10px] italic text-muted-foreground">Source: Ace Equity, Qode Advisors LLP</p>
      </div>
    </section>
  );
}

export default ValuationSpreadIndicator;
