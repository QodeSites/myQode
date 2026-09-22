// GET|POST /api/mobile/payments/razorpay/return?orderId=…&exp=…&t=…&ret=<app url>
// Razorpay Checkout's callback_url when the app opens Checkout in the system browser (redirect mode).
// Razorpay POSTs razorpay_payment_id / razorpay_order_id / razorpay_signature here (or error[…] fields on
// failure). We record what we can, then bounce the browser back into the app (`ret`), which re-verifies the
// order with the server. Authorised by the same short-lived token as the checkout page.
import { NextRequest, NextResponse } from 'next/server'
import pool from '@/lib/db'
import { verifyCheckoutToken, verifyPaymentSignature } from '@/lib/razorpay'

const esc = (s: unknown) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string))
const page = (title: string, body: string, ret: string | null, status: string) => {
  // ret = 'none' → no deep link (Expo Go): the user closes the browser and the app re-checks the order.
  const target = ret && ret !== 'none' ? ret + (ret.includes('?') ? '&' : '?') + 'status=' + encodeURIComponent(status) : ''
  return new NextResponse(`<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)}</title>${target ? `<meta http-equiv="refresh" content="0;url=${esc(target)}">` : ''}
<style>body{margin:0;background:#EFECD3;font-family:-apple-system,Segoe UI,Roboto,sans-serif;color:#002017}.c{padding:36px 22px;text-align:center}.m{color:#37584F;font-size:14px;margin-top:10px}a{color:#02422B;font-weight:700}</style></head>
<body><div class="c"><div style="font-size:22px;font-weight:600">${esc(title)}</div><div class="m">${esc(body)}</div>
${target ? `<div class="m"><a href="${esc(target)}">Return to the app</a></div>` : `<div class="m" style="margin-top:18px;font-weight:700">Close this window to return to the app.</div>`}</div>
<script>try{if(window.ReactNativeWebView){window.ReactNativeWebView.postMessage(JSON.stringify({ok:${status === 'success'},recheck:true,status:${JSON.stringify(status)}}))}}catch(e){}${target ? `setTimeout(function(){location.href=${JSON.stringify(target)}},150);` : ''}</script></body></html>`,
    { status: 200, headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' } })
}

async function handle(request: NextRequest) {
  const q = new URL(request.url).searchParams
  const orderId = q.get('orderId') || ''
  const exp = Number(q.get('exp') || 0)
  const t = q.get('t') || ''
  const ret = q.get('ret') || null
  if (!orderId || !verifyCheckoutToken(orderId, exp, t)) {
    return page('This payment link has expired', 'Please go back to the app and start the payment again.', ret, 'expired')
  }

  // Razorpay sends the result as a form POST; tolerate GET / JSON too.
  let f: Record<string, string> = {}
  try {
    const ct = request.headers.get('content-type') || ''
    if (request.method === 'POST') {
      if (ct.includes('application/json')) f = await request.json()
      else { const fd = await request.formData(); fd.forEach((v, k) => { f[k] = String(v) }) }
    }
  } catch {}
  q.forEach((v, k) => { if (!(k in f)) f[k] = v })

  console.log('[mobile/payments/razorpay/return]', request.method, 'ct=' + (request.headers.get('content-type') || '-'), 'fields=' + Object.keys(f).join(','))
  const paymentId = f.razorpay_payment_id || ''
  const signature = f.razorpay_signature || ''
  const errDesc = f['error[description]'] || f.error_description || ''

  try {
    if (paymentId && signature && verifyPaymentSignature(orderId, paymentId, signature)) {
      await pool.query(
        `UPDATE payment_transactions
         SET razorpay_payment_id = $1, razorpay_signature = $2, payment_status = 'AUTHORIZED',
             investment_status = CASE WHEN investment_status = 'PENDING_PAYMENT' THEN 'PAYMENT_SUCCESS' ELSE investment_status END,
             updated_at = NOW()
         WHERE razorpay_order_id = $3 AND gateway = 'razorpay'`,
        [paymentId, signature, orderId]
      )
      return page('Payment received', 'Taking you back to the app…', ret, 'success')
    }
    if (errDesc) {
      await pool.query(
        `UPDATE payment_transactions SET payment_message = $1, updated_at = NOW()
         WHERE razorpay_order_id = $2 AND gateway = 'razorpay' AND investment_status = 'PENDING_PAYMENT'`,
        [errDesc.slice(0, 500), orderId]
      )
      return page('Payment not completed', errDesc, ret, 'failed')
    }
  } catch (err) {
    console.error('[mobile/payments/razorpay/return]', err)
  }
  return page('Returning to the app', 'We will confirm the payment status in the app.', ret, 'unknown')
}

export const GET = handle
export const POST = handle
