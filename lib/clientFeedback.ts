// client_feedback: the app's "Your Voice Matters" answers (POST /api/mobile/engagement/feedback), read by the
// backoffice (GET /api/admin/bo/feedback). Main DB; the table is created on first use, like lib/adminAuth.ts.
import { query } from '@/lib/db'

let ready: Promise<unknown> | null = null
export function ensureFeedbackTable() {
  if (!ready) {
    ready = query(`
      CREATE TABLE IF NOT EXISTS client_feedback (
        id bigserial PRIMARY KEY,
        email text,
        client_code text,
        account_codes text[],
        recommend int,
        satisfaction int,
        clarity int,
        ease int,
        comment text,
        platform text,
        app_version text,
        created_at timestamptz NOT NULL DEFAULT now()
      );
      CREATE INDEX IF NOT EXISTS client_feedback_created_idx ON client_feedback (created_at DESC);
    `).catch(e => { ready = null; throw e })
  }
  return ready
}
