import { Router } from 'express';
import { authenticate, allowRoles } from '../auth.js';
import { logActivity } from '../activity.js';
import pool from '../db.js';
import { asyncRoute, HttpError, parseId } from '../http.js';

const router = Router();
router.use(authenticate, allowRoles('teacher'));

function validateStudent(body, { creating = false } = {}) {
  const fields = ['name', 'language', 'proficiencyLevel'];
  for (const field of fields) {
    if ((creating || body[field] !== undefined) && (typeof body[field] !== 'string' || !body[field].trim())) {
      throw new HttpError(400, `יש למלא את השדה ${field}.`);
    }
    const maxLength = field === 'name' ? 150 : 80;
    if (typeof body[field] === 'string' && body[field].length > maxLength) {
      throw new HttpError(400, `השדה ${field} ארוך מדי.`);
    }
  }

  if (body.phone !== undefined && body.phone !== null && (typeof body.phone !== 'string' || body.phone.length > 32)) {
    throw new HttpError(400, 'מספר הטלפון אינו תקין.');
  }
  if (body.timezone !== undefined) {
    try {
      new Intl.DateTimeFormat('en', { timeZone: body.timezone }).format();
    } catch {
      throw new HttpError(400, 'אזור הזמן אינו תקין.');
    }
  }
  if (body.storyTime !== undefined && body.storyTime !== null && !/^([01]\d|2[0-3]):[0-5]\d$/.test(body.storyTime)) {
    throw new HttpError(400, 'יש להזין שעת סיפור בפורמט HH:MM.');
  }
  if (body.isActive !== undefined && typeof body.isActive !== 'boolean') {
    throw new HttpError(400, 'סטטוס הפעילות אינו תקין.');
  }
  if (body.words !== undefined && (!Array.isArray(body.words) || body.words.length > 500)) {
    throw new HttpError(400, 'רשימת המילים אינה תקינה.');
  }

  if (Array.isArray(body.words)) {
    const seenWords = new Set();
    for (const word of body.words) {
      if (!word || typeof word.word !== 'string' || !word.word.trim() || word.word.length > 191) {
        throw new HttpError(400, 'כל מילה חייבת לכלול טקסט באורך של עד 191 תווים.');
      }
      const normalizedWord = word.word.trim().toLocaleLowerCase();
      if (seenWords.has(normalizedWord)) {
        throw new HttpError(400, 'רשימת המילים מכילה מילים כפולות.');
      }
      seenWords.add(normalizedWord);
      if (word.translation !== undefined && word.translation !== null && (typeof word.translation !== 'string' || word.translation.length > 191)) {
        throw new HttpError(400, 'התרגום חייב להיות באורך של עד 191 תווים.');
      }
    }
  }
}

async function findOwnedStudent(studentId, teacherId) {
  const [students] = await pool.query(
    `SELECT id, name, phone, language, proficiency_level AS proficiencyLevel,
            timezone, TIME_FORMAT(story_time, '%H:%i') AS storyTime, is_active AS isActive,
            created_at AS createdAt
     FROM students WHERE id = ? AND teacher_id = ?`,
    [studentId, teacherId],
  );
  if (!students[0]) {
    throw new HttpError(404, 'התלמיד לא נמצא.');
  }
  return students[0];
}

router.get('/', asyncRoute(async (request, response) => {
  const [students] = await pool.query(
    `SELECT s.id, s.name, s.phone, s.language, s.proficiency_level AS proficiencyLevel,
            s.timezone, TIME_FORMAT(s.story_time, '%H:%i') AS storyTime, s.is_active AS isActive,
            s.created_at AS createdAt, COUNT(DISTINCT st.id) AS storyCount
     FROM students s LEFT JOIN stories st ON st.student_id = s.id
     WHERE s.teacher_id = ?
     GROUP BY s.id ORDER BY s.is_active DESC, s.name`,
    [request.user.id],
  );
  response.json({ students });
}));

router.get('/overview', asyncRoute(async (request, response) => {
  const [[overview]] = await pool.query(
    `SELECT
       (SELECT COUNT(*) FROM students WHERE teacher_id = ?) AS totalStudents,
       (SELECT COUNT(*) FROM students WHERE teacher_id = ? AND is_active = TRUE) AS activeStudents,
       (SELECT COUNT(*) FROM stories st JOIN students s ON s.id = st.student_id WHERE s.teacher_id = ?) AS totalStories`,
    [request.user.id, request.user.id, request.user.id],
  );
  response.json({ overview });
}));

router.post('/', asyncRoute(async (request, response) => {
  validateStudent(request.body, { creating: true });
  const connection = await pool.getConnection();
  let studentId;

  try {
    await connection.beginTransaction();
    const [result] = await connection.query(
      `INSERT INTO students (teacher_id, name, phone, language, proficiency_level, timezone, story_time, is_active)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        request.user.id,
        request.body.name.trim(),
        request.body.phone?.trim() || null,
        request.body.language.trim(),
        request.body.proficiencyLevel.trim(),
        request.body.timezone || 'UTC',
        request.body.storyTime || null,
        request.body.isActive ?? true,
      ],
    );
    studentId = result.insertId;
    await saveWords(connection, studentId, request.body.words || []);
    await connection.commit();
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }

  await logActivity(request.user.id, 'student.created', 'student', studentId);
  response.status(201).json({ student: await findOwnedStudent(studentId, request.user.id) });
}));

router.get('/:id', asyncRoute(async (request, response) => {
  const student = await findOwnedStudent(parseId(request.params.id), request.user.id);
  const [words] = await pool.query(
    'SELECT id, word, translation, learned_at AS learnedAt FROM learned_words WHERE student_id = ? ORDER BY word',
    [student.id],
  );
  const [stories] = await pool.query(
    `SELECT id, title, content, language, proficiency_level AS proficiencyLevel, model,
            scheduled_for AS scheduledFor, created_at AS createdAt
     FROM stories WHERE student_id = ? ORDER BY created_at DESC LIMIT 50`,
    [student.id],
  );
  response.json({ student: { ...student, words, stories } });
}));

router.put('/:id', asyncRoute(async (request, response) => {
  validateStudent(request.body);
  const studentId = parseId(request.params.id);
  await findOwnedStudent(studentId, request.user.id);
  const allowedFields = {
    name: ['name', (value) => value.trim()],
    phone: ['phone', (value) => value?.trim() || null],
    language: ['language', (value) => value.trim()],
    proficiencyLevel: ['proficiency_level', (value) => value.trim()],
    timezone: ['timezone', (value) => value],
    storyTime: ['story_time', (value) => value || null],
    isActive: ['is_active', (value) => value],
  };
  const updates = Object.entries(allowedFields)
    .filter(([field]) => request.body[field] !== undefined)
    .map(([field, [column, transform]]) => [column, transform(request.body[field])]);

  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    if (updates.length) {
      const setClause = updates.map(([column]) => `\`${column}\` = ?`).join(', ');
      await connection.query(
        `UPDATE students SET ${setClause} WHERE id = ? AND teacher_id = ?`,
        [...updates.map(([, value]) => value), studentId, request.user.id],
      );
    }
    if (request.body.words !== undefined) {
      await saveWords(connection, studentId, request.body.words);
    }
    await connection.commit();
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }

  await logActivity(request.user.id, 'student.updated', 'student', studentId);
  response.json({ student: await findOwnedStudent(studentId, request.user.id) });
}));

router.delete('/:id', asyncRoute(async (request, response) => {
  const studentId = parseId(request.params.id);
  await findOwnedStudent(studentId, request.user.id);
  await pool.query(
    'UPDATE students SET is_active = FALSE, story_time = NULL WHERE id = ? AND teacher_id = ?',
    [studentId, request.user.id],
  );
  await logActivity(request.user.id, 'student.archived', 'student', studentId);
  response.status(204).end();
}));

router.post('/:id/stories/generate', asyncRoute(async (request, response) => {
  const studentId = parseId(request.params.id);
  await findOwnedStudent(studentId, request.user.id);
  const [result] = await pool.query(
    `INSERT INTO story_generation_jobs (student_id, scheduled_for, status, next_attempt_at)
     VALUES (?, TIMESTAMP(DATE_FORMAT(UTC_TIMESTAMP(), '%Y-%m-%d %H:%i:00')), 'pending', UTC_TIMESTAMP(3))
     ON DUPLICATE KEY UPDATE id = LAST_INSERT_ID(id)`,
    [studentId],
  );
  const [jobs] = await pool.query(
    'SELECT status FROM story_generation_jobs WHERE id = ?',
    [result.insertId],
  );
  response.status(202).json({ jobId: result.insertId, status: jobs[0].status });
}));

async function saveWords(connection, studentId, words) {
  await connection.query('DELETE FROM learned_words WHERE student_id = ?', [studentId]);
  if (words.length) {
    await connection.query(
      `INSERT INTO learned_words (student_id, word, translation)
       VALUES ${words.map(() => '(?, ?, ?)').join(', ')}`,
      words.flatMap((word) => [studentId, word.word.trim(), word.translation?.trim() || null]),
    );
  }
}

export default router;
