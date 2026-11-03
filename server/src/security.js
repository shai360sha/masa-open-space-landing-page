import { createCipheriv, createDecipheriv, createHmac, randomBytes, scrypt as nodeScrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

const scrypt = promisify(nodeScrypt);
const sessionCookie = 'session';

function sessionSecret() {
  const secret = process.env.SESSION_SECRET;
  if (!secret || Buffer.byteLength(secret) < 32) {
    throw new Error('SESSION_SECRET must contain at least 32 bytes.');
  }
  return secret;
}

function encryptionKey() {
  const key = Buffer.from(process.env.ENCRYPTION_KEY || '', 'base64');
  if (key.length !== 32) {
    throw new Error('ENCRYPTION_KEY must be a base64-encoded 32-byte key.');
  }
  return key;
}

export async function hashPassword(password) {
  validatePassword(password);

  const salt = randomBytes(16);
  const derivedKey = await scrypt(password, salt, 64);
  return `scrypt$${salt.toString('base64url')}$${derivedKey.toString('base64url')}`;
}

export function validatePassword(password) {
  if (typeof password !== 'string' || password.length < 12 || password.length > 200) {
    throw new Error('Passwords must contain between 12 and 200 characters.');
  }
}

export async function verifyPassword(password, storedHash) {
  if (typeof password !== 'string' || password.length > 200 || typeof storedHash !== 'string') {
    return false;
  }

  const [algorithm, saltValue, hashValue] = storedHash.split('$');
  if (algorithm !== 'scrypt' || !saltValue || !hashValue) {
    return false;
  }

  const salt = Buffer.from(saltValue, 'base64url');
  const expectedHash = Buffer.from(hashValue, 'base64url');
  if (salt.length !== 16 || expectedHash.length !== 64) {
    return false;
  }

  const actualHash = await scrypt(password, salt, expectedHash.length);
  return timingSafeEqual(expectedHash, actualHash);
}

function encode(value) {
  return Buffer.from(JSON.stringify(value)).toString('base64url');
}

export function createSessionToken(user) {
  const payload = encode({
    sub: String(user.id),
    role: user.role,
    exp: Math.floor(Date.now() / 1000) + 60 * 60 * 12,
  });
  const signature = createHmac('sha256', sessionSecret()).update(payload).digest('base64url');
  return `${payload}.${signature}`;
}

export function readSessionToken(token) {
  if (typeof token !== 'string' || token.length > 2048) {
    return null;
  }

  const [payload, signature, extra] = token.split('.');
  if (!payload || !signature || extra) {
    return null;
  }

  const expected = createHmac('sha256', sessionSecret()).update(payload).digest();
  const actual = Buffer.from(signature, 'base64url');
  if (actual.length !== expected.length || !timingSafeEqual(expected, actual)) {
    return null;
  }

  try {
    const user = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    if (!user.sub || !['admin', 'teacher'].includes(user.role) || user.exp <= Math.floor(Date.now() / 1000)) {
      return null;
    }
    return user;
  } catch {
    return null;
  }
}

export function sessionCookieOptions() {
  return {
    httpOnly: true,
    sameSite: 'strict',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: 12 * 60 * 60 * 1000,
  };
}

export function setSessionCookie(response, user) {
  response.cookie(sessionCookie, createSessionToken(user), sessionCookieOptions());
}

export function clearSessionCookie(response) {
  response.clearCookie(sessionCookie, sessionCookieOptions());
}

export function encryptSecret(value) {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', encryptionKey(), iv);
  const encrypted = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
  return `${iv.toString('base64url')}.${cipher.getAuthTag().toString('base64url')}.${encrypted.toString('base64url')}`;
}

export function decryptSecret(value) {
  const [ivValue, tagValue, encryptedValue] = value.split('.');
  if (!ivValue || !tagValue || !encryptedValue) {
    throw new Error('Stored AI provider key is malformed.');
  }

  const decipher = createDecipheriv('aes-256-gcm', encryptionKey(), Buffer.from(ivValue, 'base64url'));
  decipher.setAuthTag(Buffer.from(tagValue, 'base64url'));
  return Buffer.concat([
    decipher.update(Buffer.from(encryptedValue, 'base64url')),
    decipher.final(),
  ]).toString('utf8');
}
