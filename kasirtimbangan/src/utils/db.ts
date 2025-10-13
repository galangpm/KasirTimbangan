import mysql from "mysql2/promise";

// Create a single shared pool for the application
const pool = mysql.createPool({
  host: process.env.DB_HOST,
  port: parseInt(process.env.DB_PORT || "3306", 10),
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  waitForConnections: true,
  connectionLimit: 10,
  enableKeepAlive: true,
  keepAliveInitialDelay: 0,
});

export function getPool() {
  return pool;
}

export async function query<T = unknown>(sql: string, params: ReadonlyArray<string | number | boolean | null> = []): Promise<T[]> {
  const [rows] = await pool.query(sql, params);
  return rows as T[];
}