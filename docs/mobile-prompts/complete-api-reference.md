# myQode Mobile App — Complete API Reference & Frontend Implementation Guide

Base URL: `https://myqode.qodeinvest.com`
All authenticated endpoints require: `Authorization: Bearer {token}`
Content-Type for POST bodies: `application/json`

---

## Auth

### `POST /api/mobile/auth/login`

No auth header required.

**Request body:**
```json
{ "username": "QAW0009", "password": "yourpassword" }
```
`username` accepts either the client code (e.g. `QAW0009`) or email address.

**Response:**
```json
{
  "token": "eyJ...",
  "expiresIn": 2592000,
  "user": {
    "clientId": "14410001",
    "clientCode": "QAW0009",
    "name": "Ravi Sharma",
    "email": "ravi@example.com",
    "accountCodes": ["QAW0009", "QTF0003", "OWN001", "GRP001"],
    "isHeadOfFamily": true,
    "isSuperAdmin": false
  }
}
```

**Notes:**
- `accountCodes` includes individual client codes + unique ownerIds + groupId (for head-of-family accounts). All portfolio/document API calls validate against this list.
- `isSuperAdmin: true` only ever appears for `karan@qodeinvest.com`. Redirect this user to `AdminMasterScreen` instead of the normal home screen.
- Token TTL is 30 days. Store in `SecureStore` under key `auth_token`.
- If password is default/unset: `{ error: "Password setup required", code: "PASSWORD_SETUP_REQUIRED" }` → redirect to password setup flow.

**Error codes:**
| Status | Meaning |
|--------|---------|
| 400 | Missing fields |
| 401 | Invalid credentials |
| 403 | `PASSWORD_SETUP_REQUIRED` |

---

## Portfolio

All portfolio endpoints accept `?accountId=QAW0009`. If omitted, the first code in `accountCodes` is used. The server returns `403` if the requested `accountId` is not in the user's `accountCodes`.

### Portfolio Scope — Individual vs Owner vs Family

The `accountId` you pass determines the scope of the data returned. The same endpoint serves all three levels — just change the `accountId`:

| Scope | `accountId` to pass | Where to get it |
|-------|--------------------|--------------------|
| Single strategy | `QAW0009` (clientcode) | `snapshot.owners[n].accounts[i].id` |
| All accounts of one owner | `OWN001` (ownerid) | `snapshot.owners[n].id` |
| Entire family combined | `GRP001` (groupid) | `snapshot.groupId` (top-level) |

**How it works:** After login, the JWT's `accountCodes` array contains all three levels:

```json
"accountCodes": ["QAW0009", "QTF0003", "OWN001", "GRP001"]
//                individual codes       ownerid   groupid
```

The `pms_master_sheet` table stores pre-aggregated rows where `account_code = ownerid` (owner-level totals) and `account_code = groupid` (family-level totals). Passing any of these to a portfolio API returns the matching aggregate data.

**Example — fetching performance at each level:**
```
GET /api/mobile/portfolio/performance?accountId=QAW0009   → single strategy (All Weather)
GET /api/mobile/portfolio/performance?accountId=OWN001    → owner-level combined
GET /api/mobile/portfolio/performance?accountId=GRP001    → entire family combined
```

This works identically for all portfolio endpoints: `performance`, `nav`, `drawdown`, `monthly-pl`, `quarterly-pl`, `cashflow`.

**For non-head-of-family users:** Their `accountCodes` contains only their own clientcodes + ownerid. No groupId is added, so they cannot query family-level data.

**Reading codes from the snapshot response:**
```typescript
const snapshot = await apiFetch('/api/mobile/portfolio/snapshot')

// Individual strategy accounts
const strategyCodes = snapshot.owners.flatMap(o => o.accounts.map(a => a.id))

// Owner-level codes (one per owner in the group)
const ownerCodes = snapshot.owners.map(o => o.id)

// Family-level code (single group code, only exists for head of family)
const familyCode = snapshot.groupId   // null if not head of family
```

---

### Closed Account Handling

Every portfolio endpoint returns:
```json
{
  "isClosed": true,
  "closedAt": "02 Jan 2025"   // formatted date string (performance) or ISO string (nav/drawdown/cashflow)
}
```
When `isClosed: true`, **all data is already truncated at `closedAt`** — no filtering needed on the frontend. Display a "Closed Account" banner and show the last known values with the closure date.

---

### `GET /api/mobile/portfolio/snapshot`

Returns the owner profile and all linked accounts with their latest portfolio values. Use this as the home screen data loader.

**Response:**
```json
{
  "owners": [
    {
      "id": "OWN001",
      "name": "Ravi Sharma",
      "email": "ravi@example.com",
      "groupId": "GRP001",
      "isHeadOfFamily": true,
      "totalValue": 5820000.00,
      "accounts": [
        {
          "id": "QAW0009",
          "strategyPrefix": "QAW",
          "strategyName": "Qode All Weather",
          "strategyColor": "#3B82F6",
          "type": "Individual Account",
          "clientId": "14410001",
          "lastUpdated": "2025-01-02T00:00:00.000Z",
          "portfolioValue": 3200000.00,
          "status": "active",
          "isClosed": false,
          "mobile": "9876543210"
        },
        {
          "id": "QTF0003",
          "strategyPrefix": "QTF",
          "strategyName": "Qode Tactical Fund",
          "strategyColor": "#10B981",
          "type": "Individual Account",
          "clientId": "14410002",
          "lastUpdated": "2025-01-02T00:00:00.000Z",
          "portfolioValue": 2620000.00,
          "status": "closed",
          "isClosed": true,
          "mobile": null
        }
      ]
    }
  ],
  "totalPortfolioValue": 5820000.00,
  "formattedTotal": "₹58,20,000",
  "activeAccountCount": 1,
  "isHeadOfFamily": true,
  "groupId": "GRP001"
}
```

**Notes:**
- `status` values: `"active"` | `"closed"` | `"pending"` | `"dormant"`
- `isHeadOfFamily` and `groupId` at the top level come from the JWT.
- For group/owner-level consolidated codes (e.g. `GRP001`, `OWN001`), the snapshot does not return a portfolio value — use the individual accounts for display. The consolidated codes exist solely so portfolio detail APIs (performance, NAV, etc.) can be queried with them.
- The accounts array for each owner reflects actual DB records. A single-account owner will have exactly one entry.

---

### `GET /api/mobile/portfolio/performance?accountId=QAW0009`

Main performance summary screen. Includes trailing returns vs benchmark.

**Response:**
```json
{
  "accountId": "QAW0009",
  "isClosed": false,
  "closedAt": null,
  "strategy": {
    "prefix": "QAW",
    "name": "Qode All Weather",
    "benchmark": "NIFTY 500",
    "color": "#3B82F6"
  },
  "amountInvested": 2500000.00,
  "currentValue": 3200000.00,
  "totalReturns": 700000.00,
  "returnsPercent": 14.23,
  "isNegative": false,
  "inceptionDate": "15 Mar 2021",
  "dataAsOf": "02 Jan 2025",
  "grossValue": 3200000.00,
  "trailingReturns": {
    "portfolio": {
      "w1": 0.42,
      "d10": 1.15,
      "m1": 2.31,
      "m3": 5.67,
      "m6": 8.92,
      "y1": 18.45,
      "y3": 22.10,
      "currentDD": -3.21,
      "maxDD": -12.45,
      "sinceInception": 14.23
    },
    "benchmark": {
      "w1": 0.31,
      "d10": 0.88,
      "m1": 1.95,
      "m3": 4.12,
      "m6": 7.33,
      "y1": 15.22,
      "y3": 18.67,
      "currentDD": -4.55,
      "maxDD": -16.20,
      "sinceInception": 12.10
    }
  }
}
```

**Notes:**
- `returnsPercent` = CAGR if ≥ 1 year since inception, absolute % otherwise. Same formula as web.
- `amountInvested` = net of all cash flows (inflows − outflows). Can differ from gross invested if withdrawals occurred.
- `y3` is annualised CAGR, not simple 3-year return.
- `d10` = 10 business days (not calendar days).
- Any field in `trailingReturns` can be `null` if there is insufficient data for that window.
- `sinceInception` in both portfolio and benchmark may differ because benchmark is anchored to the portfolio's inception date.

**UI suggestions:**
- Show `amountInvested`, `currentValue`, `totalReturns` as the 3 top summary cards.
- Color `returnsPercent` green/red based on `isNegative`.
- Trailing returns table: show portfolio vs benchmark side-by-side for periods w1, d10, m1, m3, m6, y1, y3, sinceInception.
- Show `currentDD` and `maxDD` as a drawdown summary row.

---

### `GET /api/mobile/portfolio/nav?accountId=QAW0009&period=1Y`

NAV chart data. Both portfolio and benchmark are rebased to 100 at the start of the selected period.

**Period values:** `1W` | `1M` | `3M` | `6M` | `1Y` | `3Y` | `ALL`
Default: `1Y`

**Response:**
```json
{
  "accountId": "QAW0009",
  "isClosed": false,
  "closedAt": null,
  "strategy": {
    "prefix": "QAW",
    "name": "Qode All Weather",
    "benchmark": "NIFTY 500"
  },
  "period": "1Y",
  "series": [
    { "date": "2024-01-02", "portfolio": 100.0000, "benchmark": 100.0000 },
    { "date": "2024-01-03", "portfolio": 100.4200, "benchmark": 100.3100 },
    { "date": "2024-01-04", "portfolio": 100.3800, "benchmark": 100.2900 }
  ],
  "minValue": 94.21,
  "maxValue": 118.67
}
```

**Notes:**
- `series` is ASC by date. Both lines start at 100 at the first date of the window.
- `benchmark` values can be `null` if benchmark data is unavailable for that date (benchmark is forward-filled on trading days).
- `minValue` / `maxValue` span both series — use for Y-axis scaling.
- When `isClosed: true`, the series ends at `closedAt`.

---

### `GET /api/mobile/portfolio/drawdown?accountId=QAW0009&period=1Y`

Drawdown chart. Both series start at 0.0 (peak) and go negative.

**Period values:** Same as NAV endpoint.

**Response:**
```json
{
  "accountId": "QAW0009",
  "isClosed": false,
  "closedAt": null,
  "strategy": {
    "prefix": "QAW",
    "name": "Qode All Weather",
    "benchmark": "NIFTY 500"
  },
  "period": "1Y",
  "series": [
    { "date": "2024-01-02", "portfolio": 0.0000, "benchmark": 0.0000 },
    { "date": "2024-01-05", "portfolio": -1.2300, "benchmark": -0.8700 },
    { "date": "2024-01-08", "portfolio": -3.4500, "benchmark": -2.1200 }
  ]
}
```

**Notes:**
- All values ≤ 0. The peak within the selected window is 0.
- `benchmark` values can be `null` (forward-filled otherwise).
- Series is ASC.

---

### `GET /api/mobile/portfolio/monthly-pl?accountId=QAW0009`

Monthly P&L heatmap. Returns both % and ₹ tables.

**Response:**
```json
{
  "isClosed": false,
  "closedAt": null,
  "percentData": [
    {
      "year": 2024,
      "jan": 2.31, "feb": -0.87, "mar": 3.45, "apr": 1.22,
      "may": 0.55, "jun": 2.10, "jul": 1.89, "aug": -1.23,
      "sep": 3.67, "oct": 0.44, "nov": 2.15, "dec": 1.78,
      "total": 18.23
    }
  ],
  "rupeeData": [
    {
      "year": 2024,
      "jan": 58000.00, "feb": -22000.00, "mar": 91000.00, "apr": 32000.00,
      "may": 14000.00, "jun": 55000.00, "jul": 50000.00, "aug": -32000.00,
      "sep": 97000.00, "oct": 11000.00, "nov": 57000.00, "dec": 47000.00,
      "total": 458000.00,
      "yearCashFlow": 100000.00
    }
  ]
}
```

**Notes:**
- Month keys: `jan` through `dec` (lowercase). Missing months (before inception or after closure) are `null`.
- `total` in `percentData` = full-year NAV-based return (not sum of months).
- `total` in `rupeeData` = actual rupee P&L for the year.
- `yearCashFlow` = net capital flows during that year (deposits − withdrawals). Only on `rupeeData` rows.
- Formulas (matching web exactly):
  - `% = (endMonthNAV / startMonthNAV − 1) × 100`
  - `₹ = endValue − startValue − netCashFlowsInMonth`

---

### `GET /api/mobile/portfolio/quarterly-pl?accountId=QAW0009`

Quarterly P&L. Same structure as monthly but bucketed by quarter.

**Response:**
```json
{
  "isClosed": false,
  "closedAt": null,
  "percentData": [
    {
      "year": 2024,
      "q1": 5.12, "q2": 4.33, "q3": 3.89, "q4": 4.67,
      "total": 18.23
    }
  ],
  "rupeeData": [
    {
      "year": 2024,
      "q1": 128000.00, "q2": 108000.00, "q3": 97000.00, "q4": 125000.00,
      "total": 458000.00,
      "yearCashFlow": 100000.00
    }
  ]
}
```

---

### `GET /api/mobile/portfolio/cashflow?accountId=QAW0009`

All cash transactions (deposits and withdrawals) for the account.

**Response:**
```json
{
  "isClosed": false,
  "closedAt": null,
  "transactions": [
    {
      "date": "2021-03-15T00:00:00.000Z",
      "amount": 2500000,
      "type": "inflow",
      "formattedAmount": "+₹25,00,000.00"
    },
    {
      "date": "2023-06-01T00:00:00.000Z",
      "amount": -500000,
      "type": "outflow",
      "formattedAmount": "–₹5,00,000.00"
    }
  ],
  "total": 2000000,
  "formattedTotal": "₹20,00,000.00"
}
```

**Notes:**
- `type`: `"inflow"` (amount > 0) or `"outflow"` (amount < 0).
- `formattedAmount` uses `+` for inflows and `–` (en-dash) for outflows.
- `total` is the net (inflows − outflows). Represents total net capital deployed.

---

## Documents

### `GET /api/mobile/documents/list?accountId=QAW0009`

Document category listing with file counts.

**Response:**
```json
{
  "categories": [
    {
      "id": "pms-agreement",
      "label": "PMS Agreement",
      "description": "Your official agreement with Qode.",
      "fileCount": 2
    },
    {
      "id": "account-opening",
      "label": "Account Opening Documents",
      "description": "Verification of linked bank and demat accounts.",
      "fileCount": 5
    },
    {
      "id": "cml",
      "label": "CML",
      "description": "Capital Market License and regulatory documents.",
      "fileCount": 1
    },
    {
      "id": "disclosures",
      "label": "Disclosures",
      "description": "Risk disclosures and regulatory filings.",
      "fileCount": 3
    }
  ]
}
```

**Notes:**
- `fileCount` may be 0 if no documents have been uploaded yet for that category. Show disabled state for empty categories.
- Use `id` values as the `[category]` path param in the files endpoint below.

---

### `GET /api/mobile/documents/files/{category}?accountId=QAW0009`

Signed S3 URLs for files in a specific category.

**Valid `category` values:** `pms-agreement` | `account-opening` | `cml` | `disclosures`

**Response:**
```json
{
  "category": "pms-agreement",
  "accountId": "QAW0009",
  "files": [
    {
      "key": "docs/client-documents/14410001/PMS Agreement/agreement_v2.pdf",
      "filename": "agreement_v2.pdf",
      "size": 204800,
      "lastModified": "2024-06-15T10:30:00.000Z",
      "url": "https://qode-static-assets.s3.amazonaws.com/docs/...?X-Amz-Signature=...",
      "mimeType": "application/pdf"
    }
  ]
}
```

**Notes:**
- Signed URLs expire in **5 minutes** (300s). Do not cache them — re-fetch on each open.
- `mimeType` values: `application/pdf`, `image/png`, `image/jpeg`, `application/msword`, `application/vnd.openxmlformats-officedocument.wordprocessingml.document`, `application/vnd.ms-excel`, `application/vnd.openxmlformats-officedocument.spreadsheetml.sheet`, `application/octet-stream`.
- Open PDFs in an in-app PDF viewer; images inline; other types → offer share/download via `expo-sharing`.

---

## Services

### `POST /api/mobile/services/withdrawal`

Submit a withdrawal request.

**Request body:**
```json
{
  "accountId": "QAW0009",
  "amount": 500000,
  "additionalNotes": "Partial withdrawal for emergency"
}
```

**Response:**
```json
{ "success": true, "inquiry_id": "INQ-20250115-0042" }
```

---

### `POST /api/mobile/services/switch`

Submit a strategy switch / reallocation request.

**Request body:**
```json
{
  "accountId": "QAW0009",
  "investedIn": "QAW",
  "switchTo": "QFH",
  "amount": 1000000,
  "reason": "Seeking higher growth exposure.",
  "additionalNotes": "Optional extra context"
}
```

**`switchTo` / `investedIn` values:** `QFH` | `QAW` | `QTF` | `QGF`

**Response:**
```json
{ "success": true, "inquiry_id": "INQ-20250115-0043" }
```

---

### `POST /api/mobile/services/strategy-inquiry`

Ask the fund manager a question about a strategy.

**Request body:**
```json
{
  "accountId": "QAW0009",
  "question": "How is the All Weather fund positioned for rising interest rates?"
}
```

**Response:**
```json
{ "success": true, "inquiry_id": "INQ-20250115-0044" }
```

---

### `POST /api/mobile/services/discussion`

Raise a general query with the IR team.

**Request body:**
```json
{
  "accountId": "QAW0009",
  "topic": "I would like to understand my fee structure better."
}
```

**Response:**
```json
{ "success": true, "inquiry_id": "INQ-20250115-0045" }
```

---

### `POST /api/mobile/services/account-request`

Raise a family mapping or account change request.

**Request body:**
```json
{
  "accountId": "QAW0009",
  "message": "Please link my spouse's account QAW0015 to the same family group."
}
```

**Response:**
```json
{ "success": true, "inquiry_id": "INQ-20250115-0046" }
```

---

### `GET /api/mobile/services/bank-details`

Static Qode bank details for manual NEFT/RTGS transfers. Auth required.

**Response:**
```json
{
  "payableTo": "Qode Advisors LLP",
  "accountNumber": "43377275922",
  "bank": "SBI Bank – Corporate Account Group Branch",
  "ifsc": "SBIN0009995",
  "micr": "40000213",
  "copyText": "Payable to: Qode Advisors LLP\nAccount Number: 43377275922\nBank: SBI Bank\nIFSC: SBIN0009995"
}
```

**Notes:** Use `copyText` for the "Copy all" button.

---

### `GET /api/mobile/services/transactions?accountId=QAW0009`

All Cashfree payment transactions for the account.

**Response:**
```json
{
  "transactions": [
    {
      "orderId": "qode_1760325214059_sd8bbx",
      "type": "ONE_TIME",
      "amount": 500000,
      "currency": "INR",
      "status": "PAID",
      "date": "2025-01-15",
      "frequency": "One-time",
      "startDate": null
    },
    {
      "orderId": "qode_1750000000000_ab1234",
      "type": "SIP",
      "amount": 25000,
      "currency": "INR",
      "status": "ACTIVE",
      "date": "2024-10-01",
      "frequency": "Monthly",
      "startDate": "2024-10-05"
    }
  ],
  "lastUpdated": "2025-01-15T10:30:00.000Z"
}
```

---

## Payments (Cashfree)

### `POST /api/mobile/payments/create-order`

Create a Cashfree payment order. Returns `paymentSessionId` to pass to the Cashfree React Native SDK.

**Request body:**
```json
{
  "accountId": "QAW0009",
  "amount": 500000,
  "orderType": "ONE_TIME",
  "strategyType": "QAW"
}
```

`orderType`: `"ONE_TIME"` (default) | `"NEW_STRATEGY"`
`strategyType`: optional, e.g. `"QAW"` for new strategy onboarding.

**Response:**
```json
{
  "orderId": "qode_1760325214059_sd8bbx",
  "paymentSessionId": "session_abc123xyz",
  "orderAmount": 500000,
  "orderCurrency": "INR",
  "orderStatus": "ACTIVE",
  "orderExpiryTime": "2025-01-15T11:30:00+05:30",
  "environment": "production"
}
```

**Notes:**
- Pass `paymentSessionId` directly to `CFPaymentGatewayService` from `react-native-cashfree-pg-sdk`.
- Use `environment` to initialise the SDK in production vs sandbox mode.
- Minimum amount is ₹100.

---

### `GET /api/mobile/payments/verify?orderId=qode_1760325214059_sd8bbx`

Call this after the Cashfree SDK callback to get the authoritative payment status.

**Response:**
```json
{
  "orderId": "qode_1760325214059_sd8bbx",
  "orderStatus": "PAID",
  "orderAmount": 500000,
  "orderCurrency": "INR",
  "paymentStatus": "SUCCESS",
  "isSuccess": true,
  "payment": {
    "cfPaymentId": "987654321",
    "amount": 500000,
    "time": "2025-01-15T10:35:00+05:30",
    "method": "upi",
    "bankReference": "BANK123456",
    "message": "Transaction successful"
  }
}
```

**`paymentStatus` values:** `SUCCESS` | `FAILED` | `PENDING` | `USER_DROPPED`
**Notes:** Always call verify after the SDK returns — do not rely solely on the SDK callback.

---

### `GET /api/mobile/payments/investment-status?accountId=QAW0009`

Qode-side investment lifecycle tracking (goes beyond Cashfree status).

**Response:**
```json
{
  "accountId": "QAW0009",
  "active": [
    {
      "orderId": "qode_1760325214059_sd8bbx",
      "amount": 500000,
      "formattedAmount": "₹5,00,000.00",
      "currency": "INR",
      "paymentType": "ONE_TIME",
      "isNewStrategy": false,
      "strategyType": null,
      "paymentStatus": "SUCCESS",
      "investmentStatus": "SETTLED",
      "statusLabel": "Funds Received",
      "statusMessage": "Qode has received your funds. We are deploying them into your strategy.",
      "statusColor": "#8B5CF6",
      "isTerminal": false,
      "createdAt": "2025-01-15T10:30:00.000Z",
      "paymentTime": "2025-01-15T10:35:00.000Z",
      "settledAt": "2025-01-16T14:00:00.000Z",
      "deployedAt": null,
      "settlementAmount": 499500,
      "transferUtr": "UTR123456789",
      "bankReference": "BANK123456",
      "timeline": [
        { "step": "order_created",     "label": "Order Created",          "completedAt": "2025-01-15T10:30:00.000Z", "done": true },
        { "step": "payment_confirmed", "label": "Payment Confirmed",       "completedAt": "2025-01-15T10:35:00.000Z", "done": true },
        { "step": "funds_received",    "label": "Funds Received by Qode",  "completedAt": "2025-01-16T14:00:00.000Z", "done": true },
        { "step": "deployed",          "label": "Deployed into Strategy",  "completedAt": null,                       "done": false }
      ]
    }
  ],
  "completed": [],
  "totalCount": 1,
  "lastUpdated": "2025-01-17T10:00:00.000Z"
}
```

**`investmentStatus` lifecycle:**
| Status | Label | Color | Terminal |
|--------|-------|-------|---------|
| `PENDING_PAYMENT` | Payment Pending | `#F59E0B` | No |
| `PAYMENT_SUCCESS` | Payment Confirmed | `#3B82F6` | No |
| `SETTLED` | Funds Received | `#8B5CF6` | No |
| `DEPLOYED` | Investment Live | `#10B981` | Yes |
| `PAYMENT_FAILED` | Payment Failed | `#EF4444` | Yes |
| `EXPIRED` | Order Expired | `#6B7280` | Yes |
| `CANCELLED` | Cancelled | `#6B7280` | Yes |

**Notes:**
- `active` = in-flight investments (not yet terminal). Show these prominently.
- `completed` = terminal investments (deployed, failed, cancelled, expired).
- `timeline` array has exactly 4 steps always. Use `done` flag for the step-indicator.

---

## SIP Management

### `POST /api/mobile/services/setup-sip`

Create a new SIP via Cashfree. Returns `subscriptionSessionId` for the Cashfree subscriptions SDK.

**Request body:**
```json
{
  "accountId": "QAW0009",
  "amount": 25000,
  "frequency": "monthly",
  "startDate": "2025-02-01",
  "endDate": "2027-02-01",
  "totalInstallments": 24
}
```

`frequency`: `"daily"` | `"weekly"` | `"monthly"` | `"quarterly"` | `"yearly"`
`endDate` and `totalInstallments` are optional. Default `totalInstallments` = 120.
Minimum amount: ₹100.

**Response:**
```json
{
  "subscriptionId": "qode_1760325214059_sd8bbx",
  "subscriptionSessionId": "sub_session_abc123",
  "cfSubscriptionId": "cf_sub_98765",
  "status": "BANK_APPROVAL_PENDING",
  "amount": 25000,
  "frequency": "monthly",
  "startDate": "2025-02-01",
  "firstChargeTime": "2025-02-01T00:00:00+05:30",
  "expiryTime": "2027-02-01T23:59:59+05:30",
  "environment": "production"
}
```

**Notes:**
- Use `subscriptionSessionId` with the Cashfree subscriptions SDK for mandate registration.
- The user must complete bank mandate approval before the SIP goes `ACTIVE`.

---

### `POST /api/mobile/services/cancel-sip`

Cancel an active SIP.

**Request body:**
```json
{
  "subscription_id": "qode_1760325214059_sd8bbx",
  "accountId": "QAW0009"
}
```

**Response:**
```json
{
  "success": true,
  "message": "SIP cancelled successfully",
  "data": {
    "subscription_id": "qode_1760325214059_sd8bbx",
    "previous_status": "ACTIVE",
    "new_status": "CANCELLED",
    "cancelled_at": "2025-01-15T10:30:00.000Z",
    "amount": 25000,
    "frequency": "monthly"
  }
}
```

**Cancellable statuses:** `ACTIVE` | `BANK_APPROVAL_PENDING` | `PENDING` | `PAUSED` | `ON_HOLD` | `CUSTOMER_PAUSED`

---

### `POST /api/mobile/services/pause-resume-sip`

Pause or resume an active SIP.

**Request body:**
```json
{
  "subscription_id": "qode_1760325214059_sd8bbx",
  "accountId": "QAW0009",
  "action": "pause"
}
```

`action`: `"pause"` | `"resume"`
- `pause` only works when status is `ACTIVE`
- `resume` only works when status is `PAUSED` or `CUSTOMER_PAUSED`

**Response:**
```json
{
  "success": true,
  "message": "SIP paused successfully",
  "data": {
    "subscription_id": "qode_1760325214059_sd8bbx",
    "previous_status": "ACTIVE",
    "new_status": "PAUSED",
    "action": "pause",
    "amount": 25000,
    "frequency": "monthly",
    "next_charge_date": "2025-02-01"
  }
}
```

---

## Engagement

### `GET /api/mobile/engagement/newsletters`

Newsletter PDFs, sorted newest first. Auth required.

**Response:**
```json
{
  "items": [
    {
      "key": "docs/newsletters/Jan-2026/newsletter_jan_2026.pdf",
      "title": "Jan-2026",
      "filename": "newsletter_jan_2026.pdf",
      "section": "Jan-2026",
      "url": "https://...signed-url...",
      "type": "pdf",
      "size": 1048576,
      "lastModified": "2026-01-05T08:00:00.000Z"
    }
  ],
  "count": 18
}
```

**Notes:** Signed URLs expire in 5 minutes. Open in in-app PDF viewer.

---

### `GET /api/mobile/engagement/events`

Event materials (PDFs, slides), sorted newest first. Auth required.

**Response:** Same shape as newsletters, but `type` can be `"pdf"` or `"file"`.

---

### `GET /api/mobile/engagement/portal-guide`

Portal tutorial videos and report snapshot images from S3.

**Response:**
```json
{
  "videos": [
    {
      "key": "videos/reports-tutorial/performance/performance_tutorial.mp4",
      "filename": "performance_tutorial.mp4",
      "reportName": "performance",
      "url": "https://...signed-url...",
      "size": 10485760
    }
  ],
  "snapshots": [
    {
      "key": "images/reports-snapshot/performance/performance_preview.png",
      "filename": "performance_preview.png",
      "reportName": "performance",
      "url": "https://...signed-url...",
      "size": 204800
    }
  ],
  "byReport": {
    "snapshots": {
      "performance": [ /* snapshot items */ ],
      "nav": [ /* snapshot items */ ]
    },
    "videos": {
      "performance": [ /* video items */ ]
    }
  },
  "counts": { "videos": 4, "snapshots": 8 }
}
```

**Notes:**
- `byReport` makes it easy to show a video + preview for each report type.
- Signed URLs expire in 5 minutes.

---

### `POST /api/mobile/engagement/referral`

Refer a new investor.

**Request body:**
```json
{
  "accountId": "QAW0009",
  "name": "Priya Patel",
  "email": "priya@example.com",
  "phone": "9876543210",
  "description": "My colleague interested in PMS"
}
```

`description` is optional.

**Response:**
```json
{ "success": true, "inquiry_id": "INQ-20250115-0047" }
```

---

## Experience

### `GET /api/mobile/experience/family`

Full 3-level family tree for the logged-in user.

**Response:**
```json
{
  "isHeadOfFamily": true,
  "groupId": "GRP001",
  "groupName": "Sharma Family",
  "tree": [
    {
      "groupName": "Sharma Family",
      "groupId": "GRP001",
      "groupEmail": "ravi@example.com",
      "totalAccounts": 3,
      "owners": [
        {
          "ownerId": "OWN001",
          "ownerName": "Ravi Sharma",
          "ownerEmail": "ravi@example.com",
          "accountCount": 2,
          "accounts": [
            {
              "clientid": "14410001",
              "clientcode": "QAW0009",
              "holderName": "Ravi Sharma",
              "relation": "Primary",
              "status": "Active",
              "head_of_family": true,
              "groupid": "GRP001",
              "groupname": "Sharma Family",
              "groupemailid": "ravi@example.com",
              "ownerid": "OWN001",
              "ownername": "Ravi Sharma",
              "email": "ravi@example.com",
              "mobile": "9876543210",
              "address": "123 Main St",
              "city": "Mumbai",
              "state": "Maharashtra",
              "pannumber": "ABCDE1234F"
            },
            {
              "clientid": "14410002",
              "clientcode": "QTF0003",
              "holderName": "Ravi Sharma",
              "relation": "Family Member",
              "status": "Active",
              "head_of_family": false,
              "groupid": "GRP001",
              "groupname": "Sharma Family",
              "groupemailid": "ravi@example.com",
              "ownerid": "OWN001",
              "ownername": "Ravi Sharma",
              "email": "ravi@example.com",
              "mobile": "9876543210",
              "address": "123 Main St",
              "city": "Mumbai",
              "state": "Maharashtra",
              "pannumber": "ABCDE1234F"
            }
          ]
        }
      ]
    }
  ],
  "flatMembers": [ /* all accounts as flat array, same shape as accounts above */ ],
  "totalMembers": 3
}
```

**`status` values:** `"Active"` | `"Pending KYC"` | `"Dormant"`
**`relation` values:** `"Primary"` (head_of_family) | `"Family Member"`

**Notes:**
- Use `tree` for the hierarchical family view screen.
- Use `flatMembers` for quick lookup or a flat list view.
- Only show this screen if `user.isHeadOfFamily === true`. For non-head users, show only their own account info.

---

## Admin (Super Admin Only — `karan@qodeinvest.com`)

Both endpoints require `isSuperAdmin: true` in the JWT. Any other user receives `403 Forbidden`.

### `GET /api/mobile/admin/clients?search=&page=1&limit=50`

List all client owner groups.

**Query params:**
| Param | Default | Description |
|-------|---------|-------------|
| `search` | `""` | Filter by name, email, account code, or group name |
| `page` | `1` | Page number |
| `limit` | `10000` | Page size (default returns all) |

**Response:**
```json
{
  "clients": [
    {
      "ownerId": "OWN001",
      "ownerName": "Ravi Sharma",
      "email": "ravi@example.com",
      "mobile": "9876543210",
      "groupId": "GRP001",
      "groupName": "Sharma Family",
      "headClientCode": "QAW0009",
      "headClientId": "14410001",
      "isHeadOfFamily": true,
      "accountCodes": ["QAW0009", "QTF0003"],
      "totalAccounts": 2,
      "onboardingStatus": "completed",
      "loginCount": 42,
      "lastLogin": "2025-01-15T10:30:00.000Z",
      "accounts": [
        {
          "clientId": "14410001",
          "clientCode": "QAW0009",
          "name": "Ravi Sharma",
          "onboardingStatus": "completed",
          "isHeadOfFamily": true,
          "loginCount": 38,
          "lastLogin": "2025-01-15T10:30:00.000Z"
        },
        {
          "clientId": "14410002",
          "clientCode": "QTF0003",
          "name": "Ravi Sharma",
          "onboardingStatus": "completed",
          "isHeadOfFamily": false,
          "loginCount": 4,
          "lastLogin": "2025-01-10T14:00:00.000Z"
        }
      ]
    }
  ],
  "pagination": {
    "page": 1,
    "limit": 10000,
    "total": 248,
    "totalPages": 1
  }
}
```

**`onboardingStatus` values:** `"completed"` | `"pending"` | `"mixed"`

---

### `POST /api/mobile/admin/impersonate`

Get an impersonation token scoped to a specific client. Use `headClientCode` from the clients list for family-level impersonation.

**Request body:**
```json
{ "clientCode": "QAW0009" }
```

**Response:**
```json
{
  "token": "eyJ...",
  "expiresIn": 14400,
  "user": {
    "clientId": "14410001",
    "clientCode": "QAW0009",
    "name": "Ravi Sharma",
    "email": "ravi@example.com",
    "accountCodes": ["QAW0009", "QTF0003", "OWN001", "GRP001"],
    "isHeadOfFamily": true,
    "isImpersonated": true,
    "impersonatedBy": "karan@qodeinvest.com",
    "onboardingStatus": "completed"
  }
}
```

**Notes:**
- Impersonation token TTL is **4 hours**.
- Store under `SecureStore` key `impersonation_token` — keep separate from `auth_token`.
- All API calls use the impersonation token when active (see `getActiveToken()` below).
- `accountCodes` includes all individual codes + ownerIds + groupId for head-of-family accounts — the impersonated user sees the exact same data as if they had logged in themselves.

---

## Token Management (Client-Side)

```typescript
// SecureStore keys
const AUTH_TOKEN_KEY        = 'auth_token'
const IMPERSONATION_TOKEN_KEY = 'impersonation_token'

// Returns the active token for all API calls
async function getActiveToken(): Promise<string> {
  const impToken = await SecureStore.getItemAsync(IMPERSONATION_TOKEN_KEY)
  if (impToken) return impToken
  return (await SecureStore.getItemAsync(AUTH_TOKEN_KEY)) ?? ''
}

// Start impersonation
async function startImpersonation(clientCode: string) {
  const adminToken = await SecureStore.getItemAsync(AUTH_TOKEN_KEY)
  const res = await fetch('/api/mobile/admin/impersonate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${adminToken}` },
    body: JSON.stringify({ clientCode }),
  })
  const data = await res.json()
  await SecureStore.setItemAsync(IMPERSONATION_TOKEN_KEY, data.token)
  setImpersonatedUser(data.user)
  // navigation.reset to MainTabs
}

// Exit impersonation
async function exitImpersonation() {
  await SecureStore.deleteItemAsync(IMPERSONATION_TOKEN_KEY)
  setImpersonatedUser(null)
  // navigation.navigate('AdminMasterScreen')
}
```

**Auth context should include:**
```typescript
interface AuthContextType {
  user: User | null
  originalUser: User | null       // Karan's real user when impersonating
  isImpersonating: boolean
  startImpersonation: (clientCode: string) => Promise<void>
  exitImpersonation: () => void
}
```

**Edge cases:**
- If any API returns `401` while `isImpersonating`, call `exitImpersonation()` (impersonation token expired).
- On app restart: check if `impersonation_token` exists but is expired → silently delete and fall back to `auth_token`.

---

## Error Handling

All endpoints return errors in the format:
```json
{ "error": "Human-readable message", "code": "OPTIONAL_CODE" }
```

| Status | Common cause |
|--------|-------------|
| 400 | Missing or invalid request fields |
| 401 | Missing/expired/invalid token → redirect to login |
| 403 | Account not in user's `accountCodes`, or non-admin hitting admin endpoint |
| 404 | Account or resource not found |
| 422 | Invalid phone on file (payments/SIP) |
| 500 | Server error — show generic retry message |

**Global interceptor pattern:**
```typescript
async function apiFetch(path: string, options?: RequestInit) {
  const token = await getActiveToken()
  const res = await fetch(`${BASE_URL}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`,
      ...options?.headers,
    },
  })
  if (res.status === 401) {
    const { isImpersonating, exitImpersonation, logout } = useAuth()
    if (isImpersonating) {
      exitImpersonation()
    } else {
      logout()
    }
    return
  }
  return res.json()
}
```

---

## Summary: Full API Table

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| POST | `/api/mobile/auth/login` | None | Login, get JWT |
| GET | `/api/mobile/portfolio/snapshot` | JWT | Home screen — all accounts + values |
| GET | `/api/mobile/portfolio/performance` | JWT | Returns + trailing returns |
| GET | `/api/mobile/portfolio/nav` | JWT | NAV chart (rebased to 100) |
| GET | `/api/mobile/portfolio/drawdown` | JWT | Drawdown chart |
| GET | `/api/mobile/portfolio/monthly-pl` | JWT | Monthly P&L heatmap (% and ₹) |
| GET | `/api/mobile/portfolio/quarterly-pl` | JWT | Quarterly P&L (% and ₹) |
| GET | `/api/mobile/portfolio/cashflow` | JWT | Cash in/out transactions |
| GET | `/api/mobile/documents/list` | JWT | Document categories + file counts |
| GET | `/api/mobile/documents/files/{category}` | JWT | Signed URLs for category files |
| POST | `/api/mobile/services/withdrawal` | JWT | Submit withdrawal request |
| POST | `/api/mobile/services/switch` | JWT | Submit strategy switch request |
| POST | `/api/mobile/services/strategy-inquiry` | JWT | Ask fund manager a question |
| POST | `/api/mobile/services/discussion` | JWT | Raise general IR query |
| POST | `/api/mobile/services/account-request` | JWT | Family mapping / account change request |
| GET | `/api/mobile/services/bank-details` | JWT | Qode bank account details |
| GET | `/api/mobile/services/transactions` | JWT | Cashfree payment history |
| POST | `/api/mobile/services/setup-sip` | JWT | Create SIP via Cashfree |
| POST | `/api/mobile/services/cancel-sip` | JWT | Cancel active SIP |
| POST | `/api/mobile/services/pause-resume-sip` | JWT | Pause / resume SIP |
| POST | `/api/mobile/payments/create-order` | JWT | One-time investment — create Cashfree order |
| GET | `/api/mobile/payments/verify` | JWT | Verify payment status after SDK callback |
| GET | `/api/mobile/payments/investment-status` | JWT | Qode investment lifecycle tracker |
| GET | `/api/mobile/engagement/newsletters` | JWT | Newsletter PDFs |
| GET | `/api/mobile/engagement/events` | JWT | Event materials |
| GET | `/api/mobile/engagement/portal-guide` | JWT | Tutorial videos + report snapshots |
| POST | `/api/mobile/engagement/referral` | JWT | Submit investor referral |
| GET | `/api/mobile/experience/family` | JWT | Family tree (3-level hierarchy) |
| GET | `/api/mobile/admin/clients` | Super Admin JWT | List all client groups |
| POST | `/api/mobile/admin/impersonate` | Super Admin JWT | Get impersonation token |
