// Runs the app-notification jobs inside the Next server (started from instrumentation.ts). Every 15 s one process
// (a lease row in app_notification_state picks the leader, so extra servers stay idle) sends due popups; receipts,
// money, reading and portfolio scans run on their own cadence. GET /api/cron/notifications runs the same tick for an
// external scheduler. All state lives in the database, so a restart picks up exactly where it stopped.
import { randomUUID } from 'crypto'
import { query } from '@/lib/db'
import { tablesReady, deliverDue, checkReceipts } from '@/lib/appNotify'
import { scanMoney, scanPortfolio, scanReading } from '@/lib/appNotifyTriggers'

const ME = randomUUID()
const TICK_MS = 15_000
const EVERY = { receipts: 5 * 60_000, money: 5 * 60_000, reading: 30 * 60_000, portfolio: 30 * 60_000, zoho: 5 * 60_000 }
const lastRun: Record<string, number> = {}

async function leader(): Promise<boolean> {
  const r = await query(
    `INSERT INTO app_notification_state (key, value, updated_at) VALUES ('worker.lease', $1, NOW())
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()
       WHERE app_notification_state.value = EXCLUDED.value OR app_notification_state.updated_at < NOW() - interval '60 seconds'
     RETURNING value`, [ME])
  return r.rows[0]?.value === ME
}

async function job(name: keyof typeof EVERY | 'deliver', fn: () => Promise<unknown>, force: boolean) {
  if (name !== 'deliver' && !force && Date.now() - (lastRun[name] || 0) < EVERY[name]) return null
  lastRun[name] = Date.now()
  try { return await fn() } catch (e: any) { console.error(`[appNotify] ${name} failed:`, e?.message || e); return { error: String(e?.message || e) } }
}

/** One pass of everything that is due. `force` runs every scanner now (the cron route). */
export async function tick(force = false) {
  if (!(await tablesReady())) return { skipped: 'tables not created yet' }
  if (!(await leader())) return { skipped: 'another process is the leader' }
  // Portfolio: only while the day's NAV has had time to land (sheet updates ~8:00 and ~11:00 IST), 9:30–20:00 IST.
  const istMin = (new Date().getUTCHours() * 60 + new Date().getUTCMinutes() + 330) % 1440
  const portfolioHours = istMin >= 570 && istMin < 1200
  // Zoho first, so a Capital Inflow synced now is announced by the money scan in the same pass
  const zoho = await job('zoho', async () => (await import('@/lib/zohoService')).syncAll(), force)
  return {
    zoho,
    money: await job('money', scanMoney, force),
    reading: await job('reading', scanReading, force),
    portfolio: portfolioHours || force ? await job('portfolio', scanPortfolio, force) : null,
    deliver: await job('deliver', deliverDue, force),
    receipts: await job('receipts', checkReceipts, force),
  }
}

declare global { var _appNotifyWorker: NodeJS.Timeout | undefined }

export function startAppNotifyWorker() {
  if (global._appNotifyWorker) return
  let busy = false
  global._appNotifyWorker = setInterval(() => {
    if (busy) return
    busy = true
    tick().catch(e => console.error('[appNotify] tick', e?.message || e)).finally(() => { busy = false })
  }, TICK_MS)
  global._appNotifyWorker.unref?.()
  console.log('[appNotify] worker started', ME)
}
