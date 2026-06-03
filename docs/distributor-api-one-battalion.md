# Distributor API — One Battalion Ventures Private Limited

A read-only, server-to-server JSON API that lets **One Battalion Ventures
Private Limited** (`advisory@onebattalion.in`) build their own dashboard over
their investor book — the same investors / family grouping / portfolio /
capital-flow data shown on the myQode portfolio "snapshot" tab, scoped to
**only their own** clients.

The API is hard-scoped to this one distributor: every query is filtered by
`pms_clients_master.intermediaryname = 'One Battalion Ventures Private Limited'`,
so it can never return another distributor's data.

## Authentication

Every request must present the API key, either way:

```
Authorization: Bearer <API_KEY>
```
or
```
x-api-key: <API_KEY>
```

- The key is stored server-side in the `ONE_BATTALION_API_KEY` env var.
- It is a long-lived secret — use it **only from One Battalion's backend**,
  never from a browser (it would be exposed to end users).
- To rotate: change `ONE_BATTALION_API_KEY` and re-issue. To revoke: unset it.

Missing key → `401 NO_API_KEY`. Wrong key → `401 INVALID_API_KEY`.

## Base URL

```
https://<your-myqode-host>/api/distributor-api/v1
```

Local dev: `http://localhost:2069/api/distributor-api/v1`

All responses are JSON. Monetary values are plain numbers (rupees). Dates are
IST calendar dates (`YYYY-MM-DD`).

---

## 1. Investors (with family grouping / mapping)

```
GET /investors
```

Full book as a **family → owner → account** tree, plus latest AUM and total
invested amount per account.

```json
{
  "distributor": "One Battalion Ventures Private Limited",
  "summary": { "total_accounts": 2, "total_families": 1, "total_owners": 1, "total_aum": 28434039.39 },
  "families": [
    {
      "group_id": "14410400",
      "group_name": "SHARAN B HEGDE FAMILY",
      "total_aum": 28434039.39,
      "owners": [
        {
          "owner_id": "55136",
          "owner_name": "Sharan B Hegde",
          "is_head_of_family": false,
          "total_aum": 28434039.39,
          "accounts": [
            {
              "client_id": "14410400",
              "account_code": "QAW00098",
              "client_name": "Sharan B Hegde",
              "email": "sharanhegde1595@gmail.com",
              "scheme": "Qode Advisors Llp - Qode All Weather",
              "account_type": "Discretionary",
              "head_of_family": false,
              "inception_date": "2025-12-03",
              "latest_aum": 15464913.75,
              "invested_amount": 14499665.33,
              "as_of": "2026-06-02"
            }
          ]
        }
      ]
    }
  ]
}
```

---

## 2. Portfolio (per-account metrics)

```
GET /portfolio
GET /portfolio?account_code=QAW00098
GET /portfolio?account_code=QAW00098,QGF00090
```

Latest portfolio snapshot + performance metrics per account. The optional
`account_code` filter (repeatable or comma-separated) only narrows the result —
codes not owned by the distributor are ignored.

```json
{
  "distributor": "One Battalion Ventures Private Limited",
  "accounts": [
    {
      "account_code": "QAW00098",
      "client_name": "SHARAN B HEGDE",
      "scheme": "Qode Advisors Llp - Qode All Weather",
      "report_date": "2026-06-02",
      "portfolio_value": 15464913.75,
      "invested_amount": 14499665.33,
      "nav": 12.2489,
      "pnl": 191827.73,
      "pnl_percent": 1.26,
      "drawdown_percent": -0.03,
      "period_return_percent": 1.2565,
      "cumulative_return_percent": 2.7058,
      "since_inception_date": "2025-12-03"
    }
  ]
}
```

---

## 3. Transactions (capital flows — contributions & withdrawals)

```
GET /transactions
GET /transactions?account_code=QGF00090
GET /transactions?from=2026-03-01&to=2026-03-31
```

Capital flows derived from the portfolio book (`cash_in_out`). Positive flows
are `CONTRIBUTION`, negative are `WITHDRAWAL`. `from` / `to` (inclusive,
`YYYY-MM-DD`) filter on the stored report date.

```json
{
  "distributor": "One Battalion Ventures Private Limited",
  "count": 1,
  "transactions": [
    {
      "account_code": "QAW00098",
      "client_name": "SHARAN B HEGDE",
      "date": "2026-03-04",
      "type": "CONTRIBUTION",
      "amount": 12000000,
      "signed_amount": 12000000,
      "portfolio_value_after": 14929490.18,
      "nav": 11.8246
    }
  ]
}
```

> Note: this is the capital-flow ledger that drives the portfolio page, not
> Cashfree SIP/payment orders (those are tracked separately and are currently
> empty for these accounts).

---

## 4. Portfolio history (time series — drives the performance tab)

```
GET /portfolio/history?account_code=QAW00098
GET /portfolio/history?account_code=QAW00098,QGF00090
```

Full daily time series per account (NAV, portfolio value, drawdown, returns,
capital flow). Without `account_code`, returns the series for all accounts.

```json
{
  "distributor": "One Battalion Ventures Private Limited",
  "data": [
    { "account_code": "QAW00098", "client_name": "SHARAN B HEGDE", "report_date": "2026-06-02",
      "nav": "12.2489", "portfolio_value": "15464913.75", "drawdown_percent": "-0.03",
      "cash_in_out": "0.00", "pnl": "191827.73", "pnl_percent": "1.26",
      "period_return_percent": "1.2565", "cumulative_return_percent": "2.7058" }
  ]
}
```

---

## 5. Documents (per investor)

```
GET /documents
GET /documents?account_code=QAW00098
```

Lists document categories + file counts per account. Categories:
`pms-agreement`, `account-opening`, `cml`, `disclosures`.

```json
{
  "distributor": "One Battalion Ventures Private Limited",
  "accounts": [
    { "account_code": "QAW00098", "client_name": "Sharan B Hegde",
      "categories": [ { "id": "pms-agreement", "label": "PMS Agreement", "fileCount": 1 }, ... ] }
  ]
}
```

### Download URLs

```
GET /documents/files?account_code=QAW00098&category=pms-agreement
```

Returns short-lived (5 min) signed S3 URLs for the files in that category.

```json
{
  "distributor": "One Battalion Ventures Private Limited",
  "account_code": "QAW00098",
  "category": "pms-agreement",
  "files": [
    { "filename": "PMS agreement.pdf", "size": 4396243, "lastModified": "2026-04-21T04:59:18.348Z",
      "url": "https://...signed...", "url_expires_in": 300, "mimeType": "application/pdf" }
  ]
}
```

An `account_code` that doesn't belong to the distributor returns `404`; an
invalid `category` returns `400`.

---

## Errors

| Status | code | Meaning |
|--------|------|---------|
| 401 | `NO_API_KEY` | No `Authorization`/`x-api-key` header |
| 401 | `INVALID_API_KEY` | Key did not match |
| 500 | `NO_API_KEY_CONFIGURED` | Server env var not set |
| 500 | `INTERNAL_ERROR` | Unexpected server error |

## Implementation

- Endpoints: `app/api/distributor-api/v1/{investors,portfolio,portfolio/history,transactions,documents,documents/files}/route.ts`
- Shared auth + scoping helper: `lib/distributorApi.ts`
- Data sources: `pms_clients_master` (mapping), `public.pms_master_sheet`
  (AUM, metrics, capital flows)

## Example (curl)

```bash
KEY=ob_live_xxxxxxxx
BASE=https://<host>/api/distributor-api/v1
curl -H "Authorization: Bearer $KEY" "$BASE/investors"
curl -H "Authorization: Bearer $KEY" "$BASE/portfolio"
curl -H "Authorization: Bearer $KEY" "$BASE/transactions?from=2026-01-01&to=2026-06-30"
```
