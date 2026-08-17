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

export function explainDatabaseStartupError(error) {
  const message = String(error?.message ?? '');
  if (error?.code !== 'AUTH_SWITCH_PLUGIN_ERROR' || !message.includes('auth_gssapi_client')) return error;

  const user = config.database.user;
  const host = config.database.host === 'localhost' ? 'localhost' : '127.0.0.1';
  const explained = new Error(
    `The MariaDB account "${user}" uses GSSAPI authentication, which mysql2 cannot load. `
      + `Change that account to password authentication, or create a dedicated password-authenticated account. `
      + `MariaDB example: ALTER USER '${user}'@'${host}' IDENTIFIED VIA mysql_native_password USING PASSWORD('your-password'); `
      + `Then put the same password in DB_PASSWORD and restart the API.`,
    { cause: error },
  );
  explained.code = 'DB_UNSUPPORTED_AUTH_PLUGIN';
  explained.fatal = true;
  return explained;
}

export async function closeDatabase() {
  await db.end();
}
