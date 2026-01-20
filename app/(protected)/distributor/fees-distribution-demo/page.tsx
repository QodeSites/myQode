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
  billgroup?: string;
};

type Period = {
  type: "Quarter" | "Year";
  label: string;
  startDate: string;
  endDate: string;
};

// --- Utility ---

function formatRangeLabel(period: Period) {
  return `${period.label} (${period.startDate} - ${period.endDate})`;
}

// Parse billgroup string like "QODEPMS MF1.5 PF15 H10 Q NEW" into fee structure
function parseBillgroupFees(billgroup: string | undefined): {
  managementFees: string;
  performanceFees: string;
  hurdleRate: string;
} | null {
  if (!billgroup) return null;

  const mfMatch = billgroup.match(/MF([\d.]+)/);
  const pfMatch = billgroup.match(/PF([\d.]+)/);
  const hMatch = billgroup.match(/H([\d.]+)/);

  if (!mfMatch && !pfMatch && !hMatch) return null;

  return {
    managementFees: mfMatch ? `${mfMatch[1]}%` : "—",
    performanceFees: pfMatch ? `${pfMatch[1]}%` : "—",
    hurdleRate: hMatch ? `${hMatch[1]}%` : "—",
  };
}

// --- Dummy Data ---

const dummyPeriods: Period[] = [
  {
    type: "Quarter",
    label: "Q1 FY26",
    startDate: "1-Apr-25",
    endDate: "30-Jun-25",
  },
  {
    type: "Quarter",
    label: "Q2 FY26",
    startDate: "1-Jul-25",
    endDate: "30-Sep-25",
  },
  {
    type: "Quarter",
    label: "Q3 FY26",
    startDate: "1-Oct-25",
    endDate: "31-Dec-25",
  },
  {
    type: "Year",
    label: "FY25",
    startDate: "1-Apr-24",
    endDate: "31-Mar-25",
  },
];

const dummyRows: CalculatorRow[] = [
  {
    id: 1,
    clientName: "XYZ Alpha Corp",
    strategy: "Qode Growth Fund",
    inceptionDate: "15-Jan-24",
    averageAum: "50,00,000.00",
    performanceFees: "75,000.00",
    performanceFeesGst: "13,500.00",
    fixedFees: "25,000.00",
    fixedFeesGst: "4,500.00",
    totalFees: "1,00,000.00",
    totalFeesGst: "18,000.00",
    totalFeesCollected: "1,18,000.00",
    distributorPercentage: "30%",
    distributorShare: "35,400.00",
    accountcode: "ACC001",
    billgroup: "QODEPMS MF1.5 PF15 H10 Q NEW",
  },
  {
    id: 2,
    clientName: "XYZ Beta Holdings",
    strategy: "Qode Tactical Fund",
    inceptionDate: "22-Mar-23",
    averageAum: "75,00,000.00",
    performanceFees: "1,12,500.00",
    performanceFeesGst: "20,250.00",
    fixedFees: "37,500.00",
    fixedFeesGst: "6,750.00",
    totalFees: "1,50,000.00",
    totalFeesGst: "27,000.00",
    totalFeesCollected: "1,77,000.00",
    distributorPercentage: "30%",
    distributorShare: "53,100.00",
    accountcode: "ACC002",
    billgroup: "QODEPMS MF2.0 PF20 H12 Q NEW",
  },
  {
    id: 3,
    clientName: "XYZ Gamma Ventures",
    strategy: "Qode Growth Fund",
    inceptionDate: "10-Aug-24",
    averageAum: "1,00,00,000.00",
    performanceFees: "1,50,000.00",
    performanceFeesGst: "27,000.00",
    fixedFees: "50,000.00",
    fixedFeesGst: "9,000.00",
    totalFees: "2,00,000.00",
    totalFeesGst: "36,000.00",
    totalFeesCollected: "2,36,000.00",
    distributorPercentage: "30%",
    distributorShare: "70,800.00",
    accountcode: "ACC003",
    billgroup: "QODEPMS MF1.8 PF18 H15 Q NEW",
  },
];

// --- Main Component ---

export default function DemoCalculator() {
  // Selected period (object ref by label)
  const [selectedPeriodLabel, setSelectedPeriodLabel] = React.useState<string>(dummyPeriods[0].label);

  // Table state with dummy data
  const [rows] = React.useState<CalculatorRow[]>(dummyRows);
  const [loading] = React.useState(false);
  const [error] = React.useState<string | null>(null);

  // Get currently-selected period object
  const selectedPeriod = React.useMemo(() => {
    return dummyPeriods.find(p => p.label === selectedPeriodLabel) || null;
  }, [selectedPeriodLabel]);

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
      {/* Demo Badge */}
      <div className="mb-2 p-4 rounded-lg bg-blue-100 border-2 border-blue-300">
        <div className="text-blue-900 font-bold text-lg">📊 DEMO PAGE - Sample Data</div>
        <div className="text-blue-700 text-sm mt-1">
          This is a replica with dummy data. All client names are "XYZ" and numbers are for demonstration purposes only.
        </div>
      </div>

      {/* Period Selector */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center gap-2 mb-2">
        <label className="font-medium text-green-900 text-sm min-w-32">Period:</label>
        <div className="w-full sm:w-96">
          <Select
            value={selectedPeriodLabel}
            onValueChange={setSelectedPeriodLabel}
          >
            <SelectTrigger className="w-full">
              <SelectValue placeholder="Select Period" />
            </SelectTrigger>
            <SelectContent>
              {dummyPeriods.map(period => (
                <SelectItem key={period.label} value={period.label}>
                  {formatRangeLabel(period)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* Selected Range Summary */}
      {selectedPeriod && (
        <div className="flex flex-wrap gap-1 mb-2">
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

      {/* --- New Section: Client Name & Fees Structure Overview --- */}
      {rows.length > 0 && (
        <div className="mb-1 rounded-lg border shadow-sm bg-white overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow className="bg-green-900 hover:bg-green-900">
                <TableHead className="text-white text-base font-medium px-6 py-4">#</TableHead>
                <TableHead className="text-white text-base font-medium px-6 py-4">Client Name</TableHead>
                <TableHead className="text-white text-base font-medium px-6 py-4">Fees Structure</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row) => {
                const feeStructure = parseBillgroupFees(row.billgroup);
                return (
                  <TableRow key={row.id} className="odd:bg-white even:bg-gray-50">
                    <TableCell className="px-6 py-4 text-base text-green-900">{row.id}</TableCell>
                    <TableCell className="px-6 py-4 text-base text-green-900 font-medium">{row.clientName}</TableCell>
                    <TableCell className="px-6 py-4 text-base text-green-900">
                      {feeStructure ? (
                        <div className="space-y-1">
                          <div>Management Fees: {feeStructure.managementFees}</div>
                          <div>Performance Fees: {feeStructure.performanceFees}</div>
                          <div>Hurdle Rate: {feeStructure.hurdleRate}</div>
                        </div>
                      ) : (
                        <span>{row.billgroup || "—"}</span>
                      )}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      )}

      {/* Error and loading states */}
      {error && <div className="text-red-700 font-medium">{error}</div>}
      {loading && <div className="text-green-900">Loading...</div>}

      {/* Table */}
      <div className="mb-1 rounded-lg border shadow-sm bg-white overflow-hidden">
        {rows.length === 0 ? (
          <div className="p-8 text-center text-lg text-green-900 font-semibold">
            Not enough Data!
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow className="bg-green-900 hover:bg-green-900">
                <TableHead className="text-white text-base font-medium px-6 py-4">#</TableHead>
                <TableHead className="text-white text-base font-medium px-6 py-4">Client Name</TableHead>
                <TableHead className="text-white text-base font-medium px-6 py-4">Strategy</TableHead>
                <TableHead className="text-white text-base font-medium px-6 py-4">Inception Date</TableHead>
                <TableHead className="text-white text-base font-medium px-6 py-4 text-right">Daily Avg AUM</TableHead>
                <TableHead className="text-white text-base font-medium px-6 py-4 text-right">Perf. Fees</TableHead>
                <TableHead className="text-white text-base font-medium px-6 py-4 text-right">Fixed Fees</TableHead>
                <TableHead className="text-white text-base font-medium px-6 py-4 text-right">Total Fees</TableHead>
                <TableHead className="text-white text-base font-medium px-6 py-4 text-right">Total Fees GST</TableHead>
                <TableHead className="text-white text-base font-medium px-6 py-4 text-right">Total (Fees + GST)</TableHead>
                <TableHead className="text-white text-base font-medium px-6 py-4 text-right">Distributor %</TableHead>
                <TableHead className="text-white text-base font-medium px-6 py-4 text-right">Distributor Share</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row) => (
                <TableRow key={row.id} className="odd:bg-white even:bg-gray-50">
                  <TableCell className="px-6 py-4 text-base text-green-900">{row.id}</TableCell>
                  <TableCell className="px-6 py-4 text-base text-green-900 font-medium">
                    {row.clientName}
                  </TableCell>
                  <TableCell className="px-6 py-4 text-base text-green-900">{row.strategy}</TableCell>
                  <TableCell className="px-6 py-4 text-base text-green-900">
                    {row.inceptionDate ?? "—"}
                  </TableCell>
                  <TableCell className="px-6 py-4 text-base text-right text-green-900">
                    {row.averageAum}
                  </TableCell>
                  <TableCell className="px-6 py-4 text-base text-right text-green-900">
                    {row.performanceFees}
                  </TableCell>
                  <TableCell className="px-6 py-4 text-base text-right text-green-900">
                    {row.fixedFees}
                  </TableCell>
                  <TableCell className="px-6 py-4 text-base text-right text-green-900 font-medium">
                    {row.totalFees}
                  </TableCell>
                  <TableCell className="px-6 py-4 text-base text-right text-green-900 font-medium">
                    {row.totalFeesGst}
                  </TableCell>
                  <TableCell className="px-6 py-4 text-base text-right text-green-900 font-medium">
                    {formatNumber(
                      (parseFloat(row.totalFees?.replace(/,/g, "")) || 0) +
                      (parseFloat(row.totalFeesGst?.replace(/,/g, "")) || 0)
                    )}
                  </TableCell>
                  <TableCell className="px-6 py-4 text-base text-right text-green-900 font-medium">
                    {row.distributorPercentage}
                  </TableCell>
                  <TableCell className="px-6 py-4 text-base text-right text-green-900 font-medium">
                    {row.distributorShare}
                  </TableCell>
                </TableRow>
              ))}

              {/* Total Row */}
              <TableRow className="bg-green-50 font-bold border-t-2 border-green-200">
                <TableCell colSpan={4} className="px-6 py-5 text-lg text-green-900">
                  Total
                </TableCell>
                <TableCell className="px-6 py-5 text-lg text-right text-green-900">
                  {rows.length > 0 ? formatNumber(avgAumPerClient) : "—"}
                </TableCell>
                <TableCell className="px-6 py-5 text-lg text-right text-green-900">
                  {formatNumber(totalPerfFees)}
                </TableCell>
                <TableCell className="px-6 py-5 text-lg text-right text-green-900">
                  {formatNumber(totalFixedFees)}
                </TableCell>
                <TableCell className="px-6 py-5 text-lg text-right text-green-900 font-medium">
                  {formatNumber(totalFees)}
                </TableCell>
                <TableCell className="px-6 py-5 text-lg text-right text-green-900 font-medium">
                  {formatNumber(totalFeesGst)}
                </TableCell>
                <TableCell className="px-6 py-5 text-lg text-right text-green-900 font-medium">
                  {formatNumber(totalWithGst)}
                </TableCell>
                <TableCell className="px-6 py-5 text-lg text-right text-green-900 font-medium">
                  {distributorPercentage}
                </TableCell>
                <TableCell className="px-6 py-5 text-lg text-right text-green-900 font-medium">
                  {formatNumber(totalDistributorShare)}
                </TableCell>
              </TableRow>
            </TableBody>
          </Table>
        )}
      </div>
      <div className="mt-1 p-3 rounded bg-yellow-50 text-yellow-900 text-sm font-medium border border-yellow-200">
        <span className="font-semibold">Note:</span> We charge fixed fees on a quarterly basis, and performance fees on a yearly basis. Please raise an invoice for the value displayed.
      </div>
    </div>
  );
}
