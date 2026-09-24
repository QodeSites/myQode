# Transaction flow reply - shortened

## SHORT - fits a 500 char field - 480 chars

Our platform is a SEBI-registered PMS (INP000008914), so the payment flow sits behind an investor login and is not publicly visible.

Demo login to walk the full flow:
https://myqode.qodeinvest.com/demo
Email: test@razorpay.com
Password: RazorPay@123

Flow: login > Add Funds/SIP > select strategy > enter amount > review > Razorpay Checkout > pay by Net Banking or UPI > confirmation.

Orders are created and signatures verified server-side. Cards/wallets are disabled by design.

## LONGER - if the field allows ~850 - 845 chars

Our platform is a SEBI-registered Portfolio Management Service (INP000008914). The payment flow sits behind an investor login, so it is not publicly visible - which is likely why it was not found during review.

Demo login to walk the complete flow:
https://myqode.qodeinvest.com/demo
Email: test@razorpay.com
Password: RazorPay@123

Steps: login > Add Funds/SIP > select strategy > enter amount > review order > Razorpay Checkout opens > pay via Net Banking or UPI > confirmation page.

Orders are created via the Razorpay Orders API server-side, and payment signatures are verified server-side before the transaction is recorded. Webhooks are configured. As a regulated PMS, investors must pay from their own registered bank accounts, so cards and wallets are deliberately disabled.

Happy to provide screenshots or a screen-share walkthrough.
