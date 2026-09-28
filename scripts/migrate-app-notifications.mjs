// Creates the app-notification tables (database/migrations/006_app_notifications.sql).
//   node scripts/migrate-app-notifications.mjs          → shows which tables exist and what would be created
//   node scripts/migrate-app-notifications.mjs --apply  → runs the SQL (one transaction, IF NOT EXISTS)
import pg from 'pg'
import fs from 'fs'
import dotenv from 'dotenv'

dotenv.config({ path: '.env' })
const SQL = fs.readFileSync(new URL('../database/migrations/006_app_notifications.sql', import.meta.url), 'utf8')
const TABLES = ['app_push_devices', 'app_notification_campaigns', 'app_notifications', 'app_notification_prefs', 'app_notification_state']

const c = new pg.Client({
  host: process.env.PG_HOST, user: process.env.PG_USER, password: process.env.PG_PASSWORD,
  database: process.env.PG_DATABASE, port: process.env.PG_PORT ? +process.env.PG_PORT : 5432,
})
await c.connect()
const exists = async () => Object.fromEntries(await Promise.all(TABLES.map(async t =>
  [t, !!(await c.query(`SELECT to_regclass('public.' || $1) AS t`, [t])).rows[0].t])))

console.log('before:', await exists())
if (process.argv.includes('--apply')) {
  await c.query(SQL)
  console.log('after: ', await exists())
} else {
  console.log('dry run. Pass --apply to create the missing tables.')
}
await c.end()
