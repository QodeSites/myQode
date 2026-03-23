# Admin Master View — Frontend Prompt

## Overview

When the logged-in user is `karan@qodeinvest.com`, the app must show a special **Admin Master View** that lets Karan browse all client accounts and impersonate any one of them, seeing the app exactly as that client would.

This feature is **only active when `user.isSuperAdmin === true`** in the JWT payload. No other user ever sees this UI.

---

## Auth Flow

### 1. Login response (existing `POST /api/mobile/auth/login`)
```json
{
  "token": "eyJ...",
  "expiresIn": 2592000,
  "user": {
    "clientId": "...",
    "clientCode": "...",
    "name": "Karan ...",
    "email": "karan@qodeinvest.com",
    "accountCodes": ["..."],
    "isHeadOfFamily": true,
    "isSuperAdmin": true          // ← flag to enable admin UI
  }
}
```

### 2. After login — detect super admin
```typescript
if (user.isSuperAdmin) {
  // Redirect to AdminMasterScreen instead of normal HomeScreen
}
```

### 3. Impersonate a client (`POST /api/mobile/admin/impersonate`)
**Request:**
```json
{ "clientCode": "QAW0009" }
```
**Response:**
```json
{
  "token": "eyJ...",               // NEW JWT scoped to this client
  "expiresIn": 14400,              // 4 hours
  "user": {
    "clientId": "14410001",
    "clientCode": "QAW0009",
    "name": "Ravi Sharma",
    "email": "ravi@example.com",
    "accountCodes": ["QAW0009", "QTF0003"],
    "isHeadOfFamily": true,
    "isImpersonated": true,
    "impersonatedBy": "karan@qodeinvest.com",
    "onboardingStatus": "completed"
  }
}
```
Store this token in SecureStore as `impersonation_token`. All portfolio API calls must use this token when impersonating.

### 4. Exiting impersonation
Delete `impersonation_token` from SecureStore and revert to the original Karan token. Navigate back to AdminMasterScreen.

---

## Screens to Build

### Screen 1: `AdminMasterScreen`

**Purpose:** Entry point for Karan. Shows all client accounts with search and filters.

**Navigation:** Replaces the normal home screen when `isSuperAdmin === true`.

**API:** `GET /api/mobile/admin/clients?search=&page=1&limit=50`

**Headers:** `Authorization: Bearer {karanToken}`

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
      "onboardingStatus": "completed",   // "completed" | "pending" | "mixed"
      "loginCount": 42,
      "lastLogin": "2025-01-15T10:30:00Z",
      "accounts": [
        {
          "clientId": "14410001",
          "clientCode": "QAW0009",
          "name": "Ravi Sharma",
          "onboardingStatus": "completed",
          "isHeadOfFamily": true,
          "loginCount": 38,
          "lastLogin": "2025-01-15T10:30:00Z"
        },
        {
          "clientId": "14410002",
          "clientCode": "QTF0003",
          "name": "Ravi Sharma",
          "onboardingStatus": "completed",
          "isHeadOfFamily": false,
          "loginCount": 4,
          "lastLogin": "2025-01-10T14:00:00Z"
        }
      ]
    }
  ],
  "pagination": {
    "page": 1,
    "limit": 50,
    "total": 248,
    "totalPages": 5
  }
}
```

**UI Layout:**
```
┌─────────────────────────────────────┐
│  🛡️  Admin Master View               │
│  Logged in as karan@qodeinvest.com  │
├─────────────────────────────────────┤
│  🔍 Search clients...               │
├─────────────────────────────────────┤
│  Filters: [All ▼]  [248 clients]    │
├─────────────────────────────────────┤
│  ┌───────────────────────────────┐  │
│  │ 👤 Ravi Sharma                │  │
│  │ ravi@example.com              │  │
│  │ QAW0009 · QTF0003             │  │
│  │ ✅ Completed · 42 logins      │  │
│  │ Last: Jan 15, 2025            │  │
│  │              [View as Client] │  │
│  └───────────────────────────────┘  │
│  ┌───────────────────────────────┐  │
│  │ 👤 Priya Patel                │  │
│  │ priya@example.com             │  │
│  │ QGF0012                       │  │
│  │ ⏳ Pending · 0 logins         │  │
│  │              [View as Client] │  │
│  └───────────────────────────────┘  │
└─────────────────────────────────────┘
```

**Component details:**

- Search bar: debounced 300ms, sends `?search=` query param
- Filter dropdown: All / Completed / Pending / Mixed
- Each card shows: name, email, account codes (chips), status badge, login count, last login
- Tap card → expand to show individual accounts (if multiple)
- "View as Client" button → if multiple accounts in group, show bottom sheet picker first; if single account, impersonate directly
- Infinite scroll or pagination (Load More button)
- Pull-to-refresh
- Total count in header

---

### Screen 2: `AccountPickerBottomSheet` (shown when owner has multiple accounts)

```
┌─────────────────────────────────────┐
│  Select Account to View             │
│  Ravi Sharma                        │
├─────────────────────────────────────┤
│  ○ QAW0009 — Qode All Weather       │
│    Head of Family · 38 logins       │
│                                     │
│  ○ QTF0003 — Qode Tactical Fund     │
│    38 logins                        │
├─────────────────────────────────────┤
│  [ Impersonate as Head of Family ]  │
│  (gets access to ALL accounts)      │
└─────────────────────────────────────┘
```

When "Head of Family" is selected, use `headClientCode`. Otherwise use the specific account's `clientCode`.

---

### Screen 3: Active impersonation — `ImpersonationBanner`

When `isImpersonated === true` in the stored user context, show a persistent banner at the top of every screen:

```
┌─────────────────────────────────────┐
│ 👁️ Viewing as: Ravi Sharma          │
│ QAW0009 · QTF0003      [Exit View]  │
└─────────────────────────────────────┘
```

- Banner color: amber/warning tone to make it obvious
- "Exit View" → clears impersonation token, restores Karan's token, navigates back to AdminMasterScreen
- Banner should be visible on all screens (Portfolio, Documents, Services, etc.)

---

## Token Management

```typescript
// SecureStore keys
const KARAN_TOKEN_KEY = 'auth_token'         // Karan's original JWT
const IMPERSONATION_TOKEN_KEY = 'impersonation_token'

// Which token to use for API calls:
async function getActiveToken(): Promise<string> {
  const impToken = await SecureStore.getItemAsync(IMPERSONATION_TOKEN_KEY)
  if (impToken) return impToken
  return await SecureStore.getItemAsync(KARAN_TOKEN_KEY) ?? ''
}

// Start impersonation:
async function startImpersonation(clientCode: string) {
  const res = await fetch('/api/mobile/admin/impersonate', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${await SecureStore.getItemAsync(KARAN_TOKEN_KEY)}`,
    },
    body: JSON.stringify({ clientCode }),
  })
  const data = await res.json()
  await SecureStore.setItemAsync(IMPERSONATION_TOKEN_KEY, data.token)
  // Store impersonated user profile in state/context
  setImpersonatedUser(data.user)
}

// Exit impersonation:
async function exitImpersonation() {
  await SecureStore.deleteItemAsync(IMPERSONATION_TOKEN_KEY)
  setImpersonatedUser(null)
  // Navigate back to AdminMasterScreen
}
```

---

## Auth Context Changes

Add to your `AuthContext`:

```typescript
interface AuthContextType {
  user: User | null                    // current active user (impersonated or real)
  originalUser: User | null            // karan's real user (when impersonating)
  isImpersonating: boolean
  startImpersonation: (clientCode: string) => Promise<void>
  exitImpersonation: () => void
}
```

All API calls should use `getActiveToken()` which automatically returns the impersonation token when active.

---

## API Reference Summary

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| GET | `/api/mobile/admin/clients?search=&page=&limit=` | Karan's JWT | List all client owner groups |
| POST | `/api/mobile/admin/impersonate` | Karan's JWT | Get impersonation token for a client |

---

## Security Rules

- Both admin endpoints check `isSuperAdmin === true` in the JWT — any other user gets 403
- Impersonation tokens expire in **4 hours** (vs 30 days for regular tokens)
- The impersonated JWT includes `isImpersonated: true` and `impersonatedBy: "karan@qodeinvest.com"` for audit trail
- The app should NEVER store both tokens with the same key — keep them separate in SecureStore
- On app restart, if an impersonation token exists but is expired, silently clear it and fall back to Karan's token

---

## Edge Cases

1. **Karan's own portfolios** — When NOT impersonating, Karan sees his own portfolio normally (the admin screen is the home screen; he can navigate to his portfolio from a menu item "My Portfolio")
2. **Expired impersonation token** — 4h limit; app should catch 401 from any API and call `exitImpersonation()` automatically
3. **Client with no accounts** — `accountCodes` will be empty; disable "View as Client" button and show a tooltip
4. **Search with no results** — Show empty state: "No clients found for '[query]'"
