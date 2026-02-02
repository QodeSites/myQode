"use client";

import React, { useEffect, useState, useCallback } from "react";
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
  Activity,
  Download,
  AlertTriangle
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
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";

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
export function FullscreenLoader({
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
  ownerid?: string;
  ownername?: string;
  groupid?: string;
  groupname?: string;
  orbisData?: any[];
  orbisMetrics?: {
    latestCapitalAmount: number;
    latestMarketValue: number;
    latestDate: string;
    latestNav: number;
    totalRecords: number;
  } | null;
};

// Owner-level grouping by ownerid (per-owner All Strategies)
type GroupedOwner = {
  ownerid: string;
  ownerName: string;
  clientcodes: string[];
  accounts: FamilyAccount[];
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
  if (value === undefined || value === null || isNaN(Number(value)) || !isFinite(Number(value))) return "₹0.00";
  const numValue = Number(value);
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(numValue);
};

const formatPercent = (value: number | undefined | null) => {
  if (value === undefined || value === null || isNaN(Number(value)) || !isFinite(Number(value))) return "0.00%";
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

    return target;
  };

  const monthPeriods = {
    '1M': 1,
    '3M': 3,
    '6M': 6,
    '1Y': 12,
    '3Y': 36
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
   CSV Download Function
   ========================= */
/* =========================
   CSV Download for All Strategies
   ========================= */
const downloadAllStrategiesCSV = async (
  enrichedData: any[],
  trailingReturns: any,
  trailingReturnsBenchmark: any,
  monthlyPnl: MonthlyPnlData,
  quarterlyPnl: QuarterlyPnlData,
  accountCodes: string[],
  accountName: string,
  familyAccounts: FamilyAccount[]
) => {
  // Prepare CSV content
  let csvContent = "data:text/csv;charset=utf-8,";

  // Header section
  csvContent += `All Strategies Portfolio Export\n`;
  csvContent += `Portfolio Name,${accountName}\n`;
  csvContent += `Number of Accounts,${accountCodes.length}\n`;
  csvContent += `Account Codes,"${accountCodes.join(', ')}"\n`;
  csvContent += `Export Date,${new Date().toISOString()}\n`;
  csvContent += `\n`;

  // Combined NAV Section
  csvContent += `Combined NAV (All Strategies)\n`;
  csvContent += `Date,Combined NAV,Total Portfolio Value,Total Cash In/Out,Normalized NAV,Drawdown %\n`;
  
  // Data Quality Check
  let anomalyCount = 0;
  const anomalies: string[] = [];
  
  enrichedData.forEach((item, index) => {
    const nav = Number(item.nav);
    
    // Check for invalid NAVs
    if (nav <= 0 || !isFinite(nav)) {
      anomalyCount++;
      anomalies.push(`${item.report_date}: Invalid NAV (${nav})`);
    }
    
    // Check for sudden drops (>50% change from previous day)
    if (index > 0) {
      const prevNav = Number(enrichedData[index - 1].nav);
      const change = ((nav - prevNav) / prevNav) * 100;
      if (Math.abs(change) > 50 && prevNav > 0) {
        anomalyCount++;
        anomalies.push(`${item.report_date}: Sudden change of ${change.toFixed(2)}% (from ${prevNav} to ${nav})`);
      }
    }
    
    csvContent += `${item.report_date},${item.nav},${item.portfolio_value},${item.cash_in_out || 0},${item.normalized_nav},${item.drawdown_percent}\n`;
  });
  csvContent += `\n`;
  
  // Add Data Quality Report if anomalies found
  if (anomalyCount > 0) {
    csvContent += `DATA QUALITY REPORT\n`;
    csvContent += `Total Anomalies Detected,${anomalyCount}\n`;
    csvContent += `\n`;
    csvContent += `Anomaly Details\n`;
    anomalies.forEach(anomaly => {
      csvContent += `${anomaly}\n`;
    });
    csvContent += `\n`;
    csvContent += `Recommendation: Review source data for dates with invalid or sudden NAV changes\n`;
    csvContent += `\n`;
  }

  // Fetch individual account NAVs
  csvContent += `Individual Account NAVs (Raw Data)\n`;
  csvContent += `Date,${accountCodes.map(code => `${code} NAV`).join(',')},${accountCodes.map(code => `${code} Portfolio Value`).join(',')},${accountCodes.map(code => `${code} Cash Flow`).join(',')}\n`;

  try {
    // Fetch historical data for each account
    const accountDataPromises = accountCodes.map(async (code) => {
      const response = await fetch(`/api/portfolio-history?nuvama_code=${code}`);
      const data = await response.json();
      return { code, data: data.success ? data.data : [] };
    });

    const accountsData = await Promise.all(accountDataPromises);

    // Create a map of dates to account data
    const dateMap = new Map<string, Map<string, { nav: number; portfolio_value: number; cash_in_out: number }>>();

    accountsData.forEach(({ code, data }) => {
      data.forEach((item: any) => {
        if (!dateMap.has(item.report_date)) {
          dateMap.set(item.report_date, new Map());
        }
        dateMap.get(item.report_date)!.set(code, {
          nav: Number(item.nav) || 0,
          portfolio_value: Number(item.portfolio_value) || 0,
          cash_in_out: Number(item.cash_in_out) || 0,
        });
      });
    });

    // Sort dates and output
    const sortedDates = Array.from(dateMap.keys()).sort((a, b) => new Date(a).getTime() - new Date(b).getTime());

    sortedDates.forEach((date) => {
      const accountsForDate = dateMap.get(date)!;
      const navs = accountCodes.map(code => accountsForDate.get(code)?.nav || '');
      const portfolioValues = accountCodes.map(code => accountsForDate.get(code)?.portfolio_value || '');
      const cashFlows = accountCodes.map(code => accountsForDate.get(code)?.cash_in_out || '');
      csvContent += `${date},${navs.join(',')},${portfolioValues.join(',')},${cashFlows.join(',')}\n`;
    });
  } catch (error) {
    csvContent += `Error fetching individual account data: ${error}\n`;
  }

  csvContent += `\n`;

  // Account Details Section
  csvContent += `Account Details\n`;
  csvContent += `Account Code,Holder Name,Strategy,Status\n`;
  accountCodes.forEach((code) => {
    const account = familyAccounts.find(acc => acc.clientcode === code);
    if (account) {
      const strategyCode = code.substring(0, 3).toUpperCase();
      const strategyName = strategyNames[strategyCode as keyof typeof strategyNames] || strategyCode;
      csvContent += `${code},${account.holderName},${strategyName},${account.status}\n`;
    }
  });
  csvContent += `\n`;

  // Trailing Returns Section
  csvContent += `Trailing Returns (Combined Portfolio)\n`;
  csvContent += `Period,Portfolio %,Benchmark %\n`;
  const periods = ['1W', '10D', '1M', '3M', '6M', '1Y', '3Y', 'Since Inception'];
  periods.forEach((period) => {
    const portVal = trailingReturns && trailingReturns[period] !== undefined ? trailingReturns[period] : '-';
    const benchVal = trailingReturnsBenchmark && trailingReturnsBenchmark[period] !== undefined ? trailingReturnsBenchmark[period] : '-';
    csvContent += `${period},${portVal},${benchVal}\n`;
  });
  csvContent += `\n`;

  // Drawdown Metrics Section
  if (enrichedData.length > 0) {
    const portfolioCurrentDD = enrichedData[enrichedData.length - 1].drawdown_percent || 0;
    const portfolioMaxDD = Math.max(...enrichedData.map(item => item.drawdown_percent || 0));
    const benchmarkCurrentDD = enrichedData[enrichedData.length - 1].benchmark_drawdown_percent || 0;
    const benchmarkMaxDD = Math.max(...enrichedData.map(item => item.benchmark_drawdown_percent || 0));

    csvContent += `Drawdown Metrics\n`;
    csvContent += `Metric,Portfolio %,Benchmark %\n`;
    csvContent += `Current Drawdown,${portfolioCurrentDD.toFixed(2)},${benchmarkCurrentDD.toFixed(2)}\n`;
    csvContent += `Maximum Drawdown,${portfolioMaxDD.toFixed(2)},${benchmarkMaxDD.toFixed(2)}\n`;
    csvContent += `\n`;
  }

  // Quarterly PnL Section
  csvContent += `Quarterly PnL (Combined Portfolio)\n`;
  csvContent += `Year,Q1 %,Q1 Cash,Q2 %,Q2 Cash,Q3 %,Q3 Cash,Q4 %,Q4 Cash,Total %,Total Cash,Year Cash In/Out\n`;
  Object.keys(quarterlyPnl).sort().forEach((year) => {
    const qData = quarterlyPnl[year];
    csvContent += `${year},${qData.percent.q1},${qData.cash.q1},${qData.percent.q2},${qData.cash.q2},${qData.percent.q3},${qData.cash.q3},${qData.percent.q4},${qData.cash.q4},${qData.percent.total},${qData.cash.total},${qData.yearCash}\n`;
  });
  csvContent += `\n`;

  // Monthly PnL Section
  csvContent += `Monthly PnL (Combined Portfolio)\n`;
  csvContent += `Year,Month,Percent,Cash,Capital In/Out\n`;
  const monthOrder = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
  Object.keys(monthlyPnl).sort().forEach((year) => {
    const yearData = monthlyPnl[year];
    monthOrder.forEach((month) => {
      if (yearData.months[month]) {
        const mData = yearData.months[month];
        csvContent += `${year},${month},${mData.percent},${mData.cash},${mData.capitalInOut}\n`;
      }
    });
    csvContent += `${year},Total Year,${yearData.totalPercent},${yearData.totalCash},${yearData.totalCapitalInOut}\n`;
  });

  // Create download link
  const encodedUri = encodeURI(csvContent);
  const link = document.createElement("a");
  link.setAttribute("href", encodedUri);
  link.setAttribute("download", `all_strategies_portfolio_${new Date().toISOString().split('T')[0]}.csv`);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
};

/* =========================
   CSV Download for Single Account
   ========================= */
const downloadConsolidatedCSV = (
  enrichedData: any[],
  trailingReturns: any,
  trailingReturnsBenchmark: any,
  monthlyPnl: MonthlyPnlData,
  quarterlyPnl: QuarterlyPnlData,
  accountCode: string,
  accountName: string,
  dataView: string
) => {
  // Prepare CSV content
  let csvContent = "data:text/csv;charset=utf-8,";

  // Header section
  csvContent += `Account Information\n`;
  csvContent += `Account Code,${accountCode}\n`;
  csvContent += `Account Name,${accountName}\n`;
  csvContent += `Data View,${dataView}\n`;
  csvContent += `Export Date,${new Date().toISOString()}\n`;
  csvContent += `\n`;

  // Historical Data Section
  csvContent += `Historical Performance Data\n`;
  csvContent += `Date,NAV,Portfolio Value,Cash In/Out,Normalized NAV,Drawdown %,Benchmark NAV,Benchmark Normalized,Benchmark Drawdown %\n`;
  
  // Data Quality Check
  let anomalyCount = 0;
  const anomalies: string[] = [];
  
  enrichedData.forEach((item, index) => {
    const nav = Number(item.nav);
    
    // Check for invalid NAVs
    if (nav <= 0 || !isFinite(nav)) {
      anomalyCount++;
      anomalies.push(`${item.report_date}: Invalid NAV (${nav})`);
    }
    
    // Check for sudden drops (>50% change from previous day)
    if (index > 0) {
      const prevNav = Number(enrichedData[index - 1].nav);
      const change = ((nav - prevNav) / prevNav) * 100;
      if (Math.abs(change) > 50 && prevNav > 0) {
        anomalyCount++;
        anomalies.push(`${item.report_date}: Sudden change of ${change.toFixed(2)}% (from ${prevNav} to ${nav})`);
      }
    }
    
    csvContent += `${item.report_date},${item.nav},${item.portfolio_value},${item.cash_in_out || 0},${item.normalized_nav},${item.drawdown_percent},${item.benchmark_value || ''},${item.normalized_benchmark || ''},${item.benchmark_drawdown_percent || ''}\n`;
  });
  csvContent += `\n`;
  
  // Add Data Quality Report if anomalies found
  if (anomalyCount > 0) {
    csvContent += `DATA QUALITY REPORT\n`;
    csvContent += `Total Anomalies Detected,${anomalyCount}\n`;
    csvContent += `\n`;
    csvContent += `Anomaly Details\n`;
    anomalies.forEach(anomaly => {
      csvContent += `${anomaly}\n`;
    });
    csvContent += `\n`;
    csvContent += `Recommendation: Review source data for dates with invalid or sudden NAV changes\n`;
    csvContent += `\n`;
  }

  // Trailing Returns Section
  csvContent += `Trailing Returns\n`;
  csvContent += `Period,Portfolio %,Benchmark %\n`;
  const periods = ['1W', '10D', '1M', '3M', '6M', '1Y', '3Y', 'Since Inception'];
  periods.forEach((period) => {
    const portVal = trailingReturns && trailingReturns[period] !== undefined ? trailingReturns[period] : '-';
    const benchVal = trailingReturnsBenchmark && trailingReturnsBenchmark[period] !== undefined ? trailingReturnsBenchmark[period] : '-';
    csvContent += `${period},${portVal},${benchVal}\n`;
  });
  csvContent += `\n`;

  // Drawdown Metrics Section
  if (enrichedData.length > 0) {
    const portfolioCurrentDD = enrichedData[enrichedData.length - 1].drawdown_percent || 0;
    const portfolioMaxDD = Math.max(...enrichedData.map(item => item.drawdown_percent || 0));
    const benchmarkCurrentDD = enrichedData[enrichedData.length - 1].benchmark_drawdown_percent || 0;
    const benchmarkMaxDD = Math.max(...enrichedData.map(item => item.benchmark_drawdown_percent || 0));

    csvContent += `Drawdown Metrics\n`;
    csvContent += `Metric,Portfolio %,Benchmark %\n`;
    csvContent += `Current Drawdown,${portfolioCurrentDD.toFixed(2)},${benchmarkCurrentDD.toFixed(2)}\n`;
    csvContent += `Maximum Drawdown,${portfolioMaxDD.toFixed(2)},${benchmarkMaxDD.toFixed(2)}\n`;
    csvContent += `\n`;
  }

  // Quarterly PnL Section
  csvContent += `Quarterly PnL\n`;
  csvContent += `Year,Q1 %,Q1 Cash,Q2 %,Q2 Cash,Q3 %,Q3 Cash,Q4 %,Q4 Cash,Total %,Total Cash,Year Cash In/Out\n`;
  Object.keys(quarterlyPnl).sort().forEach((year) => {
    const qData = quarterlyPnl[year];
    csvContent += `${year},${qData.percent.q1},${qData.cash.q1},${qData.percent.q2},${qData.cash.q2},${qData.percent.q3},${qData.cash.q3},${qData.percent.q4},${qData.cash.q4},${qData.percent.total},${qData.cash.total},${qData.yearCash}\n`;
  });
  csvContent += `\n`;

  // Monthly PnL Section
  csvContent += `Monthly PnL\n`;
  csvContent += `Year,Month,Percent,Cash,Capital In/Out\n`;
  const monthOrder = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
  Object.keys(monthlyPnl).sort().forEach((year) => {
    const yearData = monthlyPnl[year];
    monthOrder.forEach((month) => {
      if (yearData.months[month]) {
        const mData = yearData.months[month];
        csvContent += `${year},${month},${mData.percent},${mData.cash},${mData.capitalInOut}\n`;
      }
    });
    csvContent += `${year},Total Year,${yearData.totalPercent},${yearData.totalCash},${yearData.totalCapitalInOut}\n`;
  });

  // Create download link
  const encodedUri = encodeURI(csvContent);
  const link = document.createElement("a");
  link.setAttribute("href", encodedUri);
  link.setAttribute("download", `portfolio_debug_${accountCode}_${dataView}_${new Date().toISOString().split('T')[0]}.csv`);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
};

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
  const [groupedOwners, setGroupedOwners] = useState<GroupedOwner[]>([]);
  const [currentData, setCurrentData] = useState<PortfolioData | null>(null);
  const [historicalData, setHistoricalData] = useState<HistoricalData[]>([]);
  const [orbisHistoricalData, setOrbisHistoricalData] = useState<HistoricalData[]>([]);
  const [consolidatedHistoricalData, setConsolidatedHistoricalData] = useState<HistoricalData[]>([]);
  const [benchmarkData, setBenchmarkData] = useState<BenchmarkItem[]>([]);
  const [trailingReturns, setTrailingReturns] = useState<any>(null);
  const [trailingReturnsBenchmark, setTrailingReturnsBenchmark] = useState<any>(null);
  const [enrichedData, setEnrichedData] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [monthlyPnl, setMonthlyPnl] = useState<MonthlyPnlData>({});
  const [quarterlyPnl, setQuarterlyPnl] = useState<QuarterlyPnlData>({});
  const [orbisData, setOrbisData] = useState<any[]>([]);
  const [dataView, setDataView] = useState<'nuvama' | 'orbis' | 'consolidated'>('nuvama');
  const [dataAnomalies, setDataAnomalies] = useState<Array<{ date: string; issue: string; severity: 'error' | 'warning' }>>([]);
  const benchmarkColor = "#9CA3AF";

const createConsolidatedData = useCallback(
  (
    orbisData: any[],
    nuvamaData: HistoricalData[],
    nuvamaCode: string
  ): HistoricalData[] => {
    // ============================================================================
    // CONSOLIDATED DATA CREATION (Orbis + Nuvama)
    // ============================================================================
    // This function combines historical data from two sources:
    // 1. Orbis (legacy PMS data) - older historical records
    // 2. Nuvama (current PMS data) - recent records
    //
    // The consolidation process:
    // - Orbis data is rebased to match Nuvama's NAV scale at the transition point
    // - Nuvama data after Orbis end date is kept as-is
    // - Result: seamless historical NAV series spanning both systems
    // ============================================================================

    if (!orbisData?.length) {
      return nuvamaData;
    }
    if (!nuvamaData?.length) {
      return orbisData.map(item => ({
        report_date: item.date,
        nav: Number(item.nav),
        portfolio_value: Number(item.market_value || 0),
        drawdown_percent: 0,
        cash_in_out: Number(item.net_capital_flow || 0),
      }));
    }

    if (nuvamaCode === 'QAW00026') {
      return nuvamaData;
    }

    // Sort Orbis
    const sortedOrbis = [...orbisData].sort(
      (a, b) => new Date(a.date).getTime() - new Date(b.date).getTime()
    );

    const lastOrbis = sortedOrbis[sortedOrbis.length - 1];
    const lastOrbisNav = Number(lastOrbis.nav);
    const orbisEndDate = lastOrbis.date;

    // Sort Nuvama
    const sortedNuvama = [...nuvamaData].sort(
      (a, b) =>
        new Date(a.report_date).getTime() -
        new Date(b.report_date).getTime()
    );

    // Find Nuvama data AFTER Orbis end date
    const nuvamaAfterOrbis = sortedNuvama.filter(
      item => new Date(item.report_date) > new Date(orbisEndDate)
    );

    if (nuvamaAfterOrbis.length === 0) {
      // No Nuvama data after Orbis, just return rebased Orbis
      return sortedOrbis.map(item => ({
        report_date: item.date,
        nav: Number(item.nav),
        portfolio_value: Number(item.market_value || 0),
        drawdown_percent: 0,
        cash_in_out: Number(item.net_capital_flow || 0),
      }));
    }

    // Get first Nuvama NAV after Orbis
    const firstNuvamaAfterOrbis = nuvamaAfterOrbis[0];
    const firstNuvamaNav = Number(firstNuvamaAfterOrbis.nav);

    // Calculate factor to rebase Orbis to match Nuvama scale
    const factor = lastOrbisNav > 0 ? firstNuvamaNav / lastOrbisNav : 1;

    // Rebase Orbis NAVs to align with Nuvama
    const rebasedOrbis: HistoricalData[] = sortedOrbis.map(item => ({
      report_date: item.date,
      nav: Number(item.nav) * factor,
      portfolio_value: Number(item.market_value || 0),
      drawdown_percent: 0,
      cash_in_out: Number(item.net_capital_flow || 0),
    }));

    // Keep Nuvama data as-is (no modification needed)
    const intactNuvama: HistoricalData[] = nuvamaAfterOrbis.map(item => ({
      ...item,
      nav: Number(item.nav),
    }));

    const consolidated = [...rebasedOrbis, ...intactNuvama];

    return consolidated;
  },
  []
);



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
            ownerid: member.ownerid,
            ownername: member.ownername,
            groupid: member.groupid,
            groupname: member.groupname,
            orbisData: member.orbisData || [],
            orbisMetrics: member.orbisMetrics || null,
          }));

          setFamilyAccounts(accounts);

          // Owner-level grouping: use ownerid to group accounts per owner
          // This is used for "Owner Name (All Strategies)" consolidation
          const ownerMap = new Map<string, GroupedOwner>();
          accounts.forEach(account => {
            const oid = account.ownerid || account.clientid || account.clientcode;
            if (!ownerMap.has(oid)) {
              ownerMap.set(oid, {
                ownerid: oid,
                ownerName: sanitizeName(account.ownername || account.holderName),
                clientcodes: [],
                accounts: [],
              });
            }
            const owner = ownerMap.get(oid)!;
            owner.clientcodes.push(account.clientcode);
            owner.accounts.push(account);
          });
          setGroupedOwners(Array.from(ownerMap.values()));

          // Set first active account as default
          const firstActive = accounts.find(acc => acc.status === "Active");
          if (firstActive) {
            setSelectedAccount(firstActive.clientcode);
            // Set orbis data for the selected account
            setOrbisData(firstActive.orbisData || []);
          }
        }
      } catch (err) {
        console.error("Failed to fetch family accounts:", err);
      }
    };

    fetchFamilyAccounts();
  }, []);

  // Update orbis data when account changes
  useEffect(() => {
    if (!selectedAccount) return;

    const selectedAccountData = familyAccounts.find(acc => acc.clientcode === selectedAccount);
    if (selectedAccountData) {
      setOrbisData(selectedAccountData.orbisData || []);

      // Auto-select view based on data availability
      const hasOrbis = selectedAccountData.orbisData && selectedAccountData.orbisData.length > 0;
      if (hasOrbis) {
        setDataView('consolidated'); // Default to consolidated view if Orbis data exists
      } else {
        setDataView('nuvama'); // Default to Nuvama only if no Orbis data
      }
    }
  }, [selectedAccount, familyAccounts]);

  // Fetch portfolio data when account is selected or when orbisData changes
  useEffect(() => {
    if (!selectedAccount) return;

    const fetchPortfolioData = async () => {
      setLoading(true);
      try {
        // Check if "Complete Family Portfolio" is selected (family-level consolidation with Orbis support)
        if (selectedAccount === 'COMPLETE_FAMILY_PORTFOLIO') {
          // ============================================================================
          // "ALL STRATEGIES" NAV CALCULATION (Complete Family Portfolio)
          // ============================================================================
          // This calculates consolidated NAV across ALL family accounts and strategies.
          //
          // IMPORTANT: Orbis data is EXCLUDED from "All Strategies" consolidation
          // - Only Nuvama data is used for multi-account consolidation
          // - Backend API (client_combined_nav) handles the NAV aggregation
          // - Individual account Orbis data is only used in single-account views
          //
          // CLOSED ACCOUNTS HANDLING:
          // - Closed accounts should only contribute to NAV when they were active
          // - We need to filter account codes based on their status and data availability
          // ============================================================================
          
          // Filter to only include active accounts OR closed accounts with recent data
          const activeAccountCodes = familyAccounts
            .filter((acc: FamilyAccount) => {
              // Always include active accounts
              if (acc.status === "Active") return true;
              
              // For closed accounts, check if they have recent data (within last 30 days)
              if (acc.status === "Closed" || acc.status === "Inactive") {
                // We'll let the backend handle this, but log it for debugging
                console.log(`ℹ️ [CLOSED ACCOUNT] ${acc.clientcode} (${acc.holderName}) is ${acc.status} - will be excluded from combined NAV`);
                return false;
              }
              
              return true;
            })
            .map((acc: FamilyAccount) => acc.clientcode);

          console.log('📊 [ACCOUNT FILTERING]');
          console.log('  Total accounts:', familyAccounts.length);
          console.log('  Active accounts:', activeAccountCodes.length);
          console.log('  Excluded accounts:', familyAccounts.length - activeAccountCodes.length);
          console.log('  Account codes for combined NAV:', activeAccountCodes);

          // Check if any account has Orbis data
          const accountsWithOrbis = familyAccounts.filter(acc => acc.orbisData && acc.orbisData.length > 0);
          const hasAnyOrbisData = accountsWithOrbis.length > 0;

          // Fetch combined NAV for all active Nuvama accounts
          const combinedNavRes = await fetch('https://qode360-backend.qodeinvest.com/api/v1/returns/client_combined_nav/', {
            method: 'POST',
            headers: { 'accept': 'application/json', 'Content-Type': 'application/json' },
            body: JSON.stringify({ account_code: activeAccountCodes }),
          });

          const combinedNavData = await combinedNavRes.json();

          // ============================================================================
          // COMBINED NAV DEBUGGING
          // ============================================================================
          // Log the API response to help debug negative NAV issues
          if (combinedNavData && combinedNavData.data) {
            const problematicDates = combinedNavData.data.filter((item: any) => {
              const nav = Number(item.combined_nav);
              return nav <= 0 || !isFinite(nav);
            });
            
            if (problematicDates.length > 0) {
              console.error('🚨 [COMBINED NAV API] Backend returned invalid NAV values:');
              console.table(problematicDates.map((item: any) => ({
                Date: item.valuedate,
                'Combined NAV': item.combined_nav,
                'Account Codes': activeAccountCodes.join(', ')
              })));
              
              console.log('📋 [DEBUG INFO] Active accounts included:', activeAccountCodes);
              console.log('💡 [RECOMMENDATION] Check if all active accounts have data for these dates');
              console.log('💡 [RECOMMENDATION] Backend API may be failing when accounts have missing data');
            }
          }

          if (combinedNavData && combinedNavData.data && Array.isArray(combinedNavData.data)) {
            // Fetch Nuvama portfolio history (only for active accounts)
            const historyRes = await fetch(`/api/portfolio-history?nuvama_codes=${activeAccountCodes.join(',')}`);
            const historyData = await historyRes.json();

            if (historyData.success && historyData.data && historyData.isMultiAccount) {
              const dateMap = new Map<string, { portfolioValues: number[]; cashFlows: number[] }>();
              historyData.data.forEach((row: any) => {
                const date = row.report_date;
                if (!dateMap.has(date)) dateMap.set(date, { portfolioValues: [], cashFlows: [] });
                const dateData = dateMap.get(date)!;
                dateData.portfolioValues.push(Number(row.portfolio_value) || 0);
                dateData.cashFlows.push(Number(row.cash_in_out) || 0);
              });

              // Create Nuvama consolidated data
              const nuvamaConsolidatedData: HistoricalData[] = combinedNavData.data
                .map((item: any) => {
                  const date = item.valuedate;
                  const dateData = dateMap.get(date);
                  return {
                    report_date: date,
                    nav: Number(item.combined_nav) || 100,
                    portfolio_value: dateData ? dateData.portfolioValues.reduce((sum, val) => sum + val, 0) : 0,
                    cash_in_out: dateData ? dateData.cashFlows.reduce((sum, val) => sum + val, 0) : 0,
                    drawdown_percent: 0,
                  };
                })
                .filter((item: HistoricalData) => {
                  // TEMPORARY FIX: Filter out invalid NAV values
                  // This handles cases where backend API still returns bad data
                  const nav = Number(item.nav);
                  const isValid = nav > 0 && isFinite(nav);
                  
                  if (!isValid) {
                    console.warn(`⚠️ [DATA FILTER] Removing invalid NAV for date ${item.report_date}: ${nav}`);
                  }
                  
                  return isValid;
                })
                .sort((a: HistoricalData, b: HistoricalData) => 
                  new Date(a.report_date).getTime() - new Date(b.report_date).getTime()
                );

              console.log('✅ [DATA PROCESSING] Final data points after filtering:', nuvamaConsolidatedData.length);
              console.log('📊 [DATA RANGE] From:', nuvamaConsolidatedData[0]?.report_date, 'To:', nuvamaConsolidatedData[nuvamaConsolidatedData.length - 1]?.report_date);

              // For "All Strategies" consolidation, we exclude Orbis data and only use Nuvama
              // Note: Individual account Orbis data is available in single-account views only
              setHistoricalData(nuvamaConsolidatedData);
              setOrbisHistoricalData([]);
              setConsolidatedHistoricalData([]);
              setOrbisData([]);
              setDataView('nuvama'); // Default to Nuvama view

              // Get current portfolio value (only for active accounts)
              const portfolioRes = await fetch("/api/portfolio-details", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ nuvama_codes: activeAccountCodes }),
              });
              const portfolioData = await portfolioRes.json();
              let totalCurrentValue = 0;
              if (portfolioData.success && portfolioData.data && portfolioData.data.length > 0) {
                totalCurrentValue = portfolioData.data.reduce((sum: number, item: any) => sum + (Number(item.portfolio_value) || 0), 0);
              }
              setCurrentData({
                account_code: 'COMPLETE_FAMILY_PORTFOLIO',
                portfolio_value: totalCurrentValue,
                report_date: new Date().toISOString()
              });
            }
          }
          setLoading(false);
          return;
        }


        // Check if an owner-level consolidation is selected (per-owner All Strategies)
        if (selectedAccount.startsWith('OWNER_')) {
          // ============================================================================
          // OWNER-LEVEL "ALL STRATEGIES" NAV CALCULATION
          // ============================================================================
          // Similar to Complete Family Portfolio, but for a single owner
          // who has multiple accounts across different strategies.
          //
          // IMPORTANT: Orbis data is EXCLUDED from owner-level consolidation
          // - Only Nuvama data is used
          // - Backend API handles NAV aggregation across owner's accounts
          // ============================================================================

          const ownerKey = selectedAccount.replace('OWNER_', '');
          const owner = groupedOwners.find(o => o.ownerid === ownerKey);

          if (owner && owner.clientcodes.length > 1) {
            // ============================================================================
            // OWNER-LEVEL CLOSED ACCOUNTS HANDLING
            // ============================================================================
            // Filter to only include active accounts for this owner
            const activeMemberAccounts = owner.accounts.filter(acc => acc.status === "Active");
            const activeMemberCodes = activeMemberAccounts.map(acc => acc.clientcode);

            console.log('📊 [OWNER ACCOUNT FILTERING]');
            console.log('  Owner:', owner.ownerName);
            console.log('  Total accounts:', owner.clientcodes.length);
            console.log('  Active accounts:', activeMemberCodes.length);
            console.log('  Account codes for combined NAV:', activeMemberCodes);

            // Skip if no active accounts
            if (activeMemberCodes.length === 0) {
              console.warn('⚠️ [OWNER LEVEL] No active accounts for owner:', owner.ownerName);
              setLoading(false);
              return;
            }

            // Check if any of owner's active accounts have Orbis data
            const memberAccountsWithOrbis = activeMemberAccounts.filter(acc => acc.orbisData && acc.orbisData.length > 0);
            const hasOrbisData = memberAccountsWithOrbis.length > 0;

            const combinedNavRes = await fetch('https://qode360-backend.qodeinvest.com/api/v1/returns/client_combined_nav/', {
              method: 'POST',
              headers: { 'accept': 'application/json', 'Content-Type': 'application/json' },
              body: JSON.stringify({ account_code: activeMemberCodes }),
            });

            const combinedNavData = await combinedNavRes.json();

            // ============================================================================
            // COMBINED NAV DEBUGGING (Member Level)
            // ============================================================================
            if (combinedNavData && combinedNavData.data) {
              const problematicDates = combinedNavData.data.filter((item: any) => {
                const nav = Number(item.combined_nav);
                return nav <= 0 || !isFinite(nav);
              });
              
              if (problematicDates.length > 0) {
                console.error('🚨 [OWNER COMBINED NAV API] Backend returned invalid NAV values:');
                console.table(problematicDates.map((item: any) => ({
                  Date: item.valuedate,
                  'Combined NAV': item.combined_nav,
                  'Owner': owner.ownerName,
                  'Account Codes': owner.clientcodes.join(', ')
                })));

                console.log('📋 [DEBUG INFO] Owner accounts:', activeMemberCodes);
                console.log('💡 [RECOMMENDATION] Check if all active owner accounts have data for these dates');
              }
            }

            if (combinedNavData && combinedNavData.data && Array.isArray(combinedNavData.data)) {
              const historyRes = await fetch(`/api/portfolio-history?nuvama_codes=${activeMemberCodes.join(',')}`);
              const historyData = await historyRes.json();

              if (historyData.success && historyData.data && historyData.isMultiAccount) {
                const dateMap = new Map<string, { portfolioValues: number[]; cashFlows: number[] }>();
                historyData.data.forEach((row: any) => {
                  const date = row.report_date;
                  if (!dateMap.has(date)) dateMap.set(date, { portfolioValues: [], cashFlows: [] });
                  const dateData = dateMap.get(date)!;
                  dateData.portfolioValues.push(Number(row.portfolio_value) || 0);
                  dateData.cashFlows.push(Number(row.cash_in_out) || 0);
                });

                const nuvamaConsolidatedData: HistoricalData[] = combinedNavData.data
                  .map((item: any) => {
                    const date = item.valuedate;
                    const dateData = dateMap.get(date);
                    return {
                      report_date: date,
                      nav: Number(item.combined_nav) || 100,
                      portfolio_value: dateData ? dateData.portfolioValues.reduce((sum, val) => sum + val, 0) : 0,
                      cash_in_out: dateData ? dateData.cashFlows.reduce((sum, val) => sum + val, 0) : 0,
                      drawdown_percent: 0,
                    };
                  })
                  .filter((item: HistoricalData) => {
                    // TEMPORARY FIX: Filter out invalid NAV values
                    const nav = Number(item.nav);
                    const isValid = nav > 0 && isFinite(nav);
                    
                    if (!isValid) {
                      console.warn(`⚠️ [MEMBER DATA FILTER] Removing invalid NAV for date ${item.report_date}: ${nav}`);
                    }
                    
                    return isValid;
                  })
                  .sort((a: HistoricalData, b: HistoricalData) => 
                    new Date(a.report_date).getTime() - new Date(b.report_date).getTime()
                  );

                console.log('✅ [MEMBER DATA PROCESSING] Final data points after filtering:', nuvamaConsolidatedData.length);

                // For "All Strategies" member consolidation, we exclude Orbis data and only use Nuvama
                // Note: Individual account Orbis data is available in single-account views only
                setHistoricalData(nuvamaConsolidatedData);
                setOrbisHistoricalData([]);
                setConsolidatedHistoricalData([]);
                setOrbisData([]);
                setDataView('nuvama'); // Default to Nuvama view

                const portfolioRes = await fetch("/api/portfolio-details", {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ nuvama_codes: activeMemberCodes }),
                });
                const portfolioData = await portfolioRes.json();
                let totalCurrentValue = 0;
                if (portfolioData.success && portfolioData.data && portfolioData.data.length > 0) {
                  totalCurrentValue = portfolioData.data.reduce((sum: number, item: any) => sum + (Number(item.portfolio_value) || 0), 0);
                }
                setCurrentData({ account_code: selectedAccount, portfolio_value: totalCurrentValue, report_date: new Date().toISOString() });
              }
            }
            setLoading(false);
            return;
          }
        }

        // Single account selected - existing logic
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

          // Get current orbisData from the selected account
          const selectedAccountData = familyAccounts.find(acc => acc.clientcode === selectedAccount);
          const currentOrbisData = selectedAccountData?.orbisData || [];

          // Convert Orbis data to historical format
          const orbisHistorical = currentOrbisData.map(item => ({
            report_date: item.date,
            nav: Number(item.nav),
            portfolio_value: Number(item.market_value || 0),
            drawdown_percent: 0,
            cash_in_out: Number(item.net_capital_flow || 0)
          }));
          setOrbisHistoricalData(orbisHistorical);

          // Create consolidated data
          const consolidated = createConsolidatedData(currentOrbisData, histDataArr, selectedAccount);
          setConsolidatedHistoricalData(consolidated);

          // Store Orbis data for view switching
          setOrbisData(currentOrbisData);

          // Set default view to Nuvama if Orbis data exists
          if (currentOrbisData.length > 0) {
            setDataView('nuvama');
          }

          // Determine the date range for benchmark data
          // Use consolidated data if it has orbis, otherwise use nuvama data
          const dataForBenchmark = currentOrbisData.length > 0 ? consolidated : histDataArr;

          if (dataForBenchmark.length > 0) {
            const incDate = dataForBenchmark[0].report_date;
            const latDate = dataForBenchmark[dataForBenchmark.length - 1].report_date;

            // Fetch benchmark data
            try {
              const benchmarkUrl = `/api/getIndices?indices=BSE500&startDate=${incDate}&endDate=${latDate}`;
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
  }, [selectedAccount, familyAccounts, createConsolidatedData]);

  // Get active historical data based on selected view
  const getActiveHistoricalData = useCallback((): HistoricalData[] => {
    if (dataView === 'orbis') return orbisHistoricalData;
    if (dataView === 'consolidated') return consolidatedHistoricalData;
    return historicalData; // nuvama
  }, [dataView, orbisHistoricalData, consolidatedHistoricalData, historicalData]);

  const activeHistoricalData = getActiveHistoricalData();

  // Compute monthly and quarterly PNL
  useEffect(() => {
    const dataToUse = getActiveHistoricalData();
    if (dataToUse.length === 0) {
      setMonthlyPnl({});
      setQuarterlyPnl({});
      return;
    }

    const sorted = [...dataToUse].sort((a, b) => new Date(a.report_date).getTime() - new Date(b.report_date).getTime());

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
          if (quarterly[prevYear]) {
            quarterly[prevYear].percent[qk as keyof typeof quarterly[string]["percent"]] = qPercent.toFixed(2);
            quarterly[prevYear].cash[qk as keyof typeof quarterly[string]["cash"]] = qCash.toFixed(2);
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
  }, [getActiveHistoricalData]);

  // Enrich data with normalization and benchmark
  useEffect(() => {
    const dataToUse = getActiveHistoricalData();
    if (dataToUse.length === 0) {
      setEnrichedData([]);
      setDataAnomalies([]);
      return;
    }

    // ============================================================================
    // NAV DATA VALIDATION & ANOMALY DETECTION
    // ============================================================================
    // Check for negative or zero NAVs which indicate data issues
    const anomalies: Array<{ date: string; issue: string; severity: 'error' | 'warning' }> = [];
    
    const invalidNavs = dataToUse.filter(item => {
      const nav = Number(item.nav);
      return nav <= 0 || !isFinite(nav);
    });

    if (invalidNavs.length > 0) {
      console.error('⚠️ [NAV ANOMALY DETECTED] Found invalid NAV values:');
      console.table(invalidNavs.map(item => ({
        Date: item.report_date,
        NAV: item.nav,
        'Portfolio Value': item.portfolio_value,
        'Cash In/Out': item.cash_in_out,
        'Data Source': dataView
      })));
      
      invalidNavs.forEach(item => {
        anomalies.push({
          date: item.report_date,
          issue: `Invalid NAV: ${item.nav} (should be positive)`,
          severity: 'error'
        });
      });
    }
      
    // Check for sudden drops (>50% change)
    const sortedData = [...dataToUse].sort((a, b) => 
      new Date(a.report_date).getTime() - new Date(b.report_date).getTime()
    );
    
    for (let i = 1; i < sortedData.length; i++) {
      const prevNav = Number(sortedData[i - 1].nav);
      const currNav = Number(sortedData[i].nav);
      
      if (prevNav > 0) {
        const change = ((currNav - prevNav) / prevNav) * 100;
        
        if (Math.abs(change) > 50) {
          console.error('🚨 [SUDDEN NAV DROP] Detected >50% change:');
          console.log('Previous:', {
            Date: sortedData[i - 1].report_date,
            NAV: prevNav,
            'Portfolio Value': sortedData[i - 1].portfolio_value
          });
          console.log('Current:', {
            Date: sortedData[i].report_date,
            NAV: currNav,
            'Portfolio Value': sortedData[i].portfolio_value
          });
          console.log('Change:', change.toFixed(2) + '%');
          
          anomalies.push({
            date: sortedData[i].report_date,
            issue: `Sudden NAV change of ${change.toFixed(2)}% (from ${prevNav.toFixed(2)} to ${currNav.toFixed(2)})`,
            severity: 'error'
          });
        } else if (Math.abs(change) > 20) {
          // Warning for >20% change
          anomalies.push({
            date: sortedData[i].report_date,
            issue: `Large NAV change of ${change.toFixed(2)}% (from ${prevNav.toFixed(2)} to ${currNav.toFixed(2)})`,
            severity: 'warning'
          });
        }
      }
    }
    
    setDataAnomalies(anomalies);

    const firstNav = Number(dataToUse[0].nav);
    if (firstNav <= 0) {
      setEnrichedData(dataToUse);
      return;
    }

    const sortedBench = benchmarkData.length > 0 ? [...benchmarkData].sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime()) : [];
    const incDate = dataToUse[0].report_date;
    const firstBenchItem = sortedBench.length > 0 ? findLatestBenchmarkBeforeOrOn(sortedBench, incDate) : null;
    const firstBench = firstBenchItem ? firstBenchItem.value : 0;

    let portPeak = firstNav;
    let benchPeak = firstBench > 0 ? 100 : 0; // normalized

    const enriched = dataToUse.map((item, index) => {
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
  }, [getActiveHistoricalData, benchmarkData]);

  // Calculate trailing returns when historicalData changes
  useEffect(() => {
    const dataToUse = getActiveHistoricalData();
    if (dataToUse.length > 0) {
      const mappedData = dataToUse.map(item => ({
        nav: Number(item.nav),
        date: item.report_date
      }));
      const incDate = dataToUse[0].report_date;
      const returns = calculateTrailingReturnsForData(mappedData, incDate);
      setTrailingReturns(returns);
    }
  }, [getActiveHistoricalData]);

  // Calculate trailing returns for benchmark
  useEffect(() => {
    const dataToUse = getActiveHistoricalData();
    if (benchmarkData.length > 0 && dataToUse.length > 0) {
      const mappedData = benchmarkData.map(item => ({
        nav: item.value,
        date: item.date
      }));
      const incDate = dataToUse[0].report_date;
      const returns = calculateTrailingReturnsForData(mappedData, incDate);
      setTrailingReturnsBenchmark(returns);
    }
  }, [benchmarkData, getActiveHistoricalData]);

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

  // Calculate metrics using active data
  // Get selected account details for Orbis metrics
  const selectedAccountDetails = familyAccounts.find(acc => acc.clientcode === selectedAccount);
  const isFamilyOrMemberView = selectedAccount === 'COMPLETE_FAMILY_PORTFOLIO' || selectedAccount.startsWith('OWNER_');
  const hasOrbisData = orbisData && orbisData.length > 0;
  const hasOrbisMetrics = selectedAccountDetails?.orbisMetrics && hasOrbisData && !isFamilyOrMemberView;

  // For Orbis-only or Consolidated views with Orbis data, use Orbis metrics
  // For Nuvama-only, use cash flow summation
  let totalInvested: number;
  let totalCapitalIn: number;
  let currentValue: number;

  if (hasOrbisMetrics && dataView === 'orbis') {
    // Use Orbis metrics for Orbis-only view (single account)
    totalInvested = selectedAccountDetails!.orbisMetrics!.latestCapitalAmount;
    totalCapitalIn = selectedAccountDetails!.orbisMetrics!.latestCapitalAmount;
    currentValue = selectedAccountDetails!.orbisMetrics!.latestMarketValue;
  } else if (hasOrbisMetrics && dataView === 'consolidated') {
    // For consolidated view (single account), use Nuvama's numbers but exclude Orbis profit
    // The transfer from Orbis to Nuvama included capital + profit, so subtract Orbis profit
    const orbisCapital = Number(selectedAccountDetails!.orbisMetrics!.latestCapitalAmount) || 0;
    const orbisMarketValue = Number(selectedAccountDetails!.orbisMetrics!.latestMarketValue) || 0;
    const orbisProfit = orbisMarketValue - orbisCapital;

    const nuvamaInvested = historicalData.reduce((sum, item) => sum + (Number(item.cash_in_out) || 0), 0);
    const nuvamaCapitalIn = historicalData.reduce((sum, item) => {
      const cashFlow = Number(item.cash_in_out) || 0;
      return sum + (cashFlow > 0 ? cashFlow : 0);
    }, 0);
    const rawNuvamaCurrentValue = Number(currentData?.portfolio_value) || 0;
    const nuvamaCurrentValue = isFinite(rawNuvamaCurrentValue) && rawNuvamaCurrentValue < 1e15 ? rawNuvamaCurrentValue : 0;

    // Subtract Orbis profit from Nuvama's invested amounts since the Orbis transfer
    // included profit that isn't new capital
    totalInvested = nuvamaInvested - orbisProfit;
    totalCapitalIn = nuvamaCapitalIn - orbisProfit;
    currentValue = nuvamaCurrentValue;
  } else if (hasOrbisData && dataView === 'orbis' && isFamilyOrMemberView) {
    // For family/member Orbis-only view, calculate from orbisHistoricalData
    totalInvested = orbisHistoricalData.reduce((sum, item) => sum + (Number(item.cash_in_out) || 0), 0);
    totalCapitalIn = orbisHistoricalData.reduce((sum, item) => {
      const cashFlow = Number(item.cash_in_out) || 0;
      return sum + (cashFlow > 0 ? cashFlow : 0);
    }, 0);
    const rawOrbisValue = orbisHistoricalData.length > 0
      ? Number(orbisHistoricalData[orbisHistoricalData.length - 1].portfolio_value) || 0
      : 0;
    currentValue = isFinite(rawOrbisValue) && rawOrbisValue < 1e15 ? rawOrbisValue : 0;
  } else if (hasOrbisData && dataView === 'consolidated' && isFamilyOrMemberView) {
    // For family/member consolidated view, use Nuvama numbers but exclude Orbis profit
    const orbisInvested = orbisHistoricalData.reduce((sum, item) => sum + (Number(item.cash_in_out) || 0), 0);
    const rawOrbisEndValue = orbisHistoricalData.length > 0
      ? Number(orbisHistoricalData[orbisHistoricalData.length - 1].portfolio_value) || 0
      : 0;
    const orbisProfit = rawOrbisEndValue - orbisInvested;

    const nuvamaInvested = historicalData.reduce((sum, item) => sum + (Number(item.cash_in_out) || 0), 0);
    const nuvamaCapitalIn = historicalData.reduce((sum, item) => {
      const cashFlow = Number(item.cash_in_out) || 0;
      return sum + (cashFlow > 0 ? cashFlow : 0);
    }, 0);
    const rawNuvamaValue = Number(currentData?.portfolio_value) || 0;
    const nuvamaCurrentValue = isFinite(rawNuvamaValue) && rawNuvamaValue < 1e15 ? rawNuvamaValue : 0;

    // Subtract Orbis profit since it was transferred to Nuvama but isn't new capital
    totalInvested = nuvamaInvested - orbisProfit;
    totalCapitalIn = nuvamaCapitalIn - orbisProfit;
    currentValue = nuvamaCurrentValue;
  } else {
    // Default calculation for Nuvama data (or consolidated without Orbis metrics)
    totalInvested = activeHistoricalData.reduce((sum, item) => sum + (Number(item.cash_in_out) || 0), 0);
    // Sum of only capital inflows (positive cash flows)
    totalCapitalIn = activeHistoricalData.reduce((sum, item) => {
      const cashFlow = Number(item.cash_in_out) || 0;
      return sum + (cashFlow > 0 ? cashFlow : 0);
    }, 0);

    if (dataView === 'consolidated' && hasOrbisData) {
      // For consolidated view without Orbis metrics, calculate properly
      // Get Orbis current value from last orbis record
      const orbisCurrentValue = orbisHistoricalData.length > 0
        ? Number(orbisHistoricalData[orbisHistoricalData.length - 1].portfolio_value) || 0
        : 0;
      // Get Nuvama current value
      const nuvamaCurrentValue = Number(currentData?.portfolio_value) || 0;

      // Validate numbers before combining
      const validOrbisValue = isFinite(orbisCurrentValue) && orbisCurrentValue < 1e15 ? orbisCurrentValue : 0;
      const validNuvamaValue = isFinite(nuvamaCurrentValue) && nuvamaCurrentValue < 1e15 ? nuvamaCurrentValue : 0;

      // Combine both
      currentValue = validOrbisValue + validNuvamaValue;
    } else if (dataView === 'nuvama') {
      currentValue = currentData?.portfolio_value || 0;
    } else if (dataView === 'orbis') {
      const rawValue = activeHistoricalData.length > 0
        ? Number(activeHistoricalData[activeHistoricalData.length - 1].portfolio_value) || 0
        : 0;
      currentValue = isFinite(rawValue) && rawValue < 1e15 ? rawValue : 0;
    } else {
      // Fallback
      const rawValue = Number(currentData?.portfolio_value) || 0;
      currentValue = isFinite(rawValue) && rawValue < 1e15 ? rawValue : 0;
    }
  }

  const totalReturns = currentValue - totalInvested;

  // Calculate returns percentage using NAV-based approach (proper CAGR/absolute)
  let returnsPercent: number = 0;
  if (activeHistoricalData.length >= 2) {
    const sortedData = [...activeHistoricalData].sort(
      (a, b) => new Date(a.report_date).getTime() - new Date(b.report_date).getTime()
    );
    const firstNavRecord = sortedData.find(r => Number(r.nav) > 0);
    const latestNavRecord = [...sortedData].reverse().find(r => Number(r.nav) > 0);

    if (firstNavRecord && latestNavRecord) {
      const firstNav = Number(firstNavRecord.nav);
      const latestNav = Number(latestNavRecord.nav);
      const firstDate = new Date(firstNavRecord.report_date);
      const latestDate = new Date(latestNavRecord.report_date);
      const daysDiff = (latestDate.getTime() - firstDate.getTime()) / (1000 * 60 * 60 * 24);
      const years = daysDiff / 365.25;

      if (years >= 1 && firstNav > 0 && latestNav > 0) {
        // CAGR for >= 1 year
        const cagr = (Math.pow(latestNav / firstNav, 1 / years) - 1) * 100;
        returnsPercent = isFinite(cagr) ? cagr : 0;
      } else if (firstNav > 0 && latestNav > 0) {
        // Absolute return for < 1 year
        const absReturn = ((latestNav / firstNav) - 1) * 100;
        returnsPercent = isFinite(absReturn) ? absReturn : 0;
      }
    }
  } else if (totalInvested !== 0 && isFinite(totalInvested) && isFinite(totalReturns)) {
    // Fallback to simple calculation if NAV data is insufficient
    const simpleReturn = (totalReturns / totalInvested) * 100;
    returnsPercent = isFinite(simpleReturn) ? simpleReturn : 0;
  }

  // Determine if return is positive based on the calculated percentage
  const isPositiveReturnOverall = returnsPercent >= 0;

  // Portfolio DD metrics
  const portfolioCurrentDD = enrichedData.length > 0 ? enrichedData[enrichedData.length - 1].drawdown_percent : 0;
  const portfolioMaxDD = enrichedData.length > 0 ? Math.max(...enrichedData.map(item => item.drawdown_percent || 0)) : 0;

  // Benchmark DD metrics
  const benchmarkCurrentDD = enrichedData.length > 0 ? enrichedData[enrichedData.length - 1].benchmark_drawdown_percent || 0 : 0;
  const benchmarkMaxDD = enrichedData.length > 0 ? Math.max(...enrichedData.map(item => item.benchmark_drawdown_percent || 0)) : 0;

  // Extract strategy (selectedAccountDetails already declared above)
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

  // Get inception and latest date using active data
  const inceptionDate = activeHistoricalData.length > 0 ? activeHistoricalData[0].report_date : null;
  const latestDate = activeHistoricalData.length > 0 ? activeHistoricalData[activeHistoricalData.length - 1].report_date : null;

  const periods = [
    { key: '1W', label: '1W' },
    { key: '10D', label: '10D' },
    { key: '1M', label: '1M' },
    { key: '3M', label: '3M' },
    { key: '6M', label: '6M' },
    { key: '1Y', label: '1Y' },
    { key: '3Y', label: '3Y' },
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
          <div className="flex flex-col gap-4">
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
              <div className="flex flex-col sm:flex-row gap-2 w-full md:w-auto">
                <Select value={selectedAccount} onValueChange={setSelectedAccount}>
                  <SelectTrigger className="w-full md:w-80">
                    <SelectValue placeholder="Select Account" />
                  </SelectTrigger>
                  <SelectContent>
                    {/* Family-level consolidation - Show if there are multiple owners in the family */}
                    {groupedOwners.length > 1 && (
                      <>
                        <SelectItem value="COMPLETE_FAMILY_PORTFOLIO">
                          <div className="flex items-center justify-between gap-3">
                            <span className="font-semibold">Complete Family Portfolio</span>
                            <span className="text-xs text-muted-foreground">(All Members, All Strategies)</span>
                          </div>
                        </SelectItem>
                        <div className="h-px bg-border my-1" />
                      </>
                    )}

                    {/* Per-owner consolidation for owners with multiple accounts/strategies */}
                    {groupedOwners.map(owner => {
                      if (owner.clientcodes.length > 1) {
                        return (
                          <SelectItem key={`OWNER_${owner.ownerid}`} value={`OWNER_${owner.ownerid}`}>
                            <div className="flex items-center justify-between gap-3">
                              <span className="font-medium">{sanitizeName(owner.ownerName)}</span>
                              <span className="text-xs text-muted-foreground">(All Strategies)</span>
                            </div>
                          </SelectItem>
                        );
                      }
                      return null;
                    })}
                    {groupedOwners.some(o => o.clientcodes.length > 1) && (
                      <div className="h-px bg-border my-1" />
                    )}

                    {/* Individual accounts */}
                    {familyAccounts.map(acc => {
                      const strategyCode = acc.clientcode.substring(0, 3).toUpperCase();
                      const strategyName = strategyNames[strategyCode as keyof typeof strategyNames] || strategyCode;
                      const hasOrbis = acc.orbisData && acc.orbisData.length > 0;

                      return (
                        <SelectItem key={acc.clientcode} value={acc.clientcode}>
                          <div className="flex items-center justify-between gap-3">
                            <span>{sanitizeName(acc.holderName)}</span>
                            <div className="flex items-center gap-1.5">
                              <span className="text-xs text-muted-foreground">{strategyName}</span>
                              {hasOrbis && (
                                <Badge variant="outline" className="text-[9px] px-1 py-0 h-4">
                                  Orbis+Nuvama
                                </Badge>
                              )}
                            </div>
                          </div>
                        </SelectItem>
                      );
                    })}
                  </SelectContent>
                </Select>
                {/* {enrichedData.length > 0 && (
                  <Button
                    onClick={() => {
                      const isAllStrategies = selectedAccount === 'COMPLETE_FAMILY_PORTFOLIO' || selectedAccount.startsWith('OWNER_');
                      if (isAllStrategies) {
                        let accountCodes: string[] = [];
                        let portfolioName = '';
                        
                        if (selectedAccount === 'COMPLETE_FAMILY_PORTFOLIO') {
                          accountCodes = familyAccounts
                            .filter(acc => acc.status === "Active")
                            .map(acc => acc.clientcode);
                          portfolioName = 'Complete Family Portfolio (Active Accounts Only)';
                        } else if (selectedAccount.startsWith('OWNER_')) {
                          const ownerKey = selectedAccount.replace('OWNER_', '');
                          const owner = groupedOwners.find(o => o.ownerid === ownerKey);
                          if (owner) {
                            accountCodes = owner.accounts
                              .filter(acc => acc.status === "Active")
                              .map(acc => acc.clientcode);
                            portfolioName = `${owner.ownerName} - All Strategies (Active Accounts Only)`;
                          }
                        }
                        
                        downloadAllStrategiesCSV(
                          enrichedData,
                          trailingReturns,
                          trailingReturnsBenchmark,
                          monthlyPnl,
                          quarterlyPnl,
                          accountCodes,
                          portfolioName,
                          familyAccounts
                        );
                      } else {
                        downloadConsolidatedCSV(
                          enrichedData,
                          trailingReturns,
                          trailingReturnsBenchmark,
                          monthlyPnl,
                          quarterlyPnl,
                          selectedAccount,
                          selectedAccountDetails?.holderName || 'Unknown',
                          dataView
                        );
                      }
                    }}
                    variant="outline"
                    size="default"
                    className="gap-2 whitespace-nowrap"
                  >
                    <Download className="h-4 w-4" />
                    <span className="hidden sm:inline">
                      {selectedAccount === 'COMPLETE_FAMILY_PORTFOLIO' || selectedAccount.startsWith('OWNER_')
                        ? 'Download All Strategies CSV'
                        : 'Download CSV'}
                    </span>
                    <span className="sm:hidden">CSV</span>
                  </Button>
                )}  */}
              </div>
            </div>

            {/* Closed Accounts Info - Show if viewing All Strategies with closed accounts */}
            {(selectedAccount === 'COMPLETE_FAMILY_PORTFOLIO' || selectedAccount.startsWith('OWNER_')) &&
             familyAccounts.some(acc => acc.status !== "Active") && (
              <Alert className="border-blue-500 bg-blue-50 dark:bg-blue-950">
                <AlertTriangle className="h-4 w-4 text-blue-600" />
                <AlertTitle>Closed Accounts Excluded</AlertTitle>
                <AlertDescription>
                  <div className="mt-2 space-y-2">
                    <p className="text-sm">
                      The following closed/inactive accounts are excluded from the combined NAV calculation:
                    </p>
                    <div className="flex flex-wrap gap-2">
                      {familyAccounts
                        .filter(acc => acc.status !== "Active")
                        .map(acc => (
                          <Badge key={acc.clientcode} variant="outline" className="text-xs">
                            {acc.clientcode} ({acc.holderName}) - {acc.status}
                          </Badge>
                        ))}
                    </div>
                    <p className="text-xs mt-2 text-muted-foreground">
                      ℹ️ Closed accounts only contribute to NAV during the period they were active.
                    </p>
                  </div>
                </AlertDescription>
              </Alert>
            )}

            {/* Data Quality Alert - Show if anomalies detected */}
            {dataAnomalies.length > 0 && (
              <Alert variant="destructive" className="border-orange-500 bg-orange-50 dark:bg-orange-950">
                <AlertTriangle className="h-4 w-4" />
                <AlertTitle>Data Quality Issues Detected</AlertTitle>
                <AlertDescription>
                  <div className="mt-2 space-y-2">
                    <p className="text-sm">
                      Found {dataAnomalies.filter(a => a.severity === 'error').length} critical issue(s) and{' '}
                      {dataAnomalies.filter(a => a.severity === 'warning').length} warning(s) in NAV data.
                    </p>
                    <div className="max-h-40 overflow-y-auto space-y-1">
                      {dataAnomalies.slice(0, 5).map((anomaly, idx) => (
                        <div key={idx} className="text-xs bg-white dark:bg-gray-900 p-2 rounded border border-orange-200">
                          <span className="font-semibold">{anomaly.date}:</span> {anomaly.issue}
                        </div>
                      ))}
                      {dataAnomalies.length > 5 && (
                        <p className="text-xs italic">
                          ...and {dataAnomalies.length - 5} more issue(s). Download CSV for full report.
                        </p>
                      )}
                    </div>
                    <p className="text-xs mt-2 font-semibold">
                      ⚠️ Recommendation: Review source data for these dates. Check backend API or database for data integrity issues.
                    </p>
                  </div>
                </AlertDescription>
              </Alert>
            )}

            {/* Data View Selector - Only show if Orbis data exists */}
            {orbisData && orbisData.length > 0 && (
              <Card>
                <CardContent className="pt-6">
                  <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
                    <div>
                      <h3 className="text-sm font-semibold text-foreground">Data Source View</h3>
                      <p className="text-xs text-muted-foreground mt-1">
                        View performance data from different sources individually or combined
                      </p>
                    </div>
                    <div className="flex gap-2">
                      <Button
                        onClick={() => setDataView('nuvama')}
                        size="sm"
                        variant={dataView === 'nuvama' ? 'gradient' : 'outline'}
                        className="text-xs"
                      >
                        Nuvama
                      </Button>
                      <Button
                        onClick={() => setDataView('orbis')}
                        size="sm"
                        variant={dataView === 'orbis' ? 'gradient' : 'outline'}
                        className="text-xs"
                      >
                        Orbis (Legacy)
                      </Button>
                      <Button
                        onClick={() => setDataView('consolidated')}
                        size="sm"
                        variant={dataView === 'consolidated' ? 'gradient' : 'outline'}
                        className="text-xs"
                      >
                        Orbis + Nuvama (Combined)
                      </Button>
                    </div>
                  </div>
                </CardContent>
              </Card>
            )}
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
                <p className="text-xs text-muted-foreground mt-1">
                  Gross: {formatCurrency(totalCapitalIn)}
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
                  {hasOrbisMetrics && dataView === 'orbis'
                    ? selectedAccountDetails?.orbisMetrics?.latestDate && `As of ${new Date(selectedAccountDetails.orbisMetrics.latestDate).toLocaleDateString('en-IN')}`
                    : currentData?.report_date && `As of ${new Date(currentData.report_date).toLocaleDateString('en-IN')}`}
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
                  {isPositiveReturnOverall ? '+' : ''}{returnsPercent.toFixed(2)}%
                </div>
                <div className="flex items-center gap-1 mt-1">
                  {isPositiveReturnOverall ? (
                    <TrendingUp className="h-3 w-3 text-green-500" />
                  ) : (
                    <TrendingDown className="h-3 w-3 text-red-500" />
                  )}
                  <p className="text-xs text-muted-foreground">
                    {(() => {
                      if (activeHistoricalData.length >= 2) {
                        const sortedData = [...activeHistoricalData].sort(
                          (a, b) => new Date(a.report_date).getTime() - new Date(b.report_date).getTime()
                        );
                        const firstNavRecord = sortedData.find(r => Number(r.nav) > 0);
                        const latestNavRecord = [...sortedData].reverse().find(r => Number(r.nav) > 0);
                        if (!firstNavRecord || !latestNavRecord) return 'Absolute returns';
                        const firstDate = new Date(firstNavRecord.report_date);
                        const latestDate = new Date(latestNavRecord.report_date);
                        const years = (latestDate.getTime() - firstDate.getTime()) / (1000 * 60 * 60 * 24 * 365.25);
                        return years < 1 ? 'Absolute returns' : 'CAGR';
                      }
                      return 'Absolute returns';
                    })()}
                  </p>
                </div>
              </CardContent>
            </Card>
          </div>

          {activeHistoricalData.length > 0 && trailingReturns && (
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
                          
                          // Check if both portfolio and benchmark values are available
                          let portfolioValue;
                          let benchmarkValue;
                          
                          if (period.key === 'Current DD') {
                            portfolioValue = portfolioCurrentDD;
                            benchmarkValue = benchmarkCurrentDD;
                          } else if (period.key === 'Max DD') {
                            portfolioValue = portfolioMaxDD;
                            benchmarkValue = benchmarkMaxDD;
                          } else {
                            portfolioValue = trailingReturns?.[period.key];
                            benchmarkValue = trailingReturnsBenchmark?.[period.key];
                          }
                          
                          // Only show if both values are available (not '-' and not undefined)
                          const portfolioAvailable = portfolioValue !== undefined && portfolioValue !== '-' && portfolioValue !== null;
                          const benchmarkAvailable = benchmarkValue !== undefined && benchmarkValue !== '-' && benchmarkValue !== null;
                          const shouldShow = portfolioAvailable && benchmarkAvailable;
                          
                          if (!shouldShow) {
                            return (
                              <td
                                key={period.key}
                                className={`px-4 py-3 text-center whitespace-nowrap ${period.key === "Current DD" ? "border-l border-border" : ""}`}
                              >
                                <span className="text-muted-foreground">-</span>
                              </td>
                            );
                          }
                          
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
                            
                            // Check if both portfolio and benchmark values are available
                            let portfolioValue;
                            let benchmarkValue;
                            
                            if (period.key === 'Current DD') {
                              portfolioValue = portfolioCurrentDD;
                              benchmarkValue = benchmarkCurrentDD;
                            } else if (period.key === 'Max DD') {
                              portfolioValue = portfolioMaxDD;
                              benchmarkValue = benchmarkMaxDD;
                            } else {
                              portfolioValue = trailingReturns?.[period.key];
                              benchmarkValue = trailingReturnsBenchmark?.[period.key];
                            }
                            
                            // Only show if both values are available
                            const portfolioAvailable = portfolioValue !== undefined && portfolioValue !== '-' && portfolioValue !== null;
                            const benchmarkAvailable = benchmarkValue !== undefined && benchmarkValue !== '-' && benchmarkValue !== null;
                            const shouldShow = portfolioAvailable && benchmarkAvailable;
                            
                            if (!shouldShow) {
                              return (
                                <td
                                  key={period.key}
                                  className={`px-4 py-3 text-center whitespace-nowrap ${period.key === "Current DD" ? "border-l border-border" : ""}`}
                                >
                                  <span className="text-muted-foreground">-</span>
                                </td>
                              );
                            }
                            
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
                      <p><strong>Returns:</strong> All returns are calculated using NAV-based methodology. Periods under 1 year show absolute returns, while those over 1 year use CAGR.</p>
                      {hasOrbisMetrics && (dataView === 'orbis' || dataView === 'consolidated') && (
                        <p className="mt-2"><strong>Orbis Data:</strong> Amount invested and current value shown are latest non-zero capital amount and market value from Orbis records.</p>
                      )}
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>
          )}

          {activeHistoricalData.length > 0 ? (
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
                        {activeHistoricalData
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