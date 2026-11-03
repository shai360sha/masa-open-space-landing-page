import { Router } from 'express';
import { allowRoles } from '../auth.js';
import { logActivity } from '../activity.js';
import pool from '../db.js';
import { hashPassword } from '../security.js';
import { asyncRoute, HttpError, parseId } from '../http.js';

const router = Router();
router.use(allowRoles('admin'));

router.get('/overview', asyncRoute(async (_request, response) => {
  const [[counts]] = await pool.query(`
    SELECT
      (SELECT COUNT(*) FROM users WHERE role = 'teacher') AS totalTeachers,
      (SELECT COUNT(*) FROM users WHERE role = 'teacher' AND is_active = TRUE) AS activeTeachers,
      (SELECT COUNT(*) FROM students) AS totalStudents,
      (SELECT COUNT(*) FROM stories) AS totalStories,
      (SELECT COUNT(*) FROM story_generation_jobs WHERE status = 'failed') AS failedJobs
  `);
  const [teachers] = await pool.query(
    `SELECT u.id, u.full_name AS fullName, u.email, u.is_active AS isActive,
            u.last_active_at AS lastActiveAt,
            COUNT(DISTINCT s.id) AS studentCount,
            COUNT(DISTINCT st.id) AS storyCount
     FROM users u
     LEFT JOIN students s ON s.teacher_id = u.id
     LEFT JOIN stories st ON st.student_id = s.id
     WHERE u.role = 'teacher'
     GROUP BY u.id ORDER BY u.created_at DESC`,
  );
  const [providers] = await pool.query(
    `SELECT id, name, model, is_default AS isDefault, is_active AS isActive
     FROM ai_providers ORDER BY is_default DESC, name`,
  );
  response.json({ overview: counts, teachers, providers });
}));

router.get('/teachers', asyncRoute(async (_request, response) => {
  const [teachers] = await pool.query(
    `SELECT u.id, u.full_name AS fullName, u.email, u.is_active AS isActive,
            u.last_active_at AS lastActiveAt,
            COUNT(DISTINCT s.id) AS studentCount,
            COUNT(DISTINCT st.id) AS storyCount
     FROM users u
     LEFT JOIN students s ON s.teacher_id = u.id
     LEFT JOIN stories st ON st.student_id = s.id
     WHERE u.role = 'teacher'
     GROUP BY u.id ORDER BY u.created_at DESC`,
  );
  response.json({ teachers });
}));

router.post('/teachers', asyncRoute(async (request, response) => {
  const { fullName, email, password } = request.body;
  validateEmail(email);
  if (typeof fullName !== 'string' || !fullName.trim() || fullName.length > 150) {
    throw new HttpError(400, 'יש להזין שם מלא באורך של עד 150 תווים.');
  }
  if (typeof password !== 'string' || password.length < 12 || password.length > 200) {
    throw new HttpError(400, 'הסיסמה חייבת להכיל בין 12 ל־200 תווים.');
  }
  const passwordHash = await hashPassword(password);
  const [result] = await pool.query(
    `INSERT INTO users (role, full_name, email, password_hash) VALUES ('teacher', ?, ?, ?)`,
    [fullName.trim(), email.trim().toLowerCase(), passwordHash],
  );
  await logActivity(request.user.id, 'teacher.created', 'user', result.insertId);
  response.status(201).json({
    teacher: { id: result.insertId, fullName: fullName.trim(), email: email.trim().toLowerCase(), isActive: true },
  });
}));

router.put('/teachers/:id', asyncRoute(async (request, response) => {
  const teacherId = parseId(request.params.id);
  const [existing] = await pool.query(
    `SELECT id, full_name AS fullName, email, is_active AS isActive
     FROM users WHERE id = ? AND role = 'teacher'`,
    [teacherId],
  );
  if (!existing[0]) {
    throw new HttpError(404, 'המורה לא נמצא.');
  }

  const updates = [];
  if (request.body.fullName !== undefined) {
    if (typeof request.body.fullName !== 'string' || !request.body.fullName.trim() || request.body.fullName.length > 150) {
      throw new HttpError(400, 'השם המלא אינו תקין.');
    }
    updates.push(['full_name', request.body.fullName.trim()]);
  }
  if (request.body.email !== undefined) {
    validateEmail(request.body.email);
    updates.push(['email', request.body.email.trim().toLowerCase()]);
  }
  if (request.body.password !== undefined) {
    if (typeof request.body.password !== 'string' || request.body.password.length < 12 || request.body.password.length > 200) {
      throw new HttpError(400, 'הסיסמה חייבת להכיל בין 12 ל־200 תווים.');
    }
    updates.push(['password_hash', await hashPassword(request.body.password)]);
  }
  if (request.body.isActive !== undefined) {
    if (typeof request.body.isActive !== 'boolean') {
      throw new HttpError(400, 'סטטוס החשבון אינו תקין.');
    }
    updates.push(['is_active', request.body.isActive]);
  }

  if (updates.length) {
    await pool.query(
      `UPDATE users SET ${updates.map(([column]) => `\`${column}\` = ?`).join(', ')} WHERE id = ? AND role = 'teacher'`,
      [...updates.map(([, value]) => value), teacherId],
    );
  }
  await logActivity(request.user.id, 'teacher.updated', 'user', teacherId);
  const [teachers] = await pool.query(
    `SELECT id, full_name AS fullName, email, is_active AS isActive
     FROM users WHERE id = ?`,
    [teacherId],
  );
  response.json({ teacher: teachers[0] });
}));

router.get('/activity', asyncRoute(async (_request, response) => {
  const [activities] = await pool.query(
    `SELECT a.id, a.action, a.entity_type AS entityType, a.entity_id AS entityId,
            a.details, a.created_at AS createdAt, u.full_name AS actorName
     FROM activity_logs a LEFT JOIN users u ON u.id = a.actor_user_id
     ORDER BY a.created_at DESC LIMIT 100`,
  );
  response.json({ activities });
}));

function validateEmail(email) {
  if (typeof email !== 'string' || email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
    throw new HttpError(400, 'יש להזין כתובת אימייל תקינה.');
  }
}

export default router;
