import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { runMigrations, splitStatements } from '../src/migrate.js';
import pool from '../src/db.js';

const migrationUrl = new URL('../src/migrations/001_initial_schema.sql', import.meta.url);

test('initial migration contains all required application tables', async () => {
  const migration = await readFile(migrationUrl, 'utf8');
  const statements = splitStatements(migration);
  const tableNames = statements.map((statement) => {
    const match = statement.match(/^CREATE TABLE IF NOT EXISTS ([a-z_]+) \(/i);
    assert.ok(match, `Expected a CREATE TABLE statement, received: ${statement.slice(0, 60)}`);
    return match[1];
  });

  assert.deepEqual(tableNames, [
    'users',
    'students',
    'learned_words',
    'ai_providers',
    'stories',
    'story_generation_jobs',
    'story_generation_attempts',
    'activity_logs',
  ]);
});

test('initial migration enforces student ownership and scheduled-story uniqueness', async () => {
  const migration = await readFile(migrationUrl, 'utf8');

  assert.match(migration, /FOREIGN KEY \(teacher_id\) REFERENCES users \(id\)/);
  assert.match(migration, /UNIQUE KEY uq_story_job_student_schedule \(student_id, scheduled_for\)/);
  assert.match(migration, /UNIQUE KEY uq_story_job_student_schedule_date \(student_id, schedule_date\)/);
  assert.match(migration, /UNIQUE KEY uq_story_attempt_number \(job_id, attempt_number\)/);
});

test('migration statement splitter does not emit empty statements', () => {
  assert.deepEqual(splitStatements('CREATE TABLE a (id INT);\n\nCREATE TABLE b (id INT);\n'), [
    'CREATE TABLE a (id INT)',
    'CREATE TABLE b (id INT)',
  ]);
});

test('database migrations apply once and can be safely rerun', async (context) => {
  const originalQuery = pool.query;
  const appliedMigrations = new Set();
  const createdTables = [];

  pool.query = async (sql, values = []) => {
    if (sql.includes('SELECT name FROM schema_migrations')) {
      return [[...appliedMigrations].map((name) => ({ name })), []];
    }
    if (sql.includes('INSERT INTO schema_migrations')) {
      appliedMigrations.add(values[0]);
      return [{ affectedRows: 1 }, []];
    }
    const table = sql.match(/^CREATE TABLE IF NOT EXISTS (users|students|learned_words|ai_providers|stories|story_generation_jobs|story_generation_attempts|activity_logs) \(/);
    if (table) createdTables.push(table[1]);
    return [{ affectedRows: 1 }, []];
  };
  context.after(() => {
    pool.query = originalQuery;
  });

  await runMigrations();
  await runMigrations();
  assert.equal(appliedMigrations.size, 1);
  assert.equal(createdTables.length, 8);
});
