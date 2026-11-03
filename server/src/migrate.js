import { readdir, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import pool from './db.js';

const migrationsDirectory = fileURLToPath(new URL('./migrations/', import.meta.url));

export function splitStatements(sql) {
  return sql.split(/;\s*(?:\r?\n|$)/).map((statement) => statement.trim()).filter(Boolean);
}

export async function runMigrations() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      name VARCHAR(255) NOT NULL PRIMARY KEY,
      applied_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci
  `);

  const [appliedRows] = await pool.query('SELECT name FROM schema_migrations');
  const appliedMigrations = new Set(appliedRows.map((row) => row.name));
  const migrationFiles = (await readdir(migrationsDirectory))
    .filter((name) => /^\d+_[a-z0-9_]+\.sql$/i.test(name))
    .sort();

  for (const name of migrationFiles) {
    if (appliedMigrations.has(name)) {
      continue;
    }

    const sql = await readFile(new URL(`./migrations/${name}`, import.meta.url), 'utf8');
    for (const statement of splitStatements(sql)) {
      await pool.query(statement);
    }

    await pool.query('INSERT INTO schema_migrations (name) VALUES (?)', [name]);
    console.log(`Applied database migration: ${name}`);
  }
}
