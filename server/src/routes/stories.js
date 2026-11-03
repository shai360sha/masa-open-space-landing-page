import { Router } from 'express';
import { authenticate } from '../auth.js';
import pool from '../db.js';
import { asyncRoute, HttpError, parseId } from '../http.js';

const router = Router();
router.use(authenticate);

router.get('/', asyncRoute(async (request, response) => {
  const isAdmin = request.user.role === 'admin';
  const [stories] = await pool.query(
    `SELECT st.id, st.student_id AS studentId, s.name AS studentName,
            st.title, st.content, st.language, st.proficiency_level AS proficiencyLevel,
            st.model, st.scheduled_for AS scheduledFor, st.created_at AS createdAt,
            u.full_name AS teacherName
     FROM stories st
     JOIN students s ON s.id = st.student_id
     JOIN users u ON u.id = s.teacher_id
     ${isAdmin ? '' : 'WHERE s.teacher_id = ?'}
     ORDER BY st.created_at DESC LIMIT 100`,
    isAdmin ? [] : [request.user.id],
  );
  response.json({ stories });
}));

router.get('/:id', asyncRoute(async (request, response) => {
  const storyId = parseId(request.params.id);
  const [stories] = await pool.query(
    `SELECT st.id, st.student_id AS studentId, s.name AS studentName,
            st.title, st.content, st.language, st.proficiency_level AS proficiencyLevel,
            st.model, st.scheduled_for AS scheduledFor, st.created_at AS createdAt,
            u.full_name AS teacherName
     FROM stories st
     JOIN students s ON s.id = st.student_id
     JOIN users u ON u.id = s.teacher_id
     WHERE st.id = ? ${request.user.role === 'admin' ? '' : 'AND s.teacher_id = ?'}`,
    request.user.role === 'admin' ? [storyId] : [storyId, request.user.id],
  );
  if (!stories[0]) {
    throw new HttpError(404, 'הסיפור לא נמצא.');
  }
  response.json({ story: stories[0] });
}));

export default router;
