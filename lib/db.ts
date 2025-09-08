import { Pool, QueryResult } from "pg";

// Define the Pool configuration type
interface PoolConfig {
  user?: string;
  host?: string;
  database?: string;
  password?: string;
  port?: number;
}

// Create a connection pool
const pool = new Pool({
  user: process.env.PG_USER,
  host: process.env.PG_HOST,
  database: process.env.PG_DATABASE,
  password: process.env.PG_PASSWORD,
  port: process.env.PG_PORT ? parseInt(process.env.PG_PORT, 10) : 5432,
} as PoolConfig);

// Tell pg to return DATE fields as strings
pool.on('connect', (client) => {
  client.query('SET timezone = "UTC"');
});

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