import mysql from 'mysql2/promise';
import { config, mysqlOptions } from './config.js';

const baseOptions = mysqlOptions({
  charset: 'utf8mb4',
  timezone: 'Z',
  waitForConnections: true,
  connectionLimit: config.database.connectionLimit,
  maxIdle: config.database.connectionLimit,
  idleTimeout: 60_000,
  enableKeepAlive: true,
});

export const db = mysql.createPool(baseOptions);

export async function closeDatabase() {
  await db.end();
}
