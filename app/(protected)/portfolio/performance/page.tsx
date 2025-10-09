"use client";

import React, { useEffect, useState } from "react";
import { useClient } from "@/contexts/ClientContext";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
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
  Activity
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
   Fullscreen, calming loader (text reveal removed)
   - Brand: plain text
   - Subtitle: gentle breathing
   - Shimmer progress bar
   - Smooth slide-up exit
   - Honors prefers-reduced-motion
   ========================= */
function FullscreenLoader({
  brand = "Qode",
  subtitle = "Preparing your portfolio…",
}: {
  brand?: string;
  subtitle?: string;
}) {
  const prefersReduced = useReducedMotion();

  return (
    <motion.div
      initial={{ y: 0, opacity: 1 }}
      animate={{ y: 0, opacity: 1 }}
      exit={{ y: "-100%", opacity: 0.98 }}
      transition={{ type: "spring", stiffness: 140, damping: 18 }}
      className="fixed inset-0 z-[9999] bg-background/95 backdrop-blur-[1px] flex items-center justify-center"
      aria-label="Loading"
    >
      {/* Soft vignette */}
      <div className="pointer-events-none absolute inset-0 opacity-[0.08] [background:radial-gradient(60%_50%_at_50%_50%,theme(colors.primary/20),transparent_60%)]" />
      {/* Gentle vertical fade */}
      <div className="pointer-events-none absolute inset-0 [background:linear-gradient(180deg,transparent,theme(colors.background)_60%)]" />

      <div className="relative flex flex-col items-center px-6">
        {/* Brand: plain text */}
        <h1 className="text-5xl sm:text-6xl font-extrabold tracking-tight text-primary">
          {brand}
        </h1>

        {/* Subtitle: breathing opacity (reduced-motion = static) */}
        <motion.div
          className="mt-4 text-sm sm:text-base text-card-foreground"
          initial={prefersReduced ? { opacity: 1 } : { opacity: 0.6 }}
          animate={prefersReduced ? { opacity: 1 } : { opacity: [0.6, 1, 0.6] }}
          transition={prefersReduced ? {} : { repeat: Infinity, duration: 2.4, ease: "easeInOut" }}
        >
          {subtitle}
        </motion.div>

        {/* Progress shimmer bar */}
        <div className="mt-6 w-56 sm:w-64 h-1.5 rounded-full bg-primary/10 overflow-hidden">
          <motion.span
            className="block h-full w-1/3 bg-primary/60"
            initial={{ x: "-100%" }}
            animate={{ x: ["-100%", "150%"] }}
            transition={{ duration: 2.6, repeat: Infinity, ease: "easeInOut" }}
          />
        </div>
      </div>
    </motion.div>
  );
}

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

type PortfolioData = {
  account_code: string;
  portfolio_value: number;
  report_date: string;
  cash_in_out?: number;
  nav?: number;
  pnl?: number;
  pnl_percent?: number;
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
  },
  QFH: {
    primary: "#A78C11",
    secondary: "#A78C11",
    strategy: "#A78C11",
    gradient1: "#A78C11",
    gradient2: "#A78C11"
  }
};

const strategyNames = {
  QAW: 'Qode All Weather',
  QTF: 'Qode Tactical Fund',
  QGF: 'Qode Growth Fund',
  QFH: 'Qode Future Horizons'
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

const sanitizeName = (name: string | null | undefined) => {
  if (!name || name === "null" || name.includes("null")) {
    return name?.replace(/\s*null\s*/g, "").trim() || "Unknown";
  }
  return name.trim();
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
    return (
      <div className="bg-background border border-border rounded-lg p-3 shadow-lg" style={{ fontFamily: 'Lato, sans-serif', fontSize: '12px' }}>
        <p className="text-sm font-medium mb-1">{formattedDate}</p>
        {payload.map((entry: any, index: number) => {
          const val = Number(entry.value);
          const isGrowth = entry.name === 'Portfolio Growth' || entry.name === 'BSE 500';
          const display = isGrowth ? `${(val - 100).toFixed(2)}%` : `${val.toFixed(2)}%`;
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

function getBusinessDaysAgo(date: Date, businessDays: number): Date {
  let target = new Date(date);
  let count = 0;
  while (count < businessDays) {
    target.setDate(target.getDate() - 1);
    const dayOfWeek = target.getDay();
    if (dayOfWeek !== 0 && dayOfWeek !== 6) { // Skip Sunday (0) and Saturday (6)
      count++;
    }
  }
  return target;
}

function calculateTrailingReturnsForData(data: Array<{ nav: number, date: string }>, inceptionDate?: string) {
  if (data.length === 0) {
    console.log("No data available for trailing returns calculation");
    return null;
  }

  const sortedData = [...data].sort((a, b) =>
    new Date(a.date).getTime() - new Date(b.date).getTime()
  );

  const latest = sortedData[sortedData.length - 1];
  const latestDate = new Date(latest.date);

  const isMonthEnd = (date: Date): boolean => {
    const nextDay = new Date(date);
    nextDay.setDate(nextDay.getDate() + 1);
    return nextDay.getMonth() !== date.getMonth();
  };

  const findClosestDataPoint = (targetDate: Date) => {
    for (let i = sortedData.length - 1; i >= 0; i--) {
      const dataDate = new Date(sortedData[i].date);
      if (dataDate <= targetDate) {
        return sortedData[i];
      }
    }
    return null;
  };

  const getTargetDate = (months: number): Date => {
    const target = new Date(latestDate);

    if (isMonthEnd(latestDate)) {
      target.setMonth(target.getMonth() - months + 1, 0);
    } else {
      target.setMonth(target.getMonth() - months);
    }

    console.log(`Target date for ${months} month(s) period: ${target.toISOString().split('T')[0]}`);
    return target;
  };

  const monthPeriods = {
    '1M': 1,
    '3M': 3,
    '6M': 6,
    '1Y': 12
  };

  const dayPeriods = {
    '1W': 7,
    '10D': 10,
  };

  const returns: any = {};

  // Day periods with weekend adjustment
  Object.entries(dayPeriods).forEach(([period, days]) => {
    const targetDate = getBusinessDaysAgo(latestDate, days);
    const startPoint = findClosestDataPoint(targetDate);

    if (startPoint) {
      // Absolute return for day periods
      const returnValue = ((latest.nav / startPoint.nav) - 1) * 100;
      returns[period] = returnValue;
    } else {
      returns[period] = '-';
    }
  });

  // Month periods
  Object.entries(monthPeriods).forEach(([period, months]) => {
    const targetDate = getTargetDate(months);
    const startPoint = findClosestDataPoint(targetDate);

    if (startPoint) {
      // Use CAGR for periods >= 1 year, absolute for less than 1 year
      let returnValue: number;
      if (months >= 12) {
        // CAGR formula: ((End/Start)^(1/years) - 1) * 100
        const years = months / 12;
        returnValue = (Math.pow(latest.nav / startPoint.nav, 1 / years) - 1) * 100;
      } else {
        // Absolute return: ((End/Start) - 1) * 100
        returnValue = ((latest.nav / startPoint.nav) - 1) * 100;
      }

      returns[period] = returnValue;
    } else {
      returns[period] = '-';
    }
  });

  // Since Inception - use absolute if <1Y, CAGR if >=1Y
  if (sortedData.length >= 2) {
    let inceptionPoint = inceptionDate ? findClosestDataPoint(new Date(inceptionDate)) : sortedData[0];
    if (inceptionPoint) {
      const incDateForYears = inceptionDate ? new Date(inceptionDate) : new Date(inceptionPoint.date);
      const daysDiff = (latestDate.getTime() - incDateForYears.getTime()) / (1000 * 60 * 60 * 24);
      const years = daysDiff / 365.25;

      let inceptionReturn: number;
      if (years < 1) {
        // Absolute return for <1Y
        inceptionReturn = ((latest.nav / inceptionPoint.nav) - 1) * 100;
        console.log(`  Calculated absolute return: ${inceptionReturn.toFixed(2)}%`);
      } else {
        // CAGR for >=1Y
        inceptionReturn = (Math.pow(latest.nav / inceptionPoint.nav, 1 / years) - 1) * 100;
      }
      returns['Since Inception'] = inceptionReturn;
    } else {
      returns['Since Inception'] = '-';
    }
  } else {
    returns['Since Inception'] = '-';
  }

  return returns;
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
  showOnlyQuarterlyCash?: boolean;
  showPmsQawView?: boolean;
  isPdfExport?: boolean; // New prop to force percent view during PDF export
}

function PnlTable({
  quarterlyPnl,
  monthlyPnl,
  showOnlyQuarterlyCash = false,
  showPmsQawView = false,
  isPdfExport = false,
}: PnlTableProps) {
  console.log(showOnlyQuarterlyCash);

  const [viewType, setViewType] = useState<"percent" | "cash">("percent");


  // Use percent view for PDF export, otherwise use state or props
  const effectiveViewType = isPdfExport ? "percent" : viewType;

  const getReturnColor = (value: string) => {
    if (value === "-" || value === "---") return "text-foreground";
    const numValue = parseFloat(value.replace(/₹|,/g, ""));
    if (numValue > 0) return "text-green-600";
    if (numValue < 0) return "text-red-600";
    return "text-muted-foreground";
  };

  const getCellClass = (value: string, isPercent: boolean) => {
    if (value === "-" || value === "---" || value === "") return "px-4 py-3 text-center whitespace-nowrap";
    return "px-4 py-3 text-center whitespace-nowrap";
  };

  const formatDisplayValue = (value: string, isPercent: boolean) => {
    if (value === "-" || value === "" || value === undefined || value === null) {
      return "-";
    }
    if (value === "-") {
      return isPercent ? "-%" : "₹-";
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
    // Use percent view for PDF export, otherwise respect showOnlyQuarterlyCash, showPmsQawView, or viewType
    const displayType = isPdfExport ? "percent" : (showOnlyQuarterlyCash || showPmsQawView ? "cash" : viewType);
    const isPercentView = displayType === "percent";

    return (
      <Card>
        <CardHeader>
          <div className="flex justify-between items-center mb-4">
            <CardTitle className="text-sm sm:text-lg text-foreground">
              Quarterly Profit and Loss ({displayType === "percent" ? "%" : "₹"})
            </CardTitle>
            {!showOnlyQuarterlyCash && !showPmsQawView && !isPdfExport && (
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
            )}
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
                  <tr key={`${year}-${displayType}`} className="border-border text-xs">
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
                {quarterlyYears.length === 0 && (
                  <tr>
                    <td colSpan={6} className="text-center py-3 px-4 text-muted-foreground">
                      No data available
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    );
  };

  const renderMonthlyTable = () => {
    // Use percent view for PDF export, otherwise respect showPmsQawView or viewType
    const displayType = isPdfExport ? "percent" : (showPmsQawView ? "percent" : viewType);
    const isPercentView = displayType === "percent";

    return (
      <Card>
        <CardHeader>
          <div className="flex justify-between items-center mb-4">
            <CardTitle className="text-sm sm:text-lg text-foreground">
              Monthly Profit and Loss ({displayType === "percent" ? "%" : "₹"})
            </CardTitle>
            {!showPmsQawView && !isPdfExport && (
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
            )}
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
                  <tr key={`${year}-${displayType}`} className="border-border text-xs">
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
                    <td
                      className={`${
                        getCellClass(
                          isPercentView
                            ? monthlyPnl[year]?.totalPercent.toString() || "-"
                            : monthlyPnl[year]?.totalCash.toString() || "-",
                          isPercentView
                        )
                      } font-medium`}
                    >
                      <span
                        className={getReturnColor(
                          isPercentView
                            ? monthlyPnl[year]?.totalPercent.toString() || "-"
                            : monthlyPnl[year]?.totalCash.toString() || "-"
                        )}
                      >
                        {isPercentView
                          ? monthlyPnl[year]?.totalPercent.toString() === "-"
                            ? "-%"
                            : monthlyPnl[year]?.totalPercent && monthlyPnl[year].totalPercent !== 0
                              ? monthlyPnl[year].totalPercent > 0
                                ? `+${monthlyPnl[year].totalPercent.toFixed(2)}%`
                                : `${monthlyPnl[year].totalPercent.toFixed(2)}%`
                              : "-"
                          : monthlyPnl[year]?.totalCash.toString() === "-"
                            ? "₹-"
                            : monthlyPnl[year]?.totalCash && monthlyPnl[year].totalCash !== 0
                              ? monthlyPnl[year].totalCash >= 0
                                ? `+₹${Math.abs(monthlyPnl[year].totalCash).toLocaleString("en-IN", {
                                    minimumFractionDigits: 2,
                                    maximumFractionDigits: 2,
                                  })}`
                                : `-₹${Math.abs(monthlyPnl[year].totalCash).toLocaleString("en-IN", {
                                    minimumFractionDigits: 2,
                                    maximumFractionDigits: 2,
                                  })}`
                              : "-"}
                      </span>
                    </td>
                  </tr>
                ))}
                {monthlyYears.length === 0 && (
                  <tr>
                    <td colSpan={14} className="text-center py-3 px-4 text-muted-foreground">
                      No data available
                    </td>
                  </tr>
                )}
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
      {!showOnlyQuarterlyCash && renderMonthlyTable()}
    </div>
  );
}

/* =========================
   Main Component
   ========================= */
export default function DetailedPortfolio() {
  const { clients, loading: clientsLoading, isHeadOfFamily } = useClient();
  const [selectedAccount, setSelectedAccount] = useState<string>("");
  const [familyAccounts, setFamilyAccounts] = useState<FamilyAccount[]>([]);
  const [currentData, setCurrentData] = useState<PortfolioData | null>(null);
  const [historicalData, setHistoricalData] = useState<HistoricalData[]>([]);
  const [benchmarkData, setBenchmarkData] = useState<BenchmarkItem[]>([]);
  const [trailingReturns, setTrailingReturns] = useState<any>(null);
  const [trailingReturnsBenchmark, setTrailingReturnsBenchmark] = useState<any>(null);
  const [enrichedData, setEnrichedData] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [monthlyPnl, setMonthlyPnl] = useState<MonthlyPnlData>({});
  const [quarterlyPnl, setQuarterlyPnl] = useState<QuarterlyPnlData>({});
  const benchmarkColor = "#9CA3AF";

  // Fetch family accounts using same API as FamilyPortfolioSection
  useEffect(() => {
    const fetchFamilyAccounts = async () => {
      try {
        const familyRes = await fetch("/api/auth/client-data");
        const familyData = await familyRes.json();

        if (familyData.success && familyData.family) {
          const accounts: FamilyAccount[] = familyData.family.map((member: any) => ({
            clientid: member.clientid,
            clientcode: member.clientcode,
            holderName: sanitizeName(member.holderName),
            relation: member.relation,
            status: member.status,
            email: member.email,
          }));

          setFamilyAccounts(accounts);

          // Set first active account as default
          const firstActive = accounts.find(acc => acc.status === "Active");
          if (firstActive) {
            setSelectedAccount(firstActive.clientcode);
          }
        }
      } catch (err) {
        console.error("Failed to fetch family accounts:", err);
      }
    };

    fetchFamilyAccounts();
  }, []);

  // Fetch portfolio data when account is selected
  useEffect(() => {
    if (!selectedAccount) return;

    const fetchPortfolioData = async () => {
      setLoading(true);
      try {
        // Fetch current portfolio data using same API as FamilyPortfolioSection
        const portfolioRes = await fetch("/api/portfolio-details", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ nuvama_codes: [selectedAccount] }),
        });

        const portfolioData = await portfolioRes.json();

        if (portfolioData.success && portfolioData.data && portfolioData.data.length > 0) {
          setCurrentData(portfolioData.data[0]);
        }

        // Fetch historical data for charts
        const historyRes = await fetch(`/api/portfolio-history?nuvama_code=${selectedAccount}`);
        const historyData = await historyRes.json();

        if (historyData.success && historyData.data) {
          const histDataArr = historyData.data;
          setHistoricalData(histDataArr);

          if (histDataArr.length > 0) {
            const incDate = histDataArr[0].report_date;
            const latDate = histDataArr[histDataArr.length - 1].report_date;

            // Fetch benchmark data
            try {
              const benchmarkUrl = `https://research.qodeinvest.com/api/getIndices?indices=BSE500&startDate=${incDate}&endDate=${latDate}`;
              const benchmarkRes = await fetch(benchmarkUrl);
              const benchmarkRaw = await benchmarkRes.json();

              let benchArray: any[] = [];
              if (Array.isArray(benchmarkRaw)) {
                benchArray = benchmarkRaw;
              } else if (benchmarkRaw && Array.isArray(benchmarkRaw.data)) {
                benchArray = benchmarkRaw.data;
              }

              // Filter to range
              const start = new Date(incDate);
              const end = new Date(latDate);
              benchArray = benchArray
                .filter((item: any) => {
                  const d = new Date(item.date);
                  return d >= start && d <= end;
                })
                .sort((a: any, b: any) => new Date(a.date).getTime() - new Date(b.date).getTime());

              const processedBench = benchArray
                .map((item: any) => ({
                  date: item.date,
                  value: parseFloat(item.nav)
                }))
                .filter(item => !isNaN(item.value));

              setBenchmarkData(processedBench);
            } catch (benchErr) {
              console.error("Failed to fetch benchmark:", benchErr);
              setBenchmarkData([]);
            }
          }
        }

      } catch (error) {
        console.error("Failed to fetch portfolio data:", error);
      } finally {
        setLoading(false);
      }
    };

    fetchPortfolioData();
  }, [selectedAccount]);

  // Compute monthly and quarterly PNL
  useEffect(() => {
    if (historicalData.length === 0) {
      setMonthlyPnl({});
      setQuarterlyPnl({});
      return;
    }

    const sorted = [...historicalData].sort((a, b) => new Date(a.report_date).getTime() - new Date(b.report_date).getTime());

    const monthly: MonthlyPnlData = {};
    const quarterly: QuarterlyPnlData = {};

    let prevNav = 0;
    let prevValue = 0;
    let prevDate: Date | null = null;
    let prevYear = 0;
    let prevQuarter = 0;
    let prevYearMonth: string | null = null;

    let monthStartNav = 0;
    let monthStartValue = 0;
    let monthSumCash = 0;

    let quarterStartNav = 0;
    let quarterStartValue = 0;
    let quarterSumCash = 0;

    let yearStartNav = 0;
    let yearStartValue = 0;
    let yearSumCash = 0;

    for (let i = 0; i < sorted.length; i++) {
      const item = sorted[i];
      const dateObj = new Date(item.report_date);
      const year = dateObj.getFullYear();
      const month = dateObj.getMonth() + 1;
      const qtr = Math.ceil(month / 3);
      const ym = `${year}-${month.toString().padStart(2, '0')}`;
      const cash = Number(item.cash_in_out || 0);
      const nav = Number(item.nav);
      const pValue = Number(item.portfolio_value || 0);

      const isNewYear = prevDate === null || year !== prevYear;
      const isNewQuarter = isNewYear || qtr !== prevQuarter;
      const isNewMonth = prevDate === null || year !== dateObj.getFullYear() || month !== prevDate.getMonth() + 1;

      if (isNewYear) {
        // Finalize previous year
        if (prevYear > 0) {
          const yPercent = yearStartNav > 0 ? ((prevNav / yearStartNav) - 1) * 100 : 0;
          const yCash = prevValue - yearStartValue - yearSumCash;
          if (monthly[prevYear]) {
            monthly[prevYear].totalPercent = yPercent;
            monthly[prevYear].totalCash = yCash;
            monthly[prevYear].totalCapitalInOut = yearSumCash;
          }
          if (quarterly[prevYear]) {
            quarterly[prevYear].percent.total = yPercent.toFixed(2);
            quarterly[prevYear].cash.total = yCash.toFixed(2);
            quarterly[prevYear].yearCash = yearSumCash.toFixed(2);
          }
        }

        // Start new year
        if (prevDate === null) {
          yearStartNav = nav;
          yearStartValue = 0;
        } else {
          yearStartNav = prevNav;
          yearStartValue = prevValue;
        }
        yearSumCash = 0;
        if (!monthly[year]) {
          monthly[year] = { months: {}, totalPercent: 0, totalCash: 0, totalCapitalInOut: 0 };
        }
        if (!quarterly[year]) {
          quarterly[year] = {
            percent: { q1: "-", q2: "-", q3: "-", q4: "-", total: "-" },
            cash: { q1: "-", q2: "-", q3: "-", q4: "-", total: "-" },
            yearCash: "0.00"
          };
        }
      }

      if (isNewQuarter) {
        // Finalize previous quarter
        if (prevQuarter > 0) {
          const qPercent = quarterStartNav > 0 ? ((prevNav / quarterStartNav) - 1) * 100 : 0;
          const qCash = prevValue - quarterStartValue - quarterSumCash;
          const qk = `q${prevQuarter}`;
          if (quarterly[year]) {
            quarterly[year].percent[qk as keyof typeof quarterly[string]["percent"]] = qPercent.toFixed(2);
            quarterly[year].cash[qk as keyof typeof quarterly[string]["cash"]] = qCash.toFixed(2);
          }
        }

        // Start new quarter
        if (prevDate === null) {
          quarterStartNav = nav;
          quarterStartValue = 0;
        } else {
          quarterStartNav = prevNav;
          quarterStartValue = prevValue;
        }
        quarterSumCash = 0;
      }

      if (isNewMonth) {
        // Finalize previous month
        if (prevYearMonth !== null) {
          const mPercent = monthStartNav > 0 ? ((prevNav / monthStartNav) - 1) * 100 : 0;
          const mCash = prevValue - monthStartValue - monthSumCash;
          const [mYearStr, mMonthStr] = prevYearMonth.split('-');
          const mYear = parseInt(mYearStr);
          const mMonthNum = parseInt(mMonthStr);
          const mMonthName = new Date(mYear, mMonthNum - 1, 1).toLocaleString('en-US', { month: 'long' });
          if (monthly[mYear]) {
            monthly[mYear].months[mMonthName] = {
              percent: mPercent.toFixed(2),
              cash: mCash.toFixed(2),
              capitalInOut: monthSumCash.toFixed(2)
            };
          }
        }

        // Start new month
        if (prevDate === null) {
          monthStartNav = nav;
          monthStartValue = 0;
        } else {
          monthStartNav = prevNav;
          monthStartValue = prevValue;
        }
        monthSumCash = 0;
        prevYearMonth = ym;
      }

      // Accumulate cash
      yearSumCash += cash;
      quarterSumCash += cash;
      monthSumCash += cash;

      // Update prev
      prevNav = nav;
      prevValue = pValue;
      prevDate = dateObj;
      prevYear = year;
      prevQuarter = qtr;
    }

    // Finalize last month
    if (prevYearMonth !== null) {
      const mPercent = monthStartNav > 0 ? ((prevNav / monthStartNav) - 1) * 100 : 0;
      const mCash = prevValue - monthStartValue - monthSumCash;
      const [mYearStr, mMonthStr] = prevYearMonth.split('-');
      const mYear = parseInt(mYearStr);
      const mMonthNum = parseInt(mMonthStr);
      const mMonthName = new Date(mYear, mMonthNum - 1, 1).toLocaleString('en-US', { month: 'long' });
      if (!monthly[mYear]) {
        monthly[mYear] = { months: {}, totalPercent: 0, totalCash: 0, totalCapitalInOut: 0 };
      }
      monthly[mYear].months[mMonthName] = {
        percent: mPercent.toFixed(2),
        cash: mCash.toFixed(2),
        capitalInOut: monthSumCash.toFixed(2)
      };
    }

    // Finalize last quarter
    if (prevQuarter > 0) {
      const qPercent = quarterStartNav > 0 ? ((prevNav / quarterStartNav) - 1) * 100 : 0;
      const qCash = prevValue - quarterStartValue - quarterSumCash;
      const qk = `q${prevQuarter}`;
      if (quarterly[prevYear]) {
        quarterly[prevYear].percent[qk as keyof typeof quarterly[string]["percent"]] = qPercent.toFixed(2);
        quarterly[prevYear].cash[qk as keyof typeof quarterly[string]["cash"]] = qCash.toFixed(2);
      }
    }

    // Finalize last year
    if (prevYear > 0) {
      const yPercent = yearStartNav > 0 ? ((prevNav / yearStartNav) - 1) * 100 : 0;
      const yCash = prevValue - yearStartValue - yearSumCash;
      if (monthly[prevYear]) {
        monthly[prevYear].totalPercent = yPercent;
        monthly[prevYear].totalCash = yCash;
        monthly[prevYear].totalCapitalInOut = yearSumCash;
      }
      if (quarterly[prevYear]) {
        quarterly[prevYear].percent.total = yPercent.toFixed(2);
        quarterly[prevYear].cash.total = yCash.toFixed(2);
        quarterly[prevYear].yearCash = yearSumCash.toFixed(2);
      }
    }

    setMonthlyPnl(monthly);
    setQuarterlyPnl(quarterly);
  }, [historicalData]);

  // Enrich data with normalization and benchmark
  useEffect(() => {
    if (historicalData.length === 0) {
      setEnrichedData([]);
      return;
    }

    const firstNav = Number(historicalData[0].nav);
    if (firstNav <= 0) {
      setEnrichedData(historicalData);
      return;
    }

    const sortedBench = benchmarkData.length > 0 ? [...benchmarkData].sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime()) : [];
    const incDate = historicalData[0].report_date;
    const firstBenchItem = sortedBench.length > 0 ? findLatestBenchmarkBeforeOrOn(sortedBench, incDate) : null;
    const firstBench = firstBenchItem ? firstBenchItem.value : 0;

    let portPeak = firstNav;
    let benchPeak = firstBench > 0 ? 100 : 0; // normalized

    const enriched = historicalData.map((item, index) => {
      const currentNav = Number(item.nav);
      if (currentNav > portPeak) portPeak = currentNav;
      const portDD = -((currentNav - portPeak) / portPeak * 100); // positive

      const normNav = (currentNav / firstNav) * 100;

      let normBench = 100;
      let benchVal = firstBench;
      let benchDD = 0;

      if (sortedBench.length > 0 && firstBench > 0) {
        const benchItem = findLatestBenchmarkBeforeOrOn(sortedBench, item.report_date);
        benchVal = benchItem ? benchItem.value : firstBench;
        normBench = (benchVal / firstBench) * 100;

        if (normBench > benchPeak) benchPeak = normBench;
        benchDD = -((normBench - benchPeak) / benchPeak * 100); // positive
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

    setEnrichedData(enriched);
  }, [historicalData, benchmarkData]);

  // Calculate trailing returns when historicalData changes
  useEffect(() => {
    if (historicalData.length > 0) {
      const mappedData = historicalData.map(item => ({
        nav: Number(item.nav),
        date: item.report_date
      }));
      const incDate = historicalData[0].report_date;
      const returns = calculateTrailingReturnsForData(mappedData, incDate);
      setTrailingReturns(returns);
    }
  }, [historicalData]);

  // Calculate trailing returns for benchmark
  useEffect(() => {
    if (benchmarkData.length > 0 && historicalData.length > 0) {
      const mappedData = benchmarkData.map(item => ({
        nav: item.value,
        date: item.date
      }));
      const incDate = historicalData[0].report_date;
      const returns = calculateTrailingReturnsForData(mappedData, incDate);
      setTrailingReturnsBenchmark(returns);
    }
  }, [benchmarkData, historicalData]);

  // Simulate initial load (clientsLoading or initial fetch)
  useEffect(() => {
    if (clientsLoading) {
      const timer = setTimeout(() => {
        // This ensures loader shows briefly even if data loads fast
      }, 500);
      return () => clearTimeout(timer);
    }
  }, [clientsLoading]);

  if (clientsLoading) {
    return (
      <AnimatePresence mode="wait">
        <FullscreenLoader brand="Qode" subtitle="Preparing your portfolio…" />
      </AnimatePresence>
    );
  }

  // Calculate metrics
  const totalInvested = historicalData.reduce((sum, item) => sum + (Number(item.cash_in_out) || 0), 0);
  const currentValue = currentData?.portfolio_value || 0;
  const totalReturns = currentValue - totalInvested;
  const returnsPercent = totalInvested > 0 ? (totalReturns / totalInvested) * 100 : 0;
  const isPositiveReturnOverall = totalReturns >= 0;

  // Portfolio DD metrics
  const portfolioCurrentDD = enrichedData.length > 0 ? enrichedData[enrichedData.length - 1].drawdown_percent : 0;
  const portfolioMaxDD = enrichedData.length > 0 ? Math.max(...enrichedData.map(item => item.drawdown_percent || 0)) : 0;

  // Benchmark DD metrics
  const benchmarkCurrentDD = enrichedData.length > 0 ? enrichedData[enrichedData.length - 1].benchmark_drawdown_percent || 0 : 0;
  const benchmarkMaxDD = enrichedData.length > 0 ? Math.max(...enrichedData.map(item => item.benchmark_drawdown_percent || 0)) : 0;

  // Get selected account details and extract strategy
  const selectedAccountDetails = familyAccounts.find(acc => acc.clientcode === selectedAccount);
  const strategyCode = selectedAccount?.substring(0, 3).toUpperCase() as keyof typeof strategyColorConfig;
  const colors = strategyColorConfig[strategyCode] || strategyColorConfig.QAW;
  const strategyName = strategyNames[strategyCode as keyof typeof strategyNames] || 'Portfolio';

  // Calculate Y-axis domains
  const hasBenchmark = enrichedData.length > 0 && enrichedData[0]?.normalized_benchmark !== undefined;
  const navValues = enrichedData.map(d => d.normalized_nav);
  if (hasBenchmark) {
    navValues.push(...enrichedData.map(d => d.normalized_benchmark));
  }
  let navDomain = calculateYDomain(navValues, 5);

  const drawdownValues = enrichedData.map(item => -item.drawdown_percent);
  if (hasBenchmark) {
    drawdownValues.push(...enrichedData.map(d => -(d.benchmark_drawdown_percent || 0)));
  }
  const minDD = drawdownValues.length > 0 ? Math.min(...drawdownValues) : 0;
  const ddRange = Math.abs(minDD);
  const ddPadding = ddRange * 0.1;
  const drawdownDomain = [Math.floor(minDD - ddPadding), 0];

  // Get inception and latest date
  const inceptionDate = historicalData.length > 0 ? historicalData[0].report_date : null;
  const latestDate = historicalData.length > 0 ? historicalData[historicalData.length - 1].report_date : null;

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
    <AnimatePresence mode="wait">
      {loading && <FullscreenLoader brand="Qode" subtitle="Loading portfolio details…" />}
      {!loading && (
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

          {/* Header */}
          <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
            <div>
              <h1 className="text-2xl md:text-3xl font-bold text-foreground">Portfolio Details</h1>
              <div className="flex flex-col gap-1 mt-1">
                <p className="text-sm text-muted-foreground">
                  {selectedAccountDetails && (
                    <>
                      {sanitizeName(selectedAccountDetails.holderName)} • {selectedAccount}
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
            <Select value={selectedAccount} onValueChange={setSelectedAccount}>
              <SelectTrigger className="w-full md:w-80">
                <SelectValue placeholder="Select Account" />
              </SelectTrigger>
              <SelectContent>
                {familyAccounts.map(acc => (
                  <SelectItem key={acc.clientcode} value={acc.clientcode}>
                    <div className="flex items-center justify-between gap-3">
                      <span>{sanitizeName(acc.holderName)}</span>
                      <span className="text-xs text-muted-foreground">({acc.clientcode})</span>
                    </div>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
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
                <div className="text-2xl font-bold text-foreground ">{formatCurrency(totalInvested)}</div>
                <p className="text-xs text-muted-foreground mt-1">Total capital deployed</p>
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
                  {currentData?.report_date && `As of ${new Date(currentData.report_date).toLocaleDateString('en-IN')}`}
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

          {historicalData.length > 0 && trailingReturns && (
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
                            <div className={`text-xs ${period.key === 'Current DD' || period.key === 'Max DD' || period.key === 'Since Inception' ? 'whitespace-normal break-words' : 'whitespace-nowrap'}`} title={period.label}>
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
                            displayValue = `-${portfolioCurrentDD.toFixed(2)}%`;
                            cellStyle = { color: '#ef4444' };
                          } else if (period.key === 'Max DD') {
                            rawValue = portfolioMaxDD;
                            displayValue = `-${portfolioMaxDD.toFixed(2)}%`;
                            cellStyle = { color: '#ef4444' };
                          } else if (period.key === 'Since Inception') {
                            rawValue = trailingReturns['Since Inception'];
                            displayValue = formatReturn(trailingReturns['Since Inception']);
                            cellStyle = isPositiveReturn(rawValue) ? { color: colors.strategy } : isNegativeReturn(rawValue) ? { color: '#ef4444' } : {};
                          } else {
                            rawValue = trailingReturns[period.key];
                            displayValue = formatReturn(trailingReturns[period.key]);
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
                      {trailingReturnsBenchmark && (
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
                              displayValue = `-${benchmarkCurrentDD.toFixed(2)}%`;
                              cellStyle = { color: '#ef4444' };
                            } else if (period.key === 'Max DD') {
                              rawValue = benchmarkMaxDD;
                              displayValue = `-${benchmarkMaxDD.toFixed(2)}%`;
                              cellStyle = { color: '#ef4444' };
                            } else if (period.key === 'Since Inception') {
                              rawValue = trailingReturnsBenchmark['Since Inception'];
                              displayValue = formatReturn(trailingReturnsBenchmark['Since Inception']);
                              cellStyle = isPositiveReturn(rawValue) ? { color: benchmarkColor } : isNegativeReturn(rawValue) ? { color: '#ef4444' } : {};
                            } else {
                              rawValue = trailingReturnsBenchmark[period.key];
                              displayValue = formatReturn(trailingReturnsBenchmark[period.key]);
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
                      )}
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
          )}

          {historicalData.length > 0 ? (
            <>
              {/* NAV Chart */}
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Activity className="h-5 w-5" style={{ color: colors.primary }} />
                    {hasBenchmark ? "NAV Performance " : "NAV Performance"}
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
                    {hasBenchmark ? "Drawdown Analysis " : "Drawdown Analysis"}
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

              {Object.keys(monthlyPnl).length > 0 && (
                <PnlTable quarterlyPnl={quarterlyPnl} monthlyPnl={monthlyPnl} />
              )}

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
                        {historicalData
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
                                <td className={`py-3 px-4 text-sm text-right font-semibold ${isInflow ? 'text-green-600' : 'text-red-600'
                                  }`}>
                                  {isInflow ? '+' : '-'}{formatCurrency(Number(item.cash_in_out))}
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
                          <td className={`py-3 px-4 text-sm text-right font-bold ${totalInvested >= 0 ? 'text-green-600' : 'text-red-600'
                            }`}>
                            {formatCurrency(totalInvested)}
                          </td>
                          <td></td>
                        </tr>
                      </tfoot>
                    </table>
                  </div>
                </CardContent>
              </Card>
            </>
          ) : (
            <Card>
              <CardContent className="text-center py-12">
                <Activity className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
                <p className="text-sm text-muted-foreground">
                  No historical data available for this account.
                </p>
              </CardContent>
            </Card>
          )}
        </motion.div>
      )}
    </AnimatePresence>
  );
}