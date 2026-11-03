import { Router } from 'express';
import { authenticate, signIn } from '../auth.js';
import { clearSessionCookie, setSessionCookie } from '../security.js';
import { asyncRoute, HttpError } from '../http.js';

const router = Router();
const loginAttempts = new Map();
const maxAttempts = 10;
const attemptWindow = 15 * 60 * 1000;

function checkLoginLimit(ip, email) {
  const now = Date.now();
  if (loginAttempts.size > 10000) {
    for (const [address, entry] of loginAttempts) {
      if (entry.resetAt <= now) loginAttempts.delete(address);
    }
    if (loginAttempts.size > 10000) {
      loginAttempts.delete(loginAttempts.keys().next().value);
    }
  }
  const key = `${ip}:${email}`;
  const current = loginAttempts.get(key);
  if (!current || current.resetAt <= now) {
    loginAttempts.set(key, { count: 1, resetAt: now + attemptWindow });
    return;
  }
  if (current.count >= maxAttempts) {
    throw new HttpError(429, 'בוצעו יותר מדי ניסיונות התחברות. נסו שוב בעוד כמה דקות.');
  }
  current.count += 1;
}

router.post('/login', asyncRoute(async (request, response) => {
  const { email, password } = request.body || {};
  if (typeof email !== 'string' || email.length > 254 || typeof password !== 'string' || password.length > 200) {
    throw new HttpError(400, 'יש להזין כתובת אימייל וסיסמה.');
  }

  const normalizedEmail = email.trim().toLowerCase();
  checkLoginLimit(request.ip, normalizedEmail);
  const user = await signIn(normalizedEmail, password);
  loginAttempts.delete(`${request.ip}:${normalizedEmail}`);
  setSessionCookie(response, user);
  response.json({ user });
}));

router.post('/logout', (_request, response) => {
  clearSessionCookie(response);
  response.status(204).end();
});

router.get('/me', authenticate, (request, response) => {
  response.json({ user: request.user });
});

export default router;
