// POST /api/mobile/engagement/feedback — "Your Voice Matters" (the old app's feedback form).
// Body: { recommend, satisfaction, clarity, ease: 1–5 (all required), comment?: string ≤ 2000, appVersion?, platform? }
//   recommend    How likely are you to recommend Qode?
//   satisfaction Overall satisfaction with Qode?
//   clarity      Clarity and usefulness of portfolio updates and review calls?
//   ease         Ease of key processes: onboarding, top-ups, withdrawals?
// Stored in client_feedback (main DB, created on first use) and emailed to Investor Relations the same way as the other
// IR mails (lib/mobileIrMail.ts: MOBILE_IR_EMAIL_OVERRIDE redirects while testing). A failed email does not lose the
// feedback: the row is stored first and the email is best-effort.
// Reviewer accounts: accepted, nothing stored or sent. View-only (partner) and impersonation tokens: 403.
import { NextRequest, NextResponse } from 'next/server'
import { verifyMobileAuth } from '@/lib/mobileAuth'
import { query } from '@/lib/db'
import { IR_EMAIL, irRecipient, irSubject } from '@/lib/mobileIrMail'
import { ensureFeedbackTable } from '@/lib/clientFeedback'

export const dynamic = 'force-dynamic'

const QUESTIONS: [key: 'recommend' | 'satisfaction' | 'clarity' | 'ease', label: string][] = [
  ['recommend', 'How likely are you to recommend Qode?'],
  ['satisfaction', 'Overall satisfaction with Qode?'],
  ['clarity', 'Clarity and usefulness of portfolio updates and review calls?'],
  ['ease', 'Ease of key processes: onboarding, top-ups, withdrawals?'],
]
const esc = (s: string) => s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!))
const short = (v: unknown, n: number) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, n) : null)

export async function POST(request: NextRequest) {
  const { user, error } = await verifyMobileAuth(request)
  if (error) return error
  const u = user!
  if (u.isReviewer) return NextResponse.json({ ok: true, success: true })
  if (u.viewOnly || u.isImpersonated) {
    return NextResponse.json({ error: 'Feedback can only be sent by the investor themselves.', code: 'VIEW_ONLY' }, { status: 403 })
  }

  let body: any
  try { body = await request.json() } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }
  const ratings = {} as Record<(typeof QUESTIONS)[number][0], number>
  for (const [k] of QUESTIONS) {
    const v = Number(body?.[k])
    if (!Number.isInteger(v) || v < 1 || v > 5) return NextResponse.json({ error: `Please rate every question from 1 to 5 (${k}).`, field: k }, { status: 400 })
    ratings[k] = v
  }
  const comment = typeof body?.comment === 'string' ? body.comment.trim() : ''
  if (comment.length > 2000) return NextResponse.json({ error: 'Please keep it under 2000 characters.', field: 'comment' }, { status: 400 })
  const platform = short(body?.platform, 20)
  const appVersion = short(body?.appVersion, 40)
  const accounts = u.accountCodes || []
  const clientCode = u.clientCode || u.clientId || null

  let id: number
  try {
    await ensureFeedbackTable()
    const r = await query(
      `INSERT INTO client_feedback (email, client_code, account_codes, recommend, satisfaction, clarity, ease, comment, platform, app_version)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING id`,
      [u.email || null, clientCode, accounts, ratings.recommend, ratings.satisfaction, ratings.clarity, ratings.ease, comment || null, platform, appVersion])
    id = Number(r.rows[0].id)
  } catch (e) {
    console.error('[mobile/engagement/feedback] store', e)
    return NextResponse.json({ error: 'Could not send your feedback. Please try again.' }, { status: 500 })
  }

  // Investor Relations email (best-effort), the same /api/send-email path and switches as the other IR mails.
  const primary = accounts.find(c => /^[A-Z]{3}\d+$/i.test(c)) || accounts[0] || clientCode || 'N/A'
  const rows = QUESTIONS.map(([k, label]) => `<p><strong>${label}</strong> ${ratings[k]} / 5</p>`).join('')
  const html = `
    <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;padding:20px;background:#EFECD3">
      <div style="background:#02422B;padding:16px;border-radius:8px;margin-bottom:16px;text-align:center">
        <h1 style="margin:0;color:#DABD38;font-family:Georgia,serif">Your Voice Matters: Feedback</h1>
      </div>
      <div style="background:#fff;padding:16px;border:1px solid #37584F;border-radius:8px">
        <p><strong>Submitted via:</strong> myQode Mobile App${platform ? ' (' + esc(platform) + (appVersion ? ' ' + esc(appVersion) : '') + ')' : ''}</p>
        <p><strong>Date:</strong> ${new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })}</p>
        <div style="background:#EFECD3;padding:12px;border-left:4px solid #DABD38;margin:12px 0">
          <p><strong>Investor:</strong> ${esc(String(clientCode ?? '—'))}</p>
          <p><strong>Email:</strong> ${esc(u.email || '—')}</p>
          <p><strong>Accounts:</strong> ${esc(accounts.join(', ') || '—')}</p>
          ${rows}
          <p><strong>What could we do better?</strong></p>
          <p>${comment ? esc(comment).replace(/\n/g, '<br/>') : '<em>No comment</em>'}</p>
        </div>
      </div>
    </div>`
  try {
    const base = process.env.NEXT_PUBLIC_BASE_URL || process.env.NEXTAUTH_URL?.trim() || 'http://localhost:2069'
    const res = await fetch(`${base}/api/send-email`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        to: irRecipient(),
        subject: irSubject(`New Feedback from ${primary} (recommend ${ratings.recommend}/5)`),
        html,
        from: IR_EMAIL,
        fromName: 'Qode Investor Relations',
        inquiry_type: 'feedback',
        nuvama_code: primary,
        client_id: u.clientId ?? '',
        user_email: u.email || IR_EMAIL,
        priority: 'normal',
        feedback_id: id,
        'How likely are you to recommend Qode? (1-5)': String(ratings.recommend),
        'Overall satisfaction with Qode? (1-5)': String(ratings.satisfaction),
        'Clarity/usefulness of portfolio updates & review calls? (1-5)': String(ratings.clarity),
        'Ease of key processes (onboarding, top-ups, withdrawals)? (1-5)': String(ratings.ease),
        'What could we do better?': comment,
      }),
    })
    if (!res.ok) console.warn('[mobile/engagement/feedback] send-email answered', res.status)
  } catch (e) {
    console.warn('[mobile/engagement/feedback] email failed:', (e as any)?.message)
  }

  return NextResponse.json({ ok: true, success: true, id })
}
