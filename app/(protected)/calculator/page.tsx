"use client";

import * as React from "react";
import {
  Table,
  TableBody,
  TableCell,
  TableHeader,
  TableHead,
  TableRow,
} from "@/components/ui/table";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

// --- Types ---

type CalculatorRow = {
  id: number;
  clientName: string;
  strategy: string;
  inceptionDate: string | null;
  averageAum: string;
  performanceFees: string;
  performanceFeesGst: string;
  fixedFees: string;
  fixedFeesGst: string;
  totalFees: string;
  totalFeesGst: string;
  totalFeesCollected: string;
  distributorPercentage: string;
  distributorShare: string;
  accountcode?: string;
};

type Period = {
  type: "Quarter" | "Year";
  label: string;
  startDate: string; // e.g. "1-Apr-25"
  endDate: string;   // e.g. "31-Mar-26"
};

type PeriodApiResponse = {
  periods: Period[];
  suggestedPeriod: Period | null;
  maxInceptionDate: string; // iso string
};

// --- Utility ---

function toIsoDate(input: string): string {
  if (/^\d{4}-\d{2}-\d{2}$/.test(input)) return input; // already ISO
  const [d, mName, y] = input.split("-");
  const months: Record<string, string> = {
    Jan: "01", Feb: "02", Mar: "03", Apr: "04", May: "05", Jun: "06",
    Jul: "07", Aug: "08", Sep: "09", Oct: "10", Nov: "11", Dec: "12"
  };
  const year = y.length === 2 ? "20" + y : y;
  return [
    year,
    months[mName],
    d.padStart(2, "0")
  ].join("-");
}

function formatRangeLabel(period: Period) {
  return `${period.label} (${period.startDate} - ${period.endDate})`;
}

// --- Main Component ---

export default function Calculator() {
  const [periodsData, setPeriodsData] = React.useState<PeriodApiResponse | null>(null);
  const [periodsLoading, setPeriodsLoading] = React.useState(true);
  const [periodsError, setPeriodsError] = React.useState<string | null>(null);

  // Selected period (object ref by label)
  const [selectedPeriodLabel, setSelectedPeriodLabel] = React.useState<string>("");

  // Table state
  const [rows, setRows] = React.useState<CalculatorRow[]>([]);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  // Fetch period options from API (GET)
  React.useEffect(() => {
    const fetchPeriods = async () => {
      setPeriodsLoading(true);
      setPeriodsError(null);
      try {
        const res = await fetch("/api/distributor/calculator", {
          method: "GET",
          headers: { "Accept": "application/json" },
        });
        if (!res.ok) throw new Error(`Failed to fetch periods (${res.status})`);
        const obj = await res.json() as PeriodApiResponse;
        if (!obj || !Array.isArray(obj.periods) || obj.periods.length === 0) {
          throw new Error("Invalid period response");
        }
        setPeriodsData(obj);
        // Prefer suggestedPeriod if exists, else first one
        const initPeriod = obj.suggestedPeriod || obj.periods[0];
        setSelectedPeriodLabel(initPeriod.label);
      } catch (e: any) {
        setPeriodsError(e.message || "Failed to load period options");
      }
      setPeriodsLoading(false);
    };
    fetchPeriods();
  }, []);

  // Get currently-selected period object
  const selectedPeriod = React.useMemo(() => {
    if (!periodsData) return null;
    return periodsData.periods.find(p => p.label === selectedPeriodLabel) || null;
  }, [periodsData, selectedPeriodLabel]);

  // Fetch table data from API (POST) for that period
  React.useEffect(() => {
    if (!selectedPeriod) return;
    const fetchRows = async () => {
      setLoading(true);
      setError(null);
      try {
        const reqBody = {
          startDate: toIsoDate(selectedPeriod.startDate),
          endDate: toIsoDate(selectedPeriod.endDate),
        };
        const res = await fetch("/api/distributor/calculator", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(reqBody),
        });
        if (!res.ok) throw new Error(`API error (${res.status}): ${await res.text()}`);
        // Adapt incoming API to our UI columns
        const apiRows = await res.json() as any[];
        const mappedRows: CalculatorRow[] = apiRows.map((r) => ({
          id: r.id,
          clientName: r.clientName,
          strategy: r.strategy,
          inceptionDate: r.inceptionDate ?? null,
          averageAum: r.averageAum,
          performanceFees: r.performanceFees,
          performanceFeesGst: r.performanceFeesGst,
          fixedFees: r.fixedFees,
          fixedFeesGst: r.fixedFeesGst,
          totalFees: r.totalFees,
          totalFeesGst: r.totalFeesGst,
          totalFeesCollected: r.totalFeesCollected,
          distributorPercentage: r.distributorPercentage,
          distributorShare: r.distributorShare,
          accountcode: r.accountcode,
        }));
        setRows(mappedRows);
      } catch (e: any) {
        setError(e.message || "Failed to load data");
        setRows([]);
      }
      setLoading(false);
    };
    fetchRows();
  }, [selectedPeriod]);

  // Totals
  const totalAum = rows.reduce(
    (sum, row) => sum + (parseFloat(row.averageAum.replace(/,/g, "")) || 0), 0
  );
  const avgAumPerClient = rows.length > 0 ? totalAum / rows.length : 0;

  const totalPerfFees = rows.reduce(
    (sum, row) => sum + (parseFloat(row.performanceFees.replace(/,/g, "")) || 0), 0
  );

  const totalFixedFees = rows.reduce(
    (sum, row) => sum + (parseFloat(row.fixedFees.replace(/,/g, "")) || 0), 0
  );
  const totalPerfFeesGst = rows.reduce(
    (sum, row) => sum + (parseFloat(row.performanceFeesGst?.replace(/,/g, "")) || 0), 0
  );
  const totalFixedFeesGst = rows.reduce(
    (sum, row) => sum + (parseFloat(row.fixedFeesGst?.replace(/,/g, "")) || 0), 0
  );
  const totalFees = rows.reduce(
    (sum, row) => sum + (parseFloat(row.totalFees?.replace(/,/g, "")) || 0), 0
  );
  const totalFeesGst = rows.reduce(
    (sum, row) => sum + (parseFloat(row.totalFeesGst?.replace(/,/g, "")) || 0), 0
  );
  const totalFeesCollected = rows.reduce(
    (sum, row) => sum + (parseFloat(row.totalFeesCollected?.replace(/,/g, "")) || 0), 0
  );

  const totalWithGst = totalFees + totalFeesGst;
  // Use average of distributor percentage if not consistent for all rows
  const distributorPercentage =
    rows.length && rows[0].distributorPercentage
      ? rows[0].distributorPercentage
      : "—";
  const totalDistributorShare = rows.reduce(
    (sum, row) => sum + (parseFloat(row.distributorShare.replace(/,/g, "")) || 0), 0
  );

  const formatNumber = (num: number) =>
    num.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  // --- RENDER ---

  return (
    <div className="flex flex-col gap-2 space-y-6 w-full mx-auto">
      {/* Period Selector */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center gap-2">
        <label className="font-medium text-green-900 text-sm min-w-32">Period:</label>
        <div className="w-full sm:w-96">
          {periodsLoading ? (
            <div className="text-green-900">Loading periods...</div>
          ) : periodsError ? (
            <div className="text-red-700 font-medium">{periodsError}</div>
          ) : periodsData ? (
            <Select
              value={selectedPeriodLabel}
              onValueChange={setSelectedPeriodLabel}
            >
              <SelectTrigger className="w-full">
                <SelectValue placeholder="Select Period" />
              </SelectTrigger>
              <SelectContent>
                {periodsData.periods.map(period => (
                  <SelectItem key={period.label} value={period.label}>
                    {formatRangeLabel(period)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : null}
        </div>
      </div>
      {/* Selected Range Summary */}
      {selectedPeriod && (
        <div className="flex flex-wrap gap-1">
          <span
            key={selectedPeriod.label}
            className="inline-flex items-center gap-1 bg-green-100 text-green-900 text-xs px-3 py-1.5 rounded-full"
          >
            <strong>Period:</strong>
            <span className="text-green-700">
              {selectedPeriod.label} ({selectedPeriod.startDate} - {selectedPeriod.endDate})
            </span>
          </span>
        </div>
      )}

      {/* Error and loading states */}
      {error && <div className="text-red-700 font-medium">{error}</div>}
      {loading && <div className="text-green-900">Loading...</div>}

      {/* Table */}
      <div className="rounded-lg border shadow-sm bg-white overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow className="bg-green-900 hover:bg-green-900">
              <TableHead className="text-white text-xs font-medium px-4 py-3">#</TableHead>
              <TableHead className="text-white text-xs font-medium px-4 py-3">Client Name</TableHead>
              <TableHead className="text-white text-xs font-medium px-4 py-3">Strategy</TableHead>
              <TableHead className="text-white text-xs font-medium px-4 py-3">Inception Date</TableHead>
              <TableHead className="text-white text-xs font-medium px-4 py-3 text-right">Daily Avg AUM</TableHead>
              <TableHead className="text-white text-xs font-medium px-4 py-3 text-right">Perf. Fees</TableHead>
              {/* <TableHead className="text-white text-xs font-medium px-4 py-3 text-right">Perf. Fees GST</TableHead> */}
              <TableHead className="text-white text-xs font-medium px-4 py-3 text-right">Fixed Fees</TableHead>
              {/* <TableHead className="text-white text-xs font-medium px-4 py-3 text-right">Fixed Fees GST</TableHead> */}
              <TableHead className="text-white text-xs font-medium px-4 py-3 text-right">Total Fees</TableHead>
              <TableHead className="text-white text-xs font-medium px-4 py-3 text-right">Total Fees GST</TableHead>
              <TableHead className="text-white text-xs font-medium px-4 py-3 text-right">Total (Fees + GST)</TableHead>
              <TableHead className="text-white text-xs font-medium px-4 py-3 text-right">Distributor %</TableHead>
              <TableHead className="text-white text-xs font-medium px-4 py-3 text-right">Distributor Share</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row) => (
              <TableRow key={row.id} className="odd:bg-white even:bg-gray-50">
                <TableCell className="px-4 py-3 text-sm text-green-900">{row.id}</TableCell>
                <TableCell className="px-4 py-3 text-sm text-green-900 font-medium">
                  {row.clientName}
                </TableCell>
                <TableCell className="px-4 py-3 text-sm text-green-900">{row.strategy}</TableCell>
                <TableCell className="px-4 py-3 text-sm text-green-900">
                  {row.inceptionDate ?? "—"}
                </TableCell>
                <TableCell className="px-4 py-3 text-sm text-right text-green-900">
                  {row.averageAum}
                </TableCell>
                <TableCell className="px-4 py-3 text-sm text-right text-green-900">
                  {row.performanceFees}
                </TableCell>
                {/* <TableCell className="px-4 py-3 text-sm text-right text-green-900">
                  {row.performanceFeesGst}
                </TableCell> */}
                <TableCell className="px-4 py-3 text-sm text-right text-green-900">
                  {row.fixedFees}
                </TableCell>
                {/* <TableCell className="px-4 py-3 text-sm text-right text-green-900">
                  {row.fixedFeesGst}
                </TableCell> */}
                <TableCell className="px-4 py-3 text-sm text-right text-green-900 font-medium">
                  {row.totalFees}
                </TableCell>
                <TableCell className="px-4 py-3 text-sm text-right text-green-900 font-medium">
                  {row.totalFeesGst}
                </TableCell>
                <TableCell className="px-4 py-3 text-sm text-right text-green-900 font-medium">
                  {formatNumber(
                    (parseFloat(row.totalFees?.replace(/,/g, "")) || 0) +
                    (parseFloat(row.totalFeesGst?.replace(/,/g, "")) || 0)
                  )}
                </TableCell>
                <TableCell className="px-4 py-3 text-sm text-right text-green-900 font-medium">
                  {row.distributorPercentage}
                </TableCell>
                <TableCell className="px-4 py-3 text-sm text-right text-green-900 font-medium">
                  {row.distributorShare}
                </TableCell>
              </TableRow>
            ))}

            {/* Total Row */}
            <TableRow className="bg-green-50 font-bold border-t-2 border-green-200">
              <TableCell colSpan={4} className="px-4 py-4 text-green-900">
                Total
              </TableCell>
              <TableCell className="px-4 py-4 text-right text-green-900">
                {rows.length > 0 ? formatNumber(avgAumPerClient) : "—"}
              </TableCell>
              <TableCell className="px-4 py-4 text-right text-green-900">
                {formatNumber(totalPerfFees)}
              </TableCell>
              {/* <TableCell className="px-4 py-4 text-right text-green-900">
                {formatNumber(totalPerfFeesGst)}
              </TableCell> */}
              <TableCell className="px-4 py-4 text-right text-green-900">
                {formatNumber(totalFixedFees)}
              </TableCell>
              {/* <TableCell className="px-4 py-4 text-right text-green-900">
                {formatNumber(totalFixedFeesGst)}
              </TableCell> */}
              <TableCell className="px-4 py-4 text-right text-green-900 font-medium">
                {formatNumber(totalFees)}
              </TableCell>
              <TableCell className="px-4 py-4 text-right text-green-900 font-medium">
                {formatNumber(totalFeesGst)}
              </TableCell>
              <TableCell className="px-4 py-4 text-right text-green-900 font-medium">
                {formatNumber(totalWithGst)}
              </TableCell>
              <TableCell className="px-4 py-4 text-right text-green-900 font-medium">
                {distributorPercentage}
              </TableCell>
              <TableCell className="px-4 py-4 text-right text-green-900 font-medium">
                {formatNumber(totalDistributorShare)}
              </TableCell>
            </TableRow>
          </TableBody>
        </Table>
      </div>
      <div className="mt-6 p-3 rounded bg-yellow-50 text-yellow-900 text-sm font-medium border border-yellow-200">
        <span className="font-semibold">Note:</span> We charge fixed fees on a quarterly basis, and performance fees on a yearly basis. Please raise an invoice for the value displayed.
      </div>
    </div>
  );
}