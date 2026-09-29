// Has a received payment reached the portfolio yet? Nuvama's data (pms_master_sheet.cash_in_out on that account,
// within ±5% of the amount, on or after the day it counted as received) is the proof — the same rule the
// investment-status tracker uses, checked directly so the app never depends on that tracker running.
import { query } from '@/lib/db'

// Money split across strategies lands on several accounts, so the person's own total (the owner row the sheet also
// keeps, account_code = ownerid without ".0") is checked too.
export async function inPortfolio(accountId: string, amount: number, fromDay: string): Promise<boolean> {
  const r = await query(
    `SELECT 1 FROM pms_master_sheet
      WHERE account_code IN (SELECT $1::text UNION SELECT regexp_replace(ownerid, '\\.0$', '') FROM pms_clients_master WHERE clientcode = $1 AND ownerid IS NOT NULL)
        AND cash_in_out BETWEEN $2 AND $3 AND report_date >= $4::date LIMIT 1`,
    [accountId, amount * 0.95, amount * 1.05, fromDay])
  return r.rows.length > 0
}
