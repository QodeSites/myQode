"use client";
import * as React from "react";

/* =========================
   Types
   ========================= */
type ReportItem = {
  name: string;
  snapshot: string;
  video_tutorial: string;
  used_for?: string;
};

type ReportGroup = {
  id: number;
  type_of_report: string;
  report_name: ReportItem[];
};

type FlatRow = {
  sr: number;
  type: string;
  name: string;
  snapshot: string;
  tutorial: string;
  used_for: string;
};
function Row({
  description,
  snapshotHref,
  videoHref,
}: {
  description: string;
  snapshotHref: string;
  videoHref: string;
}) {
  return (
    <div className="mb-3 last:mb-0">
      {/* ≥sm layout: 5 columns */}
      <div className="hidden sm:grid sm:grid-cols-5 sm:items-center sm:gap-2">
        <p className="sm:col-span-3 text-sm text-card-foreground">{description}</p>
        <div className="sm:col-span-1 text-center">
          <ViewLink href={snapshotHref} />
        </div>
        <div className="sm:col-span-1 text-center">
          <ViewLink href={videoHref} />
        </div>
      </div>

      {/* Mobile layout: stacked with inline labels */}
      <div className="grid grid-cols-1 gap-2 sm:hidden">
        <p className="text-sm text-card-foreground">{description}</p>

        <div className="grid grid-cols-2 items-center gap-2">
          <span className="text-xs font-medium text-muted-foreground">Snapshot</span>
          <div className="justify-self-end">
            <ViewLink href={snapshotHref} />
          </div>
        </div>

        <div className="grid grid-cols-2 items-center gap-2">
          <span className="text-xs font-medium text-muted-foreground">Video</span>
          <div className="justify-self-end">
            <ViewLink href={videoHref} />
          </div>
        </div>
      </div>

      {/* Divider for mobile only */}
      <div className="sm:hidden mt-3 h-px bg-border" />
    </div>
  );
}
/* =========================
   Data (typed)
   ========================= */
const reports_available: ReportGroup[] = [
  {
    id: 1,
    type_of_report: "Accounting & Financial Report",
    report_name: [
      { name: "Account Statement - Non unitized", snapshot: "", video_tutorial: "" },
      { name: "Account Statement - Non unitized", snapshot: "", video_tutorial: "" },
      {
        name: "Profit and Loss Account - Balance Sheet",
        snapshot: "",
        video_tutorial: "",
        used_for: "Annual Compliance Reports",
      },
      { name: "Trial Balance", snapshot: "", video_tutorial: "" },
    ],
  },
  {
    id: 2,
    type_of_report: "Activity Report",
    report_name: [
      {
        name: "Transaction Statement",
        snapshot: "",
        video_tutorial: "",
        used_for: "Annual Compliance Reports",
      },
      {
        name: "Capital Register",
        snapshot: "",
        video_tutorial: "",
        used_for: "Annual Compliance Reports",
      },
      { name: "Bank Book", snapshot: "", video_tutorial: "" },
    ],
  },
  {
    id: 3,
    type_of_report: "Income, Expenses & Tax Report",
    report_name: [
      { name: "Statement of Interest", snapshot: "", video_tutorial: "" },
      { name: "Statement of Dividend", snapshot: "", video_tutorial: "" },
      {
        name: "Corporate Benefit",
        snapshot: "",
        video_tutorial: "",
        used_for: "Annual Compliance Reports",
      },
      {
        name: "Statement of Expenses",
        snapshot: "",
        video_tutorial: "",
        used_for: "Annual Compliance Reports",
      },
      {
        name: "Statement of Capital Gain/Loss",
        snapshot: "",
        video_tutorial: "",
        used_for: "Annual Compliance Reports",
      },
    ],
  },
  {
    id: 4,
    type_of_report: "Portfolio Reporting & Performance",
    report_name: [
      { name: "Portfolio Fact Sheet", snapshot: "", video_tutorial: "" },
      { name: "Portfolio Position Analysis", snapshot: "", video_tutorial: "" },
      { name: "Portfolio Performance Summary", snapshot: "", video_tutorial: "" },
      {
        name: "Performance Appraisal",
        snapshot: "",
        video_tutorial: "",
        used_for: "Annual Compliance Reports",
      },
      { name: "Portfolio Performance with Benchmarks", snapshot: "", video_tutorial: "" },
      { name: "Performance by Security Since Inception", snapshot: "", video_tutorial: "" },
      { name: "Portfolio Appraisal", snapshot: "", video_tutorial: "" },
    ],
  },
  {
    id: 5,
    type_of_report: "Combined Report",
    report_name: [
      {
        name: "PMS Investor Report",
        snapshot: "",
        video_tutorial: "",
        used_for: "Quarterly Compliance Reports",
      },
    ],
  },
];

/* =========================
   Helpers
   ========================= */
function getFlatRows(data: ReportGroup[]): FlatRow[] {
  const rows: FlatRow[] = [];
  let sr = 1;
  data.forEach((group) => {
    group.report_name.forEach((rn) => {
      rows.push({
        sr: sr++,
        type: group.type_of_report,
        name: rn.name,
        snapshot: rn.snapshot,
        tutorial: rn.video_tutorial,
        used_for: rn.used_for ?? "",
      });
    });
  });
  return rows;
}

/* =========================
   UI Primitives
   ========================= */
function ViewLink({ href }: { href?: string }) {
  const link = (href ?? "").trim();
  const isLink = link.length > 0;
  return (
    <button
      type="button"
      className={`h-9 rounded-md border px-3 text-sm font-semibold transition
        ${isLink
          ? "border-border bg-primary text-white hover:brightness-105 focus:outline-none focus:ring-2 focus:ring-primary/40"
          : "border-dashed border-border text-muted-foreground cursor-not-allowed bg-muted"
        }`}
      disabled={!isLink}
      aria-disabled={!isLink}
    >
      {isLink ? "View" : "—"}
    </button>
  );
}

/* =========================
   Page (responsive)
   ========================= */
export default function ReportingPortalPage(): JSX.Element {
  const rows = React.useMemo(() => getFlatRows(reports_available), []);

  return (
    <main className="min-h-[100dvh] w-full bg-background text-foreground">
      {/* Banner */}
      <div className="w-full bg-primary px-4 py-2 text-center text-sm font-semibold text-white">
        Access all your portfolio details anytime on our secure reporting portal.
      </div>

      <section className="mx-auto w-full px-4 py-8 space-y-8">
        {/* Intro + Link */}
        <div className="space-y-4 text-center">
          <p className="mx-auto text-base leading-relaxed text-card-foreground">
            At Qode, transparency is central to our philosophy. That’s why we provide 24x7 access to your portfolio
            through <span className="mx-1 font-semibold">WealthSpectrum</span>, our secure reporting partner. From
            performance snapshots to tax packs, everything you need is organized in one place.
          </p>

          <div className="flex justify-center">
            <a
              href="https://eclientreporting.nuvamaassetservices.com/wealthspectrum/app/"
              target="_blank"
              rel="noreferrer"
              aria-label="Open WealthSpectrum reporting portal"
              className="inline-flex min-w-48 items-center justify-center rounded-md border border-border bg-primary px-4 py-2 text-lg font-semibold text-white hover:brightness-105 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
            >
              Open Reporting Portal
            </a>
          </div>
        </div>

        {/* What You Can Access */}
        <section aria-labelledby="access-title" className="w-full space-y-4">
          <h2
            id="access-title"
            className="rounded-sm bg-primary px-4 py-2 text-center text-sm font-bold tracking-wide text-white"
          >
            What You Can Access
          </h2>

          <div className="grid gap-4 md:grid-cols-5">
            {/* Left: Portfolio & Performance features (3 cols on md+) */}
            <div className="md:col-span-3">
              <div className="rounded-lg border border-border bg-card p-4">
                {/* Header (desktop/tablet only) */}
                <div className="hidden sm:grid sm:grid-cols-5 sm:items-start sm:gap-2 mb-3">
                  <h3 className="text-sm font-bold text-foreground sm:col-span-3 text-left">
                    Portfolio &amp; Performance
                  </h3>
                  <span className="text-sm font-bold text-foreground text-center">Snapshot</span>
                  <span className="text-sm font-bold text-foreground text-center">Video Tutorial</span>
                </div>

                {/* Rows */}
                <Row
                  description="Real-time snapshot of your investments."
                  snapshotHref=""
                  videoHref=""
                />
                <Row
                  description="Allocation across strategies, sectors, and asset classes."
                  snapshotHref=""
                  videoHref=""
                />
                <Row
                  description="Benchmark comparisons to track relative performance."
                  snapshotHref=""
                  videoHref=""
                />
              </div>
            </div>

            {/* Right: Transactions & Cash Flows (2 cols on md+) */}
            <div className="md:col-span-2">
              <div className="rounded-lg border border-border bg-card p-4 h-full">
                <h3 className="mb-3 text-sm font-bold text-foreground">Transactions &amp; Cash Flows</h3>
                <ul className="list-disc space-y-2 pl-5 text-sm text-card-foreground">
                  <li>Complete log of purchases, sales, top-ups, and withdrawals.</li>
                  <li>Corporate actions (dividends, splits, bonus issues) reflected seamlessly.</li>
                </ul>
              </div>
            </div>
          </div>
        </section>

        {/* Reports Available */}
        <section aria-labelledby="reports-title" className="space-y-4">
          <h2
            id="reports-title"
            className="rounded-sm bg-primary px-4 py-2 text-center text-sm font-bold tracking-wide text-white"
          >
            Reports Available
          </h2>

          {/* Grid-as-table (responsive) */}
          <div className="overflow-hidden rounded-lg border border-border">
            {/* Desktop header */}
            <div
              className="hidden md:grid md:grid-cols-6 gap-0 bg-card px-3 py-2 text-xs font-semibold text-foreground border-b border-border"
              role="row"
            >
              <div role="columnheader">Sr. No.</div>
              <div role="columnheader" className="col-span-1">
                Type of Report
              </div>
              <div role="columnheader" className="col-span-2">
                Report Name
              </div>
              <div role="columnheader">Snapshot</div>
              <div role="columnheader">Video Tutorial</div>
            </div>

            {/* Body rows */}
            <div className="divide-y divide-border">
              {rows.map((r) => (
                <div
                  key={`${r.sr}-${r.name}`}
                  className="md:grid md:grid-cols-6 items-center gap-0 px-3 py-3 text-sm"
                  role="row"
                >
                  {/* Mobile stacked labels */}
                  <div className="md:hidden space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="text-xs text-muted-foreground">Sr. No.</span>
                      <span className="font-medium">{r.sr}</span>
                    </div>
                    <div className="flex items-start justify-between gap-4">
                      <span className="text-xs text-muted-foreground whitespace-nowrap">Type</span>
                      <span className="text-right">{r.type}</span>
                    </div>
                    <div className="flex flex-col gap-1">
                      <span className="text-xs text-muted-foreground">Report Name</span>
                      <span className="font-medium">{r.name}</span>
                      {r.used_for ? (
                        <span className="text-[11px] text-muted-foreground">
                          Used for: <span className="font-medium">{r.used_for}</span>
                        </span>
                      ) : null}
                    </div>
                    <div className="flex items-center justify-between gap-4">
                      <span className="text-xs text-muted-foreground">Snapshot</span>
                      <ViewLink href={r.snapshot} />
                    </div>
                    <div className="flex items-center justify-between gap-4">
                      <span className="text-xs text-muted-foreground">Tutorial</span>
                      <ViewLink href={r.tutorial} />
                    </div>
                  </div>

                  {/* Desktop cells */}
                  <div role="cell" className="hidden md:block text-muted-foreground">
                    {r.sr}
                  </div>
                  <div role="cell" className="hidden md:block pr-2">
                    <span className="block text-foreground text-xs sm:text-sm">{r.type}</span>
                  </div>
                  <div role="cell" className="hidden md:block col-span-2 pr-2">
                    <div className="flex flex-col">
                      <span className="text-foreground">{r.name}</span>
                      {r.used_for ? (
                        <span className="mt-1 text-[11px] text-muted-foreground">
                          Used for: <span className="font-medium">{r.used_for}</span>
                        </span>
                      ) : null}
                    </div>
                  </div>
                  <div role="cell" className="hidden md:flex justify-start">
                    <ViewLink href={r.snapshot} />
                  </div>
                  <div role="cell" className="hidden md:flex justify-start">
                    <ViewLink href={r.tutorial} />
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>
      </section>
    </main>
  );
}
