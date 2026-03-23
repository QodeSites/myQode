# Portfolio Scope Levels — Frontend Implementation Guide

The portfolio section has three view levels. Every screen (Performance, NAV Chart, Drawdown,
Monthly P&L, Quarterly P&L, Cashflow) must support all three levels by switching which
API endpoint and which identifiers are used.

---

## The Three Levels

```
Level 1 — Family Combined (entire family, all members, all strategies)
Level 2 — Member X, All Strategies (one owner's accounts combined)
Level 3 — Individual Strategy (single account)
```

### Visual hierarchy
```
┌─────────────────────────────────────────────────┐
│  Level 1: Family Combined                        │
│  "All Members · All Strategies"                  │
│  Total: ₹2,45,00,000                            │
│                                                  │
│  ├── Level 2: Ravi Sharma (all strategies)       │
│  │   Total: ₹1,20,00,000                        │
│  │   ├── Level 3: QAW00037 – All Weather        │
│  │   ├── Level 3: QFH00035 – Future Horizons    │
│  │   ├── Level 3: QGF00032 – Growth Fund        │
│  │   └── Level 3: QTF00036 – Tactical Fund      │
│  │                                               │
│  └── Level 2: Priya Sharma (all strategies)     │
│      Total: ₹1,25,00,000                        │
│      ├── Level 3: QAW00038 – All Weather        │
│      └── Level 3: QFH00033 – Future Horizons   │
└─────────────────────────────────────────────────┘
```

---

## Data Source: Snapshot

Call `GET /api/mobile/portfolio/snapshot` once on app load. Everything needed to build
all three levels comes from this single response.

```typescript
interface SnapshotResponse {
  owners: Owner[]
  totalPortfolioValue: number
  formattedTotal: string          // "₹2,45,00,000"
  activeAccountCount: number
  isHeadOfFamily: boolean
  groupId: string | null          // Level 1 identifier (null if not head of family)
}

interface Owner {
  id: string                      // ownerid — Level 2 identifier
  name: string
  email: string
  groupId: string | null
  isHeadOfFamily: boolean
  totalValue: number
  accounts: Account[]
}

interface Account {
  id: string                      // clientcode — Level 3 identifier
  strategyName: string
  strategyPrefix: string
  strategyColor: string
  portfolioValue: number
  status: 'active' | 'closed' | 'pending' | 'dormant'
  isClosed: boolean
  lastUpdated: string
}
```

### Extracting level identifiers from snapshot

```typescript
const snapshot = await apiFetch('/portfolio/snapshot')

// Level 1 — Family Combined
const familyCode = snapshot.groupId          // e.g. "14410148" or "GRP001"
const canShowFamily = snapshot.isHeadOfFamily && !!familyCode

// Level 2 — Per-owner combined
// Each owner's accountIds = all their individual account codes
const ownerViews = snapshot.owners.map(owner => ({
  ownerId: owner.id,
  ownerName: owner.name,
  totalValue: owner.totalValue,
  accountIds: owner.accounts.map(a => a.id),   // ["QAW00037","QFH00035",...]
  accounts: owner.accounts,
}))

// Level 3 — Individual strategies
const allAccounts = snapshot.owners.flatMap(o => o.accounts)
```

---

## API Routing per Level

Each portfolio screen must know which endpoint and which identifier(s) to use.

### Level 1 — Family Combined

Uses the **standard single-account endpoints** with `accountId = snapshot.groupId`.
The DB has a pre-aggregated row for the groupId.

```typescript
GET /api/mobile/portfolio/performance?accountId=14410148
GET /api/mobile/portfolio/nav?accountId=14410148&period=1Y
GET /api/mobile/portfolio/drawdown?accountId=14410148&period=1Y
GET /api/mobile/portfolio/monthly-pl?accountId=14410148
GET /api/mobile/portfolio/quarterly-pl?accountId=14410148
GET /api/mobile/portfolio/cashflow?accountId=14410148
```

### Level 2 — Member X, All Strategies

Uses the **combined endpoints** with `accountIds = comma-joined list of that owner's account codes`.

```typescript
const ids = ownerViews[n].accountIds.join(',')
// e.g. "QAW00037,QFH00035,QGF00032,QTF00036"

GET /api/mobile/portfolio/combined-performance?accountIds=QAW00037,QFH00035,QGF00032,QTF00036
GET /api/mobile/portfolio/combined-nav?accountIds=QAW00037,QFH00035,QGF00032,QTF00036&period=1Y
GET /api/mobile/portfolio/combined-drawdown?accountIds=QAW00037,QFH00035,QGF00032,QTF00036&period=1Y
GET /api/mobile/portfolio/combined-monthly-pl?accountIds=QAW00037,QFH00035,QGF00032,QTF00036
GET /api/mobile/portfolio/combined-quarterly-pl?accountIds=QAW00037,QFH00035,QGF00032,QTF00036
GET /api/mobile/portfolio/combined-cashflow?accountIds=QAW00037,QFH00035,QGF00032,QTF00036
```

### Level 3 — Individual Strategy

Uses the **standard single-account endpoints** with `accountId = account.id` (clientcode).

```typescript
GET /api/mobile/portfolio/performance?accountId=QAW00037
GET /api/mobile/portfolio/nav?accountId=QAW00037&period=1Y
GET /api/mobile/portfolio/drawdown?accountId=QAW00037&period=1Y
GET /api/mobile/portfolio/monthly-pl?accountId=QAW00037
GET /api/mobile/portfolio/quarterly-pl?accountId=QAW00037
GET /api/mobile/portfolio/cashflow?accountId=QAW00037
```

---

## Endpoint + Response Summary per Level

### Performance (summary stats)

All three levels return the **same response shape**:

```typescript
interface PerformanceResponse {
  accountId?: string           // Level 1 & 3 only
  accountIds?: string[]        // Level 2 only
  isClosed: boolean
  closedAt: string | null      // formatted "02 Jan 2025"
  strategy?: {                 // Level 3 only (single account has a strategy)
    prefix: string
    name: string
    benchmark: string
    color: string
  }
  amountInvested: number
  currentValue: number
  totalReturns: number
  returnsPercent: number       // CAGR if ≥1Y since inception, absolute otherwise
  isNegative: boolean
  inceptionDate: string        // "15 Mar 2021"
  dataAsOf: string
  grossValue: number
  trailingReturns: {
    portfolio: TrailingReturns
    benchmark?: TrailingReturns  // Level 1 & 3 only; Level 2 has no benchmark
  }
}

interface TrailingReturns {
  w1: number | null
  d10: number | null
  m1: number | null
  m3: number | null
  m6: number | null
  y1: number | null
  y3: number | null            // annualised CAGR
  currentDD: number
  maxDD: number
  sinceInception: number | null
}
```

> Level 2 (`combined-performance`) returns `trailingReturns` without a `benchmark` key.
> Hide the benchmark column in the trailing returns table when `trailingReturns.benchmark` is absent.

---

### NAV Chart

Level 1 & 3 — standard endpoint:
```typescript
interface NavResponse {
  accountId: string
  period: string
  isClosed: boolean
  closedAt: string | null
  strategy: { prefix: string; name: string; benchmark: string }
  series: { date: string; portfolio: number; benchmark: number | null }[]
  minValue: number
  maxValue: number
}
```

Level 2 — combined endpoint:
```typescript
interface CombinedNavResponse {
  accountIds: string[]
  period: string
  isClosed: boolean
  closedAt: string | null
  series: { date: string; portfolio: number }[]   // no benchmark key
  minValue: number
  maxValue: number
}
```

> Both series start at 100 at the first date of the selected window.
> Hide the benchmark line when the response has no `benchmark` key in series items.

---

### Drawdown Chart

Level 1 & 3 — standard endpoint:
```typescript
interface DrawdownResponse {
  series: { date: string; portfolio: number; benchmark: number | null }[]
  // all values ≤ 0, first value is 0.0
}
```

Level 2 — combined endpoint:
```typescript
interface CombinedDrawdownResponse {
  series: { date: string; portfolio: number }[]   // no benchmark key
}
```

---

### Monthly P&L / Quarterly P&L

All three levels return the **same shape** — the combined endpoints mirror the single-account endpoints exactly:

```typescript
// Monthly
interface MonthlyPLResponse {
  isClosed: boolean
  closedAt: string | null
  percentData: YearRow[]
  rupeeData: YearRow[]
}

interface YearRow {
  year: number
  jan: number | null; feb: number | null; mar: number | null
  apr: number | null; may: number | null; jun: number | null
  jul: number | null; aug: number | null; sep: number | null
  oct: number | null; nov: number | null; dec: number | null
  total: number | null
  yearCashFlow?: number | null   // rupeeData only
}

// Quarterly
interface QuarterlyPLResponse {
  isClosed: boolean
  closedAt: string | null
  percentData: QRow[]
  rupeeData: QRow[]
}

interface QRow {
  year: number
  q1: number | null; q2: number | null
  q3: number | null; q4: number | null
  total: number | null
  yearCashFlow?: number | null   // rupeeData only
}
```

---

### Cashflow

Level 1 & 3 — standard endpoint:
```typescript
interface CashflowResponse {
  isClosed: boolean
  closedAt: string | null
  transactions: {
    date: string
    amount: number
    type: 'inflow' | 'outflow'
    formattedAmount: string      // "+₹25,00,000.00" or "–₹5,00,000.00"
  }[]
  total: number
  formattedTotal: string
}
```

Level 2 — combined endpoint adds `accountId` per transaction:
```typescript
interface CombinedCashflowResponse {
  isClosed: boolean
  closedAt: string | null
  transactions: {
    date: string
    accountId: string            // which account this transaction belongs to
    amount: number
    type: 'inflow' | 'outflow'
    formattedAmount: string
  }[]
  total: number
  formattedTotal: string
}
```

---

## State Model

```typescript
type ScopeLevel = 'family' | 'owner' | 'individual'

interface PortfolioScope {
  level: ScopeLevel

  // Level 1
  familyCode?: string              // snapshot.groupId

  // Level 2
  ownerId?: string                 // owner.id
  ownerName?: string
  accountIds?: string[]            // owner's individual account codes joined as ?accountIds=

  // Level 3
  accountId?: string               // single clientcode
  strategyName?: string
  strategyColor?: string
}
```

```typescript
// Helper: build query string for any scope
function buildPortfolioQuery(scope: PortfolioScope, extra?: Record<string, string>): string {
  const params = new URLSearchParams(extra)
  if (scope.level === 'family') {
    params.set('accountId', scope.familyCode!)
  } else if (scope.level === 'owner') {
    params.set('accountIds', scope.accountIds!.join(','))
  } else {
    params.set('accountId', scope.accountId!)
  }
  return params.toString()
}

// Helper: pick the right base path
function getEndpointBase(scope: PortfolioScope, screen: string): string {
  const prefix = scope.level === 'owner' ? 'combined-' : ''
  return `/portfolio/${prefix}${screen}`
}

// Usage examples:
const perfQuery = buildPortfolioQuery(scope)
const perfPath  = getEndpointBase(scope, 'performance')
// → apiFetch(`${perfPath}?${perfQuery}`)

const navPath  = getEndpointBase(scope, 'nav')
const navQuery = buildPortfolioQuery(scope, { period: selectedPeriod })
// → apiFetch(`${navPath}?${navQuery}`)
```

---

## Scope Selector UI

The scope selector lives at the top of every portfolio screen. It should be a segmented
control or a dropdown showing the available levels for the current user.

```
┌────────────────────────────────────────────────┐
│  [All Members]  [Ravi Sharma ▼]  [QAW00037 ▼]  │
└────────────────────────────────────────────────┘
```

- **"All Members"** tab — visible only if `snapshot.isHeadOfFamily === true`
- **Owner tabs** — one per owner in `snapshot.owners`. If there is only one owner, skip this level.
- **Strategy dropdown** — lists the individual accounts of the currently selected owner.

When a user selects a scope, update the `PortfolioScope` state and re-fetch all portfolio
screens that are currently mounted.

### When to show / hide each level

| Condition | Level 1 | Level 2 | Level 3 |
|-----------|---------|---------|---------|
| Head of family, multiple owners | Show | Show | Show |
| Head of family, single owner | Show | Hide (redundant with L1) | Show |
| Not head of family, multiple accounts | Hide | Hide | Show all their accounts |
| Not head of family, single account | Hide | Hide | Show their one account |

---

## Closed Account UI

All endpoints return `isClosed` and `closedAt`. Apply this consistently:

```typescript
if (response.isClosed) {
  // Show amber banner above portfolio data:
  // "This account was closed on [closedAt]. Showing data up to closure date."
  // All values shown are as of the closure date — no special filtering needed,
  // the API already truncates data at closedAt.
}
```

For Level 2 (combined), if ALL accounts in the owner group are closed, the combined
response will also show `isClosed: true`. If only some are closed, those individual
accounts are excluded from the combined totals automatically by the server.

---

## Quick Reference Table

| Screen | Level 1 endpoint | Level 2 endpoint | Level 3 endpoint |
|--------|-----------------|-----------------|-----------------|
| Performance | `GET /portfolio/performance?accountId={groupId}` | `GET /portfolio/combined-performance?accountIds={ids}` | `GET /portfolio/performance?accountId={code}` |
| NAV Chart | `GET /portfolio/nav?accountId={groupId}&period=` | `GET /portfolio/combined-nav?accountIds={ids}&period=` | `GET /portfolio/nav?accountId={code}&period=` |
| Drawdown | `GET /portfolio/drawdown?accountId={groupId}&period=` | `GET /portfolio/combined-drawdown?accountIds={ids}&period=` | `GET /portfolio/drawdown?accountId={code}&period=` |
| Monthly P&L | `GET /portfolio/monthly-pl?accountId={groupId}` | `GET /portfolio/combined-monthly-pl?accountIds={ids}` | `GET /portfolio/monthly-pl?accountId={code}` |
| Quarterly P&L | `GET /portfolio/quarterly-pl?accountId={groupId}` | `GET /portfolio/combined-quarterly-pl?accountIds={ids}` | `GET /portfolio/quarterly-pl?accountId={code}` |
| Cashflow | `GET /portfolio/cashflow?accountId={groupId}` | `GET /portfolio/combined-cashflow?accountIds={ids}` | `GET /portfolio/cashflow?accountId={code}` |
