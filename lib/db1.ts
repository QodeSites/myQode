import { Pool, QueryResult } from "pg";

// Singleton guard — prevents new Pool instances on every Next.js hot-reload.
declare global {
  // eslint-disable-next-line no-var
  var _pgPool1: Pool | undefined;
}

function createPool() {
  const p = new Pool({
    user:     process.env.PG_USER,
    host:     process.env.PG_HOST,
    database: process.env.PG_DATABASE1,
    password: process.env.PG_PASSWORD,
    port:     process.env.PG_PORT ? parseInt(process.env.PG_PORT, 10) : 5432,
    max:                     3,
    idleTimeoutMillis:       20_000,
    connectionTimeoutMillis: 8_000,
  });

  p.on('error', (err) => {
    console.error('[db1] unexpected pool error:', err);
  });

  return p;
}

const pool: Pool = global._pgPool1 ?? createPool();
if (process.env.NODE_ENV !== 'production') global._pgPool1 = pool;

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