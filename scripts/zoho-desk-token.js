// One-off: turn a Zoho "Self Client" grant code into ZOHO_DESK_REFRESH_TOKEN (lib/zohoDesk.ts) and save it in .env,
// then list the Desk organisations and departments this login sees.
//
//   1. Zoho API Console (https://api-console.zoho.in) → the Self Client whose Client ID is ZOHO_DESK_CLIENT_ID (or
//      ZOHO_CRM_CLIENT_ID when there is no separate Desk client: the code must come from the client it is exchanged on)
//      → "Generate Code" tab, signed in as a Zoho Desk agent who can create tickets → Scope:
//        Desk.tickets.CREATE,Desk.tickets.READ,Desk.contacts.READ,Desk.contacts.CREATE,Desk.basic.READ
//      → Time duration 10 minutes → Create → copy the code.
//   2. node scripts/zoho-desk-token.js <code>
//   3. Optional: set ZOHO_DESK_DEPARTMENT_ID (or ZOHO_DESK_DEPARTMENT=<name>) in .env from the list printed;
//      without it tickets go to the first department. Restart the backend.
//
// The refresh token is written straight into .env (never printed). Only the granted scope is shown.
const fs = require('fs')
const path = require('path')
require('dotenv').config({ path: path.join(__dirname, '..', '.env') })

const code = process.argv[2]
if (!code) { console.error('Usage: node scripts/zoho-desk-token.js <grant code>'); process.exit(1) }
const dc = process.env.ZOHO_DESK_DATA_CENTER || process.env.ZOHO_CRM_DATA_CENTER || process.env.ZOHO_DATA_CENTER || 'in'

;(async () => {
  const res = await fetch(`https://accounts.zoho.${dc}/oauth/v2/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'authorization_code', code,
      client_id: process.env.ZOHO_DESK_CLIENT_ID || process.env.ZOHO_CRM_CLIENT_ID, client_secret: process.env.ZOHO_DESK_CLIENT_SECRET || process.env.ZOHO_CRM_CLIENT_SECRET,
    }),
  })
  const data = await res.json().catch(() => ({}))
  if (!data.refresh_token) {
    console.error('Zoho did not return a refresh token:', data.error || res.status,
      '\nCodes expire after the chosen duration and work once — generate a new one and run again.')
    process.exit(1)
  }
  if (!/Desk\.tickets\.CREATE/i.test(data.scope || '')) {
    console.error('The granted scope cannot create Desk tickets:', data.scope, '\nRegenerate the code with the Desk scopes above.')
    process.exit(1)
  }
  const envPath = path.join(__dirname, '..', '.env')
  let env = fs.readFileSync(envPath, 'utf8')
  const line = `ZOHO_DESK_REFRESH_TOKEN=${data.refresh_token}`
  env = /^ZOHO_DESK_REFRESH_TOKEN=.*$/m.test(env)
    ? env.replace(/^ZOHO_DESK_REFRESH_TOKEN=.*$/m, line)
    : env.replace(/\s*$/, '') + '\r\n# Zoho Desk tickets for app requests (lib/zohoDesk.ts)\r\n' + line + '\r\n'
  fs.writeFileSync(envPath, env)
  console.log('Saved ZOHO_DESK_REFRESH_TOKEN to .env. Granted scope:', data.scope)

  // what this login sees in Desk
  const desk = `https://desk.zoho.${dc}/api/v1`
  const auth = { Authorization: `Zoho-oauthtoken ${data.access_token}` }
  const orgs = (await (await fetch(`${desk}/organizations`, { headers: auth })).json().catch(() => ({}))).data || []
  console.log('\nDesk organisations:'); orgs.forEach((o) => console.log(`  ${o.id}  ${o.companyName} (${o.portalName})`))
  if (orgs[0]) {
    const depts = (await (await fetch(`${desk}/departments?isEnabled=true&limit=100`, { headers: { ...auth, orgId: String(orgs[0].id) } })).json().catch(() => ({}))).data || []
    console.log(`\nDepartments in ${orgs[0].companyName}:`); depts.forEach((d) => console.log(`  ${d.id}  ${d.name}`))
  }
  console.log('\nRestart the backend.')
})()
