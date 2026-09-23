// GET|POST /api/mobile/payments/razorpay/return?orderId=…&exp=…&t=…&ret=<app url>&kind=order  (one-time payment)
//       or ?subId=…&exp=…&t=…&ret=<app url>&kind=sip                                          (SIP mandate)
// Razorpay Checkout's callback_url when the app opens Checkout in the system browser (redirect mode).
// Razorpay POSTs razorpay_payment_id / razorpay_order_id / razorpay_signature (or subscription_id, for SIP)
// here — or error[…] fields on failure. We record what we can, then bounce the browser back into the app
// (`ret`), which re-verifies with the server (verify / verify-sip). Authorised by the same short-lived token
// as the checkout page.
import { NextRequest, NextResponse } from 'next/server'
import pool from '@/lib/db'
import { verifyCheckoutToken, verifyPaymentSignature, verifySubscriptionSignature } from '@/lib/razorpay'

const esc = (s: unknown) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string))
// Android Chrome honours intent:// links for launching an app far more reliably than a bare custom
// scheme (exp:// or myqode://), especially at the end of a redirect chain without a fresh tap.
// exp:// → Expo Go's package; a build's own scheme needs no package (Android resolves it by scheme).
const intentUrl = (target: string) => {
  const m = target.match(/^([a-z][a-z0-9+.-]*):\/\/(.*)$/i)
  if (!m) return target
  const [, scheme, rest] = m
  const pkg = scheme === 'exp' ? 'package=host.exp.exponent;' : ''
  return `intent://${rest}#Intent;scheme=${scheme};${pkg}end`
}

// Why a 302 and not a page: Chrome only lets a page launch an app (intent:// / custom scheme) with a
// user gesture, so a landing page that meta-refreshes to the app is silently ignored — the client was
// stuck on it. A server redirect is part of the SAME navigation the client started by tapping the
// bank's button, and Chrome / ASWebAuthenticationSession honour that. If the launch still fails,
// Android follows S.browser_fallback_url to the landing page (with the big button) instead.
const jump = (ret: string | null, status: string, android: boolean, fallbackUrl: string) => {
  if (!ret || ret === 'none') return null
  // Android Chrome: a blocked intent redirect from a POST leaves the client staring at the bank's page
  // (it neither launches nor follows the fallback — seen in the trace). So Android gets the landing page
  // with the button, and the app pulls itself back via the long-poll (autoReturn). iOS keeps the 302:
  // ASWebAuthenticationSession catches the scheme at navigation time.
  if (android) return null
  const target = ret + (ret.includes('?') ? '&' : '?') + 'status=' + encodeURIComponent(status)
  const go = android ? intentUrl(target).replace(/;end$/, `;S.browser_fallback_url=${encodeURIComponent(fallbackUrl)};end`) : target
  return NextResponse.redirect(go, 302)
}

const page = (title: string, body: string, ret: string | null, status: string, android = false) => {
  // ret = 'none' → no deep link (Expo Go): the user closes the browser and the app re-checks the order.
  const target = ret && ret !== 'none' ? ret + (ret.includes('?') ? '&' : '?') + 'status=' + encodeURIComponent(status) : ''
  const go = target && android ? intentUrl(target) : target
  return new NextResponse(`<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)}</title>${go ? `<meta http-equiv="refresh" content="0;url=${esc(go)}">` : ''}
<style>body{margin:0;background:#EFECD3;font-family:-apple-system,Segoe UI,Roboto,sans-serif;color:#002017}.c{padding:36px 22px;text-align:center}.m{color:#37584F;font-size:14px;margin-top:10px}
.b{display:inline-block;margin-top:22px;padding:14px 26px;border-radius:10px;background:#02422B;color:#DABD38;font-weight:700;letter-spacing:.06em;text-decoration:none;font-size:14px}</style></head>
<body><div class="c"><div style="font-size:22px;font-weight:600">${esc(title)}</div><div class="m">${esc(body)}</div>
${go ? `<a class="b" id="go" href="${esc(target)}">RETURN TO THE APP</a><div class="m" id="h" style="display:none">If nothing happens, tap the button above${android ? '' : ', or close this window'}.</div>` : `<div class="m" style="margin-top:18px;font-weight:700">Close this window to return to the app.</div>`}
<div class="m" style="margin-top:26px;font-size:12px;color:#7a8c86">This result is already recorded — you can close this window at any time.</div></div>
<script>try{if(window.ReactNativeWebView){window.ReactNativeWebView.postMessage(JSON.stringify({ok:${status === 'success'},recheck:true,status:${JSON.stringify(status)}}))}}catch(e){}
function ping(k){try{var i=new Image();i.src=location.pathname+location.search.replace(/&?ping=[^&]*/,'')+'&ping='+k+'&_='+Date.now()}catch(e){}}
ping('shown');
${go ? `var go=${JSON.stringify(go)},alt=${JSON.stringify(target)};function j(){try{location.replace(go)}catch(e){location.href=go}}
setTimeout(j,100);setTimeout(j,900);setTimeout(function(){var h=document.getElementById('h');if(h)h.style.display='block'},1800);
document.getElementById('go').addEventListener('click',function(){ping('tap');setTimeout(function(){try{location.href=go}catch(e){}},700)});` : ''}</script></body></html>`,
    { status: 200, headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' } })
}

async function handle(request: NextRequest) {
  const q = new URL(request.url).searchParams
  const orderId = q.get('orderId') || ''
  const subId = q.get('subId') || ''
  const isSip = q.get('kind') === 'sip' || !!subId
  const id = isSip ? subId : orderId
  const exp = Number(q.get('exp') || 0)
  const t = q.get('t') || ''
  const ret = q.get('ret') || null
  const android = /android/i.test(request.headers.get('user-agent') || '')
  if (!id || !verifyCheckoutToken(id, exp, t)) {
    return page('This link has expired', 'Please go back to the app and start again.', ret, 'expired', android)
  }

  // ?ping=shown|tap: beacons from the landing page, dev trace only — tells us whether the page was actually
  // displayed and whether the client tapped the button (the browser hand-off is otherwise invisible to us).
  const ping = q.get('ping')
  if (ping) {
    if (process.env.NODE_ENV !== 'production') {
      try {
        const { appendFileSync } = await import('fs'); const { tmpdir } = await import('os'); const { join } = await import('path')
        appendFileSync(join(tmpdir(), 'razorpay-return.log'), JSON.stringify({ at: new Date().toISOString(), method: 'PING', kind: isSip ? 'sip' : 'order', id, ret, fields: { ping }, ua: request.headers.get('user-agent') }) + '\n')
      } catch {}
    }
    return new NextResponse(null, { status: 204 })
  }

  // ?shown=<status>: the landing page itself (the fallback when the app could not be launched, or a
  // revisit). Render only — the result was already recorded on the first hit.
  const shown = q.get('shown')
  if (shown) {
    const T: Record<string, [string, string]> = {
      success: [isSip ? 'SIP mandate authorised' : 'Payment received', 'Return to the app to see the confirmation.'],
      failed: [isSip ? 'SIP not set up' : 'Payment not completed', 'Nothing was charged. Return to the app to try again.'],
      cancelled: [isSip ? 'SIP not completed' : 'Payment not completed', 'Nothing was charged. Return to the app.'],
    }
    const [tt, bb] = T[shown] || ['Returning to the app', 'We will confirm the status in the app.']
    return page(tt, bb, ret, shown, android)
  }
  // Where Android lands if the app launch is refused: this same URL as a plain page — on the origin the
  // PHONE used (behind the tunnel the request itself looks like localhost, which the phone cannot open).
  const h = request.headers
  const host = h.get('x-forwarded-host') || h.get('host') || ''
  const proto = h.get('x-forwarded-proto') || (host.includes('localhost') || /^\d+\.\d+\.\d+\.\d+/.test(host) ? 'http' : 'https')
  const reqUrl = new URL(request.url)
  const origin = host ? `${proto.split(',')[0].trim()}://${host.split(',')[0].trim()}` : reqUrl.origin
  const fallback = (status: string) => { const p = new URLSearchParams(reqUrl.search); p.set('shown', status); return `${origin}${reqUrl.pathname}?${p.toString()}` }
  // Send the browser into the app (302) — or show the page when there is no deep link.
  const back = (title: string, body: string, status: string) =>
    jump(ret, status, android, fallback(status)) || page(title, body, ret, status, android)

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

  console.log('[mobile/payments/razorpay/return]', request.method, isSip ? 'SIP' : 'order', 'ct=' + (request.headers.get('content-type') || '-'), 'fields=' + Object.keys(f).join(','))
  // Dev-only trace file so the browser→server→app hand-off can be reconstructed without the terminal
  // (which fields Razorpay sent, and exactly which deep link we bounced to).
  if (process.env.NODE_ENV !== 'production') {
    try {
      const { appendFileSync } = await import('fs'); const { tmpdir } = await import('os'); const { join } = await import('path')
      appendFileSync(join(tmpdir(), 'razorpay-return.log'), JSON.stringify({ at: new Date().toISOString(), method: request.method, kind: isSip ? 'sip' : 'order', id, ret, fields: f, ua: request.headers.get('user-agent') }) + '\n')
    } catch {}
  }
  const paymentId = f.razorpay_payment_id || ''
  const signature = f.razorpay_signature || ''
  const errDesc = f['error[description]'] || f.error_description || ''
  // Razorpay posts error[reason]=payment_cancelled when the client closes Checkout; anything else
  // (payment_failed, bank decline, mandate rejected) is a real failure. The app shows different screens.
  const errReason = f['error[reason]'] || ''
  const failStatus = /cancel/i.test(errReason) ? 'cancelled' : 'failed'

  try {
    if (isSip) {
      if (paymentId && signature && verifySubscriptionSignature(subId, paymentId, signature)) {
        await pool.query(
          `UPDATE payment_transactions
           SET razorpay_payment_id = $1, razorpay_signature = $2, payment_status = 'AUTHORIZED',
               investment_status = CASE WHEN investment_status = 'PENDING_PAYMENT' THEN 'SIP_AUTHORISED' ELSE investment_status END,
               updated_at = NOW()
           WHERE razorpay_subscription_id = $3 AND gateway = 'razorpay'`,
          [paymentId, signature, subId]
        )
        return back('SIP mandate authorised', 'Taking you back to the app…', 'success')
      }
      if (errDesc) {
        await pool.query(
          `UPDATE payment_transactions SET payment_message = $1, updated_at = NOW()
           WHERE razorpay_subscription_id = $2 AND gateway = 'razorpay' AND investment_status = 'PENDING_PAYMENT'`,
          [errDesc.slice(0, 500), subId]
        )
        return back(failStatus === 'cancelled' ? 'SIP not completed' : 'SIP not set up', errDesc, failStatus)
      }
      return back('Returning to the app', 'We will confirm the SIP status in the app.', 'unknown')
    }

    if (paymentId && signature && verifyPaymentSignature(orderId, paymentId, signature)) {
      await pool.query(
        `UPDATE payment_transactions
         SET razorpay_payment_id = $1, razorpay_signature = $2, payment_status = 'AUTHORIZED',
             investment_status = CASE WHEN investment_status = 'PENDING_PAYMENT' THEN 'PAYMENT_SUCCESS' ELSE investment_status END,
             updated_at = NOW()
         WHERE razorpay_order_id = $3 AND gateway = 'razorpay'`,
        [paymentId, signature, orderId]
      )
      return back('Payment received', 'Taking you back to the app…', 'success')
    }
    if (errDesc) {
      await pool.query(
        `UPDATE payment_transactions SET payment_message = $1, updated_at = NOW()
         WHERE razorpay_order_id = $2 AND gateway = 'razorpay' AND investment_status = 'PENDING_PAYMENT'`,
        [errDesc.slice(0, 500), orderId]
      )
      return back('Payment not completed', errDesc, failStatus)
    }
  } catch (err) {
    console.error('[mobile/payments/razorpay/return]', err)
  }
  return back('Returning to the app', 'We will confirm the payment status in the app.', 'unknown')
}

export const GET = handle
export const POST = handle
