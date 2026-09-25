// Test-only redirect for the mobile auth emails (forgot-password link, password-setup OTP).
//
// MOBILE_AUTH_EMAIL_OVERRIDE=<address>[,<address>…] sends every such email there instead of the client, with the
// intended recipient named in the subject. It exists so the team can test these flows with REAL client accounts
// without the client ever receiving anything.
//
// The mobile app in TEST_MODE marks its request with { testRedirect: true }. When that flag is present and no
// override is configured, the route refuses to send (mailPlan().refuse) — so a test build can never mail a real
// client by accident, even against a server that forgot the override. Production builds never send the flag and
// production servers never set the override: behaviour there is unchanged.
const splitList = (v: string | undefined) => (v || '').split(',').map((s) => s.trim()).filter(Boolean)

export function mailPlan(clientEmail: string, testRedirect: unknown): { to: string[]; subjectPrefix: string; refuse: string | null } {
  const override = splitList(process.env.MOBILE_AUTH_EMAIL_OVERRIDE)
  if (override.length) return { to: override, subjectPrefix: `[TEST · for ${clientEmail}] `, refuse: null }
  if (testRedirect === true) {
    return {
      to: [],
      subjectPrefix: '',
      refuse: 'Test mode: this server has no MOBILE_AUTH_EMAIL_OVERRIDE, so the email was not sent (it would have reached the real client).',
    }
  }
  return { to: [clientEmail], subjectPrefix: '', refuse: null }
}
