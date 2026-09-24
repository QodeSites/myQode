# QA Test Plan — Razorpay Payments

**Everything is in TEST mode. No real money can move.** Card details, UPI IDs and
bank logins below are Razorpay's own sandbox values.

---

## Before you start

| | |
|---|---|
| **URL** | `http://localhost:3000` (or the staging URL, if given one) |
| **Login** | `test@razorpay.com` / `RazorPay@123` |
| **Where to pay** | Dashboard → **Account Services** → **Add Funds / SIP** |
| **Payment methods** | Net Banking and UPI **only** — cards and wallets are intentionally disabled |
| **Amount limits** | Minimum **₹100**, maximum **₹5,00,000** |

### Razorpay test credentials

| Purpose | Value |
|---|---|
| UPI — payment succeeds | `success@razorpay` |
| UPI — payment fails | `failure@razorpay` |
| Net Banking | Pick any bank, then click **Success** or **Failure** on the simulator page |
| OTP, if asked | `1234` |

---

## What to log for every bug

Please include all five — without them a bug usually can't be traced:

1. **What you did** (the exact steps)
2. **What you expected** vs **what happened**
3. **The amount** and **strategy** you chose
4. **The Razorpay payment ID** (`pay_...`) or order ID (`order_...`) if one was shown
5. **A screenshot**, including the browser URL bar

---

## Section 1 — One-time payment (Add Funds)

### 1.1 Successful payment
1. Log in, go to **Add Funds / SIP**
2. Choose a strategy, enter **₹1,000**
3. Review the summary — check the strategy and amount are what you entered
4. Continue to Razorpay, pay with UPI `success@razorpay`
5. **Expected:** you return to a success page showing the amount and a reference number

### 1.2 Failed payment
Same as above, but pay with `failure@razorpay`.
**Expected:** a clear failure message, an option to retry, and **no** success page.

### 1.3 Cancelled payment
Start a payment, then close the Razorpay window without paying.
**Expected:** you return to the app with a neutral message. Nothing is recorded as paid.

### 1.4 Amount validation
Try each and confirm you are blocked with a helpful message, not a crash:

| Input | Expected |
|---|---|
| ₹50 (below minimum) | Rejected — minimum is ₹100 |
| ₹6,00,000 (above maximum) | Rejected — maximum is ₹5,00,000 |
| ₹0 | Rejected |
| Negative, e.g. −500 | Rejected |
| Letters, e.g. `abc` | Rejected or not accepted by the field |
| ₹1,000.50 (decimal) | Either accepted correctly, or rejected clearly |
| Blank | Rejected |

### 1.5 Payment methods
On the Razorpay window, confirm **only Net Banking and UPI** appear.
**If you see cards, wallets, EMI or Pay Later, that is a bug — please report it.**

### 1.6 Double submission
Click **Pay** twice quickly, or refresh the page mid-payment.
**Expected:** you are never charged twice, and only one transaction appears.

---

## Section 2 — SIP (recurring payments)

SIP sets up a **mandate** — an instruction to collect automatically in future.
It behaves differently from a one-time payment, so please test it separately.

### 2.1 Create a SIP
1. **Add Funds / SIP** → switch to the **SIP** tab
2. Choose a strategy, an amount, and a frequency (monthly is the common case)
3. Choose a start date
4. Complete the mandate authorisation with UPI `success@razorpay`
5. **Expected:** a confirmation page showing the amount, frequency and next date

### 2.2 SIP date validation
- A start date **in the past** → should be rejected
- A start date **far in the future** (e.g. 2 years) → note what happens
- **Today's date** → note whether it is allowed

### 2.3 SIP failure
Repeat 2.1 with `failure@razorpay`.
**Expected:** clear failure, and **no** active SIP is created.

---

## Section 3 — Things that often break

### 3.1 Browser back button
Press **Back** immediately after a successful payment.
**Expected:** no duplicate payment, no confusing state.

### 3.2 Refresh the success page
Reload the success page.
**Expected:** it still shows correctly, or redirects somewhere sensible. It must
not show an error or create a second transaction.

### 3.3 Slow or dropped connection
Using browser DevTools → Network → **Slow 3G**, start a payment. Optionally go
offline mid-payment.
**Expected:** a clear message. The worst outcome is a page that appears to
succeed when it did not.

### 3.4 Mobile
Repeat **1.1** and **2.1** on a phone, or DevTools device mode at 375px width.
Check: nothing is cut off, buttons are tappable, the Razorpay window fits.

### 3.5 Two tabs
Open the payment page in two tabs and start a payment in each.
**Expected:** no crossed-over amounts or references.

---

## Section 4 — Please confirm these read correctly

Not bugs exactly, but worth flagging if confusing:

- Is it clear how much will be debited **before** you confirm?
- Does the success page tell you what happens next?
- Are error messages understandable to an investor, or do they show codes?
- On SIP: is it clear when the **next** payment will be taken?

---

## What is out of scope

- **Real money** — everything is sandbox; do not use a real card or bank login
- **The fees/distributor pages** — separate feature, not part of this round
- **Cashfree payments** — the older gateway, being replaced; ignore anything Cashfree

---

## If you get stuck

- **Payment window won't open** → hard refresh (Ctrl+Shift+R), then retry
- **Page hangs or spins forever** → screenshot it and report; likely a real bug
- **Login fails** → confirm the credentials above; ask before retrying repeatedly

Report anything that looks wrong, even if you are unsure. A false alarm costs a
minute; a missed bug reaches an investor.
