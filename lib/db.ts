import { Pool, QueryResult } from "pg";

// Singleton guard: in Next.js dev mode, modules are re-evaluated on every
// hot-reload. Without this guard, each reload creates a new Pool (up to 10
// connections each) while leaving old connections open — exhausting Postgres
// max_connections very quickly.
declare global {
  // eslint-disable-next-line no-var
  var _pgPool: Pool | undefined;
}

function createPool() {
  const p = new Pool({
    user:     process.env.PG_USER,
    host:     process.env.PG_HOST,
    database: process.env.PG_DATABASE,
    password: process.env.PG_PASSWORD,
    port:     process.env.PG_PORT ? parseInt(process.env.PG_PORT, 10) : 5432,
    // Conservative pool size — all three pools (db, db1, db2) connect to the
    // same VPS PostgreSQL process. 3 pools × 3 max = 9 connections per process
    // run, leaving headroom for stale connections from previous restarts.
    max:                     3,
    idleTimeoutMillis:       20_000,  // release idle clients after 20 s
    connectionTimeoutMillis: 8_000,   // fail fast rather than queueing forever
  });

  p.on('error', (err) => {
    console.error('[db] unexpected pool error:', err);
  });

  return p;
}

const pool: Pool = global._pgPool ?? createPool();
if (process.env.NODE_ENV !== 'production') global._pgPool = pool;

// Optionally, disable date parsing
const types = require('pg').types;
types.setTypeParser(types.builtins.DATE, (val: string) => val);

// Define the query function with TypeScript types
export const query = async <T = any>(text: string, params: any[] = []): Promise<QueryResult<T>> => {
  const start = Date.now();
  const res = await pool.query<T>(text, params);
  const duration = Date.now() - start;
  console.log("executed query", { text, duration, rows: res.rowCount });
  return res;
};

export default pool;