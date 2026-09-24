// GET /api/mobile/payments/razorpay/checkout?orderId=order_xxx&exp=…&t=…              (one-time payment)
//  or  GET /api/mobile/payments/razorpay/checkout?subId=sub_xxx&exp=…&t=…&kind=sub     (SIP mandate)
// A minimal hosted page that opens Razorpay Standard Checkout for one order OR one subscription — Checkout.js
// takes subscription_id in place of order_id and switches into mandate-authorisation mode by itself. The app
// opens this in the system browser and returns via callback_url (kind carried through so /return knows which
// signature formula and DB column to use). The link is authorised by a short-lived HMAC token, so no JWT
// travels in the URL.
import { NextRequest, NextResponse } from 'next/server'
import pool from '@/lib/db'
import { razorpayConfig, verifyCheckoutToken, checkoutContact } from '@/lib/razorpay'

const page = (html: string, status = 200) =>
  new NextResponse(html, { status, headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' } })

const esc = (s: unknown) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string))

// The origin the PHONE used to reach us. Behind a tunnel (devtunnel / Cloudflare) or a reverse proxy the request
// itself looks like http://localhost:2069, which the phone's browser could never open after Razorpay redirects.
function publicOrigin(request: NextRequest) {
  const h = request.headers
  const host = h.get('x-forwarded-host') || h.get('host') || ''
  const proto = h.get('x-forwarded-proto') || (host.includes('localhost') || /^\d+\.\d+\.\d+\.\d+/.test(host) ? 'http' : 'https')
  return host ? `${proto.split(',')[0].trim()}://${host.split(',')[0].trim()}` : new URL(request.url).origin
}

export async function GET(request: NextRequest) {
  const q = new URL(request.url).searchParams
  const orderId = q.get('orderId') || ''
  const subId = q.get('subId') || ''
  const isSip = !!subId
  const id = isSip ? subId : orderId
  const exp = Number(q.get('exp') || 0)
  const t = q.get('t') || ''
  const ret = q.get('ret') || ''   // app return URL → system-browser (redirect) mode
  if (!id || !verifyCheckoutToken(id, exp, t)) {
    return page('<p style="font-family:sans-serif;padding:24px">This payment link has expired. Please go back and try again.</p>', 403)
  }

  const { rows } = await pool.query(
    isSip
      ? `SELECT t.amount, t.client_name, t.nuvama_code, t.frequency, t.investment_status, t.account_number, t.ifsc_code,
                c.email AS client_email, right(regexp_replace(coalesce(c.mobile, ''), '\\D', '', 'g'), 10) AS client_phone
           FROM payment_transactions t LEFT JOIN pms_clients_master c ON c.clientcode = t.nuvama_code
          WHERE t.razorpay_subscription_id = $1 LIMIT 1`
      : `SELECT t.amount, t.client_name, t.nuvama_code, t.investment_status,
                c.email AS client_email, right(regexp_replace(coalesce(c.mobile, ''), '\\D', '', 'g'), 10) AS client_phone
           FROM payment_transactions t LEFT JOIN pms_clients_master c ON c.clientcode = t.nuvama_code
          WHERE t.razorpay_order_id = $1 LIMIT 1`,
    [id]
  )
  if (!rows.length) return page(`<p style="font-family:sans-serif;padding:24px">${isSip ? 'SIP' : 'Order'} not found.</p>`, 404)
  const tx = rows[0]
  const cfg = razorpayConfig()
  const callbackUrl = ret
    ? publicOrigin(request) + '/api/mobile/payments/razorpay/return?' + new URLSearchParams({
        ...(isSip ? { subId: id } : { orderId: id }), exp: String(exp), t, ret, kind: isSip ? 'sip' : 'order',
      }).toString()
    : ''
  const opts: any = {
    key: cfg.keyId,
    name: 'Qode Advisors LLP',
    description: isSip ? `SIP – ${tx.nuvama_code} (${tx.frequency})` : `Investment – ${tx.nuvama_code}`,
    prefill: {
      ...checkoutContact(tx.client_name || '', tx.client_email, tx.client_phone),
      // SIP: the registered bank account (setup-sip stored it on the row) — the mandate form opens filled in,
      // on the right bank, so the client only authorises. Nothing on file → the form is blank.
      ...(isSip && tx.account_number && tx.ifsc_code ? {
        method: 'emandate',
        bank: String(tx.ifsc_code).slice(0, 4),
        bank_account: { account_number: String(tx.account_number), ifsc: String(tx.ifsc_code), name: tx.client_name || '' },
      } : {}),
    },
    notes: { nuvama_code: tx.nuvama_code, source: 'qode_mobile_app' },
    theme: { color: '#02422B' },
    // One-time payments: restricted to UPI + net banking (no cards/wallets/EMI) — proven working.
    // SIP mandates need a RECURRING-capable method (UPI Autopay or card e-mandate; plain netbanking generally
    // does not support recurring authorisation). Forcing the same upi+netbanking-only block here left nothing
    // valid on this test account ("No appropriate payment method found") — so for SIP we let Checkout offer
    // whatever recurring methods are actually enabled, instead of guessing which one that is.
    ...(isSip ? {
      // Recurring methods only, and no cards (Qode does not accept card payments): UPI Autopay + e-mandate
      // (eNACH on the client's bank account). Only the method toggles — a forced display block is what
      // produced "No appropriate payment method found" when the account had none of the listed methods.
      // RAZORPAY_SIP_ALLOW_CARD=1 (test only): a card subscription goes `active` at authorisation, which is
      // the only way to exercise Pause/Resume in test mode — e-mandate stays `created/authenticated` until
      // Razorpay's scheduled first debit. Qode does not accept cards; never set this in production.
      method: { upi: true, emandate: true, card: process.env.RAZORPAY_SIP_ALLOW_CARD === '1' && cfg.isTest, netbanking: false, wallet: false, emi: false, paylater: false, cardless_emi: false },
    } : {
      method: { upi: true, netbanking: true, card: false, wallet: false, emi: false, paylater: false, cardless_emi: false },
      config: {
        display: {
          blocks: { qode: { name: 'Pay using', instruments: [{ method: 'upi' }, { method: 'netbanking' }] } },
          sequence: ['block.qode'],
          preferences: { show_default_blocks: false },
        },
      },
    }),
    // System-browser mode: Razorpay POSTs the result to our return route, which bounces back into the app.
    ...(callbackUrl ? { redirect: true, callback_url: callbackUrl } : {}),
    ...(isSip
      ? { subscription_id: id, recurring: true }
      : { order_id: id, amount: Math.round(Number(tx.amount) * 100), currency: 'INR' }),
  }

  return page(`<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Qode · ${isSip ? 'Set up SIP' : 'Secure payment'}</title>
<style>body{margin:0;background:#EFECD3;font-family:-apple-system,Segoe UI,Roboto,sans-serif;color:#002017}
.c{padding:28px 20px;text-align:center}.b{display:inline-block;margin-top:18px;padding:12px 22px;border-radius:8px;background:#02422B;color:#DABD38;font-weight:700;letter-spacing:.06em;border:0;font-size:13px}
.m{color:#37584F;font-size:13px;margin-top:8px}</style></head><body>
<div class="c"><div style="font-size:22px;font-weight:600">Qode · ${isSip ? 'Authorise your SIP' : 'Secure payment'}</div>
<div class="m">${isSip ? esc(String(tx.frequency).toUpperCase()) + ' · ' : ''}₹${esc(Number(tx.amount).toLocaleString('en-IN', { minimumFractionDigits: 2 }))} · Account ${esc(tx.nuvama_code)}${cfg.isTest ? ' · TEST MODE' : ''}</div>
<button class="b" id="pay">${isSip ? 'AUTHORISE SIP' : 'OPEN PAYMENT WINDOW'}</button><div class="m" id="s"></div></div>
<script src="https://checkout.razorpay.com/v1/checkout.js"></script>
<script>
var opts=${JSON.stringify(opts)};
function post(m){var s=JSON.stringify(m);try{if(window.ReactNativeWebView){window.ReactNativeWebView.postMessage(s);return}}catch(e){}try{window.parent.postMessage(s,'*')}catch(e){}document.getElementById('s').textContent=m.ok?'${isSip ? 'Mandate authorised. You can go back to the app.' : 'Payment received. You can go back to the app.'}':(m.cancelled?'Window closed.':('Failed: '+(m.error||'')));}
if(!opts.callback_url){opts.handler=function(r){post({ok:true,razorpay_payment_id:r.razorpay_payment_id,razorpay_signature:r.razorpay_signature,razorpay_order_id:r.razorpay_order_id,razorpay_subscription_id:r.razorpay_subscription_id})};}
opts.modal={ondismiss:function(){post({ok:false,cancelled:true});if(opts.callback_url){document.getElementById('s').innerHTML='Window closed — nothing was charged. <a href="#" onclick="rzp.open();return false">Try again</a>, or close this window to return to the app.';}},escape:true,backdropclose:false};
var rzp=new Razorpay(opts);
rzp.on('payment.failed',function(r){post({ok:false,error:(r&&r.error&&r.error.description)||'Payment failed'})});
document.getElementById('pay').onclick=function(){rzp.open()};
setTimeout(function(){try{rzp.open()}catch(e){}},300);
</script></body></html>`)
}
