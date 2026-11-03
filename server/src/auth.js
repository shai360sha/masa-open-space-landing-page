import { verifyPassword, readSessionToken } from './security.js';
import pool from './db.js';
import { HttpError } from './http.js';

export async function authenticate(request, _response, next) {
  try {
    const session = readSessionToken(request.cookies?.session);
    if (!session) {
      throw new HttpError(401, 'יש להתחבר כדי להמשיך.');
    }

    const [users] = await pool.query(
      'SELECT id, role, full_name AS fullName, email, is_active AS isActive FROM users WHERE id = ? LIMIT 1',
      [session.sub],
    );
    if (!users[0]?.isActive) {
      throw new HttpError(401, 'החשבון אינו פעיל.');
    }

    request.user = users[0];
    await pool.query(
      `UPDATE users SET last_active_at = UTC_TIMESTAMP(3)
       WHERE id = ? AND (last_active_at IS NULL OR last_active_at < UTC_TIMESTAMP(3) - INTERVAL 5 MINUTE)`,
      [request.user.id],
    );
    next();
  } catch (error) {
    next(error);
  }
}

export function allowRoles(...roles) {
  return (request, _response, next) => {
    if (!request.user || !roles.includes(request.user.role)) {
      next(new HttpError(403, 'אין הרשאה לבצע פעולה זו.'));
      return;
    }
    next();
  };
}

export async function signIn(email, password) {
  const [users] = await pool.query(
    'SELECT id, role, full_name AS fullName, email, password_hash AS passwordHash, is_active AS isActive FROM users WHERE email = ? LIMIT 1',
    [email],
  );
  const user = users[0];

  if (!user || !user.isActive || !(await verifyPassword(password, user.passwordHash))) {
    throw new HttpError(401, 'כתובת האימייל או הסיסמה שגויים.');
  }

  await pool.query('UPDATE users SET last_active_at = UTC_TIMESTAMP(3) WHERE id = ?', [user.id]);
  return { id: user.id, role: user.role, fullName: user.fullName, email: user.email };
}
