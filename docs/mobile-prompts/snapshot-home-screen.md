# Portfolio Snapshot — Home Screen Implementation Guide

## API

```
GET /api/mobile/portfolio/snapshot
Authorization: Bearer {token}
```

No query params needed. The server derives the user from the JWT.

---

## Full Response Shape

```json
{
  "owners": [
    {
      "id": "50501",
      "name": "Ravi Sharma",
      "email": "ravi@example.com",
      "groupId": "14410148",
      "isHeadOfFamily": true,
      "totalValue": 12000000.00,
      "accounts": [
        {
          "id": "QAW00037",
          "strategyPrefix": "QAW",
          "strategyName": "Qode All Weather",
          "strategyColor": "#3B82F6",
          "type": "Individual Account",
          "clientId": "14410037",
          "lastUpdated": "2025-01-02T00:00:00.000Z",
          "portfolioValue": 3500000.00,
          "status": "active",
          "isClosed": false,
          "mobile": "9876543210"
        },
        {
          "id": "QFH00035",
          "strategyPrefix": "QFH",
          "strategyName": "Qode Future Horizons",
          "strategyColor": "#8B5CF6",
          "type": "Individual Account",
          "clientId": "14410035",
          "lastUpdated": "2025-01-02T00:00:00.000Z",
          "portfolioValue": 2800000.00,
          "status": "active",
          "isClosed": false,
          "mobile": "9876543210"
        },
        {
          "id": "QTF00036",
          "strategyPrefix": "QTF",
          "strategyName": "Qode Tactical Fund",
          "strategyColor": "#10B981",
          "type": "Individual Account",
          "clientId": "14410036",
          "lastUpdated": "2025-01-02T00:00:00.000Z",
          "portfolioValue": 0.00,
          "status": "closed",
          "isClosed": true,
          "mobile": null
        }
      ]
    },
    {
      "id": "46907",
      "name": "Priya Sharma",
      "email": "priya@example.com",
      "groupId": "14410148",
      "isHeadOfFamily": false,
      "totalValue": 5800000.00,
      "accounts": [
        {
          "id": "QAW00038",
          "strategyPrefix": "QAW",
          "strategyName": "Qode All Weather",
          "strategyColor": "#3B82F6",
          "type": "Individual Account",
          "clientId": "14410038",
          "lastUpdated": "2025-01-02T00:00:00.000Z",
          "portfolioValue": 5800000.00,
          "status": "active",
          "isClosed": false,
          "mobile": null
        }
      ]
    }
  ],
  "totalPortfolioValue": 17800000.00,
  "formattedTotal": "₹1,78,00,000",
  "activeAccountCount": 3,
  "isHeadOfFamily": true,
  "groupId": "14410148"
}
```

---

## How Response Maps to the Three Scope Levels

The snapshot already contains all three levels of value in one call.
No additional API calls needed for the home screen display.

| Scope Level | Value field | Identifier to use for detail screens |
|-------------|-------------|--------------------------------------|
| Family Combined (Level 1) | `totalPortfolioValue` | `snapshot.groupId` |
| Owner combined (Level 2) | `owners[n].totalValue` | `owners[n].accounts.map(a => a.id)` as `accountIds` |
| Individual strategy (Level 3) | `owners[n].accounts[i].portfolioValue` | `accounts[i].id` as `accountId` |

---

## Home Screen Layout

### For head-of-family users (`isHeadOfFamily === true`)

```
┌─────────────────────────────────────────────────┐
│                                                  │
│  Total Portfolio Value                           │
│  ₹1,78,00,000                                   │   ← snapshot.formattedTotal
│  3 active accounts                              │   ← snapshot.activeAccountCount
│                         [View Details →]         │   ← tap → Level 1 performance
│                                                  │
├─────────────────────────────────────────────────┤
│                                                  │
│  ┌───────────────────────────────────────────┐  │
│  │ Ravi Sharma                               │  │   ← owners[0].name
│  │ ₹1,20,00,000                             │  │   ← owners[0].totalValue
│  │                       [All Strategies →]  │  │   ← tap → Level 2 (owner combined)
│  │                                           │  │
│  │  QAW00037  All Weather      ₹35,00,000   │  │   ← tap → Level 3 (individual)
│  │  QFH00035  Future Horizons  ₹28,00,000   │  │
│  │  QTF00036  Tactical Fund    CLOSED        │  │   ← isClosed badge
│  └───────────────────────────────────────────┘  │
│                                                  │
│  ┌───────────────────────────────────────────┐  │
│  │ Priya Sharma                              │  │   ← owners[1].name
│  │ ₹58,00,000                               │  │   ← owners[1].totalValue
│  │                       [All Strategies →]  │  │   ← tap → Level 2 (owner combined)
│  │                                           │  │
│  │  QAW00038  All Weather      ₹58,00,000   │  │   ← tap → Level 3 (individual)
│  └───────────────────────────────────────────┘  │
│                                                  │
└─────────────────────────────────────────────────┘
```

### For non-head-of-family users or single-owner users

```
┌─────────────────────────────────────────────────┐
│                                                  │
│  Total Portfolio Value                           │
│  ₹35,00,000                                     │   ← owners[0].totalValue
│  (no family total shown)                         │
│                                                  │
│  ┌───────────────────────────────────────────┐  │
│  │ QAW00037  Qode All Weather               │  │
│  │ ₹35,00,000                               │  │
│  │ Active · Last updated: 02 Jan 2025        │  │
│  └───────────────────────────────────────────┘  │
│                                                  │
│  ┌───────────────────────────────────────────┐  │
│  │ QFH00035  Qode Future Horizons           │  │
│  │ ₹28,00,000                               │  │
│  └───────────────────────────────────────────┘  │
│                                                  │
└─────────────────────────────────────────────────┘
```

---

## Navigation on Tap

Each tappable element navigates to the portfolio detail screens (Performance, NAV, etc.)
with the appropriate `PortfolioScope` preloaded:

```typescript
// Tap "View Details →" on total portfolio header
// → Level 1: family combined
navigation.navigate('PortfolioDetail', {
  scope: {
    level: 'family',
    familyCode: snapshot.groupId,          // "14410148"
    label: 'All Members · All Strategies',
  }
})

// Tap "All Strategies →" on an owner card
// → Level 2: that owner's combined accounts
navigation.navigate('PortfolioDetail', {
  scope: {
    level: 'owner',
    ownerId: owner.id,                     // "50501"
    ownerName: owner.name,                 // "Ravi Sharma"
    accountIds: owner.accounts.map(a => a.id),  // ["QAW00037","QFH00035","QTF00036"]
    label: `${owner.name} · All Strategies`,
  }
})

// Tap an individual account row
// → Level 3: single strategy
navigation.navigate('PortfolioDetail', {
  scope: {
    level: 'individual',
    accountId: account.id,                 // "QAW00037"
    strategyName: account.strategyName,    // "Qode All Weather"
    strategyColor: account.strategyColor,
    label: `${account.strategyName}`,
  }
})
```

---

## Rendering Rules

### Owner card — "All Strategies" button visibility

Show the "All Strategies →" button on an owner card only when that owner has
**more than one account**. If there is only one account, tapping the card directly
goes to Level 3.

```typescript
const showAllStrategiesButton = owner.accounts.length > 1
```

### Family total header visibility

Show the top-level family total section only when:
```typescript
const showFamilyTotal = snapshot.isHeadOfFamily && snapshot.groupId !== null && snapshot.owners.length > 1
```

If there is only one owner and `isHeadOfFamily` is true, the family total equals
the owner total — skip Level 1 to avoid redundancy.

### Closed account display

```typescript
// Inside account row rendering:
if (account.isClosed) {
  // Show "CLOSED" badge instead of portfolio value
  // Gray out the row
  // Still allow tap → navigate to Level 3 (closed data is still viewable up to closure date)
}

// Owner total: totalValue already excludes closed accounts (server sums only non-zero values)
// No special handling needed for owner.totalValue
```

### Status badge colors

```typescript
const statusColor = {
  active:  '#10B981',   // green
  closed:  '#6B7280',   // gray
  pending: '#F59E0B',   // amber
  dormant: '#6B7280',   // gray
}
```

### Portfolio value formatting

Use Indian numbering format (lakhs / crores):
```typescript
function formatINR(value: number): string {
  return `₹${Math.round(value).toLocaleString('en-IN')}`
}
// 3500000 → "₹35,00,000"
// 17800000 → "₹1,78,00,000"
```

---

## Edge Cases

| Situation | Behaviour |
|-----------|-----------|
| `owners` array is empty | Show "No accounts found" empty state |
| All accounts under an owner are closed | Still show owner card, mark all accounts as closed, show totalValue as 0 |
| Single owner, single account | Skip owner card grouping — show just one account card directly |
| `portfolioValue` is 0 but `isClosed` is false | Account is onboarded but not yet funded — show "Pending" status |
| `lastUpdated` is null | Show "—" instead of a date |
| `isHeadOfFamily` false but multiple accounts exist | Show accounts flat (no owner grouping needed — all accounts belong to the same person) |

---

## Pull-to-Refresh

Refresh the snapshot on pull-to-refresh. This is the only call needed —
the snapshot provides all home screen data in one request.

```typescript
const [refreshing, setRefreshing] = useState(false)

const onRefresh = async () => {
  setRefreshing(true)
  await fetchSnapshot()
  setRefreshing(false)
}

<ScrollView refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}>
```
