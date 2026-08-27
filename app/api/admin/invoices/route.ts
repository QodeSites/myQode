import { NextRequest, NextResponse } from "next/server";
import { requireRole, isRoleUser } from "@/lib/adminAuth";
import { query } from "@/lib/db";

/**
 * Issued distributor invoices, read-only.
 *
 * Finance reviews invoices here; the distributor flow issues them. This route
 * deliberately has no POST, PATCH or DELETE — the issuing path lives in
 * app/api/distributor/invoice-issue and is not part of this surface.
 *
 * The table is distributor_invoice_issued, the same one the distributor flow
 * writes. It held 0 rows as of 2026-08-27, so an empty response is the normal
 * early state, not a fault.
 */
export async function GET(request: NextRequest) {
  const admin = await requireRole(request, "invoices");
  if (!isRoleUser(admin)) return admin;

  try {
    const { searchParams } = new URL(request.url);
    const distributor = searchParams.get("distributor")?.trim();
    const from = searchParams.get("from")?.trim();
    const to = searchParams.get("to")?.trim();

    const where: string[] = [];
    const params: any[] = [];

    if (distributor) {
      params.push(distributor.toLowerCase());
      where.push(`lower(distributor_email) = $${params.length}`);
    }
    if (from) {
      params.push(from);
      where.push(`invoice_date >= $${params.length}`);
    }
    if (to) {
      params.push(to);
      where.push(`invoice_date <= $${params.length}`);
    }

    const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";

    const rowsRes = await query(
      `SELECT id, distributor_email, invoice_number, invoice_date,
              period_label, period_start, period_end,
              amount_before_tax, tax_amount, total_amount, created_at
         FROM distributor_invoice_issued
         ${whereSql}
        ORDER BY invoice_date DESC NULLS LAST, id DESC
        LIMIT 500`,
      params,
    );

    // The full distributor list, unfiltered, so the filter dropdown does not
    // shrink to only what the current filter already matched.
    const distinctRes = await query(
      `SELECT DISTINCT lower(distributor_email) AS email
         FROM distributor_invoice_issued
        WHERE distributor_email IS NOT NULL
        ORDER BY email`,
    );

    const invoices = (rowsRes.rows ?? []).map((r: any) => ({
      id: Number(r.id),
      distributorEmail: String(r.distributor_email ?? ""),
      invoiceNumber: String(r.invoice_number ?? ""),
      invoiceDate: r.invoice_date ? String(r.invoice_date) : null,
      periodLabel: r.period_label ?? null,
      periodStart: r.period_start ? String(r.period_start) : null,
      periodEnd: r.period_end ? String(r.period_end) : null,
      amountBeforeTax: Number(r.amount_before_tax ?? 0),
      taxAmount: Number(r.tax_amount ?? 0),
      totalAmount: Number(r.total_amount ?? 0),
      createdAt: r.created_at ? String(r.created_at) : null,
    }));

    const totals = invoices.reduce(
      (acc, i) => ({
        count: acc.count + 1,
        beforeTax: acc.beforeTax + i.amountBeforeTax,
        tax: acc.tax + i.taxAmount,
        total: acc.total + i.totalAmount,
      }),
      { count: 0, beforeTax: 0, tax: 0, total: 0 },
    );

    return NextResponse.json({
      invoices,
      totals,
      distributors: (distinctRes.rows ?? []).map((r: any) => String(r.email)),
    });
  } catch (error) {
    console.error("[admin/invoices] error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
