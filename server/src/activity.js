import pool from './db.js';

export async function logActivity(actorUserId, action, entityType, entityId, details = null) {
  await pool.query(
    'INSERT INTO activity_logs (actor_user_id, action, entity_type, entity_id, details) VALUES (?, ?, ?, ?, ?)',
    [actorUserId || null, action, entityType, entityId || null, details ? JSON.stringify(details) : null],
  );
}
