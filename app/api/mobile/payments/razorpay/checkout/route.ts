// GET /api/mobile/payments/razorpay/checkout?orderId=order_xxx&exp=…&t=…
// A minimal hosted page that opens Razorpay Standard Checkout for one order. The mobile app shows it in a
// WebView and listens for a JSON message (success / failed / cancelled). The link is authorised by a
// short-lived HMAC token issued by create-order, so no JWT travels in the URL.
import { NextRequest, NextResponse } from 'next/server'
import pool from '@/lib/db'
import { razorpayConfig, verifyCheckoutToken } from '@/lib/razorpay'

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
  const exp = Number(q.get('exp') || 0)
  const t = q.get('t') || ''
  const ret = q.get('ret') || ''   // app return URL → system-browser (redirect) mode
  if (!orderId || !verifyCheckoutToken(orderId, exp, t)) {
    return page('<p style="font-family:sans-serif;padding:24px">This payment link has expired. Please go back and try again.</p>', 403)
  }

  const { rows } = await pool.query(
    `SELECT amount, client_name, nuvama_code, investment_status FROM payment_transactions WHERE razorpay_order_id = $1 LIMIT 1`,
    [orderId]
  )
  if (!rows.length) return page('<p style="font-family:sans-serif;padding:24px">Order not found.</p>', 404)
  const tx = rows[0]
  const cfg = razorpayConfig()
  const opts = {
    key: cfg.keyId,
    amount: Math.round(Number(tx.amount) * 100),
    currency: 'INR',
    name: 'Qode Advisors LLP',
    description: `Investment – ${tx.nuvama_code}`,
    order_id: orderId,
    prefill: { name: tx.client_name || '', email: cfg.isTest ? 'test@razorpay.com' : undefined, contact: cfg.isTest ? '9999999999' : undefined },
    notes: { nuvama_code: tx.nuvama_code, source: 'qode_mobile_app' },
    theme: { color: '#02422B' },
    // PMS top-ups: UPI and net banking only (no cards, wallets, EMI or pay-later).
    method: { upi: true, netbanking: true, card: false, wallet: false, emi: false, paylater: false, cardless_emi: false },
    config: {
      display: {
        blocks: {
          qode: { name: 'Pay using', instruments: [{ method: 'upi' }, { method: 'netbanking' }] },
        },
        sequence: ['block.qode'],
        preferences: { show_default_blocks: false },
      },
    },
    // System-browser mode: Razorpay POSTs the result to our return route, which bounces back into the app.
    ...(ret ? { redirect: true, callback_url: publicOrigin(request) + '/api/mobile/payments/razorpay/return?' + new URLSearchParams({ orderId, exp: String(exp), t, ret }).toString() } : {}),
  }

  return page(`<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Qode · Secure payment</title>
<style>body{margin:0;background:#EFECD3;font-family:-apple-system,Segoe UI,Roboto,sans-serif;color:#002017}
.c{padding:28px 20px;text-align:center}.b{display:inline-block;margin-top:18px;padding:12px 22px;border-radius:8px;background:#02422B;color:#DABD38;font-weight:700;letter-spacing:.06em;border:0;font-size:13px}
.m{color:#37584F;font-size:13px;margin-top:8px}</style></head><body>
<div class="c"><div style="font-size:22px;font-weight:600">Qode · Secure payment</div>
<div class="m">₹${esc(Number(tx.amount).toLocaleString('en-IN', { minimumFractionDigits: 2 }))} · Account ${esc(tx.nuvama_code)}${cfg.isTest ? ' · TEST MODE' : ''}</div>
<button class="b" id="pay">OPEN PAYMENT WINDOW</button><div class="m" id="s"></div></div>
<script src="https://checkout.razorpay.com/v1/checkout.js"></script>
<script>
var opts=${JSON.stringify(opts)};
function post(m){var s=JSON.stringify(m);try{if(window.ReactNativeWebView){window.ReactNativeWebView.postMessage(s);return}}catch(e){}try{window.parent.postMessage(s,'*')}catch(e){}document.getElementById('s').textContent=m.ok?'Payment received. You can go back to the app.':(m.cancelled?'Payment window closed.':('Payment failed: '+(m.error||'')));}
if(!opts.callback_url){opts.handler=function(r){post({ok:true,razorpay_order_id:r.razorpay_order_id,razorpay_payment_id:r.razorpay_payment_id,razorpay_signature:r.razorpay_signature})};}
opts.modal={ondismiss:function(){post({ok:false,cancelled:true});if(opts.callback_url){document.getElementById('s').innerHTML='Payment window closed — nothing was charged. <a href="#" onclick="rzp.open();return false">Try again</a>, or close this window to return to the app.';}},escape:true,backdropclose:false};
var rzp=new Razorpay(opts);
rzp.on('payment.failed',function(r){post({ok:false,error:(r&&r.error&&r.error.description)||'Payment failed'})});
document.getElementById('pay').onclick=function(){rzp.open()};
setTimeout(function(){try{rzp.open()}catch(e){}},300);
</script></body></html>`)
}
