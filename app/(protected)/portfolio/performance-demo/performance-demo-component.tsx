"use client";

import React, { useState, useCallback, useMemo } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  TrendingUp,
  TrendingDown,
  Wallet,
  IndianRupeeIcon as RupeeIcon,
  Percent,
  Calendar,
  ArrowUpRight,
  ArrowDownRight,
  Activity,
  Download
} from "lucide-react";
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer
} from "recharts";
import { Button } from "@/components/ui/button";

// Import Lato font
const latoFontStyle = `
  @import url('https://fonts.googleapis.com/css2?family=Lato:wght@400;700&display=swap');
`;

/* =========================
   Types
   ========================= */
type FamilyAccount = {
  clientid: string;
  clientcode: string;
  holderName: string;
  relation: string;
  status: string;
  email?: string;
};

type HistoricalData = {
  report_date: string;
  nav: number;
  portfolio_value: number;
  drawdown_percent: number;
  cash_in_out: number;
};

type BenchmarkItem = {
  date: string;
  value: number;
};

interface QuarterlyPnlData {
  [year: string]: {
    percent: { q1: string; q2: string; q3: string; q4: string; total: string };
    cash: { q1: string; q2: string; q3: string; q4: string; total: string };
    yearCash: string;
  };
}

interface MonthlyPnlData {
  [year: string]: {
    months: {
      [month: string]: {
        percent: string;
        cash: string;
        capitalInOut: string;
      };
    };
    totalPercent: number;
    totalCash: number;
    totalCapitalInOut: number;
  };
}

/* =========================
   Dummy Data
   ========================= */
const dummyFamilyAccounts: FamilyAccount[] = [
  {
    clientid: "1",
    clientcode: "QAW00001",
    holderName: "John Doe",
    relation: "Self",
    status: "Active",
    email: "john.doe@example.com"
  },
  {
    clientid: "2",
    clientcode: "QTF00002",
    holderName: "Jane Doe",
    relation: "Spouse",
    status: "Active",
    email: "jane.doe@example.com"
  },
  {
    clientid: "3",
    clientcode: "QGF00003",
    holderName: "Robert Doe",
    relation: "Son",
    status: "Active",
    email: "robert.doe@example.com"
  }
];

// Generate dummy historical data
const generateDummyHistoricalData = (startDate: Date, days: number, startNav: number): HistoricalData[] => {
  const data: HistoricalData[] = [];
  let currentNav = startNav;
  let portfolioValue = 2500000; // Starting portfolio value of 25 lakh

  for (let i = 0; i < days; i++) {
    const date = new Date(startDate);
    date.setDate(date.getDate() + i);

    // Skip weekends
    if (date.getDay() === 0 || date.getDay() === 6) continue;

    // Random daily return between -2% and +2.5%
    const dailyReturn = (Math.random() - 0.45) * 0.04;
    currentNav = currentNav * (1 + dailyReturn);
    portfolioValue = portfolioValue * (1 + dailyReturn);

    // Add occasional cash flows - Total 50 lakhs invested
    let cashInOut = 0;
    if (i === 0) {
      cashInOut = 2500000; // Initial investment - 25 lakh
    } else if (i === 90) {
      cashInOut = 1500000; // Additional investment at 3 months - 15 lakh
    } else if (i === 180) {
      cashInOut = 1000000; // Additional investment at 6 months - 10 lakh
    } else if (i === 270) {
      cashInOut = 0; // No withdrawal
    }

    if (cashInOut !== 0) {
      portfolioValue += cashInOut;
    }

    data.push({
      report_date: date.toISOString().split('T')[0],
      nav: Number(currentNav.toFixed(4)),
      portfolio_value: Number(portfolioValue.toFixed(2)),
      drawdown_percent: 0, // Will be calculated later
      cash_in_out: cashInOut
    });
  }

  return data;
};

// Generate benchmark data
const generateBenchmarkData = (startDate: Date, days: number, startValue: number): BenchmarkItem[] => {
  const data: BenchmarkItem[] = [];
  let currentValue = startValue;

  for (let i = 0; i < days; i++) {
    const date = new Date(startDate);
    date.setDate(date.getDate() + i);

    if (date.getDay() === 0 || date.getDay() === 6) continue;

    // Slightly lower returns for benchmark
    const dailyReturn = (Math.random() - 0.48) * 0.035;
    currentValue = currentValue * (1 + dailyReturn);

    data.push({
      date: date.toISOString().split('T')[0],
      value: Number(currentValue.toFixed(4))
    });
  }

  return data;
};

// Pre-generate dummy data
const startDate = new Date('2023-01-01');
const dummyHistoricalData = generateDummyHistoricalData(startDate, 500, 100);
const dummyBenchmarkData = generateBenchmarkData(startDate, 500, 100);

// Dummy quarterly PnL - reflects 50 lakh investment
const dummyQuarterlyPnl: QuarterlyPnlData = {
  "2023": {
    percent: { q1: "5.23", q2: "3.45", q3: "-1.20", q4: "7.89", total: "15.87" },
    cash: { q1: "130750", q2: "143175", q3: "-60000", q4: "394500", total: "608425" },
    yearCash: "5000000"
  },
  "2024": {
    percent: { q1: "8.12", q2: "4.56", q3: "2.34", q4: "6.78", total: "23.45" },
    cash: { q1: "468920", q2: "282360", q3: "151710", q4: "452070", total: "1355060" },
    yearCash: "0"
  }
};

// Dummy monthly PnL - reflects 50 lakh investment
const dummyMonthlyPnl: MonthlyPnlData = {
  "2023": {
    months: {
      "January": { percent: "2.34", cash: "58500", capitalInOut: "2500000" },
      "February": { percent: "1.56", cash: "40950", capitalInOut: "0" },
      "March": { percent: "1.33", cash: "36300", capitalInOut: "0" },
      "April": { percent: "0.89", cash: "35560", capitalInOut: "1500000" },
      "May": { percent: "1.23", cash: "52275", capitalInOut: "0" },
      "June": { percent: "1.33", cash: "58850", capitalInOut: "0" },
      "July": { percent: "-0.45", cash: "-22500", capitalInOut: "1000000" },
      "August": { percent: "-0.34", cash: "-17510", capitalInOut: "0" },
      "September": { percent: "-0.41", cash: "-21375", capitalInOut: "0" },
      "October": { percent: "2.56", cash: "134400", capitalInOut: "0" },
      "November": { percent: "2.89", cash: "156060", capitalInOut: "0" },
      "December": { percent: "2.44", cash: "135850", capitalInOut: "0" }
    },
    totalPercent: 15.87,
    totalCash: 608425,
    totalCapitalInOut: 5000000
  },
  "2024": {
    months: {
      "January": { percent: "3.45", cash: "199410", capitalInOut: "0" },
      "February": { percent: "2.34", cash: "139620", capitalInOut: "0" },
      "March": { percent: "2.33", cash: "143216", capitalInOut: "0" },
      "April": { percent: "1.56", cash: "98592", capitalInOut: "0" },
      "May": { percent: "1.67", cash: "108238", capitalInOut: "0" },
      "June": { percent: "1.33", cash: "88502", capitalInOut: "0" },
      "July": { percent: "0.89", cash: "60572", capitalInOut: "0" },
      "August": { percent: "0.78", cash: "54210", capitalInOut: "0" },
      "September": { percent: "0.67", cash: "47530", capitalInOut: "0" },
      "October": { percent: "2.34", cash: "169572", capitalInOut: "0" },
      "November": { percent: "2.56", cash: "188928", capitalInOut: "0" },
      "December": { percent: "1.88", cash: "141376", capitalInOut: "0" }
    },
    totalPercent: 23.45,
    totalCash: 1355060,
    totalCapitalInOut: 0
  }
};

/* =========================
   Helper Functions
   ========================= */
const strategyColorConfig = {
  QAW: {
    primary: "#008455",
    secondary: "#001E13",
    strategy: "#008455",
    gradient1: "#008455",
    gradient2: "#001E13"
  },
  QTF: {
    primary: "#550E0E",
    secondary: "#360404",
    strategy: "#550E0E",
    gradient1: "#550E0E",
    gradient2: "#360404"
  },
  QGF: {
    primary: "#0A3452",
    secondary: "#051E31",
    strategy: "#3b82f6",
    gradient1: "#0A3452",
    gradient2: "#051E31"
  }
};

const strategyNames = {
  QAW: 'Qode All Weather',
  QTF: 'Qode Tactical Fund',
  QGF: 'Qode Growth Fund'
};

const formatCurrency = (value: number | undefined | null) => {
  if (value === undefined || value === null || isNaN(Number(value))) return "₹0.00";
  const numValue = Number(value).toFixed(2);
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(Number(numValue));
};

const formatPercent = (value: number | undefined | null) => {
  if (value === undefined || value === null || isNaN(Number(value))) return "0.00%";
  return `${Number(value).toFixed(2)}%`;
};

const formatDate = (dateString: string) => {
  return new Date(dateString).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric'
  });
};

// Helper function to calculate Y-axis domain with padding
const calculateYDomain = (data: number[], paddingPercent: number = 5) => {
  if (data.length === 0) return [0, 100];

  const min = Math.min(...data);
  const max = Math.max(...data);
  const range = max - min;
  const padding = range * (paddingPercent / 100);

  return [
    Math.floor(min - padding),
    Math.ceil(max + padding)
  ];
};

// Custom Tooltip Component
const CustomTooltip = ({ active, payload, label, data }: any) => {
  if (active && payload && payload.length) {
    const date = new Date(label);
    const formattedDate = `${date.getDate()}/${date.getMonth() + 1}/${date.getFullYear()}`;
    const tooltipData = data.find((d: any) => d.report_date === label);
    const baseNav = data.length > 0 ? Number(data[0].normalized_nav) : 10;
    return (
      <div className="bg-background border border-border rounded-lg p-3 shadow-lg" style={{ fontFamily: 'Lato, sans-serif', fontSize: '12px' }}>
        <p className="text-sm font-medium mb-1">{formattedDate}</p>
        {payload.map((entry: any, index: number) => {
          const val = Number(entry.value);
          const isGrowth = entry.name === 'Portfolio Growth' || entry.name === 'BSE 500';
          const display = isGrowth ? `${((val / baseNav - 1) * 100).toFixed(2)}%` : `${val.toFixed(2)}%`;
          return (
            <div key={index}>
              <p
                className="text-sm font-semibold"
                style={{ color: entry.color }}
              >
                {entry.name}: {display}
              </p>
              {(entry.name === 'Portfolio Growth' || entry.name === 'Drawdown') && tooltipData && (
                <p className="text-sm text-muted-foreground">
                  NAV: {tooltipData.nav}
                </p>
              )}
              {(entry.name === 'BSE 500' || entry.name === 'BSE 500 Drawdown') && tooltipData && tooltipData.benchmark_value !== undefined && (
                <p className="text-sm text-muted-foreground">
                  BSE 500: {tooltipData.benchmark_value.toFixed(2)}
                </p>
              )}
            </div>
          );
        })}
      </div>
    );
  }
  return null;
};

function findLatestBenchmarkBeforeOrOn(benchData: BenchmarkItem[], targetDateStr: string) {
  const target = new Date(targetDateStr);
  for (let i = benchData.length - 1; i >= 0; i--) {
    const bDate = new Date(benchData[i].date);
    if (bDate <= target) {
      return benchData[i];
    }
  }
  return null;
}

const isPositiveReturn = (val: any) => typeof val === 'number' && val > 0;
const isNegativeReturn = (val: any) => typeof val === 'number' && val < 0;
const formatReturn = (val: any) => val === '-' || val === null ? '-' : `${val.toFixed(2)}%`;

/* =========================
   PnlTable Component
   ========================= */
interface PnlTableProps {
  quarterlyPnl: QuarterlyPnlData;
  monthlyPnl: MonthlyPnlData;
}

function PnlTable({ quarterlyPnl, monthlyPnl }: PnlTableProps) {
  const [viewType, setViewType] = useState<"percent" | "cash">("percent");

  const getReturnColor = (value: string) => {
    if (value === "-" || value === "---") return "text-foreground";
    const numValue = parseFloat(value.replace(/₹|,/g, ""));
    if (numValue > 0) return "text-green-600";
    if (numValue < 0) return "text-red-600";
    return "text-muted-foreground";
  };

  const getCellClass = (value: string, isPercent: boolean) => {
    return "px-4 py-3 text-center whitespace-nowrap";
  };

  const formatDisplayValue = (value: string, isPercent: boolean) => {
    if (value === "-" || value === "" || value === undefined || value === null) {
      return "-";
    }
    const numValue = parseFloat(value);
    if (isNaN(numValue)) {
      return "-";
    }
    if (isPercent) {
      return numValue > 0 ? `+${numValue.toFixed(2)}%` : `${numValue.toFixed(2)}%`;
    } else {
      const absValue = Math.abs(numValue);
      const formattedValue = absValue.toLocaleString("en-IN", {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      });
      return numValue >= 0 ? `+₹${formattedValue}` : `-₹${formattedValue}`;
    }
  };

  const quarterlyYears = Object.keys(quarterlyPnl).sort((a, b) => parseInt(a) - parseInt(b));
  const monthlyYears = Object.keys(monthlyPnl).sort((a, b) => parseInt(a) - parseInt(b));

  const monthOrder = [
    "January", "February", "March", "April", "May", "June",
    "July", "August", "September", "October", "November", "December",
  ];

  const renderQuarterlyTable = () => {
    const isPercentView = viewType === "percent";

    return (
      <Card>
        <CardHeader>
          <div className="flex justify-between items-center mb-4">
            <CardTitle className="text-sm sm:text-lg text-foreground">
              Quarterly Profit and Loss ({viewType === "percent" ? "%" : "₹"})
            </CardTitle>
            <div className="space-x-2">
              <Button
                onClick={() => setViewType("percent")}
                size="sm"
                variant={viewType === "percent" ? "gradient" : "outline"}
                className="text-xs"
              >
                %
              </Button>
              <Button
                onClick={() => setViewType("cash")}
                size="sm"
                variant={viewType === "cash" ? "gradient" : "outline"}
                className="text-xs"
              >
                ₹
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <div className="w-full overflow-x-auto">
            <table className="min-w-full border-collapse divide-y border-border">
              <thead className="bg-muted">
                <tr className="bg-muted/50 border-border border-b text-sm">
                  <th className="text-center px-4 py-2 text-sm font-medium text-foreground uppercase tracking-wider min-w-[60px]">
                    Year
                  </th>
                  <th className="text-center px-4 py-2 text-sm font-medium text-foreground uppercase tracking-wider min-w-[80px]">
                    Q1
                  </th>
                  <th className="text-center px-4 py-2 text-sm font-medium text-foreground uppercase tracking-wider min-w-[80px]">
                    Q2
                  </th>
                  <th className="text-center px-4 py-2 text-sm font-medium text-foreground uppercase tracking-wider min-w-[80px]">
                    Q3
                  </th>
                  <th className="text-center px-4 py-2 text-sm font-medium text-foreground uppercase tracking-wider min-w-[80px]">
                    Q4
                  </th>
                  <th className="text-center px-4 py-2 text-sm font-medium text-foreground uppercase tracking-wider min-w-[80px]">
                    Total
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {quarterlyYears.map((year) => (
                  <tr key={`${year}-${viewType}`} className="border-border text-xs">
                    <td className="px-4 py-3 text-center whitespace-nowrap min-w-[60px] text-foreground font-medium">{year}</td>
                    {["q1", "q2", "q3", "q4", "total"].map((quarter) => {
                      const rawValue = isPercentView
                        ? quarterlyPnl[year].percent[quarter as keyof typeof quarterlyPnl[string]["percent"]]
                        : quarterlyPnl[year].cash[quarter as keyof typeof quarterlyPnl[string]["cash"]];

                      const displayValue = formatDisplayValue(rawValue, isPercentView);
                      const cellClass = getCellClass(rawValue, isPercentView);
                      const isTotal = quarter === "total";

                      return (
                        <td key={quarter} className={`${cellClass} ${isTotal ? "font-medium" : ""}`}>
                          <span className={getReturnColor(rawValue)}>
                            {displayValue}
                          </span>
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    );
  };

  const renderMonthlyTable = () => {
    const isPercentView = viewType === "percent";

    return (
      <Card>
        <CardHeader>
          <div className="flex justify-between items-center mb-4">
            <CardTitle className="text-sm sm:text-lg text-foreground">
              Monthly Profit and Loss ({viewType === "percent" ? "%" : "₹"})
            </CardTitle>
            <div className="space-x-2">
              <Button
                onClick={() => setViewType("percent")}
                size="sm"
                variant={viewType === "percent" ? "gradient" : "outline"}
              >
                %
              </Button>
              <Button
                onClick={() => setViewType("cash")}
                size="sm"
                variant={viewType === "cash" ? "gradient" : "outline"}
              >
                ₹
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <div className="w-full overflow-x-auto">
            <table className="min-w-full border-collapse divide-y border-border">
              <thead className="bg-muted">
                <tr className="bg-muted/50 border-border border-b text-sm">
                  <th className="text-center px-4 py-2 text-sm font-medium text-foreground uppercase tracking-wider min-w-[60px]">
                    Year
                  </th>
                  {monthOrder.map((month) => (
                    <th
                      key={month}
                      className="text-center px-4 py-2 text-sm font-medium text-foreground uppercase tracking-wider min-w-[80px]"
                    >
                      {month.substring(0, 3)}
                    </th>
                  ))}
                  <th className="text-center px-4 py-2 text-sm font-medium text-foreground uppercase tracking-wider min-w-[80px]">
                    Total
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {monthlyYears.map((year) => (
                  <tr key={`${year}-${viewType}`} className="border-border text-xs">
                    <td className="px-4 py-3 text-center whitespace-nowrap min-w-[60px] text-foreground font-medium">{year}</td>
                    {monthOrder.map((month) => {
                      const rawValue = isPercentView
                        ? monthlyPnl[year]?.months[month]?.percent
                        : monthlyPnl[year]?.months[month]?.cash;

                      const displayValue = formatDisplayValue(rawValue || "", isPercentView);
                      const rawValueString = rawValue || "-";
                      const cellClass = getCellClass(rawValueString, isPercentView);

                      return (
                        <td key={month} className={cellClass}>
                          <span className={getReturnColor(rawValueString)}>
                            {displayValue}
                          </span>
                        </td>
                      );
                    })}
                    <td className={`${getCellClass(
                      isPercentView
                        ? monthlyPnl[year]?.totalPercent.toString() || "-"
                        : monthlyPnl[year]?.totalCash.toString() || "-",
                      isPercentView
                    )} font-medium`}>
                      <span className={getReturnColor(
                        isPercentView
                          ? monthlyPnl[year]?.totalPercent.toString() || "-"
                          : monthlyPnl[year]?.totalCash.toString() || "-"
                      )}>
                        {isPercentView
                          ? monthlyPnl[year]?.totalPercent > 0
                            ? `+${monthlyPnl[year].totalPercent.toFixed(2)}%`
                            : `${monthlyPnl[year].totalPercent.toFixed(2)}%`
                          : monthlyPnl[year]?.totalCash >= 0
                            ? `+₹${Math.abs(monthlyPnl[year].totalCash).toLocaleString("en-IN", {
                                minimumFractionDigits: 2,
                                maximumFractionDigits: 2,
                              })}`
                            : `-₹${Math.abs(monthlyPnl[year].totalCash).toLocaleString("en-IN", {
                                minimumFractionDigits: 2,
                                maximumFractionDigits: 2,
                              })}`}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    );
  };

  return (
    <div className="flex flex-col gap-6">
      {renderQuarterlyTable()}
      {renderMonthlyTable()}
    </div>
  );
}

/* =========================
   Main Demo Component
   ========================= */
export default function DemoPortfolioPerformance() {
  const [selectedAccount, setSelectedAccount] = useState<string>("QAW00001");
  const benchmarkColor = "#9CA3AF";

  // Get account data for selected account
  const selectedAccountDetails = dummyFamilyAccounts.find(acc => acc.clientcode === selectedAccount);
  const strategyCode = selectedAccount?.substring(0, 3).toUpperCase() as keyof typeof strategyColorConfig;
  const colors = strategyColorConfig[strategyCode] || strategyColorConfig.QAW;
  const strategyName = strategyNames[strategyCode as keyof typeof strategyNames] || 'Portfolio';

  // Enrich data with normalization and benchmark
  const enrichedData = useMemo(() => {
    if (dummyHistoricalData.length === 0) return [];

    const firstNav = Number(dummyHistoricalData[0].nav);
    if (firstNav <= 0) return dummyHistoricalData;

    const sortedBench = [...dummyBenchmarkData].sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
    const incDate = dummyHistoricalData[0].report_date;
    const firstBenchItem = findLatestBenchmarkBeforeOrOn(sortedBench, incDate);
    const firstBench = firstBenchItem ? firstBenchItem.value : 0;

    // Prepend synthetic NAV=10 row one day before inception when first NAV ≠ 10
    const needsSyntheticRow = firstNav !== 10;
    let dataWithSynthetic = dummyHistoricalData;
    if (needsSyntheticRow) {
      const syntheticDate = new Date(incDate);
      syntheticDate.setDate(syntheticDate.getDate() - 1);
      const syntheticDateStr = syntheticDate.toISOString().split('T')[0];
      const syntheticRow = { ...dummyHistoricalData[0], report_date: syntheticDateStr, nav: 10 };
      dataWithSynthetic = [syntheticRow, ...dummyHistoricalData];
    }

    // Benchmark rebase target: 10 when synthetic row prepended, otherwise 100
    const benchRebaseTarget = needsSyntheticRow ? 10 : 100;

    let portPeak = needsSyntheticRow ? 10 : firstNav;
    let benchPeak = firstBench > 0 ? benchRebaseTarget : 0;

    return dataWithSynthetic.map((item) => {
      const currentNav = Number(item.nav);
      if (currentNav > portPeak) portPeak = currentNav;
      const portDD = -((currentNav - portPeak) / portPeak * 100);

      // Raw NAV (10-based PMS convention), no rebase
      const normNav = currentNav;

      let normBench = benchRebaseTarget;
      let benchVal = firstBench;
      let benchDD = 0;

      if (sortedBench.length > 0 && firstBench > 0) {
        const benchItem = findLatestBenchmarkBeforeOrOn(sortedBench, item.report_date);
        benchVal = benchItem ? benchItem.value : firstBench;
        normBench = (benchVal / firstBench) * benchRebaseTarget;

        if (normBench > benchPeak) benchPeak = normBench;
        benchDD = -((normBench - benchPeak) / benchPeak * 100);
      }

      return {
        ...item,
        normalized_nav: normNav,
        drawdown_percent: portDD,
        normalized_benchmark: normBench,
        benchmark_value: benchVal,
        benchmark_drawdown_percent: benchDD
      };
    });
  }, []);

  // Dummy trailing returns
  const trailingReturns = {
    '1W': 1.23,
    '10D': 1.89,
    '1M': 3.45,
    '3M': 8.76,
    '6M': 15.34,
    '1Y': 28.56,
    'Since Inception': 42.15
  };

  const trailingReturnsBenchmark = {
    '1W': 0.89,
    '10D': 1.23,
    '1M': 2.34,
    '3M': 6.78,
    '6M': 12.45,
    '1Y': 22.34,
    'Since Inception': 35.67
  };

  // Fixed metrics for demo - showing ₹50 lakhs invested
  const totalCapitalIn = 5000000; // Fixed at 50 lakhs
  const totalInvested = 5000000; // Net investment also 50 lakhs (no withdrawals)
  const currentValue = 7105000; // Current value showing ~42% returns
  const totalReturns = currentValue - totalInvested; // ₹21,05,000 profit
  const returnsPercent = 42.10; // Fixed percentage
  const isPositiveReturnOverall = totalReturns >= 0;

  // DD metrics
  const portfolioCurrentDD = enrichedData.length > 0 ? enrichedData[enrichedData.length - 1].drawdown_percent : 0;
  const portfolioMaxDD = enrichedData.length > 0 ? Math.max(...enrichedData.map(item => item.drawdown_percent || 0)) : 0;
  const benchmarkCurrentDD = enrichedData.length > 0 ? enrichedData[enrichedData.length - 1].benchmark_drawdown_percent || 0 : 0;
  const benchmarkMaxDD = enrichedData.length > 0 ? Math.max(...enrichedData.map(item => item.benchmark_drawdown_percent || 0)) : 0;

  // Calculate Y-axis domains
  const hasBenchmark = enrichedData.length > 0 && enrichedData[0]?.normalized_benchmark !== undefined;
  const navValues = enrichedData.map(d => d.normalized_nav);
  if (hasBenchmark) {
    navValues.push(...enrichedData.map(d => d.normalized_benchmark));
  }
  const navDomain = calculateYDomain(navValues, 5);

  const drawdownValues = enrichedData.map(item => -item.drawdown_percent);
  if (hasBenchmark) {
    drawdownValues.push(...enrichedData.map(d => -(d.benchmark_drawdown_percent || 0)));
  }
  const minDD = drawdownValues.length > 0 ? Math.min(...drawdownValues) : 0;
  const ddRange = Math.abs(minDD);
  const ddPadding = ddRange * 0.1;
  const drawdownDomain = [Math.floor(minDD - ddPadding), 0];

  // Dates
  const inceptionDate = dummyHistoricalData.length > 0 ? dummyHistoricalData[0].report_date : null;
  const latestDate = dummyHistoricalData.length > 0 ? dummyHistoricalData[dummyHistoricalData.length - 1].report_date : null;

  const periods = [
    { key: '1W', label: '1W' },
    { key: '10D', label: '10D' },
    { key: '1M', label: '1M' },
    { key: '3M', label: '3M' },
    { key: '6M', label: '6M' },
    { key: '1Y', label: '1Y' },
    { key: 'Current DD', label: 'Current DD' },
    { key: 'Max DD', label: 'Max DD' },
    { key: 'Since Inception', label: 'Since Inception' }
  ];

  return (
    <motion.div
      key="content"
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -20 }}
      transition={{ duration: 0.3 }}
      className="space-y-6 w-full"
      style={{ fontFamily: 'Lato, sans-serif' }}
    >
      {/* Inject Lato font */}
      <style>{latoFontStyle}</style>

      {/* Demo Badge */}
      {/*<div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4 mb-4">
        <p className="text-yellow-800 text-sm font-medium">
          This is a demo page with dummy data for demonstration purposes.
        </p>
      </div>

      {/* Header */}
      <div className="flex flex-col gap-4">
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
          <div>
            <h1 className="text-2xl md:text-3xl font-bold text-foreground">Portfolio Details (Demo)</h1>
            <div className="flex flex-col gap-1 mt-1">
              <p className="text-sm text-muted-foreground">
                {selectedAccountDetails && (
                  <>
                    {selectedAccountDetails.holderName} • {selectedAccount}
                  </>
                )}
              </p>
              {inceptionDate && latestDate && (
                <div className="flex flex-wrap items-center gap-3 text-xs">
                  <span className="flex items-center gap-1">
                    <Calendar className="h-3 w-3" style={{ color: colors.primary }} />
                    <span className="text-muted-foreground">Inception:</span>
                    <span className="font-medium" style={{ color: colors.primary }}>
                      {formatDate(inceptionDate)}
                    </span>
                  </span>
                  <span className="text-muted-foreground">•</span>
                  <span className="flex items-center gap-1">
                    <span className="text-muted-foreground">Data as of:</span>
                    <span className="font-medium" style={{ color: colors.primary }}>
                      {formatDate(latestDate)}
                    </span>
                  </span>
                </div>
              )}
            </div>
          </div>
          <div className="flex flex-col sm:flex-row gap-2 w-full md:w-auto">
            <Select value={selectedAccount} onValueChange={setSelectedAccount}>
              <SelectTrigger className="w-full md:w-80">
                <SelectValue placeholder="Select Account" />
              </SelectTrigger>
              <SelectContent>
                {dummyFamilyAccounts.map(acc => (
                  <SelectItem key={acc.clientcode} value={acc.clientcode}>
                    <div className="flex items-center justify-between gap-3">
                      <span>{acc.holderName}</span>
                      <span className="text-xs text-muted-foreground">({acc.clientcode})</span>
                    </div>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button
              variant="outline"
              size="default"
              className="gap-2 whitespace-nowrap"
              onClick={() => alert('Download functionality is disabled in demo mode')}
            >
              <Download className="h-4 w-4" />
              <span className="hidden sm:inline">Download CSV</span>
              <span className="sm:hidden">CSV</span>
            </Button>
          </div>
        </div>
      </div>

      {/* Metrics Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Amount Invested */}
        <Card>
          <CardContent className="">
            <div className="flex items-center justify-between mb-2">
              <p className="text-sm font-medium text-muted-foreground">Amount Invested</p>
              <Wallet className="h-4 w-4 text-blue-500" />
            </div>
            <div className="text-2xl font-bold text-foreground ">{formatCurrency(totalCapitalIn)}</div>
            <p className="text-xs text-muted-foreground mt-1">
              Net: {formatCurrency(totalInvested)}
            </p>
          </CardContent>
        </Card>

        {/* Current Value */}
        <Card>
          <CardContent className="">
            <div className="flex items-center justify-between mb-2">
              <p className="text-sm font-medium text-muted-foreground">Current Value</p>
              <RupeeIcon className="h-4 w-4 text-green-500" />
            </div>
            <div className="text-2xl font-bold text-primary">{formatCurrency(currentValue)}</div>
            <p className="text-xs text-muted-foreground mt-1">
              As of {latestDate && new Date(latestDate).toLocaleDateString('en-IN')}
            </p>
          </CardContent>
        </Card>

        {/* Returns (₹) */}
        <Card>
          <CardContent className="">
            <div className="flex items-center justify-between mb-2">
              <p className="text-sm font-medium text-muted-foreground">Total Returns</p>
              {isPositiveReturnOverall ? (
                <ArrowUpRight className="h-4 w-4 text-green-500" />
              ) : (
                <ArrowDownRight className="h-4 w-4 text-red-500" />
              )}
            </div>
            <div className={`text-2xl font-bold ${isPositiveReturnOverall ? 'text-green-600' : 'text-red-600'}`}>
              {isPositiveReturnOverall ? '+' : ''}{formatCurrency(totalReturns)}
            </div>
            <p className="text-xs text-muted-foreground mt-1">Absolute returns</p>
          </CardContent>
        </Card>

        {/* Returns (%) */}
        <Card>
          <CardContent className="">
            <div className="flex items-center justify-between mb-2">
              <p className="text-sm font-medium text-muted-foreground">Returns %</p>
              <Percent className="h-4 w-4 text-orange-500" />
            </div>
            <div className={`text-2xl font-bold ${isPositiveReturnOverall ? 'text-green-600' : 'text-red-600'}`}>
              {isPositiveReturnOverall ? '+' : ''}{formatPercent(returnsPercent)}
            </div>
            <div className="flex items-center gap-1 mt-1">
              {isPositiveReturnOverall ? (
                <TrendingUp className="h-3 w-3 text-green-500" />
              ) : (
                <TrendingDown className="h-3 w-3 text-red-500" />
              )}
              <p className="text-xs text-muted-foreground">Percentage returns</p>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Trailing Returns Table */}
      <Card>
        <CardHeader>
          <div className="flex justify-between items-center mb-4">
            <CardTitle className="text-foreground text-sm sm:text-lg">
              Trailing Returns & Drawdown
            </CardTitle>
          </div>
        </CardHeader>
        <CardContent>
          <div className="w-full overflow-x-auto">
            <table className="min-w-full border-collapse divide-y border-border">
              <thead className="bg-muted">
                <tr className="bg-muted/50 border-border border-b text-sm">
                  <th className="text-left px-4 py-2 text-sm font-medium text-foreground uppercase tracking-wider min-w-[120px]">
                    Name
                  </th>
                  {periods.map((period) => (
                    <th
                      key={period.key}
                      className={`text-center px-4 py-2 font-medium text-foreground uppercase tracking-wider min-w-[50px]
                        ${period.key === "Current DD" ? "border-l border-border" : ""}`}
                    >
                      <div className={`text-xs ${period.key === 'Current DD' || period.key === 'Max DD' || period.key === 'Since Inception' ? 'whitespace-normal break-words' : 'whitespace-nowrap'}`}>
                        {period.label}
                      </div>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                <tr className="border-border text-xs">
                  <td className="px-4 py-3 text-left whitespace-nowrap min-w-[120px] font-medium text-foreground">
                    Portfolio (%)
                  </td>
                  {periods.map((period) => {
                    let rawValue;
                    let displayValue;
                    let cellStyle = {};
                    if (period.key === 'Current DD') {
                      rawValue = portfolioCurrentDD;
                      displayValue = `-${Math.abs(portfolioCurrentDD).toFixed(2)}%`;
                      cellStyle = { color: '#ef4444' };
                    } else if (period.key === 'Max DD') {
                      rawValue = portfolioMaxDD;
                      displayValue = `-${Math.abs(portfolioMaxDD).toFixed(2)}%`;
                      cellStyle = { color: '#ef4444' };
                    } else {
                      rawValue = trailingReturns[period.key as keyof typeof trailingReturns];
                      displayValue = formatReturn(rawValue);
                      cellStyle = isPositiveReturn(rawValue) ? { color: colors.strategy } : isNegativeReturn(rawValue) ? { color: '#ef4444' } : {};
                    }
                    return (
                      <td
                        key={period.key}
                        className={`px-4 py-3 text-center whitespace-nowrap ${period.key === "Current DD" ? "border-l border-border" : ""}`}
                      >
                        <span style={cellStyle}>
                          {displayValue}
                        </span>
                      </td>
                    );
                  })}
                </tr>
                <tr className="border-border text-xs">
                  <td className="px-4 py-3 text-left whitespace-nowrap min-w-[120px] font-medium text-foreground">
                    BSE 500 (%)
                  </td>
                  {periods.map((period) => {
                    let rawValue;
                    let displayValue;
                    let cellStyle = {};
                    if (period.key === 'Current DD') {
                      rawValue = benchmarkCurrentDD;
                      displayValue = `-${Math.abs(benchmarkCurrentDD).toFixed(2)}%`;
                      cellStyle = { color: '#ef4444' };
                    } else if (period.key === 'Max DD') {
                      rawValue = benchmarkMaxDD;
                      displayValue = `-${Math.abs(benchmarkMaxDD).toFixed(2)}%`;
                      cellStyle = { color: '#ef4444' };
                    } else {
                      rawValue = trailingReturnsBenchmark[period.key as keyof typeof trailingReturnsBenchmark];
                      displayValue = formatReturn(rawValue);
                      cellStyle = isPositiveReturn(rawValue) ? { color: benchmarkColor } : isNegativeReturn(rawValue) ? { color: '#ef4444' } : {};
                    }
                    return (
                      <td
                        key={period.key}
                        className={`px-4 py-3 text-center whitespace-nowrap ${period.key === "Current DD" ? "border-l border-border" : ""}`}
                      >
                        <span style={cellStyle}>
                          {displayValue}
                        </span>
                      </td>
                    );
                  })}
                </tr>
              </tbody>
            </table>
          </div>
          <div className="mt-3 pt-4 border-t border-border">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs text-muted-foreground">
              <div>
                <p><strong>Returns:</strong> Periods under 1 year are presented as absolute, while those over 1 year are annualized (CAGR)</p>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* NAV Chart */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Activity className="h-5 w-5" style={{ color: colors.primary }} />
            NAV Performance
          </CardTitle>
        </CardHeader>
        <CardContent>
          <ResponsiveContainer width="100%" height={300}>
            <AreaChart data={enrichedData}>
              <CartesianGrid strokeDasharray="3 3" stroke={colors.primary} opacity={0.2} />
              <XAxis
                dataKey="report_date"
                stroke={colors.primary}
                tick={{ fontSize: 10, fontFamily: 'Lato, sans-serif' }}
                angle={-45}
                textAnchor="end"
                height={70}
                tickFormatter={(value) => {
                  const date = new Date(value);
                  return `${date.getDate()}/${date.getMonth() + 1}/${date.getFullYear()}`;
                }}
              />
              <YAxis
                stroke={colors.primary}
                tick={{ fontSize: 10, fontFamily: 'Lato, sans-serif' }}
                domain={navDomain}
                tickFormatter={(value) => `${Number(value).toFixed(1)}`}
              />
              <Tooltip content={(props) => <CustomTooltip {...props} data={enrichedData} />} />
              <Area
                type="monotone"
                dataKey="normalized_nav"
                stroke={colors.strategy}
                strokeWidth={2}
                fill="none"
                name="Portfolio Growth"
              />
              {hasBenchmark && (
                <Area
                  type="monotone"
                  dataKey="normalized_benchmark"
                  stroke={benchmarkColor}
                  strokeWidth={2}
                  fill="none"
                  name="BSE 500"
                />
              )}
            </AreaChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>

      {/* Drawdown Chart */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <TrendingDown className="h-5 w-5 text-red-500" />
            Drawdown Analysis
          </CardTitle>
        </CardHeader>
        <CardContent>
          <ResponsiveContainer width="100%" height={300}>
            <AreaChart data={enrichedData}>
              <CartesianGrid strokeDasharray="3 3" stroke={colors.primary} opacity={0.2} />
              <XAxis
                dataKey="report_date"
                stroke={colors.primary}
                tick={{ fontSize: 10, fontFamily: 'Lato, sans-serif' }}
                angle={-45}
                textAnchor="end"
                height={70}
                tickFormatter={(value) => {
                  const date = new Date(value);
                  return `${date.getDate()}/${date.getMonth() + 1}/${date.getFullYear()}`;
                }}
              />
              <YAxis
                stroke={colors.primary}
                tick={{ fontSize: 10, fontFamily: 'Lato, sans-serif' }}
                domain={drawdownDomain}
                tickFormatter={(value) => `${Number(value).toFixed(2)}`}
              />
              <Tooltip content={(props) => <CustomTooltip {...props} data={enrichedData} />} />
              <Area
                type="monotone"
                dataKey={(entry) => -entry.drawdown_percent}
                stroke="#ef4444"
                strokeWidth={2}
                fill="none"
                name="Drawdown"
              />
              {hasBenchmark && (
                <Area
                  type="monotone"
                  dataKey={(entry) => -(entry.benchmark_drawdown_percent || 0)}
                  stroke={benchmarkColor}
                  strokeWidth={2}
                  fill="none"
                  name="BSE 500 Drawdown"
                />
              )}
            </AreaChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>

      {/* PnL Tables */}
      <PnlTable quarterlyPnl={dummyQuarterlyPnl} monthlyPnl={dummyMonthlyPnl} />

      {/* Cash Flows Table */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Calendar className="h-5 w-5 text-primary" />
            Cash Flow History
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-border">
                  <th className="text-left py-3 px-4 text-sm font-semibold text-foreground">Date</th>
                  <th className="text-right py-3 px-4 text-sm font-semibold text-foreground">Amount</th>
                  <th className="text-right py-3 px-4 text-sm font-semibold text-foreground">Type</th>
                </tr>
              </thead>
              <tbody>
                {dummyHistoricalData
                  .filter(item => item.cash_in_out != null && Number(item.cash_in_out) !== 0)
                  .map((item, index) => {
                    const isInflow = item.cash_in_out > 0;
                    return (
                      <tr key={index} className="border-b border-border hover:bg-muted/50 transition-colors">
                        <td className="py-3 px-4 text-sm">
                          {new Date(item.report_date).toLocaleDateString('en-IN', {
                            day: '2-digit',
                            month: 'short',
                            year: 'numeric'
                          })}
                        </td>
                        <td className={`py-3 px-4 text-sm text-right font-semibold ${isInflow ? 'text-green-600' : 'text-red-600'}`}>
                          {isInflow ? '+' : '-'}{formatCurrency(Math.abs(Number(item.cash_in_out)))}
                        </td>
                        <td className="py-3 px-4 text-right">
                          <Badge variant="outline" className={`
                            ${isInflow ? 'bg-green-50 text-green-700 border-green-200' : 'bg-red-50 text-red-700 border-red-200'}
                          `}>
                            {isInflow ? (
                              <><ArrowUpRight className="h-3 w-3 mr-1" /> Inflow</>
                            ) : (
                              <><ArrowDownRight className="h-3 w-3 mr-1" /> Outflow</>
                            )}
                          </Badge>
                        </td>
                      </tr>
                    );
                  })}
              </tbody>
              <tfoot>
                <tr className="border-t-2 border-primary/20 bg-muted/30">
                  <td className="py-3 px-4 text-sm font-semibold">Total</td>
                  <td className={`py-3 px-4 text-sm text-right font-bold ${totalInvested >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                    {formatCurrency(totalInvested)}
                  </td>
                  <td></td>
                </tr>
              </tfoot>
            </table>
          </div>
        </CardContent>
      </Card>
    </motion.div>
  );
}
