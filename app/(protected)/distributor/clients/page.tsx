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

type ClientRow = {
  id: number;
  name: string;
  accountcode: string;
  scheme: string | null;
  latestAum: string;
  investedAmount: string;
  sinceInception: string | null;
};

export default function DistributorClientsPage() {
  const [rows, setRows] = React.useState<ClientRow[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    const fetchClients = async () => {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch("/api/distributor/clients", {
          method: "GET",
          headers: { Accept: "application/json" },
        });
        if (!res.ok) {
          throw new Error(`Failed to load clients (${res.status})`);
        }
        const data = (await res.json()) as ClientRow[];
        setRows(data);
      } catch (e: any) {
        setError(e.message || "Failed to load clients");
        setRows([]);
      }
      setLoading(false);
    };

    fetchClients();
  }, []);

  const totals = React.useMemo(() => {
    const parse = (s: string) => parseFloat(s.replace(/,/g, "")) || 0;
    const totalAum = rows.reduce((sum, r) => sum + parse(r.latestAum), 0);
    const totalInvested = rows.reduce((sum, r) => sum + parse(r.investedAmount), 0);
    const format = (n: number) =>
      n.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    return {
      totalAum: format(totalAum),
      totalInvested: format(totalInvested),
      totalClients: rows.length,
    };
  }, [rows]);

  return (
    <div className="flex flex-col gap-3 w-full mx-auto">
      <div className="flex items-center justify-between mb-1">
        <h2 className="text-lg font-semibold text-green-900">
          Distributor Clients
        </h2>
      </div>

      {rows.length > 0 && (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div className="rounded-xl border bg-white shadow-sm px-4 py-3">
            <div className="text-xs font-medium text-gray-600 uppercase tracking-wide">
              Total AUM
            </div>
            <div className="mt-1 text-2xl font-semibold text-green-900">
              ₹ {totals.totalAum}
            </div>
          </div>
          <div className="rounded-xl border bg-white shadow-sm px-4 py-3">
            <div className="text-xs font-medium text-gray-600 uppercase tracking-wide">
              Total Invested
            </div>
            <div className="mt-1 text-2xl font-semibold text-green-900">
              ₹ {totals.totalInvested}
            </div>
          </div>
          <div className="rounded-xl border bg-white shadow-sm px-4 py-3">
            <div className="text-xs font-medium text-gray-600 uppercase tracking-wide">
              Total Clients
            </div>
            <div className="mt-1 text-2xl font-semibold text-green-900">
              {totals.totalClients}
            </div>
          </div>
        </div>
      )}

      {error && (
        <div className="text-red-700 font-medium bg-red-50 border border-red-200 px-3 py-2 rounded">
          {error}
        </div>
      )}

      {loading && (
        <div className="text-green-900 px-3 py-2">Loading clients...</div>
      )}

      {!loading && rows.length === 0 && !error && (
        <div className="p-8 text-center text-lg text-green-900 font-semibold border rounded bg-white shadow-sm">
          No clients found.
        </div>
      )}

      {rows.length > 0 && (
        <div className="mb-1 rounded-lg border shadow-sm bg-white overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow className="bg-green-900 hover:bg-green-900">
                <TableHead className="text-white text-xs font-medium px-4 py-3 text-center">
                  #
                </TableHead>
                <TableHead className="text-white text-xs font-medium px-4 py-3 text-center">
                  Name
                </TableHead>
                <TableHead className="text-white text-xs font-medium px-4 py-3 text-center">
                  Account Code
                </TableHead>
                <TableHead className="text-white text-xs font-medium px-4 py-3 text-center">
                  Since Inception
                </TableHead>
                <TableHead className="text-white text-xs font-medium px-4 py-3 text-center">
                  Scheme
                </TableHead>
                <TableHead className="text-white text-xs font-medium px-4 py-3 text-right">
                  Latest AUM
                </TableHead>
                <TableHead className="text-white text-xs font-medium px-4 py-3 text-right">
                  Invested Amount
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row) => (
                <TableRow
                  key={row.id}
                  className="odd:bg-white even:bg-gray-50"
                >
                  <TableCell className="px-4 py-3 text-sm text-green-900 text-center">
                    {row.id}
                  </TableCell>
                  <TableCell className="px-4 py-3 text-sm text-green-900 font-medium text-center">
                    {row.name}
                  </TableCell>
                  <TableCell className="px-4 py-3 text-sm text-green-900 text-center">
                    {row.accountcode}
                  </TableCell>
                  <TableCell className="px-4 py-3 text-sm text-green-900 text-center">
                    {row.sinceInception ?? "—"}
                  </TableCell>
                  <TableCell className="px-4 py-3 text-sm text-green-900 text-center">
                    {row.scheme ?? "—"}
                  </TableCell>
                  <TableCell className="px-4 py-3 text-sm text-right text-green-900">
                    {row.latestAum}
                  </TableCell>
                  <TableCell className="px-4 py-3 text-sm text-right text-green-900">
                    {row.investedAmount}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}

