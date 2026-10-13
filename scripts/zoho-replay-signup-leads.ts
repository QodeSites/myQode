// One-off: give the sign-ups whose Zoho Lead could not be created at the time (app_signups.lead_status = 'failed',
// e.g. while the write token lacked ZohoCRM.modules.leads.CREATE) their Lead now, the same way the sign-up route does
// (lib/zohoLeads.ts): search by number first, create only when the number is new, then record the id on the row.
//
//   set -a; . ./.env; set +a; npx tsx --tsconfig tsconfig.json scripts/zoho-replay-signup-leads.ts [--dry]
//
// Investor sign-ups ('investor') are skipped: an existing client is not a lead. Two Zoho calls per row at most.
import { query } from '@/lib/db'
import { normalisePhone, findLeadByPhone, createSignupLead } from '@/lib/zohoLeads'

const dry = process.argv.includes('--dry')
;(async () => {
  const rows = (await query(`SELECT id, name, email, phone, channel FROM app_signups WHERE lead_status = 'failed' ORDER BY created_at`)).rows
  console.log(rows.length, 'sign-up(s) without a lead' + (dry ? ' (dry run: nothing is written)' : ''))
  for (const r of rows) {
    const phone = normalisePhone(r.phone)
    if (!phone) { console.log(' -', r.id, r.email, 'skipped: bad number', r.phone); continue }
    if (dry) { console.log(' -', r.id, r.name, r.email, phone.e164, r.channel || ''); continue }
    try {
      let leadId = await findLeadByPhone(phone.e164, phone.number), status = 'existing'
      if (!leadId) { leadId = await createSignupLead({ name: r.name, email: r.email, phone, channel: r.channel }); status = 'created' }
      await query(`UPDATE app_signups SET lead_id = $2, lead_status = $3 WHERE id = $1`, [r.id, leadId, status])
      console.log(' -', r.id, r.name, r.email, phone.e164, '→', status, leadId)
    } catch (e: any) { console.log(' -', r.id, r.email, 'still failed:', e?.message) }
  }
  process.exit(0)
})()
