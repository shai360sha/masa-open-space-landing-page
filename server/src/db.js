import dotenv from 'dotenv';
import { fileURLToPath } from 'node:url';
import mysql from 'mysql2/promise';

dotenv.config({ path: fileURLToPath(new URL('../../.env', import.meta.url)) });

const pool = mysql.createPool({
  host: process.env.MYSQL_HOST || 'localhost',
  port: Number(process.env.MYSQL_PORT || 3306),
  database: process.env.MYSQL_DATABASE || 'ai_story_teachers',
  user: process.env.MYSQL_USER,
  password: process.env.MYSQL_PASSWORD,
  timezone: 'Z',
  waitForConnections: true,
  connectionLimit: 10,
});

export default pool;
