import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import mysql from 'mysql2/promise';
import { config, mysqlOptions } from '../src/config.js';

const here = dirname(fileURLToPath(import.meta.url));
const migrationsDirectory = join(here, '..', 'migrations');
const connectionOptions = mysqlOptions({
  charset: 'utf8mb4',
  timezone: 'Z',
  multipleStatements: true,
});

async function connectToDatabase() {
  try {
    return await mysql.createConnection(connectionOptions);
  } catch (error) {
    if (error?.code !== 'ER_BAD_DB_ERROR') throw error;
    const database = connectionOptions.database;
    if (!/^[a-zA-Z0-9_]+$/.test(database)) {
      throw new Error('DB_NAME may only contain letters, numbers, and underscores');
    }
    const bootstrapOptions = { ...connectionOptions };
    delete bootstrapOptions.database;
    const bootstrap = await mysql.createConnection(bootstrapOptions);
    try {
      await bootstrap.query(
        `CREATE DATABASE IF NOT EXISTS \`${database}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`,
      );
      console.log(`created database ${database}`);
    } finally {
      await bootstrap.end();
    }
    return mysql.createConnection(connectionOptions);
  }
}

const connection = await connectToDatabase();

try {
  const [[lock]] = await connection.query("SELECT GET_LOCK('procedural_terrains_schema_migrations', 30) AS acquired");
  if (lock.acquired !== 1) throw new Error('Could not acquire the database migration lock');

  await connection.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      name VARCHAR(255) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
      checksum CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
      applied_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      PRIMARY KEY (name)
    ) ENGINE=InnoDB DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci
  `);

  const files = (await readdir(migrationsDirectory))
    .filter((name) => /^\d+.*\.sql$/.test(name))
    .sort((a, b) => a.localeCompare(b));

  for (const name of files) {
    const sql = await readFile(join(migrationsDirectory, name), 'utf8');
    const checksum = createHash('sha256').update(sql).digest('hex');
    const [rows] = await connection.execute('SELECT checksum FROM schema_migrations WHERE name = ?', [name]);
    if (rows[0]) {
      if (rows[0].checksum !== checksum) throw new Error(`Applied migration ${name} has been modified`);
      console.log(`skip  ${name}`);
      continue;
    }
    console.log(`apply ${name}`);
    await connection.query(sql);
    await connection.execute('INSERT INTO schema_migrations (name, checksum) VALUES (?, ?)', [name, checksum]);
  }

  await connection.query("SELECT RELEASE_LOCK('procedural_terrains_schema_migrations')");
  console.log('Database is up to date.');
} finally {
  await connection.end();
}
