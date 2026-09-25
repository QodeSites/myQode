// One-off: turn a Zoho "Self Client" grant code into ZOHO_CRM_WRITE_REFRESH_TOKEN and save it in .env.
//
//   1. Zoho API Console (https://api-console.zoho.in) → the Self Client whose Client ID is ZOHO_CRM_CLIENT_ID
//      → "Generate Code" tab → Scope:  ZohoCRM.modules.custom.CREATE,ZohoCRM.modules.READ
//      → Time duration 10 minutes → Create → copy the code.
//   2. node scripts/zoho-write-token.js <code>
//
// The refresh token is written straight into .env (never printed). Only the granted scope is shown.
const fs = require('fs')
const path = require('path')
require('dotenv').config({ path: path.join(__dirname, '..', '.env') })

const code = process.argv[2]
if (!code) { console.error('Usage: node scripts/zoho-write-token.js <grant code>'); process.exit(1) }
const dc = process.env.ZOHO_CRM_DATA_CENTER || process.env.ZOHO_DATA_CENTER || 'in'

;(async () => {
  const res = await fetch(`https://accounts.zoho.${dc}/oauth/v2/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'authorization_code', code,
      client_id: process.env.ZOHO_CRM_CLIENT_ID, client_secret: process.env.ZOHO_CRM_CLIENT_SECRET,
    }),
  })
  const data = await res.json().catch(() => ({}))
  if (!data.refresh_token) {
    console.error('Zoho did not return a refresh token:', data.error || res.status,
      '\nCodes expire after the chosen duration and work once — generate a new one and run again.')
    process.exit(1)
  }
  if (!/ZohoCRM\.modules\.custom\.CREATE|ZohoCRM\.modules\.ALL/i.test(data.scope || '')) {
    console.error('The granted scope has no create permission:', data.scope, '\nRegenerate the code with ZohoCRM.modules.custom.CREATE.')
    process.exit(1)
  }
  const envPath = path.join(__dirname, '..', '.env')
  let env = fs.readFileSync(envPath, 'utf8')
  const line = `ZOHO_CRM_WRITE_REFRESH_TOKEN=${data.refresh_token}`
  env = /^ZOHO_CRM_WRITE_REFRESH_TOKEN=.*$/m.test(env)
    ? env.replace(/^ZOHO_CRM_WRITE_REFRESH_TOKEN=.*$/m, line)
    : env.replace(/\s*$/, '') + '\r\n# Create-only Zoho token for mobile switch requests (lib/zoho.ts getZohoWriteAccessToken)\r\n' + line + '\r\n'
  fs.writeFileSync(envPath, env)
  console.log('Saved ZOHO_CRM_WRITE_REFRESH_TOKEN to .env. Granted scope:', data.scope, '\nRestart the backend.')
})()
