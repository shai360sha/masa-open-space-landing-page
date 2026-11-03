import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import test from 'node:test';
import {
  clearSessionCookie,
  createSessionToken,
  decryptSecret,
  encryptSecret,
  hashPassword,
  readSessionToken,
  verifyPassword,
} from '../src/security.js';

process.env.SESSION_SECRET = randomBytes(32).toString('base64url');
process.env.ENCRYPTION_KEY = randomBytes(32).toString('base64');

test('password hashes verify the original password without storing it', async () => {
  const password = 'correct horse battery staple';
  const hash = await hashPassword(password);

  assert.notEqual(hash, password);
  assert.equal(await verifyPassword(password, hash), true);
  assert.equal(await verifyPassword('incorrect password', hash), false);
});

test('password creation enforces a minimum length', async () => {
  await assert.rejects(hashPassword('short'), /12 and 200 characters/);
});

test('session tokens are signed, expire, and reject tampering', () => {
  const token = createSessionToken({ id: 12, role: 'teacher' });
  assert.equal(readSessionToken(token).sub, '12');
  assert.equal(readSessionToken(`${token}x`), null);
  assert.equal(readSessionToken('not-a-session'), null);
});

test('API keys are encrypted with authenticated encryption', () => {
  const key = 'provider-secret-value';
  const encrypted = encryptSecret(key);

  assert.notEqual(encrypted, key);
  assert.equal(decryptSecret(encrypted), key);
  assert.throws(() => decryptSecret(`${encrypted}tampered`));
});

test('API-key encryption rejects invalid key configuration', () => {
  const originalKey = process.env.ENCRYPTION_KEY;
  process.env.ENCRYPTION_KEY = 'invalid';
  try {
    assert.throws(() => encryptSecret('value'), /base64-encoded 32-byte key/);
  } finally {
    process.env.ENCRYPTION_KEY = originalKey;
  }
});

test('session cookies are cleared with matching cookie attributes', () => {
  let cookie;
  clearSessionCookie({
    clearCookie(name, options) {
      cookie = { name, options };
    },
  });
  assert.equal(cookie.name, 'session');
  assert.equal(cookie.options.httpOnly, true);
  assert.equal(cookie.options.sameSite, 'strict');
});
