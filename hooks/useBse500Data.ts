"use client";

import { useEffect, useState } from "react";

interface Bse500DataPoint {
  date: string;
  nav: string;
}

interface EquityCurvePoint {
  date: string;
  value: number;
}

interface UseBse500DataResult {
  bse500Data: Bse500DataPoint[];
  error: string | null;
}

export function useBse500Data(equityCurve: EquityCurvePoint[]): UseBse500DataResult {
  const [bse500Data, setBse500Data] = useState<Bse500DataPoint[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchBse500Data = async () => {
      if (!equityCurve?.length) {
        setError("No portfolio data available to define date range.");
        return;
      }

      try {
        const startDate = equityCurve[0].date;
        const endDate = equityCurve[equityCurve.length - 1].date;
        const portfolioStartTime = new Date(startDate).getTime();

        // Extend the start date backwards by 30 days to get potential backfill data
        const extendedStartDate = new Date(portfolioStartTime - (30 * 24 * 60 * 60 * 1000))
          .toISOString().split('T')[0];

        const queryParams = new URLSearchParams({
          indices: "NIFTY 50",
          start_date: extendedStartDate,
          end_date: endDate,
        });

        const response = await fetch(
          `https://research.qodeinvest.com/api/getIndices?${queryParams.toString()}`
        );
        if (!response.ok) {
          throw new Error("Failed to fetch BSE500 data");
        }
        const result = await response.json();

        let processedData: Bse500DataPoint[] = [];
        if (result.data && Array.isArray(result.data)) {
          processedData = result.data;
        } else if (result["BSE500"] && Array.isArray(result["BSE500"])) {
          processedData = result["BSE500"];
        } else if (Array.isArray(result)) {
          processedData = result;
        }

        // Sort data by date to ensure chronological order
        processedData.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

        // Find benchmark data that falls within the portfolio date range
        const benchmarkInRange = processedData.filter(
          (d) =>
            new Date(d.date).getTime() >= portfolioStartTime &&
            new Date(d.date).getTime() <= new Date(endDate).getTime()
        );

        // Check if we have benchmark data for the portfolio start date
        const hasDataForStartDate = benchmarkInRange.some(
          (d) => new Date(d.date).getTime() === portfolioStartTime
        );

        let finalBenchmarkData = [...benchmarkInRange];

        // If no benchmark data exists for portfolio start date, backfill with most recent data
        if (!hasDataForStartDate && benchmarkInRange.length > 0) {
          // Find the most recent benchmark data point before portfolio start date
          const priorData = processedData.filter(
            (d) => new Date(d.date).getTime() < portfolioStartTime
          );

          if (priorData.length > 0) {
            // Get the most recent data point before portfolio start
            const mostRecentPriorData = priorData[priorData.length - 1];
            
            // Create a backfilled data point for portfolio start date
            const backfilledDataPoint: Bse500DataPoint = {
              date: startDate,
              nav: mostRecentPriorData.nav
            };

            // Add the backfilled point at the beginning
            finalBenchmarkData = [backfilledDataPoint, ...benchmarkInRange];
            
            console.log(`Backfilled benchmark data for ${startDate} with NAV ${mostRecentPriorData.nav} from ${mostRecentPriorData.date}`);
          }
        }

        setBse500Data(finalBenchmarkData);
      } catch (err) {
        console.error("Error fetching BSE500 data:", err);
        setError(err instanceof Error ? err.message : "An unexpected error occurred");
      }
    };

    fetchBse500Data();
  }, [equityCurve]);

  return { bse500Data, error };
}