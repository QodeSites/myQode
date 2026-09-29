// Creates the app-analytics tables (database/migrations/007_app_analytics.sql).
//   node scripts/migrate-app-analytics.mjs          → shows which tables exist
//   node scripts/migrate-app-analytics.mjs --apply  → runs the SQL (one transaction, IF NOT EXISTS)
import pg from 'pg'
import fs from 'fs'
import dotenv from 'dotenv'

dotenv.config({ path: '.env' })
const SQL = fs.readFileSync(new URL('../database/migrations/007_app_analytics.sql', import.meta.url), 'utf8')
const TABLES = ['auth_events']

const c = new pg.Client({
  host: process.env.PG_HOST, user: process.env.PG_USER, password: process.env.PG_PASSWORD,
  database: process.env.PG_DATABASE, port: process.env.PG_PORT ? +process.env.PG_PORT : 5432,
})
await c.connect()
const exists = async () => {
  const out = {}
  for (const t of TABLES) out[t] = !!(await c.query(`SELECT to_regclass('public.' || $1) AS t`, [t])).rows[0].t
  return out
}

console.log('before:', await exists())
if (process.argv.includes('--apply')) {
  await c.query(SQL)
  console.log('after: ', await exists())
} else {
  console.log('dry run. Pass --apply to create the missing tables.')
}
await c.end()
