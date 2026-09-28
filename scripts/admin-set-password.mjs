// Set (or reset) a backoffice admin's password from the command line.
//   ADMIN_PASSWORD='…' node scripts/admin-set-password.mjs someone@qodeinvest.com "Their Name"
// The email must also be listed in BACKOFFICE_ADMINS for the account to work.
import pg from 'pg'
import bcrypt from 'bcryptjs'
import fs from 'fs'

const env = Object.fromEntries(fs.readFileSync(new URL('../.env', import.meta.url), 'utf8').split('\n')
  .filter(l => /^[A-Z0-9_]+=/.test(l)).map(l => { const i = l.indexOf('='); return [l.slice(0, i), l.slice(i + 1).replace(/^["']|["']$/g, '')] }))
const [email, name] = process.argv.slice(2)
const password = process.env.ADMIN_PASSWORD
if (!email || !password) { console.error('Usage: ADMIN_PASSWORD=… node scripts/admin-set-password.mjs <email> [name]'); process.exit(1) }
const c = new pg.Client({ user: env.PG_USER, host: env.PG_HOST, database: env.PG_DATABASE, password: env.PG_PASSWORD, port: +env.PG_PORT })
await c.connect()
await c.query(`CREATE TABLE IF NOT EXISTS admin_users (email text PRIMARY KEY, name text, password text, password_set_at timestamptz,
  last_login_at timestamptz, failed_attempts int NOT NULL DEFAULT 0, locked_until timestamptz, created_at timestamptz NOT NULL DEFAULT now())`)
await c.query(`INSERT INTO admin_users (email, name, password, password_set_at) VALUES ($1, $2, $3, now())
  ON CONFLICT (email) DO UPDATE SET password = EXCLUDED.password, password_set_at = now(), failed_attempts = 0, locked_until = NULL,
  name = COALESCE(EXCLUDED.name, admin_users.name)`, [email.trim().toLowerCase(), name || null, await bcrypt.hash(password, 12)])
console.log('Password set for', email)
await c.end()
