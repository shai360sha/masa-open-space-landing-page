import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { once } from 'node:events';
import test from 'node:test';
import { createApp } from '../src/index.js';
import pool from '../src/db.js';
import { hashPassword } from '../src/security.js';

process.env.SESSION_SECRET = randomBytes(32).toString('base64url');
process.env.ENCRYPTION_KEY = randomBytes(32).toString('base64');
process.env.CLIENT_ORIGIN = 'http://localhost:5173';

test('login, role checks, and student ownership are enforced by the API', async (context) => {
  const passwordHash = await hashPassword('test-password-123');
  const teacher = {
    id: 7,
    role: 'teacher',
    fullName: 'Test Teacher',
    email: 'teacher@example.com',
    passwordHash,
    isActive: 1,
  };
  const queries = [];
  const originalQuery = pool.query;
  const originalGetConnection = pool.getConnection;
  let createdStudent;
  pool.query = async (sql, values = []) => {
    queries.push({ sql, values });
    if (sql.includes('password_hash AS passwordHash')) return [[{ ...teacher }], []];
    if (sql.includes('is_active AS isActive FROM users WHERE id')) {
      return [[{ id: teacher.id, role: teacher.role, fullName: teacher.fullName, email: teacher.email, isActive: teacher.isActive }], []];
    }
    if (sql.includes('SELECT s.id, s.name')) return [[], []];
    if (sql.includes('FROM students WHERE id = ? AND teacher_id = ?')) {
      if (createdStudent && String(values[0]) === '42' && String(values[1]) === String(teacher.id)) {
        return [[createdStudent], []];
      }
      return [[], []];
    }
    if (sql.includes('UPDATE users SET last_active_at')) return [{ affectedRows: 1 }, []];
    if (sql.includes('INSERT INTO activity_logs')) return [{ insertId: 1 }, []];
    throw new Error(`Unexpected SQL in API test: ${sql}`);
  };
  pool.getConnection = async () => ({
    async beginTransaction() {},
    async commit() {},
    async rollback() {},
    release() {},
    async query(sql, values) {
      if (sql.includes('DELETE FROM learned_words')) {
        assert.deepEqual(values, [42]);
        return [{ affectedRows: 0 }, []];
      }
      if (sql.includes('INSERT INTO students')) {
        createdStudent = {
          id: 42,
          name: values[1],
          phone: values[2],
          language: values[3],
          proficiencyLevel: values[4],
          timezone: values[5],
          storyTime: values[6],
          isActive: values[7],
        };
        assert.equal(values[0], teacher.id);
        return [{ insertId: 42 }, []];
      }
      if (sql.includes('INSERT INTO learned_words')) {
        assert.deepEqual(values, [42, 'apple', 'תפוח']);
        return [{ affectedRows: 1 }, []];
      }
      throw new Error(`Unexpected transaction SQL in API test: ${sql}`);
    },
  });
  context.after(() => {
    pool.query = originalQuery;
    pool.getConnection = originalGetConnection;
  });

  const server = createApp().listen(0);
  context.after(() => new Promise((resolve) => server.close(resolve)));
  await once(server, 'listening');
  const address = server.address();
  const baseUrl = `http://127.0.0.1:${address.port}`;

  const loginResponse = await fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: { origin: 'http://localhost:5173', 'content-type': 'application/json' },
    body: JSON.stringify({ email: teacher.email, password: 'test-password-123' }),
  });
  assert.equal(loginResponse.status, 200);
  const sessionCookie = loginResponse.headers.get('set-cookie');
  assert.match(sessionCookie, /HttpOnly/i);
  assert.match(sessionCookie, /SameSite=Strict/i);
  assert.equal((await loginResponse.json()).user.role, 'teacher');

  const studentsResponse = await fetch(`${baseUrl}/api/students`, {
    headers: { cookie: sessionCookie.split(';')[0] },
  });
  assert.equal(studentsResponse.status, 200);
  assert.deepEqual((await studentsResponse.json()).students, []);
  const listQuery = queries.find(({ sql }) => sql.includes('SELECT s.id, s.name'));
  assert.deepEqual(listQuery.values, [teacher.id]);

  const missingStudentResponse = await fetch(`${baseUrl}/api/students/99`, {
    headers: { cookie: sessionCookie.split(';')[0] },
  });
  assert.equal(missingStudentResponse.status, 404);
  const ownershipQuery = queries.find(({ sql }) => sql.includes('FROM students WHERE id = ? AND teacher_id = ?'));
  assert.deepEqual(ownershipQuery.values, ['99', teacher.id]);

  const duplicateWordsResponse = await fetch(`${baseUrl}/api/students`, {
    method: 'POST',
    headers: { cookie: sessionCookie.split(';')[0], 'content-type': 'application/json' },
    body: JSON.stringify({
      name: 'Student',
      language: 'English',
      proficiencyLevel: 'Beginner',
      words: [{ word: 'apple' }, { word: 'APPLE' }],
    }),
  });
  assert.equal(duplicateWordsResponse.status, 400);

  const createStudentResponse = await fetch(`${baseUrl}/api/students`, {
    method: 'POST',
    headers: { cookie: sessionCookie.split(';')[0], 'content-type': 'application/json' },
    body: JSON.stringify({
      name: 'Student',
      language: 'English',
      proficiencyLevel: 'Beginner',
      timezone: 'Asia/Jerusalem',
      words: [{ word: 'apple', translation: 'תפוח' }],
    }),
  });
  assert.equal(createStudentResponse.status, 201);
  assert.equal((await createStudentResponse.json()).student.id, 42);

  const unauthenticatedResponse = await fetch(`${baseUrl}/api/students`);
  assert.equal(unauthenticatedResponse.status, 401);

  const forbiddenOriginResponse = await fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: { origin: 'https://untrusted.example', 'content-type': 'application/json' },
    body: JSON.stringify({ email: teacher.email, password: 'test-password-123' }),
  });
  assert.equal(forbiddenOriginResponse.status, 403);

  teacher.role = 'admin';
  const changedRoleResponse = await fetch(`${baseUrl}/api/students`, {
    headers: { cookie: sessionCookie.split(';')[0] },
  });
  assert.equal(changedRoleResponse.status, 403);
});
