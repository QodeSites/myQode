# Reply to Razorpay — transaction flow verification

Dear Team,

Thank you for the review. Our platform is a SEBI-registered Portfolio
Management Service (Qode Advisors LLP, INP000008914), so the payment flow sits
behind an investor login rather than on a public product page — which is why the
checkout may not have been visible during your review. It is fully built and
functional.

We have set up a demonstration login so your team can walk the complete flow
end to end:

  URL       : https://myqode.qodeinvest.com/demo
  Email     : test@razorpay.com
  Password  : RazorPay@123

## The complete transaction flow

1. **Sign in** — investor logs in at the URL above.
2. **Select service** — from the dashboard, choose *Add Funds / SIP* under
   Account Services.
3. **Select product** — choose the investment strategy (Qode All Weather,
   Qode Growth Fund, or Qode Tactical Fund).
4. **Enter amount** — investor enters the investment amount. Minimum and
   maximum limits are validated in this step.
5. **Review order** — a confirmation summary shows the strategy, amount and
   account before payment.
6. **Razorpay Checkout** — our server creates the order via the Razorpay Orders
   API and Razorpay's own checkout.js widget opens for payment.
7. **Payment** — the investor completes payment via Net Banking or UPI.
8. **Confirmation** — Razorpay returns to our success page, where we verify the
   payment signature server-side (HMAC-SHA256) before the transaction is
   recorded.

## Integration details

- Orders are created server-side through the Razorpay Orders API.
- Payment signatures are verified server-side; no confirmation is trusted from
  the browser.
- Webhooks are configured and verified against the raw request body.
- Payment methods are restricted to **Net Banking and UPI** only. As a
  regulated PMS, our investors transact from their own registered bank
  accounts; cards and wallets are deliberately disabled.
- Both one-time payments and SIP (recurring mandates) are supported.

Please let us know if you need any further information, additional screenshots,
or a screen-share walkthrough with our team.

Regards,
Qode Advisors LLP
